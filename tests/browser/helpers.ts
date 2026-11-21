import {
  AudioEngine,
  defaultAudioSettings,
  type AudioSettings,
  type EngineTrack,
} from '../../src/audio/engine';
import { bytesSource, readTrackInfo } from '../../src/audio/tags';

export const ASSETS = '/test-assets/generated/';

export async function fetchBytes(name: string): Promise<ArrayBuffer> {
  const r = await fetch(ASSETS + name);
  if (!r.ok) throw new Error(`missing asset ${name}`);
  return r.arrayBuffer();
}

export async function track(name: string, withInfo = false): Promise<EngineTrack> {
  const bytes = await fetchBytes(name);
  const info = withInfo ? await readTrackInfo(bytesSource(new Uint8Array(bytes))) : undefined;
  return { key: name, load: async () => bytes.slice(0), info };
}

/** Settings that make the chain bit-transparent (no limiter, unity volume, no fades). */
export function transparent(): AudioSettings {
  const s = defaultAudioSettings();
  s.chain.volume = 1;
  s.chain.eq.limiter = false;
  for (const k of Object.keys(s.fades) as (keyof typeof s.fades)[]) s.fades[k].enabled = false;
  return s;
}

export async function render(
  seconds: number,
  setup: (engine: AudioEngine) => Promise<void>,
  settings = transparent(),
  getNext: (t: EngineTrack) => EngineTrack | null = () => null,
  rate = 44100,
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.round(seconds * rate), rate);
  const engine = new AudioEngine(ctx, getNext, settings);
  await setup(engine);
  await engine.idle();
  return ctx.startRendering();
}

export function rms(x: Float32Array, from = 0, to = x.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / Math.max(1, to - from));
}

export function peak(x: Float32Array, from = 0, to = x.length): number {
  let p = 0;
  for (let i = from; i < to; i++) p = Math.max(p, Math.abs(x[i]!));
  return p;
}

export const db = (x: number) => 20 * Math.log10(x);

/** Goertzel power of one frequency. */
export function power(x: Float32Array, freq: number, rate: number, from = 0, to = x.length): number {
  const k = (2 * Math.PI * freq) / rate;
  const c = 2 * Math.cos(k);
  let s1 = 0,
    s2 = 0;
  for (let i = from; i < to; i++) {
    const s = x[i]! + c * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return s1 * s1 + s2 * s2 - c * s1 * s2;
}

/** Lag (in samples) of `b` relative to `a` that best lines them up, searched within ±maxLag. */
export function bestLag(a: Float32Array, b: Float32Array, maxLag: number, from: number, len: number): number {
  let best = 0,
    bestScore = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = from; i < from + len; i += 2) s += a[i]! * (b[i + lag] ?? 0);
    if (s > bestScore) ((bestScore = s), (best = lag));
  }
  return best;
}
