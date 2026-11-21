/** Classic-style visualisation: spectrum analyser and oscilloscope drawn with the skin's vis colours. */
import type { Skin } from '../skin/skin';
import type { Surface } from '../skin/surface';

export type VisMode = 'spectrum' | 'scope' | 'off';
export type AnalyzerStyle = 'normal' | 'fire' | 'line';
export type ScopeStyle = 'dots' | 'lines' | 'solid';

export interface VisSettings {
  mode: VisMode;
  analyzerStyle: AnalyzerStyle;
  scopeStyle: ScopeStyle;
  bands: 'thick' | 'thin';
  peaks: boolean;
  /** Bar fall speed 1 (slowest) .. 5 (fastest). */
  falloff: number;
  peakFalloff: number;
  fps: number;
}

export function defaultVis(): VisSettings {
  return {
    mode: 'spectrum',
    analyzerStyle: 'normal',
    scopeStyle: 'lines',
    bands: 'thick',
    peaks: true,
    falloff: 3,
    peakFalloff: 2,
    fps: 30,
  };
}

/**
 * Maps FFT magnitudes (0..255, linear bins up to Nyquist) to `n` bars on a log frequency scale.
 * Returns heights 0..1.
 */
export function computeBars(
  freq: ArrayLike<number>,
  sampleRate: number,
  n: number,
  lo = 40,
  hi = 16000,
): number[] {
  const bins = freq.length;
  const nyq = sampleRate / 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const f0 = lo * (hi / lo) ** (i / n),
      f1 = lo * (hi / lo) ** ((i + 1) / n);
    let b0 = Math.floor((f0 / nyq) * bins),
      b1 = Math.max(b0 + 1, Math.ceil((f1 / nyq) * bins));
    b0 = Math.min(bins - 1, b0);
    b1 = Math.min(bins, b1);
    let m = 0;
    for (let b = b0; b < b1; b++) m = Math.max(m, freq[b]!);
    out.push(m / 255);
  }
  return out;
}

export class Visualizer {
  private bars: number[] = [];
  private peaks: number[] = [];
  private peakHold: number[] = [];
  private freq = new Uint8Array(0);
  private wave = new Uint8Array(0);
  settings: VisSettings = defaultVis();

  /** Pulls fresh data from the analyser and applies falloff. */
  update(analyser: AnalyserNode | null, playing: boolean, columns: number): void {
    if (this.bars.length !== columns) {
      this.bars = Array(columns).fill(0);
      this.peaks = Array(columns).fill(0);
      this.peakHold = Array(columns).fill(0);
    }
    let target: number[] = Array(columns).fill(0);
    if (analyser && playing) {
      if (this.freq.length !== analyser.frequencyBinCount)
        this.freq = new Uint8Array(analyser.frequencyBinCount);
      if (this.wave.length !== analyser.fftSize) this.wave = new Uint8Array(analyser.fftSize);
      analyser.getByteFrequencyData(this.freq);
      analyser.getByteTimeDomainData(this.wave);
      target = computeBars(this.freq, analyser.context.sampleRate, columns);
    } else this.wave.fill(128);
    const fall = 0.02 + this.settings.falloff * 0.015;
    const pfall = 0.005 + this.settings.peakFalloff * 0.006;
    for (let i = 0; i < columns; i++) {
      this.bars[i] = Math.max(target[i]!, this.bars[i]! - fall);
      if (this.bars[i]! >= this.peaks[i]!) {
        this.peaks[i] = this.bars[i]!;
        this.peakHold[i] = 8;
      } else if (this.peakHold[i]! > 0) this.peakHold[i]!--;
      else this.peaks[i] = Math.max(0, this.peaks[i]! - pfall);
    }
  }

  /** True while bars or peaks are still falling. */
  get active(): boolean {
    return this.bars.some((b) => b > 0) || this.peaks.some((p) => p > 0);
  }

  draw(s: Surface, skin: Skin, x: number, y: number, w: number, h: number): void {
    const v = skin.vis;
    // background with the classic dotted grid
    s.fill(x, y, w, h, v[0]!);
    for (let yy = 1; yy < h; yy += 2) for (let xx = 1; xx < w; xx += 2) s.pixel(x + xx, y + yy, v[1]!);
    const st = this.settings;
    if (st.mode === 'off') return;
    if (st.mode === 'scope') return this.drawScope(s, skin, x, y, w, h);
    const thick = st.bands === 'thick';
    const cols = thick ? Math.floor((w + 1) / 4) : w;
    if (this.bars.length !== cols) return;
    for (let i = 0; i < cols; i++) {
      const bh = Math.round(this.bars[i]! * h);
      const bx = thick ? x + i * 4 : x + i;
      const bw = thick ? 3 : 1;
      for (let r = 0; r < bh; r++) {
        const row = h - 1 - r; // 0 = top
        let ci: number;
        if (st.analyzerStyle === 'fire')
          ci = 2 + Math.min(15, Math.round(((bh - 1 - r) * 15) / Math.max(1, h - 1)));
        else if (st.analyzerStyle === 'line')
          ci = 2 + Math.min(15, Math.round(((h - bh) * 15) / Math.max(1, h - 1)));
        else ci = 2 + Math.min(15, Math.round((row * 15) / Math.max(1, h - 1)));
        s.fill(bx, y + row, bw, 1, v[ci]!);
      }
      if (st.peaks) {
        const ph = Math.round(this.peaks[i]! * h);
        if (ph > 0) s.fill(bx, y + h - ph, bw, 1, v[23]!);
      }
    }
  }

  private drawScope(s: Surface, skin: Skin, x: number, y: number, w: number, h: number): void {
    const v = skin.vis;
    const n = this.wave.length;
    const st = this.settings.scopeStyle;
    let prev = -1;
    const mid = Math.floor(h / 2);
    for (let i = 0; i < w; i++) {
      const sample = n ? (this.wave[Math.floor((i / w) * n)]! - 128) / 128 : 0;
      const yy = Math.max(0, Math.min(h - 1, Math.round(mid - sample * (h / 2))));
      const color = v[18 + Math.min(4, Math.round((Math.abs(yy - mid) / Math.max(1, mid)) * 4))]!;
      if (st === 'dots' || prev < 0) s.pixel(x + i, y + yy, color);
      else if (st === 'lines') {
        const a = Math.min(prev, yy),
          b = Math.max(prev, yy);
        s.fill(x + i, y + a, 1, b - a + 1, color);
      } else {
        const a = Math.min(mid, yy),
          b = Math.max(mid, yy);
        s.fill(x + i, y + a, 1, b - a + 1, color);
      }
      prev = yy;
    }
  }
}
