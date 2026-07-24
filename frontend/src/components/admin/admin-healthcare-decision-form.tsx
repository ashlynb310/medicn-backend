"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, ShieldCheck, ShieldX } from "lucide-react";
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
import { decideAdminHealthcareVerification } from "@/lib/api/healthcare-admin";
import type {
  AdminDecisionResult,
  HealthcareDecisionReasonCode,
} from "@/lib/api/healthcare-admin";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import {
  APPROVAL_REASON_CODE,
  canSubmitDecision,
  decisionNoteState,
  defaultReasonCodeFor,
  REJECTION_REASON_CODES,
} from "@/lib/healthcare/admin-review";
import { resolveAttemptCompletion } from "@/lib/healthcare/submission";

const rejectionReasonItems: Record<string, string> = {
  evidence_unreadable: "Evidence unreadable",
  information_mismatch: "Information mismatch",
  unsupported_evidence: "Unsupported evidence",
  other: "Other",
};

function decisionErrorHint(code: string): string | null {
  switch (code) {
    case "HEALTHCARE_DECISION_CONFLICT":
      return "This submission was already decided, or another administrator decided it first. Refresh to load the authoritative state.";
    case "HEALTHCARE_EVIDENCE_NOT_READY":
      return "The sanitized evidence isn't ready, so a decision can't be recorded yet.";
    case "FORBIDDEN":
      return "Only administrators can decide healthcare submissions.";
    case "NOT_FOUND":
      return "This submission no longer exists. Refresh the queue.";
    case "VALIDATION_ERROR":
      return "Check the decision reason and note, then try again.";
    default:
      return null;
  }
}

/**
 * Records exactly one irreversible decision. Approve is always
 * `information_confirmed`; reject requires an explicit rejection reason. The UI
 * only changes after the backend PATCH succeeds, and every held evidence URL is
 * cleared immediately afterwards by the parent.
 */
export default function AdminHealthcareDecisionForm({
  verificationId,
  onDecided,
  onRefresh,
}: {
  verificationId: string;
  onDecided: (result: AdminDecisionResult) => void;
  onRefresh: () => void;
}) {
  const { accessToken } = useAuth();
  const [decision, setDecision] = useState<"approved" | "rejected" | null>(null);
  const [reasonCode, setReasonCode] =
    useState<HealthcareDecisionReasonCode | null>(null);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{
    code: string;
    message: string;
    retryAfter: number | null;
  } | null>(null);

  // One owned PATCH attempt at a time; aborted on unmount, token change, or a
  // change of submission so a late response can never apply.
  const attemptRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      // Abort ONLY. The ref is deliberately left intact so the in-flight
      // attempt still owns its busy state and can clear it in `finally` —
      // otherwise a token change would strand "Recording…".
      attemptRef.current?.abort();
    },
    [accessToken, verificationId]
  );

  const noteState = decisionNoteState(note);
  const ready = canSubmitDecision({ decision, reasonCode, note });

  const chooseDecision = (next: "approved" | "rejected") => {
    setDecision(next);
    setReasonCode(defaultReasonCodeFor(next));
    setConfirming(false);
    setError(null);
  };

  const submit = async () => {
    // Re-entrancy guard: never allow a duplicate irreversible decision.
    if (!ready || submitting || !decision || !reasonCode) return;
    attemptRef.current?.abort();
    const controller = new AbortController();
    attemptRef.current = controller;
    const isStale = () =>
      controller.signal.aborted || attemptRef.current !== controller;

    setError(null);
    setSubmitting(true);
    try {
      const result = await decideAdminHealthcareVerification(
        verificationId,
        {
          status: decision,
          reasonCode,
          ...(noteState.trimmed ? { note: noteState.trimmed } : {}),
        },
        accessToken ?? undefined,
        controller.signal
      );
      // A stale/aborted response must not report success or update the UI.
      if (isStale()) return;
      // Only now does the UI change. The parent immediately clears evidence
      // URLs and reloads the authoritative detail.
      setConfirming(false);
      onDecided(result);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (isStale()) return;
      if (err instanceof ApiError) {
        setError({
          code: err.code,
          message: err.message,
          retryAfter: err.retryAfterSeconds,
        });
      } else {
        setError({
          code: "UNKNOWN",
          message: toErrorMessage(err),
          retryAfter: null,
        });
      }
      // A failed PATCH leaves the form retryable.
      setConfirming(false);
    } finally {
      // Ownership, not abort status: an aborted attempt still clears its own
      // busy state; a SUPERSEDED attempt must never clear a newer one's.
      const completion = resolveAttemptCompletion(attemptRef.current, controller);
      if (completion.releaseRef) attemptRef.current = null;
      if (completion.clearBusyState) setSubmitting(false);
    }
  };

  const isRateLimited =
    error?.code === "RATE_LIMIT_EXCEEDED" || error?.code === "RATE_LIMITED";
  const needsRefresh =
    error?.code === "HEALTHCARE_DECISION_CONFLICT" || error?.code === "NOT_FOUND";

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-slate-200 p-5">
      <h2 className="text-base font-semibold text-slate-900">Record a decision</h2>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={decision === "approved" ? "default" : "outline"}
          onClick={() => chooseDecision("approved")}
          disabled={submitting}
        >
          <ShieldCheck aria-hidden="true" />
          Approve
        </Button>
        <Button
          type="button"
          variant={decision === "rejected" ? "destructive" : "outline"}
          onClick={() => chooseDecision("rejected")}
          disabled={submitting}
        >
          <ShieldX aria-hidden="true" />
          Reject
        </Button>
      </div>

      {decision === "approved" && (
        <p className="text-sm text-slate-600">
          Approval is recorded with the reason{" "}
          <span className="font-medium text-slate-800">information confirmed</span>.
        </p>
      )}

      {decision === "rejected" && (
        <div className="flex flex-col gap-1.5 sm:max-w-sm">
          <Label htmlFor="hc-reason">Rejection reason</Label>
          <Select
            items={rejectionReasonItems}
            value={reasonCode ?? ""}
            onValueChange={(v) =>
              setReasonCode((v as HealthcareDecisionReasonCode) ?? null)
            }
          >
            <SelectTrigger id="hc-reason" className="w-full">
              <SelectValue placeholder="Choose a reason" />
            </SelectTrigger>
            <SelectContent>
              {REJECTION_REASON_CODES.map((code) => (
                <SelectItem key={code} value={code}>
                  {rejectionReasonItems[code]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {decision && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hc-note">Internal note (optional)</Label>
          <textarea
            id="hc-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Context for other administrators."
            className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <span
            className={`text-xs ${
              noteState.valid ? "text-slate-500" : "text-red-600"
            }`}
          >
            {noteState.valid
              ? `${noteState.remaining} characters left`
              : `${Math.abs(noteState.remaining)} characters over the limit`}
          </span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex flex-col items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3"
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
            decisionErrorHint(error.code) && (
              <p className="text-xs text-red-700">
                {decisionErrorHint(error.code)}
              </p>
            )
          )}
          {needsRefresh && (
            <Button variant="outline" size="sm" onClick={onRefresh}>
              Refresh
            </Button>
          )}
        </div>
      )}

      {decision && !confirming && (
        <Button
          type="button"
          variant={decision === "rejected" ? "destructive" : "default"}
          className="w-fit"
          disabled={!ready || submitting}
          onClick={() => setConfirming(true)}
        >
          Continue
        </Button>
      )}

      {confirming && decision && (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">
            {decision === "approved" ? "Approve" : "Reject"} this submission? This
            decision is final and can&apos;t be undone. MediCN will then request
            secure deletion of the evidence images.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={decision === "rejected" ? "destructive" : "default"}
              onClick={submit}
              disabled={submitting || !ready}
            >
              {submitting
                ? "Recording…"
                : decision === "approved"
                  ? "Yes, approve"
                  : "Yes, reject"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {decision === "approved" && reasonCode !== APPROVAL_REASON_CODE && (
        <p className="text-xs text-red-700">
          Approval must use the confirmed-information reason.
        </p>
      )}
    </section>
  );
}
