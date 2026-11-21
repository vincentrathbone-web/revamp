// Fails the build if anything that must never ship ends up in dist/ (third-party skins, test audio).
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const banned = /\.(wsz|wal|zip|mp3|flac|ogg|opus|m4a|wav)$/i;
const bad = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (banned.test(f)) bad.push(p);
  }
};
walk('dist');
if (bad.length) {
  console.error('These files must not be in the build:\n  ' + bad.join('\n  '));
  process.exit(1);
}
console.log('dist check OK: no skins or audio files bundled.');
