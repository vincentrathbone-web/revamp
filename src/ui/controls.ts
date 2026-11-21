/** Hit-testable controls inside a skinned window (coordinates in unscaled window pixels). */
export interface Point {
  x: number;
  y: number;
}

export interface Control {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Skin cursor name (e.g. "close", "volbal", "posbar"). */
  cursor?: string;
  tooltip?: string;
  down?(p: Point, e: PointerEvent | MouseEvent): void;
  move?(p: Point): void;
  up?(p: Point, inside: boolean): void;
  dblclick?(p: Point): void;
  wheel?(deltaY: number): void;
  contextmenu?(p: Point, e: MouseEvent): void;
}

export const hit = (c: Control, p: Point) => p.x >= c.x && p.y >= c.y && p.x < c.x + c.w && p.y < c.y + c.h;

/** Push button: `pressed` is true while the pointer is down over it. */
export class Button implements Control {
  pressed = false;
  constructor(
    public id: string,
    public x: number,
    public y: number,
    public w: number,
    public h: number,
    public onClick: () => void,
    public tooltip?: string,
    public cursor?: string,
  ) {}
  down(): void {
    this.pressed = true;
  }
  move(p: Point): void {
    this.pressed = hit(this, p);
  }
  up(_p: Point, inside: boolean): void {
    this.pressed = false;
    if (inside) this.onClick();
  }
}

/** Horizontal slider. Value 0..1 maps to the thumb's left edge from x to x + w - thumbW. */
export class HSlider implements Control {
  dragging = false;
  private grab = 0;
  constructor(
    public id: string,
    public x: number,
    public y: number,
    public w: number,
    public h: number,
    public thumbW: number,
    public get: () => number,
    public onInput: (v: number) => void,
    public onCommit?: (v: number) => void,
    public cursor?: string,
    /** Optional snap (e.g. balance centre): returns the snapped value. */
    public snap?: (v: number) => number,
  ) {}
  thumbX(v = this.get()): number {
    return Math.round(Math.max(0, Math.min(1, v)) * (this.w - this.thumbW));
  }
  private valueAt(px: number): number {
    const v = (px - this.x - this.grab) / (this.w - this.thumbW);
    const c = Math.max(0, Math.min(1, v));
    return this.snap ? this.snap(c) : c;
  }
  down(p: Point): void {
    this.dragging = true;
    const tx = this.x + this.thumbX();
    // grabbing the thumb keeps the offset; clicking the track centres the thumb on the pointer
    this.grab = p.x >= tx && p.x < tx + this.thumbW ? p.x - tx : this.thumbW / 2;
    this.onInput(this.valueAt(p.x));
  }
  move(p: Point): void {
    if (this.dragging) this.onInput(this.valueAt(p.x));
  }
  up(p: Point): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.onCommit?.(this.valueAt(p.x));
  }
  wheel(dy: number): void {
    const v = Math.max(0, Math.min(1, this.get() - Math.sign(dy) * 0.04));
    this.onInput(v);
    this.onCommit?.(v);
  }
}

/** Vertical slider (EQ bands). Value 0 = top (+12 dB), 1 = bottom (-12 dB). */
export class VSlider implements Control {
  dragging = false;
  private grab = 0;
  constructor(
    public id: string,
    public x: number,
    public y: number,
    public w: number,
    public h: number,
    public thumbH: number,
    public travel: number,
    public get: () => number,
    public onInput: (v: number) => void,
    public onCommit?: () => void,
  ) {}
  thumbY(v = this.get()): number {
    return Math.round(Math.max(0, Math.min(1, v)) * this.travel);
  }
  private valueAt(py: number): number {
    return Math.max(0, Math.min(1, (py - this.y - this.grab) / this.travel));
  }
  down(p: Point): void {
    this.dragging = true;
    const ty = this.y + this.thumbY();
    this.grab = p.y >= ty && p.y < ty + this.thumbH ? p.y - ty : this.thumbH / 2;
    this.onInput(this.valueAt(p.y));
  }
  move(p: Point): void {
    if (this.dragging) this.onInput(this.valueAt(p.y));
  }
  up(): void {
    if (this.dragging) {
      this.dragging = false;
      this.onCommit?.();
    }
  }
  wheel(dy: number): void {
    this.onInput(Math.max(0, Math.min(1, this.get() + Math.sign(dy) / 24)));
    this.onCommit?.();
  }
}

/** A plain area with custom handlers (title bar drag, display click, etc.). */
export class Area implements Control {
  constructor(
    public id: string,
    public x: number,
    public y: number,
    public w: number,
    public h: number,
    handlers: Partial<Pick<Control, 'down' | 'move' | 'up' | 'dblclick' | 'wheel' | 'contextmenu'>>,
    public cursor?: string,
    public tooltip?: string,
  ) {
    Object.assign(this, handlers);
  }
  down?(p: Point, e: PointerEvent | MouseEvent): void;
  move?(p: Point): void;
  up?(p: Point, inside: boolean): void;
  dblclick?(p: Point): void;
  wheel?(deltaY: number): void;
  contextmenu?(p: Point, e: MouseEvent): void;
}
