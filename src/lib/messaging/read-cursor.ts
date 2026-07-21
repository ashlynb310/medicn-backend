export interface ReadAckOutcome {
  /** The acknowledged cursor after this response. */
  acked: number;
  /** Whether the acknowledged cursor now covers the requested target. */
  reachedTarget: boolean;
  /**
   * True when a SUCCESSFUL response neither reached the target nor advanced the
   * acknowledged cursor. Re-sending the same target would repeat forever, so the
   * caller stops and shows the non-blocking read-sync error instead.
   */
  stalled: boolean;
}

/**
 * Decides how far the acknowledged read cursor may advance after a successful
 * POST /inquiries/:id/read.
 *
 * The backend clamps the cursor to the committed `lastSequence` and moves it
 * with GREATEST, so ONLY `result.lastReadSequence` is authoritative — the
 * requested target is never treated as acknowledged by itself. The cursor is
 * monotonic: it never moves backwards.
 */
export function resolveReadAck(
  previousAcked: number,
  requestedTarget: number,
  confirmedSequence: number
): ReadAckOutcome {
  const acked = Math.max(previousAcked, confirmedSequence);
  const reachedTarget = acked >= requestedTarget;
  return {
    acked,
    reachedTarget,
    stalled: !reachedTarget && acked <= previousAcked,
  };
}
