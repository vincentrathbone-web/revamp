/** The converter's pure parts: ffprobe output, what needs converting, codec strings, init segments. */
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  canCopyVideo,
  codecsFromInit,
  initSegmentEnd,
  mayConvert,
  needsConversion,
  parseProbe,
  probeTrackInfo,
} from '../../src/audio/convert';
import { formats, isMedia, mediaExtensions } from '../../src/platform/platform';

const probe = (streams: object[], format: object = {}) =>
  parseProbe(JSON.stringify({ streams, format: { format_name: 'avi', duration: '10.0', ...format } }));

describe('ffprobe output', () => {
  test('picture, sound, duration and tags', () => {
    const p = probe(
      [
        { codec_type: 'video', codec_name: 'mpeg4', width: 320, height: 240, pix_fmt: 'yuv420p' },
        { codec_type: 'audio', codec_name: 'mp3', channels: 2, sample_rate: '44100' },
      ],
      { bit_rate: '406000', tags: { TITLE: 'Clip', Artist: 'Lab' } },
    );
    expect(p).toMatchObject({
      durationSec: 10,
      container: 'avi',
      bitrateKbps: 406,
      video: { codec: 'mpeg4', width: 320, height: 240 },
      audio: { codec: 'mp3', channels: 2, sampleRate: 44100 },
      tags: { title: 'Clip', artist: 'Lab' },
    });
    expect(probeTrackInfo(p)).toEqual({
      title: 'Clip',
      artist: 'Lab',
      durationSec: 10,
      sampleRate: 44100,
      channels: 2,
      bitrateKbps: 406,
      format: 'AVI',
      hasVideo: true,
    });
  });

  test('cover art is not a picture track', () => {
    const p = probe([
      { codec_type: 'audio', codec_name: 'wmav2', channels: 2, sample_rate: '44100' },
      { codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
    ]);
    expect(p.video).toBeUndefined();
    expect(probeTrackInfo(p).hasVideo).toBe(false);
  });

  test('missing or broken values', () => {
    const p = parseProbe('{"streams":[],"format":{"duration":"N/A"}}');
    expect(p.durationSec).toBe(0);
    expect(p.video).toBeUndefined();
    expect(p.audio).toBeUndefined();
  });
});

describe('what goes through the converter', () => {
  const h264 = { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, pix_fmt: 'yuv420p' };
  const aac = { codec_type: 'audio', codec_name: 'aac', channels: 2, sample_rate: '48000' };

  test('old containers always; MKV/MOV only with codecs the player lacks', () => {
    for (const n of ['a.avi', 'D:\\x\\a.WMV', 'a.flv', 'a.mpg', 'a.vob', 'a.ts', 'a.wma', 'a.mkv', 'a.mov'])
      expect(mayConvert(n)).toBe(true);
    for (const n of ['a.mp3', 'a.mp4', 'a.webm', 'a.flac']) expect(mayConvert(n)).toBe(false);

    expect(needsConversion('a.flv', probe([h264, aac]))).toBe(true);
    expect(needsConversion('a.mkv', probe([h264, aac]))).toBe(false);
    expect(needsConversion('a.mkv', probe([{ ...h264, codec_name: 'hevc' }, aac]))).toBe(true);
    expect(needsConversion('a.mkv', probe([h264, { ...aac, codec_name: 'ac3' }]))).toBe(true);
    expect(needsConversion('a.mkv', probe([{ ...h264, pix_fmt: 'yuv420p10le' }, aac]))).toBe(true);
    expect(needsConversion('a.mov', probe([{ ...h264, codec_name: 'prores' }]))).toBe(true);
  });

  test('the picture is copied only when it is H.264 the player shows', () => {
    expect(canCopyVideo(probe([h264, aac]))).toBe(true);
    expect(canCopyVideo(probe([{ ...h264, pix_fmt: 'yuv420p10le' }]))).toBe(false);
    expect(canCopyVideo(probe([{ ...h264, codec_name: 'mpeg4' }]))).toBe(false);
    expect(canCopyVideo(probe([aac]))).toBe(false);
  });

  test('the old formats count as playable only when there is a converter', () => {
    expect(isMedia('a.avi')).toBe(false);
    formats.convert = true;
    try {
      expect(isMedia('a.avi')).toBe(true);
      expect(isMedia('a.wma')).toBe(true);
      expect(mediaExtensions()).toContain('wmv');
    } finally {
      formats.convert = false;
    }
    expect(mediaExtensions()).not.toContain('wmv');
  });
});

describe('MP4 init segments', () => {
  const box = (type: string, body: Uint8Array) => {
    const b = new Uint8Array(8 + body.length);
    new DataView(b.buffer).setUint32(0, b.length);
    b.set(
      [...type].map((c) => c.charCodeAt(0)),
      4,
    );
    b.set(body, 8);
    return b;
  };
  const cat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) (out.set(p, o), (o += p.length));
    return out;
  };

  test('known only once the whole moov box has arrived', () => {
    const init = cat(box('ftyp', new Uint8Array(16)), box('moov', new Uint8Array(40)));
    const media = box('moof', new Uint8Array(20));
    const all = cat(init, media);
    expect(initSegmentEnd(all)).toBe(init.length);
    expect(initSegmentEnd(all.subarray(0, init.length - 1))).toBe(-1);
    expect(initSegmentEnd(all.subarray(0, 10))).toBe(-1);
  });

  test('codec strings of a real file (H.264 + AAC-LC)', () => {
    const mp4 = new Uint8Array(readFileSync('test-assets/generated/video.mp4'));
    const codecs = codecsFromInit(mp4);
    expect(codecs).toHaveLength(2);
    expect(codecs).toContain('mp4a.40.2');
    expect(codecs.find((c) => c.startsWith('avc1.'))).toMatch(/^avc1\.[0-9a-f]{6}$/);
  });
});
