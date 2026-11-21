/** The 275x116 main window (and its 275x14 shade mode). */
import { formatTime } from '../playlist/model';
import { textWidth } from '../skin/surface';
import {
  MAIN,
  MAIN_POS as P,
  SHADE_POS as SP,
  balanceFrame,
  digit,
  digitBlank,
  minusEx,
  minusLine,
  volumeFrame,
  type Sprite,
} from '../skin/sprites';
import { Area, Button, HSlider, type Control } from './controls';
import type { UiContext } from './context';
import { SkinnedWindow } from './window';

const CLUTTER = [
  { id: 'cO', top: 3, h: 8, down: MAIN.clutterOptionsDown },
  { id: 'cA', top: 11, h: 8, down: MAIN.clutterAlwaysOnTopDown },
  { id: 'cI', top: 19, h: 7, down: MAIN.clutterInfoDown },
  { id: 'cD', top: 26, h: 8, down: MAIN.clutterDoubleDown },
  { id: 'cV', top: 34, h: 7, down: MAIN.clutterVisDown },
] as const;

export class MainWindow extends SkinnedWindow {
  readonly id = 'main' as const;
  private buttons = new Map<string, Button>();
  private sliders = new Map<string, HSlider>();
  private seekPreview: number | null = null;

  constructor(private readonly ui: UiContext) {
    super();
  }

  get shaded(): boolean {
    return this.ui.state.shade.main;
  }

  size() {
    return { w: 275, h: this.shaded ? 14 : 116 };
  }

  override region() {
    const r = this.ui.skin.regions;
    return this.shaded ? r.windowshade : r.normal;
  }

  override animating(): boolean {
    const s = this.ui.state;
    return s.playState !== 'stopped' || this.ui.vis.active || !!s.flash || textWidth(this.titleText()) > 154;
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
  ): Button {
    const b = new Button(id, x, y, w, h, fn, tip, cursor);
    this.buttons.set(id, b);
    return b;
  }

  private menuAt(kind: Parameters<UiContext['showMenu']>[0]) {
    return (_p: unknown, e: PointerEvent | MouseEvent) => this.ui.showMenu(kind, e.clientX, e.clientY);
  }

  protected build(): void {
    const ui = this.ui;
    this.buttons.clear();
    this.sliders.clear();
    const c: Control[] = [];
    const drag = new Area(
      'drag',
      0,
      0,
      275,
      this.shaded ? 14 : 116,
      {
        down: (_p, e) => this.host?.beginMove(e as PointerEvent),
        dblclick: (p) => p.y < 14 && ui.toggleShade('main'),
        contextmenu: (_p, e) => ui.showMenu('main', e.clientX, e.clientY),
      },
      'titlebar',
    );
    c.push(drag);
    const optBtn = new Area('options', 6, 3, 9, 9, { down: this.menuAt('main') }, 'mainmenu', 'Main menu');
    if (this.shaded) {
      c.push(
        optBtn,
        this.btn('minimize', ...SP.minimize, 9, 9, () => ui.minimize(), 'Minimize', 'min'),
        this.btn('unshade', ...SP.unshade, 9, 9, () => ui.toggleShade('main'), 'Normal mode', 'winbut'),
        this.btn('close', ...SP.close, 9, 9, () => ui.closeWindow('main'), 'Close', 'close'),
        this.btn('sPrev', ...SP.prev, () => ui.prev(), 'Previous'),
        this.btn('sPlay', ...SP.play, () => ui.play(), 'Play'),
        this.btn('sPause', ...SP.pause, () => ui.pause(), 'Pause'),
        this.btn('sStop', ...SP.stop, () => ui.stop(), 'Stop'),
        this.btn('sNext', ...SP.next, () => ui.next(), 'Next'),
        this.btn('sEject', ...SP.eject, () => ui.eject(), 'Open file'),
        new Area('sTime', 127, 4, 30, 6, { down: () => ui.toggleTimeMode() }),
        this.posSlider(226, 4, 17, 7, 3),
      );
      this.controls = c;
      return;
    }
    c.push(
      optBtn,
      this.btn('minimize', ...P.minimize, 9, 9, () => ui.minimize(), 'Minimize', 'min'),
      this.btn('shade', ...P.shade, 9, 9, () => ui.toggleShade('main'), 'Shade mode', 'winbut'),
      this.btn('close', ...P.close, 9, 9, () => ui.closeWindow('main'), 'Close', 'close'),
    );
    const [cx, cy] = P.clutter;
    const clutterFns: Record<string, (e: PointerEvent | MouseEvent) => void> = {
      cO: (e) => ui.showMenu('options', e.clientX, e.clientY),
      cA: () => ui.toggleAlwaysOnTop(),
      cI: () => ui.fileInfo(),
      cD: () => ui.toggleDoubleSize(),
      cV: (e) => ui.showMenu('vis', e.clientX, e.clientY),
    };
    const tips: Record<string, string> = {
      cO: 'Options menu',
      cA: 'Always on top',
      cI: 'File info',
      cD: 'Double size',
      cV: 'Visualization menu',
    };
    for (const k of CLUTTER) {
      const b = this.btn(k.id, cx, cy + k.top, 8, k.h, () => {}, tips[k.id]);
      b.onClick = () => clutterFns[k.id]!(lastPointer);
      c.push(b);
    }
    c.push(
      new Area('time', 36, 26, 63, 13, { down: () => ui.toggleTimeMode() }, undefined, 'Elapsed / remaining'),
      new Area('vis', ...P.vis, {
        down: () => ui.cycleVisMode(),
        contextmenu: (_p, e) => ui.showMenu('vis', e.clientX, e.clientY),
      }),
      new Area('title', 111, 24, 154, 12, { dblclick: () => ui.fileInfo() }, 'songname'),
    );
    const vol = new HSlider(
      'volume',
      ...P.volume,
      68,
      13,
      14,
      () => ui.state.volume,
      (v) => {
        ui.setVolume(v);
        ui.flash(`VOLUME: ${Math.round(v * 100)}%`);
      },
      undefined,
      'volbal',
    );
    const bal = new HSlider(
      'balance',
      ...P.balance,
      38,
      13,
      14,
      () => (ui.state.balance + 1) / 2,
      (v) => {
        const b = v * 2 - 1;
        ui.setBalance(b);
        ui.flash(
          Math.abs(b) < 0.01
            ? 'BALANCE: CENTER'
            : `BALANCE: ${Math.round(Math.abs(b) * 100)}% ${b < 0 ? 'LEFT' : 'RIGHT'}`,
        );
      },
      undefined,
      'volbal',
      (v) => (Math.abs(v - 0.5) < 0.08 ? 0.5 : v),
    );
    this.sliders.set('volume', vol).set('balance', bal);
    c.push(
      vol,
      bal,
      this.btn('eqBtn', ...P.eqBtn, 23, 12, () => ui.toggleWindow('eq'), 'Equalizer'),
      this.btn('plBtn', ...P.plBtn, 23, 12, () => ui.toggleWindow('pl'), 'Playlist editor'),
      this.posSlider(...P.pos, 248, 10, 29),
      this.btn('prev', ...P.prev, 23, 18, () => ui.prev(), 'Previous track'),
      this.btn('play', ...P.play, 23, 18, () => ui.play(), 'Play'),
      this.btn('pause', ...P.pause, 23, 18, () => ui.pause(), 'Pause'),
      this.btn('stop', ...P.stop, 23, 18, () => ui.stop(), 'Stop'),
      this.btn('next', ...P.next, 22, 18, () => ui.next(), 'Next track'),
      this.btn('eject', ...P.eject, 22, 16, () => ui.eject(), 'Open file(s)'),
      this.btn('shuffle', ...P.shuffle, 47, 15, () => ui.toggleShuffle(), 'Shuffle'),
      this.btn('repeat', ...P.repeat, 28, 15, () => ui.toggleRepeat(), 'Repeat'),
    );
    this.controls = c;
  }

  private posSlider(x: number, y: number, w: number, h: number, thumb: number): HSlider {
    const ui = this.ui;
    const s = new HSlider(
      'pos',
      x,
      y,
      w,
      h,
      thumb,
      () => (this.seekPreview ?? ui.state.position) / Math.max(1e-9, ui.state.duration),
      (v) => {
        if (!ui.state.duration) return;
        this.seekPreview = v * ui.state.duration;
        ui.setSeekPreview(this.seekPreview);
        ui.flash(
          `SEEK TO: ${formatTime(this.seekPreview)}/${formatTime(ui.state.duration)} (${Math.round(v * 100)}%)`,
        );
      },
      (v) => {
        if (ui.state.duration) ui.seek(v * ui.state.duration);
        this.seekPreview = null;
        ui.setSeekPreview(null);
      },
      'posbar',
    );
    this.sliders.set('pos', s);
    return s;
  }

  private titleText(): string {
    const s = this.ui.state;
    return s.title;
  }

  private pressed(id: string): boolean {
    return this.buttons.get(id)?.pressed ?? false;
  }

  private spr(sp: Sprite, x: number, y: number): void {
    this.surface.sprite(this.ui.skin, sp, x, y);
  }

  protected paint(): void {
    const s = this.ui.state;
    const skin = this.ui.skin;
    const focused = this.ui.focusedWindow === 'main';
    const surf = this.surface;
    if (this.shaded) {
      this.spr(focused ? MAIN.shadeActive : MAIN.shadeInactive, 0, 0);
      this.spr(MAIN.optionsBtn, ...SP.options);
      this.spr(this.pressed('minimize') ? MAIN.minimizeBtnDown : MAIN.minimizeBtn, ...SP.minimize);
      this.spr(this.pressed('unshade') ? MAIN.unshadeBtnDown : MAIN.unshadeBtn, ...SP.unshade);
      this.spr(this.pressed('close') ? MAIN.closeBtnDown : MAIN.closeBtn, ...SP.close);
      // mini time
      if (s.playState !== 'stopped' && !(s.playState === 'paused' && Math.floor(s.clock * 2) % 2)) {
        const t = this.displayTime();
        const str = `${t.neg ? '-' : ' '}${String(t.m).padStart(2, '0')}:${String(t.s).padStart(2, '0')}`;
        surf.text(skin, str, 127, 4, 30);
      }
      // mini vis
      this.ui.vis.draw(surf, skin, SP.vis[0], SP.vis[1], SP.vis[2], SP.vis[3]);
      // mini position bar
      const pos = this.sliders.get('pos')!;
      this.spr(MAIN.shadePosBg, ...SP.pos);
      if (s.duration > 0) {
        const tx = SP.pos[0] + pos.thumbX();
        const v = pos.get();
        this.spr(
          v < 0.33 ? MAIN.shadePosThumbLeft : v > 0.66 ? MAIN.shadePosThumbRight : MAIN.shadePosThumb,
          tx,
          SP.pos[1],
        );
      }
      return;
    }

    this.spr(MAIN.background, 0, 0);
    this.spr(focused ? MAIN.titleActive : MAIN.titleInactive, 0, 0);
    this.spr(MAIN.optionsBtn, ...P.options);
    this.spr(this.pressed('minimize') ? MAIN.minimizeBtnDown : MAIN.minimizeBtn, ...P.minimize);
    this.spr(this.pressed('shade') ? MAIN.shadeBtnDown : MAIN.shadeBtn, ...P.shade);
    this.spr(this.pressed('close') ? MAIN.closeBtnDown : MAIN.closeBtn, ...P.close);

    // clutter bar
    const [cx, cy] = P.clutter;
    this.spr(MAIN.clutterBar, cx, cy);
    for (const k of CLUTTER) {
      const on = (k.id === 'cA' && s.alwaysOnTop) || (k.id === 'cD' && s.doubleSize) || this.pressed(k.id);
      if (on) this.spr(k.down, cx, cy + k.top);
    }

    // play status
    if (s.playState === 'playing') {
      this.spr(MAIN.statusWorking, ...P.working);
      this.spr(MAIN.statusPlay, ...P.status);
    } else if (s.playState === 'paused') this.spr(MAIN.statusPause, ...P.status);
    else this.spr(MAIN.statusStop, ...P.status);

    // time display
    const blinkOff = s.playState === 'paused' && Math.floor(s.clock * 2) % 2 === 1;
    if (s.playState !== 'stopped' && !blinkOff) {
      const ex = skin.hasNumsEx;
      const t = this.displayTime();
      if (t.neg) {
        if (ex) this.spr(minusEx, ...P.minus);
        else this.spr(minusLine, P.minus[0] + 3, P.minus[1] + 6);
      }
      const digits = [Math.floor(t.m / 10) % 10, t.m % 10, Math.floor(t.s / 10), t.s % 10];
      digits.forEach((d, i) => this.spr(digit(d, ex), P.digits[i]![0], P.digits[i]![1]));
    } else if (s.playState !== 'stopped') {
      P.digits.forEach(([x, y]) => this.spr(digitBlank(skin.hasNumsEx), x, y));
    }

    // visualisation
    this.ui.vis.draw(surf, skin, ...P.vis);

    // song title (scrolls when too long)
    const [tx, ty, tw] = P.title;
    surf.text(skin, ' '.repeat(Math.ceil(tw / 5) + 1), tx, ty, tw);
    if (s.flash) surf.text(skin, s.flash, tx, ty, tw);
    else {
      const title = this.titleText();
      const width = textWidth(title);
      if (width <= tw) surf.text(skin, title, tx, ty, tw);
      else {
        const loop = `${title}  ***  `;
        const lw = textWidth(loop);
        const off = Math.floor(s.clock * 25) % lw;
        surf.text(skin, loop + loop, tx, ty, tw, off);
      }
    }

    // bitrate / sample rate
    if (s.playState !== 'stopped') {
      const kb =
        s.kbps > 999
          ? String(Math.round(s.kbps / 100)).padStart(2, ' ') + 'H'
          : String(Math.round(s.kbps) || '').padStart(3, ' ');
      surf.text(skin, kb, ...P.kbps, 15);
      surf.text(skin, String(Math.round(s.khz) || '').padStart(2, ' '), ...P.khz, 10);
    }
    this.spr(s.playState !== 'stopped' && s.channels === 1 ? MAIN.mono : MAIN.monoOff, ...P.mono);
    this.spr(s.playState !== 'stopped' && s.channels >= 2 ? MAIN.stereo : MAIN.stereoOff, ...P.stereo);

    // volume & balance
    const vol = this.sliders.get('volume')!;
    this.spr(volumeFrame(Math.round(s.volume * 27)), ...P.volume);
    this.spr(
      vol.dragging ? MAIN.volumeThumbDown : MAIN.volumeThumb,
      P.volume[0] + vol.thumbX(),
      P.volume[1] + 1,
    );
    const bal = this.sliders.get('balance')!;
    this.spr(balanceFrame(Math.round(Math.abs(s.balance) * 27)), ...P.balance);
    this.spr(
      bal.dragging ? MAIN.balanceThumbDown : MAIN.balanceThumb,
      P.balance[0] + bal.thumbX(),
      P.balance[1] + 1,
    );

    // EQ / PL toggles
    const tog = (
      id: string,
      on: boolean,
      n: Sprite,
      nd: Sprite,
      o: Sprite,
      od: Sprite,
      at: readonly [number, number],
    ) => this.spr(on ? (this.pressed(id) ? od : o) : this.pressed(id) ? nd : n, ...at);
    tog('eqBtn', s.eqVisible, MAIN.eqBtn, MAIN.eqBtnDown, MAIN.eqBtnOn, MAIN.eqBtnOnDown, P.eqBtn);
    tog('plBtn', s.plVisible, MAIN.plBtn, MAIN.plBtnDown, MAIN.plBtnOn, MAIN.plBtnOnDown, P.plBtn);

    // position bar
    this.spr(MAIN.posBg, ...P.pos);
    if (s.duration > 0) {
      const pos = this.sliders.get('pos')!;
      this.spr(pos.dragging ? MAIN.posThumbDown : MAIN.posThumb, P.pos[0] + pos.thumbX(), P.pos[1]);
    }

    // transport
    for (const k of ['prev', 'play', 'pause', 'stop', 'next', 'eject'] as const) {
      const [px, py] = P[k];
      this.spr(this.pressed(k) ? MAIN[`${k}Down`] : MAIN[k], px, py);
    }
    tog('shuffle', s.shuffle, MAIN.shuffle, MAIN.shuffleDown, MAIN.shuffleOn, MAIN.shuffleOnDown, P.shuffle);
    tog('repeat', s.repeat, MAIN.repeat, MAIN.repeatDown, MAIN.repeatOn, MAIN.repeatOnDown, P.repeat);
  }

  private displayTime(): { m: number; s: number; neg: boolean } {
    const st = this.ui.state;
    const pos = this.seekPreview ?? st.position;
    const neg = st.timeRemaining && st.duration > 0;
    const t = Math.max(0, Math.floor(neg ? st.duration - pos : pos));
    return { m: Math.min(99, Math.floor(t / 60)), s: t % 60, neg };
  }

  protected override onWheel(dy: number): void {
    const v = Math.max(0, Math.min(1, this.ui.state.volume - Math.sign(dy) * 0.04));
    this.ui.setVolume(v);
    this.ui.flash(`VOLUME: ${Math.round(v * 100)}%`);
  }
}

/** Last pointer event, used for menus opened from buttons (they open where the user clicked). */
export let lastPointer: PointerEvent | MouseEvent =
  typeof MouseEvent !== 'undefined'
    ? new MouseEvent('pointerdown')
    : ({ clientX: 0, clientY: 0 } as MouseEvent);
if (typeof window !== 'undefined') window.addEventListener('pointerdown', (e) => (lastPointer = e), true);
