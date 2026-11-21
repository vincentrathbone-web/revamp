import { describe, expect, test } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import fc from 'fast-check';
import { dockedGroup, keepOnScreen, reflow, snap, touching, type Rect } from '../../src/ui/wm/snap';
import { Playlist, displayTitle, formatTime } from '../../src/playlist/model';
import {
  decodePlaylistBytes,
  parseB4s,
  parseM3u,
  parsePlaylist,
  parsePls,
  parseXspf,
  resolveLocation,
  writeM3u,
  writePls,
  writeXspf,
} from '../../src/playlist/formats';

describe('snapping and docking', () => {
  const main: Rect = { x: 100, y: 100, w: 275, h: 116 };
  test('snaps below another window within 10 px, and lines up the left edges', () => {
    expect(snap({ x: 104, y: 222, w: 275, h: 116 }, [main], null)).toEqual({ x: 100, y: 216 });
  });
  test('does not snap when far away', () => {
    expect(snap({ x: 500, y: 500, w: 50, h: 50 }, [main], null)).toEqual({ x: 500, y: 500 });
  });
  test('snaps to screen edges', () => {
    expect(snap({ x: 6, y: 3, w: 50, h: 50 }, [], { x: 0, y: 0, w: 1000, h: 800 })).toEqual({ x: 0, y: 0 });
    expect(snap({ x: 945, y: 745, w: 50, h: 50 }, [], { x: 0, y: 0, w: 1000, h: 800 })).toEqual({
      x: 950,
      y: 750,
    });
  });
  test('docked group follows touching chains', () => {
    const rects = {
      main,
      eq: { x: 100, y: 216, w: 275, h: 116 },
      pl: { x: 100, y: 332, w: 275, h: 232 },
      far: { x: 900, y: 900, w: 10, h: 10 },
    };
    expect(dockedGroup('main', rects).sort()).toEqual(['eq', 'pl']);
    expect(touching(rects.main, rects.far)).toBe(false);
  });
  test('shade mode: windows below move up and stay attached (property over stacks)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 0, max: 500 }),
        fc.boolean(),
        (x, y, toShade) => {
          const m = { x, y, w: 275, h: toShade ? 116 : 14 };
          const rects = {
            main: m,
            eq: { x, y: y + m.h, w: 275, h: 116 },
            pl: { x, y: y + m.h + 116, w: 275, h: 116 },
          };
          const after = { ...m, h: toShade ? 14 : 116 };
          const out = reflow('main', m, after, rects);
          expect(out.eq!.y).toBe(y + after.h);
          expect(out.pl!.y).toBe(out.eq!.y + 116);
          expect(dockedGroup('main', out).sort()).toEqual(['eq', 'pl']);
        },
      ),
    );
  });
  test('keeps windows reachable on screen', () => {
    const r = keepOnScreen({ x: -1000, y: -50, w: 275, h: 116 }, { x: 0, y: 0, w: 800, h: 600 });
    expect(r.x + r.w).toBeGreaterThanOrEqual(20);
    expect(r.y).toBe(0);
  });
});

describe('playlist model', () => {
  const make = (n: number, seed = 1) => {
    let s = seed;
    const pl = new Playlist(() => (s = (s * 16807) % 2147483647) / 2147483647);
    pl.add(Array.from({ length: n }, (_, i) => ({ location: `C:\\Music\\${i}.mp3` })));
    return pl;
  };
  test('next/prev with and without repeat', () => {
    const pl = make(3);
    pl.setCurrent(0);
    expect(pl.next()).toBe(1);
    expect(pl.next()).toBe(2);
    expect(pl.next()).toBe(-1);
    pl.setRepeat('all');
    expect(pl.next()).toBe(0);
    expect(pl.prev()).toBe(2);
    pl.setRepeat('one');
    expect(pl.peekNext()).toBe(2);
    expect(pl.peekNext(2, true)).toBe(0);
  });
  test('shuffle plays every track exactly once before repeating (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60 }), fc.integer({ min: 1, max: 1e6 }), (n, seed) => {
        const pl = make(n, seed);
        pl.setCurrent(0);
        pl.setShuffle(true);
        const seen = [pl.current];
        for (let i = 1; i < n; i++) seen.push(pl.next());
        expect(new Set(seen).size).toBe(n);
        expect(pl.next()).toBe(-1); // end of a round without repeat
      }),
    );
  });
  test('move, remove, crop, duplicates and sort keep the current track', () => {
    const pl = make(5);
    pl.setCurrent(2);
    const cur = pl.currentEntry!;
    pl.select((_, i) => i === 0 || i === 1);
    pl.moveSelected(2);
    expect(pl.entries.map((e) => e.location.slice(-5))).toEqual([
      '2.mp3',
      '3.mp3',
      '0.mp3',
      '1.mp3',
      '4.mp3',
    ]);
    expect(pl.currentEntry).toBe(cur);
    pl.add([{ location: 'C:\\Music\\4.mp3' }]);
    pl.removeDuplicates();
    expect(pl.length).toBe(5);
    pl.sortBy((e) => e.location);
    expect(pl.entries[0]!.location).toContain('0.mp3');
    expect(pl.currentEntry).toBe(cur);
    pl.select((e) => e === cur);
    pl.crop();
    expect(pl.length).toBe(1);
    expect(pl.current).toBe(0);
  });
  test('titles, durations and search', () => {
    expect(displayTitle({ id: 0, location: 'D:\\x\\My%20Song.flac' })).toBe('My Song');
    expect(displayTitle({ id: 0, location: 'a.mp3', info: { artist: 'A', title: 'T' } })).toBe('A - T');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(formatTime(65)).toBe('1:05');
    const pl = make(20);
    expect(pl.search('1 mp3')).toContain(1);
  });
  test('performance: 100,000 entries add, sort and search quickly', () => {
    const pl = new Playlist();
    const t0 = performance.now();
    pl.add(
      Array.from({ length: 100_000 }, (_, i) => ({
        location: `D:\\Music\\Artist ${i % 977}\\Track ${i}.mp3`,
      })),
    );
    pl.sortBy((e) => e.location);
    pl.search('artist 12 track');
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe('playlist formats', () => {
  const items = [
    { location: 'C:\\Music\\Ünïcode – song.mp3', title: 'Artist - Ünïcode', durationSec: 245 },
    { location: '..\\other\\b.flac', title: undefined, durationSec: undefined },
    { location: 'http://radio.example/stream', title: 'Radio', durationSec: undefined },
  ];
  test('M3U round-trip', () => {
    const back = parseM3u(writeM3u(items));
    expect(back.map((b) => b.location)).toEqual(items.map((i) => i.location));
    expect(back[0]).toMatchObject({ title: 'Artist - Ünïcode', durationSec: 245 });
  });
  test('PLS round-trip', () => {
    const back = parsePls(writePls(items));
    expect(back.map((b) => b.location)).toEqual(items.map((i) => i.location));
    expect(back[0]!.durationSec).toBe(245);
  });
  test('XSPF round-trip (paths become file:// URIs and back)', () => {
    const back = parseXspf(writeXspf(items));
    expect(back[0]!.location).toBe(items[0]!.location);
    expect(back[2]!.location).toBe('http://radio.example/stream');
    expect(back[0]!.durationSec).toBe(245);
  });
  test('B4S load', () => {
    const b = parseB4s(
      '<?xml?><WinampXML><playlist><entry Playstring="file:C:\\a.mp3"><Name>A &amp; B</Name><Length>1000</Length></entry></playlist></WinampXML>',
    );
    expect(b).toEqual([{ location: 'C:\\a.mp3', title: 'A & B', durationSec: 1 }]);
  });
  test('round-trip property: random titles and paths survive M3U and PLS', () => {
    const safe = fc
      .string({ minLength: 1, maxLength: 30 })
      .map((s) => s.replace(/[\r\n=#,<>&"]/g, '_').trim() || 'x');
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ location: safe, title: safe, durationSec: fc.integer({ min: 0, max: 99999 }) }),
          { maxLength: 30 },
        ),
        (list) => {
          expect(parseM3u(writeM3u(list))).toEqual(list);
          expect(parsePls(writePls(list))).toEqual(list);
        },
      ),
    );
  });
  test('relative paths resolve against the playlist folder', () => {
    expect(resolveLocation('..\\other\\b.flac', 'D:\\Music\\lists\\x.m3u')).toBe('D:\\Music\\other\\b.flac');
    expect(resolveLocation('song.mp3', 'D:\\Music\\x.m3u')).toBe('D:\\Music\\song.mp3');
    expect(resolveLocation('http://a/b', 'D:\\x.m3u')).toBe('http://a/b');
  });
  test('old ANSI .m3u files decode as Windows-1252', () => {
    expect(decodePlaylistBytes(new Uint8Array([0x63, 0x61, 0x66, 0xe9]), 'a.m3u')).toBe('café');
  });
  const ref = 'D:/Dev/winamp/Build/Winamp_x86_Release/Winamp.m3u8';
  test.runIf(existsSync(ref))('reads the playlist saved by the reference build', () => {
    const text = decodePlaylistBytes(new Uint8Array(readFileSync(ref)), ref);
    const list = parsePlaylist(ref, text);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((i) => i.location.length > 0)).toBe(true);
  });
});
