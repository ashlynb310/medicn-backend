import type {
  HealthcareEvidenceRef,
  HealthcareEvidenceStatus,
  HealthcareSubmission,
  HealthcareSubmissionStatus,
} from "@/lib/api/healthcare";

// Pure lifecycle, eligibility, validation, and polling logic for the subject
// side of healthcare credential verification. Presentation only — the backend
// is authoritative for every decision here, and these helpers never touch
// identity state.

export type HealthcareTone =
  | "neutral"
  | "info"
  | "warning"
  | "success"
  | "danger";

export interface SubmissionPresentation {
  label: string;
  tone: HealthcareTone;
  description: string;
}

const STATUS_PRESENTATION: Record<
  HealthcareSubmissionStatus,
  SubmissionPresentation
> = {
  created: {
    label: "Draft",
    tone: "neutral",
    description: "Add one to three images of your credential evidence.",
  },
  uploading: {
    label: "Uploading",
    tone: "info",
    description: "Your evidence is being uploaded to private storage.",
  },
  processing: {
    label: "Processing",
    tone: "info",
    description:
      "MediCN is preparing a sanitized private review image and removing the original.",
  },
  pending_review: {
    label: "Pending review",
    tone: "info",
    description:
      "Your submission is waiting for review. You can withdraw it until a decision is made.",
  },
  approved: {
    label: "Approved",
    tone: "success",
    description: "Your healthcare credential claim was approved.",
  },
  rejected: {
    label: "Rejected",
    tone: "danger",
    description: "Your healthcare credential claim was not approved.",
  },
  withdrawn: {
    label: "Withdrawn",
    tone: "neutral",
    description: "You withdrew this submission.",
  },
  processing_failed: {
    label: "Processing failed",
    tone: "warning",
    description:
      "An image could not be processed, so this version can't accept more evidence. You can start a new submission now. Separately, you can withdraw this version to request secure deletion of its images.",
  },
  deletion_pending: {
    label: "Deleting evidence",
    tone: "info",
    description:
      "Secure deletion of your evidence has been requested and is in progress.",
  },
  evidence_deleted: {
    label: "Evidence deleted",
    tone: "neutral",
    description:
      "Your evidence images have been deleted. Only the claim record and decision are retained.",
  },
  deletion_failed: {
    label: "Deletion incomplete",
    tone: "warning",
    description:
      "Secure cleanup did not finish. MediCN operations must complete the deletion.",
  },
};

export function describeSubmissionStatus(
  status: HealthcareSubmissionStatus
): SubmissionPresentation {
  return (
    STATUS_PRESENTATION[status] ?? {
      label: status,
      tone: "neutral",
      description: "",
    }
  );
}

// Statuses where the submission still occupies the single active slot, so the
// backend would answer HEALTHCARE_SUBMISSION_ACTIVE to a new create. This
// mirrors the backend exactly: `processing_failed` is NOT active, so a new
// submission may be started after one.
const ACTIVE_STATUSES: ReadonlySet<HealthcareSubmissionStatus> = new Set([
  "created",
  "uploading",
  "processing",
  "pending_review",
]);

// Statuses where evidence may still be added/completed. Mirrors the backend:
// `processing_failed` is NOT editable, and there is no subject-side endpoint to
// delete or replace an individual evidence record.
const EDITABLE_STATUSES: ReadonlySet<HealthcareSubmissionStatus> = new Set([
  "created",
  "uploading",
  "processing",
]);

// Withdrawal is broader than "active": a processing_failed submission must
// still be withdrawable so its evidence can be securely deleted.
const WITHDRAWABLE_STATUSES: ReadonlySet<HealthcareSubmissionStatus> = new Set([
  "created",
  "uploading",
  "processing",
  "pending_review",
  "processing_failed",
]);

// Statuses that describe the secure-deletion lifecycle.
const DELETION_STATUSES: ReadonlySet<HealthcareSubmissionStatus> = new Set([
  "deletion_pending",
  "evidence_deleted",
  "deletion_failed",
]);

export const MAX_EVIDENCE_COUNT = 3;
export const MIN_EVIDENCE_COUNT = 1;
export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024; // 10 MiB
export const ALLOWED_EVIDENCE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type AllowedEvidenceType = (typeof ALLOWED_EVIDENCE_TYPES)[number];

export function isSubmissionActive(
  submission: HealthcareSubmission | null
): boolean {
  return submission !== null && ACTIVE_STATUSES.has(submission.status);
}

/** A new claim may be started only when nothing occupies the active slot. */
export function canCreateSubmission(
  current: HealthcareSubmission | null
): boolean {
  return !isSubmissionActive(current);
}

/** Evidence may be added/replaced only while the submission is editable. */
export function isSubmissionEditable(
  submission: HealthcareSubmission | null
): boolean {
  return submission !== null && EDITABLE_STATUSES.has(submission.status);
}

export function isDeletionStatus(status: HealthcareSubmissionStatus): boolean {
  return DELETION_STATUSES.has(status);
}

/** More evidence may be added only below the backend's hard limit of three. */
export function canAddEvidence(
  submission: HealthcareSubmission | null
): boolean {
  if (!isSubmissionEditable(submission) || !submission) return false;
  return submission.evidenceCount < MAX_EVIDENCE_COUNT;
}

/**
 * Submit requires 1-3 evidence records that are ALL ready. The backend enforces
 * this too (HEALTHCARE_EVIDENCE_NOT_READY); this only gates the control.
 */
export function canSubmit(submission: HealthcareSubmission | null): boolean {
  if (!isSubmissionEditable(submission) || !submission) return false;
  const count = submission.evidence.length;
  if (count < MIN_EVIDENCE_COUNT || count > MAX_EVIDENCE_COUNT) return false;
  return submission.evidence.every((item) => item.status === "ready");
}

/**
 * Withdrawal is permitted only before a decision is recorded. It deliberately
 * includes `processing_failed`, which is otherwise a dead end: withdrawing is
 * how the subject requests secure deletion of that version's evidence.
 */
export function canWithdraw(submission: HealthcareSubmission | null): boolean {
  if (!submission) return false;
  if (submission.decision !== null) return false;
  if (submission.withdrawnAt !== null) return false;
  return WITHDRAWABLE_STATUSES.has(submission.status);
}

// --- evidence processing / polling ---

const TERMINAL_EVIDENCE: ReadonlySet<HealthcareEvidenceStatus> = new Set([
  "ready",
  "processing_failed",
  "deleted",
]);

export function isTerminalEvidenceStatus(
  status: HealthcareEvidenceStatus
): boolean {
  return TERMINAL_EVIDENCE.has(status);
}

export function hasProcessingEvidence(
  evidence: readonly HealthcareEvidenceRef[]
): boolean {
  return evidence.some((item) => !isTerminalEvidenceStatus(item.status));
}

/**
 * Bounded polling: continue only while at least one evidence record is still
 * processing AND the attempt budget is unspent. Exhaustion stops polling and
 * the UI offers "Check again".
 */
export function shouldContinueEvidencePolling(
  evidence: readonly HealthcareEvidenceRef[],
  attempts: number,
  maxAttempts: number
): boolean {
  if (!hasProcessingEvidence(evidence)) return false;
  return attempts < maxAttempts;
}

/**
 * Whole-submission polling: keep reading GET /me while evidence is still being
 * processed OR while secure deletion is still in progress, within the budget.
 * Deletion is only complete when the backend reports `evidence_deleted`.
 */
export function shouldContinueSubmissionPolling(
  submission: HealthcareSubmission | null,
  attempts: number,
  maxAttempts: number
): boolean {
  if (!submission) return false;
  if (attempts >= maxAttempts) return false;
  if (submission.status === "deletion_pending") return true;
  return hasProcessingEvidence(submission.evidence);
}

/**
 * A sensitive upload/mutation result must be ignored when its request was
 * aborted (unmount, token change, submission change) or when a newer attempt
 * replaced it. A stale attempt must never update visible state or fire callbacks.
 */
export function isStaleHealthcareAttempt(
  aborted: boolean,
  isCurrentAttempt: boolean
): boolean {
  return aborted || !isCurrentAttempt;
}

export interface AttemptCompletion {
  /** This attempt still owns the visible busy state and must clear it. */
  clearBusyState: boolean;
  /** This attempt owns the shared slot and must release it. */
  releaseRef: boolean;
}

/**
 * Decides what a finishing operation may clean up.
 *
 * Ownership is slot identity, NOT abort status: an operation that was aborted
 * (access-token or submission change) still owns its own busy state and must
 * clear it, otherwise "Uploading…"/"Submitting…"/"Withdrawing…" would stay on
 * screen forever. An operation that was SUPERSEDED by a newer attempt no longer
 * owns the slot and must not clear the newer attempt's state.
 */
export function resolveAttemptCompletion(
  currentAttempt: object | null,
  finishingAttempt: object
): AttemptCompletion {
  const owns = currentAttempt === finishingAttempt;
  return { clearBusyState: owns, releaseRef: owns };
}

export interface EvidenceControlInput {
  canAdd: boolean;
  submitReady: boolean;
  withdrawable: boolean;
  uploading: boolean;
  /** A submit or withdraw request is running. */
  busy: boolean;
  confirmingWithdraw: boolean;
}

export interface EvidenceControlState {
  operationInFlight: boolean;
  canUpload: boolean;
  canSubmit: boolean;
  canOpenWithdraw: boolean;
  canConfirmWithdraw: boolean;
}

/**
 * Mutually exclusive evidence controls: only one sensitive operation may be
 * startable at a time, and an open withdraw confirmation blocks upload/submit
 * so a destructive choice can't be raced by another action.
 */
export function resolveEvidenceControls(
  input: EvidenceControlInput
): EvidenceControlState {
  const operationInFlight = input.uploading || input.busy;
  return {
    operationInFlight,
    canUpload: input.canAdd && !operationInFlight && !input.confirmingWithdraw,
    canSubmit:
      input.submitReady && !operationInFlight && !input.confirmingWithdraw,
    canOpenWithdraw: input.withdrawable && !operationInFlight,
    canConfirmWithdraw: input.withdrawable && !operationInFlight,
  };
}

export interface UploadFailureRecovery {
  /** Whether an authoritative GET /me reconciliation must be triggered. */
  reconcile: boolean;
  message: string | null;
}

/**
 * Decides recovery after a failed evidence upload.
 *
 * Once POST upload-intents succeeds the backend has ALREADY created an evidence
 * record and consumed one of the three slots — so a later failure in the signed
 * PUT or in `complete` leaves the server ahead of the UI. That case must
 * reconcile against GET /me and must never imply that adding again removes or
 * replaces the failed record: there is no subject-side evidence delete endpoint.
 */
export function uploadFailureRecovery(
  intentCreated: boolean
): UploadFailureRecovery {
  if (!intentCreated) {
    return { reconcile: false, message: null };
  }
  return {
    reconcile: true,
    message:
      "That image didn't finish, but it may already count toward the three-image limit. Use Check again to refresh. If this submission can't continue, withdraw it and start a new one.",
  };
}

// --- legacy-safe claim labels ---

const ROLE_LABELS: Record<string, string> = {
  medical_student: "Medical student",
  nursing_student: "Nursing student",
  nurse: "Nurse",
  resident_physician: "Resident physician",
  physician: "Physician",
  other: "Other",
};

const AFFILIATION_TYPE_LABELS: Record<string, string> = {
  hospital: "Hospital",
  clinic: "Clinic",
  university: "University",
  medical_school: "Medical school",
  nursing_school: "Nursing school",
  other: "Other",
};

const EVIDENCE_CATEGORY_LABELS: Record<string, string> = {
  license: "Professional license",
  student: "Student enrollment",
  employment: "Employment",
  other: "Other",
};

// Legacy/backfilled rows may carry nulls. Never render "null"/"undefined" or an
// empty separator — always a safe, explicit fallback.
function labelOr(
  labels: Record<string, string>,
  value: string | null | undefined,
  fallback: string
): string {
  if (!value) return fallback;
  return labels[value] ?? value;
}

export function healthcareRoleLabel(value: string | null | undefined): string {
  return labelOr(ROLE_LABELS, value, "Role not recorded");
}

export function affiliationTypeLabel(value: string | null | undefined): string {
  return labelOr(AFFILIATION_TYPE_LABELS, value, "Organization type not recorded");
}

export function evidenceCategoryLabel(value: string | null | undefined): string {
  return labelOr(EVIDENCE_CATEGORY_LABELS, value, "Evidence type not recorded");
}

export function affiliationNameLabel(value: string | null | undefined): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : "Organization not recorded";
}

/** Safe guidance for backend error codes — never provider or reviewer detail. */
export function healthcareErrorHint(code: string): string | null {
  switch (code) {
    case "HEALTHCARE_SUBMISSION_ACTIVE":
      return "You already have a submission in progress. Finish or withdraw it before starting a new one.";
    case "HEALTHCARE_SUBMISSION_NOT_EDITABLE":
      return "This submission can no longer be changed.";
    case "HEALTHCARE_EVIDENCE_LIMIT_REACHED":
      return "A submission can include at most three images.";
    case "HEALTHCARE_EVIDENCE_NOT_READY":
      return "Every image must finish processing before you can submit.";
    case "HEALTHCARE_DECISION_FINAL":
      return "A decided submission can't be withdrawn.";
    // These leave an evidence record that may already consume one of the three
    // slots, so we never suggest simply adding the image again.
    case "MEDIA_UPLOAD_EXPIRED":
      return "The upload window expired. Use Check again to reconcile with MediCN; if this submission can't continue, withdraw it to request deletion and start a new one.";
    case "MEDIA_UPLOAD_OBJECT_MISSING":
      return "The uploaded file wasn't found in storage. Use Check again to reconcile with MediCN; if this submission can't continue, withdraw it to request deletion and start a new one.";
    case "MEDIA_INPUT_TOO_LARGE":
      return "That image is larger than the 10 MB limit.";
    case "MEDIA_NOT_CONFIGURED":
    case "MEDIA_STORAGE_UNAVAILABLE":
      return "Secure storage isn't available right now. Please try again later.";
    case "IDENTITY_VERIFICATION_REQUIRED":
      return "Verify your identity before submitting healthcare credentials.";
    case "IDENTITY_VERIFICATION_PENDING":
      return "Your identity verification is still being reviewed. Try again once it's approved.";
    case "IDENTITY_VERIFICATION_REJECTED":
      return "Your identity verification was not approved, so credentials can't be submitted.";
    case "IDENTITY_VERIFICATION_EXPIRED":
      return "Your identity verification expired. Renew it before submitting credentials.";
    case "ACCOUNT_DISABLED":
      return "This account can't submit healthcare credentials.";
    case "UNAUTHORIZED":
    case "INVALID_SUPABASE_TOKEN":
      return "Your session expired. Sign out and back in, then try again.";
    case "USER_NOT_SYNCED":
      return "Your MediCN profile hasn't finished setting up. Sign out and back in, then retry.";
    default:
      return null;
  }
}

// --- client-side file validation (usability guard only) ---

export type FileRejectionCode = "unsupported_type" | "too_large";

export interface FileValidationResult {
  ok: boolean;
  code: FileRejectionCode | null;
  message: string | null;
}

export function isAllowedEvidenceType(
  type: string
): type is AllowedEvidenceType {
  return (ALLOWED_EVIDENCE_TYPES as readonly string[]).includes(type);
}

/**
 * Client MIME/size checks are a usability guard only — the backend DTO and the
 * media processor (magic bytes, decode limits) remain authoritative. PDFs and
 * every other format are rejected by the backend regardless.
 */
export function validateEvidenceFile(file: {
  type: string;
  size: number;
}): FileValidationResult {
  if (!isAllowedEvidenceType(file.type)) {
    return {
      ok: false,
      code: "unsupported_type",
      message: "Choose a JPEG, PNG, or WebP image. PDFs aren't accepted.",
    };
  }
  if (file.size > MAX_EVIDENCE_BYTES) {
    return {
      ok: false,
      code: "too_large",
      message: "Choose an image smaller than 10 MB.",
    };
  }
  return { ok: true, code: null, message: null };
}

/** Trimmed affiliation name must be 1-200 characters, matching the DTO. */
export function validateAffiliationName(raw: string): {
  trimmed: string;
  valid: boolean;
} {
  const trimmed = raw.trim();
  return { trimmed, valid: trimmed.length >= 1 && trimmed.length <= 200 };
}
