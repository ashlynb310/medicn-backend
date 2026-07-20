"use client";

import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";
import { createPresignedUpload } from "@/lib/api/host-listings";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import { completeUpload, uploadFileToSignedUrl } from "@/lib/api/uploads";
import type { UploadAsset } from "@/lib/api/types";

const ALLOWED = ["image/jpeg", "image/png", "image/webp"] as const;
type AllowedType = (typeof ALLOWED)[number];

function isAllowed(type: string): type is AllowedType {
  return (ALLOWED as readonly string[]).includes(type);
}

interface UploadedItem {
  intentId: string;
  fileName: string;
  status: UploadAsset["status"];
  rejectionCode: string | null;
}

// Real listing-photo upload using the backend media pipeline:
//   POST /uploads/presigned-url -> PUT file to storage -> POST
//   /uploads/:intentId/complete (queues processing).
// A successful storage PUT means "uploaded", NOT publicly ready. The processed,
// sanitized derivative is published asynchronously by the backend and appears on
// the listing once ready — so this control shows an honest processing state and
// never renders the local file as if it were a durable listing photo.
export default function PhotoUploadControl({
  listingId,
}: {
  listingId: string;
}) {
  const { accessToken } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadedItem[]>([]);
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
      const asset = await completeUpload(presigned.uploadIntentId, token);
      setItems((prev) => [
        ...prev,
        {
          intentId: asset.id,
          fileName: file.name,
          status: asset.status,
          rejectionCode: asset.rejectionCode,
        },
      ]);
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

      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.intentId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
            >
              <span className="truncate font-medium text-slate-800">
                {item.fileName}
              </span>
              {item.status === "rejected" ? (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                  {item.rejectionCode
                    ? `Rejected (${item.rejectionCode})`
                    : "Rejected"}
                </span>
              ) : item.status === "ready" ? (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                  Ready
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  Processing
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {items.some((item) => item.status !== "rejected" && item.status !== "ready") && (
        <p className="text-xs text-slate-500">
          Uploaded photos are processed by MediCN before publishing. They appear
          on your listing once ready.
        </p>
      )}
    </div>
  );
}
