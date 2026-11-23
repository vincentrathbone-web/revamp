/** What every visualization engine of the visualization window can do. */
export interface VisEngine {
  /** Engine and preset/scene name, for the window's info line. */
  readonly title: string;
  /** The canvas size changed (device pixels). */
  resize(w: number, h: number): void;
  /** Draws one frame. */
  render(): void;
  next(random: boolean): void;
  prev(): void;
  dispose(): void;
}

/** The audio the engines look at: the player's analyser (before the volume control). */
export interface VisAudio {
  readonly context: AudioContext;
  readonly analyser: AnalyserNode;
}
