/**
 * The visualization window's picture: a canvas (inside a holder the host lays over the window or shows
 * fullscreen) driven by one engine at a time, MilkDrop or Drift. Changes preset by itself when asked to.
 */
import { DriftEngine } from './drift';
import { MilkdropEngine } from './milkdrop';
import { PresetLibrary, type PresetStore } from './presets';
import type { VisualEngineId, VisualSettings } from './settings';
import type { VisAudio, VisEngine } from './types';

/** Largest canvas edge in device pixels (fullscreen on a 4K screen stays smooth). */
const MAX_EDGE = 1920;

export class Visual {
  /** What the host lays over the window's picture area. */
  readonly element: HTMLDivElement;
  readonly library: PresetLibrary;
  private canvas: HTMLCanvasElement | null = null;
  private engine: VisEngine | null = null;
  private starting: Promise<void> | null = null;
  private generation = 0;
  private lastChange = 0;
  private titleText = '';
  /** Why the engine could not start (shown in the info line). */
  error = '';

  constructor(
    private readonly audio: () => VisAudio,
    private readonly settings: VisualSettings,
    store: PresetStore,
    private readonly changed: () => void,
  ) {
    this.library = new PresetLibrary(store);
    this.element = document.createElement('div');
    this.element.className = 'rv-visual';
    this.element.style.background = '#000';
  }

  get title(): string {
    if (this.error) return this.error;
    return this.titleText || (this.settings.engine === 'drift' ? 'Drift' : 'MilkDrop');
  }

  get running(): boolean {
    return !!this.engine;
  }

  get engineId(): VisualEngineId {
    return this.settings.engine;
  }

  /** The MilkDrop preset on screen ('' with Drift). */
  get presetName(): string {
    return this.engine instanceof MilkdropEngine ? this.engine.presetName : '';
  }

  private setTitle(t: string): void {
    this.titleText = t;
    this.lastChange = performance.now();
    this.changed();
  }

  /** Starts the chosen engine (once; again after `stop` or a switch). */
  start(): Promise<void> {
    if (this.engine) return Promise.resolve();
    if (this.starting) return this.starting;
    const gen = ++this.generation;
    this.error = '';
    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block' });
    this.fit(canvas);
    this.element.replaceChildren(canvas);
    this.canvas = canvas;
    const id = this.settings.engine;
    const make = async (): Promise<VisEngine> =>
      id === 'drift'
        ? new DriftEngine(canvas, this.audio(), (t) => this.setTitle(t))
        : MilkdropEngine.create(canvas, this.audio(), this.library, {
            preset: this.settings.preset,
            blendSec: () => this.settings.blendSec,
            onPreset: (name) => {
              this.settings.preset = name;
              this.setTitle(`MilkDrop: ${name}`);
            },
          });
    this.starting = make()
      .then((e) => {
        if (gen !== this.generation) return e.dispose();
        this.engine = e;
        this.lastChange = performance.now();
      })
      .catch((err: unknown) => {
        if (gen !== this.generation) return;
        this.error = `Can't start ${id === 'drift' ? 'Drift' : 'MilkDrop'}: ${String((err as Error)?.message ?? err)}`;
        this.changed();
      })
      .finally(() => {
        if (gen === this.generation) this.starting = null;
      });
    return this.starting;
  }

  /** Stops drawing and frees the graphics memory (window closed). */
  stop(): void {
    this.generation++;
    this.starting = null;
    this.engine?.dispose();
    this.engine = null;
    this.canvas = null;
    this.element.replaceChildren();
  }

  async setEngine(id: VisualEngineId): Promise<void> {
    if (id === this.settings.engine && (this.engine || this.starting)) return;
    this.settings.engine = id;
    this.titleText = '';
    this.stop();
    await this.start();
  }

  /** Makes the canvas match its holder's size on screen. Returns true when it changed. */
  private fit(canvas: HTMLCanvasElement): boolean {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    let w = Math.max(1, Math.round(this.element.clientWidth * dpr));
    let h = Math.max(1, Math.round(this.element.clientHeight * dpr));
    const k = Math.min(1, MAX_EDGE / Math.max(w, h));
    w = Math.max(1, Math.round(w * k));
    h = Math.max(1, Math.round(h * k));
    if (canvas.width === w && canvas.height === h) return false;
    canvas.width = w;
    canvas.height = h;
    return true;
  }

  /** One frame (called by the app's frame loop while the window shows). */
  render(now = performance.now()): void {
    const e = this.engine;
    if (!e || !this.canvas) return;
    if (this.fit(this.canvas)) e.resize(this.canvas.width, this.canvas.height);
    const auto = this.settings.autoNextSec;
    if (auto > 0 && now - this.lastChange > auto * 1000) this.next(this.settings.random);
    try {
      e.render();
    } catch (err) {
      this.error = `Visualization stopped: ${String((err as Error)?.message ?? err)}`;
      this.stop();
      this.changed();
    }
  }

  next(random = this.settings.random): void {
    this.lastChange = performance.now();
    this.engine?.next(random);
  }

  prev(): void {
    this.lastChange = performance.now();
    this.engine?.prev();
  }

  showPreset(name: string): void {
    if (this.engine instanceof MilkdropEngine) {
      this.lastChange = performance.now();
      this.engine.showByName(name);
    } else {
      this.settings.preset = name;
      void this.setEngine('milkdrop');
    }
  }
}
