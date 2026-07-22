import { apiFetch } from "./client";
import type {
  CommandQueryInput,
  HostTransferQueryInput,
  HostTransferReversalStatus,
  HostTransferStatus,
  JobExecutionQueryInput,
  JobExecutionState,
  OperationalCommandStatus,
  OperationalCommandType,
  PaymentQueryInput,
  PaymentStatus,
} from "@/lib/admin-operations/query";
import {
  buildCommandQuery,
  buildHostTransferQuery,
  buildJobExecutionQuery,
  buildPaymentQuery,
} from "@/lib/admin-operations/query";

export interface AdminOperationalPaginationMeta {
  page: number;
  limit: number;
  total: number;
}

export interface AdminPaymentSummary {
  id: string;
  bookingId: string;
  attemptNumber: number;
  amountCents: number;
  amountRefundedCents: number;
  currency: string;
  status: PaymentStatus;
  active: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  refundedAt: string | null;
}

export interface AdminPaymentDetail extends AdminPaymentSummary {
  providerReferences: {
    checkoutSessionId: string | null;
    paymentIntentId: string | null;
    chargeId: string | null;
  };
  lastProviderEventAt: string | null;
}

export interface AdminHostTransferFinancialBoundary {
  movement: "stripe_transfer_to_connected_balance";
  representsBankPayout: false;
}

export interface AdminHostTransferSummary {
  id: string;
  bookingId: string;
  paymentId: string;
  grossAmountCents: number;
  platformFeeCents: number;
  hostNetAmountCents: number;
  currency: string;
  status: HostTransferStatus;
  reversalStatus: HostTransferReversalStatus;
  reversedAmountCents: number;
  reversalTargetAmountCents: number;
  eligibleAt: string;
  transferredAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
  financialBoundary: AdminHostTransferFinancialBoundary;
}

export interface AdminHostTransferDetail extends AdminHostTransferSummary {
  hostId: string;
  failureCode: string | null;
  reversalFailureCode: string | null;
  providerReferences: {
    connectedAccountId: string;
    transferId: string | null;
    reversalIds: string[];
  };
}

export interface AdminJobExecution {
  id: string;
  outboxEventId: string | null;
  queueName: "email" | "media" | "maps" | "operations" | "unknown";
  jobType: string;
  jobId: string;
  aggregateType: string | null;
  aggregateId: string | null;
  attemptNumber: number;
  state: JobExecutionState;
  retryable: boolean | null;
  failureCategory: string | null;
  classification: JobExecutionState | "retryable_failed" | "dead_letter";
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminOperationalCommandCounts {
  scanned: number;
  succeeded: number;
  skipped: number;
  retryableFailures: number;
  permanentFailures: number;
  providerCalls: number;
}

export interface AdminOperationalCommand {
  id: string;
  commandType: OperationalCommandType;
  source: string;
  targetId: string | null;
  status: OperationalCommandStatus;
  batchLimit: number | null;
  staleBefore: string | null;
  counts: AdminOperationalCommandCounts;
  resultCode: string | null;
  lastFailureCategory: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AdminOutboxEventStatus =
  | "pending"
  | "publishing"
  | "enqueued"
  | "failed";

export interface AdminOutboxStatus {
  counts: Partial<Record<AdminOutboxEventStatus, number>>;
  oldestPendingAgeSeconds: number;
}

export type AdminBookingCancellationFailureStatus =
  | "checkout_expiry_pending"
  | "refund_pending"
  | "transfer_reversal_pending"
  | "failed_retryable"
  | "failed_permanent";

export interface AdminOperationalFailureCounts {
  jobExecutions: number;
  emailWebhooks: number;
  unmatchedEmailWebhooks: number;
  healthcareEvidenceDeletions: number;
  bookingCancellations: Partial<
    Record<AdminBookingCancellationFailureStatus, number>
  >;
}

export interface AdminWorkerStatus {
  process: string;
  instance: string;
  processStartedAt: string;
  lastHeartbeatAt: string;
  ageSeconds: number;
  stale: boolean;
  version: string;
}

export interface AdminOperationsStatus {
  outbox: AdminOutboxStatus;
  failures: AdminOperationalFailureCounts;
  workers: AdminWorkerStatus[];
}

export interface AdminOperationalListResult<T> {
  records: T[];
  meta: AdminOperationalPaginationMeta;
}

export async function getAdminOperationsStatus(
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data } = await apiFetch<AdminOperationsStatus>(
    "/admin/operations/status",
    { accessToken, signal }
  );
  return data;
}

export async function listAdminPayments(
  query: PaymentQueryInput,
  accessToken?: string,
  signal?: AbortSignal
): Promise<AdminOperationalListResult<AdminPaymentSummary>> {
  const { data, meta } = await apiFetch<
    AdminPaymentSummary[],
    AdminOperationalPaginationMeta
  >("/admin/operations/payments", {
    query: buildPaymentQuery(query),
    accessToken,
    signal,
  });
  return { records: data, meta };
}

export async function getAdminPayment(
  id: string,
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data } = await apiFetch<AdminPaymentDetail>(
    `/admin/operations/payments/${encodeURIComponent(id)}`,
    { accessToken, signal }
  );
  return data;
}

export async function listAdminHostTransfers(
  query: HostTransferQueryInput,
  accessToken?: string,
  signal?: AbortSignal
): Promise<AdminOperationalListResult<AdminHostTransferSummary>> {
  const { data, meta } = await apiFetch<
    AdminHostTransferSummary[],
    AdminOperationalPaginationMeta
  >("/admin/operations/host-transfers", {
    query: buildHostTransferQuery(query),
    accessToken,
    signal,
  });
  return { records: data, meta };
}

export async function getAdminHostTransfer(
  id: string,
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data } = await apiFetch<AdminHostTransferDetail>(
    `/admin/operations/host-transfers/${encodeURIComponent(id)}`,
    { accessToken, signal }
  );
  return data;
}

async function listJobsAt(
  path: string,
  query: JobExecutionQueryInput,
  accessToken?: string,
  signal?: AbortSignal
): Promise<AdminOperationalListResult<AdminJobExecution>> {
  const { data, meta } = await apiFetch<
    AdminJobExecution[],
    AdminOperationalPaginationMeta
  >(path, {
    query: buildJobExecutionQuery(query),
    accessToken,
    signal,
  });
  return { records: data, meta };
}

export function listAdminJobExecutions(
  query: JobExecutionQueryInput,
  accessToken?: string,
  signal?: AbortSignal
) {
  return listJobsAt(
    "/admin/operations/job-executions",
    query,
    accessToken,
    signal
  );
}

export function listAdminFailedJobExecutions(
  query: JobExecutionQueryInput,
  accessToken?: string,
  signal?: AbortSignal
) {
  return listJobsAt(
    "/admin/operations/job-executions/failed",
    query,
    accessToken,
    signal
  );
}

export async function getAdminJobExecution(
  id: string,
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data } = await apiFetch<AdminJobExecution>(
    `/admin/operations/job-executions/${encodeURIComponent(id)}`,
    { accessToken, signal }
  );
  return data;
}

export async function listAdminOperationalCommands(
  query: CommandQueryInput,
  accessToken?: string,
  signal?: AbortSignal
): Promise<AdminOperationalListResult<AdminOperationalCommand>> {
  const { data, meta } = await apiFetch<
    AdminOperationalCommand[],
    AdminOperationalPaginationMeta
  >("/admin/operations/commands", {
    query: buildCommandQuery(query),
    accessToken,
    signal,
  });
  return { records: data, meta };
}

export async function getAdminOperationalCommand(
  id: string,
  accessToken?: string,
  signal?: AbortSignal
) {
  const { data } = await apiFetch<AdminOperationalCommand>(
    `/admin/operations/commands/${encodeURIComponent(id)}`,
    { accessToken, signal }
  );
  return data;
}
