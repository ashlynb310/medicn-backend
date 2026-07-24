import { Injectable } from "@nestjs/common";
import {
  BookingLifecycleSource,
  BookingStatus,
  CancellationActorType,
  CancellationFinancialDisposition,
  CancellationOperationReason,
  CancellationOperationStatus,
  PaymentStatus,
  Prisma
} from "@prisma/client";
import {
  BOOKING_CANCELLATION_EMAIL_JOB,
  type BookingCancellationEmailPayload
} from "../bookings/booking-cancellation.types";
import {
  BOOKING_COMPLETION_EMAIL_JOB,
  type BookingCompletionEmailPayload
} from "../bookings/booking-lifecycle.types";
import { JobsService } from "../jobs/jobs.service";
import { PrismaService } from "../prisma/prisma.service";

const lifecycleInclude = {
  payments: { orderBy: { attemptNumber: "desc" as const }, take: 1 },
  hostTransfer: true,
  cancellationOperations: {
    where: { active: true },
    orderBy: { version: "desc" as const },
    take: 1
  }
} satisfies Prisma.BookingInclude;

type LifecycleBooking = Prisma.BookingGetPayload<{
  include: typeof lifecycleInclude;
}>;

@Injectable()
export class BookingLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService
  ) {}

  async expireRequestedBookings(limit = 100, asOf?: Date) {
    const boundedLimit = Math.min(Math.max(limit, 1), 500);
    const now = asOf ?? await this.databaseNow(this.prisma);
    const candidates = await this.prisma.booking.findMany({
      where: {
        status: BookingStatus.requested,
        requestExpiresAt: { lte: now }
      },
      select: { id: true },
      orderBy: [{ requestExpiresAt: "asc" }, { id: "asc" }],
      take: boundedLimit
    });
    let expired = 0;
    let skipped = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        const result = await this.expireRequestedBooking(candidate.id, now);
        if (result.expired) expired += 1;
        else skipped += 1;
      } catch {
        failed += 1;
      }
    }
    return { scanned: candidates.length, expired, skipped, failed };
  }

  async expireRequestedBooking(bookingId: string, asOf?: Date) {
    const candidate = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { listingId: true }
    });
    if (!candidate) return { expired: false as const, reason: "not_found" as const };

    return this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, candidate.listingId);
      await this.lock(transaction, `booking:${bookingId}`);
      await this.lock(transaction, `checkout:${bookingId}`);
      let booking = await this.loadBooking(transaction, bookingId);
      if (!booking) return { expired: false as const, reason: "not_found" as const };
      if (booking.status !== BookingStatus.requested) {
        return {
          expired: false as const,
          reason: booking.expiredAt ? "already_expired" as const : "state_changed" as const
        };
      }
      if (booking.payments[0]) {
        await this.lock(transaction, `payment:${booking.payments[0].id}`);
      }
      if (booking.hostTransfer) {
        await this.lock(transaction, `host-transfer:${booking.hostTransfer.id}`);
      }
      if (booking.payments[0] || booking.hostTransfer) {
        const reloaded = await this.loadBooking(transaction, bookingId);
        if (!reloaded) return { expired: false as const, reason: "not_found" as const };
        booking = reloaded;
      }
      if (booking.status !== BookingStatus.requested) {
        return { expired: false as const, reason: "state_changed" as const };
      }
      const now = asOf ?? await this.databaseNow(transaction);
      if (booking.requestExpiresAt > now) {
        return { expired: false as const, reason: "not_due" as const };
      }
      if (booking.payments.length > 0) {
        return { expired: false as const, reason: "payment_state_changed" as const };
      }
      if (booking.cancellationOperations.length > 0) {
        return { expired: false as const, reason: "cancellation_in_progress" as const };
      }

      const idempotencyKey = `system:request-expired:${bookingId}`;
      const existing = await transaction.bookingCancellationOperation.findUnique({
        where: { bookingId_idempotencyKey: { bookingId, idempotencyKey } }
      });
      if (existing) {
        return { expired: false as const, reason: "already_expired" as const };
      }
      const versions = await transaction.bookingCancellationOperation.aggregate({
        where: { bookingId },
        _max: { version: true }
      });
      const operation = await transaction.bookingCancellationOperation.create({
        data: {
          bookingId,
          paymentId: null,
          version: (versions._max.version ?? 0) + 1,
          actorType: CancellationActorType.system,
          actorUserId: null,
          reason: CancellationOperationReason.request_expired,
          status: CancellationOperationStatus.completed,
          financialDisposition: CancellationFinancialDisposition.no_payment_collected,
          idempotencyKey,
          active: false,
          requestedAt: now,
          effectiveAt: now
        }
      });
      const updated = await transaction.booking.updateMany({
        where: { id: bookingId, status: BookingStatus.requested },
        data: {
          status: BookingStatus.cancelled,
          cancellationReason: "request_expired",
          cancelledAt: now,
          expiredAt: now,
          expirySource: BookingLifecycleSource.operations_scheduler
        }
      });
      if (updated.count !== 1) {
        throw new Error("Requested booking state changed before expiry committed.");
      }
      await this.queueExpiryNotifications(transaction, operation.id, booking);
      return { expired: true as const };
    });
  }

  async completeEligibleBookings(limit = 100, asOf?: Date) {
    const boundedLimit = Math.min(Math.max(limit, 1), 500);
    const now = asOf ?? await this.databaseNow(this.prisma);
    const candidates = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT booking."id"
      FROM "Booking" AS booking
      WHERE booking."status" = 'paid'
        AND (
          (booking."endDate" + booking."checkoutTime"::time)
          AT TIME ZONE booking."timeZone"
        ) + INTERVAL '2 hours' <= ${now}
      ORDER BY booking."endDate" ASC, booking."id" ASC
      LIMIT ${boundedLimit}
    `);
    let completed = 0;
    let skipped = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        const result = await this.completeBooking(candidate.id, now);
        if (result.completed) completed += 1;
        else skipped += 1;
      } catch {
        failed += 1;
      }
    }
    return { scanned: candidates.length, completed, skipped, failed };
  }

  async completeBooking(bookingId: string, asOf?: Date) {
    const candidate = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { listingId: true }
    });
    if (!candidate) return { completed: false as const, reason: "not_found" as const };

    return this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, candidate.listingId);
      await this.lock(transaction, `booking:${bookingId}`);
      await this.lock(transaction, `checkout:${bookingId}`);
      let booking = await this.loadBooking(transaction, bookingId);
      if (!booking) return { completed: false as const, reason: "not_found" as const };
      if (booking.status === BookingStatus.completed) {
        return {
          completed: false as const,
          reason: "already_completed" as const,
          eligibilityAt: await this.eligibilityAt(transaction, bookingId)
        };
      }
      if (booking.status !== BookingStatus.paid) {
        return { completed: false as const, reason: "state_changed" as const };
      }
      const payment = booking.payments[0] ?? null;
      if (payment) await this.lock(transaction, `payment:${payment.id}`);
      if (booking.hostTransfer) {
        await this.lock(transaction, `host-transfer:${booking.hostTransfer.id}`);
      }
      if (payment || booking.hostTransfer) {
        const reloaded = await this.loadBooking(transaction, bookingId);
        if (!reloaded) return { completed: false as const, reason: "not_found" as const };
        booking = reloaded;
      }
      const eligibilityAt = await this.eligibilityAt(transaction, bookingId);
      const now = asOf ?? await this.databaseNow(transaction);
      if (eligibilityAt > now) {
        return { completed: false as const, reason: "not_due" as const, eligibilityAt };
      }
      if (
        booking.status !== BookingStatus.paid ||
        booking.cancelledAt !== null ||
        booking.cancellationOperations.length > 0
      ) {
        return { completed: false as const, reason: "lifecycle_blocked" as const, eligibilityAt };
      }
      const currentPayment = booking.payments[0] ?? null;
      const paymentFulfillable =
        currentPayment !== null &&
        (currentPayment.status === PaymentStatus.paid ||
          currentPayment.status === PaymentStatus.partially_refunded) &&
        currentPayment.amountRefundedCents < currentPayment.amountCents;
      if (!paymentFulfillable) {
        return {
          completed: false as const,
          reason: "payment_not_fulfillable" as const,
          eligibilityAt
        };
      }
      const updated = await transaction.booking.updateMany({
        where: {
          id: bookingId,
          status: BookingStatus.paid,
          completedAt: null
        },
        data: {
          status: BookingStatus.completed,
          completedAt: now,
          completionSource: BookingLifecycleSource.operations_scheduler
        }
      });
      if (updated.count !== 1) {
        return { completed: false as const, reason: "state_changed" as const, eligibilityAt };
      }
      await this.queueCompletionNotifications(transaction, booking);
      return { completed: true as const, eligibilityAt };
    });
  }

  private async queueExpiryNotifications(
    transaction: Prisma.TransactionClient,
    cancellationOperationId: string,
    booking: Pick<LifecycleBooking, "renterId" | "hostId">
  ) {
    for (const recipientUserId of [booking.renterId, booking.hostId]) {
      const payload: BookingCancellationEmailPayload = {
        cancellationOperationId,
        recipientUserId,
        template: "booking_cancelled_no_payment"
      };
      await this.jobs.enqueue(BOOKING_CANCELLATION_EMAIL_JOB, payload, {
        aggregateType: "booking_cancellation",
        aggregateId: cancellationOperationId,
        client: transaction,
        deduplicationKey: `booking-request-expired-email:${cancellationOperationId}:${recipientUserId}`
      });
    }
  }

  private async queueCompletionNotifications(
    transaction: Prisma.TransactionClient,
    booking: Pick<LifecycleBooking, "id" | "renterId" | "hostId">
  ) {
    for (const recipientUserId of [booking.renterId, booking.hostId]) {
      const payload: BookingCompletionEmailPayload = {
        bookingId: booking.id,
        recipientUserId
      };
      await this.jobs.enqueue(BOOKING_COMPLETION_EMAIL_JOB, payload, {
        aggregateType: "booking",
        aggregateId: booking.id,
        client: transaction,
        deduplicationKey: `booking-completed-email:${booking.id}:${recipientUserId}`
      });
    }
  }

  private async eligibilityAt(
    transaction: Prisma.TransactionClient,
    bookingId: string
  ) {
    const [result] = await transaction.$queryRaw<Array<{ eligibilityAt: Date }>>(Prisma.sql`
      SELECT (
        (booking."endDate" + booking."checkoutTime"::time)
        AT TIME ZONE booking."timeZone"
      ) + INTERVAL '2 hours' AS "eligibilityAt"
      FROM "Booking" AS booking
      WHERE booking."id" = ${bookingId}
    `);
    if (!result) throw new Error("Booking completion eligibility was unavailable.");
    return result.eligibilityAt;
  }

  private loadBooking(transaction: Prisma.TransactionClient, bookingId: string) {
    return transaction.booking.findUnique({
      where: { id: bookingId },
      include: lifecycleInclude
    });
  }

  private async databaseNow(
    client: Pick<PrismaService, "$queryRaw"> | Prisma.TransactionClient
  ) {
    const [clock] = await client.$queryRaw<Array<{ now: Date }>>(
      Prisma.sql`SELECT CURRENT_TIMESTAMP AS "now"`
    );
    if (!clock) throw new Error("Database current time was unavailable.");
    return clock.now;
  }

  private lock(transaction: Prisma.TransactionClient, key: string) {
    return transaction.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
    );
  }
}
