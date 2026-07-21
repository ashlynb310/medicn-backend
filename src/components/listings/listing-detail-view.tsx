import ListingReservePanel from "@/components/listings/listing-reserve-panel";
import ListingInquiryForm from "@/components/messaging/listing-inquiry-form";
import ListingMapPreview from "@/components/listings/listing-map-preview";
import NearbyPlacesList from "@/components/listings/nearby-places-list";
import ListingPhotoGallery from "@/components/listings/listing-photo-gallery";
import ListingPlaceList from "@/components/listings/listing-place-list";
import { ListingStatusBadge } from "@/components/ui/status-badge";
import type { ListingDetail } from "@/lib/api/types";
import {
  formatEnumLabel,
  formatHostName,
  formatListingType,
  formatPriceWithUnit,
  formatStayDuration,
} from "@/lib/listing-format";

// Presentational listing detail. Shared by the server page (public/approved
// listings) and the client owner fallback (an owner viewing their own
// pre-approval listing). Booking is only offered for approved listings.
export default function ListingDetailView({
  listing,
}: {
  listing: ListingDetail;
}) {
  const hostName = formatHostName(listing.host);
  const isApproved = listing.status === "approved";

  return (
    <article className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {listing.title}
          </h1>
          {!isApproved && <ListingStatusBadge status={listing.status} />}
        </div>
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
          {isApproved ? (
            <ListingReservePanel
              listing={{
                id: listing.id,
                priceCents: listing.priceCents,
                currency: listing.currency,
                priceUnit: listing.priceUnit,
                stayDurations: listing.stayDurations,
                timeZone: listing.timeZone,
              }}
            />
          ) : (
            <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-center gap-2">
                <ListingStatusBadge status={listing.status} />
              </div>
              <p className="text-sm text-slate-600">
                This listing isn&apos;t approved yet, so it isn&apos;t visible in
                search or open for booking. Once an admin approves it, renters
                can request to book.
              </p>
            </div>
          )}
          {/* Renter-only inquiry form; self-hides for the owner/host/admin. */}
          {isApproved && (
            <ListingInquiryForm
              listingId={listing.id}
              hostId={listing.host.id}
            />
          )}
          <ListingMapPreview publicLocation={listing.publicLocation} />
          <NearbyPlacesList nearbyPlaces={listing.nearbyPlaces} />
        </aside>
      </div>
    </article>
  );
}
