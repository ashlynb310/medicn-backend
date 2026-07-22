"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Skeleton } from "@/components/ui/skeleton";
import ErrorState from "@/components/ui/error-state";
import { useAuth } from "@/components/auth/auth-provider";
import HealthcareClaimForm from "@/components/healthcare/healthcare-claim-form";
import HealthcareEvidenceManager from "@/components/healthcare/healthcare-evidence-manager";
import HealthcareHistoryList from "@/components/healthcare/healthcare-history-list";
import {
  getMyHealthcareVerifications,
  type HealthcareMine,
  type HealthcareSubmission,
} from "@/lib/api/healthcare";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import { isHealthcareEvidenceEnabled } from "@/lib/healthcare/config";
import {
  canCreateSubmission,
  describeSubmissionStatus,
  healthcareErrorHint,
  isDeletionStatus,
  shouldContinueSubmissionPolling,
  type HealthcareTone,
} from "@/lib/healthcare/submission";

const POLL_INTERVAL_MS = 4_000;
const MAX_POLLS = 30; // ~2 minutes of bounded waiting

const TONE_CLASS: Record<HealthcareTone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  info: "bg-sky-100 text-sky-800",
  warning: "bg-amber-100 text-amber-900",
  success: "bg-green-100 text-green-800",
  danger: "bg-red-100 text-red-800",
};

/** Factual, informational privacy copy — not legal approval or a policy. */
function PrivacyNotes() {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
      <p>Evidence images are uploaded to private storage.</p>
      <p>
        MediCN creates a sanitized private review image and removes the original
        after processing.
      </p>
      <p>
        Deletion of your evidence is requested after a decision or withdrawal,
        and is complete only when MediCN reports it as deleted.
      </p>
      <p className="text-slate-500">
        This summary is informational. It is not legal approval and does not
        replace an approved consent or privacy policy.
      </p>
    </div>
  );
}

export default function HealthcareVerificationPanel() {
  const { accessToken, user } = useAuth();
  // Rollout guard is evaluated before ANY healthcare API or upload call.
  const enabled = isHealthcareEvidenceEnabled();

  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [mine, setMine] = useState<HealthcareMine | null>(null);
  const [loadError, setLoadError] = useState<{
    code: string;
    message: string;
  } | null>(null);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const pollsRef = useRef(0);

  useEffect(() => {
    // No network activity at all while the rollout guard is off.
    if (!enabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    pollsRef.current = 0;

    const tick = async () => {
      try {
        const data = await getMyHealthcareVerifications(
          accessToken ?? undefined,
          controller.signal
        );
        if (cancelled) return;
        setMine(data);
        setPhase("ready");
        setLoadError(null);

        if (
          shouldContinueSubmissionPolling(
            data.current,
            pollsRef.current,
            MAX_POLLS
          )
        ) {
          setPollTimedOut(false);
          pollsRef.current += 1;
          timer = setTimeout(tick, POLL_INTERVAL_MS);
        } else if (
          data.current &&
          shouldContinueSubmissionPolling(data.current, 0, MAX_POLLS)
        ) {
          // Still unfinished, but the budget is spent.
          setPollTimedOut(true);
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (error instanceof ApiError) {
          setLoadError({ code: error.code, message: error.message });
        } else {
          setLoadError({ code: "UNKNOWN", message: toErrorMessage(error) });
        }
        setPhase((current) => (current === "loading" ? "error" : current));
      }
    };

    void tick();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [enabled, accessToken, reloadKey]);

  const refresh = () => {
    setLoadError(null);
    setPollTimedOut(false);
    setReloadKey((key) => key + 1);
  };

  const applySubmission = (next: HealthcareSubmission) => {
    setMine((current) => {
      const history = current?.history ?? [];
      return {
        current: next,
        history: [next, ...history.filter((item) => item.id !== next.id)],
      };
    });
  };

  // --- Rollout disabled: honest unavailable state, no API/upload calls. ---
  if (!enabled) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-5">
          <h2 className="text-base font-semibold text-slate-900">
            Healthcare credential verification isn&apos;t available yet
          </h2>
          <p className="text-sm text-slate-600">
            This workflow is not enabled on MediCN. Nothing is uploaded or
            submitted, and no credential evidence is collected.
          </p>
        </div>
        <ButtonLink href="/account" variant="outline" className="w-fit">
          Back to profile
        </ButtonLink>
      </div>
    );
  }

  const identity = user?.identityVerification;
  const identityApproved = identity?.status === "approved";

  if (phase === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (phase === "error" || !mine) {
    const hint = loadError ? healthcareErrorHint(loadError.code) : null;
    return (
      <ErrorState
        title="We couldn't load your credential submissions"
        message={[loadError?.message ?? "Please try again.", hint]
          .filter(Boolean)
          .join(" ")}
        action={
          <Button variant="outline" onClick={refresh}>
            Try again
          </Button>
        }
      />
    );
  }

  const current = mine.current;
  const presentation = current ? describeSubmissionStatus(current.status) : null;
  const mayCreate = canCreateSubmission(current);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <ShieldCheck className="size-5 text-slate-700" aria-hidden="true" />
          Healthcare credentials
        </h2>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw aria-hidden="true" />
          Check again
        </Button>
      </div>

      <p className="text-sm text-slate-700">
        Healthcare credential verification confirms your professional role and
        affiliation. It is separate from identity verification.
      </p>

      {/* Identity prerequisite — explanation only. The backend check on
          POST /healthcare-verifications is authoritative. */}
      {!identityApproved && (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">
            Identity verification must be approved before you can submit
            healthcare credentials.
          </p>
          <p className="text-xs text-amber-800">
            Your identity verification is currently{" "}
            {identity ? identity.status.replaceAll("_", " ") : "not started"}.
          </p>
          <ButtonLink href="/account/verification" variant="outline">
            Go to identity verification
          </ButtonLink>
        </div>
      )}

      <PrivacyNotes />

      {loadError && phase === "ready" && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          {loadError.message}
        </div>
      )}

      {current && presentation && (
        <section className="flex flex-col gap-4 rounded-xl border border-slate-200 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-900">
              Current submission
            </h3>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[presentation.tone]}`}
            >
              {presentation.label}
            </span>
          </div>
          <p className="text-sm text-slate-700">{presentation.description}</p>

          {pollTimedOut && (
            <p className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
              <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
              This is taking longer than expected. Use Check again to refresh.
            </p>
          )}

          {!pollTimedOut && isDeletionStatus(current.status) &&
            current.status === "deletion_pending" && (
              <p className="flex items-center gap-2 text-sm text-slate-600">
                <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
                Waiting for MediCN to confirm secure deletion.
              </p>
            )}

          <HealthcareEvidenceManager
            submission={current}
            onUpdated={applySubmission}
            onRequestPoll={refresh}
          />
        </section>
      )}

      {mayCreate && identityApproved && (
        <HealthcareClaimForm onCreated={applySubmission} />
      )}

      {mayCreate && !identityApproved && (
        <p className="text-sm text-slate-600">
          Once your identity verification is approved, you can start a
          credential submission here.
        </p>
      )}

      <HealthcareHistoryList submissions={mine.history} />
    </div>
  );
}
