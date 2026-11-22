/**
 * Dev server only: the converter routes of scripts/dev-music.ts, standing in for the desktop app's FFmpeg
 * (src-tauri/src/convert.rs), so converted playback can be tested in a plain browser. Works for files served
 * under /dev-music/ and /dev-assets/.
 */
import { parseProbe, type ByteReader, type Converter } from '../audio/convert';

const q = (location: string) => encodeURIComponent(location);

export const devConverter: Converter = {
  async probe(location) {
    const r = await fetch(`/dev-probe?f=${q(location)}`);
    if (!r.ok) throw new Error(`probe failed: ${await r.text()}`);
    return parseProbe(await r.text());
  },
  async open(location, startSec, opts): Promise<ByteReader> {
    const ac = new AbortController();
    const url =
      `/dev-convert?f=${q(location)}&t=${startSec}` +
      `&copy=${opts.copyVideo ? 1 : 0}&video=${opts.hasVideo ? 1 : 0}`;
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok || !r.body) throw new Error(`convert failed: ${await r.text()}`);
    const start = Number(r.headers.get('x-start') ?? startSec);
    const reader = r.body.getReader();
    return {
      start: Number.isFinite(start) ? start : startSec,
      async read() {
        try {
          const { value, done } = await reader.read();
          return done ? null : value;
        } catch (e) {
          if (ac.signal.aborted) return null;
          throw e;
        }
      },
      close: () => ac.abort(),
    };
  },
};
