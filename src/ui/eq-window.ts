/** The equalizer window (275x116, shade 275x14). */
import { EQ, EQ_POS, eqSliderFrame, type Sprite } from '../skin/sprites';
import { getPixel } from '../skin/image';
import { Area, Button, HSlider, VSlider, type Control } from './controls';
import type { UiContext } from './context';
import { SkinnedWindow } from './window';

/** Slider position (0 = top) <-> dB. Values within 0.5 dB of zero snap to zero. */
export const posToDb = (v: number) => {
  const db = 12 - v * 24;
  return Math.abs(db) < 0.5 ? 0 : Math.round(db * 10) / 10;
};
export const dbToPos = (db: number) => (12 - db) / 24;

export class EqWindow extends SkinnedWindow {
  readonly id = 'eq' as const;
  private buttons = new Map<string, Button>();
  private vsliders: VSlider[] = [];
  private hsliders = new Map<string, HSlider>();

  constructor(private readonly ui: UiContext) {
    super();
  }

  get shaded(): boolean {
    return this.ui.state.shade.eq;
  }

  size() {
    return { w: 275, h: this.shaded ? 14 : 116 };
  }

  override region() {
    const r = this.ui.skin.regions;
    return this.shaded ? r.equalizerws : r.equalizer;
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
    this.buttons.clear();
    this.vsliders = [];
    this.hsliders.clear();
    const c: Control[] = [
      new Area(
        'drag',
        0,
        0,
        275,
        this.shaded ? 14 : 116,
        {
          down: (_p, e) => this.host?.beginMove(e as PointerEvent),
          dblclick: (p) => p.y < 14 && ui.toggleShade('eq'),
          contextmenu: (_p, e) => ui.showMenu('eqPresets', e.clientX, e.clientY),
        },
        'eqtitle',
      ),
    ];
    if (this.shaded) {
      c.push(
        this.btn('unshade', 254, 3, 9, 9, () => ui.toggleShade('eq'), 'Normal mode', 'winbut'),
        this.btn('close', 264, 3, 9, 9, () => ui.closeWindow('eq'), 'Close', 'eqclose'),
      );
      const vol = new HSlider(
        'svol',
        61,
        4,
        97,
        7,
        3,
        () => ui.state.volume,
        (v) => ui.setVolume(v),
      );
      const bal = new HSlider(
        'sbal',
        164,
        4,
        43,
        7,
        3,
        () => (ui.state.balance + 1) / 2,
        (v) => ui.setBalance(v * 2 - 1),
        undefined,
        undefined,
        (v) => (Math.abs(v - 0.5) < 0.1 ? 0.5 : v),
      );
      this.hsliders.set('svol', vol).set('sbal', bal);
      c.push(vol, bal);
      this.controls = c;
      return;
    }
    c.push(
      this.btn('shade', ...EQ_POS.shade, 9, 9, () => ui.toggleShade('eq'), 'Shade mode', 'winbut'),
      this.btn('close', ...EQ_POS.close, 9, 9, () => ui.closeWindow('eq'), 'Close', 'eqclose'),
      this.btn(
        'on',
        ...EQ_POS.on,
        26,
        12,
        () => ui.setEq({ ...ui.state.eq, enabled: !ui.state.eq.enabled }),
        'Equalizer on/off',
      ),
      this.btn(
        'auto',
        ...EQ_POS.auto,
        32,
        12,
        () => ui.setEq({ ...ui.state.eq, auto: !ui.state.eq.auto }),
        'Load presets automatically',
      ),
      new Area(
        'presets',
        ...EQ_POS.presets,
        44,
        12,
        { down: (_p, e) => ui.showMenu('eqPresets', e.clientX, e.clientY) },
        undefined,
        'Presets',
      ),
    );
    const mk = (id: string, x: number, get: () => number, set: (db: number) => void) => {
      const s = new VSlider(
        id,
        x,
        EQ_POS.preamp[1],
        14,
        EQ_POS.sliderH,
        11,
        EQ_POS.thumbTravel,
        () => dbToPos(get()),
        (v) => {
          set(posToDb(v));
          ui.flash(
            `${id === 'preamp' ? 'PREAMP' : 'EQ'}: ${posToDb(v) > 0 ? '+' : ''}${posToDb(v).toFixed(1)} DB`,
          );
        },
      );
      this.vsliders.push(s);
      return s;
    };
    c.push(
      mk(
        'preamp',
        EQ_POS.preamp[0],
        () => ui.state.eq.preampDb,
        (db) => ui.setEq({ ...ui.state.eq, preampDb: db }),
      ),
    );
    EQ_POS.bands.forEach(([x], i) => {
      c.push(
        mk(
          `band${i}`,
          x,
          () => ui.state.eq.bandsDb[i] ?? 0,
          (db) => {
            const bands = [...ui.state.eq.bandsDb];
            bands[i] = db;
            ui.setEq({ ...ui.state.eq, bandsDb: bands });
          },
        ),
      );
    });
    this.controls = c;
  }

  private spr(sp: Sprite, x: number, y: number): void {
    this.surface.sprite(this.ui.skin, sp, x, y);
  }

  private pressed(id: string): boolean {
    return this.buttons.get(id)?.pressed ?? false;
  }

  protected paint(): void {
    const ui = this.ui;
    const eq = ui.state.eq;
    const focused = ui.focusedWindow === 'eq';
    if (this.shaded) {
      this.spr(focused ? EQ.shadeActive : EQ.shadeInactive, 0, 0);
      if (this.pressed('unshade')) this.spr(EQ.unshadeBtnDown, 254, 3);
      if (this.pressed('close')) this.spr(EQ.shadeCloseBtnDown, 264, 3);
      const vol = this.hsliders.get('svol')!,
        bal = this.hsliders.get('sbal')!;
      this.spr(EQ.shadeVolumeThumb, 61 + vol.thumbX(), 4);
      this.spr(EQ.shadeBalanceThumb, 164 + bal.thumbX(), 4);
      return;
    }
    this.spr(EQ.background, 0, 0);
    this.spr(focused ? EQ.titleActive : EQ.titleInactive, 0, 0);
    if (this.pressed('close')) this.spr(EQ.closeBtnDown, ...EQ_POS.close);
    if (this.pressed('shade')) this.spr(EQ.shadeBtnDown, ...EQ_POS.shade);
    const onSp = eq.enabled
      ? this.pressed('on')
        ? EQ.onBtnOnDown
        : EQ.onBtnOn
      : this.pressed('on')
        ? EQ.onBtnDown
        : EQ.onBtn;
    const autoSp = eq.auto
      ? this.pressed('auto')
        ? EQ.autoBtnOnDown
        : EQ.autoBtnOn
      : this.pressed('auto')
        ? EQ.autoBtnDown
        : EQ.autoBtn;
    this.spr(onSp, ...EQ_POS.on);
    this.spr(autoSp, ...EQ_POS.auto);
    this.spr(EQ.presetsBtn, ...EQ_POS.presets);
    this.paintGraph();
    for (const s of this.vsliders) {
      const v = s.get();
      this.spr(eqSliderFrame(Math.round(v * 27)), s.x, s.y);
      this.spr(s.dragging ? EQ.sliderThumbDown : EQ.sliderThumb, s.x + 1, s.y + s.thumbY());
    }
  }

  /** The response curve: a smooth line through the 10 band values, coloured by height. */
  private paintGraph(): void {
    const [gx, gy] = EQ_POS.graph;
    const skin = this.ui.skin;
    const eq = this.ui.state.eq;
    this.spr(EQ.graphBg, gx, gy);
    const preY = Math.round(((12 - eq.preampDb) / 24) * 18);
    this.spr(EQ.preampLine, gx, gy + preY);
    const pts = eq.bandsDb.map((db) => ((12 - db) / 24) * 18);
    const W = 113;
    const colors = skin.sheets[EQ.graphColors.sheet];
    let prev = -1;
    for (let x = 0; x < W; x++) {
      const t = (x / (W - 1)) * 9;
      const i = Math.min(8, Math.floor(t));
      const f = t - i;
      const p0 = pts[Math.max(0, i - 1)]!,
        p1 = pts[i]!,
        p2 = pts[i + 1]!,
        p3 = pts[Math.min(9, i + 2)]!;
      // Catmull-Rom spline
      const y =
        0.5 *
        (2 * p1 +
          (-p0 + p2) * f +
          (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f +
          (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
      const yy = Math.max(0, Math.min(18, Math.round(y)));
      const a = prev < 0 ? yy : Math.min(prev, yy),
        b = prev < 0 ? yy : Math.max(prev, yy);
      for (let k = a; k <= b; k++) {
        const [r, g, bl] = getPixel(colors, EQ.graphColors.x, EQ.graphColors.y + k);
        this.surface.pixel(gx + x, gy + k, [r, g, bl]);
      }
      prev = yy;
    }
  }
}
