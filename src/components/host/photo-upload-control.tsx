"use client";

import { useRef, useState } from "react";
import { ImageOff, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";
import {
  addListingPhoto,
  createPresignedUpload,
  uploadFileToSignedUrl,
} from "@/lib/api/host-listings";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import type { ListingPhotoRecord } from "@/lib/api/types";

const ALLOWED = ["image/jpeg", "image/png", "image/webp"] as const;
type AllowedType = (typeof ALLOWED)[number];

function isAllowed(type: string): type is AllowedType {
  return (ALLOWED as readonly string[]).includes(type);
}

function isHttpUrl(url: string) {
  return url.startsWith("https://") || url.startsWith("http://");
}

/**
 * Real photo upload for a created listing using the backend's presigned-URL
 * flow: POST /uploads/presigned-url -> PUT file to storage -> POST
 * /listings/:id/photos. Success is only shown after all three steps succeed.
 */
export default function PhotoUploadControl({
  listingId,
}: {
  listingId: string;
}) {
  const { accessToken } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<ListingPhotoRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    if (!isAllowed(file.type)) {
      setError("Choose a JPEG, PNG, or WebP image.");
      return;
    }
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
      const photo = await addListingPhoto(
        listingId,
        { storagePath: presigned.storagePath },
        token
      );
      setPhotos((prev) => [...prev, photo]);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(toErrorMessage(err));
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED.join(",")}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset so selecting the same file again re-triggers change.
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
        <span className="text-sm text-slate-500">JPEG, PNG, or WebP.</span>
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-red-600">
          {error}
        </p>
      )}

      {photos.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((photo) => (
            <li
              key={photo.id}
              className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
            >
              {isHttpUrl(photo.fileUrl) ? (
                // eslint-disable-next-line @next/next/no-img-element -- backend storage host is env-dependent
                <img
                  src={photo.fileUrl}
                  alt="Uploaded listing photo"
                  className="h-28 w-full object-cover"
                />
              ) : (
                <div className="flex h-28 w-full items-center justify-center text-slate-400">
                  <ImageOff className="size-6" aria-hidden="true" />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
