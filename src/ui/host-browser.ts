/**
 * Shows skinned windows inside the browser page: one canvas per window, drawn pixel-exact
 * (integer scaling, no smoothing), dragged with snapping and docking like the classic player.
 * The desktop app uses it too, inside one transparent full-screen window (see platform/tauri.ts).
 */
import { dockedGroup, keepOnScreens, reflow, snap, type Rect } from './wm/snap';
import type { SkinnedWindow, WindowHostApi, WindowId } from './window';

export interface HostOptions {
  scaleOf(id: WindowId): number;
  /** Return false where the window is transparent (shaped skins). */
  inside(id: WindowId, x: number, y: number): boolean;
  cursorUrl(name: string | undefined): string | undefined;
  snapEnabled(): boolean;
  snapDistance(): number;
  onFocus(id: WindowId): void;
  onLayout(): void;
  onDrop?(id: WindowId, e: DragEvent): void;
}

interface Hosted {
  win: SkinnedWindow;
  el: HTMLDivElement;
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  x: number;
  y: number;
  visible: boolean;
  /** Last size in screen px, for reflow after size changes. */
  rect: Rect;
}

export class BrowserHost {
  private wins = new Map<WindowId, Hosted>();
  focused: WindowId | null = null;
  private moving: {
    ids: WindowId[];
    start: Record<string, { x: number; y: number }>;
    px: number;
    py: number;
    main: WindowId;
  } | null = null;

  constructor(
    readonly root: HTMLElement,
    readonly opts: HostOptions,
  ) {
    addEventListener('pointermove', (e) => this.onDragMove(e));
    addEventListener('pointerup', () => {
      if (this.moving) {
        this.moving = null;
        this.opts.onLayout();
      }
    });
    addEventListener('resize', () => this.keepAllOnScreen());
  }

  get screen(): Rect {
    return { x: 0, y: 0, w: this.root.clientWidth || innerWidth, h: this.root.clientHeight || innerHeight };
  }

  /** The monitors' work areas in page coordinates (desktop app). Unset = the page is one screen. */
  monitors: Rect[] | null = null;

  get screens(): Rect[] {
    return this.monitors?.length ? this.monitors : [this.screen];
  }

  add(win: SkinnedWindow, x: number, y: number, visible = true): void {
    const el = document.createElement('div');
    el.className = 'rv-window';
    el.dataset.win = win.id;
    const canvas = document.createElement('canvas');
    canvas.setAttribute(
      'aria-label',
      { main: 'RevAmp main window', eq: 'Equalizer', pl: 'Playlist editor' }[win.id],
    );
    el.appendChild(canvas);
    this.root.appendChild(el);
    const g = canvas.getContext('2d')!;
    const h: Hosted = { win, el, canvas, g, x, y, visible, rect: { x, y, w: 0, h: 0 } };
    this.wins.set(win.id, h);
    const api: WindowHostApi = {
      beginMove: (e) => this.beginMove(win.id, e),
      sizeChanged: () => this.sizeChanged(win.id),
      setCursor: (name) => (canvas.style.cursor = this.opts.cursorUrl(name) ?? ''),
      setTooltip: (t) => (canvas.title = t ?? ''),
      get focused() {
        return false;
      },
    };
    win.host = api;
    this.wireEvents(h);
    this.applyGeometry(h);
  }

  private local(h: Hosted, e: MouseEvent) {
    const r = h.canvas.getBoundingClientRect();
    const s = this.opts.scaleOf(h.win.id);
    return { x: Math.floor((e.clientX - r.left) / s), y: Math.floor((e.clientY - r.top) / s) };
  }

  private wireEvents(h: Hosted): void {
    const c = h.canvas;
    const id = h.win.id;
    const transparentAt = (e: MouseEvent) => {
      const p = this.local(h, e);
      return !this.opts.inside(id, p.x, p.y);
    };
    c.addEventListener('pointerdown', (e) => {
      if (transparentAt(e)) return;
      this.focus(id);
      c.setPointerCapture(e.pointerId);
      h.win.pointerDown(this.local(h, e), e);
      e.preventDefault();
    });
    c.addEventListener('pointermove', (e) => {
      const win = h.win as SkinnedWindow & {
        resizing?: boolean;
        resizeMove?: (x: number, y: number, s: number) => void;
      };
      if (win.resizing && win.resizeMove) win.resizeMove(e.screenX, e.screenY, this.opts.scaleOf(id));
      else h.win.pointerMove(this.local(h, e));
    });
    c.addEventListener('pointerup', (e) => {
      if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
      h.win.pointerUp(this.local(h, e));
    });
    c.addEventListener('dblclick', (e) => !transparentAt(e) && h.win.dblclick(this.local(h, e)));
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        h.win.wheel(this.local(h, e), e.deltaY);
      },
      { passive: false },
    );
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!transparentAt(e)) h.win.contextmenu(this.local(h, e), e);
    });
    c.addEventListener('dragover', (e) => e.preventDefault());
    c.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.opts.onDrop?.(id, e);
    });
  }

  focus(id: WindowId): void {
    if (this.focused === id) return;
    this.focused = id;
    for (const [k, h] of this.wins) h.el.style.zIndex = k === id ? '3' : '2';
    this.opts.onFocus(id);
    for (const h of this.wins.values()) h.win.invalidate();
  }

  private sizeOf(h: Hosted): { w: number; h: number } {
    const s = h.win.size();
    const k = this.opts.scaleOf(h.win.id);
    return { w: s.w * k, h: s.h * k };
  }

  /** Applies position (and size, unless only moving: sizeChanged needs the old size to reflow docked windows). */
  private applyGeometry(h: Hosted, moveOnly = false): void {
    const { w, h: hh } = moveOnly && h.rect.w ? h.rect : this.sizeOf(h);
    h.el.style.transform = `translate(${h.x}px, ${h.y}px)`;
    h.el.style.display = h.visible ? '' : 'none';
    h.canvas.style.width = `${w}px`;
    h.canvas.style.height = `${hh}px`;
    h.rect = { x: h.x, y: h.y, w, h: hh };
  }

  rects(includeHidden = false): Record<string, Rect> {
    const out: Record<string, Rect> = {};
    for (const [id, h] of this.wins)
      if (h.visible || includeHidden) out[id] = { x: h.x, y: h.y, ...this.sizeOf(h) };
    return out;
  }

  position(id: WindowId): { x: number; y: number } {
    const h = this.wins.get(id)!;
    return { x: h.x, y: h.y };
  }

  setPosition(id: WindowId, x: number, y: number): void {
    const h = this.wins.get(id);
    if (!h) return;
    h.x = Math.round(x);
    h.y = Math.round(y);
    this.applyGeometry(h, true);
  }

  setVisible(id: WindowId, visible: boolean): void {
    const h = this.wins.get(id);
    if (!h) return;
    h.visible = visible;
    this.applyGeometry(h);
    if (visible) this.render(true);
  }

  isVisible(id: WindowId): boolean {
    return this.wins.get(id)?.visible ?? false;
  }

  private beginMove(id: WindowId, e: PointerEvent): void {
    const rects = this.rects();
    const ids: WindowId[] = [id, ...(id === 'main' ? (dockedGroup('main', rects) as WindowId[]) : [])];
    const start: Record<string, { x: number; y: number }> = {};
    for (const k of ids) start[k] = this.position(k);
    this.moving = { ids, start, px: e.clientX, py: e.clientY, main: id };
  }

  private onDragMove(e: PointerEvent): void {
    const m = this.moving;
    if (!m) return;
    const dx = e.clientX - m.px,
      dy = e.clientY - m.py;
    const lead = m.main;
    const r = this.rects();
    const moving: Rect = { ...r[lead]!, x: m.start[lead]!.x + dx, y: m.start[lead]!.y + dy };
    let target = { x: moving.x, y: moving.y };
    if (this.opts.snapEnabled()) {
      const others = Object.entries(r)
        .filter(([k]) => !m.ids.includes(k as WindowId))
        .map(([, v]) => v);
      target = snap(moving, others, this.screens, this.opts.snapDistance());
    }
    const ddx = target.x - m.start[lead]!.x,
      ddy = target.y - m.start[lead]!.y;
    for (const k of m.ids) this.setPosition(k, m.start[k]!.x + ddx, m.start[k]!.y + ddy);
  }

  /** A window changed size (shade, double size, playlist resize): keep docked windows attached. */
  sizeChanged(id: WindowId): void {
    const h = this.wins.get(id);
    if (!h) return;
    const before = h.rect;
    const size = this.sizeOf(h);
    const after = { x: h.x, y: h.y, ...size };
    if (before.w && (before.w !== after.w || before.h !== after.h) && h.visible) {
      const rects: Record<string, Rect> = {};
      for (const [k, o] of this.wins) if (o.visible) rects[k] = k === id ? before : o.rect;
      const out = reflow(id, before, after, rects);
      for (const [k, rr] of Object.entries(out)) if (k !== id) this.setPosition(k as WindowId, rr.x, rr.y);
    }
    this.applyGeometry(h);
    h.win.invalidate();
    this.opts.onLayout();
  }

  keepAllOnScreen(): void {
    if (this.screen.w < 40 || this.screen.h < 40) return;
    for (const [id, h] of this.wins) {
      const r = keepOnScreens({ x: h.x, y: h.y, ...this.sizeOf(h) }, this.screens);
      if (r.x !== h.x || r.y !== h.y) this.setPosition(id, r.x, r.y);
    }
  }

  /** Draws every visible window that changed. */
  render(force = false): void {
    for (const h of this.wins.values()) {
      if (!h.visible) continue;
      if (!h.win.render(force)) continue;
      const s = h.win.surface;
      if (h.canvas.width !== s.width || h.canvas.height !== s.height) {
        h.canvas.width = s.width;
        h.canvas.height = s.height;
        this.applyGeometry(h);
      }
      h.g.putImageData(new ImageData(s.data as Uint8ClampedArray<ArrayBuffer>, s.width, s.height), 0, 0);
    }
  }

  get windows(): SkinnedWindow[] {
    return [...this.wins.values()].map((h) => h.win);
  }

  /** True while a window is being dragged. */
  get dragging(): boolean {
    return this.moving !== null;
  }

  /** True if page point (x, y) is on a visible, non-transparent part of a window (topmost first). */
  hitTest(x: number, y: number): boolean {
    const order = [...this.wins.values()].sort(
      (a, b) => Number(b.el.style.zIndex || 0) - Number(a.el.style.zIndex || 0),
    );
    for (const h of order) {
      if (!h.visible) continue;
      const { w, h: hh } = this.sizeOf(h);
      if (x < h.x || y < h.y || x >= h.x + w || y >= h.y + hh) continue;
      const s = this.opts.scaleOf(h.win.id);
      if (this.opts.inside(h.win.id, Math.floor((x - h.x) / s), Math.floor((y - h.y) / s))) return true;
    }
    return false;
  }

  canvasOf(id: WindowId): HTMLCanvasElement | undefined {
    return this.wins.get(id)?.canvas;
  }
}
