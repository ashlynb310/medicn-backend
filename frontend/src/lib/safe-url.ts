// Shared validation for provider-issued redirect URLs (Stripe Connect account
// links, and any future hosted provider flow).
//
// Production accepts HTTPS only. Outside production, HTTP is additionally
// accepted for genuine loopback hosts so a local stack works — arbitrary
// production HTTP is never allowed. Anything else (javascript:, data:, blob:,
// file:, protocol-relative, relative, malformed) is refused.

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/** HTTP is permitted only outside production, and only for loopback. */
export function allowLoopbackHttpInThisEnvironment(): boolean {
  return process.env.NODE_ENV !== "production";
}

/**
 * Validates and normalizes a provider redirect URL, returning the canonical
 * href or null when it must not be used.
 */
export function normalizeProviderUrl(
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

export function isSafeProviderUrl(
  value: unknown,
  allowLoopbackHttp: boolean
): value is string {
  return normalizeProviderUrl(value, allowLoopbackHttp) !== null;
}

/**
 * Validates the complete short-lived Connect link response and returns only a
 * transient normalized URL. Provider data is intentionally never included in
 * a failure result.
 */
export function normalizeConnectAccountLinkUrl(
  value: unknown,
  expectedType: "account_onboarding" | "account_update",
  allowLoopbackHttp: boolean,
  nowMs = Date.now()
): string | null {
  if (typeof value !== "object" || value === null) return null;
  const link = value as {
    url?: unknown;
    expiresAt?: unknown;
    type?: unknown;
  };
  if (link.type !== expectedType || typeof link.expiresAt !== "string") {
    return null;
  }
  const expiresAtMs = Date.parse(link.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) return null;
  return normalizeProviderUrl(link.url, allowLoopbackHttp);
}
