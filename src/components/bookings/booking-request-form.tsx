"use client";

import { useMemo, useState } from "react";
import { CalendarDays, CircleAlert, CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { BookingStatusBadge } from "@/components/ui/status-badge";
import { useAuth } from "@/components/auth/auth-provider";
import { createBooking } from "@/lib/api/bookings";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import type { Booking, ListingDetail } from "@/lib/api/types";
import { formatPrice, formatStayDuration } from "@/lib/listing-format";
import { estimateTotalCents, nightsBetween } from "@/lib/booking-format";

type FormListing = Pick<
  ListingDetail,
  "id" | "priceCents" | "currency" | "priceUnit" | "stayDurations"
>;

function defaultOptionForUnit(priceUnit: FormListing["priceUnit"]) {
  if (priceUnit === "day") return { value: "daily", label: "Daily stay" };
  if (priceUnit === "month") return { value: "monthly", label: "Monthly stay" };
  return { value: "nightly", label: "Nightly stay" };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Human-readable guidance for the backend error codes this endpoint can return.
function recoveryHintFor(code: string) {
  switch (code) {
    case "EMAIL_NOT_VERIFIED":
      return "Confirm your email address (check your inbox for the verification link), then try again.";
    case "USER_NOT_SYNCED":
      return "Your MediCN profile has not finished setting up. Sign out and back in, then retry.";
    case "FORBIDDEN":
      return "Booking requests can only be made from a renter account, and hosts cannot book their own listing.";
    case "BOOKING_NOT_AVAILABLE":
      return "Those dates are unavailable or already requested. Try a different date range.";
    default:
      return null;
  }
}

export default function BookingRequestForm({
  listing,
}: {
  listing: FormListing;
}) {
  const { status, accessToken } = useAuth();

  const stayOptions = useMemo<Record<string, string>>(() => {
    if (listing.stayDurations.length > 0) {
      return Object.fromEntries(
        listing.stayDurations.map((d) => [d, formatStayDuration(d)])
      );
    }
    const fallback = defaultOptionForUnit(listing.priceUnit);
    return { [fallback.value]: fallback.label };
  }, [listing.stayDurations, listing.priceUnit]);

  const firstOption = Object.keys(stayOptions)[0];

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedOption, setSelectedOption] = useState(firstOption);
  const [additionalRequests, setAdditionalRequests] = useState("");

  const [validationError, setValidationError] = useState<string | null>(null);
  const [backendError, setBackendError] = useState<{
    code: string;
    message: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [createdBooking, setCreatedBooking] = useState<Booking | null>(null);

  const nights = startDate && endDate ? nightsBetween(startDate, endDate) : 0;
  const datesValid = nights > 0;
  const estimateCents = datesValid
    ? estimateTotalCents(
        listing.priceCents,
        listing.priceUnit,
        startDate,
        endDate
      )
    : 0;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBackendError(null);

    if (!startDate || !endDate) {
      setValidationError("Choose both a check-in and a check-out date.");
      return;
    }
    if (!datesValid) {
      setValidationError("Check-out must be after check-in.");
      return;
    }
    if (!selectedOption) {
      setValidationError("Choose a stay option.");
      return;
    }
    setValidationError(null);
    setSubmitting(true);

    try {
      const booking = await createBooking(
        {
          listingId: listing.id,
          startDate,
          endDate,
          selectedOption,
          additionalRequests: additionalRequests.trim() || undefined,
        },
        accessToken ?? undefined
      );
      setCreatedBooking(booking);
    } catch (error) {
      if (error instanceof ApiError) {
        setBackendError({ code: error.code, message: error.message });
      } else {
        setBackendError({ code: "UNKNOWN", message: toErrorMessage(error) });
      }
    } finally {
      setSubmitting(false);
    }
  };

  // --- Success state: only shown after a real backend booking is created. ---
  if (createdBooking) {
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-green-200 bg-green-50 p-5">
        <div className="flex items-center gap-2">
          <CircleCheck className="size-6 text-green-600" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-green-900">
            Booking requested
          </h2>
        </div>
        <p className="text-sm text-green-900">
          Your request was sent to the host for review. You can track its status
          from your bookings.
        </p>
        <dl className="flex flex-col gap-1.5 text-sm">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-green-900/80">Status</dt>
            <dd>
              <BookingStatusBadge status={createdBooking.status} />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-green-900/80">Total</dt>
            <dd className="font-semibold text-green-900">
              {formatPrice(
                createdBooking.totalAmountCents,
                createdBooking.currency
              )}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-green-900/80">Reference</dt>
            <dd className="font-mono text-xs text-green-900">
              {createdBooking.id}
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/bookings/${createdBooking.id}`}>
            View booking
          </ButtonLink>
          <ButtonLink href="/bookings" variant="outline">
            All bookings
          </ButtonLink>
        </div>
      </div>
    );
  }

  const renderAction = () => {
    if (status === "loading") {
      return <Skeleton className="h-9 w-full" />;
    }
    if (status !== "authenticated") {
      return (
        <ButtonLink
          href={`/login?returnTo=${encodeURIComponent(`/listings/${listing.id}`)}`}
          className="w-full justify-center"
        >
          Log in to request a booking
        </ButtonLink>
      );
    }
    return (
      <Button
        type="submit"
        disabled={submitting || !datesValid}
        className="w-full justify-center"
      >
        {submitting ? "Sending request…" : "Request booking"}
      </Button>
    );
  };

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Request a booking"
      className="flex flex-col gap-4 rounded-xl border border-slate-200 p-5"
    >
      <div className="flex items-center gap-2">
        <CalendarDays className="size-5 text-slate-700" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-slate-900">
          Request to book
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="booking-start">Check in</Label>
          <Input
            id="booking-start"
            type="date"
            min={todayIso()}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="booking-end">Check out</Label>
          <Input
            id="booking-end"
            type="date"
            min={startDate || todayIso()}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="booking-option">Stay option</Label>
        <Select
          items={stayOptions}
          value={selectedOption}
          onValueChange={(v) => setSelectedOption(v ?? firstOption)}
        >
          <SelectTrigger id="booking-option" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(stayOptions).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="booking-notes">Message to host (optional)</Label>
        <textarea
          id="booking-notes"
          rows={3}
          maxLength={2000}
          value={additionalRequests}
          onChange={(e) => setAdditionalRequests(e.target.value)}
          placeholder="Share arrival details, rotation dates, or any questions."
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

      {/* Price summary derived from real listing data; final total is confirmed
          by the backend on the created booking. */}
      <div className="flex flex-col gap-1 rounded-lg bg-slate-50 p-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-slate-600">
            {formatPrice(listing.priceCents, listing.currency)} ×{" "}
            {datesValid ? nights : "—"}{" "}
            {listing.priceUnit === "month" ? "day(s)" : "night(s)"}
          </span>
          <span className="font-semibold text-slate-900">
            {datesValid ? formatPrice(estimateCents, listing.currency) : "—"}
          </span>
        </div>
        <p className="text-xs text-slate-500">
          Estimated total. The host and MediCN confirm the final amount when the
          request is reviewed.
        </p>
      </div>

      {validationError && (
        <p role="alert" className="text-sm font-medium text-red-600">
          {validationError}
        </p>
      )}

      {backendError && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-3"
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
            <CircleAlert className="size-4" aria-hidden="true" />
            {backendError.message}
          </p>
          {recoveryHintFor(backendError.code) && (
            <p className="text-xs text-red-700">
              {recoveryHintFor(backendError.code)}
            </p>
          )}
        </div>
      )}

      {renderAction()}
    </form>
  );
}
