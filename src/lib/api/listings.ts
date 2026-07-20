import { apiFetch } from "./client";
import type {
  ListingDetail,
  ListingSummary,
  PaginationMeta,
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
