"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, CircleCheck, Loader2, RotateCcw, Trash2, Upload } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import {
  PROFILE_PHOTO_CONTENT_TYPES,
  createProfilePhotoPresignedUpload,
  type ProfilePhotoContentType,
} from "@/lib/api/profile-photo";
import { deleteProfilePhoto } from "@/lib/api/auth";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import {
  completeUpload,
  pollUploadUntilTerminal,
  uploadFileToSignedUrl,
} from "@/lib/api/uploads";
import { avatarColorClass, avatarInitials } from "@/lib/avatar";

// Client MIME/size checks below are usability guards only — the backend media
// pipeline is authoritative.
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

type PhotoState =
  | "idle"
  | "uploading"
  | "processing"
  | "ready"
  | "rejected"
  | "timeout";

function isAllowedType(type: string): type is ProfilePhotoContentType {
  return (PROFILE_PHOTO_CONTENT_TYPES as readonly string[]).includes(type);
}

function isRenderableImageUrl(value: string | null): value is string {
  return !!value && (value.startsWith("https://") || value.startsWith("http://"));
}

// Profile-photo upload using the backend media pipeline:
//   POST /uploads/presigned-url -> PUT to storage -> POST /uploads/:id/complete
//   -> poll GET /uploads/:id until ready/rejected/deleted (or timeout).
// The processed avatar is published asynchronously; a successful PUT is
// "processing", not "ready". Only the backend-processed avatar is rendered
// (never the local file). On ready we refresh the AuthProvider profile so the
// processed photo appears. Polling is cancelled on unmount/navigation.
export default function ProfilePhotoUpload({
  currentPhotoUrl,
  fallbackLabel,
}: {
  currentPhotoUrl: string | null;
  fallbackLabel: string;
}) {
  const { accessToken, refreshProfile } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastIntentRef = useRef<string | null>(null);
  const [photoState, setPhotoState] = useState<PhotoState>("idle");
  const [rejectionCode, setRejectionCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);

  useEffect(() => {
    abortRef.current = new AbortController();
    return () => abortRef.current?.abort();
  }, []);

  const isBusy = photoState === "uploading" || photoState === "processing";

  const applyTerminal = async (asset: {
    status: string;
    rejectionCode: string | null;
  }) => {
    if (asset.status === "ready") {
      setPhotoState("ready");
      // Reflect the processed photo once the backend publishes it.
      await refreshProfile();
    } else if (asset.status === "rejected" || asset.status === "deleted") {
      setPhotoState("rejected");
      setRejectionCode(asset.rejectionCode);
    } else {
      // Timed out while still processing — honest "still processing" state.
      setPhotoState("timeout");
    }
  };

  const handleFile = async (file: File) => {
    setError(null);
    setRemoved(false);
    setRejectionCode(null);
    if (!isAllowedType(file.type)) {
      setError("Choose a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError("Choose an image smaller than 5 MB.");
      return;
    }

    setPhotoState("uploading");
    try {
      const token = accessToken ?? undefined;
      const presigned = await createProfilePhotoPresignedUpload(
        { fileName: file.name, contentType: file.type },
        token
      );
      await uploadFileToSignedUrl(presigned.uploadUrl, file);
      await completeUpload(presigned.uploadIntentId, token);
      lastIntentRef.current = presigned.uploadIntentId;
      setPhotoState("processing");
      const asset = await pollUploadUntilTerminal(presigned.uploadIntentId, {
        accessToken: token,
        signal: abortRef.current?.signal,
      });
      await applyTerminal(asset);
    } catch (uploadError) {
      if (uploadError instanceof DOMException && uploadError.name === "AbortError") {
        return; // unmounted/navigated away
      }
      setPhotoState("idle");
      setError(
        uploadError instanceof ApiError
          ? uploadError.message
          : toErrorMessage(uploadError)
      );
    }
  };

  const recheck = async () => {
    const intentId = lastIntentRef.current;
    if (!intentId) {
      await refreshProfile();
      return;
    }
    setError(null);
    setPhotoState("processing");
    try {
      const asset = await pollUploadUntilTerminal(intentId, {
        accessToken: accessToken ?? undefined,
        signal: abortRef.current?.signal,
        timeoutMs: 30_000,
      });
      await applyTerminal(asset);
    } catch (recheckError) {
      if (recheckError instanceof DOMException && recheckError.name === "AbortError") {
        return;
      }
      setPhotoState("timeout");
      setError(toErrorMessage(recheckError));
    }
  };

  const removePhoto = async () => {
    setError(null);
    setRejectionCode(null);
    setRemoved(false);
    setPhotoState("uploading");
    try {
      await deleteProfilePhoto(accessToken ?? undefined);
      await refreshProfile();
      setRemoved(true);
      setPhotoState("idle");
    } catch (removeError) {
      setPhotoState("idle");
      setError(
        removeError instanceof ApiError
          ? removeError.message
          : toErrorMessage(removeError)
      );
    }
  };

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-slate-200 p-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Profile photo</h2>
        <p className="mt-1 text-sm text-slate-600">
          This photo appears in your account menu and profile.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div
          className={`flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-slate-200 ${
            isRenderableImageUrl(currentPhotoUrl)
              ? "bg-slate-100 text-slate-400"
              : `${avatarColorClass(fallbackLabel)} text-2xl font-semibold text-white`
          }`}
        >
          {isRenderableImageUrl(currentPhotoUrl) ? (
            // eslint-disable-next-line @next/next/no-img-element -- Supabase storage host is environment-dependent.
            <img
              src={currentPhotoUrl}
              alt="Current profile photo"
              className="size-full object-cover"
            />
          ) : (
            avatarInitials(fallbackLabel)
          )}
        </div>

        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={PROFILE_PHOTO_CONTENT_TYPES.join(",")}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void handleFile(file);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isBusy}
              onClick={() => inputRef.current?.click()}
            >
              <Upload aria-hidden="true" />
              {isBusy
                ? "Working…"
                : currentPhotoUrl
                  ? "Change photo"
                  : "Upload photo"}
            </Button>
            {currentPhotoUrl && (
              <Button
                type="button"
                variant="destructive"
                disabled={isBusy}
                onClick={() => void removePhoto()}
              >
                <Trash2 aria-hidden="true" />
                Remove
              </Button>
            )}
          </div>
          <p className="text-sm text-slate-500">JPEG, PNG, or WebP, up to 5 MB.</p>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-red-600">
          {error}
        </p>
      )}
      {photoState === "processing" && (
        <p role="status" className="flex items-center gap-1.5 text-sm text-amber-700">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Photo uploaded — processing. It will appear once ready.
        </p>
      )}
      {photoState === "ready" && (
        <p role="status" className="flex items-center gap-1.5 text-sm text-green-700">
          <CircleCheck className="size-4" aria-hidden="true" />
          Photo processed and updated.
        </p>
      )}
      {photoState === "rejected" && (
        <p role="alert" className="flex items-center gap-1.5 text-sm text-red-600">
          <CircleAlert className="size-4" aria-hidden="true" />
          {rejectionCode
            ? `We couldn't use that image (${rejectionCode}). Try a different photo.`
            : "We couldn't use that image. Try a different photo."}
        </p>
      )}
      {photoState === "timeout" && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="flex items-center gap-1.5 text-sm text-amber-700">
            <Loader2 className="size-4" aria-hidden="true" />
            Still processing. This can take a moment.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void recheck()}>
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Check again
          </Button>
        </div>
      )}
      {removed && (
        <p role="status" className="text-sm text-slate-600">
          Profile photo removed.
        </p>
      )}
    </section>
  );
}
