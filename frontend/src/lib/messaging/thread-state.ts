import type { InquiryMessage, InquiryPageInfo } from "@/lib/api/types";

// Pure reconciliation logic for an inquiry thread.
//
// Socket.IO events are hints only. PostgreSQL (via REST) is authoritative, so
// every notification, gap, reconnect, or re-subscription funnels through
// GET /inquiries/:id?afterSequence=<cursor> and merges here. Messages are
// identified by backend-allocated `sequence` (unique per inquiry) and `id`;
// the browser never invents a sequence.

/**
 * Merges incoming messages into existing ones, deduplicating by message id AND
 * by (inquiry-scoped) sequence, and returns them in ascending sequence order.
 * Existing entries win, so a duplicate delivery can never overwrite or reorder
 * committed state.
 */
export function mergeMessages(
  existing: InquiryMessage[],
  incoming: InquiryMessage[]
): InquiryMessage[] {
  const seenIds = new Set(existing.map((m) => m.id));
  const seenSequences = new Set(existing.map((m) => m.sequence));
  const merged = [...existing];

  for (const message of incoming) {
    if (seenIds.has(message.id) || seenSequences.has(message.sequence)) continue;
    seenIds.add(message.id);
    seenSequences.add(message.sequence);
    merged.push(message);
  }

  return merged.sort((a, b) => a.sequence - b.sequence);
}

/** Largest committed sequence currently held (0 when empty) — the REST cursor. */
export function latestSequence(messages: InquiryMessage[]): number {
  let max = 0;
  for (const message of messages) {
    if (message.sequence > max) max = message.sequence;
  }
  return max;
}

/**
 * True when a notification's sequence skips past what we hold, meaning at least
 * one message is missing and a REST catch-up is required. An equal or older
 * sequence is a duplicate/stale hint, not a gap.
 */
export function hasSequenceGap(
  lastKnownSequence: number,
  incomingSequence: number
): boolean {
  return incomingSequence > lastKnownSequence + 1;
}

export interface ThreadPage {
  messages: InquiryMessage[];
  pageInfo: InquiryPageInfo;
}

export interface ThreadState {
  messages: InquiryMessage[];
  cursor: number;
  hasMore: boolean;
}

/**
 * Applies one REST catch-up page. The cursor advances monotonically to the
 * furthest of what we already hold and the page's nextCursor, so repeated or
 * out-of-order pages can never move it backwards.
 */
export function applyThreadPage(
  state: ThreadState,
  page: ThreadPage
): ThreadState {
  const messages = mergeMessages(state.messages, page.messages);
  const cursor = Math.max(
    state.cursor,
    latestSequence(messages),
    page.pageInfo.nextCursor
  );
  return { messages, cursor, hasMore: page.pageInfo.hasMore };
}

/**
 * True when the server still reports more pages but the cursor did not move.
 * Continuing would loop forever re-reading the same page, so the caller stops
 * and surfaces an honest error instead of silently truncating the thread.
 */
export function isCatchUpStalled(
  before: ThreadState,
  after: ThreadState
): boolean {
  return after.hasMore && after.cursor <= before.cursor;
}

export interface EventIdCache {
  /** Records the id; returns false when it was already seen (duplicate). */
  remember(eventId: string): boolean;
  seen(eventId: string): boolean;
  readonly size: number;
}

/**
 * Bounded FIFO cache of Socket.IO eventIds so repeated deliveries are ignored
 * without growing without limit. Oldest ids are evicted past `limit`.
 */
export function createEventIdCache(limit = 200): EventIdCache {
  const order: string[] = [];
  const ids = new Set<string>();

  return {
    remember(eventId: string) {
      if (ids.has(eventId)) return false;
      ids.add(eventId);
      order.push(eventId);
      while (order.length > limit) {
        const oldest = order.shift();
        if (oldest !== undefined) ids.delete(oldest);
      }
      return true;
    },
    seen(eventId: string) {
      return ids.has(eventId);
    },
    get size() {
      return ids.size;
    },
  };
}
