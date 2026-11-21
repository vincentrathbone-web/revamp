import { describe, expect, test } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { zipSync } from 'fflate';
import { BmpError, decodeBmp } from '../../src/skin/bmp';
import { getPixel } from '../../src/skin/image';
import { insideRegions, parseIni, parsePledit, parseRegion, parseViscolor } from '../../src/skin/textfiles';
import { SHEET_SIZES, skinFromArchive } from '../../src/skin/skin';
import { defaultSkin } from '../../src/skin/default-skin';
import { MAIN, PL, EQ, SHEETS, eqSliderFrame, glyph, volumeFrame, type Sprite } from '../../src/skin/sprites';

/** Builds a BMP for tests (bottom-up unless height < 0). */
function bmp(
  w: number,
  h: number,
  bpp: 1 | 4 | 8 | 24 | 32,
  pixel: (x: number, y: number) => number,
  palette: number[] = [],
): Uint8Array {
  const absH = Math.abs(h);
  const stride = Math.floor((bpp * w + 31) / 32) * 4;
  const palBytes = bpp <= 8 ? (1 << bpp) * 4 : 0;
  const off = 54 + palBytes;
  const buf = new Uint8Array(off + stride * absH);
  const dv = new DataView(buf.buffer);
  buf[0] = 0x42;
  buf[1] = 0x4d;
  dv.setUint32(2, buf.length, true);
  dv.setUint32(10, off, true);
  dv.setUint32(14, 40, true);
  dv.setInt32(18, w, true);
  dv.setInt32(22, h, true);
  dv.setUint16(26, 1, true);
  dv.setUint16(28, bpp, true);
  for (let i = 0; i < Math.min(palette.length, palBytes / 4); i++)
    dv.setUint32(54 + i * 4, palette[i]!, true); // 0x00RRGGBB as BGRA bytes
  for (let row = 0; row < absH; row++) {
    const y = h < 0 ? row : absH - 1 - row;
    for (let x = 0; x < w; x++) {
      const v = pixel(x, y);
      const o = off + row * stride;
      if (bpp === 24) {
        buf[o + x * 3] = v & 255;
        buf[o + x * 3 + 1] = (v >> 8) & 255;
        buf[o + x * 3 + 2] = (v >> 16) & 255;
      } else if (bpp === 32) dv.setUint32(o + x * 4, v, true);
      else {
        const bit = x * bpp;
        buf[o + (bit >> 3)]! |= v << (8 - bpp - (bit & 7));
      }
    }
  }
  return buf;
}

describe('BMP decoder', () => {
  const pattern = (x: number, y: number) =>
    ((x * 37 + y * 11) & 0xff) | (((x ^ y) & 0xff) << 8) | (((y * 5) & 0xff) << 16);
  test('24-bit, odd width (row padding), bottom-up and top-down', () => {
    for (const h of [7, -7]) {
      const img = decodeBmp(bmp(13, h, 24, pattern));
      expect([img.width, img.height]).toEqual([13, 7]);
      for (const [x, y] of [
        [0, 0],
        [12, 6],
        [5, 3],
      ] as const) {
        const v = pattern(x, y);
        expect(getPixel(img, x, y)).toEqual([(v >> 16) & 255, (v >> 8) & 255, v & 255, 255]);
      }
    }
  });
  test('32-bit', () => {
    const img = decodeBmp(bmp(5, 4, 32, pattern));
    const v = pattern(4, 3);
    expect(getPixel(img, 4, 3)).toEqual([(v >> 16) & 255, (v >> 8) & 255, v & 255, 255]);
  });
  test('8, 4 and 1-bit palettes', () => {
    const pal = [0x000000, 0xff0000, 0x00ff00, 0x0000ff];
    for (const bpp of [8, 4, 1] as const) {
      const n = bpp === 1 ? 2 : 4;
      const img = decodeBmp(bmp(9, 3, bpp, (x, y) => (x + y) % n, pal));
      for (let x = 0; x < 9; x++) {
        const c = pal[(x + 1) % n]!;
        expect(getPixel(img, x, 1)).toEqual([(c >> 16) & 255, (c >> 8) & 255, c & 255, 255]);
      }
    }
  });
  test('rejects non-BMP data and never crashes on random input (property)', () => {
    expect(() => decodeBmp(new Uint8Array([1, 2, 3]))).toThrow(BmpError);
    const good = bmp(20, 10, 8, (x) => x % 4, [0, 0xffffff, 0xff, 0xff00]);
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 600 }), fc.nat(good.length), (noise, at) => {
        const b = good.slice();
        b.set(noise.subarray(0, Math.max(0, b.length - at)), at);
        try {
          decodeBmp(b);
        } catch (e) {
          if (!(e instanceof BmpError)) throw e;
        }
        try {
          decodeBmp(b.subarray(0, at));
        } catch (e) {
          if (!(e instanceof BmpError)) throw e;
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe('skin text files', () => {
  test('pledit.txt with odd spacing and missing keys', () => {
    const c = parsePledit('[Text]\r\nNormal = #00FF00\nCurrent=FFFFFF\r\nnormalbg=#000000\nFont=Tahoma\n');
    expect(c.normal).toEqual([0, 255, 0]);
    expect(c.current).toEqual([255, 255, 255]);
    expect(c.font).toBe('Tahoma');
    expect(c.selectedBg).toEqual([0, 0, 198]); // default
  });
  test('viscolor.txt with comments, short files fall back to defaults', () => {
    const v = parseViscolor('0,0,0, // background\n 10, 20, 30 // dots\n255,0,0');
    expect(v).toHaveLength(24);
    expect(v[1]).toEqual([10, 20, 30]);
    expect(v[2]).toEqual([255, 0, 0]);
  });
  test('region.txt polygons and hit-testing', () => {
    const r = parseRegion(
      '[Normal]\nNumPoints=4\nPointList=0,0, 275,0, 275,116, 0,116\n[WindowShade]\nNumPoints=4\nPointList=0 0 10 0 10 10 0 10',
    );
    expect(r.normal?.[0]).toHaveLength(4);
    expect(insideRegions(r.windowshade, 5, 5)).toBe(true);
    expect(insideRegions(r.windowshade, 50, 5)).toBe(false);
    expect(insideRegions(undefined, 999, 999)).toBe(true);
  });
  test('ini parser ignores junk lines', () => {
    expect(parseIni('garbage\n[A]\nx=1\n;c=2\n[b]\ny = "q"')).toEqual({ a: { x: '1' }, b: { y: 'q' } });
  });
});

describe('default skin', () => {
  test('every sheet has its standard size', () => {
    const s = defaultSkin();
    for (const sheet of SHEETS)
      expect([s.sheets[sheet].width, s.sheets[sheet].height]).toEqual(SHEET_SIZES[sheet]);
  });
});

const allSprites = (): Sprite[] => [
  ...Object.values(MAIN),
  ...Object.values(EQ),
  ...Object.values(PL),
  ...Array.from({ length: 28 }, (_, i) => volumeFrame(i)),
  ...Array.from({ length: 28 }, (_, i) => eqSliderFrame(i)),
  ...[...'abcxyz0123456789'].map(glyph),
];

describe('skin loading', () => {
  test('every sprite lies inside its standard sheet', () => {
    for (const sp of allSprites()) {
      const [w, h] = SHEET_SIZES[sp.sheet];
      expect(sp.x + sp.w <= w && sp.y + sp.h <= h, `${sp.sheet} ${sp.x},${sp.y}`).toBe(true);
    }
  });

  test('a minimal skin with one bitmap falls back to the default for the rest', () => {
    const zip = zipSync({
      'MySkin/Main.BMP': bmp(275, 116, 24, () => 0x123456),
      'MySkin/viscolor.txt': new TextEncoder().encode('1,2,3'),
    });
    const s = skinFromArchive('test', zip, defaultSkin());
    expect(getPixel(s.sheets.main, 10, 10)).toEqual([0x12, 0x34, 0x56, 255]);
    expect(s.sheets.cbuttons).toBe(defaultSkin().sheets.cbuttons);
    expect(s.vis[0]).toEqual([1, 2, 3]);
    expect(s.warnings.some((w) => w.includes('cbuttons'))).toBe(true);
  });

  test('an undersized bitmap is padded with default-skin pixels', () => {
    const zip = zipSync({ 'cbuttons.bmp': bmp(50, 18, 24, () => 0xff0000) });
    const s = skinFromArchive('t', zip, defaultSkin());
    expect(s.sheets.cbuttons.width).toBe(136);
    expect(getPixel(s.sheets.cbuttons, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(getPixel(s.sheets.cbuttons, 120, 30)).toEqual(getPixel(defaultSkin().sheets.cbuttons, 120, 30));
  });

  test('broken archives fall back instead of throwing', () => {
    const s = skinFromArchive('junk', new Uint8Array([80, 75, 3, 4, 1, 2, 3]), defaultSkin());
    expect(s.warnings.length).toBeGreaterThan(0);
    expect(s.sheets.main).toBe(defaultSkin().sheets.main);
  });

  const dirs = ['test-assets/skins', 'test-assets/skins/corpus'];
  const files = dirs.filter(existsSync).flatMap((d) =>
    readdirSync(d)
      .filter((f) => /\.(wsz|zip)$/i.test(f))
      .map((f) => join(d, f)),
  );
  test.runIf(files.length > 0)(
    `corpus: ${files.length} community skins load with no crash, each under 50 ms on average`,
    () => {
      const t0 = performance.now();
      let withMain = 0;
      const problems: string[] = [];
      for (const f of files) {
        const s = skinFromArchive(f, new Uint8Array(readFileSync(f)), defaultSkin());
        if (s.sheets.main !== defaultSkin().sheets.main) withMain++;
        for (const sheet of SHEETS) {
          const img = s.sheets[sheet];
          if (img.width < SHEET_SIZES[sheet][0] || img.height < SHEET_SIZES[sheet][1])
            problems.push(`${f}: ${sheet} too small`);
        }
      }
      const avg = (performance.now() - t0) / files.length;
      console.info(
        `corpus: ${files.length} skins, ${withMain} with their own main.bmp, ${avg.toFixed(1)} ms each`,
      );
      expect(problems).toEqual([]);
      expect(withMain / files.length).toBeGreaterThan(0.9);
      expect(avg).toBeLessThan(50);
    },
  );
});
