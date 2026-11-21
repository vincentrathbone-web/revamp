/**
 * Every button on every skin: loads each classic skin in test-assets/skins (and its corpus/ folder), then clicks
 * every control of the main, EQ and playlist windows (normal and shade mode) and checks that
 *  - the click reaches the control (not covered by another one, not cut away by the skin's region.txt),
 *  - it sends the right command (play, stop, menus, minimize, shade, close, ...),
 *  - sliders move both ways and their thumb is redrawn,
 *  - the playlist's bottom menus open and run an item.
 * Pressed-looking art is checked too, but a skin may draw a button the same pressed and released, so that is only
 * counted in the report (test-assets/skin-button-report.json), not failed.
 * Third-party skins are never committed; without them this suite skips.
 */
import { afterAll, describe, expect, test } from 'vitest';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultSkin } from '../../src/skin/default-skin';
import { SHEET_SIZES, skinFromArchive, type Skin } from '../../src/skin/skin';
import type { Surface } from '../../src/skin/surface';
import { Button, HSlider, VSlider, type Control } from '../../src/ui/controls';
import { EqWindow } from '../../src/ui/eq-window';
import { MainWindow } from '../../src/ui/main-window';
import { PlaylistWindow } from '../../src/ui/playlist-window';
import type { SkinnedWindow, WindowId } from '../../src/ui/window';
import { fakeUi } from './fake-ui';

const ROOT = join(__dirname, '..', '..', 'test-assets', 'skins');
const files: string[] = [];
for (const dir of [ROOT, join(ROOT, 'corpus')])
  if (existsSync(dir))
    for (const f of readdirSync(dir)) if (/\.(wsz|zip)$/i.test(f)) files.push(join(dir, f));
const LIMIT = Number(process.env['SKIN_LIMIT'] ?? 0);
const allSkins = LIMIT ? files.slice(0, LIMIT) : files;

/** What each control must do when clicked: a call the fake app records (prefix match), or a special check. */
const EXPECT: Record<WindowId, Record<string, string>> = {
  main: {
    options: 'showMenu("main"',
    minimize: 'minimize()',
    shade: 'toggleShade("main")',
    unshade: 'toggleShade("main")',
    close: 'closeWindow("main")',
    cO: 'showMenu("options"',
    cA: 'toggleAlwaysOnTop()',
    cI: 'fileInfo()',
    cD: 'toggleDoubleSize()',
    cV: 'showMenu("vis"',
    time: 'toggleTimeMode()',
    sTime: 'toggleTimeMode()',
    vis: 'cycleVisMode()',
    title: 'dblclick:fileInfo()',
    eqBtn: 'toggleWindow("eq")',
    plBtn: 'toggleWindow("pl")',
    prev: 'prev()',
    play: 'play()',
    pause: 'pause()',
    stop: 'stop()',
    next: 'next()',
    eject: 'eject()',
    sPrev: 'prev()',
    sPlay: 'play()',
    sPause: 'pause()',
    sStop: 'stop()',
    sNext: 'next()',
    sEject: 'eject()',
    shuffle: 'toggleShuffle()',
    repeat: 'toggleRepeat()',
    volume: 'slider:setVolume',
    balance: 'slider:setBalance',
    pos: 'slider:seek(',
  },
  eq: {
    shade: 'toggleShade("eq")',
    unshade: 'toggleShade("eq")',
    close: 'closeWindow("eq")',
    on: 'setEq',
    auto: 'setEq',
    presets: 'showMenu("eqPresets"',
    preamp: 'slider:setEq',
    svol: 'slider:setVolume',
    sbal: 'slider:setBalance',
    ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`band${i}`, 'slider:setEq'])),
  },
  pl: {
    shade: 'toggleShade("pl")',
    unshade: 'toggleShade("pl")',
    close: 'closeWindow("pl")',
    add: 'menu',
    rem: 'menu',
    sel: 'menu',
    misc: 'menu',
    list: 'menu',
    mPrev: 'prev()',
    mPlay: 'play()',
    mPause: 'pause()',
    mStop: 'stop()',
    mNext: 'next()',
    mEject: 'eject()',
    resize: 'skip', // needs the window host (screen coordinates); covered by host tests
  },
};
/** Hot spots the classic format gives no pressed art (shade-mode and playlist mini transport). */
const NO_PRESS_ART = new Set([
  'sPrev',
  'sPlay',
  'sPause',
  'sStop',
  'sNext',
  'sEject',
  'mPrev',
  'mPlay',
  'mPause',
  'mStop',
  'mNext',
  'mEject',
]);
/** Areas that only drag or scroll the window/list (covered by other tests). */
const PASSIVE = new Set(['drag', 'list', 'scroll', 'tracks']);

const pe = (button = 0) =>
  ({ button, clientX: 10, clientY: 10, screenX: 10, screenY: 10, pointerId: 1 }) as unknown as PointerEvent;

function snapshot(s: Surface): Uint8ClampedArray | Uint8Array {
  return s.data.slice();
}
function differs(
  a: ArrayLike<number>,
  s: Surface,
  c: { x: number; y: number; w: number; h: number },
): boolean {
  for (let y = Math.max(0, c.y); y < Math.min(s.height, c.y + c.h); y++)
    for (let x = Math.max(0, c.x); x < Math.min(s.width, c.x + c.w); x++) {
      const i = (y * s.width + x) * 4;
      if (a[i] !== s.data[i] || a[i + 1] !== s.data[i + 1] || a[i + 2] !== s.data[i + 2]) return true;
    }
  return false;
}

interface Report {
  skins: number;
  loadFailures: Record<string, string>;
  problems: Record<string, string[]>;
  noPressArt: Record<string, number>;
  /** Changes the drawing code makes but the skin art hides (knob drawn like its track, blank menus). */
  invisibleArt: Record<string, number>;
  warnings: Record<string, number>;
}
const report: Report = {
  skins: 0,
  loadFailures: {},
  problems: {},
  noPressArt: {},
  invisibleArt: {},
  warnings: {},
};

function makeWindows(skin: Skin, shade: boolean) {
  const f = fakeUi(skin, { shade: { main: shade, eq: shade, pl: shade } });
  const menuActions: string[] = [];
  const wins: Record<WindowId, SkinnedWindow> = {
    main: new MainWindow(f.ui),
    eq: new EqWindow(f.ui),
    pl: new PlaylistWindow(
      f.ui,
      () => null,
      (id) => menuActions.push(id),
    ),
  };
  return { ...f, wins, menuActions };
}

const count = (o: Record<string, number>, k: string) => (o[k] = (o[k] ?? 0) + 1);

/** The same skin with every picture replaced by opaque noise (same sizes), to test the drawing code itself. */
function noisy(skin: Skin): Skin {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) & 255;
  const sheets = Object.fromEntries(
    Object.entries(skin.sheets).map(([k, img]) => {
      const data = new Uint8ClampedArray(img.data.length);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = rnd();
        data[i + 1] = rnd();
        data[i + 2] = rnd();
        data[i + 3] = 255;
      }
      return [k, { ...img, data }];
    }),
  ) as Skin['sheets'];
  return { ...skin, sheets };
}

/** Drags a slider from one end to the other: is the window redrawn differently there? */
function sliderRedraws(skin: Skin, id: WindowId, shade: boolean, cid: string): boolean {
  const win = makeWindows(skin, shade).wins[id];
  win.render(true);
  const c = win.controls.find((k) => k.id === cid)!;
  const vertical = c instanceof VSlider;
  const mid = { x: c.x + Math.floor(c.w / 2), y: c.y + Math.floor(c.h / 2) };
  const drag = (p: { x: number; y: number }) => {
    win.pointerDown(p, pe());
    win.pointerMove(p);
    win.pointerUp(p);
    win.render(true);
  };
  drag(vertical ? { x: mid.x, y: c.y } : { x: c.x, y: mid.y });
  const img = snapshot(win.surface);
  drag(vertical ? { x: mid.x, y: c.y + c.h - 1 } : { x: c.x + c.w - 1, y: mid.y });
  return differs(img, win.surface, c);
}

/** Opens a playlist bottom menu: does anything new appear? */
function menuDraws(skin: Skin, shade: boolean, cid: string): boolean {
  const win = makeWindows(skin, shade).wins.pl;
  win.render(true);
  const c = win.controls.find((k) => k.id === cid)!;
  const before = snapshot(win.surface);
  win.pointerDown({ x: c.x + 5, y: c.y + 5 }, pe());
  win.render(true);
  return differs(before, win.surface, { x: 0, y: 0, w: win.surface.width, h: win.surface.height });
}

/** Clicks every control of one window and returns the problems found. */
function checkWindow(skin: Skin, id: WindowId, shade: boolean, strict: boolean): string[] {
  const problems: string[] = [];
  const where = `${id}${shade ? ' (shade)' : ''}`;
  const probe = makeWindows(skin, shade).wins[id];
  probe.render(true);
  const ids = probe.controls.map((c) => c.id).filter((c) => !PASSIVE.has(c));
  for (const cid of ids) {
    // a fresh app and window per control, so one click can't change what the next one sees
    const { wins, calls, menuActions } = makeWindows(skin, shade);
    const win = wins[id];
    win.render(true);
    const c = win.controls.find((k) => k.id === cid) as Control;
    const want = EXPECT[id][cid];
    if (!want) {
      problems.push(`${where} ${cid}: no expectation in the test (new control?)`);
      continue;
    }
    if (want === 'skip') continue;
    const p = { x: c.x + Math.floor(c.w / 2), y: c.y + Math.floor(c.h / 2) };
    if (win.controlAt(p) !== c) {
      problems.push(`${where} ${cid}: covered by ${win.controlAt(p)?.id}`);
      continue;
    }
    if (!win.inside(p.x, p.y))
      problems.push(`${where} ${cid}: cut away by the skin's region (click goes through)`);

    if (want.startsWith('slider:')) {
      const name = want.slice(7);
      const s = c as HSlider | VSlider;
      const lo = s instanceof VSlider ? { x: p.x, y: c.y } : { x: c.x, y: p.y };
      const hi = s instanceof VSlider ? { x: p.x, y: c.y + c.h - 1 } : { x: c.x + c.w - 1, y: p.y };
      win.pointerDown(lo, pe());
      win.pointerMove(lo);
      win.pointerUp(lo);
      win.render(true);
      const atLo = s.get();
      const img = snapshot(win.surface);
      win.pointerDown(hi, pe());
      win.pointerMove(hi);
      win.pointerUp(hi);
      win.render(true);
      const atHi = s.get();
      if (!calls.some((k) => k.startsWith(name)))
        problems.push(`${where} ${cid}: dragging didn't call ${name}`);
      if (cid === 'pos') {
        const seeks = calls.filter((k) => k.startsWith('seek(')).map((k) => Number(k.slice(5, -1)));
        if (!(seeks.length >= 2 && seeks[0]! < 5 && seeks.at(-1)! > 190))
          problems.push(`${where} pos: seek went to ${seeks.join(', ')}`);
      } else if (!(Math.abs(atHi - atLo) > 0.9))
        problems.push(`${where} ${cid}: slider only moved from ${atLo.toFixed(2)} to ${atHi.toFixed(2)}`);
      if (!differs(img, win.surface, c)) {
        // Some skins draw the knob exactly like its track. Tell that apart from a drawing bug: with the skin's
        // pictures replaced by noise, a working slider must show a change.
        if (sliderRedraws(noisy(skin), id, shade, cid)) count(report.invisibleArt, `${where} ${cid}`);
        else problems.push(`${where} ${cid}: slider thumb not redrawn when moved`);
      }
      continue;
    }

    if (want === 'menu') {
      const before = snapshot(win.surface);
      win.pointerDown(p, pe());
      win.render(true);
      const opened = differs(before, win.surface, {
        x: 0,
        y: 0,
        w: win.surface.width,
        h: win.surface.height,
      });
      // move onto the first item (the menu opens upwards; its top item sits highest) and release
      const m = (win as unknown as { openMenu: { x: number; y: number } | null }).openMenu;
      if (!m) {
        problems.push(`${where} ${cid}: menu did not open`);
        win.pointerUp(p);
        continue;
      }
      if (!opened) {
        if (menuDraws(noisy(skin), shade, cid)) count(report.invisibleArt, `${where} ${cid} menu`);
        else problems.push(`${where} ${cid}: menu opened but nothing was drawn`);
      }
      const item = { x: m.x + 5, y: m.y + 9 };
      win.pointerMove(item);
      win.pointerUp(item);
      if (menuActions.length !== 1) problems.push(`${where} ${cid}: picking a menu item did nothing`);
      continue;
    }

    if (want.startsWith('dblclick:')) {
      win.dblclick(p);
      if (!calls.some((k) => k.startsWith(want.slice(9))))
        problems.push(`${where} ${cid}: double-click didn't call ${want.slice(9)}`);
      continue;
    }

    // a plain button or click area
    const before = snapshot(win.surface);
    win.pointerDown(p, pe());
    win.render(true);
    if (c instanceof Button && !differs(before, win.surface, c)) {
      if (strict && !NO_PRESS_ART.has(cid)) problems.push(`${where} ${cid}: no pressed look`);
      else report.noPressArt[`${id}.${cid}`] = (report.noPressArt[`${id}.${cid}`] ?? 0) + 1;
    }
    win.pointerUp(p);
    if (!calls.some((k) => k.startsWith(want)))
      problems.push(`${where} ${cid}: click sent ${calls.join(' ') || 'nothing'}`);
    else if (calls.length !== 1)
      problems.push(`${where} ${cid}: click sent more than one command: ${calls.join(' ')}`);
  }
  // the main controls must all exist
  if (!shade && id === 'main')
    for (const must of [
      'play',
      'stop',
      'pause',
      'prev',
      'next',
      'eject',
      'volume',
      'balance',
      'pos',
      'options',
      'minimize',
      'shade',
      'close',
    ])
      if (!ids.includes(must)) problems.push(`main: ${must} missing`);
  return problems;
}

/**
 * Every check for one loaded skin: sheet sizes, then every control of every window, normal and shade.
 * `strict` (for RevAmp's own skins) also fails buttons that look the same pressed and released.
 */
export function checkSkin(skin: Skin, strict = false): string[] {
  const problems: string[] = [];
  for (const [sheet, [sw, sh]] of Object.entries(SHEET_SIZES)) {
    const img = skin.sheets[sheet as keyof Skin['sheets']];
    if (img.width < sw || img.height < sh)
      problems.push(`${sheet}.bmp smaller than ${sw}x${sh} after padding`);
  }
  for (const shade of [false, true])
    for (const id of ['main', 'eq', 'pl'] as const) problems.push(...checkWindow(skin, id, shade, strict));
  return problems;
}

/** Runs shard `n` of `of` (the skins are split so the test files run in parallel). */
export function skinButtonSuite(n: number, of: number): void {
  const skins = allSkins.filter((_, i) => i % of === n);
  describe.skipIf(!skins.length)(`every button, ${skins.length} skins`, () => {
    test.each(skins.map((f) => [f.slice(ROOT.length + 1), f]))('%s', (name, file) => {
      report.skins++;
      let skin: Skin;
      try {
        skin = skinFromArchive(name, new Uint8Array(readFileSync(file)), defaultSkin());
      } catch (e) {
        report.loadFailures[name] = String((e as Error).message ?? e);
        return; // a broken archive is reported, not failed (see the report and the load test below)
      }
      for (const w of skin.warnings ?? []) {
        const k = String(w).replace(/\d+/g, '#').slice(0, 60);
        report.warnings[k] = (report.warnings[k] ?? 0) + 1;
      }
      const problems = checkSkin(skin);
      if (problems.length) report.problems[name] = problems;
      expect(problems).toEqual([]);
    });
  });

  afterAll(() => {
    if (!skins.length) return;
    writeFileSync(join(ROOT, '..', `skin-button-report-${n + 1}.json`), JSON.stringify(report, null, 2));
  });
}
