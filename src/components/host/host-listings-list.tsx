"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, List } from "lucide-react";
import HostListingCard from "@/components/host/host-listing-card";
import EmptyState from "@/components/ui/empty-state";
import ErrorState from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/components/auth/auth-provider";
import { listMyListings } from "@/lib/api/host-listings";
import { toErrorMessage } from "@/lib/api/client";
import type { ListingStatus, ListingSummary, PaginationMeta } from "@/lib/api/types";

const PAGE_SIZE = 12;

const statusFilterItems: Record<string, string> = {
  all: "All statuses",
  draft: "Draft",
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  hidden: "Hidden",
};

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; listings: ListingSummary[]; meta: PaginationMeta };

export default function HostListingsList() {
  const { accessToken } = useAuth();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    listMyListings(
      {
        status: statusFilter === "all" ? undefined : (statusFilter as ListingStatus),
        page,
        limit: PAGE_SIZE,
      },
      accessToken ?? undefined,
      controller.signal
    )
      .then(({ listings, meta }) =>
        setState({ status: "ready", listings, meta })
      )
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: toErrorMessage(error) });
      });
    return () => controller.abort();
  }, [accessToken, statusFilter, page, attempt]);

  const changeFilter = (next: string) => {
    setState({ status: "loading" });
    setStatusFilter(next);
    setPage(1);
  };

  const goToPage = (next: number) => {
    setState({ status: "loading" });
    setPage(next);
  };

  const retry = () => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  };

  const totalPages =
    state.status === "ready"
      ? Math.max(1, Math.ceil(state.meta.total / state.meta.limit))
      : 1;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5 sm:max-w-xs">
        <Label htmlFor="host-status-filter">Filter by status</Label>
        <Select
          items={statusFilterItems}
          value={statusFilter}
          onValueChange={(v) => changeFilter(v ?? "all")}
        >
          <SelectTrigger id="host-status-filter" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(statusFilterItems).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {state.status === "loading" && (
        <div
          className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
          aria-busy="true"
          aria-live="polite"
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      )}

      {state.status === "error" && (
        <ErrorState
          title="We couldn't load your listings"
          message={state.message}
          action={
            <Button variant="outline" onClick={retry}>
              Try again
            </Button>
          }
        />
      )}

      {state.status === "ready" && state.listings.length === 0 && (
        <EmptyState
          icon={List}
          title={
            statusFilter === "all"
              ? "No listings yet"
              : "No listings with this status"
          }
          description={
            statusFilter === "all"
              ? "Create your first listing to make your property available to visiting medical professionals."
              : "Try a different status filter, or create a new listing."
          }
          action={<ButtonLink href="/host/listings/new">Create a listing</ButtonLink>}
        />
      )}

      {state.status === "ready" && state.listings.length > 0 && (
        <>
          <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {state.listings.map((listing) => (
              <li key={listing.id}>
                <HostListingCard listing={listing} />
              </li>
            ))}
          </ul>

          {totalPages > 1 && (
            <nav
              aria-label="Listings pages"
              className="flex items-center justify-center gap-4"
            >
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
              >
                <ChevronLeft aria-hidden="true" />
                Previous
              </Button>
              <span className="text-sm text-slate-600">
                Page {state.meta.page} of {totalPages}
              </span>
              <Button
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => goToPage(page + 1)}
              >
                Next
                <ChevronRight aria-hidden="true" />
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
