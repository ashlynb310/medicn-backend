import {
  BookingStatus,
  CancellationActorType,
  CancellationFinancialDisposition,
  CancellationOperationStatus,
  PaymentStatus,
  UserRole
} from "@prisma/client";
import type { AuthService } from "../src/auth/auth.service";
import type { JobsService } from "../src/jobs/jobs.service";
import { BookingCancellationsService } from "../src/payments/booking-cancellations.service";
import type { PrismaService } from "../src/prisma/prisma.service";

const now = new Date("2026-07-19T18:00:00.000Z");
const users = {
  renter: { id: "renter_1", roles: [UserRole.renter] },
  host: { id: "host_1", roles: [UserRole.host] },
  admin: { id: "admin_1", roles: [UserRole.admin] },
  unrelated: { id: "other_1", roles: [UserRole.renter] }
};

function operation(overrides: Record<string, unknown> = {}) {
  return {
    id: "cancel_1",
    bookingId: "booking_1",
    paymentId: null,
    version: 1,
    actorType: CancellationActorType.renter,
    actorUserId: users.renter.id,
    reason: "plans_changed",
    status: CancellationOperationStatus.completed,
    financialDisposition: CancellationFinancialDisposition.no_payment_collected,
    idempotencyKey: "request-1",
    active: false,
    providerOperationRef: null,
    failureCode: null,
    requestedAt: now,
    effectiveAt: now,
    failedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function createService(options: {
  actor?: keyof typeof users;
  status?: BookingStatus;
  payment?: Record<string, unknown> | null;
  existingByKey?: ReturnType<typeof operation> | null;
  activeOperation?: ReturnType<typeof operation> | null;
} = {}) {
  const actor = users[options.actor ?? "renter"];
  const payment = options.payment === undefined ? null : options.payment;
  const booking = {
    id: "booking_1",
    listingId: "listing_1",
    renterId: users.renter.id,
    hostId: users.host.id,
    status: options.status ?? BookingStatus.requested,
    startDate: new Date("2026-08-10T00:00:00.000Z"),
    cancelledAt: null,
    cancellationReason: null,
    payments: payment ? [payment] : [],
    hostTransfer: null
  };
  const created = operation();
  const transaction = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([{ now }]),
    booking: {
      findUnique: jest.fn().mockResolvedValue(booking),
      update: jest.fn().mockResolvedValue({ ...booking, status: BookingStatus.cancelled }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    bookingCancellationOperation: {
      findUnique: jest.fn().mockResolvedValue(options.existingByKey ?? null),
      findFirst: jest.fn().mockResolvedValue(options.activeOperation ?? null),
      aggregate: jest.fn().mockResolvedValue({ _max: { version: null } }),
      create: jest.fn().mockResolvedValue(created)
    },
    outboxEvent: { create: jest.fn(), findUnique: jest.fn() }
  };
  const prisma = {
    booking: {
      findUnique: jest.fn().mockResolvedValue({ listingId: booking.listingId })
    },
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(transaction))
  };
  const auth = { getCurrentUserRecord: jest.fn().mockResolvedValue(actor) };
  const jobs = { enqueue: jest.fn().mockResolvedValue({ id: "outbox_1" }) };
  const service = new BookingCancellationsService(
    prisma as unknown as PrismaService,
    auth as unknown as AuthService,
    jobs as unknown as JobsService
  );
  return { service, prisma, transaction, jobs, booking };
}

describe("BookingCancellationsService", () => {
  it("atomically cancels an unpaid Renter request and queues only opaque participant notification IDs", async () => {
    const { service, transaction, jobs } = createService();

    await expect(
      service.cancelBooking("token", "booking_1", "request-1", {
        reason: "plans_changed"
      })
    ).resolves.toMatchObject({
      bookingId: "booking_1",
      bookingStatus: BookingStatus.cancelled,
      cancellation: {
        actorType: CancellationActorType.renter,
        status: CancellationOperationStatus.completed,
        financialDisposition: CancellationFinancialDisposition.no_payment_collected
      }
    });

    expect(transaction.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: BookingStatus.cancelled,
          cancellationReason: "renter_cancelled",
          cancelledAt: now
        })
      })
    );
    expect(transaction.bookingCancellationOperation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: users.renter.id,
        reason: "plans_changed",
        status: CancellationOperationStatus.completed,
        active: false,
        effectiveAt: now
      })
    });
    expect(jobs.enqueue).toHaveBeenCalledWith(
      "send_booking_cancellation_email",
      {
        cancellationOperationId: "cancel_1",
        recipientUserId: users.host.id,
        template: "booking_cancelled_no_payment"
      },
      expect.objectContaining({ client: transaction })
    );
    expect(JSON.stringify(jobs.enqueue.mock.calls)).not.toContain("@");
  });

  it("creates Checkout-expiry pending state without releasing inventory", async () => {
    const { service, transaction, jobs } = createService({
      status: BookingStatus.payment_pending,
      payment: {
        id: "payment_1",
        status: PaymentStatus.pending,
        amountCents: 16000,
        amountRefundedCents: 0,
        providerCheckoutSessionId: "cs_1",
        attemptNumber: 1
      }
    });
    transaction.bookingCancellationOperation.create.mockResolvedValue(
      operation({
        paymentId: "payment_1",
        status: CancellationOperationStatus.checkout_expiry_pending,
        financialDisposition: CancellationFinancialDisposition.checkout_expiry_pending,
        active: true,
        effectiveAt: null
      })
    );

    await expect(
      service.cancelBooking("token", "booking_1", "request-1", {
        reason: "booking_no_longer_needed"
      })
    ).resolves.toMatchObject({ bookingStatus: BookingStatus.payment_pending });
    expect(transaction.booking.updateMany).not.toHaveBeenCalled();
    expect(jobs.enqueue).toHaveBeenCalledWith(
      "booking_cancellation_checkout_expiry",
      { cancellationOperationId: "cancel_1" },
      expect.objectContaining({ client: transaction })
    );
  });

  it("rejects paid Renter cancellation without writing an operation", async () => {
    const { service, transaction } = createService({
      status: BookingStatus.paid,
      payment: {
        id: "payment_1",
        status: PaymentStatus.paid,
        amountCents: 16000,
        amountRefundedCents: 0,
        attemptNumber: 1
      }
    });

    await expect(
      service.cancelBooking("token", "booking_1", "request-1", {
        reason: "plans_changed"
      })
    ).rejects.toMatchObject({
      response: { code: "PAID_CANCELLATION_POLICY_UNAVAILABLE", details: {} }
    });
    expect(transaction.bookingCancellationOperation.create).not.toHaveBeenCalled();
  });

  it("queues the remaining full refund for a paid Host cancellation without marking cancellation effective", async () => {
    const { service, transaction, jobs } = createService({
      actor: "host",
      status: BookingStatus.paid,
      payment: {
        id: "payment_1",
        status: PaymentStatus.partially_refunded,
        amountCents: 16000,
        amountRefundedCents: 4000,
        attemptNumber: 1
      }
    });
    transaction.bookingCancellationOperation.create.mockResolvedValue(
      operation({
        actorType: CancellationActorType.host,
        actorUserId: users.host.id,
        reason: "property_unavailable",
        paymentId: "payment_1",
        status: CancellationOperationStatus.refund_pending,
        financialDisposition: CancellationFinancialDisposition.full_refund_pending,
        active: true,
        effectiveAt: null
      })
    );

    await service.cancelBooking("token", "booking_1", "request-1", {
      reason: "property_unavailable"
    });

    expect(transaction.booking.updateMany).not.toHaveBeenCalled();
    expect(jobs.enqueue).toHaveBeenCalledWith(
      "booking_cancellation_full_refund",
      { cancellationOperationId: "cancel_1" },
      expect.objectContaining({ client: transaction })
    );
  });

  it("returns the same operation for the same booking and idempotency key", async () => {
    const existing = operation();
    const { service, transaction } = createService({ existingByKey: existing });

    await expect(
      service.cancelBooking("token", "booking_1", "request-1", {
        reason: "other"
      })
    ).resolves.toMatchObject({ cancellation: { id: existing.id } });
    expect(transaction.bookingCancellationOperation.create).not.toHaveBeenCalled();
  });

  it("rejects a different key while an operation is active", async () => {
    const { service } = createService({
      status: BookingStatus.payment_pending,
      activeOperation: operation({ active: true })
    });

    await expect(
      service.cancelBooking("token", "booking_1", "request-2", {
        reason: "other"
      })
    ).rejects.toMatchObject({
      response: { code: "CANCELLATION_ALREADY_IN_PROGRESS", details: {} }
    });
  });

  it("uses opaque NOT_FOUND for an unrelated authenticated user", async () => {
    const { service } = createService({ actor: "unrelated" });
    await expect(
      service.cancelBooking("token", "booking_1", "request-1", {
        reason: "other"
      })
    ).rejects.toMatchObject({ response: { code: "NOT_FOUND", details: {} } });
  });

  it("enforces actor-specific reason allowlists", async () => {
    const { service } = createService({ actor: "host", status: BookingStatus.accepted });
    await expect(
      service.cancelBooking("token", "booking_1", "request-1", {
        reason: "plans_changed"
      })
    ).rejects.toMatchObject({
      response: { code: "VALIDATION_ERROR", details: {} }
    });
  });
});
