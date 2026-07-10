import { apiFetch } from "./client";
import type {
  Booking,
  BookingListMeta,
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
