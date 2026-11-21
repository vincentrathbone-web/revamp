/**
 * Windows BMP decoder (written from the public file-format description).
 * Handles 1/4/8-bit palettes, RLE4/RLE8, 16-bit (555/565 bitfields), 24-bit and 32-bit,
 * top-down and bottom-up rows, OS/2 core headers and odd sizes. Throws BmpError on bad data.
 */
import type { RgbaImage } from './image';

export class BmpError extends Error {}

export function decodeBmp(buf: Uint8Array): RgbaImage {
  if (buf.length < 26 || buf[0] !== 0x42 || buf[1] !== 0x4d) throw new BmpError('Not a BMP file');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const pixOffset = dv.getUint32(10, true);
  const hdr = dv.getUint32(14, true);
  let width: number,
    height: number,
    bpp: number,
    compression = 0,
    colorsUsed = 0;
  let palEntry = 4;
  if (hdr === 12) {
    width = dv.getUint16(18, true);
    height = dv.getInt16(20, true);
    bpp = dv.getUint16(24, true);
    palEntry = 3;
  } else {
    if (buf.length < 54) throw new BmpError('Truncated header');
    width = dv.getInt32(18, true);
    height = dv.getInt32(22, true);
    bpp = dv.getUint16(28, true);
    compression = dv.getUint32(30, true);
    colorsUsed = dv.getUint32(46, true);
  }
  const topDown = height < 0;
  height = Math.abs(height);
  if (width <= 0 || height <= 0 || width > 16384 || height > 16384)
    throw new BmpError(`Bad size ${width}x${height}`);
  if (![1, 4, 8, 16, 24, 32].includes(bpp)) throw new BmpError(`Unsupported bit depth ${bpp}`);

  // Palette
  const palette: number[][] = [];
  if (bpp <= 8) {
    const n = colorsUsed > 0 && colorsUsed <= 256 ? colorsUsed : 1 << bpp;
    const start = 14 + hdr;
    for (let i = 0; i < n; i++) {
      const o = start + i * palEntry;
      if (o + 2 >= buf.length) break;
      palette.push([buf[o + 2]!, buf[o + 1]!, buf[o]!]);
    }
    while (palette.length < 1 << bpp) palette.push([0, 0, 0]);
  }

  // Bitfield masks (16/32-bit)
  let masks: [number, number, number] | null = null;
  if (compression === 3 || compression === 6) {
    const mo = hdr >= 52 ? 54 : 14 + hdr;
    if (mo + 12 <= buf.length)
      masks = [dv.getUint32(mo, true), dv.getUint32(mo + 4, true), dv.getUint32(mo + 8, true)];
  } else if (bpp === 16) masks = [0x7c00, 0x03e0, 0x001f];

  const out = new Uint8ClampedArray(width * height * 4);
  const put = (x: number, row: number, r: number, g: number, b: number) => {
    const y = topDown ? row : height - 1 - row;
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const o = (y * width + x) * 4;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = 255;
  };
  for (let i = 3; i < out.length; i += 4) out[i] = 255;

  if (compression === 1 || compression === 2) {
    decodeRle(buf, pixOffset, width, height, compression === 1 ? 8 : 4, (x, row, idx) => {
      const c = palette[idx] ?? [0, 0, 0];
      put(x, row, c[0]!, c[1]!, c[2]!);
    });
    return { width, height, data: out };
  }
  if (compression !== 0 && compression !== 3 && compression !== 6)
    throw new BmpError(`Unsupported compression ${compression}`);

  const stride = Math.floor((bpp * width + 31) / 32) * 4;
  const shift = (m: number) => (m ? 31 - Math.clz32(m & -m) : 0);
  const scale = (v: number, m: number) => {
    const bits = m ? 32 - Math.clz32(m >>> shift(m)) : 0;
    return bits ? Math.round((v * 255) / ((1 << bits) - 1)) : 0;
  };
  for (let row = 0; row < height; row++) {
    const ro = pixOffset + row * stride;
    if (ro >= buf.length) break; // truncated file: keep what we have
    for (let x = 0; x < width; x++) {
      let r = 0,
        g = 0,
        b = 0;
      if (bpp <= 8) {
        const bitPos = x * bpp;
        const byte = buf[ro + (bitPos >> 3)];
        if (byte === undefined) break;
        const idx = (byte >> (8 - bpp - (bitPos & 7))) & ((1 << bpp) - 1);
        [r, g, b] = palette[idx] as [number, number, number];
      } else if (bpp === 24) {
        const o = ro + x * 3;
        if (o + 2 >= buf.length) break;
        ((b = buf[o]!), (g = buf[o + 1]!), (r = buf[o + 2]!));
      } else if (bpp === 32 && !masks) {
        const o = ro + x * 4;
        if (o + 3 >= buf.length) break;
        ((b = buf[o]!), (g = buf[o + 1]!), (r = buf[o + 2]!));
      } else {
        const o = ro + x * (bpp / 8);
        if (o + bpp / 8 > buf.length) break;
        const v = bpp === 16 ? dv.getUint16(o, true) : dv.getUint32(o, true);
        const [mr, mg, mb] = masks!;
        r = scale((v & mr) >>> shift(mr), mr);
        g = scale((v & mg) >>> shift(mg), mg);
        b = scale((v & mb) >>> shift(mb), mb);
      }
      put(x, row, r, g, b);
    }
  }
  return { width, height, data: out };
}

function decodeRle(
  buf: Uint8Array,
  start: number,
  _width: number,
  height: number,
  bits: 4 | 8,
  set: (x: number, row: number, idx: number) => void,
): void {
  let x = 0,
    row = 0,
    p = start;
  while (p + 1 < buf.length && row < height) {
    const n = buf[p++]!;
    const v = buf[p++]!;
    if (n > 0) {
      for (let i = 0; i < n; i++) set(x++, row, bits === 8 ? v : i & 1 ? v & 15 : v >> 4);
    } else if (v === 0) {
      x = 0;
      row++;
    } else if (v === 1) return;
    else if (v === 2) {
      x += buf[p++] ?? 0;
      row += buf[p++] ?? 0;
    } else {
      for (let i = 0; i < v; i++) {
        const byte = buf[p + (bits === 8 ? i : i >> 1)] ?? 0;
        set(x++, row, bits === 8 ? byte : i & 1 ? byte & 15 : byte >> 4);
      }
      const used = bits === 8 ? v : Math.ceil(v / 2);
      p += used + (used & 1);
    }
  }
}
