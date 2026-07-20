import { ApiError, apiFetch } from "./client";
import type { UploadAsset } from "./types";

/**
 * POST /uploads/:intentId/complete — after the storage PUT succeeds, tells the
 * backend the object is uploaded so the media processor can run. A successful
 * PUT means "uploaded", not "ready"; the returned asset status advances to
 * `ready` (renderable derivatives) or `rejected` asynchronously.
 */
export async function completeUpload(intentId: string, accessToken?: string) {
  const { data } = await apiFetch<UploadAsset>(
    `/uploads/${encodeURIComponent(intentId)}/complete`,
    { method: "POST", accessToken }
  );
  return data;
}

/** GET /uploads/:intentId — poll the processing status of an upload intent. */
export async function getUploadStatus(
  intentId: string,
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data } = await apiFetch<UploadAsset>(
    `/uploads/${encodeURIComponent(intentId)}`,
    { accessToken, signal }
  );
  return data;
}

/** DELETE /uploads/:assetId — remove an upload asset the caller owns. */
export async function deleteUpload(assetId: string, accessToken?: string) {
  const { data } = await apiFetch<{ id: string | null; status: string }>(
    `/uploads/${encodeURIComponent(assetId)}`,
    { method: "DELETE", accessToken }
  );
  return data;
}

/**
 * Uploads directly to a short-lived Supabase Storage URL. The capability token
 * is embedded in the URL, so the browser must not attach its bearer token.
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
