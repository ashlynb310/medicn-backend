// Executable checks for Host Stripe Connect payout onboarding: provider-URL
// safety, readiness presentation, nullable fields, role visibility, request
// ownership, and the privacy/persistence invariants.
// Run with:  npm test   (node --test "tests/**/*.test.mts")
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isLoopbackHost,
  isSafeProviderUrl,
  normalizeConnectAccountLinkUrl,
  normalizeProviderUrl,
} from "../src/lib/safe-url.ts";
import {
  canViewPayoutSettings,
  connectErrorRecovery,
  connectStateOwnerKey,
  describePayoutReadiness,
  formatCapability,
  formatCountry,
  formatCurrency,
  formatSynchronizedAt,
  formatTriState,
  hasRequirements,
  isSafeRequirement,
  isStaleConnectRequest,
  normalizeCountryInput,
  summarizeConnectRequirements,
} from "../src/lib/connect/payouts.ts";

function requirement(status, awaitingActionFrom = "user") {
  return {
    status,
    awaitingActionFrom,
    requestedReasonCodes: ["requirements.pending_verification"],
    restrictsCapabilities: ["recipient.stripe_transfers"],
  };
}

function account(overrides = {}) {
  return {
    userId: "u1",
    providerAccountId: "acct_x",
    apiModel: "accounts_v2_recipient",
    country: "US",
    currency: "usd",
    detailsSubmitted: true,
    transfersCapability: "active",
    transfersReady: true,
    payoutsEnabled: true,
    requirementsCurrentlyDue: [],
    requirementsPastDue: [],
    lastSynchronizedAt: "2026-07-22T12:00:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-22T12:00:00.000Z",
    ...overrides,
  };
}

function source(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

// --- safe provider URL validation ---

test("production accepts HTTPS and rejects arbitrary HTTP", () => {
  const PROD = false;
  assert.equal(isSafeProviderUrl("https://connect.stripe.com/setup/x", PROD), true);
  assert.equal(isSafeProviderUrl("http://connect.stripe.com/setup/x", PROD), false);
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.equal(isSafeProviderUrl(`http://${host}/setup`, PROD), false, host);
  }
});

test("development permits loopback HTTP only", () => {
  const DEV = true;
  for (const host of ["localhost", "127.0.0.1", "[::1]", "LOCALHOST"]) {
    assert.equal(isSafeProviderUrl(`http://${host}:4100/setup`, DEV), true, host);
  }
  for (const host of ["connect.stripe.com", "10.0.0.5", "evil.localhost.example"]) {
    assert.equal(isSafeProviderUrl(`http://${host}/setup`, DEV), false, host);
  }
  assert.equal(isSafeProviderUrl("https://connect.stripe.com/x", DEV), true);
});

test("isLoopbackHost matches only real loopback hosts", () => {
  for (const host of ["localhost", "127.0.0.1", "::1", "[::1]"]) {
    assert.equal(isLoopbackHost(host), true, host);
  }
  for (const host of ["localhost.evil.com", "127.0.0.2", "stripe.com", ""]) {
    assert.equal(isLoopbackHost(host), false, host);
  }
});

test("dangerous and malformed provider URLs are always rejected", () => {
  for (const allow of [true, false]) {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "blob:https://example.com/abc",
      "file:///etc/passwd",
      "//evil.example/setup",
      "/host/payouts",
      "not a url",
      "",
      "   ",
      null,
      undefined,
      42,
    ]) {
      assert.equal(isSafeProviderUrl(bad, allow), false, String(bad));
      assert.equal(normalizeProviderUrl(bad, allow), null, String(bad));
    }
  }
});

test("normalize returns a canonical href", () => {
  assert.equal(
    normalizeProviderUrl("  https://connect.stripe.com/setup?x=1  ", false),
    "https://connect.stripe.com/setup?x=1"
  );
});

test("Connect links require a safe URL, future expiry, and matching type", () => {
  const now = Date.parse("2026-07-22T12:00:00.000Z");
  const valid = {
    url: "https://connect.stripe.com/setup/x",
    expiresAt: "2026-07-22T12:05:00.000Z",
    type: "account_onboarding",
  };
  assert.equal(
    normalizeConnectAccountLinkUrl(valid, "account_onboarding", false, now),
    valid.url
  );
  assert.equal(
    normalizeConnectAccountLinkUrl(
      { ...valid, expiresAt: "2026-07-22T12:00:00.000Z" },
      "account_onboarding",
      false,
      now
    ),
    null,
    "already-expired links are rejected"
  );
  assert.equal(
    normalizeConnectAccountLinkUrl(
      { ...valid, expiresAt: "not-a-date" },
      "account_onboarding",
      false,
      now
    ),
    null
  );
  assert.equal(
    normalizeConnectAccountLinkUrl(valid, "account_update", false, now),
    null,
    "mismatched link types are rejected"
  );
  assert.equal(
    normalizeConnectAccountLinkUrl(
      { ...valid, url: "javascript:alert(1)" },
      "account_onboarding",
      false,
      now
    ),
    null
  );
});

// --- readiness presentation ---

test("no account is the not-created starting state", () => {
  const readiness = describePayoutReadiness(null);
  assert.equal(readiness.state, "not_created");
  assert.equal(readiness.needsOnboarding, true);
});

test("a fully enabled account is ready and needs no onboarding", () => {
  const readiness = describePayoutReadiness(account());
  assert.equal(readiness.state, "ready");
  assert.equal(readiness.tone, "success");
  assert.equal(readiness.needsOnboarding, false);
});

test("past-due requirements outrank every other state", () => {
  const readiness = describePayoutReadiness(
    account({
      requirementsPastDue: [requirement("past_due")],
      requirementsCurrentlyDue: [requirement("currently_due")],
      transfersCapability: "restricted",
    })
  );
  assert.equal(readiness.state, "requirements_past_due");
  assert.equal(readiness.tone, "danger");
});

test("a restricted capability outranks currently-due requirements", () => {
  const readiness = describePayoutReadiness(
    account({
      transfersCapability: "restricted",
      requirementsCurrentlyDue: [requirement("currently_due")],
    })
  );
  assert.equal(readiness.state, "restricted");
});

test("an unsupported capability is treated as restricted", () => {
  assert.equal(
    describePayoutReadiness(account({ transfersCapability: "unsupported" })).state,
    "restricted"
  );
});

test("currently-due requirements block readiness", () => {
  const readiness = describePayoutReadiness(
    account({ requirementsCurrentlyDue: [requirement("currently_due")] })
  );
  assert.equal(readiness.state, "requirements_due");
  assert.equal(readiness.needsOnboarding, true);
});

test("readiness requires BOTH transfersReady and payoutsEnabled", () => {
  assert.equal(
    describePayoutReadiness(account({ transfersReady: false })).state,
    "pending"
  );
  assert.equal(
    describePayoutReadiness(account({ payoutsEnabled: false })).state,
    "pending"
  );
  // A null payoutsEnabled (not yet reported) must never read as ready.
  assert.equal(
    describePayoutReadiness(account({ payoutsEnabled: null })).state,
    "pending",
    "unknown payout status is not readiness"
  );
});

test("a pending capability is pending, not ready", () => {
  assert.equal(
    describePayoutReadiness(
      account({ transfersCapability: "pending", transfersReady: false })
    ).state,
    "pending"
  );
});

// --- nullable field formatting ---

test("nullable country and currency use safe fallbacks", () => {
  assert.equal(formatCountry(null), "Not set");
  assert.equal(formatCountry(""), "Not set");
  assert.equal(formatCountry("  us "), "US");
  assert.equal(formatCurrency(null), "Not set");
  assert.equal(formatCurrency("usd"), "USD");
});

test("tri-state booleans distinguish false from not-reported", () => {
  assert.equal(formatTriState(true), "Yes");
  assert.equal(formatTriState(false), "No");
  assert.equal(formatTriState(null), "Not reported");
  assert.equal(formatTriState(undefined), "Not reported");
});

test("capability and timestamps degrade safely", () => {
  assert.equal(formatCapability(null), "Not reported");
  assert.equal(formatCapability("active"), "Active");
  assert.equal(formatSynchronizedAt(null), "Never");
  assert.equal(formatSynchronizedAt("nonsense"), "Never");
});

test("no formatter ever emits null or undefined text", () => {
  for (const value of [null, undefined, ""]) {
    for (const fn of [formatCountry, formatCurrency, formatCapability]) {
      const result = fn(value);
      assert.ok(result.length > 0);
      assert.ok(!/null|undefined/i.test(result), `${result} for ${String(value)}`);
    }
  }
});

test("hasRequirements handles null and empty lists", () => {
  assert.equal(hasRequirements(null), false);
  assert.equal(hasRequirements(undefined), false);
  assert.equal(hasRequirements([]), false);
  assert.equal(hasRequirements([requirement("currently_due")]), true);
  assert.equal(hasRequirements({ malformed: true }), true);
});

test("requirements use the exact safe structured shape", () => {
  const currentlyDue = requirement("currently_due", "user");
  const pastDue = requirement("past_due", "stripe");
  assert.equal(isSafeRequirement(currentlyDue), true);
  assert.equal(isSafeRequirement(pastDue), true);
  for (const malformed of [
    "external_account",
    null,
    {},
    { ...currentlyDue, status: "eventually_due" },
    { ...currentlyDue, awaitingActionFrom: "platform" },
    { ...currentlyDue, requestedReasonCodes: [42] },
    { ...currentlyDue, restrictsCapabilities: null },
  ]) {
    assert.equal(isSafeRequirement(malformed), false, JSON.stringify(malformed));
  }

  const api = source("../src/lib/api/connect.ts");
  assert.match(api, /requirementsCurrentlyDue: SafeRequirement\[\]/);
  assert.match(api, /requirementsPastDue: SafeRequirement\[\]/);
});

test("malformed legacy requirements become generic string summaries", () => {
  for (const malformed of [
    ["external_account"],
    [{ legacy: "individual.verification.document" }],
    [null],
    { legacy: true },
  ]) {
    const summaries = summarizeConnectRequirements(malformed, "currently_due");
    assert.ok(summaries.length > 0);
    for (const summary of summaries) {
      assert.equal(typeof summary.text, "string");
      assert.equal(summary.text, "Stripe requires additional information.");
      assert.ok(!summary.text.includes("[object Object]"));
    }
  }

  const panel = source("../src/components/host/host-payouts-panel.tsx");
  assert.match(panel, /<li key=\{item\.key\}>\{item\.text\}<\/li>/);
  assert.ok(!/<li[^>]*>\{item\}<\/li>/.test(panel));
});

// --- country input (the only field MediCN collects) ---

test("country input is trimmed, uppercased, and exactly two letters", () => {
  assert.deepEqual(normalizeCountryInput("  us "), { normalized: "US", valid: true });
  assert.equal(normalizeCountryInput("GB").valid, true);
  for (const bad of ["", "U", "USA", "1A", "U S", "--"]) {
    assert.equal(normalizeCountryInput(bad).valid, false, bad);
  }
});

// --- role visibility ---

test("only hosts see payout settings", () => {
  assert.equal(canViewPayoutSettings(["host"]), true);
  assert.equal(canViewPayoutSettings(["renter", "host"]), true);
  assert.equal(canViewPayoutSettings(["renter"]), false);
  assert.equal(canViewPayoutSettings(["admin"]), false, "admin is not a host");
  assert.equal(canViewPayoutSettings([]), false);
  assert.equal(canViewPayoutSettings(null), false);
  assert.equal(canViewPayoutSettings(undefined), false);
});

// --- stale / aborted request ownership ---

test("aborted or superseded connect requests are stale", () => {
  assert.equal(isStaleConnectRequest(true, true), true, "aborted");
  assert.equal(isStaleConnectRequest(false, false), true, "superseded");
  assert.equal(isStaleConnectRequest(true, false), true, "both");
  assert.equal(isStaleConnectRequest(false, true), false, "current attempt acts");
});

test("Connect state keys isolate users without resetting on token rotation", () => {
  assert.notEqual(connectStateOwnerKey("host-a"), connectStateOwnerKey("host-b"));
  assert.equal(connectStateOwnerKey("host-a"), connectStateOwnerKey("host-a"));
  assert.notEqual(
    connectStateOwnerKey("host-a", "return"),
    connectStateOwnerKey("host-a", "refresh")
  );

  const payouts = source("../src/components/host/host-payouts-panel.tsx");
  const returned = source("../src/components/host/connect-return-panel.tsx");
  assert.match(payouts, /key=\{connectStateOwnerKey\(user\.id\)\}/);
  assert.match(returned, /key=\{connectStateOwnerKey\(user\.id, mode\)\}/);
  assert.ok(!/key=\{[^}]*accessToken/.test(payouts));
  assert.ok(!/key=\{[^}]*accessToken/.test(returned));
  assert.match(payouts, /user\.supabaseUserId === sessionUserId/);
  assert.match(returned, /user\.supabaseUserId === sessionUserId/);
});

test("the payouts panel guards every request against stale completion", () => {
  const panel = source("../src/components/host/host-payouts-panel.tsx");
  assert.match(panel, /isStaleConnectRequest\(/);
  // Redirect only happens after the staleness check.
  const flow = panel.slice(panel.indexOf("const openHostedFlow"));
  const staleGuard = flow.indexOf("if (isStaleAction(controller)) return;");
  const validation = flow.indexOf("normalizeConnectAccountLinkUrl(");
  const redirect = flow.indexOf("window.location.assign(safeUrl)");
  assert.ok(staleGuard > -1 && staleGuard < redirect, "stale must return before redirect");
  assert.ok(validation > staleGuard && validation < redirect, "validate after ownership and before redirect");
  assert.match(flow, /err instanceof DOMException|error instanceof DOMException/);
  // Actions are cancelled on unmount / token change.
  assert.match(panel, /actionRef\.current\?\.abort\(\);/);
});

// --- self-service must never send hostUserId ---

test("self-service connect calls never send hostUserId", () => {
  const api = source("../src/lib/api/connect.ts");
  assert.ok(
    !/hostUserId/.test(api.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")),
    "hostUserId is Admin-only and must not appear in self-service calls"
  );
  assert.match(api, /body: \{ country \}/, "create sends only the country");
});

// --- no credential collection, no URL/token persistence ---

test("the payout UI collects no payout credentials", () => {
  const panel = source("../src/components/host/host-payouts-panel.tsx");
  for (const forbidden of [
    "routingNumber",
    "accountNumber",
    "iban",
    "ssn",
    "taxId",
    "dateOfBirth",
    'type="password"',
  ]) {
    assert.ok(!panel.includes(forbidden), `must not collect ${forbidden}`);
  }
});

test("the provider URL is never persisted, logged, or rendered", () => {
  const panel = source("../src/components/host/host-payouts-panel.tsx");
  for (const forbidden of [
    "localStorage",
    "sessionStorage",
    "document.cookie",
    "console.log",
    "console.error",
  ]) {
    assert.ok(!panel.includes(forbidden), `must not use ${forbidden}`);
  }
  // The link URL is never stored in React state...
  assert.ok(!/useState[^\n]*(url|link)/i.test(panel), "no URL held in state");
  // ...and is only used transiently for the redirect.
  assert.match(panel, /window\.location\.assign\(safeUrl\)/);
  assert.match(panel, /normalizeConnectAccountLinkUrl\(/);
  // Provider identifiers are never displayed.
  assert.ok(
    !/providerAccountId\}/.test(panel) && !/\{account\.providerAccountId/.test(panel),
    "the Stripe account id must not be rendered"
  );
});

test("Retry-After guidance is preserved on payout and return pages", () => {
  assert.equal(
    connectErrorRecovery(
      { code: "RATE_LIMIT_EXCEEDED", status: 429, retryAfter: 37 },
      null
    ),
    "Too many attempts. Try again in about 37s."
  );
  assert.equal(
    connectErrorRecovery(
      { code: "RATE_LIMITED", status: 429, retryAfter: null },
      null
    ),
    "Too many attempts. Please wait a moment and try again."
  );
  const payouts = source("../src/components/host/host-payouts-panel.tsx");
  const returned = source("../src/components/host/connect-return-panel.tsx");
  assert.match(payouts, /retryAfter: error\.retryAfterSeconds/);
  assert.match(payouts, /connectErrorRecovery\(loadError\)/);
  assert.match(returned, /connectErrorRecovery\(error\)/);
});

// --- return pages must re-read the authoritative state ---

test("the return panel confirms status via GET /connect/account", () => {
  const panel = source("../src/components/host/connect-return-panel.tsx");
  assert.match(panel, /getConnectAccount\(/, "must call the authoritative endpoint");
  // Nothing about the redirect itself is treated as a result.
  for (const forbidden of ["searchParams", "useSearchParams", "location.search"]) {
    assert.ok(!panel.includes(forbidden), `must not read ${forbidden}`);
  }
  assert.match(
    panel,
    /by itself confirm setup/,
    "must state that returning is not proof of success"
  );
  assert.match(panel, /isStaleConnectRequest\(/);
});

test("both Stripe return routes render the authoritative panel", () => {
  for (const [file, mode] of [
    ["../src/app/host/connect/return/page.tsx", "return"],
    ["../src/app/host/connect/refresh/page.tsx", "refresh"],
  ]) {
    const page = source(file);
    assert.match(page, new RegExp(`ConnectReturnPanel mode="${mode}"`), file);
  }
});

test("payout settings never claim a bank payout or show invented amounts", () => {
  const panel = source("../src/components/host/host-payouts-panel.tsx");
  // No fabricated money figures: the Connect account response carries no
  // amounts, so nothing here may format or display one.
  for (const forbidden of [
    "amountCents",
    "formatPrice",
    "toFixed",
    "Intl.NumberFormat",
    "earnings",
    "available balance",
    "payout sent",
    "deposited",
    "arriving",
  ]) {
    assert.ok(
      !new RegExp(forbidden.replace(/ /g, "\\s+"), "i").test(panel),
      `must not display ${forbidden}`
    );
  }
  // Transfers are honestly described as reaching the connected Stripe balance,
  // with Stripe controlling when money reaches a bank account.
  assert.match(panel, /connected Stripe balance/);
  assert.match(panel, /Stripe controls\s*\n?\s*when money reaches your bank account/);
});
