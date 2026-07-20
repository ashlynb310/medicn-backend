import { ExternalLink } from "lucide-react";
import ApproximateLocationMap from "@/components/maps/approximate-location-map";
import type { PublicListingLocation } from "@/lib/api/types";

interface ListingMapPreviewProps {
  publicLocation: PublicListingLocation;
}

function formatRadius(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return "";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

// Public listing map preview. The backend only exposes an APPROXIMATE location
// to ordinary visitors (city + a coarse center/radius), never a street address
// or exact pin. We render a non-interactive approximate-area disc (not an exact
// marker) plus the label, and — with no Google Maps browser key wired — link out
// at the city level. This works with no key and leaks nothing.
export default function ListingMapPreview({
  publicLocation,
}: ListingMapPreviewProps) {
  const { city, radiusMeters, latitude, longitude } = publicLocation;
  const radiusLabel = formatRadius(radiusMeters);
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

      {/* Approximate-area treatment: a real circle when keyed + coords exist,
          otherwise a neutral area. Never an exact-property pin. */}
      <ApproximateLocationMap
        latitude={latitude}
        longitude={longitude}
        radiusMeters={radiusMeters}
        city={city}
      />

      <p className="text-sm text-slate-700">
        {city || "Location not provided"}
        {radiusLabel ? ` · approximate area (~${radiusLabel} radius)` : ""}
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
