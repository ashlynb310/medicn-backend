import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import {
  BookingCancellationReason,
  BookingStatus,
  HostTransferReversalStatus,
  HostTransferStatus,
  PaymentStatus,
  StripeWebhookProcessingStatus,
  UserRole
} from "@prisma/client";
import type Stripe from "stripe";
import type { AuthService } from "../src/auth/auth.service";
import type { EmailService } from "../src/email/email.service";
import { PaymentTransitionService } from "../src/payments/payment-transition.service";
import { PaymentsService } from "../src/payments/payments.service";
import type { IdentityEligibilityService } from "../src/identity/identity-eligibility.service";
import type { StripeService } from "../src/payments/stripe.service";
import type { ConnectService } from "../src/payments/connect.service";
import type { PrismaService } from "../src/prisma/prisma.service";

const now = new Date();
const expiresAt = new Date(now.getTime() + 30 * 60_000);

const renterUser = {
  id: "renter_user_1",
  supabaseUserId: "supabase-renter-1",
  email: "renter@example.com",
  emailVerifiedAt: now,
  firstName: "Alex",
  lastName: "Renter",
  displayName: "Alex R",
  healthcareRole: null,
  roles: [UserRole.renter],
  healthcareAffiliation: null,
  phoneNumber: null,
  bio: null,
  profilePhotoUrl: null,
  profileComplete: true,
  currentVerificationStatus: "not_started",
  disabledAt: null,
  createdAt: now,
  updatedAt: now
};

const unrelatedUser = {
  ...renterUser,
  id: "other_user",
  supabaseUserId: "supabase-other",
  email: "other@example.com",
  roles: [UserRole.host]
};

const acceptedBooking = {
  id: "booking_1",
  listingId: "listing_1",
  renterId: renterUser.id,
  hostId: "host_user_1",
  startDate: new Date("2026-07-20T00:00:00.000Z"),
  endDate: new Date("2026-07-22T00:00:00.000Z"),
  selectedOption: "daily_short_term",
  additionalRequests: null,
  status: BookingStatus.accepted,
  totalAmountCents: 16_000,
  currency: "USD",
  createdAt: now,
  updatedAt: now,
  cancelledAt: null,
  cancellationReason: null,
  listing: {
    title: "Private room near hospital"
  },
  renter: {
    email: renterUser.email
  }
};

function paymentRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "payment_1",
    bookingId: acceptedBooking.id,
    provider: "stripe",
    providerCheckoutSessionId: "cs_test_123",
    providerPaymentIntentId: "pi_123",
    providerChargeId: null,
    attemptNumber: 1,
    idempotencyKey: "checkout:booking_1:1:stable",
    amountCents: 16_000,
    currency: "USD",
    status: PaymentStatus.pending,
    active: true,
    expiresAt,
    amountRefundedCents: 0,
    failureReason: null,
    lastProviderEventId: null,
    lastProviderEventCreatedAt: null,
    createdAt: now,
    updatedAt: now,
    paidAt: null,
    refundedAt: null,
    hostTransfer: null,
    booking: {
      ...acceptedBooking,
      status: BookingStatus.payment_pending,
      listing: {
        title: acceptedBooking.listing.title,
        address: "123 Main St",
        latitude: 29.7604,
        longitude: -95.3698,
        location: { verifiedAddressVersion: 4 }
      },
      renter: { email: renterUser.email }
    },
    ...overrides
  };
}

function checkoutSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_test_123",
    object: "checkout.session",
    client_reference_id: acceptedBooking.id,
    metadata: {
      bookingId: acceptedBooking.id,
      paymentId: "payment_1"
    },
    payment_status: "paid",
    status: "complete",
    amount_total: 16_000,
    currency: "usd",
    payment_intent: "pi_123",
    expires_at: Math.floor(expiresAt.getTime() / 1000),
    url: "https://checkout.stripe.com/c/pay/cs_test_123",
    ...overrides
  } as unknown as Stripe.Checkout.Session;
}

function paymentIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: "pi_123",
    object: "payment_intent",
    status: "succeeded",
    amount: 16_000,
    amount_received: 16_000,
    currency: "usd",
    metadata: {
      bookingId: acceptedBooking.id,
      paymentId: "payment_1"
    },
    ...overrides
  } as unknown as Stripe.PaymentIntent;
}

function hostTransferRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "host_transfer_1",
    paymentId: "payment_1",
    bookingId: "booking_1",
    status: HostTransferStatus.transferred,
    providerTransferId: "tr_1",
    grossAmountCents: 16_000,
    platformFeeCents: 2_000,
    hostNetAmountCents: 14_000,
    reversedAmountCents: 0,
    reversalTargetAmountCents: 0,
    reversalStatus: HostTransferReversalStatus.none,
    reversalProviderIds: [],
    payment: paymentRecord({ hostTransfer: { id: "host_transfer_1" } }),
    ...overrides
  };
}

function stripeEvent(
  type: string,
  object: Record<string, unknown>,
  id = "evt_1"
) {
  return {
    id,
    object: "event",
    api_version: "2026-06-24.dahlia",
    created: Math.floor(now.getTime() / 1000),
    data: { object },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type
  } as unknown as Stripe.Event;
}

function createService() {
  const prisma = {
    $executeRaw: jest.fn(),
    booking: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn()
    },
    bookingLocationSnapshot: {
      upsert: jest.fn()
    },
    payment: {
      aggregate: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn()
    },
    hostTransfer: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      updateMany: jest.fn()
    },
    stripeWebhookEvent: {
      create: jest.fn().mockResolvedValue({
        id: "inbox_1",
        status: StripeWebhookProcessingStatus.received
      }),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    }
  };
  const transaction = jest.fn(
    async (
      callback: (transactionClient: typeof prisma) => Promise<unknown>
    ) => callback(prisma)
  );
  const prismaWithTransaction = {
    ...prisma,
    $transaction: transaction
  };
  const authService = {
    getCurrentUserRecord: jest.fn()
  };
  const emailService = {
    queueTransactionalEmail: jest.fn()
  };
  const stripeService = {
    constructWebhookEvent: jest.fn(),
    createCheckoutSession: jest.fn(),
    retrieveCharge: jest.fn(),
    retrieveCheckoutSession: jest.fn(),
    retrievePaymentIntent: jest.fn(),
    retrieveCheckoutSessionForReconciliation: jest.fn(),
    retrievePaymentIntentForReconciliation: jest.fn(),
    findDisputesForReconciliation: jest.fn(),
    retrieveHostTransferForReconciliation: jest.fn(),
    findHostTransfersForReconciliation: jest.fn()
  };
  const configValues: Record<string, unknown> = {
    CHECKOUT_SESSION_TTL_MINUTES: 30,
    PAYMENTS_OPERATIONS_EMAIL: "payments@example.com"
  };
  const config = {
    get: jest.fn((key: string) => configValues[key])
  };
  const connectService = {
    requireTransferReadyForBooking: jest.fn().mockResolvedValue(null),
    marketplaceConfiguration: jest.fn()
  };
  const identityEligibility = { assertApproved: jest.fn() };
  const service = new PaymentsService(
    prismaWithTransaction as unknown as PrismaService,
    authService as unknown as AuthService,
    emailService as unknown as EmailService,
    stripeService as unknown as StripeService,
    new PaymentTransitionService(),
    config as unknown as ConfigService,
    connectService as unknown as ConnectService,
    identityEligibility as unknown as IdentityEligibilityService
  );

  return {
    service,
    prisma,
    transaction,
    authService,
    emailService,
    stripeService,
    configValues,
    connectService,
    identityEligibility
  };
}

function arrangeNewCheckout(
  context: ReturnType<typeof createService>,
  attemptOverrides: Record<string, unknown> = {}
) {
  const attempt = paymentRecord({
    providerCheckoutSessionId: null,
    providerPaymentIntentId: null,
    ...attemptOverrides
  });
  context.authService.getCurrentUserRecord.mockResolvedValue(renterUser);
  context.prisma.booking.findUnique.mockResolvedValue(acceptedBooking);
  context.prisma.payment.findFirst.mockResolvedValue(null);
  context.prisma.payment.aggregate.mockResolvedValue({
    _max: { attemptNumber: 0 }
  });
  context.prisma.payment.create.mockResolvedValue(attempt);
  context.stripeService.createCheckoutSession.mockResolvedValue({
    id: "cs_test_123",
    url: "https://checkout.stripe.com/c/pay/cs_test_123",
    paymentIntentId: null,
    expiresAt
  });
  return attempt;
}

async function deliver(
  context: ReturnType<typeof createService>,
  event: Stripe.Event
) {
  context.stripeService.constructWebhookEvent.mockReturnValue(event);
  return context.service.handleStripeWebhook(
    Buffer.from(JSON.stringify(event)),
    "valid-signature"
  );
}

describe("PaymentsService checkout", () => {
  it("blocks Checkout creation when renter identity is not approved", async () => {
    const context = createService();
    context.authService.getCurrentUserRecord.mockResolvedValue(renterUser);
    context.identityEligibility.assertApproved.mockRejectedValue(
      new ForbiddenException({ code: "IDENTITY_VERIFICATION_EXPIRED" })
    );
    await expect(
      context.service.createCheckoutSession("token", { bookingId: "booking_1" })
    ).rejects.toMatchObject({ response: { code: "IDENTITY_VERIFICATION_EXPIRED" } });
    expect(context.stripeService.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("creates Checkout from backend amount/currency and persists the attempt first", async () => {
    const context = createService();
    const attempt = arrangeNewCheckout(context);

    const result = await context.service.createCheckoutSession("token", {
      bookingId: "booking_1"
    });

    expect(result).toEqual({
      checkoutSessionId: "cs_test_123",
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_123",
      expiresAt: expiresAt.toISOString()
    });
    expect(new Date(result.expiresAt).toISOString()).toBe(result.expiresAt);
    expect(JSON.stringify(result)).not.toMatch(
      /sk_(?:test|live)|whsec_|paymentIntentId|providerPaymentIntentId/
    );

    expect(context.prisma.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: "booking_1",
        attemptNumber: 1,
        amountCents: 16_000,
        currency: "USD",
        status: PaymentStatus.pending,
        active: true,
        idempotencyKey: expect.stringMatching(/^checkout:booking_1:1:/)
      })
    });
    expect(context.stripeService.createCheckoutSession).toHaveBeenCalledWith({
      bookingId: "booking_1",
      paymentId: "payment_1",
      amountCents: 16_000,
      currency: "USD",
      listingTitle: "Private room near hospital",
      idempotencyKey: attempt.idempotencyKey,
      expiresAt: attempt.expiresAt
    });
    expect(context.prisma.booking.updateMany).toHaveBeenCalledWith({
      where: {
        id: "booking_1",
        status: {
          in: [BookingStatus.accepted, BookingStatus.payment_pending]
        }
      },
      data: { status: BookingStatus.payment_pending }
    });
  });

  it("rejects checkout for an unverified renter", async () => {
    const context = createService();
    context.authService.getCurrentUserRecord.mockResolvedValue({
      ...renterUser,
      emailVerifiedAt: null
    });

    await expect(
      context.service.createCheckoutSession("token", { bookingId: "booking_1" })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(context.prisma.booking.findUnique).not.toHaveBeenCalled();
  });

  it("rejects checkout by a non-renter/non-owner", async () => {
    const context = createService();
    context.authService.getCurrentUserRecord.mockResolvedValue(unrelatedUser);
    context.prisma.booking.findUnique.mockResolvedValue(acceptedBooking);

    await expect(
      context.service.createCheckoutSession("token", { bookingId: "booking_1" })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(context.stripeService.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects checkout before the booking is accepted", async () => {
    const context = createService();
    context.authService.getCurrentUserRecord.mockResolvedValue(renterUser);
    context.prisma.booking.findUnique.mockResolvedValue({
      ...acceptedBooking,
      status: BookingStatus.requested
    });

    await expect(
      context.service.createCheckoutSession("token", { bookingId: "booking_1" })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(context.stripeService.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("reuses an active unexpired Checkout Session", async () => {
    const context = createService();
    context.authService.getCurrentUserRecord.mockResolvedValue(renterUser);
    context.prisma.booking.findUnique.mockResolvedValue({
      ...acceptedBooking,
      status: BookingStatus.payment_pending
    });
    context.prisma.payment.findFirst.mockResolvedValue(paymentRecord());
    context.stripeService.retrieveCheckoutSession.mockResolvedValue(
      checkoutSession({ payment_status: "unpaid", status: "open" })
    );

    const first = await context.service.createCheckoutSession("token", {
      bookingId: "booking_1"
    });
    const second = await context.service.createCheckoutSession("token", {
      bookingId: "booking_1"
    });

    expect(first).toEqual(second);
    expect(context.prisma.payment.create).not.toHaveBeenCalled();
    expect(context.stripeService.createCheckoutSession).not.toHaveBeenCalled();
    expect(context.stripeService.retrieveCheckoutSession).toHaveBeenCalledTimes(2);
  });

  it("concurrent checkout calls create one attempt and reuse one provider session id", async () => {
    const context = createService();
    context.authService.getCurrentUserRecord.mockResolvedValue(renterUser);
    context.prisma.booking.findUnique.mockResolvedValue(acceptedBooking);
    context.prisma.payment.aggregate.mockResolvedValue({
      _max: { attemptNumber: 0 }
    });
    let activeAttempt: ReturnType<typeof paymentRecord> | null = null;
    context.prisma.payment.findFirst.mockImplementation(() =>
      Promise.resolve(activeAttempt)
    );
    context.prisma.payment.create.mockImplementation(({ data }) => {
      activeAttempt = paymentRecord({
        ...data,
        providerCheckoutSessionId: null,
        providerPaymentIntentId: null
      });
      return Promise.resolve(activeAttempt);
    });
    context.stripeService.createCheckoutSession.mockResolvedValue({
      id: "cs_single",
      url: "https://checkout.stripe.com/c/pay/cs_single",
      paymentIntentId: null,
      expiresAt
    });
    let tail = Promise.resolve();
    context.transaction.mockImplementation(
      (callback: (transactionClient: typeof context.prisma) => Promise<unknown>) => {
        const result = tail.then(() => callback(context.prisma));
        tail = result.then(
          () => undefined,
          () => undefined
        );
        return result;
      }
    );

    const [first, second] = await Promise.all([
      context.service.createCheckoutSession("token", { bookingId: "booking_1" }),
      context.service.createCheckoutSession("token", { bookingId: "booking_1" })
    ]);

    expect(first.checkoutSessionId).toBe("cs_single");
    expect(second.checkoutSessionId).toBe("cs_single");
    expect(context.prisma.payment.create).toHaveBeenCalledTimes(1);
    const idempotencyKeys = context.stripeService.createCheckoutSession.mock.calls.map(
      ([input]) => input.idempotencyKey
    );
    expect(new Set(idempotencyKeys).size).toBe(1);
  });

  it("creates a new idempotency key after a historical failed attempt", async () => {
    const context = createService();
    arrangeNewCheckout(context, { attemptNumber: 2 });
    context.prisma.payment.aggregate.mockResolvedValue({
      _max: { attemptNumber: 1 }
    });

    await context.service.createCheckoutSession("token", {
      bookingId: "booking_1"
    });

    expect(context.prisma.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        attemptNumber: 2,
        idempotencyKey: expect.stringMatching(/^checkout:booking_1:2:/)
      })
    });
  });

  it("blocks checkout when the Host payout account is not ready", async () => {
    const context = createService();
    context.authService.getCurrentUserRecord.mockResolvedValue(renterUser);
    context.prisma.booking.findUnique.mockResolvedValue(acceptedBooking);
    context.connectService.requireTransferReadyForBooking.mockRejectedValue(
      new BadRequestException({
        code: "HOST_PAYOUT_ACCOUNT_NOT_READY",
        message: "not ready",
        details: {}
      })
    );

    await expect(
      context.service.createCheckoutSession("token", { bookingId: "booking_1" })
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "HOST_PAYOUT_ACCOUNT_NOT_READY" })
    });
    expect(context.prisma.payment.create).not.toHaveBeenCalled();
    expect(context.stripeService.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("persists immutable server-side fee snapshots before Connect checkout", async () => {
    const context = createService();
    const attempt = arrangeNewCheckout(context);
    context.connectService.requireTransferReadyForBooking.mockResolvedValue({
      id: "connected_1",
      userId: acceptedBooking.hostId,
      providerAccountId: "acct_v2_host",
      transfersReady: true
    });
    context.connectService.marketplaceConfiguration.mockReturnValue({
      platformFeeBps: 1250,
      transferDelayHours: 24
    });

    await context.service.createCheckoutSession("token", {
      bookingId: "booking_1"
    });

    expect(context.prisma.hostTransfer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: "booking_1",
        paymentId: attempt.id,
        hostId: acceptedBooking.hostId,
        connectedAccountId: "connected_1",
        providerConnectedAccountId: "acct_v2_host",
        grossAmountCents: 16_000,
        platformFeeCents: 2_000,
        hostNetAmountCents: 14_000,
        currency: "USD",
        transferGroup: "booking_booking_1",
        idempotencyKey: `host-transfer:booking_1:${attempt.id}`,
        eligibleAt: new Date("2026-07-21T00:00:00.000Z")
      })
    });
    expect(context.stripeService.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ transferGroup: "booking_booking_1" })
    );
  });

  it("reuses an existing Connect snapshot without recalculating it", async () => {
    const context = createService();
    context.authService.getCurrentUserRecord.mockResolvedValue(renterUser);
    context.connectService.requireTransferReadyForBooking.mockResolvedValue({
      id: "connected_1",
      userId: acceptedBooking.hostId,
      providerAccountId: "acct_v2_host",
      transfersReady: true
    });
    context.prisma.booking.findUnique.mockResolvedValue({
      ...acceptedBooking,
      status: BookingStatus.payment_pending
    });
    context.prisma.payment.findFirst.mockResolvedValue(paymentRecord());
    context.prisma.hostTransfer.findUnique.mockResolvedValue({
      transferGroup: "booking_booking_1",
      grossAmountCents: 16_000,
      platformFeeCents: 2_000,
      hostNetAmountCents: 14_000
    });
    context.stripeService.retrieveCheckoutSession.mockResolvedValue(
      checkoutSession({ payment_status: "unpaid", status: "open" })
    );

    await context.service.createCheckoutSession("token", {
      bookingId: "booking_1"
    });

    expect(context.prisma.hostTransfer.create).not.toHaveBeenCalled();
    expect(context.connectService.marketplaceConfiguration).not.toHaveBeenCalled();
    expect(context.stripeService.retrieveCheckoutSession).toHaveBeenCalledWith(
      "cs_test_123"
    );
  });
});

describe("PaymentsService webhooks", () => {
  function arrangePaidWebhook(context: ReturnType<typeof createService>) {
    const payment = paymentRecord();
    context.prisma.payment.findUnique.mockResolvedValue(payment);
    context.stripeService.retrieveCheckoutSession.mockResolvedValue(
      checkoutSession()
    );
    return payment;
  }

  it("rejects an invalid signature before persisting an inbox event", async () => {
    const context = createService();
    context.stripeService.constructWebhookEvent.mockImplementation(() => {
      throw new UnauthorizedException();
    });

    await expect(
      context.service.handleStripeWebhook(Buffer.from("{}"), "bad-signature")
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(context.prisma.stripeWebhookEvent.create).not.toHaveBeenCalled();
  });

  it("passes the untouched raw body to Stripe signature validation", async () => {
    const context = createService();
    const event = stripeEvent("unhandled.event", { id: "object_1" });
    const rawBody = Buffer.from('{"exact":"bytes"}');
    context.stripeService.constructWebhookEvent.mockReturnValue(event);

    await context.service.handleStripeWebhook(rawBody, "valid-signature");

    expect(context.stripeService.constructWebhookEvent).toHaveBeenCalledWith(
      rawBody,
      "valid-signature"
    );
  });

  it("delivers the same event twice but fulfills and queues email once", async () => {
    const context = createService();
    arrangePaidWebhook(context);
    const event = stripeEvent("checkout.session.completed", {
      id: "cs_test_123"
    });
    context.prisma.stripeWebhookEvent.create
      .mockResolvedValueOnce({
        id: "inbox_1",
        status: StripeWebhookProcessingStatus.received
      })
      .mockRejectedValueOnce({ code: "P2002" });
    context.prisma.stripeWebhookEvent.findUnique.mockResolvedValue({
      id: "inbox_1",
      status: StripeWebhookProcessingStatus.processed
    });

    const first = await deliver(context, event);
    const second = await deliver(context, event);

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(context.prisma.payment.update).toHaveBeenCalledTimes(1);
    expect(context.prisma.booking.update).toHaveBeenCalledTimes(1);
    expect(context.emailService.queueTransactionalEmail).toHaveBeenCalledTimes(1);
  });

  it("concurrent duplicate deliveries claim business processing once", async () => {
    const context = createService();
    arrangePaidWebhook(context);
    const event = stripeEvent("checkout.session.async_payment_succeeded", {
      id: "cs_test_123"
    });
    context.prisma.stripeWebhookEvent.create
      .mockResolvedValueOnce({
        id: "inbox_1",
        status: StripeWebhookProcessingStatus.received
      })
      .mockRejectedValueOnce({ code: "P2002" });
    context.prisma.stripeWebhookEvent.findUnique.mockResolvedValue({
      id: "inbox_1",
      status: StripeWebhookProcessingStatus.processing
    });

    await Promise.all([deliver(context, event), deliver(context, event)]);

    expect(context.prisma.payment.update).toHaveBeenCalledTimes(1);
    expect(context.emailService.queueTransactionalEmail).toHaveBeenCalledTimes(1);
  });

  it("does not mark paid when checkout completed but remains unpaid", async () => {
    const context = createService();
    context.prisma.payment.findUnique.mockResolvedValue(paymentRecord());
    context.stripeService.retrieveCheckoutSession.mockResolvedValue(
      checkoutSession({ payment_status: "unpaid" })
    );

    const response = await deliver(
      context,
      stripeEvent("checkout.session.completed", { id: "cs_test_123" })
    );

    expect(response.processingStatus).toBe(
      StripeWebhookProcessingStatus.ignored
    );
    expect(context.prisma.payment.update).not.toHaveBeenCalled();
    expect(context.prisma.booking.update).not.toHaveBeenCalled();
  });

  it("marks an authoritative async payment succeeded event paid once", async () => {
    const context = createService();
    arrangePaidWebhook(context);

    await deliver(
      context,
      stripeEvent("checkout.session.async_payment_succeeded", {
        id: "cs_test_123"
      })
    );

    expect(context.prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "payment_1" },
      data: expect.objectContaining({
        status: PaymentStatus.paid,
        paidAt: expect.any(Date),
        active: false
      })
    });
    expect(context.prisma.booking.update).toHaveBeenCalledWith({
      where: { id: "booking_1" },
      data: { status: BookingStatus.paid }
    });
    expect(context.prisma.bookingLocationSnapshot.upsert).toHaveBeenCalledWith({
      where: { bookingId: "booking_1" },
      create: expect.objectContaining({
        formattedAddress: "123 Main St",
        exactLatitude: 29.7604,
        exactLongitude: -95.3698,
        sourceListingLocationVersion: 4,
        capturedAt: expect.any(Date)
      }),
      update: {}
    });
  });

  it("validates payment_intent.succeeded before fulfillment", async () => {
    const context = createService();
    const payment = paymentRecord();
    context.stripeService.retrievePaymentIntent.mockResolvedValue(
      paymentIntent()
    );
    context.prisma.payment.findFirst.mockResolvedValue(payment);
    context.prisma.payment.findUnique.mockResolvedValue(payment);

    await deliver(
      context,
      stripeEvent("payment_intent.succeeded", {
        id: "pi_123",
        metadata: {
          bookingId: "booking_1",
          paymentId: "payment_1"
        }
      })
    );

    expect(context.stripeService.retrievePaymentIntent).toHaveBeenCalledWith(
      "pi_123"
    );
    expect(context.prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "payment_1" },
      data: expect.objectContaining({ status: PaymentStatus.paid })
    });
  });

  it("payment_intent.payment_failed cancels and releases a pending booking", async () => {
    const context = createService();
    const payment = paymentRecord();
    context.prisma.payment.findFirst.mockResolvedValue(payment);
    context.prisma.payment.findUnique.mockResolvedValue(payment);
    context.prisma.booking.updateMany.mockResolvedValue({ count: 1 });

    await deliver(
      context,
      stripeEvent("payment_intent.payment_failed", {
        id: "pi_123",
        metadata: {
          bookingId: "booking_1",
          paymentId: "payment_1"
        }
      })
    );

    expect(context.prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "payment_1" },
      data: expect.objectContaining({
        status: PaymentStatus.failed,
        active: false
      })
    });
    expect(context.prisma.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: BookingStatus.cancelled,
          cancellationReason: BookingCancellationReason.payment_failed
        })
      })
    );
  });

  it.each([
    ["amount", { amount_total: 15_999 }],
    ["currency", { currency: "cad" }],
    ["booking metadata", { metadata: { bookingId: "wrong", paymentId: "payment_1" } }]
  ])("flags a %s mismatch without fulfillment", async (_label, overrides) => {
    const context = createService();
    context.prisma.payment.findUnique.mockResolvedValue(paymentRecord());
    context.stripeService.retrieveCheckoutSession.mockResolvedValue(
      checkoutSession(overrides)
    );

    const response = await deliver(
      context,
      stripeEvent("checkout.session.async_payment_succeeded", {
        id: "cs_test_123"
      })
    );

    expect(response.processingStatus).toBe(StripeWebhookProcessingStatus.failed);
    expect(context.prisma.payment.update).not.toHaveBeenCalled();
    expect(context.prisma.booking.update).not.toHaveBeenCalled();
  });

  it.each([
    [
      "checkout.session.expired",
      PaymentStatus.expired,
      BookingCancellationReason.payment_expired
    ],
    [
      "checkout.session.async_payment_failed",
      PaymentStatus.failed,
      BookingCancellationReason.payment_failed
    ]
  ])("%s releases inventory and records cancellation", async (type, status, reason) => {
    const context = createService();
    context.prisma.payment.findUnique.mockResolvedValue(paymentRecord());
    context.prisma.booking.updateMany.mockResolvedValue({ count: 1 });

    await deliver(context, stripeEvent(type, { id: "cs_test_123" }));

    expect(context.prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "payment_1" },
      data: expect.objectContaining({ status, active: false })
    });
    expect(context.prisma.booking.updateMany).toHaveBeenCalledWith({
      where: {
        id: "booking_1",
        status: BookingStatus.payment_pending
      },
      data: {
        status: BookingStatus.cancelled,
        cancellationReason: reason,
        cancelledAt: expect.any(Date)
      }
    });
  });

  it("a stale succeeded event cannot overwrite refunded state or paidAt", async () => {
    const context = createService();
    const originalPaidAt = new Date("2026-07-18T11:00:00.000Z");
    context.prisma.payment.findUnique.mockResolvedValue(
      paymentRecord({
        status: PaymentStatus.refunded,
        paidAt: originalPaidAt,
        refundedAt: now,
        booking: {
          ...paymentRecord().booking,
          status: BookingStatus.cancelled
        }
      })
    );
    context.stripeService.retrieveCheckoutSession.mockResolvedValue(
      checkoutSession()
    );

    await deliver(
      context,
      stripeEvent("checkout.session.async_payment_succeeded", {
        id: "cs_test_123"
      })
    );

    expect(context.prisma.payment.update).not.toHaveBeenCalled();
    expect(context.emailService.queueTransactionalEmail).not.toHaveBeenCalled();
  });

  it("records a newer delayed success after expiry without restoring inventory or access", async () => {
    const context = createService();
    const expired = paymentRecord({
      status: PaymentStatus.expired,
      active: false,
      failureReason: "checkout.session.expired",
      lastProviderEventCreatedAt: new Date(now.getTime() - 60_000),
      booking: {
        ...paymentRecord().booking,
        status: BookingStatus.cancelled,
        cancellationReason: BookingCancellationReason.payment_expired
      }
    });
    context.prisma.payment.findUnique.mockResolvedValue(expired);
    context.stripeService.retrieveCheckoutSession.mockResolvedValue(
      checkoutSession()
    );

    await deliver(
      context,
      stripeEvent("checkout.session.async_payment_succeeded", {
        id: "cs_test_123"
      })
    );

    expect(context.prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "payment_1" },
      data: expect.objectContaining({ status: PaymentStatus.paid })
    });
    expect(context.prisma.booking.update).not.toHaveBeenCalled();
    expect(context.emailService.queueTransactionalEmail).not.toHaveBeenCalled();
  });

  it("represents a partial refund without cancelling the booking", async () => {
    const context = createService();
    const paid = paymentRecord({
      status: PaymentStatus.paid,
      active: false,
      paidAt: now,
      booking: {
        ...paymentRecord().booking,
        status: BookingStatus.paid
      }
    });
    context.prisma.payment.findFirst.mockResolvedValue(paid);
    context.prisma.payment.findUnique.mockResolvedValue(paid);

    await deliver(
      context,
      stripeEvent("charge.refunded", {
        id: "ch_123",
        payment_intent: "pi_123",
        amount_refunded: 4_000,
        currency: "usd"
      })
    );

    expect(context.prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "payment_1" },
      data: expect.objectContaining({
        status: PaymentStatus.partially_refunded,
        amountRefundedCents: 4_000
      })
    });
    expect(context.prisma.booking.updateMany).not.toHaveBeenCalled();
  });

  it("schedules a proportional partial reversal after Host transfer release", async () => {
    const context = createService();
    const paid = paymentRecord({
      status: PaymentStatus.paid,
      active: false,
      paidAt: now,
      booking: {
        ...paymentRecord().booking,
        status: BookingStatus.paid
      }
    });
    context.prisma.payment.findFirst.mockResolvedValue(paid);
    context.prisma.payment.findUnique.mockResolvedValue(paid);
    context.prisma.hostTransfer.findUnique.mockResolvedValue(
      hostTransferRecord()
    );

    await deliver(
      context,
      stripeEvent("charge.refunded", {
        id: "ch_123",
        payment_intent: "pi_123",
        amount_refunded: 4_000,
        currency: "usd"
      })
    );

    expect(context.prisma.hostTransfer.update).toHaveBeenCalledWith({
      where: { id: "host_transfer_1" },
      data: {
        reversalTargetAmountCents: 3_500,
        reversalStatus: HostTransferReversalStatus.pending
      }
    });
  });

  it("blocks a refunded payment before Host transfer release", async () => {
    const context = createService();
    const paid = paymentRecord({
      status: PaymentStatus.paid,
      active: false,
      paidAt: now,
      booking: {
        ...paymentRecord().booking,
        status: BookingStatus.paid
      }
    });
    context.prisma.payment.findFirst.mockResolvedValue(paid);
    context.prisma.payment.findUnique.mockResolvedValue(paid);
    context.prisma.hostTransfer.findUnique.mockResolvedValue(
      hostTransferRecord({
        status: HostTransferStatus.pending,
        providerTransferId: null
      })
    );

    await deliver(
      context,
      stripeEvent("charge.refunded", {
        id: "ch_123",
        payment_intent: "pi_123",
        amount_refunded: 1_000,
        currency: "usd"
      })
    );

    expect(context.prisma.hostTransfer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: HostTransferStatus.blocked,
          failureCode: "payment_refunded_before_release"
        })
      })
    );
  });

  it("a full refund is timestamp-stable and cancels/releases the booking", async () => {
    const context = createService();
    const paid = paymentRecord({
      status: PaymentStatus.paid,
      active: false,
      paidAt: now,
      booking: {
        ...paymentRecord().booking,
        status: BookingStatus.paid
      }
    });
    context.prisma.payment.findFirst.mockResolvedValue(paid);
    context.prisma.payment.findUnique.mockResolvedValue(paid);
    context.prisma.booking.updateMany.mockResolvedValue({ count: 1 });

    await deliver(
      context,
      stripeEvent("charge.refunded", {
        id: "ch_123",
        payment_intent: "pi_123",
        amount_refunded: 16_000,
        currency: "usd"
      })
    );

    expect(context.prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "payment_1" },
      data: expect.objectContaining({
        status: PaymentStatus.refunded,
        amountRefundedCents: 16_000,
        refundedAt: expect.any(Date)
      })
    });
    expect(context.prisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: "booking_1", status: BookingStatus.paid },
      data: {
        status: BookingStatus.cancelled,
        cancellationReason: BookingCancellationReason.full_refund,
        cancelledAt: expect.any(Date)
      }
    });
    expect(context.emailService.queueTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({ template: "payment_refunded_renter" }),
      expect.objectContaining({
        deduplicationKey: "payment-refunded:payment_1:renter"
      })
    );
  });

  it("a dispute cancels location access and queues one operations email", async () => {
    const context = createService();
    const paid = paymentRecord({
      status: PaymentStatus.paid,
      active: false,
      paidAt: now,
      booking: {
        ...paymentRecord().booking,
        status: BookingStatus.paid
      }
    });
    context.prisma.payment.findFirst.mockResolvedValue(paid);
    context.prisma.payment.findUnique.mockResolvedValue(paid);
    context.prisma.booking.updateMany.mockResolvedValue({ count: 1 });

    await deliver(
      context,
      stripeEvent("charge.dispute.created", {
        id: "dp_123",
        payment_intent: "pi_123",
        status: "needs_response"
      })
    );

    expect(context.prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "payment_1" },
      data: expect.objectContaining({ status: PaymentStatus.disputed })
    });
    expect(context.prisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: "booking_1", status: BookingStatus.paid },
      data: {
        status: BookingStatus.cancelled,
        cancellationReason: BookingCancellationReason.payment_disputed,
        cancelledAt: expect.any(Date)
      }
    });
    expect(context.emailService.queueTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "payments@example.com",
        template: "payment_disputed_admin"
      }),
      expect.objectContaining({
        deduplicationKey: "payment-disputed:payment_1:operations"
      })
    );
  });

  it("blocks an unreleased Host transfer when a dispute opens", async () => {
    const context = createService();
    const paid = paymentRecord({
      status: PaymentStatus.paid,
      active: false,
      paidAt: now,
      booking: {
        ...paymentRecord().booking,
        status: BookingStatus.paid
      }
    });
    context.prisma.payment.findFirst.mockResolvedValue(paid);
    context.prisma.payment.findUnique.mockResolvedValue(paid);
    context.prisma.hostTransfer.findUnique.mockResolvedValue(
      hostTransferRecord({
        status: HostTransferStatus.pending,
        providerTransferId: null
      })
    );
    context.prisma.booking.updateMany.mockResolvedValue({ count: 1 });

    await deliver(
      context,
      stripeEvent("charge.dispute.created", {
        id: "dp_123",
        payment_intent: "pi_123",
        status: "needs_response"
      })
    );

    expect(context.prisma.hostTransfer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: HostTransferStatus.blocked,
          failureCode: "payment_disputed_before_release"
        })
      })
    );
  });

  it("reconciles duplicate transfer.reversed events monotonically", async () => {
    const context = createService();
    context.prisma.hostTransfer.findUnique.mockResolvedValue(
      hostTransferRecord({
        reversedAmountCents: 1_000,
        reversalTargetAmountCents: 3_500,
        reversalProviderIds: ["trr_old"]
      })
    );
    await deliver(
      context,
      stripeEvent("transfer.reversed", {
        id: "tr_1",
        amount_reversed: 3_500,
        reversed: false,
        reversals: { data: [{ id: "trr_old" }, { id: "trr_new" }] }
      })
    );

    expect(context.prisma.hostTransfer.update).toHaveBeenCalledWith({
      where: { id: "host_transfer_1" },
      data: expect.objectContaining({
        reversedAmountCents: 3_500,
        reversalTargetAmountCents: 3_500,
        reversalProviderIds: ["trr_old", "trr_new"],
        reversalStatus: HostTransferReversalStatus.partially_reversed
      })
    });
  });

  it("a won dispute reconciles payment state without resurrecting the cancelled booking", async () => {
    const context = createService();
    const disputed = paymentRecord({
      status: PaymentStatus.disputed,
      active: false,
      paidAt: now,
      booking: {
        ...paymentRecord().booking,
        status: BookingStatus.cancelled,
        cancellationReason: BookingCancellationReason.payment_disputed
      }
    });
    context.prisma.payment.findFirst.mockResolvedValue(disputed);
    context.prisma.payment.findUnique.mockResolvedValue(disputed);

    await deliver(
      context,
      stripeEvent("charge.dispute.closed", {
        id: "dp_123",
        payment_intent: "pi_123",
        status: "won"
      })
    );

    expect(context.prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "payment_1" },
      data: expect.objectContaining({ status: PaymentStatus.paid })
    });
    expect(context.prisma.booking.update).not.toHaveBeenCalled();
    expect(context.prisma.booking.updateMany).not.toHaveBeenCalled();
  });

  it("retries failed or crash-left received inbox events through the explicit recovery path", async () => {
    const context = createService();
    context.prisma.stripeWebhookEvent.findMany.mockResolvedValue([
      {
        id: "inbox_failed",
        status: StripeWebhookProcessingStatus.failed,
        payload: {
          id: "evt_retry",
          type: "unhandled.event",
          created: Math.floor(now.getTime() / 1000),
          object: { id: "object_1" }
        }
      }
    ]);

    await expect(
      context.service.retryFailedWebhookEvents(25)
    ).resolves.toEqual({ total: 1, processed: 1, failed: 0 });
  });
});

describe("PaymentsService local expiry sweep", () => {
  it("releases stale payment_pending inventory even without a webhook", async () => {
    const context = createService();
    const stalePayment = paymentRecord({
      expiresAt: new Date(Date.now() - 60_000)
    });
    context.prisma.payment.findMany.mockResolvedValue([
      {
        id: "payment_1",
        bookingId: "booking_1",
        booking: { listingId: "listing_1" }
      }
    ]);
    context.prisma.payment.findUnique.mockResolvedValue(stalePayment);
    context.prisma.booking.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      context.service.expireStaleCheckoutAttempts()
    ).resolves.toEqual({ scanned: 1, expired: 1 });

    expect(context.prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "payment_1" },
      data: {
        status: PaymentStatus.expired,
        active: false,
        failureReason: "local_checkout_expiry"
      }
    });
    expect(context.prisma.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: BookingStatus.cancelled,
          cancellationReason: BookingCancellationReason.payment_expired
        })
      })
    );
  });
});

describe("PaymentsService provider reconciliation", () => {
  it("skips a terminal refunded payment without a provider call", async () => {
    const context = createService();
    context.prisma.payment.findUnique.mockResolvedValue(
      paymentRecord({ status: PaymentStatus.refunded })
    );

    await expect(
      context.service.reconcilePaymentProviderState("payment_1", "command_1")
    ).resolves.toEqual({ outcome: "skipped", providerCalls: 0 });
    expect(
      context.stripeService.retrievePaymentIntentForReconciliation
    ).not.toHaveBeenCalled();
  });

  it("applies a cumulative refund snapshot through the transactional webhook path", async () => {
    const context = createService();
    const paid = paymentRecord({
      status: PaymentStatus.paid,
      active: false,
      paidAt: now
    });
    const snapshot = paymentIntent({
      latest_charge: {
        id: "ch_123",
        amount: 16_000,
        amount_refunded: 4_000,
        currency: "usd",
        payment_intent: "pi_123",
        metadata: { bookingId: "booking_1", paymentId: "payment_1" }
      }
    });
    context.prisma.payment.findUnique.mockResolvedValue(paid);
    context.prisma.payment.findFirst.mockResolvedValue(paid);
    context.prisma.booking.updateMany.mockResolvedValue({ count: 1 });
    context.stripeService.retrievePaymentIntentForReconciliation.mockResolvedValue(
      snapshot
    );

    await expect(
      context.service.reconcilePaymentProviderState("payment_1", "command_1")
    ).resolves.toEqual({ outcome: "reconciled", providerCalls: 1 });
    expect(context.prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "payment_1" },
      data: expect.objectContaining({
        status: PaymentStatus.partially_refunded,
        amountRefundedCents: 4_000
      })
    });
    expect(context.transaction).toHaveBeenCalled();
  });

  it("reconciles a provider-declined PaymentIntent without fulfillment validation", async () => {
    const context = createService();
    const pending = paymentRecord();
    const declined = paymentIntent({
      status: "requires_payment_method",
      amount_received: 0
    });
    context.prisma.payment.findUnique.mockResolvedValue(pending);
    context.prisma.payment.findFirst.mockResolvedValue(pending);
    context.prisma.booking.updateMany.mockResolvedValue({ count: 1 });
    context.stripeService.retrievePaymentIntentForReconciliation.mockResolvedValue(
      declined
    );

    await expect(
      context.service.reconcilePaymentProviderState("payment_1", "command_1")
    ).resolves.toEqual({ outcome: "reconciled", providerCalls: 1 });
    expect(context.prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "payment_1" },
      data: expect.objectContaining({
        status: PaymentStatus.failed,
        failureReason: "payment_intent.payment_failed"
      })
    });
  });

  it("reconciles a bounded dispute lookup through the monotonic dispute path", async () => {
    const context = createService();
    const paid = paymentRecord({ status: PaymentStatus.paid, active: false });
    const snapshot = paymentIntent({
      latest_charge: {
        id: "ch_123",
        amount: 16_000,
        amount_refunded: 0,
        currency: "usd",
        payment_intent: "pi_123",
        disputed: true
      }
    });
    context.prisma.payment.findUnique.mockResolvedValue(paid);
    context.prisma.payment.findFirst.mockResolvedValue(paid);
    context.prisma.booking.updateMany.mockResolvedValue({ count: 1 });
    context.stripeService.retrievePaymentIntentForReconciliation.mockResolvedValue(
      snapshot
    );
    context.stripeService.findDisputesForReconciliation.mockResolvedValue([
      {
        id: "dp_123",
        amount: 16_000,
        currency: "usd",
        payment_intent: "pi_123",
        metadata: { bookingId: "booking_1", paymentId: "payment_1" },
        status: "needs_response"
      }
    ]);

    await expect(
      context.service.reconcilePaymentProviderState("payment_1", "command_1")
    ).resolves.toEqual({ outcome: "reconciled", providerCalls: 2 });
    expect(context.prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "payment_1" },
      data: expect.objectContaining({ status: PaymentStatus.disputed })
    });
  });

  it("adopts one validated provider transfer without representing a bank payout", async () => {
    const context = createService();
    const baseTransfer = hostTransferRecord({
      status: HostTransferStatus.processing,
      providerTransferId: null,
      providerConnectedAccountId: "acct_host_1",
      connectedAccountId: "connected_1",
      hostId: "host_user_1",
      currency: "USD",
      transferGroup: "booking:booking_1",
      transferredAt: null,
      failedAt: null,
      failureCode: null,
      failureMessage: null,
      payment: paymentRecord({
        hostTransfer: { id: "host_transfer_1" }
      })
    });
    context.prisma.hostTransfer.findUnique.mockResolvedValue(baseTransfer);
    context.stripeService.findHostTransfersForReconciliation.mockResolvedValue([
      {
        id: "tr_1",
        amount: 14_000,
        amount_reversed: 0,
        currency: "usd",
        destination: "acct_host_1",
        transfer_group: "booking:booking_1",
        metadata: {
          bookingId: "booking_1",
          hostTransferId: "host_transfer_1"
        },
        reversed: false
      }
    ]);

    await expect(
      context.service.reconcileHostTransferProviderState(
        "host_transfer_1",
        "command_1"
      )
    ).resolves.toEqual({ outcome: "reconciled", providerCalls: 1 });
    expect(context.prisma.hostTransfer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerTransferId: "tr_1",
          status: HostTransferStatus.transferred
        })
      })
    );
  });
});
