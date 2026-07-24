export const OPERATIONAL_PAGE_LIMIT = 100;
export const OPERATIONAL_DATE_RANGE_DAYS = 366;

export type PaymentStatus =
  | "pending"
  | "paid"
  | "failed"
  | "expired"
  | "partially_refunded"
  | "refunded"
  | "disputed";

export type HostTransferStatus =
  | "pending"
  | "processing"
  | "transferred"
  | "failed"
  | "blocked";

export type HostTransferReversalStatus =
  | "none"
  | "pending"
  | "processing"
  | "partially_reversed"
  | "reversed"
  | "failed";

export type JobExecutionState = "running" | "succeeded" | "failed";
export type OperationalQueueName = "email" | "media" | "maps" | "operations";
export type OperationalCommandType =
  | "job_requeue"
  | "payment_reconciliation"
  | "host_transfer_reconciliation";
export type OperationalCommandStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "partially_succeeded"
  | "failed_retryable"
  | "failed_permanent";

interface OperationalPageInput {
  page: number;
  limit: number;
  createdFrom?: string;
  createdTo?: string;
}

export interface PaymentQueryInput extends OperationalPageInput {
  status?: PaymentStatus | "";
  bookingId?: string;
}

export interface HostTransferQueryInput extends OperationalPageInput {
  status?: HostTransferStatus | "";
  reversalStatus?: HostTransferReversalStatus | "";
  bookingId?: string;
}

export interface JobExecutionQueryInput extends OperationalPageInput {
  state?: JobExecutionState | "";
  jobType?: string;
  queueName?: OperationalQueueName | "";
}

export interface CommandQueryInput extends OperationalPageInput {
  commandType?: OperationalCommandType | "";
  status?: OperationalCommandStatus | "";
}

type OperationalQueryValue = string | number | undefined;
export type OperationalQuery = Record<string, OperationalQueryValue>;

function text(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function pageQuery(input: OperationalPageInput): OperationalQuery {
  return {
    page: input.page,
    limit: input.limit,
    ...(text(input.createdFrom) ? { createdFrom: text(input.createdFrom) } : {}),
    ...(text(input.createdTo) ? { createdTo: text(input.createdTo) } : {}),
  };
}

export function buildPaymentQuery(input: PaymentQueryInput): OperationalQuery {
  return {
    ...pageQuery(input),
    ...(input.status ? { status: input.status } : {}),
    ...(text(input.bookingId) ? { bookingId: text(input.bookingId) } : {}),
  };
}

export function buildHostTransferQuery(
  input: HostTransferQueryInput
): OperationalQuery {
  return {
    ...pageQuery(input),
    ...(input.status ? { status: input.status } : {}),
    ...(input.reversalStatus
      ? { reversalStatus: input.reversalStatus }
      : {}),
    ...(text(input.bookingId) ? { bookingId: text(input.bookingId) } : {}),
  };
}

export function buildJobExecutionQuery(
  input: JobExecutionQueryInput
): OperationalQuery {
  return {
    ...pageQuery(input),
    ...(input.state ? { state: input.state } : {}),
    ...(text(input.jobType) ? { jobType: text(input.jobType) } : {}),
    ...(input.queueName ? { queueName: input.queueName } : {}),
  };
}

export function buildCommandQuery(input: CommandQueryInput): OperationalQuery {
  return {
    ...pageQuery(input),
    ...(input.commandType ? { commandType: input.commandType } : {}),
    ...(input.status ? { status: input.status } : {}),
  };
}

export type OperationalDateRangeResult =
  | { valid: true; createdFrom: string | undefined; createdTo: string | undefined }
  | { valid: false; message: string };

/** Matches the backend's paired, ordered, maximum-366-day date contract. */
export function validateOperationalDateRange(
  rawFrom: string,
  rawTo: string
): OperationalDateRangeResult {
  const from = rawFrom.trim();
  const to = rawTo.trim();
  if (!from && !to) {
    return { valid: true, createdFrom: undefined, createdTo: undefined };
  }
  if (!from || !to) {
    return {
      valid: false,
      message: "Created from and created to are both required for a date range.",
    };
  }
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return { valid: false, message: "Enter a valid created date range." };
  }
  if (toMs < fromMs) {
    return {
      valid: false,
      message: "Created to must be the same as or later than created from.",
    };
  }
  const maximumMs = OPERATIONAL_DATE_RANGE_DAYS * 86_400_000;
  if (toMs - fromMs > maximumMs) {
    return {
      valid: false,
      message: "The created date range cannot exceed 366 days.",
    };
  }
  return {
    valid: true,
    createdFrom: new Date(fromMs).toISOString(),
    createdTo: new Date(toMs).toISOString(),
  };
}
