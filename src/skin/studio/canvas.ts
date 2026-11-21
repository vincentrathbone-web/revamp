/**
 * Small anti-aliased drawing toolkit for RevAmp's own skins: shapes are signed distance functions (SDF), so
 * edges are smooth and the same shape gives bevel lighting, glows and shadows. All art is generated in code.
 */
import type { RgbaImage } from '../image';

export type RGB = readonly [number, number, number];
/** Signed distance in pixels: negative inside the shape, positive outside. */
export type Sdf = (x: number, y: number) => number;
/** A surface colour at window coordinates (x, y). */
export type Material = (x: number, y: number) => RGB;

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const scale = (c: RGB, f: number): RGB => [c[0] * f, c[1] * f, c[2] * f];
/** Lighten (t > 0, towards white) or darken (t < 0, towards black). */
export const shade = (c: RGB, t: number): RGB =>
  t >= 0 ? mix(c, [255, 255, 255], t) : mix(c, [0, 0, 0], -t);
export const hex = (s: string): RGB => {
  const n = parseInt(s.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const solid =
  (c: RGB): Material =>
  () =>
    c;

// ------------------------------------------------------------------ shapes
export const circle =
  (cx: number, cy: number, r: number): Sdf =>
  (x, y) =>
    Math.hypot(x - cx, y - cy) - r;

/** Rounded rectangle; (x, y, w, h) are the outer edges in pixels. */
export const rrect = (x: number, y: number, w: number, h: number, r: number): Sdf => {
  const hx = w / 2,
    hy = h / 2,
    cx = x + hx,
    cy = y + hy;
  r = Math.min(r, hx, hy);
  return (px, py) => {
    const qx = Math.abs(px - cx) - hx + r,
      qy = Math.abs(py - cy) - hy + r;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
};

/** Polygon (any winding). */
export const poly = (pts: readonly (readonly [number, number])[]): Sdf => {
  return (px, py) => {
    let d = Infinity,
      s = 1;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i]!,
        [xj, yj] = pts[j]!;
      const ex = xj - xi,
        ey = yj - yi,
        wx = px - xi,
        wy = py - yi;
      const t = clamp01((wx * ex + wy * ey) / (ex * ex + ey * ey || 1));
      d = Math.min(d, Math.hypot(wx - ex * t, wy - ey * t));
      const c1 = py >= yi,
        c2 = py < yj,
        c3 = ex * wy > ey * wx;
      if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
    }
    return s * d;
  };
};
export const union =
  (...fs: Sdf[]): Sdf =>
  (x, y) =>
    Math.min(...fs.map((f) => f(x, y)));
export const subtract =
  (a: Sdf, b: Sdf): Sdf =>
  (x, y) =>
    Math.max(a(x, y), -b(x, y));
export const offset =
  (f: Sdf, dx: number, dy: number): Sdf =>
  (x, y) =>
    f(x - dx, y - dy);

/** Outward unit normal of the shape at (x, y). */
export function normal(f: Sdf, x: number, y: number): [number, number] {
  const gx = f(x + 0.5, y) - f(x - 0.5, y),
    gy = f(x, y + 0.5) - f(x, y - 0.5);
  const n = Math.hypot(gx, gy) || 1;
  return [gx / n, gy / n];
}

/** Light comes from the top left. */
const LX = -0.55,
  LY = -0.83;

/**
 * Bevel lighting near the edge of a shape: +1 = fully lit edge, -1 = shadowed edge, 0 inside the flat face.
 * `width` is the bevel width in pixels.
 */
export function bevel(f: Sdf, x: number, y: number, d: number, width: number): number {
  if (d < -width) return 0;
  const [nx, ny] = normal(f, x, y);
  const t = 1 - clamp01(-d / width);
  return (nx * LX + ny * LY) * t;
}

// ------------------------------------------------------------------ noise
export function hash(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
/** Value noise in [0, 1). */
export function noise(x: number, y: number, seed = 0): number {
  const x0 = Math.floor(x),
    y0 = Math.floor(y);
  const fx = smooth(x - x0),
    fy = smooth(y - y0);
  const a = hash(x0, y0, seed),
    b = hash(x0 + 1, y0, seed),
    c = hash(x0, y0 + 1, seed),
    d = hash(x0 + 1, y0 + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
export function fbm(x: number, y: number, octaves = 4, seed = 0): number {
  let v = 0,
    amp = 0.5,
    f = 1,
    tot = 0;
  for (let i = 0; i < octaves; i++) {
    v += noise(x * f, y * f, seed + i * 17) * amp;
    tot += amp;
    amp *= 0.5;
    f *= 2;
  }
  return v / tot;
}

// ------------------------------------------------------------------ canvas
/**
 * Draws into a sheet using window coordinates: a pixel at window (x, y) lands at sheet (x + ox, y + oy).
 * `clip` (sheet coordinates) keeps drawing inside one sprite cell.
 */
export class Canvas {
  clip: [number, number, number, number];
  constructor(
    readonly img: RgbaImage,
    readonly ox = 0,
    readonly oy = 0,
    clip?: [number, number, number, number],
  ) {
    this.clip = clip ?? [0, 0, img.width, img.height];
  }

  /** A canvas for one sprite cell that shows window area starting at (wx, wy). */
  static cell(img: RgbaImage, sx: number, sy: number, w: number, h: number, wx: number, wy: number): Canvas {
    return new Canvas(img, sx - wx, sy - wy, [sx, sy, sx + w, sy + h]);
  }

  private inside(sx: number, sy: number): boolean {
    const [x0, y0, x1, y1] = this.clip;
    return sx >= x0 && sy >= y0 && sx < x1 && sy < y1;
  }

  get(x: number, y: number): RGB {
    const sx = x + this.ox,
      sy = y + this.oy;
    if (sx < 0 || sy < 0 || sx >= this.img.width || sy >= this.img.height) return [0, 0, 0];
    const o = (sy * this.img.width + sx) * 4;
    return [this.img.data[o]!, this.img.data[o + 1]!, this.img.data[o + 2]!];
  }

  /** Blends colour `c` over the pixel with opacity `a`. */
  set(x: number, y: number, c: RGB, a = 1): void {
    const sx = x + this.ox,
      sy = y + this.oy;
    if (a <= 0 || !this.inside(sx, sy)) return;
    const o = (sy * this.img.width + sx) * 4;
    const d = this.img.data;
    if (a >= 1) {
      d[o] = c[0];
      d[o + 1] = c[1];
      d[o + 2] = c[2];
    } else {
      d[o] = d[o]! + (c[0] - d[o]!) * a;
      d[o + 1] = d[o + 1]! + (c[1] - d[o + 1]!) * a;
      d[o + 2] = d[o + 2]! + (c[2] - d[o + 2]!) * a;
    }
    d[o + 3] = 255;
  }

  rect(x: number, y: number, w: number, h: number, m: Material | RGB, a = 1): void {
    const f = typeof m === 'function' ? m : () => m;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, f(i, j), a);
  }

  /** Fills a shape. `paint` gets the pixel centre and the signed distance there. */
  shape(
    f: Sdf,
    box: [number, number, number, number],
    paint: (x: number, y: number, d: number) => RGB,
    opacity = 1,
  ): void {
    const [x0, y0, x1, y1] = box;
    for (let y = Math.floor(y0) - 1; y < Math.ceil(y1) + 1; y++)
      for (let x = Math.floor(x0) - 1; x < Math.ceil(x1) + 1; x++) {
        const px = x + 0.5,
          py = y + 0.5;
        const d = f(px, py);
        const cov = clamp01(0.5 - d);
        if (cov > 0) this.set(x, y, paint(px, py, d), cov * opacity);
      }
  }

  /** Soft glow or shadow around a shape (outside and inside its edge). */
  halo(f: Sdf, box: [number, number, number, number], c: RGB, radius: number, opacity: number): void {
    const [x0, y0, x1, y1] = box;
    for (let y = Math.floor(y0 - radius); y < Math.ceil(y1 + radius); y++)
      for (let x = Math.floor(x0 - radius); x < Math.ceil(x1 + radius); x++) {
        const d = f(x + 0.5, y + 0.5);
        if (d > radius) continue;
        const t = 1 - clamp01(d / radius);
        this.set(x, y, c, t * t * opacity);
      }
  }

  /** Copies another image's window area (at the same window coordinates) under this canvas. */
  backdrop(src: RgbaImage, srcOx = 0, srcOy = 0): void {
    const [x0, y0, x1, y1] = this.clip;
    for (let sy = y0; sy < y1; sy++)
      for (let sx = x0; sx < x1; sx++) {
        const wx = sx - this.ox + srcOx,
          wy = sy - this.oy + srcOy;
        if (wx < 0 || wy < 0 || wx >= src.width || wy >= src.height) continue;
        const so = (wy * src.width + wx) * 4,
          d = (sy * this.img.width + sx) * 4;
        this.img.data[d] = src.data[so]!;
        this.img.data[d + 1] = src.data[so + 1]!;
        this.img.data[d + 2] = src.data[so + 2]!;
        this.img.data[d + 3] = 255;
      }
  }
}
