import { describe, expect, it } from 'vitest';
import { chordOf, conflicts, findShortcut, keyName, SHORTCUTS } from '../../src/app/keys';
import { codecsFromInit } from '../../src/audio/convert';

const ev = (
  code: string,
  key: string,
  mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {},
) =>
  ({ code, key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods }) as KeyboardEvent;

describe('classic shortcuts', () => {
  it('has no two shortcuts on the same key in the same window', () => {
    expect(conflicts()).toEqual([]);
  });

  it('names keys by their physical place', () => {
    expect(keyName('KeyZ', 'y')).toBe('Z'); // German layout: still the Z place
    expect(keyName('Numpad3', 'PageDown')).toBe('Num3');
    expect(keyName('Digit3', '#')).toBe('3');
    expect(keyName('ArrowLeft', 'ArrowLeft')).toBe('Left');
    expect(chordOf(ev('KeyV', 'V', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+V');
  });

  it.each([
    ['Z', 'main', /prev/i],
    ['Ctrl+Z', 'main', /first/i],
    ['Shift+Z', 'main', /back|rewind/i],
    ['Ctrl+B', 'main', /last/i],
    ['Shift+B', 'main', /forward|ahead/i],
    ['Ctrl+V', 'main', /after/i],
    ['Shift+V', 'main', /fade/i],
    ['Num3', 'main', /10/],
    ['1', 'eq', /band|raise|up/i],
    ['Alt+G', 'pl', /equali/i],
  ] as const)('%s in %s', (chord, where, label) => {
    expect(findShortcut(chord, where)?.label).toMatch(label);
  });

  it('every listed shortcut is found where it is meant to work', () => {
    for (const s of SHORTCUTS)
      for (const k of s.keys) for (const w of s.in) expect(findShortcut(k, w)).toBe(s);
  });
});

describe('converter stream type', () => {
  const box = (type: string, ...kids: Uint8Array[]) => {
    const body = kids.reduce((n, k) => n + k.length, 0);
    const out = new Uint8Array(8 + body);
    new DataView(out.buffer).setUint32(0, 8 + body);
    out.set(
      [...type].map((c) => c.charCodeAt(0)),
      4,
    );
    let p = 8;
    for (const k of kids) (out.set(k, p), (p += k.length));
    return out;
  };
  const raw = (n: number) => new Uint8Array(n);
  const trak = (entry: Uint8Array) =>
    box('trak', box('mdia', box('minf', box('stbl', box('stsd', raw(8), entry)))));

  it('leaves out chapter text tracks, which would make the player refuse the stream', () => {
    const init = box('moov', trak(box('mp4a', raw(28))), trak(box('text', raw(8))));
    expect(codecsFromInit(init)).toEqual(['mp4a.40.2']);
  });
});
