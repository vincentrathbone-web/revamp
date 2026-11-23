// Downloads a local corpus of community skins from the Internet Archive for robustness tests.
// Skins are NOT committed (test-assets/skins is git-ignored). Usage: node scripts/fetch-skin-corpus.mjs [count]
// Picks skins spread evenly over the whole "winampskins" collection (not just one page), so the corpus covers
// many years and authors. Re-running tops the folder up to `count`; skins already there are kept.
import { mkdirSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const want = Number(process.argv[2] ?? 200);
const OUT = join(process.cwd(), 'test-assets', 'skins', 'corpus');
mkdirSync(OUT, { recursive: true });
const UA = { 'User-Agent': 'revamp-test-corpus/0.2' };
const WORKERS = 8;

/** All identifiers in the collection, via the scrape API (paged with a cursor). */
async function allIds() {
  const ids = [];
  let cursor = '';
  for (;;) {
    const url =
      'https://archive.org/services/search/v1/scrape?q=collection%3Awinampskins&fields=identifier&count=10000' +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const r = await (await fetch(url, { headers: UA })).json();
    for (const it of r.items ?? []) ids.push(it.identifier);
    if (!r.cursor) break;
    cursor = r.cursor;
  }
  return ids.sort();
}

const ids = await allIds();
console.log(`${ids.length} skins in the collection`);
const have = new Set(readdirSync(OUT));
let got = have.size;
// spread the picks evenly over the sorted list, so a bigger count adds new skins in between
const order = [];
const step = Math.max(1, ids.length / Math.max(want * 1.6, 1));
for (let f = 0; f < ids.length && order.length < want * 1.6; f += step) order.push(ids[Math.floor(f)]);
let i = 0;
let failed = 0;

async function worker() {
  while (got < want && i < order.length) {
    const id = order[i++];
    const name = `${id}.wsz`.replace(/[^\w.-]/g, '_');
    if (have.has(name) || existsSync(join(OUT, name))) continue;
    try {
      const meta = await (await fetch(`https://archive.org/metadata/${id}`, { headers: UA })).json();
      const f = (meta.files ?? []).find(
        (x) => /\.(wsz|zip)$/i.test(x.name) && Number(x.size ?? 0) < 3_000_000,
      );
      if (!f) continue;
      const r = await fetch(`https://archive.org/download/${id}/${encodeURIComponent(f.name)}`, {
        headers: UA,
      });
      if (!r.ok) {
        failed++;
        continue;
      }
      writeFileSync(join(OUT, name), new Uint8Array(await r.arrayBuffer()));
      got++;
      if (got % 100 === 0) console.log(`${got} skins`);
    } catch (e) {
      failed++;
      console.warn(`skip ${id}: ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: WORKERS }, worker));
console.log(`Done: ${got} skins in ${OUT} (${failed} failed)`);
