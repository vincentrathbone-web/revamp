/** A fake app for window tests: records every command the windows send. */
import { defaultEq } from '../../src/dsp/eq';
import { Playlist } from '../../src/playlist/model';
import type { Skin } from '../../src/skin/skin';
import type { UiContext, UiState } from '../../src/ui/context';
import { EqWindow } from '../../src/ui/eq-window';
import { MainWindow } from '../../src/ui/main-window';
import { PlaylistWindow } from '../../src/ui/playlist-window';
import { VideoWindow } from '../../src/ui/video-window';
import { Visualizer } from '../../src/ui/vis';
import type { SkinnedWindow, WindowId } from '../../src/ui/window';

export function fakeUi(skin: Skin, patch: Partial<UiState> = {}) {
  const calls: string[] = [];
  const playlist = new Playlist(() => 0.5);
  playlist.add([
    { location: 'a.mp3', title: 'First track', durationSec: 201 },
    { location: 'b.flac', title: 'Second track with a much longer title than fits', durationSec: 63 },
    { location: 'c.ogg', title: 'Third', durationSec: 3600 },
  ]);
  playlist.setCurrent(1);
  const state: UiState = {
    playState: 'playing',
    position: 75,
    duration: 201,
    title: '2. Second track (1:03)',
    kbps: 192,
    khz: 44.1,
    channels: 2,
    volume: 0.8,
    balance: 0,
    shuffle: false,
    repeat: true,
    eqVisible: true,
    plVisible: true,
    alwaysOnTop: false,
    doubleSize: false,
    timeRemaining: false,
    shade: { main: false, eq: false, pl: false },
    eq: { ...defaultEq(), bandsDb: [6, 4, 2, 0, -2, -4, -2, 0, 2, 4], preampDb: -3 },
    plSize: { w: 275, h: 232 },
    videoSize: { w: 275, h: 232 },
    clock: 0,
    flash: null,
    ...patch,
  };
  const rec =
    (name: string) =>
    (...args: unknown[]) =>
      void calls.push(`${name}(${args.map((a) => JSON.stringify(a)).join(',')})`);
  const ui: UiContext = {
    skin,
    state,
    playlist,
    vis: new Visualizer(),
    focusedWindow: 'main',
    play: rec('play'),
    pause: rec('pause'),
    stop: rec('stop'),
    next: rec('next'),
    prev: rec('prev'),
    eject: rec('eject'),
    seek: (s: number) => ((state.position = s), calls.push(`seek(${s})`)),
    setSeekPreview: () => {},
    setVolume: (v) => ((state.volume = v), calls.push(`setVolume`)),
    setBalance: (b) => ((state.balance = b), calls.push('setBalance')),
    toggleShuffle: rec('toggleShuffle'),
    toggleRepeat: rec('toggleRepeat'),
    toggleWindow: rec('toggleWindow'),
    closeWindow: rec('closeWindow'),
    toggleShade: rec('toggleShade'),
    minimize: rec('minimize'),
    toggleAlwaysOnTop: rec('toggleAlwaysOnTop'),
    toggleDoubleSize: rec('toggleDoubleSize'),
    toggleTimeMode: rec('toggleTimeMode'),
    cycleVisMode: rec('cycleVisMode'),
    fileInfo: rec('fileInfo'),
    showMenu: rec('showMenu'),
    setEq: (eq) => ((state.eq = eq), calls.push('setEq')),
    playIndex: rec('playIndex'),
    setPlaylistSize: rec('setPlaylistSize'),
    setVideoSize: rec('setVideoSize'),
    videoCommand: rec('videoCommand'),
    flash: () => {},
  };
  return { ui, calls, state };
}

export function windowsFor(ui: UiContext): Record<WindowId, SkinnedWindow> {
  return {
    main: new MainWindow(ui),
    eq: new EqWindow(ui),
    pl: new PlaylistWindow(ui),
    video: new VideoWindow(ui),
  };
}
