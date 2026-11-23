/**
 * Keyboard shortcuts, matching the classic player's (checked against its key tables, behaviour only).
 * One table: each shortcut says which windows it works in, so the playlist and equalizer can give keys their
 * own meaning (L adds files in the playlist, 1–0 raise EQ bands) while the rest work everywhere.
 *
 * Keys are matched by physical key (like the original), so they work on any keyboard layout and the number
 * pad keys are told apart from the number row.
 */
import type { WindowId } from '../ui/window';

/** What the shortcuts can ask for (implemented by App). */
export interface KeyActions {
  prev(): void;
  play(): void;
  pause(): void;
  stop(): void;
  next(): void;
  firstTrack(): void;
  lastTrack(): void;
  jumpTracks(n: number): void;
  stopWithFade(): void;
  toggleStopAfterCurrent(): void;
  toggleManualAdvance(): void;
  seekBy(sec: number): void;
  volumeBy(delta: number): void;
  balanceBy(delta: number): void;
  openFiles(replace: boolean): void;
  openFolder(replace: boolean): void;
  openUrl(replace: boolean): void;
  jumpToFile(): void;
  jumpToTime(): void;
  toggleRepeat(): void;
  toggleShuffle(): void;
  fileInfo(): void;
  toggleWindow(id: 'main' | 'eq' | 'pl' | 'video' | 'visual'): void;
  toggleShade(): void;
  toggleDoubleSize(): void;
  toggleTimeMode(): void;
  toggleAlwaysOnTop(): void;
  preferences(): void;
  about(): void;
  minimize(): void;
  quit(): void;
  mainMenu(): void;
  skinsMenu(): void;
  visualMenu(): void;
  reloadSkin(): void;
  focusNextWindow(): void;
  fullscreen(): void;
  exitFullscreen(): boolean;
  loadPlaylist(): void;
  savePlaylist(): void;
  // playlist window
  plShowPlaying(): void;
  plClear(): void;
  plCrop(): void;
  plRemoveDead(): void;
  plSort(by: 'title' | 'filename' | 'path' | 'reverse' | 'random'): void;
  // equalizer window
  eqBand(band: number, deltaDb: number): void;
  eqPreamp(deltaDb: number): void;
  eqToggle(): void;
  eqToggleAuto(): void;
  eqPresets(): void;
  // visualization window
  visualNext(): void;
  visualPrev(): void;
}

type Where = WindowId;
const ALL: Where[] = ['main', 'eq', 'pl', 'video', 'visual'];
const PLAYER: Where[] = ['main', 'eq', 'pl', 'video', 'visual'];
const NOT_PL: Where[] = ['main', 'eq', 'video', 'visual'];
const NOT_EQ: Where[] = ['main', 'pl', 'video', 'visual'];
const MAIN: Where[] = ['main', 'video', 'visual'];

export interface Shortcut {
  keys: string[];
  label: string;
  in: Where[];
  run: (a: KeyActions) => void;
}

/** Volume step of the arrow keys, as a fraction of full volume. */
const VOL = 0.02;
/** EQ step for the band keys (dB). */
const EQ_STEP = 1;
const EQ_UP = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const EQ_DOWN = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'];

export const SHORTCUTS: Shortcut[] = [
  // transport (number pad too)
  { keys: ['Z', 'Num4'], label: 'Previous track', in: PLAYER, run: (a) => a.prev() },
  { keys: ['Ctrl+Z'], label: 'First track in the list', in: PLAYER, run: (a) => a.firstTrack() },
  { keys: ['Shift+Z'], label: 'Back 5 seconds', in: PLAYER, run: (a) => a.seekBy(-5) },
  { keys: ['X', 'Num5'], label: 'Play / restart', in: PLAYER, run: (a) => a.play() },
  { keys: ['C'], label: 'Pause', in: PLAYER, run: (a) => a.pause() },
  { keys: ['V'], label: 'Stop', in: PLAYER, run: (a) => a.stop() },
  { keys: ['Shift+V'], label: 'Fade out and stop', in: PLAYER, run: (a) => a.stopWithFade() },
  { keys: ['Ctrl+V'], label: 'Stop after this track', in: PLAYER, run: (a) => a.toggleStopAfterCurrent() },
  { keys: ['B', 'Num6'], label: 'Next track', in: PLAYER, run: (a) => a.next() },
  { keys: ['Ctrl+B'], label: 'Last track in the list', in: PLAYER, run: (a) => a.lastTrack() },
  { keys: ['Shift+B'], label: 'Forward 5 seconds', in: PLAYER, run: (a) => a.seekBy(5) },
  { keys: ['Num1'], label: 'Back 10 tracks', in: NOT_EQ, run: (a) => a.jumpTracks(-10) },
  { keys: ['Num3'], label: 'Forward 10 tracks', in: NOT_EQ, run: (a) => a.jumpTracks(10) },
  { keys: ['Left', 'Num7'], label: 'Back 5 seconds', in: NOT_EQ, run: (a) => a.seekBy(-5) },
  { keys: ['Right', 'Num9'], label: 'Forward 5 seconds', in: NOT_EQ, run: (a) => a.seekBy(5) },
  { keys: ['Up', 'Num8'], label: 'Volume up', in: NOT_PL, run: (a) => a.volumeBy(VOL) },
  { keys: ['Down', 'Num2'], label: 'Volume down', in: NOT_PL, run: (a) => a.volumeBy(-VOL) },
  { keys: ['Num8'], label: 'Volume up', in: ['pl'], run: (a) => a.volumeBy(VOL) },
  { keys: ['Num2'], label: 'Volume down', in: ['pl'], run: (a) => a.volumeBy(-VOL) },
  { keys: ['Shift+R'], label: 'Manual playlist advance', in: MAIN, run: (a) => a.toggleManualAdvance() },
  { keys: ['R'], label: 'Repeat', in: NOT_EQ, run: (a) => a.toggleRepeat() },
  { keys: ['S'], label: 'Shuffle', in: NOT_EQ, run: (a) => a.toggleShuffle() },
  { keys: ['J', 'NumDecimal'], label: 'Jump to file', in: PLAYER, run: (a) => a.jumpToFile() },
  { keys: ['Ctrl+J'], label: 'Jump to time', in: ALL, run: (a) => a.jumpToTime() },

  // opening files: the playlist adds, the other windows replace the list
  { keys: ['L', 'Num0', 'Shift+X'], label: 'Play file', in: NOT_PL, run: (a) => a.openFiles(true) },
  { keys: ['Shift+L', 'Insert'], label: 'Play folder', in: NOT_PL, run: (a) => a.openFolder(true) },
  {
    keys: ['Ctrl+L', 'Ctrl+Num0', 'Ctrl+X'],
    label: 'Play location',
    in: NOT_PL,
    run: (a) => a.openUrl(true),
  },
  { keys: ['L', 'Num0', 'Ctrl+Insert'], label: 'Add files', in: ['pl'], run: (a) => a.openFiles(false) },
  { keys: ['Shift+L', 'Insert'], label: 'Add folder', in: ['pl'], run: (a) => a.openFolder(false) },
  {
    keys: ['Ctrl+L', 'Ctrl+Num0', 'Shift+Insert'],
    label: 'Add location',
    in: ['pl'],
    run: (a) => a.openUrl(false),
  },
  { keys: ['Shift+X'], label: 'Play file', in: ['pl'], run: (a) => a.openFiles(true) },
  { keys: ['Ctrl+X'], label: 'Play location', in: ['pl'], run: (a) => a.openUrl(true) },
  { keys: ['Ctrl+O'], label: 'Open playlist', in: ALL, run: (a) => a.loadPlaylist() },
  { keys: ['Ctrl+S'], label: 'Save playlist', in: ALL, run: (a) => a.savePlaylist() },

  // windows and options
  { keys: ['Alt+W'], label: 'Main window', in: ALL, run: (a) => a.toggleWindow('main') },
  { keys: ['Alt+G'], label: 'Equalizer', in: ALL, run: (a) => a.toggleWindow('eq') },
  { keys: ['Alt+E'], label: 'Playlist editor', in: ALL, run: (a) => a.toggleWindow('pl') },
  { keys: ['Alt+V'], label: 'Video window', in: ALL, run: (a) => a.toggleWindow('video') },
  { keys: ['Ctrl+Shift+K'], label: 'Visualization window', in: ALL, run: (a) => a.toggleWindow('visual') },
  { keys: ['Alt+K', 'Ctrl+K'], label: 'Visualization options', in: ALL, run: (a) => a.visualMenu() },
  { keys: ['Ctrl+W'], label: 'Window shade', in: ALL, run: (a) => a.toggleShade() },
  { keys: ['Ctrl+D'], label: 'Double size', in: ALL, run: (a) => a.toggleDoubleSize() },
  { keys: ['Ctrl+T'], label: 'Time elapsed / remaining', in: ALL, run: (a) => a.toggleTimeMode() },
  { keys: ['Ctrl+A'], label: 'Always on top', in: NOT_PL, run: (a) => a.toggleAlwaysOnTop() },
  { keys: ['Ctrl+Alt+A'], label: 'Always on top', in: ['pl'], run: (a) => a.toggleAlwaysOnTop() },
  { keys: ['Ctrl+P'], label: 'Preferences', in: ALL, run: (a) => a.preferences() },
  { keys: ['Ctrl+F1'], label: 'About', in: ALL, run: (a) => a.about() },
  { keys: ['Alt+3'], label: 'File info', in: ALL, run: (a) => a.fileInfo() },
  { keys: ['Alt+S'], label: 'Skins', in: ALL, run: (a) => a.skinsMenu() },
  { keys: ['F5'], label: 'Reload skin', in: ALL, run: (a) => a.reloadSkin() },
  { keys: ['Alt+F'], label: 'Main menu', in: ALL, run: (a) => a.mainMenu() },
  { keys: ['Alt+M'], label: 'Minimize', in: ALL, run: (a) => a.minimize() },
  { keys: ['Alt+F4'], label: 'Exit', in: ALL, run: (a) => a.quit() },
  { keys: ['Ctrl+Tab'], label: 'Next window', in: ALL, run: (a) => a.focusNextWindow() },
  { keys: ['Alt+Enter', 'Ctrl+F'], label: 'Fullscreen', in: ALL, run: (a) => a.fullscreen() },
  {
    keys: ['F'],
    label: 'Fullscreen (video and visualization windows)',
    in: ['video', 'visual'],
    run: (a) => a.fullscreen(),
  },

  // playlist window
  { keys: ['Space'], label: 'Show the playing track', in: ['pl'], run: (a) => a.plShowPlaying() },
  { keys: ['Ctrl+N', 'Ctrl+Shift+Delete'], label: 'New (empty) list', in: ['pl'], run: (a) => a.plClear() },
  { keys: ['Ctrl+Delete'], label: 'Crop to selection', in: ['pl'], run: (a) => a.plCrop() },
  { keys: ['Alt+Delete'], label: 'Remove missing files', in: ['pl'], run: (a) => a.plRemoveDead() },
  { keys: ['Ctrl+Shift+1'], label: 'Sort by title', in: ['pl'], run: (a) => a.plSort('title') },
  { keys: ['Ctrl+Shift+2'], label: 'Sort by file name', in: ['pl'], run: (a) => a.plSort('filename') },
  { keys: ['Ctrl+Shift+3'], label: 'Sort by path', in: ['pl'], run: (a) => a.plSort('path') },
  { keys: ['Ctrl+R'], label: 'Reverse list', in: ['pl'], run: (a) => a.plSort('reverse') },
  { keys: ['Ctrl+Shift+R'], label: 'Randomize list', in: ['pl'], run: (a) => a.plSort('random') },

  // equalizer window
  ...EQ_UP.map((k, i) => ({
    keys: [k],
    label: `EQ band ${i + 1} up`,
    in: ['eq'] as Where[],
    run: (a: KeyActions) => a.eqBand(i, EQ_STEP),
  })),
  ...EQ_DOWN.map((k, i) => ({
    keys: [k],
    label: `EQ band ${i + 1} down`,
    in: ['eq'] as Where[],
    run: (a: KeyActions) => a.eqBand(i, -EQ_STEP),
  })),
  { keys: ['`'], label: 'Preamp up', in: ['eq'], run: (a) => a.eqPreamp(EQ_STEP) },
  { keys: ['Tab'], label: 'Preamp down', in: ['eq'], run: (a) => a.eqPreamp(-EQ_STEP) },
  { keys: ['N'], label: 'Equalizer on / off', in: ['eq'], run: (a) => a.eqToggle() },
  { keys: ['A'], label: 'Auto equalizer', in: ['eq'], run: (a) => a.eqToggleAuto() },
  { keys: ['S'], label: 'Equalizer presets', in: ['eq'], run: (a) => a.eqPresets() },
  { keys: ['Left'], label: 'Balance left', in: ['eq'], run: (a) => a.balanceBy(-0.05) },
  { keys: ['Right'], label: 'Balance right', in: ['eq'], run: (a) => a.balanceBy(0.05) },

  // visualization window
  { keys: ['Space'], label: 'Next preset', in: ['visual'], run: (a) => a.visualNext() },
  { keys: ['Backspace'], label: 'Previous preset', in: ['visual'], run: (a) => a.visualPrev() },
];

const CODE_NAMES: Record<string, string> = {
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  Backquote: '`',
  NumpadDecimal: 'NumDecimal',
  NumpadEnter: 'Enter',
};

/** The key's name in the table: physical key, so layouts don't matter ("Z", "Num4", "Left", "F5"…). */
export function keyName(code: string, key: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num${code.slice(6)}`;
  if (CODE_NAMES[code]) return CODE_NAMES[code]!;
  if (code === 'Space' || key === ' ') return 'Space';
  return code || key;
}

/** "Ctrl+Shift+K" style name of a key press. */
export function chordOf(
  e: Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(keyName(e.code, e.key));
  return parts.join('+');
}

/** The shortcut for this key press in this window (the window's own meaning wins). */
export function findShortcut(chord: string, where: Where): Shortcut | undefined {
  return SHORTCUTS.find((s) => s.in.includes(where) && s.keys.includes(chord));
}

/** Every chord bound twice in the same window (a mistake in the table). */
export function conflicts(): string[] {
  const out: string[] = [];
  for (const w of ALL) {
    const seen = new Map<string, string>();
    for (const s of SHORTCUTS)
      if (s.in.includes(w))
        for (const k of s.keys) {
          const before = seen.get(k);
          if (before && before !== s.label) out.push(`${w}: ${k} = ${before} and ${s.label}`);
          seen.set(k, s.label);
        }
  }
  return out;
}
