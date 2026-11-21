/** Loads classic skins (.wsz/.zip archives or loose files) into a ready-to-draw Skin. */
import { unzipSync } from 'fflate';
import { decodeBmp } from './bmp';
import { createImage, type RgbaImage } from './image';
import { OPTIONAL_SHEETS, SHEETS, type Sheet } from './sprites';
import {
  DEFAULT_PLAYLIST_COLORS,
  DEFAULT_VIS_COLORS,
  parsePledit,
  parseRegion,
  parseViscolor,
  type PlaylistColors,
  type Regions,
} from './textfiles';

export interface Skin {
  name: string;
  sheets: Record<Sheet, RgbaImage>;
  playlist: PlaylistColors;
  vis: [number, number, number][];
  regions: Regions;
  /** Cursor files by lower-case base name without extension (e.g. "normal", "eqslid"). */
  cursors: Record<string, Uint8Array>;
  /** True if the skin has its own nums_ex.bmp (big minus sign). */
  hasNumsEx: boolean;
  warnings: string[];
}

/** Standard size of each sheet (used to pad undersized bitmaps with the fallback skin). */
export const SHEET_SIZES: Record<Sheet, [number, number]> = {
  main: [275, 116],
  cbuttons: [136, 36],
  titlebar: [344, 87],
  numbers: [99, 13],
  nums_ex: [108, 13],
  text: [155, 18],
  posbar: [307, 10],
  volume: [68, 433],
  balance: [47, 433],
  monoster: [56, 24],
  playpaus: [42, 9],
  shufrep: [92, 85],
  eqmain: [275, 315],
  eq_ex: [275, 56],
  pledit: [280, 186],
};

const MAX_FILE = 8 * 1024 * 1024;
const MAX_TOTAL = 40 * 1024 * 1024;

/** Collects the archive's files by lower-case base name. Shallowest path wins for duplicates. */
export function readArchive(bytes: Uint8Array): Map<string, Uint8Array> {
  let total = 0;
  const entries = unzipSync(bytes, {
    filter: (f) => {
      if (f.name.endsWith('/') || /(^|\/)__MACOSX\//.test(f.name)) return false;
      if (f.originalSize > MAX_FILE) return false;
      total += f.originalSize;
      return total <= MAX_TOTAL; // guards against zip bombs
    },
  });
  const out = new Map<string, Uint8Array>();
  const depth = new Map<string, number>();
  for (const [path, data] of Object.entries(entries)) {
    const parts = path.replace(/\\/g, '/').split('/');
    const base = parts[parts.length - 1]!.toLowerCase();
    if (!base) continue;
    const d = parts.length;
    if (!out.has(base) || d < depth.get(base)!) {
      out.set(base, data);
      depth.set(base, d);
    }
  }
  return out;
}

const decodeText = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

/** Pastes `img` over a copy of `base` (so undersized skin bitmaps keep the fallback pixels elsewhere). */
function padWith(img: RgbaImage, base: RgbaImage): RgbaImage {
  if (img.width >= base.width && img.height >= base.height) return img;
  const out = createImage(Math.max(img.width, base.width), Math.max(img.height, base.height), 0);
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++) {
      const src = x < img.width && y < img.height ? img : x < base.width && y < base.height ? base : null;
      if (!src) continue;
      const si = (y * src.width + x) * 4,
        di = (y * out.width + x) * 4;
      out.data.set(src.data.subarray(si, si + 4), di);
    }
  return out;
}

/** Builds a Skin from a file map. Anything missing or broken falls back to `fallback`. */
export function skinFromFiles(name: string, files: Map<string, Uint8Array>, fallback: Skin | null): Skin {
  const warnings: string[] = [];
  const sheets = {} as Record<Sheet, RgbaImage>;
  const found = new Set<Sheet>();
  for (const sheet of SHEETS) {
    const data = files.get(`${sheet}.bmp`);
    if (!data) continue;
    try {
      const img = decodeBmp(data);
      sheets[sheet] = fallback ? padWith(img, fallback.sheets[sheet]) : img;
      found.add(sheet);
    } catch (e) {
      warnings.push(`${sheet}.bmp: ${(e as Error).message}`);
    }
  }
  // Documented substitutions between sheets.
  if (!found.has('balance') && found.has('volume')) sheets.balance = sheets.volume;
  if (!found.has('nums_ex') && !found.has('numbers') && fallback) sheets.numbers = fallback.sheets.numbers;
  for (const sheet of SHEETS) {
    if (sheets[sheet]) continue;
    if (!OPTIONAL_SHEETS.includes(sheet)) warnings.push(`${sheet}.bmp missing; using default`);
    if (fallback) sheets[sheet] = fallback.sheets[sheet];
    else sheets[sheet] = createImage(...SHEET_SIZES[sheet]);
  }

  let playlist = fallback?.playlist ?? DEFAULT_PLAYLIST_COLORS;
  let vis = fallback?.vis ?? DEFAULT_VIS_COLORS;
  let regions: Regions = {};
  try {
    const p = files.get('pledit.txt');
    if (p) playlist = parsePledit(decodeText(p));
    const v = files.get('viscolor.txt');
    if (v) vis = parseViscolor(decodeText(v));
    const r = files.get('region.txt');
    if (r) regions = parseRegion(decodeText(r));
  } catch (e) {
    warnings.push(`text files: ${(e as Error).message}`);
  }
  const cursors: Record<string, Uint8Array> = {};
  for (const [k, v] of files) {
    const m = /^(.+)\.(cur|ani)$/.exec(k);
    if (m) cursors[m[1]!] = v;
  }
  return { name, sheets, playlist, vis, regions, cursors, hasNumsEx: found.has('nums_ex'), warnings };
}

export function skinFromArchive(name: string, bytes: Uint8Array, fallback: Skin | null): Skin {
  let files: Map<string, Uint8Array>;
  try {
    files = readArchive(bytes);
  } catch (e) {
    if (!fallback) throw e;
    return { ...fallback, name, warnings: [`archive: ${(e as Error).message}`] };
  }
  return skinFromFiles(name, files, fallback);
}
