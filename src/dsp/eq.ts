import { magnitudeDb, peaking } from './biquad';

/** Band centre frequencies. "classic" matches the classic 10-band layout; "iso" is the ISO octave set. */
export const BAND_SETS = {
  classic: [70, 180, 320, 600, 1000, 3000, 6000, 12000, 14000, 16000],
  iso: [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000],
} as const;
export type BandSet = keyof typeof BAND_SETS;

/** Labels shown under the sliders (classic skins print their own labels in the bitmap). */
export const BAND_LABELS: Record<BandSet, string[]> = {
  classic: ['60', '170', '310', '600', '1K', '3K', '6K', '12K', '14K', '16K'],
  iso: ['31', '63', '125', '250', '500', '1K', '2K', '4K', '8K', '16K'],
};

/**
 * EQ modes. "classic": wide, overlapping bands (smooth, musical curve).
 * "precise": narrower bands so each slider mostly affects its own region.
 */
export type EqMode = 'classic' | 'precise';
export const MODE_Q: Record<EqMode, number> = { classic: 1.0, precise: 2.0 };

export const EQ_MIN_DB = -12;
export const EQ_MAX_DB = 12;

export interface EqState {
  enabled: boolean;
  auto: boolean;
  preampDb: number;
  bandsDb: number[]; // 10 values, -12..+12
  bandSet: BandSet;
  mode: EqMode;
  limiter: boolean;
}

export function defaultEq(): EqState {
  return {
    enabled: true,
    auto: false,
    preampDb: 0,
    bandsDb: Array(10).fill(0),
    bandSet: 'classic',
    mode: 'classic',
    limiter: true,
  };
}

export const clampDb = (v: number) => Math.max(EQ_MIN_DB, Math.min(EQ_MAX_DB, v));

/** Predicted response (dB) of the whole EQ, including preamp, at `freq`. */
export function responseDb(eq: EqState, freq: number, sampleRate = 48000): number {
  if (!eq.enabled) return 0;
  const freqs = BAND_SETS[eq.bandSet];
  const q = MODE_Q[eq.mode];
  let total = eq.preampDb;
  for (let i = 0; i < 10; i++) {
    const g = eq.bandsDb[i] ?? 0;
    if (g !== 0) total += magnitudeDb(peaking(freqs[i]!, q, g, sampleRate), freq, sampleRate);
  }
  return total;
}

export interface Preset {
  name: string;
  preampDb: number;
  bandsDb: number[];
}

/** RevAmp's own built-in presets (classic band layout). */
export const BUILTIN_PRESETS: Preset[] = [
  { name: 'Flat', preampDb: 0, bandsDb: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { name: 'Bass Lift', preampDb: -3, bandsDb: [7, 6, 4, 2, 0, 0, 0, 0, 0, 0] },
  { name: 'Deep Bass', preampDb: -5, bandsDb: [10, 9, 6, 3, 0, -1, -1, 0, 0, 0] },
  { name: 'Treble Lift', preampDb: -3, bandsDb: [0, 0, 0, 0, 0, 1, 3, 5, 6, 6] },
  { name: 'Smile', preampDb: -4, bandsDb: [6, 5, 2, -1, -3, -1, 2, 4, 5, 5] },
  { name: 'Vocal Presence', preampDb: -2, bandsDb: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1] },
  { name: 'Warm', preampDb: -2, bandsDb: [3, 3, 2, 1, 0, -1, -2, -3, -3, -4] },
  { name: 'Bright', preampDb: -2, bandsDb: [-2, -1, 0, 0, 0, 1, 2, 4, 4, 5] },
  { name: 'Late Night', preampDb: 0, bandsDb: [-4, -3, -1, 0, 1, 2, 1, 0, -2, -3] },
  { name: 'Small Speakers', preampDb: -4, bandsDb: [-6, 2, 5, 3, 0, 0, 2, 3, 2, 0] },
  { name: 'Headphones', preampDb: -2, bandsDb: [3, 2, 0, -1, 0, 1, 2, 2, 1, 0] },
  { name: 'Live Room', preampDb: -2, bandsDb: [-2, 0, 2, 3, 3, 3, 2, 1, 1, 1] },
];
