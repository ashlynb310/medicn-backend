import { apiFetch } from "./client";
import type {
  CreatedListing,
  CreateListingInput,
  ListingStatus,
  ListingSummary,
  PaginationMeta,
  PresignedUpload,
} from "./types";

export interface MyListingsParams {
  status?: ListingStatus;
  page?: number;
  limit?: number;
}

/**
 * GET /api/v1/listings/mine — the caller's own listings (host/admin), including
 * draft/pending/rejected/hidden/approved. Same summary shape + pagination meta
 * as search. Requires a bearer token.
 */
export async function listMyListings(
  params: MyListingsParams = {},
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data, meta } = await apiFetch<ListingSummary[], PaginationMeta>(
    "/listings/mine",
    {
      query: {
        status: params.status,
        page: params.page,
        limit: params.limit,
      },
      accessToken,
      signal,
    }
  );
  return { listings: data, meta };
}

// Host-only listing + photo endpoints. All require a Supabase bearer token;
// when omitted, apiFetch falls back to the ambient (logged-in) token.

/** POST /api/v1/listings — create a listing (host/admin role). Returns id + status. */
export async function createListing(
  input: CreateListingInput,
  accessToken?: string
) {
  const { data } = await apiFetch<CreatedListing>("/listings", {
    method: "POST",
    body: input,
    accessToken,
  });
  return data;
}

/**
 * POST /api/v1/uploads/presigned-url — get a signed storage upload URL and an
 * upload-intent id. After the storage PUT, call completeUpload(uploadIntentId)
 * (src/lib/api/uploads.ts) so the media processor can produce the ready photo.
 *
 * Note: POST /listings/:id/photos no longer registers a storagePath directly —
 * the backend returns MEDIA_PROCESSING_REQUIRED and publishes photos only
 * through the processor. Use the intent/complete flow instead.
 */
export async function createPresignedUpload(
  input: {
    purpose: "listing_photo";
    listingId: string;
    fileName: string;
    contentType: "image/jpeg" | "image/png" | "image/webp";
  },
  accessToken?: string
) {
  const { data } = await apiFetch<PresignedUpload>("/uploads/presigned-url", {
    method: "POST",
    body: input,
    accessToken,
  });
  return data;
}
