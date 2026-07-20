const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True only for a canonical UUID string. Used to validate URL-supplied locators
 * (e.g. the checkout-return bookingId) before any API call — a missing or
 * malformed value must fall back safely instead of hitting the backend.
 */
export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
