"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/components/auth/auth-provider";
import { getBookingPaymentSummary } from "@/lib/api/payments";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import { formatPrice } from "@/lib/listing-format";
import { formatInstantInZone } from "@/lib/booking-lifecycle";
import type {
  BookingPaymentSummary,
  PaymentAttempt,
  SafePaymentLifecycleStatus,
} from "@/lib/api/types";

const PAYMENT_TONE: Record<SafePaymentLifecycleStatus, string> = {
  pending: "bg-amber-100 text-amber-800",
  paid: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  expired: "bg-slate-200 text-slate-700",
  partially_refunded: "bg-sky-100 text-sky-800",
  refunded: "bg-sky-100 text-sky-800",
  disputed: "bg-red-100 text-red-800",
};

function PaymentStatusPill({ status }: { status: SafePaymentLifecycleStatus }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${PAYMENT_TONE[status]}`}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

function AttemptRow({
  attempt,
  timeZone,
}: {
  attempt: PaymentAttempt;
  timeZone: string;
}) {
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
          Attempt {attempt.attemptNumber}
          {attempt.active && (
            <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">
              Active
            </span>
          )}
        </span>
        <PaymentStatusPill status={attempt.status} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-600">
        <span>{formatPrice(attempt.amountCents, attempt.currency)}</span>
        {attempt.amountRefundedCents > 0 && (
          <span>
            Refunded {formatPrice(attempt.amountRefundedCents, attempt.currency)}
          </span>
        )}
        {attempt.paidAt && <span>Paid {formatInstantInZone(attempt.paidAt, timeZone)}</span>}
        {attempt.refundedAt && (
          <span>Refunded {formatInstantInZone(attempt.refundedAt, timeZone)}</span>
        )}
        {attempt.status === "pending" && attempt.expiresAt && (
          <span>Expires {formatInstantInZone(attempt.expiresAt, timeZone)}</span>
        )}
      </div>
    </li>
  );
}

// Presentational payment summary. Payment state shown here is authoritative
// (from GET /bookings/:id/payment-summary) — never inferred from booking status,
// URL, or session_id.
export function PaymentSummaryView({
  summary,
  timeZone,
  isHost,
}: {
  summary: BookingPaymentSummary;
  timeZone: string;
  isHost: boolean;
}) {
  const transfer = summary.transfer;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-600">Total</span>
        <span className="text-sm font-semibold text-slate-900">
          {formatPrice(summary.totalAmountCents, summary.currency)}
        </span>
      </div>

      {summary.payments.length === 0 ? (
        <p className="text-sm text-slate-600">No payment attempts yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {[...summary.payments]
            .sort((a, b) => b.attemptNumber - a.attemptNumber)
            .map((attempt) => (
              <AttemptRow key={attempt.id} attempt={attempt} timeZone={timeZone} />
            ))}
        </ul>
      )}

      {/* Host transfer — clearly a transfer to the connected Stripe balance,
          never described as a bank payout. Shown to the Host only. */}
      {isHost && transfer && (
        <div className="flex flex-col gap-1 rounded-lg bg-slate-50 p-3">
          <h3 className="text-sm font-semibold text-slate-900">
            Transfer to connected Stripe balance
          </h3>
          <p className="text-xs text-slate-500">
            This is a transfer to your connected Stripe balance — not a bank
            payout.
          </p>
          <dl className="mt-1 flex flex-col gap-0.5 text-xs text-slate-600">
            <div className="flex justify-between gap-2">
              <dt>Status</dt>
              <dd className="font-medium">{transfer.status.replaceAll("_", " ")}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Your net</dt>
              <dd className="font-medium">
                {formatPrice(transfer.hostNetAmountCents, transfer.currency)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Platform fee</dt>
              <dd>{formatPrice(transfer.platformFeeCents, transfer.currency)}</dd>
            </div>
            {transfer.reversedAmountCents > 0 && (
              <div className="flex justify-between gap-2">
                <dt>Reversed</dt>
                <dd>{formatPrice(transfer.reversedAmountCents, transfer.currency)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <dt>Reversal status</dt>
              <dd>{transfer.reversalStatus.replaceAll("_", " ")}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}

// Self-fetching wrapper used on the booking detail page.
export default function PaymentSummaryPanel({
  bookingId,
  timeZone,
  isHost,
}: {
  bookingId: string;
  timeZone: string;
  isHost: boolean;
}) {
  const { accessToken } = useAuth();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; code: string; message: string }
    | { status: "ready"; summary: BookingPaymentSummary }
  >({ status: "loading" });

  const load = useCallback(
    (signal?: AbortSignal) => {
      getBookingPaymentSummary(bookingId, accessToken ?? undefined, signal)
        .then((summary) => setState({ status: "ready", summary }))
        .catch((error) => {
          if (signal?.aborted) return;
          if (error instanceof ApiError) {
            setState({ status: "error", code: error.code, message: error.message });
          } else {
            setState({ status: "error", code: "UNKNOWN", message: toErrorMessage(error) });
          }
        });
    },
    [bookingId, accessToken]
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4">
      <h2 className="text-sm font-semibold text-slate-900">Payment</h2>
      {state.status === "loading" && <Skeleton className="h-24 w-full" />}
      {state.status === "error" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-slate-600">
            {state.code === "NOT_FOUND"
              ? "Payment details aren't available for this booking."
              : state.message}
          </p>
          {state.code !== "NOT_FOUND" && (
            <Button variant="outline" className="w-fit" onClick={() => load()}>
              Try again
            </Button>
          )}
        </div>
      )}
      {state.status === "ready" && (
        <PaymentSummaryView
          summary={state.summary}
          timeZone={timeZone}
          isHost={isHost}
        />
      )}
    </div>
  );
}
