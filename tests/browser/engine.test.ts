import { describe, expect, test } from 'vitest';
import { bestLag, db, fetchBytes, peak, power, render, rms, track, transparent } from './helpers';

const R = 44100;
const AMP = 10 ** (-6 / 20);
const FORMATS = ['wav', 'mp3', 'flac', 'ogg', 'opus', 'm4a'];

describe('decoding', () => {
  for (const ext of FORMATS) {
    test(`${ext}: right length and a clean 1 kHz tone`, async () => {
      const ctx = new OfflineAudioContext(2, R, R);
      const buf = await ctx.decodeAudioData(await fetchBytes(`tone1k.${ext}`));
      const lossless = ext === 'wav' || ext === 'flac';
      if (lossless) expect(buf.length).toBe(3 * R);
      else expect(Math.abs(buf.length - 3 * R)).toBeLessThan(0.05 * R); // codec padding
      const x = buf.getChannelData(0);
      const p1k = power(x, 1000, R, R / 2, 2 * R);
      expect(p1k / power(x, 900, R, R / 2, 2 * R)).toBeGreaterThan(1000);
      expect(p1k / power(x, 1100, R, R / 2, 2 * R)).toBeGreaterThan(1000);
      expect(Math.abs(db(rms(x, R / 2, 2 * R) * Math.SQRT2) - -6)).toBeLessThan(0.5);
    });

    test(`${ext}: decoder delay handled (start within 10 ms of the original)`, async () => {
      const ctx = new OfflineAudioContext(2, R, R);
      const ref = (await ctx.decodeAudioData(await fetchBytes('sweep.wav'))).getChannelData(0);
      const dec = (await ctx.decodeAudioData(await fetchBytes(`sweep.${ext}`))).getChannelData(0);
      const lag = bestLag(ref, dec, Math.round(0.03 * R), R, R);
      expect(Math.abs(lag) / R).toBeLessThan(0.01);
    });
  }

  test('resampling 44.1 kHz -> 48 kHz keeps the level within 0.1 dB and the pitch', async () => {
    const ctx = new OfflineAudioContext(2, 48000, 48000);
    const buf = await ctx.decodeAudioData(await fetchBytes('tone1k.wav'));
    expect(buf.sampleRate).toBe(48000);
    const x = buf.getChannelData(0);
    expect(Math.abs(db(rms(x, 24000, 120000) * Math.SQRT2) - -6)).toBeLessThan(0.1);
    expect(power(x, 1000, 48000, 24000, 96000) / power(x, 920, 48000, 24000, 96000)).toBeGreaterThan(1000);
  });

  test('corrupt and truncated files report an error instead of crashing', async () => {
    const good = await fetchBytes('tone1k.mp3');
    const cases = [new Uint8Array(1000).fill(7).buffer, good.slice(0, 200), new ArrayBuffer(0)];
    for (const bytes of cases) {
      const errors: unknown[] = [];
      await render(0.5, async (e) => {
        e.on('error', (x) => errors.push(x));
        await e.play({ key: 'bad', load: async () => bytes.slice(0) });
      });
      expect(errors.length).toBe(1);
    }
  });
});

describe('transport', () => {
  test('playback through the chain is bit-transparent with neutral settings', async () => {
    const out = await render(2, async (e) => e.play(await track('tone1k.wav')));
    const ctx = new OfflineAudioContext(2, R, R);
    const src = (await ctx.decodeAudioData(await fetchBytes('tone1k.wav'))).getChannelData(0);
    const y = out.getChannelData(0);
    let maxDiff = 0;
    for (let i = 0; i < 2 * R; i++) maxDiff = Math.max(maxDiff, Math.abs(y[i]! - src[i]!));
    expect(maxDiff).toBeLessThan(1e-6);
  });

  test('starting at an offset lands on the exact sample', async () => {
    const out = await render(0.5, async (e) => {
      await e.play(await track('tone1k.wav'), 1.25);
      expect(e.position).toBeCloseTo(1.25, 4);
    });
    const y = out.getChannelData(0);
    for (const i of [0, 10, 1000])
      expect(y[i]).toBeCloseTo(AMP * Math.sin((2 * Math.PI * 1000 * (1.25 * R + i)) / R), 3);
  });

  test('gapless FLAC: a sine split into two files joins with no discontinuity', async () => {
    const a = await track('gapless-a.flac');
    const b = await track('gapless-b.flac');
    const out = await render(
      4.5,
      async (e) => e.play(a),
      transparent(),
      (t) => (t.key === a.key ? b : null),
    );
    const y = out.getChannelData(0);
    let maxDiff = 0;
    for (let i = 0; i < Math.round(4.3 * R) - 10; i++)
      maxDiff = Math.max(maxDiff, Math.abs(y[i]! - AMP * Math.sin((2 * Math.PI * 220 * i) / R)));
    expect(maxDiff).toBeLessThan(2 / 32768);
  });

  test('gapless MP3: no silent gap at the join', async () => {
    const a = await track('gapless-a.mp3');
    const b = await track('gapless-b.mp3');
    const out = await render(
      4.5,
      async (e) => e.play(a),
      transparent(),
      (t) => (t.key === a.key ? b : null),
    );
    const y = out.getChannelData(0);
    const join = Math.round(2.123 * R);
    // A gap would show as a 1 ms window with almost no signal; a 220 Hz sine never has one.
    for (let i = join - 4410; i < join + 4410; i += 22) expect(rms(y, i, i + 44)).toBeGreaterThan(0.02);
  });

  test('crossfade overlaps tracks by exactly the set time and does not clip', async () => {
    const a = await track('tone1k.wav');
    const b = await track('tone440-48k.wav');
    const s = transparent();
    s.crossfadeMs = 1000;
    s.chain.eq.limiter = true;
    const out = await render(
      6,
      async (e) => e.play(a),
      s,
      (t) => (t.key === a.key ? b : null),
    );
    const y = out.getChannelData(0);
    // 3 s + 3 s - 1 s overlap = sound until 5 s, then silence
    expect(rms(y, Math.round(4.8 * R), Math.round(4.95 * R))).toBeGreaterThan(0.1);
    expect(rms(y, Math.round(5.05 * R), Math.round(5.9 * R))).toBe(0);
    expect(peak(y)).toBeLessThanOrEqual(1);
    // during the overlap both tones are present
    const mid = [Math.round(2.4 * R), Math.round(2.6 * R)] as const;
    expect(power(y, 1000, R, ...mid)).toBeGreaterThan(1);
    expect(power(y, 440, R, ...mid)).toBeGreaterThan(1);
  });

  test('silence remover trims leading/trailing silence between tracks', async () => {
    const a = await track('silence-padded.wav');
    const b = await track('tone440-48k.wav');
    const s = transparent();
    s.silenceRemover.enabled = true;
    const out = await render(
      5.5,
      async (e) => e.play(a),
      s,
      (t) => (t.key === a.key ? b : null),
    );
    const y = out.getChannelData(0);
    expect(rms(y, 0, 441)).toBeGreaterThan(0.1); // tone starts immediately
    // 2 s tone (+5 ms margins), then the 440 Hz track starts right away
    expect(power(y, 440, R, Math.round(2.05 * R), Math.round(2.5 * R))).toBeGreaterThan(
      power(y, 1000, R, Math.round(2.05 * R), Math.round(2.5 * R)) * 100,
    );
  });

  test('start fade follows the selected curve', async () => {
    const s = transparent();
    s.fades.firstStart = { enabled: true, ms: 500 };
    s.fadeShape = 'linear';
    const out = await render(1, async (e) => e.play(await track('tone1k.wav')), s);
    const y = out.getChannelData(0);
    for (const t of [0.1, 0.25, 0.4]) {
      const i = Math.round(t * R);
      const env = peak(y, i - 22, i + 22) / AMP;
      expect(env).toBeCloseTo(t / 0.5, 1);
    }
  });

  test('end-of-song fade on the last track', async () => {
    const s = transparent();
    s.fades.endOfSong = { enabled: true, ms: 1000 };
    s.fadeShape = 'linear';
    const out = await render(3, async (e) => e.play(await track('tone1k.wav')), s);
    const y = out.getChannelData(0);
    expect(peak(y, Math.round(1.5 * R), Math.round(1.6 * R)) / AMP).toBeCloseTo(1, 1);
    expect(peak(y, Math.round(2.5 * R) - 22, Math.round(2.5 * R) + 22) / AMP).toBeCloseTo(0.5, 1);
  });
});

describe('effects chain', () => {
  test('EQ band at +12 dB boosts its frequency by 12 dB (±0.5)', async () => {
    const s = transparent();
    s.chain.eq.bandSet = 'iso';
    s.chain.eq.bandsDb[5] = 12; // 1 kHz
    const out = await render(2, async (e) => e.play(await track('tone1k.wav')), s);
    expect(Math.abs(db(rms(out.getChannelData(0), R / 2, R + R / 2) * Math.SQRT2) - 6)).toBeLessThan(0.5);
  });

  test('limiter keeps a +12 dB boosted full-scale signal at or below 0 dBFS', async () => {
    const s = transparent();
    s.chain.eq.limiter = true;
    s.chain.eq.preampDb = 12;
    s.chain.eq.bandsDb = Array(10).fill(12);
    const out = await render(2, async (e) => e.play(await track('full-scale.wav')), s);
    expect(peak(out.getChannelData(0))).toBeLessThanOrEqual(1);
    expect(peak(out.getChannelData(1))).toBeLessThanOrEqual(1);
  });

  test('ReplayGain applies the tagged track gain within 0.1 dB', async () => {
    const s = transparent();
    s.replayGain.enabled = true;
    const t = await track('tagged.flac', true);
    const on = await render(2, async (e) => e.play(t), s);
    const off = await render(2, async (e) => e.play(t));
    const diff = db(rms(on.getChannelData(0), R / 2, R) / rms(off.getChannelData(0), R / 2, R));
    expect(Math.abs(diff - -3.5)).toBeLessThan(0.1);
  });

  test('mono mixes a left-only signal to both speakers', async () => {
    const s = transparent();
    s.chain.mono = true;
    const out = await render(1, async (e) => e.play(await track('tone1k-left.wav')), s);
    const l = rms(out.getChannelData(0), R / 4, R / 2),
      r = rms(out.getChannelData(1), R / 4, R / 2);
    expect(r).toBeGreaterThan(0.1);
    expect(Math.abs(db(l / r))).toBeLessThan(0.01);
  });

  test('balance fully right silences the left speaker', async () => {
    const s = transparent();
    s.chain.balance = 1;
    const out = await render(1, async (e) => e.play(await track('tone1k.wav')), s);
    expect(rms(out.getChannelData(0), R / 4, R / 2)).toBeLessThan(1e-6);
    expect(rms(out.getChannelData(1), R / 4, R / 2)).toBeGreaterThan(0.1);
  });

  test('volume curve: 50 % with the dB curve is 20 dB down (40 dB range)', async () => {
    const s = transparent();
    s.chain.volume = 0.5;
    s.chain.volumeCurve = 'db';
    const out = await render(1, async (e) => e.play(await track('tone1k.wav')), s);
    expect(db(rms(out.getChannelData(0), R / 4, R / 2) * Math.SQRT2) - -6).toBeCloseTo(-20, 1);
  });

  test('performance: full chain renders 60 s of audio in well under 2 % of real time per second', async () => {
    const s = transparent();
    s.chain.eq.limiter = true;
    s.chain.eq.bandsDb = [3, 2, 1, 0, -1, -2, 1, 2, 3, 4];
    const bytes = await fetchBytes('tone1k.wav');
    const t0 = performance.now();
    await render(
      60,
      async (e) => {
        e.setSettings(s);
        await e.play({ key: 'x', load: async () => bytes.slice(0) });
      },
      s,
      (t) => ({ ...t, key: t.key + '+' }),
    );
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(60_000 * 0.02 * 2); // includes decoding; generous for CI machines
  });
});
