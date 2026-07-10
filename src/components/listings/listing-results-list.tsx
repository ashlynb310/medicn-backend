import ListingCard from "./listing-card";
import type { ListingSummary } from "@/lib/api/types";

export default function ListingResultsList({
  listings,
}: {
  listings: ListingSummary[];
}) {
  return (
    <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {listings.map((listing) => (
        <li key={listing.id}>
          <ListingCard listing={listing} />
        </li>
      ))}
    </ul>
  );
}
