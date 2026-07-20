import { apiFetch } from "./client";
import type { PresignedUpload } from "./types";

export const PROFILE_PHOTO_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type ProfilePhotoContentType =
  (typeof PROFILE_PHOTO_CONTENT_TYPES)[number];

export async function createProfilePhotoPresignedUpload(
  input: {
    fileName: string;
    contentType: ProfilePhotoContentType;
  },
  accessToken?: string
) {
  const { data } = await apiFetch<PresignedUpload>("/uploads/presigned-url", {
    method: "POST",
    body: { purpose: "profile_photo", ...input },
    accessToken,
  });
  return data;
}
