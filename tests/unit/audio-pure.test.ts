import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { fadeCurve, fadeGain } from '../../src/audio/fades';
import { findTrim } from '../../src/audio/silence';
import { defaultReplayGain, parseGainText, replayGainFactor } from '../../src/audio/replaygain';
import { bytesSource, readTrackInfo } from '../../src/audio/tags';

const asset = (n: string) => new Uint8Array(readFileSync(`test-assets/generated/${n}`));

describe('fades', () => {
  test('linear fade matches a straight line at 10 points', () => {
    for (let i = 0; i <= 10; i++) expect(fadeGain(i / 10, 0, 1, 'linear')).toBeCloseTo(i / 10, 9);
  });
  test('log fade is linear in dB between -60 dB and 0 dB', () => {
    for (let i = 1; i <= 9; i++) {
      const db = 20 * Math.log10(fadeGain(i / 10, 0, 1, 'log'));
      expect(db).toBeCloseTo(-60 + 60 * (i / 10), 6);
    }
    expect(fadeGain(0, 0, 1, 'log')).toBe(0);
    expect(fadeGain(1, 1, 0, 'log')).toBe(0);
  });
  test('curves are monotonic (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 500 }),
        fc.constantFrom('linear' as const, 'log' as const),
        (n, s) => {
          const c = fadeCurve(n, 1, 0, s);
          for (let i = 1; i < c.length; i++) expect(c[i]!).toBeLessThanOrEqual(c[i - 1]!);
        },
      ),
    );
  });
});

describe('silence remover', () => {
  test('finds the tone inside generated padding to within 5 ms', () => {
    const R = 44100;
    const x = new Float32Array(R + 2 * R + 1.5 * R);
    for (let i = R; i < 3 * R; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / R);
    const t = findTrim([x, x], R, -60, 0);
    expect(Math.abs(t.start - R)).toBeLessThan(0.005 * R);
    expect(Math.abs(t.end - 3 * R)).toBeLessThan(0.005 * R);
  });
  test('all-silent input trims to nothing', () => {
    expect(findTrim([new Float32Array(100)], 44100)).toEqual({ start: 0, end: 0 });
  });
});

describe('ReplayGain', () => {
  const on = { ...defaultReplayGain(), enabled: true };
  test('applies tagged track gain', () => {
    expect(20 * Math.log10(replayGainFactor({ trackGain: -3.5 }, on))).toBeCloseTo(-3.5, 6);
  });
  test('album mode, falling back to track gain', () => {
    const s = { ...on, source: 'album' as const };
    expect(20 * Math.log10(replayGainFactor({ albumGain: -5 }, s))).toBeCloseTo(-5, 6);
    expect(20 * Math.log10(replayGainFactor({ trackGain: -2 }, s))).toBeCloseTo(-2, 6);
    expect(
      20 * Math.log10(replayGainFactor({ trackGain: -2 }, { ...s, fallbackToOther: false })),
    ).toBeCloseTo(-6, 6);
  });
  test('preamp and clipping protection', () => {
    expect(replayGainFactor({ trackGain: 6, trackPeak: 0.9 }, on)).toBeCloseTo(1 / 0.9, 6);
    expect(20 * Math.log10(replayGainFactor({ trackGain: -6 }, { ...on, preampDb: 2 }))).toBeCloseTo(-4, 6);
  });
  test('disabled = unity', () => expect(replayGainFactor({ trackGain: -10 }, defaultReplayGain())).toBe(1));
  test('parses gain text', () => {
    expect(parseGainText('-7.32 dB')).toBe(-7.32);
    expect(parseGainText('+1,5dB')).toBe(1.5);
    expect(parseGainText('junk')).toBeUndefined();
  });
});

describe('track info', () => {
  const expectTags = async (file: string, rg = true) => {
    const info = await readTrackInfo(bytesSource(asset(file)));
    expect(info.title).toBe('Test Tone Ünïcode');
    expect(info.artist).toBe('RevAmp Lab');
    expect(info.album).toBe('Generated');
    expect(info.track).toMatch(/^7/);
    expect(info.year).toBe('2026');
    expect(info.durationSec).toBeGreaterThan(2.9);
    expect(info.durationSec).toBeLessThan(3.2);
    if (rg) {
      expect(info.replayGain?.trackGain).toBe(-3.5);
      expect(info.replayGain?.trackPeak).toBeCloseTo(0.501187, 5);
      expect(info.replayGain?.albumGain).toBe(-5.25);
    }
    return info;
  };
  test('MP3 with ID3v2.3 + ID3v1', async () => {
    const i = await expectTags('tagged.mp3');
    expect(i).toMatchObject({ format: 'MP3', sampleRate: 44100, channels: 2, bitrateKbps: 128 });
  });
  test('VBR MP3 with ID3v2.4', async () => expectTags('tagged-v24.mp3'));
  test('FLAC', async () => {
    const i = await expectTags('tagged.flac');
    expect(i).toMatchObject({ format: 'FLAC', sampleRate: 44100, channels: 2 });
    expect(i.durationSec).toBeCloseTo(3, 6);
  });
  test('Ogg Vorbis', async () => expect((await expectTags('tagged.ogg')).format).toBe('Vorbis'));
  test('Opus', async () => expect((await expectTags('tagged.opus')).format).toBe('Opus'));
  test('M4A', async () => expect((await expectTags('tagged.m4a', false)).sampleRate).toBe(44100));
  test('WAV', async () => {
    const i = await readTrackInfo(bytesSource(asset('tone1k.wav')));
    expect(i).toMatchObject({ format: 'WAV', sampleRate: 44100, channels: 2, durationSec: 3 });
  });
  test('garbage and truncated files never throw (property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ maxLength: 4000 }),
        fc.constantFrom('', 'ID3', 'fLaC', 'OggS', 'RIFF'),
        async (b, prefix) => {
          const data = new Uint8Array([...new TextEncoder().encode(prefix), ...b]);
          await readTrackInfo(bytesSource(data));
        },
      ),
      { numRuns: 300 },
    );
    for (const f of ['tagged.mp3', 'tagged.flac', 'tagged.ogg', 'tagged.m4a']) {
      const full = asset(f);
      for (const cut of [10, 100, 1000, 5000]) await readTrackInfo(bytesSource(full.subarray(0, cut)));
    }
  });
});
