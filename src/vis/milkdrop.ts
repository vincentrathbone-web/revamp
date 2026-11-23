/** The MilkDrop engine: Butterchurn (MIT) drawing MilkDrop presets with WebGL 2. */
import type { ButterchurnVisualizer } from 'butterchurn';
import { nextIndex, type PresetLibrary } from './presets';
import type { VisAudio, VisEngine } from './types';

export class MilkdropEngine implements VisEngine {
  private index = -1;
  private history: number[] = [];

  private constructor(
    private readonly viz: ButterchurnVisualizer,
    private readonly audio: VisAudio,
    private readonly library: PresetLibrary,
    private readonly blendSec: () => number,
    private readonly onPreset: (name: string) => void,
  ) {}

  static async create(
    canvas: HTMLCanvasElement,
    audio: VisAudio,
    library: PresetLibrary,
    opts: { preset: string; blendSec: () => number; onPreset: (name: string) => void },
  ): Promise<MilkdropEngine> {
    const [mod] = await Promise.all([import('butterchurn'), library.load()]);
    // the UMD build can arrive wrapped in one or two `default`s, depending on the bundler
    let bc = mod as unknown as { default?: unknown; createVisualizer?: unknown };
    while (typeof bc.createVisualizer !== 'function' && bc.default) bc = bc.default as typeof bc;
    if (typeof bc.createVisualizer !== 'function') throw new Error('Butterchurn did not load');
    const viz = (bc as typeof mod.default).createVisualizer(audio.context, canvas, {
      width: Math.max(1, canvas.width),
      height: Math.max(1, canvas.height),
      pixelRatio: 1,
      textureRatio: 1,
    });
    viz.connectAudio(audio.analyser);
    const e = new MilkdropEngine(viz, audio, library, opts.blendSec, opts.onPreset);
    const all = library.all;
    const start = all.findIndex((p) => p.name === opts.preset);
    e.show(start >= 0 ? start : nextIndex(-1, all.length, true), 0);
    return e;
  }

  get title(): string {
    const p = this.library.all[this.index];
    return p ? `MilkDrop: ${p.name}` : 'MilkDrop';
  }

  get presetName(): string {
    return this.library.all[this.index]?.name ?? '';
  }

  /** Shows the preset at `i` of the library's list. */
  show(i: number, blendSec = this.blendSec()): void {
    const p = this.library.all[i];
    if (!p) return;
    try {
      this.viz.loadPreset(p.preset, blendSec);
    } catch {
      // a broken preset: skip it, but don't loop forever
      if (this.history.length < this.library.all.length) return this.next(true);
      return;
    }
    if (this.index >= 0) this.history.push(this.index);
    if (this.history.length > 50) this.history.shift();
    this.index = i;
    this.onPreset(p.name);
  }

  showByName(name: string): void {
    const i = this.library.all.findIndex((p) => p.name === name);
    if (i >= 0) this.show(i);
  }

  resize(w: number, h: number): void {
    this.viz.setRendererSize(w, h);
  }

  render(): void {
    this.viz.render();
  }

  next(random: boolean): void {
    this.show(nextIndex(this.index, this.library.all.length, random));
  }

  prev(): void {
    const last = this.history.pop();
    const i = last ?? nextIndex(this.index, this.library.all.length, false, -1);
    this.show(i);
    this.history.pop(); // going back doesn't add to the history
  }

  dispose(): void {
    try {
      this.viz.disconnectAudio(this.audio.analyser);
    } catch {
      /* already disconnected */
    }
  }
}
