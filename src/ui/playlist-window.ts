/** The resizable playlist editor window. */
import { displayTitle, formatTime } from '../playlist/model';
import type { RgbaImage } from '../skin/image';
import { textWidth } from '../skin/surface';
import {
  PL,
  PL_MENUS,
  PL_MIN_H,
  PL_MIN_W,
  PL_STEP_H,
  PL_STEP_W,
  type PlMenuItem,
  type Sprite,
} from '../skin/sprites';
import { Area, Button, type Control, type Point } from './controls';
import type { UiContext } from './context';
import { SkinnedWindow } from './window';

/** Renders a line of text in the skin's playlist font (browser: canvas; tests: null = use the bitmap font). */
export type TextRenderer = (
  text: string,
  color: readonly [number, number, number],
  bg: readonly [number, number, number],
  maxW: number,
  h: number,
  font: string,
) => RgbaImage | null;

export const ROW_H = 13;
type MenuName = keyof typeof PL_MENUS;

export class PlaylistWindow extends SkinnedWindow {
  readonly id = 'pl' as const;
  scroll = 0;
  private anchor = -1;
  private dragRow: number | null = null;
  private openMenu: { name: MenuName; x: number; y: number; hover: number } | null = null;
  private buttons = new Map<string, Button>();
  private scrollDrag: { startY: number; startScroll: number } | null = null;
  private resizeDrag: { sx: number; sy: number; w: number; h: number } | null = null;
  private textCache = new Map<string, RgbaImage | null>();

  constructor(
    private readonly ui: UiContext,
    private readonly renderText: TextRenderer = () => null,
    private readonly onMenuAction: (id: string) => void = () => {},
  ) {
    super();
  }

  get shaded(): boolean {
    return this.ui.state.shade.pl;
  }

  size() {
    const { w, h } = this.ui.state.plSize;
    return { w, h: this.shaded ? 14 : h };
  }

  get listRect() {
    const { w, h } = this.size();
    return { x: 12, y: 20, w: w - 31, h: h - 58 };
  }

  get visibleRows(): number {
    return Math.max(1, Math.floor(this.listRect.h / ROW_H));
  }

  get maxScroll(): number {
    return Math.max(0, this.ui.playlist.length - this.visibleRows);
  }

  scrollTo(row: number): void {
    this.scroll = Math.max(0, Math.min(this.maxScroll, Math.round(row)));
    this.invalidate();
  }

  ensureVisible(i: number): void {
    if (i < this.scroll) this.scrollTo(i);
    else if (i >= this.scroll + this.visibleRows) this.scrollTo(i - this.visibleRows + 1);
  }

  private btn(
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    fn: () => void,
    tip?: string,
    cursor?: string,
  ) {
    const b = new Button(id, x, y, w, h, fn, tip, cursor);
    this.buttons.set(id, b);
    return b;
  }

  protected build(): void {
    const ui = this.ui;
    const { w, h } = this.size();
    this.buttons.clear();
    const c: Control[] = [];
    if (this.shaded) {
      c.push(
        new Area(
          'drag',
          0,
          0,
          w,
          14,
          {
            down: (_p, e) => this.host?.beginMove(e as PointerEvent),
            dblclick: () => ui.toggleShade('pl'),
          },
          'pwsnorm',
        ),
        this.btn('unshade', w - 20, 3, 9, 9, () => ui.toggleShade('pl'), 'Normal mode', 'pwinbut'),
        this.btn('close', w - 11, 3, 9, 9, () => ui.closeWindow('pl'), 'Close', 'pclose'),
      );
      this.controls = c;
      return;
    }
    const L = this.listRect;
    c.push(
      new Area(
        'drag',
        0,
        0,
        w,
        20,
        {
          down: (_p, e) => this.host?.beginMove(e as PointerEvent),
          dblclick: () => ui.toggleShade('pl'),
        },
        'ptbar',
      ),
      this.btn('shade', w - 20, 3, 9, 9, () => ui.toggleShade('pl'), 'Shade mode', 'pwinbut'),
      this.btn('close', w - 11, 3, 9, 9, () => ui.closeWindow('pl'), 'Close', 'pclose'),
      new Area(
        'list',
        L.x,
        L.y,
        L.w,
        L.h,
        {
          down: (p, e) => this.listDown(p, e),
          move: (p) => this.listMove(p),
          up: () => (this.dragRow = null),
          dblclick: (p) => {
            const i = this.rowAt(p);
            if (i >= 0) ui.playIndex(i);
          },
          contextmenu: (p, e) => {
            const i = this.rowAt(p);
            if (i >= 0 && !ui.playlist.entries[i]!.selected) this.selectOnly(i);
            ui.showMenu('plItem', e.clientX, e.clientY, i);
          },
        },
        'pnormal',
      ),
      new Area(
        'scroll',
        w - 15,
        20,
        8,
        h - 58,
        {
          down: (p) => {
            const thumbY = this.thumbY();
            if (p.y >= thumbY && p.y < thumbY + 18)
              this.scrollDrag = { startY: p.y, startScroll: this.scroll };
            else this.scrollTo(this.scroll + (p.y < thumbY ? -this.visibleRows : this.visibleRows));
          },
          move: (p) => {
            if (!this.scrollDrag) return;
            const track = h - 58 - 18;
            this.scrollTo(
              this.scrollDrag.startScroll +
                ((p.y - this.scrollDrag.startY) / Math.max(1, track)) * this.maxScroll,
            );
          },
          up: () => (this.scrollDrag = null),
        },
        'pvscroll',
      ),
    );
    // bottom bar menu buttons
    const menuBtn = (name: MenuName, x: number) =>
      new Area(
        name,
        x,
        h - 30,
        22,
        18,
        {
          down: () => {
            const m = PL_MENUS[name];
            this.openMenu = { name, x, y: h - 30 + 18 - m.items.length * 18, hover: -1 };
          },
          move: (p) => {
            const m = this.openMenu;
            if (!m) return;
            const n = PL_MENUS[m.name].items.length;
            const idx = p.x >= m.x - 3 && p.x < m.x + 22 ? Math.floor((p.y - m.y) / 18) : -1;
            m.hover = idx >= 0 && idx < n ? idx : -1;
          },
          up: () => {
            const m = this.openMenu;
            this.openMenu = null;
            if (m && m.hover >= 0) this.onMenuAction(PL_MENUS[m.name].items[m.hover]!.id);
          },
        },
        'pnormal',
      );
    c.push(
      menuBtn('add', 14),
      menuBtn('rem', 43),
      menuBtn('sel', 72),
      menuBtn('misc', 101),
      menuBtn('list', w - 44),
    );
    // mini transport (in the bottom-right piece)
    const bx = w - 144,
      by = h - 16;
    const mini: [string, () => void, string][] = [
      ['mPrev', () => ui.prev(), 'Previous'],
      ['mPlay', () => ui.play(), 'Play'],
      ['mPause', () => ui.pause(), 'Pause'],
      ['mStop', () => ui.stop(), 'Stop'],
      ['mNext', () => ui.next(), 'Next'],
      ['mEject', () => ui.eject(), 'Open file'],
    ];
    mini.forEach(([id, fn, tip], i) => c.push(this.btn(id, bx + i * 9, by, 9, 8, fn, tip)));
    // resize grip
    c.push(
      new Area(
        'resize',
        w - 20,
        h - 20,
        20,
        20,
        {
          down: (_p, e) =>
            (this.resizeDrag = {
              sx: (e as PointerEvent).screenX,
              sy: (e as PointerEvent).screenY,
              ...ui.state.plSize,
            }),
          move: () => {},
          up: () => (this.resizeDrag = null),
        },
        'psize',
      ),
    );
    this.controls = c;
  }

  /** Resize uses screen coordinates (the window grows under the pointer). Called by the host. */
  resizeMove(screenX: number, screenY: number, scale: number): void {
    const r = this.resizeDrag;
    if (!r) return;
    const w = Math.max(PL_MIN_W, r.w + Math.round((screenX - r.sx) / scale / PL_STEP_W) * PL_STEP_W);
    const h = Math.max(PL_MIN_H, r.h + Math.round((screenY - r.sy) / scale / PL_STEP_H) * PL_STEP_H);
    if (w !== this.ui.state.plSize.w || h !== this.ui.state.plSize.h) this.ui.setPlaylistSize(w, h);
  }

  get resizing(): boolean {
    return !!this.resizeDrag;
  }

  private rowAt(p: Point): number {
    const i = this.scroll + Math.floor((p.y - this.listRect.y) / ROW_H);
    return i >= 0 && i < this.ui.playlist.length ? i : -1;
  }

  private selectOnly(i: number): void {
    this.ui.playlist.select((_, k) => k === i);
    this.anchor = i;
  }

  private listDown(p: Point, e: PointerEvent | MouseEvent): void {
    const pl = this.ui.playlist;
    const i = this.rowAt(p);
    if (i < 0) {
      pl.select(() => false);
      return;
    }
    if (e.shiftKey && this.anchor >= 0) {
      const [a, b] = [Math.min(this.anchor, i), Math.max(this.anchor, i)];
      pl.select((en, k) => (e.ctrlKey ? !!en.selected : false) || (k >= a && k <= b));
    } else if (e.ctrlKey) {
      pl.entries[i]!.selected = !pl.entries[i]!.selected;
      this.anchor = i;
      pl.changed();
    } else {
      if (!pl.entries[i]!.selected) this.selectOnly(i);
      this.dragRow = i;
    }
  }

  private listMove(p: Point): void {
    if (this.dragRow === null) return;
    const i = Math.max(
      0,
      Math.min(this.ui.playlist.length - 1, this.scroll + Math.floor((p.y - this.listRect.y) / ROW_H)),
    );
    if (i !== this.dragRow) {
      this.ui.playlist.moveSelected(i - this.dragRow);
      this.dragRow = i;
    }
    if (p.y < this.listRect.y) this.scrollTo(this.scroll - 1);
    if (p.y > this.listRect.y + this.listRect.h) this.scrollTo(this.scroll + 1);
  }

  private thumbY(): number {
    const { h } = this.size();
    const track = h - 58 - 18;
    return 20 + (this.maxScroll ? Math.round((this.scroll / this.maxScroll) * track) : 0);
  }

  override key(e: KeyboardEvent): boolean {
    const pl = this.ui.playlist;
    const sel = pl.entries.findIndex((x) => x.selected);
    const move = (to: number) => {
      const i = Math.max(0, Math.min(pl.length - 1, to));
      if (e.shiftKey && this.anchor >= 0) {
        const [a, b] = [Math.min(this.anchor, i), Math.max(this.anchor, i)];
        pl.select((_, k) => k >= a && k <= b);
      } else this.selectOnly(i);
      this.ensureVisible(i);
    };
    switch (e.key) {
      case 'Delete':
        pl.removeSelected();
        return true;
      case 'Enter':
        if (sel >= 0) this.ui.playIndex(sel);
        return true;
      case 'ArrowDown':
        if (e.altKey) pl.moveSelected(1);
        else move(sel + 1);
        return true;
      case 'ArrowUp':
        if (e.altKey) pl.moveSelected(-1);
        else move(sel - 1);
        return true;
      case 'PageDown':
        move(sel + this.visibleRows);
        return true;
      case 'PageUp':
        move(sel - this.visibleRows);
        return true;
      case 'Home':
        move(0);
        return true;
      case 'End':
        move(pl.length - 1);
        return true;
      case 'a':
        if (e.ctrlKey) {
          pl.select(() => true);
          return true;
        }
        return false;
      case 'i':
        if (e.ctrlKey) {
          pl.select((x) => !x.selected);
          return true;
        }
        return false;
    }
    return false;
  }

  protected override onWheel(dy: number): void {
    this.scrollTo(this.scroll + Math.sign(dy) * 3);
  }

  private spr(sp: Sprite, x: number, y: number, w?: number, h?: number): void {
    this.surface.sprite(this.ui.skin, sp, x, y, w, h);
  }

  protected paint(): void {
    const ui = this.ui;
    const skin = ui.skin;
    const surf = this.surface;
    const { w, h } = this.size();
    const focused = ui.focusedWindow === 'pl';
    if (this.shaded) {
      this.spr(PL.shadeLeft, 0, 0);
      surf.tile(skin, PL.shadeFill, 25, 0, w - 75, 14);
      this.spr(focused ? PL.shadeRight : PL.shadeRightInactive, w - 50, 0);
      const cur = ui.playlist.currentEntry;
      if (cur) {
        const t = `${ui.playlist.current + 1}. ${displayTitle(cur)}`;
        const d = formatTime(cur.info?.durationSec ?? cur.durationSec);
        surf.text(skin, t, 5, 4, w - 75 - textWidth(d));
        surf.text(skin, d, w - 48 - textWidth(d) - 10, 4);
      }
      if (this.buttons.get('unshade')?.pressed) this.spr(PL.unshadeBtnDown, w - 20, 3);
      if (this.buttons.get('close')?.pressed) this.spr(PL.shadeCloseBtnDown, w - 11, 3);
      return;
    }
    // frame
    const [tl, title, fill, tr] = focused
      ? [PL.topLeft, PL.topTitle, PL.topFill, PL.topRight]
      : [PL.topLeftInactive, PL.topTitleInactive, PL.topFillInactive, PL.topRightInactive];
    surf.tile(skin, fill, 25, 0, w - 50, 20);
    this.spr(tl, 0, 0);
    this.spr(title, Math.round((w - 100) / 2), 0);
    this.spr(tr, w - 25, 0);
    surf.tile(skin, PL.left, 0, 20, 12, h - 58);
    surf.tile(skin, PL.right, w - 20, 20, 20, h - 58);
    surf.tile(skin, PL.bottomFill, 125, h - 38, w - 275, 38);
    this.spr(PL.bottomLeft, 0, h - 38);
    if (w - 150 - 75 >= 125) this.spr(PL.visExtra, w - 150 - 75, h - 38);
    this.spr(PL.bottomRight, w - 150, h - 38);
    if (this.buttons.get('shade')?.pressed) this.spr(PL.shadeBtnDown, w - 20, 3);
    if (this.buttons.get('close')?.pressed) this.spr(PL.closeBtnDown, w - 11, 3);

    // list
    const L = this.listRect;
    const col = skin.playlist;
    surf.fill(L.x, L.y, L.w, L.h, col.normalBg);
    const pl = ui.playlist;
    const digits = String(pl.length).length;
    for (let r = 0; r < this.visibleRows; r++) {
      const i = this.scroll + r;
      const e = pl.entries[i];
      if (!e) break;
      const y = L.y + r * ROW_H;
      const bg = e.selected ? col.selectedBg : col.normalBg;
      if (e.selected) surf.fill(L.x, y, L.w, ROW_H, bg);
      const fg = i === pl.current ? col.current : col.normal;
      const dur = formatTime(e.info?.durationSec ?? e.durationSec);
      const label = `${String(i + 1).padStart(digits, ' ')}. ${displayTitle(e)}`;
      this.drawText(dur, fg, bg, L.x + L.w - 2, y, 60, 'right');
      const durW = dur ? this.measure(dur, fg, bg) + 6 : 0;
      this.drawText(label, fg, bg, L.x + 2, y, L.w - 4 - durW, 'left');
    }
    // scrollbar thumb
    this.spr(this.scrollDrag ? PL.scrollThumbDown : PL.scrollThumb, w - 15, this.thumbY());

    // info text: selected / total time
    const total = pl.totalDuration();
    const selT = pl.totalDuration(true);
    const info = `${formatTime(selT.sec)}${selT.unknown ? '+' : ''}/${formatTime(total.sec)}${total.unknown ? '+' : ''}`;
    surf.text(skin, info, w - 143, h - 28, 90);
    // running time of the current track
    const st = ui.state;
    if (st.playState !== 'stopped') {
      const t =
        st.timeRemaining && st.duration
          ? `-${formatTime(st.duration - st.position)}`
          : formatTime(st.position);
      surf.text(skin, t.padStart(6, ' '), w - 84, h - 15, 30);
    }

    // open pop-up menu
    const m = this.openMenu;
    if (m) {
      const menu = PL_MENUS[m.name];
      this.spr(menu.bar, m.x - 3, m.y, 3, menu.items.length * 18);
      (menu.items as readonly PlMenuItem[]).forEach((it, k) =>
        this.spr(k === m.hover ? it.selected : it.normal, m.x, m.y + k * 18),
      );
    }
  }

  private measure(
    text: string,
    fg: readonly [number, number, number],
    bg: readonly [number, number, number],
  ): number {
    const img = this.cachedText(text, fg, bg, 400);
    return img ? img.width : textWidth(text);
  }

  private cachedText(
    text: string,
    fg: readonly [number, number, number],
    bg: readonly [number, number, number],
    maxW: number,
  ): RgbaImage | null {
    const key = `${text}|${fg}|${bg}|${maxW}`;
    if (this.textCache.has(key)) return this.textCache.get(key)!;
    const img = this.renderText(text, fg, bg, maxW, ROW_H, this.ui.skin.playlist.font);
    if (this.textCache.size > 2000) this.textCache.clear();
    this.textCache.set(key, img);
    return img;
  }

  private drawText(
    text: string,
    fg: readonly [number, number, number],
    bg: readonly [number, number, number],
    x: number,
    y: number,
    maxW: number,
    align: 'left' | 'right',
  ): void {
    if (!text || maxW <= 0) return;
    const img = this.cachedText(text, fg, bg, Math.max(1, Math.floor(maxW)));
    if (img) {
      const dx = align === 'right' ? x - img.width : x;
      this.surface.copy(img, 0, 0, Math.min(img.width, maxW), img.height, dx, y);
      return;
    }
    // Fallback: the skin's bitmap font (used in tests and if canvas text is unavailable).
    const wpx = Math.min(textWidth(text), maxW);
    this.surface.text(this.ui.skin, text, align === 'right' ? x - wpx : x, y + 4, maxW);
  }

  /** Clears cached text images (after a skin change). */
  clearTextCache(): void {
    this.textCache.clear();
  }
}
