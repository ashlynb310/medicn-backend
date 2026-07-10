import Link from "next/link";
import { ImageOff, MapPin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { ListingSummary } from "@/lib/api/types";
import {
  formatHostName,
  formatPriceWithUnit,
  formatStayDuration,
} from "@/lib/listing-format";

function isRenderableImageUrl(url: string | null): url is string {
  // Backend fileUrl can be a bare storage path when storage is not configured.
  return !!url && (url.startsWith("https://") || url.startsWith("http://"));
}

export default function ListingCard({ listing }: { listing: ListingSummary }) {
  return (
    <Card className="h-full transition-shadow hover:shadow-md">
      <Link
        href={`/listings/${listing.id}`}
        className="flex h-full flex-col outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
      >
        <div className="relative -mt-(--card-spacing) h-44 w-full overflow-hidden bg-slate-100">
          {isRenderableImageUrl(listing.coverPhotoUrl) ? (
            // eslint-disable-next-line @next/next/no-img-element -- backend photo hosts are env-dependent, so next/image remotePatterns cannot be pinned
            <img
              src={listing.coverPhotoUrl}
              alt={`Photo of ${listing.title}`}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex h-full w-full items-center justify-center text-slate-400"
            >
              <ImageOff className="size-8" />
            </div>
          )}
        </div>

        <CardContent className="flex grow flex-col gap-2 pt-4">
          <h3 className="text-base font-semibold leading-snug text-slate-900">
            {listing.title}
          </h3>

          <p className="flex items-center gap-1 text-sm text-slate-600">
            <MapPin className="size-4 shrink-0" aria-hidden="true" />
            {listing.city}
          </p>

          {listing.stayDurations.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {listing.stayDurations.map((duration) => (
                <li
                  key={duration}
                  className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800"
                >
                  {formatStayDuration(duration)}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-auto flex items-baseline justify-between gap-2 pt-2">
            <span className="text-base font-bold text-slate-900">
              {formatPriceWithUnit(
                listing.priceCents,
                listing.currency,
                listing.priceUnit
              )}
            </span>
            <span className="truncate text-sm text-slate-500">
              Hosted by {formatHostName(listing.host)}
            </span>
          </div>
        </CardContent>
      </Link>
    </Card>
  );
}
