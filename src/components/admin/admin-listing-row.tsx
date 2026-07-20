"use client";

import { useState } from "react";
import { Check, CircleAlert, ImageOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ListingStatusBadge } from "@/components/ui/status-badge";
import { useAuth } from "@/components/auth/auth-provider";
import { moderateListing } from "@/lib/api/admin";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import type { AdminListing } from "@/lib/api/types";
import { formatPriceWithUnit, formatDate } from "@/lib/listing-format";

function isHttpUrl(url: string | null): url is string {
  return !!url && (url.startsWith("https://") || url.startsWith("http://"));
}

function hostName(host: AdminListing["host"]) {
  return (
    host.displayName ||
    [host.firstName, host.lastName].filter(Boolean).join(" ") ||
    host.email
  );
}

// Extra guidance for the moderation-specific error codes.
function recoveryHintFor(code: string) {
  switch (code) {
    case "LISTING_STATUS_NOT_ALLOWED":
      return "This listing is no longer pending — it may have been moderated already or changed concurrently. Refresh the list to see its current status.";
    case "FORBIDDEN":
      return "Your account is not an administrator.";
    case "NOT_FOUND":
      return "This listing no longer exists or was removed.";
    default:
      return null;
  }
}

export default function AdminListingRow({
  listing,
  onModerated,
}: {
  listing: AdminListing;
  /** Called with the updated listing after a successful backend decision. */
  onModerated: (updated: AdminListing) => void;
}) {
  const { accessToken } = useAuth();
  const [note, setNote] = useState("");
  const [deciding, setDeciding] = useState<null | "approved" | "rejected">(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(
    null
  );

  const isPending = listing.status === "pending";

  const decide = async (status: "approved" | "rejected") => {
    setError(null);
    setDeciding(status);
    try {
      const updated = await moderateListing(
        listing.id,
        { status, note: note.trim() || undefined },
        accessToken ?? undefined
      );
      // Only reflect the decision after the backend confirms it.
      onModerated(updated);
    } catch (err) {
      if (err instanceof ApiError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({ code: "UNKNOWN", message: toErrorMessage(err) });
      }
    } finally {
      setDeciding(null);
    }
  };

  return (
    <li className="flex flex-col gap-4 rounded-xl border border-slate-200 p-4 sm:flex-row">
      <div className="h-24 w-full shrink-0 overflow-hidden rounded-lg bg-slate-100 sm:w-36">
        {isHttpUrl(listing.coverPhotoUrl) ? (
          // eslint-disable-next-line @next/next/no-img-element -- backend storage host is env-dependent
          <img
            src={listing.coverPhotoUrl}
            alt={`Cover of ${listing.title}`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-full w-full items-center justify-center text-slate-400"
          >
            <ImageOff className="size-7" />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-base font-semibold text-slate-900">
              {listing.title}
            </h3>
            <p className="text-sm text-slate-600">
              {listing.city} ·{" "}
              {formatPriceWithUnit(
                listing.priceCents,
                listing.currency,
                listing.priceUnit
              )}
            </p>
            <p className="text-xs text-slate-500">
              Host: {hostName(listing.host)} ({listing.host.email}) · Submitted{" "}
              {formatDate(listing.createdAt)}
            </p>
          </div>
          <ListingStatusBadge status={listing.status} />
        </div>

        {isPending ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`note-${listing.id}`}>
                Moderation note (optional)
              </Label>
              <textarea
                id={`note-${listing.id}`}
                rows={2}
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Recorded with your decision in the audit log."
                className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => decide("approved")}
                disabled={deciding !== null}
              >
                <Check aria-hidden="true" />
                {deciding === "approved" ? "Approving…" : "Approve"}
              </Button>
              <Button
                variant="destructive"
                onClick={() => decide("rejected")}
                disabled={deciding !== null}
              >
                <X aria-hidden="true" />
                {deciding === "rejected" ? "Rejecting…" : "Reject"}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            This listing has been moderated.
          </p>
        )}

        {error && (
          <div
            role="alert"
            className="flex flex-col gap-1 rounded-lg border border-red-200 bg-red-50 p-3"
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
              <CircleAlert className="size-4" aria-hidden="true" />
              {error.message}
            </p>
            {recoveryHintFor(error.code) && (
              <p className="text-xs text-red-700">
                {recoveryHintFor(error.code)}
              </p>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
