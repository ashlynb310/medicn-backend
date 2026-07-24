import { apiFetch } from "./client";

// Host Stripe Connect payout onboarding (see medicn ConnectService/StripeService).
//
// MediCN never collects bank accounts, routing numbers, card details,
// government IDs, SSNs, tax IDs, or any payout credential — those are collected
// exclusively by Stripe's hosted onboarding. The only input this app sends is
// the two-letter country code the backend DTO requires.
//
// `hostUserId` exists on the backend DTOs for authorized ADMIN management of
// another Host. These self-service functions deliberately never send it, so the
// backend always resolves the caller's own account.

export type ConnectCapabilityStatus =
  | "pending"
  | "active"
  | "restricted"
  | "unsupported";

/** Exact allowlisted requirement shape returned by ConnectService. */
export interface SafeRequirement {
  status: "currently_due" | "past_due";
  awaitingActionFrom: "stripe" | "user";
  requestedReasonCodes: string[];
  restrictsCapabilities: string[];
}

/**
 * Mirrors ConnectService.toSafeAccount. `providerAccountId`/`apiModel` are part
 * of the response but are provider identifiers and are never rendered.
 */
export interface ConnectAccount {
  userId: string;
  providerAccountId: string;
  apiModel: string;
  country: string | null;
  currency: string | null;
  detailsSubmitted: boolean;
  transfersCapability: ConnectCapabilityStatus;
  transfersReady: boolean;
  payoutsEnabled: boolean | null;
  requirementsCurrentlyDue: SafeRequirement[];
  requirementsPastDue: SafeRequirement[];
  lastSynchronizedAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Mirrors StripeService.createRecipientAccountLink. The URL is a short-lived
 * Stripe-hosted link used transiently for a redirect — never rendered, logged,
 * persisted, or placed in a route.
 */
export interface ConnectAccountLink {
  url: string;
  expiresAt: string;
  type: "account_onboarding" | "account_update";
}

/**
 * POST /api/v1/connect/account — create or reuse the caller's connected
 * account. Body is exactly `{ country }` (two letters; the backend trims and
 * uppercases). Surfaces CONNECT_NOT_CONFIGURED, CONNECT_PROVIDER_UNAVAILABLE,
 * FORBIDDEN, VALIDATION_ERROR, and ACCOUNT_DISABLED via ApiError.
 */
export async function createConnectedAccount(
  country: string,
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data } = await apiFetch<ConnectAccount>("/connect/account", {
    method: "POST",
    body: { country },
    accessToken,
    signal,
  });
  return data;
}

/**
 * GET /api/v1/connect/account — the authoritative, freshly synchronized account
 * state. This is the ONLY source of readiness; returning from Stripe is never
 * proof that onboarding succeeded.
 */
export async function getConnectAccount(
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data } = await apiFetch<ConnectAccount>("/connect/account", {
    accessToken,
    signal,
  });
  return data;
}

/**
 * POST /api/v1/connect/onboarding-link — a Stripe-hosted onboarding link.
 * Requires an existing stored account (otherwise CONNECT_ONBOARDING_REQUIRED).
 */
export async function createConnectOnboardingLink(
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data } = await apiFetch<ConnectAccountLink>(
    "/connect/onboarding-link",
    { method: "POST", body: {}, accessToken, signal }
  );
  return data;
}

/**
 * POST /api/v1/connect/management-link — a Stripe-hosted account-update link
 * for a Host who has already onboarded.
 */
export async function createConnectManagementLink(
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data } = await apiFetch<ConnectAccountLink>(
    "/connect/management-link",
    { method: "POST", body: {}, accessToken, signal }
  );
  return data;
}
