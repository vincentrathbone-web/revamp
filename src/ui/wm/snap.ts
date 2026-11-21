/**
 * Window snapping and docking geometry (pure functions, no DOM).
 * - Windows snap to screen edges and to each other's edges within `dist` pixels.
 * - Windows touching the main window (directly or through each other) form a docked group that moves with it.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const right = (r: Rect) => r.x + r.w;
const bottom = (r: Rect) => r.y + r.h;
const overlap = (a0: number, a1: number, b0: number, b1: number, slack = 0) =>
  a0 < b1 + slack && b0 < a1 + slack;

/** Returns the snapped top-left position for `moving` placed at (x, y). */
export function snap(moving: Rect, others: Rect[], screen: Rect | null, dist = 10): { x: number; y: number } {
  let bestX: number | null = null,
    bestDx = dist + 1;
  let bestY: number | null = null,
    bestDy = dist + 1;
  const tryX = (target: number) => {
    const d = Math.abs(target - moving.x);
    if (d < bestDx) ((bestDx = d), (bestX = target));
  };
  const tryY = (target: number) => {
    const d = Math.abs(target - moving.y);
    if (d < bestDy) ((bestDy = d), (bestY = target));
  };
  for (const o of others) {
    const vNear = overlap(moving.y, bottom(moving), o.y, bottom(o), dist);
    const hNear = overlap(moving.x, right(moving), o.x, right(o), dist);
    if (vNear) {
      tryX(right(o)); // my left to its right
      tryX(o.x - moving.w); // my right to its left
    }
    if (hNear) {
      tryY(bottom(o)); // my top to its bottom
      tryY(o.y - moving.h); // my bottom to its top
    }
    // line up edges when side by side / stacked
    if (vNear || hNear) {
      if (hNear) (tryX(o.x), tryX(right(o) - moving.w));
      if (vNear) (tryY(o.y), tryY(bottom(o) - moving.h));
    }
  }
  if (screen) {
    tryX(screen.x);
    tryX(right(screen) - moving.w);
    tryY(screen.y);
    tryY(bottom(screen) - moving.h);
  }
  return { x: bestX ?? moving.x, y: bestY ?? moving.y };
}

/** True if two windows share an edge (touching, with some overlap along that edge). */
export function touching(a: Rect, b: Rect): boolean {
  const vOv = overlap(a.y, bottom(a), b.y, bottom(b));
  const hOv = overlap(a.x, right(a), b.x, right(b));
  return (vOv && (right(a) === b.x || right(b) === a.x)) || (hOv && (bottom(a) === b.y || bottom(b) === a.y));
}

/** Ids of windows connected to `rootId` through touching edges (not including the root). */
export function dockedGroup(rootId: string, rects: Record<string, Rect>): string[] {
  const seen = new Set([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const [other, r] of Object.entries(rects)) {
      if (!seen.has(other) && touching(rects[id]!, r)) {
        seen.add(other);
        queue.push(other);
      }
    }
  }
  seen.delete(rootId);
  return [...seen];
}

/**
 * After window `id` changes size, moves windows docked below / to the right of it by the size change,
 * so the stack stays attached (e.g. shade mode or double size). Returns new rects.
 */
export function reflow(
  id: string,
  before: Rect,
  after: Rect,
  rects: Record<string, Rect>,
): Record<string, Rect> {
  const out: Record<string, Rect> = { ...rects, [id]: after };
  const dh = after.h - before.h,
    dw = after.w - before.w;
  const others = { ...rects };
  delete others[id];
  // windows hanging off the bottom edge (and anything docked to them, except back to us)
  const below = Object.entries(others).filter(
    ([, r]) => r.y === bottom(before) && overlap(r.x, right(r), before.x, right(before)),
  );
  const besides = Object.entries(others).filter(
    ([, r]) => r.x === right(before) && overlap(r.y, bottom(r), before.y, bottom(before)),
  );
  const move = (start: [string, Rect][], dx: number, dy: number) => {
    const moved = new Set<string>();
    const queue = start.map(([k]) => k);
    while (queue.length) {
      const k = queue.shift()!;
      if (moved.has(k) || k === id) continue;
      moved.add(k);
      for (const [o, r] of Object.entries(others))
        if (!moved.has(o) && touching(rects[k]!, r)) {
          // only follow windows further away from the resized one
          if ((dy && r.y >= rects[k]!.y) || (dx && r.x >= rects[k]!.x)) queue.push(o);
        }
    }
    for (const k of moved) out[k] = { ...out[k]!, x: out[k]!.x + dx, y: out[k]!.y + dy };
  };
  if (dh) move(below, 0, dh);
  if (dw) move(besides, dw, 0);
  return out;
}

/** Keeps at least `margin` px of a window on screen. */
export function keepOnScreen(r: Rect, screen: Rect, margin = 20): Rect {
  return {
    ...r,
    x: Math.min(Math.max(r.x, screen.x - r.w + margin), right(screen) - margin),
    y: Math.min(Math.max(r.y, screen.y), bottom(screen) - margin),
  };
}
