/**
 * Old formats through the converter, in a real browser: the dev server's FFmpeg routes (scripts/dev-music.ts,
 * same arguments as the desktop app) stream fragmented MP4 that MseFeed plays in a media element.
 * Needs `npm run assets` (clip.avi / clip.wmv / clip.flv / tone.wma) and the LGPL FFmpeg in the toolshed.
 */
import { afterEach, expect, test } from 'vitest';
import { canCopyVideo, type ConvertSource } from '../../src/audio/convert';
import { MseFeed } from '../../src/audio/mse';
import { devConverter } from '../../src/platform/dev-convert';

let cleanup: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanup) c();
  cleanup = [];
});

async function source(name: string): Promise<{ src: ConvertSource; copy: boolean }> {
  const loc = `/dev-assets/${name}`;
  const p = await devConverter.probe(loc);
  const opts = { copyVideo: canCopyVideo(p), hasVideo: !!p.video };
  return {
    src: { durationSec: p.durationSec, hasVideo: !!p.video, open: (t) => devConverter.open(loc, t, opts) },
    copy: opts.copyVideo,
  };
}

function element(video: boolean): HTMLMediaElement {
  const el = document.createElement(video ? 'video' : 'audio');
  el.muted = true;
  document.body.appendChild(el);
  return el;
}

function start(el: HTMLMediaElement, src: ConvertSource): MseFeed {
  const feed = new MseFeed(el, src);
  const errors: unknown[] = [];
  feed.onerror = (e) => errors.push(e);
  el.src = feed.url;
  cleanup.push(() => {
    feed.dispose();
    el.pause();
    el.removeAttribute('src');
    el.load();
    el.remove();
    expect(errors).toEqual([]);
  });
  return feed;
}

const until = async (what: string, ok: () => boolean, ms = 15000) => {
  const end = performance.now() + ms;
  while (!ok()) {
    if (performance.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

for (const [name, copied] of [
  ['clip.avi', false],
  ['clip.wmv', false],
  ['clip.flv', true],
] as const) {
  test(`${name} plays, seeks outside the buffer and plays on`, async () => {
    const { src, copy } = await source(name);
    expect(copy).toBe(copied); // FLV holds H.264 already: copied, not encoded again
    expect(src.hasVideo).toBe(true);
    expect(src.durationSec).toBeCloseTo(10, 0);
    const el = element(true) as HTMLVideoElement;
    const feed = start(el, src);
    await el.play();
    await until('playback', () => el.currentTime > 0.5);
    expect(feed.mime).toMatch(/^video\/mp4; codecs="avc1\.[0-9a-f]{6}, mp4a\.40\.2"$/);
    expect([el.videoWidth, el.videoHeight]).toEqual([320, 240]);
    expect(el.duration).toBeCloseTo(10, 0);

    // jump forward; the converter restarts there (at the key frame before it, when copying)
    el.currentTime = 6.5;
    await until('seek', () => !el.seeking && el.currentTime > 6.6);
    expect(el.currentTime).toBeLessThan(8.5);
    await until('the end', () => el.ended, 10000);
  });
}

test('sound-only WMA plays as an audio stream', async () => {
  const { src } = await source('tone.wma');
  expect(src.hasVideo).toBe(false);
  // a muted <video> element: the test browser only lets muted video start without a click
  const el = element(true);
  const feed = start(el, src);
  await el.play();
  await until('playback', () => el.currentTime > 0.5);
  expect(feed.mime).toBe('audio/mp4; codecs="mp4a.40.2"');
  el.currentTime = 8;
  await until('the end', () => el.ended, 10000);
});

test('a start offset is honoured (resume where the last session stopped)', async () => {
  const { src } = await source('clip.avi');
  const el = element(true);
  start(el, src);
  el.currentTime = 4;
  await el.play();
  await until('playback', () => el.currentTime > 4.3);
  expect(el.currentTime).toBeLessThan(6);
});
