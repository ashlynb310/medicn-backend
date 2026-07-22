"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, SearchX } from "lucide-react";
import EmptyState from "@/components/ui/empty-state";
import ErrorState from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { useAuth } from "@/components/auth/auth-provider";
import AdminHealthcareEvidenceViewer from "@/components/admin/admin-healthcare-evidence-viewer";
import AdminHealthcareDecisionForm from "@/components/admin/admin-healthcare-decision-form";
import HealthcareUnavailableNotice from "@/components/healthcare/healthcare-unavailable-notice";
import { getAdminHealthcareVerification } from "@/lib/api/healthcare-admin";
import type { AdminHealthcareDetail as AdminDetail } from "@/lib/api/healthcare-admin";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import { isUuid } from "@/lib/uuid";
import { isHealthcareEvidenceEnabled } from "@/lib/healthcare/config";
import { shouldClearDecisionRecorded } from "@/lib/healthcare/admin-review";
import {
  affiliationNameLabel,
  affiliationTypeLabel,
  describeSubmissionStatus,
  evidenceCategoryLabel,
  healthcareRoleLabel,
} from "@/lib/healthcare/submission";

const reasonLabels: Record<string, string> = {
  information_confirmed: "Information confirmed",
  evidence_unreadable: "Evidence unreadable",
  information_mismatch: "Information mismatch",
  unsupported_evidence: "Unsupported evidence",
  other: "Other",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2.5 last:border-b-0">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="text-sm font-medium text-slate-900">{children}</dd>
    </div>
  );
}

/**
 * Guards the rollout flag and the route id BEFORE any request, then remounts the
 * content per (submission, account). That remount is what guarantees form
 * selections, notes, held evidence URLs, and previously loaded detail can never
 * carry from submission A to submission B — or across Admin accounts.
 */
export default function AdminHealthcareDetail({ id }: { id: string }) {
  const { user } = useAuth();
  const enabled = isHealthcareEvidenceEnabled();
  const validId = isUuid(id) ? id : null;

  if (!enabled) {
    return <HealthcareUnavailableNotice context="review" />;
  }

  if (!validId) {
    return (
      <EmptyState
        icon={SearchX}
        title="Submission not found"
        description="That review link isn't valid."
        action={
          <ButtonLink href="/admin/healthcare-verifications">
            Back to the queue
          </ButtonLink>
        }
      />
    );
  }

  return (
    <DetailContent
      key={`${validId}:${user?.id ?? "anonymous"}`}
      id={validId}
    />
  );
}

function DetailContent({ id }: { id: string }) {
  const { accessToken } = useAuth();

  const [phase, setPhase] = useState<"loading" | "ready" | "not_found" | "error">(
    "loading"
  );
  const [detail, setDetail] = useState<AdminDetail | null>(null);
  const [loadError, setLoadError] = useState<{
    code: string;
    message: string;
  } | null>(null);
  // Bumping this clears every held evidence URL (refresh, decision).
  const [clearToken, setClearToken] = useState(0);
  // Set the moment a PATCH succeeds, so no second decision is possible even
  // before the authoritative reload returns.
  const [decisionRecorded, setDecisionRecorded] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    // A response only applies when it is both un-aborted AND still the owner,
    // so an older request can never overwrite the current view.
    const isStale = () =>
      controller.signal.aborted || requestRef.current !== controller;

    getAdminHealthcareVerification(id, accessToken ?? undefined, controller.signal)
      .then((data) => {
        if (isStale()) return;
        setDetail(data);
        setPhase("ready");
        setLoadError(null);
        // Converge the interim "recorded" panel only once authoritative state
        // actually shows the decision (or a non-pending status). A reload that
        // still reports pending_review with no decision keeps it.
        if (shouldClearDecisionRecorded(data)) {
          setDecisionRecorded(false);
        }
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (isStale()) return;
        if (error instanceof ApiError && error.code === "NOT_FOUND") {
          setPhase("not_found");
          return;
        }
        if (error instanceof ApiError) {
          setLoadError({ code: error.code, message: error.message });
        } else {
          setLoadError({ code: "UNKNOWN", message: toErrorMessage(error) });
        }
        setPhase((current) => (current === "loading" ? "error" : current));
      });
  }, [id, accessToken]);

  useEffect(() => {
    load();
    return () => requestRef.current?.abort();
  }, [load]);

  // Token rotation is handled inside the viewer itself (its cleanup effect
  // depends on accessToken), so no extra clearing effect is needed here.

  const refresh = () => {
    setClearToken((token) => token + 1); // drop every held evidence URL
    setLoadError(null);
    load();
  };

  if (phase === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (phase === "not_found") {
    return (
      <EmptyState
        icon={SearchX}
        title="Submission not found"
        description="This healthcare submission may have been removed."
        action={
          <ButtonLink href="/admin/healthcare-verifications">
            Back to the queue
          </ButtonLink>
        }
      />
    );
  }

  if (phase === "error" || !detail) {
    return (
      <ErrorState
        title={
          loadError?.code === "FORBIDDEN"
            ? "You don't have access to healthcare review"
            : "We couldn't load this submission"
        }
        message={loadError?.message ?? "Please try again."}
        action={
          loadError?.code === "FORBIDDEN" ? undefined : (
            <Button variant="outline" onClick={refresh}>
              Try again
            </Button>
          )
        }
      />
    );
  }

  const presentation = describeSubmissionStatus(detail.status);
  const isPending = detail.status === "pending_review";
  const decided = detail.decision !== null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold text-slate-900">
            {healthcareRoleLabel(detail.claimedRole)} · v{detail.version}
          </h1>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
            {presentation.label}
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <dl className="rounded-xl border border-slate-200 p-4">
        <Row label="Organization">
          {affiliationNameLabel(detail.claimedAffiliationName)}
        </Row>
        <Row label="Organization type">
          {affiliationTypeLabel(detail.claimedAffiliationType)}
        </Row>
        <Row label="Evidence type">
          {evidenceCategoryLabel(detail.evidenceCategory)}
        </Row>
        <Row label="Submitted">{formatDateTime(detail.submittedAt)}</Row>
        <Row label="Created">{formatDateTime(detail.createdAt)}</Row>
        <Row label="Subject reference">
          <span className="font-mono text-xs">{detail.userId}</span>
        </Row>
      </dl>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-slate-900">
          Sanitized evidence
        </h2>
        <p className="text-sm text-slate-600">
          Images open only when you choose View, through a short-lived private
          link that is recorded in the audit log.
        </p>
        {detail.evidence.length === 0 ? (
          <p className="text-sm text-slate-500">No evidence images.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {detail.evidence.map((evidence, index) => (
              <AdminHealthcareEvidenceViewer
                key={evidence.id}
                verificationId={detail.id}
                evidence={evidence}
                index={index}
                viewable={isPending}
                clearToken={clearToken}
              />
            ))}
          </ul>
        )}
      </section>

      {decided && detail.decision && (
        <section className="flex flex-col gap-2 rounded-xl border border-slate-200 p-4">
          <h2 className="text-base font-semibold text-slate-900">Decision</h2>
          <dl>
            <Row label="Outcome">{detail.decision.status}</Row>
            <Row label="Reason">
              {detail.decision.reasonCode
                ? (reasonLabels[detail.decision.reasonCode] ??
                  detail.decision.reasonCode)
                : "Not recorded"}
            </Row>
            <Row label="Decided">{formatDateTime(detail.decision.decidedAt)}</Row>
            <Row label="Reviewer">
              <span className="font-mono text-xs">
                {detail.decision.reviewerId ?? "Not recorded"}
              </span>
            </Row>
          </dl>
          {detail.decision.note && (
            <div className="flex flex-col gap-1">
              <span className="text-sm text-slate-600">Internal note</span>
              <p className="whitespace-pre-line text-sm text-slate-800">
                {detail.decision.note}
              </p>
            </div>
          )}
        </section>
      )}

      {/* A recorded decision permanently replaces the form for this mount, so
          a second irreversible PATCH is impossible even if the authoritative
          reload is slow or fails. Nothing here is fabricated from the limited
          PATCH response — reviewer, note, and full decision detail come only
          from GET. */}
      {decisionRecorded && (
        <section className="flex flex-col items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 p-4">
          <h2 className="text-base font-semibold text-sky-900">
            Decision recorded
          </h2>
          {loadError ? (
            <>
              <p className="text-sm text-sky-900">
                Your decision was recorded, but we couldn&apos;t reload the
                authoritative state: {loadError.message}
              </p>
              <Button variant="outline" size="sm" onClick={refresh}>
                <RefreshCw aria-hidden="true" />
                Refresh
              </Button>
            </>
          ) : (
            <p className="text-sm text-sky-900">
              Refreshing authoritative state…
            </p>
          )}
        </section>
      )}

      {isPending && !decided && !decisionRecorded && (
        <AdminHealthcareDecisionForm
          verificationId={detail.id}
          onDecided={() => {
            // Immediately: drop every held evidence URL and block any further
            // decision — before the authoritative reload returns.
            setClearToken((token) => token + 1);
            setDecisionRecorded(true);
            setLoadError(null);
            load();
          }}
          onRefresh={refresh}
        />
      )}

      <ButtonLink
        href="/admin/healthcare-verifications"
        variant="outline"
        className="w-fit"
      >
        Back to the queue
      </ButtonLink>
    </div>
  );
}
