"use client";

import { useState } from "react";
import { Archive, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";
import { archiveListing } from "@/lib/api/host-listings";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import type { ArchivedListing } from "@/lib/api/types";

export default function ListingArchiveControl({
  listingId,
  onArchived,
}: {
  listingId: string;
  onArchived: (archived: ArchivedListing) => void;
}) {
  const { accessToken } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(
    null
  );

  const archive = async () => {
    setError(null);
    setArchiving(true);
    try {
      const result = await archiveListing(listingId, accessToken ?? undefined);
      onArchived(result);
    } catch (err) {
      if (err instanceof ApiError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({ code: "UNKNOWN", message: toErrorMessage(err) });
      }
      setConfirming(false);
    } finally {
      setArchiving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50/40 p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">Archive listing</h3>
        <p className="mt-1 text-sm text-slate-600">
          Archiving removes the listing from search and hosting. This can&apos;t
          be done while it has active bookings.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-lg border border-red-200 bg-red-50 p-3"
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
            <CircleAlert className="size-4" aria-hidden="true" />
            {error.message}
          </p>
          {error.code === "LISTING_ARCHIVE_BLOCKED_BY_ACTIVE_BOOKINGS" && (
            <p className="text-xs text-red-700">
              Wait until the active bookings are completed or cancelled, then try
              again.
            </p>
          )}
        </div>
      )}

      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-800">
            Archive this listing?
          </span>
          <Button variant="destructive" onClick={archive} disabled={archiving}>
            {archiving ? "Archiving…" : "Yes, archive"}
          </Button>
          <Button
            variant="outline"
            onClick={() => setConfirming(false)}
            disabled={archiving}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="destructive"
          className="w-fit"
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
        >
          <Archive aria-hidden="true" />
          Archive listing
        </Button>
      )}
    </div>
  );
}
