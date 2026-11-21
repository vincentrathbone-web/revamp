/** Multi-monitor rules: snapping to each screen's edges and rescuing windows from missing screens. */
import { expect, test } from 'vitest';
import fc from 'fast-check';
import { keepOnScreens, snap, type Rect } from '../../src/ui/wm/snap';

// two screens side by side, the right one taller and lower
const left: Rect = { x: 0, y: 0, w: 1920, h: 1040 };
const rightS: Rect = { x: 1920, y: -200, w: 1440, h: 2520 };
const screens = [left, rightS];
const win = (x: number, y: number): Rect => ({ x, y, w: 275, h: 116 });

test('snaps to the inner edges of the screen it is on', () => {
  expect(snap(win(1920 + 6, 300), [], screens)).toEqual({ x: 1920, y: 300 }); // left edge of right screen
  expect(snap(win(1920 - 275 - 4, 300), [], screens)).toEqual({ x: 1920 - 275, y: 300 }); // right edge of left screen
  expect(snap(win(2500, -195), [], screens)).toEqual({ x: 2500, y: -200 }); // top of the right screen
});

test('ignores edges of screens far away', () => {
  // bottom edge of the right screen (y = 2320) must not pull a window on the left screen
  expect(snap(win(100, 2320 - 116 - 3), [], [left, { x: 5000, y: 0, w: 100, h: 2320 }])).toEqual({
    x: 100,
    y: 2320 - 116 - 3,
  });
});

test('a window on a screen stays where it is', () => {
  expect(keepOnScreens(win(2200, 1800), screens)).toEqual(win(2200, 1800));
  expect(keepOnScreens(win(100, 100), screens)).toEqual(win(100, 100));
});

test('a window on an unplugged screen moves onto the nearest remaining one', () => {
  const r = keepOnScreens(win(2500, 600), [left]);
  expect(r.x).toBeLessThanOrEqual(1920 - 20);
  expect(r.y).toBe(600);
});

test('property: after keepOnScreens the title bar is reachable on some screen', () => {
  fc.assert(
    fc.property(fc.integer({ min: -5000, max: 8000 }), fc.integer({ min: -3000, max: 5000 }), (x, y) => {
      const r = keepOnScreens(win(x, y), screens);
      const ok = screens.some(
        (s) =>
          r.y >= s.y && r.y < s.y + s.h - 10 + 1 && Math.min(r.x + r.w, s.x + s.w) - Math.max(r.x, s.x) >= 20,
      );
      expect(ok).toBe(true);
    }),
  );
});
