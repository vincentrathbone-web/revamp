/**
 * Reads track info (tags, ReplayGain, duration, format) from audio files without decoding them.
 * Supports ID3v2.2/2.3/2.4 + ID3v1 + MPEG frame headers (MP3), FLAC, Ogg Vorbis/Opus, MP4/M4A and WAV.
 * Written from the public format specifications.
 */
import { parseGainText, type ReplayGainTags } from './replaygain';

export interface TrackInfo {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  track?: string;
  year?: string;
  genre?: string;
  comment?: string;
  replayGain?: ReplayGainTags;
  durationSec?: number;
  sampleRate?: number;
  channels?: number;
  bitrateKbps?: number;
  format?: string;
}

export interface ByteSource {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export function bytesSource(data: Uint8Array): ByteSource {
  return {
    size: data.length,
    read: async (o, l) => data.subarray(Math.max(0, o), Math.min(data.length, o + l)),
  };
}

export function blobSource(blob: Blob): ByteSource {
  return {
    size: blob.size,
    read: async (o, l) => new Uint8Array(await blob.slice(o, o + l).arrayBuffer()),
  };
}

const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
const be32 = (b: Uint8Array, o: number) =>
  ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const le32 = (b: Uint8Array, o: number) =>
  (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
const syncsafe = (b: Uint8Array, o: number) =>
  (b[o]! << 21) | (b[o + 1]! << 14) | (b[o + 2]! << 7) | b[o + 3]!;

/** Applies a "name=value" tag (Vorbis-comment style keys) to the info. */
function applyKey(info: TrackInfo, rawKey: string, value: string): void {
  const key = rawKey.toUpperCase();
  const v = value.trim();
  if (!v) return;
  const rg = (info.replayGain ??= {});
  switch (key) {
    case 'TITLE':
      info.title ??= v;
      break;
    case 'ARTIST':
      info.artist ??= v;
      break;
    case 'ALBUM':
      info.album ??= v;
      break;
    case 'ALBUMARTIST':
    case 'ALBUM ARTIST':
      info.albumArtist ??= v;
      break;
    case 'TRACKNUMBER':
    case 'TRACK':
      info.track ??= v;
      break;
    case 'DATE':
    case 'YEAR':
      info.year ??= v.slice(0, 4);
      break;
    case 'GENRE':
      info.genre ??= v;
      break;
    case 'COMMENT':
    case 'DESCRIPTION':
      info.comment ??= v;
      break;
    case 'REPLAYGAIN_TRACK_GAIN':
      rg.trackGain = parseGainText(v);
      break;
    case 'REPLAYGAIN_TRACK_PEAK':
      rg.trackPeak = parseGainText(v);
      break;
    case 'REPLAYGAIN_ALBUM_GAIN':
      rg.albumGain = parseGainText(v);
      break;
    case 'REPLAYGAIN_ALBUM_PEAK':
      rg.albumPeak = parseGainText(v);
      break;
  }
}

function tidy(info: TrackInfo): TrackInfo {
  if (info.replayGain && Object.values(info.replayGain).every((x) => x === undefined)) delete info.replayGain;
  return info;
}

// ---------------------------------------------------------------- Vorbis comments (FLAC, Ogg)
function parseVorbisComment(b: Uint8Array, o: number, info: TrackInfo): void {
  if (o + 4 > b.length) return;
  const vendorLen = le32(b, o);
  o += 4 + vendorLen;
  if (o + 4 > b.length) return;
  const count = le32(b, o);
  o += 4;
  for (let i = 0; i < count && o + 4 <= b.length; i++) {
    const len = le32(b, o);
    o += 4;
    const s = utf8.decode(b.subarray(o, Math.min(b.length, o + len)));
    o += len;
    const eq = s.indexOf('=');
    if (eq > 0) applyKey(info, s.slice(0, eq), s.slice(eq + 1));
  }
}

// ---------------------------------------------------------------- ID3v2
function decodeText(enc: number, d: Uint8Array): string {
  let s: string;
  if (enc === 0) s = latin1.decode(d);
  else if (enc === 3) s = utf8.decode(d);
  else if (enc === 1 || enc === 2) {
    let le = enc === 1;
    let start = 0;
    if (enc === 1 && d.length >= 2) {
      if (d[0] === 0xff && d[1] === 0xfe) ((le = true), (start = 2));
      else if (d[0] === 0xfe && d[1] === 0xff) ((le = false), (start = 2));
    }
    s = new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(
      d.subarray(start, start + ((d.length - start) & ~1)),
    );
  } else s = latin1.decode(d);
  return s.replace(/\0+$/, '');
}

/** Splits encoded text at its terminator (1 or 2 zero bytes depending on encoding). */
function splitTerm(enc: number, d: Uint8Array): [Uint8Array, Uint8Array] {
  const wide = enc === 1 || enc === 2;
  for (let i = 0; i + (wide ? 1 : 0) < d.length; i += wide ? 2 : 1) {
    if (d[i] === 0 && (!wide || d[i + 1] === 0)) return [d.subarray(0, i), d.subarray(i + (wide ? 2 : 1))];
  }
  return [d, new Uint8Array(0)];
}

function unsync(d: Uint8Array): Uint8Array {
  const out = new Uint8Array(d.length);
  let n = 0;
  for (let i = 0; i < d.length; i++) {
    out[n++] = d[i]!;
    if (d[i] === 0xff && d[i + 1] === 0x00) i++;
  }
  return out.subarray(0, n);
}

const ID3V1_GENRES = [
  'Blues',
  'Classic Rock',
  'Country',
  'Dance',
  'Disco',
  'Funk',
  'Grunge',
  'Hip-Hop',
  'Jazz',
  'Metal',
  'New Age',
  'Oldies',
  'Other',
  'Pop',
  'R&B',
  'Rap',
  'Reggae',
  'Rock',
  'Techno',
  'Industrial',
  'Alternative',
  'Ska',
  'Death Metal',
  'Pranks',
  'Soundtrack',
  'Euro-Techno',
  'Ambient',
  'Trip-Hop',
  'Vocal',
  'Jazz+Funk',
  'Fusion',
  'Trance',
  'Classical',
  'Instrumental',
  'Acid',
  'House',
  'Game',
  'Sound Clip',
  'Gospel',
  'Noise',
  'Alternative Rock',
  'Bass',
  'Soul',
  'Punk',
  'Space',
  'Meditative',
  'Instrumental Pop',
  'Instrumental Rock',
  'Ethnic',
  'Gothic',
  'Darkwave',
  'Techno-Industrial',
  'Electronic',
  'Pop-Folk',
  'Eurodance',
  'Dream',
  'Southern Rock',
  'Comedy',
  'Cult',
  'Gangsta',
  'Top 40',
  'Christian Rap',
  'Pop/Funk',
  'Jungle',
  'Native American',
  'Cabaret',
  'New Wave',
  'Psychedelic',
  'Rave',
  'Showtunes',
  'Trailer',
  'Lo-Fi',
  'Tribal',
  'Acid Punk',
  'Acid Jazz',
  'Polka',
  'Retro',
  'Musical',
  'Rock & Roll',
  'Hard Rock',
];

function genreText(v: string): string {
  const m = /^\((\d+)\)(.*)$/.exec(v) ?? /^(\d+)$/.exec(v);
  if (m) {
    const g = ID3V1_GENRES[Number(m[1])];
    return (m[2]?.trim() || g) ?? v;
  }
  return v;
}

/** Parses an ID3v2 tag at offset 0 of `b`. Returns the tag's total size (0 if none). */
function parseId3v2(b: Uint8Array, info: TrackInfo): number {
  if (b.length < 10 || ascii(b, 0, 3) !== 'ID3') return 0;
  const ver = b[3]!;
  const flags = b[5]!;
  const size = syncsafe(b, 6);
  const total = 10 + size + (flags & 0x10 ? 10 : 0);
  let tag = b.subarray(10, Math.min(b.length, 10 + size));
  if (ver < 4 && flags & 0x80) tag = unsync(tag);
  let o = 0;
  if (flags & 0x40) o = ver === 4 ? syncsafe(tag, 0) : be32(tag, 0) + 4; // extended header
  const idLen = ver === 2 ? 3 : 4;
  const hdrLen = ver === 2 ? 6 : 10;
  const map: Record<string, keyof TrackInfo> =
    ver === 2
      ? {
          TT2: 'title',
          TP1: 'artist',
          TAL: 'album',
          TP2: 'albumArtist',
          TRK: 'track',
          TYE: 'year',
          TCO: 'genre',
        }
      : {
          TIT2: 'title',
          TPE1: 'artist',
          TALB: 'album',
          TPE2: 'albumArtist',
          TRCK: 'track',
          TYER: 'year',
          TDRC: 'year',
          TCON: 'genre',
        };
  while (o + hdrLen <= tag.length) {
    const id = ascii(tag, o, idLen);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const fsize =
      ver === 2
        ? (tag[o + 3]! << 16) | (tag[o + 4]! << 8) | tag[o + 5]!
        : ver === 4
          ? syncsafe(tag, o + 4)
          : be32(tag, o + 4);
    const fflags = ver === 2 ? 0 : tag[o + 9]!;
    let d = tag.subarray(o + hdrLen, Math.min(tag.length, o + hdrLen + fsize));
    o += hdrLen + fsize;
    if (ver === 4) {
      if (fflags & 0x01) d = d.subarray(4); // data length indicator
      if (fflags & 0x02) d = unsync(d);
      if (fflags & 0x0c) continue; // compressed/encrypted: skip
    }
    if (d.length < 1) continue;
    const enc = d[0]!;
    const field = map[id];
    if (field) {
      let v = decodeText(enc, d.subarray(1)).split('\0')[0]!.trim();
      if (field === 'genre') v = genreText(v);
      if (field === 'year') v = v.slice(0, 4);
      if (v && info[field] === undefined) (info as Record<string, unknown>)[field] = v;
    } else if (id === 'TXXX' || id === 'TXX') {
      const [desc, val] = splitTerm(enc, d.subarray(1));
      applyKey(info, decodeText(enc, desc), decodeText(enc, val));
    } else if ((id === 'COMM' || id === 'COM') && d.length > 4) {
      const [desc, val] = splitTerm(enc, d.subarray(4));
      const descText = decodeText(enc, desc);
      if (!descText || descText === 'description') applyKey(info, 'COMMENT', decodeText(enc, val));
    }
  }
  return total;
}

function parseId3v1(b: Uint8Array, info: TrackInfo): void {
  if (b.length < 128) return;
  const t = b.subarray(b.length - 128);
  if (ascii(t, 0, 3) !== 'TAG') return;
  const str = (o: number, n: number) =>
    latin1
      .decode(t.subarray(o, o + n))
      .replace(/\0.*$/s, '')
      .trim();
  info.title ||= str(3, 30) || undefined;
  info.artist ||= str(33, 30) || undefined;
  info.album ||= str(63, 30) || undefined;
  info.year ||= str(93, 4) || undefined;
  info.comment ||= str(97, t[125] === 0 && t[126] ? 28 : 30) || undefined;
  if (t[125] === 0 && t[126]) info.track ||= String(t[126]);
  if (!info.genre && t[127]! < ID3V1_GENRES.length) info.genre = ID3V1_GENRES[t[127]!];
}

// ---------------------------------------------------------------- MPEG audio frames
const MPEG_BITRATES: Record<string, number[]> = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MPEG_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

function parseMpeg(
  b: Uint8Array,
  start: number,
  fileSize: number,
  tailTagBytes: number,
  info: TrackInfo,
): boolean {
  for (let o = start; o + 4 < Math.min(b.length, start + 65536); o++) {
    if (b[o] !== 0xff || (b[o + 1]! & 0xe0) !== 0xe0) continue;
    const verBits = (b[o + 1]! >> 3) & 3,
      layerBits = (b[o + 1]! >> 1) & 3;
    const brIdx = b[o + 2]! >> 4,
      srIdx = (b[o + 2]! >> 2) & 3;
    if (verBits === 1 || layerBits === 0 || brIdx === 0 || brIdx === 15 || srIdx === 3) continue;
    const layer = 4 - layerBits;
    const v1 = verBits === 3;
    const kbps = MPEG_BITRATES[v1 ? `1-${layer}` : layer === 1 ? '2-1' : '2-2']![brIdx]!;
    const rate = MPEG_RATES[verBits]![srIdx]!;
    const mono = b[o + 3]! >> 6 === 3;
    const spf = layer === 1 ? 384 : layer === 3 && !v1 ? 576 : 1152;
    const frameLen =
      layer === 1
        ? Math.floor((12 * kbps * 1000) / rate + ((b[o + 2]! >> 1) & 1)) * 4
        : Math.floor(((spf / 8) * kbps * 1000) / rate) + ((b[o + 2]! >> 1) & 1);
    // Make sure the next frame header follows, to avoid false syncs in junk data.
    const n = o + frameLen;
    if (n + 1 < b.length && (b[n] !== 0xff || (b[n + 1]! & 0xe0) !== 0xe0)) continue;
    info.format = `MP${layer}`;
    info.sampleRate = rate;
    info.channels = mono ? 1 : 2;
    // Xing/Info header holds the frame count for VBR files.
    const side = layer !== 3 ? 0 : v1 ? (mono ? 17 : 32) : mono ? 9 : 17;
    const x = o + 4 + side;
    const tagId = x + 4 <= b.length ? ascii(b, x, 4) : '';
    const audioBytes = fileSize - o - tailTagBytes;
    if ((tagId === 'Xing' || tagId === 'Info') && b[x + 7]! & 1) {
      const frames = be32(b, x + 8);
      info.durationSec = (frames * spf) / rate;
      info.bitrateKbps = tagId === 'Info' ? kbps : Math.round((audioBytes * 8) / info.durationSec / 1000);
    } else if (ascii(b, o + 36, 4) === 'VBRI') {
      const frames = be32(b, o + 36 + 14);
      info.durationSec = (frames * spf) / rate;
      info.bitrateKbps = Math.round((audioBytes * 8) / info.durationSec / 1000);
    } else {
      info.bitrateKbps = kbps;
      info.durationSec = (audioBytes * 8) / (kbps * 1000);
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- FLAC
function parseFlac(b: Uint8Array, start: number, info: TrackInfo, fileSize: number): void {
  info.format = 'FLAC';
  let o = start + 4;
  for (;;) {
    if (o + 4 > b.length) break;
    const last = b[o]! & 0x80,
      type = b[o]! & 0x7f;
    const len = (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!;
    const d = b.subarray(o + 4, o + 4 + len);
    if (type === 0 && d.length >= 18) {
      info.sampleRate = (d[10]! << 12) | (d[11]! << 4) | (d[12]! >> 4);
      info.channels = ((d[12]! >> 1) & 7) + 1;
      const total = (d[13]! & 0x0f) * 2 ** 32 + be32(d, 14);
      if (total && info.sampleRate) {
        info.durationSec = total / info.sampleRate;
        info.bitrateKbps = Math.round((fileSize * 8) / info.durationSec / 1000);
      }
    } else if (type === 4) parseVorbisComment(d, 0, info);
    o += 4 + len;
    if (last) break;
  }
}

// ---------------------------------------------------------------- Ogg
async function parseOgg(src: ByteSource, head: Uint8Array, info: TrackInfo): Promise<void> {
  // Join the payloads of the first pages: they hold the identification and comment packets.
  const parts: Uint8Array[] = [];
  let o = 0;
  let serial = -1;
  while (o + 27 <= head.length && ascii(head, o, 4) === 'OggS' && parts.length < 64) {
    const segs = head[o + 26]!;
    let len = 0;
    for (let i = 0; i < segs; i++) len += head[o + 27 + i]!;
    if (serial < 0) serial = le32(head, o + 14);
    parts.push(head.subarray(o + 27 + segs, o + 27 + segs + len));
    o += 27 + segs + len;
  }
  const data = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let p = 0;
  for (const part of parts) (data.set(part, p), (p += part.length));
  let preSkip = 0;
  if (ascii(data, 0, 8) === 'OpusHead') {
    info.format = 'Opus';
    info.channels = data[9];
    preSkip = data[10]! | (data[11]! << 8);
    info.sampleRate = 48000;
    const t = findBytes(data, 'OpusTags');
    if (t >= 0) parseVorbisComment(data, t + 8, info);
  } else if (ascii(data, 1, 6) === 'vorbis') {
    info.format = 'Vorbis';
    info.channels = data[11];
    info.sampleRate = le32(data, 12);
    const nominal = le32(data, 20);
    if (nominal > 0 && nominal < 2 ** 31) info.bitrateKbps = Math.round(nominal / 1000);
    const t = findBytes(data, '\x03vorbis');
    if (t >= 0) parseVorbisComment(data, t + 7, info);
  }
  // Duration from the granule position of the last page.
  const tailLen = Math.min(src.size, 65536);
  const tail = await src.read(src.size - tailLen, tailLen);
  for (let i = tail.length - 27; i >= 0; i--) {
    if (tail[i] === 0x4f && ascii(tail, i, 4) === 'OggS' && le32(tail, i + 14) === serial >>> 0) {
      const granule = le32(tail, i + 6) + le32(tail, i + 10) * 2 ** 32;
      if (info.sampleRate) {
        info.durationSec = (granule - preSkip) / info.sampleRate;
        if (!info.bitrateKbps) info.bitrateKbps = Math.round((src.size * 8) / info.durationSec / 1000);
      }
      break;
    }
  }
}

function findBytes(b: Uint8Array, s: string): number {
  outer: for (let i = 0; i + s.length <= b.length; i++) {
    for (let j = 0; j < s.length; j++) if (b[i + j] !== s.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}

// ---------------------------------------------------------------- MP4
async function parseMp4(src: ByteSource, info: TrackInfo): Promise<void> {
  info.format = 'M4A';
  // Find the moov box at the top level (it can be at the end of the file).
  let o = 0;
  let moov: Uint8Array | null = null;
  while (o + 8 <= src.size) {
    const h = await src.read(o, 16);
    let size = be32(h, 0);
    const type = ascii(h, 4, 4);
    if (size === 1) size = be32(h, 8) * 2 ** 32 + be32(h, 12);
    else if (size === 0) size = src.size - o;
    if (size < 8) break;
    if (type === 'moov') {
      if (size > 64 * 1024 * 1024) return;
      moov = await src.read(o, size);
      break;
    }
    o += size;
  }
  if (!moov) return;
  const walk = (
    b: Uint8Array,
    start: number,
    end: number,
    cb: (type: string, s: number, e: number) => void,
  ) => {
    let p = start;
    while (p + 8 <= end) {
      const size = be32(b, p);
      if (size < 8 || p + size > end) break;
      cb(ascii(b, p + 4, 4), p + 8, p + size);
      p += size;
    }
  };
  const keyMap: Record<string, string> = {
    '\xa9nam': 'TITLE',
    '\xa9ART': 'ARTIST',
    '\xa9alb': 'ALBUM',
    aART: 'ALBUMARTIST',
    '\xa9day': 'DATE',
    '\xa9gen': 'GENRE',
    '\xa9cmt': 'COMMENT',
  };
  const visit = (type: string, s: number, e: number): void => {
    const b = moov!;
    if (type === 'mvhd') {
      const v = b[s]!;
      const scale = be32(b, s + (v === 1 ? 20 : 12));
      const dur = v === 1 ? be32(b, s + 24) * 2 ** 32 + be32(b, s + 28) : be32(b, s + 16);
      if (scale) info.durationSec = dur / scale;
    } else if (type === 'mdhd') {
      const v = b[s]!;
      info.sampleRate ??= be32(b, s + (v === 1 ? 20 : 12));
    } else if (type === 'meta') walk(b, s + 4, e, visit);
    else if (type === 'stsd') {
      const entry = s + 8;
      const fmt = ascii(b, entry + 4, 4);
      if (fmt === 'alac') info.format = 'ALAC';
      info.channels ??= (b[entry + 24]! << 8) | b[entry + 25]!;
    } else if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'ilst'].includes(type)) walk(b, s, e, visit);
    else if (keyMap[type] || type === 'trkn' || type === '----') {
      let mean = '',
        name = '',
        data: Uint8Array | null = null;
      walk(b, s, e, (t, ds, de) => {
        if (t === 'data') data = b.subarray(ds + 8, de);
        else if (t === 'name') name = utf8.decode(b.subarray(ds + 4, de));
        else if (t === 'mean') mean = utf8.decode(b.subarray(ds + 4, de));
      });
      const d = data as Uint8Array | null;
      if (!d) return;
      if (type === 'trkn' && d.length >= 4) applyKey(info, 'TRACKNUMBER', String((d[2]! << 8) | d[3]!));
      else if (type === '----') {
        if (mean.includes('apple.iTunes') || mean === '') applyKey(info, name, utf8.decode(d));
      } else applyKey(info, keyMap[type]!, utf8.decode(d));
    }
  };
  walk(moov, 8, moov.length, visit);
  if (info.durationSec) info.bitrateKbps = Math.round((src.size * 8) / info.durationSec / 1000);
}

// ---------------------------------------------------------------- WAV
function parseWav(b: Uint8Array, info: TrackInfo, fileSize: number): void {
  info.format = 'WAV';
  let o = 12;
  let byteRate = 0;
  while (o + 8 <= b.length) {
    const id = ascii(b, o, 4);
    const len = le32(b, o + 4);
    if (id === 'fmt ') {
      info.channels = b[o + 10]! | (b[o + 11]! << 8);
      info.sampleRate = le32(b, o + 12);
      byteRate = le32(b, o + 16);
      info.bitrateKbps = Math.round((byteRate * 8) / 1000);
    } else if (id === 'data') {
      const dataLen = Math.min(len, fileSize - o - 8);
      if (byteRate) info.durationSec = dataLen / byteRate;
      break; // LIST chunks after data are not read (would need more bytes)
    } else if (id === 'LIST' && ascii(b, o + 8, 4) === 'INFO') {
      let p = o + 12;
      const map: Record<string, string> = {
        INAM: 'TITLE',
        IART: 'ARTIST',
        IPRD: 'ALBUM',
        ICRD: 'DATE',
        IGNR: 'GENRE',
        ICMT: 'COMMENT',
        ITRK: 'TRACKNUMBER',
      };
      while (p + 8 <= o + 8 + len) {
        const sid = ascii(b, p, 4),
          sl = le32(b, p + 4);
        if (map[sid])
          applyKey(info, map[sid], latin1.decode(b.subarray(p + 8, p + 8 + sl)).replace(/\0.*$/s, ''));
        p += 8 + sl + (sl & 1);
      }
    }
    o += 8 + len + (len & 1);
  }
}

// ---------------------------------------------------------------- entry point
export async function readTrackInfo(src: ByteSource): Promise<TrackInfo> {
  const info: TrackInfo = {};
  const head = await src.read(0, Math.min(src.size, 512 * 1024));
  try {
    let start = 0;
    if (ascii(head, 0, 3) === 'ID3') {
      start = parseId3v2(head, info);
      // A big ID3 tag (cover art) may push the audio start past the bytes we read.
      if (start + 4096 > head.length && start < src.size) {
        const more = await src.read(start, 70000);
        if (ascii(more, 0, 4) === 'fLaC') parseFlac(more, 0, info, src.size);
        else parseMpeg(more, 0, src.size - start, 0, info);
        return tidy(info);
      }
    }
    const magic = ascii(head, start, 4);
    if (magic === 'fLaC') parseFlac(head, start, info, src.size);
    else if (magic === 'OggS') await parseOgg(src, head, info);
    else if (ascii(head, 4, 4) === 'ftyp') await parseMp4(src, info);
    else if (magic === 'RIFF' && ascii(head, 8, 4) === 'WAVE') parseWav(head, info, src.size);
    else {
      const tail = src.size >= 128 ? await src.read(src.size - 128, 128) : new Uint8Array(0);
      const hasV1 = tail.length === 128 && ascii(tail, 0, 3) === 'TAG';
      if (parseMpeg(head, start, src.size, hasV1 ? 128 : 0, info) && hasV1) parseId3v1(tail, info);
    }
  } catch (err) {
    console.warn('[tags] could not read all track info', err);
  }
  return tidy(info);
}
