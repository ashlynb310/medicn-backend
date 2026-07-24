// Civil dates are wall-calendar dates ("YYYY-MM-DD") with no time or offset.
// Listing availability and booking ranges are half-open [startDate, endDate).
//
// "Today" for a listing must be computed in the LISTING's IANA timezone, never
// the browser's — a renter in Los Angeles booking a Tokyo listing must see
// Tokyo's current date. Never use `new Date().toISOString().slice(0, 10)` for
// listing-facing dates; it silently uses UTC.

export type CivilDate = string;

const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isCivilDate(value: string): boolean {
  return CIVIL_DATE_PATTERN.test(value);
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/**
 * The current civil date in `timeZone`. Uses Intl parts so it is correct across
 * locales; falls back to UTC when the timezone is invalid (mirrors the backend
 * default of UTC for legacy rows).
 */
export function todayInTimeZone(timeZone: string): CivilDate {
  const zone = safeZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

/**
 * Adds `days` (may be negative) to a civil date, returning a civil date. Uses
 * UTC calendar arithmetic, which is correct because a civil date carries no
 * timezone — only the Y/M/D calendar advances.
 */
export function addDays(civil: CivilDate, days: number): CivilDate {
  const [year, month, day] = civil.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(
    date.getUTCDate()
  )}`;
}

/** Lexical comparison is a valid ordering for `YYYY-MM-DD` civil dates. */
export function compareCivil(a: CivilDate, b: CivilDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Half-open [start, end) overlap test. Two ranges overlap when each starts
 * before the other ends. Adjacent ranges (a.end === b.start) do NOT overlap,
 * matching the backend's exclusive end dates.
 */
export function civilRangesOverlap(
  a: { startDate: CivilDate; endDate: CivilDate },
  b: { startDate: CivilDate; endDate: CivilDate }
): boolean {
  return a.startDate < b.endDate && b.startDate < a.endDate;
}

export function civilRangeOverlapsAny(
  range: { startDate: CivilDate; endDate: CivilDate },
  ranges: Array<{ startDate: CivilDate; endDate: CivilDate }>
): boolean {
  return ranges.some((other) => civilRangesOverlap(range, other));
}
