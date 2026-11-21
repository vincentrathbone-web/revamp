/**
 * Builds a video window sheet (the video.bmp layout) from a skin's playlist sheet, for the many skins that have no
 * video.bmp of their own. The playlist and video windows share the same title-bar plan, so the frame pieces carry
 * over; the playlist's own text and buttons are left out and five plain buttons are drawn in the skin's colours.
 */
import { createImage, type RgbaImage } from './image';
import { PL, VIDEO, VIDEO_BUTTONS, type Sprite } from './sprites';

type RGB = [number, number, number];

function copy(
  src: RgbaImage,
  sx: number,
  sy: number,
  w: number,
  h: number,
  dst: RgbaImage,
  dx: number,
  dy: number,
) {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const X = sx + x,
        Y = sy + y;
      if (X < 0 || Y < 0 || X >= src.width || Y >= src.height) continue;
      if (dx + x >= dst.width || dy + y >= dst.height) continue;
      const si = (Y * src.width + X) * 4,
        di = ((dy + y) * dst.width + dx + x) * 4;
      dst.data.set(src.data.subarray(si, si + 4), di);
      dst.data[di + 3] = 255;
    }
}

const put = (src: RgbaImage, sp: Sprite, dst: RgbaImage, at: Sprite, cut = { x: 0, w: sp.w }) =>
  copy(src, sp.x + cut.x, sp.y, Math.min(cut.w, at.w), Math.min(sp.h, at.h), dst, at.x, at.y);

/** Fills `at` with copies of `tile`. */
function tile(src: RgbaImage, t: Sprite, dst: RgbaImage, at: { x: number; y: number; w: number; h: number }) {
  for (let y = 0; y < at.h; y += t.h)
    for (let x = 0; x < at.w; x += t.w)
      copy(src, t.x, t.y, Math.min(t.w, at.w - x), Math.min(t.h, at.h - y), dst, at.x + x, at.y + y);
}

function average(img: RgbaImage, r: Sprite): RGB {
  let n = 0;
  const sum = [0, 0, 0];
  for (let y = r.y; y < r.y + r.h && y < img.height; y++)
    for (let x = r.x; x < r.x + r.w && x < img.width; x++) {
      const o = (y * img.width + x) * 4;
      sum[0]! += img.data[o]!;
      sum[1]! += img.data[o + 1]!;
      sum[2]! += img.data[o + 2]!;
      n++;
    }
  return n ? (sum.map((v) => Math.round(v / n)) as RGB) : [128, 128, 128];
}

const lum = (c: RGB) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
const shade = (c: RGB, t: number): RGB =>
  c.map((v) => Math.round(t >= 0 ? v + (255 - v) * t : v * (1 + t))) as RGB;

function px(img: RgbaImage, x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const o = (y * img.width + x) * 4;
  img.data[o] = c[0];
  img.data[o + 1] = c[1];
  img.data[o + 2] = c[2];
  img.data[o + 3] = 255;
}

/** 3x5 pixel glyphs for the zoom buttons. */
const GLYPHS: Record<string, string[]> = {
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  x: ['...', '#.#', '.#.', '#.#', '...'],
};

/** Icon pixels of button i, relative to the button's top-left corner (15x18). */
function iconPixels(i: number): [number, number][] {
  const out: [number, number][] = [];
  const glyphs = (chars: string, x0: number, y0: number) =>
    [...chars].forEach((ch, k) =>
      GLYPHS[ch]!.forEach((row, y) =>
        [...row].forEach((v, x) => v === '#' && out.push([x0 + k * 4 + x, y0 + y])),
      ),
    );
  switch (i) {
    case 0: // fullscreen: a screen outline
      for (let x = 3; x <= 11; x++) out.push([x, 5], [x, 11]);
      for (let y = 6; y <= 10; y++) out.push([3, y], [11, y]);
      for (let x = 5; x <= 9; x++) out.push([x, 13]);
      break;
    case 1:
      glyphs('1x', 4, 6);
      break;
    case 2:
      glyphs('2x', 4, 6);
      break;
    case 3: // stretch: a double arrow
      for (let x = 3; x <= 11; x++) out.push([x, 8]);
      out.push([4, 7], [4, 9], [5, 6], [5, 10], [10, 7], [10, 9], [9, 6], [9, 10]);
      break;
    default: // menu: three lines
      for (const y of [5, 8, 11]) for (let x = 4; x <= 10; x++) out.push([x, y]);
  }
  return out;
}

function drawButton(img: RgbaImage, at: Sprite, i: number, face: RGB, pressed: boolean): void {
  const f = pressed ? shade(face, -0.15) : face;
  const hi = shade(face, 0.35),
    lo = shade(face, -0.4);
  for (let y = 0; y < at.h; y++)
    for (let x = 0; x < at.w; x++) {
      const edgeTL = x === 0 || y === 0,
        edgeBR = x === at.w - 1 || y === at.h - 1;
      px(img, at.x + x, at.y + y, edgeTL ? (pressed ? lo : hi) : edgeBR ? (pressed ? hi : lo) : f);
    }
  const ink = lum(face) > 0.5 ? shade(face, -0.7) : shade(face, 0.75);
  const d = pressed ? 1 : 0;
  for (const [x, y] of iconPixels(i)) px(img, at.x + x + d, at.y + y + d, ink);
}

/** A complete video.bmp-layout sheet made from `pledit`. */
export function videoSheetFromPledit(pledit: RgbaImage): RgbaImage {
  const img = createImage(233, 119);
  for (const [row, top] of [
    [0, VIDEO.topActive],
    [21, VIDEO.topInactive],
  ] as const) {
    const active = row === 0;
    const src = {
      left: active ? PL.topLeft : PL.topLeftInactive,
      fill: active ? PL.topFill : PL.topFillInactive,
      right: active ? PL.topRight : PL.topRightInactive,
    };
    put(pledit, src.left, img, top.left);
    put(pledit, src.fill, img, top.fill);
    put(pledit, src.right, img, top.right);
    // the playlist's title says PLAYLIST: use plain title-bar fill instead
    tile(pledit, src.fill, img, top.title);
    // no shade button on the video window: cover it with title-bar fill
    copy(pledit, src.fill.x + 5, src.fill.y + 3, 9, 9, img, top.right.x + 5, top.right.y + 3);
  }
  // sides: the playlist's left border and the outer 8 px of its right border (past the scroll bar)
  put(pledit, PL.left, img, VIDEO.left, { x: 0, w: 11 });
  put(pledit, PL.right, img, VIDEO.right, { x: PL.right.w - 8, w: 8 });
  // bottom bar: playlist bottom filler everywhere, its left edge and resize grip at the ends
  tile(pledit, PL.bottomFill, img, VIDEO.bottomLeft);
  tile(pledit, PL.bottomFill, img, VIDEO.bottomRight);
  tile(pledit, PL.bottomFill, img, VIDEO.bottomFill);
  copy(pledit, PL.bottomLeft.x, PL.bottomLeft.y, 9, 38, img, VIDEO.bottomLeft.x, VIDEO.bottomLeft.y);
  copy(
    pledit,
    PL.bottomRight.x + PL.bottomRight.w - 20,
    PL.bottomRight.y,
    20,
    38,
    img,
    105,
    VIDEO.bottomRight.y,
  );
  put(pledit, PL.closeBtnDown, img, VIDEO.closeBtnDown);
  const face = average(pledit, PL.bottomFill);
  for (let i = 0; i < VIDEO_BUTTONS; i++) {
    drawButton(img, VIDEO.button(i), i, face, false);
    drawButton(img, VIDEO.buttonDown(i), i, face, true);
  }
  return img;
}
