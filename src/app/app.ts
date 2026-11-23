/** RevAmp application: connects the audio engine, playlist, skin, windows, menus and settings. */
import { AudioEngine, type EngineTrack, type PlayState } from '../audio/engine';
import { readTrackInfo, type TrackInfo } from '../audio/tags';
import {
  CONVERT_EXTENSIONS,
  canCopyVideo,
  mayConvert,
  needsConversion,
  probeTrackInfo,
  type ConvertSource,
} from '../audio/convert';
import { loadSettings, saveSettings, type Settings } from '../config/settings';
import { logger } from '../core/log';
import { BUILTIN_PRESETS, clampDb, type EqState, type Preset } from '../dsp/eq';
import { parseEqf, writeEqf } from '../dsp/eqf';
import { displayTitle, formatTime, Playlist, type Entry } from '../playlist/model';
import {
  decodePlaylistBytes,
  parsePlaylist,
  resolveLocation,
  writeM3u,
  writePls,
  writeXspf,
} from '../playlist/formats';
import {
  extOf,
  isMedia,
  isPlaylist,
  isSkin,
  playsAsVideo,
  mediaExtensions,
  PLAYLIST_EXTENSIONS,
  type FileRef,
  type Platform,
} from '../platform/platform';
import { filesFromDrop } from '../platform/browser';
import { BUILTIN_SKINS, builtinLocation, builtinSkin, isBuiltinLocation } from '../skin/builtin';
import { defaultSkin } from '../skin/default-skin';
import { skinFromArchive, type Skin } from '../skin/skin';
import type { MenuKind, UiContext, UiState, VideoCommand, VisualCommand } from '../ui/context';
import { dialog, factTable, prompt, setDialogArea } from '../ui/dialogs';
import { EqWindow } from '../ui/eq-window';
import { BrowserHost } from '../ui/host-browser';
import { MainWindow } from '../ui/main-window';
import { showMenu, type MenuItem } from '../ui/menu';
import { PlaylistWindow, type TextRenderer } from '../ui/playlist-window';
import { VideoWindow } from '../ui/video-window';
import { VisualWindow } from '../ui/visual-window';
import { Visual } from '../vis/visual';
import { Visualizer } from '../ui/vis';
import type { ShadeId, WindowId } from '../ui/window';
import { VIDEO_MIN_H, VIDEO_MIN_W, videoArea } from '../skin/sprites';
import { openPreferences } from './preferences';
import { chordOf, findShortcut, type KeyActions } from './keys';

const log = logger('app');
export const VERSION = '0.2.1';

const isStream = (loc: string) =>
  /^https?:\/\//i.test(loc) && !/\.(mp3|ogg|flac|m4a|wav|opus|aac)(\?|$)/i.test(loc);

export class App implements UiContext {
  readonly playlist = new Playlist();
  readonly vis = new Visualizer();
  skin: Skin = defaultSkin();
  settings: Settings;
  readonly engine: AudioEngine;
  readonly host: BrowserHost;
  readonly main: MainWindow;
  readonly eqWin: EqWindow;
  readonly plWin: PlaylistWindow;
  readonly videoWin: VideoWindow;
  readonly visualWin: VisualWindow;
  /** The visualization window's picture (MilkDrop or Drift). */
  readonly visual: Visual;
  /** The <video> element currently laid over the video window. */
  private shownVideo: HTMLVideoElement | null = null;
  private files = new Map<number, FileRef>();
  private startTime = performance.now();
  private flashText: string | null = null;
  private flashUntil = 0;
  private seekPreview: number | null = null;
  private trackMeta = { kbps: 0, khz: 0, channels: 0 };
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private scanQueue: Entry[] = [];
  private scanning = false;
  private cursorUrls = new Map<string, string>();
  private lastVis = 0;
  private lastAutoSave = 0;
  minimized = false;
  /** Extra skins the menu offers (e.g. test skins served by the dev server). */
  skinLibrary: { name: string; url: string }[] = [];

  constructor(
    readonly platform: Platform,
    readonly ctx: AudioContext,
    root: HTMLElement,
    textRenderer: TextRenderer,
  ) {
    this.settings = loadSettings(platform.loadSetting('settings'));
    const s = this.settings;
    this.playlist.shuffle = s.shuffle;
    this.playlist.repeat = s.repeat;
    this.vis.settings = s.ui.vis;
    this.engine = new AudioEngine(ctx, (t) => this.nextTrackAfter(t), s.audio);
    this.engine.on('trackStart', (t) => this.onTrackStart(t));
    this.engine.on('error', ({ track, error }) => this.onTrackError(track, error));
    this.engine.on('state', (st) => {
      this.invalidateAll();
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = st === 'stopped' ? 'none' : st;
    });
    this.setupMediaKeys();
    this.engine.on('ended', () => (this.stopAfterCurrent = false));
    this.engine.on('info', (i) => {
      this.trackMeta.khz = i.sampleRate / 1000;
      this.trackMeta.channels = i.channels;
    });
    if (s.ui.outputDevice) void this.engine.setOutputDevice(s.ui.outputDevice).catch(() => {});

    this.main = new MainWindow(this);
    this.eqWin = new EqWindow(this);
    this.plWin = new PlaylistWindow(this, textRenderer, (id) => void this.plMenuAction(id));
    this.videoWin = new VideoWindow(this);
    this.visualWin = new VisualWindow(this);
    this.visual = new Visual(
      () => ({ context: this.ctx, analyser: this.engine.analyser }),
      s.ui.visual,
      platform,
      () => {
        this.visualWin.invalidate();
        this.scheduleSave();
      },
    );
    this.host = new BrowserHost(root, {
      scaleOf: (id) =>
        this.settings.ui.doubleSize && (id === 'main' || (id === 'eq' && this.settings.ui.doubleSizeEq))
          ? 2
          : 1,
      inside: (id, x, y) => this.windowById(id).inside(x, y),
      cursorUrl: (name) => this.cursorFor(name),
      snapEnabled: () => this.settings.ui.snap,
      snapDistance: () => this.settings.ui.snapDistance,
      onFocus: (id) => {
        if (id !== 'pl') this.plWin.closeMenu();
        this.invalidateAll();
      },
      onLayout: () => this.saveLayout(),
      onDrop: (id, e) => void this.onDrop(e, id),
    });
    const pos = s.ui.positions;
    this.host.add(this.main, pos.main.x, pos.main.y);
    this.host.add(this.eqWin, pos.eq.x, pos.eq.y, s.ui.eqVisible);
    this.host.add(this.plWin, pos.pl.x, pos.pl.y, s.ui.plVisible);
    this.host.add(this.videoWin, pos.video.x, pos.video.y, s.ui.videoVisible);
    this.host.add(this.visualWin, pos.visual.x, pos.visual.y, s.ui.visual.visible);
    this.host.setOverlay('visual', this.visual.element, () => this.visualWin.pictureRect);
    if (s.ui.visual.visible) void this.visual.start();
    this.host.focus('main');
    // desktop app: the page is resized to the monitors after start; positions are checked then
    this.host.holdLayout = platform.kind === 'tauri';
    this.host.keepAllOnScreen();
    setDialogArea(() => {
      const m = this.host.position('main');
      return (
        this.host.screens.find((r) => m.x >= r.x && m.y >= r.y && m.x < r.x + r.w && m.y < r.y + r.h) ?? null
      );
    });
    this.playlist.onChange(() => {
      this.plWin.invalidate();
      this.main.invalidate();
      this.scheduleSave();
    });
    root.addEventListener('dragover', (e) => e.preventDefault());
    root.addEventListener('drop', (e) => {
      e.preventDefault();
      void this.onDrop(e, null);
    });
    addEventListener('keydown', (e) => this.onKey(e));
    addEventListener('beforeunload', () => this.saveNow());
    // restore remembered playlist entries the platform can reach
    this.restored = this.restorePlaylist().catch((e) => log.warn('playlist restore failed', e));
    requestAnimationFrame(() => this.frame());
  }

  // ------------------------------------------------------------------ UiContext
  get state(): UiState {
    const s = this.settings;
    const e = this.playlist.currentEntry;
    const info = e?.info;
    return {
      playState: this.engine.state,
      position: this.engine.position,
      duration: this.engine.currentTrack ? this.engine.duration : 0,
      title: this.titleLine(),
      kbps: info?.bitrateKbps ?? this.trackMeta.kbps,
      khz: info?.sampleRate ? info.sampleRate / 1000 : this.trackMeta.khz,
      channels: info?.channels ?? this.trackMeta.channels,
      volume: s.audio.chain.volume,
      balance: s.audio.chain.balance,
      shuffle: this.playlist.shuffle,
      repeat: this.playlist.repeat !== 'off',
      eqVisible: this.host?.isVisible('eq') ?? s.ui.eqVisible,
      plVisible: this.host?.isVisible('pl') ?? s.ui.plVisible,
      alwaysOnTop: s.ui.alwaysOnTop,
      doubleSize: s.ui.doubleSize,
      timeRemaining: s.ui.timeRemaining,
      shade: s.ui.shade,
      eq: s.audio.chain.eq,
      plSize: s.ui.plSize,
      videoSize: s.ui.videoSize,
      visualSize: s.ui.visual.size,
      visualTitle: this.visual?.title ?? '',
      clock: (performance.now() - this.startTime) / 1000,
      flash: performance.now() < this.flashUntil ? this.flashText : null,
    };
  }

  get focusedWindow(): WindowId | null {
    return this.host?.focused ?? 'main';
  }

  private titleLine(): string {
    const e = this.playlist.currentEntry;
    if (!e) return `RevAmp ${VERSION}`;
    const d =
      e.info?.durationSec ?? e.durationSec ?? (this.engine.currentTrack ? this.engine.duration : undefined);
    const num = this.settings.ui.showNumbers ? `${this.playlist.current + 1}. ` : '';
    return `${num}${displayTitle(e)}${d ? ` (${formatTime(d)})` : ''}`;
  }

  private windowById(id: WindowId) {
    return { main: this.main, eq: this.eqWin, pl: this.plWin, video: this.videoWin, visual: this.visualWin }[
      id
    ];
  }

  invalidateAll(): void {
    this.main.invalidate();
    this.eqWin.invalidate();
    this.plWin.invalidate();
    this.videoWin.invalidate();
    this.visualWin?.invalidate();
  }

  flash(text: string): void {
    this.flashText = text;
    this.flashUntil = performance.now() + 1200;
    this.main.invalidate();
  }

  // ------------------------------------------------------------------ transport
  private toTrack(e: Entry): EngineTrack {
    return {
      key: String(e.id),
      info: e.info,
      stream: isStream(e.location),
      video: playsAsVideo(e.location, e.info?.hasVideo),
      convert: this.platform.converter && mayConvert(e.location) ? () => this.convertSource(e) : undefined,
      load: async () => {
        const f = await this.fileFor(e);
        if (!f) throw new Error(`Cannot open ${e.location}`);
        return f.read();
      },
      mediaUrl: async () => {
        const f = await this.fileFor(e);
        return f ? f.mediaUrl() : e.location;
      },
    };
  }

  /** Asks the converter about a file the web view may not play; null = it plays as it is. */
  private async convertSource(e: Entry): Promise<ConvertSource | null> {
    const c = this.platform.converter!;
    const where = (await this.fileFor(e).catch(() => null))?.location ?? e.location;
    const always = CONVERT_EXTENSIONS.includes(extOf(where));
    let p;
    try {
      p = await c.probe(where);
    } catch (err) {
      if (always) throw err;
      log.debug('probe failed, playing as it is', where, err);
      return null;
    }
    this.setInfo(e, { ...probeTrackInfo(p), ...e.info, hasVideo: !!p.video });
    if (!needsConversion(where, p)) return null;
    const opts = { copyVideo: canCopyVideo(p), hasVideo: !!p.video };
    return { durationSec: p.durationSec, hasVideo: !!p.video, open: (t) => c.open(where, t, opts) };
  }

  private setInfo(e: Entry, info: TrackInfo): void {
    e.info = info;
    if (info.durationSec) e.durationSec = info.durationSec;
    this.playlist.changed();
  }

  private async fileFor(e: Entry): Promise<FileRef | null> {
    const f = this.files.get(e.id);
    if (f) return f;
    const r = await this.platform.resolve(e.location);
    if (r) this.files.set(e.id, r);
    return r;
  }

  private nextTrackAfter(t: EngineTrack): EngineTrack | null {
    if (this.stopAfterCurrent || this.settings.manualAdvance) return null;
    const idx = this.playlist.entries.findIndex((e) => String(e.id) === t.key);
    if (idx < 0) return null;
    const n = this.playlist.peekNext(idx);
    const e = this.playlist.entries[n];
    return e ? this.toTrack(e) : null;
  }

  private onTrackStart(t: EngineTrack): void {
    const idx = this.playlist.entries.findIndex((e) => String(e.id) === t.key);
    if (idx >= 0 && idx !== this.playlist.current) {
      if (this.playlist.peekNext() === idx) this.playlist.next();
      else this.playlist.setCurrent(idx);
    }
    const e = this.playlist.entries[idx];
    this.trackMeta = { kbps: e?.info?.bitrateKbps ?? 0, khz: 0, channels: 0 };
    if (e && this.settings.audio.chain.eq.auto) this.autoLoadPreset(e);
    if (idx >= 0) this.plWin.ensureVisible(idx);
    if (e && 'mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: e.info?.title ?? displayTitle(e),
        artist: e.info?.artist ?? '',
        album: e.info?.album ?? '',
      });
    }
    this.invalidateAll();
    this.scheduleSave();
  }

  /** Keyboard media keys and the system media overlay. */
  private setupMediaKeys(): void {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const on = (a: MediaSessionAction, fn: (d: MediaSessionActionDetails) => void) => {
      try {
        ms.setActionHandler(a, fn);
      } catch {
        /* action not supported here */
      }
    };
    on('play', () => this.play());
    on('pause', () => this.pause());
    on('stop', () => this.stop());
    on('nexttrack', () => this.next());
    on('previoustrack', () => this.prev());
    on('seekto', (d) => d.seekTime !== undefined && this.seek(d.seekTime));
  }

  private errorStreak = 0;
  private onTrackError(t: EngineTrack, error: unknown): void {
    log.warn('track failed', t.key, error);
    this.flash('CANNOT PLAY THIS FILE');
    this.errorStreak++;
    if (this.errorStreak < Math.min(10, this.playlist.length)) {
      setTimeout(() => {
        const n = this.playlist.next(true);
        if (n >= 0)
          void this.engine
            .play(this.toTrack(this.playlist.entries[n]!))
            .then(() => (this.errorStreak = this.engine.state === 'playing' ? 0 : this.errorStreak));
      }, 400);
    } else this.errorStreak = 0;
  }

  /** Where the last session stopped (seconds into the current track); used once by the first Play. */
  private resumeAt = 0;

  playIndex(i: number, offset = 0): void {
    const e = this.playlist.entries[i];
    if (!e) return;
    this.resumeAt = 0;
    this.playlist.setCurrent(i);
    void this.resumeCtx()
      .then(() => this.probeVideo(e))
      .then(() => this.engine.play(this.toTrack(e), offset));
  }

  /** .mp4/.webm can be music or video: read the header first if the background scan hasn't yet. */
  private async probeVideo(e: Entry): Promise<void> {
    if (e.info || isStream(e.location) || !['mp4', 'webm'].includes(extOf(e.location))) return;
    const f = await this.fileFor(e).catch(() => null);
    if (!f) return;
    try {
      e.info = await readTrackInfo(f.source());
    } catch (err) {
      log.debug('probe failed', e.location, err);
    }
  }

  private async resumeCtx(): Promise<void> {
    if (this.ctx.state === 'suspended' && this.engine.state !== 'paused') await this.ctx.resume();
  }

  play(): void {
    if (this.engine.state === 'paused') return void this.engine.resume();
    if (!this.playlist.length) return this.eject();
    const i = this.playlist.current >= 0 ? this.playlist.current : 0;
    this.playIndex(i, i === this.playlist.current ? this.resumeAt : 0);
  }

  pause(): void {
    if (this.engine.state === 'playing') void this.engine.pause();
    else if (this.engine.state === 'paused') void this.engine.resume();
  }

  stop(): void {
    void this.engine.stop();
  }

  next(): void {
    const i = this.playlist.peekNext(this.playlist.current, true);
    if (i < 0) return;
    if (this.engine.state === 'stopped') {
      this.playlist.next(true);
      return;
    }
    this.playlist.next(true);
    this.playIndex(this.playlist.current);
  }

  prev(): void {
    const i = this.playlist.prev();
    if (i < 0) return;
    if (this.engine.state !== 'stopped') this.playIndex(i);
  }

  seek(sec: number): void {
    this.engine.seek(sec);
  }

  setSeekPreview(sec: number | null): void {
    this.seekPreview = sec;
  }

  eject(): void {
    void this.openFiles(true);
  }

  // ------------------------------------------------------------------ settings changes
  private applyAudio(): void {
    this.engine.setSettings(this.settings.audio);
    this.scheduleSave();
  }

  setVolume(v: number): void {
    this.settings.audio.chain.volume = Math.max(0, Math.min(1, v));
    this.applyAudio();
    this.main.invalidate();
    this.eqWin.invalidate();
  }

  setBalance(b: number): void {
    this.settings.audio.chain.balance = Math.max(-1, Math.min(1, b));
    this.applyAudio();
    this.main.invalidate();
  }

  setEq(eq: EqState): void {
    this.settings.audio.chain.eq = {
      ...eq,
      bandsDb: eq.bandsDb.map(clampDb),
      preampDb: clampDb(eq.preampDb),
    };
    this.applyAudio();
    this.eqWin.invalidate();
  }

  toggleShuffle(): void {
    this.playlist.setShuffle(!this.playlist.shuffle);
    this.settings.shuffle = this.playlist.shuffle;
    this.engine.invalidateNext();
    this.main.invalidate();
    this.scheduleSave();
  }

  toggleRepeat(): void {
    this.setRepeat(this.playlist.repeat === 'off' ? 'all' : 'off');
  }

  setRepeat(mode: 'off' | 'all' | 'one'): void {
    this.playlist.setRepeat(mode);
    this.settings.repeat = mode;
    this.engine.invalidateNext();
    this.main.invalidate();
    this.scheduleSave();
  }

  toggleWindow(id: 'eq' | 'pl' | 'video' | 'visual'): void {
    this.setWindowVisible(id, !this.host.isVisible(id));
  }

  private setWindowVisible(id: 'eq' | 'pl' | 'video' | 'visual', vis: boolean): void {
    if (!vis && this.fullscreenOf === id) this.exitFullscreen();
    this.host.setVisible(id, vis);
    if (id === 'visual') {
      this.settings.ui.visual.visible = vis;
      if (vis) void this.visual.start();
      else this.visual.stop();
    } else this.settings.ui[({ eq: 'eqVisible', pl: 'plVisible', video: 'videoVisible' } as const)[id]] = vis;
    if (vis) this.host.keepAllOnScreen();
    this.main.invalidate();
    this.scheduleSave();
  }

  closeWindow(id: WindowId): void {
    if (id === 'main') {
      if (this.platform.quit) {
        this.saveNow();
        return this.platform.quit();
      }
      void this.engine.stop();
      this.minimize();
      return;
    }
    this.toggleWindow(id);
  }

  toggleShade(id: ShadeId): void {
    this.settings.ui.shade[id] = !this.settings.ui.shade[id];
    this.windowById(id).relayout();
    this.scheduleSave();
  }

  minimize(): void {
    if (this.platform.minimize) return this.platform.minimize();
    this.minimized = true;
    this.host.root.classList.add('minimized');
  }

  restore(): void {
    this.minimized = false;
    this.host.root.classList.remove('minimized');
  }

  toggleAlwaysOnTop(): void {
    this.settings.ui.alwaysOnTop = !this.settings.ui.alwaysOnTop;
    this.platform.setAlwaysOnTop?.(this.settings.ui.alwaysOnTop);
    this.main.invalidate();
    this.scheduleSave();
  }

  toggleDoubleSize(): void {
    this.settings.ui.doubleSize = !this.settings.ui.doubleSize;
    this.host.sizeChanged('main');
    this.host.sizeChanged('eq');
    this.host.render(true);
    this.scheduleSave();
  }

  toggleTimeMode(): void {
    this.settings.ui.timeRemaining = !this.settings.ui.timeRemaining;
    this.main.invalidate();
    this.plWin.invalidate();
    this.scheduleSave();
  }

  cycleVisMode(): void {
    const order = ['spectrum', 'scope', 'off'] as const;
    const v = this.settings.ui.vis;
    v.mode = order[(order.indexOf(v.mode) + 1) % order.length]!;
    this.main.invalidate();
    this.scheduleSave();
  }

  setPlaylistSize(w: number, h: number): void {
    this.settings.ui.plSize = { w, h };
    this.plWin.scrollTo(this.plWin.scroll);
    this.plWin.relayout();
    this.scheduleSave();
  }

  // ------------------------------------------------------------------ video
  setVideoSize(w: number, h: number): void {
    const scr = this.host.screens[0] ?? this.host.screen;
    this.settings.ui.videoSize = {
      w: Math.max(VIDEO_MIN_W, Math.min(Math.round(w), Math.max(VIDEO_MIN_W, scr.w))),
      h: Math.max(VIDEO_MIN_H, Math.min(Math.round(h), Math.max(VIDEO_MIN_H, scr.h))),
    };
    this.videoWin.relayout();
    this.scheduleSave();
  }

  videoCommand(cmd: VideoCommand): void {
    const el = this.shownVideo;
    switch (cmd) {
      case 'fullscreen':
        if (this.host.fullscreen) this.exitFullscreen();
        else void this.enterFullscreen('video');
        break;
      case 'zoom1':
      case 'zoom2': {
        if (!el?.videoWidth) return this.flash('NO VIDEO PLAYING');
        const k = cmd === 'zoom2' ? 2 : 1;
        // window size so the picture area is exactly the video size (times k)
        const a = videoArea(0, 0);
        this.setVideoSize(el.videoWidth * k - a.w, el.videoHeight * k - a.h);
        break;
      }
      case 'stretch':
        this.settings.ui.videoStretch = !this.settings.ui.videoStretch;
        this.shownVideo?.classList.toggle('stretch', this.settings.ui.videoStretch);
        this.scheduleSave();
        break;
    }
  }

  /** Which window's picture fills the screen now. */
  private fullscreenOf: 'video' | 'visual' | null = null;

  private async enterFullscreen(id: 'video' | 'visual' = 'video'): Promise<void> {
    if (id === 'video' && !this.shownVideo) return this.flash('NO VIDEO PLAYING');
    if (!this.host.isVisible(id)) this.setWindowVisible(id, true);
    const area = this.host.enterFullscreen(id, (kind, e) =>
      kind === 'dblclick' ? this.exitFullscreen() : this.showMenu(id, e.clientX, e.clientY),
    );
    if (!area) return;
    this.fullscreenOf = id;
    // desktop app: cover the whole monitor, taskbar included
    const grown = await this.platform
      .fullscreenMonitor?.(true, area.x + area.w / 2, area.y + area.h / 2)
      .catch(() => false);
    if (grown && this.host.fullscreen) this.host.fullscreenFillPage();
  }

  private exitFullscreen(): void {
    if (!this.host.fullscreen) return;
    this.fullscreenOf = null;
    this.host.exitFullscreen();
    void this.platform.fullscreenMonitor?.(false, 0, 0).catch(() => {});
  }

  /** Keeps the video window showing the current track's picture (called every frame). */
  private syncVideo(): void {
    const el = this.engine.videoElement;
    if (el === this.shownVideo) return;
    this.shownVideo = el;
    if (!el) {
      this.exitFullscreen();
      this.host.setOverlay('video', null);
      this.videoWin.invalidate();
      return;
    }
    el.classList.toggle('stretch', this.settings.ui.videoStretch);
    this.host.setOverlay('video', el, () => this.videoWin.pictureRect);
    if (this.settings.ui.videoAutoShow && !this.host.isVisible('video')) this.setWindowVisible('video', true);
    if (!this.host.fullscreen) this.flash('F OR CTRL+F: FULLSCREEN');
  }

  private videoMenu(): MenuItem[] {
    const has = !!this.shownVideo;
    return [
      {
        label: 'Fullscreen',
        shortcut: 'F',
        checked: this.host.fullscreen,
        disabled: !has,
        action: () => this.videoCommand('fullscreen'),
      },
      { label: 'Original size (100%)', disabled: !has, action: () => this.videoCommand('zoom1') },
      { label: 'Double size (200%)', disabled: !has, action: () => this.videoCommand('zoom2') },
      {
        label: 'Stretch to fill',
        checked: this.settings.ui.videoStretch,
        action: () => this.videoCommand('stretch'),
      },
      'sep',
      {
        label: 'Open video window when a video starts',
        checked: this.settings.ui.videoAutoShow,
        action: () => {
          this.settings.ui.videoAutoShow = !this.settings.ui.videoAutoShow;
          this.scheduleSave();
        },
      },
      { label: 'Close video window', shortcut: 'Alt+V', action: () => this.setWindowVisible('video', false) },
    ];
  }

  // ------------------------------------------------------------------ visualization window
  setVisualSize(w: number, h: number): void {
    const scr = this.host.screens[0] ?? this.host.screen;
    this.settings.ui.visual.size = {
      w: Math.max(VIDEO_MIN_W, Math.min(Math.round(w), Math.max(VIDEO_MIN_W, scr.w))),
      h: Math.max(VIDEO_MIN_H, Math.min(Math.round(h), Math.max(VIDEO_MIN_H, scr.h))),
    };
    this.visualWin.relayout();
    this.scheduleSave();
  }

  visualCommand(cmd: VisualCommand): void {
    switch (cmd) {
      case 'fullscreen':
        if (this.host.fullscreen) this.exitFullscreen();
        else void this.enterFullscreen('visual');
        break;
      case 'zoom1':
        this.setVisualSize(275, 232);
        break;
      case 'zoom2': {
        // picture area twice as wide and tall as at the normal size
        const a = videoArea(275, 232);
        this.setVisualSize(a.w * 2 + 19, a.h * 2 + 58);
        break;
      }
      case 'next':
        this.visual.next();
        break;
      case 'prev':
        this.visual.prev();
        break;
      case 'random':
        this.visual.next(true);
        break;
      case 'engine':
        void this.visual.setEngine(this.visual.engineId === 'milkdrop' ? 'drift' : 'milkdrop');
        break;
    }
    this.visualWin.invalidate();
  }

  /** Adds the user's own MilkDrop presets (.milk files) and shows the first one. */
  async addMilkPresets(files: FileRef[]): Promise<void> {
    const texts = await Promise.all(
      files.map(async (f) => ({ name: f.name, text: new TextDecoder().decode(await f.read()) })),
    );
    const { added, failed } = await this.visual.library.addMilkFiles(texts);
    if (added.length) {
      if (!this.host.isVisible('visual')) this.setWindowVisible('visual', true);
      this.visual.showPreset(added[0]!);
    }
    this.flash(
      failed.length
        ? `PRESETS: ${added.length} ADDED, ${failed.length} UNREADABLE`
        : `PRESETS: ${added.length} ADDED`,
    );
  }

  private async pickMilkPresets(): Promise<void> {
    const files = await this.platform.pickFiles({ accept: ['.milk'], multiple: true });
    if (files.length) await this.addMilkPresets(files);
  }

  private visualMenu(): MenuItem[] {
    const v = this.settings.ui.visual;
    const lib = this.visual.library;
    const milk = v.engine === 'milkdrop';
    const save = () => this.scheduleSave();
    const all = lib.all;
    const current = this.visual.presetName;
    // the preset list in groups of 25, so no menu is taller than the screen
    const groups: MenuItem[] = [];
    for (let i = 0; i < all.length; i += 25) {
      const part = all.slice(i, i + 25);
      groups.push({
        label: `${part[0]!.name.slice(0, 18)} … ${part[part.length - 1]!.name.slice(0, 18)}`,
        checked: part.some((p) => p.name === current),
        submenu: () =>
          part.map((p) => ({
            label: p.own ? `★ ${p.name}` : p.name,
            checked: p.name === current,
            radio: true,
            action: () => this.visual.showPreset(p.name),
          })),
      });
    }
    const autoChoices = [0, 10, 20, 30, 60];
    return [
      {
        label: 'Fullscreen',
        shortcut: 'F',
        checked: this.fullscreenOf === 'visual',
        action: () => this.visualCommand('fullscreen'),
      },
      'sep',
      { label: 'MilkDrop', checked: milk, radio: true, action: () => void this.visual.setEngine('milkdrop') },
      { label: 'Drift', checked: !milk, radio: true, action: () => void this.visual.setEngine('drift') },
      'sep',
      {
        label: milk ? 'Next preset' : 'Next scene',
        shortcut: 'Space',
        action: () => this.visualCommand('next'),
      },
      {
        label: milk ? 'Previous preset' : 'Previous scene',
        shortcut: 'Backspace',
        action: () => this.visualCommand('prev'),
      },
      { label: 'Presets', disabled: !groups.length, submenu: () => groups },
      {
        label: 'Change by itself',
        submenu: () =>
          autoChoices.map((sec) => ({
            label: sec ? `Every ${sec} seconds` : 'Never',
            checked: v.autoNextSec === sec,
            radio: true,
            action: () => ((v.autoNextSec = sec), save()),
          })),
      },
      { label: 'Random order', checked: v.random, action: () => ((v.random = !v.random), save()) },
      'sep',
      { label: 'Add MilkDrop presets (.milk)…', action: () => void this.pickMilkPresets() },
      {
        label: 'Remove my presets',
        disabled: !lib.ownPresets.length,
        submenu: () =>
          lib.ownPresets.map((p) => ({
            label: p.name,
            action: () => {
              lib.remove(p.name);
              if (p.name === current) this.visual.next();
            },
          })),
      },
      'sep',
      {
        label: 'Close visualization window',
        shortcut: 'Ctrl+Shift+K',
        action: () => this.setWindowVisible('visual', false),
      },
    ];
  }

  // ------------------------------------------------------------------ files
  async openFiles(replace: boolean): Promise<void> {
    const files = await this.platform.pickFiles({
      accept: [...mediaExtensions(), ...PLAYLIST_EXTENSIONS],
      multiple: true,
    });
    if (files.length) await this.addFiles(files, replace, replace);
  }

  async openFolder(replace: boolean): Promise<void> {
    const files = await this.platform.pickFolder();
    if (files.length) await this.addFiles(files, replace, replace);
  }

  async openUrl(): Promise<void> {
    const url = await prompt(
      'Open location',
      'Address of a file or internet radio stream (http:// or https://):',
    );
    if (!url) return;
    const [e] = this.playlist.add([{ location: url, title: url }]);
    this.playIndex(this.playlist.entries.indexOf(e!));
  }

  /** Adds audio files and playlists. Skins dropped here are loaded instead. */
  /** Resolves once the playlist of the last session is back. */
  readonly restored: Promise<void>;
  private lastPlayLaunch = -Infinity;

  /**
   * Files from Explorer's "Play in RevAmp" / "Enqueue in RevAmp" or the command line. Explorer starts RevAmp once
   * per selected file, so "Play" starts arriving close together form one new list instead of replacing each other.
   */
  async launch(mode: 'play' | 'enqueue', files: FileRef[]): Promise<void> {
    await this.restored;
    if (!files.length) return;
    if (mode === 'play') {
      const now = performance.now();
      const sameBurst = now - this.lastPlayLaunch < 1500;
      this.lastPlayLaunch = now;
      return this.addFiles(files, !sameBurst, !sameBurst);
    }
    return this.addFiles(files, false, this.engine.state === 'stopped' && !this.playlist.length);
  }

  async addFiles(files: FileRef[], replace: boolean, play: boolean): Promise<void> {
    const skin = files.find((f) => isSkin(f.name));
    if (skin) return this.loadSkinFile(skin);
    const items: { entry: Omit<Entry, 'id'>; file?: FileRef }[] = [];
    for (const f of files) {
      if (isPlaylist(f.name)) {
        const text = decodePlaylistBytes(new Uint8Array(await f.read()), f.name);
        for (const it of parsePlaylist(f.name, text)) {
          const loc = resolveLocation(it.location, f.location);
          // in the browser, entries can match other dropped files by name
          const match = files.find((x) => x.location === loc || x.name === loc.split(/[\\/]/).pop());
          items.push({ entry: { ...it, location: loc }, file: match });
        }
      } else if (isMedia(f.name)) items.push({ entry: { location: f.location }, file: f });
    }
    if (!items.length) return this.flash('NO PLAYABLE FILES FOUND');
    if (replace) {
      this.files.clear();
      this.playlist.clear();
    }
    const at = this.playlist.length;
    const made = this.playlist.add(items.map((i) => i.entry));
    made.forEach((e, k) => items[k]!.file && this.files.set(e.id, items[k]!.file!));
    this.engine.invalidateNext();
    this.scan(made);
    if (play) this.playIndex(at);
  }

  private async onDrop(e: DragEvent, _id: WindowId | null): Promise<void> {
    if (!e.dataTransfer) return;
    const all = await filesFromDrop(e.dataTransfer);
    const milk = all.filter((f) => /\.milk$/i.test(f.name));
    if (milk.length) await this.addMilkPresets(milk);
    const files = all.filter((f) => !milk.includes(f));
    if (files.length)
      await this.addFiles(
        files.sort((a, b) => a.location.localeCompare(b.location, undefined, { numeric: true })),
        false,
        this.engine.state === 'stopped' && !this.playlist.length,
      );
  }

  /** Reads tags/durations in the background, a few files at a time. */
  private scan(entries: Entry[]): void {
    this.scanQueue.push(...entries.filter((e) => !isStream(e.location)));
    if (this.scanning) return;
    this.scanning = true;
    const step = async () => {
      const batch = this.scanQueue.splice(0, 8);
      if (!batch.length) {
        this.scanning = false;
        return;
      }
      await Promise.all(
        batch.map(async (e) => {
          const f = await this.fileFor(e).catch(() => null);
          if (!f) return;
          try {
            const c = this.platform.converter;
            e.info =
              c && CONVERT_EXTENSIONS.includes(extOf(f.location))
                ? probeTrackInfo(await c.probe(f.location))
                : await readTrackInfo(f.source());
            if (e.info.durationSec) e.durationSec = e.info.durationSec;
          } catch (err) {
            log.debug('scan failed', e.location, err);
          }
        }),
      );
      this.playlist.changed();
      setTimeout(step, 0);
    };
    void step();
  }

  private async restorePlaylist(): Promise<void> {
    const s = this.settings;
    if (!s.playlist.length) return;
    const made = this.playlist.add(s.playlist.map((p) => ({ ...p })));
    if (s.playlistIndex >= 0 && s.playlistIndex < made.length) {
      this.playlist.setCurrent(s.playlistIndex);
      this.resumeAt = Math.max(0, s.resumePosition);
    }
    this.scan(made);
  }

  // ------------------------------------------------------------------ skins
  async loadSkinUrl(url: string, name = url.split('/').pop() ?? url): Promise<void> {
    try {
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      this.loadSkinBytes(name, bytes, url);
    } catch (e) {
      log.warn('skin load failed', url, e);
      this.flash('COULD NOT LOAD SKIN');
    }
  }

  /** Loads a skin file the user picked or dropped; remembered for next time when it has a real path. */
  async loadSkinFile(f: FileRef): Promise<void> {
    const remember = /^([a-z]:[\\/]|\\\\|https?:\/\/)/i.test(f.location) ? f.location : null;
    this.loadSkinBytes(f.name, new Uint8Array(await f.read()), remember);
  }

  /** Loads the skin remembered from the last session (a URL or, in the desktop app, a file path). */
  async restoreSkin(location: string): Promise<void> {
    if (isBuiltinLocation(location)) {
      const skin = builtinSkin(location);
      if (skin) this.setSkin(skin);
      else log.warn('remembered built-in skin is gone', location);
      return;
    }
    const name =
      location
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.(wsz|zip)$/i, '') ?? location;
    if (/^(https?:\/\/|\/)/i.test(location)) return this.loadSkinUrl(location, name);
    const f = await this.platform.resolve(location).catch(() => null);
    if (f) await this.loadSkinFile(f);
    else log.warn('remembered skin is gone', location);
  }

  loadSkinBytes(name: string, bytes: Uint8Array, remember: string | null): void {
    this.setSkin(skinFromArchive(name.replace(/\.(wsz|zip)$/i, ''), bytes, defaultSkin()));
    this.settings.ui.skin = remember;
    this.scheduleSave();
  }

  setSkin(skin: Skin): void {
    this.skin = skin;
    if (skin.warnings.length) log.info(`skin "${skin.name}":`, skin.warnings.join('; '));
    for (const u of this.cursorUrls.values()) URL.revokeObjectURL(u);
    this.cursorUrls.clear();
    this.plWin.clearTextCache();
    for (const w of [this.main, this.eqWin, this.plWin]) w.relayout();
    this.host.render(true);
  }

  private cursorFor(name: string | undefined): string | undefined {
    if (!name) return undefined;
    // standard pointers for resize spots, used when the skin has no cursor of its own
    const plain = (
      {
        psize: 'nwse-resize',
        'size-se': 'nwse-resize',
        'size-nw': 'nwse-resize',
        'size-ne': 'nesw-resize',
        'size-sw': 'nesw-resize',
        'size-e': 'ew-resize',
        'size-w': 'ew-resize',
        'size-n': 'ns-resize',
        'size-s': 'ns-resize',
      } as Record<string, string>
    )[name];
    const data = this.settings.ui.skinCursors ? this.skin.cursors[name] : undefined;
    if (!data) return plain;
    let url = this.cursorUrls.get(name);
    if (!url) {
      url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'image/x-icon' }));
      this.cursorUrls.set(name, url);
    }
    return `url("${url}"), ${plain ?? 'auto'}`;
  }

  // ------------------------------------------------------------------ EQ presets
  get allPresets(): Preset[] {
    return [...BUILTIN_PRESETS, ...this.settings.userPresets];
  }

  applyPreset(p: Preset): void {
    this.setEq({ ...this.settings.audio.chain.eq, preampDb: p.preampDb, bandsDb: [...p.bandsDb] });
    this.flash(`EQ PRESET: ${p.name.toUpperCase()}`);
  }

  private autoLoadPreset(e: Entry): void {
    const base = displayTitle(e).toLowerCase();
    const file = (e.location.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.[^.]+$/, '');
    const p = this.settings.userPresets.find(
      (x) => x.name.toLowerCase() === file || x.name.toLowerCase() === base,
    );
    if (p) this.applyPreset(p);
  }

  async savePreset(): Promise<void> {
    const name = await prompt('Save preset', 'Preset name:', '');
    if (!name) return;
    const eq = this.settings.audio.chain.eq;
    const list = this.settings.userPresets.filter((p) => p.name !== name);
    list.push({ name, preampDb: eq.preampDb, bandsDb: [...eq.bandsDb] });
    this.settings.userPresets = list;
    this.scheduleSave();
  }

  async importPresets(): Promise<void> {
    const files = await this.platform.pickFiles({ accept: ['eqf', 'q1'], multiple: true });
    let n = 0;
    for (const f of files) {
      try {
        const presets = parseEqf(new Uint8Array(await f.read()));
        this.settings.userPresets.push(...presets);
        n += presets.length;
        if (presets.length === 1 && f.name.toLowerCase().endsWith('.eqf')) this.applyPreset(presets[0]!);
      } catch {
        this.flash('NOT AN EQ PRESET FILE');
      }
    }
    if (n) this.flash(`IMPORTED ${n} PRESET${n > 1 ? 'S' : ''}`);
    this.scheduleSave();
  }

  async exportPreset(): Promise<void> {
    const eq = this.settings.audio.chain.eq;
    await this.platform.saveFile(
      'revamp-preset.eqf',
      writeEqf([{ name: 'RevAmp preset', preampDb: eq.preampDb, bandsDb: eq.bandsDb }]),
    );
  }

  // ------------------------------------------------------------------ playlist menu actions
  private async plMenuAction(id: string): Promise<void> {
    const pl = this.playlist;
    switch (id) {
      case 'addFile':
        return this.openFiles(false);
      case 'addDir':
        return this.openFolder(false);
      case 'addUrl': {
        const url = await prompt('Add location', 'Address of a file or stream:');
        if (url) pl.add([{ location: url, title: url }]);
        return;
      }
      case 'remSel':
        return pl.removeSelected();
      case 'crop':
        return pl.crop();
      case 'remAll':
        return (this.files.clear(), pl.clear());
      case 'remMisc':
        return pl.removeDuplicates();
      case 'selAll':
        return pl.select(() => true);
      case 'selNone':
        return pl.select(() => false);
      case 'selInvert':
        return pl.select((e) => !e.selected);
      case 'sort':
        return this.showMenu('plMisc', innerWidth / 2, innerHeight / 2);
      case 'fileInfo': {
        const i = pl.entries.findIndex((e) => e.selected);
        return this.fileInfo(i >= 0 ? i : pl.current);
      }
      case 'miscOpts':
        return this.showMenu('options', innerWidth / 2, innerHeight / 2);
      case 'newList':
        return (this.files.clear(), pl.clear());
      case 'saveList':
        return this.savePlaylist('m3u8');
      case 'loadList': {
        const files = await this.platform.pickFiles({ accept: PLAYLIST_EXTENSIONS, multiple: false });
        if (files.length) await this.addFiles(files, true, false);
        return;
      }
    }
  }

  async savePlaylist(fmt: 'm3u8' | 'pls' | 'xspf'): Promise<void> {
    const items = this.playlist.entries.map((e) => ({
      location: e.location,
      title: displayTitle(e),
      durationSec: e.info?.durationSec ?? e.durationSec,
    }));
    const text = fmt === 'pls' ? writePls(items) : fmt === 'xspf' ? writeXspf(items) : writeM3u(items);
    await this.platform.saveFile(`playlist.${fmt}`, text);
  }

  // ------------------------------------------------------------------ dialogs
  fileInfo(index = this.playlist.current): void {
    const e = this.playlist.entries[index];
    if (!e) return this.flash('NO FILE SELECTED');
    const i = e.info ?? {};
    const rg = i.replayGain;
    dialog({
      title: 'File info',
      width: 420,
      closeOnOutside: true,
      body: factTable([
        ['Location', e.location],
        ['Title', i.title],
        ['Artist', i.artist],
        ['Album', i.album],
        ['Album artist', i.albumArtist],
        ['Track', i.track],
        ['Year', i.year],
        ['Genre', i.genre],
        ['Comment', i.comment],
        ['Format', i.format],
        ['Length', formatTime(i.durationSec ?? e.durationSec)],
        ['Bit rate', i.bitrateKbps ? `${i.bitrateKbps} kbps` : undefined],
        ['Sample rate', i.sampleRate ? `${i.sampleRate} Hz` : undefined],
        [
          'Channels',
          i.channels
            ? i.channels === 1
              ? 'Mono'
              : i.channels === 2
                ? 'Stereo'
                : String(i.channels)
            : undefined,
        ],
        ['Track gain', rg?.trackGain !== undefined ? `${rg.trackGain.toFixed(2)} dB` : undefined],
        ['Album gain', rg?.albumGain !== undefined ? `${rg.albumGain.toFixed(2)} dB` : undefined],
      ]),
    });
  }

  jumpToFile(): void {
    const wrap = document.createElement('div');
    wrap.className = 'rv-jump';
    const input = document.createElement('input');
    input.placeholder = 'Type part of a title or file name';
    const list = document.createElement('select');
    list.size = 12;
    wrap.append(input, list);
    const fill = () => {
      list.innerHTML = '';
      for (const i of this.playlist.search(input.value).slice(0, 500)) {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = `${i + 1}. ${displayTitle(this.playlist.entries[i]!)}`;
        list.appendChild(o);
      }
      if (list.options.length) list.selectedIndex = 0;
    };
    input.addEventListener('input', fill);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') (list.focus(), e.preventDefault());
    });
    fill();
    const play = () => {
      const v = list.value;
      if (v) this.playIndex(Number(v));
    };
    list.addEventListener('dblclick', () => (play(), d.close()));
    const d = dialog({
      title: 'Jump to file',
      body: wrap,
      width: 440,
      buttons: [{ label: 'Play', primary: true, action: play }, { label: 'Close' }],
    });
  }

  openPreferences(): void {
    openPreferences(this);
  }

  about(): void {
    const body = document.createElement('div');
    body.innerHTML = `<p><b>RevAmp ${VERSION}</b></p><p>A classic skinnable music player, rebuilt from scratch.</p>
      <p>Loads classic <code>.wsz</code> skins. Default skin "Graphite" is original RevAmp art.</p>
      <p>MIT License. Third-party components: fflate (MIT).</p>`;
    dialog({ title: 'About RevAmp', body, width: 380, closeOnOutside: true });
  }

  // ------------------------------------------------------------------ menus
  showMenu(kind: MenuKind, x: number, y: number, arg?: unknown): void {
    const items = this.menuItems(kind, arg);
    if (items.length) showMenu(items, x, y);
  }

  private visMenu(): MenuItem[] {
    const v = this.settings.ui.vis;
    const set = (patch: Partial<typeof v>) => () => (
      Object.assign(v, patch),
      this.main.invalidate(),
      this.scheduleSave()
    );
    return [
      {
        label: 'Spectrum analyser',
        checked: v.mode === 'spectrum',
        radio: true,
        action: set({ mode: 'spectrum' }),
      },
      { label: 'Oscilloscope', checked: v.mode === 'scope', radio: true, action: set({ mode: 'scope' }) },
      { label: 'Off', checked: v.mode === 'off', radio: true, action: set({ mode: 'off' }) },
      'sep',
      {
        label: 'Analyser style',
        submenu: [
          {
            label: 'Normal',
            checked: v.analyzerStyle === 'normal',
            radio: true,
            action: set({ analyzerStyle: 'normal' }),
          },
          {
            label: 'Fire',
            checked: v.analyzerStyle === 'fire',
            radio: true,
            action: set({ analyzerStyle: 'fire' }),
          },
          {
            label: 'Line',
            checked: v.analyzerStyle === 'line',
            radio: true,
            action: set({ analyzerStyle: 'line' }),
          },
          'sep',
          {
            label: 'Thick bands',
            checked: v.bands === 'thick',
            radio: true,
            action: set({ bands: 'thick' }),
          },
          { label: 'Thin bands', checked: v.bands === 'thin', radio: true, action: set({ bands: 'thin' }) },
          { label: 'Show peaks', checked: v.peaks, action: set({ peaks: !v.peaks }) },
        ],
      },
      {
        label: 'Oscilloscope style',
        submenu: (['dots', 'lines', 'solid'] as const).map((st) => ({
          label: st[0]!.toUpperCase() + st.slice(1),
          checked: v.scopeStyle === st,
          radio: true,
          action: set({ scopeStyle: st }),
        })),
      },
      {
        label: 'Falloff speed',
        submenu: [1, 2, 3, 4, 5].map((n) => ({
          label: ['Slowest', 'Slow', 'Moderate', 'Fast', 'Fastest'][n - 1]!,
          checked: v.falloff === n,
          radio: true,
          action: set({ falloff: n }),
        })),
      },
      {
        label: 'Refresh rate',
        submenu: [15, 30, 60].map((n) => ({
          label: `${n} fps`,
          checked: v.fps === n,
          radio: true,
          action: set({ fps: n }),
        })),
      },
    ];
  }

  private skinsMenu(): MenuItem[] {
    const items: MenuItem[] = [
      {
        label: 'RevAmp Graphite (default)',
        checked: this.skin === defaultSkin(),
        radio: true,
        action: () => {
          this.setSkin(defaultSkin());
          this.settings.ui.skin = null;
          this.scheduleSave();
        },
      },
      ...BUILTIN_SKINS.map((s) => ({
        label: s.name,
        checked: this.settings.ui.skin === builtinLocation(s.id),
        radio: true,
        action: () => {
          const loc = builtinLocation(s.id);
          const skin = builtinSkin(loc);
          if (!skin) return;
          this.setSkin(skin);
          this.settings.ui.skin = loc;
          this.scheduleSave();
        },
      })),
      'sep' as const,
      {
        label: 'Load skin file…',
        action: async () => {
          const [f] = await this.platform.pickFiles({ accept: ['wsz', 'zip'], multiple: false });
          if (f) await this.loadSkinFile(f);
        },
      },
    ];
    if (this.skinLibrary.length) {
      items.push('sep');
      for (const s of this.skinLibrary.slice(0, 40))
        items.push({
          label: s.name,
          checked: this.skin.name === s.name,
          radio: true,
          action: () => void this.loadSkinUrl(s.url, s.name),
        });
    }
    return items;
  }

  private menuItems(kind: MenuKind, arg?: unknown): MenuItem[] {
    const st = this.state;
    switch (kind) {
      case 'main':
        return [
          { label: 'Play file…', shortcut: 'L', action: () => void this.openFiles(true) },
          { label: 'Play folder…', shortcut: 'Shift+L', action: () => void this.openFolder(true) },
          { label: 'Play location…', shortcut: 'Ctrl+L', action: () => void this.openUrl() },
          'sep',
          { label: 'Main window', checked: true, disabled: true },
          {
            label: 'Equalizer',
            shortcut: 'Alt+G',
            checked: st.eqVisible,
            action: () => this.toggleWindow('eq'),
          },
          {
            label: 'Playlist editor',
            shortcut: 'Alt+E',
            checked: st.plVisible,
            action: () => this.toggleWindow('pl'),
          },
          {
            label: 'Video window',
            shortcut: 'Alt+V',
            checked: this.host.isVisible('video'),
            action: () => this.toggleWindow('video'),
          },
          {
            label: 'Visualization window',
            shortcut: 'Ctrl+Shift+K',
            checked: this.host.isVisible('visual'),
            action: () => this.toggleWindow('visual'),
          },
          'sep',
          { label: 'Skins', submenu: () => this.skinsMenu() },
          { label: 'Video', submenu: () => this.videoMenu() },
          { label: 'Options', submenu: () => this.menuItems('options') },
          { label: 'Playback', submenu: () => this.playbackMenu() },
          { label: 'Visualization', submenu: () => this.visMenu() },
          'sep',
          { label: 'Preferences…', shortcut: 'Ctrl+P', action: () => this.openPreferences() },
          { label: 'About RevAmp…', action: () => this.about() },
          'sep',
          { label: this.platform.quit ? 'Exit' : 'Close player', action: () => this.closeWindow('main') },
        ];
      case 'options':
        return [
          { label: 'Preferences…', shortcut: 'Ctrl+P', action: () => this.openPreferences() },
          { label: 'Skins', submenu: () => this.skinsMenu() },
          'sep',
          {
            label: 'Time elapsed',
            shortcut: 'Ctrl+T',
            checked: !st.timeRemaining,
            radio: true,
            action: () => st.timeRemaining && this.toggleTimeMode(),
          },
          {
            label: 'Time remaining',
            shortcut: 'Ctrl+T',
            checked: st.timeRemaining,
            radio: true,
            action: () => !st.timeRemaining && this.toggleTimeMode(),
          },
          {
            label: 'Always on top',
            shortcut: 'Ctrl+A',
            checked: st.alwaysOnTop,
            action: () => this.toggleAlwaysOnTop(),
          },
          {
            label: 'Double size',
            shortcut: 'Ctrl+D',
            checked: st.doubleSize,
            action: () => this.toggleDoubleSize(),
          },
          'sep',
          {
            label: 'Repeat: off',
            checked: this.playlist.repeat === 'off',
            radio: true,
            action: () => this.setRepeat('off'),
          },
          {
            label: 'Repeat: whole list',
            shortcut: 'R',
            checked: this.playlist.repeat === 'all',
            radio: true,
            action: () => this.setRepeat('all'),
          },
          {
            label: 'Repeat: one track',
            checked: this.playlist.repeat === 'one',
            radio: true,
            action: () => this.setRepeat('one'),
          },
          { label: 'Shuffle', shortcut: 'S', checked: st.shuffle, action: () => this.toggleShuffle() },
        ];
      case 'vis':
        return this.visMenu();
      case 'video':
        return this.videoMenu();
      case 'visual':
        return this.visualMenu();
      case 'eqPresets':
        return [
          {
            label: 'Load',
            submenu: () => this.allPresets.map((p) => ({ label: p.name, action: () => this.applyPreset(p) })),
          },
          { label: 'Save as…', action: () => void this.savePreset() },
          {
            label: 'Delete',
            disabled: !this.settings.userPresets.length,
            submenu: () =>
              this.settings.userPresets.map((p) => ({
                label: p.name,
                action: () => {
                  this.settings.userPresets = this.settings.userPresets.filter((x) => x !== p);
                  this.scheduleSave();
                },
              })),
          },
          'sep',
          { label: 'Import .eqf / .q1 file…', action: () => void this.importPresets() },
          { label: 'Export current settings as .eqf…', action: () => void this.exportPreset() },
          'sep',
          { label: 'Reset to flat', action: () => this.applyPreset(BUILTIN_PRESETS[0]!) },
          {
            label: 'Band layout',
            submenu: [
              {
                label: 'Classic (60 Hz – 16 kHz)',
                checked: st.eq.bandSet === 'classic',
                radio: true,
                action: () => this.setEq({ ...st.eq, bandSet: 'classic' }),
              },
              {
                label: 'ISO (31 Hz – 16 kHz)',
                checked: st.eq.bandSet === 'iso',
                radio: true,
                action: () => this.setEq({ ...st.eq, bandSet: 'iso' }),
              },
            ],
          },
          {
            label: 'Filter style',
            submenu: [
              {
                label: 'Classic (wide, smooth)',
                checked: st.eq.mode === 'classic',
                radio: true,
                action: () => this.setEq({ ...st.eq, mode: 'classic' }),
              },
              {
                label: 'Precise (narrow)',
                checked: st.eq.mode === 'precise',
                radio: true,
                action: () => this.setEq({ ...st.eq, mode: 'precise' }),
              },
            ],
          },
          {
            label: 'Limiter',
            checked: st.eq.limiter,
            action: () => this.setEq({ ...st.eq, limiter: !st.eq.limiter }),
          },
        ];
      case 'plMisc':
        return [
          { label: 'Sort by title', action: () => this.playlist.sortBy(displayTitle) },
          {
            label: 'Sort by file name',
            action: () => this.playlist.sortBy((e) => e.location.split(/[\\/]/).pop() ?? ''),
          },
          { label: 'Sort by path and file name', action: () => this.playlist.sortBy((e) => e.location) },
          'sep',
          { label: 'Reverse list', action: () => this.playlist.reverse() },
          { label: 'Randomize list', action: () => this.playlist.randomize() },
        ];
      case 'plItem': {
        const i = typeof arg === 'number' ? arg : -1;
        return [
          { label: 'Play item', disabled: i < 0, action: () => this.playIndex(i) },
          { label: 'File info…', disabled: i < 0, action: () => this.fileInfo(i) },
          'sep',
          { label: 'Remove selected', shortcut: 'Del', action: () => this.playlist.removeSelected() },
          { label: 'Crop to selection', action: () => this.playlist.crop() },
          'sep',
          { label: 'Sort', submenu: () => this.menuItems('plMisc') },
          {
            label: 'Save playlist as',
            submenu: [
              { label: 'M3U8…', action: () => void this.savePlaylist('m3u8') },
              { label: 'PLS…', action: () => void this.savePlaylist('pls') },
              { label: 'XSPF…', action: () => void this.savePlaylist('xspf') },
            ],
          },
        ];
      }
      default:
        return [];
    }
  }

  private playbackMenu(): MenuItem[] {
    return [
      { label: 'Previous', shortcut: 'Z', action: () => this.prev() },
      { label: 'Play', shortcut: 'X', action: () => this.play() },
      { label: 'Pause', shortcut: 'C', action: () => this.pause() },
      { label: 'Stop', shortcut: 'V', action: () => this.stop() },
      { label: 'Next', shortcut: 'B', action: () => this.next() },
      'sep',
      { label: 'Back 5 seconds', shortcut: 'Left', action: () => this.seekBy(-5) },
      { label: 'Forward 5 seconds', shortcut: 'Right', action: () => this.seekBy(5) },
      { label: 'Jump to file…', shortcut: 'J', action: () => this.jumpToFile() },
      'sep',
      {
        label: 'Volume up',
        shortcut: 'Up',
        action: () => this.setVolume(this.settings.audio.chain.volume + 0.02),
      },
      {
        label: 'Volume down',
        shortcut: 'Down',
        action: () => this.setVolume(this.settings.audio.chain.volume - 0.02),
      },
    ];
  }

  seekBy(sec: number): void {
    if (!this.engine.currentTrack) return;
    this.engine.seek(Math.max(0, Math.min(this.engine.duration - 0.5, this.engine.position + sec)));
  }

  // ------------------------------------------------------------------ keyboard
  /** Stop when the current track ends (Ctrl+V), once. */
  stopAfterCurrent = false;

  /** First (Ctrl+Z) or last (Ctrl+B) track of the list; plays it if something was playing. */
  private goToTrack(i: number): void {
    if (i < 0 || i >= this.playlist.length) return;
    if (this.engine.state === 'stopped') this.playlist.setCurrent(i);
    else this.playIndex(i);
  }

  /** Moves 10 tracks down or up the list (number pad 3 / 1), stopping at the ends. */
  private jumpTracks(n: number): void {
    if (!this.playlist.length) return;
    this.goToTrack(Math.max(0, Math.min(this.playlist.length - 1, Math.max(0, this.playlist.current) + n)));
  }

  private async jumpToTime(): Promise<void> {
    if (!this.engine.currentTrack) return this.flash('NOTHING PLAYING');
    const text = await prompt(
      'Jump to time',
      'Time (minutes:seconds, or seconds):',
      formatTime(this.engine.position),
    );
    if (!text) return;
    const parts = text.trim().split(':').map(Number);
    if (parts.some((p) => !Number.isFinite(p))) return this.flash('NOT A TIME');
    const sec = parts.reduce((t, p) => t * 60 + p, 0);
    this.seek(Math.max(0, Math.min(this.engine.duration - 0.5, sec)));
  }

  private focusNextWindow(): void {
    const order = (['main', 'eq', 'pl', 'video', 'visual'] as const).filter((id) => this.host.isVisible(id));
    if (!order.length) return;
    const i = order.indexOf(this.host.focused as (typeof order)[number]);
    this.host.focus(order[(i + 1) % order.length]!);
    this.invalidateAll();
  }

  private menuAtWindow(kind: MenuKind, id: WindowId): void {
    const p = this.host.position(id);
    this.showMenu(kind, p.x + 20, p.y + 20);
  }

  private keyActions(): KeyActions {
    const eq = () => this.settings.audio.chain.eq;
    return {
      prev: () => this.prev(),
      play: () => this.play(),
      pause: () => this.pause(),
      stop: () => this.stop(),
      next: () => this.next(),
      firstTrack: () => this.goToTrack(0),
      lastTrack: () => this.goToTrack(this.playlist.length - 1),
      jumpTracks: (n) => this.jumpTracks(n),
      stopWithFade: () => void this.engine.stop(2000),
      toggleStopAfterCurrent: () => {
        this.stopAfterCurrent = !this.stopAfterCurrent;
        this.engine.invalidateNext();
        this.flash(this.stopAfterCurrent ? 'STOP AFTER THIS TRACK' : 'KEEP PLAYING');
      },
      toggleManualAdvance: () => {
        this.settings.manualAdvance = !this.settings.manualAdvance;
        this.engine.invalidateNext();
        this.flash(this.settings.manualAdvance ? 'MANUAL ADVANCE: ON' : 'MANUAL ADVANCE: OFF');
        this.scheduleSave();
      },
      seekBy: (s) => this.seekBy(s),
      volumeBy: (d) => {
        this.setVolume(this.settings.audio.chain.volume + d);
        this.flash(`VOLUME: ${Math.round(this.settings.audio.chain.volume * 100)}%`);
      },
      balanceBy: (d) => {
        this.setBalance(Math.round((this.settings.audio.chain.balance + d) * 100) / 100);
        const b = Math.round(this.settings.audio.chain.balance * 100);
        this.flash(b === 0 ? 'BALANCE: CENTRE' : `BALANCE: ${Math.abs(b)}% ${b < 0 ? 'LEFT' : 'RIGHT'}`);
      },
      openFiles: (replace) => void this.openFiles(replace),
      openFolder: (replace) => void this.openFolder(replace),
      openUrl: (replace) => void (replace ? this.openUrl() : this.plMenuAction('addUrl')),
      jumpToFile: () => this.jumpToFile(),
      jumpToTime: () => void this.jumpToTime(),
      toggleRepeat: () => this.toggleRepeat(),
      toggleShuffle: () => this.toggleShuffle(),
      fileInfo: () => {
        const sel = this.host.focused === 'pl' ? this.playlist.entries.findIndex((e) => e.selected) : -1;
        this.fileInfo(sel >= 0 ? sel : this.playlist.current);
      },
      toggleWindow: (id) => {
        if (id !== 'main') return this.toggleWindow(id);
        // the main window may only hide while another window stays open
        const others = (['eq', 'pl', 'video', 'visual'] as const).some((w) => this.host.isVisible(w));
        if (this.host.isVisible('main') && !others) return;
        this.host.setVisible('main', !this.host.isVisible('main'));
      },
      toggleShade: () =>
        this.toggleShade(
          this.host.focused === 'eq' || this.host.focused === 'pl' ? this.host.focused : 'main',
        ),
      toggleDoubleSize: () => this.toggleDoubleSize(),
      toggleTimeMode: () => this.toggleTimeMode(),
      toggleAlwaysOnTop: () => this.toggleAlwaysOnTop(),
      preferences: () => this.openPreferences(),
      about: () => this.about(),
      minimize: () => this.minimize(),
      quit: () => this.closeWindow('main'),
      mainMenu: () => this.menuAtWindow('main', 'main'),
      skinsMenu: () => this.menuAtWindow('skins', 'main'),
      visualMenu: () => this.menuAtWindow('visual', this.host.isVisible('visual') ? 'visual' : 'main'),
      reloadSkin: () => {
        const loc = this.settings.ui.skin;
        if (loc) void this.restoreSkin(loc);
        else this.setSkin(defaultSkin());
      },
      focusNextWindow: () => this.focusNextWindow(),
      fullscreen: () =>
        this.fullscreenOf === 'visual' || (!this.host.fullscreen && this.host.focused === 'visual')
          ? this.visualCommand('fullscreen')
          : this.videoCommand('fullscreen'),
      exitFullscreen: () => (this.host.fullscreen ? (this.exitFullscreen(), true) : false),
      loadPlaylist: () => void this.plMenuAction('loadList'),
      savePlaylist: () => void this.savePlaylist('m3u8'),
      plShowPlaying: () => {
        if (this.playlist.current >= 0) this.plWin.ensureVisible(this.playlist.current);
      },
      plClear: () => void this.plMenuAction('newList'),
      plCrop: () => this.playlist.crop(),
      plRemoveDead: () => void this.removeMissing(),
      plSort: (by) => {
        const pl = this.playlist;
        if (by === 'title') pl.sortBy(displayTitle);
        else if (by === 'filename') pl.sortBy((e) => e.location.split(/[\\/]/).pop() ?? '');
        else if (by === 'path') pl.sortBy((e) => e.location);
        else if (by === 'reverse') pl.reverse();
        else pl.randomize();
      },
      eqBand: (band, d) => {
        const e = eq();
        this.setEq({ ...e, bandsDb: e.bandsDb.map((v, i) => (i === band ? v + d : v)) });
        this.eqWin.invalidate();
      },
      eqPreamp: (d) => {
        this.setEq({ ...eq(), preampDb: eq().preampDb + d });
        this.eqWin.invalidate();
      },
      eqToggle: () => (this.setEq({ ...eq(), enabled: !eq().enabled }), this.eqWin.invalidate()),
      eqToggleAuto: () => (this.setEq({ ...eq(), auto: !eq().auto }), this.eqWin.invalidate()),
      eqPresets: () => this.menuAtWindow('eqPresets', 'eq'),
      visualNext: () => this.visualCommand('next'),
      visualPrev: () => this.visualCommand('prev'),
    };
  }

  /** Removes playlist entries whose files are gone (Alt+Delete in the playlist). */
  private async removeMissing(): Promise<void> {
    const gone = new Set<number>();
    await Promise.all(
      this.playlist.entries.map(async (e) => {
        if (isStream(e.location)) return;
        const f = await this.platform.resolve(e.location).catch(() => null);
        if (!f) gone.add(e.id);
      }),
    );
    if (gone.size) this.playlist.removeWhere((e) => gone.has(e.id));
    this.flash(`REMOVED ${gone.size} MISSING`);
  }

  /** Last key press and what it did (the QA run reads it). */
  lastKey: { chord: string; where: WindowId; label: string | null } | null = null;

  private onKey(e: KeyboardEvent): void {
    const t = e.target as Element | null;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement)
      return;
    // keys typed in a dialog belong to it; with a dialog open elsewhere, the player still takes keys
    if (t?.closest?.('.rv-dialog, .rv-menu-layer')) return;
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    if (e.key === 'Escape' && this.host.fullscreen) {
      e.preventDefault();
      return this.exitFullscreen();
    }
    const where: WindowId = this.fullscreenOf ?? this.host.focused ?? 'main';
    if (where === 'pl' && this.plWin.key(e)) return void (this.plWin.invalidate(), e.preventDefault());
    const chord = chordOf(e);
    const s = findShortcut(chord, where);
    this.lastKey = { chord, where, label: s?.label ?? null };
    if (!s) return;
    e.preventDefault();
    s.run(this.keyActions());
    this.invalidateAll();
  }

  // ------------------------------------------------------------------ persistence
  private saveLayout(): void {
    for (const id of ['main', 'eq', 'pl', 'video', 'visual'] as const)
      this.settings.ui.positions[id] = this.host.position(id);
    this.scheduleSave();
  }

  scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 500);
  }

  saveNow(): void {
    const s = this.settings;
    s.playlist = this.playlist.entries.slice(0, 20000).map((e) => ({
      location: e.location,
      title: e.info?.title ? displayTitle(e) : e.title,
      durationSec: e.info?.durationSec ?? e.durationSec,
    }));
    s.playlistIndex = this.playlist.current;
    s.resumePosition = this.engine.state === 'stopped' ? this.resumeAt : this.engine.position;
    this.platform.saveSetting('settings', saveSettings(s));
  }

  // ------------------------------------------------------------------ frame loop
  private frame(): void {
    requestAnimationFrame(() => this.frame());
    if (this.minimized) return;
    const now = performance.now();
    // keep the resume position fresh in case the app is killed
    if (this.engine.state === 'playing' && now - this.lastAutoSave > 10_000) {
      this.lastAutoSave = now;
      this.saveNow();
    }
    const v = this.settings.ui.vis;
    if (v.mode !== 'off' && now - this.lastVis >= 1000 / v.fps) {
      this.lastVis = now;
      const shaded = this.settings.ui.shade.main;
      const cols = shaded ? (v.bands === 'thick' ? 10 : 38) : v.bands === 'thick' ? 19 : 76;
      this.vis.update(this.engine.analyser, this.engine.state === 'playing', cols);
    }
    if (this.engine.state !== 'stopped') this.plWin.invalidate();
    this.syncVideo();
    if (this.host.isVisible('visual') || this.fullscreenOf === 'visual') this.visual.render(now);
    void this.seekPreview;
    this.host.render();
  }

  get playStateForTests(): PlayState {
    return this.engine.state;
  }
}
