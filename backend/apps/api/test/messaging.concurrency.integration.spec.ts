import { ListingStatus, UserRole, type User } from "@prisma/client";
import type { AuthService } from "../src/auth/auth.service";
import { JobsService } from "../src/jobs/jobs.service";
import { MessagingRealtimeService } from "../src/messaging/messaging-realtime.service";
import { MessagingService } from "../src/messaging/messaging.service";
import { PrismaService } from "../src/prisma/prisma.service";

const describeWithDatabase =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? describe : describe.skip;

describeWithDatabase("MessagingService PostgreSQL concurrency", () => {
  const suffix = `${Date.now()}`;
  let prisma: PrismaService;
  let renter: User;
  let host: User;
  let listingId = "";
  let actor: User;
  let service: MessagingService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    host = await prisma.user.create({
      data: {
        supabaseUserId: `messaging-host-${suffix}`,
        email: `messaging-host-${suffix}@example.com`,
        emailVerifiedAt: new Date(),
        roles: [UserRole.host]
      }
    });
    renter = await prisma.user.create({
      data: {
        supabaseUserId: `messaging-renter-${suffix}`,
        email: `messaging-renter-${suffix}@example.com`,
        emailVerifiedAt: new Date(),
        roles: [UserRole.renter]
      }
    });
    actor = renter;
    const listing = await prisma.listing.create({
      data: {
        hostId: host.id,
        title: "Messaging concurrency fixture",
        description: "Approved listing for an inquiry race.",
        city: "Houston",
        priceCents: 8_000,
        priceUnit: "day",
        listingType: "private_room",
        status: ListingStatus.approved
      }
    });
    listingId = listing.id;
    const auth = { getCurrentUserRecord: jest.fn(async () => actor) };
    service = new MessagingService(
      prisma,
      auth as unknown as AuthService,
      new JobsService(prisma),
      new MessagingRealtimeService()
    );
  });

  afterAll(async () => {
    if (!prisma) return;
    const inquiries = await prisma.inquiry.findMany({
      where: { listingId },
      select: { id: true }
    });
    const inquiryIds = inquiries.map((inquiry) => inquiry.id);
    await prisma.adminAction.deleteMany({
      where: { targetType: "inquiry", targetId: { in: inquiryIds } }
    });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: inquiryIds } } });
    await prisma.message.deleteMany({ where: { inquiryId: { in: inquiryIds } } });
    await prisma.inquiryParticipantState.deleteMany({
      where: { inquiryId: { in: inquiryIds } }
    });
    await prisma.inquiry.deleteMany({ where: { id: { in: inquiryIds } } });
    await prisma.listing.deleteMany({ where: { id: listingId } });
    await prisma.user.deleteMany({
      where: { supabaseUserId: { endsWith: suffix } }
    });
    await prisma.$disconnect();
  });

  it("allows exactly one concurrent open inquiry and commits one message/Outbox event", async () => {
    const results = await Promise.allSettled([
      service.createInquiry("renter-token", listingId, { message: "First request" }),
      service.createInquiry("renter-token", listingId, { message: "Second request" })
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const inquiries = await prisma.inquiry.findMany({ where: { listingId } });
    expect(inquiries).toHaveLength(1);
    await expect(
      prisma.message.count({ where: { inquiryId: inquiries[0]?.id } })
    ).resolves.toBe(1);
    await expect(
      prisma.outboxEvent.count({ where: { aggregateId: inquiries[0]?.id } })
    ).resolves.toBe(1);
    const outbox = await prisma.outboxEvent.findFirstOrThrow({
      where: { aggregateId: inquiries[0]?.id },
      select: { payload: true }
    });
    expect(Object.keys(outbox.payload as Record<string, unknown>).sort()).toEqual([
      "inquiryId",
      "messageId",
      "recipientUserId",
      "template"
    ]);
    expect(JSON.stringify(outbox.payload)).not.toContain("request");
    expect(JSON.stringify(outbox.payload)).not.toContain("@example.com");
  });

  it("rolls back a message and ordering metadata when its Outbox write fails", async () => {
    const inquiry = await prisma.inquiry.findFirstOrThrow({ where: { listingId } });
    actor = host;
    const failingJobs = { enqueue: jest.fn(() => Promise.reject(new Error("forced"))) };
    const publish = jest.fn();
    const failingService = new MessagingService(
      prisma,
      { getCurrentUserRecord: jest.fn(async () => actor) } as unknown as AuthService,
      failingJobs as unknown as JobsService,
      { publish } as unknown as MessagingRealtimeService
    );

    await expect(
      failingService.sendMessage("host-token", inquiry.id, { message: "Rollback me" })
    ).rejects.toThrow("forced");
    await expect(
      prisma.message.count({ where: { inquiryId: inquiry.id } })
    ).resolves.toBe(1);
    await expect(
      prisma.inquiry.findUnique({ where: { id: inquiry.id }, select: { lastSequence: true } })
    ).resolves.toEqual({ lastSequence: 1 });
    expect(publish).not.toHaveBeenCalled();
  });

  it("keeps a committed REST write successful when realtime publication fails", async () => {
    const inquiry = await prisma.inquiry.findFirstOrThrow({ where: { listingId } });
    actor = host;
    const failingRealtime = {
      publish: jest.fn(() => {
        throw new Error("forced socket failure");
      })
    };
    const resilientService = new MessagingService(
      prisma,
      { getCurrentUserRecord: jest.fn(async () => actor) } as unknown as AuthService,
      new JobsService(prisma),
      failingRealtime as unknown as MessagingRealtimeService
    );

    await expect(
      resilientService.sendMessage("host-token", inquiry.id, {
        message: "Committed despite socket failure"
      })
    ).resolves.toMatchObject({ sequence: 2 });
    await expect(
      prisma.message.count({ where: { inquiryId: inquiry.id } })
    ).resolves.toBe(2);
    await expect(
      prisma.outboxEvent.count({ where: { aggregateId: inquiry.id } })
    ).resolves.toBe(2);
    await expect(
      prisma.inquiry.findUnique({ where: { id: inquiry.id }, select: { lastSequence: true } })
    ).resolves.toEqual({ lastSequence: 2 });
    expect(failingRealtime.publish).toHaveBeenCalledTimes(1);
  });

  it("keeps concurrent read cursor movement monotonic and bounded", async () => {
    const inquiry = await prisma.inquiry.findFirstOrThrow({ where: { listingId } });
    await prisma.message.create({
      data: {
        inquiryId: inquiry.id,
        sequence: 3,
        senderId: renter.id,
        senderRole: UserRole.renter,
        body: "Third durable message"
      }
    });
    await prisma.inquiry.update({
      where: { id: inquiry.id },
      data: { lastSequence: 3, lastMessageAt: new Date() }
    });
    actor = host;

    const catchUp = await service.getInquiry("host-token", inquiry.id, {
      afterSequence: 2,
      limit: 50
    });
    expect(catchUp.messages.map((message) => message.sequence)).toEqual([3]);

    await Promise.all([
      service.markRead("host-token", inquiry.id, { sequence: 3 }),
      service.markRead("host-token", inquiry.id, { sequence: 1 }),
      service.markRead("host-token", inquiry.id, { sequence: 999 })
    ]);
    await expect(
      prisma.inquiryParticipantState.findUnique({
        where: { inquiryId_userId: { inquiryId: inquiry.id, userId: host.id } },
        select: { lastReadSequence: true }
      })
    ).resolves.toEqual({ lastReadSequence: 3 });
  });
});
