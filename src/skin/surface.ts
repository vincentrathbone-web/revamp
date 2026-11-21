/** Software drawing surface: every skinned window is drawn by copying sprite pixels, like the classic player. */
import { createImage, type RgbaImage } from './image';
import type { Skin } from './skin';
import { CHAR_H, CHAR_W, glyph, type Sprite } from './sprites';

export class Surface implements RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  /** Alpha mask for window shapes (region.txt): 0 = transparent. Applied by `applyMask`. */
  constructor(width: number, height: number) {
    const img = createImage(width, height);
    this.width = width;
    this.height = height;
    this.data = img.data;
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.data = createImage(width, height).data;
  }

  /** Copies a rectangle of `src` to (dx, dy), clipped to both images. */
  copy(src: RgbaImage, sx: number, sy: number, w: number, h: number, dx: number, dy: number): void {
    let x0 = 0,
      y0 = 0,
      x1 = w,
      y1 = h;
    x0 = Math.max(x0, -sx, -dx);
    y0 = Math.max(y0, -sy, -dy);
    x1 = Math.min(x1, src.width - sx, this.width - dx);
    y1 = Math.min(y1, src.height - sy, this.height - dy);
    if (x1 <= x0 || y1 <= y0) return;
    const rowLen = (x1 - x0) * 4;
    for (let y = y0; y < y1; y++) {
      const si = ((sy + y) * src.width + sx + x0) * 4;
      const di = ((dy + y) * this.width + dx + x0) * 4;
      this.data.set(src.data.subarray(si, si + rowLen), di);
    }
  }

  /** Draws a sprite from the skin; `w`/`h` crop it (never stretch). */
  sprite(skin: Skin, sp: Sprite, dx: number, dy: number, w = sp.w, h = sp.h): void {
    this.copy(skin.sheets[sp.sheet], sp.x, sp.y, Math.min(w, sp.w), Math.min(h, sp.h), dx, dy);
  }

  /** Tiles a sprite to fill a rectangle. */
  tile(skin: Skin, sp: Sprite, dx: number, dy: number, w: number, h: number): void {
    for (let y = 0; y < h; y += sp.h)
      for (let x = 0; x < w; x += sp.w)
        this.sprite(skin, sp, dx + x, dy + y, Math.min(sp.w, w - x), Math.min(sp.h, h - y));
  }

  fill(x: number, y: number, w: number, h: number, c: readonly [number, number, number], a = 255): void {
    const x0 = Math.max(0, x),
      y0 = Math.max(0, y),
      x1 = Math.min(this.width, x + w),
      y1 = Math.min(this.height, y + h);
    for (let yy = y0; yy < y1; yy++)
      for (let xx = x0; xx < x1; xx++) {
        const o = (yy * this.width + xx) * 4;
        this.data[o] = c[0];
        this.data[o + 1] = c[1];
        this.data[o + 2] = c[2];
        this.data[o + 3] = a;
      }
  }

  pixel(x: number, y: number, c: readonly [number, number, number]): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const o = (y * this.width + x) * 4;
    this.data[o] = c[0];
    this.data[o + 1] = c[1];
    this.data[o + 2] = c[2];
    this.data[o + 3] = 255;
  }

  /** Draws text with the skin's 5x6 bitmap font, clipped to `maxW`. `offset` scrolls it left (pixels). */
  text(skin: Skin, str: string, dx: number, dy: number, maxW = Infinity, offset = 0): void {
    let x = -offset;
    for (const ch of str) {
      if (x >= maxW) break;
      if (x + CHAR_W > 0) {
        const g = glyph(ch);
        const cut = Math.max(0, -x);
        const w = Math.min(CHAR_W - cut, maxW - x - cut);
        if (w > 0) this.copy(skin.sheets.text, g.x + cut, g.y, w, CHAR_H, dx + x + cut, dy);
      }
      x += CHAR_W;
    }
  }

  /** Makes pixels outside `inside(x, y)` fully transparent (for shaped windows). */
  applyMask(inside: (x: number, y: number) => boolean): void {
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++) if (!inside(x, y)) this.data[(y * this.width + x) * 4 + 3] = 0;
  }
}

export const textWidth = (s: string) => [...s].length * CHAR_W;
