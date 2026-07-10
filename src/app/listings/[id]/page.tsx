import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AvailabilitySummary from "@/components/listings/availability-summary";
import BookingRequestForm from "@/components/bookings/booking-request-form";
import ListingDetailErrorState from "@/components/listings/listing-detail-error-state";
import ListingMapPreview from "@/components/listings/listing-map-preview";
import ListingPhotoGallery from "@/components/listings/listing-photo-gallery";
import ListingPlaceList from "@/components/listings/listing-place-list";
import { getListing } from "@/lib/api/listings";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import type { ListingDetail } from "@/lib/api/types";
import {
  formatEnumLabel,
  formatHostName,
  formatListingType,
  formatPriceWithUnit,
  formatStayDuration,
} from "@/lib/listing-format";

export const metadata: Metadata = {
  title: "Listing | The MediCN",
};

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let listing: ListingDetail;
  try {
    listing = await getListing(id);
  } catch (error) {
    if (error instanceof ApiError && error.code === "NOT_FOUND") {
      notFound();
    }
    return <ListingDetailErrorState message={toErrorMessage(error)} />;
  }

  const hostName = formatHostName(listing.host);

  return (
    <article className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {listing.title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
          <span>{listing.city}</span>
          <span>{formatListingType(listing.listingType)}</span>
          {listing.category && <span>{listing.category}</span>}
        </div>
      </header>

      <ListingPhotoGallery photos={listing.photos} title={listing.title} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xl font-bold text-slate-900">
                {formatPriceWithUnit(
                  listing.priceCents,
                  listing.currency,
                  listing.priceUnit
                )}
              </p>
              <p className="text-sm text-slate-600">Hosted by {hostName}</p>
            </div>

            {(listing.stayDurations.length > 0 ||
              listing.specialFeatures.length > 0 ||
              listing.proximityTags.length > 0) && (
              <ul className="flex flex-wrap gap-1.5">
                {listing.stayDurations.map((duration) => (
                  <li
                    key={duration}
                    className="rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-800"
                  >
                    {formatStayDuration(duration)}
                  </li>
                ))}
                {listing.proximityTags.map((tag) => (
                  <li
                    key={tag}
                    className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-800"
                  >
                    {formatEnumLabel(tag)}
                  </li>
                ))}
                {listing.specialFeatures.map((feature) => (
                  <li
                    key={feature}
                    className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700"
                  >
                    {formatEnumLabel(feature)}
                  </li>
                ))}
              </ul>
            )}

            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
              {listing.description}
            </p>
          </section>

          {listing.host.bio && (
            <section className="flex flex-col gap-2 rounded-xl border border-slate-200 p-4">
              <h2 className="text-lg font-semibold text-slate-900">
                About {hostName}
              </h2>
              <p className="text-sm leading-relaxed text-slate-700">
                {listing.host.bio}
              </p>
            </section>
          )}

          <ListingPlaceList places={listing.places} />
        </div>

        <aside className="flex flex-col gap-6">
          <BookingRequestForm
            listing={{
              id: listing.id,
              priceCents: listing.priceCents,
              currency: listing.currency,
              priceUnit: listing.priceUnit,
              stayDurations: listing.stayDurations,
            }}
          />
          <AvailabilitySummary availability={listing.availability} />
          <ListingMapPreview
            city={listing.city}
            address={listing.address}
            latitude={listing.latitude}
            longitude={listing.longitude}
          />
        </aside>
      </div>
    </article>
  );
}
