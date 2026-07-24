import { apiFetch } from "./client";
import type { BookingPaymentSummary, CheckoutSession } from "./types";

// Payment endpoints (see medicn PaymentsController / PaymentOperationsService).
// All require a Supabase bearer token; when accessToken is omitted, apiFetch
// uses the ambient token. Payment state is authoritative on the backend and is
// never inferred from booking status, URL, session_id, or frontend state.

/**
 * GET /api/v1/bookings/:id/payment-summary — participant/Admin-only safe
 * payment view: backend total, payment attempts, active attempt, refunded
 * amounts, checkout expiry, and (where present) the Host transfer-to-connected-
 * balance summary. No provider secrets, methods, or raw payloads. Unrelated or
 * missing bookings return opaque NOT_FOUND.
 */
export async function getBookingPaymentSummary(
  bookingId: string,
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data } = await apiFetch<BookingPaymentSummary>(
    `/bookings/${encodeURIComponent(bookingId)}/payment-summary`,
    { accessToken, signal }
  );
  return data;
}

/**
 * POST /api/v1/payments/checkout-session — create or reuse a Stripe Checkout
 * Session for a booking the caller owns as Renter. The body is exactly
 * `{ bookingId }`; the backend calculates all amounts. Returns the hosted
 * checkoutUrl (redirect target), the session id, and an ISO expiresAt.
 *
 * Surfaces EMAIL_NOT_VERIFIED, IDENTITY_VERIFICATION_* , HOST_PAYOUT_ACCOUNT_NOT_READY,
 * CONNECT_ONBOARDING_REQUIRED, CONNECT_NOT_CONFIGURED, BOOKING_NOT_AVAILABLE,
 * PAYMENT_PROVIDER_UNAVAILABLE, and rate-limit errors via ApiError.
 */
export async function createCheckoutSession(
  bookingId: string,
  accessToken?: string
) {
  const { data } = await apiFetch<CheckoutSession>(
    "/payments/checkout-session",
    { method: "POST", body: { bookingId }, accessToken }
  );
  return data;
}
