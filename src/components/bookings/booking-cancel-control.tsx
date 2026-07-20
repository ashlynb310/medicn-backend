"use client";

import { useState } from "react";
import { CircleAlert, XCircle } from "lucide-react";
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
import { cancelBooking } from "@/lib/api/bookings";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import { newIdempotencyKey } from "@/lib/idempotency";
import {
  canOfferCancellation,
  isCancellationProcessing,
} from "@/lib/booking-lifecycle";
import {
  HOST_CANCELLATION_REASONS,
  RENTER_CANCELLATION_REASONS,
  type Booking,
  type BookingCancellationResult,
  type CancellationRequestReason,
} from "@/lib/api/types";

function cancelErrorHint(code: string): string | null {
  switch (code) {
    case "PAID_CANCELLATION_POLICY_UNAVAILABLE":
      return "Paid bookings can't be cancelled here. Contact the host if you need to make a change.";
    case "BOOKING_CANCELLATION_NOT_ALLOWED":
      return "This booking can't be cancelled in its current state.";
    case "CANCELLATION_ALREADY_IN_PROGRESS":
      return "A cancellation is already in progress. Refresh to see its current status.";
    case "PAYMENT_STATE_CHANGED":
      return "The payment state changed. Refresh and review before trying again.";
    case "PAYMENT_PROVIDER_UNAVAILABLE":
      return "The payment provider is temporarily unavailable. You can retry in a moment.";
    default:
      return null;
  }
}

// Codes for which retrying with the SAME idempotency key is appropriate.
const RETRYABLE_CODES = new Set([
  "PAYMENT_PROVIDER_UNAVAILABLE",
  "RATE_LIMITED",
  "RATE_LIMIT_EXCEEDED",
  "INTERNAL_SERVER_ERROR",
  "NETWORK_ERROR",
]);

// Role-appropriate cancellation. Hosts continue to Reject a `requested` booking
// (handled elsewhere); this control is not offered for that case, nor for
// rejected/cancelled/completed bookings or while a cancellation is already
// processing. The same idempotency key is preserved across retries of one
// attempt so a retry never creates a second cancellation.
export default function BookingCancelControl({
  booking,
  isRenter,
  isHost,
  onCancelled,
  onRefresh,
}: {
  booking: Booking;
  isRenter: boolean;
  isHost: boolean;
  onCancelled: (result: BookingCancellationResult) => void;
  onRefresh: () => void;
}) {
  const { accessToken } = useAuth();
  const reasons = isHost
    ? HOST_CANCELLATION_REASONS
    : RENTER_CANCELLATION_REASONS;

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<CancellationRequestReason>(
    reasons[0].value
  );
  const [attemptKey, setAttemptKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{
    code: string;
    message: string;
    retryAfter: number | null;
  } | null>(null);

  // Eligibility is decided by the shared pure helper: terminal states, paid
  // Renter (policy-blocked), host-`requested` (use Reject), in-progress
  // cancellations, and non-participant viewers are all excluded.
  if (
    !canOfferCancellation({
      status: booking.status,
      isRenter,
      isHost,
      processing: isCancellationProcessing(booking),
    })
  ) {
    return null;
  }

  const changeReason = (next: CancellationRequestReason) => {
    setReason(next);
    // A different reason is a new logical attempt → new idempotency key.
    setAttemptKey(null);
    setError(null);
  };

  const submit = async () => {
    if (submitting) return;
    setError(null);
    // Reuse the attempt's key on retry; mint one for a fresh attempt.
    const key = attemptKey ?? newIdempotencyKey();
    setAttemptKey(key);
    setSubmitting(true);
    try {
      const result = await cancelBooking(
        booking.id,
        reason,
        key,
        accessToken ?? undefined
      );
      // Only reflect success after the backend accepts the request.
      setAttemptKey(null);
      setOpen(false);
      onCancelled(result);
    } catch (err) {
      if (err instanceof ApiError) {
        setError({
          code: err.code,
          message: err.message,
          retryAfter: err.retryAfterSeconds,
        });
        // Non-retryable deterministic failures end this attempt; the next
        // submit should be a fresh key. Retryable ones keep the same key.
        if (!RETRYABLE_CODES.has(err.code)) {
          setAttemptKey(null);
        }
      } else {
        setError({ code: "UNKNOWN", message: toErrorMessage(err), retryAfter: null });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const needsRefresh =
    error?.code === "CANCELLATION_ALREADY_IN_PROGRESS" ||
    error?.code === "PAYMENT_STATE_CHANGED";
  const isRateLimited =
    error?.code === "RATE_LIMITED" || error?.code === "RATE_LIMIT_EXCEEDED";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4">
      <h2 className="text-sm font-semibold text-slate-900">Cancel booking</h2>

      {!open ? (
        <Button variant="outline" className="w-fit" onClick={() => setOpen(true)}>
          <XCircle aria-hidden="true" />
          Cancel this booking
        </Button>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5 sm:max-w-xs">
            <Label htmlFor="cancel-reason">Reason</Label>
            <Select
              items={Object.fromEntries(reasons.map((r) => [r.value, r.label]))}
              value={reason}
              onValueChange={(v) =>
                changeReason((v as CancellationRequestReason) ?? reasons[0].value)
              }
            >
              <SelectTrigger id="cancel-reason" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {reasons.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-xs text-slate-500">
            Cancellation outcomes (including any refund) are determined by the
            backend policy. No amounts are calculated here.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" onClick={submit} disabled={submitting}>
              {submitting ? "Submitting…" : "Confirm cancellation"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              disabled={submitting}
            >
              Keep booking
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-3"
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
            <CircleAlert className="size-4" aria-hidden="true" />
            {error.message}
          </p>
          {isRateLimited ? (
            <p className="text-xs text-red-700">
              Too many attempts.{" "}
              {error.retryAfter
                ? `Try again in about ${error.retryAfter}s.`
                : "Please wait a moment and try again."}
            </p>
          ) : (
            cancelErrorHint(error.code) && (
              <p className="text-xs text-red-700">{cancelErrorHint(error.code)}</p>
            )
          )}
          {needsRefresh && (
            <Button variant="outline" className="w-fit" onClick={onRefresh}>
              Refresh
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
