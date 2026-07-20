import { BookingStatus, PaymentStatus } from "@prisma/client";
import {
  CancellationPolicyError,
  decideCancellationPlan
} from "../src/bookings/booking-cancellation-policy";

describe("booking cancellation policy", () => {
  function expectPolicyError(action: () => unknown, code: string) {
    try {
      action();
      throw new Error("Expected cancellation policy to reject the transition.");
    } catch (error) {
      expect(error).toBeInstanceOf(CancellationPolicyError);
      expect(error).toMatchObject({ code });
    }
  }

  it.each([
    ["renter", BookingStatus.requested],
    ["admin", BookingStatus.requested],
    ["renter", BookingStatus.accepted],
    ["host", BookingStatus.accepted],
    ["admin", BookingStatus.accepted]
  ] as const)("immediately cancels unpaid %s %s bookings", (actorType, status) => {
    expect(decideCancellationPlan({ actorType, bookingStatus: status, payment: null }))
      .toEqual({ kind: "immediate", bookingReason: `${actorType}_cancelled` });
  });

  it("keeps Host rejection as the requested-booking command", () => {
    expectPolicyError(() =>
      decideCancellationPlan({
        actorType: "host",
        bookingStatus: BookingStatus.requested,
        payment: null
      }), "BOOKING_CANCELLATION_NOT_ALLOWED");
  });

  it.each(["renter", "host", "admin"] as const)(
    "queues Checkout expiry for unsettled payment_pending %s cancellation",
    (actorType) => {
      expect(
        decideCancellationPlan({
          actorType,
          bookingStatus: BookingStatus.payment_pending,
          payment: { status: PaymentStatus.pending }
        })
      ).toEqual({ kind: "checkout_expiry", bookingReason: `${actorType}_cancelled` });
    }
  );

  it("rejects a paid Renter without inventing a refund policy", () => {
    expectPolicyError(() =>
      decideCancellationPlan({
        actorType: "renter",
        bookingStatus: BookingStatus.paid,
        payment: { status: PaymentStatus.paid }
      }), "PAID_CANCELLATION_POLICY_UNAVAILABLE");
  });

  it.each(["host", "admin"] as const)(
    "queues a full refund for paid future-stay %s cancellation",
    (actorType) => {
      expect(
        decideCancellationPlan({
          actorType,
          bookingStatus: BookingStatus.paid,
          payment: { status: PaymentStatus.partially_refunded }
        })
      ).toEqual({ kind: "full_refund", bookingReason: `${actorType}_cancelled` });
    }
  );

  it.each([BookingStatus.completed, BookingStatus.rejected] as const)(
    "rejects terminal %s bookings",
    (bookingStatus) => {
      expectPolicyError(() =>
        decideCancellationPlan({ actorType: "admin", bookingStatus, payment: null })
      , "BOOKING_CANCELLATION_NOT_ALLOWED");
    }
  );

  it("returns cancelled bookings idempotently", () => {
    expect(
      decideCancellationPlan({
        actorType: "renter",
        bookingStatus: BookingStatus.cancelled,
        payment: null
      })
    ).toEqual({ kind: "existing", bookingReason: "renter_cancelled" });
  });

  it("fails closed when payment state and booking state disagree", () => {
    expectPolicyError(() =>
      decideCancellationPlan({
        actorType: "host",
        bookingStatus: BookingStatus.payment_pending,
        payment: { status: PaymentStatus.refunded }
      }), "PAYMENT_STATE_CHANGED");
  });

  it.each([PaymentStatus.failed, PaymentStatus.expired] as const)(
    "treats an authoritative %s attempt as no payment collected",
    (status) => {
      expect(
        decideCancellationPlan({
          actorType: "renter",
          bookingStatus: BookingStatus.accepted,
          payment: { status }
        })
      ).toEqual({ kind: "immediate", bookingReason: "renter_cancelled" });
    }
  );
});
