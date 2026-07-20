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
  roles: AppUserRole[];
  profileComplete: boolean;
  currentVerificationStatus: VerificationStatus;
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
