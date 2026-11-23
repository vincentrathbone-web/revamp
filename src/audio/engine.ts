/**
 * Playback engine on Web Audio.
 * - Local files are fully decoded, so track changes are sample-exact (gapless) and crossfades are precise.
 * - Very long files and network streams play through a media element (no gapless/crossfade for those).
 * - Works with an AudioContext (live) or an OfflineAudioContext (tests render to memory).
 */
import { Emitter } from '../core/events';
import { logger } from '../core/log';
import { DspChain, defaultChain, type ChainSettings } from './graph';
import { defaultFades, fadeCurve, type FadeSettings, type FadeShape } from './fades';
import { defaultReplayGain, replayGainFactor, type ReplayGainSettings } from './replaygain';
import { findTrim } from './silence';
import type { TrackInfo } from './tags';
import type { ConvertSource } from './convert';
import { MseFeed } from './mse';

const log = logger('engine');

export interface EngineTrack {
  /** Unique key (path or URL). */
  key: string;
  /** Returns the encoded file bytes (for decoding into memory). */
  load(): Promise<ArrayBuffer>;
  /** URL the media element can play (blob:, asset:, http:). Needed for streams and very long files. */
  mediaUrl?(): Promise<string>;
  /** Network stream (radio): always played through the media element. */
  stream?: boolean;
  /** Has a picture: played through a <video> element (its sound still goes through the EQ chain). */
  video?: boolean;
  /**
   * Files the web view may not play (see convert.ts): resolves to a converter stream, or null when the file
   * plays as it is after all. Such tracks always use a media element.
   */
  convert?(): Promise<ConvertSource | null>;
  info?: TrackInfo;
}

export interface AudioSettings {
  chain: ChainSettings;
  fades: FadeSettings;
  fadeShape: FadeShape;
  crossfadeMs: number; // 0 = off
  gapless: boolean;
  silenceRemover: { enabled: boolean; thresholdDb: number };
  replayGain: ReplayGainSettings;
  /** Files longer than this play from the media element instead of being decoded into memory. */
  maxDecodeMinutes: number;
}

export function defaultAudioSettings(): AudioSettings {
  return {
    chain: defaultChain(),
    fades: defaultFades(),
    fadeShape: 'log',
    crossfadeMs: 0,
    gapless: true,
    silenceRemover: { enabled: false, thresholdDb: -60 },
    replayGain: defaultReplayGain(),
    maxDecodeMinutes: 15,
  };
}

export type PlayState = 'stopped' | 'playing' | 'paused';

export interface EngineEvents extends Record<string, unknown> {
  state: PlayState;
  trackStart: EngineTrack;
  trackEnd: EngineTrack;
  ended: undefined; // the last track finished and nothing follows
  error: { track: EngineTrack; error: unknown };
  info: { track: EngineTrack; sampleRate: number; channels: number; duration: number };
}

// ------------------------------------------------------------------ voices
abstract class Voice {
  readonly gain: GainNode;
  readonly rg: GainNode;
  constructor(
    protected readonly ctx: BaseAudioContext,
    readonly track: EngineTrack,
    dest: AudioNode,
  ) {
    this.gain = ctx.createGain();
    this.rg = ctx.createGain();
    this.gain.connect(this.rg);
    this.rg.connect(dest);
  }
  /** Context time at which the voice's fade-in (start fade or crossfade) is done. */
  fadeInEnd = 0;
  abstract readonly kind: 'buffer' | 'media';
  abstract get duration(): number;
  abstract position(now: number): number;
  dispose(): void {
    this.gain.disconnect();
    this.rg.disconnect();
  }
}

class BufferVoice extends Voice {
  readonly kind = 'buffer';
  private src: AudioBufferSourceNode | null = null;
  startAt = 0; // context time at which `startOffset` is heard
  startOffset = 0;
  readonly trimStart: number;
  readonly trimEnd: number;
  scheduled = false;

  /**
   * @param partial true while this voice only holds the first seconds of the song (fast start); the engine swaps
   *   in the full decode as soon as it is ready.
   */
  constructor(
    ctx: BaseAudioContext,
    track: EngineTrack,
    dest: AudioNode,
    readonly buffer: AudioBuffer,
    trim: boolean | { start: number; end: number },
    thresholdDb: number,
    readonly partial = false,
  ) {
    super(ctx, track, dest);
    const sr = buffer.sampleRate;
    if (typeof trim === 'object') {
      this.trimStart = trim.start;
      this.trimEnd = trim.end;
    } else if (trim) {
      const ch = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
      const t = findTrim(ch, sr, thresholdDb, 5);
      this.trimStart = t.end > t.start ? t.start / sr : 0;
      this.trimEnd = t.end > t.start ? t.end / sr : buffer.duration;
    } else {
      this.trimStart = 0;
      this.trimEnd = buffer.duration;
    }
  }

  get duration(): number {
    return this.buffer.duration;
  }

  /** Starts (or restarts) playback of buffer time `offset` at context time `when` (both frame-aligned). */
  start(when: number, offset: number): void {
    this.unschedule();
    const sr = this.ctx.sampleRate;
    const w = Math.round(when * sr) / sr;
    const off = Math.max(this.trimStart, Math.min(this.trimEnd, Math.round(offset * sr) / sr));
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.gain);
    src.start(w, off, Math.max(0, this.trimEnd - off));
    this.src = src;
    this.startAt = w;
    this.startOffset = off;
    this.scheduled = true;
  }

  /** Stops at context time `when` (used when handing over to the full decode). */
  stopAt(when: number): void {
    try {
      this.src?.stop(when);
    } catch {
      /* not started */
    }
  }

  unschedule(): void {
    if (this.src) {
      try {
        this.src.stop();
      } catch {
        /* never started */
      }
      this.src.disconnect();
      this.src = null;
    }
    this.scheduled = false;
  }

  /** Context time at which the trimmed end is reached. Frame-exact. */
  endTime(): number {
    const sr = this.ctx.sampleRate;
    return (Math.round(this.startAt * sr) + Math.round((this.trimEnd - this.startOffset) * sr)) / sr;
  }

  position(now: number): number {
    if (!this.scheduled) return this.startOffset;
    return Math.max(this.trimStart, Math.min(this.trimEnd, this.startOffset + (now - this.startAt)));
  }

  override dispose(): void {
    this.unschedule();
    super.dispose();
  }
}

class MediaVoice extends Voice {
  readonly kind = 'media';
  readonly el: HTMLMediaElement;
  private node: MediaElementAudioSourceNode;
  /** Set when the file streams through the converter. */
  readonly feed: MseFeed | null = null;
  constructor(ctx: AudioContext, track: EngineTrack, dest: AudioNode, url: string, source?: ConvertSource) {
    super(ctx, track, dest);
    if (source ? source.hasVideo : track.video) {
      const v = document.createElement('video');
      v.playsInline = true;
      v.disablePictureInPicture = true;
      this.el = v;
    } else this.el = new Audio();
    this.el.crossOrigin = 'anonymous';
    this.el.preload = 'auto';
    if (source) {
      this.feed = new MseFeed(this.el, source);
      this.el.src = this.feed.url;
    } else this.el.src = url;
    this.node = ctx.createMediaElementSource(this.el);
    this.node.connect(this.gain);
  }
  get duration(): number {
    return Number.isFinite(this.el.duration) ? this.el.duration : 0;
  }
  position(): number {
    return this.el.currentTime;
  }
  override dispose(): void {
    this.feed?.dispose();
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
    this.el.remove(); // a video element may be on the page
    this.node.disconnect();
    super.dispose();
  }
}

// ------------------------------------------------------------------ engine
export class AudioEngine extends Emitter<EngineEvents> {
  readonly chain: DspChain;
  settings: AudioSettings;
  state: PlayState = 'stopped';
  private current: Voice | null = null;
  private next: BufferVoice | null = null;
  private nextLoading: { key: string; promise: Promise<void> } | null = null;
  private pending = new Set<Promise<unknown>>();
  private firstStartDone = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private generation = 0; // bumps on every manual change, so stale async loads are ignored
  private readonly live: boolean;

  /** `getNext` tells the engine which track follows the given one (or null at the end of the list). */
  constructor(
    readonly ctx: BaseAudioContext,
    private readonly getNext: (after: EngineTrack) => EngineTrack | null,
    settings: AudioSettings = defaultAudioSettings(),
  ) {
    super();
    this.settings = structuredClone(settings);
    this.live = typeof AudioContext !== 'undefined' && ctx instanceof AudioContext;
    this.chain = new DspChain(ctx, ctx.destination, this.settings.chain);
    if (this.live) this.timer = setInterval(() => this.tick(), 40);
  }

  get currentTrack(): EngineTrack | null {
    return this.current?.track ?? null;
  }
  get position(): number {
    const v = this.current;
    if (!v) return 0;
    return v instanceof BufferVoice
      ? v.position(this.ctx.currentTime) - v.trimStart
      : v.position(this.ctx.currentTime);
  }
  get duration(): number {
    const v = this.current;
    if (!v) return 0;
    if (v instanceof BufferVoice && v.partial) return v.track.info?.durationSec ?? v.buffer.duration;
    return v instanceof BufferVoice ? v.trimEnd - v.trimStart : v.duration;
  }
  get analyser(): AnalyserNode {
    return this.chain.analyser;
  }
  /** The <video> element of the current track, if it has a picture. */
  get videoElement(): HTMLVideoElement | null {
    const v = this.current;
    if (!(v instanceof MediaVoice) || typeof HTMLVideoElement === 'undefined') return null;
    return v.el instanceof HTMLVideoElement ? v.el : null;
  }

  /** Resolves when all background loading/scheduling has finished (used by tests). */
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  private track<T>(p: Promise<T>): Promise<T> {
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p)).catch(() => {});
    return p;
  }

  private lead(): number {
    return this.live ? 0.03 : 0;
  }

  private setState(s: PlayState): void {
    if (this.state !== s) {
      this.state = s;
      this.emit('state', s);
    }
  }

  // ---------------------------------------------------------------- loading
  private wantsMedia(t: EngineTrack): boolean {
    if (t.stream || t.video || t.convert) return true;
    const d = t.info?.durationSec;
    return !!(t.mediaUrl && this.live && d && d > this.settings.maxDecodeMinutes * 60);
  }

  private async makeVoice(t: EngineTrack): Promise<Voice> {
    if (this.wantsMedia(t)) {
      if (!this.live) throw new Error('Streams need a live audio context');
      const source = t.convert ? await t.convert() : null;
      const v = source
        ? new MediaVoice(this.ctx as AudioContext, t, this.chain.input, '', source)
        : t.mediaUrl
          ? new MediaVoice(this.ctx as AudioContext, t, this.chain.input, await t.mediaUrl())
          : null;
      if (!v) throw new Error('Streams need a media URL');
      v.rg.gain.value = replayGainFactor(t.info?.replayGain, this.settings.replayGain);
      return v;
    }
    const bytes = await t.load();
    return this.bufferVoice(t, await this.ctx.decodeAudioData(bytes));
  }

  private bufferVoice(t: EngineTrack, buffer: AudioBuffer, partial = false): BufferVoice {
    const v = new BufferVoice(
      this.ctx,
      t,
      this.chain.input,
      buffer,
      this.settings.silenceRemover.enabled && !partial,
      this.settings.silenceRemover.thresholdDb,
      partial,
    );
    v.rg.gain.value = replayGainFactor(t.info?.replayGain, this.settings.replayGain);
    if (!partial)
      this.emit('info', {
        track: t,
        sampleRate: buffer.sampleRate,
        channels: buffer.numberOfChannels,
        duration: buffer.duration,
      });
    return v;
  }

  /** Seconds decoded up front for a fast start; the rest is decoded while the song already plays. */
  static readonly HEAD_SECONDS = 15;

  /**
   * Fast start: decodes only the first seconds of the file, so playback starts in a few tens of ms instead of
   * waiting for the whole song (about 1 s for a 4-minute MP3). Returns the partial voice and a promise for the
   * full decode. Returns null when not worth it or not possible (short files, offsets, formats that can't be cut).
   */
  private async fastStart(
    t: EngineTrack,
    offset: number,
  ): Promise<{ voice: BufferVoice; full: Promise<AudioBuffer> | null } | null> {
    if (!this.live || this.wantsMedia(t) || offset > 5 || this.settings.silenceRemover.enabled) return null;
    const bytes = await t.load();
    const size = bytes.byteLength;
    const dur = t.info?.durationSec;
    const head = Math.max(256 * 1024, dur ? Math.ceil((size * AudioEngine.HEAD_SECONDS) / dur) : 512 * 1024);
    if (head * 1.5 >= size) {
      // small file: decoding everything is quick anyway
      return { voice: this.bufferVoice(t, await this.ctx.decodeAudioData(bytes)), full: null };
    }
    const full = this.ctx.decodeAudioData(bytes.slice(0));
    full.catch(() => {});
    try {
      const part = await this.ctx.decodeAudioData(bytes.slice(0, head));
      if (part.duration < Math.min(4, AudioEngine.HEAD_SECONDS / 2) + offset)
        throw new Error('head too short');
      return { voice: this.bufferVoice(t, part, true), full };
    } catch {
      // format that can't be cut (e.g. MP4 with its index at the end): wait for the full decode
      return { voice: this.bufferVoice(t, await full), full: null };
    }
  }

  /** Swaps a partial voice for the full decode at the same sample, without a click. */
  private async completeFastStart(part: BufferVoice, full: Promise<AudioBuffer>, gen: number): Promise<void> {
    let buffer: AudioBuffer;
    try {
      buffer = await full;
    } catch {
      return; // nothing to swap (already complete)
    }
    // swapping mid fade-in would freeze the volume where the fade happened to be: wait for it to finish
    while (gen === this.generation && this.current === part && part.fadeInEnd > this.ctx.currentTime)
      await sleep(Math.min(250, (part.fadeInEnd - this.ctx.currentTime) * 1000 + 20));
    if (gen !== this.generation || this.current !== part) return;
    const voice = this.bufferVoice(part.track, buffer);
    const sr = this.ctx.sampleRate;
    const when = Math.round((this.ctx.currentTime + 0.05) * sr) / sr;
    const pos = this.pendingSeek !== null ? this.pendingSeek + voice.trimStart : part.position(when);
    const seekJump = this.pendingSeek !== null;
    this.pendingSeek = null;
    if (pos >= part.buffer.duration - 0.01 && !seekJump)
      log.warn('fast start ran out before the full decode');
    // the two decodes should match sample for sample; if not, hide the seam with a 15 ms crossfade
    const same = !seekJump && sameSamples(part.buffer, buffer, pos, 512);
    voice.start(when, pos);
    if (same) part.stopAt(when);
    else {
      const xf = 0.015;
      this.ramp(voice.gain.gain, when, xf, 0, 1);
      voice.fadeInEnd = when + xf;
      this.ramp(part.gain.gain, when, xf, 1, 0);
      part.stopAt(when + xf);
    }
    this.current = voice;
    setTimeout(() => part.dispose(), 300);
    this.preloadNext(gen);
  }

  /** Seek target (seconds) asked for while only the start of the song was decoded. */
  private pendingSeek: number | null = null;

  // ---------------------------------------------------------------- transport
  /** Starts playing `t` from `offset` seconds. */
  play(t: EngineTrack, offset = 0): Promise<void> {
    return this.track(this.playInner(t, offset));
  }

  private async playInner(t: EngineTrack, offset: number): Promise<void> {
    const gen = ++this.generation;
    this.dropNext();
    if (this.live && (this.ctx as AudioContext).state === 'suspended')
      await (this.ctx as AudioContext).resume();
    this.chain.input.gain.cancelScheduledValues(this.ctx.currentTime);
    this.chain.input.gain.value = 1;
    let voice: Voice;
    let full: Promise<AudioBuffer> | null = null;
    this.pendingSeek = null;
    try {
      const fast = await this.fastStart(t, offset);
      if (fast) {
        voice = fast.voice;
        full = fast.full;
      } else voice = await this.makeVoice(t);
    } catch (error) {
      if (gen !== this.generation) return;
      log.warn('could not play', t.key, error);
      this.emit('error', { track: t, error });
      return;
    }
    if (gen !== this.generation) return voice.dispose();
    this.current?.dispose();
    this.current = voice;
    const fade = this.firstStartDone ? this.settings.fades.start : this.settings.fades.firstStart;
    this.firstStartDone = true;
    const when = this.ctx.currentTime + this.lead();
    if (fade.enabled && fade.ms > 0) {
      this.ramp(voice.gain.gain, when, fade.ms / 1000, 0, 1);
      voice.fadeInEnd = when + fade.ms / 1000;
    }
    if (voice instanceof BufferVoice) voice.start(when, voice.trimStart + offset);
    else {
      const el = (voice as MediaVoice).el;
      el.currentTime = offset;
      el.onended = () => this.onMediaEnded(voice);
      el.onerror = () => this.emit('error', { track: t, error: el.error });
      const feed = (voice as MediaVoice).feed;
      if (feed) feed.onerror = (error) => this.emit('error', { track: t, error });
      await el.play().catch((error) => this.emit('error', { track: t, error }));
    }
    this.setState('playing');
    this.emit('trackStart', t);
    if (voice instanceof BufferVoice && voice.partial && full)
      void this.track(this.completeFastStart(voice, full, gen));
    else this.preloadNext(gen);
  }

  pause(): Promise<void> {
    return this.track(this.pauseInner());
  }

  private async pauseInner(): Promise<void> {
    if (this.state !== 'playing' || !this.current) return;
    this.setState('paused');
    const f = this.settings.fades.pause;
    if (f.enabled && f.ms > 0) {
      this.ramp(this.chain.input.gain, this.ctx.currentTime, f.ms / 1000, 1, 0);
      await sleep(f.ms);
    }
    if ((this.state as PlayState) !== 'paused') return; // resumed during the fade
    if (this.current instanceof MediaVoice) this.current.el.pause();
    else if (this.live) await (this.ctx as AudioContext).suspend();
  }

  resume(): Promise<void> {
    return this.track(this.resumeInner());
  }

  private async resumeInner(): Promise<void> {
    if (this.state !== 'paused' || !this.current) return;
    if (this.live) await (this.ctx as AudioContext).resume();
    if (this.current instanceof MediaVoice) await this.current.el.play();
    const f = this.settings.fades.resume;
    const g = this.chain.input.gain;
    if (f.enabled && f.ms > 0) this.ramp(g, this.ctx.currentTime, f.ms / 1000, 0, 1);
    else {
      g.cancelScheduledValues(this.ctx.currentTime);
      g.value = 1;
    }
    this.setState('playing');
  }

  /** Stops; `fadeMs` overrides the stop fade from the settings. */
  stop(fadeMs?: number): Promise<void> {
    return this.track(this.stopInner(fadeMs));
  }

  private async stopInner(fadeMs?: number): Promise<void> {
    if (!this.current) return this.setState('stopped');
    const gen = ++this.generation;
    const f = fadeMs === undefined ? this.settings.fades.stop : { enabled: fadeMs > 0, ms: fadeMs };
    if (this.state === 'playing' && f.enabled && f.ms > 0) {
      this.ramp(this.chain.input.gain, this.ctx.currentTime, f.ms / 1000, 1, 0);
      await sleep(f.ms);
      if (gen !== this.generation) return;
    }
    this.dropNext();
    this.current?.dispose();
    this.current = null;
    if (this.live && (this.ctx as AudioContext).state === 'suspended')
      await (this.ctx as AudioContext).resume();
    this.chain.input.gain.cancelScheduledValues(this.ctx.currentTime);
    this.chain.input.gain.value = 1;
    this.setState('stopped');
  }

  /** True when the last seek was a crossfade (read by the QA run). */
  lastSeekCrossfaded = false;
  /** How long the last seek crossfade took, in ms (read by the QA run). */
  lastSeekFadeMs = 0;

  /** Jumps to `sec` seconds into the current track. */
  seek(sec: number): void {
    const v = this.current;
    if (!v) return;
    const now = this.ctx.currentTime;
    this.lastSeekCrossfaded = false;
    // Like the classic output: the old spot fades out while the new spot fades in, both over the
    // "Fade on seek" time. The song crossfade length has nothing to do with it.
    const f = this.settings.fades.seek;
    const fs = f.enabled ? f.ms / 1000 : 0;
    if (fs > 0 && this.state === 'playing' && this.seekCrossfade(v, Math.max(0, sec), fs)) return;
    if (fs > 0 && this.state === 'playing') {
      const g = this.chain.input.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(0, now);
      g.linearRampToValueAtTime(1, now + this.lead() + f.ms / 1000);
    }
    if (v instanceof BufferVoice) {
      if (v.partial && v.trimStart + sec > v.buffer.duration - 1) {
        // beyond the decoded start: jump there as soon as the full song is ready
        this.pendingSeek = Math.max(0, sec);
        return;
      }
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.value = 1;
      v.start(now + this.lead(), v.trimStart + Math.max(0, sec));
      if (this.next) {
        this.next.unschedule();
        this.scheduleNext();
      }
    } else (v as MediaVoice).el.currentTime = Math.max(0, sec);
  }

  /**
   * Plays the same song from the new spot on a second voice and crossfades to it over `xf` seconds (the
   * seek fade time). Returns false when it can't (then the plain seek runs).
   */
  private seekCrossfade(v: Voice, sec: number, xf: number): boolean {
    if (v instanceof MediaVoice) {
      // one media element can't be in two places: dip the sound around the jump instead
      const g = this.chain.input.gain;
      const half = xf / 2;
      const now = this.ctx.currentTime;
      this.ramp(g, now, half, g.value, 0);
      const el = v.el;
      setTimeout(() => {
        if (this.current !== v) return;
        el.currentTime = sec;
        this.ramp(g, this.ctx.currentTime, half, 0, 1);
      }, half * 1000);
      this.lastSeekCrossfaded = true;
      this.lastSeekFadeMs = Math.round(xf * 1000);
      return true;
    }
    if (!(v instanceof BufferVoice)) return false;
    const target = v.trimStart + sec;
    if (target >= v.trimEnd - 0.05) return false;
    if (v.partial) return false; // the full decode is about to replace this voice: plain seek
    const nv = new BufferVoice(
      this.ctx,
      v.track,
      this.chain.input,
      v.buffer,
      { start: v.trimStart, end: v.trimEnd },
      0,
      false,
    );
    nv.rg.gain.value = v.rg.gain.value;
    const sr = this.ctx.sampleRate;
    const when = Math.round((this.ctx.currentTime + this.lead()) * sr) / sr;
    const dur = Math.max(0.01, Math.min(xf, v.trimEnd - target));
    nv.start(when, target);
    this.ramp(nv.gain.gain, when, dur, 0, 1);
    nv.fadeInEnd = when + dur;
    // the old voice fades from wherever its own fade is right now
    const from = v.fadeInEnd > when ? Math.max(0, Math.min(1, v.gain.gain.value)) : 1;
    this.ramp(v.gain.gain, when, dur, from, 0);
    v.stopAt(when + dur);
    v.fadeInEnd = 0;
    this.current = nv;
    setTimeout(() => v.dispose(), (dur + 0.3) * 1000);
    if (this.next) {
      this.next.unschedule();
      this.scheduleNext();
    }
    this.lastSeekCrossfaded = true;
    this.lastSeekFadeMs = Math.round(dur * 1000);
    return true;
  }

  /** What each voice is doing right now (read by the QA run). */
  debugVoices(): { role: string; kind: string; key: string; rg: number; gain: number; partial: boolean }[] {
    const out = [];
    for (const [role, v] of [
      ['current', this.current],
      ['next', this.next],
    ] as const)
      if (v)
        out.push({
          role,
          kind: v.kind,
          key: v.track.key,
          rg: Math.round(v.rg.gain.value * 1000) / 1000,
          gain: Math.round(v.gain.gain.value * 1000) / 1000,
          partial: v instanceof BufferVoice && v.partial,
        });
    return out;
  }

  /** Call when the playlist order changed, so the preloaded next track is chosen again. */
  invalidateNext(): void {
    if (!this.current) return;
    this.dropNext();
    this.preloadNext(this.generation);
  }

  setSettings(s: AudioSettings): void {
    const old = this.settings;
    this.settings = structuredClone(s);
    this.chain.apply(this.settings.chain);
    if (JSON.stringify(old.replayGain) !== JSON.stringify(s.replayGain)) {
      for (const v of [this.current, this.next])
        if (v)
          v.rg.gain.setTargetAtTime(
            replayGainFactor(v.track.info?.replayGain, s.replayGain),
            this.ctx.currentTime,
            0.05,
          );
    }
    if (
      old.crossfadeMs !== s.crossfadeMs ||
      old.gapless !== s.gapless ||
      old.fades.endOfSong.enabled !== s.fades.endOfSong.enabled
    ) {
      if (this.next) {
        this.next.unschedule();
        this.scheduleNext();
      }
    }
  }

  /** Lists audio outputs (labels may be empty until the browser grants media permission). */
  static async outputDevices(): Promise<{ id: string; label: string }[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((d) => d.kind === 'audiooutput')
      .map((d) => ({ id: d.deviceId, label: d.label || d.deviceId }));
  }

  /** Switches the output device ("" = system default, which also follows Windows default changes). */
  async setOutputDevice(id: string): Promise<boolean> {
    const c = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (!this.live || !c.setSinkId) return false;
    await c.setSinkId(id);
    return true;
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.dropNext();
    this.current?.dispose();
    this.chain.dispose();
  }

  // ---------------------------------------------------------------- scheduling
  private ramp(p: AudioParam, when: number, dur: number, from: number, to: number): void {
    p.cancelScheduledValues(when);
    p.setValueAtTime(from, when);
    const pts = Math.max(2, Math.min(512, Math.round(dur * 200)));
    p.setValueCurveAtTime(fadeCurve(pts, from, to, this.settings.fadeShape), when, Math.max(0.001, dur));
  }

  private dropNext(): void {
    this.next?.dispose();
    this.next = null;
    this.nextLoading = null;
  }

  private preloadNext(gen: number): void {
    const cur = this.current;
    if (!cur || this.next || this.nextLoading) return;
    const t = this.getNext(cur.track);
    if (!t) {
      this.scheduleEndFade();
      return;
    }
    if (cur instanceof MediaVoice || this.wantsMedia(t)) return; // no gapless across media voices
    const promise = (async () => {
      try {
        const v = await this.makeVoice(t);
        if (gen !== this.generation || this.current !== cur || this.nextLoading?.key !== t.key)
          return v.dispose();
        this.next = v as BufferVoice;
        this.nextLoading = null;
        this.scheduleNext();
      } catch (error) {
        log.warn('preload failed', t.key, error);
        if (this.nextLoading?.key === t.key) this.nextLoading = null;
      }
    })();
    this.nextLoading = { key: t.key, promise };
    this.track(promise);
  }

  /** Schedules the preloaded next track right at the end of the current one (or overlapping for crossfade). */
  private scheduleNext(): void {
    const cur = this.current;
    const nxt = this.next;
    if (!(cur instanceof BufferVoice) || !nxt || !cur.scheduled || cur.partial) return;
    const xf = this.settings.crossfadeMs / 1000;
    const end = cur.endTime();
    const now = this.ctx.currentTime;
    // Cancelling an automation that is under way puts the value back to where it started (0 for a
    // fade-in), so only clear what comes after the current fade-in.
    const keepUntil = Math.max(now, cur.startAt, cur.fadeInEnd);
    cur.gain.gain.cancelScheduledValues(keepUntil);
    if (xf > 0) {
      const dur = Math.min(xf, cur.trimEnd - cur.trimStart, nxt.trimEnd - nxt.trimStart);
      const when = Math.max(now + this.lead(), end - dur, keepUntil);
      nxt.start(when, nxt.trimStart);
      this.ramp(cur.gain.gain, when, Math.max(0.001, end - when), 1, 0);
      this.ramp(nxt.gain.gain, when, Math.max(0.001, end - when), 0, 1);
      nxt.fadeInEnd = when + Math.max(0.001, end - when);
    } else if (this.settings.gapless) {
      nxt.start(Math.max(now + this.lead(), end), nxt.trimStart);
    } else {
      // Not gapless: a short pause between tracks, like separate files would have.
      nxt.start(Math.max(now + this.lead(), end + 0.25), nxt.trimStart);
    }
  }

  private scheduleEndFade(): void {
    const cur = this.current;
    const f = this.settings.fades.endOfSong;
    if (!(cur instanceof BufferVoice) || cur.partial || !f.enabled || f.ms <= 0) return;
    const dur = Math.min(f.ms / 1000, cur.trimEnd - cur.trimStart);
    this.ramp(cur.gain.gain, Math.max(this.ctx.currentTime, cur.fadeInEnd, cur.endTime() - dur), dur, 1, 0);
  }

  /** Live mode: promotes the next track when it starts and detects the end of the list. */
  tick(): void {
    if (this.state !== 'playing') return;
    const now = this.ctx.currentTime;
    const cur = this.current;
    if (!(cur instanceof BufferVoice) || cur.partial) return;
    if (this.next && this.next.scheduled && now >= this.next.startAt) {
      const old = cur;
      const nxt = this.next;
      this.next = null;
      this.current = nxt;
      this.emit('trackEnd', old.track);
      // Let the old voice finish its crossfade tail before releasing it.
      const tail = Math.max(0, old.endTime() - now);
      setTimeout(() => old.dispose(), tail * 1000 + 200);
      this.emit('trackStart', nxt.track);
      this.preloadNext(this.generation);
    } else if (!this.next && !this.nextLoading && now >= cur.endTime()) {
      this.emit('trackEnd', cur.track);
      cur.dispose();
      this.current = null;
      this.setState('stopped');
      this.emit('ended', undefined);
    }
  }

  private onMediaEnded(v: Voice): void {
    if (this.current !== v) return;
    this.emit('trackEnd', v.track);
    const t = this.getNext(v.track);
    if (t) void this.play(t);
    else {
      v.dispose();
      this.current = null;
      this.setState('stopped');
      this.emit('ended', undefined);
    }
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** True if `a` and `b` hold the same samples for `n` frames from `atSec` (all channels, tiny tolerance). */
export function sameSamples(a: AudioBuffer, b: AudioBuffer, atSec: number, n: number): boolean {
  if (a.sampleRate !== b.sampleRate || a.numberOfChannels !== b.numberOfChannels) return false;
  const i0 = Math.round(atSec * a.sampleRate);
  if (i0 + n > a.length || i0 + n > b.length) return false;
  for (let c = 0; c < a.numberOfChannels; c++) {
    const x = a.getChannelData(c),
      y = b.getChannelData(c);
    for (let i = i0; i < i0 + n; i++) if (Math.abs(x[i]! - y[i]!) > 1e-6) return false;
  }
  return true;
}
