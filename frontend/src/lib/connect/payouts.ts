import type { ConnectAccount, SafeRequirement } from "@/lib/api/connect";

// Pure presentation logic for Host payout readiness. The backend is
// authoritative for every value here; this module only maps real fields to
// labels. It never infers readiness from a Stripe redirect and never implies a
// bank payout has occurred.

export type PayoutTone = "neutral" | "info" | "warning" | "success" | "danger";

export type PayoutReadinessState =
  | "not_created"
  | "pending"
  | "requirements_due"
  | "requirements_past_due"
  | "restricted"
  | "ready";

export interface PayoutReadiness {
  state: PayoutReadinessState;
  label: string;
  tone: PayoutTone;
  description: string;
  /** Whether Stripe-hosted onboarding should be offered. */
  needsOnboarding: boolean;
}

const READINESS: Record<PayoutReadinessState, Omit<PayoutReadiness, "state">> = {
  not_created: {
    label: "Not set up",
    tone: "neutral",
    description:
      "Set up payouts to receive money for paid bookings. Stripe collects and verifies your details — MediCN never sees them.",
    needsOnboarding: true,
  },
  pending: {
    label: "Pending verification",
    tone: "info",
    description:
      "Stripe is reviewing your details. This can take a little while; refresh to see the latest status.",
    needsOnboarding: true,
  },
  requirements_due: {
    label: "Information needed",
    tone: "warning",
    description:
      "Stripe needs more information before you can receive transfers. Continue in Stripe to provide it.",
    needsOnboarding: true,
  },
  requirements_past_due: {
    label: "Action required",
    tone: "danger",
    description:
      "Stripe has overdue requirements on your account. Transfers stay blocked until you resolve them in Stripe.",
    needsOnboarding: true,
  },
  restricted: {
    label: "Restricted",
    tone: "danger",
    description:
      "Stripe has restricted transfers for this account. Continue in Stripe to review what's required.",
    needsOnboarding: true,
  },
  ready: {
    label: "Ready",
    tone: "success",
    description:
      "Stripe reports your account can receive transfers for paid bookings.",
    needsOnboarding: false,
  },
};

export function hasRequirements(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isSafeRequirement(value: unknown): value is SafeRequirement {
  if (typeof value !== "object" || value === null) return false;
  const requirement = value as Partial<Record<keyof SafeRequirement, unknown>>;
  return (
    (requirement.status === "currently_due" ||
      requirement.status === "past_due") &&
    (requirement.awaitingActionFrom === "stripe" ||
      requirement.awaitingActionFrom === "user") &&
    isStringArray(requirement.requestedReasonCodes) &&
    isStringArray(requirement.restrictsCapabilities)
  );
}

export interface ConnectRequirementSummary {
  key: string;
  text: string;
}

/**
 * Converts backend requirements into allowlisted prose. Raw reason codes and
 * capability keys are deliberately not rendered. Malformed legacy JSON still
 * produces an honest generic action state and can never become a React child.
 */
export function summarizeConnectRequirements(
  value: unknown,
  expectedStatus: SafeRequirement["status"]
): ConnectRequirementSummary[] {
  if (!hasRequirements(value)) return [];
  const entries = Array.isArray(value) ? value : [value];
  return entries.map((entry, index) => {
    if (!isSafeRequirement(entry) || entry.status !== expectedStatus) {
      return {
        key: `${expectedStatus}-unknown-${index}`,
        text: "Stripe requires additional information.",
      };
    }
    return {
      key: `${expectedStatus}-${entry.awaitingActionFrom}-${index}`,
      text:
        entry.awaitingActionFrom === "stripe"
          ? "Stripe is reviewing information for this requirement."
          : "Stripe requires additional information from you.",
    };
  });
}

/**
 * Derives readiness from the backend account, worst-problem-first so a blocking
 * condition is never hidden behind a friendlier one. Readiness requires BOTH
 * transfersReady and payoutsEnabled === true; a null payoutsEnabled (unknown)
 * is never treated as ready.
 */
export function describePayoutReadiness(
  account: ConnectAccount | null
): PayoutReadiness {
  if (!account) return { state: "not_created", ...READINESS.not_created };

  if (hasRequirements(account.requirementsPastDue)) {
    return { state: "requirements_past_due", ...READINESS.requirements_past_due };
  }
  if (
    account.transfersCapability === "restricted" ||
    account.transfersCapability === "unsupported"
  ) {
    return { state: "restricted", ...READINESS.restricted };
  }
  if (hasRequirements(account.requirementsCurrentlyDue)) {
    return { state: "requirements_due", ...READINESS.requirements_due };
  }
  if (account.transfersReady && account.payoutsEnabled === true) {
    return { state: "ready", ...READINESS.ready };
  }
  return { state: "pending", ...READINESS.pending };
}

// --- null-safe field display ---

export function formatCountry(country: string | null | undefined): string {
  const trimmed = typeof country === "string" ? country.trim() : "";
  return trimmed.length > 0 ? trimmed.toUpperCase() : "Not set";
}

export function formatCurrency(currency: string | null | undefined): string {
  const trimmed = typeof currency === "string" ? currency.trim() : "";
  return trimmed.length > 0 ? trimmed.toUpperCase() : "Not set";
}

/** Tri-state booleans (payoutsEnabled may be null = not yet reported). */
export function formatTriState(value: boolean | null | undefined): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Not reported";
}

export function formatCapability(value: string | null | undefined): string {
  if (!value) return "Not reported";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatSynchronizedAt(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// --- country input (the only field MediCN collects) ---

const COUNTRY_PATTERN = /^[A-Za-z]{2}$/;

export interface CountryInputState {
  normalized: string;
  valid: boolean;
}

/** Matches the backend DTO exactly: trimmed, uppercased, two letters. */
export function normalizeCountryInput(raw: string): CountryInputState {
  const trimmed = raw.trim();
  return {
    normalized: trimmed.toUpperCase(),
    valid: COUNTRY_PATTERN.test(trimmed),
  };
}

// --- request ownership ---

/**
 * A response must be ignored when its request was aborted (unmount, token
 * change) or superseded by a newer attempt. A stale response must never
 * redirect the browser or update visible state.
 */
export function isStaleConnectRequest(
  aborted: boolean,
  isCurrentAttempt: boolean
): boolean {
  return aborted || !isCurrentAttempt;
}

/** React state owner key: token rotation intentionally does not participate. */
export function connectStateOwnerKey(
  userId: string,
  mode?: "return" | "refresh"
): string {
  return mode ? `${userId}:${mode}` : userId;
}

export interface ConnectErrorRecoveryInput {
  code: string;
  status: number | null;
  retryAfter: number | null;
}

export function connectErrorRecovery(
  error: ConnectErrorRecoveryInput,
  fallback: string | null
): string | null {
  const isRateLimited =
    error.status === 429 ||
    error.code === "RATE_LIMIT_EXCEEDED" ||
    error.code === "RATE_LIMITED";
  if (!isRateLimited) return fallback;
  return error.retryAfter !== null
    ? `Too many attempts. Try again in about ${error.retryAfter}s.`
    : "Too many attempts. Please wait a moment and try again.";
}

/** Only a Host may see payout setup; role visibility, not authorization. */
export function canViewPayoutSettings(
  roles: readonly string[] | null | undefined
): boolean {
  return Array.isArray(roles) && roles.includes("host");
}
