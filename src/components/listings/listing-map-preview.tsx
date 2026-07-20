import { ExternalLink, MapPin } from "lucide-react";
import type { PublicListingLocation } from "@/lib/api/types";

interface ListingMapPreviewProps {
  publicLocation: PublicListingLocation;
}

// Public listing map preview. The backend only exposes an APPROXIMATE location
// to ordinary visitors (city + a coarse center/radius), never a street address
// or exact pin. No Google Maps browser key is wired yet, so we link out at the
// city level instead of embedding an exact-pin map widget. The interactive
// approximate-area map is a later phase.
export default function ListingMapPreview({
  publicLocation,
}: ListingMapPreviewProps) {
  const { city } = publicLocation;
  const mapsUrl = city
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(city)}`
    : null;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Location</h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
          Approximate location
        </span>
      </div>
      <p className="flex items-center gap-1.5 text-sm text-slate-700">
        <MapPin className="size-4 shrink-0" aria-hidden="true" />
        {city || "Location not provided"}
      </p>
      <p className="text-xs text-slate-500">
        The exact address is shared with you after a booking is paid.
      </p>
      {mapsUrl && (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-sky-700 underline underline-offset-4 hover:text-sky-900"
        >
          View area on Google Maps
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      )}
    </div>
  );
}
