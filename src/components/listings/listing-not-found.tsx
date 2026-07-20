import { SearchX } from "lucide-react";
import { ButtonLink } from "@/components/ui/button-link";

// Shown when a listing is not public and the viewer isn't its owner. It does
// not confirm whether the listing exists (the backend returns 404 either way).
export default function ListingNotFoundBlock() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-6 py-24 text-center">
      <SearchX className="size-10 text-slate-400" aria-hidden="true" />
      <h1 className="text-xl font-semibold text-slate-900">Listing not found</h1>
      <p className="max-w-md text-sm text-slate-600">
        This listing may have been removed, is not yet approved, or isn&apos;t
        available to view.
      </p>
      <ButtonLink href="/search" variant="outline">
        Browse listings
      </ButtonLink>
    </div>
  );
}
