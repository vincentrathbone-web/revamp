/**
 * Desktop platform (Tauri 2 on Windows).
 *
 * Layout: one undecorated, transparent window covers the monitor's work area. The skinned windows are drawn
 * inside it exactly as in the browser, so docking/snapping code is shared. Mouse clicks pass through to the
 * desktop wherever no skinned window is drawn: the cursor position is polled and the native window switches
 * "ignore cursor events" on and off.
 */
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import {
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

  minimize(): void {
    void this.win.minimize();
  }

  quit(): void {
    void this.win.close();
  }
}

/** Fits the window to the monitor work area, shows it, and starts click-through and file drop handling. */
export async function startDesktop(app: App, platform: TauriPlatform): Promise<void> {
  document.documentElement.classList.add('native');
  const win = getCurrentWindow();
  const mon = await currentMonitor();
  if (mon) {
    const area = (mon as typeof mon & { workArea?: { position: PhysicalPosition; size: PhysicalSize } })
      .workArea ?? {
      position: mon.position,
      size: mon.size,
    };
    await win.setPosition(new PhysicalPosition(area.position.x, area.position.y));
    await win.setSize(new PhysicalSize(area.size.width, area.size.height));
  }
  await win.show();
  if (app.settings.ui.alwaysOnTop) await win.setAlwaysOnTop(true);
  app.host.keepAllOnScreen();

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
