import {
  BookingStatus,
  CancellationFinancialDisposition,
  CancellationOperationStatus,
  PaymentStatus
} from "@prisma/client";
import type { AuthService } from "../src/auth/auth.service";
import type { JobsService } from "../src/jobs/jobs.service";
import { BookingCancellationsService } from "../src/payments/booking-cancellations.service";
import type { StripeService } from "../src/payments/stripe.service";
import type { PrismaService } from "../src/prisma/prisma.service";

const now = new Date("2026-07-19T18:00:00.000Z");

function workerHarness(options: {
  status: CancellationOperationStatus;
  paymentStatus: PaymentStatus;
  amountRefundedCents?: number;
}) {
  const payment = {
    id: "payment_1",
    bookingId: "booking_1",
    status: options.paymentStatus,
    active: options.paymentStatus === PaymentStatus.pending,
    amountCents: 16_000,
    amountRefundedCents: options.amountRefundedCents ?? 0,
    providerCheckoutSessionId: "cs_1",
    providerPaymentIntentId: "pi_1",
    attemptNumber: 1
  };
  const booking = {
    id: "booking_1",
    listingId: "listing_1",
    renterId: "renter_1",
    hostId: "host_1",
    status:
      options.paymentStatus === PaymentStatus.pending
        ? BookingStatus.payment_pending
        : BookingStatus.paid,
    startDate: new Date("2026-08-01T00:00:00.000Z"),
    payments: [payment],
    hostTransfer: null
  };
  const operation = {
    id: "cancel_1",
    bookingId: booking.id,
    paymentId: payment.id,
    status: options.status,
    financialDisposition:
      options.status === CancellationOperationStatus.checkout_expiry_pending
        ? CancellationFinancialDisposition.checkout_expiry_pending
        : CancellationFinancialDisposition.full_refund_pending,
    active: true,
    actorType: "host",
    actorUserId: "host_1",
    reason: "property_unavailable",
    version: 1,
    idempotencyKey: "client-1",
    providerOperationRef: null,
    failureCode: null,
    requestedAt: now,
    effectiveAt: null,
    failedAt: null,
    createdAt: now,
    updatedAt: now,
    booking: { ...booking }
  };
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([{ now }]),
    bookingCancellationOperation: {
      findUnique: jest.fn().mockResolvedValue(operation),
      update: jest.fn().mockResolvedValue(operation)
    },
    payment: { update: jest.fn().mockResolvedValue(payment) },
    booking: { update: jest.fn().mockResolvedValue(booking) },
    outboxEvent: { create: jest.fn(), findUnique: jest.fn() }
  };
  const prisma = {
    bookingCancellationOperation: {
      findUnique: jest.fn().mockResolvedValue({
        bookingId: booking.id,
        booking: { listingId: booking.listingId }
      })
    },
    $transaction: jest.fn(async (callback: (transaction: unknown) => unknown) =>
      callback(tx)
    )
  };
  const jobs = { enqueue: jest.fn().mockResolvedValue({ id: "outbox_1" }) };
  const stripe = {
    expireCheckoutSession: jest.fn().mockResolvedValue({ id: "cs_1", status: "expired" }),
    createFullRefund: jest.fn().mockResolvedValue({ id: "re_1", status: "pending" })
  };
  const service = new BookingCancellationsService(
    prisma as unknown as PrismaService,
    {} as AuthService,
    jobs as unknown as JobsService,
    stripe as unknown as StripeService
  );
  return { service, tx, jobs, stripe, payment, booking, operation };
}

describe("booking cancellation provider workers", () => {
  it("expires Checkout and only then completes the unpaid cancellation", async () => {
    const { service, tx, stripe } = workerHarness({
      status: CancellationOperationStatus.checkout_expiry_pending,
      paymentStatus: PaymentStatus.pending
    });

    await service.executeCheckoutExpiry("cancel_1");

    expect(stripe.expireCheckoutSession).toHaveBeenCalledWith({
      checkoutSessionId: "cs_1",
      idempotencyKey: "cancellation-checkout-expiry:cancel_1"
    });
    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: "payment_1" },
      data: expect.objectContaining({ status: PaymentStatus.expired, active: false })
    });
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: "booking_1" },
      data: expect.objectContaining({ status: BookingStatus.cancelled, cancelledAt: now })
    });
    expect(tx.bookingCancellationOperation.update).toHaveBeenCalledWith({
      where: { id: "cancel_1" },
      data: expect.objectContaining({
        status: CancellationOperationStatus.completed,
        financialDisposition: CancellationFinancialDisposition.financially_complete,
        active: false,
        effectiveAt: now
      })
    });
  });

  it("derives the full-refund command from the stored remaining amount and does not complete early", async () => {
    const { service, tx, stripe } = workerHarness({
      status: CancellationOperationStatus.refund_pending,
      paymentStatus: PaymentStatus.partially_refunded,
      amountRefundedCents: 4_000
    });

    await service.executeFullRefund("cancel_1");

    expect(stripe.createFullRefund).toHaveBeenCalledWith({
      paymentIntentId: "pi_1",
      amountCents: 12_000,
      bookingId: "booking_1",
      paymentId: "payment_1",
      cancellationOperationId: "cancel_1",
      idempotencyKey: "cancellation-full-refund:cancel_1:12000"
    });
    expect(tx.booking.update).not.toHaveBeenCalled();
    expect(tx.bookingCancellationOperation.update).toHaveBeenCalledWith({
      where: { id: "cancel_1" },
      data: {
        providerOperationRef: "re_1",
        failureCode: null,
        failedAt: null
      }
    });
  });

  it("keeps inventory blocked and records retryable provider failure", async () => {
    const { service, tx, stripe } = workerHarness({
      status: CancellationOperationStatus.refund_pending,
      paymentStatus: PaymentStatus.paid
    });
    stripe.createFullRefund.mockRejectedValue({
      getResponse: () => ({ code: "PAYMENT_PROVIDER_UNAVAILABLE" })
    });

    await expect(service.executeFullRefund("cancel_1")).rejects.toBeDefined();
    expect(tx.booking.update).not.toHaveBeenCalled();
    expect(tx.bookingCancellationOperation.update).toHaveBeenCalledWith({
      where: { id: "cancel_1" },
      data: expect.objectContaining({
        status: CancellationOperationStatus.failed_retryable,
        failureCode: "PAYMENT_PROVIDER_UNAVAILABLE",
        failedAt: expect.any(Date)
      })
    });
  });
});
