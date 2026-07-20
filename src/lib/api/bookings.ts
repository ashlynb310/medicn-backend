import { apiFetch } from "./client";
import type {
  Booking,
  BookingCancellationResult,
  BookingListMeta,
  CancellationRequestReason,
  CreateBookingInput,
} from "./types";

// All booking endpoints require a Supabase bearer token. When accessToken is
// omitted, apiFetch falls back to the ambient token set by the auth provider.

/** POST /api/v1/bookings — create a booking request (renter, verified email). */
export async function createBooking(
  input: CreateBookingInput,
  accessToken?: string
) {
  const { data } = await apiFetch<Booking>("/bookings", {
    method: "POST",
    body: input,
    accessToken,
  });
  return data;
}

/** GET /api/v1/bookings — bookings where the user is renter or host. */
export async function listBookings(accessToken?: string, signal?: AbortSignal) {
  const { data, meta } = await apiFetch<Booking[], BookingListMeta>(
    "/bookings",
    { accessToken, signal }
  );
  return { bookings: data, meta };
}

/** GET /api/v1/bookings/:id — a single booking the user may access. */
export async function getBooking(
  id: string,
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data } = await apiFetch<Booking>(
    `/bookings/${encodeURIComponent(id)}`,
    { accessToken, signal }
  );
  return data;
}

/**
 * PATCH /api/v1/bookings/:id/status — host/admin decision on a `requested`
 * booking. Body is exactly { status: "accepted" | "rejected" }. Returns the
 * updated booking DTO. Surfaces FORBIDDEN, NOT_FOUND, VALIDATION_ERROR, and
 * BOOKING_STATUS_NOT_ALLOWED via ApiError.
 */
export async function updateBookingStatus(
  id: string,
  status: "accepted" | "rejected",
  accessToken?: string
) {
  const { data } = await apiFetch<Booking>(
    `/bookings/${encodeURIComponent(id)}/status`,
    { method: "PATCH", body: { status }, accessToken }
  );
  return data;
}

/**
 * POST /api/v1/bookings/:id/cancel — request cancellation. The body is exactly
 * `{ reason }`; actor identity/type, amounts, and financial disposition come
 * from the backend, never the client.
 *
 * The backend REQUIRES an `Idempotency-Key` header and dedupes on
 * `(bookingId, idempotencyKey)`. Callers must generate ONE stable key per
 * logical cancellation attempt and reuse it when retrying that attempt, so a
 * retry never creates a second cancellation. Returns the booking id/status and
 * a safe cancellation summary (operation status + financial disposition).
 *
 * Surfaces BOOKING_CANCELLATION_NOT_ALLOWED, PAID_CANCELLATION_POLICY_UNAVAILABLE,
 * CANCELLATION_ALREADY_IN_PROGRESS, PAYMENT_STATE_CHANGED,
 * PAYMENT_PROVIDER_UNAVAILABLE, VALIDATION_ERROR, FORBIDDEN, NOT_FOUND, and
 * rate-limit errors via ApiError.
 */
export async function cancelBooking(
  id: string,
  reason: CancellationRequestReason,
  idempotencyKey: string,
  accessToken?: string
) {
  const { data } = await apiFetch<BookingCancellationResult>(
    `/bookings/${encodeURIComponent(id)}/cancel`,
    { method: "POST", body: { reason }, idempotencyKey, accessToken }
  );
  return data;
}
