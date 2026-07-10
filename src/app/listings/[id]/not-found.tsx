import Link from "next/link";
import { SearchX } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default function ListingNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-6 py-24 text-center">
      <SearchX className="size-10 text-slate-400" aria-hidden="true" />
      <h1 className="text-xl font-semibold text-slate-900">
        Listing not found
      </h1>
      <p className="max-w-md text-sm text-slate-600">
        This listing may have been removed or is no longer available.
      </p>
      <Link href="/search" className={buttonVariants({ variant: "outline" })}>
        Browse listings
      </Link>
    </div>
  );
}
