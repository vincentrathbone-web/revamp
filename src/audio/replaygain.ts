/** ReplayGain: volume levelling from tags written by taggers/rippers. */
export interface ReplayGainTags {
  trackGain?: number; // dB
  trackPeak?: number; // linear
  albumGain?: number;
  albumPeak?: number;
}

export interface ReplayGainSettings {
  enabled: boolean;
  source: 'track' | 'album';
  /** Use the other kind of gain if the preferred one is missing. */
  fallbackToOther: boolean;
  /** Applied when a file has no ReplayGain tags at all (dB). */
  noTagGainDb: number;
  /** Added to every tagged gain (dB). */
  preampDb: number;
  /** Lower the gain if the tagged peak would clip. */
  preventClipping: boolean;
}

export function defaultReplayGain(): ReplayGainSettings {
  return {
    enabled: false,
    source: 'track',
    fallbackToOther: true,
    noTagGainDb: -6,
    preampDb: 0,
    preventClipping: true,
  };
}

/** Linear gain multiplier to apply to a track. */
export function replayGainFactor(tags: ReplayGainTags | undefined, s: ReplayGainSettings): number {
  if (!s.enabled) return 1;
  const t = tags ?? {};
  const pref = s.source === 'track' ? [t.trackGain, t.trackPeak] : [t.albumGain, t.albumPeak];
  const other = s.source === 'track' ? [t.albumGain, t.albumPeak] : [t.trackGain, t.trackPeak];
  let [gain, peak] = pref;
  if (gain === undefined && s.fallbackToOther) [gain, peak] = other;
  if (gain === undefined) return 10 ** (s.noTagGainDb / 20);
  let factor = 10 ** ((gain + s.preampDb) / 20);
  if (s.preventClipping && peak !== undefined && peak > 0 && factor * peak > 1) factor = 1 / peak;
  return factor;
}

/** Parses tag text such as "-7.32 dB" or "+1.5dB" or "0.988". */
export function parseGainText(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = /[-+]?\d*[.,]?\d+(?:e[-+]?\d+)?/i.exec(v);
  if (!m) return undefined;
  const n = Number(m[0].replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}
