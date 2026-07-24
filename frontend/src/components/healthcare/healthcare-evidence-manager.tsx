"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, Loader2, Send, Upload, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";
import {
  completeHealthcareEvidence,
  createHealthcareEvidenceUploadIntent,
  submitHealthcareVerification,
  withdrawHealthcareVerification,
} from "@/lib/api/healthcare";
import type {
  HealthcareEvidenceStatus,
  HealthcareSubmission,
} from "@/lib/api/healthcare";
import { uploadFileToSignedUrl } from "@/lib/api/uploads";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import {
  ALLOWED_EVIDENCE_TYPES,
  canAddEvidence,
  canSubmit,
  canWithdraw,
  healthcareErrorHint,
  isStaleHealthcareAttempt,
  isSubmissionEditable,
  MAX_EVIDENCE_COUNT,
  resolveAttemptCompletion,
  resolveEvidenceControls,
  uploadFailureRecovery,
  validateEvidenceFile,
  type AllowedEvidenceType,
} from "@/lib/healthcare/submission";

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

const EVIDENCE_STATUS_LABEL: Record<HealthcareEvidenceStatus, string> = {
  processing: "Processing",
  ready: "Ready",
  processing_failed: "Processing failed",
  deleted: "Deleted",
};

const EVIDENCE_STATUS_CLASS: Record<HealthcareEvidenceStatus, string> = {
  processing: "bg-sky-100 text-sky-800",
  ready: "bg-green-100 text-green-800",
  processing_failed: "bg-amber-100 text-amber-900",
  deleted: "bg-slate-100 text-slate-600",
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

function ErrorNotice({ error }: { error: RequestError }) {
  const isRateLimited =
    error.code === "RATE_LIMIT_EXCEEDED" || error.code === "RATE_LIMITED";
  const hint = isRateLimited
    ? error.retryAfter
      ? `Too many attempts. Try again in about ${error.retryAfter}s.`
      : "Too many attempts. Please wait a moment and try again."
    : healthcareErrorHint(error.code);
  return (
    <div
      role="alert"
      className="flex flex-col gap-1 rounded-lg border border-red-200 bg-red-50 p-3"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
        <CircleAlert className="size-4" aria-hidden="true" />
        {error.message}
      </p>
      {hint && <p className="text-xs text-red-700">{hint}</p>}
    </div>
  );
}

/**
 * Evidence upload, submit, and withdraw for the current submission.
 *
 * The signed upload URL exists ONLY as a local variable inside the upload
 * function: it is never rendered, logged, persisted, or placed in React state,
 * and the storage PUT is raw (no Supabase bearer token). No image bytes,
 * thumbnails, storage paths, or derivative URLs are ever displayed — only the
 * coarse per-image status the backend returns.
 */
export default function HealthcareEvidenceManager({
  submission,
  onUpdated,
  onRequestPoll,
}: {
  submission: HealthcareSubmission;
  onUpdated: (next: HealthcareSubmission) => void;
  onRequestPoll: () => void;
}) {
  const { accessToken } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStep, setUploadStep] = useState<
    "idle" | "requesting" | "transferring" | "confirming"
  >("idle");
  const [busyAction, setBusyAction] = useState<null | "submit" | "withdraw">(null);
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<RequestError | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);

  // Sensitive operations are cancelled on unmount, access-token change, or a
  // change of submission, and replaced attempts abort the previous one.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      // Abort ONLY. The ref is deliberately left intact so the in-flight
      // attempt still owns its visible busy state and can clear it in
      // `finally` — otherwise a token change would strand "Uploading…".
      abortRef.current?.abort();
    },
    [accessToken, submission.id]
  );

  /** Starts a new attempt, aborting any previous one (defense in depth). */
  const beginAttempt = () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return controller;
  };

  /** True when this attempt was cancelled or superseded. */
  const isStale = (controller: AbortController) =>
    isStaleHealthcareAttempt(
      controller.signal.aborted,
      abortRef.current === controller
    );

  /** Clears only what this attempt still owns. */
  const finishAttempt = (controller: AbortController, clear: () => void) => {
    const completion = resolveAttemptCompletion(abortRef.current, controller);
    if (completion.releaseRef) abortRef.current = null;
    if (completion.clearBusyState) clear();
  };

  const editable = isSubmissionEditable(submission);
  const controls = resolveEvidenceControls({
    canAdd: canAddEvidence(submission),
    submitReady: canSubmit(submission),
    withdrawable: canWithdraw(submission),
    uploading,
    busy: busyAction !== null,
    confirmingWithdraw,
  });
  const withdrawable = canWithdraw(submission);
  const atEvidenceLimit = submission.evidenceCount >= MAX_EVIDENCE_COUNT;

  const addEvidence = async (file: File) => {
    // Normal UI use never overlaps operations; this is the programmatic guard.
    if (controls.operationInFlight || confirmingWithdraw) return;
    setFileError(null);
    setError(null);
    setRecoveryMessage(null);
    const validation = validateEvidenceFile(file);
    if (!validation.ok) {
      setFileError(validation.message);
      return;
    }

    const controller = beginAttempt();
    // Once the intent succeeds the backend has already created the evidence
    // record and consumed one of the three slots.
    let intentCreated = false;
    setUploading(true);
    try {
      const token = accessToken ?? undefined;
      setUploadStep("requesting");
      const intent = await createHealthcareEvidenceUploadIntent(
        submission.id,
        {
          fileName: file.name,
          contentType: file.type as AllowedEvidenceType,
        },
        token,
        controller.signal
      );
      if (isStale(controller)) return;
      intentCreated = true;

      // `intent.uploadUrl` is used here and nowhere else — a transient local
      // value passed straight to the raw storage PUT. The bearer token is NOT
      // attached to that request.
      setUploadStep("transferring");
      await uploadFileToSignedUrl(intent.uploadUrl, file, controller.signal);
      if (isStale(controller)) return;

      // Only after `complete` succeeds is the upload real.
      setUploadStep("confirming");
      await completeHealthcareEvidence(
        submission.id,
        intent.evidenceId,
        token,
        controller.signal
      );
      if (isStale(controller)) return;
      onRequestPoll();
    } catch (err) {
      // A cancelled/superseded attempt is not a failure and must not update
      // visible state or fire callbacks.
      if (isAbortError(err) || isStale(controller)) return;
      setError(toRequestError(err));
      const recovery = uploadFailureRecovery(intentCreated);
      if (recovery.reconcile) {
        setRecoveryMessage(recovery.message);
        // The server is ahead of the UI — reconcile against GET /me.
        onRequestPoll();
      }
    } finally {
      finishAttempt(controller, () => {
        setUploadStep("idle");
        setUploading(false);
      });
    }
  };

  const submitForReview = async () => {
    if (controls.operationInFlight || confirmingWithdraw) return;
    setError(null);
    setRecoveryMessage(null);
    const controller = beginAttempt();
    setBusyAction("submit");
    try {
      const updated = await submitHealthcareVerification(
        submission.id,
        accessToken ?? undefined,
        controller.signal
      );
      if (isStale(controller)) return;
      onUpdated(updated);
    } catch (err) {
      if (isAbortError(err) || isStale(controller)) return;
      setError(toRequestError(err));
    } finally {
      finishAttempt(controller, () => setBusyAction(null));
    }
  };

  const withdraw = async () => {
    if (controls.operationInFlight) return;
    setError(null);
    setRecoveryMessage(null);
    const controller = beginAttempt();
    setBusyAction("withdraw");
    try {
      const updated = await withdrawHealthcareVerification(
        submission.id,
        accessToken ?? undefined,
        controller.signal
      );
      if (isStale(controller)) return;
      setConfirmingWithdraw(false);
      onUpdated(updated);
      // Deletion is asynchronous; keep reading until evidence_deleted.
      onRequestPoll();
    } catch (err) {
      if (isAbortError(err) || isStale(controller)) return;
      setError(toRequestError(err));
    } finally {
      finishAttempt(controller, () => setBusyAction(null));
    }
  };

  const uploadLabel =
    uploadStep === "requesting"
      ? "Preparing…"
      : uploadStep === "transferring"
        ? "Uploading…"
        : uploadStep === "confirming"
          ? "Confirming…"
          : "Add evidence image";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-slate-900">
          Evidence images ({submission.evidenceCount} of {MAX_EVIDENCE_COUNT})
        </h3>

        {submission.evidence.length === 0 ? (
          <p className="text-sm text-slate-600">No images added yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {submission.evidence.map((item, index) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                {/* Never a thumbnail, URL, file name, or storage path. */}
                <span className="font-medium text-slate-800">
                  Image {index + 1}
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${EVIDENCE_STATUS_CLASS[item.status]}`}
                >
                  {item.status === "processing" && (
                    <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  )}
                  {EVIDENCE_STATUS_LABEL[item.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editable && (
        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={ALLOWED_EVIDENCE_TYPES.join(",")}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void addEvidence(file);
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={!controls.canUpload}
              onClick={() => inputRef.current?.click()}
            >
              <Upload aria-hidden="true" />
              {uploadLabel}
            </Button>
            <span className="text-sm text-slate-500">
              JPEG, PNG, or WebP, up to 10 MB. One image at a time.
            </span>
          </div>
          {atEvidenceLimit && (
            <p className="text-xs text-slate-500">
              You&apos;ve added the maximum of {MAX_EVIDENCE_COUNT} images.
            </p>
          )}
          {fileError && (
            <p role="alert" className="text-sm font-medium text-red-600">
              {fileError}
            </p>
          )}
        </div>
      )}

      {error && <ErrorNotice error={error} />}

      {/* Post-intent failure: the server may already hold the evidence record,
          so we never imply that adding again removes or replaces it. */}
      {recoveryMessage && (
        <p
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        >
          {recoveryMessage}
        </p>
      )}

      {/* processing_failed is a dead end for THIS version: no more evidence can
          be added, and there is no subject-side way to remove or replace an
          image. Starting a new submission and withdrawing this one are two
          INDEPENDENT options — withdrawal is never a prerequisite. */}
      {!editable && canWithdraw(submission) && submission.status === "processing_failed" && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          This failed version can&apos;t accept more evidence. You can start a new
          submission now. You can also withdraw this version to request secure
          deletion.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <Button
            type="button"
            onClick={submitForReview}
            disabled={!controls.canSubmit}
          >
            <Send aria-hidden="true" />
            {busyAction === "submit" ? "Submitting…" : "Submit for review"}
          </Button>
        )}
        {withdrawable && !confirmingWithdraw && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirmingWithdraw(true)}
            disabled={!controls.canOpenWithdraw}
          >
            <XCircle aria-hidden="true" />
            Withdraw
          </Button>
        )}
      </div>

      {editable && !canSubmit(submission) && submission.evidence.length > 0 && (
        <p className="text-xs text-slate-500">
          Submit becomes available once every image finishes processing.
        </p>
      )}

      {confirmingWithdraw && withdrawable && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <span className="text-sm font-medium text-amber-900">
            Withdraw this submission? MediCN will request secure deletion of your
            evidence.
          </span>
          <Button
            variant="destructive"
            size="sm"
            onClick={withdraw}
            disabled={!controls.canConfirmWithdraw}
          >
            {busyAction === "withdraw" ? "Withdrawing…" : "Yes, withdraw"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmingWithdraw(false)}
            disabled={controls.operationInFlight}
          >
            Keep submission
          </Button>
        </div>
      )}
    </div>
  );
}
