import type {
  Booking,
  BookingPaymentSummary,
  BookingStatus,
  PaymentAttempt,
} from "@/lib/api/types";

// Presentation-only helpers for the booking lifecycle. All decisions about the
// authoritative state come from the backend Booking/payment-summary; this module
// only maps those real fields to labels/tones.

export type LifecycleTone = "neutral" | "info" | "warning" | "success" | "danger";

export interface LifecycleDescriptor {
  key: string;
  label: string;
  tone: LifecycleTone;
  detail: string;
}

// Cancellation operation statuses that mean work is still in flight.
const CANCELLATION_PROCESSING = new Set([
  "requested",
  "checkout_expiry_pending",
  "refund_pending",
  "transfer_reversal_pending",
  "failed_retryable",
]);

export function isCancellationProcessing(booking: Booking): boolean {
  const op = booking.cancellation;
  if (!op) return false;
  return CANCELLATION_PROCESSING.has(op.status);
}

/** A requested booking that was auto-cancelled at its 24h expiry. */
export function isExpiredRequest(booking: Booking): boolean {
  return booking.status === "cancelled" && booking.expiredAt !== null;
}

/**
 * Maps a booking (and optional payment summary) to a single top-line lifecycle
 * descriptor. Uses only backend fields — never infers "paid" from a URL/redirect.
 */
export function describeBookingLifecycle(
  booking: Booking,
  timeZone: string
): LifecycleDescriptor {
  const when = (iso: string | null) =>
    iso ? formatInstantInZone(iso, timeZone) : "";

  if (isCancellationProcessing(booking)) {
    return {
      key: "cancellation_processing",
      label: "Cancellation processing",
      tone: "warning",
      detail:
        "A cancellation is being processed. The final outcome is confirmed by the backend.",
    };
  }

  switch (booking.status) {
    case "requested":
      return {
        key: "requested",
        label: "Requested",
        tone: "info",
        detail: booking.requestExpiresAt
          ? `Waiting for the host to respond. This request expires ${when(
              booking.requestExpiresAt
            )}.`
          : "Waiting for the host to respond.",
      };
    case "accepted":
      return {
        key: "accepted",
        label: "Accepted",
        tone: "info",
        detail: "The host accepted your request. Continue to payment to confirm.",
      };
    case "payment_pending":
      return {
        key: "payment_pending",
        label: "Payment pending",
        tone: "warning",
        detail: "Payment is pending. Complete checkout to confirm your stay.",
      };
    case "paid":
      return {
        key: "paid",
        label: "Paid",
        tone: "success",
        detail: "Payment confirmed by the backend. Your stay is booked.",
      };
    case "completed":
      return {
        key: "completed",
        label: "Completed",
        tone: "neutral",
        detail: booking.completedAt
          ? `This stay completed ${when(booking.completedAt)}.`
          : "This stay is complete.",
      };
    case "rejected":
      return {
        key: "rejected",
        label: "Rejected",
        tone: "danger",
        detail: "The host declined this request.",
      };
    case "cancelled":
      if (isExpiredRequest(booking)) {
        return {
          key: "expired",
          label: "Request expired",
          tone: "neutral",
          detail: booking.expiredAt
            ? `This request expired unanswered ${when(booking.expiredAt)}.`
            : "This request expired before the host responded.",
        };
      }
      return {
        key: "cancelled",
        label: "Cancelled",
        tone: "neutral",
        detail: booking.cancelledAt
          ? `This booking was cancelled ${when(booking.cancelledAt)}.`
          : "This booking was cancelled.",
      };
    default:
      return {
        key: booking.status,
        label: booking.status,
        tone: "neutral",
        detail: "",
      };
  }
}

/**
 * Formats an ISO instant in the given IANA timezone (listing-local). Used for
 * lifecycle timestamps and checkout time, which are wall-clock-in-listing-zone.
 */
export function formatInstantInZone(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }
}

// Whether the backend booking state currently allows a Renter to start checkout.
export function canRenterCheckout(booking: Booking): boolean {
  return booking.status === "accepted" || booking.status === "payment_pending";
}

// --- Checkout-return payment-state derivation (pure, tested) ---

export type DerivedPaymentState =
  | "confirming"
  | "paid"
  | "failed"
  | "expired"
  | "refunded"
  | "partially_refunded"
  | "disputed"
  | "cancelled"
  | "rejected";

/**
 * Selects the payment attempt that represents the booking's current payment.
 * Prefers the ACTIVE attempt; if none is active, the highest attemptNumber (the
 * most recent) — never `payments[0]` by array position.
 */
export function selectPaymentAttempt(
  payments: PaymentAttempt[]
): PaymentAttempt | null {
  if (!payments || payments.length === 0) return null;
  const byLatest = (a: PaymentAttempt, b: PaymentAttempt) =>
    b.attemptNumber > a.attemptNumber ? b : a;
  const active = payments.filter((p) => p.active);
  if (active.length > 0) return active.reduce(byLatest);
  return payments.reduce(byLatest);
}

// Adverse payment states must win over a booking that reads paid/completed — a
// later dispute or refund must never be masked by the booking lifecycle status.
const ADVERSE_PAYMENT: Record<string, DerivedPaymentState> = {
  disputed: "disputed",
  refunded: "refunded",
  partially_refunded: "partially_refunded",
  failed: "failed",
  expired: "expired",
};

/**
 * Derives the authoritative checkout-return display state from the backend
 * booking + payment summary. Never infers "paid" from a redirect/session_id.
 */
export function deriveCheckoutState(
  booking: Booking,
  summary: BookingPaymentSummary | null
): DerivedPaymentState {
  const attempt = summary ? selectPaymentAttempt(summary.payments) : null;
  if (attempt && ADVERSE_PAYMENT[attempt.status]) {
    return ADVERSE_PAYMENT[attempt.status];
  }
  // Only report confirmed payment from authoritative booking lifecycle status.
  if (booking.status === "paid" || booking.status === "completed") return "paid";
  if (booking.status === "cancelled") return "cancelled";
  if (booking.status === "rejected") return "rejected";
  return "confirming";
}

/**
 * Bounded success polling continues only while payment is still confirming AND
 * the booking is in an actively-resolving state (accepted or payment_pending).
 * It must NOT stop merely because the booking is temporarily still `accepted`.
 */
export function shouldContinueCheckoutPolling(
  booking: Booking,
  derived: DerivedPaymentState
): boolean {
  return (
    derived === "confirming" &&
    (booking.status === "accepted" || booking.status === "payment_pending")
  );
}

// --- Cancellation eligibility (pure, tested) ---

/**
 * Whether to OFFER the cancellation control to this viewer. Backend authorization
 * remains authoritative; this only decides UI visibility.
 * - Admin/other viewers (neither renter nor host) never inherit renter/host controls.
 * - Hidden for terminal bookings (rejected/cancelled/completed).
 * - Hosts use Reject (not cancel) for a still-`requested` booking.
 * - Paid-Renter self-service cancellation is policy-blocked, so it is hidden;
 *   a race (state flips to paid after opening) is still surfaced by the backend
 *   PAID_CANCELLATION_POLICY_UNAVAILABLE error.
 */
export function canOfferCancellation(opts: {
  status: BookingStatus;
  isRenter: boolean;
  isHost: boolean;
  processing: boolean;
}): boolean {
  const { status, isRenter, isHost, processing } = opts;
  if (!isRenter && !isHost) return false;
  if (processing) return false;
  if (status === "rejected" || status === "cancelled" || status === "completed") {
    return false;
  }
  if (isHost && status === "requested") return false;
  if (isRenter && status === "paid") return false;
  return true;
}
