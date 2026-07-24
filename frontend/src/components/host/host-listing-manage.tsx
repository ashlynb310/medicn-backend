"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, MapPin } from "lucide-react";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button-link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import ErrorState from "@/components/ui/error-state";
import EmptyState from "@/components/ui/empty-state";
import { SearchX } from "lucide-react";
import { ListingStatusBadge } from "@/components/ui/status-badge";
import ListingEditForm from "@/components/host/listing-edit-form";
import ListingPhotoManager from "@/components/host/listing-photo-manager";
import AvailabilityManager from "@/components/host/availability-manager";
import ListingArchiveControl from "@/components/host/listing-archive-control";
import { useAuth } from "@/components/auth/auth-provider";
import { getListing } from "@/lib/api/listings";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import type { ListingDetail } from "@/lib/api/types";
import { formatEnumLabel } from "@/lib/listing-format";

type State =
  | { status: "loading" }
  | { status: "not_found" }
  | { status: "error"; message: string }
  | { status: "ready"; listing: ListingDetail };

type Tab = "details" | "photos" | "availability";

const tabs: { id: Tab; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "photos", label: "Photos" },
  { id: "availability", label: "Availability" },
];

export default function HostListingManage({ id }: { id: string }) {
  const { accessToken } = useAuth();
  const [state, setState] = useState<State>({ status: "loading" });
  const [tab, setTab] = useState<Tab>("details");

  const load = useCallback(
    (signal?: AbortSignal) => {
      getListing(id, accessToken ?? undefined, signal)
        .then((listing) => setState({ status: "ready", listing }))
        .catch((error) => {
          if (signal?.aborted) return;
          if (error instanceof ApiError && error.code === "NOT_FOUND") {
            setState({ status: "not_found" });
          } else {
            setState({ status: "error", message: toErrorMessage(error) });
          }
        });
    },
    [id, accessToken]
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const refresh = useCallback(async () => {
    await getListing(id, accessToken ?? undefined)
      .then((listing) => setState({ status: "ready", listing }))
      .catch(() => {
        /* keep current view on a background refresh error */
      });
  }, [id, accessToken]);

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (state.status === "not_found") {
    return (
      <EmptyState
        icon={SearchX}
        title="Listing not found"
        description="This listing may have been removed, or you don't have access to manage it."
        action={<ButtonLink href="/host/listings">Back to my listings</ButtonLink>}
      />
    );
  }

  if (state.status === "error") {
    return (
      <ErrorState
        title="We couldn't load this listing"
        message={state.message}
        action={
          <Button variant="outline" onClick={() => load()}>
            Try again
          </Button>
        }
      />
    );
  }

  const { listing } = state;
  const isApproved = listing.status === "approved";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {listing.title}
          </h1>
          <ListingStatusBadge status={listing.status} />
        </div>
        <p className="flex items-center gap-1.5 text-sm text-slate-600">
          <MapPin className="size-4 shrink-0" aria-hidden="true" />
          {listing.city}
        </p>
        {/* Location processing status (safe geocode/enrichment summary). */}
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
            Location: {formatEnumLabel(listing.locationStatus.geocode)}
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
            Nearby data: {formatEnumLabel(listing.locationStatus.enrichment)}
          </span>
        </div>
        {isApproved && (
          <Link
            href={`/listings/${listing.id}`}
            className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-sky-700 underline underline-offset-4 hover:text-sky-900"
          >
            View public listing
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </Link>
        )}
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Listing management"
        className="flex flex-wrap gap-1 border-b border-slate-200"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={
              tab === t.id
                ? "border-b-2 border-sky-600 px-3 py-2 text-sm font-semibold text-sky-700"
                : "border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "details" && (
        <div className="flex flex-col gap-8">
          <ListingEditForm
            listing={listing}
            onUpdated={(updated) => setState({ status: "ready", listing: updated })}
          />
          <ListingArchiveControl
            listingId={listing.id}
            onArchived={(archived) =>
              setState({
                status: "ready",
                listing: { ...listing, status: archived.status },
              })
            }
          />
        </div>
      )}

      {tab === "photos" && (
        <ListingPhotoManager
          listingId={listing.id}
          initialPhotos={listing.photos}
          onPhotosChanged={refresh}
        />
      )}

      {tab === "availability" && (
        <AvailabilityManager listingId={listing.id} timeZone={listing.timeZone} />
      )}
    </div>
  );
}
