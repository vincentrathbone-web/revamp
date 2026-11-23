/**
 * QA run, keyboard part: presses the classic shortcuts on the real page (as key events, the way Windows
 * delivers them) and checks that each one does what it should. Keys that open file pickers or menus are only
 * checked for being recognised, so the run never waits on a system dialog.
 */
import type { App } from '../app/app';
import { chordOf, conflicts, findShortcut, SHORTCUTS } from '../app/keys';
import type { WindowId } from '../ui/window';
import type { FileRef } from './platform';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Turns "Ctrl+Shift+Z" / "Num3" / "Left" into the KeyboardEvent the browser would send. */
function eventFor(chord: string): KeyboardEventInit {
  const parts = chord.split('+');
  const name = parts.pop()!;
  let code: string, key: string;
  if (/^[A-Z]$/.test(name)) ((code = `Key${name}`), (key = name.toLowerCase()));
  else if (/^\d$/.test(name)) ((code = `Digit${name}`), (key = name));
  else if (/^Num\d$/.test(name)) ((code = `Numpad${name.slice(3)}`), (key = name.slice(3)));
  else if (name === 'NumDecimal') ((code = 'NumpadDecimal'), (key = '.'));
  else if (['Left', 'Right', 'Up', 'Down'].includes(name)) ((code = `Arrow${name}`), (key = `Arrow${name}`));
  else if (name === '`') ((code = 'Backquote'), (key = '`'));
  else if (name === 'Space') ((code = 'Space'), (key = ' '));
  else ((code = name), (key = name));
  return {
    code,
    key,
    ctrlKey: parts.includes('Ctrl'),
    altKey: parts.includes('Alt'),
    shiftKey: parts.includes('Shift'),
    bubbles: true,
    cancelable: true,
  };
}

function press(app: App, chord: string, where: WindowId): void {
  app.host.focus(where);
  window.dispatchEvent(new KeyboardEvent('keydown', eventFor(chord)));
}

export async function checkKeys(
  app: App,
  refs: FileRef[],
  problems: string[],
): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = {};
  const clash = conflicts();
  data.conflicts = clash;
  if (clash.length) problems.push(`shortcut clashes: ${clash.join('; ')}`);

  // 1. every shortcut is recognised in each window it is meant for
  const notFound: string[] = [];
  let checked = 0;
  for (const s of SHORTCUTS)
    for (const k of s.keys)
      for (const w of s.in) {
        checked++;
        if (findShortcut(chordOf(eventFor(k) as KeyboardEvent), w) !== s) notFound.push(`${k} in ${w}`);
      }
  data.recognised = `${checked - notFound.length} of ${checked}`;
  if (notFound.length) problems.push(`not recognised: ${notFound.join(', ')}`);

  // 2. what the keys do, with a real playlist
  if (refs.length < 3) {
    problems.push('keys case needs at least 3 files');
    return data;
  }
  const effects: Record<string, string> = {};
  const expect = (label: string, ok: boolean, detail: string) => {
    effects[label] = (ok ? 'ok: ' : 'FAIL: ') + detail;
    if (!ok) problems.push(`${label}: ${detail}`);
  };
  await app.addFiles(refs, true, true);
  await sleep(1500);
  const n = app.playlist.length;
  const at = () => app.playlist.current;
  const settle = () => sleep(700);

  press(app, 'B', 'main');
  await settle();
  expect('B next', at() === 1, `track ${at()}`);
  press(app, 'Z', 'main');
  await settle();
  expect('Z previous', at() === 0, `track ${at()}`);
  press(app, 'Ctrl+B', 'main');
  await settle();
  expect('Ctrl+B last track', at() === n - 1, `track ${at()} of ${n}`);
  press(app, 'Ctrl+Z', 'main');
  await settle();
  expect('Ctrl+Z first track', at() === 0, `track ${at()}`);
  press(app, 'C', 'main');
  await settle();
  expect('C pause', app.engine.state === 'paused', app.engine.state);
  press(app, 'C', 'main');
  await settle();
  expect('C again resumes', app.engine.state === 'playing', app.engine.state);
  await sleep(1500);

  let p0 = app.engine.position;
  press(app, 'Right', 'main');
  await sleep(300);
  expect(
    'Right +5 s',
    app.engine.position - p0 > 3.5,
    `${p0.toFixed(1)} → ${app.engine.position.toFixed(1)}`,
  );
  p0 = app.engine.position;
  press(app, 'Left', 'main');
  await sleep(300);
  expect('Left −5 s', p0 - app.engine.position > 3.5, `${p0.toFixed(1)} → ${app.engine.position.toFixed(1)}`);
  p0 = app.engine.position;
  press(app, 'Shift+B', 'main');
  await sleep(300);
  expect(
    'Shift+B +5 s',
    app.engine.position - p0 > 3.5,
    `${p0.toFixed(1)} → ${app.engine.position.toFixed(1)}`,
  );
  p0 = app.engine.position;
  press(app, 'Shift+Z', 'main');
  await sleep(300);
  expect(
    'Shift+Z −5 s',
    p0 - app.engine.position > 3.5,
    `${p0.toFixed(1)} → ${app.engine.position.toFixed(1)}`,
  );

  const vol = app.settings.audio.chain.volume;
  app.setVolume(0.5);
  press(app, 'Up', 'main');
  expect('Up volume', app.settings.audio.chain.volume > 0.5, `${app.settings.audio.chain.volume}`);
  press(app, 'Down', 'main');
  press(app, 'Down', 'main');
  expect('Down volume', app.settings.audio.chain.volume < 0.5, `${app.settings.audio.chain.volume}`);
  app.setVolume(vol);

  const rep = app.settings.repeat;
  press(app, 'R', 'main');
  expect('R repeat', app.settings.repeat !== rep, `${rep} → ${app.settings.repeat}`);
  press(app, 'R', 'main');
  press(app, 'R', 'main');
  const sh = app.settings.shuffle;
  press(app, 'S', 'main');
  expect('S shuffle', app.settings.shuffle !== sh, `${sh} → ${app.settings.shuffle}`);
  press(app, 'S', 'main');

  press(app, 'Ctrl+V', 'main');
  expect('Ctrl+V stop after current', app.stopAfterCurrent, String(app.stopAfterCurrent));
  press(app, 'Ctrl+V', 'main');
  const ma = app.settings.manualAdvance;
  press(app, 'Shift+R', 'main');
  expect('Shift+R manual advance', app.settings.manualAdvance !== ma, String(app.settings.manualAdvance));
  press(app, 'Shift+R', 'main');

  const eqVis = app.host.isVisible('eq');
  press(app, 'Alt+G', 'main');
  await sleep(100);
  expect('Alt+G equalizer', app.host.isVisible('eq') !== eqVis, `visible ${app.host.isVisible('eq')}`);
  press(app, 'Alt+G', 'main');
  const plVis = app.host.isVisible('pl');
  press(app, 'Alt+E', 'main');
  await sleep(100);
  expect('Alt+E playlist', app.host.isVisible('pl') !== plVis, `visible ${app.host.isVisible('pl')}`);
  press(app, 'Alt+E', 'main');
  await sleep(100);

  // equalizer window keys
  const eq0 = structuredClone(app.settings.audio.chain.eq);
  press(app, '1', 'eq');
  expect(
    'EQ 1 raises band 1',
    app.settings.audio.chain.eq.bandsDb[0]! > eq0.bandsDb[0]!,
    `${app.settings.audio.chain.eq.bandsDb[0]}`,
  );
  press(app, 'Q', 'eq');
  expect(
    'EQ Q lowers band 1',
    app.settings.audio.chain.eq.bandsDb[0] === eq0.bandsDb[0],
    `${app.settings.audio.chain.eq.bandsDb[0]}`,
  );
  press(app, 'N', 'eq');
  expect(
    'EQ N on/off',
    app.settings.audio.chain.eq.enabled !== eq0.enabled,
    `${app.settings.audio.chain.eq.enabled}`,
  );
  press(app, 'N', 'eq');

  // number pad jumps 10 tracks (fewer when the list is short)
  if (n > 2) {
    press(app, 'Ctrl+Z', 'main');
    await settle();
    press(app, 'Num3', 'main');
    await settle();
    expect('Num3 jump on', at() === Math.min(10, n - 1), `track ${at()}`);
    press(app, 'Num1', 'main');
    await settle();
    expect('Num1 jump back', at() === 0, `track ${at()}`);
  }

  // keys go on working while a non-blocking dialog is open
  app.about();
  await sleep(200);
  press(app, 'B', 'main');
  await settle();
  expect('keys work with a dialog open', at() === 1, `track ${at()}`);
  document.querySelectorAll('.rv-dialog-layer').forEach((l) => l.remove());

  press(app, 'V', 'main');
  await settle();
  expect('V stop', app.engine.state === 'stopped', app.engine.state);
  data.effects = effects;
  return data;
}
