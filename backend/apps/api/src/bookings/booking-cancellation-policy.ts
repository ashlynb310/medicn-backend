import {
  BookingCancellationReason,
  BookingStatus,
  PaymentStatus
} from "@prisma/client";

export type CancellationRequestActor = "renter" | "host" | "admin";
export type CancellationPlanKind =
  | "existing"
  | "immediate"
  | "checkout_expiry"
  | "full_refund";

export class CancellationPolicyError extends Error {
  constructor(
    readonly code:
      | "PAID_CANCELLATION_POLICY_UNAVAILABLE"
      | "BOOKING_CANCELLATION_NOT_ALLOWED"
      | "PAYMENT_STATE_CHANGED"
  ) {
    super(code);
  }
}

export function decideCancellationPlan(input: {
  actorType: CancellationRequestActor;
  bookingStatus: BookingStatus;
  payment: { status: PaymentStatus } | null;
  futureStay?: boolean;
}): { kind: CancellationPlanKind; bookingReason: BookingCancellationReason } {
  const bookingReason = BookingCancellationReason[`${input.actorType}_cancelled`];

  if (input.bookingStatus === BookingStatus.cancelled) {
    return { kind: "existing", bookingReason };
  }
  if (
    input.bookingStatus === BookingStatus.completed ||
    input.bookingStatus === BookingStatus.rejected ||
    (input.bookingStatus === BookingStatus.requested && input.actorType === "host")
  ) {
    throw new CancellationPolicyError("BOOKING_CANCELLATION_NOT_ALLOWED");
  }

  const paymentStatus = input.payment?.status;
  const settled =
    paymentStatus === PaymentStatus.paid ||
    paymentStatus === PaymentStatus.partially_refunded;
  const definitivelyUnpaid =
    paymentStatus === PaymentStatus.failed ||
    paymentStatus === PaymentStatus.expired;

  if (
    input.bookingStatus === BookingStatus.requested ||
    input.bookingStatus === BookingStatus.accepted
  ) {
    if (!input.payment || definitivelyUnpaid) {
      return { kind: "immediate", bookingReason };
    }
    if (paymentStatus === PaymentStatus.pending) {
      return { kind: "checkout_expiry", bookingReason };
    }
    if (settled) {
      if (input.actorType === "renter") {
        throw new CancellationPolicyError(
          "PAID_CANCELLATION_POLICY_UNAVAILABLE"
        );
      }
      return { kind: "full_refund", bookingReason };
    }
    throw new CancellationPolicyError("PAYMENT_STATE_CHANGED");
  }

  if (input.bookingStatus === BookingStatus.payment_pending) {
    if (definitivelyUnpaid) return { kind: "immediate", bookingReason };
    if (paymentStatus === PaymentStatus.pending) {
      return { kind: "checkout_expiry", bookingReason };
    }
    if (settled) {
      if (input.actorType === "renter") {
        throw new CancellationPolicyError(
          "PAID_CANCELLATION_POLICY_UNAVAILABLE"
        );
      }
      return { kind: "full_refund", bookingReason };
    }
    throw new CancellationPolicyError("PAYMENT_STATE_CHANGED");
  }

  if (input.bookingStatus === BookingStatus.paid) {
    if (!settled) throw new CancellationPolicyError("PAYMENT_STATE_CHANGED");
    if (input.actorType === "renter") {
      throw new CancellationPolicyError("PAID_CANCELLATION_POLICY_UNAVAILABLE");
    }
    if (input.futureStay === false) {
      throw new CancellationPolicyError("BOOKING_CANCELLATION_NOT_ALLOWED");
    }
    return { kind: "full_refund", bookingReason };
  }

  throw new CancellationPolicyError("BOOKING_CANCELLATION_NOT_ALLOWED");
}
