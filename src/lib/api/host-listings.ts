import { apiFetch } from "./client";
import type {
  ArchivedListing,
  CreatedListing,
  CreateListingInput,
  DeletedListingPhoto,
  ListingDetail,
  ListingStatus,
  ListingSummary,
  PaginationMeta,
  PresignedUpload,
  ReorderedListingPhoto,
  UpdateListingInput,
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
 * PATCH /api/v1/listings/:id — update owner listing fields. Returns the owner
 * listing detail projection (with exactLocation). Does NOT accept bulk
 * availability (rejected with AVAILABILITY_DEDICATED_ENDPOINT_REQUIRED) or
 * latitude/longitude. Surfaces NOT_FOUND, FORBIDDEN, VALIDATION_ERROR,
 * LISTING_LOCATION_* and LISTING_STATUS_NOT_ALLOWED via ApiError.
 */
export async function updateListing(
  id: string,
  input: UpdateListingInput,
  accessToken?: string
) {
  const { data } = await apiFetch<ListingDetail>(
    `/listings/${encodeURIComponent(id)}`,
    { method: "PATCH", body: input, accessToken }
  );
  return data;
}

/**
 * DELETE /api/v1/listings/:id — archive (soft-delete) an owned listing. The
 * backend blocks archive with LISTING_ARCHIVE_BLOCKED_BY_ACTIVE_BOOKINGS when
 * active booking obligations exist.
 */
export async function archiveListing(id: string, accessToken?: string) {
  const { data } = await apiFetch<ArchivedListing>(
    `/listings/${encodeURIComponent(id)}`,
    { method: "DELETE", accessToken }
  );
  return data;
}

/** DELETE /api/v1/listings/:listingId/photos/:photoId — remove a listing photo. */
export async function deleteListingPhoto(
  listingId: string,
  photoId: string,
  accessToken?: string
) {
  const { data } = await apiFetch<DeletedListingPhoto>(
    `/listings/${encodeURIComponent(listingId)}/photos/${encodeURIComponent(
      photoId
    )}`,
    { method: "DELETE", accessToken }
  );
  return data;
}

/**
 * PATCH /api/v1/listings/:listingId/photos/:photoId/order — set a photo's
 * display order (0..10000).
 */
export async function reorderListingPhoto(
  listingId: string,
  photoId: string,
  displayOrder: number,
  accessToken?: string
) {
  const { data } = await apiFetch<ReorderedListingPhoto>(
    `/listings/${encodeURIComponent(listingId)}/photos/${encodeURIComponent(
      photoId
    )}/order`,
    { method: "PATCH", body: { displayOrder }, accessToken }
  );
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
