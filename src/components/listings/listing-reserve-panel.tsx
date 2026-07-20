"use client";

import { useEffect, useState } from "react";
import { CalendarOff } from "lucide-react";
import BookingRequestForm from "@/components/bookings/booking-request-form";
import { getPublicListingCalendar } from "@/lib/api/listings";
import type { CivilDateRange, PriceUnit, StayDuration } from "@/lib/api/types";
import { formatDate } from "@/lib/listing-format";
import { addDays, todayInTimeZone } from "@/lib/civil-date";

interface ReserveListing {
  id: string;
  priceCents: number;
  currency: string;
  priceUnit: PriceUnit;
  stayDurations: StayDuration[];
  timeZone: string;
}

// Client panel for an approved listing: fetches the public calendar (unavailable
// dates only — never revealing whether a date is blocked or reserved) and wires
// those ranges into the booking form's advisory validation. Calendar failure
// degrades gracefully: the booking form still renders (the backend remains
// authoritative on availability).
export default function ListingReservePanel({
  listing,
}: {
  listing: ReserveListing;
}) {
  const [unavailable, setUnavailable] = useState<CivilDateRange[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const start = todayInTimeZone(listing.timeZone);
    const end = addDays(start, 180);
    getPublicListingCalendar(listing.id, { startDate: start, endDate: end }, controller.signal)
      .then((calendar) => setUnavailable(calendar.unavailable))
      .catch(() => {
        // Non-fatal: booking stays available; backend validates on submit.
      });
    return () => controller.abort();
  }, [listing.id, listing.timeZone]);

  return (
    <div className="flex flex-col gap-4">
      <BookingRequestForm
        listing={listing}
        timeZone={listing.timeZone}
        unavailableRanges={unavailable}
      />
      {unavailable.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <CalendarOff className="size-4" aria-hidden="true" />
            Unavailable dates
          </h2>
          <ul className="flex flex-col gap-1.5">
            {unavailable.slice(0, 12).map((range, index) => (
              <li
                key={`${range.startDate}-${range.endDate}-${index}`}
                className="text-sm text-slate-600"
              >
                {formatDate(range.startDate)} → {formatDate(range.endDate)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
