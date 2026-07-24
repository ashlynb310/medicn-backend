"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
import EmptyState from "@/components/ui/empty-state";
import ErrorState from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/components/auth/auth-provider";
import { listAdminHealthcareVerifications } from "@/lib/api/healthcare-admin";
import type {
  AdminHealthcareListMeta,
  AdminHealthcareSummary,
} from "@/lib/api/healthcare-admin";
import type {
  HealthcareEvidenceCategory,
  HealthcareSubmissionStatus,
} from "@/lib/api/healthcare";
import type { HealthcareRole } from "@/lib/api/auth";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import { isHealthcareEvidenceEnabled } from "@/lib/healthcare/config";
import {
  ANY_FILTER,
  buildAdminQueueQuery,
} from "@/lib/healthcare/admin-review";
import {
  affiliationNameLabel,
  affiliationTypeLabel,
  describeSubmissionStatus,
  evidenceCategoryLabel,
  healthcareRoleLabel,
} from "@/lib/healthcare/submission";
import HealthcareUnavailableNotice from "@/components/healthcare/healthcare-unavailable-notice";

const PAGE_SIZE = 20;

// The backend applies `status ?? pending_review`, so status is always explicit.
const statusItems: Record<string, string> = {
  pending_review: "Pending review",
  processing: "Processing",
  created: "Draft",
  uploading: "Uploading",
  processing_failed: "Processing failed",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  deletion_pending: "Deleting evidence",
  evidence_deleted: "Evidence deleted",
  deletion_failed: "Deletion incomplete",
};

const roleItems: Record<string, string> = {
  [ANY_FILTER]: "Any role",
  medical_student: "Medical student",
  nursing_student: "Nursing student",
  nurse: "Nurse",
  resident_physician: "Resident physician",
  physician: "Physician",
  other: "Other",
};

const categoryItems: Record<string, string> = {
  [ANY_FILTER]: "Any evidence type",
  license: "Professional license",
  student: "Student enrollment",
  employment: "Employment",
  other: "Other",
};

type State =
  | { status: "loading" }
  | { status: "error"; code: string; message: string; retryAfter: number | null }
  | {
      status: "ready";
      submissions: AdminHealthcareSummary[];
      meta: AdminHealthcareListMeta;
    };

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Guards the rollout flag before anything mounts, then remounts the queue per
 * authenticated account. Keying on `user.id` (never the access token) means
 * switching accounts synchronously discards the previous Admin's filters,
 * pagination, rows, errors, and request refs, while an ordinary token rotation
 * for the SAME user leaves filters intact. Backend FORBIDDEN stays authoritative.
 */
export default function AdminHealthcareQueue() {
  const { user } = useAuth();
  const enabled = isHealthcareEvidenceEnabled();

  if (!enabled) {
    return <HealthcareUnavailableNotice context="review" />;
  }

  return <QueueContent key={user?.id ?? "anonymous"} />;
}

function QueueContent() {
  const { accessToken } = useAuth();

  const [status, setStatus] = useState<HealthcareSubmissionStatus>("pending_review");
  const [role, setRole] = useState<HealthcareRole | typeof ANY_FILTER>(ANY_FILTER);
  const [category, setCategory] = useState<
    HealthcareEvidenceCategory | typeof ANY_FILTER
  >(ANY_FILTER);
  const [page, setPage] = useState(1);
  const [state, setState] = useState<State>({ status: "loading" });
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    // A response applies only when un-aborted AND still the owner, so an older
    // filter/page request can never overwrite the current view.
    const isStale = () =>
      controller.signal.aborted || requestRef.current !== controller;

    listAdminHealthcareVerifications(
      buildAdminQueueQuery({ status, role, evidenceCategory: category, page, limit: PAGE_SIZE }),
      accessToken ?? undefined,
      controller.signal
    )
      .then(({ submissions, meta }) => {
        if (isStale()) return;
        setState({ status: "ready", submissions, meta });
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (isStale()) return;
        if (error instanceof ApiError) {
          setState({
            status: "error",
            code: error.code,
            message: error.message,
            retryAfter: error.retryAfterSeconds,
          });
        } else {
          setState({
            status: "error",
            code: "UNKNOWN",
            message: toErrorMessage(error),
            retryAfter: null,
          });
        }
      });
  }, [accessToken, status, role, category, page]);

  useEffect(() => {
    load();
    return () => requestRef.current?.abort();
  }, [load]);

  const changeFilter = (apply: () => void) => {
    setState({ status: "loading" });
    apply();
    setPage(1);
  };

  const goToPage = (next: number) => {
    setState({ status: "loading" });
    setPage(next);
  };

  const retry = () => {
    setState({ status: "loading" });
    load();
  };

  const totalPages =
    state.status === "ready"
      ? Math.max(1, Math.ceil(state.meta.total / state.meta.limit))
      : 1;

  const isRateLimited =
    state.status === "error" &&
    (state.code === "RATE_LIMIT_EXCEEDED" || state.code === "RATE_LIMITED");

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hc-status">Status</Label>
          <Select
            items={statusItems}
            value={status}
            onValueChange={(v) =>
              changeFilter(() =>
                setStatus((v as HealthcareSubmissionStatus) ?? "pending_review")
              )
            }
          >
            <SelectTrigger id="hc-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(statusItems).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hc-role">Role</Label>
          <Select
            items={roleItems}
            value={role}
            onValueChange={(v) =>
              changeFilter(() =>
                setRole((v as HealthcareRole | typeof ANY_FILTER) ?? ANY_FILTER)
              )
            }
          >
            <SelectTrigger id="hc-role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(roleItems).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hc-category">Evidence type</Label>
          <Select
            items={categoryItems}
            value={category}
            onValueChange={(v) =>
              changeFilter(() =>
                setCategory(
                  (v as HealthcareEvidenceCategory | typeof ANY_FILTER) ?? ANY_FILTER
                )
              )
            }
          >
            <SelectTrigger id="hc-category" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(categoryItems).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {state.status === "loading" && (
        <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {state.status === "error" &&
        (state.code === "FORBIDDEN" ? (
          <ErrorState
            title="You don't have access to healthcare review"
            message="This area is limited to MediCN administrators."
          />
        ) : (
          <ErrorState
            title="We couldn't load the review queue"
            message={
              isRateLimited
                ? `Too many requests. ${
                    state.retryAfter
                      ? `Try again in about ${state.retryAfter}s.`
                      : "Please wait a moment and try again."
                  }`
                : state.message
            }
            action={
              <Button variant="outline" onClick={retry}>
                Try again
              </Button>
            }
          />
        ))}

      {state.status === "ready" && state.submissions.length === 0 && (
        <EmptyState
          icon={ShieldCheck}
          title="Nothing to review"
          description="No healthcare credential submissions match these filters."
        />
      )}

      {state.status === "ready" && state.submissions.length > 0 && (
        <>
          <ul className="flex flex-col gap-3">
            {state.submissions.map((submission) => {
              const presentation = describeSubmissionStatus(submission.status);
              const readyCount = submission.evidence.filter((e) => e.ready).length;
              return (
                <li key={submission.id}>
                  <Link
                    href={`/admin/healthcare-verifications/${submission.id}`}
                    className="flex flex-col gap-1.5 rounded-xl border border-slate-200 p-4 outline-none transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-900">
                        {healthcareRoleLabel(submission.claimedRole)} · v
                        {submission.version}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {presentation.label}
                      </span>
                    </div>
                    <p className="text-sm text-slate-700">
                      {affiliationNameLabel(submission.claimedAffiliationName)}
                      {" · "}
                      {affiliationTypeLabel(submission.claimedAffiliationType)}
                    </p>
                    {/* Readiness counts only — never a thumbnail or preloaded image. */}
                    <p className="text-xs text-slate-500">
                      {evidenceCategoryLabel(submission.evidenceCategory)}
                      {" · "}
                      {readyCount} of {submission.evidence.length} image
                      {submission.evidence.length === 1 ? "" : "s"} ready
                      {" · "}
                      Submitted {formatDate(submission.submittedAt)}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>

          {totalPages > 1 && (
            <nav
              aria-label="Review queue pages"
              className="flex items-center justify-center gap-4"
            >
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
              >
                <ChevronLeft aria-hidden="true" />
                Previous
              </Button>
              <span className="text-sm text-slate-600">
                Page {state.meta.page} of {totalPages}
              </span>
              <Button
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => goToPage(page + 1)}
              >
                Next
                <ChevronRight aria-hidden="true" />
              </Button>
            </nav>
          )}
        </>
      )}

      <ButtonLink href="/admin/listings" variant="outline" className="w-fit">
        Listing moderation
      </ButtonLink>
    </div>
  );
}
