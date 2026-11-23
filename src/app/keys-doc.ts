/** The keyboard shortcut list as Markdown (docs/KEYS.md), grouped by the window the keys work in. */
import { SHORTCUTS, type Shortcut } from './keys';
import type { WindowId } from '../ui/window';

const ALL: WindowId[] = ['main', 'eq', 'pl', 'video', 'visual'];

function group(s: Shortcut): string {
  const w = s.in;
  if (ALL.every((x) => w.includes(x))) return 'Everywhere';
  if (w.length === 1)
    return {
      main: 'Main window',
      eq: 'Equalizer window',
      pl: 'Playlist window',
      video: 'Video window',
      visual: 'Visualization window',
    }[w[0]!];
  if (w.includes('video') && w.includes('visual') && w.length === 2) return 'Video and visualization windows';
  const names = { main: 'main', eq: 'equalizer', pl: 'playlist', video: 'video', visual: 'visualization' };
  const missing = ALL.filter((x) => !w.includes(x));
  return `Everywhere except the ${missing.map((m) => names[m]).join(' and ')} window${missing.length > 1 ? 's' : ''}`;
}

export function keysMarkdown(): string {
  const groups = new Map<string, Shortcut[]>();
  for (const s of SHORTCUTS) {
    const g = group(s);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(s);
  }
  const order = (g: string) => (g === 'Everywhere' ? 0 : g.startsWith('Everywhere') ? 1 : 2);
  const out = [
    '# RevAmp keyboard shortcuts',
    '',
    "The classic player's keys. Keys follow the physical key position, so they work on any keyboard layout;",
    '`Num` means the number pad. Some keys mean something else while the playlist, equalizer or video window has',
    'focus. Esc leaves fullscreen.',
    '',
    '_This file is made from `src/app/keys.ts` by `npm run docs:keys`._',
  ];
  for (const [g, list] of [...groups].sort((a, b) => order(a[0]) - order(b[0]))) {
    out.push('', `## ${g}`, '', '| Keys | Does |', '| --- | --- |');
    for (const s of list) out.push(`| ${s.keys.map((k) => `\`${k}\``).join(', ')} | ${s.label} |`);
  }
  return out.join('\n') + '\n';
}
