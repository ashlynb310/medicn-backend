import { CalendarDays } from "lucide-react";
import type { ListingAvailabilityWindow } from "@/lib/api/types";
import { formatDate, formatEnumLabel } from "@/lib/listing-format";

export default function AvailabilitySummary({
  availability,
}: {
  availability: ListingAvailabilityWindow[];
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
        <CalendarDays className="size-5" aria-hidden="true" />
        Availability
      </h2>
      {availability.length === 0 ? (
        <p className="text-sm text-slate-600">
          No availability windows are published for this listing yet. Contact
          the host for dates.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {availability.map((window) => (
            <li
              key={window.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"
            >
              <span className="font-medium text-slate-800">
                {formatDate(window.startDate)} – {formatDate(window.endDate)}
              </span>
              <span
                className={
                  window.status === "available"
                    ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800"
                    : "rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700"
                }
              >
                {formatEnumLabel(window.status)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
