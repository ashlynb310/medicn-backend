"use client";

import { useEffect, useRef, useState } from "react";
import {
  BadgeCheck,
  CircleAlert,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Skeleton } from "@/components/ui/skeleton";
import ErrorState from "@/components/ui/error-state";
import { useAuth } from "@/components/auth/auth-provider";
import {
  createIdentitySession,
  getCurrentIdentityVerification,
  type IdentityVerificationSummary,
} from "@/lib/api/identity";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import {
  describeIdentityStatus,
  identityActionLabel,
  isPollableIdentityStatus,
  isStaleSessionAttempt,
  resolveSessionOutcome,
  shouldContinueIdentityPolling,
  type IdentityTone,
} from "@/lib/identity/presentation";

const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS = 24; // ~2 minutes of bounded waiting

const TONE_CLASS: Record<IdentityTone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  info: "bg-sky-100 text-sky-800",
  warning: "bg-amber-100 text-amber-900",
  success: "bg-green-100 text-green-800",
  danger: "bg-red-100 text-red-800",
};

interface RequestError {
  code: string;
  message: string;
  retryAfter: number | null;
}

function toRequestError(error: unknown): RequestError {
  if (error instanceof ApiError) {
    return {
      code: error.code,
      message: error.message,
      retryAfter: error.retryAfterSeconds,
    };
  }
  return { code: "UNKNOWN", message: toErrorMessage(error), retryAfter: null };
}

function errorHint(code: string): string | null {
  switch (code) {
    case "VERIFF_NOT_CONFIGURED":
      return "Identity verification isn't available on MediCN right now. Please try again later.";
    case "VERIFF_PROVIDER_UNAVAILABLE":
      return "The verification provider is temporarily unavailable. Please try again shortly.";
    case "ACCOUNT_DISABLED":
      return "This account can't start identity verification.";
    case "UNAUTHORIZED":
    case "INVALID_SUPABASE_TOKEN":
      return "Your session expired. Sign out and back in, then try again.";
    case "USER_NOT_SYNCED":
      return "Your MediCN profile hasn't finished setting up. Sign out and back in, then retry.";
    default:
      return null;
  }
}

function isRateLimit(code: string): boolean {
  return code === "RATE_LIMIT_EXCEEDED" || code === "RATE_LIMITED";
}

/** Safe recovery guidance for any request failure — never provider internals. */
function recoveryText(error: RequestError): string | null {
  if (isRateLimit(error.code)) {
    return error.retryAfter
      ? `Too many attempts. Try again in about ${error.retryAfter}s.`
      : "Too many attempts. Please wait a moment and try again.";
  }
  return errorHint(error.code);
}

/** Shared error notice so load and session failures read identically. */
function ErrorNotice({ error }: { error: RequestError }) {
  const recovery = recoveryText(error);
  return (
    <div
      role="alert"
      className="flex flex-col gap-1 rounded-lg border border-red-200 bg-red-50 p-3"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
        <CircleAlert className="size-4" aria-hidden="true" />
        {error.message}
      </p>
      {recovery && <p className="text-xs text-red-700">{recovery}</p>}
    </div>
  );
}

function formatDateTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2 last:border-b-0">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}

/**
 * Veriff identity verification. The backend owns the provider session; the
 * browser only opens the returned hosted URL and re-reads the authoritative
 * status. Returning from the provider is never treated as approval — only the
 * backend (webhook-driven) status is believed. sessionId and verificationUrl are
 * never rendered, logged, or persisted.
 */
export default function IdentityVerificationPanel() {
  const { accessToken, refreshProfile } = useAuth();

  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [summary, setSummary] = useState<IdentityVerificationSummary | null>(null);
  const [loadError, setLoadError] = useState<RequestError | null>(null);
  const [startError, setStartError] = useState<RequestError | null>(null);
  const [starting, setStarting] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const pollsRef = useRef(0);
  const approvedHandledRef = useRef(false);
  const startAbortRef = useRef<AbortController | null>(null);

  // Abort any in-flight session request on unmount or access-token change, so
  // its response can never redirect or update a stale page.
  useEffect(
    () => () => {
      startAbortRef.current?.abort();
      startAbortRef.current = null;
    },
    [accessToken]
  );

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    pollsRef.current = 0;

    const tick = async () => {
      try {
        const data = await getCurrentIdentityVerification(
          accessToken ?? undefined,
          controller.signal
        );
        if (cancelled) return;
        setSummary(data);
        setPhase("ready");
        setLoadError(null);

        // Once the backend confirms approval, refresh the AuthProvider profile
        // so its identityVerification summary is current app-wide.
        if (data.status === "approved" && !approvedHandledRef.current) {
          approvedHandledRef.current = true;
          void refreshProfile();
        }

        if (
          shouldContinueIdentityPolling(data.status, pollsRef.current, MAX_POLLS)
        ) {
          setPollTimedOut(false);
          pollsRef.current += 1;
          timer = setTimeout(tick, POLL_INTERVAL_MS);
        } else if (isPollableIdentityStatus(data.status)) {
          // Budget spent while still awaiting a decision.
          setPollTimedOut(true);
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError(toRequestError(error));
        setPhase((current) => (current === "loading" ? "error" : current));
        // Polling stops on error; the user can Refresh.
      }
    };

    void tick();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [accessToken, reloadKey, refreshProfile]);

  // Returning from the hosted provider flow re-reads the authoritative status.
  // It never implies success.
  useEffect(() => {
    const refresh = () => setReloadKey((key) => key + 1);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const manualRefresh = () => {
    setLoadError(null);
    setStartError(null);
    setPollTimedOut(false);
    setReloadKey((key) => key + 1);
  };

  const startVerification = async () => {
    if (starting) return;
    // Cancel any previous attempt so only the newest one can act.
    startAbortRef.current?.abort();
    const controller = new AbortController();
    startAbortRef.current = controller;

    setStartError(null);
    setStarting(true);
    let redirecting = false;
    try {
      const session = await createIdentitySession(
        accessToken ?? undefined,
        controller.signal
      );
      // A stale/aborted attempt must never navigate or touch this page.
      if (
        isStaleSessionAttempt(
          controller.signal.aborted,
          startAbortRef.current === controller
        )
      ) {
        return;
      }

      const outcome = resolveSessionOutcome(session);
      if (outcome.kind === "redirect") {
        redirecting = true;
        window.location.assign(outcome.url);
        return;
      }
      if (outcome.kind === "approved") {
        // Legitimate: already approved, so there is nothing to open. Confirm
        // through the authoritative status rather than reporting an error.
        void refreshProfile();
        setReloadKey((key) => key + 1);
        return;
      }
      setStartError({
        code: "NO_VERIFICATION_URL",
        message: "Verification can't be opened right now.",
        retryAfter: null,
      });
      setReloadKey((key) => key + 1);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (controller.signal.aborted) return;
      setStartError(toRequestError(error));
    } finally {
      if (!redirecting) setStarting(false);
    }
  };

  if (phase === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (phase === "error" || !summary) {
    const recovery = loadError ? recoveryText(loadError) : null;
    return (
      <ErrorState
        title="We couldn't load your verification status"
        message={[loadError?.message ?? "Please try again.", recovery]
          .filter(Boolean)
          .join(" ")}
        action={
          <Button variant="outline" onClick={manualRefresh}>
            Try again
          </Button>
        }
      />
    );
  }

  const presentation = describeIdentityStatus(summary.status);
  const actionLabel = identityActionLabel(summary.actionRequired);
  const awaitingDecision = isPollableIdentityStatus(summary.status);
  const isApproved = summary.status === "approved";
  const submittedAt = formatDateTime(summary.submittedAt);
  const decidedAt = formatDateTime(summary.decidedAt);
  const expiresAt = formatDateTime(summary.expiresAt);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {isApproved ? (
            <BadgeCheck className="size-5 text-green-600" aria-hidden="true" />
          ) : (
            <ShieldCheck className="size-5 text-slate-700" aria-hidden="true" />
          )}
          <h2 className="text-lg font-semibold text-slate-900">
            Identity verification
          </h2>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[presentation.tone]}`}
          >
            {presentation.label}
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={manualRefresh}>
          <RefreshCw aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <p className="text-sm text-slate-700">{presentation.description}</p>

      {/* Scope statement — identity only. */}
      <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
        Identity verification confirms who you are. It does <strong>not</strong>{" "}
        verify medical employment, school affiliation, or professional
        licensing — those are handled separately.
      </p>

      {(submittedAt || decidedAt || expiresAt) && (
        <dl className="rounded-xl border border-slate-200 p-4">
          {submittedAt && <Row label="Submitted" value={submittedAt} />}
          {decidedAt && <Row label="Decision" value={decidedAt} />}
          {expiresAt && <Row label="Expires" value={expiresAt} />}
        </dl>
      )}

      {awaitingDecision && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900"
        >
          {pollTimedOut ? (
            <>
              <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
              This is taking longer than expected. Use Refresh to check again —
              we&apos;ll show the decision as soon as MediCN receives it.
            </>
          ) : (
            <>
              <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
              Waiting for the verification decision. This page updates
              automatically.
            </>
          )}
        </p>
      )}

      {/* A refresh failure while already showing a status keeps the same safe
          recovery guidance as a session failure. */}
      {loadError && phase === "ready" && <ErrorNotice error={loadError} />}

      {startError && <ErrorNotice error={startError} />}

      {/* Separate workflow — deliberately not merged with the identity status
          above. Healthcare credentials have their own submissions and decision. */}
      <div className="flex flex-col items-start gap-2 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-semibold text-slate-900">
          Healthcare credentials
        </h3>
        <p className="text-sm text-slate-600">
          Verifying your professional role and affiliation is a separate
          workflow with its own review and status.
        </p>
        <ButtonLink href="/account/healthcare-verification" variant="outline">
          Healthcare credentials
        </ButtonLink>
      </div>

      {actionLabel && (
        <div className="flex flex-col gap-2">
          <Button
            onClick={startVerification}
            disabled={starting}
            className="w-fit"
          >
            {starting ? "Opening…" : actionLabel}
          </Button>
          <p className="text-xs text-slate-500">
            You&apos;ll continue on our verification provider&apos;s secure page,
            then return here. MediCN confirms the result — returning doesn&apos;t
            by itself mean you were approved.
          </p>
        </div>
      )}
    </div>
  );
}
