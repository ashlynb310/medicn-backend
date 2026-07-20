import { AvailabilityStatus } from "@prisma/client";

export interface CivilDateRange {
  startDate: Date;
  endDate: Date;
}

export interface AvailabilityRange extends CivilDateRange {
  status: AvailabilityStatus;
}

export const CIVIL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseCivilDate(value: string) {
  const match = CIVIL_DATE_PATTERN.exec(value);
  if (!match) throw invalidCivilDate();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw invalidCivilDate();
  }
  return date;
}

export function formatCivilDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function isValidIanaTimeZone(value: string) {
  if (value !== "UTC" && !value.includes("/")) return false;
  try {
    return (
      new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions()
        .timeZone === value
    );
  } catch {
    return false;
  }
}

export function rangesOverlap(left: CivilDateRange, right: CivilDateRange) {
  return left.startDate < right.endDate && left.endDate > right.startDate;
}

export function isRangeBookable(
  requested: CivilDateRange,
  windows: AvailabilityRange[]
) {
  if (requested.endDate <= requested.startDate) return false;
  if (
    windows.some(
      (window) =>
        window.status === AvailabilityStatus.blocked &&
        rangesOverlap(requested, window)
    )
  ) {
    return false;
  }
  const available = mergeDateRanges(
    windows.filter((window) => window.status === AvailabilityStatus.available)
  );
  if (available.length === 0) return true;
  return available.some(
    (window) =>
      window.startDate <= requested.startDate &&
      window.endDate >= requested.endDate
  );
}

export function mergeDateRanges(ranges: CivilDateRange[]) {
  const ordered = ranges
    .filter(({ startDate, endDate }) => endDate > startDate)
    .map(({ startDate, endDate }) => ({ startDate, endDate }))
    .sort(
      (left, right) =>
        left.startDate.getTime() - right.startDate.getTime() ||
        left.endDate.getTime() - right.endDate.getTime()
    );
  const merged: CivilDateRange[] = [];
  for (const current of ordered) {
    const previous = merged.at(-1);
    if (!previous || current.startDate > previous.endDate) {
      merged.push({ ...current });
      continue;
    }
    if (current.endDate > previous.endDate) previous.endDate = current.endDate;
  }
  return merged;
}

export function projectUnavailableRanges(
  query: CivilDateRange,
  windows: AvailabilityRange[],
  reservations: CivilDateRange[]
) {
  const unavailable: CivilDateRange[] = [];
  const available = mergeDateRanges(
    windows.filter((window) => window.status === AvailabilityStatus.available)
  );
  if (available.length > 0) {
    let cursor = query.startDate;
    for (const window of available) {
      const clipped = clipRange(window, query);
      if (!clipped) continue;
      if (clipped.startDate > cursor) {
        unavailable.push({ startDate: cursor, endDate: clipped.startDate });
      }
      if (clipped.endDate > cursor) cursor = clipped.endDate;
    }
    if (cursor < query.endDate) {
      unavailable.push({ startDate: cursor, endDate: query.endDate });
    }
  }
  for (const range of [
    ...windows.filter((window) => window.status === AvailabilityStatus.blocked),
    ...reservations
  ]) {
    const clipped = clipRange(range, query);
    if (clipped) unavailable.push(clipped);
  }
  return mergeDateRanges(unavailable);
}

function clipRange(range: CivilDateRange, bounds: CivilDateRange) {
  const startDate = range.startDate > bounds.startDate ? range.startDate : bounds.startDate;
  const endDate = range.endDate < bounds.endDate ? range.endDate : bounds.endDate;
  return endDate > startDate ? { startDate, endDate } : null;
}

function invalidCivilDate() {
  return new Error("VALIDATION_ERROR: date must use a real YYYY-MM-DD civil date.");
}
