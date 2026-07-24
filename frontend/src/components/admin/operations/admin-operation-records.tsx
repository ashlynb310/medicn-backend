import Link from "next/link";
import type {
  AdminHostTransferSummary,
  AdminJobExecution,
  AdminOperationalCommand,
  AdminPaymentSummary,
} from "@/lib/api/admin-operations";
import {
  describeHostTransferBoundary,
  formatOperationalDateTime,
  formatOperationalMoney,
  humanizeOperationalValue,
} from "@/lib/admin-operations/presentation";
import { AdminOperationalStatusBadge } from "./admin-operations-states";

type Props =
  | { kind: "payments"; records: AdminPaymentSummary[] }
  | { kind: "transfers"; records: AdminHostTransferSummary[] }
  | { kind: "jobs"; records: AdminJobExecution[] }
  | { kind: "commands"; records: AdminOperationalCommand[] };

function RecordLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-slate-200 bg-white p-4 outline-none transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </Link>
  );
}

function Identifier({ label, value }: { label: string; value: string }) {
  return (
    <span className="min-w-0 text-xs text-slate-500">
      {label}: <span className="break-all font-mono text-slate-700">{value}</span>
    </span>
  );
}

function PaymentRecords({ records }: { records: AdminPaymentSummary[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {records.map((payment) => (
        <li key={payment.id}>
          <RecordLink href={`/admin/operations/payments/${payment.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-sm font-semibold text-slate-900">
                  {formatOperationalMoney(payment.amountCents, payment.currency)}
                  <span className="ml-2 font-normal text-slate-500">
                    Attempt {payment.attemptNumber}
                  </span>
                </p>
                <Identifier label="Payment" value={payment.id} />
                <Identifier label="Booking" value={payment.bookingId} />
              </div>
              <AdminOperationalStatusBadge
                value={payment.status}
                label={humanizeOperationalValue(payment.status)}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
              <span>
                Refunded: {formatOperationalMoney(payment.amountRefundedCents, payment.currency)}
              </span>
              <span>Active: {payment.active ? "Yes" : "No"}</span>
              <span>Created: {formatOperationalDateTime(payment.createdAt)}</span>
            </div>
          </RecordLink>
        </li>
      ))}
    </ul>
  );
}

function TransferRecords({ records }: { records: AdminHostTransferSummary[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {records.map((transfer) => (
        <li key={transfer.id}>
          <RecordLink href={`/admin/operations/transfers/${transfer.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-sm font-semibold text-slate-900">
                  Host net {formatOperationalMoney(transfer.hostNetAmountCents, transfer.currency)}
                </p>
                <Identifier label="Transfer" value={transfer.id} />
                <Identifier label="Booking" value={transfer.bookingId} />
              </div>
              <div className="flex flex-wrap gap-2">
                <AdminOperationalStatusBadge
                  value={transfer.status}
                  label={humanizeOperationalValue(transfer.status)}
                />
                <AdminOperationalStatusBadge
                  value={transfer.reversalStatus}
                  label={`Reversal: ${humanizeOperationalValue(transfer.reversalStatus)}`}
                />
              </div>
            </div>
            <p className="mt-3 text-xs font-medium text-slate-700">
              {describeHostTransferBoundary(transfer.financialBoundary)}
            </p>
            <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
              <span>
                Gross: {formatOperationalMoney(transfer.grossAmountCents, transfer.currency)}
              </span>
              <span>
                Platform fee: {formatOperationalMoney(transfer.platformFeeCents, transfer.currency)}
              </span>
              <span>Created: {formatOperationalDateTime(transfer.createdAt)}</span>
            </div>
          </RecordLink>
        </li>
      ))}
    </ul>
  );
}

function JobRecords({ records }: { records: AdminJobExecution[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {records.map((job) => (
        <li key={job.id}>
          <RecordLink href={`/admin/operations/jobs/${job.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="break-words text-sm font-semibold text-slate-900">
                  {job.jobType}
                </p>
                <Identifier label="Execution" value={job.id} />
                <Identifier label="Job" value={job.jobId} />
              </div>
              <div className="flex flex-wrap gap-2">
                <AdminOperationalStatusBadge
                  value={job.state}
                  label={humanizeOperationalValue(job.state)}
                />
                <AdminOperationalStatusBadge
                  value={job.classification}
                  label={humanizeOperationalValue(job.classification)}
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
              <span>Queue: {humanizeOperationalValue(job.queueName)}</span>
              <span>Attempt: {job.attemptNumber}</span>
              <span>Retryable: {job.retryable === null ? "Not reported" : job.retryable ? "Yes" : "No"}</span>
              <span>Started: {formatOperationalDateTime(job.startedAt)}</span>
            </div>
          </RecordLink>
        </li>
      ))}
    </ul>
  );
}

function CommandRecords({ records }: { records: AdminOperationalCommand[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {records.map((command) => (
        <li key={command.id}>
          <RecordLink href={`/admin/operations/commands/${command.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-sm font-semibold text-slate-900">
                  {humanizeOperationalValue(command.commandType)}
                </p>
                <Identifier label="Command" value={command.id} />
                {command.targetId && (
                  <Identifier label="Target" value={command.targetId} />
                )}
              </div>
              <AdminOperationalStatusBadge
                value={command.status}
                label={humanizeOperationalValue(command.status)}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
              <span>Scanned: {command.counts.scanned}</span>
              <span>Succeeded: {command.counts.succeeded}</span>
              <span>Skipped: {command.counts.skipped}</span>
              <span>Created: {formatOperationalDateTime(command.createdAt)}</span>
            </div>
          </RecordLink>
        </li>
      ))}
    </ul>
  );
}

export default function AdminOperationRecords(props: Props) {
  switch (props.kind) {
    case "payments":
      return <PaymentRecords records={props.records} />;
    case "transfers":
      return <TransferRecords records={props.records} />;
    case "jobs":
      return <JobRecords records={props.records} />;
    case "commands":
      return <CommandRecords records={props.records} />;
  }
}
