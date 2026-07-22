import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildCommandQuery,
  buildHostTransferQuery,
  buildJobExecutionQuery,
  buildPaymentQuery,
  validateOperationalDateRange,
} from "../src/lib/admin-operations/query.ts";
import {
  adminOperationsStateKey,
  describeHostTransferBoundary,
  describeWorkerHeartbeat,
  formatOperationalMoney,
  operationalErrorPresentation,
} from "../src/lib/admin-operations/presentation.ts";

function source(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

test("an empty operational date range is valid and omitted", () => {
  assert.deepEqual(validateOperationalDateRange("", ""), {
    valid: true,
    createdFrom: undefined,
    createdTo: undefined,
  });
});

test("operational date ranges require both endpoints", () => {
  for (const [from, to] of [
    ["2026-01-01T00:00", ""],
    ["", "2026-01-02T00:00"],
  ]) {
    const result = validateOperationalDateRange(from, to);
    assert.equal(result.valid, false);
    if (!result.valid) assert.match(result.message, /both/i);
  }
});

test("operational date ranges must be valid, ordered, and at most 366 days", () => {
  assert.equal(
    validateOperationalDateRange("not-a-date", "2026-01-02T00:00").valid,
    false
  );
  assert.equal(
    validateOperationalDateRange(
      "2026-01-02T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z"
    ).valid,
    false
  );
  assert.equal(
    validateOperationalDateRange(
      "2025-01-01T00:00:00.000Z",
      "2026-01-03T00:00:00.000Z"
    ).valid,
    false
  );
  assert.equal(
    validateOperationalDateRange(
      "2025-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z"
    ).valid,
    true,
    "exactly 366 days is allowed"
  );
});

test("payment query construction sends only documented filters", () => {
  assert.deepEqual(
    buildPaymentQuery({
      page: 2,
      limit: 20,
      status: "paid",
      bookingId: "booking-id",
      createdFrom: "2026-01-01T00:00:00.000Z",
      createdTo: "2026-01-02T00:00:00.000Z",
    }),
    {
      page: 2,
      limit: 20,
      status: "paid",
      bookingId: "booking-id",
      createdFrom: "2026-01-01T00:00:00.000Z",
      createdTo: "2026-01-02T00:00:00.000Z",
    }
  );
});

test("transfer, job, and command queries use their exact filters", () => {
  assert.deepEqual(
    buildHostTransferQuery({
      page: 1,
      limit: 100,
      status: "blocked",
      reversalStatus: "failed",
      bookingId: "booking-id",
    }),
    {
      page: 1,
      limit: 100,
      status: "blocked",
      reversalStatus: "failed",
      bookingId: "booking-id",
    }
  );
  assert.deepEqual(
    buildJobExecutionQuery({
      page: 3,
      limit: 20,
      state: "failed",
      jobType: "checkout_expiry",
      queueName: "operations",
    }),
    {
      page: 3,
      limit: 20,
      state: "failed",
      jobType: "checkout_expiry",
      queueName: "operations",
    }
  );
  assert.deepEqual(
    buildCommandQuery({
      page: 1,
      limit: 20,
      commandType: "job_requeue",
      status: "succeeded",
    }),
    {
      page: 1,
      limit: 20,
      commandType: "job_requeue",
      status: "succeeded",
    }
  );
});

test("optional query filters are omitted rather than serialized as blanks", () => {
  assert.deepEqual(
    buildPaymentQuery({
      page: 1,
      limit: 20,
      status: "",
      bookingId: "  ",
      createdFrom: undefined,
      createdTo: undefined,
    }),
    { page: 1, limit: 20 }
  );
});

test("money formatting accepts backend integer cents only", () => {
  assert.equal(formatOperationalMoney(12345, "USD"), "$123.45");
  assert.equal(formatOperationalMoney(0, "usd"), "$0.00");
  assert.equal(formatOperationalMoney(12.5, "USD"), "Not reported");
  assert.equal(formatOperationalMoney(Number.NaN, "USD"), "Not reported");
  assert.equal(formatOperationalMoney(100, ""), "Not reported");
});

test("Host transfers are always described as connected-balance transfers", () => {
  assert.equal(
    describeHostTransferBoundary({
      movement: "stripe_transfer_to_connected_balance",
      representsBankPayout: false,
    }),
    "Transfer to connected Stripe balance - not a bank payout"
  );
  assert.equal(
    describeHostTransferBoundary({
      movement: "unexpected",
      representsBankPayout: true,
    }),
    "Financial boundary not reported"
  );
});

test("worker presentation trusts backend heartbeat age and stale state", () => {
  assert.deepEqual(
    describeWorkerHeartbeat({ ageSeconds: 125, stale: true }),
    { label: "Stale", detail: "Last heartbeat 2m 5s ago", tone: "danger" }
  );
  assert.deepEqual(
    describeWorkerHeartbeat({ ageSeconds: 4, stale: false }),
    { label: "Current", detail: "Last heartbeat 4s ago", tone: "success" }
  );
});

test("account, view, and resource ids own operational state, never tokens", () => {
  assert.notEqual(
    adminOperationsStateKey("admin-a", "payments"),
    adminOperationsStateKey("admin-b", "payments")
  );
  assert.notEqual(
    adminOperationsStateKey("admin-a", "payments", "payment-a"),
    adminOperationsStateKey("admin-a", "payments", "payment-b")
  );
  assert.equal(
    adminOperationsStateKey("admin-a", "payments"),
    "admin-a:payments"
  );
});

test("forbidden, not-found, and Retry-After errors have distinct guidance", () => {
  assert.equal(
    operationalErrorPresentation({
      code: "FORBIDDEN",
      status: 403,
      message: "forbidden",
      retryAfterSeconds: null,
    }).kind,
    "forbidden"
  );
  assert.equal(
    operationalErrorPresentation({
      code: "NOT_FOUND",
      status: 404,
      message: "missing",
      retryAfterSeconds: null,
    }).kind,
    "not_found"
  );
  const limited = operationalErrorPresentation({
    code: "RATE_LIMIT_EXCEEDED",
    status: 429,
    message: "limited",
    retryAfterSeconds: 42,
  });
  assert.equal(limited.kind, "rate_limited");
  assert.match(limited.message, /42s/);
});

test("API contracts keep nullable fields and response types separate", () => {
  const api = source("../src/lib/api/admin-operations.ts");
  for (const name of [
    "AdminPaymentSummary",
    "AdminPaymentDetail",
    "AdminHostTransferSummary",
    "AdminHostTransferDetail",
    "AdminJobExecution",
    "AdminOperationalCommand",
    "AdminOperationsStatus",
    "AdminWorkerStatus",
    "AdminOutboxStatus",
    "AdminOperationalFailureCounts",
  ]) {
    assert.match(api, new RegExp(`interface ${name}`), name);
  }
  assert.match(api, /expiresAt: string \| null/);
  assert.match(api, /completedAt: string \| null/);
  assert.match(api, /retryable: boolean \| null/);
  assert.match(api, /representsBankPayout: false/);
});

test("operational frontend calls are GET-only with no command endpoints", () => {
  const api = source("../src/lib/api/admin-operations.ts");
  assert.ok(!/method:\s*["']POST["']/.test(api));
  assert.ok(!/requeue|reconciliation\/payments|reconciliation\/host-transfers/.test(api));
  for (const path of [
    "/admin/operations/status",
    "/admin/operations/payments",
    "/admin/operations/host-transfers",
    "/admin/operations/job-executions",
    "/admin/operations/job-executions/failed",
    "/admin/operations/commands",
  ]) {
    assert.ok(api.includes(path), path);
  }
});

test("provider references are never persisted, logged, or placed in routes", () => {
  const files = [
    source("../src/lib/api/admin-operations.ts"),
    source("../src/components/admin/operations/admin-operation-detail.tsx"),
  ];
  const combined = files.join("\n");
  for (const forbidden of [
    "localStorage",
    "sessionStorage",
    "document.cookie",
    "console.log",
    "console.error",
    "URLSearchParams(provider",
  ]) {
    assert.ok(!combined.includes(forbidden), forbidden);
  }
  assert.ok(!/href=\{?[^\n]*(providerReferences|providerCall)/.test(combined));
});

test("list and detail panels key state and guard stale requests", () => {
  const list = source(
    "../src/components/admin/operations/admin-operations-list.tsx"
  );
  const detail = source(
    "../src/components/admin/operations/admin-operation-detail.tsx"
  );
  assert.match(list, /key=\{adminOperationsStateKey\(user\.id, kind\)\}/);
  assert.match(
    detail,
    /key=\{adminOperationsStateKey\(user\.id, kind, resourceId\)\}/
  );
  for (const panel of [list, detail]) {
    assert.match(panel, /requestRef\.current !== controller/);
    assert.match(panel, /controller\.signal\.aborted/);
    assert.ok(!/key=\{[^}]*accessToken/.test(panel));
  }
});
