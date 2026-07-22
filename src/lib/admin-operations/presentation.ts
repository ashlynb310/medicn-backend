export type OperationalTone = "neutral" | "info" | "warning" | "success" | "danger";

export function formatOperationalMoney(
  cents: number,
  currency: string
): string {
  const normalizedCurrency = currency.trim().toUpperCase();
  if (!Number.isInteger(cents) || !/^[A-Z]{3}$/.test(normalizedCurrency)) {
    return "Not reported";
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalizedCurrency,
    }).format(cents / 100);
  } catch {
    return "Not reported";
  }
}

export function formatOperationalDateTime(value: string | null): string {
  if (!value) return "Not reported";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not reported";
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function humanizeOperationalValue(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function describeHostTransferBoundary(boundary: {
  movement: string;
  representsBankPayout: boolean;
}): string {
  return boundary.movement === "stripe_transfer_to_connected_balance" &&
    boundary.representsBankPayout === false
    ? "Transfer to connected Stripe balance - not a bank payout"
    : "Financial boundary not reported";
}

function duration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

/** Uses the backend-provided age and stale boolean without recomputing either. */
export function describeWorkerHeartbeat(worker: {
  ageSeconds: number;
  stale: boolean;
}): { label: string; detail: string; tone: OperationalTone } {
  return {
    label: worker.stale ? "Stale" : "Current",
    detail: `Last heartbeat ${duration(worker.ageSeconds)} ago`,
    tone: worker.stale ? "danger" : "success",
  };
}

export function adminOperationsStateKey(
  userId: string,
  view: string,
  resourceId?: string
): string {
  return resourceId ? `${userId}:${view}:${resourceId}` : `${userId}:${view}`;
}

export interface OperationalErrorInput {
  code: string;
  status: number | null;
  message: string;
  retryAfterSeconds: number | null;
}

export interface OperationalErrorPresentation {
  kind: "forbidden" | "not_found" | "rate_limited" | "error";
  title: string;
  message: string;
}

export function operationalErrorPresentation(
  error: OperationalErrorInput
): OperationalErrorPresentation {
  if (error.code === "FORBIDDEN" || error.status === 403) {
    return {
      kind: "forbidden",
      title: "Administrator access required",
      message: "This operational area is limited to MediCN administrators.",
    };
  }
  if (error.code === "NOT_FOUND" || error.status === 404) {
    return {
      kind: "not_found",
      title: "Operational record not found",
      message: "The requested operational resource was not found.",
    };
  }
  if (
    error.status === 429 ||
    error.code === "RATE_LIMIT_EXCEEDED" ||
    error.code === "RATE_LIMITED"
  ) {
    return {
      kind: "rate_limited",
      title: "Too many operational requests",
      message:
        error.retryAfterSeconds !== null
          ? `Try again in about ${error.retryAfterSeconds}s.`
          : "Please wait a moment and try again.",
    };
  }
  return {
    kind: "error",
    title: "We couldn't load operational data",
    message: error.message,
  };
}
