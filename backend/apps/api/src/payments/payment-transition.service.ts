import { Injectable } from "@nestjs/common";
import { BookingStatus, PaymentStatus } from "@prisma/client";

export type PaymentTransitionSource =
  | "provider_payment"
  | "provider_failure"
  | "provider_expiry"
  | "provider_refund"
  | "provider_dispute"
  | "dispute_won";

@Injectable()
export class PaymentTransitionService {
  canTransitionPayment(
    current: PaymentStatus,
    target: PaymentStatus,
    source: PaymentTransitionSource
  ) {
    if (current === target) {
      return false;
    }

    const allowed: Partial<Record<PaymentStatus, PaymentStatus[]>> = {
      [PaymentStatus.pending]: [
        PaymentStatus.paid,
        PaymentStatus.failed,
        PaymentStatus.expired
      ],
      [PaymentStatus.paid]: [
        PaymentStatus.partially_refunded,
        PaymentStatus.refunded,
        PaymentStatus.disputed
      ],
      [PaymentStatus.partially_refunded]: [
        PaymentStatus.refunded,
        PaymentStatus.disputed
      ],
      [PaymentStatus.failed]:
        source === "provider_payment" ? [PaymentStatus.paid] : [],
      [PaymentStatus.expired]:
        source === "provider_payment" ? [PaymentStatus.paid] : [],
      [PaymentStatus.disputed]:
        source === "dispute_won" ? [PaymentStatus.paid] : []
    };

    return allowed[current]?.includes(target) ?? false;
  }

  canTransitionBooking(current: BookingStatus, target: BookingStatus) {
    if (current === target) {
      return false;
    }

    const allowed: Partial<Record<BookingStatus, BookingStatus[]>> = {
      [BookingStatus.requested]: [BookingStatus.accepted, BookingStatus.rejected],
      [BookingStatus.accepted]: [
        BookingStatus.payment_pending,
        BookingStatus.cancelled
      ],
      [BookingStatus.payment_pending]: [
        BookingStatus.paid,
        BookingStatus.cancelled
      ],
      [BookingStatus.paid]: [BookingStatus.completed, BookingStatus.cancelled]
    };

    return allowed[current]?.includes(target) ?? false;
  }
}
