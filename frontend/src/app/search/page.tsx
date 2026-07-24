import type { Metadata } from "next";
import ListingResultsList from "@/components/listings/listing-results-list";
import ListingSearchEmptyState from "@/components/listings/listing-search-empty-state";
import ListingSearchErrorState from "@/components/listings/listing-search-error-state";
import ListingSearchFilters from "@/components/listings/listing-search-filters";
import PaginationControls from "@/components/listings/pagination-controls";
import { searchListings } from "@/lib/api/listings";
import { toErrorMessage } from "@/lib/api/client";
import type {
  ListingSort,
  ListingType,
  SearchListingsParams,
  StayDuration,
} from "@/lib/api/types";

export const metadata: Metadata = {
  title: "Search Listings | The MediCN",
  description:
    "Search housing listings for medical professionals on rotations, assignments, and relocations.",
};

const PAGE_SIZE = 12;

type RawSearchParams = { [key: string]: string | string[] | undefined };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function oneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[]
): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined;
}

function positiveNumber(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseFilters(raw: RawSearchParams): SearchListingsParams {
  // `q` is kept as an alias so older homepage links keep working.
  const location = first(raw.location) ?? first(raw.q);
  const startDate = first(raw.startDate);
  const endDate = first(raw.endDate);
  const page = positiveNumber(first(raw.page));

  return {
    location: location?.trim() || undefined,
    city: first(raw.city)?.trim() || undefined,
    nearbyHospital: first(raw.nearbyHospital)?.trim() || undefined,
    listingType: oneOf<ListingType>(first(raw.listingType), [
      "private_room",
      "entire_home",
      "shared_room",
    ]),
    category: first(raw.category)?.trim() || undefined,
    stayDuration: oneOf<StayDuration>(first(raw.stayDuration), [
      "short_term",
      "medium_term",
      "long_term",
    ]),
    // The backend requires both dates, so drop a lone one instead of erroring.
    startDate: startDate && endDate ? startDate : undefined,
    endDate: startDate && endDate ? endDate : undefined,
    minPrice: positiveNumber(first(raw.minPrice)),
    maxPrice: positiveNumber(first(raw.maxPrice)),
    sort: oneOf<ListingSort>(first(raw.sort), [
      "newest",
      "price_asc",
      "price_desc",
    ]),
    page: page && Number.isInteger(page) && page >= 1 ? page : 1,
    limit: PAGE_SIZE,
  };
}

function toPreservedParams(filters: SearchListingsParams) {
  const preserved: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (key === "page" || key === "limit") continue;
    if (value === undefined) continue;
    preserved[key] = String(value);
  }
  return preserved;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const filters = parseFilters(await searchParams);

  let results: Awaited<ReturnType<typeof searchListings>> | null = null;
  let errorMessage: string | null = null;

  try {
    results = await searchListings(filters);
  } catch (error) {
    errorMessage = toErrorMessage(error);
  }

  const totalPages = results
    ? Math.max(1, Math.ceil(results.meta.total / results.meta.limit))
    : 1;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Find your next stay
        </h1>
        {results && (
          <p className="text-sm text-slate-600">
            {results.meta.total}{" "}
            {results.meta.total === 1 ? "listing" : "listings"} found
          </p>
        )}
      </div>

      <ListingSearchFilters initialFilters={filters} />

      {errorMessage ? (
        <ListingSearchErrorState message={errorMessage} />
      ) : results && results.listings.length === 0 ? (
        <ListingSearchEmptyState />
      ) : results ? (
        <>
          <ListingResultsList listings={results.listings} />
          <PaginationControls
            page={results.meta.page}
            totalPages={totalPages}
            searchParams={toPreservedParams(filters)}
          />
        </>
      ) : null}
    </div>
  );
}
