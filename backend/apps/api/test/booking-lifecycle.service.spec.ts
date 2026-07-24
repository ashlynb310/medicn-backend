import {
  BookingLifecycleSource,
  BookingStatus,
  CancellationFinancialDisposition,
  CancellationOperationReason,
  CancellationOperationStatus,
  PaymentStatus
} from "@prisma/client";
import type { JobsService } from "../src/jobs/jobs.service";
import { BookingLifecycleService } from "../src/payments/booking-lifecycle.service";
import type { PrismaService } from "../src/prisma/prisma.service";

const boundary = new Date("2027-01-02T12:00:00.000Z");

function requestedBooking() {
  return {
    id: "booking_1",
    listingId: "listing_1",
    renterId: "renter_1",
    hostId: "host_1",
    status: BookingStatus.requested,
    requestExpiresAt: boundary,
    payments: [],
    hostTransfer: null,
    cancellationOperations: []
  };
}

function paidBooking(paymentStatus: PaymentStatus, amountRefundedCents = 0) {
  return {
    id: "booking_2",
    listingId: "listing_1",
    renterId: "renter_1",
    hostId: "host_1",
    status: BookingStatus.paid,
    endDate: new Date("2027-01-02T00:00:00.000Z"),
    timeZone: "UTC",
    checkoutTime: "10:00",
    cancelledAt: null,
    completedAt: null,
    payments: [{
      id: "payment_1",
      status: paymentStatus,
      attemptNumber: 1,
      amountCents: 20_000,
      amountRefundedCents
    }],
    hostTransfer: null,
    cancellationOperations: []
  };
}

function createService(booking: ReturnType<typeof requestedBooking> | ReturnType<typeof paidBooking>) {
  const transaction = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([{ eligibilityAt: boundary }]),
    booking: {
      findUnique: jest.fn().mockResolvedValue(booking),
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    bookingCancellationOperation: {
      findUnique: jest.fn().mockResolvedValue(null),
      aggregate: jest.fn().mockResolvedValue({ _max: { version: null } }),
      create: jest.fn().mockImplementation(async ({ data }) => ({
        id: "cancellation_1",
        createdAt: boundary,
        updatedAt: boundary,
        failedAt: null,
        failureCode: null,
        providerOperationRef: null,
        paymentId: null,
        ...data
      }))
    }
  };
  const prisma = {
    booking: {
      findUnique: jest.fn().mockResolvedValue({ listingId: booking.listingId })
    },
    $transaction: jest.fn(async (callback) => callback(transaction))
  };
  const jobs = { enqueue: jest.fn().mockResolvedValue({ id: "outbox_1" }) };
  return {
    service: new BookingLifecycleService(
      prisma as unknown as PrismaService,
      jobs as unknown as JobsService
    ),
    transaction,
    jobs
  };
}

describe("BookingLifecycleService", () => {
  it("does not expire a request before the exact 24-hour boundary", async () => {
    const { service, transaction, jobs } = createService(requestedBooking());

    await expect(
      service.expireRequestedBooking(
        "booking_1",
        new Date(boundary.getTime() - 1)
      )
    ).resolves.toEqual({ expired: false, reason: "not_due" });
    expect(transaction.booking.updateMany).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it("expires at the exact boundary through no-payment cancellation and opaque Outbox payloads", async () => {
    const { service, transaction, jobs } = createService(requestedBooking());

    await expect(service.expireRequestedBooking("booking_1", boundary))
      .resolves.toEqual({ expired: true });
    expect(transaction.booking.updateMany).toHaveBeenCalledWith({
      where: { id: "booking_1", status: BookingStatus.requested },
      data: {
        status: BookingStatus.cancelled,
        cancellationReason: "request_expired",
        cancelledAt: boundary,
        expiredAt: boundary,
        expirySource: BookingLifecycleSource.operations_scheduler
      }
    });
    expect(transaction.bookingCancellationOperation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "system",
        reason: CancellationOperationReason.request_expired,
        status: CancellationOperationStatus.completed,
        financialDisposition: CancellationFinancialDisposition.no_payment_collected,
        active: false
      })
    });
    expect(jobs.enqueue).toHaveBeenCalledTimes(2);
    for (const call of jobs.enqueue.mock.calls) {
      expect(JSON.stringify(call[1])).toMatch(
        /^\{"cancellationOperationId":"cancellation_1","recipientUserId":"(renter|host)_1","template":"booking_cancelled_no_payment"\}$/
      );
    }
  });

  it("completes an eligible paid booking at the exact grace boundary", async () => {
    const { service, transaction, jobs } = createService(
      paidBooking(PaymentStatus.paid)
    );

    await expect(service.completeBooking("booking_2", boundary))
      .resolves.toEqual({ completed: true, eligibilityAt: boundary });
    expect(transaction.booking.updateMany).toHaveBeenCalledWith({
      where: {
        id: "booking_2",
        status: BookingStatus.paid,
        completedAt: null
      },
      data: {
        status: BookingStatus.completed,
        completedAt: boundary,
        completionSource: BookingLifecycleSource.operations_scheduler
      }
    });
    expect(jobs.enqueue).toHaveBeenCalledTimes(2);
    expect(jobs.enqueue.mock.calls.map((call) => call[1])).toEqual([
      { bookingId: "booking_2", recipientUserId: "renter_1" },
      { bookingId: "booking_2", recipientUserId: "host_1" }
    ]);
  });

  it.each([
    [PaymentStatus.refunded, 20_000, "payment_not_fulfillable"],
    [PaymentStatus.disputed, 0, "payment_not_fulfillable"],
    [PaymentStatus.partially_refunded, 20_000, "payment_not_fulfillable"]
  ] as const)(
    "blocks completion for payment %s with refunded amount %s",
    async (status, refunded, reason) => {
      const { service, transaction, jobs } = createService(
        paidBooking(status, refunded)
      );
      await expect(service.completeBooking("booking_2", boundary))
        .resolves.toEqual({ completed: false, reason, eligibilityAt: boundary });
      expect(transaction.booking.updateMany).not.toHaveBeenCalled();
      expect(jobs.enqueue).not.toHaveBeenCalled();
    }
  );

  it("allows a settled partial refund that remains fulfillable", async () => {
    const { service } = createService(
      paidBooking(PaymentStatus.partially_refunded, 2_000)
    );
    await expect(service.completeBooking("booking_2", boundary))
      .resolves.toMatchObject({ completed: true });
  });
});
