import {
  BookingStatus,
  CancellationFinancialDisposition,
  CancellationOperationStatus,
  ListingStatus,
  PaymentStatus,
  UserRole,
  type Prisma,
  type User
} from "@prisma/client";
import type { ConfigService } from "@nestjs/config";
import type Stripe from "stripe";
import type { AuthService } from "../src/auth/auth.service";
import { BookingsService } from "../src/bookings/bookings.service";
import type { EmailService } from "../src/email/email.service";
import type { IdentityEligibilityService } from "../src/identity/identity-eligibility.service";
import { JobsService } from "../src/jobs/jobs.service";
import { BookingCancellationsService } from "../src/payments/booking-cancellations.service";
import { BookingLifecycleService } from "../src/payments/booking-lifecycle.service";
import type { ConnectService } from "../src/payments/connect.service";
import { PaymentsService } from "../src/payments/payments.service";
import { PaymentTransitionService } from "../src/payments/payment-transition.service";
import type { StripeService } from "../src/payments/stripe.service";
import { PrismaService } from "../src/prisma/prisma.service";

const describeWithDatabase =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? describe : describe.skip;

describeWithDatabase("booking lifecycle PostgreSQL correctness", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const bookingIds: string[] = [];
  const listingIds: string[] = [];
  let prisma: PrismaService;
  let renter: User;
  let host: User;
  let lifecycle: BookingLifecycleService;
  let bookings: BookingsService;
  let cancellations: BookingCancellationsService;
  let payments: PaymentsService;
  let constructWebhookEvent: jest.Mock;
  let retrievePaymentIntentForReconciliation: jest.Mock;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    [renter, host] = await Promise.all([
      prisma.user.create({
        data: {
          supabaseUserId: `lifecycle-renter-${suffix}`,
          email: `lifecycle-renter-${suffix}@example.com`,
          emailVerifiedAt: new Date(),
          roles: [UserRole.renter]
        }
      }),
      prisma.user.create({
        data: {
          supabaseUserId: `lifecycle-host-${suffix}`,
          email: `lifecycle-host-${suffix}@example.com`,
          emailVerifiedAt: new Date(),
          roles: [UserRole.host]
        }
      })
    ]);
    const auth = {
      getCurrentUserRecord: jest.fn(async (token: string) =>
        token === "host-token" ? host : renter)
    };
    const jobs = new JobsService(prisma);
    const email = {
      queueTransactionalEmail: jest.fn().mockResolvedValue(undefined)
    } as unknown as EmailService;
    lifecycle = new BookingLifecycleService(prisma, jobs);
    bookings = new BookingsService(
      prisma,
      auth as unknown as AuthService,
      email,
      new PaymentTransitionService(),
      {} as IdentityEligibilityService
    );
    cancellations = new BookingCancellationsService(
      prisma,
      auth as unknown as AuthService,
      jobs
    );
    constructWebhookEvent = jest.fn();
    retrievePaymentIntentForReconciliation = jest.fn();
    payments = new PaymentsService(
      prisma,
      auth as unknown as AuthService,
      email,
      {
        constructWebhookEvent,
        retrievePaymentIntentForReconciliation
      } as unknown as StripeService,
      new PaymentTransitionService(),
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
      {} as ConnectService,
      {} as IdentityEligibilityService,
      cancellations
    );
  });

  afterAll(async () => {
    const operations = await prisma.bookingCancellationOperation.findMany({
      where: { bookingId: { in: bookingIds } },
      select: { id: true }
    });
    await prisma.outboxEvent.deleteMany({
      where: {
        OR: [
          { aggregateType: "booking", aggregateId: { in: bookingIds } },
          {
            aggregateType: "booking_cancellation",
            aggregateId: { in: operations.map(({ id }) => id) }
          }
        ]
      }
    });
    await prisma.bookingCancellationOperation.deleteMany({
      where: { bookingId: { in: bookingIds } }
    });
    await prisma.stripeWebhookEvent.deleteMany({
      where: {
        OR: [
          { providerEventId: { startsWith: `evt_lifecycle_${suffix}` } },
          {
            providerEventId: {
              startsWith: `reconcile-refund:command_${suffix}`
            }
          }
        ]
      }
    });
    await prisma.hostTransfer.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.bookingLocationSnapshot.deleteMany({
      where: { bookingId: { in: bookingIds } }
    });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.listing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.connectedAccount.deleteMany({ where: { userId: host.id } });
    await prisma.user.deleteMany({ where: { id: { in: [renter.id, host.id] } } });
    await prisma.$disconnect();
  });

  async function createListing(timeZone = "UTC", checkoutTime = "10:00") {
    const listing = await prisma.listing.create({
      data: {
        hostId: host.id,
        title: `Lifecycle ${listingIds.length + 1}`,
        description: "Booking lifecycle integration fixture.",
        city: "Chicago",
        timeZone,
        checkoutTime,
        address: "100 Main St, Chicago, IL 60601",
        priceCents: 10_000,
        priceUnit: "day",
        listingType: "private_room",
        status: ListingStatus.approved
      }
    });
    listingIds.push(listing.id);
    return listing;
  }

  async function createBooking(input: {
    status: BookingStatus;
    timeZone?: string;
    checkoutTime?: string;
    startDate?: string;
    endDate?: string;
    requestExpiresAt?: Date;
    payment?: { status: PaymentStatus; refunded?: number };
  }) {
    const listing = await createListing(
      input.timeZone ?? "UTC",
      input.checkoutTime ?? "10:00"
    );
    const booking = await prisma.booking.create({
      data: {
        listingId: listing.id,
        renterId: renter.id,
        hostId: host.id,
        startDate: new Date(`${input.startDate ?? "2027-01-01"}T00:00:00.000Z`),
        endDate: new Date(`${input.endDate ?? "2027-01-02"}T00:00:00.000Z`),
        timeZone: listing.timeZone,
        checkoutTime: listing.checkoutTime,
        selectedOption: "daily_short_term",
        status: input.status,
        totalAmountCents: 20_000,
        currency: "USD",
        ...(input.requestExpiresAt
          ? { requestExpiresAt: input.requestExpiresAt }
          : {}),
        ...(input.payment
          ? {
              payments: {
                create: {
                  attemptNumber: 1,
                  amountCents: 20_000,
                  amountRefundedCents: input.payment.refunded ?? 0,
                  currency: "USD",
                  status: input.payment.status,
                  active: false,
                  providerPaymentIntentId: `pi_lifecycle_${bookingIds.length}_${suffix}`
                }
              }
            }
          : {})
      },
      include: { payments: true }
    });
    bookingIds.push(booking.id);
    return booking;
  }

  it("enforces the exact 24-hour boundary before, at, and after", async () => {
    const boundary = new Date("2027-01-02T12:00:00.000Z");
    const before = await createBooking({
      status: BookingStatus.requested,
      requestExpiresAt: boundary
    });
    const at = await createBooking({
      status: BookingStatus.requested,
      requestExpiresAt: boundary
    });
    const after = await createBooking({
      status: BookingStatus.requested,
      requestExpiresAt: boundary
    });

    await expect(
      lifecycle.expireRequestedBooking(before.id, new Date(boundary.getTime() - 1))
    ).resolves.toEqual({ expired: false, reason: "not_due" });
    await expect(lifecycle.expireRequestedBooking(at.id, boundary))
      .resolves.toEqual({ expired: true });
    await expect(
      lifecycle.expireRequestedBooking(after.id, new Date(boundary.getTime() + 1))
    ).resolves.toEqual({ expired: true });

    const rows = await prisma.booking.findMany({
      where: { id: { in: [before.id, at.id, after.id] } },
      orderBy: { id: "asc" }
    });
    expect(rows.filter(({ status }) => status === BookingStatus.requested))
      .toHaveLength(1);
    for (const row of rows.filter(({ status }) => status === BookingStatus.cancelled)) {
      expect(row).toMatchObject({
        cancellationReason: "request_expired",
        expirySource: "operations_scheduler"
      });
      expect(row.expiredAt).not.toBeNull();
    }
  });

  it.each(["accepted", "rejected"] as const)(
    "serializes Host %s against request expiry",
    async (decision) => {
      const boundary = new Date();
      const booking = await createBooking({
        status: BookingStatus.requested,
        requestExpiresAt: boundary
      });
      const outcomes = await Promise.allSettled([
        bookings.decideBooking("host-token", booking.id, { status: decision }),
        lifecycle.expireRequestedBooking(booking.id, boundary)
      ]);
      const stored = await prisma.booking.findUniqueOrThrow({
        where: { id: booking.id }
      });
      expect([BookingStatus[decision], BookingStatus.cancelled]).toContain(stored.status);
      expect(outcomes.some(({ status }) => status === "fulfilled")).toBe(true);
      const expiryOperations = await prisma.bookingCancellationOperation.count({
        where: { bookingId: booking.id, reason: "request_expired" }
      });
      expect(expiryOperations).toBe(stored.status === BookingStatus.cancelled ? 1 : 0);
    }
  );

  it("serializes Renter cancellation against expiry with one durable operation", async () => {
    const boundary = new Date();
    const booking = await createBooking({
      status: BookingStatus.requested,
      requestExpiresAt: boundary
    });
    await Promise.allSettled([
      cancellations.cancelBooking("renter-token", booking.id, "renter-race", {
        reason: "plans_changed"
      }),
      lifecycle.expireRequestedBooking(booking.id, boundary)
    ]);

    await expect(prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
      .resolves.toMatchObject({ status: BookingStatus.cancelled });
    await expect(
      prisma.bookingCancellationOperation.count({ where: { bookingId: booking.id } })
    ).resolves.toBe(1);
  });

  it("keeps inventory reserved until expiry commits and rolls back Outbox failures", async () => {
    const boundary = new Date();
    const pending = await createBooking({
      status: BookingStatus.requested,
      requestExpiresAt: boundary
    });
    let release!: () => void;
    let reached!: () => void;
    const reachedPromise = new Promise<void>((resolve) => { reached = resolve; });
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    const durableJobs = new JobsService(prisma);
    let calls = 0;
    const blockingJobs = {
      enqueue: jest.fn(async (...args: Parameters<JobsService["enqueue"]>) => {
        calls += 1;
        if (calls === 1) {
          reached();
          await releasePromise;
        }
        return durableJobs.enqueue(...args);
      })
    };
    const blockingLifecycle = new BookingLifecycleService(
      prisma,
      blockingJobs as unknown as JobsService
    );
    const expiring = blockingLifecycle.expireRequestedBooking(pending.id, boundary);
    await reachedPromise;
    await expect(prisma.booking.findUniqueOrThrow({ where: { id: pending.id } }))
      .resolves.toMatchObject({ status: BookingStatus.requested });
    release();
    await expect(expiring).resolves.toEqual({ expired: true });
    await expect(prisma.booking.findUniqueOrThrow({ where: { id: pending.id } }))
      .resolves.toMatchObject({ status: BookingStatus.cancelled });

    const rollback = await createBooking({
      status: BookingStatus.requested,
      requestExpiresAt: boundary
    });
    const failingJobs = {
      enqueue: jest.fn().mockRejectedValue(new Error("outbox write failed"))
    } as unknown as JobsService;
    const failingLifecycle = new BookingLifecycleService(prisma, failingJobs);
    await expect(failingLifecycle.expireRequestedBooking(rollback.id, boundary))
      .rejects.toThrow("outbox write failed");
    await expect(prisma.booking.findUniqueOrThrow({ where: { id: rollback.id } }))
      .resolves.toMatchObject({
        status: BookingStatus.requested,
        expiredAt: null
      });
    await expect(
      prisma.bookingCancellationOperation.count({ where: { bookingId: rollback.id } })
    ).resolves.toBe(0);
  });

  it.each([
    ["UTC", "2027-01-01", "2027-01-02", "10:00", "2027-01-02T12:00:00.000Z"],
    ["America/Chicago", "2027-03-13", "2027-03-14", "11:00", "2027-03-14T18:00:00.000Z"],
    ["Europe/Berlin", "2027-10-30", "2027-10-31", "11:00", "2027-10-31T12:00:00.000Z"]
  ])(
    "computes completion in %s across local/DST boundaries",
    async (timeZone, startDate, endDate, checkoutTime, eligibleIso) => {
      const eligibleAt = new Date(eligibleIso);
      const booking = await createBooking({
        status: BookingStatus.paid,
        timeZone,
        checkoutTime,
        startDate,
        endDate,
        payment: { status: PaymentStatus.paid }
      });
      await expect(
        lifecycle.completeBooking(booking.id, new Date(eligibleAt.getTime() - 1))
      ).resolves.toEqual({ completed: false, reason: "not_due", eligibilityAt: eligibleAt });
      await expect(lifecycle.completeBooking(booking.id, eligibleAt))
        .resolves.toEqual({ completed: true, eligibilityAt: eligibleAt });
      await expect(lifecycle.completeBooking(booking.id, eligibleAt))
        .resolves.toMatchObject({ completed: false, reason: "already_completed" });
    }
  );

  it("serializes a provider reconciliation snapshot against a concurrent webhook", async () => {
    const booking = await createBooking({
      status: BookingStatus.paid,
      payment: { status: PaymentStatus.paid }
    });
    const payment = booking.payments[0]!;
    retrievePaymentIntentForReconciliation.mockResolvedValueOnce({
      id: payment.providerPaymentIntentId,
      object: "payment_intent",
      status: "succeeded",
      amount: payment.amountCents,
      amount_received: payment.amountCents,
      currency: payment.currency.toLowerCase(),
      metadata: { bookingId: booking.id, paymentId: payment.id },
      latest_charge: {
        id: `ch_reconcile_${suffix}`,
        object: "charge",
        amount: payment.amountCents,
        amount_refunded: payment.amountCents,
        currency: payment.currency.toLowerCase(),
        payment_intent: payment.providerPaymentIntentId,
        metadata: { bookingId: booking.id, paymentId: payment.id }
      }
    });
    constructWebhookEvent.mockReturnValueOnce({
      id: `evt_lifecycle_${suffix}_reconciliation_race`,
      object: "event",
      api_version: "2026-06-24.dahlia",
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: `dp_reconciliation_race_${suffix}`,
          object: "dispute",
          payment_intent: payment.providerPaymentIntentId,
          amount: payment.amountCents,
          currency: payment.currency.toLowerCase(),
          metadata: { bookingId: booking.id, paymentId: payment.id }
        }
      },
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "charge.dispute.created"
    } as unknown as Stripe.Event);

    const outcomes = await Promise.allSettled([
      payments.reconcilePaymentProviderState(
        payment.id,
        `command_${suffix}`
      ),
      payments.handleStripeWebhook(Buffer.from("{}"), "test-signature")
    ]);
    expect(outcomes.every(({ status }) => status === "fulfilled")).toBe(true);
    const stored = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id }
    });
    expect([PaymentStatus.refunded, PaymentStatus.disputed]).toContain(
      stored.status
    );
    expect(stored.amountRefundedCents).toBe(payment.amountCents);
  });

  it("completes after the boundary and rolls back a failed completion Outbox write", async () => {
    const booking = await createBooking({
      status: BookingStatus.paid,
      payment: { status: PaymentStatus.paid }
    });
    const afterEligibility = new Date("2027-01-02T12:00:00.001Z");
    const failingJobs = {
      enqueue: jest.fn().mockRejectedValue(new Error("outbox write failed"))
    } as unknown as JobsService;
    const failingLifecycle = new BookingLifecycleService(prisma, failingJobs);

    await expect(failingLifecycle.completeBooking(booking.id, afterEligibility))
      .rejects.toThrow("outbox write failed");
    await expect(prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
      .resolves.toMatchObject({
        status: BookingStatus.paid,
        completedAt: null,
        completionSource: null
      });
    await expect(
      prisma.outboxEvent.count({
        where: { aggregateId: booking.id, eventType: "send_booking_completion_email" }
      })
    ).resolves.toBe(0);

    await expect(lifecycle.completeBooking(booking.id, afterEligibility))
      .resolves.toMatchObject({ completed: true });
  });

  it.each([
    [PaymentStatus.refunded, 20_000],
    [PaymentStatus.disputed, 0],
    [PaymentStatus.partially_refunded, 20_000]
  ])(
    "blocks completion for non-fulfillable payment %s",
    async (status, refunded) => {
      const booking = await createBooking({
        status: BookingStatus.paid,
        payment: { status, refunded }
      });
      await expect(
        lifecycle.completeBooking(booking.id, new Date("2027-01-02T12:00:00.000Z"))
      ).resolves.toMatchObject({
        completed: false,
        reason: "payment_not_fulfillable"
      });
    }
  );

  it("blocks active pending refund but completes a settled partial refund", async () => {
    const pending = await createBooking({
      status: BookingStatus.paid,
      payment: { status: PaymentStatus.paid }
    });
    await prisma.bookingCancellationOperation.create({
      data: {
        bookingId: pending.id,
        paymentId: pending.payments[0]!.id,
        actorType: "host",
        actorUserId: host.id,
        reason: "property_unavailable",
        status: CancellationOperationStatus.refund_pending,
        financialDisposition: CancellationFinancialDisposition.full_refund_pending,
        idempotencyKey: `pending-refund-${pending.id}`,
        active: true
      }
    });
    await expect(
      lifecycle.completeBooking(pending.id, new Date("2027-01-02T12:00:00.000Z"))
    ).resolves.toMatchObject({ completed: false, reason: "lifecycle_blocked" });

    const partial = await createBooking({
      status: BookingStatus.paid,
      payment: { status: PaymentStatus.partially_refunded, refunded: 2_000 }
    });
    const paymentBefore = await prisma.payment.findUniqueOrThrow({
      where: { id: partial.payments[0]!.id }
    });
    await expect(
      lifecycle.completeBooking(partial.id, new Date("2027-01-02T12:00:00.000Z"))
    ).resolves.toMatchObject({ completed: true });
    await expect(prisma.payment.findUniqueOrThrow({ where: { id: paymentBefore.id } }))
      .resolves.toEqual(paymentBefore);
  });

  it.each([
    ["charge.refunded", PaymentStatus.refunded, "charge"],
    ["charge.dispute.created", PaymentStatus.disputed, "dispute"]
  ] as const)(
    "serializes completion against actual %s webhook processing",
    async (eventType, expectedPaymentStatus, objectType) => {
      const booking = await createBooking({
        status: BookingStatus.paid,
        payment: { status: PaymentStatus.paid }
      });
      const payment = booking.payments[0]!;
      const object = eventType === "charge.refunded"
        ? {
            id: `ch_${suffix}_${objectType}`,
            object: "charge",
            payment_intent: payment.providerPaymentIntentId,
            amount: payment.amountCents,
            amount_refunded: payment.amountCents,
            currency: payment.currency.toLowerCase(),
            metadata: { bookingId: booking.id, paymentId: payment.id }
          }
        : {
            id: `dp_${suffix}_${objectType}`,
            object: "dispute",
            payment_intent: payment.providerPaymentIntentId,
            amount: payment.amountCents,
            currency: payment.currency.toLowerCase(),
            metadata: { bookingId: booking.id, paymentId: payment.id }
          };
      constructWebhookEvent.mockReturnValueOnce({
        id: `evt_lifecycle_${suffix}_${objectType}`,
        object: "event",
        api_version: "2026-06-24.dahlia",
        created: Math.floor(Date.now() / 1000),
        data: { object },
        livemode: false,
        pending_webhooks: 1,
        request: null,
        type: eventType
      } as unknown as Stripe.Event);

      const outcomes = await Promise.allSettled([
        lifecycle.completeBooking(booking.id, new Date("2027-01-02T12:00:00.000Z")),
        payments.handleStripeWebhook(Buffer.from("{}"), "test-signature")
      ]);
      expect(outcomes.every(({ status }) => status === "fulfilled")).toBe(true);

      const storedBooking = await prisma.booking.findUniqueOrThrow({
        where: { id: booking.id }
      });
      const storedPayment = await prisma.payment.findUniqueOrThrow({
        where: { id: payment.id }
      });
      expect(storedPayment.status).toBe(expectedPaymentStatus);
      expect([BookingStatus.cancelled, BookingStatus.completed]).toContain(
        storedBooking.status
      );
      if (storedBooking.status === BookingStatus.completed) {
        expect(storedBooking.completedAt).not.toBeNull();
      } else {
        expect(storedBooking.completedAt).toBeNull();
      }
    }
  );

  it("makes concurrent completion idempotent and keeps completion payloads opaque", async () => {
    const booking = await createBooking({
      status: BookingStatus.paid,
      payment: { status: PaymentStatus.paid }
    });
    const at = new Date("2027-01-02T12:00:00.000Z");
    const results = await Promise.all([
      lifecycle.completeBooking(booking.id, at),
      lifecycle.completeBooking(booking.id, at)
    ]);
    expect(results.filter(({ completed }) => completed)).toHaveLength(1);
    const outbox = await prisma.outboxEvent.findMany({
      where: {
        aggregateType: "booking",
        aggregateId: booking.id,
        eventType: "send_booking_completion_email"
      }
    });
    expect(outbox).toHaveLength(2);
    for (const event of outbox) {
      expect(Object.keys(event.payload as Prisma.JsonObject).sort()).toEqual([
        "bookingId",
        "recipientUserId"
      ]);
      expect(JSON.stringify(event.payload)).not.toMatch(
        /@|100 Main|address|payment|refund|message|body/
      );
    }
  });

  it("prevents booking snapshot mutation in PostgreSQL", async () => {
    const booking = await createBooking({ status: BookingStatus.requested });
    await expect(
      prisma.booking.update({
        where: { id: booking.id },
        data: { checkoutTime: "12:00" }
      })
    ).rejects.toBeDefined();
    await expect(
      prisma.booking.update({
        where: { id: booking.id },
        data: { timeZone: "America/New_York" }
      })
    ).rejects.toBeDefined();
  });
});
