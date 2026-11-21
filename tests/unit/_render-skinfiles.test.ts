// Dev helper (not part of the suite's checks): renders .wsz files from SKIN_DIR into PNGs in SKIN_OUT.
import { test } from 'vitest';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from '../../src/skin/png';
import { skinFromArchive } from '../../src/skin/skin';
import { defaultSkin } from '../../src/skin/default-skin';
import { fakeUi, windowsFor } from './fake-ui';

test.skipIf(!process.env['SKIN_DIR'])('render skin files', () => {
  const dir = process.env['SKIN_DIR']!;
  const out = process.env['SKIN_OUT']!;
  mkdirSync(out, { recursive: true });
  for (const f of readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.wsz'))) {
    const skin = skinFromArchive(f, new Uint8Array(readFileSync(join(dir, f))), defaultSkin());
    const { ui } = fakeUi(skin, { plSize: { w: 275, h: 145 } });
    const w = windowsFor(ui);
    for (const id of ['main', 'eq', 'pl'] as const) {
      w[id].render(true);
      writeFileSync(join(out, `${f.replace(/\.wsz$/i, '')}-${id}.png`), encodePng(w[id].surface));
    }
  }
});
