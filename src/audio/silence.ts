/**
 * Finds where audible sound starts and ends, for the silence remover.
 * Returns sample indices [start, end) with a small safety margin kept on each side.
 */
export interface TrimPoints {
  start: number;
  end: number;
}

export function findTrim(
  channels: ArrayLike<number>[],
  sampleRate: number,
  thresholdDb = -60,
  marginMs = 5,
): TrimPoints {
  const len = channels[0]?.length ?? 0;
  if (len === 0) return { start: 0, end: 0 };
  const thr = 10 ** (thresholdDb / 20);
  const loud = (i: number) => channels.some((ch) => Math.abs(ch[i]!) > thr);
  let s = 0;
  while (s < len && !loud(s)) s++;
  if (s === len) return { start: 0, end: 0 }; // all silent
  let e = len - 1;
  while (e > s && !loud(e)) e--;
  const margin = Math.round((marginMs / 1000) * sampleRate);
  return { start: Math.max(0, s - margin), end: Math.min(len, e + 1 + margin) };
}
