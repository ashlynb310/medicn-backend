import { ExternalLink, MapPin } from "lucide-react";

interface ListingMapPreviewProps {
  city: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}

export default function ListingMapPreview({
  city,
  address,
  latitude,
  longitude,
}: ListingMapPreviewProps) {
  // No Google Maps browser key is configured yet, so link out instead of
  // embedding a map widget. Missing coordinates must not block the page.
  const query =
    latitude !== null && longitude !== null
      ? `${latitude},${longitude}`
      : [address, city].filter(Boolean).join(", ");

  const mapsUrl = query
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
    : null;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-200 p-4">
      <h2 className="text-lg font-semibold text-slate-900">Location</h2>
      <p className="flex items-center gap-1.5 text-sm text-slate-700">
        <MapPin className="size-4 shrink-0" aria-hidden="true" />
        {[address, city].filter(Boolean).join(", ") || "Location not provided"}
      </p>
      {mapsUrl && (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-sky-700 underline underline-offset-4 hover:text-sky-900"
        >
          View on Google Maps
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      )}
    </div>
  );
}
