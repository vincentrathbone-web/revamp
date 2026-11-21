// Fails if any installed package uses a license that is not compatible with shipping RevAmp under MIT.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Apache-2.0',
  'Zlib',
  'CC0-1.0',
  'Unlicense',
  'BlueOak-1.0.0',
  'Python-2.0',
  'CC-BY-4.0',
  'MPL-2.0',
]);

const root = join(process.cwd(), 'node_modules');
const bad = [];
let count = 0;

function licenseOf(pkg) {
  let l = pkg.license ?? pkg.licenses;
  if (Array.isArray(l)) l = l.map((x) => x.type ?? x).join(' OR ');
  if (l && typeof l === 'object') l = l.type;
  return String(l ?? 'UNKNOWN');
}

function ok(expr) {
  const clean = expr.replace(/[()]/g, '');
  if (clean.includes(' OR ')) return clean.split(' OR ').some((p) => ok(p.trim()));
  if (clean.includes(' AND ')) return clean.split(' AND ').every((p) => ok(p.trim()));
  return ALLOWED.has(clean.trim());
}

function visit(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const p = join(dir, name);
    if (name.startsWith('@')) {
      visit(p);
      continue;
    }
    const pj = join(p, 'package.json');
    if (existsSync(pj)) {
      const pkg = JSON.parse(readFileSync(pj, 'utf8'));
      count++;
      const lic = licenseOf(pkg);
      if (!ok(lic)) bad.push(`${pkg.name}@${pkg.version}: ${lic}`);
      visit(join(p, 'node_modules'));
    }
  }
}

visit(root);
if (bad.length) {
  console.error(`License check failed (${bad.length} of ${count} packages):\n  ` + bad.join('\n  '));
  process.exit(1);
}
console.log(`License check OK: ${count} packages, all MIT-compatible.`);
