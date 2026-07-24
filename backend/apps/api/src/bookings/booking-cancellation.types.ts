export const BOOKING_CANCELLATION_CHECKOUT_EXPIRY_JOB =
  "booking_cancellation_checkout_expiry";
export const BOOKING_CANCELLATION_FULL_REFUND_JOB =
  "booking_cancellation_full_refund";
export const BOOKING_CANCELLATION_EMAIL_JOB =
  "send_booking_cancellation_email";

export interface BookingCancellationOperationPayload {
  cancellationOperationId: string;
}

export interface BookingCancellationEmailPayload
  extends BookingCancellationOperationPayload {
  recipientUserId: string;
  template:
    | "booking_cancellation_pending"
    | "booking_cancelled_no_payment"
    | "booking_cancelled_refunded"
    | "booking_cancelled_financial_event";
}
