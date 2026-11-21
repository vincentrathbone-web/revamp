/**
 * Peaking-EQ biquad maths (the well-known "Audio EQ Cookbook" formulas by R. Bristow-Johnson).
 * Web Audio's BiquadFilterNode type "peaking" uses the same design, so these functions predict
 * what the live graph does and let us test the EQ without audio hardware.
 */
export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export function peaking(freq: number, q: number, gainDb: number, sampleRate: number): Biquad {
  const A = 10 ** (gainDb / 40);
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha / A;
  return {
    b0: (1 + alpha * A) / a0,
    b1: (-2 * cos) / a0,
    b2: (1 - alpha * A) / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha / A) / a0,
  };
}

/** Magnitude response in dB of one biquad at `freq`. */
export function magnitudeDb(f: Biquad, freq: number, sampleRate: number): number {
  const w = (2 * Math.PI * freq) / sampleRate;
  const c1 = Math.cos(w),
    s1 = Math.sin(w),
    c2 = Math.cos(2 * w),
    s2 = Math.sin(2 * w);
  const nr = f.b0 + f.b1 * c1 + f.b2 * c2,
    ni = -(f.b1 * s1 + f.b2 * s2);
  const dr = 1 + f.a1 * c1 + f.a2 * c2,
    di = -(f.a1 * s1 + f.a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

/** Runs a biquad over a signal (direct form I). Used by tests and the offline renderer. */
export function process(f: Biquad, input: Float32Array): Float32Array {
  const out = new Float32Array(input.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i]!;
    const y = f.b0 * x + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}
