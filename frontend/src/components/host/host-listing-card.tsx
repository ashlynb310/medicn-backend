import Link from "next/link";
import { ImageOff, MapPin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ListingStatusBadge } from "@/components/ui/status-badge";
import type { ListingSummary } from "@/lib/api/types";
import { formatPriceWithUnit } from "@/lib/listing-format";

function isRenderableImageUrl(url: string | null): url is string {
  return !!url && (url.startsWith("https://") || url.startsWith("http://"));
}

export default function HostListingCard({
  listing,
}: {
  listing: ListingSummary;
}) {
  return (
    <Card className="h-full transition-shadow hover:shadow-md">
      <Link
        href={`/host/listings/${listing.id}`}
        className="flex h-full flex-col rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="relative -mt-(--card-spacing) h-40 w-full overflow-hidden bg-slate-100">
          {isRenderableImageUrl(listing.coverPhotoUrl) ? (
            // eslint-disable-next-line @next/next/no-img-element -- backend photo hosts are env-dependent
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
          <span className="absolute left-2 top-2">
            <ListingStatusBadge status={listing.status} />
          </span>
        </div>

        <CardContent className="flex grow flex-col gap-2 pt-4">
          <h3 className="text-base font-semibold leading-snug text-slate-900">
            {listing.title}
          </h3>
          <p className="flex items-center gap-1 text-sm text-slate-600">
            <MapPin className="size-4 shrink-0" aria-hidden="true" />
            {listing.city}
          </p>
          <span className="mt-auto pt-2 text-base font-bold text-slate-900">
            {formatPriceWithUnit(
              listing.priceCents,
              listing.currency,
              listing.priceUnit
            )}
          </span>
        </CardContent>
      </Link>
    </Card>
  );
}
