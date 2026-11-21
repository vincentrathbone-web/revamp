/**
 * Builds a complete classic-layout skin from a hi-fi `Design`: one painter for every sheet, with each sprite
 * drawn over the exact backdrop it will sit on, so round buttons, knobs and caps blend into the panel.
 */
import { createImage, type RgbaImage } from '../image';
import { SHEET_SIZES, type Skin } from '../skin';
import { EQ, EQ_POS, MAIN, MAIN_POS, PL, PL_MENUS, SHADE_POS, type Sprite } from '../sprites';
import { TEXT_ROWS, FONT_3X5 } from '../default-skin';
import type { Polygon, Regions } from '../textfiles';
import { videoSheetFromPledit } from '../video-sheet';
import {
  Canvas,
  bevel,
  circle,
  clamp01,
  mix,
  rrect,
  scale,
  shade,
  union,
  type Material,
  type RGB,
  type Sdf,
} from './canvas';
import {
  displayWell,
  drawIcon,
  dropShadow,
  led,
  panel,
  segDigit,
  text,
  textCentered,
  textWidth,
  type Icon,
  type TextStyle,
} from './kit';

export type ButtonShape = 'round' | 'orb' | 'key' | 'square' | 'pill';
export type Win = 'main' | 'eq';

export interface Design {
  id: string;
  name: string;
  /** One line for the gallery. */
  description: string;
  brand: string;
  model: string;
  /** Colour of the model name in the title (defaults to the accent). */
  modelColor?: RGB;
  /** Small print under the display (at most 21 characters). */
  tagline: string;
  brandStyle: TextStyle;
  /** Window corner radius (0 = square). */
  corner: number;
  body: Material;
  /** Title bar band (defaults to the body). */
  titleBand?: Material;
  outline: RGB;
  /** Bevel strength of the window edge. */
  edgeLight?: number;
  ink: RGB;
  inkDim: RGB;
  accent: RGB;
  screen: {
    bg: RGB;
    on: RGB;
    /** Brightest text (current track). */
    hi: RGB;
    dim: RGB;
    ghost: RGB | null;
    bezel: RGB;
    radius: number;
    slant?: boolean;
    glow?: number;
    sheen?: number;
  };
  button: {
    shape: ButtonShape;
    face: RGB;
    /** Surface for button faces (defaults to a plain face). */
    material?: (base: RGB) => Material;
    icon: RGB;
    iconDown: RGB;
    rim: RGB;
    /** A recessed tray behind the transport buttons. */
    bay?: RGB;
    glow?: boolean;
  };
  small: { face: RGB; text: RGB; on: RGB; shape: 'pill' | 'key' | 'round' };
  thumb: { face: RGB; mark: RGB; style: 'cap' | 'round' | 'gold' | 'bar' };
  groove: RGB;
  fill: [RGB, RGB];
  /** Extra art on the main and EQ windows (after the standard layout). */
  decorate?: (c: Canvas, win: Win, d: Design) => void;
  /** Free area at the bottom right of the main window (x 238..270, y 84..112). */
  corner2?: (c: Canvas, d: Design) => void;
}

const BOX = (x: number, y: number, w: number, h: number): [number, number, number, number] => [
  x,
  y,
  x + w,
  y + h,
];
const sheetImg = (name: keyof typeof SHEET_SIZES, fill: RGB = [0, 0, 0]): RgbaImage => {
  const [w, h] = SHEET_SIZES[name];
  const img = createImage(w, h);
  new Canvas(img).rect(0, 0, w, h, fill);
  return img;
};
const cell = (img: RgbaImage, sp: Sprite, wx: number, wy: number) =>
  Canvas.cell(img, sp.x, sp.y, sp.w, sp.h, wx, wy);
const at = (p: readonly number[]) => [p[0]!, p[1]!] as const;

// ------------------------------------------------------------------ common pieces
function body(c: Canvas, d: Design, w: number, h: number, corner = d.corner): void {
  c.rect(0, 0, w, h, d.outline);
  panel(c, 0, 0, w, h, corner, d.body, { bevel: 2.2, light: d.edgeLight ?? 0.5, outline: d.outline });
}

function titleBand(c: Canvas, d: Design, w: number): void {
  if (!d.titleBand) return;
  const f = rrect(1, 1, w - 2, 13, Math.max(0, d.corner - 1));
  c.shape(
    (x, y) => Math.max(f(x, y), y - 14),
    BOX(1, 1, w - 2, 13),
    (x, y) => d.titleBand!(Math.floor(x), Math.floor(y)),
  );
  c.rect(2, 14, w - 4, 1, shade(d.outline, 0.1), 0.6);
}

function brandMark(c: Canvas, d: Design, x: number, y: number, active: boolean): number {
  const col = active ? d.ink : d.inkDim;
  const w = text(c, d.brand, x, y, col, { ...d.brandStyle, under: { c: [0, 0, 0], a: 0.35 } });
  const mx = x + w + 5;
  const my = y + (d.brandStyle.font === '5x7' ? 2 : 0);
  text(c, d.model, mx, my, active ? (d.modelColor ?? d.accent) : d.inkDim, { font: '3x5', spacing: 1 });
  return mx + textWidth(d.model);
}

/** Small button: pill, key or round, with an LED and a label. */
function smallButton(
  c: Canvas,
  d: Design,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  pressed: boolean,
  on: boolean | null,
): void {
  const s = d.small;
  const r = s.shape === 'pill' ? h / 2 : s.shape === 'round' ? h / 2 : 2;
  const f = rrect(x + 0.5, y + 0.5, w - 1, h - 1, r);
  if (!pressed) dropShadow(c, f, BOX(x, y, w, h), 0.8, 0.35, 1.5);
  const face = pressed ? shade(s.face, -0.12) : s.face;
  c.shape(f, BOX(x, y, w, h), (px, py, dd) => {
    const t = (py - y) / h;
    const base = shade(face, (0.5 - t) * 0.22 * (pressed ? -1 : 1));
    return mix(
      shade(base, bevel(f, px, py, dd, 1.3) * 0.5 * (pressed ? -1 : 1)),
      d.outline,
      clamp01(1 + dd) * 0.8,
    );
  });
  let tx = x + w / 2;
  if (on !== null) {
    const lx = x + (s.shape === 'pill' ? 5 : 4);
    led(c, lx, y + h / 2, 1.5, d.accent, on);
    tx += 2.5;
  }
  textCentered(
    c,
    label,
    tx + (pressed ? 0.5 : 0),
    Math.round(y + h / 2 - 2.5 + (pressed ? 1 : 0)),
    on ? shade(s.on, 0.1) : s.text,
    { font: '3x5', spacing: 1 },
  );
}

/** A transport button of the design's shape, centred in (x, y, w, h). */
function transportButton(
  c: Canvas,
  d: Design,
  x: number,
  y: number,
  w: number,
  h: number,
  icon: Icon,
  pressed: boolean,
): void {
  const b = d.button;
  const m = b.material ? b.material(b.face) : () => b.face;
  const cx = x + w / 2,
    cy = y + h / 2;
  let f: Sdf;
  switch (b.shape) {
    case 'round':
    case 'orb':
      f = circle(cx, cy, Math.min(w, h) / 2 - 0.8);
      break;
    case 'key':
      f = rrect(x + 0.5, y + 0.5, w - 1, h - 1, 2);
      break;
    case 'square':
      f = rrect(x + 1.5, y + 1, w - 3, h - 2, 3);
      break;
    case 'pill':
      f = rrect(x + 1, y + 2, w - 2, h - 4, (h - 4) / 2);
      break;
  }
  const box = BOX(x, y, w, h);
  if (!pressed) dropShadow(c, f, box, 1, 0.5, 2);
  const R = Math.min(w, h) / 2;
  c.shape(f, box, (px, py, dd) => {
    const base = m(Math.floor(px), Math.floor(py));
    let col: RGB;
    if (b.shape === 'orb') {
      // glossy dome
      const nx = (px - cx) / R,
        ny = (py - cy) / R;
      const diff = clamp01(0.55 - nx * 0.35 - ny * 0.55);
      col = shade(base, (diff - 0.45) * 0.8 * (pressed ? 0.6 : 1));
      const spec = clamp01(1 - Math.hypot(nx + 0.25, ny + 0.5) / 0.42);
      col = shade(col, spec * spec * 0.85);
      const rimLight = clamp01((Math.hypot(nx, ny) - 0.72) / 0.28) * clamp01(ny + 0.2);
      col = shade(col, rimLight * 0.35);
    } else if (b.shape === 'round') {
      const lin = ((px - cx) * -0.55 + (py - cy) * -0.83) / R;
      col = shade(
        base,
        lin * 0.28 * (pressed ? -1 : 1) + bevel(f, px, py, dd, 1.5) * 0.35 * (pressed ? -1 : 1),
      );
      if (dd > -2.2) col = mix(col, b.rim, clamp01(1 - (-dd - 1) / 1.2) * 0.55);
    } else {
      const t = clamp01((py - y) / h);
      col = shade(
        base,
        (0.5 - t) * 0.3 * (pressed ? -0.6 : 1) +
          bevel(f, px, py, dd, b.shape === 'key' ? 1.6 : 2) * 0.55 * (pressed ? -1 : 1),
      );
    }
    return mix(col, d.outline, clamp01(1 + dd) * 0.7);
  });
  const s = b.shape === 'round' || b.shape === 'orb' ? 0.8 : 0.95;
  drawIcon(c, icon, cx + (pressed ? 0.4 : 0), cy + (pressed ? 0.6 : 0), pressed ? b.iconDown : b.icon, s, {
    glow: b.glow && pressed ? b.iconDown : undefined,
    engrave: b.shape === 'orb' ? undefined : shade(b.face, 0.35),
  });
}

/** Little title-bar button (9x9). */
function winButton(c: Canvas, d: Design, x: number, y: number, icon: Icon, pressed: boolean): void {
  const f = d.small.shape === 'key' ? rrect(x + 0.5, y + 0.5, 8, 8, 1.5) : circle(x + 4.5, y + 4.5, 4);
  const box = BOX(x, y, 9, 9);
  const face = pressed ? shade(d.small.face, -0.18) : d.small.face;
  c.shape(f, box, (px, py, dd) =>
    mix(
      shade(face, bevel(f, px, py, dd, 1.2) * 0.5 * (pressed ? -1 : 1) + (0.5 - (py - y) / 9) * 0.2),
      d.outline,
      clamp01(1 + dd) * 0.8,
    ),
  );
  drawIcon(c, icon, x + 4.5, y + 4.5, pressed ? d.accent : d.small.text, 0.85);
}

function shadeStrip(c: Canvas, d: Design, w: number, _active: boolean): void {
  body(c, d, w, 14, Math.min(d.corner, 5));
  titleBand(c, d, w);
}

// ------------------------------------------------------------------ main window
const MAIN_SCREEN: Sdf = union(rrect(19, 21, 251, 33, 0), rrect(19, 21, 88, 42, 0));

function screenShape(d: Design): Sdf {
  const r = d.screen.radius;
  return union(rrect(19, 21, 251, 33, r), rrect(19, 21, 88, 42, r));
}

function paintMain(d: Design): RgbaImage {
  const img = createImage(275, 116);
  const c = new Canvas(img);
  body(c, d, 275, 116);
  titleBand(c, d, 275);
  // engraved line under the title area
  if (!d.titleBand) {
    c.rect(4, 14, 267, 1, shade(d.outline, 0.05), 0.35);
    c.rect(4, 15, 267, 1, [255, 255, 255], 0.08);
  }
  // display
  const sc = screenShape(d);
  displayWell(c, sc, BOX(19, 21, 251, 42), d.screen.bg, {
    bezel: d.screen.bezel,
    sheen: d.screen.sheen,
    ring: 1.6,
  });
  void MAIN_SCREEN;
  const S = d.screen;
  // time colon
  for (const yy of [29, 35]) c.rect(73, yy, 2, 2, S.dim);
  text(c, 'KBPS', 128, 44, S.dim, { font: '3x5' });
  text(c, 'KHZ', 168, 44, S.dim, { font: '3x5' });
  // divider between the title line and the info line
  c.rect(110, 38, 157, 1, S.dim, 0.35);
  // tagline
  text(c, d.tagline, 20, 65, d.inkDim, { font: '3x5', spacing: 1, under: { c: [255, 255, 255], a: 0.06 } });
  // transport bay
  if (d.button.bay) {
    panel(c, 13, 85, 147, 24, 5, () => d.button.bay!, {
      sunken: true,
      bevel: 1.6,
      light: 0.45,
      outline: shade(d.button.bay, -0.5),
    });
  }
  if (d.corner2) d.corner2(c, d);
  d.decorate?.(c, 'main', d);
  return img;
}

function paintTitle(d: Design, main: RgbaImage, active: boolean): RgbaImage {
  // a 275x14 strip: the top of the main window with the brand
  const img = createImage(275, 14);
  const c = new Canvas(img);
  c.backdrop(main);
  brandMark(c, d, 18, d.brandStyle.font === '5x7' ? 4 : 5, active);
  if (!active) c.rect(0, 0, 275, 14, d.outline, 0.18);
  return img;
}

function paintMainShade(d: Design, active: boolean): RgbaImage {
  const img = createImage(275, 14);
  const c = new Canvas(img);
  shadeStrip(c, d, 275, active);
  text(c, d.brand, 18, 5, active ? d.ink : d.inkDim, { font: '3x5', spacing: 1, bold: true });
  const S = d.screen;
  const well = (x: number, y: number, w: number, h: number) =>
    displayWell(c, rrect(x, y, w, h, 1.5), BOX(x, y, w, h), S.bg, { bezel: S.bezel, ring: 1 });
  well(78, 4, 40, 7);
  well(125, 3, 33, 8);
  well(226, 4, 17, 7);
  const ic: [Icon, number][] = [
    ['prev', 173],
    ['play', 182],
    ['pause', 192],
    ['stop', 201.5],
    ['next', 210],
    ['eject', 220.5],
  ];
  for (const [i, x] of ic) drawIcon(c, i, x, 7.5, active ? d.small.text : d.inkDim, 0.6);
  if (!active) c.rect(0, 0, 275, 14, d.outline, 0.15);
  return img;
}

// ------------------------------------------------------------------ EQ window
const BAND_LABELS = ['60', '170', '310', '600', '1K', '3K', '6K', '12K', '14K', '16K'];
const dbY = (k: number) => 38 + 5.5 + (k / 4) * 51; // k = 0 (+12 dB) .. 4 (-12 dB)

function paintEq(d: Design): RgbaImage {
  const img = createImage(275, 116);
  const c = new Canvas(img);
  body(c, d, 275, 116);
  titleBand(c, d, 275);
  if (!d.titleBand) c.rect(4, 14, 267, 1, shade(d.outline, 0.05), 0.35);
  const S = d.screen;
  displayWell(c, rrect(86, 17, 113, 19, 1.5), BOX(86, 17, 113, 19), S.bg, { bezel: S.bezel, ring: 1.4 });
  // dB scale + grid lines across the band area
  const lab: [string, number][] = [
    ['+12', 0],
    ['+6', 1],
    ['0', 2],
    ['-6', 3],
    ['-12', 4],
  ];
  for (const [t, k] of lab) {
    const y = Math.round(dbY(k));
    text(c, t, 64 - textWidth(t), y - 2, k === 2 ? d.ink : d.inkDim, { font: '3x5' });
    c.rect(67, y, 8, 1, d.inkDim, k === 2 ? 0.9 : 0.5);
    c.rect(77, y, 180, 1, d.inkDim, k === 2 ? 0.28 : 0.14);
  }
  textCentered(c, 'PREAMP', 28, 104, d.inkDim, { font: '3x5' });
  EQ_POS.bands.forEach(([x], i) => textCentered(c, BAND_LABELS[i]!, x + 7, 104, d.inkDim, { font: '3x5' }));
  text(c, 'HZ', 259, 104, d.inkDim, { font: '3x5' });
  // divider between preamp and bands
  c.rect(42, 40, 1, 58, d.inkDim, 0.2);
  d.decorate?.(c, 'eq', d);
  return img;
}

function paintEqTitle(d: Design, eq: RgbaImage, active: boolean): RgbaImage {
  const img = createImage(275, 14);
  const c = new Canvas(img);
  c.backdrop(eq);
  const x = brandMark(c, d, 18, d.brandStyle.font === '5x7' ? 4 : 5, active);
  text(c, 'GRAPHIC EQUALIZER', x + 8, 5, active ? d.ink : d.inkDim, { font: '3x5', spacing: 1 });
  for (const [bx, i] of [
    [254, 'shade'],
    [264, 'close'],
  ] as const)
    winButton(c, d, bx, 3, i, false);
  if (!active) c.rect(0, 0, 275, 14, d.outline, 0.18);
  return img;
}

/** One EQ slider frame (14x63) at level k (0 = top). */
function eqFrame(c: Canvas, d: Design, x: number, y: number, k: number | null): void {
  for (let i = 0; i <= 4; i++)
    c.rect(x, Math.round(y + 5.5 + (i / 4) * 51), 14, 1, d.inkDim, i === 2 ? 0.28 : 0.14);
  const g = rrect(x + 5, y + 2, 4, 59, 2);
  c.shape(g, BOX(x + 5, y + 2, 4, 59), (px, py, dd) => shade(d.groove, -bevel(g, px, py, dd, 1.2) * 0.6));
  if (k !== null) {
    const thumbY = Math.round((k / 27) * 51) + 6;
    const mid = 31;
    const [a, b] = thumbY < mid ? [thumbY, mid] : [mid, thumbY];
    const t = Math.abs(k - 13.5) / 13.5;
    const col = mix(d.fill[0], d.fill[1], t);
    for (let yy = a; yy <= b; yy++) c.rect(x + 6, y + yy, 2, 1, col, 0.95);
    if (b > a) c.halo(rrect(x + 6, y + a, 2, b - a + 1, 1), BOX(x + 6, y + a, 2, b - a), col, 2, 0.25);
  }
}

function thumb(
  c: Canvas,
  d: Design,
  x: number,
  y: number,
  w: number,
  h: number,
  pressed: boolean,
  vertical = false,
): void {
  const t = d.thumb;
  const face = pressed ? shade(t.face, -0.12) : t.face;
  let f: Sdf;
  if (t.style === 'round') f = circle(x + w / 2, y + h / 2, Math.min(w, h) / 2 - 0.6);
  else if (t.style === 'bar')
    f = vertical ? rrect(x + 0.5, y + 3, w - 1, h - 6, 1) : rrect(x + 3, y + 0.5, w - 6, h - 1, 1);
  else f = rrect(x + 0.5, y + 0.5, w - 1, h - 1, 2);
  const box = BOX(x, y, w, h);
  dropShadow(c, f, box, 0.8, 0.5, 1.5);
  c.shape(f, box, (px, py, dd) => {
    let col: RGB;
    if (t.style === 'gold' || t.style === 'cap') {
      // machined cap: horizontal brushed bands + a bright top edge
      const band = Math.sin((vertical ? px - x : py - y) * 2.2) * 0.05;
      const lin = 0.5 - (py - y) / h;
      col = shade(face, lin * (t.style === 'gold' ? 0.5 : 0.35) + band + bevel(f, px, py, dd, 1.4) * 0.45);
    } else if (t.style === 'round') {
      const lin = ((px - x - w / 2) * -0.55 + (py - y - h / 2) * -0.83) / (w / 2);
      col = shade(face, lin * 0.35 + bevel(f, px, py, dd, 1.2) * 0.4);
    } else col = shade(face, bevel(f, px, py, dd, 1) * 0.5);
    return mix(col, d.outline, clamp01(1 + dd) * 0.75);
  });
  // grip mark
  if (vertical) c.rect(x + 2, Math.floor(y + h / 2), w - 4, 1, t.mark);
  else c.rect(Math.floor(x + w / 2), y + 2, 1, h - 4, t.mark);
}

// ------------------------------------------------------------------ the build
export function buildDesign(d: Design): Skin {
  const main = paintMain(d);
  const eqBody = paintEq(d);
  const S = d.screen;
  {
    // The slider frames are shared by all 11 sliders, so give every slider column the same backdrop
    // (the first band's) - otherwise textures show seams behind the frames.
    const [bx, by] = EQ_POS.bands[0]!;
    const strip = createImage(14, 63);
    Canvas.cell(strip, 0, 0, 14, 63, bx, by).backdrop(eqBody);
    for (const [x, y] of [EQ_POS.preamp, ...EQ_POS.bands])
      Canvas.cell(eqBody, x, y, 14, 63, 0, 0).backdrop(strip);
  }

  // main.bmp: the body; the title strip and every control are sprites over it
  const titlebar = sheetImg('titlebar', d.outline);
  const tb = new Canvas(titlebar);
  const titleA = paintTitle(d, main, true),
    titleI = paintTitle(d, main, false);
  const shadeA = paintMainShade(d, true),
    shadeI = paintMainShade(d, false);
  for (const [im, y] of [
    [titleA, 0],
    [titleI, 15],
    [shadeA, 29],
    [shadeI, 42],
  ] as const)
    new Canvas(titlebar, 27, y, [27, y, 302, y + 14]).backdrop(im);
  void tb;
  // title buttons: drawn over the title strip (and the shade strip for unshade)
  for (const [sp, pos, icon, down, src] of [
    [MAIN.optionsBtn, MAIN_POS.options, 'menu', false, titleA],
    [MAIN.optionsBtnDown, MAIN_POS.options, 'menu', true, titleA],
    [MAIN.minimizeBtn, MAIN_POS.minimize, 'min', false, titleA],
    [MAIN.minimizeBtnDown, MAIN_POS.minimize, 'min', true, titleA],
    [MAIN.closeBtn, MAIN_POS.close, 'close', false, titleA],
    [MAIN.closeBtnDown, MAIN_POS.close, 'close', true, titleA],
    [MAIN.shadeBtn, MAIN_POS.shade, 'shade', false, titleA],
    [MAIN.shadeBtnDown, MAIN_POS.shade, 'shade', true, titleA],
    [MAIN.unshadeBtn, SHADE_POS.unshade, 'unshade', false, shadeA],
    [MAIN.unshadeBtnDown, SHADE_POS.unshade, 'unshade', true, shadeA],
  ] as const) {
    const cc = cell(titlebar, sp, pos[0], pos[1]);
    cc.backdrop(src);
    winButton(cc, d, pos[0], pos[1], icon, down);
  }
  // clutter bar: a slim strip with O A I D V
  const clutter = (sp: Sprite, enabled: boolean) => {
    const cc = cell(titlebar, sp, 10, 22);
    cc.backdrop(main);
    const f = rrect(10.5, 22.5, 7, 42, 3.5);
    cc.shape(f, BOX(10, 22, 8, 43), (px, py, dd) =>
      mix(shade(d.small.face, -0.35 - bevel(f, px, py, dd, 1) * 0.4), d.outline, clamp01(1 + dd) * 0.8),
    );
    const tops = [3, 11, 19, 26, 34];
    'OAIDV'.split('').forEach((ch, i) =>
      text(cc, ch, 12, 22 + tops[i]! + 1, enabled ? d.small.text : shade(d.small.face, -0.1), {
        font: '3x5',
      }),
    );
  };
  clutter(MAIN.clutterBar, true);
  clutter(MAIN.clutterBarDisabled, false);
  for (const [sp, top, ch] of [
    [MAIN.clutterOptionsDown, 3, 'O'],
    [MAIN.clutterAlwaysOnTopDown, 11, 'A'],
    [MAIN.clutterInfoDown, 19, 'I'],
    [MAIN.clutterDoubleDown, 26, 'D'],
    [MAIN.clutterVisDown, 34, 'V'],
  ] as const) {
    const cc = cell(titlebar, sp, 10, 22 + top);
    cc.backdrop(main);
    cc.shape(rrect(11, 22 + top, 6, sp.h, 2), BOX(10, 22 + top, 8, sp.h), () => shade(d.accent, -0.35));
    text(cc, ch, 12, 22 + top + 1, shade(d.accent, 0.6), { font: '3x5' });
  }
  // shade-mode position bar
  {
    const cc = new Canvas(titlebar, 0 - 226, 36 - 4, [0, 36, 17, 43]);
    cc.backdrop(shadeA);
    cc.rect(227, 7, 15, 1, S.dim, 0.6);
    for (const [sp, dx] of [
      [MAIN.shadePosThumbLeft, 0],
      [MAIN.shadePosThumb, 1],
      [MAIN.shadePosThumbRight, 2],
    ] as const) {
      const t = new Canvas(titlebar, sp.x - 0, sp.y - 0, [sp.x, sp.y, sp.x + 3, sp.y + 7]);
      t.rect(sp.x, sp.y, 3, 7, S.bg);
      t.rect(sp.x, sp.y + 1, 3, 5, dx === 1 ? S.hi : S.on);
    }
  }

  // cbuttons
  const cbuttons = sheetImg('cbuttons');
  const tbtn: [keyof typeof MAIN, keyof typeof MAIN_POS, Icon][] = [
    ['prev', 'prev', 'prev'],
    ['play', 'play', 'play'],
    ['pause', 'pause', 'pause'],
    ['stop', 'stop', 'stop'],
    ['next', 'next', 'next'],
    ['eject', 'eject', 'eject'],
  ];
  for (const [k, pk, icon] of tbtn) {
    const pos = MAIN_POS[pk] as readonly [number, number];
    for (const down of [false, true]) {
      const sp = MAIN[(down ? `${k}Down` : k) as keyof typeof MAIN] as Sprite;
      const cc = cell(cbuttons, sp, pos[0], pos[1]);
      cc.backdrop(main);
      transportButton(cc, d, pos[0], pos[1], sp.w, sp.h, icon, down);
    }
  }

  // seven-segment digits (backdrop = the display at the first digit position)
  const digits = (ex: boolean) => {
    const img = sheetImg(ex ? 'nums_ex' : 'numbers', S.bg);
    const [dx, dy] = MAIN_POS.digits[0];
    for (let n = 0; n <= (ex ? 11 : 10); n++) {
      const cc = Canvas.cell(img, n * 9, 0, 9, 13, dx, dy);
      cc.backdrop(main);
      const v = n < 10 ? n : n === 10 ? 'blank' : 'minus';
      segDigit(cc, dx, dy, v, S.on, S.ghost, { slant: S.slant, glow: S.glow });
    }
    if (!ex) {
      // numbers.bmp minus: a 5x1 line at (20, 6); the "no minus" line at (9, 6) is the background
      new Canvas(img).rect(20, 6, 5, 1, S.on);
    }
    return img;
  };

  // display font
  const textImg = sheetImg('text', S.bg);
  {
    const tc = new Canvas(textImg);
    TEXT_ROWS.forEach((row, r) =>
      [...row].forEach((ch, i) => {
        const g = FONT_3X5[ch.toUpperCase()] ?? FONT_3X5[' ']!;
        for (let j = 0; j < 5; j++)
          for (let q = 0; q < 3; q++) if (g[j * 3 + q] === '1') tc.set(i * 5 + 1 + q, r * 6 + j, S.on);
      }),
    );
  }

  // position bar
  const posbar = sheetImg('posbar');
  {
    const cc = Canvas.cell(posbar, 0, 0, 248, 10, 16, 72);
    cc.backdrop(main);
    const g = rrect(17, 75, 246, 4, 2);
    cc.shape(g, BOX(17, 75, 246, 4), (px, py, dd) => shade(d.groove, -bevel(g, px, py, dd, 1.2) * 0.6));
    for (let x = 0; x <= 10; x++)
      cc.rect(Math.round(18 + x * 24.3), x % 5 === 0 ? 72 : 73, 1, x % 5 === 0 ? 2 : 1, d.inkDim, 0.6);
    const pbg = createImage(29, 10);
    for (const [sx, down] of [
      [248, false],
      [278, true],
    ] as const) {
      const t = Canvas.cell(posbar, sx, 0, 29, 10, 120, 72);
      t.backdrop(posbar, -16 + 16, -72 + 72);
      // backdrop from the bar background at the same window spot
      const src = new Canvas(pbg);
      void src;
      for (let y = 0; y < 10; y++)
        for (let x = 0; x < 29; x++) t.set(120 + x, 72 + y, cc.get(120 + x, 72 + y));
      thumb(t, d, 127, 72, 15, 10, down);
    }
  }

  // volume + balance
  const slider = (name: 'volume' | 'balance') => {
    const img = sheetImg(name);
    const x0 = name === 'volume' ? 0 : 9,
      w = name === 'volume' ? 68 : 38;
    const pos = name === 'volume' ? MAIN_POS.volume : MAIN_POS.balance;
    for (let i = 0; i < 28; i++) {
      const cc = Canvas.cell(img, x0, i * 15, w, 13, pos[0], pos[1]);
      cc.backdrop(main);
      const gx = pos[0] + 2,
        gw = w - 4,
        gy = pos[1] + 5;
      const g = rrect(gx, gy, gw, 3, 1.5);
      cc.shape(g, BOX(gx, gy, gw, 3), (px, py, dd) => shade(d.groove, -bevel(g, px, py, dd, 1) * 0.6));
      const t = i / 27;
      if (name === 'volume') {
        const lit = Math.round(gw * t);
        for (let x = 0; x < lit; x++) cc.rect(gx + x, gy + 1, 1, 1, mix(d.fill[0], d.fill[1], x / gw));
      } else {
        const mid = gx + Math.floor(gw / 2);
        const lit = Math.round((gw / 2) * t);
        for (let x = -lit; x <= lit; x++)
          cc.rect(mid + x, gy + 1, 1, 1, mix(d.fill[0], d.fill[1], Math.abs(x) / (gw / 2)));
      }
      // scale dots under the groove
      const n = name === 'volume' ? 10 : 6;
      for (let k = 0; k <= n; k++)
        cc.rect(Math.round(gx + 1 + (k * (gw - 3)) / n), pos[1] + 10, 1, 1, d.inkDim, 0.8);
    }
    // thumbs: drawn over frame 0 at a mid position
    for (const [sx, down] of [
      [15, false],
      [0, true],
    ] as const) {
      const cc = Canvas.cell(img, sx, 422, 14, 11, pos[0] + 20, pos[1] + 1);
      const fr = Canvas.cell(img, x0, 0, w, 13, pos[0], pos[1]);
      for (let y = 0; y < 11; y++)
        for (let x = 0; x < 14; x++)
          cc.set(
            pos[0] + 20 + x,
            pos[1] + 1 + y,
            fr.get(pos[0] + Math.min(20 + x, w - 1) - (x0 ? 0 : 0), pos[1] + 1 + y),
          );
      thumb(cc, d, pos[0] + 20, pos[1] + 1, 14, 11, down);
    }
    return img;
  };

  // mono / stereo indicators
  const monoster = sheetImg('monoster');
  for (const [sx, w, pos, label] of [
    [0, 29, MAIN_POS.stereo, 'STEREO'],
    [29, 27, MAIN_POS.mono, 'MONO'],
  ] as const)
    for (const [sy, on] of [
      [0, true],
      [12, false],
    ] as const) {
      const cc = Canvas.cell(monoster, sx, sy, w, 12, pos[0], pos[1]);
      cc.backdrop(main);
      if (on)
        cc.halo(
          rrect(pos[0] + 2, pos[1] + 3, w - 4, 6, 2),
          BOX(pos[0] + 2, pos[1] + 3, w - 4, 6),
          S.on,
          2,
          0.12 * (S.glow ?? 1),
        );
      textCentered(cc, label, pos[0] + w / 2, pos[1] + 4, on ? S.hi : (S.ghost ?? S.dim), { font: '3x5' });
    }

  // play status
  const playpaus = sheetImg('playpaus', S.bg);
  for (const [sx, icon] of [
    [0, 'play'],
    [9, 'pause'],
    [18, 'stop'],
  ] as const) {
    const cc = Canvas.cell(playpaus, sx, 0, 9, 9, 26, 28);
    cc.backdrop(main);
    drawIcon(cc, icon, 30.5, 32.5, S.on, 0.62, { glow: S.glow ? S.on : undefined });
  }
  for (const [sx, on] of [
    [36, false],
    [39, true],
  ] as const) {
    const cc = Canvas.cell(playpaus, sx, 0, 3, 9, 24, 28);
    cc.backdrop(main);
    cc.rect(25, 30, 1, 5, on ? S.on : (S.ghost ?? S.dim));
  }

  // shuffle / repeat / EQ / PL
  const shufrep = sheetImg('shufrep');
  const sbtn = (sp: Sprite, pos: readonly [number, number], label: string, pressed: boolean, on: boolean) => {
    const cc = cell(shufrep, sp, pos[0], pos[1]);
    cc.backdrop(main);
    smallButton(cc, d, pos[0], pos[1], sp.w, sp.h, label, pressed, on);
  };
  sbtn(MAIN.repeat, at(MAIN_POS.repeat), 'REP', false, false);
  sbtn(MAIN.repeatDown, at(MAIN_POS.repeat), 'REP', true, false);
  sbtn(MAIN.repeatOn, at(MAIN_POS.repeat), 'REP', false, true);
  sbtn(MAIN.repeatOnDown, at(MAIN_POS.repeat), 'REP', true, true);
  sbtn(MAIN.shuffle, at(MAIN_POS.shuffle), 'SHUFFLE', false, false);
  sbtn(MAIN.shuffleDown, at(MAIN_POS.shuffle), 'SHUFFLE', true, false);
  sbtn(MAIN.shuffleOn, at(MAIN_POS.shuffle), 'SHUFFLE', false, true);
  sbtn(MAIN.shuffleOnDown, at(MAIN_POS.shuffle), 'SHUFFLE', true, true);
  sbtn(MAIN.eqBtn, at(MAIN_POS.eqBtn), 'EQ', false, false);
  sbtn(MAIN.eqBtnDown, at(MAIN_POS.eqBtn), 'EQ', true, false);
  sbtn(MAIN.eqBtnOn, at(MAIN_POS.eqBtn), 'EQ', false, true);
  sbtn(MAIN.eqBtnOnDown, at(MAIN_POS.eqBtn), 'EQ', true, true);
  sbtn(MAIN.plBtn, at(MAIN_POS.plBtn), 'PL', false, false);
  sbtn(MAIN.plBtnDown, at(MAIN_POS.plBtn), 'PL', true, false);
  sbtn(MAIN.plBtnOn, at(MAIN_POS.plBtn), 'PL', false, true);
  sbtn(MAIN.plBtnOnDown, at(MAIN_POS.plBtn), 'PL', true, true);

  // ---------------------------------------------------------------- EQ sheets
  const eqmain = sheetImg('eqmain', d.outline);
  new Canvas(eqmain, 0, 0, [0, 0, 275, 116]).backdrop(eqBody);
  const eqTA = paintEqTitle(d, eqBody, true),
    eqTI = paintEqTitle(d, eqBody, false);
  new Canvas(eqmain, 0, 134, [0, 134, 275, 148]).backdrop(eqTA);
  new Canvas(eqmain, 0, 149, [0, 149, 275, 163]).backdrop(eqTI);
  // the main EQ image's own title rows show the active title
  new Canvas(eqmain, 0, 0, [0, 0, 275, 14]).backdrop(eqTA);
  {
    const [bx, by] = EQ_POS.bands[0]!;
    for (let k = 0; k < 28; k++) {
      const sx = 13 + (k % 14) * 15,
        sy = 164 + Math.floor(k / 14) * 65;
      const cc = Canvas.cell(eqmain, sx, sy, 14, 63, bx, by);
      cc.backdrop(eqBody);
      eqFrame(cc, d, bx, by, k);
    }
    // thumbs: over an empty frame
    const empty = createImage(14, 63);
    {
      const ec = Canvas.cell(empty, 0, 0, 14, 63, bx, by);
      ec.backdrop(eqBody);
      eqFrame(ec, d, bx, by, null);
    }
    for (const [sy, down] of [
      [164, false],
      [176, true],
    ] as const) {
      const cc = Canvas.cell(eqmain, 0, sy, 11, 11, bx + 1, by + 20);
      for (let y = 0; y < 11; y++)
        for (let x = 0; x < 11; x++) {
          const o = ((20 + y) * 14 + 1 + x) * 4;
          cc.set(bx + 1 + x, by + 20 + y, [empty.data[o]!, empty.data[o + 1]!, empty.data[o + 2]!]);
        }
      thumb(cc, d, bx + 1, by + 20, 11, 11, down, true);
    }
  }
  // ON / AUTO / PRESETS
  const ebtn = (
    sp: Sprite,
    pos: readonly [number, number],
    label: string,
    pressed: boolean,
    on: boolean | null,
  ) => {
    const cc = cell(eqmain, sp, pos[0], pos[1]);
    cc.backdrop(eqBody);
    smallButton(cc, d, pos[0], pos[1], sp.w, sp.h, label, pressed, on);
  };
  ebtn(EQ.onBtn, at(EQ_POS.on), 'ON', false, false);
  ebtn(EQ.onBtnDown, at(EQ_POS.on), 'ON', true, false);
  ebtn(EQ.onBtnOn, at(EQ_POS.on), 'ON', false, true);
  ebtn(EQ.onBtnOnDown, at(EQ_POS.on), 'ON', true, true);
  ebtn(EQ.autoBtn, at(EQ_POS.auto), 'AUTO', false, false);
  ebtn(EQ.autoBtnDown, at(EQ_POS.auto), 'AUTO', true, false);
  ebtn(EQ.autoBtnOn, at(EQ_POS.auto), 'AUTO', false, true);
  ebtn(EQ.autoBtnOnDown, at(EQ_POS.auto), 'AUTO', true, true);
  ebtn(EQ.presetsBtn, at(EQ_POS.presets), 'PRESETS', false, null);
  ebtn(EQ.presetsBtnDown, at(EQ_POS.presets), 'PRESETS', true, null);
  {
    // close button pressed
    const cc = cell(eqmain, EQ.closeBtnDown, 264, 3);
    cc.backdrop(eqTA);
    winButton(cc, d, 264, 3, 'close', true);
  }
  // graph background, colours, preamp line
  {
    const g = new Canvas(eqmain, 0 - 86, 294 - 17, [0, 294, 113, 313]);
    g.rect(86, 17, 113, 19, S.bg);
    for (let k = 1; k < 4; k++)
      g.rect(86, 17 + Math.round((k / 4) * 18), 113, 1, S.dim, k === 2 ? 0.35 : 0.15);
    for (let x = 0; x < 10; x++) g.rect(86 + Math.round((x / 9) * 112), 17, 1, 19, S.dim, 0.12);
    const cols = new Canvas(eqmain);
    for (let j = 0; j < 19; j++) cols.set(115, 294 + j, mix(S.hi, S.on, Math.abs(j - 9) / 9));
    for (let x = 0; x < 113; x++) cols.set(x, 314, x % 3 === 2 ? S.bg : S.dim);
  }
  // EQ shade strip
  const eqEx = sheetImg('eq_ex', d.outline);
  for (const [y, active] of [
    [0, true],
    [15, false],
  ] as const) {
    const cc = new Canvas(eqEx, 0, y, [0, y, 275, y + 14]);
    shadeStrip(cc, d, 275, active);
    text(cc, 'EQ', 18, 5, active ? d.ink : d.inkDim, { font: '3x5', spacing: 1, bold: true });
    const g1 = rrect(61, 6, 97, 3, 1.5),
      g2 = rrect(164, 6, 43, 3, 1.5);
    for (const g of [g1, g2])
      cc.shape(g, BOX(61, 6, 150, 3), (px, py, dd) => shade(d.groove, -bevel(g, px, py, dd, 1) * 0.6));
    winButton(cc, d, 254, 3, 'unshade', false);
    winButton(cc, d, 264, 3, 'close', false);
    if (!active) cc.rect(0, 0, 275, 14, d.outline, 0.15);
  }
  {
    const ex = new Canvas(eqEx);
    ex.rect(1, 30, 3, 7, d.thumb.face);
    ex.rect(11, 30, 3, 7, d.thumb.face);
    ex.rect(2, 31, 1, 5, d.thumb.mark);
    ex.rect(12, 31, 1, 5, d.thumb.mark);
    for (const [x, y, icon, src] of [
      [254, 3, 'shade', eqTA],
      [1, 47, 'unshade', null],
      [11, 47, 'close', null],
    ] as const) {
      const cc = new Canvas(eqEx, x - (x === 254 ? 254 : x === 1 ? 254 : 264), y - 3, [x, y, x + 9, y + 9]);
      if (src) cc.backdrop(src);
      else cc.rect(x === 1 ? 254 : 264, 3, 9, 9, d.outline);
      winButton(cc, d, x === 254 ? 254 : x === 1 ? 254 : 264, 3, icon, true);
    }
  }

  // ---------------------------------------------------------------- playlist
  const pledit = paintPledit(d);

  return {
    name: d.name,
    sheets: {
      main,
      cbuttons,
      titlebar,
      numbers: digits(false),
      nums_ex: digits(true),
      text: textImg,
      posbar,
      volume: slider('volume'),
      balance: slider('balance'),
      monoster,
      playpaus,
      shufrep,
      eqmain,
      eq_ex: eqEx,
      pledit,
      video: videoSheetFromPledit(pledit),
    },
    playlist: {
      normal: [...S.on] as [number, number, number],
      current: [...S.hi] as [number, number, number],
      normalBg: [...S.bg] as [number, number, number],
      selectedBg: mix(S.bg, S.on, 0.22).map(Math.round) as [number, number, number],
      font: 'Segoe UI',
    },
    vis: Array.from({ length: 24 }, (_v, i): [number, number, number] => {
      const r = (c: RGB) => c.map(Math.round) as [number, number, number];
      if (i === 0) return r(S.bg);
      if (i === 1) return r(mix(S.bg, S.dim, 0.5));
      if (i <= 17) return r(mix(S.hi, mix(S.on, S.bg, 0.45), (i - 2) / 15));
      if (i <= 22) return r(mix(S.hi, S.on, (i - 18) / 4));
      return r(S.hi);
    }),
    regions: regionsFor(d.corner),
    cursors: {},
    hasNumsEx: true,
    warnings: [],
  };
}

// ------------------------------------------------------------------ playlist sheet
function paintPledit(d: Design): RgbaImage {
  const img = sheetImg('pledit', d.outline);
  const S = d.screen;
  // window coordinates for pieces: a 275-wide frame; each piece is painted where it would sit in a 275x116 window
  const W = 275,
    H = 116;
  const frame = createImage(W, H);
  const fc = new Canvas(frame);
  body(fc, d, W, H, 0);
  titleBand(fc, d, W);
  // list well
  displayWell(fc, rrect(12, 20, W - 32, H - 58, 1), BOX(12, 20, W - 32, H - 58), S.bg, {
    bezel: S.bezel,
    ring: 1.2,
  });
  // scroll groove
  const sg = rrect(W - 15, 21, 8, H - 60, 3);
  fc.shape(sg, BOX(W - 15, 21, 8, H - 60), (px, py, dd) =>
    shade(d.groove, -bevel(sg, px, py, dd, 1.2) * 0.6),
  );

  const piece = (sp: Sprite, wx: number, wy: number, src: RgbaImage = frame) => {
    const cc = cell(img, sp, wx, wy);
    cc.backdrop(src);
    return cc;
  };
  // top bar (active / inactive)
  const top = (active: boolean) => {
    const t = createImage(W, 20);
    const tc = new Canvas(t);
    tc.backdrop(frame);
    const label = 'PLAYLIST';
    const lw = textWidth(label, { font: '3x5', spacing: 2 });
    textCentered(tc, label, 26 + 50, 8, active ? d.ink : d.inkDim, {
      font: '3x5',
      spacing: 2,
      under: { c: [0, 0, 0], a: 0.3 },
    });
    // double groove lines run through every piece (so tiling is seamless), with a gap for the label
    const gap0 = Math.floor(76 - lw / 2 - 5),
      gap1 = Math.ceil(76 + lw / 2 + 5);
    for (const yy of [8, 11]) {
      tc.rect(4, yy, gap0 - 4, 1, d.inkDim, 0.35);
      tc.rect(gap1, yy, W - 24 - gap1, 1, d.inkDim, 0.35);
      tc.rect(4, yy + 1, gap0 - 4, 1, [255, 255, 255], 0.07);
      tc.rect(gap1, yy + 1, W - 24 - gap1, 1, [255, 255, 255], 0.07);
    }
    if (!active) tc.rect(0, 0, W, 20, d.outline, 0.18);
    return t;
  };
  const tA = top(true),
    tI = top(false);
  // the top-right piece sits at the window's right edge; paint its buttons there
  const tr = (src: RgbaImage, active: boolean) => {
    const t = createImage(25, 20);
    const tc = Canvas.cell(t, 0, 0, 25, 20, 250, 0);
    tc.backdrop(src);
    winButton(tc, d, 250 + 25 - 21, 3, 'shade', false);
    winButton(tc, d, 250 + 25 - 11, 3, 'close', false);
    if (!active) tc.rect(250, 0, 25, 20, d.outline, 0.12);
    return t;
  };
  piece(PL.topLeft, 0, 0, tA);
  piece(PL.topTitle, 26, 0, tA);
  piece(PL.topFill, 140, 0, tA);
  piece(PL.topLeftInactive, 0, 0, tI).clip;
  {
    const c1 = cell(img, PL.topLeftInactive, 0, 0);
    c1.backdrop(tI);
    const c2 = cell(img, PL.topTitleInactive, 26, 0);
    c2.backdrop(tI);
    const c3 = cell(img, PL.topFillInactive, 140, 0);
    c3.backdrop(tI);
  }
  for (const [sp, active] of [
    [PL.topRight, true],
    [PL.topRightInactive, false],
  ] as const) {
    const t = tr(active ? tA : tI, active);
    const cc = Canvas.cell(img, sp.x, sp.y, 25, 20, 0, 0);
    cc.backdrop(t);
  }
  piece(PL.left, 0, 40);
  piece(PL.right, W - 20, 40);
  // scroll thumbs
  for (const [sp, down] of [
    [PL.scrollThumb, false],
    [PL.scrollThumbDown, true],
  ] as const) {
    const cc = cell(img, sp, W - 15, 40);
    cc.backdrop(frame);
    thumb(cc, d, W - 15, 40, 8, 18, down, true);
  }
  // bottom: buttons, time display, mini transport
  const bottom = createImage(W, 38);
  {
    const bc = new Canvas(bottom, 0, -(H - 38));
    bc.backdrop(frame);
    ['ADD', 'REM', 'SEL', 'MISC'].forEach((l, i) =>
      smallButton(bc, d, 14 + i * 29, H - 38 + 10, 25, 18, l, false, null),
    );
    const bx = W - 150;
    smallButton(bc, d, bx + 106, H - 38 + 10, 25, 18, 'LIST', false, null);
    const well = (x: number, y: number, w: number, h: number) =>
      displayWell(bc, rrect(x, y, w, h, 1.5), BOX(x, y, w, h), S.bg, { bezel: S.bezel, ring: 1 });
    well(bx + 7, H - 38 + 10, 90, 7);
    well(bx + 66, H - 38 + 22, 30, 7);
    const ic: Icon[] = ['prev', 'play', 'pause', 'stop', 'next', 'eject'];
    ic.forEach((i, k) => drawIcon(bc, i, bx + 10.5 + k * 9, H - 38 + 25.5, d.small.text, 0.55));
    // resize grip
    for (let k = 0; k < 3; k++)
      for (let j = 0; j <= k; j++) bc.rect(W - 4 - k * 2 + j * 2, H - 4 - j * 2, 1, 1, d.inkDim, 0.8);
  }
  piece(PL.bottomLeft, 0, H - 38, frame).backdrop(bottom, 0, -(H - 38));
  piece(PL.bottomRight, W - 150, H - 38, frame).backdrop(bottom, 0, -(H - 38));
  piece(PL.bottomFill, 125, H - 38, frame).backdrop(bottom, 0, -(H - 38));
  piece(PL.visExtra, 125, H - 38, frame).backdrop(bottom, 0, -(H - 38));
  // title-bar button presses
  for (const [sp, x, icon] of [
    [PL.closeBtnDown, W - 11, 'close'],
    [PL.shadeBtnDown, W - 21, 'shade'],
  ] as const) {
    const cc = cell(img, sp, x, 3);
    cc.backdrop(tA);
    winButton(cc, d, x, 3, icon, true);
  }
  // shade mode pieces
  const shadeImg = createImage(W, 14);
  {
    const sc = new Canvas(shadeImg);
    shadeStrip(sc, d, W, true);
  }
  piece(PL.shadeLeft, 0, 0, shadeImg);
  piece(PL.shadeFill, 100, 0, shadeImg);
  for (const [sp, active] of [
    [PL.shadeRight, true],
    [PL.shadeRightInactive, false],
  ] as const) {
    const cc = cell(img, sp, W - 50, 0);
    cc.backdrop(shadeImg);
    winButton(cc, d, W - 21, 3, 'unshade', false);
    winButton(cc, d, W - 11, 3, 'close', false);
    if (!active) cc.rect(W - 50, 0, 50, 14, d.outline, 0.15);
  }
  {
    const cc = cell(img, PL.unshadeBtnDown, W - 21, 3);
    cc.backdrop(shadeImg);
    winButton(cc, d, W - 21, 3, 'unshade', true);
  }
  // pop-up menus
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
  const mc = new Canvas(img);
  for (const menu of Object.values(PL_MENUS)) {
    mc.rect(menu.bar.x, menu.bar.y, menu.bar.w, menu.bar.h, d.accent);
    for (const it of menu.items) {
      mc.rect(it.normal.x, it.normal.y, 22, 18, d.outline);
      smallButton(
        Canvas.cell(img, it.normal.x, it.normal.y, 22, 18, it.normal.x, it.normal.y),
        d,
        it.normal.x,
        it.normal.y,
        22,
        18,
        labels[it.id] ?? '',
        false,
        null,
      );
      mc.rect(it.selected.x, it.selected.y, 22, 18, d.outline);
      const sc = Canvas.cell(img, it.selected.x, it.selected.y, 22, 18, it.selected.x, it.selected.y);
      smallButton(
        sc,
        { ...d, small: { ...d.small, face: shade(d.accent, -0.2), text: [255, 255, 255] } },
        it.selected.x,
        it.selected.y,
        22,
        18,
        labels[it.id] ?? '',
        true,
        null,
      );
    }
  }
  return img;
}

// ------------------------------------------------------------------ window shapes
function roundedPoly(w: number, h: number, r: number): Polygon {
  if (r <= 0)
    return [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ];
  const inset = (y: number) => {
    const dy = r - y - 0.5;
    return y >= r ? 0 : Math.round(r - Math.sqrt(Math.max(0, r * r - dy * dy)));
  };
  const pts: Polygon = [];
  for (let y = 0; y < r; y++) pts.push([inset(y), y], [inset(y), y + 1]);
  for (let y = r - 1; y >= 0; y--) pts.push([w - inset(y), h - y - 1], [w - inset(y), h - y]);
  // bottom-left corner going up is not needed in this order; build left side down, bottom-right up properly
  const left: Polygon = [];
  for (let y = 0; y < r; y++) left.push([inset(y), y], [inset(y), y + 1]);
  const bl: Polygon = [];
  for (let y = h - r; y < h; y++) bl.push([inset(h - 1 - y), y], [inset(h - 1 - y), y + 1]);
  const br: Polygon = [];
  for (let y = h - 1; y >= h - r; y--) br.push([w - inset(h - 1 - y), y + 1], [w - inset(h - 1 - y), y]);
  const tr: Polygon = [];
  for (let y = r - 1; y >= 0; y--) tr.push([w - inset(y), y + 1], [w - inset(y), y]);
  void pts;
  return [...left, ...bl, ...br, ...tr];
}

function regionsFor(r: number): Regions {
  if (r <= 1) return {};
  const shadeR = Math.min(r, 5);
  return {
    normal: [roundedPoly(275, 116, r)],
    windowshade: [roundedPoly(275, 14, shadeR)],
    equalizer: [roundedPoly(275, 116, r)],
    equalizerws: [roundedPoly(275, 14, shadeR)],
  };
}

export { scale };
