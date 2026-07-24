// Executable checks for messaging thread reconciliation.
// Run with:  npm test   (node --test "tests/**/*.test.mts")
// No test framework is added; Node runs .ts via native type stripping. This
// file is excluded from tsconfig and eslint.
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyThreadPage,
  createEventIdCache,
  hasSequenceGap,
  latestSequence,
  mergeMessages,
} from "../src/lib/messaging/thread-state.ts";

function message(sequence, overrides = {}) {
  return {
    id: `m${sequence}`,
    sequence,
    sender: { id: "u1", displayName: "Renter", role: "renter" },
    isAdmin: false,
    body: `body ${sequence}`,
    createdAt: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}

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

// --- ordered merging ---

test("mergeMessages returns ascending sequence order", () => {
  const merged = mergeMessages([], [message(3), message(1), message(2)]);
  assert.deepEqual(
    merged.map((m) => m.sequence),
    [1, 2, 3]
  );
});

test("mergeMessages inserts out-of-order arrivals into the right position", () => {
  const merged = mergeMessages([message(1), message(4)], [message(2)]);
  assert.deepEqual(
    merged.map((m) => m.sequence),
    [1, 2, 4]
  );
});

// --- deduplication ---

test("mergeMessages deduplicates by message id", () => {
  const merged = mergeMessages([message(1)], [message(1)]);
  assert.equal(merged.length, 1);
});

test("mergeMessages deduplicates by sequence even with a different id", () => {
  const merged = mergeMessages([message(1)], [message(1, { id: "other" })]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "m1"); // existing wins
});

test("mergeMessages deduplicates repeats inside one incoming batch", () => {
  const merged = mergeMessages([], [message(1), message(1), message(2)]);
  assert.deepEqual(
    merged.map((m) => m.sequence),
    [1, 2]
  );
});

// --- sequence-gap detection ---

test("hasSequenceGap only flags skipped sequences", () => {
  assert.equal(hasSequenceGap(5, 6), false); // next in line
  assert.equal(hasSequenceGap(5, 5), false); // duplicate/stale
  assert.equal(hasSequenceGap(5, 4), false); // older
  assert.equal(hasSequenceGap(5, 7), true); // 6 is missing
  assert.equal(hasSequenceGap(0, 1), false); // first message
  assert.equal(hasSequenceGap(0, 3), true);
});

// --- cursor advancement + repeated catch-up pages ---

test("latestSequence is 0 for an empty thread", () => {
  assert.equal(latestSequence([]), 0);
});

test("applyThreadPage advances the cursor and merges", () => {
  const first = applyThreadPage(
    { messages: [], cursor: 0, hasMore: false },
    page([message(1), message(2)], { hasMore: true })
  );
  assert.equal(first.cursor, 2);
  assert.equal(first.hasMore, true);

  const second = applyThreadPage(first, page([message(3)], { hasMore: false }));
  assert.equal(second.cursor, 3);
  assert.equal(second.hasMore, false);
  assert.deepEqual(
    second.messages.map((m) => m.sequence),
    [1, 2, 3]
  );
});

test("repeated identical catch-up pages are idempotent", () => {
  const p = page([message(1), message(2)]);
  const once = applyThreadPage({ messages: [], cursor: 0, hasMore: false }, p);
  const twice = applyThreadPage(once, p);
  assert.equal(twice.messages.length, 2);
  assert.equal(twice.cursor, 2);
});

test("cursor never moves backwards on a stale page", () => {
  const state = { messages: [message(5)], cursor: 5, hasMore: false };
  const stale = applyThreadPage(
    state,
    page([], { afterSequence: 0, nextCursor: 0 })
  );
  assert.equal(stale.cursor, 5);
});

test("an empty page still reports hasMore and keeps the cursor", () => {
  const state = { messages: [], cursor: 0, hasMore: false };
  const result = applyThreadPage(state, page([], { nextCursor: 0, hasMore: false }));
  assert.equal(result.cursor, 0);
  assert.deepEqual(result.messages, []);
});

// --- bounded event-id cache ---

test("event cache reports duplicates and remembers new ids", () => {
  const cache = createEventIdCache(10);
  assert.equal(cache.remember("e1"), true);
  assert.equal(cache.remember("e1"), false); // duplicate delivery
  assert.equal(cache.seen("e1"), true);
  assert.equal(cache.seen("nope"), false);
});

test("event cache is bounded and evicts oldest ids", () => {
  const cache = createEventIdCache(3);
  cache.remember("a");
  cache.remember("b");
  cache.remember("c");
  cache.remember("d"); // evicts "a"
  assert.equal(cache.size, 3);
  assert.equal(cache.seen("a"), false);
  assert.equal(cache.seen("d"), true);
  // "a" can be remembered again after eviction (harmless: REST is authoritative)
  assert.equal(cache.remember("a"), true);
  assert.equal(cache.size, 3);
});
