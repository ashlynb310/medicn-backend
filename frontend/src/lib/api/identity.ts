import { apiFetch } from "./client";
import type {
  IdentityVerificationAction,
  IdentityVerificationStatus,
} from "./auth";

// Identity verification (see medicn/apps/api/src/identity). This is Veriff
// IDENTITY verification only — it is completely separate from healthcare
// credential verification and never reads or writes healthcareVerification /
// currentVerificationStatus.
//
// The browser NEVER calls Veriff directly and never holds VERIFF_API_KEY or
// VERIFF_SHARED_SECRET. The backend creates the hosted session; webhooks are
// backend-only and authoritative for the decision.

/** Mirrors IdentityService.toSummary. */
export interface IdentityVerificationSummary {
  status: IdentityVerificationStatus;
  provider: "veriff";
  submittedAt: string | null;
  decidedAt: string | null;
  expiresAt: string | null;
  canRetry: boolean;
  actionRequired: IdentityVerificationAction;
}

/**
 * Mirrors IdentityService.toSessionDto. `verificationUrl` is null once the
 * verification is approved (there is nothing left to host).
 */
export interface IdentitySession {
  verificationUrl: string | null;
  sessionId: string;
  status: IdentityVerificationStatus;
  expiresAt: string | null;
}

/**
 * GET /api/v1/identity/verifications/current — the caller's own current
 * identity verification summary. Contains only allowlisted status/guidance;
 * no provider payload, document, or raw decision data.
 */
export async function getCurrentIdentityVerification(
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data } = await apiFetch<IdentityVerificationSummary>(
    "/identity/verifications/current",
    { accessToken, signal }
  );
  return data;
}

/**
 * POST /api/v1/identity/verifications/session — creates or reuses the hosted
 * provider session. No request body. Rate limited (identity_session).
 *
 * Accepts an AbortSignal so a stale attempt (unmount, access-token change, or a
 * replacement click) can be cancelled — an aborted response must never redirect
 * the browser or update the page.
 *
 * Surfaces VERIFF_NOT_CONFIGURED, VERIFF_PROVIDER_UNAVAILABLE, ACCOUNT_DISABLED,
 * UNAUTHORIZED, INVALID_SUPABASE_TOKEN, USER_NOT_SYNCED, and rate-limit errors
 * via ApiError.
 */
export async function createIdentitySession(
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data } = await apiFetch<IdentitySession>(
    "/identity/verifications/session",
    { method: "POST", accessToken, signal }
  );
  return data;
}
