// Merges the reports written by the "every button on every skin" test (tests/unit/skin-buttons-*.test.ts)
// and prints a summary. Usage: node scripts/skin-report.mjs [--json]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'test-assets');
const parts = existsSync(dir) ? readdirSync(dir).filter((f) => /^skin-button-report-\d+\.json$/.test(f)) : [];
const all = { skins: 0, loadFailures: {}, problems: {}, noPressArt: {}, invisibleArt: {}, warnings: {} };
for (const f of parts) {
  const r = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  all.skins += r.skins;
  Object.assign(all.loadFailures, r.loadFailures);
  Object.assign(all.problems, r.problems);
  for (const k of ['noPressArt', 'invisibleArt', 'warnings'])
    for (const [a, n] of Object.entries(r[k] ?? {})) all[k][a] = (all[k][a] ?? 0) + n;
}
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(all, null, 2));
  process.exit(0);
}
const top = (o, n = 12) =>
  Object.entries(o)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `    ${String(v).padStart(5)}  ${k}`)
    .join('\n');
console.log(`Skins tested: ${all.skins}`);
console.log(`Could not be opened: ${Object.keys(all.loadFailures).length}`);
for (const [k, v] of Object.entries(all.loadFailures)) console.log(`    ${k}: ${v}`);
console.log(`Skins with a broken control: ${Object.keys(all.problems).length}`);
for (const [k, v] of Object.entries(all.problems)) console.log(`    ${k}\n      ${v.join('\n      ')}`);
console.log(`Hidden by the skin's own art (works, but can't be seen):\n${top(all.invisibleArt)}`);
console.log(`Buttons drawn the same pressed and released (skin art):\n${top(all.noPressArt)}`);
console.log(`Missing pictures (default art used):\n${top(all.warnings)}`);
