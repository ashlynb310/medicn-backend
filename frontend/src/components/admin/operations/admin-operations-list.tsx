"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Inbox } from "lucide-react";
import EmptyState from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  listAdminFailedJobExecutions,
  listAdminHostTransfers,
  listAdminJobExecutions,
  listAdminOperationalCommands,
  listAdminPayments,
  type AdminHostTransferSummary,
  type AdminJobExecution,
  type AdminOperationalCommand,
  type AdminOperationalPaginationMeta,
  type AdminPaymentSummary,
} from "@/lib/api/admin-operations";
import { adminOperationsStateKey } from "@/lib/admin-operations/presentation";
import { validateOperationalDateRange } from "@/lib/admin-operations/query";
import type { JobExecutionQueryInput } from "@/lib/admin-operations/query";
import AdminOperationFilters from "./admin-operation-filters";
import AdminOperationRecords from "./admin-operation-records";
import AdminOperationsAccess from "./admin-operations-access";
import {
  AdminOperationalErrorState,
  AdminOperationalPagination,
  toAdminOperationalRequestError,
  type AdminOperationalRequestError,
} from "./admin-operations-states";
import {
  initialAdminOperationFilterDraft,
  type AdminOperationsListKind,
} from "./types";

type Records =
  | AdminPaymentSummary[]
  | AdminHostTransferSummary[]
  | AdminJobExecution[]
  | AdminOperationalCommand[];

type ListState =
  | { status: "loading" }
  | { status: "error"; error: AdminOperationalRequestError }
  | {
      status: "ready";
      records: Records;
      meta: AdminOperationalPaginationMeta;
    };

function nonAny<T extends string>(value: string): T | undefined {
  return value === "any" ? undefined : (value as T);
}

function LoadingList() {
  return (
    <div className="flex flex-col gap-3" aria-label="Loading operational records">
      {[0, 1, 2].map((item) => (
        <Skeleton key={item} className="h-32 w-full rounded-xl" />
      ))}
    </div>
  );
}

function RecordsForKind({ kind, records }: { kind: AdminOperationsListKind; records: Records }) {
  switch (kind) {
    case "payments":
      return <AdminOperationRecords kind="payments" records={records as AdminPaymentSummary[]} />;
    case "transfers":
      return <AdminOperationRecords kind="transfers" records={records as AdminHostTransferSummary[]} />;
    case "jobs":
      return <AdminOperationRecords kind="jobs" records={records as AdminJobExecution[]} />;
    case "commands":
      return <AdminOperationRecords kind="commands" records={records as AdminOperationalCommand[]} />;
  }
}

function AdminOperationsListContent({
  kind,
  accessToken,
}: {
  kind: AdminOperationsListKind;
  accessToken: string | null;
}) {
  const [draft, setDraft] = useState(initialAdminOperationFilterDraft);
  const [applied, setApplied] = useState(initialAdminOperationFilterDraft);
  const [page, setPage] = useState(1);
  const [dateError, setDateError] = useState<string | null>(null);
  const [state, setState] = useState<ListState>({ status: "loading" });
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState({ status: "loading" });
    const common = {
      page,
      limit: 20,
      createdFrom: applied.createdFrom || undefined,
      createdTo: applied.createdTo || undefined,
    };

    try {
      let result;
      switch (kind) {
        case "payments":
          result = await listAdminPayments(
            {
              ...common,
              status: nonAny(applied.status),
              bookingId: applied.bookingId,
            },
            accessToken ?? undefined,
            controller.signal
          );
          break;
        case "transfers":
          result = await listAdminHostTransfers(
            {
              ...common,
              status: nonAny(applied.status),
              reversalStatus: nonAny(applied.reversalStatus),
              bookingId: applied.bookingId,
            },
            accessToken ?? undefined,
            controller.signal
          );
          break;
        case "jobs": {
          const query: JobExecutionQueryInput = {
            ...common,
            state:
              applied.jobScope === "failed"
                ? undefined
                : nonAny(applied.state),
            jobType: applied.jobType,
            queueName: nonAny(applied.queueName),
          };
          result = await (applied.jobScope === "failed"
            ? listAdminFailedJobExecutions
            : listAdminJobExecutions)(
            query,
            accessToken ?? undefined,
            controller.signal
          );
          break;
        }
        case "commands":
          result = await listAdminOperationalCommands(
            {
              ...common,
              commandType: nonAny(applied.commandType),
              status: nonAny(applied.status),
            },
            accessToken ?? undefined,
            controller.signal
          );
          break;
      }

      if (controller.signal.aborted || requestRef.current !== controller) return;
      setState({ status: "ready", records: result.records, meta: result.meta });
    } catch (error) {
      if (controller.signal.aborted || requestRef.current !== controller) return;
      setState({ status: "error", error: toAdminOperationalRequestError(error) });
    }
  }, [accessToken, applied, kind, page]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timeout);
      requestRef.current?.abort();
    };
  }, [load]);

  const applyFilters = () => {
    const dates = validateOperationalDateRange(draft.createdFrom, draft.createdTo);
    if (!dates.valid) {
      setDateError(dates.message);
      return;
    }
    setDateError(null);
    setPage(1);
    setApplied({
      ...draft,
      createdFrom: dates.createdFrom ?? "",
      createdTo: dates.createdTo ?? "",
    });
  };

  const resetFilters = () => {
    const initial = initialAdminOperationFilterDraft();
    setDraft(initial);
    setApplied(initial);
    setDateError(null);
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-5">
      <AdminOperationFilters
        kind={kind}
        draft={draft}
        dateError={dateError}
        onChange={setDraft}
        onApply={applyFilters}
        onReset={resetFilters}
      />
      {state.status === "loading" && <LoadingList />}
      {state.status === "error" && (
        <AdminOperationalErrorState error={state.error} onRetry={load} />
      )}
      {state.status === "ready" && state.records.length === 0 && (
        <EmptyState
          icon={Inbox}
          title="No operational records"
          description="No records match the current endpoint and filters."
        />
      )}
      {state.status === "ready" && state.records.length > 0 && (
        <RecordsForKind kind={kind} records={state.records} />
      )}
      {state.status === "ready" && (
        <AdminOperationalPagination meta={state.meta} onPage={setPage} />
      )}
    </div>
  );
}

export default function AdminOperationsList({
  kind,
}: {
  kind: AdminOperationsListKind;
}) {
  return (
    <AdminOperationsAccess>
      {({ user, accessToken }) => (
        <AdminOperationsListContent
          key={adminOperationsStateKey(user.id, kind)}
          kind={kind}
          accessToken={accessToken}
        />
      )}
    </AdminOperationsAccess>
  );
}
