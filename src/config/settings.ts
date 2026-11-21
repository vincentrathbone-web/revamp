/** Persisted settings with versioned migrations. */
import { defaultAudioSettings, type AudioSettings } from '../audio/engine';
import type { Preset } from '../dsp/eq';
import { defaultVis, type VisSettings } from '../ui/vis';

export const SETTINGS_VERSION = 2;

export interface UiSettings {
  positions: Record<'main' | 'eq' | 'pl', { x: number; y: number }>;
  eqVisible: boolean;
  plVisible: boolean;
  shade: Record<'main' | 'eq' | 'pl', boolean>;
  doubleSize: boolean;
  doubleSizeEq: boolean;
  alwaysOnTop: boolean;
  timeRemaining: boolean;
  plSize: { w: number; h: number };
  vis: VisSettings;
  snap: boolean;
  snapDistance: number;
  scrollTitle: boolean;
  skinCursors: boolean;
  /** Skin to load at start: null = default, otherwise a URL or path. */
  skin: string | null;
  titleFormat: 'artist-title' | 'title' | 'filename';
  showNumbers: boolean;
  outputDevice: string;
}

export interface Settings {
  version: number;
  audio: AudioSettings;
  ui: UiSettings;
  userPresets: Preset[];
  repeat: 'off' | 'all' | 'one';
  shuffle: boolean;
  /** Playlist locations remembered between runs (paths/URLs; browser files can't be reopened). */
  playlist: { location: string; title?: string; durationSec?: number }[];
  playlistIndex: number;
  resumePosition: number;
}

export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    audio: defaultAudioSettings(),
    ui: {
      positions: { main: { x: 40, y: 40 }, eq: { x: 40, y: 156 }, pl: { x: 40, y: 272 } },
      eqVisible: true,
      plVisible: true,
      shade: { main: false, eq: false, pl: false },
      doubleSize: false,
      doubleSizeEq: true,
      alwaysOnTop: false,
      timeRemaining: false,
      plSize: { w: 275, h: 232 },
      vis: defaultVis(),
      snap: true,
      snapDistance: 10,
      scrollTitle: true,
      skinCursors: true,
      skin: null,
      titleFormat: 'artist-title',
      showNumbers: true,
      outputDevice: '',
    },
    userPresets: [],
    repeat: 'off',
    shuffle: false,
    playlist: [],
    playlistIndex: -1,
    resumePosition: 0,
  };
}

/** Deep-merges saved data over defaults, so new settings get default values. */
function merge<T>(base: T, saved: unknown): T {
  // optional values (default null): keep whatever was saved
  if (base === null) return (saved === undefined ? null : saved) as T;
  if (Array.isArray(base)) return (Array.isArray(saved) ? saved : base) as T;
  if (base && typeof base === 'object') {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    if (saved && typeof saved === 'object')
      for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
        out[k] = k in out ? merge(out[k], v) : v;
      }
    return out as T;
  }
  return (saved === undefined || typeof saved !== typeof base ? base : saved) as T;
}

/** Migrations from older versions (each takes the raw object of version n and returns version n+1). */
const MIGRATIONS: Record<number, (s: Record<string, unknown>) => Record<string, unknown>> = {
  1: (s) => {
    // v1 stored volume at the top level
    const out = { ...s, version: 2 } as Record<string, unknown>;
    if (typeof s['volume'] === 'number') {
      const audio = (out['audio'] ??= {}) as Record<string, unknown>;
      const chain = (audio['chain'] ??= {}) as Record<string, unknown>;
      chain['volume'] = s['volume'];
      delete out['volume'];
    }
    return out;
  },
};

export function loadSettings(raw: string | null): Settings {
  const def = defaultSettings();
  if (!raw) return def;
  try {
    let obj = JSON.parse(raw) as Record<string, unknown>;
    let v = typeof obj['version'] === 'number' ? (obj['version'] as number) : 1;
    while (v < SETTINGS_VERSION && MIGRATIONS[v]) {
      obj = MIGRATIONS[v]!(obj);
      v++;
    }
    const s = merge(def, obj);
    s.version = SETTINGS_VERSION;
    return s;
  } catch {
    return def;
  }
}

export function saveSettings(s: Settings): string {
  return JSON.stringify(s);
}
