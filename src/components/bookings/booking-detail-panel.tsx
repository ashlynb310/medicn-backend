"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SearchX } from "lucide-react";
import EmptyState from "@/components/ui/empty-state";
import ErrorState from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { BookingStatusBadge } from "@/components/ui/status-badge";
import { useAuth } from "@/components/auth/auth-provider";
import { getBooking } from "@/lib/api/bookings";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import type { Booking } from "@/lib/api/types";
import { formatPrice, formatDate, formatEnumLabel } from "@/lib/listing-format";
import { nightsBetween } from "@/lib/booking-format";

type State =
  | { status: "loading" }
  | { status: "error"; code: string; message: string }
  | { status: "ready"; booking: Booking };

// Checkout is only meaningful once a host accepts (accepted / payment_pending).
// Stripe checkout is a later phase, so the control is shown disabled and honest.
const CHECKOUTABLE = new Set(["accepted", "payment_pending"]);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2.5 last:border-b-0">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="text-sm font-medium text-slate-900">{children}</dd>
    </div>
  );
}

export default function BookingDetailPanel({
  bookingId,
}: {
  bookingId: string;
}) {
  const { accessToken, user } = useAuth();
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getBooking(bookingId, accessToken ?? undefined, controller.signal)
      .then((booking) => setState({ status: "ready", booking }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError) {
          setState({
            status: "error",
            code: error.code,
            message: error.message,
          });
        } else {
          setState({
            status: "error",
            code: "UNKNOWN",
            message: toErrorMessage(error),
          });
        }
      });
    return () => controller.abort();
  }, [bookingId, accessToken, attempt]);

  const retry = () => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  };

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (state.status === "error") {
    if (state.code === "NOT_FOUND") {
      return (
        <EmptyState
          icon={SearchX}
          title="Booking not found"
          description="This booking may have been removed, or the reference is incorrect."
          action={<ButtonLink href="/bookings">Back to bookings</ButtonLink>}
        />
      );
    }
    return (
      <ErrorState
        title="We couldn't load this booking"
        message={state.message}
        action={
          <Button variant="outline" onClick={retry}>
            Try again
          </Button>
        }
      />
    );
  }

  const { booking } = state;
  const isHost = user?.id === booking.hostId;
  const counterpart = isHost ? booking.renter : booking.listing.host;
  const counterpartName =
    counterpart.displayName || counterpart.firstName || counterpart.email;
  const nights = nightsBetween(booking.startDate, booking.endDate);
  const canCheckout = CHECKOUTABLE.has(booking.status);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href={`/listings/${booking.listingId}`}
          className="text-lg font-semibold text-slate-900 underline-offset-4 hover:underline"
        >
          {booking.listing.title}
        </Link>
        <BookingStatusBadge status={booking.status} />
      </div>

      <dl className="rounded-xl border border-slate-200 p-4">
        <Row label="Dates">
          {formatDate(booking.startDate)} – {formatDate(booking.endDate)} ·{" "}
          {nights} {booking.listing.priceUnit === "month" ? "day(s)" : "night(s)"}
        </Row>
        <Row label="Stay option">{formatEnumLabel(booking.selectedOption)}</Row>
        <Row label={isHost ? "Renter" : "Host"}>{counterpartName}</Row>
        <Row label="Total">
          {formatPrice(booking.totalAmountCents, booking.currency)}
        </Row>
        <Row label="Requested on">{formatDate(booking.createdAt)}</Row>
        <Row label="Reference">
          <span className="font-mono text-xs">{booking.id}</span>
        </Row>
      </dl>

      {booking.additionalRequests && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Message to host
          </h2>
          <p className="whitespace-pre-line text-sm text-slate-700">
            {booking.additionalRequests}
          </p>
        </div>
      )}

      {/* Payment is a later phase. Show the control only when the status makes
          checkout meaningful, and keep it honestly disabled. */}
      {!isHost && (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-900">Payment</h2>
          {canCheckout ? (
            <>
              <Button disabled className="w-fit">
                Continue to payment
              </Button>
              <p className="text-xs text-slate-500">
                Secure checkout is coming in a later phase. Amounts are
                calculated by the backend, not the browser.
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-600">
              Payment becomes available after the host accepts your request.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
