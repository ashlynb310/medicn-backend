import type {
  IdentityVerificationAction,
  IdentityVerificationStatus,
} from "@/lib/api/auth";

// Pure presentation + safety logic for Veriff IDENTITY verification.
// Identity verification confirms who someone is. It does NOT verify medical
// employment, school affiliation, or professional licensing — that is the
// separate healthcare-credential workflow.

export type IdentityTone = "neutral" | "info" | "warning" | "success" | "danger";

export interface IdentityStatusPresentation {
  label: string;
  tone: IdentityTone;
  description: string;
}

const STATUS_PRESENTATION: Record<
  IdentityVerificationStatus,
  IdentityStatusPresentation
> = {
  not_started: {
    label: "Not started",
    tone: "neutral",
    description:
      "You haven't started identity verification yet.",
  },
  created: {
    label: "In progress",
    tone: "info",
    description:
      "Your verification session is open but not finished. Continue where you left off.",
  },
  submitted: {
    label: "Submitted",
    tone: "info",
    description:
      "Your documents were submitted. The provider's decision is confirmed by MediCN, not by returning to this page.",
  },
  review: {
    label: "In review",
    tone: "info",
    description:
      "Your verification is being reviewed. This page updates when the decision arrives.",
  },
  resubmission_requested: {
    label: "More information needed",
    tone: "warning",
    description:
      "The provider needs another submission before a decision can be made.",
  },
  approved: {
    label: "Approved",
    tone: "success",
    description: "Your identity has been verified.",
  },
  declined: {
    label: "Declined",
    tone: "danger",
    description: "Your identity verification was not approved.",
  },
  expired: {
    label: "Expired",
    tone: "warning",
    description: "Your verification session expired before it was completed.",
  },
  abandoned: {
    label: "Not completed",
    tone: "warning",
    description: "Your previous verification attempt was not completed.",
  },
};

export function describeIdentityStatus(
  status: IdentityVerificationStatus
): IdentityStatusPresentation {
  return (
    STATUS_PRESENTATION[status] ?? {
      label: status,
      tone: "neutral",
      description: "",
    }
  );
}

/**
 * Button label for the backend-provided `actionRequired`. `wait` and `none`
 * return null — no start button is offered in those states.
 */
export function identityActionLabel(
  action: IdentityVerificationAction
): string | null {
  switch (action) {
    case "start":
      return "Start identity verification";
    case "continue":
      return "Continue verification";
    case "resubmit":
      return "Resubmit verification";
    case "retry":
      return "Try identity verification again";
    case "wait":
    case "none":
    default:
      return null;
  }
}

// Statuses where the backend has reached a final decision for this attempt.
const TERMINAL: ReadonlySet<IdentityVerificationStatus> = new Set([
  "approved",
  "declined",
  "expired",
  "abandoned",
]);

// Statuses awaiting a provider webhook — the only ones worth polling.
const POLLABLE: ReadonlySet<IdentityVerificationStatus> = new Set([
  "submitted",
  "review",
]);

export function isTerminalIdentityStatus(
  status: IdentityVerificationStatus
): boolean {
  return TERMINAL.has(status);
}

export function isPollableIdentityStatus(
  status: IdentityVerificationStatus
): boolean {
  return POLLABLE.has(status);
}

/**
 * Bounded polling decision. Polling continues only while the status is awaiting
 * a decision AND the attempt budget is unspent. Terminal states, actionable
 * states, and an exhausted budget all stop it (the UI then offers Refresh).
 */
export function shouldContinueIdentityPolling(
  status: IdentityVerificationStatus,
  attempts: number,
  maxAttempts: number
): boolean {
  if (!isPollableIdentityStatus(status)) return false;
  return attempts < maxAttempts;
}

export type SessionOutcome =
  | { kind: "redirect"; url: string }
  | { kind: "approved" }
  | { kind: "error" };

/**
 * Decides what to do with a POST /identity/verifications/session response.
 *
 * The backend legitimately returns `status: "approved"` with
 * `verificationUrl: null` — there is nothing left to verify. That is NOT an
 * error: the caller refetches the authoritative status and refreshes the
 * profile instead of showing a failure. For any non-approved status, a missing
 * or unsafe URL remains an honest error, and approval is only ever displayed
 * from the backend's own current status.
 */
export function resolveSessionOutcome(session: {
  status: IdentityVerificationStatus;
  verificationUrl: string | null;
}): SessionOutcome {
  if (session.status === "approved") return { kind: "approved" };
  if (isSafeHostedUrl(session.verificationUrl)) {
    return { kind: "redirect", url: session.verificationUrl };
  }
  return { kind: "error" };
}

/**
 * A session response must be ignored when its request was aborted (unmount or
 * token change) or when a newer attempt replaced it. A stale response must
 * never navigate the browser or update the page.
 */
export function isStaleSessionAttempt(
  aborted: boolean,
  isCurrentAttempt: boolean
): boolean {
  return aborted || !isCurrentAttempt;
}

/**
 * Accepts ONLY an absolute http/https URL, which is the sole shape the backend
 * hosted-session contract can produce. Rejects javascript:/data:/blob: schemes,
 * protocol-relative and relative paths, and malformed input, so a compromised or
 * unexpected value can never become a navigation target.
 */
export function isSafeHostedUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  // Reject protocol-relative ("//evil.example") before URL parsing.
  if (trimmed.startsWith("//")) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false; // relative or malformed
  }
  return parsed.protocol === "https:" || parsed.protocol === "http:";
}
