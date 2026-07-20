import { AvailabilityStatus } from "@prisma/client";
import {
  formatCivilDate,
  isRangeBookable,
  isValidIanaTimeZone,
  mergeDateRanges,
  parseCivilDate,
  projectUnavailableRanges
} from "../src/listings/availability-calendar";

const range = (startDate: string, endDate: string) => ({
  startDate: parseCivilDate(startDate),
  endDate: parseCivilDate(endDate)
});

describe("local civil availability rules", () => {
  it("accepts only real ISO civil dates and preserves them without timezone conversion", () => {
    expect(formatCivilDate(parseCivilDate("2028-02-29"))).toBe("2028-02-29");
    expect(() => parseCivilDate("2027-02-29")).toThrow("VALIDATION_ERROR");
    expect(() => parseCivilDate("2027-02-01T00:00:00Z")).toThrow(
      "VALIDATION_ERROR"
    );
  });

  it("validates IANA zones and rejects offsets or browser-style abbreviations", () => {
    expect(isValidIanaTimeZone("America/Chicago")).toBe(true);
    expect(isValidIanaTimeZone("UTC")).toBe(true);
    expect(isValidIanaTimeZone("-06:00")).toBe(false);
    expect(isValidIanaTimeZone("CST")).toBe(false);
    expect(isValidIanaTimeZone("America/Not_A_Zone")).toBe(false);
  });

  it("keeps DST-crossing stays as civil dates rather than 23/25-hour instants", () => {
    const stay = range("2026-03-07", "2026-03-10");
    expect(formatCivilDate(stay.startDate)).toBe("2026-03-07");
    expect(formatCivilDate(stay.endDate)).toBe("2026-03-10");
    expect(isValidIanaTimeZone("America/New_York")).toBe(true);
  });

  it("uses half-open boundaries so adjacent ranges do not overlap", () => {
    const windows = [
      { ...range("2026-08-01", "2026-08-05"), status: AvailabilityStatus.available },
      { ...range("2026-08-05", "2026-08-07"), status: AvailabilityStatus.blocked }
    ];
    expect(isRangeBookable(range("2026-08-01", "2026-08-05"), windows)).toBe(
      true
    );
    expect(isRangeBookable(range("2026-08-04", "2026-08-06"), windows)).toBe(
      false
    );
  });

  it("lets blocked windows win over overlapping available windows", () => {
    const windows = [
      { ...range("2026-09-01", "2026-09-20"), status: AvailabilityStatus.available },
      { ...range("2026-09-10", "2026-09-12"), status: AvailabilityStatus.blocked }
    ];
    expect(isRangeBookable(range("2026-09-09", "2026-09-11"), windows)).toBe(
      false
    );
    expect(isRangeBookable(range("2026-09-12", "2026-09-14"), windows)).toBe(
      true
    );
  });

  it("merges overlapping and adjacent unavailable ranges", () => {
    expect(
      mergeDateRanges([
        range("2026-10-01", "2026-10-04"),
        range("2026-10-03", "2026-10-06"),
        range("2026-10-06", "2026-10-08")
      ]).map(({ startDate, endDate }) => ({
        startDate: formatCivilDate(startDate),
        endDate: formatCivilDate(endDate)
      }))
    ).toEqual([{ startDate: "2026-10-01", endDate: "2026-10-08" }]);
  });

  it("projects availability gaps, blocked windows, and reservations as unavailable", () => {
    const unavailable = projectUnavailableRanges(
      range("2026-11-01", "2026-11-10"),
      [
        { ...range("2026-11-02", "2026-11-09"), status: AvailabilityStatus.available },
        { ...range("2026-11-05", "2026-11-06"), status: AvailabilityStatus.blocked }
      ],
      [range("2026-11-07", "2026-11-08")]
    );

    expect(
      unavailable.map(({ startDate, endDate }) => ({
        startDate: formatCivilDate(startDate),
        endDate: formatCivilDate(endDate)
      }))
    ).toEqual([
      { startDate: "2026-11-01", endDate: "2026-11-02" },
      { startDate: "2026-11-05", endDate: "2026-11-06" },
      { startDate: "2026-11-07", endDate: "2026-11-08" },
      { startDate: "2026-11-09", endDate: "2026-11-10" }
    ]);
  });
});
