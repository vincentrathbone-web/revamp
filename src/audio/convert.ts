/**
 * Files the web view can't play by itself (AVI, WMV, FLV, MPEG, WMA...) go through FFmpeg, which the desktop
 * app bundles: it turns them into fragmented MP4 that `MseFeed` streams into the media element.
 * This file holds the pure parts: what ffprobe says about a file, whether it needs converting, and the codec
 * string of the converted stream.
 */
import type { TrackInfo } from './tags';

export interface MediaProbe {
  durationSec: number;
  /** ffprobe's container name list, e.g. "avi" or "mov,mp4,m4a,3gp,3g2,mj2". */
  container: string;
  video?: { codec: string; width: number; height: number; pixFmt: string };
  audio?: { codec: string; channels: number; sampleRate: number };
  bitrateKbps: number;
  /** Container tags, keys in lower case (title, artist, album, genre, date, track...). */
  tags: Record<string, string>;
}

/** Converted output being read: `start` is where its timeline begins, in seconds into the file. */
export interface ByteReader {
  readonly start: number;
  /** The next bytes, or null at the end. */
  read(): Promise<Uint8Array | null>;
  close(): void;
}

export interface Converter {
  probe(location: string): Promise<MediaProbe>;
  open(
    location: string,
    startSec: number,
    opts: { copyVideo: boolean; hasVideo: boolean },
  ): Promise<ByteReader>;
}

/** One file ready to stream through the converter. */
export interface ConvertSource {
  durationSec: number;
  hasVideo: boolean;
  open(startSec: number): Promise<ByteReader>;
}

/** Always converted: the web view can't open these containers at all. */
export const CONVERT_EXTENSIONS = [
  'avi',
  'wmv',
  'asf',
  'flv',
  'f4v',
  'mpg',
  'mpeg',
  'm1v',
  'm2v',
  'vob',
  'ts',
  'm2ts',
  'mts',
  '3gp',
  '3g2',
  'divx',
  'rm',
  'rmvb',
  'ogm',
  'dv',
  'wtv',
  'wma',
  'ac3',
  'ape',
  'mka',
  'wv',
  'amr',
];
/** Sound-only formats among them (no video window). */
export const CONVERT_AUDIO_EXTENSIONS = ['wma', 'ac3', 'ape', 'mka', 'wv', 'amr'];
/** Containers the web view opens, but whose codecs it may not know (HEVC, MPEG-4 Part 2, AC-3...): ffprobe decides. */
export const PROBE_EXTENSIONS = ['mkv', 'mov', 'm4v'];

const NATIVE_VIDEO = ['h264', 'vp8', 'vp9', 'av1', 'theora'];
const NATIVE_AUDIO = ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_s24le', 'pcm_f32le', 'alac'];
/** 8-bit 4:2:0 only: Chromium can't show 10-bit or 4:4:4 H.264. */
const NATIVE_PIX = ['yuv420p', 'yuvj420p'];

interface FfStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  channels?: number;
  sample_rate?: string;
  disposition?: { attached_pic?: number };
}

/** Reads `ffprobe -print_format json -show_format -show_streams` output. */
export function parseProbe(json: string): MediaProbe {
  const j = JSON.parse(json) as {
    streams?: FfStream[];
    format?: { format_name?: string; duration?: string; bit_rate?: string; tags?: Record<string, string> };
  };
  const streams = j.streams ?? [];
  // cover art inside music files shows up as a one-frame video stream
  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const a = streams.find((s) => s.codec_type === 'audio');
  const d = Number(j.format?.duration);
  const tags: Record<string, string> = {};
  for (const [k, val] of Object.entries(j.format?.tags ?? {})) tags[k.toLowerCase()] = String(val);
  const br = Number(j.format?.bit_rate);
  return {
    bitrateKbps: Number.isFinite(br) && br > 0 ? Math.round(br / 1000) : 0,
    tags,
    durationSec: Number.isFinite(d) && d > 0 ? d : 0,
    container: j.format?.format_name ?? '',
    video: v
      ? { codec: v.codec_name ?? '', width: v.width ?? 0, height: v.height ?? 0, pixFmt: v.pix_fmt ?? '' }
      : undefined,
    audio: a
      ? { codec: a.codec_name ?? '', channels: a.channels ?? 0, sampleRate: Number(a.sample_rate ?? 0) }
      : undefined,
  };
}

/** What the playlist shows for a file the converter read. */
export function probeTrackInfo(p: MediaProbe): TrackInfo {
  const t = p.tags;
  const info: TrackInfo = {
    title: t.title,
    artist: t.artist ?? t.author,
    album: t.album,
    albumArtist: t.album_artist,
    track: t.track,
    year: t.date ?? t.year,
    genre: t.genre,
    comment: t.comment,
    durationSec: p.durationSec || undefined,
    sampleRate: p.audio?.sampleRate || undefined,
    channels: p.audio?.channels || undefined,
    bitrateKbps: p.bitrateKbps || undefined,
    format: (p.container.split(',')[0] ?? '').toUpperCase() || undefined,
    hasVideo: !!p.video,
  };
  for (const k of Object.keys(info) as (keyof TrackInfo)[])
    if (info[k] === undefined || info[k] === '') delete info[k];
  return info;
}

const extOf = (name: string) => name.split(/[?#]/)[0]!.toLowerCase().split('.').pop() ?? '';

/** Will this file go to the converter? (`probe` is only needed for the PROBE_EXTENSIONS.) */
export function mayConvert(location: string): boolean {
  const e = extOf(location);
  return CONVERT_EXTENSIONS.includes(e) || PROBE_EXTENSIONS.includes(e);
}

/** The web view can't play this file as it is. */
export function needsConversion(location: string, p: MediaProbe): boolean {
  if (CONVERT_EXTENSIONS.includes(extOf(location))) return true;
  if (p.video && (!NATIVE_VIDEO.includes(p.video.codec) || !nativePix(p))) return true;
  return !!p.audio && !NATIVE_AUDIO.includes(p.audio.codec);
}

const nativePix = (p: MediaProbe) => !p.video?.pixFmt || NATIVE_PIX.includes(p.video.pixFmt);

/** The picture can be copied as it is (already H.264 the player can show): fast and lossless. */
export const canCopyVideo = (p: MediaProbe) => p.video?.codec === 'h264' && nativePix(p);

// ------------------------------------------------------------- MP4 boxes
interface Box {
  type: string;
  start: number;
  body: number;
  end: number;
}

function boxes(b: Uint8Array, from: number, to: number): Box[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Box[] = [];
  let o = from;
  while (o + 8 <= to) {
    let size = dv.getUint32(o);
    let head = 8;
    if (size === 1) {
      if (o + 16 > to) break;
      size = Number(dv.getBigUint64(o + 8));
      head = 16;
    } else if (size === 0) size = to - o;
    if (size < head) break;
    const type = String.fromCharCode(b[o + 4]!, b[o + 5]!, b[o + 6]!, b[o + 7]!);
    out.push({ type, start: o, body: o + head, end: o + size });
    o += size;
  }
  return out;
}

/** Length of the init segment (everything up to the end of `moov`) once it has fully arrived, else -1. */
export function initSegmentEnd(b: Uint8Array): number {
  for (const box of boxes(b, 0, b.length)) {
    if (box.end > b.length) return -1;
    if (box.type === 'moov') return box.end;
  }
  return -1;
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

/** RFC 6381 codec strings of the tracks in an MP4 init segment, e.g. ["avc1.64001f", "mp4a.40.2"]. */
export function codecsFromInit(b: Uint8Array): string[] {
  const out: string[] = [];
  const find = (from: number, to: number, path: string[]): Box | undefined => {
    let range: Box | undefined;
    let s = from,
      e = to;
    for (const t of path) {
      range = boxes(b, s, e).find((x) => x.type === t);
      if (!range) return undefined;
      s = range.body;
      e = Math.min(range.end, to);
    }
    return range;
  };
  const moov = boxes(b, 0, b.length).find((x) => x.type === 'moov');
  if (!moov) return out;
  for (const trak of boxes(b, moov.body, moov.end).filter((x) => x.type === 'trak')) {
    const stsd = find(trak.body, trak.end, ['mdia', 'minf', 'stbl', 'stsd']);
    if (!stsd) continue;
    // stsd: version/flags (4) + entry count (4), then sample entries
    const entry = boxes(b, stsd.body + 8, stsd.end)[0];
    if (!entry) continue;
    if (entry.type === 'avc1' || entry.type === 'avc3') {
      // visual sample entry: 78 bytes before its child boxes
      const avcC = boxes(b, entry.body + 78, entry.end).find((x) => x.type === 'avcC');
      out.push(
        avcC
          ? `${entry.type}.${hex2(b[avcC.body + 1]!)}${hex2(b[avcC.body + 2]!)}${hex2(b[avcC.body + 3]!)}`
          : `${entry.type}.42e01e`,
      );
    } else if (entry.type === 'mp4a') {
      // audio sample entry: 28 bytes before its child boxes
      const esds = boxes(b, entry.body + 28, entry.end).find((x) => x.type === 'esds');
      out.push(`mp4a.40.${esds ? aacObjectType(b, esds.body + 4, esds.end) : 2}`);
    } else out.push(entry.type);
  }
  return out;
}

/** The AAC object type in an esds box's DecoderSpecificInfo (2 = AAC-LC, 5 = HE-AAC...). */
function aacObjectType(b: Uint8Array, from: number, to: number): number {
  let o = from;
  const len = () => {
    let n = 0;
    for (let i = 0; i < 4 && o < to; i++) {
      const c = b[o++]!;
      n = (n << 7) | (c & 0x7f);
      if (!(c & 0x80)) break;
    }
    return n;
  };
  while (o < to) {
    const tag = b[o++]!;
    const n = len();
    if (tag === 0x03)
      o += 3; // ES_Descriptor: id + flags (no optional fields from FFmpeg)
    else if (tag === 0x04)
      o += 13; // DecoderConfigDescriptor header
    else if (tag === 0x05) {
      const aot = b[o]! >> 3;
      return aot || 2;
    } else o += n;
  }
  return 2;
}
