import { apiFetch } from "./client";
import type {
  HealthcareAffiliationType,
  HealthcareEvidenceCategory,
  HealthcareSubmissionStatus,
} from "./healthcare";
import type { HealthcareRole } from "./auth";

// ADMIN-side healthcare credential review (see medicn HealthcareAdminService).
// Deliberately separate from the subject-side types in ./healthcare: the Admin
// projection carries fields (userId, per-evidence readiness, reviewer identity,
// Admin note) that must never leak into subject-side components.
//
// This is also entirely separate from Veriff identity verification.

export type HealthcareDecisionReasonCode =
  | "information_confirmed"
  | "evidence_unreadable"
  | "information_mismatch"
  | "unsupported_evidence"
  | "other";

/** Admin evidence readiness. Never a URL, path, bucket, or byte. */
export interface AdminHealthcareEvidenceRef {
  id: string;
  ready: boolean;
  sanitizedAt: string | null;
}

/** Mirrors HealthcareAdminService.adminSummary. */
export interface AdminHealthcareSummary {
  id: string;
  userId: string;
  version: number;
  // Legacy/backfilled rows may carry nulls; safe fallbacks are used for display.
  claimedRole: HealthcareRole | null;
  claimedAffiliationName: string | null;
  claimedAffiliationType: HealthcareAffiliationType | null;
  evidenceCategory: HealthcareEvidenceCategory | null;
  status: HealthcareSubmissionStatus;
  submittedAt: string | null;
  createdAt: string;
  evidence: AdminHealthcareEvidenceRef[];
}

/** Present only once a decision has been recorded. */
export interface AdminHealthcareDecision {
  status: string;
  reviewerId: string | null;
  decidedAt: string;
  reasonCode: HealthcareDecisionReasonCode | null;
  note: string | null;
}

export interface AdminHealthcareDetail extends AdminHealthcareSummary {
  decision: AdminHealthcareDecision | null;
}

export interface AdminHealthcareListMeta {
  page: number;
  limit: number;
  total: number;
}

/**
 * Short-lived signed URL for ONE sanitized evidence derivative. Valid for at
 * most 60 seconds, Admin-only, and audit-recorded on the backend. It must stay
 * in ephemeral component memory: never a route, query string, log, storage,
 * cookie, analytics event, error message, or persisted state.
 */
export interface AdminEvidenceViewUrl {
  evidenceId: string;
  viewUrl: string;
  expiresAt: string;
}

export interface AdminDecisionInput {
  status: "approved" | "rejected";
  reasonCode: HealthcareDecisionReasonCode;
  note?: string;
}

export interface AdminDecisionResult {
  id: string;
  status: HealthcareSubmissionStatus;
  decision: "approved" | "rejected";
  reasonCode: HealthcareDecisionReasonCode;
  decidedAt: string;
}

export interface AdminHealthcareQueueParams {
  status?: HealthcareSubmissionStatus;
  role?: HealthcareRole;
  evidenceCategory?: HealthcareEvidenceCategory;
  page?: number;
  limit?: number;
}

/**
 * GET /api/v1/admin/healthcare-verifications — review queue. The backend
 * defaults to status=pending_review and caps limit at 100. Requires the `admin`
 * role; non-Admins receive FORBIDDEN.
 */
export async function listAdminHealthcareVerifications(
  params: AdminHealthcareQueueParams = {},
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data, meta } = await apiFetch<
    AdminHealthcareSummary[],
    AdminHealthcareListMeta
  >("/admin/healthcare-verifications", {
    query: {
      status: params.status,
      role: params.role,
      evidenceCategory: params.evidenceCategory,
      page: params.page,
      limit: params.limit,
    },
    accessToken,
    signal,
  });
  return { submissions: data, meta };
}

/**
 * GET /api/v1/admin/healthcare-verifications/:id — claim, evidence readiness,
 * and (once decided) the retained decision metadata. Missing rows are NOT_FOUND.
 */
export async function getAdminHealthcareVerification(
  id: string,
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data } = await apiFetch<AdminHealthcareDetail>(
    `/admin/healthcare-verifications/${encodeURIComponent(id)}`,
    { accessToken, signal }
  );
  return data;
}

/**
 * POST /api/v1/admin/healthcare-verifications/:id/evidence/:evidenceId/view-url
 * — mints a ≤60s signed URL for the sanitized derivative. Only available for
 * READY evidence on a PENDING_REVIEW submission; every call is audited and
 * increments a bounded access counter on the backend.
 */
export async function createAdminEvidenceViewUrl(
  verificationId: string,
  evidenceId: string,
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data } = await apiFetch<AdminEvidenceViewUrl>(
    `/admin/healthcare-verifications/${encodeURIComponent(verificationId)}/evidence/${encodeURIComponent(evidenceId)}/view-url`,
    { method: "POST", accessToken, signal }
  );
  return data;
}

/**
 * PATCH /api/v1/admin/healthcare-verifications/:id — record exactly one
 * decision. The submission moves to `deletion_pending` and secure evidence
 * deletion is queued. Surfaces HEALTHCARE_DECISION_CONFLICT for a concurrent or
 * stale decision and HEALTHCARE_EVIDENCE_NOT_READY when evidence is unusable.
 */
export async function decideAdminHealthcareVerification(
  id: string,
  input: AdminDecisionInput,
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data } = await apiFetch<AdminDecisionResult>(
    `/admin/healthcare-verifications/${encodeURIComponent(id)}`,
    { method: "PATCH", body: input, accessToken, signal }
  );
  return data;
}
