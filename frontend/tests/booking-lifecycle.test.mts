// Executable checks for the checkout/cancellation pure helpers.
// Run with:  npm test   (node --test "tests/**/*.test.mts")
// No test framework is added; Node runs .ts via native type stripping. This
// file is excluded from tsconfig and eslint. The helpers only read a few fields,
// so fixtures are minimal plain objects.
import test from "node:test";
import assert from "node:assert/strict";
import {
  canOfferCancellation,
  deriveCheckoutState,
  selectPaymentAttempt,
  shouldContinueCheckoutPolling,
} from "../src/lib/booking-lifecycle.ts";
import { isUuid } from "../src/lib/uuid.ts";

function attempt(overrides = {}) {
  return {
    id: "pay",
    attemptNumber: 1,
    status: "pending",
    amountCents: 1000,
    amountRefundedCents: 0,
    currency: "usd",
    active: false,
    expiresAt: null,
    paidAt: null,
    refundedAt: null,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}

function booking(overrides = {}) {
  return { status: "accepted", renterId: "r1", hostId: "h1", ...overrides };
}

function summary(payments) {
  return { payments };
}

// --- selectPaymentAttempt ---

test("selectPaymentAttempt returns null for no payments", () => {
  assert.equal(selectPaymentAttempt([]), null);
});

test("selectPaymentAttempt picks the highest attemptNumber when none active", () => {
  const chosen = selectPaymentAttempt([
    attempt({ id: "a", attemptNumber: 1 }),
    attempt({ id: "c", attemptNumber: 3 }),
    attempt({ id: "b", attemptNumber: 2 }),
  ]);
  assert.equal(chosen?.id, "c");
});

test("selectPaymentAttempt prefers the active attempt even if not the highest number", () => {
  const chosen = selectPaymentAttempt([
    attempt({ id: "old", attemptNumber: 1, active: true }),
    attempt({ id: "new", attemptNumber: 2, active: false }),
  ]);
  assert.equal(chosen?.id, "old");
});

// --- deriveCheckoutState ---

test("partial refund is not shown as fully refunded or ordinary paid", () => {
  const state = deriveCheckoutState(
    booking({ status: "paid" }),
    summary([attempt({ status: "partially_refunded", active: true })])
  );
  assert.equal(state, "partially_refunded");
  assert.notEqual(state, "refunded");
  assert.notEqual(state, "paid");
});

test("dispute overrides a paid/completed booking", () => {
  assert.equal(
    deriveCheckoutState(
      booking({ status: "completed" }),
      summary([attempt({ status: "disputed", active: true })])
    ),
    "disputed"
  );
});

test("refund overrides a paid booking", () => {
  assert.equal(
    deriveCheckoutState(
      booking({ status: "paid" }),
      summary([attempt({ status: "refunded", active: true })])
    ),
    "refunded"
  );
});

test("paid booking with a paid attempt derives paid", () => {
  assert.equal(
    deriveCheckoutState(
      booking({ status: "paid" }),
      summary([attempt({ status: "paid", active: true })])
    ),
    "paid"
  );
});

test("pending payment on accepted booking derives confirming", () => {
  assert.equal(
    deriveCheckoutState(booking({ status: "payment_pending" }), null),
    "confirming"
  );
});

test("adverse state uses the LATEST attempt, not payments[0]", () => {
  // payments[0] is an old failed attempt; the latest active is paid.
  const state = deriveCheckoutState(
    booking({ status: "paid" }),
    summary([
      attempt({ id: "old", attemptNumber: 1, status: "failed" }),
      attempt({ id: "new", attemptNumber: 2, status: "paid", active: true }),
    ])
  );
  assert.equal(state, "paid");
});

// --- shouldContinueCheckoutPolling ---

test("accepted/payment_pending confirming states continue polling", () => {
  assert.equal(
    shouldContinueCheckoutPolling(booking({ status: "accepted" }), "confirming"),
    true
  );
  assert.equal(
    shouldContinueCheckoutPolling(
      booking({ status: "payment_pending" }),
      "confirming"
    ),
    true
  );
});

test("terminal states stop polling", () => {
  assert.equal(
    shouldContinueCheckoutPolling(booking({ status: "paid" }), "paid"),
    false
  );
  assert.equal(
    shouldContinueCheckoutPolling(booking({ status: "cancelled" }), "cancelled"),
    false
  );
  // Adverse payment on an accepted booking must not keep polling.
  assert.equal(
    shouldContinueCheckoutPolling(booking({ status: "accepted" }), "failed"),
    false
  );
});

// --- canOfferCancellation ---

test("renter/host/admin action eligibility", () => {
  // Renter on an accepted booking can cancel.
  assert.equal(
    canOfferCancellation({
      status: "accepted",
      isRenter: true,
      isHost: false,
      processing: false,
    }),
    true
  );
  // Host on an accepted booking can cancel.
  assert.equal(
    canOfferCancellation({
      status: "accepted",
      isRenter: false,
      isHost: true,
      processing: false,
    }),
    true
  );
  // Admin / non-participant never inherits the control.
  assert.equal(
    canOfferCancellation({
      status: "accepted",
      isRenter: false,
      isHost: false,
      processing: false,
    }),
    false
  );
});

test("paid Renter cancellation is hidden", () => {
  assert.equal(
    canOfferCancellation({
      status: "paid",
      isRenter: true,
      isHost: false,
      processing: false,
    }),
    false
  );
});

test("host uses reject (not cancel) on a requested booking", () => {
  assert.equal(
    canOfferCancellation({
      status: "requested",
      isRenter: false,
      isHost: true,
      processing: false,
    }),
    false
  );
});

test("cancellation hidden for terminal states and while processing", () => {
  for (const status of ["rejected", "cancelled", "completed"]) {
    assert.equal(
      canOfferCancellation({ status, isRenter: true, isHost: false, processing: false }),
      false
    );
  }
  assert.equal(
    canOfferCancellation({
      status: "accepted",
      isRenter: true,
      isHost: false,
      processing: true,
    }),
    false
  );
});

// --- isUuid (locator validation) ---

test("isUuid accepts a canonical UUID and rejects invalid locators", () => {
  assert.equal(isUuid("11111111-2222-3333-4444-555555555555"), true);
  assert.equal(isUuid("not-a-uuid"), false);
  assert.equal(isUuid(""), false);
  assert.equal(isUuid(null), false);
  assert.equal(isUuid(undefined), false);
});
