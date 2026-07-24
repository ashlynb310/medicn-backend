import { apiFetch } from "./client";
import type {
  AvailabilityListMeta,
  HostListingCalendar,
  ListingAvailabilityStatus,
  ListingAvailabilityWindow,
} from "./types";

// Host availability endpoints (see medicn ListingAvailabilityService). All
// require the listing Host or an Admin bearer token; when accessToken is
// omitted, apiFetch uses the ambient token. Missing/unrelated/archived
// listings and windows return opaque NOT_FOUND.

/**
 * GET /api/v1/listings/:id/availability?page&limit — paginated Host-managed
 * windows. Meta is { page, limit, total } (no totalPages). limit ≤100.
 */
export async function listAvailabilityWindows(
  listingId: string,
  params: { page?: number; limit?: number } = {},
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data, meta } = await apiFetch<
    ListingAvailabilityWindow[],
    AvailabilityListMeta
  >(`/listings/${encodeURIComponent(listingId)}/availability`, {
    query: { page: params.page, limit: params.limit },
    accessToken,
    signal,
  });
  return { windows: data, meta };
}

/**
 * POST /api/v1/listings/:id/availability — create one available/blocked window.
 * Dates are half-open civil dates [startDate, endDate). Surfaces
 * AVAILABILITY_RANGE_INVALID and AVAILABILITY_CONFLICTS_WITH_RESERVATION.
 */
export async function createAvailabilityWindow(
  listingId: string,
  input: { startDate: string; endDate: string; status: ListingAvailabilityStatus },
  accessToken?: string
) {
  const { data } = await apiFetch<ListingAvailabilityWindow>(
    `/listings/${encodeURIComponent(listingId)}/availability`,
    { method: "POST", body: input, accessToken }
  );
  return data;
}

/** PATCH /api/v1/listings/:id/availability/:windowId — change a window. */
export async function updateAvailabilityWindow(
  listingId: string,
  windowId: string,
  input: {
    startDate?: string;
    endDate?: string;
    status?: ListingAvailabilityStatus;
  },
  accessToken?: string
) {
  const { data } = await apiFetch<ListingAvailabilityWindow>(
    `/listings/${encodeURIComponent(listingId)}/availability/${encodeURIComponent(
      windowId
    )}`,
    { method: "PATCH", body: input, accessToken }
  );
  return data;
}

/** DELETE /api/v1/listings/:id/availability/:windowId — remove a window. */
export async function deleteAvailabilityWindow(
  listingId: string,
  windowId: string,
  accessToken?: string
) {
  const { data } = await apiFetch<{ id: string; deleted: boolean }>(
    `/listings/${encodeURIComponent(listingId)}/availability/${encodeURIComponent(
      windowId
    )}`,
    { method: "DELETE", accessToken }
  );
  return data;
}

/**
 * GET /api/v1/listings/:id/availability/calendar?startDate&endDate — bounded
 * (≤366 day) owner projection: Host windows plus merged opaque `reserved`
 * ranges. Surfaces CALENDAR_RANGE_TOO_LARGE and AVAILABILITY_RANGE_INVALID.
 */
export async function getHostListingCalendar(
  listingId: string,
  range: { startDate: string; endDate: string },
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data } = await apiFetch<HostListingCalendar>(
    `/listings/${encodeURIComponent(listingId)}/availability/calendar`,
    {
      query: { startDate: range.startDate, endDate: range.endDate },
      accessToken,
      signal,
    }
  );
  return data;
}
