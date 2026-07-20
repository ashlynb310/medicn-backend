import { ExternalLink, MapPin } from "lucide-react";
import type { CheckInLocation } from "@/lib/api/types";

// Renders the exact check-in location. This component must only ever be given a
// `location` that came from the protected GET /bookings/:id response's
// `checkInLocation` field. It is NEVER derived from listing exactLocation /
// publicLocation, nor shown because the frontend thinks payment succeeded, and
// it never appears on booking cards/list pages.
export default function BookingCheckinLocation({
  location,
}: {
  location: CheckInLocation;
}) {
  const mapQuery =
    location.latitude !== null && location.longitude !== null
      ? `${location.latitude},${location.longitude}`
      : location.address;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    mapQuery
  )}`;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-green-200 bg-green-50/50 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-green-900">
        <MapPin className="size-4" aria-hidden="true" />
        Check-in location
      </h2>
      <p className="text-sm text-slate-800">{location.address}</p>
      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-sky-700 underline underline-offset-4 hover:text-sky-900"
      >
        Open in Google Maps
        <ExternalLink className="size-3.5" aria-hidden="true" />
      </a>
    </div>
  );
}
