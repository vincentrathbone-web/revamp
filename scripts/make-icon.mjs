// Draws RevAmp's app icon (original art: amber ring + play symbol on graphite) as a 1024x1024 PNG.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const S = 1024,
  SS = 4; // 4x4 supersampling
const px = new Uint8Array(S * S * 4);
const graphite = [35, 38, 45],
  edge = [58, 63, 73],
  amber = [240, 166, 64],
  amberDark = [196, 120, 30];

function sample(x, y) {
  // rounded square
  const r = 200,
    m = 40;
  const qx = Math.max(m + r - x, 0, x - (S - m - r)),
    qy = Math.max(m + r - y, 0, y - (S - m - r));
  const d = Math.hypot(qx, qy);
  if (d > r) return null;
  const cx = S / 2,
    cy = S / 2;
  const dist = Math.hypot(x - cx, y - cy);
  // ring
  if (dist > 300 && dist < 360) return dist < 330 ? amber : amberDark;
  // play triangle
  const tx = x - cx + 30,
    ty = y - cy;
  if (tx > -120 && tx < 190 && Math.abs(ty) < (190 - tx) * 0.62) return amber;
  // body with subtle top highlight and border
  if (d > r - 14) return edge;
  const t = y / S;
  return graphite.map((c) => Math.round(c + 14 * (1 - t)));
}

for (let y = 0; y < S; y++)
  for (let x = 0; x < S; x++) {
    let r = 0,
      g = 0,
      b = 0,
      a = 0;
    for (let j = 0; j < SS; j++)
      for (let i = 0; i < SS; i++) {
        const c = sample(x + (i + 0.5) / SS, y + (j + 0.5) / SS);
        if (c) ((r += c[0]), (g += c[1]), (b += c[2]), a++);
      }
    const o = (y * S + x) * 4;
    if (a) ((px[o] = r / a), (px[o + 1] = g / a), (px[o + 2] = b / a));
    px[o + 3] = Math.round((a / (SS * SS)) * 255);
  }

const crcT = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b) => {
  let c = 0xffffffff;
  for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1);
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
mkdirSync('assets', { recursive: true });
writeFileSync('assets/icon.png', png);
console.log('wrote assets/icon.png');
