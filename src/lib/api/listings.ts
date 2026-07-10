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

export async function getListing(id: string, signal?: AbortSignal) {
  const { data } = await apiFetch<ListingDetail>(
    `/listings/${encodeURIComponent(id)}`,
    { signal }
  );

  return data;
}
