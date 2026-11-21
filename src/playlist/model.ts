/** Playlist model: entries, selection, current track, shuffle and repeat. No UI. */
import type { TrackInfo } from '../audio/tags';

export interface Entry {
  id: number;
  /** Path, file name or URL. */
  location: string;
  /** Display title from the playlist file or tags. */
  title?: string;
  durationSec?: number;
  info?: TrackInfo;
  /** Opaque handle the platform uses to read the file (e.g. a browser File). */
  handle?: unknown;
  selected?: boolean;
}

export type RepeatMode = 'off' | 'all' | 'one';

let nextId = 1;

export function displayTitle(e: Entry): string {
  const i = e.info;
  if (i?.title) return i.artist ? `${i.artist} - ${i.title}` : i.title;
  if (e.title) return e.title;
  const name = e.location.split(/[\\/]/).pop() ?? e.location;
  try {
    return decodeURIComponent(name).replace(/\.[^.]+$/, '');
  } catch {
    return name.replace(/\.[^.]+$/, '');
  }
}

export function formatTime(sec: number | undefined): string {
  if (sec === undefined || !Number.isFinite(sec) || sec < 0) return '';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    r = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${m}:${String(r).padStart(2, '0')}`;
}

export class Playlist {
  entries: Entry[] = [];
  current = -1;
  shuffle = false;
  repeat: RepeatMode = 'off';
  /** Shuffle order: indexes into `entries`; `shufflePos` is where we are in it. */
  private order: number[] = [];
  private shufflePos = -1;
  private listeners = new Set<() => void>();
  private rng: () => number;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  changed(): void {
    for (const l of [...this.listeners]) l();
  }

  get length(): number {
    return this.entries.length;
  }

  get currentEntry(): Entry | undefined {
    return this.entries[this.current];
  }

  add(items: Omit<Entry, 'id'>[], at = this.entries.length): Entry[] {
    const made = items.map((i) => ({ ...i, id: nextId++ }));
    this.entries.splice(at, 0, ...made);
    if (this.current >= at) this.current += made.length;
    this.rebuildOrder();
    this.changed();
    return made;
  }

  clear(): void {
    this.entries = [];
    this.current = -1;
    this.rebuildOrder();
    this.changed();
  }

  removeWhere(pred: (e: Entry, i: number) => boolean): void {
    const cur = this.currentEntry;
    this.entries = this.entries.filter((e, i) => !pred(e, i));
    this.current = cur ? this.entries.indexOf(cur) : -1;
    this.rebuildOrder();
    this.changed();
  }

  removeSelected(): void {
    this.removeWhere((e) => !!e.selected);
  }

  crop(): void {
    this.removeWhere((e) => !e.selected);
  }

  removeDuplicates(): void {
    const seen = new Set<string>();
    this.removeWhere((e) => (seen.has(e.location) ? true : (seen.add(e.location), false)));
  }

  select(fn: (e: Entry, i: number) => boolean): void {
    this.entries.forEach((e, i) => (e.selected = fn(e, i)));
    this.changed();
  }

  /** Moves the selected entries by `delta` places (drag to reorder). */
  moveSelected(delta: number): void {
    if (!delta) return;
    const cur = this.currentEntry;
    const sel = this.entries.filter((e) => e.selected);
    if (!sel.length) return;
    const firstIdx = this.entries.indexOf(sel[0]!);
    const lastIdx = this.entries.indexOf(sel[sel.length - 1]!);
    const d = Math.max(-firstIdx, Math.min(this.entries.length - 1 - lastIdx, delta));
    if (!d) return;
    const rest = this.entries.filter((e) => !e.selected);
    const newFirst = firstIdx + d;
    // place the block so that the first selected item lands at newFirst
    const before = rest.slice(0, newFirst);
    const after = rest.slice(newFirst);
    this.entries = [...before, ...sel, ...after];
    this.current = cur ? this.entries.indexOf(cur) : -1;
    this.rebuildOrder();
    this.changed();
  }

  sortBy(key: (e: Entry) => string): void {
    const cur = this.currentEntry;
    const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    this.entries.sort((a, b) => coll.compare(key(a), key(b)));
    this.current = cur ? this.entries.indexOf(cur) : -1;
    this.rebuildOrder();
    this.changed();
  }

  reverse(): void {
    const cur = this.currentEntry;
    this.entries.reverse();
    this.current = cur ? this.entries.indexOf(cur) : -1;
    this.rebuildOrder();
    this.changed();
  }

  randomize(): void {
    const cur = this.currentEntry;
    for (let i = this.entries.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [this.entries[i], this.entries[j]] = [this.entries[j]!, this.entries[i]!];
    }
    this.current = cur ? this.entries.indexOf(cur) : -1;
    this.rebuildOrder();
    this.changed();
  }

  setShuffle(on: boolean): void {
    this.shuffle = on;
    this.rebuildOrder();
    this.changed();
  }

  setRepeat(mode: RepeatMode): void {
    this.repeat = mode;
    this.changed();
  }

  setCurrent(i: number): void {
    this.current = i >= 0 && i < this.entries.length ? i : -1;
    if (this.shuffle) {
      const p = this.order.indexOf(this.current);
      this.shufflePos = p;
    }
    this.changed();
  }

  /** New shuffle order that starts with the current track, so every track plays once before repeating. */
  private rebuildOrder(): void {
    const n = this.entries.length;
    const idx = Array.from({ length: n }, (_, i) => i).filter((i) => i !== this.current);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [idx[i], idx[j]] = [idx[j]!, idx[i]!];
    }
    this.order = this.current >= 0 ? [this.current, ...idx] : idx;
    this.shufflePos = this.current >= 0 ? 0 : -1;
  }

  /** Index of the track after `from` (default: current), or -1 at the end. Does not change state. */
  peekNext(from = this.current, manual = false): number {
    const n = this.entries.length;
    if (!n) return -1;
    if (this.repeat === 'one' && !manual && from >= 0) return from;
    if (this.shuffle) {
      const p = from === this.current ? this.shufflePos : this.order.indexOf(from);
      if (p + 1 < this.order.length) return this.order[p + 1]!;
      return this.repeat === 'all' || manual ? (this.order[0] ?? -1) : -1;
    }
    if (from + 1 < n) return from + 1;
    return this.repeat === 'all' || manual ? 0 : -1;
  }

  peekPrev(from = this.current): number {
    const n = this.entries.length;
    if (!n) return -1;
    if (this.shuffle) {
      const p = this.order.indexOf(from);
      return p > 0 ? this.order[p - 1]! : this.order[this.order.length - 1]!;
    }
    return from > 0 ? from - 1 : n - 1;
  }

  /** Advances to the next track. Returns the new index or -1. */
  next(manual = false): number {
    const i = this.peekNext(this.current, manual);
    if (i < 0) return -1;
    if (this.shuffle) {
      const p = this.order.indexOf(i);
      if (p <= this.shufflePos && !(this.repeat === 'one' && !manual)) {
        // wrapped around: reshuffle for a fresh round, keeping i first
        this.current = i;
        this.rebuildOrder();
      } else this.shufflePos = p;
    }
    this.current = i;
    this.changed();
    return i;
  }

  prev(): number {
    const i = this.peekPrev();
    if (i < 0) return -1;
    if (this.shuffle) this.shufflePos = this.order.indexOf(i);
    this.current = i;
    this.changed();
    return i;
  }

  totalDuration(selectedOnly = false): { sec: number; unknown: boolean } {
    let sec = 0,
      unknown = false;
    for (const e of this.entries) {
      if (selectedOnly && !e.selected) continue;
      const d = e.info?.durationSec ?? e.durationSec;
      if (d === undefined) unknown = true;
      else sec += d;
    }
    return { sec, unknown };
  }

  /** Jump-to-file search: every word must appear in title or location. */
  search(query: string): number[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.entries
      .map((e, i) => [i, `${displayTitle(e)} ${e.location}`.toLowerCase()] as const)
      .filter(([, t]) => words.every((w) => t.includes(w)))
      .map(([i]) => i);
  }
}
