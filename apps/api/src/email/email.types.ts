export const EMAIL_QUEUE_NAME = "email";
export const SEND_TRANSACTIONAL_EMAIL_JOB = "send_transactional_email";

export type TransactionalEmailTemplate =
  | "booking_requested_host"
  | "booking_accepted_renter"
  | "booking_rejected_renter"
  | "booking_cancellation_pending"
  | "booking_cancelled_no_payment"
  | "booking_cancelled_refunded"
  | "booking_cancelled_financial_event"
  | "booking_completed"
  | "payment_succeeded_renter"
  | "payment_failed_renter"
  | "payment_expired_renter"
  | "payment_refunded_renter"
  | "payment_disputed_admin"
  | "host_transfer_failed_admin"
  | "host_transfer_reversal_failed_admin"
  | "identity_verification_submitted"
  | "identity_verification_approved"
  | "identity_verification_declined"
  | "identity_verification_resubmission"
  | "identity_verification_expired"
  | "inquiry_new_message";

export interface TransactionalEmailPayload {
  to: string;
  template: TransactionalEmailTemplate;
  subject: string;
  text: string;
  metadata?: Record<string, string>;
}
