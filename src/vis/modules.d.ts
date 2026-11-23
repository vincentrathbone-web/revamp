/** Minimal types for the MilkDrop libraries (MIT, no typings of their own). */

declare module 'butterchurn' {
  export interface ButterchurnVisualizer {
    connectAudio(node: AudioNode): void;
    disconnectAudio(node: AudioNode): void;
    loadPreset(preset: object, blendSec?: number): void;
    setRendererSize(w: number, h: number): void;
    render(): void;
    launchSongTitleAnim(text: string): void;
  }
  const butterchurn: {
    createVisualizer(
      ctx: BaseAudioContext,
      canvas: HTMLCanvasElement,
      opts: { width: number; height: number; pixelRatio?: number; textureRatio?: number },
    ): ButterchurnVisualizer;
  };
  export default butterchurn;
}

declare module 'butterchurn-presets/lib/butterchurnPresets.min.js' {
  const pack: { getPresets(): Record<string, object> };
  export default pack;
}

declare module 'milkdrop-preset-converter' {
  /** Async in practice (returns a promise). */
  export function convertPreset(text: string): Promise<object> | object;
}
