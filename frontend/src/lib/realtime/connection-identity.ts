// Opaque identity for a realtime connection attempt.
//
// A connection is defined by (access token, inquiry room). We must be able to
// tell "is this status from the CURRENT connection?" during render — without
// ever storing, hashing, interpolating, rendering, or persisting the access
// token. So the identity is an opaque object with no contents: a fresh one is
// minted whenever the dependency identity changes, and only reference equality
// is ever compared.

/** Why realtime is not live. Never exposes provider or token detail. */
export type FallbackReason =
  | "connecting"
  | "disconnected"
  | "unavailable"
  | "rate_limited"
  | "timeout";

/** Opaque — carries no data, only reference identity. */
export type ConnectionGeneration = object;

/**
 * Mints a fresh opaque identity. It takes NO arguments — the values that define
 * a connection (access token, room) are never passed in, read, stored, hashed,
 * or returned. Callers mint a new one when those values change.
 */
export function createConnectionGeneration(): ConnectionGeneration {
  return {};
}

export interface RealtimeConnectionStatus {
  generation: ConnectionGeneration;
  live: boolean;
  reason: FallbackReason | null;
}

export interface ResolvedRealtimeStatus {
  live: boolean;
  fallbackReason: FallbackReason | null;
}

/**
 * Resolves the status to display. A status recorded for a PREVIOUS generation
 * (token rotated, room changed) immediately resolves to a non-live "connecting"
 * state — no stale room/token liveness is ever shown, and no effect or timer is
 * needed to reset it.
 */
export function resolveRealtimeStatus(
  status: RealtimeConnectionStatus,
  generation: ConnectionGeneration
): ResolvedRealtimeStatus {
  if (status.generation !== generation) {
    return { live: false, fallbackReason: "connecting" };
  }
  return { live: status.live, fallbackReason: status.reason };
}
