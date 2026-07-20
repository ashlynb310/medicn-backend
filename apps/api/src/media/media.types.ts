import type { MediaPurpose, MediaVariantType } from "@prisma/client";

export const PROCESS_MEDIA_ASSET_JOB = "process_media_asset";
export const CLEANUP_MEDIA_ASSET_JOB = "cleanup_media_asset";
export const MEDIA_QUEUE_NAME = "media";

export const ALLOWED_MEDIA_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp"
] as const;

export type AllowedMediaContentType =
  (typeof ALLOWED_MEDIA_CONTENT_TYPES)[number];

export interface ProcessMediaAssetPayload {
  assetId: string;
}

export interface CleanupMediaAssetPayload {
  assetId: string;
}

export interface CreateMediaIntentInput {
  purpose: MediaPurpose;
  listingId?: string;
  fileName: string;
  contentType: AllowedMediaContentType;
}

export interface ProcessedVariant {
  type: MediaVariantType;
  buffer: Buffer;
  width: number;
  height: number;
  contentType: "image/webp";
  checksumSha256: string;
}

export interface ProcessedMedia {
  checksumSha256: string;
  detectedContentType: AllowedMediaContentType;
  detectedFormat: "jpeg" | "png" | "webp";
  decodedWidth: number;
  decodedHeight: number;
  variants: ProcessedVariant[];
}
