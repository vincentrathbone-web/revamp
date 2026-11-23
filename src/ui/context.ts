/** The interface skinned windows use to read state and send commands (implemented by the App). */
import type { EqState } from '../dsp/eq';
import type { PlayState } from '../audio/engine';
import type { Playlist } from '../playlist/model';
import type { Skin } from '../skin/skin';
import type { Visualizer } from './vis';
import type { ShadeId, WindowId } from './window';

/** What the video window's buttons and menu ask for. */
export type VideoCommand = 'fullscreen' | 'zoom1' | 'zoom2' | 'stretch';
/** What the visualization window's buttons, menu and keys ask for. */
export type VisualCommand = 'fullscreen' | 'zoom1' | 'zoom2' | 'next' | 'prev' | 'random' | 'engine';

export interface UiState {
  playState: PlayState;
  position: number;
  duration: number;
  title: string;
  kbps: number;
  khz: number;
  channels: number;
  volume: number;
  balance: number;
  shuffle: boolean;
  repeat: boolean;
  eqVisible: boolean;
  plVisible: boolean;
  alwaysOnTop: boolean;
  doubleSize: boolean;
  timeRemaining: boolean;
  shade: Record<ShadeId, boolean>;
  eq: EqState;
  plSize: { w: number; h: number };
  videoSize: { w: number; h: number };
  visualSize: { w: number; h: number };
  /** The visualization window's info line: engine and preset name. */
  visualTitle: string;
  /** Seconds-since-start counter used for blinking and scrolling. */
  clock: number;
  /** Status message shown in the title area for a moment (e.g. "VOLUME: 50%"). */
  flash: string | null;
}

export type MenuKind =
  | 'main'
  | 'options'
  | 'vis'
  | 'eqPresets'
  | 'plAdd'
  | 'plRem'
  | 'plSel'
  | 'plMisc'
  | 'plList'
  | 'plItem'
  | 'skins'
  | 'video'
  | 'visual';

export interface UiContext {
  readonly skin: Skin;
  readonly state: UiState;
  readonly playlist: Playlist;
  readonly vis: Visualizer;
  readonly focusedWindow: WindowId | null;
  play(): void;
  pause(): void;
  stop(): void;
  next(): void;
  prev(): void;
  eject(): void;
  seek(sec: number): void;
  /** Preview while dragging the position bar (time display follows), without seeking. */
  setSeekPreview(sec: number | null): void;
  setVolume(v: number): void;
  setBalance(b: number): void;
  toggleShuffle(): void;
  toggleRepeat(): void;
  toggleWindow(id: 'eq' | 'pl'): void;
  closeWindow(id: WindowId): void;
  toggleShade(id: ShadeId): void;
  minimize(): void;
  toggleAlwaysOnTop(): void;
  toggleDoubleSize(): void;
  toggleTimeMode(): void;
  cycleVisMode(): void;
  fileInfo(index?: number): void;
  showMenu(kind: MenuKind, screenX: number, screenY: number, arg?: unknown): void;
  setEq(eq: EqState): void;
  playIndex(i: number): void;
  setPlaylistSize(w: number, h: number): void;
  setVideoSize(w: number, h: number): void;
  videoCommand(cmd: VideoCommand): void;
  setVisualSize(w: number, h: number): void;
  visualCommand(cmd: VisualCommand): void;
  flash(text: string): void;
}
