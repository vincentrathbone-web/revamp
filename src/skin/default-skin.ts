/**
 * RevAmp's own default skin, "Graphite", painted in code into the standard sheet layout.
 * Original art: dark graphite panels with an amber display. No third-party artwork is used.
 */
import { createImage, type RgbaImage } from './image';
import { SHEET_SIZES, type Skin } from './skin';
import { MAIN, MAIN_POS, PL, PL_MENUS, EQ, EQ_POS, type Sprite } from './sprites';
import { DEFAULT_VIS_COLORS } from './textfiles';

type C = readonly [number, number, number];
const P = {
  bg0: [16, 19, 23] as C,
  bg1: [30, 36, 43] as C,
  bg2: [42, 50, 59] as C,
  line: [58, 68, 80] as C,
  hi: [92, 104, 118] as C,
  sh: [9, 11, 14] as C,
  lcd: [9, 11, 13] as C,
  amber: [240, 168, 58] as C,
  amberHi: [255, 214, 140] as C,
  amberDim: [110, 78, 30] as C,
  text: [208, 214, 222] as C,
  dim: [112, 124, 138] as C,
  red: [226, 82, 62] as C,
  green: [92, 200, 120] as C,
};

// ------------------------------------------------------------------ 3x5 pixel font (original design)
const FONT: Record<string, string> = {
  A: '010101111101101',
  B: '110101110101110',
  C: '011100100100011',
  D: '110101101101110',
  E: '111100110100111',
  F: '111100110100100',
  G: '011100101101011',
  H: '101101111101101',
  I: '111010010010111',
  J: '001001001101010',
  K: '101101110101101',
  L: '100100100100111',
  M: '101111111101101',
  N: '110101101101101',
  O: '010101101101010',
  P: '110101110100100',
  Q: '010101101110011',
  R: '110101110101101',
  S: '011100010001110',
  T: '111010010010010',
  U: '101101101101111',
  V: '101101101101010',
  W: '101101111111101',
  X: '101101010101101',
  Y: '101101010010010',
  Z: '111001010100111',
  '0': '111101101101111',
  '1': '010110010010111',
  '2': '110001010100111',
  '3': '110001010001110',
  '4': '101101111001001',
  '5': '111100110001110',
  '6': '011100111101111',
  '7': '111001010010010',
  '8': '111101111101111',
  '9': '111101111001110',
  '"': '101101000000000',
  '@': '010101111100011',
  '…': '000000000000101',
  '.': '000000000000010',
  ':': '000010000010000',
  '(': '001010010010001',
  ')': '100010010010100',
  '-': '000000111000000',
  "'": '010010000000000',
  '!': '010010010000010',
  _: '000000000000111',
  '+': '000010111010000',
  '\\': '100100010001001',
  '/': '001001010100100',
  '[': '011010010010011',
  ']': '110010010010110',
  '^': '010101000000000',
  '&': '010101010101011',
  '%': '101001010100101',
  ',': '000000000010100',
  '=': '000111000111000',
  $: '011110010011110',
  '#': '101111101111101',
  Å: '010000010101111',
  Ö: '101010101101010',
  Ä: '101010101111101',
  '?': '110001010000010',
  '*': '000101010101000',
  ' ': '000000000000000',
};
const TEXT_ROWS = ['ABCDEFGHIJKLMNOPQRSTUVWXYZ"@', "0123456789….:()-'!_+\\/[]^&%,=$#", 'ÅÖÄ?*'];

class Painter {
  constructor(readonly img: RgbaImage) {}
  px(x: number, y: number, c: C): void {
    if (x < 0 || y < 0 || x >= this.img.width || y >= this.img.height) return;
    const o = (y * this.img.width + x) * 4;
    this.img.data[o] = c[0];
    this.img.data[o + 1] = c[1];
    this.img.data[o + 2] = c[2];
    this.img.data[o + 3] = 255;
  }
  fill(x: number, y: number, w: number, h: number, c: C): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c);
  }
  vgrad(x: number, y: number, w: number, h: number, a: C, b: C): void {
    for (let j = 0; j < h; j++) {
      const t = h > 1 ? j / (h - 1) : 0;
      this.fill(x, y + j, w, 1, mix(a, b, t));
    }
  }
  rect(x: number, y: number, w: number, h: number, c: C): void {
    this.fill(x, y, w, 1, c);
    this.fill(x, y + h - 1, w, 1, c);
    this.fill(x, y, 1, h, c);
    this.fill(x + w - 1, y, 1, h, c);
  }
  /** Raised (or sunken) bevelled box. */
  bevel(x: number, y: number, w: number, h: number, sunken = false, face: C = P.bg2): void {
    this.vgrad(
      x,
      y,
      w,
      h,
      sunken ? mix(face, P.sh, 0.4) : mix(face, P.hi, 0.25),
      sunken ? face : mix(face, P.sh, 0.25),
    );
    const tl = sunken ? P.sh : P.hi,
      br = sunken ? P.hi : P.sh;
    this.fill(x, y, w, 1, tl);
    this.fill(x, y, 1, h, tl);
    this.fill(x, y + h - 1, w, 1, br);
    this.fill(x + w - 1, y, 1, h, br);
  }
  /** Sunken display well. */
  well(x: number, y: number, w: number, h: number, c: C = P.lcd): void {
    this.fill(x, y, w, h, c);
    this.fill(x - 1, y - 1, w + 2, 1, P.sh);
    this.fill(x - 1, y - 1, 1, h + 2, P.sh);
    this.fill(x - 1, y + h, w + 2, 1, P.line);
    this.fill(x + w, y - 1, 1, h + 2, P.line);
  }
  glyph(ch: string, x: number, y: number, c: C): void {
    const g = FONT[ch.toUpperCase()] ?? FONT[' ']!;
    for (let j = 0; j < 5; j++)
      for (let i = 0; i < 3; i++) if (g[j * 3 + i] === '1') this.px(x + i, y + j, c);
  }
  text(s: string, x: number, y: number, c: C): void {
    let cx = x;
    for (const ch of s) {
      this.glyph(ch, cx, y, c);
      cx += 4;
    }
  }
  textCentered(s: string, cx: number, y: number, c: C): void {
    this.text(s, Math.round(cx - (s.length * 4 - 1) / 2), y, c);
  }
  /** Filled triangle pointing right (dir=1) or left (dir=-1), height h, at (x, y) top. */
  tri(x: number, y: number, h: number, dir: 1 | -1, c: C): void {
    const half = Math.floor(h / 2);
    for (let j = 0; j < h; j++) {
      const len = half - Math.abs(j - half) + 1;
      for (let i = 0; i < len; i++) this.px(dir === 1 ? x + i : x - i, y + j, c);
    }
  }
}

const mix = (a: C, b: C, t: number): C => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

function sheet(name: keyof typeof SHEET_SIZES, fill: C = P.bg1): [RgbaImage, Painter] {
  const [w, h] = SHEET_SIZES[name];
  const img = createImage(w, h);
  const p = new Painter(img);
  p.fill(0, 0, w, h, fill);
  return [img, p];
}

// ------------------------------------------------------------------ sheets
function titleStrip(p: Painter, x: number, y: number, w: number, active: boolean, label: string): void {
  p.vgrad(x, y, w, 14, active ? P.bg2 : P.bg1, active ? P.bg1 : P.bg0);
  p.fill(x, y, w, 1, active ? P.hi : P.line);
  p.fill(x, y + 13, w, 1, P.sh);
  const c = active ? P.amber : P.dim;
  const lw = label.length * 4 + 6;
  const cx = x + Math.floor(w / 2);
  for (const yy of [y + 5, y + 8]) {
    p.fill(x + 20, yy, cx - lw / 2 - x - 24, 1, active ? P.line : P.bg2);
    p.fill(cx + lw / 2 + 4, yy, x + w - 36 - (cx + lw / 2), 1, active ? P.line : P.bg2);
  }
  p.textCentered(label, cx, y + 5, c);
}

function iconButton(
  p: Painter,
  x: number,
  y: number,
  sunken: boolean,
  icon: (cx: number, cy: number, c: C) => void,
  w = 9,
  h = 9,
): void {
  p.bevel(x, y, w, h, sunken);
  icon(x + Math.floor(w / 2), y + Math.floor(h / 2), sunken ? P.amber : P.text);
}

function makeTitlebar(): RgbaImage {
  const [img, p] = sheet('titlebar', P.bg0);
  const glyphs = {
    menu: (cx: number, cy: number, c: C) => [-2, 0, 2].forEach((d) => p.fill(cx - 2, cy + d, 5, 1, c)),
    min: (cx: number, cy: number, c: C) => p.fill(cx - 2, cy + 2, 5, 1, c),
    close: (cx: number, cy: number, c: C) =>
      [-2, -1, 0, 1, 2].forEach((d) => (p.px(cx + d, cy + d, c), p.px(cx + d, cy - d, c))),
    shade: (cx: number, cy: number, c: C) => (p.fill(cx - 2, cy - 2, 5, 1, c), p.fill(cx - 2, cy, 5, 1, c)),
    unshade: (cx: number, cy: number, c: C) => p.rect(cx - 2, cy - 2, 5, 5, c),
  };
  for (const [sp, down, g] of [
    [MAIN.optionsBtn, MAIN.optionsBtnDown, glyphs.menu],
    [MAIN.minimizeBtn, MAIN.minimizeBtnDown, glyphs.min],
    [MAIN.closeBtn, MAIN.closeBtnDown, glyphs.close],
    [MAIN.shadeBtn, MAIN.shadeBtnDown, glyphs.shade],
    [MAIN.unshadeBtn, MAIN.unshadeBtnDown, glyphs.unshade],
  ] as const) {
    iconButton(p, sp.x, sp.y, false, g);
    iconButton(p, down.x, down.y, true, g);
  }
  titleStrip(p, 27, 0, 275, true, 'REVAMP');
  titleStrip(p, 27, 15, 275, false, 'REVAMP');
  titleStrip(p, 27, 57, 275, true, 'REVAMP');
  titleStrip(p, 27, 72, 275, false, 'REVAMP');
  // shade-mode strips: label on the left, mini display wells for vis, time and position
  for (const [y, active] of [
    [29, true],
    [42, false],
  ] as const) {
    p.vgrad(27, y, 275, 14, active ? P.bg2 : P.bg1, active ? P.bg1 : P.bg0);
    p.fill(27, y, 275, 1, active ? P.hi : P.line);
    p.fill(27, y + 13, 275, 1, P.sh);
    p.text('REVAMP', 27 + 18, y + 5, active ? P.amber : P.dim);
    p.well(27 + 79, y + 5, 38, 5);
    p.well(27 + 126, y + 4, 31, 6);
    p.well(27 + 226, y + 4, 17, 7);
    // mini transport icons (click zones are fixed by the format)
    const c = active ? P.text : P.dim;
    p.tri(27 + 171, y + 4, 5, -1, c);
    p.fill(27 + 169, y + 4, 1, 5, c);
    p.tri(27 + 180, y + 4, 5, 1, c);
    p.fill(27 + 189, y + 4, 2, 5, c);
    p.fill(27 + 192, y + 4, 2, 5, c);
    p.fill(27 + 199, y + 4, 5, 5, c);
    p.tri(27 + 208, y + 4, 5, 1, c);
    p.fill(27 + 212, y + 4, 1, 5, c);
    p.tri(27 + 218, y + 4, 3, 1, c);
    p.fill(27 + 218, y + 8, 5, 1, c);
  }
  // clutter bar: O A I D V
  const tops = [
    [3, 8, 'O'],
    [11, 8, 'A'],
    [19, 7, 'I'],
    [26, 8, 'D'],
    [34, 7, 'V'],
  ] as const;
  for (const bx of [304, 312]) {
    p.bevel(bx, 0, 8, 43, false, P.bg1);
    for (const [t, , ch] of tops) p.glyph(ch, bx + 2, t + 1, bx === 312 ? P.line : P.dim);
  }
  tops.forEach(([t, h, ch], i) => {
    const x = 304 + i * 8;
    p.fill(x, 44 + t, 8, h, P.amberDim);
    p.glyph(ch, x + 2, 44 + t + 1, P.amberHi);
  });
  // shade position bar
  p.well(0, 36, 17, 7, P.lcd);
  p.fill(17, 36, 3, 7, P.amber);
  p.fill(20, 36, 3, 7, P.amberHi);
  p.fill(23, 36, 3, 7, P.amber);
  return img;
}

function makeMain(): RgbaImage {
  const [img, p] = sheet('main');
  p.vgrad(0, 0, 275, 116, P.bg2, P.bg0);
  p.rect(0, 0, 275, 116, P.sh);
  p.fill(1, 1, 273, 1, P.line);
  p.well(21, 23, 82, 38); // time + vis display
  p.well(110, 24, 156, 10); // song title
  p.well(110, 41, 18, 9); // kbps
  p.text('KBPS', 131, 43, P.dim);
  p.well(155, 41, 12, 9); // khz
  p.text('KHZ', 170, 43, P.dim);
  p.well(107, 57, 68, 13);
  p.well(177, 57, 38, 13);
  p.well(16, 72, 248, 10);
  p.text('REVAMP', 230, 104, P.dim);
  p.fill(230, 110, 23, 1, P.amberDim);
  // groove behind the transport buttons
  p.fill(14, 86, 147, 22, P.bg0);
  return img;
}

function makeCbuttons(): RgbaImage {
  const [img, p] = sheet('cbuttons');
  const draw = (sp: Sprite, sunken: boolean, icon: (x: number, y: number, c: C) => void) => {
    p.bevel(sp.x, sp.y, sp.w, sp.h, sunken);
    icon(sp.x + Math.floor(sp.w / 2), sp.y + Math.floor(sp.h / 2), sunken ? P.amber : P.text);
  };
  const icons = {
    prev: (x: number, y: number, c: C) => (
      p.fill(x - 5, y - 3, 1, 7, c),
      p.tri(x, y - 3, 7, -1, c),
      p.tri(x + 4, y - 3, 7, -1, c)
    ),
    play: (x: number, y: number, c: C) => p.tri(x - 2, y - 4, 9, 1, c),
    pause: (x: number, y: number, c: C) => (p.fill(x - 3, y - 3, 2, 7, c), p.fill(x + 1, y - 3, 2, 7, c)),
    stop: (x: number, y: number, c: C) => p.fill(x - 3, y - 3, 7, 7, c),
    next: (x: number, y: number, c: C) => (
      p.tri(x - 4, y - 3, 7, 1, c),
      p.tri(x, y - 3, 7, 1, c),
      p.fill(x + 4, y - 3, 1, 7, c)
    ),
    eject: (x: number, y: number, c: C) => {
      for (let j = 0; j < 4; j++) p.fill(x - j, y - 4 + j, j * 2 + 1, 1, c);
      p.fill(x - 3, y + 1, 7, 2, c);
    },
  };
  for (const k of ['prev', 'play', 'pause', 'stop', 'next', 'eject'] as const) {
    draw(MAIN[k], false, icons[k]);
    draw(MAIN[`${k}Down`], true, icons[k]);
  }
  return img;
}

function sevenSeg(p: Painter, x: number, y: number, d: number, c: C): void {
  const segs = [
    '1110111',
    '0010010',
    '1011101',
    '1011011',
    '0111010',
    '1101011',
    '1101111',
    '1010010',
    '1111111',
    '1111011',
  ][d]!;
  const [a, b, cc, dd, e, f, g] = [...segs].map((v) => v === '1');
  if (a) p.fill(x + 2, y + 1, 5, 1, c);
  if (b) p.fill(x + 1, y + 2, 1, 4, c);
  if (cc) p.fill(x + 7, y + 2, 1, 4, c);
  if (dd) p.fill(x + 2, y + 6, 5, 1, c);
  if (e) p.fill(x + 1, y + 7, 1, 4, c);
  if (f) p.fill(x + 7, y + 7, 1, 4, c);
  if (g) p.fill(x + 2, y + 11, 5, 1, c);
}

function makeNumbers(ex: boolean): RgbaImage {
  const [img, p] = sheet(ex ? 'nums_ex' : 'numbers', P.lcd);
  for (let d = 0; d < 10; d++) sevenSeg(p, d * 9, 0, d, P.amber);
  if (ex) p.fill(99 + 2, 6, 5, 1, P.amber);
  else p.fill(20, 6, 5, 1, P.amber); // minus line inside the "2" cell area
  return img;
}

function makeText(): RgbaImage {
  const [img, p] = sheet('text', P.lcd);
  TEXT_ROWS.forEach((row, r) => [...row].forEach((ch, i) => p.glyph(ch, i * 5 + 1, r * 6, P.amber)));
  return img;
}

function makePosbar(): RgbaImage {
  const [img, p] = sheet('posbar', P.lcd);
  p.fill(0, 0, 248, 10, P.lcd);
  p.fill(2, 4, 244, 2, P.bg2);
  for (let x = 2; x < 246; x += 20) p.fill(x, 3, 1, 4, P.line);
  p.bevel(248, 0, 29, 10, false, P.amberDim);
  p.fill(248 + 13, 2, 3, 6, P.amberHi);
  p.bevel(278, 0, 29, 10, true, P.amber);
  p.fill(278 + 13, 2, 3, 6, P.amberHi);
  return img;
}

function makeSlider(name: 'volume' | 'balance'): RgbaImage {
  const [img, p] = sheet(name, P.lcd);
  const x0 = name === 'volume' ? 0 : 9,
    w = name === 'volume' ? 68 : 38;
  for (let i = 0; i < 28; i++) {
    const y = i * 15;
    p.fill(x0, y, w, 13, P.lcd);
    const t = i / 27;
    const lit = name === 'volume' ? Math.round((w - 4) * t) : Math.round(((w - 4) / 2) * t);
    const col = mix(P.green, P.red, t);
    p.fill(x0 + 2, y + 5, w - 4, 3, P.bg2);
    if (name === 'volume') p.fill(x0 + 2, y + 5, lit, 3, col);
    else {
      const mid = x0 + 2 + Math.floor((w - 4) / 2);
      p.fill(mid - lit, y + 5, lit * 2 || 1, 3, col);
    }
  }
  p.bevel(15, 422, 14, 11, false, P.bg2);
  p.fill(15 + 6, 424, 2, 7, P.amber);
  p.bevel(0, 422, 14, 11, true, P.bg2);
  p.fill(6, 424, 2, 7, P.amberHi);
  return img;
}

function makeMonoster(): RgbaImage {
  const [img, p] = sheet('monoster', P.bg1);
  for (const [x, w, label] of [
    [0, 29, 'STEREO'],
    [29, 27, 'MONO'],
  ] as const) {
    for (const [y, on] of [
      [0, true],
      [12, false],
    ] as const) {
      p.fill(x, y, w, 12, P.bg1);
      p.textCentered(label, x + w / 2, y + 4, on ? P.amber : P.line);
    }
  }
  return img;
}

function makePlaypaus(): RgbaImage {
  const [img, p] = sheet('playpaus', P.lcd);
  p.tri(2, 1, 7, 1, P.amber);
  p.fill(10, 1, 2, 7, P.amber);
  p.fill(14, 1, 2, 7, P.amber);
  p.fill(20, 2, 5, 5, P.amber);
  p.fill(36, 1, 3, 7, P.red);
  p.fill(39, 1, 3, 7, P.green);
  return img;
}

function makeShufrep(): RgbaImage {
  const [img, p] = sheet('shufrep', P.bg1);
  const btn = (x: number, y: number, w: number, h: number, sunken: boolean, on: boolean, label: string) => {
    p.bevel(x, y, w, h, sunken);
    p.fill(x + 3, y + Math.floor(h / 2) - 1, 2, 2, on ? P.amber : P.sh); // LED
    p.text(label, x + 7, y + Math.floor(h / 2) - 2, on ? P.amberHi : P.text);
  };
  [
    [0, false, false],
    [15, true, false],
    [30, false, true],
    [45, true, true],
  ].forEach(([y, sunk, on]) => {
    btn(0, y as number, 28, 15, sunk as boolean, on as boolean, 'REP');
    btn(28, y as number, 47, 15, sunk as boolean, on as boolean, 'SHUFFLE');
  });
  for (const [x, label] of [
    [0, 'EQ'],
    [23, 'PL'],
  ] as const) {
    btn(x, 61, 23, 12, false, false, label);
    btn(x, 73, 23, 12, false, true, label);
    btn(x + 46, 61, 23, 12, true, false, label);
    btn(x + 46, 73, 23, 12, true, true, label);
  }
  return img;
}

function makeEqmain(): RgbaImage {
  const [img, p] = sheet('eqmain', P.bg0);
  p.vgrad(0, 0, 275, 116, P.bg2, P.bg0);
  p.rect(0, 0, 275, 116, P.sh);
  titleStrip(p, 0, 0, 275, true, 'EQUALIZER');
  titleStrip(p, 0, 134, 275, true, 'EQUALIZER');
  titleStrip(p, 0, 149, 275, false, 'EQUALIZER');
  p.well(86, 17, 113, 19);
  p.text('PREAMP', 13, 105, P.dim);
  const labels = ['60', '170', '310', '600', '1K', '3K', '6K', '12K', '14K', '16K'];
  EQ_POS.bands.forEach(([x], i) => p.textCentered(labels[i]!, x + 7, 105, P.dim));
  p.text('+12', 50, 38, P.dim);
  p.text('0', 58, 67, P.dim);
  p.text('-12', 50, 96, P.dim);
  for (const [x] of [EQ_POS.preamp, ...EQ_POS.bands]) p.well(x + 5, 39, 4, 61, P.lcd);
  // slider backgrounds: a groove with an amber fill from the centre line to the thumb
  for (let k = 0; k < 28; k++) {
    const x = 13 + (k % 14) * 15,
      y = 164 + Math.floor(k / 14) * 65;
    p.fill(x, y, 14, 63, P.bg1);
    p.fill(x + 5, y + 1, 4, 61, P.lcd);
    const thumbY = Math.round((k / 27) * 51) + 6;
    const mid = 31;
    const [a, b] = thumbY < mid ? [thumbY, mid] : [mid, thumbY];
    p.fill(x + 6, y + a, 2, b - a + 1, mix(P.amber, P.red, Math.abs(k - 13.5) / 13.5));
  }
  p.bevel(0, 164, 11, 11, false, P.bg2);
  p.fill(1, 169, 9, 1, P.amber);
  p.bevel(0, 176, 11, 11, true, P.bg2);
  p.fill(1, 181, 9, 1, P.amberHi);
  // graph
  p.fill(0, 294, 113, 19, P.lcd);
  for (const y of [294 + 9]) p.fill(0, y, 113, 1, P.bg2);
  for (let j = 0; j < 19; j++) p.px(115, 294 + j, mix(P.red, P.green, j / 18));
  p.fill(0, 314, 113, 1, P.dim);
  // buttons
  const b = (sp: Sprite, sunken: boolean, on: boolean, label: string) => {
    p.bevel(sp.x, sp.y, sp.w, sp.h, sunken);
    p.fill(sp.x + 3, sp.y + 5, 2, 2, on ? P.amber : P.sh);
    p.text(label, sp.x + 7, sp.y + 4, on ? P.amberHi : P.text);
  };
  b(EQ.onBtn, false, false, 'ON');
  b(EQ.onBtnDown, true, false, 'ON');
  b(EQ.onBtnOn, false, true, 'ON');
  b(EQ.onBtnOnDown, true, true, 'ON');
  b(EQ.autoBtn, false, false, 'AUTO');
  b(EQ.autoBtnDown, true, false, 'AUTO');
  b(EQ.autoBtnOn, false, true, 'AUTO');
  b(EQ.autoBtnOnDown, true, true, 'AUTO');
  p.bevel(224, 164, 44, 12);
  p.text('PRESETS', 225 + 4, 168, P.text);
  p.bevel(224, 176, 44, 12, true);
  p.text('PRESETS', 225 + 4, 180, P.amber);
  // close button (pressed); the normal one is part of the title strip
  for (const [x, y, sunk] of [
    [264, 3, false],
    [254, 3, false],
    [264, 137, false],
    [254, 137, false],
    [264, 152, false],
    [254, 152, false],
    [0, 116, true],
  ] as const) {
    p.bevel(x, y, 9, 9, sunk);
    const cx = x + 4,
      cy = y + 4,
      c = sunk ? P.amber : P.text;
    if (x === 254) (p.fill(cx - 2, cy - 2, 5, 1, c), p.fill(cx - 2, cy, 5, 1, c));
    else [-2, -1, 0, 1, 2].forEach((d) => (p.px(cx + d, cy + d, c), p.px(cx + d, cy - d, c)));
  }
  return img;
}

function makeEqEx(): RgbaImage {
  const [img, p] = sheet('eq_ex', P.bg0);
  for (const [y, active] of [
    [0, true],
    [15, false],
  ] as const) {
    titleStrip(p, 0, y, 275, active, 'EQ');
    p.well(61, y + 4, 97, 7);
    p.well(164, y + 4, 43, 7);
  }
  p.fill(1, 30, 3, 7, P.amber);
  p.fill(11, 30, 3, 7, P.amber);
  for (const [x, y] of [
    [254, 3],
    [1, 47],
    [11, 47],
  ])
    p.bevel(x!, y!, 9, 9, true);
  return img;
}

function makePledit(): RgbaImage {
  const [img, p] = sheet('pledit', P.bg0);
  const top = (active: boolean, y: number) => {
    for (const sp of [PL.topLeft, PL.topTitle, PL.topFill, PL.topRight]) {
      p.vgrad(sp.x, y, sp.w, 20, active ? P.bg2 : P.bg1, active ? P.bg1 : P.bg0);
      p.fill(sp.x, y, sp.w, 1, active ? P.hi : P.line);
      p.fill(sp.x, y + 19, sp.w, 1, P.sh);
      p.fill(sp.x, y + 8, sp.w, 1, active ? P.line : P.bg2);
      p.fill(sp.x, y + 11, sp.w, 1, active ? P.line : P.bg2);
    }
    p.fill(PL.topTitle.x + 14, y + 6, 72, 8, active ? P.bg2 : P.bg1);
    p.textCentered('PLAYLIST', PL.topTitle.x + 50, y + 7, active ? P.amber : P.dim);
    // close + shade buttons drawn into the top-right piece
    for (const [dx, kind] of [
      [PL.topRight.w - 11, 'x'],
      [PL.topRight.w - 21, 's'],
    ] as const) {
      const bx = PL.topRight.x + dx,
        by = y + 3;
      p.bevel(bx, by, 9, 9);
      if (kind === 'x')
        [-2, -1, 0, 1, 2].forEach(
          (d) => (p.px(bx + 4 + d, by + 4 + d, P.text), p.px(bx + 4 + d, by + 4 - d, P.text)),
        );
      else (p.fill(bx + 2, by + 2, 5, 1, P.text), p.fill(bx + 2, by + 4, 5, 1, P.text));
    }
  };
  top(true, 0);
  top(false, 21);
  p.vgrad(PL.left.x, PL.left.y, 12, 29, P.bg2, P.bg1);
  p.fill(PL.left.x + 11, PL.left.y, 1, 29, P.sh);
  p.vgrad(PL.right.x, PL.right.y, 20, 29, P.bg2, P.bg1);
  p.fill(PL.right.x, PL.right.y, 1, 29, P.line);
  p.fill(PL.right.x + 5, PL.right.y, 8, 29, P.lcd); // scroll groove
  p.bevel(PL.scrollThumb.x, PL.scrollThumb.y, 8, 18, false);
  p.bevel(PL.scrollThumbDown.x, PL.scrollThumbDown.y, 8, 18, true);
  // bottom pieces
  for (const sp of [PL.bottomLeft, PL.bottomRight, PL.bottomFill, PL.visExtra]) {
    p.vgrad(sp.x, sp.y, sp.w, sp.h, P.bg1, P.bg0);
    p.fill(sp.x, sp.y, sp.w, 1, P.line);
  }
  // menu buttons in the bottom-left piece
  ['ADD', 'REM', 'SEL', 'MISC'].forEach((l, i) => {
    const x = PL.bottomLeft.x + 14 + i * 29,
      y = PL.bottomLeft.y + 10;
    p.bevel(x, y, 25, 18);
    p.textCentered(l, x + 13, y + 7, P.text);
  });
  // bottom-right: list button, time display, mini transport
  {
    const bx = PL.bottomRight.x,
      by = PL.bottomRight.y;
    p.bevel(bx + 150 - 44, by + 10, 25, 18);
    p.textCentered('LIST', bx + 150 - 31, by + 17, P.text);
    p.well(bx + 7, by + 10, 90, 7);
    p.well(bx + 66, by + 22, 30, 7);
    const c = P.text;
    const icons: ((x: number, y: number) => void)[] = [
      (x, y) => (p.fill(x, y, 1, 5, c), p.tri(x + 4, y, 5, -1, c)),
      (x, y) => p.tri(x + 1, y, 5, 1, c),
      (x, y) => (p.fill(x, y, 2, 5, c), p.fill(x + 3, y, 2, 5, c)),
      (x, y) => p.fill(x, y, 5, 5, c),
      (x, y) => (p.tri(x, y, 5, 1, c), p.fill(x + 4, y, 1, 5, c)),
      (x, y) => (p.tri(x + 2, y, 3, 1, c), p.fill(x, y + 4, 5, 1, c)),
    ];
    icons.forEach((f, i) => f(bx + 8 + i * 9, by + 23));
  }
  // shade pieces
  for (const sp of [PL.shadeLeft, PL.shadeRight, PL.shadeFill]) {
    p.vgrad(sp.x, sp.y, sp.w, 14, P.bg2, P.bg1);
    p.fill(sp.x, sp.y + 13, sp.w, 1, P.sh);
  }
  p.vgrad(PL.shadeRightInactive.x, PL.shadeRightInactive.y, 50, 14, P.bg1, P.bg0);
  for (const sp of [PL.closeBtnDown, PL.shadeBtnDown, PL.unshadeBtnDown]) p.bevel(sp.x, sp.y, 9, 9, true);
  // pop-up menu items
  const labels: Record<string, string> = {
    addUrl: 'URL',
    addDir: 'DIR',
    addFile: 'FILE',
    remAll: 'ALL',
    crop: 'CROP',
    remSel: 'SEL',
    remMisc: 'DUP',
    selInvert: 'INV',
    selNone: 'NONE',
    selAll: 'ALL',
    sort: 'SORT',
    fileInfo: 'INFO',
    miscOpts: 'OPTS',
    newList: 'NEW',
    saveList: 'SAVE',
    loadList: 'LOAD',
  };
  for (const menu of Object.values(PL_MENUS)) {
    p.fill(menu.bar.x, menu.bar.y, menu.bar.w, menu.bar.h, P.amberDim);
    for (const it of menu.items) {
      p.bevel(it.normal.x, it.normal.y, 22, 18);
      p.textCentered(labels[it.id] ?? '', it.normal.x + 11, it.normal.y + 7, P.text);
      p.bevel(it.selected.x, it.selected.y, 22, 18, true, P.amberDim);
      p.textCentered(labels[it.id] ?? '', it.selected.x + 11, it.selected.y + 7, P.amberHi);
    }
  }
  return img;
}

let cached: Skin | null = null;

export function defaultSkin(): Skin {
  if (cached) return cached;
  const main = makeMain();
  // The title bar sits on top of main.bmp's first 14 rows; keep main's own top consistent with it.
  void MAIN_POS;
  cached = {
    name: 'RevAmp Graphite',
    sheets: {
      main,
      cbuttons: makeCbuttons(),
      titlebar: makeTitlebar(),
      numbers: makeNumbers(false),
      nums_ex: makeNumbers(true),
      text: makeText(),
      posbar: makePosbar(),
      volume: makeSlider('volume'),
      balance: makeSlider('balance'),
      monoster: makeMonoster(),
      playpaus: makePlaypaus(),
      shufrep: makeShufrep(),
      eqmain: makeEqmain(),
      eq_ex: makeEqEx(),
      pledit: makePledit(),
    },
    playlist: {
      normal: P.amber as [number, number, number],
      current: [255, 240, 210],
      normalBg: P.lcd as [number, number, number],
      selectedBg: [60, 46, 22],
      font: 'Segoe UI',
    },
    vis: DEFAULT_VIS_COLORS.map((_c, i) => {
      if (i === 0) return [...P.lcd] as [number, number, number];
      if (i === 1) return [...P.bg2] as [number, number, number];
      if (i >= 2 && i <= 17) return mix(P.amberHi, P.amberDim, (i - 2) / 15) as [number, number, number];
      if (i >= 18 && i <= 22) return mix(P.amberHi, P.amber, (i - 18) / 4) as [number, number, number];
      return [...P.text] as [number, number, number];
    }),
    regions: {},
    cursors: {},
    hasNumsEx: true,
    warnings: [],
  };
  return cached;
}
