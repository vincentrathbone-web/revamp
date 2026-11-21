/** A plain RGBA image (works in Node and the browser; no canvas needed). */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA, row-major, top-down
}

export function createImage(width: number, height: number, fill = 0x000000ff): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill !== 0) {
    const r = (fill >>> 24) & 255,
      g = (fill >>> 16) & 255,
      b = (fill >>> 8) & 255,
      a = fill & 255;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { width, height, data };
}

export function getPixel(img: RgbaImage, x: number, y: number): [number, number, number, number] {
  const o = (y * img.width + x) * 4;
  return [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!, img.data[o + 3]!];
}

/** Parses "#rrggbb", "rrggbb" or "r,g,b" into [r,g,b]. */
export function parseColor(s: string | undefined): [number, number, number] | undefined {
  if (!s) return undefined;
  const t = s.trim();
  const hex = /^#?([0-9a-f]{6})/i.exec(t);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(t);
  if (rgb) return [Number(rgb[1]) & 255, Number(rgb[2]) & 255, Number(rgb[3]) & 255];
  return undefined;
}

export const cssColor = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;
