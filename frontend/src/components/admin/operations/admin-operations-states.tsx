"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import ErrorState from "@/components/ui/error-state";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import { operationalErrorPresentation } from "@/lib/admin-operations/presentation";
import type { AdminOperationalPaginationMeta } from "@/lib/api/admin-operations";

export interface AdminOperationalRequestError {
  code: string;
  status: number | null;
  message: string;
  retryAfterSeconds: number | null;
}

export function toAdminOperationalRequestError(
  error: unknown
): AdminOperationalRequestError {
  if (error instanceof ApiError) {
    return {
      code: error.code,
      status: error.status,
      message: error.message,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }
  return {
    code: "UNKNOWN",
    status: null,
    message: toErrorMessage(error),
    retryAfterSeconds: null,
  };
}

export function AdminOperationalErrorState({
  error,
  onRetry,
}: {
  error: AdminOperationalRequestError;
  onRetry?: () => void;
}) {
  const presentation = operationalErrorPresentation(error);
  return (
    <ErrorState
      title={presentation.title}
      message={presentation.message}
      action={
        presentation.kind === "forbidden" ||
        presentation.kind === "not_found" ||
        !onRetry ? undefined : (
          <Button variant="outline" onClick={onRetry}>
            Try again
          </Button>
        )
      }
    />
  );
}

export function AdminOperationalPagination({
  meta,
  onPage,
}: {
  meta: AdminOperationalPaginationMeta;
  onPage: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(meta.total / meta.limit));
  if (totalPages <= 1) return null;
  return (
    <nav
      aria-label="Operational result pages"
      className="flex flex-wrap items-center justify-center gap-3"
    >
      <Button
        variant="outline"
        disabled={meta.page <= 1}
        onClick={() => onPage(meta.page - 1)}
      >
        <ChevronLeft aria-hidden="true" />
        Previous
      </Button>
      <span className="text-sm text-slate-600">
        Page {meta.page} of {totalPages} - {meta.total} records
      </span>
      <Button
        variant="outline"
        disabled={meta.page >= totalPages}
        onClick={() => onPage(meta.page + 1)}
      >
        Next
        <ChevronRight aria-hidden="true" />
      </Button>
    </nav>
  );
}

const STATUS_TONE: Record<string, string> = {
  paid: "bg-green-100 text-green-800",
  transferred: "bg-green-100 text-green-800",
  succeeded: "bg-green-100 text-green-800",
  current: "bg-green-100 text-green-800",
  pending: "bg-sky-100 text-sky-800",
  processing: "bg-sky-100 text-sky-800",
  running: "bg-sky-100 text-sky-800",
  queued: "bg-sky-100 text-sky-800",
  partially_refunded: "bg-amber-100 text-amber-900",
  partially_reversed: "bg-amber-100 text-amber-900",
  partially_succeeded: "bg-amber-100 text-amber-900",
  blocked: "bg-amber-100 text-amber-900",
  failed: "bg-red-100 text-red-800",
  failed_retryable: "bg-red-100 text-red-800",
  failed_permanent: "bg-red-100 text-red-800",
  dead_letter: "bg-red-100 text-red-800",
  disputed: "bg-red-100 text-red-800",
  stale: "bg-red-100 text-red-800",
};

export function AdminOperationalStatusBadge({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        STATUS_TONE[value] ?? "bg-slate-100 text-slate-700"
      }`}
    >
      {label}
    </span>
  );
}
