"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Gavel, ShieldX } from "lucide-react";
import AdminListingRow from "@/components/admin/admin-listing-row";
import EmptyState from "@/components/ui/empty-state";
import ErrorState from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/components/auth/auth-provider";
import { listAdminListings } from "@/lib/api/admin";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import type { AdminListing, ListingStatus, PaginationMeta } from "@/lib/api/types";

const PAGE_SIZE = 20;

const statusFilterItems: Record<string, string> = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  draft: "Draft",
  hidden: "Hidden",
};

type State =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error"; message: string }
  | { status: "ready"; listings: AdminListing[]; meta: PaginationMeta };

function ForbiddenBlock() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-6 py-16 text-center">
      <ShieldX className="size-10 text-amber-500" aria-hidden="true" />
      <h2 className="text-lg font-semibold text-amber-900">
        Administrator access required
      </h2>
      <p className="max-w-md text-sm text-amber-800">
        This area is limited to MediCN administrators. Your account does not have
        the admin role.
      </p>
    </div>
  );
}

export default function AdminListingsModeration() {
  const { accessToken, user } = useAuth();
  const [statusFilter, setStatusFilter] = useState<ListingStatus>("pending");
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ status: "loading" });

  // null = roles unknown (profile not loaded); let the backend be authoritative.
  const isAdmin = user ? user.roles.includes("admin") : null;

  useEffect(() => {
    // Skip the request for a known non-admin; render shows the forbidden block.
    if (isAdmin === false) {
      return;
    }
    const controller = new AbortController();
    listAdminListings(
      { status: statusFilter, page, limit: PAGE_SIZE },
      accessToken ?? undefined,
      controller.signal
    )
      .then(({ listings, meta }) =>
        setState({ status: "ready", listings, meta })
      )
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (
          error instanceof ApiError &&
          (error.code === "FORBIDDEN" || error.code === "UNAUTHORIZED")
        ) {
          setState({ status: "forbidden" });
        } else {
          setState({ status: "error", message: toErrorMessage(error) });
        }
      });
    return () => controller.abort();
  }, [isAdmin, accessToken, statusFilter, page, attempt]);

  const changeFilter = (next: ListingStatus) => {
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

  const handleModerated = (updated: AdminListing) => {
    setState((prev) =>
      prev.status === "ready"
        ? {
            ...prev,
            listings: prev.listings.map((l) =>
              l.id === updated.id ? updated : l
            ),
          }
        : prev
    );
  };

  // A known non-admin never triggers a fetch; show the forbidden block directly.
  if (isAdmin === false) {
    return <ForbiddenBlock />;
  }

  const totalPages =
    state.status === "ready"
      ? Math.max(1, Math.ceil(state.meta.total / state.meta.limit))
      : 1;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5 sm:max-w-xs">
        <Label htmlFor="admin-status-filter">Filter by status</Label>
        <Select
          items={statusFilterItems}
          value={statusFilter}
          onValueChange={(v) => changeFilter((v ?? "pending") as ListingStatus)}
        >
          <SelectTrigger id="admin-status-filter" className="w-full">
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
        <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      )}

      {state.status === "forbidden" && <ForbiddenBlock />}

      {state.status === "error" && (
        <ErrorState
          title="We couldn't load listings for review"
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
          icon={Gavel}
          title="Nothing to review"
          description={
            statusFilter === "pending"
              ? "There are no listings awaiting moderation right now."
              : "No listings match this status."
          }
        />
      )}

      {state.status === "ready" && state.listings.length > 0 && (
        <>
          <ul className="flex flex-col gap-4">
            {state.listings.map((listing) => (
              <AdminListingRow
                key={listing.id}
                listing={listing}
                onModerated={handleModerated}
              />
            ))}
          </ul>

          {totalPages > 1 && (
            <nav
              aria-label="Review pages"
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
