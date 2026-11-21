/** RevAmp application: connects the audio engine, playlist, skin, windows, menus and settings. */
import { AudioEngine, type EngineTrack, type PlayState } from '../audio/engine';
import { readTrackInfo } from '../audio/tags';
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
  isAudio,
  isPlaylist,
  isSkin,
  AUDIO_EXTENSIONS,
  PLAYLIST_EXTENSIONS,
  type FileRef,
  type Platform,
} from '../platform/platform';
import { filesFromDrop } from '../platform/browser';
import { defaultSkin } from '../skin/default-skin';
import { skinFromArchive, type Skin } from '../skin/skin';
import type { MenuKind, UiContext, UiState } from '../ui/context';
import { dialog, factTable, prompt } from '../ui/dialogs';
import { EqWindow } from '../ui/eq-window';
import { BrowserHost } from '../ui/host-browser';
import { MainWindow } from '../ui/main-window';
import { showMenu, type MenuItem } from '../ui/menu';
import { PlaylistWindow, type TextRenderer } from '../ui/playlist-window';
import { Visualizer } from '../ui/vis';
import type { WindowId } from '../ui/window';
import { openPreferences } from './preferences';

const log = logger('app');
export const VERSION = '0.1.0';

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
    this.engine.on('info', (i) => {
      this.trackMeta.khz = i.sampleRate / 1000;
      this.trackMeta.channels = i.channels;
    });
    if (s.ui.outputDevice) void this.engine.setOutputDevice(s.ui.outputDevice).catch(() => {});

    this.main = new MainWindow(this);
    this.eqWin = new EqWindow(this);
    this.plWin = new PlaylistWindow(this, textRenderer, (id) => void this.plMenuAction(id));
    this.host = new BrowserHost(root, {
      scaleOf: (id) =>
        this.settings.ui.doubleSize && (id === 'main' || (id === 'eq' && this.settings.ui.doubleSizeEq))
          ? 2
          : 1,
      inside: (id, x, y) => this.windowById(id).inside(x, y),
      cursorUrl: (name) => this.cursorFor(name),
      snapEnabled: () => this.settings.ui.snap,
      snapDistance: () => this.settings.ui.snapDistance,
      onFocus: () => this.invalidateAll(),
      onLayout: () => this.saveLayout(),
      onDrop: (id, e) => void this.onDrop(e, id),
    });
    const pos = s.ui.positions;
    this.host.add(this.main, pos.main.x, pos.main.y);
    this.host.add(this.eqWin, pos.eq.x, pos.eq.y, s.ui.eqVisible);
    this.host.add(this.plWin, pos.pl.x, pos.pl.y, s.ui.plVisible);
    this.host.focus('main');
    this.host.keepAllOnScreen();
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
    void this.restorePlaylist();
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
    return id === 'main' ? this.main : id === 'eq' ? this.eqWin : this.plWin;
  }

  invalidateAll(): void {
    this.main.invalidate();
    this.eqWin.invalidate();
    this.plWin.invalidate();
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

  private async fileFor(e: Entry): Promise<FileRef | null> {
    const f = this.files.get(e.id);
    if (f) return f;
    const r = await this.platform.resolve(e.location);
    if (r) this.files.set(e.id, r);
    return r;
  }

  private nextTrackAfter(t: EngineTrack): EngineTrack | null {
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

  playIndex(i: number): void {
    const e = this.playlist.entries[i];
    if (!e) return;
    this.playlist.setCurrent(i);
    void this.resumeCtx().then(() => this.engine.play(this.toTrack(e)));
  }

  private async resumeCtx(): Promise<void> {
    if (this.ctx.state === 'suspended' && this.engine.state !== 'paused') await this.ctx.resume();
  }

  play(): void {
    if (this.engine.state === 'paused') return void this.engine.resume();
    if (!this.playlist.length) return this.eject();
    const i = this.playlist.current >= 0 ? this.playlist.current : 0;
    this.playIndex(i);
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

  toggleWindow(id: 'eq' | 'pl'): void {
    const vis = !this.host.isVisible(id);
    this.host.setVisible(id, vis);
    this.settings.ui[id === 'eq' ? 'eqVisible' : 'plVisible'] = vis;
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

  toggleShade(id: WindowId): void {
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

  // ------------------------------------------------------------------ files
  async openFiles(replace: boolean): Promise<void> {
    const files = await this.platform.pickFiles({
      accept: [...AUDIO_EXTENSIONS, ...PLAYLIST_EXTENSIONS],
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
  async addFiles(files: FileRef[], replace: boolean, play: boolean): Promise<void> {
    const skin = files.find((f) => isSkin(f.name));
    if (skin) return this.loadSkinBytes(skin.name, new Uint8Array(await skin.read()), null);
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
      } else if (isAudio(f.name)) items.push({ entry: { location: f.location }, file: f });
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
    const files = await filesFromDrop(e.dataTransfer);
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
            e.info = await readTrackInfo(f.source());
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
    if (s.playlistIndex >= 0 && s.playlistIndex < made.length) this.playlist.setCurrent(s.playlistIndex);
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
    if (!name || !this.settings.ui.skinCursors) return undefined;
    const data = this.skin.cursors[name];
    if (!data) return undefined;
    let url = this.cursorUrls.get(name);
    if (!url) {
      url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'image/x-icon' }));
      this.cursorUrls.set(name, url);
    }
    return `url("${url}"), auto`;
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

  about(): void {
    const body = document.createElement('div');
    body.innerHTML = `<p><b>RevAmp ${VERSION}</b></p><p>A classic skinnable music player, rebuilt from scratch.</p>
      <p>Loads classic <code>.wsz</code> skins. Default skin "Graphite" is original RevAmp art.</p>
      <p>MIT License. Third-party components: fflate (MIT).</p>`;
    dialog({ title: 'About RevAmp', body, width: 380 });
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
      {
        label: 'Load skin file…',
        action: async () => {
          const [f] = await this.platform.pickFiles({ accept: ['wsz', 'zip'], multiple: false });
          if (f) this.loadSkinBytes(f.name, new Uint8Array(await f.read()), null);
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
          'sep',
          { label: 'Skins', submenu: () => this.skinsMenu() },
          { label: 'Options', submenu: () => this.menuItems('options') },
          { label: 'Playback', submenu: () => this.playbackMenu() },
          { label: 'Visualization', submenu: () => this.visMenu() },
          'sep',
          { label: 'Preferences…', shortcut: 'Ctrl+P', action: () => openPreferences(this) },
          { label: 'About RevAmp…', action: () => this.about() },
          'sep',
          { label: this.platform.quit ? 'Exit' : 'Close player', action: () => this.closeWindow('main') },
        ];
      case 'options':
        return [
          { label: 'Preferences…', shortcut: 'Ctrl+P', action: () => openPreferences(this) },
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
  private onKey(e: KeyboardEvent): void {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      e.target instanceof HTMLSelectElement
    )
      return;
    if (document.querySelector('.rv-dialog-layer')) return;
    if (this.host.focused === 'pl' && this.plWin.key(e))
      return void (this.plWin.invalidate(), e.preventDefault());
    const k = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    const map: Record<string, () => void> = {
      z: () => this.prev(),
      x: () => this.play(),
      c: () => this.pause(),
      v: () => this.stop(),
      b: () => this.next(),
      j: () => this.jumpToFile(),
      r: () => this.toggleRepeat(),
      s: () => this.toggleShuffle(),
      arrowleft: () => this.seekBy(-5),
      arrowright: () => this.seekBy(5),
      arrowup: () => (
        this.setVolume(this.settings.audio.chain.volume + 0.02),
        this.flash(`VOLUME: ${Math.round(this.settings.audio.chain.volume * 100)}%`)
      ),
      arrowdown: () => (
        this.setVolume(this.settings.audio.chain.volume - 0.02),
        this.flash(`VOLUME: ${Math.round(this.settings.audio.chain.volume * 100)}%`)
      ),
    };
    let fn: (() => void) | undefined;
    if (ctrl && k === 'l') fn = () => void this.openUrl();
    else if (ctrl && k === 'd') fn = () => this.toggleDoubleSize();
    else if (ctrl && k === 't') fn = () => this.toggleTimeMode();
    else if (ctrl && k === 'p') fn = () => openPreferences(this);
    else if (ctrl && k === 'a' && this.host.focused !== 'pl') fn = () => this.toggleAlwaysOnTop();
    else if (ctrl && k === 'w') fn = () => this.toggleShade('main');
    else if (e.altKey && k === 'e') fn = () => this.toggleWindow('pl');
    else if (e.altKey && k === 'g') fn = () => this.toggleWindow('eq');
    else if (e.altKey && k === '3') fn = () => this.fileInfo();
    else if (k === 'l' && e.shiftKey && !ctrl) fn = () => void this.openFolder(true);
    else if (k === 'l' && !ctrl && !e.altKey) fn = () => void this.openFiles(true);
    else if (!ctrl && !e.altKey) fn = map[k];
    if (fn) {
      e.preventDefault();
      fn();
      this.invalidateAll();
    }
  }

  // ------------------------------------------------------------------ persistence
  private saveLayout(): void {
    for (const id of ['main', 'eq', 'pl'] as const) this.settings.ui.positions[id] = this.host.position(id);
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
    this.platform.saveSetting('settings', saveSettings(s));
  }

  // ------------------------------------------------------------------ frame loop
  private frame(): void {
    requestAnimationFrame(() => this.frame());
    if (this.minimized) return;
    const now = performance.now();
    const v = this.settings.ui.vis;
    if (v.mode !== 'off' && now - this.lastVis >= 1000 / v.fps) {
      this.lastVis = now;
      const shaded = this.settings.ui.shade.main;
      const cols = shaded ? (v.bands === 'thick' ? 10 : 38) : v.bands === 'thick' ? 19 : 76;
      this.vis.update(this.engine.analyser, this.engine.state === 'playing', cols);
    }
    if (this.engine.state !== 'stopped') this.plWin.invalidate();
    void this.seekPreview;
    this.host.render();
  }

  get playStateForTests(): PlayState {
    return this.engine.state;
  }
}
