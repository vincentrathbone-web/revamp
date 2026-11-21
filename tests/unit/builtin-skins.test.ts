import { describe, expect, it } from 'vitest';
import { BUILTIN_SKINS, builtinLocation, builtinSkin, isBuiltinLocation } from '../../src/skin/builtin';
import { defaultSkin } from '../../src/skin/default-skin';

describe('built-in skins', () => {
  it('lists all ten studio designs with unique ids and names', () => {
    expect(BUILTIN_SKINS).toHaveLength(10);
    expect(new Set(BUILTIN_SKINS.map((s) => s.id)).size).toBe(10);
    expect(new Set(BUILTIN_SKINS.map((s) => s.name)).size).toBe(10);
  });

  it('remembers built-ins by a revamp: location that file paths and URLs never match', () => {
    expect(builtinLocation('meridian')).toBe('revamp:meridian');
    expect(isBuiltinLocation('revamp:meridian')).toBe(true);
    for (const loc of ['D:\\Skins\\cool.wsz', 'https://example.com/a.wsz', '/dev-skins/a.wsz'])
      expect(isBuiltinLocation(loc)).toBe(false);
  });

  it('paints each design once and returns the same skin after that', () => {
    for (const { id, name } of BUILTIN_SKINS) {
      const skin = builtinSkin(builtinLocation(id));
      expect(skin?.name).toBe(name);
      expect(builtinSkin(builtinLocation(id))).toBe(skin);
      expect(skin!.sheets.main).toBeTruthy();
    }
  }, 30_000); // painting all ten takes about a second alone, longer while the whole suite runs

  it('maps graphite to the default skin and unknown ids to null', () => {
    expect(builtinSkin('revamp:graphite')).toBe(defaultSkin());
    expect(builtinSkin('revamp:nope')).toBeNull();
    expect(builtinSkin('D:\\Skins\\cool.wsz')).toBeNull();
  });
});
