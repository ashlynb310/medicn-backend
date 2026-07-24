"use client";

import { useState } from "react";
import { CircleAlert, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";
import { createCheckoutSession } from "@/lib/api/payments";
import { ApiError, toErrorMessage } from "@/lib/api/client";

// Human guidance for the checkout error codes this endpoint can return. These
// are gating/policy errors decided by the backend — the browser never bypasses
// them or calls Stripe directly.
function checkoutErrorHint(code: string): string | null {
  switch (code) {
    case "EMAIL_NOT_VERIFIED":
      return "Verify your email address before paying, then try again.";
    case "IDENTITY_VERIFICATION_REQUIRED":
      return "Identity verification is required before payment.";
    case "IDENTITY_VERIFICATION_PENDING":
      return "Your identity verification is still being reviewed. Try again once it's approved.";
    case "IDENTITY_VERIFICATION_REJECTED":
      return "Your identity verification was rejected, so payment can't proceed.";
    case "IDENTITY_VERIFICATION_EXPIRED":
      return "Your identity verification expired. Renew it before paying.";
    case "HOST_PAYOUT_ACCOUNT_NOT_READY":
      return "The host isn't ready to receive payments yet. Please try again later.";
    case "CONNECT_ONBOARDING_REQUIRED":
    case "CONNECT_NOT_CONFIGURED":
      return "Payments to this host aren't available yet. Please try again later.";
    case "BOOKING_NOT_AVAILABLE":
      return "This booking is no longer available for payment.";
    case "PAYMENT_PROVIDER_UNAVAILABLE":
      return "The payment provider is temporarily unavailable. Please try again shortly.";
    default:
      return null;
  }
}

// Renter-only Stripe Checkout entry point. Shown only when the authoritative
// booking state allows checkout. On success it redirects to the backend-provided
// hosted checkoutUrl — it never calculates amounts, sends amounts, or calls
// Stripe APIs/keys directly.
export default function CheckoutButton({
  bookingId,
  label = "Continue to payment",
}: {
  bookingId: string;
  label?: string;
}) {
  const { accessToken } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{
    code: string;
    message: string;
    retryAfter: number | null;
  } | null>(null);

  const startCheckout = async () => {
    if (submitting) return; // prevent duplicate clicks / duplicate sessions
    setError(null);
    setSubmitting(true);
    try {
      const session = await createCheckoutSession(
        bookingId,
        accessToken ?? undefined
      );
      // Redirect only after a successful response, to the backend URL.
      window.location.assign(session.checkoutUrl);
      // Keep the button disabled while the browser navigates away.
    } catch (err) {
      if (err instanceof ApiError) {
        setError({
          code: err.code,
          message: err.message,
          retryAfter: err.retryAfterSeconds,
        });
      } else {
        setError({ code: "UNKNOWN", message: toErrorMessage(err), retryAfter: null });
      }
      setSubmitting(false);
    }
  };

  const isRateLimited =
    error?.code === "RATE_LIMITED" || error?.code === "RATE_LIMIT_EXCEEDED";

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={startCheckout} disabled={submitting} className="w-fit">
        <CreditCard aria-hidden="true" />
        {submitting ? "Starting checkout…" : label}
      </Button>
      <p className="text-xs text-slate-500">
        Amounts are calculated by MediCN and charged securely by Stripe.
      </p>
      {error && (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-lg border border-red-200 bg-red-50 p-3"
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
            checkoutErrorHint(error.code) && (
              <p className="text-xs text-red-700">{checkoutErrorHint(error.code)}</p>
            )
          )}
        </div>
      )}
    </div>
  );
}
