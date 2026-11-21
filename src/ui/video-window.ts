/**
 * The resizable video window: a skinned frame (video.bmp layout) around the picture. The picture itself is a
 * <video> element the host lays over `pictureRect`; this window draws the frame, the buttons and an info line.
 */
import { formatTime } from '../playlist/model';
import { VIDEO, VIDEO_BUTTONS, VIDEO_MIN_H, VIDEO_MIN_W, videoArea, type Sprite } from '../skin/sprites';
import { Area, Button, type Control } from './controls';
import type { UiContext, VideoCommand } from './context';
import { SkinnedWindow } from './window';

/** Resize steps, like the playlist (free sizes come from the 1x/2x buttons). */
const STEP_W = 25;
const STEP_H = 29;

const BUTTONS: { id: string; cmd: VideoCommand | 'menu'; tip: string }[] = [
  { id: 'vFull', cmd: 'fullscreen', tip: 'Fullscreen' },
  { id: 'vZoom1', cmd: 'zoom1', tip: 'Original size (100%)' },
  { id: 'vZoom2', cmd: 'zoom2', tip: 'Double size (200%)' },
  { id: 'vStretch', cmd: 'stretch', tip: 'Stretch to fill / keep aspect' },
  { id: 'vMenu', cmd: 'menu', tip: 'Video menu' },
];

export class VideoWindow extends SkinnedWindow {
  readonly id = 'video' as const;
  private buttons = new Map<string, Button>();
  private resizeDrag: { sx: number; sy: number; w: number; h: number } | null = null;

  constructor(private readonly ui: UiContext) {
    super();
  }

  size() {
    return { ...this.ui.state.videoSize };
  }

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
    const menuAt = (e: MouseEvent | PointerEvent) => ui.showMenu('video', e.clientX, e.clientY);
    const c: Control[] = [
      new Area('drag', 0, 0, w, h, { down: (_p, e) => this.host?.beginMove(e as PointerEvent) }),
      new Area('title', 0, 0, w, 20, {
        down: (_p, e) => this.host?.beginMove(e as PointerEvent),
        dblclick: () => ui.videoCommand('fullscreen'),
      }),
      new Area('picture', P.x, P.y, P.w, P.h, {
        down: (_p, e) => this.host?.beginMove(e as PointerEvent),
        dblclick: () => ui.videoCommand('fullscreen'),
        contextmenu: (_p, e) => menuAt(e),
      }),
      this.btn('close', w - 11, 3, 9, 9, () => ui.closeWindow('video'), 'Close'),
    ];
    BUTTONS.forEach((b, i) =>
      c.push(
        this.btn(
          b.id,
          9 + i * 15,
          h - 29,
          15,
          18,
          () =>
            b.cmd === 'menu'
              ? ui.showMenu('video', this.lastPointer.x, this.lastPointer.y)
              : ui.videoCommand(b.cmd),
          b.tip,
        ),
      ),
    );
    c.push(
      new Area('resize', w - 20, h - 20, 20, 20, {
        down: (_p, e) =>
          (this.resizeDrag = {
            sx: (e as PointerEvent).screenX,
            sy: (e as PointerEvent).screenY,
            ...ui.state.videoSize,
          }),
        move: () => {},
        up: () => (this.resizeDrag = null),
      }),
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
    const w = Math.max(VIDEO_MIN_W, r.w + Math.round((screenX - r.sx) / scale / STEP_W) * STEP_W);
    const h = Math.max(VIDEO_MIN_H, r.h + Math.round((screenY - r.sy) / scale / STEP_H) * STEP_H);
    if (w !== this.ui.state.videoSize.w || h !== this.ui.state.videoSize.h) this.ui.setVideoSize(w, h);
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
    const top = ui.focusedWindow === 'video' ? VIDEO.topActive : VIDEO.topInactive;
    // title bar: fill on both sides of the centred title piece
    surf.tile(skin, top.fill, 25, 0, w - 50, 20);
    this.spr(top.left, 0, 0);
    this.spr(top.title, Math.round((w - 100) / 2), 0);
    this.spr(top.right, w - 25, 0);
    // sides, bottom bar
    surf.tile(skin, VIDEO.left, 0, 20, 11, h - 58);
    surf.tile(skin, VIDEO.right, w - 8, 20, 8, h - 58);
    surf.tile(skin, VIDEO.bottomFill, 125, h - 38, w - 250, 38);
    this.spr(VIDEO.bottomLeft, 0, h - 38);
    this.spr(VIDEO.bottomRight, w - 125, h - 38);
    // picture area (the video element is laid over it)
    const P = this.pictureRect;
    surf.fill(P.x, P.y, P.w, P.h, [0, 0, 0]);
    // pressed buttons
    for (let i = 0; i < VIDEO_BUTTONS; i++)
      if (this.buttons.get(BUTTONS[i]!.id)?.pressed) this.spr(VIDEO.buttonDown(i), 9 + i * 15, h - 29);
    if (this.buttons.get('close')?.pressed) this.spr(VIDEO.closeBtnDown, w - 11, 3);
    // info line: title and time
    this.painted = this.infoLine();
    surf.text(skin, this.painted, 92, h - 23, Math.max(0, w - 25 - 92));
  }

  private painted = '';
  private infoLine(): string {
    const st = this.ui.state;
    const time = st.duration ? `${formatTime(st.position)}/${formatTime(st.duration)}` : '';
    return `${st.title}${time ? `  ${time}` : ''}`;
  }

  /** Repaints only when the info line changes (about once a second), not every frame. */
  override animating(): boolean {
    return this.ui.state.playState !== 'stopped' && this.infoLine() !== this.painted;
  }
}
