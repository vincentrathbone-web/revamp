/** Base class for skinned windows: owns a Surface and a list of controls, handles pointer routing. */
import { Surface } from '../skin/surface';
import { insideRegions, type Polygon } from '../skin/textfiles';
import { hit, type Control, type Point } from './controls';

export type WindowId = 'main' | 'eq' | 'pl';

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

  private maskCache: { key: unknown; w: number; h: number; mask: Uint8Array } | null = null;

  private applyRegion(): void {
    const polys = this.region();
    if (!polys) return;
    const { width: w, height: h } = this.surface;
    if (!this.maskCache || this.maskCache.key !== polys || this.maskCache.w !== w || this.maskCache.h !== h) {
      const mask = new Uint8Array(w * h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) mask[y * w + x] = insideRegions(polys, x, y) ? 1 : 0;
      this.maskCache = { key: polys, w, h, mask };
    }
    const m = this.maskCache.mask;
    const d = this.surface.data;
    for (let i = 0; i < m.length; i++) if (!m[i]) d[i * 4 + 3] = 0;
  }

  /** False where the window is cut away by its region (clicks pass through). */
  inside(x: number, y: number): boolean {
    const polys = this.region();
    return !polys || insideRegions(polys, x, y);
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
