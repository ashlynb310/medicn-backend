import { apiFetch } from "./client";
import type { HealthcareRole } from "./auth";

// Subject-side healthcare CREDENTIAL verification (see medicn
// apps/api/src/healthcare). This is private, sensitive evidence and is entirely
// separate from Veriff identity verification: it never reads, writes, or infers
// identity status, and identity never creates a healthcare record.
//
// The subject projection deliberately excludes reviewer identity, Admin notes
// and reason codes, storage paths/buckets, and any evidence URL. Nothing here
// exposes image bytes or document contents.

export type HealthcareAffiliationType =
  | "hospital"
  | "clinic"
  | "university"
  | "medical_school"
  | "nursing_school"
  | "other";

export type HealthcareEvidenceCategory =
  | "license"
  | "student"
  | "employment"
  | "other";

export type HealthcareSubmissionStatus =
  | "created"
  | "uploading"
  | "processing"
  | "pending_review"
  | "approved"
  | "rejected"
  | "withdrawn"
  | "processing_failed"
  | "deletion_pending"
  | "evidence_deleted"
  | "deletion_failed";

/** Coarse evidence state — never a URL, path, or byte count. */
export type HealthcareEvidenceStatus =
  | "processing"
  | "ready"
  | "processing_failed"
  | "deleted";

export interface HealthcareEvidenceRef {
  id: string;
  status: HealthcareEvidenceStatus;
}

/** Mirrors HealthcareVerificationService.toSubject — the ONLY subject shape. */
export interface HealthcareSubmission {
  id: string;
  version: number;
  // Legacy/backfilled rows may carry nulls; the UI renders safe fallbacks.
  claimedRole: HealthcareRole | null;
  claimedAffiliationName: string | null;
  claimedAffiliationType: HealthcareAffiliationType | null;
  evidenceCategory: HealthcareEvidenceCategory | null;
  status: HealthcareSubmissionStatus;
  /** Retained decision, or null while undecided. No reason code or note. */
  decision: "approved" | "rejected" | null;
  submittedAt: string | null;
  decidedAt: string | null;
  withdrawnAt: string | null;
  createdAt: string;
  evidenceCount: number;
  evidence: HealthcareEvidenceRef[];
}

export interface HealthcareMine {
  current: HealthcareSubmission | null;
  history: HealthcareSubmission[];
}

export interface CreateHealthcareVerificationInput {
  claimedRole: HealthcareRole;
  claimedAffiliationName: string;
  claimedAffiliationType: HealthcareAffiliationType;
  evidenceCategory: HealthcareEvidenceCategory;
}

/**
 * Upload intent. `uploadUrl` is a short-lived signed storage URL that MUST be
 * used only as a transient local variable for the raw PUT — never rendered,
 * logged, persisted, or stored in React state.
 */
export interface HealthcareUploadIntent {
  evidenceId: string;
  uploadUrl: string;
  expiresAt: string;
}

/**
 * GET /api/v1/healthcare-verifications/me — redacted current submission plus
 * versioned history.
 */
export async function getMyHealthcareVerifications(
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data } = await apiFetch<HealthcareMine>("/healthcare-verifications/me", {
    accessToken,
    signal,
  });
  return data;
}

/**
 * POST /api/v1/healthcare-verifications — create the next versioned claim.
 * Requires a backend-confirmed APPROVED identity verification; the backend is
 * authoritative and returns IDENTITY_VERIFICATION_* when it is not.
 * Surfaces HEALTHCARE_SUBMISSION_ACTIVE when one is already active.
 */
export async function createHealthcareVerification(
  input: CreateHealthcareVerificationInput,
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data } = await apiFetch<HealthcareSubmission>(
    "/healthcare-verifications",
    { method: "POST", body: input, accessToken, signal }
  );
  return data;
}

/**
 * POST /api/v1/healthcare-verifications/:id/evidence/upload-intents —
 * one private upload intent (rate limited). JPEG/PNG/WebP only.
 */
export async function createHealthcareEvidenceUploadIntent(
  verificationId: string,
  input: { fileName: string; contentType: "image/jpeg" | "image/png" | "image/webp" },
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data } = await apiFetch<HealthcareUploadIntent>(
    `/healthcare-verifications/${encodeURIComponent(verificationId)}/evidence/upload-intents`,
    { method: "POST", body: input, accessToken, signal }
  );
  return data;
}

/**
 * POST /api/v1/healthcare-verifications/:id/evidence/:evidenceId/complete —
 * confirm the storage upload and enqueue private processing. Only after this
 * succeeds may the UI call the upload successful.
 */
export async function completeHealthcareEvidence(
  verificationId: string,
  evidenceId: string,
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data } = await apiFetch<{
    evidenceId: string;
    status: HealthcareEvidenceStatus;
  }>(
    `/healthcare-verifications/${encodeURIComponent(verificationId)}/evidence/${encodeURIComponent(evidenceId)}/complete`,
    { method: "POST", accessToken, signal }
  );
  return data;
}

/**
 * POST /api/v1/healthcare-verifications/:id/submit — submit 1-3 ready,
 * sanitized images. Blocked with HEALTHCARE_EVIDENCE_NOT_READY until every
 * derivative is ready and the original is confirmed absent.
 */
export async function submitHealthcareVerification(
  verificationId: string,
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data } = await apiFetch<HealthcareSubmission>(
    `/healthcare-verifications/${encodeURIComponent(verificationId)}/submit`,
    { method: "POST", accessToken, signal }
  );
  return data;
}

/**
 * POST /api/v1/healthcare-verifications/:id/withdraw — allowed only before a
 * decision; durably requests secure evidence deletion.
 */
export async function withdrawHealthcareVerification(
  verificationId: string,
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data } = await apiFetch<HealthcareSubmission>(
    `/healthcare-verifications/${encodeURIComponent(verificationId)}/withdraw`,
    { method: "POST", accessToken, signal }
  );
  return data;
}
