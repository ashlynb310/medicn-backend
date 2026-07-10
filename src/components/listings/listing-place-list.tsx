import { ExternalLink } from "lucide-react";
import type { ListingPlace } from "@/lib/api/types";

function isSafeExternalUrl(url: string | null): url is string {
  return !!url && url.startsWith("https://");
}

function PlaceGroup({ title, places }: { title: string; places: ListingPlace[] }) {
  if (places.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <ul className="flex flex-col gap-1.5">
        {places.map((place) => (
          <li key={place.id} className="text-sm text-slate-700">
            {isSafeExternalUrl(place.mapsUrl) ? (
              <a
                href={place.mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sky-700 underline underline-offset-4 hover:text-sky-900"
              >
                {place.label}
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            ) : (
              place.label
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ListingPlaceList({
  places,
}: {
  places: ListingPlace[];
}) {
  if (places.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-slate-200 p-4">
      <h2 className="text-lg font-semibold text-slate-900">
        Around the neighborhood
      </h2>
      <PlaceGroup
        title="Neighborhood perks"
        places={places.filter((place) => place.type === "neighborhood_perk")}
      />
      <PlaceGroup
        title="Local recommendations"
        places={places.filter(
          (place) => place.type === "local_recommendation"
        )}
      />
    </div>
  );
}
