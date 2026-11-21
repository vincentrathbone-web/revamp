// Generates reproducible test audio in test-assets/generated/.
// WAV files are written by this script; other formats are encoded with ffmpeg if it is available
// (set FFMPEG=path, default D:\Dev\toolshed\ffmpeg-full\...\ffmpeg.exe, else "ffmpeg" on PATH).
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const OUT = join(process.cwd(), 'test-assets', 'generated');
mkdirSync(OUT, { recursive: true });

function wav(channels, rate, bits = 16) {
  const n = channels[0].length;
  const bps = bits / 8;
  const dataLen = n * channels.length * bps;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels.length, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * channels.length * bps, 28);
  buf.writeUInt16LE(channels.length * bps, 32);
  buf.writeUInt16LE(bits, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  let o = 44;
  const max = 2 ** (bits - 1) - 1;
  for (let i = 0; i < n; i++) {
    for (const ch of channels) {
      const v = Math.max(-1, Math.min(1, ch[i]));
      const s = Math.round(v * max);
      if (bits === 16) buf.writeInt16LE(s, o);
      else buf.writeIntLE(s, o, 3);
      o += bps;
    }
  }
  return buf;
}

const amp = 10 ** (-6 / 20); // -6 dBFS
function tone(freq, secs, rate, a = amp, phase = 0) {
  const n = Math.round(secs * rate);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = a * Math.sin(phase + (2 * Math.PI * freq * i) / rate);
  return x;
}
function concat(...parts) {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
}
const stereo = (x) => [x, x];

const files = {};
const R = 44100;

files['tone1k.wav'] = wav(stereo(tone(1000, 3, R)), R);
files['tone440-48k.wav'] = wav(stereo(tone(440, 3, 48000)), 48000);
files['tone1k-left.wav'] = wav([tone(1000, 2, R), new Float32Array(2 * R)], R);
files['tone1k-24bit.wav'] = wav(stereo(tone(1000, 2, R)), R, 24);
files['full-scale.wav'] = wav(stereo(tone(1000, 2, R, 1.0)), R);

{
  // log sweep 20 Hz -> 20 kHz over 5 s
  const n = 5 * R,
    f0 = 20,
    f1 = 20000,
    T = 5;
  const k = Math.log(f1 / f0);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / R;
    x[i] = amp * Math.sin(((2 * Math.PI * f0 * T) / k) * (Math.exp((t / T) * k) - 1));
  }
  files['sweep.wav'] = wav(stereo(x), R);
}

files['silence-padded.wav'] = wav(
  stereo(concat(new Float32Array(R), tone(1000, 2, R), new Float32Array(Math.round(1.5 * R)))),
  R,
);

{
  // One continuous 220 Hz sine, split at a sample that is not a zero crossing.
  const whole = tone(220, 4.3, R);
  const cut = Math.round(2.123 * R);
  files['gapless-a.wav'] = wav(stereo(whole.slice(0, cut)), R);
  files['gapless-b.wav'] = wav(stereo(whole.slice(cut)), R);
}

for (const [name, data] of Object.entries(files)) writeFileSync(join(OUT, name), data);

// Encoded formats
const candidates = [
  process.env.FFMPEG,
  'D:\\Dev\\toolshed\\ffmpeg-full\\ffmpeg-9.0.2-essentials_build\\bin\\ffmpeg.exe',
  'ffmpeg',
].filter(Boolean);
const ffmpeg = candidates.find((c) => c === 'ffmpeg' || existsSync(c));
const encodes = [
  ['tone1k.wav', 'tone1k.mp3', ['-c:a', 'libmp3lame', '-b:a', '192k']],
  ['tone1k.wav', 'tone1k.flac', ['-c:a', 'flac']],
  ['tone1k.wav', 'tone1k.ogg', ['-c:a', 'libvorbis', '-q:a', '5']],
  ['tone1k.wav', 'tone1k.opus', ['-c:a', 'libopus', '-b:a', '128k']],
  ['tone1k.wav', 'tone1k.m4a', ['-c:a', 'aac', '-b:a', '192k']],
  ['gapless-a.wav', 'gapless-a.flac', ['-c:a', 'flac']],
  ['gapless-b.wav', 'gapless-b.flac', ['-c:a', 'flac']],
  ['gapless-a.wav', 'gapless-a.mp3', ['-c:a', 'libmp3lame', '-b:a', '256k']],
  ['gapless-b.wav', 'gapless-b.mp3', ['-c:a', 'libmp3lame', '-b:a', '256k']],
];
const meta = [
  '-metadata',
  'title=Test Tone Ünïcode',
  '-metadata',
  'artist=RevAmp Lab',
  '-metadata',
  'album=Generated',
  '-metadata',
  'track=7',
  '-metadata',
  'date=2026',
  '-metadata',
  'genre=Test',
];
const rg = [
  '-metadata',
  'REPLAYGAIN_TRACK_GAIN=-3.50 dB',
  '-metadata',
  'REPLAYGAIN_TRACK_PEAK=0.501187',
  '-metadata',
  'REPLAYGAIN_ALBUM_GAIN=-5.25 dB',
];
encodes.push(
  [
    'tone1k.wav',
    'tagged.mp3',
    ['-c:a', 'libmp3lame', '-b:a', '128k', '-id3v2_version', '3', '-write_id3v1', '1', ...meta, ...rg],
  ],
  [
    'tone1k.wav',
    'tagged-v24.mp3',
    ['-c:a', 'libmp3lame', '-q:a', '4', '-id3v2_version', '4', ...meta, ...rg],
  ],
  ['tone1k.wav', 'tagged.flac', ['-c:a', 'flac', ...meta, ...rg]],
  ['tone1k.wav', 'tagged.ogg', ['-c:a', 'libvorbis', '-q:a', '4', ...meta, ...rg]],
  ['tone1k.wav', 'tagged.opus', ['-c:a', 'libopus', '-b:a', '96k', ...meta, ...rg]],
  ['tone1k.wav', 'tagged.m4a', ['-c:a', 'aac', '-b:a', '128k', ...meta]],
);
let encoded = 0;
for (const [src, dst, args] of encodes) {
  const r = spawnSync(
    ffmpeg,
    [
      '-y',
      '-v',
      'error',
      '-i',
      join(OUT, src),
      '-map_metadata',
      '-1',
      '-fflags',
      '+bitexact',
      '-map_chapters',
      '-1',
      '-flags:a',
      '+bitexact',
      ...args,
      join(OUT, dst),
    ],
    { encoding: 'utf8' },
  );
  if (r.status === 0) encoded++;
  else console.warn(`ffmpeg failed for ${dst}: ${r.error?.message ?? r.stderr}`);
}

const manifest = {};
for (const name of [...Object.keys(files), ...encodes.map((e) => e[1])]) {
  const p = join(OUT, name);
  if (existsSync(p)) manifest[name] = createHash('sha256').update(readFileSync(p)).digest('hex');
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Wrote ${Object.keys(files).length} WAV files and ${encoded} encoded files to ${OUT}`);
