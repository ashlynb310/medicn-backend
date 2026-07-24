"use client";

import { useMemo } from "react";

// Curated fallback used only when the runtime lacks Intl.supportedValuesOf.
const FALLBACK_ZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "America/Mexico_City",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
];

/** True IANA validity check — the same intent as the backend timezone check. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function detectBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function allTimeZones(): string[] {
  try {
    const withValues = Intl as unknown as {
      supportedValuesOf?: (key: string) => string[];
    };
    const zones = withValues.supportedValuesOf?.("timeZone");
    if (Array.isArray(zones) && zones.length > 0) return zones;
  } catch {
    // fall through
  }
  return FALLBACK_ZONES;
}

// Native <select> is used deliberately: the full IANA list is long (~400
// entries) and native selects give free keyboard type-ahead and accessibility.
// Validated against real IANA zones so the browser never invents an
// authoritative value; the Host confirms the suggested zone.
export default function TimezoneSelect({
  id,
  value,
  onChange,
  ariaDescribedBy,
}: {
  id: string;
  value: string;
  onChange: (timeZone: string) => void;
  ariaDescribedBy?: string;
}) {
  const zones = useMemo(() => {
    const list = allTimeZones();
    // Guarantee the current value is selectable even if unusual.
    return value && !list.includes(value) ? [value, ...list] : list;
  }, [value]);

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-describedby={ariaDescribedBy}
      className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
    >
      {zones.map((zone) => (
        <option key={zone} value={zone}>
          {zone}
        </option>
      ))}
    </select>
  );
}
