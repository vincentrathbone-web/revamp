/**
 * Desktop platform (Tauri 2 on Windows).
 *
 * Layout: one undecorated, transparent window covers the work areas of all monitors. The skinned windows are drawn
 * inside it exactly as in the browser, so docking/snapping code is shared. Mouse clicks pass through to the
 * desktop wherever no skinned window is drawn: the cursor position is polled and the native window switches
 * "ignore cursor events" on and off.
 */
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import {
  availableMonitors,
  currentMonitor,
  cursorPosition,
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize,
} from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { App } from '../app/app';
import { logger } from '../core/log';
import { overDialog } from '../ui/dialogs';
import { urlFileRef } from './browser';
import type { FileRef, Platform } from './platform';
import type { ShellSettings } from '../config/settings';
import { parseProbe, type ByteReader, type Converter } from '../audio/convert';

const log = logger('tauri');

export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const isUrl = (s: string) => /^https?:\/\//i.test(s);
const isPath = (s: string) => /^[a-z]:[\\/]/i.test(s) || s.startsWith('\\\\') || s.startsWith('/');

/** The bundled FFmpeg, run by the Rust side (src-tauri/src/convert.rs). */
const tauriConverter: Converter = {
  probe: async (location) => parseProbe(await invoke<string>('media_probe', { path: location })),
  async open(location, startSec, opts): Promise<ByteReader> {
    const { id, start } = await invoke<{ id: number; start: number }>('convert_open', {
      path: location,
      start: startSec,
      copyVideo: opts.copyVideo,
      hasVideo: opts.hasVideo,
    });
    let closed = false;
    return {
      start,
      async read() {
        if (closed) return null;
        const buf = await invoke<ArrayBuffer>('convert_read', { id });
        if (!buf.byteLength) return null;
        return new Uint8Array(buf);
      },
      close() {
        if (closed) return;
        closed = true;
        void invoke('convert_close', { id }).catch(() => {});
      },
    };
  },
};

export class TauriPlatform implements Platform {
  readonly kind = 'tauri' as const;
  readonly converter = tauriConverter;
  private win = getCurrentWindow();

  async pickFiles(opts: { accept: string[]; multiple: boolean }): Promise<FileRef[]> {
    const picked = await open({
      multiple: opts.multiple,
      filters: [
        { name: 'Supported files', extensions: opts.accept },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
    return this.refs(paths);
  }

  async pickFolder(): Promise<FileRef[]> {
    const dir = await open({ directory: true });
    if (typeof dir !== 'string') return [];
    const paths = await invoke<string[]>('expand_paths', { paths: [dir] });
    return this.refs(paths);
  }

  /** Writes the Explorer entries (src-tauri/src/shell.rs). */
  registerShell(options: ShellSettings, force: boolean): Promise<boolean> {
    return invoke<boolean>('shell_register', { options, force });
  }

  /** Opens Windows' Default apps page for RevAmp. */
  openDefaultApps(): Promise<void> {
    return invoke('open_default_apps');
  }

  async refs(paths: string[]): Promise<FileRef[]> {
    const out = await Promise.all(paths.map((p) => this.resolve(p)));
    return out.filter((r): r is FileRef => r !== null);
  }

  async saveFile(suggestedName: string, data: Uint8Array | string): Promise<void> {
    const path = await save({ defaultPath: suggestedName });
    if (!path) return;
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    await invoke('write_file', { path, data: Array.from(bytes) });
  }

  loadSetting(key: string): string | null {
    try {
      return localStorage.getItem(`revamp.${key}`);
    } catch {
      return null;
    }
  }

  saveSetting(key: string, value: string): void {
    try {
      localStorage.setItem(`revamp.${key}`, value);
    } catch {
      /* ignore */
    }
  }

  async resolve(location: string): Promise<FileRef | null> {
    if (isUrl(location)) return urlFileRef(location, location);
    if (!isPath(location)) return null;
    try {
      return await urlFileRef(location, convertFileSrc(location));
    } catch (e) {
      log.warn('cannot open', location, e);
      return null;
    }
  }

  writeCrashReport(text: string): void {
    console.error(text);
    void invoke('crash_report', { text }).catch(() => {});
  }

  setAlwaysOnTop(on: boolean): void {
    void this.win.setAlwaysOnTop(on);
  }

  async fullscreenMonitor(on: boolean, x: number, y: number): Promise<boolean> {
    if (!theApp || !fitted) return false;
    if (!on) {
      videoFullscreen = false;
      fitted = { ...fitted, key: '' }; // same origin, so player windows keep their place
      await fitMonitors(theApp);
      return true;
    }
    const px = fitted.x + x * fitted.scale,
      py = fitted.y + y * fitted.scale;
    const mons = await availableMonitors();
    const m = mons.find(
      (m) =>
        px >= m.position.x &&
        py >= m.position.y &&
        px < m.position.x + m.size.width &&
        py < m.position.y + m.size.height,
    );
    if (!m) return false;
    videoFullscreen = true;
    await this.win.setPosition(new PhysicalPosition(m.position.x, m.position.y));
    await this.win.setSize(new PhysicalSize(m.size.width, m.size.height));
    return true;
  }

  minimize(): void {
    void this.win.minimize();
  }

  quit(): void {
    void this.win.close();
  }
}

type Area = { position: { x: number; y: number }; size: { width: number; height: number } };
let fitted: { key: string; x: number; y: number; scale: number } | null = null;
/** While a video is fullscreen the window covers one whole monitor; the monitor check must not undo that. */
let videoFullscreen = false;
let theApp: App | null = null;

/**
 * Makes the transparent window cover the work areas of all monitors (their bounding box) and tells the window
 * host where each monitor is, so player windows snap to monitor edges and come back if a monitor disappears.
 * Player windows keep their place on screen when the bounding box moves.
 * Limitation: the page uses one zoom factor, so on monitors with different scaling the player looks larger or
 * smaller on one of them.
 */
async function fitMonitors(app: App): Promise<void> {
  if (videoFullscreen) return;
  const win = getCurrentWindow();
  const mons = await availableMonitors();
  if (!mons.length) {
    const m = await currentMonitor();
    if (m) mons.push(m);
  }
  if (!mons.length) return;
  const areas: Area[] = mons.map((m) => (m as typeof m & { workArea?: Area }).workArea ?? m);
  const key = JSON.stringify(areas.map((a) => [a.position.x, a.position.y, a.size.width, a.size.height]));
  if (fitted?.key === key) return;
  const x0 = Math.min(...areas.map((a) => a.position.x));
  const y0 = Math.min(...areas.map((a) => a.position.y));
  const x1 = Math.max(...areas.map((a) => a.position.x + a.size.width));
  const y1 = Math.max(...areas.map((a) => a.position.y + a.size.height));
  await win.setPosition(new PhysicalPosition(x0, y0));
  await win.setSize(new PhysicalSize(x1 - x0, y1 - y0));
  const scale = await win.scaleFactor();
  if (fitted) {
    // keep the player windows where they are on screen
    const dx = (fitted.x - x0) / scale,
      dy = (fitted.y - y0) / scale;
    for (const id of ['main', 'eq', 'pl', 'video', 'visual'] as const) {
      const p = app.host.position(id);
      app.host.setPosition(id, p.x + dx, p.y + dy);
    }
  }
  fitted = { key, x: x0, y: y0, scale };
  app.host.monitors = areas.map((a) => ({
    x: (a.position.x - x0) / scale,
    y: (a.position.y - y0) / scale,
    w: a.size.width / scale,
    h: a.size.height / scale,
  }));
  app.host.holdLayout = false;
  app.host.keepAllOnScreen();
  app.scheduleSave();
  log.info(`covering ${areas.length} monitor(s): ${x1 - x0}x${y1 - y0} at ${x0},${y0}`);
}

/** Fits the window to the monitors, shows it, and starts click-through and file drop handling. */
export async function startDesktop(app: App, platform: TauriPlatform): Promise<void> {
  document.documentElement.classList.add('native');
  theApp = app;
  const win = getCurrentWindow();
  await fitMonitors(app).catch((e) => log.warn('fitting to the monitors failed', e));
  if (app.host.holdLayout) {
    // fitting failed: check positions against the page as it is
    app.host.holdLayout = false;
    app.host.keepAllOnScreen();
  }
  await win.show();
  if (app.settings.ui.alwaysOnTop) await win.setAlwaysOnTop(true);
  // monitors plugged in, removed or rearranged
  setInterval(() => void fitMonitors(app).catch((e) => log.debug('monitor check failed', e)), 3000);

  // click-through where nothing is drawn
  let ignoring: boolean | null = null;
  const poll = async () => {
    try {
      const busy = app.host.dragging || document.querySelector('.rv-menu-layer') !== null;
      let over = busy;
      if (!busy) {
        const [cur, pos, scale] = await Promise.all([
          cursorPosition(),
          win.outerPosition(),
          win.scaleFactor(),
        ]);
        const x = (cur.x - pos.x) / scale,
          y = (cur.y - pos.y) / scale;
        over = app.host.hitTest(x, y) || overDialog(x, y);
      }
      if (ignoring !== !over) {
        ignoring = !over;
        await win.setIgnoreCursorEvents(ignoring);
      }
    } catch (e) {
      log.debug('poll failed', e);
    }
    setTimeout(() => void poll(), 33);
  };
  void poll();
  void selfTest(app, platform);

  // Files from Explorer (Play / Enqueue) or the command line. Later starts of revamp.exe hand theirs to this one.
  let queue = Promise.resolve();
  const drain = () =>
    (queue = queue
      .then(async () => {
        const launches = await invoke<{ mode: 'play' | 'enqueue'; paths: string[] }[]>('take_launches');
        for (const l of launches) {
          const paths = await invoke<string[]>('expand_paths', { paths: l.paths });
          await app.launch(l.mode, await platform.refs(paths));
        }
      })
      .catch((e) => log.warn('could not open files', e)));
  await listen('launch', () => void drain());
  void drain();
  // keep Explorer's entries pointing at this program (skipped when nothing changed; test builds leave them alone)
  void platform.registerShell(app.settings.shell, false).catch((e) => log.debug('Explorer entries:', e));

  // files dropped from Explorer arrive as paths
  await getCurrentWebview().onDragDropEvent(async (e) => {
    if (e.payload.type !== 'drop') return;
    const paths = await invoke<string[]>('expand_paths', { paths: e.payload.paths });
    const files = await platform.refs(paths);
    if (files.length)
      await app.addFiles(files, false, app.engine.state === 'stopped' && !app.playlist.length);
  });
}

/**
 * Self-test part (VITE_SELFTEST_VISUAL=1): runs both visualization engines in the window and fullscreen and
 * reports frames per second, the cost of one frame, and when each part ran (so CPU use can be matched to it).
 */
async function visualCheck(app: App): Promise<Record<string, unknown>> {
  const sleep = (t: number) => new Promise((r) => setTimeout(r, t));
  const out: Record<string, unknown> = {};
  const vis = app.visual;
  if (!app.host.isVisible('visual')) app.toggleWindow('visual');
  let frames = 0;
  const render = vis.render.bind(vis);
  vis.render = (now?: number) => (frames++, render(now));
  for (const engine of ['milkdrop', 'drift'] as const) {
    await vis.setEngine(engine);
    await sleep(1500);
    for (const full of [false, true]) {
      if (full) app.visualCommand('fullscreen');
      await sleep(1000);
      const canvas = vis.element.querySelector('canvas');
      const from = Date.now();
      frames = 0;
      await sleep(5000);
      const fps = frames / 5;
      const to = Date.now();
      // cost of one frame, waiting for the graphics card to finish
      const gl = canvas?.getContext('webgl2');
      const times: number[] = [];
      for (let i = 0; gl && i < 60; i++) {
        const t = performance.now();
        render();
        gl.finish();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        times.push(performance.now() - t);
      }
      times.sort((a, b) => a - b);
      out[`${engine}${full ? ' fullscreen' : ''}`] = {
        canvas: canvas ? `${canvas.width}x${canvas.height}` : null,
        fps: Math.round(fps * 10) / 10,
        msMedian: Math.round((times[30] ?? 0) * 100) / 100,
        msP95: Math.round((times[57] ?? 0) * 100) / 100,
        title: vis.title,
        error: vis.error || undefined,
        from,
        to,
      };
      if (full) app.visualCommand('fullscreen');
    }
  }
  vis.render = render;
  app.toggleWindow('visual');
  return out;
}

/** Debug builds only (see self_test in main.rs): plays one file and writes what happened to a JSON report. */
async function selfTest(app: App, platform: TauriPlatform): Promise<void> {
  const cfg = await invoke<[string, string] | null>('self_test').catch(() => null);
  if (!cfg) return;
  const [file, out] = cfg;
  const report: Record<string, unknown> = { file, platform: platform.kind };
  if (file === '-layout' || file === '-layout-move') {
    // window positions after start; "-layout-move" then moves the docked stack low on the biggest monitor
    // and saves, so the next start can show whether it comes back in the same place
    await new Promise((r) => setTimeout(r, 1500));
    const ids = ['main', 'eq', 'pl'] as const;
    report.monitors = app.host.screens;
    report.atStart = Object.fromEntries(ids.map((id) => [id, app.host.position(id)]));
    if (file === '-layout-move') {
      const big = [...app.host.screens].sort((a, b) => b.w * b.h - a.w * a.h)[0]!;
      const x = Math.round(big.x + big.w - 400);
      const y = Math.round(big.y + big.h - 520);
      app.host.setPosition('main', x, y);
      app.host.setPosition('eq', x, y + 116);
      app.host.setPosition('pl', x, y + 232);
      for (const id of ids) app.settings.ui.positions[id] = app.host.position(id);
      app.saveNow();
      report.moved = Object.fromEntries(ids.map((id) => [id, app.host.position(id)]));
    }
    return invoke('write_file', {
      path: out,
      data: Array.from(new TextEncoder().encode(JSON.stringify(report, null, 2))),
    });
  }
  if (file.startsWith('qa:')) {
    // the QA run: a plan of cases played through the real app (see qa.ts)
    let result: unknown;
    try {
      const plan = await platform.resolve(file.slice(3));
      if (!plan) throw new Error(`no plan at ${file.slice(3)}`);
      await new Promise((r) => setTimeout(r, 1500));
      const { runQa } = await import('./qa');
      result = await runQa(app, new TextDecoder().decode(await plan.read()));
    } catch (e) {
      result = { ok: false, crashed: String((e as Error)?.stack ?? e) };
    }
    return invoke('write_file', {
      path: out,
      data: Array.from(new TextEncoder().encode(JSON.stringify(result, null, 2))),
    });
  }
  if (file === '-') {
    // no file: report what command-line starts (Play / Enqueue) put in the playlist after a while
    app.setVolume(0);
    await new Promise((r) => setTimeout(r, Number(import.meta.env.VITE_SELFTEST_WAIT ?? 9000)));
    report.playlist = app.playlist.entries.map((e) => e.location);
    report.current = app.playlist.current;
    report.state = app.engine.state;
    app.stop();
    return invoke('write_file', {
      path: out,
      data: Array.from(new TextEncoder().encode(JSON.stringify(report, null, 2))),
    });
  }
  try {
    const ref = await platform.resolve(file);
    report.resolved = !!ref;
    report.size = ref?.size;
    if (ref) {
      const vol = app.settings.audio.chain.volume;
      app.setVolume(0); // silent: the analyser reads the signal before the volume stage
      await app.addFiles([ref], true, true);
      await new Promise((r) => setTimeout(r, 6000));
      const e = app.playlist.currentEntry;
      report.title = e?.info?.title;
      report.artist = e?.info?.artist;
      report.duration = e?.info?.durationSec;
      report.state = app.engine.state;
      report.position = app.engine.position;
      report.ctx = app.ctx.state;
      const a = app.engine.analyser;
      const buf = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(buf);
      report.peak = buf.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      const v = app.engine.videoElement;
      if (v) report.video = { width: v.videoWidth, height: v.videoHeight };
      report.converted = (app.engine as unknown as { current?: { feed?: { mime: string } } }).current?.feed
        ?.mime;
      if (app.engine.duration > 20) {
        // a jump far ahead: the converter starts again there
        const to = Math.round(app.engine.duration * 0.66);
        app.engine.seek(to);
        await new Promise((r) => setTimeout(r, 2500));
        report.seek = { to, position: app.engine.position, state: app.engine.state };
      }
      if (!v && import.meta.env.VITE_SELFTEST_VISUAL) report.visual = await visualCheck(app);
      app.stop();
      app.setVolume(vol);
    }
  } catch (err) {
    report.error = String(err);
  }
  await invoke('write_file', {
    path: out,
    data: Array.from(new TextEncoder().encode(JSON.stringify(report, null, 2))),
  });
}
