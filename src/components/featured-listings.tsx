"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import ListingCard from "@/components/listings/listing-card";
import { searchListings } from "@/lib/api/listings";
import { toErrorMessage } from "@/lib/api/client";
import type { ListingSummary } from "@/lib/api/types";

type FeaturedListingsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; listings: ListingSummary[] };

export default function FeaturedListings() {
  const [state, setState] = useState<FeaturedListingsState>({
    status: "loading",
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    searchListings({ sort: "newest", limit: 4 }, controller.signal)
      .then(({ listings }) => setState({ status: "ready", listings }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: toErrorMessage(error) });
      });
    return () => controller.abort();
  }, [attempt]);

  const retry = () => {
    setState({ status: "loading" });
    setAttempt((current) => current + 1);
  };

  if (state.status === "loading") {
    return (
      <div
        role="status"
        aria-label="Loading featured listings"
        className="grid w-full max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4"
      >
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-72 animate-pulse rounded-xl bg-white/20"
          />
        ))}
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div
        role="alert"
        className="flex w-full max-w-2xl flex-col items-center gap-3 rounded-xl bg-white/10 px-6 py-12 text-center"
      >
        <CircleAlert className="size-8 text-white" aria-hidden="true" />
        <p className="text-sm text-white">{state.message}</p>
        <Button variant="secondary" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  }

  if (state.listings.length === 0) {
    return (
      <div className="flex w-full max-w-2xl flex-col items-center gap-3 rounded-xl bg-white/10 px-6 py-12 text-center">
        <p className="text-sm text-white">
          No listings are published yet. Check back soon, or be the first to
          list your property.
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-5xl flex-col items-center gap-8">
      <ul className="grid w-full grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {state.listings.map((listing) => (
          <li key={listing.id}>
            <ListingCard listing={listing} />
          </li>
        ))}
      </ul>
      <Link
        href="/search"
        className={buttonVariants({ variant: "secondary" })}
      >
        Browse all listings
      </Link>
    </div>
  );
}
