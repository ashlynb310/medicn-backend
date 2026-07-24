import { apiFetch } from "./client";
import type {
  ListingDetail,
  ListingSummary,
  PaginationMeta,
  PublicListingCalendar,
  SearchListingsParams,
} from "./types";

export async function searchListings(
  params: SearchListingsParams = {},
  signal?: AbortSignal
) {
  const { data, meta } = await apiFetch<ListingSummary[], PaginationMeta>(
    "/listings",
    { query: { ...params }, signal }
  );

  return { listings: data, meta };
}

// When accessToken is omitted, apiFetch falls back to the ambient token set by
// the auth provider — so client-side calls by a logged-in user automatically
// send Authorization, letting an owner view their own pre-approval listing.
// Server-side (SSR) calls have no ambient token and therefore see only public
// (approved) listings, which is the intended behavior.
export async function getListing(
  id: string,
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data } = await apiFetch<ListingDetail>(
    `/listings/${encodeURIComponent(id)}`,
    { accessToken, signal }
  );

  return data;
}

/**
 * GET /api/v1/listings/:id/calendar — public unavailable-date ranges for an
 * approved listing within [startDate, endDate). The backend never reveals
 * whether a date is Host-blocked or reserved. Range must be ≤366 days.
 */
export async function getPublicListingCalendar(
  id: string,
  range: { startDate: string; endDate: string },
  signal?: AbortSignal
) {
  const { data } = await apiFetch<PublicListingCalendar>(
    `/listings/${encodeURIComponent(id)}/calendar`,
    { query: { startDate: range.startDate, endDate: range.endDate }, signal }
  );
  return data;
}
