/** Fade curve maths. "linear" ramps the amplitude; "log" ramps in decibels (sounds more even). */
export type FadeShape = 'linear' | 'log';

/** Events that can each have their own fade, like the classic output settings. */
export type FadeEvent = 'start' | 'firstStart' | 'endOfSong' | 'pause' | 'resume' | 'seek' | 'stop';

export interface FadeSetting {
  enabled: boolean;
  ms: number;
}

export type FadeSettings = Record<FadeEvent, FadeSetting>;

export function defaultFades(): FadeSettings {
  return {
    start: { enabled: false, ms: 300 },
    firstStart: { enabled: false, ms: 300 },
    endOfSong: { enabled: false, ms: 1000 },
    pause: { enabled: true, ms: 120 },
    resume: { enabled: true, ms: 120 },
    seek: { enabled: true, ms: 40 },
    stop: { enabled: true, ms: 150 },
  };
}

/** The floor used by log fades: -60 dB is treated as silence. */
export const LOG_FLOOR_DB = -60;

/** Gain at position `t` (0..1) of a fade from `from` to `to` (linear amplitudes). */
export function fadeGain(t: number, from: number, to: number, shape: FadeShape): number {
  const x = Math.max(0, Math.min(1, t));
  if (shape === 'linear') return from + (to - from) * x;
  const toDb = (g: number) => (g <= 0 ? LOG_FLOOR_DB : Math.max(LOG_FLOOR_DB, 20 * Math.log10(g)));
  const db = toDb(from) + (toDb(to) - toDb(from)) * x;
  if (x === 1 && to === 0) return 0;
  if (x === 0 && from === 0) return 0;
  return 10 ** (db / 20);
}

/** A sampled curve for AudioParam.setValueCurveAtTime. */
export function fadeCurve(points: number, from: number, to: number, shape: FadeShape): Float32Array {
  const n = Math.max(2, points);
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = fadeGain(i / (n - 1), from, to, shape);
  return c;
}
