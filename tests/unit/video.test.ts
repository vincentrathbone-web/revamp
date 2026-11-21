/** Video support that runs without a browser: telling video from audio files, and the video window's controls. */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { bytesSource, readTrackInfo } from '../../src/audio/tags';
import { isMedia, playsAsVideo } from '../../src/platform/platform';
import { defaultSkin } from '../../src/skin/default-skin';
import { VideoWindow } from '../../src/ui/video-window';
import { fakeUi } from './fake-ui';

const asset = (n: string) => new Uint8Array(readFileSync(`test-assets/generated/${n}`));
const info = (n: string) => readTrackInfo(bytesSource(asset(n)));

describe('finding the picture track', () => {
  test('MP4 with H.264 + AAC: video, and the sample rate comes from the sound track', async () => {
    const i = await info('video.mp4');
    expect(i).toMatchObject({ format: 'MP4', hasVideo: true, sampleRate: 44100, channels: 2 });
    expect(i.durationSec).toBeCloseTo(2, 1);
  });
  test('WebM (VP9 + Opus) and Matroska (H.264 + AAC)', async () => {
    const w = await info('video.webm');
    expect(w).toMatchObject({ format: 'WebM', hasVideo: true, channels: 2 });
    expect(w.durationSec).toBeCloseTo(2, 1);
    expect(await info('video.mkv')).toMatchObject({ format: 'MKV', hasVideo: true });
  });
  test('audio-only files say so', async () => {
    expect(await info('audio-only.webm')).toMatchObject({ format: 'WebM', hasVideo: false });
    expect(await info('tagged.m4a')).toMatchObject({ format: 'M4A', hasVideo: false, sampleRate: 44100 });
    expect((await info('tagged.mp3')).hasVideo).toBeUndefined();
  });
  test('cut-off Matroska files never throw', async () => {
    const full = asset('video.mkv');
    for (const cut of [4, 40, 400, 4000]) await readTrackInfo(bytesSource(full.subarray(0, cut)));
  });
});

describe('video or audio?', () => {
  test('the header wins; otherwise the extension decides', () => {
    expect(playsAsVideo('clip.mkv', undefined)).toBe(true);
    expect(playsAsVideo('D:\\Films\\clip.MOV', undefined)).toBe(true);
    expect(playsAsVideo('song.mp4', undefined)).toBe(false); // .mp4 is often music
    expect(playsAsVideo('clip.mp4', true)).toBe(true);
    expect(playsAsVideo('music.mkv', false)).toBe(false);
    expect(playsAsVideo('https://x/a.m4v?token=1', undefined)).toBe(true);
  });
  test('video files can be added', () => {
    for (const n of ['a.mkv', 'a.m4v', 'a.mov', 'a.ogv', 'a.mp4', 'a.webm']) expect(isMedia(n)).toBe(true);
    expect(isMedia('a.txt')).toBe(false);
  });
});

describe('video window', () => {
  test('resizing snaps to 25 x 29 steps and never goes below 275 x 116', () => {
    const { ui, calls } = fakeUi(defaultSkin());
    const w = new VideoWindow(ui);
    w.render(true);
    const grip = w.controls.find((c) => c.id === 'resize')!;
    grip.down!({ x: 270, y: 228 }, { screenX: 500, screenY: 500 } as PointerEvent);
    w.resizeMove(500 + 60, 500 + 40, 1);
    expect(calls.at(-1)).toBe('setVideoSize(325,261)');
    w.resizeMove(0, 0, 1);
    expect(calls.at(-1)).toBe('setVideoSize(275,116)');
  });
  test('the picture area sits inside the frame', () => {
    const { ui } = fakeUi(defaultSkin(), { videoSize: { w: 300, h: 261 } });
    expect(new VideoWindow(ui).pictureRect).toEqual({ x: 11, y: 20, w: 281, h: 203 });
  });
});
