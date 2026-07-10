import { ApiError, apiFetch } from "./client";
import type {
  CreatedListing,
  CreateListingInput,
  ListingPhotoRecord,
  PresignedUpload,
} from "./types";

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
export async function uploadFileToSignedUrl(uploadUrl: string, file: File) {
  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "content-type": file.type || "application/octet-stream",
        "x-upsert": "true",
      },
      body: file,
    });
  } catch {
    throw new ApiError(
      {
        code: "UPLOAD_NETWORK_ERROR",
        message: "Could not reach storage to upload the photo.",
      },
      0
    );
  }

  if (!response.ok) {
    throw new ApiError(
      {
        code: "UPLOAD_FAILED",
        message: `Storage rejected the upload (${response.status}).`,
      },
      response.status
    );
  }
}

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
