/** Parsers for the small text files inside classic skins. */
import { parseColor } from './image';

/** Lenient INI parser: section and key names are lower-cased. */
export function parseIni(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let section = '';
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('//')) continue;
    const sec = /^\[(.+?)\]/.exec(line);
    if (sec) {
      section = sec[1]!.trim().toLowerCase();
      out[section] ??= {};
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line
      .slice(eq + 1)
      .trim()
      .replace(/^"(.*)"$/, '$1');
    (out[section] ??= {})[key] = value;
  }
  return out;
}

export interface PlaylistColors {
  normal: [number, number, number];
  current: [number, number, number];
  normalBg: [number, number, number];
  selectedBg: [number, number, number];
  font: string;
}

export const DEFAULT_PLAYLIST_COLORS: PlaylistColors = {
  normal: [0, 255, 0],
  current: [255, 255, 255],
  normalBg: [0, 0, 0],
  selectedBg: [0, 0, 198],
  font: 'Arial',
};

/** pledit.txt: [Text] Normal, Current, NormalBG, SelectedBG, Font. */
export function parsePledit(text: string): PlaylistColors {
  const t = parseIni(text)['text'] ?? {};
  return {
    normal: parseColor(t['normal']) ?? DEFAULT_PLAYLIST_COLORS.normal,
    current: parseColor(t['current']) ?? DEFAULT_PLAYLIST_COLORS.current,
    normalBg: parseColor(t['normalbg']) ?? DEFAULT_PLAYLIST_COLORS.normalBg,
    selectedBg: parseColor(t['selectedbg']) ?? DEFAULT_PLAYLIST_COLORS.selectedBg,
    font: t['font']?.trim() || DEFAULT_PLAYLIST_COLORS.font,
  };
}

/**
 * viscolor.txt: 24 lines of "r,g,b" (comments allowed after the numbers).
 * 0 = background, 1 = dots, 2..17 = spectrum bars (top to bottom), 18..22 = oscilloscope, 23 = peak dots.
 */
export const DEFAULT_VIS_COLORS: [number, number, number][] = [
  [0, 0, 0],
  [24, 33, 41],
  [239, 49, 16],
  [206, 41, 16],
  [214, 90, 0],
  [214, 102, 0],
  [214, 115, 0],
  [198, 123, 8],
  [222, 165, 24],
  [214, 181, 33],
  [189, 222, 41],
  [148, 222, 33],
  [41, 206, 16],
  [50, 190, 16],
  [57, 181, 16],
  [49, 156, 8],
  [41, 148, 0],
  [24, 132, 8],
  [255, 255, 255],
  [214, 214, 222],
  [181, 189, 189],
  [160, 170, 175],
  [148, 156, 165],
  [150, 150, 150],
];

export function parseViscolor(text: string): [number, number, number][] {
  const colors: [number, number, number][] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    const c = parseColor(line.replace(/\s+/g, ' ').replace(/ ,/g, ','));
    if (c) colors.push(c);
    if (colors.length === 24) break;
  }
  return DEFAULT_VIS_COLORS.map((d, i) => colors[i] ?? d);
}

/** region.txt: polygons that cut the window shape. Keys: NumPoints, PointList per section. */
export type Polygon = [number, number][];
export interface Regions {
  normal?: Polygon[];
  windowshade?: Polygon[];
  equalizer?: Polygon[];
  equalizerws?: Polygon[];
}

export function parseRegion(text: string): Regions {
  const ini = parseIni(text);
  const out: Regions = {};
  for (const name of ['normal', 'windowshade', 'equalizer', 'equalizerws'] as const) {
    const s = ini[name];
    if (!s) continue;
    const counts = (s['numpoints'] ?? '')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    const nums = (s['pointlist'] ?? '')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    const polys: Polygon[] = [];
    let p = 0;
    for (const c of counts) {
      if (!Number.isFinite(c) || c <= 0) continue;
      const poly: Polygon = [];
      for (let i = 0; i < c && p + 1 < nums.length; i++, p += 2) poly.push([nums[p]!, nums[p + 1]!]);
      if (poly.length >= 3) polys.push(poly);
    }
    if (polys.length) out[name] = polys;
  }
  return out;
}

/** Point-in-polygon (even-odd rule), used for click-through outside the skin's shape. */
export function insideRegions(polys: Polygon[] | undefined, x: number, y: number): boolean {
  if (!polys || !polys.length) return true;
  const px = x + 0.5,
    py = y + 0.5;
  let inside = false;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]!,
        [xj, yj] = poly[j]!;
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
