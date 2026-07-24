import { ExternalLink, Navigation } from "lucide-react";
import type { ListingNearbyPlace } from "@/lib/api/types";
import { formatEnumLabel } from "@/lib/listing-format";

function formatApproxDistance(meters: number | null): string | null {
  if (meters === null || !Number.isFinite(meters)) return null;
  if (meters < 1000) return `~${Math.round(meters)} m`;
  return `~${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

// Renders backend-provided nearby places. Links are safe, destination-only
// Google Maps searches supplied by the backend — the exact listing location is
// never used as a directions origin. Straight-line distances are labeled
// approximate; route duration is shown only when the backend returns it.
export default function NearbyPlacesList({
  nearbyPlaces,
}: {
  nearbyPlaces: ListingNearbyPlace[];
}) {
  if (!nearbyPlaces || nearbyPlaces.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4">
      <h2 className="text-lg font-semibold text-slate-900">What&apos;s nearby</h2>
      <ul className="flex flex-col gap-2">
        {nearbyPlaces.map((place, index) => {
          const distance = formatApproxDistance(
            place.routeDistanceMeters ?? place.approximateDistanceMeters
          );
          const duration = formatDuration(place.routeDurationSeconds);
          return (
            <li
              key={`${place.name}-${index}`}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2 last:border-b-0"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium text-slate-800">
                  {place.name}
                </span>
                <span className="text-xs text-slate-500">
                  {formatEnumLabel(place.category)}
                  {distance ? ` · ${distance} away` : ""}
                  {duration
                    ? ` · ${duration}${
                        place.travelMode
                          ? ` ${formatEnumLabel(place.travelMode).toLowerCase()}`
                          : ""
                      }`
                    : ""}
                </span>
              </div>
              {place.mapsUrl && (
                <a
                  href={place.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-sky-700 underline underline-offset-4 hover:text-sky-900"
                >
                  <Navigation className="size-3.5" aria-hidden="true" />
                  Map
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-slate-500">Distances are approximate.</p>
    </div>
  );
}
