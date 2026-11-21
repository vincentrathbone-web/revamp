/** The playlist must stay quick with very large lists (100,000 entries). */
import { expect, test } from 'vitest';
import { Playlist, displayTitle } from '../../src/playlist/model';
import { parseM3u, writeM3u } from '../../src/playlist/formats';

const N = 100_000;
const time = (fn: () => void) => {
  const t = performance.now();
  fn();
  return performance.now() - t;
};

test('100k entries: add, sort, shuffle, search, select, remove, save/load stay fast', () => {
  const pl = new Playlist(() => 0.42);
  const items = Array.from({ length: N }, (_, i) => ({
    location: `D:/Music/Artist ${i % 997}/Track ${i}.mp3`,
    title: `Artist ${i % 997} - Track ${i}`,
    durationSec: 120 + (i % 300),
  }));
  const t: Record<string, number> = {};
  t.add = time(() => pl.add(items));
  expect(pl.length).toBe(N);
  t.sort = time(() => pl.sortBy(displayTitle));
  t.shuffle = time(() => pl.setShuffle(true));
  t.next = time(() => {
    for (let i = 0; i < 1000; i++) pl.next();
  });
  t.search = time(() => expect(pl.search('track 9999').length).toBeGreaterThan(0));
  t.total = time(() => expect(pl.totalDuration().sec).toBeGreaterThan(0));
  t.select = time(() => pl.select((e) => e.id % 2 === 0));
  t.remove = time(() => pl.removeSelected());
  expect(pl.length).toBe(N / 2);
  let text = '';
  t.save = time(
    () =>
      (text = writeM3u(
        pl.entries.map((e) => ({ location: e.location, title: e.title, durationSec: e.durationSec })),
      )),
  );
  t.load = time(() => expect(parseM3u(text).length).toBe(N / 2));
  console.log(
    '100k timings (ms):',
    Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v)])),
  );
  for (const [k, v] of Object.entries(t)) expect(v, k).toBeLessThan(1500);
});
