/** Base class for skinned windows: owns a Surface and a list of controls, handles pointer routing. */
import { Surface } from '../skin/surface';
import { regionMask, type Polygon } from '../skin/textfiles';
import { hit, type Control, type Point } from './controls';

export type WindowId = 'main' | 'eq' | 'pl' | 'video';
/** The classic windows, which have a shade mode. */
export type ShadeId = 'main' | 'eq' | 'pl';

/** Big areas that only drag the window or hold text; the shape doesn't have to keep them solid. */
const PASSIVE_AREAS = new Set(['drag', 'list', 'scroll', 'title', 'tracks']);

/** What a window can ask of the thing that shows it on screen (browser page or native window). */
export interface WindowHostApi {
  /** Starts dragging the window (the host moves it, with snapping and docking). */
  beginMove(e: PointerEvent): void;
  /** Tells the host the window's logical size changed. */
  sizeChanged(): void;
  setCursor(name: string | undefined): void;
  setTooltip(text: string | undefined): void;
  readonly focused: boolean;
}

export abstract class SkinnedWindow {
  abstract readonly id: WindowId;
  readonly surface = new Surface(1, 1);
  controls: Control[] = [];
  host: WindowHostApi | null = null;
  private active: Control | null = null;
  private dirty = true;

  /** Logical (unscaled) size. */
  abstract size(): { w: number; h: number };
  /** Rebuilds the control list for the current size/mode. */
  protected abstract build(): void;
  /** Draws everything onto `this.surface`. */
  protected abstract paint(): void;
  /** True while something animates (vis, scrolling title, blinking time). */
  animating(): boolean {
    return false;
  }

  invalidate(): void {
    this.dirty = true;
  }

  relayout(): void {
    this.build();
    this.invalidate();
    this.host?.sizeChanged();
  }

  /** Redraws if needed. Returns true if the surface changed. */
  render(force = false): boolean {
    if (!force && !this.dirty && !this.animating()) return false;
    const { w, h } = this.size();
    if (this.surface.width !== w || this.surface.height !== h) {
      this.surface.resize(w, h);
      this.build();
    }
    if (!this.controls.length) this.build();
    this.paint();
    this.applyRegion();
    this.dirty = false;
    return true;
  }

  /** Window shape from the skin's region.txt (undefined = rectangular). */
  region(): Polygon[] | undefined {
    return undefined;
  }

  private maskCache: {
    key: unknown;
    controls: Control[];
    w: number;
    h: number;
    mask: Uint8Array | null;
  } | null = null;

  /**
   * The window shape as a mask (1 = solid), or null for a plain rectangle. Every button and slider stays solid,
   * even where the skin's region cuts it away, so each control always works. A region that hides more than a
   * quarter of the controls is treated as broken (some old region tools wrote garbage) and ignored.
   */
  private shapeMask(): Uint8Array | null {
    const polys = this.region();
    if (!polys) return null;
    const { width: w, height: h } = this.surface;
    const mc = this.maskCache;
    if (mc && mc.key === polys && mc.controls === this.controls && mc.w === w && mc.h === h) return mc.mask;
    const active = this.controls.filter((c) => !PASSIVE_AREAS.has(c.id));
    let mask: Uint8Array | null = regionMask(polys, w, h);
    const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask![y * w + x] === 1;
    const hidden = active.filter((c) => !solid(c.x + Math.floor(c.w / 2), c.y + Math.floor(c.h / 2))).length;
    if (hidden > active.length / 4) mask = null;
    else {
      for (const c of active)
        for (let y = Math.max(0, c.y); y < Math.min(h, c.y + c.h); y++)
          for (let x = Math.max(0, c.x); x < Math.min(w, c.x + c.w); x++) mask[y * w + x] = 1;
    }
    this.maskCache = { key: polys, controls: this.controls, w, h, mask };
    return mask;
  }

  private applyRegion(): void {
    const m = this.shapeMask();
    if (!m) return;
    const d = this.surface.data;
    for (let i = 0; i < m.length; i++) if (!m[i]) d[i * 4 + 3] = 0;
  }

  /** False where the window is cut away by its region (clicks pass through). */
  inside(x: number, y: number): boolean {
    const m = this.shapeMask();
    if (!m) return true;
    const { width: w, height: h } = this.surface;
    return x >= 0 && y >= 0 && x < w && y < h && m[y * w + x] === 1;
  }

  controlAt(p: Point): Control | undefined {
    for (let i = this.controls.length - 1; i >= 0; i--)
      if (hit(this.controls[i]!, p)) return this.controls[i];
    return undefined;
  }

  pointerDown(p: Point, e: PointerEvent): void {
    const c = this.controlAt(p);
    if (!c) return;
    if (e.button === 2) return;
    this.active = c;
    c.down?.(p, e);
    this.invalidate();
  }

  pointerMove(p: Point): void {
    if (this.active) {
      this.active.move?.(p);
      this.invalidate();
      return;
    }
    const c = this.controlAt(p);
    this.host?.setCursor(c?.cursor);
    this.host?.setTooltip(c?.tooltip);
  }

  pointerUp(p: Point): void {
    const c = this.active;
    this.active = null;
    if (c) {
      c.up?.(p, hit(c, p));
      this.invalidate();
    }
  }

  dblclick(p: Point): void {
    this.controlAt(p)?.dblclick?.(p);
    this.invalidate();
  }

  wheel(p: Point, dy: number): void {
    const c = this.controlAt(p);
    if (c?.wheel) {
      c.wheel(dy);
      this.invalidate();
    } else this.onWheel(dy);
  }

  contextmenu(p: Point, e: MouseEvent): void {
    const c = this.controlAt(p);
    if (c?.contextmenu) c.contextmenu(p, e);
    else this.onContextMenu(e);
  }

  protected onWheel(_dy: number): void {}
  protected onContextMenu(_e: MouseEvent): void {}
  /** Keys pressed while this window has focus. Return true if handled. */
  key(_e: KeyboardEvent): boolean {
    return false;
  }
}
