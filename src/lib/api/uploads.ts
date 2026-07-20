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

// Media processing is asynchronous. These are the states after which no more
// work happens, so polling must stop.
const TERMINAL_UPLOAD_STATUSES: UploadAsset["status"][] = [
  "ready",
  "rejected",
  "deleted",
];

export function isTerminalUploadStatus(status: UploadAsset["status"]) {
  return TERMINAL_UPLOAD_STATUSES.includes(status);
}

/** Rejects with an AbortError if the signal fires while waiting. */
function abortableDelay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Polls GET /uploads/:intentId with bounded exponential backoff until the asset
 * reaches a terminal status (ready/rejected/deleted), the overall timeout
 * elapses, or the AbortSignal fires (unmount/navigation). Each status is passed
 * to onUpdate. Returns the last observed asset; callers that get a non-terminal
 * status back should treat it as "still processing" rather than success.
 */
export async function pollUploadUntilTerminal(
  intentId: string,
  options: {
    accessToken?: string;
    signal?: AbortSignal;
    onUpdate?: (asset: UploadAsset) => void;
    timeoutMs?: number;
    initialIntervalMs?: number;
    maxIntervalMs?: number;
  } = {}
) {
  const {
    accessToken,
    signal,
    onUpdate,
    timeoutMs = 90_000,
    initialIntervalMs = 1_000,
    maxIntervalMs = 5_000,
  } = options;

  const startedAt = Date.now();
  let interval = initialIntervalMs;
  let asset = await getUploadStatus(intentId, accessToken, signal);
  onUpdate?.(asset);

  while (!isTerminalUploadStatus(asset.status)) {
    if (Date.now() - startedAt >= timeoutMs) {
      return asset;
    }
    await abortableDelay(interval, signal);
    interval = Math.min(interval * 2, maxIntervalMs);
    asset = await getUploadStatus(intentId, accessToken, signal);
    onUpdate?.(asset);
  }
  return asset;
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
