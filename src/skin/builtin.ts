/**
 * The skins that ship inside RevAmp: the Graphite default plus the studio designs. A built-in skin is remembered
 * in settings as `revamp:<id>` (Graphite is remembered as no skin at all).
 */
import { defaultSkin } from './default-skin';
import type { Skin } from './skin';
import { DESIGNS, designSkin } from './studio/designs';

const PREFIX = 'revamp:';

/** The studio designs, in menu order. */
export const BUILTIN_SKINS: readonly { id: string; name: string }[] = DESIGNS.map(({ id, name }) => ({
  id,
  name,
}));

/** The location a built-in skin is remembered by. */
export const builtinLocation = (id: string): string => PREFIX + id;

/** Whether a remembered skin location names a built-in skin. */
export const isBuiltinLocation = (location: string): boolean => location.startsWith(PREFIX);

/** The built-in skin a location names (painted on first use, then cached), or null if there is none. */
export function builtinSkin(location: string): Skin | null {
  if (!isBuiltinLocation(location)) return null;
  const id = location.slice(PREFIX.length);
  return id === 'graphite' ? defaultSkin() : designSkin(id);
}
