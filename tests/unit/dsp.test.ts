import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { magnitudeDb, peaking, process } from '../../src/dsp/biquad';
import { BAND_SETS, BUILTIN_PRESETS, defaultEq, responseDb } from '../../src/dsp/eq';
import { byteToDb, dbToByte, parseEqf, writeEqf } from '../../src/dsp/eqf';

describe('biquad', () => {
  test('peaking filter hits its gain exactly at the centre', () => {
    for (const g of [-12, -6, 3, 12]) {
      const f = peaking(1000, 1, g, 48000);
      expect(magnitudeDb(f, 1000, 48000)).toBeCloseTo(g, 6);
    }
  });

  test('time-domain processing matches the predicted response', () => {
    const f = peaking(1000, 1, 12, 48000);
    const n = 48000;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / 48000);
    const y = process(f, x);
    let peak = 0;
    for (let i = n / 2; i < n; i++) peak = Math.max(peak, Math.abs(y[i]!));
    expect(20 * Math.log10(peak / 0.1)).toBeCloseTo(12, 1);
  });
});

describe('equalizer response', () => {
  test('+12 dB at each band centre within 0.5 dB (one band at a time)', () => {
    for (const set of ['classic', 'iso'] as const) {
      for (const mode of ['classic', 'precise'] as const) {
        BAND_SETS[set].forEach((freq, i) => {
          const eq = { ...defaultEq(), bandSet: set, mode, bandsDb: Array(10).fill(0) };
          eq.bandsDb[i] = 12;
          expect(Math.abs(responseDb(eq, freq) - 12)).toBeLessThan(0.5);
        });
      }
    }
  });

  test('flat within 0.05 dB with all bands at 0', () => {
    const eq = defaultEq();
    for (let f = 20; f < 20000; f *= 1.1) expect(Math.abs(responseDb(eq, f))).toBeLessThan(0.05);
  });

  test('disabled EQ is flat even with bands set', () => {
    const eq = { ...defaultEq(), enabled: false, bandsDb: Array(10).fill(12), preampDb: 6 };
    expect(responseDb(eq, 1000)).toBe(0);
  });

  test('built-in presets are in range and have 10 bands', () => {
    for (const p of BUILTIN_PRESETS) {
      expect(p.bandsDb).toHaveLength(10);
      for (const v of [...p.bandsDb, p.preampDb]) expect(Math.abs(v)).toBeLessThanOrEqual(12);
    }
  });
});

describe('.eqf / .q1 files', () => {
  test('byte <-> dB mapping round-trips for every byte value', () => {
    for (let b = 0; b <= 63; b++) expect(dbToByte(byteToDb(b))).toBe(b);
    expect(byteToDb(0)).toBe(12);
    expect(byteToDb(31)).toBe(0);
    expect(byteToDb(63)).toBe(-12);
  });

  test('write -> parse round-trip keeps names and values (property)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc.string({ maxLength: 40 }).map((s) => s.replace(/[^\x20-\x7e]/g, 'x')),
            bytes: fc.array(fc.integer({ min: 0, max: 63 }), { minLength: 11, maxLength: 11 }),
          }),
          { maxLength: 20 },
        ),
        (items) => {
          const presets = items.map((i) => ({
            name: i.name,
            bandsDb: i.bytes.slice(0, 10).map(byteToDb),
            preampDb: byteToDb(i.bytes[10]!),
          }));
          const back = parseEqf(writeEqf(presets));
          expect(back.map((p) => p.name)).toEqual(presets.map((p) => p.name));
          back.forEach((p, i) => {
            expect(p.bandsDb.map(dbToByte)).toEqual(items[i]!.bytes.slice(0, 10));
            expect(dbToByte(p.preampDb)).toBe(items[i]!.bytes[10]);
          });
        },
      ),
    );
  });

  const refQ1 = 'D:/Dev/winamp/Build/Winamp_x86_Release/Winamp.q1';
  test.runIf(existsSafe(refQ1))(
    'reads the preset library saved by the reference build, byte-identical on save',
    () => {
      const data = new Uint8Array(readFileSync(refQ1));
      const presets = parseEqf(data);
      expect(presets).toHaveLength(18);
      expect(presets.find((p) => p.bandsDb.every((v) => v === 0))).toBeDefined(); // a flat preset exists
      expect(Array.from(writeEqf(presets))).toEqual(Array.from(data));
    },
  );

  test('rejects files that are not presets', () => {
    expect(() => parseEqf(new TextEncoder().encode('hello world, this is not an eq file'))).toThrow();
  });
});

function existsSafe(p: string): boolean {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
}
