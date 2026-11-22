/**
 * Streams converted fragmented MP4 (see convert.ts) into a media element through Media Source Extensions.
 * - keeps about AHEAD seconds buffered in front of the play position and drops what is far behind it;
 * - a seek outside the buffered part starts the converter again at the new time;
 * - small gaps at the start of a new stream (first frame a little after the seek point) are jumped over.
 */
import { codecsFromInit, initSegmentEnd, type ByteReader, type ConvertSource } from './convert';
import { logger } from '../core/log';

const log = logger('mse');

const AHEAD = 30;
const KEEP_BEHIND = 20;

const concat = (a: Uint8Array, b: Uint8Array) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MseFeed {
  readonly url: string;
  /** Conversion or decoding failed. */
  onerror: ((error: unknown) => void) | null = null;
  /** The MIME type the source buffer was made with (for tests and logs). */
  mime = '';
  private readonly ms = new MediaSource();
  private sb: SourceBuffer | null = null;
  private reader: ByteReader | null = null;
  private gen = 0;
  private closed = false;
  private wakeUp: (() => void) | null = null;

  constructor(
    private readonly el: HTMLMediaElement,
    private readonly src: ConvertSource,
  ) {
    this.url = URL.createObjectURL(this.ms);
    this.ms.addEventListener(
      'sourceopen',
      () => {
        if (src.durationSec > 0) this.ms.duration = src.durationSec;
        void this.restart(el.currentTime || 0);
      },
      { once: true },
    );
    el.addEventListener('seeking', this.onSeeking);
    el.addEventListener('timeupdate', this.wake);
    el.addEventListener('waiting', this.jumpGap);
  }

  /** Seconds buffered in front of the play position. */
  get ahead(): number {
    const b = this.sb?.buffered;
    return b?.length ? Math.max(0, b.end(b.length - 1) - this.el.currentTime) : 0;
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.gen++;
    this.reader?.close();
    this.reader = null;
    this.wake();
    this.el.removeEventListener('seeking', this.onSeeking);
    this.el.removeEventListener('timeupdate', this.wake);
    this.el.removeEventListener('waiting', this.jumpGap);
    URL.revokeObjectURL(this.url);
  }

  private readonly wake = () => {
    const w = this.wakeUp;
    this.wakeUp = null;
    w?.();
  };

  private readonly onSeeking = () => {
    if (this.closed || this.ms.readyState === 'closed') return;
    const t = this.el.currentTime;
    if (this.isBuffered(t)) return;
    void this.restart(t);
  };

  private isBuffered(t: number): boolean {
    const b = this.sb?.buffered;
    if (!b) return false;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.05 && t < b.end(i) - 0.1) return true;
    return false;
  }

  /** The play position sits just before the first buffered frame: move onto it. */
  private readonly jumpGap = () => {
    const b = this.sb?.buffered;
    if (!b?.length) return;
    const t = this.el.currentTime;
    for (let i = 0; i < b.length; i++) {
      const s = b.start(i);
      if (s > t && s - t < 1.5) {
        this.el.currentTime = s + 0.001;
        return;
      }
      if (s <= t) continue;
      break;
    }
  };

  private async restart(t: number): Promise<void> {
    const gen = ++this.gen;
    this.reader?.close();
    this.reader = null;
    this.wake();
    try {
      if (this.sb) await this.clear();
      if (gen !== this.gen) return;
      const reader = await this.src.open(Math.max(0, t));
      if (gen !== this.gen || this.closed) return reader.close();
      this.reader = reader;
      await this.pump(reader, gen);
    } catch (e) {
      if (gen === this.gen && !this.closed) {
        log.warn('conversion failed', e);
        this.onerror?.(e);
      }
    }
  }

  private idle(): Promise<void> {
    const sb = this.sb;
    if (!sb?.updating) return Promise.resolve();
    return new Promise((r) => sb.addEventListener('updateend', () => r(), { once: true }));
  }

  /** Drops everything buffered and resets the parser, ready for a new stream (with its own init segment). */
  private async clear(): Promise<void> {
    const sb = this.sb!;
    if (this.ms.readyState === 'open') sb.abort();
    await this.idle();
    if (sb.buffered.length) {
      sb.remove(0, Infinity);
      await this.idle();
    }
  }

  private async pump(reader: ByteReader, gen: number): Promise<void> {
    let head = new Uint8Array(0);
    let first = true;
    if (this.sb) this.sb.timestampOffset = reader.start;
    for (;;) {
      await this.room(gen);
      if (gen !== this.gen) return;
      const chunk = await reader.read();
      if (gen !== this.gen) return;
      if (!chunk) break;
      let data = chunk;
      if (!this.sb) {
        head = concat(head, chunk);
        const end = initSegmentEnd(head);
        if (end < 0) continue;
        const codecs = codecsFromInit(head.subarray(0, end));
        this.mime = `${this.src.hasVideo ? 'video' : 'audio'}/mp4; codecs="${codecs.join(', ')}"`;
        if (!MediaSource.isTypeSupported(this.mime)) throw new Error(`This player can't show ${this.mime}`);
        const sb = this.ms.addSourceBuffer(this.mime);
        sb.mode = 'segments';
        sb.timestampOffset = reader.start;
        sb.addEventListener('error', () => this.onerror?.(new Error(`Could not decode ${this.mime}`)));
        this.sb = sb;
        data = head;
      }
      if (!chunk.length) continue;
      await this.append(data, gen);
      if (first && this.sb.buffered.length) {
        first = false;
        this.jumpGap();
      }
    }
    await this.idle();
    if (gen === this.gen && this.ms.readyState === 'open') this.ms.endOfStream();
  }

  /** Waits while enough is buffered ahead, trimming what is far behind. */
  private async room(gen: number): Promise<void> {
    while (gen === this.gen && !this.closed && this.sb && this.ahead > AHEAD) {
      this.trimBehind(KEEP_BEHIND);
      await new Promise<void>((r) => {
        this.wakeUp = r;
        setTimeout(r, 1000);
      });
    }
  }

  private trimBehind(keep: number): void {
    const sb = this.sb;
    if (!sb || sb.updating || !sb.buffered.length) return;
    const cut = this.el.currentTime - keep;
    if (cut - sb.buffered.start(0) > 5) sb.remove(0, cut);
  }

  private async append(data: Uint8Array, gen: number): Promise<void> {
    for (let tries = 0; ; tries++) {
      await this.idle();
      if (gen !== this.gen) return;
      try {
        this.sb!.appendBuffer(data as Uint8Array<ArrayBuffer>);
        await this.idle();
        return;
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'QuotaExceededError') || tries > 30) throw e;
        this.trimBehind(3); // memory full: drop more of what was played
        await sleep(500);
      }
    }
  }
}
