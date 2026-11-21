// Dev helper: renders the studio skin designs (main / EQ / playlist, normal + shade) to PNGs in STUDIO_OUT.
import { test } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from '../../src/skin/png';
import { DESIGNS, designSkin } from '../../src/skin/studio/designs';
import { fakeUi, windowsFor } from './fake-ui';

test.skipIf(!process.env['STUDIO_OUT'])('render studio designs', () => {
  const out = process.env['STUDIO_OUT']!;
  const only = process.env['STUDIO_ONLY'];
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, 'designs.json'),
    JSON.stringify(DESIGNS.map(({ id, name, description }) => ({ id, name, description }))),
  );
  for (const d of DESIGNS) {
    if (only && !only.split(',').includes(d.id)) continue;
    const skin = designSkin(d.id)!;
    for (const shade of [false, true]) {
      const { ui } = fakeUi(skin, {
        shade: { main: shade, eq: shade, pl: shade },
        plSize: { w: 275, h: 145 },
      });
      const w = windowsFor(ui);
      for (const id of ['main', 'eq', 'pl'] as const) {
        w[id].render(true);
        writeFileSync(join(out, `${d.id}-${id}${shade ? '-shade' : ''}.png`), encodePng(w[id].surface));
      }
    }
  }
});
