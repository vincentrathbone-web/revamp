import type { Preset } from './eq';

/**
 * Classic EQ preset files (.eqf = one or more presets, .q1 = preset library). Same binary layout:
 *   31-byte header, then per preset: 257-byte zero-padded name + 11 bytes (10 bands, then preamp).
 * Each value byte is 0..63 where 0 = +12 dB, 31 = 0 dB and 63 = -12 dB.
 * (Layout measured from files; the header text is required for other players to accept the file.)
 */
const HEADER = 'Winamp EQ library file v1.1\x1a!--';
const NAME_LEN = 257;
const ENTRY_LEN = NAME_LEN + 11;

export function byteToDb(b: number): number {
  const v = Math.max(0, Math.min(63, b));
  return v <= 31 ? ((31 - v) / 31) * 12 : ((31 - v) / 32) * 12;
}

export function dbToByte(db: number): number {
  const d = Math.max(-12, Math.min(12, db));
  return d >= 0 ? Math.round(31 - (d / 12) * 31) : Math.round(31 - (d / 12) * 32);
}

export class EqfError extends Error {}

export function parseEqf(data: Uint8Array): Preset[] {
  if (data.length < HEADER.length) throw new EqfError('File too short');
  const head = String.fromCharCode(...data.subarray(0, HEADER.length));
  if (!head.startsWith('Winamp EQ library file')) throw new EqfError('Not an EQ preset file');
  const out: Preset[] = [];
  for (let o = HEADER.length; o + ENTRY_LEN <= data.length; o += ENTRY_LEN) {
    const nameBytes = data.subarray(o, o + NAME_LEN);
    const end = nameBytes.indexOf(0);
    const name = new TextDecoder('latin1').decode(nameBytes.subarray(0, end < 0 ? NAME_LEN : end));
    const v = data.subarray(o + NAME_LEN, o + ENTRY_LEN);
    out.push({
      name,
      bandsDb: Array.from(v.subarray(0, 10), byteToDb),
      preampDb: byteToDb(v[10]!),
    });
  }
  return out;
}

export function writeEqf(presets: Preset[]): Uint8Array {
  const out = new Uint8Array(HEADER.length + presets.length * ENTRY_LEN);
  for (let i = 0; i < HEADER.length; i++) out[i] = HEADER.charCodeAt(i);
  presets.forEach((p, idx) => {
    const o = HEADER.length + idx * ENTRY_LEN;
    const name = p.name.slice(0, NAME_LEN - 1);
    for (let i = 0; i < name.length; i++) {
      const c = name.charCodeAt(i);
      out[o + i] = c < 256 ? c : 63; // '?' for characters outside latin-1
    }
    for (let b = 0; b < 10; b++) out[o + NAME_LEN + b] = dbToByte(p.bandsDb[b] ?? 0);
    out[o + NAME_LEN + 10] = dbToByte(p.preampDb);
  });
  return out;
}
