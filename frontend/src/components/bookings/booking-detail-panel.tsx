"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleAlert, SearchX } from "lucide-react";
import EmptyState from "@/components/ui/empty-state";
import ErrorState from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { BookingStatusBadge } from "@/components/ui/status-badge";
import CheckoutButton from "@/components/bookings/checkout-button";
import BookingCancelControl from "@/components/bookings/booking-cancel-control";
import PaymentSummaryPanel from "@/components/bookings/payment-summary-panel";
import BookingCheckinLocation from "@/components/bookings/booking-checkin-location";
import { useAuth } from "@/components/auth/auth-provider";
import { getBooking, updateBookingStatus } from "@/lib/api/bookings";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import type { Booking } from "@/lib/api/types";
import { formatPrice, formatDate, formatEnumLabel } from "@/lib/listing-format";
import { nightsBetween } from "@/lib/booking-format";
import {
  canRenterCheckout,
  describeBookingLifecycle,
  formatInstantInZone,
  type LifecycleTone,
} from "@/lib/booking-lifecycle";

type State =
  | { status: "loading" }
  | { status: "error"; code: string; message: string }
  | { status: "ready"; booking: Booking };

const TONE_CLASS: Record<LifecycleTone, string> = {
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
  info: "border-sky-200 bg-sky-50 text-sky-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  success: "border-green-200 bg-green-50 text-green-900",
  danger: "border-red-200 bg-red-50 text-red-900",
};

// Statuses for which a payment summary is meaningful.
const PAYMENT_RELEVANT = new Set([
  "accepted",
  "payment_pending",
  "paid",
  "completed",
  "cancelled",
]);

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
  const [deciding, setDeciding] = useState<null | "accepted" | "rejected">(null);
  const [decisionError, setDecisionError] = useState<{
    code: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getBooking(bookingId, accessToken ?? undefined, controller.signal)
      .then((booking) => setState({ status: "ready", booking }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError) {
          setState({ status: "error", code: error.code, message: error.message });
        } else {
          setState({ status: "error", code: "UNKNOWN", message: toErrorMessage(error) });
        }
      });
    return () => controller.abort();
  }, [bookingId, accessToken, attempt]);

  // Soft refetch (no skeleton flash) — used after cancellation or a stale-state
  // prompt. `retry` resets to a full loading state for the error view.
  const refetch = () => setAttempt((n) => n + 1);
  const retry = () => {
    setDecisionError(null);
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
  const isRenter = user?.id === booking.renterId;
  const counterpart = isHost ? booking.renter : booking.listing.host;
  const counterpartName =
    counterpart.displayName || counterpart.firstName || counterpart.email;
  const nights = nightsBetween(booking.startDate, booking.endDate);
  const canDecide = isHost && booking.status === "requested";
  // Checkout is renter-only; admins/other viewers never inherit it.
  const showCheckout = isRenter && canRenterCheckout(booking);
  const lifecycle = describeBookingLifecycle(booking, booking.timeZone);
  const cancellation = booking.cancellation;

  const decide = async (next: "accepted" | "rejected") => {
    setDecisionError(null);
    setDeciding(next);
    try {
      const updated = await updateBookingStatus(
        booking.id,
        next,
        accessToken ?? undefined
      );
      setState({ status: "ready", booking: updated });
    } catch (error) {
      if (error instanceof ApiError) {
        setDecisionError({ code: error.code, message: error.message });
      } else {
        setDecisionError({ code: "UNKNOWN", message: toErrorMessage(error) });
      }
    } finally {
      setDeciding(null);
    }
  };

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

      {/* Authoritative lifecycle banner (from backend fields, never inferred). */}
      <div className={`flex flex-col gap-1 rounded-xl border p-4 ${TONE_CLASS[lifecycle.tone]}`}>
        <span className="text-sm font-semibold">{lifecycle.label}</span>
        {lifecycle.detail && <p className="text-sm">{lifecycle.detail}</p>}
      </div>

      <dl className="rounded-xl border border-slate-200 p-4">
        <Row label="Dates">
          {formatDate(booking.startDate)} – {formatDate(booking.endDate)} ·{" "}
          {nights} {booking.listing.priceUnit === "month" ? "day(s)" : "night(s)"}
        </Row>
        <Row label="Check-out time">
          {booking.checkoutTime} · {booking.timeZone}
        </Row>
        <Row label="Stay option">{formatEnumLabel(booking.selectedOption)}</Row>
        <Row label={isHost ? "Renter" : "Host"}>{counterpartName}</Row>
        <Row label="Total">
          {formatPrice(booking.totalAmountCents, booking.currency)}
        </Row>
        <Row label="Requested on">{formatDate(booking.createdAt)}</Row>
        {booking.completedAt && (
          <Row label="Completed">
            {formatInstantInZone(booking.completedAt, booking.timeZone)}
            {booking.completionSource
              ? ` · ${formatEnumLabel(booking.completionSource)}`
              : ""}
          </Row>
        )}
        <Row label="Reference">
          <span className="font-mono text-xs">{booking.id}</span>
        </Row>
      </dl>

      {/* Cancellation operation summary — safe fields only (no provider refs). */}
      {cancellation && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-900">Cancellation</h2>
          <dl className="flex flex-col gap-0.5 text-sm text-slate-600">
            <div className="flex justify-between gap-2">
              <dt>Reason</dt>
              <dd className="font-medium text-slate-900">
                {formatEnumLabel(booking.cancellationReason ?? cancellation.reason)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Status</dt>
              <dd className="font-medium text-slate-900">
                {formatEnumLabel(cancellation.status)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Financial disposition</dt>
              <dd className="font-medium text-slate-900">
                {formatEnumLabel(cancellation.financialDisposition)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Requested</dt>
              <dd>{formatInstantInZone(cancellation.requestedAt, booking.timeZone)}</dd>
            </div>
            {cancellation.effectiveAt && (
              <div className="flex justify-between gap-2">
                <dt>Effective</dt>
                <dd>{formatInstantInZone(cancellation.effectiveAt, booking.timeZone)}</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {booking.additionalRequests && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-900">Message to host</h2>
          <p className="whitespace-pre-line text-sm text-slate-700">
            {booking.additionalRequests}
          </p>
        </div>
      )}

      {/* Host decision on a still-`requested` booking (preserved from F1). */}
      {canDecide && (
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Respond to this request
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => decide("accepted")} disabled={deciding !== null}>
              {deciding === "accepted" ? "Accepting…" : "Accept"}
            </Button>
            <Button
              variant="destructive"
              onClick={() => decide("rejected")}
              disabled={deciding !== null}
            >
              {deciding === "rejected" ? "Rejecting…" : "Reject"}
            </Button>
          </div>
          {decisionError && (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-3"
            >
              <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
                <CircleAlert className="size-4" aria-hidden="true" />
                {decisionError.message}
              </p>
              {(decisionError.code === "BOOKING_STATUS_NOT_ALLOWED" ||
                decisionError.code === "NOT_FOUND") && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-red-700">
                    This booking may have already been decided or changed.
                    Refresh to see its current status.
                  </p>
                  <Button variant="outline" onClick={retry} className="w-fit">
                    Refresh
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Exact check-in location — ONLY when the protected response included it. */}
      {booking.checkInLocation && (
        <BookingCheckinLocation location={booking.checkInLocation} />
      )}

      {/* Renter checkout — only when the authoritative state allows it. */}
      {showCheckout && (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-900">Payment</h2>
          <CheckoutButton bookingId={booking.id} />
        </div>
      )}

      {/* Authoritative payment summary. */}
      {PAYMENT_RELEVANT.has(booking.status) && (
        <PaymentSummaryPanel
          bookingId={booking.id}
          timeZone={booking.timeZone}
          isHost={isHost}
        />
      )}

      {/* Cancellation control (self-hides when not eligible). */}
      <BookingCancelControl
        booking={booking}
        isRenter={isRenter}
        isHost={isHost}
        onCancelled={refetch}
        onRefresh={refetch}
      />
    </div>
  );
}
