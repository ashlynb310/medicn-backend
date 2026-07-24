import { SearchX } from "lucide-react";

export default function ListingSearchEmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-16 text-center">
      <SearchX className="size-10 text-slate-400" aria-hidden="true" />
      <h2 className="text-lg font-semibold text-slate-900">
        No listings found
      </h2>
      <p className="max-w-md text-sm text-slate-600">
        Try widening your search: remove some filters, adjust the price range,
        or search a different city.
      </p>
    </div>
  );
}
