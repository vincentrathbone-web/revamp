/** Playlist file formats: M3U/M3U8, PLS, XSPF (load + save) and B4S (load). */
import type { Entry } from './model';

export type PlaylistItem = Pick<Entry, 'location' | 'title' | 'durationSec'>;

export function detectFormat(name: string, text: string): 'm3u' | 'pls' | 'xspf' | 'b4s' | null {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'm3u' || ext === 'm3u8') return 'm3u';
  if (ext === 'pls') return 'pls';
  if (ext === 'xspf') return 'xspf';
  if (ext === 'b4s') return 'b4s';
  const t = text.trimStart();
  if (t.startsWith('#EXTM3U')) return 'm3u';
  if (/^\[playlist\]/i.test(t)) return 'pls';
  if (t.includes('<playlist') && t.includes('xspf')) return 'xspf';
  if (t.includes('<WinampXML') || t.includes('<WasabiXML')) return 'b4s';
  return null;
}

/** Decodes playlist bytes: UTF-8 (with or without BOM) or Windows-1252 for old .m3u files. */
export function decodePlaylistBytes(bytes: Uint8Array, name: string): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    if (name.toLowerCase().endsWith('.m3u8')) return new TextDecoder('utf-8').decode(bytes);
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function parsePlaylist(name: string, text: string): PlaylistItem[] {
  switch (detectFormat(name, text)) {
    case 'm3u':
      return parseM3u(text);
    case 'pls':
      return parsePls(text);
    case 'xspf':
      return parseXspf(text);
    case 'b4s':
      return parseB4s(text);
    default:
      return parseM3u(text); // plain list of paths
  }
}

export function parseM3u(text: string): PlaylistItem[] {
  const out: PlaylistItem[] = [];
  let pending: { title?: string; durationSec?: number } = {};
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const m = /^#EXTINF:\s*(-?\d+(?:\.\d+)?)?[^,]*,(.*)$/i.exec(line);
      if (m)
        pending = {
          durationSec: m[1] && Number(m[1]) >= 0 ? Number(m[1]) : undefined,
          title: m[2]?.trim() || undefined,
        };
      continue;
    }
    out.push({ location: line, ...pending });
    pending = {};
  }
  return out;
}

export function writeM3u(items: PlaylistItem[]): string {
  const lines = ['#EXTM3U'];
  for (const it of items) {
    if (it.title !== undefined || it.durationSec !== undefined)
      lines.push(
        `#EXTINF:${it.durationSec !== undefined ? Math.round(it.durationSec) : -1},${it.title ?? ''}`,
      );
    lines.push(it.location);
  }
  return lines.join('\r\n') + '\r\n';
}

export function parsePls(text: string): PlaylistItem[] {
  const files = new Map<number, PlaylistItem>();
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const m = /^\s*(file|title|length)(\d+)\s*=\s*(.*)$/i.exec(raw);
    if (!m) continue;
    const n = Number(m[2]);
    const it = files.get(n) ?? { location: '' };
    const key = m[1]!.toLowerCase();
    if (key === 'file') it.location = m[3]!.trim();
    else if (key === 'title') it.title = m[3]!.trim();
    else if (Number(m[3]) >= 0) it.durationSec = Number(m[3]);
    files.set(n, it);
  }
  return [...files.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v)
    .filter((v) => v.location);
}

export function writePls(items: PlaylistItem[]): string {
  const lines = ['[playlist]'];
  items.forEach((it, i) => {
    lines.push(`File${i + 1}=${it.location}`);
    if (it.title !== undefined) lines.push(`Title${i + 1}=${it.title}`);
    lines.push(`Length${i + 1}=${it.durationSec !== undefined ? Math.round(it.durationSec) : -1}`);
  });
  lines.push(`NumberOfEntries=${items.length}`, 'Version=2');
  return lines.join('\r\n') + '\r\n';
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xmlUnescape = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

function tag(block: string, name: string): string | undefined {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? xmlUnescape(m[1]!.trim()) : undefined;
}

export function parseXspf(text: string): PlaylistItem[] {
  const out: PlaylistItem[] = [];
  for (const m of text.matchAll(/<track>([\s\S]*?)<\/track>/gi)) {
    const block = m[1]!;
    let loc = tag(block, 'location');
    if (!loc) continue;
    if (loc.startsWith('file:///')) loc = decodeURIComponent(loc.slice(8)).replace(/\//g, '\\');
    const creator = tag(block, 'creator'),
      title = tag(block, 'title');
    const dur = tag(block, 'duration');
    out.push({
      location: loc,
      title: title ? (creator ? `${creator} - ${title}` : title) : undefined,
      durationSec: dur && Number(dur) >= 0 ? Number(dur) / 1000 : undefined,
    });
  }
  return out;
}

export function writeXspf(items: PlaylistItem[]): string {
  const toUri = (p: string) =>
    /^[a-z][a-z0-9+.-]*:\/\//i.test(p)
      ? p
      : 'file:///' +
        p
          .replace(/\\/g, '/')
          .split('/')
          .map(encodeURIComponent)
          .join('/')
          .replace(/^([A-Za-z])%3A/, '$1:');
  const tracks = items.map((it) => {
    const parts = [`<location>${xmlEscape(toUri(it.location))}</location>`];
    if (it.title) parts.push(`<title>${xmlEscape(it.title)}</title>`);
    if (it.durationSec !== undefined) parts.push(`<duration>${Math.round(it.durationSec * 1000)}</duration>`);
    return `    <track>${parts.join('')}</track>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="1" xmlns="http://xspf.org/ns/0/">\n  <trackList>\n${tracks.join('\n')}\n  </trackList>\n</playlist>\n`;
}

export function parseB4s(text: string): PlaylistItem[] {
  const out: PlaylistItem[] = [];
  for (const m of text.matchAll(/<entry\s+Playstring="([^"]*)"[^>]*>([\s\S]*?)<\/entry>/gi)) {
    let loc = xmlUnescape(m[1]!);
    if (loc.toLowerCase().startsWith('file:')) loc = loc.slice(5);
    const len = tag(m[2]!, 'Length');
    out.push({ location: loc, title: tag(m[2]!, 'Name'), durationSec: len ? Number(len) / 1000 : undefined });
  }
  return out;
}

/** Resolves a playlist entry path against the playlist's own folder. */
export function resolveLocation(location: string, playlistPath: string): string {
  if (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(location) ||
    /^[a-z]:[\\/]/i.test(location) ||
    location.startsWith('\\\\') ||
    location.startsWith('/')
  )
    return location;
  const sep = playlistPath.includes('\\') ? '\\' : '/';
  const dir = playlistPath.replace(/[\\/][^\\/]*$/, '');
  const parts = [...dir.split(/[\\/]/), ...location.split(/[\\/]/)];
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
    else if (p === '' && out.length === 0) out.push('');
  }
  return out.join(sep);
}
