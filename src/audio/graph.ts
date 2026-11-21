/**
 * The sound-processing chain shared by all tracks:
 *   input (transport fades) → preamp → 10 EQ filters → [limiter] → mono → balance → volume → output
 *                                                                          └→ analyser (visualisation, before volume)
 */
import { BAND_SETS, MODE_Q, type EqState, defaultEq } from '../dsp/eq';

export type VolumeCurve = 'linear' | 'db';

export interface ChainSettings {
  eq: EqState;
  volume: number; // 0..1
  balance: number; // -1 (left) .. 1 (right)
  mono: boolean;
  volumeCurve: VolumeCurve;
  /** With the "db" curve, 0 % maps to this many dB below full volume (then silence at the very bottom). */
  volumeRangeDb: number;
  smoothVolume: boolean;
}

export function defaultChain(): ChainSettings {
  return {
    eq: defaultEq(),
    volume: 0.8,
    balance: 0,
    mono: false,
    volumeCurve: 'linear',
    volumeRangeDb: 40,
    smoothVolume: true,
  };
}

export function volumeGain(v: number, curve: VolumeCurve, rangeDb: number): number {
  const x = Math.max(0, Math.min(1, v));
  if (x === 0) return 0;
  if (curve === 'linear') return x;
  return 10 ** ((-rangeDb * (1 - x)) / 20);
}

/** Soft ceiling curve: linear up to -1 dBFS, then bends smoothly towards 0.99 (never above). */
export function limiterCurve(points = 8193): Float32Array {
  const c = new Float32Array(points);
  const knee = 0.891; // -1 dBFS
  const ceil = 0.99;
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (ceil - knee) * Math.tanh((a - knee) / (ceil - knee));
    c[i] = Math.sign(x) * y;
  }
  return c;
}

export class DspChain {
  readonly input: GainNode;
  readonly analyser: AnalyserNode;
  private readonly preamp: GainNode;
  private readonly filters: BiquadFilterNode[];
  private readonly comp: DynamicsCompressorNode;
  private readonly clip: WaveShaperNode;
  private readonly monoNode: GainNode;
  private readonly panner: StereoPannerNode;
  private readonly volumeNode: GainNode;
  private limiterOn: boolean | null = null;
  private monoOn: boolean | null = null;
  settings: ChainSettings;

  constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode,
    settings: ChainSettings = defaultChain(),
  ) {
    this.settings = structuredClone(settings);
    this.input = ctx.createGain();
    this.preamp = ctx.createGain();
    this.filters = BAND_SETS.classic.map(() => {
      const f = ctx.createBiquadFilter();
      f.type = 'peaking';
      return f;
    });
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -1.5;
    this.comp.knee.value = 1;
    this.comp.ratio.value = 20;
    this.comp.attack.value = 0.002;
    this.comp.release.value = 0.2;
    this.clip = ctx.createWaveShaper();
    this.clip.curve = limiterCurve() as Float32Array<ArrayBuffer>;
    this.monoNode = ctx.createGain();
    this.panner = ctx.createStereoPanner();
    this.volumeNode = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0;

    this.input.connect(this.preamp);
    this.preamp.connect(this.filters[0]!);
    for (let i = 0; i < this.filters.length - 1; i++) this.filters[i]!.connect(this.filters[i + 1]!);
    this.comp.connect(this.clip);
    this.panner.connect(this.volumeNode);
    this.panner.connect(this.analyser);
    this.volumeNode.connect(destination);
    this.apply(this.settings, false);
  }

  private get last(): BiquadFilterNode {
    return this.filters[this.filters.length - 1]!;
  }

  /** Applies settings. Gains move smoothly when `ramp` is true (avoids clicks). */
  apply(s: ChainSettings, ramp = true): void {
    this.settings = structuredClone(s);
    const t = this.ctx.currentTime;
    const set = (p: AudioParam, v: number, tc = 0.015) => {
      if (ramp) p.setTargetAtTime(v, t, tc);
      else {
        p.cancelScheduledValues(t);
        p.value = v;
      }
    };
    const eq = s.eq;
    const freqs = BAND_SETS[eq.bandSet];
    this.filters.forEach((f, i) => {
      f.frequency.value = freqs[i]!;
      f.Q.value = MODE_Q[eq.mode];
      set(f.gain, eq.enabled ? (eq.bandsDb[i] ?? 0) : 0);
    });
    set(this.preamp.gain, eq.enabled ? 10 ** (eq.preampDb / 20) : 1);

    if (this.limiterOn !== eq.limiter) {
      this.last.disconnect();
      this.clip.disconnect();
      if (eq.limiter) {
        this.last.connect(this.comp);
        this.clip.connect(this.monoNode);
      } else this.last.connect(this.monoNode);
      this.limiterOn = eq.limiter;
    }
    if (this.monoOn !== s.mono) {
      this.monoNode.disconnect();
      if (s.mono) {
        // A 1-channel node mixes left+right down; the next node spreads it back to both speakers.
        this.monoNode.channelCount = 1;
        this.monoNode.channelCountMode = 'explicit';
        this.monoNode.channelInterpretation = 'speakers';
      } else {
        this.monoNode.channelCount = 2;
        this.monoNode.channelCountMode = 'max';
      }
      this.monoNode.connect(this.panner);
      this.monoOn = s.mono;
    }
    set(this.panner.pan, Math.max(-1, Math.min(1, s.balance)));
    set(
      this.volumeNode.gain,
      volumeGain(s.volume, s.volumeCurve, s.volumeRangeDb),
      s.smoothVolume ? 0.02 : 0.002,
    );
  }

  dispose(): void {
    for (const n of [
      this.input,
      this.preamp,
      ...this.filters,
      this.comp,
      this.clip,
      this.monoNode,
      this.panner,
      this.volumeNode,
      this.analyser,
    ])
      n.disconnect();
  }
}
