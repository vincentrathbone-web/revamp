/**
 * A resizable skinned frame in the video.bmp layout, around a picture area that the host covers with an element
 * (a <video>, or the visualization canvas). Draws the frame, five buttons, the close button and an info line.
 * The video window and the visualization window are both built on it.
 */
import { VIDEO, VIDEO_BUTTONS, VIDEO_MIN_H, VIDEO_MIN_W, videoArea, type Sprite } from '../skin/sprites';
import { Area, Button, type Control } from './controls';
import type { MenuKind, UiContext } from './context';
import { SkinnedWindow } from './window';

/** Resize steps, like the playlist (free sizes come from the 1x/2x buttons). */
const STEP_W = 25;
const STEP_H = 29;

export interface FrameButton {
  id: string;
  tip: string;
  /** 'menu' opens the window's menu where the button was pressed. */
  run: (() => void) | 'menu';
}

export abstract class FrameWindow extends SkinnedWindow {
  abstract override readonly id: 'video' | 'visual';
  private buttons = new Map<string, Button>();
  /** A resize in progress: which edges move (-1 left/top, 1 right/bottom, 0 none) and where it started. */
  private resizeDrag: {
    sx: number;
    sy: number;
    w: number;
    h: number;
    x: number;
    y: number;
    dx: -1 | 0 | 1;
    dy: -1 | 0 | 1;
  } | null = null;

  constructor(protected readonly ui: UiContext) {
    super();
  }

  /** The window's size in window pixels. */
  abstract override size(): { w: number; h: number };
  protected abstract applySize(w: number, h: number): void;
  /** The five buttons in the bottom bar, left to right. */
  protected abstract buttonDefs(): FrameButton[];
  protected abstract readonly menuKind: MenuKind;
  /** Double-click on the title or picture. */
  protected abstract toggleFullscreen(): void;
  protected abstract infoLine(): string;
  /** Whether the info line may change by itself (playing), so `animating` checks it. */
  protected abstract live(): boolean;
  /** Draw title-bar fill where the skin's title piece would be (the piece says "video"). */
  protected readonly coverTitle: boolean = false;

  /** Where the picture goes, in window pixels. */
  get pictureRect() {
    const { w, h } = this.size();
    return videoArea(w, h);
  }

  private btn(id: string, x: number, y: number, w: number, h: number, fn: () => void, tip: string) {
    const b = new Button(id, x, y, w, h, fn, tip);
    this.buttons.set(id, b);
    return b;
  }

  protected build(): void {
    const ui = this.ui;
    const { w, h } = this.size();
    const P = this.pictureRect;
    this.buttons.clear();
    const menuAt = (x: number, y: number) => ui.showMenu(this.menuKind, x, y);
    const c: Control[] = [
      new Area('drag', 0, 0, w, h, { down: (_p, e) => this.host?.beginMove(e as PointerEvent) }),
      new Area('title', 0, 0, w, 20, {
        down: (_p, e) => this.host?.beginMove(e as PointerEvent),
        dblclick: () => this.toggleFullscreen(),
      }),
      new Area('picture', P.x, P.y, P.w, P.h, {
        down: (_p, e) => this.host?.beginMove(e as PointerEvent),
        dblclick: () => this.toggleFullscreen(),
        contextmenu: (_p, e) => menuAt(e.clientX, e.clientY),
      }),
      this.btn('close', w - 11, 3, 9, 9, () => ui.closeWindow(this.id), 'Close'),
    ];
    this.buttonDefs().forEach((b, i) => {
      const run = b.run;
      c.push(
        this.btn(
          b.id,
          9 + i * 15,
          h - 29,
          15,
          18,
          run === 'menu' ? () => menuAt(this.lastPointer.x, this.lastPointer.y) : run,
          b.tip,
        ),
      );
    });
    // resize from every edge and corner (the bottom-right grip is bigger, like the skin draws it); these
    // come last so they win over the buttons and picture they overlap
    const E = 4; // edge thickness
    const K = 12; // corner size
    const grip = (id: string, x: number, y: number, gw: number, gh: number, dx: -1 | 0 | 1, dy: -1 | 0 | 1) =>
      new Area(
        id,
        x,
        y,
        gw,
        gh,
        {
          down: (_p, e) => {
            const pos = this.host?.position?.() ?? { x: 0, y: 0 };
            this.resizeDrag = {
              sx: (e as PointerEvent).screenX,
              sy: (e as PointerEvent).screenY,
              ...this.size(),
              ...pos,
              dx,
              dy,
            };
          },
          move: () => {},
          up: () => (this.resizeDrag = null),
        },
        `size-${dy < 0 ? 'n' : dy > 0 ? 's' : ''}${dx < 0 ? 'w' : dx > 0 ? 'e' : ''}`,
        'Drag to resize',
      );
    c.push(
      grip('resize-n', K, 0, w - 2 * K, E, 0, -1),
      grip('resize-s', K, h - E, w - 2 * K, E, 0, 1),
      grip('resize-w', 0, K, E, h - 2 * K, -1, 0),
      grip('resize-e', w - E, K, E, h - 2 * K, 1, 0),
      grip('resize-nw', 0, 0, K, K / 2, -1, -1),
      grip('resize-ne', w - K, 0, K - 11, K / 2, 1, -1), // leaves the close button free
      grip('resize-sw', 0, h - K, K, K, -1, 1),
      grip('resize', w - 20, h - 20, 20, 20, 1, 1),
    );
    this.controls = c;
  }

  /** Where the last press happened on the page, so the menu button opens its menu there. */
  private lastPointer = { x: 0, y: 0 };
  override pointerDown(p: { x: number; y: number }, e: PointerEvent): void {
    this.lastPointer = { x: e.clientX, y: e.clientY };
    super.pointerDown(p, e);
  }

  /** Resize uses screen coordinates (the window grows under the pointer). Called by the host. */
  resizeMove(screenX: number, screenY: number, scale: number): void {
    const r = this.resizeDrag;
    if (!r) return;
    const w = r.dx
      ? Math.max(VIDEO_MIN_W, r.w + r.dx * Math.round((screenX - r.sx) / scale / STEP_W) * STEP_W)
      : r.w;
    const h = r.dy
      ? Math.max(VIDEO_MIN_H, r.h + r.dy * Math.round((screenY - r.sy) / scale / STEP_H) * STEP_H)
      : r.h;
    const now = this.size();
    if (w === now.w && h === now.h) return;
    this.applySize(w, h);
    // growing to the left or up: keep the opposite edge where it was
    if (r.dx < 0 || r.dy < 0)
      this.host?.moveTo?.(r.dx < 0 ? r.x + (r.w - w) : r.x, r.dy < 0 ? r.y + (r.h - h) : r.y);
  }

  get resizing(): boolean {
    return !!this.resizeDrag;
  }

  private spr(sp: Sprite, x: number, y: number, w?: number, h?: number): void {
    this.surface.sprite(this.ui.skin, sp, x, y, w, h);
  }

  protected paint(): void {
    const ui = this.ui;
    const skin = ui.skin;
    const surf = this.surface;
    const { w, h } = this.size();
    const top = ui.focusedWindow === this.id ? VIDEO.topActive : VIDEO.topInactive;
    // title bar: fill on both sides of the centred title piece
    surf.tile(skin, top.fill, 25, 0, w - 50, 20);
    this.spr(top.left, 0, 0);
    if (!this.coverTitle) this.spr(top.title, Math.round((w - 100) / 2), 0);
    this.spr(top.right, w - 25, 0);
    // sides, bottom bar
    surf.tile(skin, VIDEO.left, 0, 20, 11, h - 58);
    surf.tile(skin, VIDEO.right, w - 8, 20, 8, h - 58);
    surf.tile(skin, VIDEO.bottomFill, 125, h - 38, w - 250, 38);
    this.spr(VIDEO.bottomLeft, 0, h - 38);
    this.spr(VIDEO.bottomRight, w - 125, h - 38);
    // picture area (the element is laid over it)
    const P = this.pictureRect;
    surf.fill(P.x, P.y, P.w, P.h, [0, 0, 0]);
    // pressed buttons
    const defs = this.buttonDefs();
    for (let i = 0; i < VIDEO_BUTTONS; i++)
      if (this.buttons.get(defs[i]!.id)?.pressed) this.spr(VIDEO.buttonDown(i), 9 + i * 15, h - 29);
    if (this.buttons.get('close')?.pressed) this.spr(VIDEO.closeBtnDown, w - 11, 3);
    this.painted = this.infoLine();
    surf.text(skin, this.painted, 92, h - 23, Math.max(0, w - 25 - 92));
  }

  private painted = '';

  /** Repaints only when the info line changes (about once a second), not every frame. */
  override animating(): boolean {
    return this.live() && this.infoLine() !== this.painted;
  }
}
