/**
 * Window rendering and interaction tests (Node, no browser): each window draws into a software surface.
 * Golden images: the Graphite default skin renders are kept as PNGs in tests/golden and compared byte for byte
 * (the PNG writer is deterministic). Delete a PNG or run with UPDATE_GOLDEN=1 to re-create it after a deliberate change.
 * Third-party test skins are only checked for "draws without errors" (their art is never committed).
 */
import { describe, expect, test } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultEq } from '../../src/dsp/eq';
import { defaultSkin } from '../../src/skin/default-skin';
import { getPixel } from '../../src/skin/image';
import { encodePng } from '../../src/skin/png';
import { skinFromArchive } from '../../src/skin/skin';
import { fakeUi, windowsFor } from './fake-ui';
import { dbToPos, posToDb } from '../../src/ui/eq-window';
import type { SkinnedWindow } from '../../src/ui/window';
import { PlaylistWindow } from '../../src/ui/playlist-window';

const GOLDEN = join(__dirname, '..', 'golden');

function golden(name: string, win: SkinnedWindow): void {
  win.render(true);
  const png = encodePng(win.surface);
  const file = join(GOLDEN, `${name}.png`);
  if (!existsSync(file) || process.env['UPDATE_GOLDEN']) {
    mkdirSync(GOLDEN, { recursive: true });
    writeFileSync(file, png);
    return;
  }
  const want = new Uint8Array(readFileSync(file));
  expect(Buffer.from(png).equals(Buffer.from(want)), `${name}.png differs from the golden image`).toBe(true);
}

const pe = (button = 0) => ({ button, clientX: 0, clientY: 0, pointerId: 1 }) as unknown as PointerEvent;

function click(win: SkinnedWindow, x: number, y: number): void {
  win.render(true);
  win.pointerDown({ x, y }, pe());
  win.pointerUp({ x, y });
}

describe('golden images (Graphite default skin)', () => {
  const skin = defaultSkin();
  test.each(['main', 'eq', 'pl'] as const)('%s window', (id) => {
    const { ui } = fakeUi(skin);
    golden(`graphite-${id}`, windowsFor(ui)[id]);
  });
  test.each(['main', 'eq', 'pl'] as const)('%s window shaded', (id) => {
    const { ui } = fakeUi(skin, { shade: { main: true, eq: true, pl: true } });
    golden(`graphite-${id}-shade`, windowsFor(ui)[id]);
  });
  test('main window stopped, time remaining, shuffle on', () => {
    const { ui } = fakeUi(skin, { playState: 'stopped', shuffle: true, repeat: false, timeRemaining: true });
    golden('graphite-main-stopped', windowsFor(ui).main);
  });
  test('playlist at a larger size', () => {
    const { ui } = fakeUi(skin, { plSize: { w: 350, h: 290 } });
    const pl = windowsFor(ui).pl;
    expect(pl.size()).toEqual({ w: 350, h: 290 });
    golden('graphite-pl-large', pl);
  });
});

describe('window interaction', () => {
  const skin = defaultSkin();
  test('main window transport buttons call the right commands', () => {
    const { ui, calls } = fakeUi(skin);
    const main = windowsFor(ui).main;
    // centre of each button, from the classic layout
    const at: [string, number, number][] = [
      ['prev', 27, 97],
      ['play', 50, 97],
      ['pause', 73, 97],
      ['stop', 96, 97],
      ['next', 118, 97],
      ['eject', 147, 97],
    ];
    for (const [, x, y] of at) click(main, x, y);
    expect(calls).toEqual(['prev()', 'play()', 'pause()', 'stop()', 'next()', 'eject()']);
  });

  test('pressing a button and releasing outside it does nothing', () => {
    const { ui, calls } = fakeUi(skin);
    const main = windowsFor(ui).main;
    main.render(true);
    main.pointerDown({ x: 50, y: 97 }, pe());
    main.pointerUp({ x: 200, y: 20 });
    expect(calls).toEqual([]);
  });

  test('shuffle and repeat buttons toggle', () => {
    const { ui, calls } = fakeUi(skin);
    const main = windowsFor(ui).main;
    click(main, 185, 95);
    click(main, 222, 95);
    expect(calls).toEqual(['toggleShuffle()', 'toggleRepeat()']);
  });

  test('volume slider follows the pointer', () => {
    const { ui, state } = fakeUi(skin);
    const main = windowsFor(ui).main;
    main.render(true);
    main.pointerDown({ x: 108, y: 60 }, pe());
    main.pointerMove({ x: 108, y: 60 });
    main.pointerUp({ x: 108, y: 60 });
    expect(state.volume).toBeLessThan(0.15);
    main.pointerDown({ x: 172, y: 60 }, pe());
    main.pointerMove({ x: 172, y: 60 });
    main.pointerUp({ x: 172, y: 60 });
    expect(state.volume).toBeGreaterThan(0.85);
  });

  test('EQ slider position <-> dB, with a snap to zero', () => {
    expect(posToDb(0)).toBe(12);
    expect(posToDb(1)).toBe(-12);
    expect(posToDb(0.5)).toBe(0);
    expect(posToDb(0.51)).toBe(0);
    expect(dbToPos(posToDb(0.25))).toBeCloseTo(0.25, 2);
  });

  test('dragging an EQ band changes only that band', () => {
    const { ui, state } = fakeUi(skin, { eq: defaultEq() });
    const eq = windowsFor(ui).eq;
    eq.render(true);
    const band = eq.controls.find((c) => c.id === 'band3')!;
    const x = band.x + 5;
    eq.pointerDown({ x, y: band.y + 2 }, pe());
    eq.pointerMove({ x, y: band.y + 2 });
    eq.pointerUp({ x, y: band.y + 2 });
    expect(state.eq.bandsDb[3]).toBeGreaterThan(10);
    expect(state.eq.bandsDb.filter((_, i) => i !== 3).every((v) => v === 0)).toBe(true);
  });

  test('double-clicking the title bar toggles shade mode', () => {
    for (const id of ['main', 'eq', 'pl'] as const) {
      const { ui, calls } = fakeUi(skin);
      const w = windowsFor(ui)[id];
      w.render(true);
      w.dblclick({ x: 120, y: 6 });
      expect(calls, id).toContain(`toggleShade("${id}")`);
    }
  });

  describe('playlist bottom menus (add, rem, sel, misc, list)', () => {
    const setup = () => {
      const { ui } = fakeUi(skin);
      const actions: string[] = [];
      const pl = new PlaylistWindow(
        ui,
        () => null,
        (id) => actions.push(id),
      );
      pl.render(true);
      const btn = pl.controls.find((c) => c.id === 'add')!;
      const at = { x: btn.x + 10, y: btn.y + 9 };
      const menu = () => (pl as unknown as { openMenu: { x: number; y: number } | null }).openMenu;
      return { pl, actions, at, menu };
    };

    test('a click opens the menu and it stays open', () => {
      const { pl, at, menu } = setup();
      click(pl, at.x, at.y);
      expect(menu()).not.toBeNull();
      pl.pointerMove({ x: 150, y: 40 }); // moving around doesn't close it
      expect(menu()).not.toBeNull();
    });

    test('then clicking an item runs it and closes the menu', () => {
      const { pl, actions, at, menu } = setup();
      click(pl, at.x, at.y);
      const m = menu()!;
      pl.pointerMove({ x: m.x + 5, y: m.y + 9 });
      click(pl, m.x + 5, m.y + 9);
      expect(actions).toHaveLength(1);
      expect(menu()).toBeNull();
    });

    test('clicking elsewhere or pressing Escape closes it without running anything', () => {
      for (const how of ['elsewhere', 'escape'] as const) {
        const { pl, actions, at, menu } = setup();
        click(pl, at.x, at.y);
        if (how === 'elsewhere') click(pl, 200, 40);
        if (how === 'escape') pl.key({ key: 'Escape' } as KeyboardEvent);
        expect(menu(), how).toBeNull();
        expect(actions, how).toEqual([]);
      }
    });

    test('a click that wobbles a little on the button still just opens the menu', () => {
      // the bottom item is drawn over the button, so a shaky click must not run it
      const { pl, actions, at, menu } = setup();
      pl.pointerDown(at, pe());
      pl.pointerMove({ x: at.x + 2, y: at.y + 1 });
      pl.pointerUp({ x: at.x + 2, y: at.y + 1 });
      expect(menu()).not.toBeNull();
      expect(actions).toEqual([]);
    });

    test('press, drag onto an item and release still works', () => {
      const { pl, actions, at, menu } = setup();
      pl.pointerDown(at, pe());
      const m = menu()!;
      pl.pointerMove({ x: m.x + 5, y: m.y + 9 });
      pl.pointerUp({ x: m.x + 5, y: m.y + 9 });
      expect(actions).toHaveLength(1);
      expect(menu()).toBeNull();
    });

    test('press and release away from the button and the menu closes it', () => {
      const { pl, actions, at, menu } = setup();
      pl.pointerDown(at, pe());
      pl.pointerMove({ x: 200, y: 40 });
      pl.pointerUp({ x: 200, y: 40 });
      expect(menu()).toBeNull();
      expect(actions).toEqual([]);
    });
  });

  test('double-clicking a playlist row plays it', () => {
    const { ui, calls } = fakeUi(skin);
    const pl = windowsFor(ui).pl;
    pl.render(true);
    pl.pointerDown({ x: 60, y: 20 + 13 * 2 + 4 }, pe());
    pl.pointerUp({ x: 60, y: 20 + 13 * 2 + 4 });
    pl.dblclick({ x: 60, y: 20 + 13 * 2 + 4 });
    expect(calls).toContain('playIndex(2)');
  });

  test('region-shaped windows are see-through outside the region', () => {
    const { ui } = fakeUi(skin);
    const main = windowsFor(ui).main;
    main.render(true);
    expect(main.inside(10, 10)).toBe(true);
    expect(getPixel(main.surface, 10, 10)[3]).toBe(255);
  });
});

describe('test skins draw without errors', () => {
  const dir = join(__dirname, '..', '..', 'test-assets', 'skins');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.wsz')) : [];
  test.skipIf(!files.length).each(files)('%s', (f) => {
    const skin = skinFromArchive(f, new Uint8Array(readFileSync(join(dir, f))), defaultSkin());
    for (const shade of [false, true]) {
      const { ui } = fakeUi(skin, { shade: { main: shade, eq: shade, pl: shade } });
      for (const w of Object.values(windowsFor(ui))) {
        w.render(true);
        const { w: ww, h } = w.size();
        expect(w.surface.width).toBe(ww);
        expect(w.surface.height).toBe(h);
        // something visible was drawn
        let opaque = 0;
        for (let i = 3; i < w.surface.data.length; i += 4) if (w.surface.data[i]) opaque++;
        expect(opaque).toBeGreaterThan(ww * h * 0.3);
      }
    }
  });
});
