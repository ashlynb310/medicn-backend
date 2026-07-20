import { apiFetch } from "./client";
import type {
  CreatedListing,
  CreateListingInput,
  ListingPhotoRecord,
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

/** POST /api/v1/uploads/presigned-url — get a signed storage upload URL. */
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

/**
 * Uploads a file to the Supabase signed upload URL returned by
 * createPresignedUpload. The token is embedded in the URL, so no Authorization
 * header is sent. Throws ApiError on a non-2xx storage response.
 */
/** POST /api/v1/listings/:id/photos — register an uploaded photo's storagePath. */
export async function addListingPhoto(
  listingId: string,
  input: { storagePath: string; displayOrder?: number },
  accessToken?: string
) {
  const { data } = await apiFetch<ListingPhotoRecord>(
    `/listings/${encodeURIComponent(listingId)}/photos`,
    { method: "POST", body: input, accessToken }
  );
  return data;
}
