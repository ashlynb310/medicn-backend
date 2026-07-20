"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  ImageOff,
  Loader2,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";
import {
  createPresignedUpload,
  deleteListingPhoto,
  reorderListingPhoto,
} from "@/lib/api/host-listings";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import {
  completeUpload,
  pollUploadUntilTerminal,
  uploadFileToSignedUrl,
} from "@/lib/api/uploads";
import type { ListingPhoto, UploadAsset } from "@/lib/api/types";

const ALLOWED = ["image/jpeg", "image/png", "image/webp"] as const;
type AllowedType = (typeof ALLOWED)[number];

function isAllowed(type: string): type is AllowedType {
  return (ALLOWED as readonly string[]).includes(type);
}

function isHttpUrl(url: string | undefined | null): url is string {
  return !!url && (url.startsWith("https://") || url.startsWith("http://"));
}

// A pending, in-flight upload. Its `asset` is set once complete/poll returns.
interface PendingUpload {
  key: string;
  fileName: string;
  phase: "uploading" | "processing" | "ready" | "rejected" | "failed";
  asset: UploadAsset | null;
  message: string | null;
}

// Prefer the largest ready derivative for display; only backend variant URLs are
// ever rendered — never a local object URL.
function pickVariantUrl(asset: UploadAsset | null): string | null {
  if (!asset || asset.status !== "ready" || asset.variants.length === 0) {
    return null;
  }
  const sorted = [...asset.variants].sort(
    (a, b) => (b.width ?? 0) - (a.width ?? 0)
  );
  return sorted[0]?.url ?? null;
}

// Full listing-photo management with the backend media pipeline:
//   presigned intent -> storage PUT -> complete -> poll until terminal.
// Persisted (ready) photos support delete and reorder. Processing/rejected
// states are shown honestly; a rejected upload can be retried. Polling stops on
// terminal status, timeout, and unmount/navigation (shared AbortController).
export default function ListingPhotoManager({
  listingId,
  initialPhotos,
  onPhotosChanged,
}: {
  listingId: string;
  initialPhotos: ListingPhoto[];
  onPhotosChanged?: () => void | Promise<void>;
}) {
  const { accessToken } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyPhotoId, setBusyPhotoId] = useState<string | null>(null);

  // Persisted photos are owned by the parent (from the listing detail); mirror
  // them locally and keep them sorted by displayOrder.
  const photos = [...initialPhotos].sort(
    (a, b) => a.displayOrder - b.displayOrder
  );

  useEffect(() => {
    abortRef.current = new AbortController();
    return () => abortRef.current?.abort();
  }, []);

  const setPhase = (key: string, patch: Partial<PendingUpload>) => {
    setPending((prev) =>
      prev.map((item) => (item.key === key ? { ...item, ...patch } : item))
    );
  };

  const handleFile = async (file: File) => {
    setError(null);
    if (!isAllowed(file.type)) {
      setError("Choose a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      // Usability guard only; the backend pipeline is authoritative.
      setError("Choose an image smaller than 5 MB.");
      return;
    }
    const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setPending((prev) => [
      ...prev,
      { key, fileName: file.name, phase: "uploading", asset: null, message: null },
    ]);
    setUploading(true);
    try {
      const token = accessToken ?? undefined;
      const presigned = await createPresignedUpload(
        {
          purpose: "listing_photo",
          listingId,
          fileName: file.name,
          contentType: file.type,
        },
        token
      );
      await uploadFileToSignedUrl(presigned.uploadUrl, file);
      setPhase(key, { phase: "processing" });
      await completeUpload(presigned.uploadIntentId, token);
      const asset = await pollUploadUntilTerminal(presigned.uploadIntentId, {
        accessToken: token,
        signal: abortRef.current?.signal,
        onUpdate: (next) =>
          setPhase(key, {
            asset: next,
            phase:
              next.status === "ready"
                ? "ready"
                : next.status === "rejected" || next.status === "deleted"
                  ? "rejected"
                  : "processing",
          }),
      });
      if (asset.status === "ready") {
        setPhase(key, { phase: "ready", asset });
        if (onPhotosChanged) {
          await onPhotosChanged();
          // Parent reload now includes this photo; drop the pending tile.
          setPending((prev) => prev.filter((item) => item.key !== key));
        }
      } else if (asset.status === "rejected" || asset.status === "deleted") {
        setPhase(key, {
          phase: "rejected",
          asset,
          message: asset.rejectionCode,
        });
      } else {
        // Timed out still processing — keep an honest processing state.
        setPhase(key, { phase: "processing", asset });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return; // unmounted/navigated away
      }
      setPhase(key, {
        phase: "failed",
        message: err instanceof ApiError ? err.message : toErrorMessage(err),
      });
    } finally {
      setUploading(false);
    }
  };

  const retry = (key: string) => {
    setPending((prev) => prev.filter((item) => item.key !== key));
    inputRef.current?.click();
  };

  const removePhoto = async (photoId: string) => {
    setError(null);
    setBusyPhotoId(photoId);
    try {
      await deleteListingPhoto(listingId, photoId, accessToken ?? undefined);
      await onPhotosChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : toErrorMessage(err));
    } finally {
      setBusyPhotoId(null);
    }
  };

  const movePhoto = async (index: number, direction: -1 | 1) => {
    const target = photos[index + direction];
    const current = photos[index];
    if (!target || !current) return;
    setError(null);
    setBusyPhotoId(current.id);
    try {
      await reorderListingPhoto(
        listingId,
        current.id,
        target.displayOrder,
        accessToken ?? undefined
      );
      await onPhotosChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : toErrorMessage(err));
    } finally {
      setBusyPhotoId(null);
    }
  };

  const canManage = Boolean(onPhotosChanged);

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED.join(",")}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleFile(file);
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          <Upload aria-hidden="true" />
          {uploading ? "Uploading…" : "Upload photo"}
        </Button>
        <span className="text-sm text-slate-500">JPEG, PNG, or WebP, up to 5 MB.</span>
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-red-600">
          {error}
        </p>
      )}

      {/* Persisted, ready photos with delete/reorder (management context). */}
      {photos.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((photo, index) => (
            <li
              key={photo.id}
              className="flex flex-col gap-1 overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
            >
              {isHttpUrl(photo.fileUrl) ? (
                // eslint-disable-next-line @next/next/no-img-element -- backend storage host is env-dependent
                <img
                  src={photo.fileUrl}
                  alt="Listing photo"
                  className="h-28 w-full object-cover"
                />
              ) : (
                <div className="flex h-28 w-full items-center justify-center text-slate-400">
                  <ImageOff className="size-6" aria-hidden="true" />
                </div>
              )}
              {canManage && (
                <div className="flex items-center justify-between gap-1 px-1 pb-1">
                  <div className="flex gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={index === 0 || busyPhotoId !== null}
                      onClick={() => movePhoto(index, -1)}
                      aria-label="Move photo earlier"
                    >
                      <ArrowUp className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={index === photos.length - 1 || busyPhotoId !== null}
                      onClick={() => movePhoto(index, 1)}
                      aria-label="Move photo later"
                    >
                      <ArrowDown className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={busyPhotoId !== null}
                    onClick={() => removePhoto(photo.id)}
                    aria-label="Delete photo"
                  >
                    <Trash2 className="size-4 text-red-600" aria-hidden="true" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* In-flight uploads and their processing states. */}
      {pending.length > 0 && (
        <ul className="flex flex-col gap-2">
          {pending.map((item) => {
            const readyUrl = pickVariantUrl(item.asset);
            return (
              <li
                key={item.key}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {item.phase === "ready" && isHttpUrl(readyUrl) ? (
                    // eslint-disable-next-line @next/next/no-img-element -- backend storage host is env-dependent
                    <img
                      src={readyUrl}
                      alt="Uploaded listing photo"
                      className="size-8 rounded object-cover"
                    />
                  ) : null}
                  <span className="truncate font-medium text-slate-800">
                    {item.fileName}
                  </span>
                </span>
                {item.phase === "ready" ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                    Ready
                  </span>
                ) : item.phase === "rejected" ? (
                  <span className="flex items-center gap-2">
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                      {item.message ? `Rejected (${item.message})` : "Rejected"}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => retry(item.key)}
                    >
                      <RotateCcw className="size-3.5" aria-hidden="true" />
                      Retry
                    </Button>
                  </span>
                ) : item.phase === "failed" ? (
                  <span className="flex items-center gap-2">
                    <span className="flex items-center gap-1 text-xs font-medium text-red-700">
                      <CircleAlert className="size-3.5" aria-hidden="true" />
                      {item.message ?? "Upload failed"}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => retry(item.key)}
                    >
                      <RotateCcw className="size-3.5" aria-hidden="true" />
                      Retry
                    </Button>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                    <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                    {item.phase === "uploading" ? "Uploading" : "Processing"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {photos.length === 0 && pending.length === 0 && (
        <p className="text-sm text-slate-500">No photos yet.</p>
      )}
    </div>
  );
}
