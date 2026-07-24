"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getAdminHostTransfer,
  getAdminJobExecution,
  getAdminOperationalCommand,
  getAdminPayment,
  type AdminHostTransferDetail,
  type AdminJobExecution,
  type AdminOperationalCommand,
  type AdminPaymentDetail,
} from "@/lib/api/admin-operations";
import {
  adminOperationsStateKey,
  describeHostTransferBoundary,
  formatOperationalDateTime,
  formatOperationalMoney,
  humanizeOperationalValue,
} from "@/lib/admin-operations/presentation";
import AdminOperationsAccess from "./admin-operations-access";
import {
  AdminOperationalErrorState,
  AdminOperationalStatusBadge,
  toAdminOperationalRequestError,
  type AdminOperationalRequestError,
} from "./admin-operations-states";
import type { AdminOperationsListKind } from "./types";

type Detail =
  | AdminPaymentDetail
  | AdminHostTransferDetail
  | AdminJobExecution
  | AdminOperationalCommand;

type DetailState =
  | { status: "loading" }
  | { status: "error"; error: AdminOperationalRequestError }
  | { status: "ready"; detail: Detail };

function DetailGrid({ children }: { children: React.ReactNode }) {
  return (
    <dl className="grid grid-cols-1 overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-2">
      {children}
    </dl>
  );
}

function DetailItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0 border-b border-slate-100 px-4 py-3 sm:odd:border-r">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd
        className={`mt-1 break-words text-sm text-slate-900 ${
          mono ? "font-mono" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function nullable(value: string | null) {
  return value ?? "Not reported";
}

function PaymentDetail({ payment }: { payment: AdminPaymentDetail }) {
  return (
    <DetailGrid>
      <DetailItem label="Payment ID" value={payment.id} mono />
      <DetailItem label="Booking ID" value={payment.bookingId} mono />
      <DetailItem label="Status" value={<AdminOperationalStatusBadge value={payment.status} label={humanizeOperationalValue(payment.status)} />} />
      <DetailItem label="Attempt" value={payment.attemptNumber} />
      <DetailItem label="Amount" value={formatOperationalMoney(payment.amountCents, payment.currency)} />
      <DetailItem label="Refunded amount" value={formatOperationalMoney(payment.amountRefundedCents, payment.currency)} />
      <DetailItem label="Active" value={payment.active ? "Yes" : "No"} />
      <DetailItem label="Expires" value={formatOperationalDateTime(payment.expiresAt)} />
      <DetailItem label="Paid" value={formatOperationalDateTime(payment.paidAt)} />
      <DetailItem label="Refunded" value={formatOperationalDateTime(payment.refundedAt)} />
      <DetailItem label="Last provider event" value={formatOperationalDateTime(payment.lastProviderEventAt)} />
      <DetailItem label="Created" value={formatOperationalDateTime(payment.createdAt)} />
      <DetailItem label="Checkout session reference" value={nullable(payment.providerReferences.checkoutSessionId)} mono />
      <DetailItem label="Payment intent reference" value={nullable(payment.providerReferences.paymentIntentId)} mono />
      <DetailItem label="Charge reference" value={nullable(payment.providerReferences.chargeId)} mono />
      <DetailItem label="Updated" value={formatOperationalDateTime(payment.updatedAt)} />
    </DetailGrid>
  );
}

function TransferDetail({ transfer }: { transfer: AdminHostTransferDetail }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-900">
        {describeHostTransferBoundary(transfer.financialBoundary)}
      </p>
      <DetailGrid>
        <DetailItem label="Transfer ID" value={transfer.id} mono />
        <DetailItem label="Booking ID" value={transfer.bookingId} mono />
        <DetailItem label="Payment ID" value={transfer.paymentId} mono />
        <DetailItem label="Host ID" value={transfer.hostId} mono />
        <DetailItem label="Status" value={<AdminOperationalStatusBadge value={transfer.status} label={humanizeOperationalValue(transfer.status)} />} />
        <DetailItem label="Reversal status" value={<AdminOperationalStatusBadge value={transfer.reversalStatus} label={humanizeOperationalValue(transfer.reversalStatus)} />} />
        <DetailItem label="Gross amount" value={formatOperationalMoney(transfer.grossAmountCents, transfer.currency)} />
        <DetailItem label="Platform fee" value={formatOperationalMoney(transfer.platformFeeCents, transfer.currency)} />
        <DetailItem label="Host net amount" value={formatOperationalMoney(transfer.hostNetAmountCents, transfer.currency)} />
        <DetailItem label="Reversed amount" value={formatOperationalMoney(transfer.reversedAmountCents, transfer.currency)} />
        <DetailItem label="Reversal target" value={formatOperationalMoney(transfer.reversalTargetAmountCents, transfer.currency)} />
        <DetailItem label="Eligible" value={formatOperationalDateTime(transfer.eligibleAt)} />
        <DetailItem label="Transferred" value={formatOperationalDateTime(transfer.transferredAt)} />
        <DetailItem label="Failed" value={formatOperationalDateTime(transfer.failedAt)} />
        <DetailItem label="Failure code" value={nullable(transfer.failureCode)} mono />
        <DetailItem label="Reversal failure code" value={nullable(transfer.reversalFailureCode)} mono />
        <DetailItem label="Connected account reference" value={transfer.providerReferences.connectedAccountId} mono />
        <DetailItem label="Transfer reference" value={nullable(transfer.providerReferences.transferId)} mono />
        <DetailItem label="Reversal references" value={transfer.providerReferences.reversalIds.length ? transfer.providerReferences.reversalIds.join(", ") : "None reported"} mono />
        <DetailItem label="Created" value={formatOperationalDateTime(transfer.createdAt)} />
        <DetailItem label="Updated" value={formatOperationalDateTime(transfer.updatedAt)} />
      </DetailGrid>
    </div>
  );
}

function JobDetail({ job }: { job: AdminJobExecution }) {
  return (
    <DetailGrid>
      <DetailItem label="Execution ID" value={job.id} mono />
      <DetailItem label="Outbox event ID" value={nullable(job.outboxEventId)} mono />
      <DetailItem label="Queue" value={humanizeOperationalValue(job.queueName)} />
      <DetailItem label="Job type" value={job.jobType} mono />
      <DetailItem label="Job ID" value={job.jobId} mono />
      <DetailItem label="Attempt" value={job.attemptNumber} />
      <DetailItem label="State" value={<AdminOperationalStatusBadge value={job.state} label={humanizeOperationalValue(job.state)} />} />
      <DetailItem label="Classification" value={<AdminOperationalStatusBadge value={job.classification} label={humanizeOperationalValue(job.classification)} />} />
      <DetailItem label="Retryable" value={job.retryable === null ? "Not reported" : job.retryable ? "Yes" : "No"} />
      <DetailItem label="Failure category" value={nullable(job.failureCategory)} mono />
      <DetailItem label="Aggregate type" value={nullable(job.aggregateType)} mono />
      <DetailItem label="Aggregate ID" value={nullable(job.aggregateId)} mono />
      <DetailItem label="Started" value={formatOperationalDateTime(job.startedAt)} />
      <DetailItem label="Completed" value={formatOperationalDateTime(job.completedAt)} />
      <DetailItem label="Created" value={formatOperationalDateTime(job.createdAt)} />
      <DetailItem label="Updated" value={formatOperationalDateTime(job.updatedAt)} />
    </DetailGrid>
  );
}

function CommandDetail({ command }: { command: AdminOperationalCommand }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-600">
        This is a read-only record of a backend-issued operational command.
      </p>
      <DetailGrid>
        <DetailItem label="Command ID" value={command.id} mono />
        <DetailItem label="Command type" value={humanizeOperationalValue(command.commandType)} />
        <DetailItem label="Status" value={<AdminOperationalStatusBadge value={command.status} label={humanizeOperationalValue(command.status)} />} />
        <DetailItem label="Source" value={command.source} mono />
        <DetailItem label="Target ID" value={nullable(command.targetId)} mono />
        <DetailItem label="Batch limit" value={command.batchLimit ?? "Not reported"} />
        <DetailItem label="Stale before" value={formatOperationalDateTime(command.staleBefore)} />
        <DetailItem label="Result code" value={nullable(command.resultCode)} mono />
        <DetailItem label="Last failure category" value={nullable(command.lastFailureCategory)} mono />
        <DetailItem label="Scanned" value={command.counts.scanned} />
        <DetailItem label="Succeeded" value={command.counts.succeeded} />
        <DetailItem label="Skipped" value={command.counts.skipped} />
        <DetailItem label="Retryable failures" value={command.counts.retryableFailures} />
        <DetailItem label="Permanent failures" value={command.counts.permanentFailures} />
        <DetailItem label="Provider calls" value={command.counts.providerCalls} />
        <DetailItem label="Started" value={formatOperationalDateTime(command.startedAt)} />
        <DetailItem label="Completed" value={formatOperationalDateTime(command.completedAt)} />
        <DetailItem label="Created" value={formatOperationalDateTime(command.createdAt)} />
        <DetailItem label="Updated" value={formatOperationalDateTime(command.updatedAt)} />
      </DetailGrid>
    </div>
  );
}

function DetailForKind({ kind, detail }: { kind: AdminOperationsListKind; detail: Detail }) {
  switch (kind) {
    case "payments":
      return <PaymentDetail payment={detail as AdminPaymentDetail} />;
    case "transfers":
      return <TransferDetail transfer={detail as AdminHostTransferDetail} />;
    case "jobs":
      return <JobDetail job={detail as AdminJobExecution} />;
    case "commands":
      return <CommandDetail command={detail as AdminOperationalCommand} />;
  }
}

function AdminOperationDetailContent({
  kind,
  resourceId,
  accessToken,
}: {
  kind: AdminOperationsListKind;
  resourceId: string;
  accessToken: string | null;
}) {
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState({ status: "loading" });
    try {
      const token = accessToken ?? undefined;
      let detail: Detail;
      switch (kind) {
        case "payments":
          detail = await getAdminPayment(resourceId, token, controller.signal);
          break;
        case "transfers":
          detail = await getAdminHostTransfer(resourceId, token, controller.signal);
          break;
        case "jobs":
          detail = await getAdminJobExecution(resourceId, token, controller.signal);
          break;
        case "commands":
          detail = await getAdminOperationalCommand(resourceId, token, controller.signal);
          break;
      }
      if (controller.signal.aborted || requestRef.current !== controller) return;
      setState({ status: "ready", detail });
    } catch (error) {
      if (controller.signal.aborted || requestRef.current !== controller) return;
      setState({ status: "error", error: toAdminOperationalRequestError(error) });
    }
  }, [accessToken, kind, resourceId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timeout);
      requestRef.current?.abort();
    };
  }, [load]);

  if (state.status === "loading") {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }
  if (state.status === "error") {
    return <AdminOperationalErrorState error={state.error} onRetry={load} />;
  }
  return <DetailForKind kind={kind} detail={state.detail} />;
}

export default function AdminOperationDetail({
  kind,
  resourceId,
}: {
  kind: AdminOperationsListKind;
  resourceId: string;
}) {
  return (
    <AdminOperationsAccess>
      {({ user, accessToken }) => (
        <AdminOperationDetailContent
          key={adminOperationsStateKey(user.id, kind, resourceId)}
          kind={kind}
          resourceId={resourceId}
          accessToken={accessToken}
        />
      )}
    </AdminOperationsAccess>
  );
}
