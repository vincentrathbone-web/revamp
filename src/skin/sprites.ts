/**
 * Sprite map for classic skins: where each graphic sits inside each bitmap.
 * These rectangles are file-format facts (measured from skin files) needed to load existing skins.
 */
export type Sheet =
  | 'main'
  | 'cbuttons'
  | 'titlebar'
  | 'numbers'
  | 'nums_ex'
  | 'text'
  | 'posbar'
  | 'volume'
  | 'balance'
  | 'monoster'
  | 'playpaus'
  | 'shufrep'
  | 'eqmain'
  | 'eq_ex'
  | 'pledit';

export const SHEETS: Sheet[] = [
  'main',
  'cbuttons',
  'titlebar',
  'numbers',
  'nums_ex',
  'text',
  'posbar',
  'volume',
  'balance',
  'monoster',
  'playpaus',
  'shufrep',
  'eqmain',
  'eq_ex',
  'pledit',
];

/** Sheets a skin may leave out (we fall back to another sheet or the default skin). */
export const OPTIONAL_SHEETS: Sheet[] = ['nums_ex', 'eq_ex', 'balance'];

export interface Sprite {
  sheet: Sheet;
  x: number;
  y: number;
  w: number;
  h: number;
}

const s = (sheet: Sheet, x: number, y: number, w: number, h: number): Sprite => ({ sheet, x, y, w, h });

// ---------------------------------------------------------------- main window
export const MAIN = {
  background: s('main', 0, 0, 275, 116),
  titleActive: s('titlebar', 27, 0, 275, 14),
  titleInactive: s('titlebar', 27, 15, 275, 14),
  shadeActive: s('titlebar', 27, 29, 275, 14),
  shadeInactive: s('titlebar', 27, 42, 275, 14),
  optionsBtn: s('titlebar', 0, 0, 9, 9),
  optionsBtnDown: s('titlebar', 0, 9, 9, 9),
  minimizeBtn: s('titlebar', 9, 0, 9, 9),
  minimizeBtnDown: s('titlebar', 9, 9, 9, 9),
  shadeBtn: s('titlebar', 0, 18, 9, 9),
  shadeBtnDown: s('titlebar', 9, 18, 9, 9),
  unshadeBtn: s('titlebar', 0, 27, 9, 9),
  unshadeBtnDown: s('titlebar', 9, 27, 9, 9),
  closeBtn: s('titlebar', 18, 0, 9, 9),
  closeBtnDown: s('titlebar', 18, 9, 9, 9),
  clutterBar: s('titlebar', 304, 0, 8, 43),
  clutterBarDisabled: s('titlebar', 312, 0, 8, 43),
  clutterOptionsDown: s('titlebar', 304, 47, 8, 8),
  clutterAlwaysOnTopDown: s('titlebar', 312, 55, 8, 8),
  clutterInfoDown: s('titlebar', 320, 63, 8, 7),
  clutterDoubleDown: s('titlebar', 328, 70, 8, 8),
  clutterVisDown: s('titlebar', 336, 78, 8, 7),
  shadePosBg: s('titlebar', 0, 36, 17, 7),
  shadePosThumb: s('titlebar', 20, 36, 3, 7),
  shadePosThumbLeft: s('titlebar', 17, 36, 3, 7),
  shadePosThumbRight: s('titlebar', 23, 36, 3, 7),

  prev: s('cbuttons', 0, 0, 23, 18),
  prevDown: s('cbuttons', 0, 18, 23, 18),
  play: s('cbuttons', 23, 0, 23, 18),
  playDown: s('cbuttons', 23, 18, 23, 18),
  pause: s('cbuttons', 46, 0, 23, 18),
  pauseDown: s('cbuttons', 46, 18, 23, 18),
  stop: s('cbuttons', 69, 0, 23, 18),
  stopDown: s('cbuttons', 69, 18, 23, 18),
  next: s('cbuttons', 92, 0, 22, 18),
  nextDown: s('cbuttons', 92, 18, 22, 18),
  eject: s('cbuttons', 114, 0, 22, 16),
  ejectDown: s('cbuttons', 114, 16, 22, 16),

  statusPlay: s('playpaus', 0, 0, 9, 9),
  statusPause: s('playpaus', 9, 0, 9, 9),
  statusStop: s('playpaus', 18, 0, 9, 9),
  statusNotWorking: s('playpaus', 36, 0, 3, 9),
  statusWorking: s('playpaus', 39, 0, 3, 9),

  stereo: s('monoster', 0, 0, 29, 12),
  stereoOff: s('monoster', 0, 12, 29, 12),
  mono: s('monoster', 29, 0, 27, 12),
  monoOff: s('monoster', 29, 12, 27, 12),

  posBg: s('posbar', 0, 0, 248, 10),
  posThumb: s('posbar', 248, 0, 29, 10),
  posThumbDown: s('posbar', 278, 0, 29, 10),

  volumeThumb: s('volume', 15, 422, 14, 11),
  volumeThumbDown: s('volume', 0, 422, 14, 11),
  balanceThumb: s('balance', 15, 422, 14, 11),
  balanceThumbDown: s('balance', 0, 422, 14, 11),

  repeat: s('shufrep', 0, 0, 28, 15),
  repeatDown: s('shufrep', 0, 15, 28, 15),
  repeatOn: s('shufrep', 0, 30, 28, 15),
  repeatOnDown: s('shufrep', 0, 45, 28, 15),
  shuffle: s('shufrep', 28, 0, 47, 15),
  shuffleDown: s('shufrep', 28, 15, 47, 15),
  shuffleOn: s('shufrep', 28, 30, 47, 15),
  shuffleOnDown: s('shufrep', 28, 45, 47, 15),
  eqBtn: s('shufrep', 0, 61, 23, 12),
  eqBtnOn: s('shufrep', 0, 73, 23, 12),
  eqBtnDown: s('shufrep', 46, 61, 23, 12),
  eqBtnOnDown: s('shufrep', 46, 73, 23, 12),
  plBtn: s('shufrep', 23, 61, 23, 12),
  plBtnOn: s('shufrep', 23, 73, 23, 12),
  plBtnDown: s('shufrep', 69, 61, 23, 12),
  plBtnOnDown: s('shufrep', 69, 73, 23, 12),
} as const;

/** Volume background frame i (0..27): 68x13 strips every 15 px. */
export const volumeFrame = (i: number): Sprite => s('volume', 0, Math.max(0, Math.min(27, i)) * 15, 68, 13);
/** Balance background frame i (0..27): 38x13 strips at x=9 every 15 px. */
export const balanceFrame = (i: number): Sprite => s('balance', 9, Math.max(0, Math.min(27, i)) * 15, 38, 13);

/** Digit sprites (9x13). `ex` = nums_ex.bmp, which also has its own minus sign. */
export const digit = (n: number, ex: boolean): Sprite => s(ex ? 'nums_ex' : 'numbers', n * 9, 0, 9, 13);
export const digitBlank = (ex: boolean): Sprite => s(ex ? 'nums_ex' : 'numbers', 90, 0, 9, 13);
export const minusEx = s('nums_ex', 99, 0, 9, 13);
/** In numbers.bmp the minus sign is a 5x1 line taken from a digit cell. */
export const minusLine = s('numbers', 20, 6, 5, 1);
export const noMinusLine = s('numbers', 9, 6, 5, 1);

/** Positions inside the 275x116 main window. */
export const MAIN_POS = {
  options: [6, 3],
  minimize: [244, 3],
  shade: [254, 3],
  close: [264, 3],
  clutter: [10, 22],
  status: [26, 28],
  working: [24, 28],
  minus: [36, 26],
  digits: [
    [48, 26],
    [60, 26],
    [78, 26],
    [90, 26],
  ],
  vis: [24, 43, 76, 16],
  title: [111, 27, 154, 6],
  kbps: [111, 43],
  khz: [156, 43],
  mono: [212, 41],
  stereo: [239, 41],
  volume: [107, 57],
  balance: [177, 57],
  eqBtn: [219, 58],
  plBtn: [242, 58],
  pos: [16, 72],
  prev: [16, 88],
  play: [39, 88],
  pause: [62, 88],
  stop: [85, 88],
  next: [108, 88],
  eject: [136, 89],
  shuffle: [164, 89],
  repeat: [210, 89],
} as const;

/** Main window shade mode (275x14). */
export const SHADE_POS = {
  options: [6, 3],
  minimize: [244, 3],
  unshade: [254, 3],
  close: [264, 3],
  time: [127, 4], // 5x6 font digits
  vis: [79, 5, 38, 5],
  pos: [226, 4],
  // transport click zones (drawn in the title bar bitmap itself)
  prev: [169, 2, 8, 11],
  play: [177, 2, 10, 11],
  pause: [187, 2, 10, 11],
  stop: [197, 2, 9, 11],
  next: [206, 2, 8, 11],
  eject: [216, 2, 9, 11],
} as const;

// ---------------------------------------------------------------- text font (text.bmp, 5x6 cells)
const ROW0 = 'abcdefghijklmnopqrstuvwxyz"@';
const ROW1 = "0123456789….:()-'!_+\\/[]^&%,=$#";
const ROW2 = 'åöä?*';
export const CHAR_W = 5;
export const CHAR_H = 6;
export function glyph(ch: string): Sprite {
  const c = ch.toLowerCase();
  const map: Record<string, string> = {
    '<': '[',
    '>': ']',
    '{': '(',
    '}': ')',
    '`': "'",
    '~': '-',
    '|': '!',
    ';': ':',
    ü: 'u',
    é: 'e',
    è: 'e',
    à: 'a',
    ß: 's',
    '"': '"',
  };
  const k = map[c] ?? c;
  let i = ROW0.indexOf(k);
  if (i >= 0) return s('text', i * 5, 0, 5, 6);
  i = ROW1.indexOf(k);
  if (i >= 0) return s('text', i * 5, 6, 5, 6);
  i = ROW2.indexOf(k);
  if (i >= 0) return s('text', i * 5, 12, 5, 6);
  return s('text', 150, 0, 5, 6); // space
}

// ---------------------------------------------------------------- equalizer window
export const EQ = {
  background: s('eqmain', 0, 0, 275, 116),
  titleActive: s('eqmain', 0, 134, 275, 14),
  titleInactive: s('eqmain', 0, 149, 275, 14),
  closeBtnDown: s('eqmain', 0, 116, 9, 9),
  onBtn: s('eqmain', 10, 119, 26, 12),
  onBtnDown: s('eqmain', 128, 119, 26, 12),
  onBtnOn: s('eqmain', 69, 119, 26, 12),
  onBtnOnDown: s('eqmain', 187, 119, 26, 12),
  autoBtn: s('eqmain', 36, 119, 32, 12),
  autoBtnDown: s('eqmain', 154, 119, 32, 12),
  autoBtnOn: s('eqmain', 95, 119, 32, 12),
  autoBtnOnDown: s('eqmain', 213, 119, 32, 12),
  sliderThumb: s('eqmain', 0, 164, 11, 11),
  sliderThumbDown: s('eqmain', 0, 176, 11, 11),
  graphBg: s('eqmain', 0, 294, 113, 19),
  graphColors: s('eqmain', 115, 294, 1, 19),
  preampLine: s('eqmain', 0, 314, 113, 1),
  presetsBtn: s('eqmain', 224, 164, 44, 12),
  presetsBtnDown: s('eqmain', 224, 176, 44, 12),
  // eq_ex.bmp (shade mode and shade buttons)
  shadeActive: s('eq_ex', 0, 0, 275, 14),
  shadeInactive: s('eq_ex', 0, 15, 275, 14),
  shadeBtnDown: s('eq_ex', 254, 3, 9, 9),
  unshadeBtnDown: s('eq_ex', 1, 47, 9, 9),
  shadeCloseBtnDown: s('eq_ex', 11, 47, 9, 9),
  shadeVolumeThumb: s('eq_ex', 1, 30, 3, 7),
  shadeBalanceThumb: s('eq_ex', 11, 30, 3, 7),
} as const;

/** EQ slider background frame (0 = top/+12 dB ... 27 = bottom/-12 dB). */
export const eqSliderFrame = (i: number): Sprite => {
  const k = Math.max(0, Math.min(27, i));
  return s('eqmain', 13 + (k % 14) * 15, 164 + Math.floor(k / 14) * 65, 14, 63);
};

export const EQ_POS = {
  close: [264, 3],
  shade: [254, 3],
  on: [14, 18],
  auto: [40, 18],
  presets: [217, 18],
  graph: [86, 17],
  preamp: [21, 38],
  bands: [78, 96, 114, 132, 150, 168, 186, 204, 222, 240].map((x) => [x, 38] as const),
  sliderH: 63,
  thumbTravel: 51,
} as const;

// ---------------------------------------------------------------- playlist window
export const PL = {
  topLeft: s('pledit', 0, 0, 25, 20),
  topTitle: s('pledit', 26, 0, 100, 20),
  topFill: s('pledit', 127, 0, 25, 20),
  topRight: s('pledit', 153, 0, 25, 20),
  topLeftInactive: s('pledit', 0, 21, 25, 20),
  topTitleInactive: s('pledit', 26, 21, 100, 20),
  topFillInactive: s('pledit', 127, 21, 25, 20),
  topRightInactive: s('pledit', 153, 21, 25, 20),
  left: s('pledit', 0, 42, 12, 29),
  right: s('pledit', 31, 42, 20, 29),
  bottomLeft: s('pledit', 0, 72, 125, 38),
  bottomRight: s('pledit', 126, 72, 150, 38),
  bottomFill: s('pledit', 179, 0, 25, 38),
  visExtra: s('pledit', 205, 0, 75, 38),
  scrollThumb: s('pledit', 52, 53, 8, 18),
  scrollThumbDown: s('pledit', 61, 53, 8, 18),
  closeBtnDown: s('pledit', 52, 42, 9, 9),
  shadeBtnDown: s('pledit', 62, 42, 9, 9),
  shadeLeft: s('pledit', 72, 42, 25, 14),
  shadeRight: s('pledit', 99, 42, 50, 14),
  shadeRightInactive: s('pledit', 99, 57, 50, 14),
  shadeFill: s('pledit', 72, 57, 25, 14),
  unshadeBtnDown: s('pledit', 150, 42, 9, 9),
  shadeCloseBtnDown: s('pledit', 52, 42, 9, 9),
} as const;

export interface PlMenuItem {
  id: string;
  normal: Sprite;
  selected: Sprite;
}
const mi = (id: string, x: number, y: number): PlMenuItem => ({
  id,
  normal: s('pledit', x, y, 22, 18),
  selected: s('pledit', x + 23, y, 22, 18),
});
/** Playlist bottom-bar pop-up menus (items listed bottom to top, as drawn). */
export const PL_MENUS = {
  add: {
    bar: s('pledit', 48, 111, 3, 54),
    items: [mi('addUrl', 0, 111), mi('addDir', 0, 130), mi('addFile', 0, 149)],
  },
  rem: {
    bar: s('pledit', 100, 111, 3, 72),
    items: [mi('remAll', 54, 111), mi('crop', 54, 130), mi('remSel', 54, 149), mi('remMisc', 54, 168)],
  },
  sel: {
    bar: s('pledit', 150, 111, 3, 54),
    items: [mi('selInvert', 104, 111), mi('selNone', 104, 130), mi('selAll', 104, 149)],
  },
  misc: {
    bar: s('pledit', 200, 111, 3, 54),
    items: [mi('sort', 154, 111), mi('fileInfo', 154, 130), mi('miscOpts', 154, 149)],
  },
  list: {
    bar: s('pledit', 250, 111, 3, 54),
    items: [mi('newList', 204, 111), mi('saveList', 204, 130), mi('loadList', 204, 149)],
  },
} as const;

export const PL_MIN_W = 275;
export const PL_MIN_H = 116;
export const PL_STEP_W = 25;
export const PL_STEP_H = 29;
