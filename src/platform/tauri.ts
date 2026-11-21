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
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { App } from '../app/app';
import { logger } from '../core/log';
import { urlFileRef } from './browser';
import type { FileRef, Platform } from './platform';

const log = logger('tauri');

export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const isUrl = (s: string) => /^https?:\/\//i.test(s);
const isPath = (s: string) => /^[a-z]:[\\/]/i.test(s) || s.startsWith('\\\\') || s.startsWith('/');

export class TauriPlatform implements Platform {
  readonly kind = 'tauri' as const;
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
    for (const id of ['main', 'eq', 'pl', 'video'] as const) {
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
  app.host.keepAllOnScreen();
  app.scheduleSave();
  log.info(`covering ${areas.length} monitor(s): ${x1 - x0}x${y1 - y0} at ${x0},${y0}`);
}

/** Fits the window to the monitors, shows it, and starts click-through and file drop handling. */
export async function startDesktop(app: App, platform: TauriPlatform): Promise<void> {
  document.documentElement.classList.add('native');
  theApp = app;
  const win = getCurrentWindow();
  await fitMonitors(app);
  await win.show();
  if (app.settings.ui.alwaysOnTop) await win.setAlwaysOnTop(true);
  // monitors plugged in, removed or rearranged
  setInterval(() => void fitMonitors(app).catch((e) => log.debug('monitor check failed', e)), 3000);

  // click-through where nothing is drawn
  let ignoring: boolean | null = null;
  const poll = async () => {
    try {
      const busy = app.host.dragging || document.querySelector('.rv-menu-layer, .rv-dialog-layer') !== null;
      let over = busy;
      if (!busy) {
        const [cur, pos, scale] = await Promise.all([
          cursorPosition(),
          win.outerPosition(),
          win.scaleFactor(),
        ]);
        over = app.host.hitTest((cur.x - pos.x) / scale, (cur.y - pos.y) / scale);
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

  // files dropped from Explorer arrive as paths
  await getCurrentWebview().onDragDropEvent(async (e) => {
    if (e.payload.type !== 'drop') return;
    const paths = await invoke<string[]>('expand_paths', { paths: e.payload.paths });
    const files = await platform.refs(paths);
    if (files.length)
      await app.addFiles(files, false, app.engine.state === 'stopped' && !app.playlist.length);
  });
}

/** Debug builds only (see self_test in main.rs): plays one file and writes what happened to a JSON report. */
async function selfTest(app: App, platform: TauriPlatform): Promise<void> {
  const cfg = await invoke<[string, string] | null>('self_test').catch(() => null);
  if (!cfg) return;
  const [file, out] = cfg;
  const report: Record<string, unknown> = { file, platform: platform.kind };
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
