import { ForbiddenException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import {
  BookingStatus,
  ConnectCapabilityStatus,
  HostTransferReversalStatus,
  HostTransferStatus,
  PaymentStatus,
  StripeAccountApiModel
} from "@prisma/client";
import type { EmailService } from "../src/email/email.service";
import type { ConnectService } from "../src/payments/connect.service";
import { HostTransfersService } from "../src/payments/host-transfers.service";
import type { IdentityEligibilityService } from "../src/identity/identity-eligibility.service";
import type { StripeService } from "../src/payments/stripe.service";
import type { PrismaService } from "../src/prisma/prisma.service";

const now = new Date("2026-07-22T00:00:00.000Z");

function transferRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "host_transfer_1",
    bookingId: "booking_1",
    paymentId: "payment_1",
    hostId: "host_1",
    connectedAccountId: "connected_1",
    providerConnectedAccountId: "acct_v2_host",
    grossAmountCents: 16_000,
    platformFeeCents: 2_000,
    hostNetAmountCents: 14_000,
    currency: "USD",
    transferGroup: "booking_booking_1",
    status: HostTransferStatus.pending,
    providerTransferId: null,
    idempotencyKey: "host-transfer:booking_1:payment_1",
    eligibleAt: new Date("2026-07-01T00:00:00.000Z"),
    transferredAt: null,
    failedAt: null,
    failureCode: null,
    failureMessage: null,
    reversedAmountCents: 0,
    reversalTargetAmountCents: 0,
    reversalStatus: HostTransferReversalStatus.none,
    reversalProviderIds: [],
    reversalIdempotencyKey: null,
    reversalFailedAt: null,
    reversalFailureCode: null,
    reversalFailureMessage: null,
    createdAt: now,
    updatedAt: now,
    booking: {
      id: "booking_1",
      status: BookingStatus.paid,
      cancelledAt: null,
      cancellationOperations: []
    },
    payment: {
      id: "payment_1",
      status: PaymentStatus.paid,
      amountRefundedCents: 0,
      providerChargeId: "ch_1"
    },
    connectedAccount: {
      id: "connected_1",
      userId: "host_1",
      providerAccountId: "acct_v2_host",
      apiModel: StripeAccountApiModel.accounts_v2_recipient,
      country: "US",
      currency: "USD",
      detailsSubmitted: true,
      transfersCapability: ConnectCapabilityStatus.active,
      transfersReady: true,
      payoutsEnabled: true,
      requirementsCurrentlyDue: [],
      requirementsPastDue: [],
      lastSynchronizedAt: now,
      createdAt: now,
      updatedAt: now
    },
    ...overrides
  };
}

function createService(initial = transferRecord()) {
  let state = initial;
  const hostTransfer = {
    findMany: jest.fn(),
    findUnique: jest.fn().mockImplementation(() => Promise.resolve(state)),
    update: jest.fn().mockImplementation(({ data }) => {
      state = { ...state, ...data };
      return Promise.resolve(state);
    }),
    updateMany: jest.fn().mockImplementation(({ data }) => {
      state = { ...state, ...data };
      return Promise.resolve({ count: 1 });
    })
  };
  const transactionClient = {
    $executeRaw: jest.fn(),
    hostTransfer
  };
  let tail = Promise.resolve();
  const prisma = {
    ...transactionClient,
    $transaction: jest.fn((callback) => {
      const result = tail.then(() => callback(transactionClient));
      tail = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    })
  };
  const stripe = {
    createHostTransfer: jest.fn().mockResolvedValue({
      id: "tr_1",
      amount: 14_000,
      currency: "usd",
      destination: "acct_v2_host"
    }),
    createHostTransferReversal: jest.fn()
  };
  const connect = {
    synchronizeHostAccount: jest.fn().mockResolvedValue({ transfersReady: true }),
    marketplaceConfiguration: jest.fn().mockReturnValue({
      platformFeeBps: 1250,
      transferDelayHours: 24
    })
  };
  const email = { queueTransactionalEmail: jest.fn() };
  const config = {
    get: jest.fn((key: string) =>
      key === "PAYMENTS_OPERATIONS_EMAIL" ? "payments@example.com" : undefined
    )
  };
  const identityEligibility = { assertApproved: jest.fn() };
  const service = new HostTransfersService(
    prisma as unknown as PrismaService,
    stripe as unknown as StripeService,
    connect as unknown as ConnectService,
    email as unknown as EmailService,
    config as unknown as ConfigService,
    identityEligibility as unknown as IdentityEligibilityService
  );
  return {
    service,
    prisma,
    hostTransfer,
    stripe,
    email,
    identityEligibility,
    getState: () => state,
    setState: (next: ReturnType<typeof transferRecord>) => {
      state = next;
    }
  };
}

describe("HostTransfersService", () => {
  it("blocks Host transfer release when Host identity is not approved", async () => {
    const context = createService(transferRecord());
    context.identityEligibility.assertApproved.mockRejectedValue(
      new ForbiddenException({ code: "IDENTITY_VERIFICATION_REJECTED" })
    );
    await expect(context.service.releaseOne("host_transfer_1")).rejects.toMatchObject({
      response: { code: "IDENTITY_VERIFICATION_REJECTED" }
    });
    expect(context.stripe.createHostTransfer).not.toHaveBeenCalled();
  });

  it("does not release before check-in plus delay", async () => {
    const context = createService(
      transferRecord({ eligibleAt: new Date(Date.now() + 60_000) })
    );
    await expect(context.service.releaseOne("host_transfer_1")).rejects.toMatchObject({
      response: expect.objectContaining({ code: "TRANSFER_NOT_ELIGIBLE" })
    });
    expect(context.stripe.createHostTransfer).not.toHaveBeenCalled();
  });

  it("does not release a Host transfer while cancellation is active", async () => {
    const context = createService(
      transferRecord({
        booking: {
          ...transferRecord().booking,
          cancellationOperations: [{ id: "cancel_1" }]
        }
      })
    );
    await expect(context.service.releaseOne("host_transfer_1")).rejects.toMatchObject({
      response: expect.objectContaining({ code: "TRANSFER_NOT_ELIGIBLE" })
    });
    expect(context.stripe.createHostTransfer).not.toHaveBeenCalled();
  });

  it("uses the durable Stripe idempotency key and source charge", async () => {
    const context = createService();
    await context.service.releaseOne("host_transfer_1");
    expect(context.stripe.createHostTransfer).toHaveBeenCalledWith({
      amountCents: 14_000,
      currency: "USD",
      destination: "acct_v2_host",
      sourceChargeId: "ch_1",
      transferGroup: "booking_booking_1",
      bookingId: "booking_1",
      hostTransferId: "host_transfer_1",
      idempotencyKey: "host-transfer:booking_1:payment_1"
    });
    expect(context.getState()).toMatchObject({
      status: HostTransferStatus.transferred,
      providerTransferId: "tr_1"
    });
  });

  it("serializes concurrent release so Stripe receives one create call", async () => {
    const context = createService();
    const results = await Promise.allSettled([
      context.service.releaseOne("host_transfer_1"),
      context.service.releaseOne("host_transfer_1")
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(context.stripe.createHostTransfer).toHaveBeenCalledTimes(1);
  });

  it("retries a failed transfer with the same stable Stripe idempotency key", async () => {
    const context = createService();
    context.stripe.createHostTransfer
      .mockRejectedValueOnce(new Error("temporary provider failure"))
      .mockResolvedValueOnce({
        id: "tr_1",
        amount: 14_000,
        currency: "usd",
        destination: "acct_v2_host"
      });
    await expect(context.service.releaseOne("host_transfer_1")).rejects.toThrow();
    await context.service.releaseOne("host_transfer_1");
    expect(context.stripe.createHostTransfer).toHaveBeenCalledTimes(2);
    expect(
      context.stripe.createHostTransfer.mock.calls.map(
        ([input]) => input.idempotencyKey
      )
    ).toEqual([
      "host-transfer:booking_1:payment_1",
      "host-transfer:booking_1:payment_1"
    ]);
    expect(context.email.queueTransactionalEmail).toHaveBeenCalled();
  });

  it("creates cumulative partial then full reversals without duplicating amounts", async () => {
    const partial = transferRecord({
      status: HostTransferStatus.transferred,
      providerTransferId: "tr_1",
      reversalTargetAmountCents: 3_500,
      reversalStatus: HostTransferReversalStatus.pending
    });
    const context = createService(partial);
    context.stripe.createHostTransferReversal.mockResolvedValueOnce({
      id: "trr_partial",
      amount: 3_500,
      transfer: "tr_1"
    });
    await context.service.reverseOne("host_transfer_1");
    expect(context.getState()).toMatchObject({
      reversedAmountCents: 3_500,
      reversalStatus: HostTransferReversalStatus.partially_reversed,
      reversalProviderIds: ["trr_partial"]
    });

    context.setState(
      transferRecord({
        status: HostTransferStatus.transferred,
        providerTransferId: "tr_1",
        reversedAmountCents: 3_500,
        reversalTargetAmountCents: 14_000,
        reversalStatus: HostTransferReversalStatus.pending,
        reversalProviderIds: ["trr_partial"]
      })
    );
    context.stripe.createHostTransferReversal.mockResolvedValueOnce({
      id: "trr_full",
      amount: 10_500,
      transfer: "tr_1"
    });
    await context.service.reverseOne("host_transfer_1");
    expect(context.stripe.createHostTransferReversal).toHaveBeenLastCalledWith(
      expect.objectContaining({
        amountCents: 10_500,
        idempotencyKey: "host-transfer-reversal:host_transfer_1:14000"
      })
    );
    expect(context.getState()).toMatchObject({
      reversedAmountCents: 14_000,
      reversalStatus: HostTransferReversalStatus.reversed,
      reversalProviderIds: ["trr_partial", "trr_full"]
    });
  });
});
