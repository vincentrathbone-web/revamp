/** The window host on a real page: placement, hit-testing, docking reflow and group dragging. */
import { afterEach, expect, test } from 'vitest';
import { BrowserHost } from '../../src/ui/host-browser';
import { SkinnedWindow, type WindowId } from '../../src/ui/window';

class Box extends SkinnedWindow {
  h: number;
  constructor(
    readonly id: WindowId,
    h: number,
    private hole = false,
  ) {
    super();
    this.h = h;
  }
  size() {
    return { w: 275, h: this.h };
  }
  protected build() {
    this.controls = [];
  }
  protected paint() {
    this.surface.fill(0, 0, 275, this.h, [80, 80, 80]);
  }
  override inside(x: number, y: number) {
    // a see-through notch in the top-left corner, like a shaped skin
    return !(this.hole && x < 10 && y < 10);
  }
}

let root: HTMLElement;
afterEach(() => root?.remove());

function setup(scale = () => 1) {
  root = document.createElement('div');
  root.style.cssText = 'position:fixed;inset:0';
  document.body.appendChild(root);
  const wins = { main: new Box('main', 116, true), eq: new Box('eq', 116), pl: new Box('pl', 232) };
  let layouts = 0;
  const host = new BrowserHost(root, {
    scaleOf: (id) => (id === 'pl' ? 1 : scale()),
    inside: (id, x, y) => wins[id].inside(x, y),
    cursorUrl: () => undefined,
    snapEnabled: () => true,
    snapDistance: () => 10,
    onFocus: () => {},
    onLayout: () => layouts++,
  });
  host.add(wins.main, 40, 40);
  host.add(wins.eq, 40, 156);
  host.add(wins.pl, 40, 272);
  host.render(true);
  return { host, wins, layouts: () => layouts };
}

test('windows are placed where asked and drawn', () => {
  const { host } = setup();
  expect(host.rects()).toEqual({
    main: { x: 40, y: 40, w: 275, h: 116 },
    eq: { x: 40, y: 156, w: 275, h: 116 },
    pl: { x: 40, y: 272, w: 275, h: 232 },
  });
  const r = host.canvasOf('main')!.getBoundingClientRect();
  expect([r.left, r.top, r.width, r.height]).toEqual([40, 40, 275, 116]);
});

test('hit-testing respects window shapes and gaps', () => {
  const { host } = setup();
  expect(host.hitTest(100, 100)).toBe(true);
  expect(host.hitTest(45, 45)).toBe(false); // notch in the main window
  expect(host.hitTest(500, 100)).toBe(false); // empty desktop
  host.setVisible('pl', false);
  expect(host.hitTest(100, 300)).toBe(false);
});

test('a window growing pushes the docked windows below it, and back', () => {
  let s = 1;
  const { host } = setup(() => s);
  s = 2;
  host.sizeChanged('main');
  host.sizeChanged('eq');
  expect(host.position('eq')).toEqual({ x: 40, y: 272 });
  expect(host.position('pl')).toEqual({ x: 40, y: 504 });
  s = 1;
  host.sizeChanged('main');
  host.sizeChanged('eq');
  expect(host.position('eq')).toEqual({ x: 40, y: 156 });
  expect(host.position('pl')).toEqual({ x: 40, y: 272 });
});

test('dragging the main window moves the docked group; others snap', () => {
  const { host, wins } = setup();
  const canvas = host.canvasOf('main')!;
  const down = new PointerEvent('pointerdown', { clientX: 100, clientY: 45, pointerId: 1, bubbles: true });
  wins.main.host!.beginMove(down);
  dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 145 }));
  dispatchEvent(new PointerEvent('pointerup', {}));
  expect(host.position('main')).toEqual({ x: 240, y: 140 });
  expect(host.position('eq')).toEqual({ x: 240, y: 256 });
  expect(host.position('pl')).toEqual({ x: 240, y: 372 });
  expect(canvas).toBeTruthy();
  // drag the playlist alone next to the main window: it snaps to the right edge
  wins.pl.host!.beginMove(new PointerEvent('pointerdown', { clientX: 300, clientY: 380 }));
  dispatchEvent(new PointerEvent('pointermove', { clientX: 300 + 270, clientY: 380 - 230 }));
  dispatchEvent(new PointerEvent('pointerup', {}));
  expect(host.position('pl')).toEqual({ x: 515, y: 140 }); // right edge and top edge both snap
});
