"use client";

import { useRef, useState } from "react";
import { Loader2, Trash2, Upload } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import {
  PROFILE_PHOTO_CONTENT_TYPES,
  createProfilePhotoPresignedUpload,
  type ProfilePhotoContentType,
} from "@/lib/api/profile-photo";
import { deleteProfilePhoto } from "@/lib/api/auth";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import { completeUpload, uploadFileToSignedUrl } from "@/lib/api/uploads";
import { avatarColorClass, avatarInitials } from "@/lib/avatar";

// Client MIME/size checks below are usability guards only — the backend media
// pipeline is authoritative.
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

function isAllowedType(type: string): type is ProfilePhotoContentType {
  return (PROFILE_PHOTO_CONTENT_TYPES as readonly string[]).includes(type);
}

function isRenderableImageUrl(value: string | null): value is string {
  return !!value && (value.startsWith("https://") || value.startsWith("http://"));
}

// Profile-photo upload using the backend media pipeline:
//   POST /uploads/presigned-url -> PUT to storage -> POST /uploads/:id/complete.
// The processed avatar is published asynchronously by the backend; a successful
// upload is "processing", not "ready". We refresh the profile so the processed
// photo appears once ready and never write a browser-provided URL via the
// profile API (external profile-photo URLs are rejected by the backend).
export default function ProfilePhotoUpload({
  currentPhotoUrl,
  fallbackLabel,
}: {
  currentPhotoUrl: string | null;
  fallbackLabel: string;
}) {
  const { accessToken, refreshProfile } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [removed, setRemoved] = useState(false);

  const handleFile = async (file: File) => {
    setError(null);
    setProcessing(false);
    setRemoved(false);
    if (!isAllowedType(file.type)) {
      setError("Choose a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError("Choose an image smaller than 5 MB.");
      return;
    }

    setIsUploading(true);
    try {
      const token = accessToken ?? undefined;
      const presigned = await createProfilePhotoPresignedUpload(
        { fileName: file.name, contentType: file.type },
        token
      );
      await uploadFileToSignedUrl(presigned.uploadUrl, file);
      await completeUpload(presigned.uploadIntentId, token);
      setProcessing(true);
      // Reflect the processed photo once the backend publishes it.
      await refreshProfile();
    } catch (uploadError) {
      setError(
        uploadError instanceof ApiError
          ? uploadError.message
          : toErrorMessage(uploadError)
      );
    } finally {
      setIsUploading(false);
    }
  };

  const removePhoto = async () => {
    setError(null);
    setProcessing(false);
    setRemoved(false);
    setIsUploading(true);
    try {
      await deleteProfilePhoto(accessToken ?? undefined);
      await refreshProfile();
      setRemoved(true);
    } catch (removeError) {
      setError(
        removeError instanceof ApiError
          ? removeError.message
          : toErrorMessage(removeError)
      );
    } finally {
      setIsUploading(false);
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
              disabled={isUploading}
              onClick={() => inputRef.current?.click()}
            >
              <Upload aria-hidden="true" />
              {isUploading
                ? "Uploading..."
                : currentPhotoUrl
                  ? "Change photo"
                  : "Upload photo"}
            </Button>
            {currentPhotoUrl && (
              <Button
                type="button"
                variant="destructive"
                disabled={isUploading}
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
      {processing && (
        <p role="status" className="flex items-center gap-1.5 text-sm text-amber-700">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Photo uploaded — processing. It will appear once ready.
        </p>
      )}
      {removed && (
        <p role="status" className="text-sm text-slate-600">
          Profile photo removed.
        </p>
      )}
    </section>
  );
}
