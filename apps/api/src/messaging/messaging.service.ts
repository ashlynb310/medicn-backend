import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException
} from "@nestjs/common";
import {
  InquiryStatus,
  ListingStatus,
  MediaAssetStatus,
  Prisma,
  UserRole,
  type User
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AuthService } from "../auth/auth.service";
import { JobsService } from "../jobs/jobs.service";
import { PrismaService } from "../prisma/prisma.service";
import type { ArchiveInquiryDto } from "./dto/archive-inquiry.dto";
import type { InquiryMessagesQueryDto } from "./dto/inquiry-messages-query.dto";
import type { ListInquiriesQueryDto } from "./dto/list-inquiries-query.dto";
import type { MessageBodyDto } from "./dto/message-body.dto";
import type { ReadInquiryDto } from "./dto/read-inquiry.dto";
import { normalizeMessageBody } from "./message-content";
import { MessagingRealtimeService } from "./messaging-realtime.service";
import {
  MESSAGING_NOTIFICATION_EMAIL_JOB,
  inquiryRoom,
  userRoom,
  type MessagingNotificationEmailPayload,
  type MessagingRealtimeEvent
} from "./messaging.types";

const safeInquiryInclude = Prisma.validator<Prisma.InquiryInclude>()({
  listing: {
    select: {
      id: true,
      title: true,
      city: true,
      listingType: true,
      photos: {
        where: {
          deletedAt: null,
          OR: [
            { legacyUnprocessed: true },
            { mediaAsset: { status: MediaAssetStatus.ready } }
          ]
        },
        orderBy: { displayOrder: "asc" },
        take: 1,
        select: { fileUrl: true }
      }
    }
  },
  renter: {
    select: { id: true, displayName: true, firstName: true, profilePhotoUrl: true }
  },
  host: {
    select: { id: true, displayName: true, firstName: true, profilePhotoUrl: true }
  },
  participantStates: {
    select: {
      userId: true,
      role: true,
      lastReadSequence: true,
      lastReadAt: true,
      archivedAt: true
    }
  },
  messages: {
    orderBy: { sequence: "desc" },
    take: 1,
    select: { body: true, sequence: true, senderRole: true, createdAt: true }
  }
});

type SafeInquiry = Prisma.InquiryGetPayload<{ include: typeof safeInquiryInclude }>;

interface LockedInquiry {
  id: string;
  listingId: string;
  renterId: string;
  hostId: string;
  status: InquiryStatus;
  lastSequence: number;
  lastMessageAt: Date | null;
  closedAt: Date | null;
  updatedAt: Date;
}

interface UnreadRow {
  inquiryId: string;
  unreadCount: bigint | number;
}

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly jobs: JobsService,
    private readonly realtime: MessagingRealtimeService
  ) {}

  async createInquiry(token: string, listingId: string, input: MessageBodyDto) {
    const actor = await this.authService.getCurrentUserRecord(token);
    this.assertRenter(actor);
    this.assertVerifiedEmail(actor);
    const body = normalizeMessageBody(input.message);
    const listing = await this.prisma.listing.findFirst({
      where: { id: listingId, status: ListingStatus.approved, deletedAt: null },
      select: {
        id: true,
        hostId: true,
        host: { select: { disabledAt: true } }
      }
    });

    if (!listing || listing.host.disabledAt !== null || listing.hostId === actor.id) {
      throw new UnprocessableEntityException({
        code: "INQUIRY_NOT_AVAILABLE",
        message: "This listing is not available for a new inquiry.",
        details: {}
      });
    }

    const inquiryId = randomUUID();
    const messageId = randomUUID();
    const now = new Date();
    let created: SafeInquiry;

    try {
      created = await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.inquiry.findFirst({
          where: { listingId, renterId: actor.id, closedAt: null },
          select: { id: true }
        });
        if (existing) throw this.alreadyOpen();

        await transaction.inquiry.create({
          data: {
            id: inquiryId,
            listingId,
            renterId: actor.id,
            hostId: listing.hostId,
            status: InquiryStatus.open,
            lastSequence: 1,
            lastMessageAt: now,
            participantStates: {
              create: [
                {
                  userId: actor.id,
                  role: UserRole.renter,
                  lastReadSequence: 1,
                  lastReadAt: now
                },
                { userId: listing.hostId, role: UserRole.host }
              ]
            },
            messages: {
              create: {
                id: messageId,
                sequence: 1,
                senderId: actor.id,
                senderRole: UserRole.renter,
                body,
                createdAt: now
              }
            }
          }
        });
        await this.enqueueEmail(transaction, inquiryId, messageId, listing.hostId);
        const inquiry = await transaction.inquiry.findUnique({
          where: { id: inquiryId },
          include: safeInquiryInclude
        });
        if (!inquiry) throw this.notFound();
        return inquiry;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) throw this.alreadyOpen();
      throw error;
    }

    this.emit(
      this.messageEvents(created, messageId, 1, now, [listing.hostId])
    );
    return {
      inquiry: this.toSummary(created, actor.id, 0),
      messages: [
        {
          id: messageId,
          sequence: 1,
          sender: {
            id: actor.id,
            displayName: this.displayName(actor),
            role: UserRole.renter
          },
          isAdmin: false,
          body,
          createdAt: now.toISOString()
        }
      ]
    };
  }

  async listInquiries(token: string, query: ListInquiriesQueryDto) {
    const actor = await this.authService.getCurrentUserRecord(token);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = this.visibleWhere(actor);
    const archived = query.archived ?? false;
    where.participantStates = archived
      ? { some: { userId: actor.id, archivedAt: { not: null } } }
      : { none: { userId: actor.id, archivedAt: { not: null } } };
    if (query.status === "open") where.closedAt = null;
    if (query.status === "closed") where.closedAt = { not: null };

    const [total, inquiries] = await Promise.all([
      this.prisma.inquiry.count({ where }),
      this.prisma.inquiry.findMany({
        where,
        include: safeInquiryInclude,
        orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit
      })
    ]);
    const unread = await this.unreadCounts(
      actor.id,
      inquiries.map((inquiry) => inquiry.id)
    );

    return {
      data: inquiries.map((inquiry) =>
        this.toSummary(inquiry, actor.id, unread.get(inquiry.id) ?? 0)
      ),
      meta: { page, limit, total },
      error: null
    };
  }

  async getInquiry(
    token: string,
    inquiryId: string,
    query: InquiryMessagesQueryDto
  ) {
    const actor = await this.authService.getCurrentUserRecord(token);
    const inquiry = await this.prisma.inquiry.findFirst({
      where: { id: inquiryId, ...this.visibleWhere(actor) },
      include: safeInquiryInclude
    });
    if (!inquiry) throw this.notFound();

    const afterSequence = query.afterSequence ?? 0;
    const limit = query.limit ?? 50;
    const messages = await this.prisma.message.findMany({
      where: { inquiryId, sequence: { gt: afterSequence } },
      orderBy: { sequence: "asc" },
      take: limit + 1,
      select: {
        id: true,
        sequence: true,
        senderRole: true,
        body: true,
        createdAt: true,
        sender: { select: { id: true, displayName: true, firstName: true } }
      }
    });
    const hasMore = messages.length > limit;
    const pageMessages = hasMore ? messages.slice(0, limit) : messages;
    const unread = await this.unreadCount(actor.id, inquiryId);

    return {
      inquiry: this.toSummary(inquiry, actor.id, unread),
      messages: pageMessages.map((message) => ({
        id: message.id,
        sequence: message.sequence,
        sender: {
          id: message.sender.id,
          displayName: this.displayName(message.sender),
          role: message.senderRole
        },
        isAdmin: message.senderRole === UserRole.admin,
        body: message.body,
        createdAt: message.createdAt.toISOString()
      })),
      pageInfo: {
        afterSequence,
        nextCursor: pageMessages.at(-1)?.sequence ?? afterSequence,
        hasMore
      }
    };
  }

  async sendMessage(token: string, inquiryId: string, input: MessageBodyDto) {
    const actor = await this.authService.getCurrentUserRecord(token);
    const body = normalizeMessageBody(input.message);
    const messageId = randomUUID();
    const now = new Date();
    const result = await this.prisma.$transaction(async (transaction) => {
      const inquiry = await this.lockInquiry(transaction, inquiryId);
      const senderRole = this.assertCanSend(actor, inquiry);
      if (inquiry.closedAt !== null) throw this.closed();
      const sequence = inquiry.lastSequence + 1;
      const recipientIds =
        senderRole === UserRole.admin
          ? [inquiry.renterId, inquiry.hostId]
          : [senderRole === UserRole.renter ? inquiry.hostId : inquiry.renterId];

      await transaction.message.create({
        data: {
          id: messageId,
          inquiryId,
          sequence,
          senderId: actor.id,
          senderRole,
          body,
          createdAt: now
        }
      });
      await transaction.inquiry.update({
        where: { id: inquiryId },
        data: { lastSequence: sequence, lastMessageAt: now }
      });
      await transaction.inquiryParticipantState.updateMany({
        where: { inquiryId, userId: { in: recipientIds } },
        data: { archivedAt: null }
      });
      for (const recipientId of recipientIds) {
        await this.enqueueEmail(transaction, inquiryId, messageId, recipientId);
      }
      if (senderRole === UserRole.admin) {
        await transaction.adminAction.create({
          data: {
            adminId: actor.id,
            targetType: "inquiry",
            targetId: inquiryId,
            action: "message_sent"
          }
        });
      }
      return { inquiry, recipientIds, senderRole, sequence };
    });

    const updatedAt = now.toISOString();
    this.emit(
      this.messageEvents(
        { ...result.inquiry, lastSequence: result.sequence, lastMessageAt: now, updatedAt: now },
        messageId,
        result.sequence,
        now,
        result.recipientIds
      )
    );
    return {
      id: messageId,
      inquiryId,
      sequence: result.sequence,
      sender: {
        id: actor.id,
        displayName: this.displayName(actor),
        role: result.senderRole
      },
      isAdmin: result.senderRole === UserRole.admin,
      body,
      createdAt: updatedAt
    };
  }

  async markRead(token: string, inquiryId: string, input: ReadInquiryDto) {
    const actor = await this.authService.getCurrentUserRecord(token);
    const now = new Date();
    const state = await this.prisma.$transaction(async (transaction) => {
      const inquiry = await this.lockInquiry(transaction, inquiryId);
      const role = this.assertCanRead(actor, inquiry);
      const boundedSequence = Math.min(input.sequence, inquiry.lastSequence);
      await transaction.inquiryParticipantState.upsert({
        where: { inquiryId_userId: { inquiryId, userId: actor.id } },
        create: { inquiryId, userId: actor.id, role },
        update: {}
      });
      await transaction.$executeRaw(Prisma.sql`
        UPDATE "InquiryParticipantState"
        SET
          "lastReadSequence" = ${boundedSequence},
          "lastReadAt" = ${now},
          "updatedAt" = ${now}
        WHERE "inquiryId" = ${inquiryId}
          AND "userId" = ${actor.id}
          AND "lastReadSequence" < ${boundedSequence}
      `);
      const updated = await transaction.inquiryParticipantState.findUnique({
        where: { inquiryId_userId: { inquiryId, userId: actor.id } }
      });
      if (!updated) throw this.notFound();
      return updated;
    });
    const unreadCount = await this.unreadCount(actor.id, inquiryId);
    this.emit([
      {
        name: "unread.changed",
        rooms: [userRoom(actor.id)],
        payload: {
          eventId: `read:${inquiryId}:${actor.id}:${state.lastReadSequence}`,
          inquiryId,
          userId: actor.id,
          lastReadSequence: state.lastReadSequence,
          unreadCount,
          updatedAt: state.updatedAt.toISOString()
        }
      }
    ]);
    return {
      inquiryId,
      lastReadSequence: state.lastReadSequence,
      unreadCount,
      readAt: state.lastReadAt?.toISOString() ?? null
    };
  }

  async closeInquiry(token: string, inquiryId: string) {
    const actor = await this.authService.getCurrentUserRecord(token);
    const result = await this.prisma.$transaction(async (transaction) => {
      const inquiry = await this.lockInquiry(transaction, inquiryId);
      this.assertCanRead(actor, inquiry);
      if (inquiry.closedAt !== null) return inquiry;
      const closedAt = new Date();
      return transaction.inquiry.update({
        where: { id: inquiryId },
        data: {
          status: InquiryStatus.closed,
          closedAt,
          closedById: actor.id
        }
      });
    });
    const closedAt = result.closedAt ?? new Date();
    this.emit([
      {
        name: "inquiry.closed",
        rooms: [
          inquiryRoom(inquiryId),
          userRoom(result.renterId),
          userRoom(result.hostId)
        ],
        payload: {
          eventId: `closed:${inquiryId}:${closedAt.toISOString()}`,
          inquiryId,
          status: "closed",
          closedAt: closedAt.toISOString()
        }
      }
    ]);
    return { id: inquiryId, status: "closed" as const, closedAt: closedAt.toISOString() };
  }

  async archiveInquiry(
    token: string,
    inquiryId: string,
    input: ArchiveInquiryDto
  ) {
    const actor = await this.authService.getCurrentUserRecord(token);
    const now = new Date();
    const result = await this.prisma.$transaction(async (transaction) => {
      const inquiry = await this.lockInquiry(transaction, inquiryId);
      const role = this.assertCanRead(actor, inquiry);
      const state = await transaction.inquiryParticipantState.upsert({
        where: { inquiryId_userId: { inquiryId, userId: actor.id } },
        create: {
          inquiryId,
          userId: actor.id,
          role,
          archivedAt: input.archived ? now : null
        },
        update: { archivedAt: input.archived ? now : null }
      });
      return { inquiry, state };
    });
    this.emit([
      {
        name: "inquiry.updated",
        rooms: [userRoom(actor.id)],
        payload: {
          eventId: `archive:${inquiryId}:${actor.id}:${input.archived}`,
          inquiryId,
          status: result.inquiry.closedAt ? "closed" : "open",
          lastSequence: result.inquiry.lastSequence,
          lastMessageAt: result.inquiry.lastMessageAt?.toISOString() ?? null,
          updatedAt: result.state.updatedAt.toISOString()
        }
      }
    ]);
    return {
      inquiryId,
      archived: input.archived,
      archivedAt: result.state.archivedAt?.toISOString() ?? null
    };
  }

  async canAccessInquiry(
    user: Pick<User, "id" | "roles">,
    inquiryId: string
  ) {
    const inquiry = await this.prisma.inquiry.findFirst({
      where: { id: inquiryId, ...this.visibleWhere(user) },
      select: { id: true }
    });
    return inquiry !== null;
  }

  private async lockInquiry(
    transaction: Prisma.TransactionClient,
    inquiryId: string
  ) {
    const rows = await transaction.$queryRaw<LockedInquiry[]>(Prisma.sql`
      SELECT
        "id", "listingId", "renterId", "hostId", "status",
        "lastSequence", "lastMessageAt", "closedAt", "updatedAt"
      FROM "Inquiry"
      WHERE "id" = ${inquiryId}
      FOR UPDATE
    `);
    const inquiry = rows[0];
    if (!inquiry) throw this.notFound();
    return inquiry;
  }

  private assertCanRead(actor: User, inquiry: LockedInquiry) {
    if (actor.roles.includes(UserRole.admin)) return UserRole.admin;
    if (actor.id === inquiry.renterId) return UserRole.renter;
    if (actor.id === inquiry.hostId) return UserRole.host;
    throw this.notFound();
  }

  private assertCanSend(actor: User, inquiry: LockedInquiry) {
    const role = this.assertCanRead(actor, inquiry);
    if (role === UserRole.admin || actor.roles.includes(role)) return role;
    throw new ForbiddenException({
      code: "FORBIDDEN",
      message: "The current account is not enabled to send in this inquiry.",
      details: {}
    });
  }

  private visibleWhere(
    actor: Pick<User, "id" | "roles">
  ): Prisma.InquiryWhereInput {
    return actor.roles.includes(UserRole.admin)
      ? {}
      : { OR: [{ renterId: actor.id }, { hostId: actor.id }] };
  }

  private assertRenter(actor: User) {
    if (actor.roles.includes(UserRole.renter)) return;
    throw new ForbiddenException({
      code: "FORBIDDEN",
      message: "Only renters can create listing inquiries.",
      details: {}
    });
  }

  private assertVerifiedEmail(actor: User) {
    if (actor.emailVerifiedAt !== null) return;
    throw new ForbiddenException({
      code: "EMAIL_NOT_VERIFIED",
      message: "A verified email address is required to create an inquiry.",
      details: {}
    });
  }

  private async enqueueEmail(
    transaction: Prisma.TransactionClient,
    inquiryId: string,
    messageId: string,
    recipientUserId: string
  ) {
    const payload: MessagingNotificationEmailPayload = {
      inquiryId,
      messageId,
      recipientUserId,
      template: "inquiry_new_message"
    };
    await this.jobs.enqueue(MESSAGING_NOTIFICATION_EMAIL_JOB, payload, {
      aggregateType: "inquiry",
      aggregateId: inquiryId,
      client: transaction,
      deduplicationKey: `messaging-email:${messageId}:${recipientUserId}`
    });
  }

  private async unreadCounts(userId: string, inquiryIds: string[]) {
    if (inquiryIds.length === 0) return new Map<string, number>();
    const rows = await this.prisma.$queryRaw<UnreadRow[]>(Prisma.sql`
      SELECT
        message."inquiryId" AS "inquiryId",
        COUNT(*)::BIGINT AS "unreadCount"
      FROM "Message" AS message
      LEFT JOIN "InquiryParticipantState" AS state
        ON state."inquiryId" = message."inquiryId"
        AND state."userId" = ${userId}
      WHERE message."inquiryId" IN (${Prisma.join(inquiryIds)})
        AND message."senderId" <> ${userId}
        AND message."sequence" > COALESCE(state."lastReadSequence", 0)
      GROUP BY message."inquiryId"
    `);
    return new Map(
      rows.map((row) => [row.inquiryId, Number(row.unreadCount)] as const)
    );
  }

  private async unreadCount(userId: string, inquiryId: string) {
    return (await this.unreadCounts(userId, [inquiryId])).get(inquiryId) ?? 0;
  }

  private toSummary(inquiry: SafeInquiry, actorId: string, unreadCount: number) {
    const state = inquiry.participantStates.find((item) => item.userId === actorId);
    const lastMessage = inquiry.messages[0];
    const counterpart =
      actorId === inquiry.renterId
        ? inquiry.host
        : actorId === inquiry.hostId
          ? inquiry.renter
          : null;
    return {
      id: inquiry.id,
      status: inquiry.closedAt ? "closed" as const : "open" as const,
      listing: {
        id: inquiry.listing.id,
        title: inquiry.listing.title,
        city: inquiry.listing.city,
        listingType: inquiry.listing.listingType,
        photoUrl: inquiry.listing.photos[0]?.fileUrl ?? null
      },
      counterpart: counterpart
        ? {
            id: counterpart.id,
            displayName: this.displayName(counterpart),
            profilePhotoUrl: counterpart.profilePhotoUrl
          }
        : null,
      participants: {
        renter: {
          id: inquiry.renter.id,
          displayName: this.displayName(inquiry.renter),
          profilePhotoUrl: inquiry.renter.profilePhotoUrl
        },
        host: {
          id: inquiry.host.id,
          displayName: this.displayName(inquiry.host),
          profilePhotoUrl: inquiry.host.profilePhotoUrl
        }
      },
      unreadCount,
      archived: state?.archivedAt !== null && state?.archivedAt !== undefined,
      lastReadSequence: state?.lastReadSequence ?? 0,
      lastSequence: inquiry.lastSequence,
      lastMessageAt: inquiry.lastMessageAt?.toISOString() ?? null,
      lastMessagePreview: lastMessage
        ? [...lastMessage.body].slice(0, 160).join("")
        : null,
      closedAt: inquiry.closedAt?.toISOString() ?? null,
      createdAt: inquiry.createdAt.toISOString(),
      updatedAt: inquiry.updatedAt.toISOString()
    };
  }

  private messageEvents(
    inquiry: Pick<
      LockedInquiry,
      "id" | "renterId" | "hostId" | "lastSequence" | "lastMessageAt" | "updatedAt"
    >,
    messageId: string,
    sequence: number,
    createdAt: Date,
    recipientIds: string[]
  ): MessagingRealtimeEvent[] {
    const participantRooms = [userRoom(inquiry.renterId), userRoom(inquiry.hostId)];
    return [
      {
        name: "message.created",
        rooms: [inquiryRoom(inquiry.id), ...recipientIds.map(userRoom)],
        payload: {
          eventId: `message:${messageId}`,
          inquiryId: inquiry.id,
          messageId,
          sequence,
          createdAt: createdAt.toISOString()
        }
      },
      {
        name: "inquiry.updated",
        rooms: participantRooms,
        payload: {
          eventId: `inquiry:${inquiry.id}:${sequence}`,
          inquiryId: inquiry.id,
          status: "open",
          lastSequence: sequence,
          lastMessageAt: createdAt.toISOString(),
          updatedAt: createdAt.toISOString()
        }
      },
      ...recipientIds.map<MessagingRealtimeEvent>((recipientId) => ({
        name: "unread.changed",
        rooms: [userRoom(recipientId)],
        payload: {
          eventId: `unread:${inquiry.id}:${recipientId}:${sequence}`,
          inquiryId: inquiry.id,
          userId: recipientId,
          updatedAt: createdAt.toISOString()
        }
      }))
    ];
  }

  private displayName(user: { displayName: string | null; firstName: string | null }) {
    return user.displayName ?? user.firstName ?? "MediCN member";
  }

  private emit(events: MessagingRealtimeEvent[]) {
    try {
      this.realtime.publish(events);
    } catch {
      this.logger.warn("messaging_realtime_notification_failed");
    }
  }

  private isUniqueViolation(error: unknown) {
    return (
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") ||
      (typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "P2002")
    );
  }

  private notFound() {
    return new NotFoundException({
      code: "NOT_FOUND",
      message: "Inquiry not found.",
      details: {}
    });
  }

  private alreadyOpen() {
    return new ConflictException({
      code: "INQUIRY_ALREADY_OPEN",
      message: "An open inquiry already exists for this listing.",
      details: {}
    });
  }

  private closed() {
    return new ConflictException({
      code: "INQUIRY_CLOSED",
      message: "This inquiry is closed and read-only.",
      details: {}
    });
  }
}
