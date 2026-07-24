"use client";

// Rendered when the server-side (unauthenticated) listing fetch returned 404.
// A logged-in owner/admin may still be able to see the listing before approval,
// so this retries the fetch client-side where the ambient bearer token is
// attached. A non-owner still gets 404 and sees the not-found block.

import { useEffect, useState } from "react";
import ListingDetailView from "@/components/listings/listing-detail-view";
import ListingDetailErrorState from "@/components/listings/listing-detail-error-state";
import ListingNotFoundBlock from "@/components/listings/listing-not-found";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/components/auth/auth-provider";
import { getListing } from "@/lib/api/listings";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import type { ListingDetail } from "@/lib/api/types";

type State =
  | { status: "loading" }
  | { status: "not_found" }
  | { status: "error"; message: string }
  | { status: "ready"; listing: ListingDetail };

export default function ListingOwnerFallback({ id }: { id: string }) {
  const { status: authStatus, accessToken } = useAuth();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    // Only a logged-in user can see a non-public listing. The anonymous /
    // loading cases are handled in render, so the effect never calls setState
    // synchronously in its body.
    if (authStatus !== "authenticated") {
      return;
    }
    const controller = new AbortController();
    getListing(id, accessToken ?? undefined, controller.signal)
      .then((listing) => setState({ status: "ready", listing }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.code === "NOT_FOUND") {
          setState({ status: "not_found" });
        } else {
          setState({ status: "error", message: toErrorMessage(error) });
        }
      });
    return () => controller.abort();
  }, [authStatus, accessToken, id]);

  const loadingBlock = (
    <div
      className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6"
      aria-busy="true"
      aria-live="polite"
    >
      <Skeleton className="h-9 w-3/4" />
      <Skeleton className="mt-4 h-72 w-full" />
    </div>
  );

  if (authStatus === "loading") {
    return loadingBlock;
  }

  // Anonymous (and non-configured) viewers can't access non-public listings.
  if (authStatus !== "authenticated") {
    return <ListingNotFoundBlock />;
  }

  if (state.status === "loading") {
    return loadingBlock;
  }

  if (state.status === "not_found") {
    return <ListingNotFoundBlock />;
  }

  if (state.status === "error") {
    return <ListingDetailErrorState message={state.message} />;
  }

  return <ListingDetailView listing={state.listing} />;
}
