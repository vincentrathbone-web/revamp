/**
 * Parts for RevAmp's hi-fi skins: materials (brushed metal, wood, plastic...), fonts, buttons, knobs, screws,
 * LEDs, display wells and seven-segment digits. Original designs, drawn with the SDF canvas.
 */
import { FONT_3X5 } from '../default-skin';
import {
  Canvas,
  bevel,
  circle,
  clamp01,
  fbm,
  hash,
  mix,
  noise,
  poly,
  rrect,
  scale,
  shade,
  type Material,
  type RGB,
  type Sdf,
} from './canvas';

// ------------------------------------------------------------------ materials
/** Brushed metal: fine horizontal streaks. */
export const brushed =
  (base: RGB, amount = 0.14, seed = 1): Material =>
  (x, y) => {
    const v =
      noise(x * 0.025, y * 1.7, seed) * 0.55 +
      noise(x * 0.4, y * 3.1, seed + 3) * 0.2 +
      hash(x, y, seed) * 0.25;
    return scale(base, 1 + (v - 0.5) * amount * 2);
  };

/** Brushed metal with a vertical light falloff (top brighter), like a lit faceplate. */
export const faceplate =
  (base: RGB, amount = 0.12, light = 0.12, h = 116, seed = 1): Material =>
  (x, y) =>
    shade(brushed(base, amount, seed)(x, y), light * (0.5 - y / h) * 2);

/** Wood grain. */
export const wood =
  (base: RGB, seed = 2): Material =>
  (x, y) => {
    const warp = fbm(x * 0.01, y * 0.08, 3, seed) * 6;
    const ring = Math.sin((y + warp * 4) * 0.9 + fbm(x * 0.03, y * 0.2, 2, seed + 5) * 4);
    const fine = hash(x >> 1, y, seed) - 0.5;
    return scale(base, 1 + ring * 0.1 + fine * 0.06 + (fbm(x * 0.05, y * 0.05, 2, seed + 9) - 0.5) * 0.2);
  };

/** Matte plastic with a faint grain and a soft vertical gradient. */
export const plastic =
  (top: RGB, bottom: RGB, h = 116, grain = 0.03, seed = 3): Material =>
  (x, y) =>
    scale(mix(top, bottom, clamp01(y / h)), 1 + (hash(x, y, seed) - 0.5) * grain);

/** Glossy plastic: a bright band near the top, then a darker body. */
export const gloss =
  (base: RGB, y0: number, h: number, strength = 0.35): Material =>
  (_x, y) => {
    const t = (y - y0) / h;
    const band =
      t < 0.42 ? strength * (1 - t / 0.42) * 0.9 + strength * 0.15 : -strength * 0.25 * ((t - 0.42) / 0.58);
    return shade(base, band);
  };

/** Anodized aluminium: fine sparkle. */
export const anodized =
  (base: RGB, amount = 0.06, seed = 4): Material =>
  (x, y) =>
    scale(base, 1 + (hash(x, y, seed) - 0.5) * amount + (noise(x * 0.1, y * 0.1, seed) - 0.5) * amount);

/** Carbon fibre weave. */
export const carbon =
  (base: RGB): Material =>
  (x, y) => {
    const cell = ((x >> 1) + (y >> 1)) & 1;
    const t = cell ? (x & 1) * 0.5 + 0.2 : (y & 1) * 0.5 + 0.2;
    return scale(base, 0.8 + t * 0.4);
  };

/** Liquid metal: a lit height field from noise (organic, chrome-like). */
export const liquid =
  (dark: RGB, light: RGB, tint: RGB, scaleXY = 0.045, seed = 6): Material =>
  (x, y) => {
    // ridged noise = rounded tubes and folds; lit like polished metal
    const h = (a: number, b: number) => {
      const r = 1 - Math.abs(fbm(a * scaleXY, b * scaleXY, 3, seed) * 2 - 1);
      return r * r;
    };
    const k = 26;
    const dx = (h(x + 1, y) - h(x - 1, y)) * k,
      dy = (h(x, y + 1) - h(x, y - 1)) * k;
    const n = Math.hypot(dx, dy, 1);
    const [nx, ny, nz] = [-dx / n, -dy / n, 1 / n];
    const diff = clamp01(nx * -0.5 + ny * -0.68 + nz * 0.53);
    // half vector between the light and the viewer
    const spec = Math.pow(clamp01(nx * -0.27 + ny * -0.37 + nz * 0.89), 30);
    const ht = h(x, y);
    let c = mix(dark, light, diff * 0.85 + ht * 0.15);
    c = mix(c, tint, clamp01(0.55 - ht) * 0.7);
    return shade(c, spec * 0.75);
  };

// ------------------------------------------------------------------ fonts
/** 5x7 pixel font (original glyph designs). */
const FONT_5X7: Record<string, string> = {
  A: '01110100011000111111100011000110001',
  B: '11110100011000111110100011000111110',
  C: '01110100011000010000100001000101110',
  D: '11110100011000110001100011000111110',
  E: '11111100001000011110100001000011111',
  F: '11111100001000011110100001000010000',
  G: '01110100011000010111100011000101111',
  H: '10001100011000111111100011000110001',
  I: '01110001000010000100001000010001110',
  J: '00111000100001000010000101001001100',
  K: '10001100101010011000101001001010001',
  L: '10000100001000010000100001000011111',
  M: '10001110111010110101100011000110001',
  N: '10001100011100110101100111000110001',
  O: '01110100011000110001100011000101110',
  P: '11110100011000111110100001000010000',
  Q: '01110100011000110001101011001001101',
  R: '11110100011000111110101001001010001',
  S: '01111100001000001110000010000111110',
  T: '11111001000010000100001000010000100',
  U: '10001100011000110001100011000101110',
  V: '10001100011000110001100010101000100',
  W: '10001100011000110101101011010101010',
  X: '10001100010101000100010101000110001',
  Y: '10001100010101000100001000010000100',
  Z: '11111000010001000100010001000011111',
  '0': '01110100011001110101110011000101110',
  '1': '00100011000010000100001000010001110',
  '2': '01110100010000100010001000100011111',
  '3': '11111000100010000010000011000101110',
  '4': '00010001100101010010111110001000010',
  '5': '11111100001111000001000011000101110',
  '6': '00110010001000011110100011000101110',
  '7': '11111000010001000100010000100001000',
  '8': '01110100011000101110100011000101110',
  '9': '01110100011000101111000010001001100',
  '-': '00000000000000011111000000000000000',
  '.': '00000000000000000000000000110001100',
  '/': '00001000100001000100010001000010000',
  '+': '00000001000010011111001000010000000',
  ':': '00000011000110000000011000110000000',
  '&': '01100100101010001000101011001001101',
  "'": '00100001000000000000000000000000000',
  ' ': '00000000000000000000000000000000000',
};

export type FontName = '5x7' | '3x5';
const fontInfo = (f: FontName) => (f === '5x7' ? { w: 5, h: 7, g: FONT_5X7 } : { w: 3, h: 5, g: FONT_3X5 });

export interface TextStyle {
  font?: FontName;
  /** Extra pixels between letters. */
  spacing?: number;
  bold?: boolean;
  /** Printed look: a 1px highlight below (engraved) or shadow below (raised). */
  under?: { c: RGB; a: number };
}

export function textWidth(s: string, st: TextStyle = {}): number {
  const f = fontInfo(st.font ?? '3x5');
  const n = [...s].length;
  return n * (f.w + (st.bold ? 1 : 0)) + Math.max(0, n - 1) * (st.spacing ?? 1);
}

export function text(
  c: Canvas,
  s: string,
  x: number,
  y: number,
  col: RGB,
  st: TextStyle = {},
  a = 1,
): number {
  const f = fontInfo(st.font ?? '3x5');
  const sp = st.spacing ?? 1;
  const adv = f.w + (st.bold ? 1 : 0) + sp;
  const draw = (dx: number, dy: number, cc: RGB, aa: number) => {
    let cx = x;
    for (const ch of s) {
      const g = f.g[ch.toUpperCase()] ?? f.g[' ']!;
      for (let j = 0; j < f.h; j++)
        for (let i = 0; i < f.w; i++)
          if (g[j * f.w + i] === '1') {
            c.set(cx + i + dx, y + j + dy, cc, aa);
            if (st.bold) c.set(cx + i + 1 + dx, y + j + dy, cc, aa);
          }
      cx += adv;
    }
  };
  if (st.under) draw(0, 1, st.under.c, st.under.a);
  draw(0, 0, col, a);
  return textWidth(s, st);
}

export function textCentered(
  c: Canvas,
  s: string,
  cx: number,
  y: number,
  col: RGB,
  st: TextStyle = {},
  a = 1,
): void {
  text(c, s, Math.round(cx - textWidth(s, st) / 2), y, col, st, a);
}

// ------------------------------------------------------------------ parts
const box = (x: number, y: number, w: number, h: number): [number, number, number, number] => [
  x,
  y,
  x + w,
  y + h,
];

/** A raised or sunken panel with lit edges. */
export function panel(
  c: Canvas,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  m: Material,
  opts: { bevel?: number; light?: number; sunken?: boolean; outline?: RGB } = {},
): Sdf {
  const f = rrect(x, y, w, h, r);
  const bw = opts.bevel ?? 1.5,
    k = (opts.light ?? 0.45) * (opts.sunken ? -1 : 1);
  c.shape(f, box(x, y, w, h), (px, py, d) => {
    const base = m(Math.floor(px), Math.floor(py));
    const l = bevel(f, px, py, d, bw) * k;
    const col = shade(base, l);
    return opts.outline && d > -1 ? mix(col, opts.outline, clamp01(1 + d)) : col;
  });
  return f;
}

/** Drop shadow under a shape. */
export function dropShadow(
  c: Canvas,
  f: Sdf,
  b: [number, number, number, number],
  dy = 1,
  opacity = 0.45,
  r = 2,
): void {
  c.halo((x, y) => f(x, y - dy), [b[0], b[1] + dy, b[2], b[3] + dy], [0, 0, 0], r, opacity);
}

/** A display window: dark bezel ring, flat glass, inner shadow along the top and left. */
export function displayWell(
  c: Canvas,
  f: Sdf,
  b: [number, number, number, number],
  bg: RGB,
  opts: { bezel?: RGB; ring?: number; inner?: number; sheen?: number } = {},
): void {
  const ring = opts.ring ?? 1.5;
  const bez = opts.bezel ?? shade(bg, -0.5);
  // bezel: a lip just outside the glass, lit on the bottom edge (sunken)
  c.shape(
    (x, y) => f(x, y) - ring,
    [b[0] - ring, b[1] - ring, b[2] + ring, b[3] + ring],
    (px, py, d) => shade(bez, -bevel((x, y) => f(x, y) - ring, px, py, d, ring + 0.5) * 0.6),
  );
  const inner = opts.inner ?? 0.5;
  c.shape(f, b, (px, py, d) => {
    // inner shadow: darker within 3 px of the top/left edge
    const [nx, ny] = [f(px + 0.5, py) - f(px - 0.5, py), f(px, py + 0.5) - f(px, py - 0.5)];
    const top = clamp01(1 + d / 3) * clamp01(-(nx * -0.55 + ny * -0.83));
    return shade(bg, -top * inner);
  });
  if (opts.sheen)
    c.shape(
      f,
      b,
      (px, py) => {
        void px;
        return shade(bg, opts.sheen! * clamp01(1 - (py - b[1]) / ((b[3] - b[1]) * 0.45)));
      },
      1,
    );
}

export function screw(c: Canvas, cx: number, cy: number, r: number, metal: RGB, angle = 0.7): void {
  const f = circle(cx, cy, r);
  c.halo(circle(cx, cy + 0.6, r), box(cx - r, cy - r, 2 * r, 2 * r), [0, 0, 0], 1.2, 0.5);
  c.shape(f, box(cx - r, cy - r, 2 * r, 2 * r), (px, py, d) => {
    const t = clamp01((((px - cx) * -0.55 + (py - cy) * -0.83) / r) * 0.5 + 0.5);
    return shade(mix(shade(metal, -0.35), shade(metal, 0.35), t), bevel(f, px, py, d, 1) * 0.3);
  });
  const ca = Math.cos(angle),
    sa = Math.sin(angle);
  const slot = poly([
    [cx - ca * r * 0.8 - sa * 0.45, cy - sa * r * 0.8 + ca * 0.45],
    [cx + ca * r * 0.8 - sa * 0.45, cy + sa * r * 0.8 + ca * 0.45],
    [cx + ca * r * 0.8 + sa * 0.45, cy + sa * r * 0.8 - ca * 0.45],
    [cx - ca * r * 0.8 + sa * 0.45, cy - sa * r * 0.8 - ca * 0.45],
  ]);
  c.shape(slot, box(cx - r, cy - r, 2 * r, 2 * r), () => shade(metal, -0.6), 0.85);
}

export function led(c: Canvas, cx: number, cy: number, r: number, col: RGB, on: boolean): void {
  if (on) c.halo(circle(cx, cy, r), box(cx - r, cy - r, 2 * r, 2 * r), col, r * 2.2, 0.35);
  const base = on ? col : mix(scale(col, 0.25), [20, 20, 20], 0.4);
  const f = circle(cx, cy, r);
  c.shape(f, box(cx - r, cy - r, 2 * r, 2 * r), (px, py) => {
    const hl = clamp01(1 - Math.hypot(px - (cx - r * 0.35), py - (cy - r * 0.4)) / (r * 0.8));
    return shade(base, hl * (on ? 0.7 : 0.35));
  });
}

/** A rotary knob with a knurled rim and a pointer line. */
export function knob(
  c: Canvas,
  cx: number,
  cy: number,
  r: number,
  opts: { body: RGB; cap?: RGB; mark: RGB; angle?: number; ridges?: number; skirt?: RGB },
): void {
  const ang = opts.angle ?? -2.2;
  if (opts.skirt) {
    const s = circle(cx, cy, r + 1.5);
    c.shape(s, box(cx - r - 2, cy - r - 2, 2 * r + 4, 2 * r + 4), (px, py, d) =>
      shade(opts.skirt!, bevel(s, px, py, d, 1.2) * 0.5),
    );
  }
  c.halo(circle(cx + 0.5, cy + 1.2, r), box(cx - r, cy - r, 2 * r, 2 * r), [0, 0, 0], 2, 0.5);
  const f = circle(cx, cy, r);
  const ridges = opts.ridges ?? 28;
  c.shape(f, box(cx - r, cy - r, 2 * r, 2 * r), (px, py, d) => {
    const a = Math.atan2(py - cy, px - cx);
    const rim = d > -2 ? 0.12 * Math.sin(a * ridges) : 0;
    const lin = ((px - cx) * -0.55 + (py - cy) * -0.83) / r;
    return shade(opts.body, lin * 0.35 + rim + bevel(f, px, py, d, 1.6) * 0.3);
  });
  const capR = r * 0.72;
  const cap = circle(cx, cy, capR);
  const capCol = opts.cap ?? opts.body;
  c.shape(cap, box(cx - capR, cy - capR, 2 * capR, 2 * capR), (px, py, d) => {
    // concentric machining rings + a conical light sweep
    const rr = Math.hypot(px - cx, py - cy);
    const a = Math.atan2(py - cy, px - cx);
    const sweep = Math.cos(2 * (a + 2.2)) * 0.18;
    return shade(capCol, sweep + Math.sin(rr * 3.1) * 0.03 + bevel(cap, px, py, d, 1) * -0.25);
  });
  const mx = Math.cos(ang),
    my = Math.sin(ang);
  const m = poly([
    [cx + mx * capR * 0.25 - my * 0.6, cy + my * capR * 0.25 + mx * 0.6],
    [cx + mx * (capR - 0.6) - my * 0.6, cy + my * (capR - 0.6) + mx * 0.6],
    [cx + mx * (capR - 0.6) + my * 0.6, cy + my * (capR - 0.6) - mx * 0.6],
    [cx + mx * capR * 0.25 + my * 0.6, cy + my * capR * 0.25 - mx * 0.6],
  ]);
  c.shape(m, box(cx - r, cy - r, 2 * r, 2 * r), () => opts.mark);
}

/** Slotted vents. */
export function vents(
  c: Canvas,
  x: number,
  y: number,
  w: number,
  h: number,
  n: number,
  dark: RGB,
  lip: RGB,
): void {
  const gap = w / n;
  for (let i = 0; i < n; i++) {
    const sx = x + i * gap + gap / 2 - 1;
    const f = rrect(sx, y, 2, h, 1);
    c.shape(f, box(sx, y, 2, h), () => dark);
    c.shape(rrect(sx, y + h - 0.5, 2, 1, 0.5), box(sx, y + h - 1, 2, 2), () => lip, 0.5);
  }
}

/** Speaker grille: a grid of round holes. */
export function grille(
  c: Canvas,
  x: number,
  y: number,
  w: number,
  h: number,
  pitch: number,
  hole: RGB,
): void {
  for (let j = 0; j * pitch < h; j++)
    for (let i = 0; i * pitch < w; i++) {
      const cx = x + i * pitch + (j & 1 ? pitch / 2 : 0) + pitch / 2,
        cy = y + j * pitch + pitch / 2;
      if (cx > x + w - 0.5) continue;
      c.shape(circle(cx, cy, pitch * 0.3), box(cx - 2, cy - 2, 4, 4), () => hole, 0.9);
    }
}

// ------------------------------------------------------------------ icons (transport)
export type Icon =
  'prev' | 'play' | 'pause' | 'stop' | 'next' | 'eject' | 'close' | 'min' | 'shade' | 'unshade' | 'menu';

/** Icon shapes centred on (cx, cy); `s` is the scale (1 = icons for 23x18 buttons). */
export function iconSdf(icon: Icon, cx: number, cy: number, s = 1): Sdf {
  const P = (pts: [number, number][]) =>
    poly(pts.map(([x, y]) => [cx + x * s, cy + y * s] as [number, number]));
  const R = (x: number, y: number, w: number, h: number) => rrect(cx + x * s, cy + y * s, w * s, h * s, 0.3);
  const U =
    (...fs: Sdf[]) =>
    (x: number, y: number) =>
      Math.min(...fs.map((f) => f(x, y)));
  switch (icon) {
    case 'play':
      return P([
        [-2.5, -4],
        [4, 0],
        [-2.5, 4],
      ]);
    case 'pause':
      return U(R(-3.5, -3.5, 2.6, 7), R(0.9, -3.5, 2.6, 7));
    case 'stop':
      return R(-3.5, -3.5, 7, 7);
    case 'prev':
      return U(
        R(-5, -3.5, 1.6, 7),
        P([
          [-3.4, 0],
          [1, -3.5],
          [1, 3.5],
        ]),
        P([
          [0.8, 0],
          [5.2, -3.5],
          [5.2, 3.5],
        ]),
      );
    case 'next':
      return U(
        R(3.4, -3.5, 1.6, 7),
        P([
          [3.4, 0],
          [-1, -3.5],
          [-1, 3.5],
        ]),
        P([
          [-0.8, 0],
          [-5.2, -3.5],
          [-5.2, 3.5],
        ]),
      );
    case 'eject':
      return U(
        P([
          [-4, 0.5],
          [0, -3.8],
          [4, 0.5],
        ]),
        R(-4, 2, 8, 1.7),
      );
    case 'close':
      return U(
        P([
          [-2.6, -2],
          [-2, -2.6],
          [2.6, 2],
          [2, 2.6],
        ]),
        P([
          [2, -2.6],
          [2.6, -2],
          [-2, 2.6],
          [-2.6, 2],
        ]),
      );
    case 'min':
      return R(-2.5, 1.2, 5, 1.3);
    case 'shade':
      return U(R(-2.5, -2.2, 5, 1.2), R(-2.5, 0.4, 5, 1.2));
    case 'unshade':
      return (x, y) => Math.max(R(-2.5, -2.5, 5, 5)(x, y), -R(-1.4, -1.2, 2.8, 2.6)(x, y));
    case 'menu':
      return U(R(-2.5, -2.2, 5, 1), R(-2.5, -0.5, 5, 1), R(-2.5, 1.2, 5, 1));
  }
}

export function drawIcon(
  c: Canvas,
  icon: Icon,
  cx: number,
  cy: number,
  col: RGB,
  s = 1,
  opts: { glow?: RGB; engrave?: RGB } = {},
): void {
  const f = iconSdf(icon, cx, cy, s);
  const b: [number, number, number, number] = [cx - 7 * s, cy - 6 * s, cx + 7 * s, cy + 6 * s];
  if (opts.glow) c.halo(f, b, opts.glow, 2.5, 0.45);
  if (opts.engrave)
    c.shape(
      (x, y) => f(x, y - 0.8),
      b,
      () => opts.engrave!,
      0.55,
    );
  c.shape(f, b, () => col);
}

// ------------------------------------------------------------------ seven-segment digits
/** Segment cells inside a 9x13 digit (a top, b top-left, c top-right, d middle, e bottom-left, f bottom-right, g bottom). */
const SEG = {
  a: [2, 0, 4, 2],
  b: [0, 2, 2, 4],
  c: [6, 2, 2, 4],
  d: [2, 6, 4, 1],
  e: [0, 7, 2, 4],
  f: [6, 7, 2, 4],
  g: [2, 11, 4, 2],
} as const;
const DIGIT_SEGS = ['abcefg', 'cf', 'acdeg', 'acdfg', 'bcdf', 'abdfg', 'abdefg', 'acf', 'abcdefg', 'abcdfg'];

/**
 * Draws a digit (0-9, 'blank' = all segments unlit, 'minus') in a 9x13 cell at (x, y).
 * `slant` shifts the upper rows right (italic, like VFD/LCD displays).
 */
export function segDigit(
  c: Canvas,
  x: number,
  y: number,
  d: number | 'blank' | 'minus',
  on: RGB,
  ghost: RGB | null,
  opts: { slant?: boolean; glow?: number } = {},
): void {
  const lit = d === 'blank' ? '' : d === 'minus' ? 'd' : DIGIT_SEGS[d]!;
  const sh = (row: number) => (opts.slant ? (row < 5 ? 1 : row < 9 ? 0.5 : 0) : 0);
  const paint = (segs: string, col: RGB, a: number) => {
    for (const k of segs) {
      const [sx, sy, w, h] = SEG[k as keyof typeof SEG];
      for (let j = 0; j < h; j++) {
        const s = sh(sy + j);
        for (let i = 0; i < w; i++) {
          const fx = sx + i + s;
          const ix = Math.floor(fx),
            frac = fx - ix;
          c.set(x + ix, y + sy + j, col, a * (1 - frac));
          if (frac > 0) c.set(x + ix + 1, y + sy + j, col, a * frac);
        }
      }
    }
  };
  if (ghost)
    paint(
      'abcdefg'
        .split('')
        .filter((k) => !lit.includes(k))
        .join(''),
      ghost,
      1,
    );
  if (opts.glow && lit)
    for (const k of lit) {
      const [sx, sy, w, h] = SEG[k as keyof typeof SEG];
      for (let j = -1; j <= h; j++)
        for (let i = -1; i <= w; i++)
          c.set(x + sx + i + Math.round(sh(sy + j)), y + sy + j, on, opts.glow * 0.35);
    }
  paint(lit, on, 1);
}
