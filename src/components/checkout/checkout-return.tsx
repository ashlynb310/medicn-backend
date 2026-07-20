"use client";

import { useEffect, useRef, useState } from "react";
import {
  CircleCheckBig,
  CircleX,
  Clock,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { ButtonLink } from "@/components/ui/button-link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import SignInRequired from "@/components/auth/sign-in-required";
import CheckoutButton from "@/components/bookings/checkout-button";
import { PaymentSummaryView } from "@/components/bookings/payment-summary-panel";
import { useAuth } from "@/components/auth/auth-provider";
import { getBooking } from "@/lib/api/bookings";
import { getBookingPaymentSummary } from "@/lib/api/payments";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import { isUuid } from "@/lib/uuid";
import {
  canRenterCheckout,
  deriveCheckoutState,
  shouldContinueCheckoutPolling,
  type DerivedPaymentState,
} from "@/lib/booking-lifecycle";
import type { Booking, BookingPaymentSummary } from "@/lib/api/types";

type ReturnMode = "success" | "cancel";

const POLL_INTERVAL_MS = 3_000;
const MAX_POLLS = 12; // ~36s bounded confirmation window

interface LoadedData {
  booking: Booking;
  summary: BookingPaymentSummary | null;
  summaryError: { code: string; message: string } | null;
}

export default function CheckoutReturn({
  mode,
  bookingId,
}: {
  mode: ReturnMode;
  bookingId: string | null;
}) {
  const { status: authStatus, accessToken, user } = useAuth();
  // Validate the locator BEFORE any API call; invalid/missing → safe fallback.
  const validBookingId = isUuid(bookingId) ? bookingId : null;
  const bookingHref = validBookingId ? `/bookings/${validBookingId}` : "/bookings";

  const [data, setData] = useState<LoadedData | null>(null);
  const [loadError, setLoadError] = useState<{ code: string; message: string } | null>(
    null
  );
  const [timedOut, setTimedOut] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const pollsRef = useRef(0);

  useEffect(() => {
    if (authStatus !== "authenticated" || !validBookingId) return;
    const controller = new AbortController();
    const token = accessToken ?? undefined;
    let activeTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    pollsRef.current = 0;

    const tick = async () => {
      try {
        const booking = await getBooking(validBookingId, token, controller.signal);
        // Load the payment summary honestly — a failure is recorded (with its
        // code) rather than silently converted to "no data".
        let summary: BookingPaymentSummary | null = null;
        let summaryError: { code: string; message: string } | null = null;
        try {
          summary = await getBookingPaymentSummary(
            validBookingId,
            token,
            controller.signal
          );
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          if (err instanceof ApiError) {
            summaryError = { code: err.code, message: err.message };
          } else {
            summaryError = { code: "UNKNOWN", message: toErrorMessage(err) };
          }
        }
        if (cancelled) return;
        setData({ booking, summary, summaryError });
        setLoadError(null);

        const derived = deriveCheckoutState(booking, summary);
        if (mode === "success" && shouldContinueCheckoutPolling(booking, derived)) {
          if (pollsRef.current >= MAX_POLLS) {
            setTimedOut(true);
            return;
          }
          setTimedOut(false);
          pollsRef.current += 1;
          activeTimer = setTimeout(tick, POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (error instanceof ApiError) {
          setLoadError({ code: error.code, message: error.message });
        } else {
          setLoadError({ code: "UNKNOWN", message: toErrorMessage(error) });
        }
      }
    };

    void tick();
    return () => {
      cancelled = true;
      controller.abort();
      if (activeTimer) clearTimeout(activeTimer);
    };
  }, [authStatus, validBookingId, accessToken, mode, reloadKey]);

  // A real reload that restarts the bounded polling cycle. Errors are NOT
  // swallowed — the effect surfaces them via loadError.
  const manualRefresh = () => {
    setLoadError(null);
    setTimedOut(false);
    setReloadKey((k) => k + 1);
  };

  // --- Missing/invalid locator: safe fallback to bookings. ---
  if (!validBookingId) {
    return (
      <Card>
        <Header
          icon={<TriangleAlert className="size-7" aria-hidden="true" />}
          tone="neutral"
          title="We couldn't identify that booking"
        />
        <p className="max-w-md text-sm text-slate-600">
          Head to your bookings to see the current status of your reservations.
        </p>
        <ButtonLink href="/bookings">Go to my bookings</ButtonLink>
      </Card>
    );
  }

  if (authStatus === "loading") {
    return (
      <Card>
        <Skeleton className="h-40 w-full" />
      </Card>
    );
  }

  if (authStatus !== "authenticated") {
    // Returned from Stripe but no session available; never assert payment.
    return (
      <SignInRequired
        message="Sign in to view the authoritative status of your booking and payment."
        returnTo={bookingHref}
      />
    );
  }

  if (loadError) {
    if (loadError.code === "NOT_FOUND") {
      return (
        <Card>
          <Header
            icon={<TriangleAlert className="size-7" aria-hidden="true" />}
            tone="neutral"
            title="Booking not found"
          />
          <p className="max-w-md text-sm text-slate-600">
            We couldn&apos;t find that booking. Check your bookings for the
            current status.
          </p>
          <ButtonLink href="/bookings">Go to my bookings</ButtonLink>
        </Card>
      );
    }
    return (
      <Card>
        <Header
          icon={<TriangleAlert className="size-7" aria-hidden="true" />}
          tone="warning"
          title="We couldn't load your booking"
        />
        <p className="max-w-md text-sm text-slate-600">{loadError.message}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="outline" onClick={manualRefresh}>
            Try again
          </Button>
          <ButtonLink href={bookingHref} variant="outline">
            View booking
          </ButtonLink>
        </div>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <Skeleton className="h-40 w-full" />
      </Card>
    );
  }

  const derived = deriveCheckoutState(data.booking, data.summary);
  const stillConfirming = derived === "confirming";
  const isRenter = data.booking.renterId === user?.id;
  const isHostViewer = data.booking.hostId === user?.id;
  // Retry checkout only when the refreshed state is eligible AND the viewer is
  // the Renter.
  const showRetry =
    isRenter &&
    canRenterCheckout(data.booking) &&
    (derived === "expired" || derived === "failed" || mode === "cancel");

  return (
    <Card>
      <ReturnHeader mode={mode} derived={derived} timedOut={timedOut} />

      <p className="max-w-md text-sm text-slate-600">
        {returnBody(mode, derived, stillConfirming, timedOut)}
      </p>

      {/* Authoritative payment details, or an honest, distinguishable error. */}
      <div className="w-full max-w-md rounded-xl border border-slate-200 p-4 text-left">
        {data.summary ? (
          <PaymentSummaryView
            summary={data.summary}
            timeZone={data.booking.timeZone}
            isHost={isHostViewer}
          />
        ) : data.summaryError ? (
          data.summaryError.code === "NOT_FOUND" ? (
            <p className="text-sm text-slate-600">
              Payment details aren&apos;t available for this booking.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-slate-600">
                We couldn&apos;t load payment details: {data.summaryError.message}
              </p>
              <Button variant="outline" className="w-fit" onClick={manualRefresh}>
                Try again
              </Button>
            </div>
          )
        ) : (
          <p className="text-sm text-slate-600">
            Payment details aren&apos;t available yet.
          </p>
        )}
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {stillConfirming && (
          <Button variant="outline" onClick={manualRefresh}>
            Refresh
          </Button>
        )}
        {showRetry && (
          <CheckoutButton bookingId={data.booking.id} label="Retry checkout" />
        )}
        <ButtonLink href={bookingHref}>View booking</ButtonLink>
        <ButtonLink href="/search" variant="outline">
          Keep browsing
        </ButtonLink>
      </div>
    </Card>
  );
}

function returnBody(
  mode: ReturnMode,
  derived: DerivedPaymentState,
  stillConfirming: boolean,
  timedOut: boolean
): string {
  if (mode === "cancel" && stillConfirming) {
    return "You returned from checkout. Here is the current status of your booking.";
  }
  if (derived === "paid") {
    return "The backend confirmed your payment. Your stay is booked.";
  }
  if (derived === "partially_refunded") {
    return "Part of this payment has been refunded. See the payment details below.";
  }
  if (derived === "refunded") {
    return "This payment was fully refunded. See the payment details below.";
  }
  if (stillConfirming) {
    return timedOut
      ? "This is taking longer than expected. You can refresh, or check your booking — the status updates once payment is confirmed."
      : "We're confirming your payment with the backend. This page updates automatically.";
  }
  return "Here is the current status of your booking and payment.";
}

function ReturnHeader({
  mode,
  derived,
  timedOut,
}: {
  mode: ReturnMode;
  derived: DerivedPaymentState;
  timedOut: boolean;
}) {
  if (derived === "paid") {
    return (
      <Header
        icon={<CircleCheckBig className="size-7" aria-hidden="true" />}
        tone="success"
        title="Payment confirmed"
      />
    );
  }
  if (derived === "failed") {
    return (
      <Header
        icon={<CircleX className="size-7" aria-hidden="true" />}
        tone="danger"
        title="Payment failed"
      />
    );
  }
  if (derived === "expired") {
    return (
      <Header
        icon={<Clock className="size-7" aria-hidden="true" />}
        tone="neutral"
        title="Checkout session expired"
      />
    );
  }
  if (derived === "partially_refunded") {
    return (
      <Header
        icon={<TriangleAlert className="size-7" aria-hidden="true" />}
        tone="neutral"
        title="Payment partially refunded"
      />
    );
  }
  if (derived === "refunded") {
    return (
      <Header
        icon={<TriangleAlert className="size-7" aria-hidden="true" />}
        tone="neutral"
        title="Payment refunded"
      />
    );
  }
  if (derived === "disputed") {
    return (
      <Header
        icon={<TriangleAlert className="size-7" aria-hidden="true" />}
        tone="warning"
        title="Payment disputed"
      />
    );
  }
  if (derived === "cancelled") {
    return (
      <Header
        icon={<CircleX className="size-7" aria-hidden="true" />}
        tone="neutral"
        title="This booking is cancelled"
      />
    );
  }
  if (derived === "rejected") {
    return (
      <Header
        icon={<CircleX className="size-7" aria-hidden="true" />}
        tone="neutral"
        title="This request was rejected"
      />
    );
  }
  if (timedOut) {
    return (
      <Header
        icon={<Clock className="size-7" aria-hidden="true" />}
        tone="neutral"
        title="Still confirming your payment"
      />
    );
  }
  return (
    <Header
      icon={<Loader2 className="size-7 animate-spin" aria-hidden="true" />}
      tone="info"
      title={mode === "success" ? "Confirming your payment…" : "Checking your booking…"}
    />
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-slate-200 bg-white px-6 py-12 text-center">
      {children}
    </div>
  );
}

const HEADER_TONE: Record<string, string> = {
  neutral: "bg-slate-100 text-slate-600",
  info: "bg-sky-100 text-sky-700",
  warning: "bg-amber-100 text-amber-700",
  success: "bg-green-100 text-green-700",
  danger: "bg-red-100 text-red-700",
};

function Header({
  icon,
  tone,
  title,
}: {
  icon: React.ReactNode;
  tone: keyof typeof HEADER_TONE;
  title: string;
}) {
  return (
    <>
      <span
        className={`flex size-14 items-center justify-center rounded-full ${HEADER_TONE[tone]}`}
      >
        {icon}
      </span>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
    </>
  );
}
