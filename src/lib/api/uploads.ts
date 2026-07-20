import { ApiError } from "./client";

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
