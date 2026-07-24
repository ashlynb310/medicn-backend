import { apiFetch } from "./client";

// Mirrors CurrentUserDto from medicn/apps/api/src/auth/auth.service.ts.
export type HealthcareRole =
  | "medical_student"
  | "nursing_student"
  | "nurse"
  | "resident_physician"
  | "physician"
  | "other";

export type AppUserRole = "renter" | "host" | "admin";

export type VerificationStatus =
  | "not_started"
  | "pending"
  | "approved"
  | "rejected"
  | "expired";

export type IdentityVerificationStatus =
  | "not_started"
  | "created"
  | "submitted"
  | "review"
  | "resubmission_requested"
  | "approved"
  | "declined"
  | "expired"
  | "abandoned";

export type IdentityVerificationAction =
  | "start"
  | "continue"
  | "wait"
  | "resubmit"
  | "none"
  | "retry";

// Mirrors CurrentUserDto (packages/types + auth.service.toCurrentUserDto).
export interface CurrentUser {
  id: string;
  supabaseUserId: string;
  email: string;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  healthcareRole: HealthcareRole | null;
  healthcareAffiliation: string | null;
  phoneNumber: string | null;
  bio: string | null;
  profilePhotoUrl: string | null;
  profilePhoto: { url: string; source: "processed" | "legacy" } | null;
  roles: AppUserRole[];
  profileComplete: boolean;
  /** @deprecated Healthcare-verification status only; use healthcareVerification.status. */
  currentVerificationStatus: VerificationStatus;
  healthcareVerification: { status: VerificationStatus };
  identityVerification: {
    status: IdentityVerificationStatus;
    provider: "veriff";
    submittedAt: string | null;
    decidedAt: string | null;
    expiresAt: string | null;
    canRetry: boolean;
    actionRequired: IdentityVerificationAction;
  };
}

// Mirrors UpdateCurrentUserDto from the backend. Empty optional text fields
// are sent as null by the account form so users can intentionally clear them.
export interface UpdateCurrentUserInput {
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  healthcareRole?: HealthcareRole | null;
  healthcareAffiliation?: string | null;
  phoneNumber?: string | null;
  bio?: string | null;
  profilePhotoUrl?: string | null;
}

/**
 * GET /auth/me — returns the synced MediCN profile for the bearer token.
 * Throws ApiError with code "USER_NOT_SYNCED" (404) when the Supabase user has
 * no MediCN profile yet; call syncCurrentUser first in that case.
 */
export async function getCurrentUser(accessToken: string) {
  const { data } = await apiFetch<CurrentUser>("/auth/me", { accessToken });
  return data;
}

/**
 * POST /auth/sync — upserts the MediCN profile from the Supabase user's
 * metadata and returns it. Safe to call after login and signup.
 */
export async function syncCurrentUser(accessToken: string) {
  const { data } = await apiFetch<CurrentUser>("/auth/sync", {
    method: "POST",
    accessToken,
  });
  return data;
}

export async function updateCurrentUser(
  input: UpdateCurrentUserInput,
  accessToken: string
) {
  const { data } = await apiFetch<CurrentUser>("/users/me", {
    method: "PATCH",
    body: input,
    accessToken,
  });
  return data;
}

/**
 * DELETE /users/me/profile-photo — removes the current user's profile photo.
 * The backend owns processed-media storage, so removal goes through this
 * dedicated endpoint rather than PATCH /users/me with a URL. It returns the
 * media-asset deletion result; callers refresh the profile separately.
 */
export async function deleteProfilePhoto(accessToken?: string) {
  const { data } = await apiFetch<{ id: string | null; status: string }>(
    "/users/me/profile-photo",
    { method: "DELETE", accessToken }
  );
  return data;
}
