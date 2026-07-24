import { ConflictException, ForbiddenException } from "@nestjs/common";
import { InquiryStatus, ListingType, UserRole } from "@prisma/client";
import type { AuthService } from "../src/auth/auth.service";
import type { JobsService } from "../src/jobs/jobs.service";
import { MessagingRealtimeService } from "../src/messaging/messaging-realtime.service";
import { MessagingService } from "../src/messaging/messaging.service";
import type { PrismaService } from "../src/prisma/prisma.service";

const now = new Date("2026-07-19T12:00:00.000Z");

const renter = {
  id: "renter-1",
  supabaseUserId: "supabase-renter-1",
  email: "renter@example.com",
  emailVerifiedAt: now,
  firstName: "Alex",
  lastName: "Renter",
  displayName: "Alex",
  healthcareRole: null,
  roles: [UserRole.renter],
  healthcareAffiliation: null,
  phoneNumber: null,
  bio: null,
  profilePhotoUrl: null,
  activeProfileMediaAssetId: null,
  profileComplete: true,
  currentVerificationStatus: "not_started",
  disabledAt: null,
  createdAt: now,
  updatedAt: now
};

const host = {
  ...renter,
  id: "host-1",
  supabaseUserId: "supabase-host-1",
  email: "host@example.com",
  firstName: "Maya",
  displayName: "Maya",
  roles: [UserRole.host]
};

const admin = {
  ...renter,
  id: "admin-1",
  supabaseUserId: "supabase-admin-1",
  email: "admin@example.com",
  roles: [UserRole.admin]
};

function inquiryRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "inquiry-1",
    listingId: "listing-1",
    renterId: renter.id,
    hostId: host.id,
    status: InquiryStatus.open,
    lastSequence: 1,
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    closedById: null,
    listing: {
      id: "listing-1",
      title: "Room near the medical center",
      city: "Houston",
      listingType: ListingType.private_room,
      photos: [{ fileUrl: "https://cdn.example.test/photo.webp" }]
    },
    renter: {
      id: renter.id,
      displayName: renter.displayName,
      firstName: renter.firstName,
      profilePhotoUrl: null
    },
    host: {
      id: host.id,
      displayName: host.displayName,
      firstName: host.firstName,
      profilePhotoUrl: null
    },
    participantStates: [
      {
        userId: renter.id,
        role: UserRole.renter,
        lastReadSequence: 1,
        lastReadAt: now,
        archivedAt: null
      },
      {
        userId: host.id,
        role: UserRole.host,
        lastReadSequence: 0,
        lastReadAt: null,
        archivedAt: null
      }
    ],
    messages: [
      { body: "Hello host", sequence: 1, senderRole: UserRole.renter, createdAt: now }
    ],
    ...overrides
  };
}

function lockedInquiry(overrides: Record<string, unknown> = {}) {
  return {
    id: "inquiry-1",
    listingId: "listing-1",
    renterId: renter.id,
    hostId: host.id,
    status: InquiryStatus.open,
    lastSequence: 1,
    lastMessageAt: now,
    closedAt: null,
    updatedAt: now,
    ...overrides
  };
}

function createService() {
  const transactionClient = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    inquiry: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn()
    },
    message: { create: jest.fn() },
    inquiryParticipantState: {
      updateMany: jest.fn(),
      upsert: jest.fn(),
      findUnique: jest.fn()
    },
    adminAction: { create: jest.fn() },
    outboxEvent: { create: jest.fn(), findUnique: jest.fn() }
  };
  const prisma = {
    listing: { findFirst: jest.fn() },
    inquiry: { count: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
    message: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(
      async (callback: (client: typeof transactionClient) => Promise<unknown>) =>
        callback(transactionClient)
    )
  };
  const authService = { getCurrentUserRecord: jest.fn() };
  const jobs = { enqueue: jest.fn() };
  const realtime = new MessagingRealtimeService();
  const publish = jest.spyOn(realtime, "publish");
  const service = new MessagingService(
    prisma as unknown as PrismaService,
    authService as unknown as AuthService,
    jobs as unknown as JobsService,
    realtime
  );
  return { service, prisma, transactionClient, authService, jobs, publish };
}

describe("MessagingService", () => {
  it("creates the inquiry, first message, states and ID-only Outbox event atomically", async () => {
    const { service, prisma, transactionClient, authService, jobs, publish } =
      createService();
    authService.getCurrentUserRecord.mockResolvedValue(renter);
    prisma.listing.findFirst.mockResolvedValue({
      id: "listing-1",
      hostId: host.id,
      host: { disabledAt: null }
    });
    transactionClient.inquiry.findFirst.mockResolvedValue(null);
    transactionClient.inquiry.findUnique.mockResolvedValue(inquiryRecord());

    const result = await service.createInquiry("token", "listing-1", {
      message: "  Hello host  "
    });

    expect(transactionClient.inquiry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          listingId: "listing-1",
          renterId: renter.id,
          hostId: host.id,
          lastSequence: 1,
          messages: {
            create: expect.objectContaining({ body: "Hello host", sequence: 1 })
          },
          participantStates: {
            create: expect.arrayContaining([
              expect.objectContaining({ userId: renter.id, role: UserRole.renter }),
              expect.objectContaining({ userId: host.id, role: UserRole.host })
            ])
          }
        })
      })
    );
    const payload = jobs.enqueue.mock.calls[0]?.[1];
    expect(payload).toEqual(
      expect.objectContaining({
        inquiryId: expect.any(String),
        messageId: expect.any(String),
        recipientUserId: host.id,
        template: "inquiry_new_message"
      })
    );
    expect(JSON.stringify(payload)).not.toContain("Hello host");
    expect(JSON.stringify(payload)).not.toContain("@example.com");
    expect(JSON.stringify(publish.mock.calls)).not.toContain("Hello host");
    expect(result).not.toHaveProperty("email");
    expect(result.inquiry.listing).not.toHaveProperty("address");
  });

  it("requires a verified Renter before looking up a listing", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(host);

    await expect(
      service.createInquiry("token", "listing-1", { message: "Hello" })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.listing.findFirst).not.toHaveBeenCalled();
  });

  it("rejects an unverified Renter and self-inquiry with stable errors", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue({
      ...renter,
      emailVerifiedAt: null
    });
    await expect(
      service.createInquiry("token", "listing-1", { message: "Hello" })
    ).rejects.toMatchObject({ response: { code: "EMAIL_NOT_VERIFIED" } });

    authService.getCurrentUserRecord.mockResolvedValue(renter);
    prisma.listing.findFirst.mockResolvedValue({
      id: "listing-1",
      hostId: renter.id,
      host: { disabledAt: null }
    });
    await expect(
      service.createInquiry("token", "listing-1", { message: "Hello" })
    ).rejects.toMatchObject({ response: { code: "INQUIRY_NOT_AVAILABLE" } });
  });

  it("maps a PostgreSQL uniqueness race to INQUIRY_ALREADY_OPEN", async () => {
    const { service, prisma, authService, publish } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(renter);
    prisma.listing.findFirst.mockResolvedValue({
      id: "listing-1",
      hostId: host.id,
      host: { disabledAt: null }
    });
    prisma.$transaction.mockRejectedValue({ code: "P2002" });

    try {
      await service.createInquiry("token", "listing-1", { message: "Hello" });
      throw new Error("expected conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: "INQUIRY_ALREADY_OPEN"
      });
    }
    expect(publish).not.toHaveBeenCalled();
  });

  it("returns a committed creation when realtime delivery is unavailable", async () => {
    const { service, prisma, transactionClient, authService, publish } =
      createService();
    authService.getCurrentUserRecord.mockResolvedValue(renter);
    prisma.listing.findFirst.mockResolvedValue({
      id: "listing-1",
      hostId: host.id,
      host: { disabledAt: null }
    });
    transactionClient.inquiry.findFirst.mockResolvedValue(null);
    transactionClient.inquiry.findUnique.mockResolvedValue(inquiryRecord());
    publish.mockImplementation(() => {
      throw new Error("socket unavailable");
    });

    await expect(
      service.createInquiry("token", "listing-1", { message: "Durable first" })
    ).resolves.toMatchObject({ inquiry: { id: "inquiry-1" } });
    expect(transactionClient.inquiry.create).toHaveBeenCalled();
  });

  it("rejects sends after close without creating a message or Outbox row", async () => {
    const { service, transactionClient, authService, jobs } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(renter);
    transactionClient.$queryRaw.mockResolvedValue([
      lockedInquiry({ status: InquiryStatus.closed, closedAt: now })
    ]);

    await expect(
      service.sendMessage("token", "inquiry-1", { message: "Too late" })
    ).rejects.toMatchObject({ response: { code: "INQUIRY_CLOSED" } });
    expect(transactionClient.message.create).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it("marks Admin messages, audits without a body and notifies both participants", async () => {
    const { service, transactionClient, authService, jobs, publish } =
      createService();
    authService.getCurrentUserRecord.mockResolvedValue(admin);
    transactionClient.$queryRaw.mockResolvedValue([lockedInquiry()]);

    const result = await service.sendMessage("token", "inquiry-1", {
      message: "Support update"
    });

    expect(result).toMatchObject({ isAdmin: true, sender: { role: UserRole.admin } });
    expect(transactionClient.adminAction.create).toHaveBeenCalledWith({
      data: {
        adminId: admin.id,
        targetType: "inquiry",
        targetId: "inquiry-1",
        action: "message_sent"
      }
    });
    expect(JSON.stringify(transactionClient.adminAction.create.mock.calls)).not.toContain(
      "Support update"
    );
    expect(jobs.enqueue).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(publish.mock.calls)).not.toContain("Support update");
  });

  it("clamps read movement to the committed last sequence", async () => {
    const { service, prisma, transactionClient, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(host);
    transactionClient.$queryRaw.mockResolvedValue([lockedInquiry({ lastSequence: 3 })]);
    transactionClient.inquiryParticipantState.findUnique.mockResolvedValue({
      inquiryId: "inquiry-1",
      userId: host.id,
      lastReadSequence: 3,
      lastReadAt: now,
      updatedAt: now
    });
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(
      service.markRead("token", "inquiry-1", { sequence: 999 })
    ).resolves.toMatchObject({ lastReadSequence: 3 });
  });

  it("returns an opaque NOT_FOUND for unrelated private inquiry access", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue({
      ...renter,
      id: "unrelated"
    });
    prisma.inquiry.findFirst.mockResolvedValue(null);

    await expect(
      service.getInquiry("token", "private-id", {})
    ).rejects.toMatchObject({ response: { code: "NOT_FOUND" } });
  });

  it("returns stable sequence pagination and privacy-safe detail DTOs", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(host);
    prisma.inquiry.findFirst.mockResolvedValue(inquiryRecord());
    prisma.message.findMany.mockResolvedValue([
      {
        id: "message-2",
        sequence: 2,
        senderRole: UserRole.host,
        body: "Reply",
        createdAt: now,
        sender: { id: host.id, displayName: host.displayName, firstName: host.firstName }
      }
    ]);
    prisma.$queryRaw.mockResolvedValue([{ inquiryId: "inquiry-1", unreadCount: 1n }]);

    const result = await service.getInquiry("token", "inquiry-1", {
      afterSequence: 1,
      limit: 1
    });
    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { inquiryId: "inquiry-1", sequence: { gt: 1 } },
        orderBy: { sequence: "asc" },
        take: 2
      })
    );
    expect(result.pageInfo).toEqual({ afterSequence: 1, nextCursor: 2, hasMore: false });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("@example.com");
    expect(serialized).not.toContain("supabase-");
    expect(serialized).not.toContain("phoneNumber");
    expect(serialized).not.toContain("latitude");
  });

  it("returns actor-scoped paged summaries with per-user unread counts", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(host);
    prisma.inquiry.count.mockResolvedValue(1);
    prisma.inquiry.findMany.mockResolvedValue([inquiryRecord()]);
    prisma.$queryRaw.mockResolvedValue([
      { inquiryId: "inquiry-1", unreadCount: 1n }
    ]);

    const result = await service.listInquiries("token", {
      status: "open",
      archived: false,
      page: 1,
      limit: 20
    });
    expect(result.meta).toEqual({ page: 1, limit: 20, total: 1 });
    expect(result.data[0]).toMatchObject({
      id: "inquiry-1",
      unreadCount: 1,
      archived: false,
      counterpart: { id: renter.id }
    });
    expect(prisma.inquiry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
        skip: 0,
        take: 20
      })
    );
  });

  it("archives only the current actor state", async () => {
    const { service, transactionClient, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(renter);
    transactionClient.$queryRaw.mockResolvedValue([lockedInquiry()]);
    transactionClient.inquiryParticipantState.upsert.mockResolvedValue({
      inquiryId: "inquiry-1",
      userId: renter.id,
      archivedAt: now,
      updatedAt: now
    });

    await expect(
      service.archiveInquiry("token", "inquiry-1", { archived: true })
    ).resolves.toMatchObject({ archived: true, archivedAt: now.toISOString() });
    expect(transactionClient.inquiryParticipantState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          inquiryId_userId: { inquiryId: "inquiry-1", userId: renter.id }
        }
      })
    );
  });

  it("closes idempotently without issuing a second update", async () => {
    const { service, transactionClient, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(host);
    transactionClient.$queryRaw.mockResolvedValue([
      lockedInquiry({ status: InquiryStatus.closed, closedAt: now })
    ]);

    await expect(service.closeInquiry("token", "inquiry-1")).resolves.toEqual({
      id: "inquiry-1",
      status: "closed",
      closedAt: now.toISOString()
    });
    expect(transactionClient.inquiry.update).not.toHaveBeenCalled();
  });
});
