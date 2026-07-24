// Executable checks for the civil-date helpers and half-open overlap logic.
// Run with:  npm test   (node --test "tests/**/*.test.mts")
// Node 22+/24 runs .ts directly via native type stripping — no test framework
// is added to the project. This file is excluded from tsconfig and eslint.
import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  civilRangeOverlapsAny,
  civilRangesOverlap,
  compareCivil,
  isCivilDate,
  todayInTimeZone,
} from "../src/lib/civil-date.ts";

test("isCivilDate accepts YYYY-MM-DD and rejects other shapes", () => {
  assert.equal(isCivilDate("2026-07-19"), true);
  assert.equal(isCivilDate("2026-7-9"), false);
  assert.equal(isCivilDate("2026-07-19T00:00:00Z"), false);
  assert.equal(isCivilDate("not-a-date"), false);
});

test("addDays advances the calendar across month and year boundaries", () => {
  assert.equal(addDays("2026-07-19", 1), "2026-07-20");
  assert.equal(addDays("2026-07-31", 1), "2026-08-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29"); // leap year
  assert.equal(addDays("2026-01-01", 365), "2027-01-01");
});

test("todayInTimeZone can differ across zones at the same instant", () => {
  const chicago = todayInTimeZone("America/Chicago");
  const tokyo = todayInTimeZone("Asia/Tokyo");
  assert.ok(isCivilDate(chicago));
  assert.ok(isCivilDate(tokyo));
  // Tokyo is never behind Chicago on the calendar.
  assert.ok(compareCivil(tokyo, chicago) >= 0);
});

test("todayInTimeZone falls back to UTC for an invalid zone", () => {
  const utc = todayInTimeZone("UTC");
  const bogus = todayInTimeZone("Not/AZone");
  assert.equal(bogus, utc);
});

test("civilRangesOverlap uses half-open [start, end) semantics", () => {
  // Adjacent ranges do NOT overlap (end is exclusive).
  assert.equal(
    civilRangesOverlap(
      { startDate: "2026-07-01", endDate: "2026-07-05" },
      { startDate: "2026-07-05", endDate: "2026-07-10" }
    ),
    false
  );
  // Genuine overlap.
  assert.equal(
    civilRangesOverlap(
      { startDate: "2026-07-01", endDate: "2026-07-06" },
      { startDate: "2026-07-05", endDate: "2026-07-10" }
    ),
    true
  );
  // Full containment.
  assert.equal(
    civilRangesOverlap(
      { startDate: "2026-07-01", endDate: "2026-07-31" },
      { startDate: "2026-07-10", endDate: "2026-07-12" }
    ),
    true
  );
  // Disjoint.
  assert.equal(
    civilRangesOverlap(
      { startDate: "2026-07-01", endDate: "2026-07-05" },
      { startDate: "2026-08-01", endDate: "2026-08-05" }
    ),
    false
  );
});

test("civilRangeOverlapsAny detects any overlapping range", () => {
  const unavailable = [
    { startDate: "2026-07-10", endDate: "2026-07-15" },
    { startDate: "2026-08-01", endDate: "2026-08-03" },
  ];
  assert.equal(
    civilRangeOverlapsAny(
      { startDate: "2026-07-14", endDate: "2026-07-16" },
      unavailable
    ),
    true
  );
  assert.equal(
    civilRangeOverlapsAny(
      { startDate: "2026-07-16", endDate: "2026-07-20" },
      unavailable
    ),
    false
  );
});
