/**
 * The QA run (debug desktop builds only): `REVAMP_SELFTEST=qa:<plan.json>` plays real files through the real
 * app and measures what a listener would notice — silence, loudness, pictures, windows, keys — then writes a
 * report. Each case returns `ok` plus the numbers behind it; `scripts/qa.ps1` runs it and prints the summary.
 *
 * Plan: { "cases": [ { "kind": "play" | "crossfade" | "seekCrossfade" | "replayGain" | "dialogs" | "keys", ... } ] }
 */
import type { App } from '../app/app';
import type { FileRef } from './platform';

export interface QaCase {
  kind: 'play' | 'crossfade' | 'seekCrossfade' | 'replayGain' | 'dialogs' | 'keys' | 'videoWindow';
  name?: string;
  file?: string;
  files?: string[];
  seconds?: number;
  crossfadeMs?: number;
  /** For "play": jump here (seconds) before listening, past a silent start. */
  at?: number;
  /** For "play": the file is a video, so a picture must show. */
  video?: boolean;
}

export interface QaResult {
  name: string;
  ok: boolean;
  problems: string[];
  data: Record<string, unknown>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Loudness right now (RMS of the analyser's last block, before the volume control). */
function level(app: App): number {
  const a = app.engine.analyser;
  const buf = new Float32Array(a.fftSize);
  a.getFloatTimeDomainData(buf);
  let s = 0;
  for (const v of buf) s += v * v;
  return Math.sqrt(s / buf.length);
}

/** Samples the loudness every 100 ms for `ms`; also notes track changes. */
async function listen(app: App, ms: number): Promise<{ t: number; rms: number; track: number }[]> {
  const out: { t: number; rms: number; track: number }[] = [];
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    out.push({
      t: Math.round(performance.now() - t0),
      rms: Math.round(level(app) * 1e4) / 1e4,
      track: app.playlist.current,
    });
    await sleep(100);
  }
  return out;
}

/** Longest stretch (ms) with no sound while it should be playing. */
function longestSilence(samples: { t: number; rms: number }[], floor = 0.002): number {
  let best = 0,
    start = -1;
  for (const s of samples) {
    if (s.rms < floor) {
      if (start < 0) start = s.t;
      best = Math.max(best, s.t - start);
    } else start = -1;
  }
  return best;
}

async function load(app: App, paths: string[]): Promise<FileRef[]> {
  const refs: FileRef[] = [];
  for (const p of paths) {
    const r = await app.platform.resolve(p);
    if (!r) throw new Error(`cannot open ${p}`);
    refs.push(r);
  }
  return refs;
}

async function waitFor(fn: () => boolean, ms: number): Promise<boolean> {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(100);
  }
  return fn();
}

/** Average brightness (0..255) of the video picture, drawn small. */
function pictureBrightness(v: HTMLVideoElement): number {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 18;
  const g = c.getContext('2d')!;
  g.drawImage(v, 0, 0, 32, 18);
  const d = g.getImageData(0, 0, 32, 18).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
  return s / (d.length / 4);
}

function setAudio(app: App, patch: (a: App['settings']['audio']) => void): void {
  patch(app.settings.audio);
  app.engine.setSettings(app.settings.audio);
}

// ------------------------------------------------------------------ cases
async function play(app: App, c: QaCase, r: QaResult): Promise<void> {
  const errors: string[] = [];
  const off = app.engine.on('error', ({ error }) => errors.push(String((error as Error)?.message ?? error)));
  const [ref] = await load(app, [c.file!]);
  app.host.setVisible('video', false);
  await app.addFiles([ref!], true, true);
  await waitFor(() => app.engine.state === 'playing' && app.engine.position > 1, 20000);
  if (c.at) {
    app.seek(c.at);
    await waitFor(() => app.engine.position >= c.at! && app.engine.position < c.at! + 30, 20000);
    await sleep(1000);
  }
  const samples = await listen(app, (c.seconds ?? 6) * 1000);
  const v = app.engine.videoElement;
  const d = r.data;
  d.state = app.engine.state;
  d.position = Math.round(app.engine.position * 10) / 10;
  d.duration = Math.round(app.engine.duration);
  d.info = app.playlist.currentEntry?.info;
  d.converted =
    (app.engine as unknown as { current?: { feed?: { mime: string } } }).current?.feed?.mime ?? null;
  d.maxRms = Math.max(...samples.map((s) => s.rms));
  d.longestSilenceMs = longestSilence(samples);
  d.errors = errors;
  if (app.engine.state !== 'playing') r.problems.push(`not playing (${app.engine.state})`);
  if (errors.length) r.problems.push(`errors: ${errors.join('; ')}`);
  if ((d.maxRms as number) < 0.003) r.problems.push('no sound');
  if (c.video) {
    d.videoWindow = app.host.isVisible('video');
    d.videoElement = v ? { w: v.videoWidth, h: v.videoHeight } : null;
    if (v) {
      const q = v.getVideoPlaybackQuality();
      d.frames = { total: q.totalVideoFrames, dropped: q.droppedVideoFrames };
      d.brightness = Math.round(pictureBrightness(v));
    }
    if (!d.videoWindow) r.problems.push('video window did not open');
    if (!v) r.problems.push('played as sound only (no video element)');
    else {
      if (!v.videoWidth) r.problems.push('no picture size (picture not decoded)');
      if ((d.frames as { total: number }).total < 10) r.problems.push('fewer than 10 frames shown');
      if ((d.brightness as number) < 2) r.problems.push('picture is black');
    }
  }
  off();
  app.stop();
  await sleep(500);
}

/** Two (or more) songs back to back with crossfade: the change must be smooth and the new song audible. */
async function crossfade(app: App, c: QaCase, r: QaResult): Promise<void> {
  const xf = c.crossfadeMs ?? 5000;
  setAudio(app, (a) => (a.crossfadeMs = xf));
  const refs = await load(app, c.files!);
  await app.addFiles(refs, true, true);
  await waitFor(() => app.engine.state === 'playing' && app.engine.position > 0.5, 20000);
  // let the background decode finish (fast start) and the next song load, then jump close to the end
  await sleep(4000);
  const dur = app.engine.duration;
  const lead = xf / 1000 + 4;
  if (dur > lead + 2) app.seek(dur - lead);
  const samples = await listen(app, (lead + 6) * 1000);
  const changedAt = samples.find((s) => s.track !== samples[0]!.track);
  r.data.crossfadeMs = xf;
  r.data.durationFirst = Math.round(dur);
  r.data.trackChangedAtMs = changedAt?.t ?? null;
  // songs often end and start quietly: only count real silence here, not a soft passage
  r.data.longestSilenceMs = longestSilence(samples, 0.0008);
  r.data.afterChange = samples.filter((s) => changedAt && s.t >= changedAt.t).map((s) => s.rms);
  r.data.positionAfter = Math.round(app.engine.position * 10) / 10;
  r.data.samples = samples.map((s) => s.rms);
  if (!changedAt) r.problems.push('did not move on to the next song');
  if ((r.data.longestSilenceMs as number) > 600) r.problems.push(`silent for ${r.data.longestSilenceMs} ms`);
  const tail = samples.slice(-20).map((s) => s.rms);
  if (Math.max(...tail) < 0.003) r.problems.push('next song is silent');
  app.stop();
  setAudio(app, (a) => (a.crossfadeMs = 0));
  await sleep(500);
}

/** Seeking inside a song with crossfade on: old and new position overlap (no hard cut, no silence). */
async function seekCrossfade(app: App, c: QaCase, r: QaResult): Promise<void> {
  const xf = c.crossfadeMs ?? 3000;
  setAudio(app, (a) => (a.crossfadeMs = xf));
  const [ref] = await load(app, [c.file!]);
  await app.addFiles([ref!], true, true);
  await waitFor(() => app.engine.state === 'playing' && app.engine.position > 0.5, 20000);
  await sleep(4000);
  const before = app.engine.position;
  app.seek(Math.min(app.engine.duration - 20, before + 60));
  const samples = await listen(app, xf + 2000);
  r.data.crossfadeMs = xf;
  r.data.seekFrom = Math.round(before);
  r.data.positionAfter = Math.round(app.engine.position * 10) / 10;
  r.data.voices = app.engine.debugVoices();
  r.data.longestSilenceMs = longestSilence(samples);
  r.data.samples = samples.map((s) => s.rms);
  if ((r.data.longestSilenceMs as number) > 300) r.problems.push(`silent for ${r.data.longestSilenceMs} ms`);
  if (!app.engine.lastSeekCrossfaded) r.problems.push('seek did not crossfade');
  app.stop();
  setAudio(app, (a) => (a.crossfadeMs = 0));
  await sleep(500);
}

/** Replay gain on and off must change the level of a tagged song (and of untagged ones by the no-tag gain). */
async function replayGain(app: App, c: QaCase, r: QaResult): Promise<void> {
  const [ref] = await load(app, [c.file!]);
  setAudio(app, (a) => (a.replayGain.enabled = true));
  await app.addFiles([ref!], true, true);
  await waitFor(() => app.engine.state === 'playing' && app.engine.position > 0.5, 20000);
  await sleep(2500);
  const on = app.engine.debugVoices();
  const lvOn = (await listen(app, 2000)).reduce((m, s) => Math.max(m, s.rms), 0);
  setAudio(app, (a) => (a.replayGain.enabled = false));
  await sleep(600);
  const off = app.engine.debugVoices();
  const lvOff = (await listen(app, 2000)).reduce((m, s) => Math.max(m, s.rms), 0);
  r.data.tags = app.playlist.currentEntry?.info?.replayGain ?? null;
  r.data.on = on;
  r.data.off = off;
  r.data.levelOn = lvOn;
  r.data.levelOff = lvOff;
  const gOn = on[0]?.rg ?? 1,
    gOff = off[0]?.rg ?? 1;
  if (Math.abs(gOff - 1) > 0.01) r.problems.push(`gain stays ${gOff.toFixed(3)} with replay gain off`);
  if (r.data.tags && Math.abs(gOn - 1) < 0.01) r.problems.push('replay gain tags were not applied');
  app.stop();
  await sleep(500);
}

/** Dialogs must not block the screens and must close on click-away. */
async function dialogs(app: App, _c: QaCase, r: QaResult): Promise<void> {
  const { overDialog } = await import('../ui/dialogs');
  const checks: Record<string, unknown> = {};
  for (const [name, open] of [
    ['File info', () => app.fileInfo(0)],
    ['Preferences', () => app.openPreferences()],
    ['About', () => app.about()],
  ] as const) {
    open();
    await sleep(300);
    const layer = document.querySelector('.rv-dialog-layer') as HTMLElement | null;
    const box = document.querySelector('.rv-dialog') as HTMLElement | null;
    if (!layer || !box) {
      r.problems.push(`${name}: did not open`);
      continue;
    }
    const b = box.getBoundingClientRect();
    const st = getComputedStyle(layer);
    const res = {
      passesClicks: st.pointerEvents === 'none',
      dimmed: st.backgroundColor !== 'rgba(0, 0, 0, 0)',
      catchesOwnClicks: overDialog(b.left + 5, b.top + 5),
      catchesOutside: overDialog(b.right + 50, b.bottom + 50),
    };
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 1, clientY: 1 }));
    await sleep(100);
    const closed = !document.querySelector('.rv-dialog');
    checks[name] = { ...res, closesOnClickAway: closed };
    if (!res.passesClicks) r.problems.push(`${name}: blocks other screens`);
    if (res.dimmed) r.problems.push(`${name}: dims the screens`);
    if (!res.catchesOwnClicks || res.catchesOutside) r.problems.push(`${name}: wrong click area`);
    if (!closed) r.problems.push(`${name}: does not close on click-away`);
    document.querySelectorAll('.rv-dialog-layer').forEach((l) => l.remove());
  }
  r.data = checks;
}

/** The classic keyboard shortcuts (see KEYS in src/app/keys.ts), pressed as the user would. */
async function keys(app: App, c: QaCase, r: QaResult): Promise<void> {
  const { checkKeys } = await import('./qa-keys');
  const refs = c.files?.length ? await load(app, c.files) : [];
  r.data = await checkKeys(app, refs, r.problems);
}

/** The video window: resize pointers at its edges, resizing from a corner and the left edge, F for fullscreen. */
async function videoWindow(app: App, c: QaCase, r: QaResult): Promise<void> {
  const [ref] = await load(app, [c.file!]);
  await app.addFiles([ref!], true, true);
  await waitFor(() => app.host.isVisible('video') && !!app.engine.videoElement, 20000);
  await sleep(1500);
  const canvas =
    (document.querySelector(
      '[data-window="video"] canvas, .rv-win-video canvas',
    ) as HTMLCanvasElement | null) ??
    ([...document.querySelectorAll('canvas')].find((cv) =>
      cv.closest('[data-id="video"], [data-window="video"], .rv-video'),
    ) as HTMLCanvasElement | undefined) ??
    null;
  const win = app.videoWin;
  const host = app.host;
  // find the window canvas by its size and place
  const pos0 = host.position('video');
  const size0 = win.size();
  const cv =
    canvas ??
    [...document.querySelectorAll('canvas')].find((x) => {
      const b = x.getBoundingClientRect();
      return Math.abs(b.left - pos0.x) < 2 && Math.abs(b.top - pos0.y) < 2;
    }) ??
    null;
  if (!cv) return void r.problems.push('video window canvas not found');
  const b = cv.getBoundingClientRect();
  const s = b.width / size0.w;
  const at = (x: number, y: number) => ({
    clientX: b.left + x * s,
    clientY: b.top + y * s,
    screenX: b.left + x * s,
    screenY: b.top + y * s,
  });
  const fire = (type: string, p: object) =>
    cv.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, ...p }));
  const cursors: Record<string, string> = {};
  for (const [name, x, y] of [
    ['corner', size0.w - 3, size0.h - 3],
    ['right', size0.w - 2, size0.h / 2],
    ['bottom', size0.w / 2, size0.h - 2],
    ['left', 1, size0.h / 2],
    ['top', size0.w / 2, 1],
  ] as const) {
    fire('pointermove', at(x, y));
    cursors[name] = cv.style.cursor;
    if (!/resize/.test(cv.style.cursor)) r.problems.push(`no resize pointer at the ${name}`);
  }
  r.data.cursors = cursors;
  // drag the corner 60 px right and down
  fire('pointerdown', at(size0.w - 3, size0.h - 3));
  const dragging = host.dragging;
  fire('pointermove', { ...at(size0.w + 57, size0.h + 57) });
  fire('pointerup', at(size0.w + 57, size0.h + 57));
  const size1 = win.size();
  r.data.corner = { before: size0, after: size1, keptMouse: dragging };
  if (!dragging) r.problems.push('desktop would let the mouse fall through while resizing');
  if (size1.w <= size0.w || size1.h <= size0.h) r.problems.push('corner drag did not grow the window');
  // drag the left edge 50 px further left: wider, and the right edge stays put
  await sleep(200);
  const b2 = cv.getBoundingClientRect();
  const p1 = host.position('video');
  const right1 = p1.x + size1.w * s;
  fire('pointerdown', {
    clientX: b2.left + 1,
    clientY: b2.top + 60,
    screenX: b2.left + 1,
    screenY: b2.top + 60,
  });
  fire('pointermove', {
    clientX: b2.left - 49,
    clientY: b2.top + 60,
    screenX: b2.left - 49,
    screenY: b2.top + 60,
  });
  fire('pointerup', {
    clientX: b2.left - 49,
    clientY: b2.top + 60,
    screenX: b2.left - 49,
    screenY: b2.top + 60,
  });
  const size2 = win.size();
  const p2 = host.position('video');
  r.data.left = { before: { ...p1, ...size1 }, after: { ...p2, ...size2 } };
  if (size2.w <= size1.w) r.problems.push('left edge drag did not widen the window');
  if (Math.abs(p2.x + size2.w * s - right1) > 2) r.problems.push('left edge drag moved the right edge');
  // F for fullscreen, Esc to leave
  host.focus('video');
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f', bubbles: true }));
  await sleep(800);
  r.data.fullscreenOnF = host.fullscreen;
  if (!host.fullscreen) r.problems.push('F did not go fullscreen');
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
  await sleep(800);
  if (host.fullscreen) r.problems.push('Esc did not leave fullscreen');
  app.stop();
  await sleep(500);
}

const CASES = { play, crossfade, seekCrossfade, replayGain, dialogs, keys, videoWindow };

export async function runQa(app: App, planText: string): Promise<{ ok: boolean; results: QaResult[] }> {
  const plan = JSON.parse(planText) as { cases: QaCase[] };
  const vol = app.settings.audio.chain.volume;
  app.setVolume(0); // silent: the analyser listens before the volume control
  const results: QaResult[] = [];
  for (const c of plan.cases) {
    const name = c.name ?? `${c.kind} ${(c.file ?? c.files?.join(' + ') ?? '').split(/[\\/]/).pop()}`;
    const r: QaResult = { name, ok: false, problems: [], data: {} };
    const t0 = performance.now();
    try {
      await CASES[c.kind](app, c, r);
    } catch (e) {
      r.problems.push(`crashed: ${String((e as Error)?.stack ?? e)}`);
    }
    r.data.ms = Math.round(performance.now() - t0);
    r.ok = r.problems.length === 0;
    results.push(r);
  }
  app.stop();
  app.setVolume(vol);
  return { ok: results.every((r) => r.ok), results };
}
