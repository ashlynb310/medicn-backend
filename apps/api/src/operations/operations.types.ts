export const OPERATIONS_QUEUE_NAME = "operations";

export const OPERATION_JOB_NAMES = {
  stripeWebhookRetry: "stripe_webhook_retry",
  checkoutExpiry: "checkout_expiry",
  hostTransferRelease: "host_transfer_release",
  veriffWebhookRetry: "veriff_webhook_retry",
  mediaRecovery: "media_recovery",
  mediaCleanup: "media_cleanup",
  mapsRecovery: "maps_recovery",
  mapsRefresh: "maps_refresh",
  brevoWebhookRetry: "brevo_webhook_retry",
  staleRecovery: "stale_operational_recovery",
  bookingCancellationCheckoutExpiry: "booking_cancellation_checkout_expiry",
  bookingCancellationFullRefund: "booking_cancellation_full_refund",
  bookingCancellationRecovery: "booking_cancellation_recovery",
  requestedBookingExpiry: "requested_booking_expiry",
  bookingCompletion: "booking_completion",
  executeOperationalCommand: "execute_operational_command"
} as const;

export const OPERATION_SCHEDULES = [
  { schedulerId: "medicn:stripe-webhook-retry:v1", name: OPERATION_JOB_NAMES.stripeWebhookRetry, interval: "recovery" },
  { schedulerId: "medicn:checkout-expiry:v1", name: OPERATION_JOB_NAMES.checkoutExpiry, interval: "recovery" },
  { schedulerId: "medicn:host-transfer-release:v1", name: OPERATION_JOB_NAMES.hostTransferRelease, interval: "recovery" },
  { schedulerId: "medicn:veriff-webhook-retry:v1", name: OPERATION_JOB_NAMES.veriffWebhookRetry, interval: "recovery" },
  { schedulerId: "medicn:media-recovery:v1", name: OPERATION_JOB_NAMES.mediaRecovery, interval: "maintenance" },
  { schedulerId: "medicn:media-cleanup:v1", name: OPERATION_JOB_NAMES.mediaCleanup, interval: "maintenance" },
  { schedulerId: "medicn:maps-recovery:v1", name: OPERATION_JOB_NAMES.mapsRecovery, interval: "maintenance" },
  { schedulerId: "medicn:maps-refresh:v1", name: OPERATION_JOB_NAMES.mapsRefresh, interval: "maintenance" },
  { schedulerId: "medicn:brevo-webhook-retry:v1", name: OPERATION_JOB_NAMES.brevoWebhookRetry, interval: "recovery" },
  { schedulerId: "medicn:stale-operational-recovery:v1", name: OPERATION_JOB_NAMES.staleRecovery, interval: "recovery" },
  { schedulerId: "medicn:booking-cancellation-recovery:v1", name: OPERATION_JOB_NAMES.bookingCancellationRecovery, interval: "recovery" },
  { schedulerId: "medicn:requested-booking-expiry:v1", name: OPERATION_JOB_NAMES.requestedBookingExpiry, interval: "recovery" },
  { schedulerId: "medicn:booking-completion:v1", name: OPERATION_JOB_NAMES.bookingCompletion, interval: "recovery" }
] as const;

export type OperationJobName = typeof OPERATION_JOB_NAMES[keyof typeof OPERATION_JOB_NAMES];
