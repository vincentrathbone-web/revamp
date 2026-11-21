// Downloads a local corpus of community skins from the Internet Archive for robustness tests.
// Skins are NOT committed (test-assets/skins is git-ignored). Usage: node scripts/fetch-skin-corpus.mjs [count]
import { mkdirSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const want = Number(process.argv[2] ?? 200);
const OUT = join(process.cwd(), 'test-assets', 'skins', 'corpus');
mkdirSync(OUT, { recursive: true });
const have = new Set(readdirSync(OUT));
const UA = { 'User-Agent': 'revamp-test-corpus/0.1' };

const search = await (
  await fetch(
    `https://archive.org/advancedsearch.php?q=collection%3Awinampskins&fl%5B%5D=identifier&rows=${want * 2}&page=3&output=json`,
    { headers: UA },
  )
).json();
const ids = search.response.docs.map((d) => d.identifier);
let got = have.size;
let i = 0;

async function worker() {
  while (got < want && i < ids.length) {
    const id = ids[i++];
    try {
      const meta = await (await fetch(`https://archive.org/metadata/${id}`, { headers: UA })).json();
      const f = (meta.files ?? []).find((x) => /\.wsz$/i.test(x.name) && Number(x.size ?? 0) < 3_000_000);
      if (!f) continue;
      const name = `${id}.wsz`.replace(/[^\w.-]/g, '_');
      if (existsSync(join(OUT, name))) continue;
      const r = await fetch(`https://archive.org/download/${id}/${encodeURIComponent(f.name)}`, {
        headers: UA,
      });
      if (!r.ok) continue;
      writeFileSync(join(OUT, name), new Uint8Array(await r.arrayBuffer()));
      got++;
      if (got % 20 === 0) console.log(`${got} skins`);
    } catch (e) {
      console.warn(`skip ${id}: ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`Done: ${got} skins in ${OUT}`);
