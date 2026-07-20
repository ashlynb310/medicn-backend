// Generates a stable idempotency key for a single logical mutation attempt
// (e.g. one cancellation attempt). Callers keep the returned key and REUSE it
// across retries of the same attempt so the backend dedupes on it; they mint a
// new key only when starting a genuinely new attempt.
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID.
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}
