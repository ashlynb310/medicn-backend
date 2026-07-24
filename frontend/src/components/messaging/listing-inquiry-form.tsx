"use client";

import { useState } from "react";
import { CircleAlert, CircleCheck, MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/components/auth/auth-provider";
import { createInquiry } from "@/lib/api/messaging";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import { evaluateMessage } from "@/lib/messaging/message-content";
import type { CreatedInquiry } from "@/lib/api/types";

function inquiryErrorHint(code: string): string | null {
  switch (code) {
    case "CONTACT_INFORMATION_NOT_ALLOWED":
      return "Phone numbers and email addresses can't be sent through MediCN messages. Rewrite your message without them.";
    case "EMAIL_NOT_VERIFIED":
      return "Confirm your email address (check your inbox for the verification link), then try again.";
    case "INQUIRY_NOT_AVAILABLE":
      return "This listing isn't accepting messages right now.";
    case "FORBIDDEN":
      return "Only renters can message a host, and hosts can't message their own listing.";
    default:
      return null;
  }
}

// "Message the host" form for an APPROVED public listing.
//
// Shown only to a signed-in user who holds the `renter` role and is not this
// listing's owner. A dual-role Host/Renter therefore still sees it on someone
// else's listing, which matches the backend rule (verified Renter, not the
// captured Host of this listing). The backend remains authoritative — this is
// visibility only. Sends exactly `{ message }`; success is shown only after the
// backend creates the inquiry.
export default function ListingInquiryForm({
  listingId,
  hostId,
}: {
  listingId: string;
  hostId: string;
}) {
  const { status, user, accessToken } = useAuth();
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedInquiry | null>(null);
  const [error, setError] = useState<{
    code: string;
    message: string;
    retryAfter: number | null;
  } | null>(null);

  if (status === "loading") {
    return <Skeleton className="h-32 w-full" />;
  }

  // Logged out: the same sign-in behaviour used elsewhere on this page.
  if (status !== "authenticated") {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <MessagesSquare className="size-5" aria-hidden="true" />
          Message the host
        </h2>
        <p className="text-sm text-slate-600">
          Sign in to ask the host about this listing.
        </p>
        <ButtonLink
          href={`/login?returnTo=${encodeURIComponent(`/listings/${listingId}`)}`}
          className="w-full justify-center"
        >
          Log in to message the host
        </ButtonLink>
      </div>
    );
  }

  // Owner/host/admin must not see renter inquiry controls.
  const isOwner = user?.id === hostId;
  const isRenter = user?.roles?.includes("renter") ?? false;
  if (isOwner || !isRenter) {
    return null;
  }

  if (created) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-green-200 bg-green-50 p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-green-900">
          <CircleCheck className="size-5 text-green-600" aria-hidden="true" />
          Message sent
        </h2>
        <p className="text-sm text-green-900">
          Your message was sent to the host. Replies appear in Messages.
        </p>
        <ButtonLink href={`/messages/${created.inquiry.id}`} className="w-fit">
          Open conversation
        </ButtonLink>
      </div>
    );
  }

  const evaluated = evaluateMessage(draft);
  const alreadyOpen = error?.code === "INQUIRY_ALREADY_OPEN";
  const isRateLimited =
    error?.code === "RATE_LIMITED" || error?.code === "RATE_LIMIT_EXCEEDED";

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!evaluated.valid || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await createInquiry(
        listingId,
        evaluated.trimmed,
        accessToken ?? undefined
      );
      setCreated(result);
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
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-xl border border-slate-200 p-5"
      aria-label="Message the host"
    >
      <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
        <MessagesSquare className="size-5" aria-hidden="true" />
        Message the host
      </h2>

      <label htmlFor="listing-inquiry-body" className="sr-only">
        Your message
      </label>
      <textarea
        id="listing-inquiry-body"
        rows={4}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Ask about availability, the neighborhood, or house rules."
        className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <p className="text-xs text-slate-500">
        Keep the conversation on MediCN — phone numbers and email addresses
        aren&apos;t allowed in messages.
      </p>

      {error && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-3"
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
            <CircleAlert className="size-4" aria-hidden="true" />
            {error.message}
          </p>
          {alreadyOpen ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-xs text-red-700">
                You already have an open conversation about this listing.
              </p>
              <ButtonLink href="/messages" variant="outline">
                Go to Messages
              </ButtonLink>
            </div>
          ) : isRateLimited ? (
            <p className="text-xs text-red-700">
              Too many messages.{" "}
              {error.retryAfter
                ? `Try again in about ${error.retryAfter}s.`
                : "Please wait a moment and try again."}
            </p>
          ) : (
            inquiryErrorHint(error.code) && (
              <p className="text-xs text-red-700">{inquiryErrorHint(error.code)}</p>
            )
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`text-xs ${
            evaluated.tooLong ? "text-red-600" : "text-slate-500"
          }`}
        >
          {evaluated.tooLong
            ? `${Math.abs(evaluated.remaining)} characters over the limit`
            : `${evaluated.remaining} characters left`}
        </span>
        <Button type="submit" disabled={submitting || !evaluated.valid}>
          {submitting ? "Sending…" : "Send message"}
        </Button>
      </div>
    </form>
  );
}
