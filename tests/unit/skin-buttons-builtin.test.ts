/** Every button on RevAmp's own skins (Graphite and the studio designs). Unlike third-party skins, these always run. */
import { expect, test } from 'vitest';
import { BUILTIN_SKINS, builtinLocation, builtinSkin } from '../../src/skin/builtin';
import { checkSkin } from './skin-buttons-suite';

test.each([['graphite'], ...BUILTIN_SKINS.map((s) => [s.id])])(
  'every button works on %s',
  (id) => {
    expect(checkSkin(builtinSkin(builtinLocation(id))!, true)).toEqual([]);
  },
  30_000,
);
