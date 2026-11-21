/**
 * RevAmp's own hi-fi skin designs. Original art, made in code; inspired by the feel of classic hardware
 * (portable players, receivers, tape decks, studio racks), never copied from any skin.
 */
import { Canvas, circle, clamp01, hex, mix, noise, poly, rrect, shade, type RGB } from './canvas';
import { buildDesign, type Design } from './build';
import {
  anodized,
  brushed,
  carbon,
  dropShadow,
  faceplate,
  gloss,
  grille,
  knob,
  led,
  liquid,
  plastic,
  screw,
  text,
  vents,
  wood,
} from './kit';
import type { Skin } from '../skin';

const B = (x: number, y: number, w: number, h: number): [number, number, number, number] => [
  x,
  y,
  x + w,
  y + h,
];

/** A five-petal blossom. */
function blossom(
  c: Canvas,
  cx: number,
  cy: number,
  r: number,
  petal: RGB,
  centre: RGB,
  rot = 0,
  a = 1,
): void {
  const f = (x: number, y: number) => {
    const dx = x - cx,
      dy = y - cy;
    const ang = Math.atan2(dy, dx) + rot;
    const rr = r * (0.62 + 0.38 * Math.abs(Math.cos((ang * 5) / 2)));
    return Math.hypot(dx, dy) - rr;
  };
  c.shape(
    f,
    B(cx - r, cy - r, 2 * r, 2 * r),
    (x, y) => mix(shade(petal, 0.35), petal, clamp01(Math.hypot(x - cx, y - cy) / r)),
    a,
  );
  c.shape(circle(cx, cy, r * 0.22), B(cx - 2, cy - 2, 4, 4), () => centre, a);
}

/** A lit chrome pipe between two points. */
function pipe(c: Canvas, x0: number, y0: number, x1: number, y1: number, r: number, col: RGB): void {
  const dx = x1 - x0,
    dy = y1 - y0,
    len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len,
    ny = dx / len;
  const f = (x: number, y: number) => {
    const t = clamp01(((x - x0) * dx + (y - y0) * dy) / (len * len));
    return Math.hypot(x - (x0 + dx * t), y - (y0 + dy * t)) - r;
  };
  dropShadow(
    c,
    f,
    B(Math.min(x0, x1) - r, Math.min(y0, y1) - r, Math.abs(dx) + 2 * r, Math.abs(dy) + 2 * r),
    1.2,
    0.5,
    2,
  );
  c.shape(
    f,
    B(Math.min(x0, x1) - r, Math.min(y0, y1) - r, Math.abs(dx) + 2 * r, Math.abs(dy) + 2 * r),
    (x, y) => {
      const across = ((x - x0) * nx + (y - y0) * ny) / r; // -1..1
      const l = Math.cos(across * 1.3 + 0.5);
      const spec = Math.pow(clamp01(1 - Math.abs(across + 0.45) / 0.25), 2);
      return shade(shade(col, (l - 0.6) * 0.9), spec * 0.7);
    },
  );
}

// ------------------------------------------------------------------ 1. Meridian MD (portable MiniDisc)
const meridian: Design = {
  id: 'meridian',
  name: 'Meridian MD',
  description:
    'A blue anodized MiniDisc portable: grey-green reflective LCD with ghost segments and silver buttons.',
  brand: 'MERIDIAN',
  model: 'MD-77',
  tagline: 'DIGITAL MINIDISC',
  brandStyle: { font: '5x7', bold: true, spacing: 1 },
  corner: 9,
  body: (x, y) =>
    shade(
      anodized(hex('#2c6db8'), 0.07)(x, y),
      0.25 * (0.5 - y / 116) + 0.18 * Math.max(0, 1 - Math.abs(y - 18) / 6),
    ),
  outline: hex('#0d2a4d'),
  edgeLight: 0.7,
  ink: hex('#eef5ff'),
  inkDim: hex('#9cc0e8'),
  accent: hex('#7df0ff'),
  screen: {
    bg: hex('#a9b8a2'),
    on: hex('#1c2a24'),
    hi: hex('#0a120e'),
    dim: hex('#58695d'),
    ghost: hex('#98a893'),
    bezel: hex('#18324f'),
    radius: 4,
    slant: true,
    sheen: 0.08,
  },
  button: {
    shape: 'round',
    face: hex('#cfd6de'),
    material: (b) => brushed(b, 0.08, 4),
    icon: hex('#2b3440'),
    iconDown: hex('#0f5aa8'),
    rim: hex('#7d8894'),
  },
  small: { face: hex('#c3ccd6'), text: hex('#24303d'), on: hex('#0f5aa8'), shape: 'pill' },
  thumb: { face: hex('#dde3ea'), mark: hex('#2c6db8'), style: 'cap' },
  groove: hex('#173a63'),
  fill: [hex('#7df0ff'), hex('#ffffff')],
  corner2: (c, d) => {
    // jog dial
    knob(c, 254, 98, 10, {
      body: hex('#b9c3ce'),
      cap: hex('#dfe6ee'),
      mark: d.outline,
      ridges: 40,
      skirt: hex('#1d4f88'),
    });
  },
  decorate: (c, win, d) => {
    if (win === 'main') {
      // a light wave line along the bottom (brand motif)
      for (let x = 20; x < 160; x++) {
        const y = 112.5 + Math.sin(x * 0.12) * 1.5;
        c.set(x, Math.floor(y), d.inkDim, 0.45);
      }
    }
  },
};

// ------------------------------------------------------------------ 2. Obsidian Core (console)
const obsidian: Design = {
  id: 'obsidian',
  name: 'Obsidian Core',
  description: 'Black console plastic with a glowing green core, glossy jewel buttons and a lime display.',
  brand: 'OBSIDIAN',
  model: 'CORE',
  tagline: 'ENTERTAINMENT SYSTEM',
  brandStyle: { font: '5x7', spacing: 2 },
  corner: 6,
  body: plastic(hex('#2b2e2b'), hex('#121412'), 116, 0.04),
  outline: hex('#050605'),
  ink: hex('#d6dcd2'),
  inkDim: hex('#6d776a'),
  accent: hex('#7dff3a'),
  screen: {
    bg: hex('#0a0f0a'),
    on: hex('#8af24a'),
    hi: hex('#d9ffb8'),
    dim: hex('#3f6b2a'),
    ghost: hex('#142213'),
    bezel: hex('#000000'),
    radius: 3,
    glow: 0.8,
    slant: false,
  },
  button: {
    shape: 'orb',
    face: hex('#262b26'),
    icon: hex('#9cff5e'),
    iconDown: hex('#e2ffc9'),
    rim: hex('#000000'),
    glow: true,
    bay: hex('#0c0e0c'),
  },
  small: { face: hex('#323832'), text: hex('#b9c7b2'), on: hex('#9cff5e'), shape: 'pill' },
  thumb: { face: hex('#3a413a'), mark: hex('#8af24a'), style: 'round' },
  groove: hex('#070907'),
  fill: [hex('#3fa81a'), hex('#c8ff7a')],
  corner2: (c, d) => {
    // the core: a glowing jewel
    const f = circle(254, 97, 9);
    c.halo(f, B(245, 88, 18, 18), d.accent, 6, 0.4);
    c.shape(circle(254, 97, 11), B(243, 86, 22, 22), (x, y) =>
      shade(hex('#1c201c'), (((x - 254) * -0.55 + (y - 97) * -0.83) / 11) * 0.4),
    );
    c.shape(f, B(245, 88, 18, 18), (x, y) => {
      const r = Math.hypot(x - 254, y - 97) / 9;
      const spec = clamp01(1 - Math.hypot(x - 251, y - 93) / 3.5);
      return shade(mix(hex('#d8ff9c'), hex('#2d8c10'), r), spec * 0.8);
    });
  },
  decorate: (c, win, d) => {
    // light pipe along the bottom edge
    const y = win === 'main' ? 112 : 112;
    c.halo(rrect(30, y, 215, 1, 0.5), B(30, y, 215, 1), d.accent, 3, 0.25);
    c.rect(30, y, 215, 1, mix(d.accent, [255, 255, 255], 0.3), 0.8);
  },
};

// ------------------------------------------------------------------ 3. Silverline (silver + neon)
const silverline: Design = {
  id: 'silverline',
  name: 'Silverline',
  description:
    'Light brushed silver around a black display with bright neon-green segments and chunky dark keys.',
  brand: 'SILVERLINE',
  model: 'SX-98',
  tagline: 'HIGH SENSITIVITY',
  brandStyle: { font: '5x7', bold: true, spacing: 1 },
  corner: 3,
  body: faceplate(hex('#a9adab'), 0.12, 0.18),
  titleBand: (x, y) => shade(brushed(hex('#7c817f'), 0.1, 9)(x, y), (7 - y) * 0.03),
  outline: hex('#2d302f'),
  ink: hex('#101312'),
  inkDim: hex('#505553'),
  accent: hex('#46ff3c'),
  screen: {
    bg: hex('#000000'),
    on: hex('#4dff3a'),
    hi: hex('#c8ffbf'),
    dim: hex('#1f7a19'),
    ghost: hex('#0b2209'),
    bezel: hex('#3b3f3d'),
    radius: 2,
    glow: 0.7,
  },
  button: {
    shape: 'square',
    face: hex('#4b504e'),
    icon: hex('#e7ece9'),
    iconDown: hex('#4dff3a'),
    rim: hex('#202322'),
  },
  small: { face: hex('#565b59'), text: hex('#eef2f0'), on: hex('#4dff3a'), shape: 'key' },
  thumb: { face: hex('#d9dcdb'), mark: hex('#1d201f'), style: 'cap' },
  groove: hex('#1d201f'),
  fill: [hex('#2fd42a'), hex('#d4ff5a')],
  corner2: (c) => {
    for (const [x, y] of [
      [246, 90],
      [262, 90],
      [246, 104],
      [262, 104],
    ] as const)
      screw(c, x, y, 2.6, hex('#c9cecc'), x * 0.3);
  },
  decorate: (c, win) => {
    if (win === 'main') vents(c, 20, 110, 140, 3, 28, hex('#2a2d2c'), hex('#e4e8e6'));
  },
};

// ------------------------------------------------------------------ 4. Nautilus (biomechanical chrome)
const nautilus: Design = {
  id: 'nautilus',
  name: 'Nautilus',
  description: 'Organic liquid-chrome shell in bronze and teal, with glass orb buttons and chrome pipes.',
  brand: 'NAUTILUS',
  model: 'BIO/2',
  tagline: 'ORGANIC SOUND ENGINE',
  brandStyle: { font: '5x7', spacing: 2 },
  corner: 7,
  // liquid chrome frame (title band + outer rim), smooth dark teal shell inside
  body: (x, y) => {
    const edge = Math.min(x - 1, y - 14, 273 - x, 114 - y);
    const chrome = liquid(hex('#1b2328'), hex('#d9c193'), hex('#1e5d6e'), 0.03, 6)(x, y);
    if (y < 14) return chrome;
    const inner = mix(hex('#173039'), hex('#0b1a20'), clamp01(y / 116));
    const ripple = (noise(x * 0.05, y * 0.05, 21) - 0.5) * 0.12;
    const t = clamp01((edge - 3) / 3);
    return mix(chrome, shade(inner, ripple), t);
  },
  outline: hex('#0a0d0e'),
  ink: hex('#f0e2c6'),
  inkDim: hex('#c9b38c'),
  accent: hex('#7fe0ff'),
  screen: {
    bg: hex('#081a20'),
    on: hex('#8fdcf0'),
    hi: hex('#e6fbff'),
    dim: hex('#3b7a8a'),
    ghost: hex('#11303a'),
    bezel: hex('#2a2016'),
    radius: 6,
    glow: 0.6,
    sheen: 0.06,
  },
  button: {
    shape: 'orb',
    face: hex('#2f8eae'),
    icon: hex('#e9fbff'),
    iconDown: hex('#ffffff'),
    rim: hex('#0a1a20'),
    glow: true,
  },
  small: { face: hex('#8c7a5c'), text: hex('#1a140c'), on: hex('#7fe0ff'), shape: 'pill' },
  thumb: { face: hex('#d8c39a'), mark: hex('#1b2328'), style: 'round' },
  groove: hex('#0b1418'),
  fill: [hex('#2fa6c8'), hex('#c8f6ff')],
  corner2: (c) => {
    const f = circle(255, 97, 9);
    c.halo(f, B(246, 88, 18, 18), hex('#7fe0ff'), 4, 0.35);
    c.shape(circle(255, 97, 11), B(244, 86, 22, 22), (x, y) =>
      shade(hex('#8a7350'), (((x - 255) * -0.55 + (y - 97) * -0.83) / 11) * 0.6),
    );
    c.shape(f, B(246, 88, 18, 18), (x, y) => {
      const r = Math.hypot(x - 255, y - 97) / 9;
      const spec = clamp01(1 - Math.hypot(x - 252, y - 93) / 3);
      return shade(mix(hex('#bff3ff'), hex('#0c4a60'), r), spec * 0.9);
    });
  },
  decorate: (c, win) => {
    if (win === 'main') {
      pipe(c, 3, 22, 3, 104, 1.8, hex('#c9b38c'));
      pipe(c, 20, 112, 236, 112, 1.6, hex('#c9b38c'));
      for (const x of [40, 90, 140, 190]) screw(c, x, 112, 2.2, hex('#d7c09a'), x);
    } else {
      pipe(c, 3, 18, 3, 104, 1.8, hex('#c9b38c'));
      pipe(c, 20, 112, 255, 112, 1.6, hex('#c9b38c'));
    }
  },
};

// ------------------------------------------------------------------ 5. Sakura (blossom)
const sakura: Design = {
  id: 'sakura',
  name: 'Sakura',
  description: 'Deep indigo night with cherry blossoms, a soft pink display and lavender-lit controls.',
  brand: 'SAKURA',
  model: 'HANAMI',
  tagline: 'SPRING NIGHT EDITION',
  brandStyle: { font: '5x7', spacing: 2 },
  corner: 6,
  body: (x, y) => {
    const base = plastic(hex('#272247'), hex('#120f26'), 116, 0.025)(x, y);
    const mist = noise(x * 0.03, y * 0.05, 11) * 0.12;
    return mix(base, hex('#5a2c6e'), mist);
  },
  outline: hex('#08061a'),
  ink: hex('#ffd6ef'),
  inkDim: hex('#a98ac4'),
  accent: hex('#ff79c8'),
  screen: {
    bg: hex('#0d0a1f'),
    on: hex('#ff8fd2'),
    hi: hex('#ffe3f4'),
    dim: hex('#7d3f73'),
    ghost: hex('#24142f'),
    bezel: hex('#3d2f6b'),
    radius: 4,
    glow: 0.6,
  },
  button: {
    shape: 'round',
    face: hex('#3a3270'),
    icon: hex('#ffb3e0'),
    iconDown: hex('#ffffff'),
    rim: hex('#1a143b'),
    glow: true,
  },
  small: { face: hex('#3a3270'), text: hex('#f0d7ff'), on: hex('#ff8fd2'), shape: 'pill' },
  thumb: { face: hex('#ff8fd2'), mark: hex('#2a1f4f'), style: 'round' },
  groove: hex('#0b0919'),
  fill: [hex('#b26bff'), hex('#ff8fd2')],
  corner2: (c) => {
    blossom(c, 252, 95, 8, hex('#ffb7dd'), hex('#ffe47a'), 0.3);
    blossom(c, 262, 106, 5, hex('#ff9bd0'), hex('#ffe47a'), 1.1);
    blossom(c, 243, 106, 4, hex('#f5a8e0'), hex('#ffe47a'), 2.0, 0.9);
  },
  decorate: (c, win) => {
    // a thin branch across the bottom with a few blossoms
    const pts: [number, number][] =
      win === 'main'
        ? [
            [14, 113],
            [60, 111],
            [110, 113],
            [160, 110],
          ]
        : [
            [14, 112],
            [90, 110],
            [180, 113],
            [262, 110],
          ];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i]!,
        [x1, y1] = pts[i + 1]!;
      for (let t = 0; t <= 1; t += 0.01)
        c.set(
          Math.round(x0 + (x1 - x0) * t),
          Math.round(y0 + (y1 - y0) * t + Math.sin(t * 3.14) * -1.5),
          hex('#4a3266'),
          0.9,
        );
    }
    for (const [x, y, r, rot] of win === 'main'
      ? [
          [60, 110, 3.5, 0.2],
          [110, 112, 3, 1],
          [150, 109, 2.5, 2],
        ]
      : [
          [150, 112, 2.5, 0.5],
          [214, 112, 2.5, 1.4],
          [40, 112, 2.5, 0.9],
        ])
      blossom(c, x!, y!, r!, hex('#ffb7dd'), hex('#ffe47a'), rot!, 0.95);
    // falling petals
    if (win === 'main')
      for (const [x, y] of [
        [8, 70],
        [6, 98],
        [116, 66],
      ] as const)
        blossom(c, x, y, 2, hex('#ff9bd0'), hex('#ff9bd0'), x);
  },
};

// ------------------------------------------------------------------ 6. Bubblegum (Y2K)
const bubblegum: Design = {
  id: 'bubblegum',
  name: 'Bubblegum',
  description: 'Y2K glossy magenta plastic with cyan bubble buttons and a midnight-blue display.',
  brand: 'BUBBLE',
  model: 'POP 2000',
  tagline: 'TRANSLUCENT EDITION',
  brandStyle: { font: '5x7', bold: true, spacing: 1 },
  corner: 12,
  body: (x, y) => {
    const g = gloss(hex('#e44fb7'), 0, 116, 0.3)(x, y);
    const stripe = clamp01(1 - Math.abs(((x + y * 0.6) % 46) - 23) / 2.5) * 0.08;
    return shade(g, stripe);
  },
  outline: hex('#3d0838'),
  edgeLight: 0.8,
  ink: hex('#ffffff'),
  inkDim: hex('#ffc1ec'),
  accent: hex('#59e8ff'),
  screen: {
    bg: hex('#0b0d33'),
    on: hex('#63e3ff'),
    hi: hex('#e8fbff'),
    dim: hex('#2d6c9c'),
    ghost: hex('#151a4f'),
    bezel: hex('#5a1150'),
    radius: 7,
    glow: 0.5,
    sheen: 0.1,
  },
  button: {
    shape: 'orb',
    face: hex('#26a8e0'),
    icon: hex('#082a4a'),
    iconDown: hex('#ffffff'),
    rim: hex('#0c3d66'),
  },
  small: { face: hex('#2bb4ea'), text: hex('#062440'), on: hex('#ffffff'), shape: 'pill' },
  thumb: { face: hex('#5fd9ff'), mark: hex('#0b2c55'), style: 'round' },
  groove: hex('#3d0838'),
  fill: [hex('#59e8ff'), hex('#ffffff')],
  corner2: (c) => {
    for (const [x, y, r] of [
      [252, 94, 6],
      [263, 104, 3.5],
      [244, 106, 2.5],
    ]) {
      const f = circle(x!, y!, r!);
      c.shape(
        f,
        B(x! - r!, y! - r!, 2 * r!, 2 * r!),
        (px, py) => {
          const nx = (px - x!) / r!,
            ny = (py - y!) / r!;
          const rim = clamp01((Math.hypot(nx, ny) - 0.65) / 0.35);
          const spec = clamp01(1 - Math.hypot(nx + 0.35, ny + 0.45) / 0.35);
          return shade(mix(hex('#ffd2f1'), hex('#ffffff'), rim * 0.5), spec);
        },
        0.55,
      );
    }
  },
};

// ------------------------------------------------------------------ 7. Reference (receiver)
const reference: Design = {
  id: 'reference',
  name: 'Reference Receiver',
  description:
    'Champagne-gold receiver faceplate with a blue-green VFD, piano-style keys, gold sliders and a big volume knob.',
  brand: 'REFERENCE',
  model: 'RX-1100',
  modelColor: hex('#0b5e52'),
  tagline: 'QUARTZ SYNTHESIZED',
  brandStyle: { font: '5x7', spacing: 2 },
  corner: 2,
  body: faceplate(hex('#c9b791'), 0.1, 0.16),
  outline: hex('#3b3123'),
  ink: hex('#2a2218'),
  inkDim: hex('#6b5d45'),
  accent: hex('#5ff0d8'),
  screen: {
    bg: hex('#06100f'),
    on: hex('#63eed9'),
    hi: hex('#d6fff6'),
    dim: hex('#2a6e64'),
    ghost: hex('#0f2a27'),
    bezel: hex('#2b241a'),
    radius: 1,
    glow: 0.9,
    slant: false,
  },
  button: {
    shape: 'key',
    face: hex('#d8c9a6'),
    material: (b) => brushed(b, 0.1, 8),
    icon: hex('#3b3123'),
    iconDown: hex('#0e7d6c'),
    rim: hex('#6b5d45'),
    bay: hex('#2d261b'),
  },
  small: { face: hex('#d2c29c'), text: hex('#2d261b'), on: hex('#0e7d6c'), shape: 'key' },
  thumb: { face: hex('#e0b85a'), mark: hex('#4a3510'), style: 'gold' },
  groove: hex('#2d261b'),
  fill: [hex('#3fc7b4'), hex('#b8fff2')],
  corner2: (c) => {
    knob(c, 254, 98, 12, { body: hex('#b9a782'), cap: hex('#d9cba8'), mark: hex('#2d261b'), ridges: 48 });
  },
  decorate: (c, win, d) => {
    if (win === 'main') {
      led(c, 168, 112, 1.4, hex('#ff5a3c'), true);
      text(c, 'POWER', 172, 110, d.inkDim, { font: '3x5' });
      text(c, 'DIRECT', 200, 110, d.inkDim, { font: '3x5' });
      led(c, 226, 112, 1.4, d.accent, false);
    }
  },
};

// ------------------------------------------------------------------ 8. Heartwood (valve amp)
const heartwood: Design = {
  id: 'heartwood',
  name: 'Heartwood Valve',
  description:
    'Walnut cabinet with a brass faceplate band, warm orange glow display, brass buttons and a lit valve.',
  brand: 'HEARTWOOD',
  model: '300B',
  modelColor: hex('#7a1e00'),
  tagline: 'VALVE PRE-AMPLIFIER',
  brandStyle: { font: '5x7', spacing: 1 },
  corner: 4,
  body: wood(hex('#6a3b1f'), 7),
  titleBand: (x, y) => shade(brushed(hex('#c8a356'), 0.12, 12)(x, y), (7 - y) * 0.04),
  outline: hex('#1d0e05'),
  ink: hex('#2b1a06'),
  inkDim: hex('#d9b27a'),
  accent: hex('#ffa040'),
  screen: {
    bg: hex('#160903'),
    on: hex('#ff9d42'),
    hi: hex('#ffe0b0'),
    dim: hex('#7a3f12'),
    ghost: hex('#2c1205'),
    bezel: hex('#9c7a3c'),
    radius: 3,
    glow: 1,
  },
  button: {
    shape: 'round',
    face: hex('#d4b064'),
    material: (b) => brushed(b, 0.1, 13),
    icon: hex('#3a2407'),
    iconDown: hex('#8a3c00'),
    rim: hex('#7a5a22'),
  },
  small: { face: hex('#cfa95e'), text: hex('#2e1b04'), on: hex('#a34500'), shape: 'pill' },
  thumb: { face: hex('#e2bd6a'), mark: hex('#3a2407'), style: 'gold' },
  groove: hex('#1a0c04'),
  fill: [hex('#ff7a1a'), hex('#ffd59a')],
  corner2: (c) => {
    // a glowing valve
    const glass = rrect(247, 85, 15, 25, 7);
    c.halo(glass, B(247, 85, 15, 25), hex('#ff8a2a'), 5, 0.3);
    c.shape(glass, B(247, 85, 15, 25), (x, y) => {
      const glow = clamp01(1 - Math.hypot((x - 254.5) / 6, (y - 99) / 9));
      const edge = clamp01(1 - Math.abs(x - 249.5) / 1.5) * 0.4;
      return shade(mix(hex('#2a1608'), hex('#ffb060'), glow * 0.9), edge);
    });
    for (let y = 92; y < 106; y++) c.set(254, y, hex('#fff1c8'), 0.6);
    c.rect(246, 108, 17, 4, hex('#2a1608'));
    c.rect(246, 108, 17, 1, hex('#c8a356'));
  },
  decorate: (c, win) => {
    // brass screws in the corners of the band
    screw(c, 5, 7, 2.3, hex('#d8b25e'), 0.4);
    if (win === 'eq') screw(c, 245, 7, 2.3, hex('#d8b25e'), 1.4);
  },
};

// ------------------------------------------------------------------ 9. Studio Rack
const studio: Design = {
  id: 'studio',
  name: 'Studio Rack',
  description: 'Black anodized 19-inch rack unit with rack-ear screws, an ice-blue VFD and rubber pads.',
  brand: 'STUDIOLINE',
  model: 'SR-2',
  tagline: 'PRO PLAYBACK UNIT',
  brandStyle: { font: '5x7', bold: true, spacing: 1 },
  corner: 1,
  body: (x, y) => shade(anodized(hex('#26272b'), 0.12)(x, y), 0.08 * (0.5 - y / 116)),
  outline: hex('#050506'),
  ink: hex('#e9ecf2'),
  inkDim: hex('#7d828d'),
  accent: hex('#3fa9ff'),
  screen: {
    bg: hex('#03070e'),
    on: hex('#6cc3ff'),
    hi: hex('#e2f3ff'),
    dim: hex('#24507a'),
    ghost: hex('#0b1a2b'),
    bezel: hex('#0b0b0d'),
    radius: 1,
    glow: 0.8,
  },
  button: {
    shape: 'square',
    face: hex('#4a4c52'),
    material: (b) => carbon(b),
    icon: hex('#f0f2f6'),
    iconDown: hex('#6cc3ff'),
    rim: hex('#18191c'),
    glow: true,
  },
  small: { face: hex('#3d3f44'), text: hex('#dfe3ea'), on: hex('#6cc3ff'), shape: 'key' },
  thumb: { face: hex('#9aa0aa'), mark: hex('#111214'), style: 'bar' },
  groove: hex('#0a0a0c'),
  fill: [hex('#2878d6'), hex('#9fe0ff')],
  corner2: (c, d) => {
    knob(c, 254, 97, 10, { body: hex('#2c2d31'), cap: hex('#3b3d42'), mark: d.accent, ridges: 24 });
    // level meter LEDs
    for (let i = 0; i < 6; i++)
      led(
        c,
        243 + i * 4.6,
        112,
        1.3,
        i < 4 ? hex('#4dff7a') : i < 5 ? hex('#ffd23c') : hex('#ff3c3c'),
        i < 4,
      );
  },
  decorate: (c, win) => {
    // rack ears: slotted holes
    for (const y of [30, 92]) {
      const f = rrect(2, y, 6, 10, 3);
      c.shape(f, B(2, y, 6, 10), () => hex('#000000'));
      c.shape(rrect(2, y + 9, 6, 1.5, 0.7), B(2, y + 9, 6, 2), () => hex('#5a5d66'), 0.6);
    }
    if (win === 'main') grille(c, 14, 109, 145, 5, 3, hex('#0b0b0d'));
  },
};

// ------------------------------------------------------------------ 10. Chroma Deck (cassette)
const chroma: Design = {
  id: 'chroma',
  name: 'Chroma Deck',
  description: 'Eighties silver cassette deck with rainbow stripes, red LED counter and black piano keys.',
  brand: 'CHROMA',
  model: 'C-84',
  tagline: 'AUTO REVERSE DECK',
  brandStyle: { font: '5x7', bold: true, spacing: 2 },
  corner: 2,
  body: faceplate(hex('#c4c7cc'), 0.12, 0.2),
  outline: hex('#2a2c30'),
  ink: hex('#17191c'),
  inkDim: hex('#5c6068'),
  accent: hex('#ff4a2a'),
  screen: {
    bg: hex('#140604'),
    on: hex('#ff5a36'),
    hi: hex('#ffd0c0'),
    dim: hex('#7a2412'),
    ghost: hex('#2c0c07'),
    bezel: hex('#2a2c30'),
    radius: 1,
    glow: 1,
    slant: true,
  },
  button: {
    shape: 'key',
    face: hex('#24262a'),
    icon: hex('#f2f3f5'),
    iconDown: hex('#ff6a48'),
    rim: hex('#0b0c0e'),
    bay: hex('#1a1b1e'),
  },
  small: { face: hex('#2b2d32'), text: hex('#eceef2'), on: hex('#ff6a48'), shape: 'key' },
  thumb: { face: hex('#e6e8ec'), mark: hex('#ff4a2a'), style: 'cap' },
  groove: hex('#1a1b1e'),
  fill: [hex('#ff4a2a'), hex('#ffd23c')],
  corner2: (c) => {
    // two tape reels hint: small spoked hubs
    for (const cx of [247, 262]) {
      c.shape(circle(cx, 98, 6.5), B(cx - 7, 91, 14, 14), (x, y) =>
        shade(hex('#2a2c30'), (((x - cx) * -0.55 + (y - 98) * -0.83) / 7) * 0.3),
      );
      c.shape(circle(cx, 98, 4), B(cx - 4, 94, 8, 8), () => hex('#e6e8ec'));
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        c.shape(
          poly([
            [cx, 98],
            [cx + Math.cos(a - 0.25) * 4.2, 98 + Math.sin(a - 0.25) * 4.2],
            [cx + Math.cos(a + 0.25) * 4.2, 98 + Math.sin(a + 0.25) * 4.2],
          ]),
          B(cx - 5, 93, 10, 10),
          () => hex('#2a2c30'),
        );
      }
      c.shape(circle(cx, 98, 1.4), B(cx - 2, 96, 4, 4), () => hex('#e6e8ec'));
    }
  },
  decorate: (c, win) => {
    const cols = ['#e8352b', '#f5821f', '#f7c82a', '#4cb848', '#2a7fd1'].map(hex);
    if (win === 'main') {
      cols.forEach((col, i) => c.rect(20, 108 + i, 140, 1, col));
      cols.forEach((col, i) => c.rect(170 + i * 3, 104, 2, 9, col, 0.95));
    } else cols.forEach((col, i) => c.rect(4, 110 + i, 267, 1, col));
  },
};

export const DESIGNS: Design[] = [
  meridian,
  obsidian,
  silverline,
  nautilus,
  sakura,
  bubblegum,
  reference,
  heartwood,
  studio,
  chroma,
];

const cache = new Map<string, Skin>();
export function designSkin(id: string): Skin | null {
  const d = DESIGNS.find((x) => x.id === id);
  if (!d) return null;
  let s = cache.get(id);
  if (!s) cache.set(id, (s = buildDesign(d)));
  return s;
}
