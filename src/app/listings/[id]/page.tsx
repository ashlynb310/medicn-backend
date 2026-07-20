import type { Metadata } from "next";
import ListingDetailErrorState from "@/components/listings/listing-detail-error-state";
import ListingDetailView from "@/components/listings/listing-detail-view";
import ListingOwnerFallback from "@/components/listings/listing-owner-fallback";
import { getListing } from "@/lib/api/listings";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import type { ListingDetail } from "@/lib/api/types";

export const metadata: Metadata = {
  title: "Listing | The MediCN",
};

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Server-side fetch has no bearer token, so it sees only public (approved)
  // listings. On 404, a logged-in owner may still have access, so we hand off to
  // a client fallback that retries with the ambient token.
  let listing: ListingDetail;
  try {
    listing = await getListing(id);
  } catch (error) {
    if (error instanceof ApiError && error.code === "NOT_FOUND") {
      return <ListingOwnerFallback id={id} />;
    }
    return <ListingDetailErrorState message={toErrorMessage(error)} />;
  }

  return <ListingDetailView listing={listing} />;
}
