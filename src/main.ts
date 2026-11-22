/** Entry point for the browser and the desktop app. */
import { App } from './app/app';
import { installCrashHandler, logger } from './core/log';
import { BrowserPlatform } from './platform/browser';
import { formats, type Platform } from './platform/platform';
import { createImage, type RgbaImage } from './skin/image';
import type { TextRenderer } from './ui/playlist-window';

const log = logger('main');

/** Draws playlist text with the system font into small RGBA images (cached by the playlist window). */
function canvasTextRenderer(): TextRenderer {
  const c = new OffscreenCanvas(1, 1);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  return (text, color, bg, maxW, h, font): RgbaImage | null => {
    if (maxW <= 0) return null;
    const css = `${h - 2}px ${font ? `"${font}", ` : ''}Arial, sans-serif`;
    g.font = css;
    const w = Math.max(1, Math.min(maxW, Math.ceil(g.measureText(text).width) + 1));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    g.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
    g.fillRect(0, 0, w, h);
    g.font = css; // resizing the canvas resets the context state
    g.textBaseline = 'middle';
    g.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
    g.fillText(text, 0, h / 2 + 0.5);
    const d = g.getImageData(0, 0, w, h);
    const img = createImage(w, h);
    img.data.set(d.data);
    return img;
  };
}

async function start(): Promise<void> {
  const desktop = await import('./platform/tauri');
  const native = desktop.isTauri();
  const platform: Platform = native ? new desktop.TauriPlatform() : new BrowserPlatform();
  formats.convert = !!platform.converter;
  installCrashHandler((t) => platform.writeCrashReport(t));
  const ctx = new AudioContext({ latencyHint: 'playback' });
  const app = new App(platform, ctx, document.getElementById('desktop')!, canvasTextRenderer());
  (globalThis as { revamp?: App }).revamp = app;
  if (native) await desktop.startDesktop(app, platform as InstanceType<typeof desktop.TauriPlatform>);

  // Dev server: offer the test skins in the Skins menu (served by scripts/dev-music.ts, never bundled).
  if (import.meta.env.DEV) {
    void fetch('/dev-skins/index.json')
      .then((r) => (r.ok ? (r.json() as Promise<string[]>) : []))
      .then((names) => {
        app.skinLibrary = names.map((f) => ({
          name: f.replace(/\.wsz$/i, ''),
          url: `/dev-skins/${encodeURIComponent(f)}`,
        }));
      })
      .catch(() => {});
  }
  // Dev server: `revamp.addDevMusic(n)` queues files from the local test music folder.
  if (import.meta.env.DEV) {
    (app as App & { addDevMusic?: (n?: number) => Promise<void> }).addDevMusic = async (n = 20) => {
      const names = (await (await fetch('/dev-music/index.json')).json()) as string[];
      const refs = await Promise.all(
        names.slice(0, n).map((f) => platform.resolve(`/dev-music/${encodeURIComponent(f)}`)),
      );
      await app.addFiles(
        refs.filter((r) => r !== null),
        false,
        false,
      );
    };
  }
  const remembered = app.settings.ui.skin;
  if (remembered) void app.restoreSkin(remembered);

  // Browsers keep audio locked until the first click or key press.
  if (ctx.state === 'suspended') {
    const unlock = () => void ctx.resume();
    addEventListener('pointerdown', unlock, { once: true, capture: true });
    addEventListener('keydown', unlock, { once: true, capture: true });
  }
  log.info('RevAmp started');
}

void start();
