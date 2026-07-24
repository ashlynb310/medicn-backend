// Executable checks for Veriff identity presentation, polling bounds, and
// hosted-URL safety.
// Run with:  npm test   (node --test "tests/**/*.test.mts")
import test from "node:test";
import assert from "node:assert/strict";
import {
  describeIdentityStatus,
  identityActionLabel,
  isPollableIdentityStatus,
  isSafeHostedUrl,
  isStaleSessionAttempt,
  isTerminalIdentityStatus,
  resolveSessionOutcome,
  shouldContinueIdentityPolling,
} from "../src/lib/identity/presentation.ts";

const ALL_STATUSES = [
  "not_started",
  "created",
  "submitted",
  "review",
  "resubmission_requested",
  "approved",
  "declined",
  "expired",
  "abandoned",
];

// --- status presentation ---

test("every backend status has a distinct human presentation", () => {
  const labels = new Set();
  for (const status of ALL_STATUSES) {
    const presentation = describeIdentityStatus(status);
    assert.ok(presentation.label.length > 0, `${status} needs a label`);
    assert.ok(presentation.description.length > 0, `${status} needs a description`);
    labels.add(presentation.label);
  }
  assert.equal(labels.size, ALL_STATUSES.length, "labels must not collide");
});

test("approved is the only success tone", () => {
  assert.equal(describeIdentityStatus("approved").tone, "success");
  assert.equal(describeIdentityStatus("declined").tone, "danger");
  assert.equal(describeIdentityStatus("not_started").tone, "neutral");
});

// --- actionRequired -> button label ---

test("button labels are derived from actionRequired", () => {
  assert.equal(identityActionLabel("start"), "Start identity verification");
  assert.equal(identityActionLabel("continue"), "Continue verification");
  assert.equal(identityActionLabel("resubmit"), "Resubmit verification");
  assert.equal(identityActionLabel("retry"), "Try identity verification again");
});

test("wait and none offer no start button", () => {
  assert.equal(identityActionLabel("wait"), null);
  assert.equal(identityActionLabel("none"), null);
});

// --- terminal vs pollable ---

test("terminal statuses are the decided ones", () => {
  for (const status of ["approved", "declined", "expired", "abandoned"]) {
    assert.equal(isTerminalIdentityStatus(status), true, status);
  }
  for (const status of ["not_started", "created", "submitted", "review", "resubmission_requested"]) {
    assert.equal(isTerminalIdentityStatus(status), false, status);
  }
});

test("only submitted and review are pollable", () => {
  assert.equal(isPollableIdentityStatus("submitted"), true);
  assert.equal(isPollableIdentityStatus("review"), true);
  for (const status of ALL_STATUSES.filter(
    (s) => s !== "submitted" && s !== "review"
  )) {
    assert.equal(isPollableIdentityStatus(status), false, status);
  }
});

test("terminal and pollable never overlap", () => {
  for (const status of ALL_STATUSES) {
    assert.equal(
      isTerminalIdentityStatus(status) && isPollableIdentityStatus(status),
      false,
      status
    );
  }
});

// --- bounded polling decisions ---

test("polling continues for awaiting states within the budget", () => {
  assert.equal(shouldContinueIdentityPolling("submitted", 0, 5), true);
  assert.equal(shouldContinueIdentityPolling("review", 4, 5), true);
});

test("polling stops when the attempt budget is exhausted", () => {
  assert.equal(shouldContinueIdentityPolling("review", 5, 5), false);
  assert.equal(shouldContinueIdentityPolling("submitted", 6, 5), false);
});

test("polling never starts for terminal or actionable states", () => {
  assert.equal(shouldContinueIdentityPolling("approved", 0, 5), false);
  assert.equal(shouldContinueIdentityPolling("declined", 0, 5), false);
  assert.equal(shouldContinueIdentityPolling("not_started", 0, 5), false);
  assert.equal(shouldContinueIdentityPolling("created", 0, 5), false);
  assert.equal(shouldContinueIdentityPolling("resubmission_requested", 0, 5), false);
});

// --- hosted URL safety ---

test("absolute http/https hosted URLs are accepted", () => {
  assert.equal(isSafeHostedUrl("https://provider.example/v/abc123"), true);
  assert.equal(isSafeHostedUrl("http://localhost:4100/hosted/x"), true);
  assert.equal(isSafeHostedUrl("  https://example.com/session  "), true);
});

test("dangerous schemes are rejected", () => {
  assert.equal(isSafeHostedUrl("javascript:alert(1)"), false);
  assert.equal(isSafeHostedUrl("JavaScript:alert(1)"), false);
  assert.equal(isSafeHostedUrl("data:text/html,<script>alert(1)</script>"), false);
  assert.equal(isSafeHostedUrl("blob:https://example.com/abc"), false);
  assert.equal(isSafeHostedUrl("file:///etc/passwd"), false);
});

test("relative, protocol-relative, and malformed URLs are rejected", () => {
  assert.equal(isSafeHostedUrl("/account/verification"), false);
  assert.equal(isSafeHostedUrl("verification"), false);
  assert.equal(isSafeHostedUrl("//evil.example/path"), false);
  assert.equal(isSafeHostedUrl("http://"), false);
  assert.equal(isSafeHostedUrl("not a url"), false);
});

// --- session outcome (approved / no-URL race) ---

test("approved with a null URL is a refresh, not an error", () => {
  const outcome = resolveSessionOutcome({
    status: "approved",
    verificationUrl: null,
  });
  assert.deepEqual(outcome, { kind: "approved" });
});

test("approved never redirects even if a URL is present", () => {
  const outcome = resolveSessionOutcome({
    status: "approved",
    verificationUrl: "https://provider.example/v/abc",
  });
  assert.equal(outcome.kind, "approved");
});

test("a non-approved status with a safe URL redirects", () => {
  const outcome = resolveSessionOutcome({
    status: "created",
    verificationUrl: "https://provider.example/v/abc",
  });
  assert.deepEqual(outcome, {
    kind: "redirect",
    url: "https://provider.example/v/abc",
  });
});

test("a non-approved status with a missing URL is an honest error", () => {
  for (const status of ["created", "submitted", "review", "declined"]) {
    assert.equal(
      resolveSessionOutcome({ status, verificationUrl: null }).kind,
      "error",
      status
    );
  }
});

test("a non-approved status with an unsafe URL is an honest error", () => {
  for (const url of ["javascript:alert(1)", "/relative", "//evil.example", ""]) {
    assert.equal(
      resolveSessionOutcome({ status: "created", verificationUrl: url }).kind,
      "error",
      url
    );
  }
});

// --- stale/aborted session attempts ---

test("an aborted session response is stale and cannot redirect", () => {
  assert.equal(isStaleSessionAttempt(true, true), true);
});

test("a replaced session attempt is stale and cannot redirect", () => {
  assert.equal(isStaleSessionAttempt(false, false), true);
});

test("only the current, non-aborted attempt may act", () => {
  assert.equal(isStaleSessionAttempt(false, true), false);
});

test("empty and non-string values are rejected", () => {
  assert.equal(isSafeHostedUrl(""), false);
  assert.equal(isSafeHostedUrl("   "), false);
  assert.equal(isSafeHostedUrl(null), false);
  assert.equal(isSafeHostedUrl(undefined), false);
  assert.equal(isSafeHostedUrl(42), false);
  assert.equal(isSafeHostedUrl({ toString: () => "https://evil.example" }), false);
});
