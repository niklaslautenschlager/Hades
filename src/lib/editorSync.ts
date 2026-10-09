export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** Smallest single replacement that turns `current` into `next`; null when they are equal. */
export function minimalEdit(current: string, next: string): TextEdit | null {
  if (current === next) return null;
  const max = Math.min(current.length, next.length);
  let start = 0;
  while (start < max && current.charCodeAt(start) === next.charCodeAt(start)) start++;
  // Never cut between the halves of a surrogate pair.
  if (start > 0 && isHigh(current.charCodeAt(start - 1)) && isLow(current.charCodeAt(start))) start--;
  let endCur = current.length;
  let endNext = next.length;
  while (endCur > start && endNext > start && current.charCodeAt(endCur - 1) === next.charCodeAt(endNext - 1)) {
    endCur--;
    endNext--;
  }
  if (endCur < current.length && isLow(current.charCodeAt(endCur)) && endCur > 0 && isHigh(current.charCodeAt(endCur - 1))) {
    endCur++;
    endNext++;
  }
  return { from: start, to: endCur, insert: next.slice(start, endNext) };
}

// The editor emits every keystroke into the store, so a `content` prop equal to the
// last emitted text is just our own echo. Anything else came from outside (a sync pull,
// an AI rewrite) and has to reach the open buffer, or the next keystroke would write the
// stale buffer back over it.
export function externalEdit(current: string, next: string, lastEmitted: string): TextEdit | null {
  if (next === lastEmitted) return null;
  return minimalEdit(current, next);
}
