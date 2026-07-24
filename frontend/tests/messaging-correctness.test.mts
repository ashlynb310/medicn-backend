// Executable checks for the F4 correctness pass: serialized catch-up reruns,
// cursor stalling, read-cursor retry semantics, Unicode code-point counting,
// and multi-page unread aggregation.
// Run with:  npm test   (node --test "tests/**/*.test.mts")
import test from "node:test";
import assert from "node:assert/strict";
import { createSerialRunner } from "../src/lib/messaging/serial-runner.ts";
import {
  applyThreadPage,
  createEventIdCache,
  isCatchUpStalled,
} from "../src/lib/messaging/thread-state.ts";
import {
  countCodePoints,
  evaluateMessage,
  MAX_MESSAGE_CODE_POINTS,
} from "../src/lib/messaging/message-content.ts";
import {
  aggregateUnread,
  sumUnreadCounts,
  totalPagesFor,
} from "../src/lib/messaging/unread.ts";
import { resolveReadAck } from "../src/lib/messaging/read-cursor.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// --- notification arriving during an active catch-up ---

test("a notification during an active run schedules exactly one rerun", async () => {
  let started = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const runner = createSerialRunner(async () => {
    started += 1;
    if (started === 1) await gate;
  });

  const first = runner.schedule();
  await tick();
  assert.equal(started, 1);
  assert.equal(runner.running, true);

  // Two notifications arrive mid-run: they must coalesce into ONE rerun.
  await runner.schedule();
  await runner.schedule();
  assert.equal(started, 1, "reruns must not overlap the active run");

  release();
  await first;
  assert.equal(started, 2, "pending work must not be discarded");
  assert.equal(runner.runs, 2);
});

test("a failing run still performs its pending rerun", async () => {
  let started = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const runner = createSerialRunner(async () => {
    started += 1;
    if (started === 1) {
      await gate;
      throw new Error("catch-up failed");
    }
  });

  const first = runner.schedule();
  await tick();
  await runner.schedule();
  release();
  await first;
  assert.equal(started, 2);
});

test("sequential schedules run once each when idle", async () => {
  const runner = createSerialRunner(async () => {});
  await runner.schedule();
  await runner.schedule();
  assert.equal(runner.runs, 2);
});

// --- catch-up cursor non-progress ---

function page(messages, { nextCursor, hasMore = false, afterSequence = 0 } = {}) {
  return {
    messages,
    pageInfo: {
      afterSequence,
      nextCursor: nextCursor ?? (messages.at(-1)?.sequence ?? afterSequence),
      hasMore,
    },
  };
}

test("isCatchUpStalled flags hasMore without cursor progress", () => {
  const before = { messages: [], cursor: 7, hasMore: true };
  const after = applyThreadPage(before, page([], { nextCursor: 7, hasMore: true }));
  assert.equal(after.cursor, 7);
  assert.equal(isCatchUpStalled(before, after), true);
});

test("isCatchUpStalled is false when the cursor advances", () => {
  const before = { messages: [], cursor: 7, hasMore: true };
  const after = applyThreadPage(
    before,
    page([], { nextCursor: 9, hasMore: true })
  );
  assert.equal(isCatchUpStalled(before, after), false);
});

test("isCatchUpStalled is false on a completed page even without progress", () => {
  const before = { messages: [], cursor: 7, hasMore: false };
  const after = applyThreadPage(before, page([], { nextCursor: 7, hasMore: false }));
  assert.equal(isCatchUpStalled(before, after), false);
});

// --- acknowledged read cursor (real production helper) ---

test("acked advances only from the backend-confirmed sequence", () => {
  // The backend confirmed 5 for a request of 5.
  const reached = resolveReadAck(0, 5, 5);
  assert.equal(reached.acked, 5);
  assert.equal(reached.reachedTarget, true);
  assert.equal(reached.stalled, false);
});

test("a requested target is never acknowledged by itself", () => {
  // Requested 9 but the backend clamped to 4 (its committed lastSequence).
  const outcome = resolveReadAck(0, 9, 4);
  assert.equal(outcome.acked, 4, "must use the confirmed value, not the target");
  assert.equal(outcome.reachedTarget, false);
  // It DID advance toward the target, so one more attempt is allowed.
  assert.equal(outcome.stalled, false);
});

test("a success that does not advance the cursor is stalled, not looped", () => {
  // Second attempt for the same target returns the same clamped value.
  const outcome = resolveReadAck(4, 9, 4);
  assert.equal(outcome.acked, 4);
  assert.equal(outcome.reachedTarget, false);
  assert.equal(outcome.stalled, true, "caller must break instead of retrying");
});

test("the acknowledged cursor never moves backwards", () => {
  const outcome = resolveReadAck(7, 9, 3); // stale/older confirmation
  assert.equal(outcome.acked, 7);
  assert.equal(outcome.stalled, true);
});

// Drives the REAL helper the same way the component loop does, proving that
// coalescing works and that the loop always terminates (no request storm).
async function driveReadCursor(initialTarget, send) {
  const state = { target: initialTarget, acked: 0, error: false, requests: 0 };
  while (state.target > state.acked) {
    const target = state.target;
    let confirmed;
    try {
      state.requests += 1;
      confirmed = await send(target, state);
    } catch {
      state.error = true;
      break;
    }
    const outcome = resolveReadAck(state.acked, target, confirmed);
    state.acked = outcome.acked;
    if (outcome.stalled) {
      state.error = true;
      break;
    }
    state.error = false;
  }
  return state;
}

test("read cursor does not advance on failure, then succeeds on retry", async () => {
  let attempts = 0;
  const send = async (sequence) => {
    attempts += 1;
    if (attempts === 1) throw new Error("network");
    return sequence;
  };

  const first = await driveReadCursor(5, send);
  assert.equal(first.acked, 0, "must not advance before the backend confirms");
  assert.equal(first.error, true);
  assert.equal(attempts, 1, "a failure must not spin into a request loop");

  const retry = await driveReadCursor(5, send);
  assert.equal(retry.acked, 5);
  assert.equal(retry.error, false);
  assert.equal(attempts, 2);
});

test("a newer target arriving mid-request is coalesced into one more send", async () => {
  const sent = [];
  const result = await driveReadCursor(3, async (sequence, state) => {
    sent.push(sequence);
    if (sent.length === 1) state.target = 9; // arrives during the request
    return sequence;
  });
  assert.deepEqual(sent, [3, 9]);
  assert.equal(result.acked, 9);
});

test("a permanently clamped cursor terminates instead of storming", async () => {
  // The backend can never confirm past 4; the loop must stop quickly.
  const result = await driveReadCursor(9, async () => 4);
  assert.equal(result.acked, 4);
  assert.equal(result.error, true);
  assert.ok(result.requests <= 2, `expected ≤2 requests, got ${result.requests}`);
});

test("no read request is sent when the target has not advanced", async () => {
  const result = await driveReadCursor(0, async () => {
    throw new Error("should not be called");
  });
  assert.equal(result.requests, 0);
});

// --- Unicode code-point counting ---

test("countCodePoints counts code points, not UTF-16 units", () => {
  assert.equal("👍".length, 2); // JS string length is misleading
  assert.equal(countCodePoints("👍"), 1);
  assert.equal(countCodePoints("héllo"), 5);
  assert.equal(countCodePoints("👍👍👍"), 3);
  assert.equal(countCodePoints(""), 0);
});

test("evaluateMessage trims and validates against the 1-4000 code-point rule", () => {
  const blank = evaluateMessage("   ");
  assert.equal(blank.empty, true);
  assert.equal(blank.valid, false);

  const ok = evaluateMessage("  hello  ");
  assert.equal(ok.trimmed, "hello");
  assert.equal(ok.length, 5);
  assert.equal(ok.valid, true);
  assert.equal(ok.remaining, MAX_MESSAGE_CODE_POINTS - 5);

  // 4000 emoji = 8000 UTF-16 units but exactly 4000 code points: still valid.
  const atLimit = evaluateMessage("👍".repeat(MAX_MESSAGE_CODE_POINTS));
  assert.equal(atLimit.length, MAX_MESSAGE_CODE_POINTS);
  assert.equal(atLimit.tooLong, false);
  assert.equal(atLimit.valid, true);

  const overLimit = evaluateMessage("a".repeat(MAX_MESSAGE_CODE_POINTS + 1));
  assert.equal(overLimit.tooLong, true);
  assert.equal(overLimit.valid, false);
});

// --- multi-page unread aggregation ---

test("sumUnreadCounts and totalPagesFor compute page coverage", () => {
  assert.equal(sumUnreadCounts([{ unreadCount: 2 }, { unreadCount: 3 }]), 5);
  assert.equal(sumUnreadCounts([]), 0);
  assert.equal(totalPagesFor(0, 100), 0);
  assert.equal(totalPagesFor(100, 100), 1);
  assert.equal(totalPagesFor(101, 100), 2);
  assert.equal(totalPagesFor(250, 100), 3);
});

test("aggregateUnread totals every page, not just the first", () => {
  const pages = [
    [{ unreadCount: 1 }, { unreadCount: 2 }], // page 1
    [{ unreadCount: 4 }], // page 2
    [{ unreadCount: 3 }], // page 3
  ];
  const result = aggregateUnread(pages, true);
  assert.equal(result.total, 10);
  assert.equal(result.complete, true);
});

test("an incomplete walk is reported so the badge can keep its old value", () => {
  const result = aggregateUnread([[{ unreadCount: 5 }]], false);
  assert.equal(result.complete, false);
});

// --- bounded event dedupe ---

test("event dedupe is bounded and drops repeats", () => {
  const cache = createEventIdCache(2);
  assert.equal(cache.remember("e1"), true);
  assert.equal(cache.remember("e1"), false);
  cache.remember("e2");
  cache.remember("e3"); // evicts e1
  assert.equal(cache.size, 2);
  assert.equal(cache.seen("e1"), false);
  assert.equal(cache.seen("e3"), true);
});
