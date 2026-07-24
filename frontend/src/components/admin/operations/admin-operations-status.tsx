"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Clock3, RefreshCw, Server, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getAdminOperationsStatus,
  type AdminOperationsStatus,
} from "@/lib/api/admin-operations";
import {
  adminOperationsStateKey,
  describeWorkerHeartbeat,
  formatOperationalDateTime,
  humanizeOperationalValue,
} from "@/lib/admin-operations/presentation";
import AdminOperationsAccess from "./admin-operations-access";
import {
  AdminOperationalErrorState,
  AdminOperationalStatusBadge,
  toAdminOperationalRequestError,
  type AdminOperationalRequestError,
} from "./admin-operations-states";

type StatusState =
  | { status: "loading" }
  | { status: "error"; error: AdminOperationalRequestError }
  | { status: "ready"; data: AdminOperationsStatus };

function CountCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
        {value}
      </dd>
    </div>
  );
}

function StatusSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Activity;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
        <Icon className="size-4 text-slate-500" aria-hidden="true" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function StatusData({ data }: { data: AdminOperationsStatus }) {
  const outboxStatuses = ["pending", "publishing", "enqueued", "failed"] as const;
  const cancellationStatuses = [
    "checkout_expiry_pending",
    "refund_pending",
    "transfer_reversal_pending",
    "failed_retryable",
    "failed_permanent",
  ] as const;

  return (
    <div className="flex flex-col gap-7">
      <StatusSection title="Outbox" icon={Activity}>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {outboxStatuses.map((status) => (
            <CountCard
              key={status}
              label={humanizeOperationalValue(status)}
              value={data.outbox.counts[status] ?? 0}
            />
          ))}
          <CountCard
            label="Oldest pending age (seconds)"
            value={data.outbox.oldestPendingAgeSeconds}
          />
        </dl>
      </StatusSection>

      <StatusSection title="Failure counts" icon={TriangleAlert}>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <CountCard label="Job executions" value={data.failures.jobExecutions} />
          <CountCard label="Email webhooks" value={data.failures.emailWebhooks} />
          <CountCard label="Unmatched email webhooks" value={data.failures.unmatchedEmailWebhooks} />
          <CountCard label="Healthcare evidence deletions" value={data.failures.healthcareEvidenceDeletions} />
          {cancellationStatuses.map((status) => (
            <CountCard
              key={status}
              label={`Cancellation: ${humanizeOperationalValue(status)}`}
              value={data.failures.bookingCancellations[status] ?? 0}
            />
          ))}
        </dl>
      </StatusSection>

      <StatusSection title="Workers" icon={Server}>
        {data.workers.length === 0 ? (
          <EmptyState
            icon={Server}
            title="No worker heartbeats reported"
            description="The backend status response did not include active worker heartbeat records."
            className="py-10"
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {data.workers.map((worker) => {
              const heartbeat = describeWorkerHeartbeat(worker);
              return (
                <li
                  key={`${worker.process}:${worker.instance}`}
                  className="rounded-xl border border-slate-200 bg-white p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">{worker.process}</p>
                      <p className="break-all font-mono text-xs text-slate-500">
                        {worker.instance}
                      </p>
                    </div>
                    <AdminOperationalStatusBadge
                      value={worker.stale ? "stale" : "current"}
                      label={heartbeat.label}
                    />
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-1 text-xs text-slate-600 sm:grid-cols-2">
                    <span className="flex items-center gap-1.5">
                      <Clock3 className="size-3.5" aria-hidden="true" />
                      {heartbeat.detail}
                    </span>
                    <span>Heartbeat: {formatOperationalDateTime(worker.lastHeartbeatAt)}</span>
                    <span>Process started: {formatOperationalDateTime(worker.processStartedAt)}</span>
                    <span>Version: {worker.version}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </StatusSection>
    </div>
  );
}

function AdminOperationsStatusContent({ accessToken }: { accessToken: string | null }) {
  const [state, setState] = useState<StatusState>({ status: "loading" });
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState({ status: "loading" });
    try {
      const data = await getAdminOperationsStatus(
        accessToken ?? undefined,
        controller.signal
      );
      if (controller.signal.aborted || requestRef.current !== controller) return;
      setState({ status: "ready", data });
    } catch (error) {
      if (controller.signal.aborted || requestRef.current !== controller) return;
      setState({ status: "error", error: toAdminOperationalRequestError(error) });
    }
  }, [accessToken]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timeout);
      requestRef.current?.abort();
    };
  }, [load]);

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-36 w-full rounded-xl" />
        <Skeleton className="h-52 w-full rounded-xl" />
      </div>
    );
  }
  if (state.status === "error") {
    return <AdminOperationalErrorState error={state.error} onRetry={load} />;
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw aria-hidden="true" />
          Refresh status
        </Button>
      </div>
      <StatusData data={state.data} />
    </div>
  );
}

export default function AdminOperationsStatusPanel() {
  return (
    <AdminOperationsAccess>
      {({ user, accessToken }) => (
        <AdminOperationsStatusContent
          key={adminOperationsStateKey(user.id, "status")}
          accessToken={accessToken}
        />
      )}
    </AdminOperationsAccess>
  );
}
