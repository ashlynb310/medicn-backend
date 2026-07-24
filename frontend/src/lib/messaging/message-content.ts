// The backend counts Unicode CODE POINTS (not UTF-16 code units) after trimming
// and rejects anything outside 1–4000. JavaScript's `String.length` counts code
// units, so a single astral character (emoji, some CJK extensions) would be
// counted twice and the UI would disagree with the server. Both the inquiry
// creation form and the thread composer use this helper.

export const MAX_MESSAGE_CODE_POINTS = 4000;

/** Counts Unicode code points — iteration over a string yields code points. */
export function countCodePoints(value: string): number {
  return [...value].length;
}

export interface MessageLengthState {
  trimmed: string;
  length: number;
  remaining: number;
  empty: boolean;
  tooLong: boolean;
  valid: boolean;
}

export function evaluateMessage(raw: string): MessageLengthState {
  const trimmed = raw.trim();
  const length = countCodePoints(trimmed);
  const empty = length === 0;
  const tooLong = length > MAX_MESSAGE_CODE_POINTS;
  return {
    trimmed,
    length,
    remaining: MAX_MESSAGE_CODE_POINTS - length,
    empty,
    tooLong,
    valid: !empty && !tooLong,
  };
}
