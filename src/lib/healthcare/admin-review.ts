import type {
  AdminHealthcareQueueParams,
  HealthcareDecisionReasonCode,
} from "@/lib/api/healthcare-admin";
import type {
  HealthcareEvidenceCategory,
  HealthcareSubmissionStatus,
} from "@/lib/api/healthcare";
import type { HealthcareRole } from "@/lib/api/auth";

// Pure logic for the Admin healthcare review surface: query construction,
// decision eligibility, and the short-lived evidence-URL validity rules.
// The backend remains authoritative for authorization and for every decision.

/** Sentinel for "no filter" in the UI selects. */
export const ANY_FILTER = "all";

export const MAX_DECISION_NOTE_LENGTH = 1000;

export const APPROVAL_REASON_CODE = "information_confirmed" as const;

export const REJECTION_REASON_CODES = [
  "evidence_unreadable",
  "information_mismatch",
  "unsupported_evidence",
  "other",
] as const;

export type RejectionReasonCode = (typeof REJECTION_REASON_CODES)[number];

export interface AdminQueueFilters {
  /**
   * ALWAYS explicit. The backend applies `status ?? pending_review`, so an
   * omitted status silently means pending_review — there is no "all statuses"
   * query, and the UI must never pretend otherwise.
   */
  status: HealthcareSubmissionStatus;
  role: HealthcareRole | typeof ANY_FILTER;
  evidenceCategory: HealthcareEvidenceCategory | typeof ANY_FILTER;
  page: number;
  limit: number;
}

/** Builds the queue query, omitting only the genuinely optional filters. */
export function buildAdminQueueQuery(
  filters: AdminQueueFilters
): AdminHealthcareQueueParams {
  return {
    status: filters.status,
    ...(filters.role === ANY_FILTER ? {} : { role: filters.role }),
    ...(filters.evidenceCategory === ANY_FILTER
      ? {}
      : { evidenceCategory: filters.evidenceCategory }),
    page: filters.page,
    limit: filters.limit,
  };
}

export interface DecisionNoteState {
  trimmed: string;
  length: number;
  remaining: number;
  valid: boolean;
}

/** The note is optional; when present it must be ≤1000 characters trimmed. */
export function decisionNoteState(raw: string): DecisionNoteState {
  const trimmed = raw.trim();
  return {
    trimmed,
    length: trimmed.length,
    remaining: MAX_DECISION_NOTE_LENGTH - trimmed.length,
    valid: trimmed.length <= MAX_DECISION_NOTE_LENGTH,
  };
}

export function isRejectionReasonCode(
  value: string | null
): value is RejectionReasonCode {
  return (
    value !== null && (REJECTION_REASON_CODES as readonly string[]).includes(value)
  );
}

/**
 * Approve is always `information_confirmed`; reject requires one of the four
 * rejection codes. A decision can never be submitted without both.
 */
export function canSubmitDecision(input: {
  decision: "approved" | "rejected" | null;
  reasonCode: HealthcareDecisionReasonCode | null;
  note: string;
}): boolean {
  if (!decisionNoteState(input.note).valid) return false;
  if (input.decision === "approved") {
    return input.reasonCode === APPROVAL_REASON_CODE;
  }
  if (input.decision === "rejected") {
    return isRejectionReasonCode(input.reasonCode);
  }
  return false;
}

/**
 * After a successful PATCH the UI shows an interim "decision recorded" state.
 * It converges — and that interim panel is dropped — only once an authoritative
 * GET actually shows the decision, or shows the submission has left
 * pending_review. A reload that still reports pending_review with no decision
 * (stale replica, race) must NOT clear it, and neither must a failed reload.
 */
export function shouldClearDecisionRecorded(
  detail: { status: string; decision: unknown } | null
): boolean {
  if (!detail) return false;
  return detail.decision !== null || detail.status !== "pending_review";
}

/** Reason code implied by the chosen decision, for a fresh selection. */
export function defaultReasonCodeFor(
  decision: "approved" | "rejected"
): HealthcareDecisionReasonCode | null {
  return decision === "approved" ? APPROVAL_REASON_CODE : null;
}

// --- transient evidence view URL ---

/** Loopback hosts where plain HTTP is acceptable for local development only. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/**
 * HTTP is permitted ONLY outside production, and even then only for loopback.
 * Passed explicitly so the rule is testable without a build environment.
 */
export function allowLoopbackHttpInThisEnvironment(): boolean {
  return process.env.NODE_ENV !== "production";
}

/**
 * Validates and normalizes a signed evidence URL before it may be held.
 *
 * Production accepts HTTPS only. Development additionally accepts HTTP for
 * loopback hosts (localhost, 127.0.0.1, ::1) so a local Supabase/storage stack
 * works — arbitrary production HTTP is never allowed. Returns the normalized
 * href, or null when the value must not be rendered.
 */
export function normalizeEvidenceViewUrl(
  value: unknown,
  allowLoopbackHttp: boolean
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol === "https:") return url.href;
  if (url.protocol === "http:" && allowLoopbackHttp && isLoopbackHost(url.hostname)) {
    return url.href;
  }
  return null;
}

export function isSafeEvidenceViewUrl(
  value: unknown,
  allowLoopbackHttp: boolean
): value is string {
  return normalizeEvidenceViewUrl(value, allowLoopbackHttp) !== null;
}

/**
 * Hard client-side cap on how long a signed evidence URL may stay visible,
 * independent of what the backend reports.
 */
export const MAX_EVIDENCE_VIEW_MS = 60_000;

/**
 * Effective expiry = min(valid backend expiresAt, receivedAt + 60s).
 * Returns null when the backend timestamp is malformed/unusable.
 */
export function resolveEffectiveExpiryMs(
  expiresAt: string,
  receivedAtMs: number
): number | null {
  const backendMs = Date.parse(expiresAt);
  if (Number.isNaN(backendMs)) return null;
  return Math.min(backendMs, receivedAtMs + MAX_EVIDENCE_VIEW_MS);
}

export type EvidenceViewRejection =
  | "none"
  | "missing"
  | "unsafe_url"
  | "invalid_expiry"
  | "expired";

export interface EvidenceViewState {
  renderable: boolean;
  reason: EvidenceViewRejection;
}

export interface HeldEvidenceView {
  viewUrl: string;
  expiresAt: string;
  receivedAtMs: number;
}

/**
 * A signed evidence URL may be rendered only while it is well-formed AND within
 * its effective (capped) lifetime. On expiry the image is cleared and another
 * explicit, audited View action is required — it is never silently refreshed.
 */
export function resolveEvidenceViewState(
  view: HeldEvidenceView | null,
  nowMs: number,
  allowLoopbackHttp: boolean
): EvidenceViewState {
  if (!view) return { renderable: false, reason: "missing" };
  if (!isSafeEvidenceViewUrl(view.viewUrl, allowLoopbackHttp)) {
    return { renderable: false, reason: "unsafe_url" };
  }
  const effective = resolveEffectiveExpiryMs(view.expiresAt, view.receivedAtMs);
  if (effective === null) return { renderable: false, reason: "invalid_expiry" };
  if (effective <= nowMs) return { renderable: false, reason: "expired" };
  return { renderable: true, reason: "none" };
}

/** Milliseconds until the EFFECTIVE (capped) expiry, clamped at zero. */
export function evidenceViewRemainingMs(
  expiresAt: string,
  receivedAtMs: number,
  nowMs: number
): number {
  const effective = resolveEffectiveExpiryMs(expiresAt, receivedAtMs);
  if (effective === null) return 0;
  return Math.max(0, effective - nowMs);
}

/**
 * Opaque per-context identity for a held view URL. It carries NO data: a fresh
 * one is minted whenever the account session, submission, evidence, or clear
 * signal changes, and only reference equality is compared. The access token is
 * never passed in, stored, hashed, serialized, rendered, or logged.
 */
export type EvidenceViewGeneration = object;

export function createEvidenceViewGeneration(): EvidenceViewGeneration {
  return {};
}

/** A held URL from a previous generation is stale and must not render. */
export function isEvidenceViewStale(
  current: EvidenceViewGeneration,
  held: EvidenceViewGeneration | null
): boolean {
  return held !== null && held !== current;
}
