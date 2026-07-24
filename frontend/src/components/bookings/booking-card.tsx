import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BookingStatusBadge } from "@/components/ui/status-badge";
import type { Booking } from "@/lib/api/types";
import { formatPrice, formatDate } from "@/lib/listing-format";

export default function BookingCard({
  booking,
  currentUserId,
}: {
  booking: Booking;
  /** Used to label the user's role on this booking (renter vs host). */
  currentUserId?: string;
}) {
  const isHost = currentUserId != null && booking.hostId === currentUserId;

  return (
    <Link
      href={`/bookings/${booking.id}`}
      className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-900">
          {booking.listing.title}
        </h3>
        <BookingStatusBadge status={booking.status} />
      </div>

      <p className="flex items-center gap-1.5 text-sm text-slate-600">
        <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
        {formatDate(booking.startDate)} – {formatDate(booking.endDate)}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone={isHost ? "accent" : "neutral"}>
          {isHost ? "As host" : "As renter"}
        </Badge>
        <span className="text-sm font-semibold text-slate-900">
          {formatPrice(booking.totalAmountCents, booking.currency)}
        </span>
      </div>
    </Link>
  );
}
