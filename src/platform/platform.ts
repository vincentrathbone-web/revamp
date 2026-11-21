/** What RevAmp needs from the host environment (browser page now, Tauri later). */
import type { ByteSource } from '../audio/tags';

export interface FileRef {
  name: string;
  /** Full path when known (Tauri), otherwise the file name or relative path. */
  location: string;
  size: number;
  read(): Promise<ArrayBuffer>;
  source(): ByteSource;
  /** URL a media element can stream from. */
  mediaUrl(): Promise<string>;
}

export const AUDIO_EXTENSIONS = [
  'mp3',
  'mp2',
  'mp1',
  'ogg',
  'oga',
  'opus',
  'flac',
  'wav',
  'm4a',
  'mp4',
  'aac',
  'webm',
  'aif',
  'aiff',
];
/** Containers that normally hold a picture. (.mp4 and .webm are in the audio list: their header decides.) */
export const VIDEO_EXTENSIONS = ['m4v', 'mkv', 'mov', 'ogv'];
export const MEDIA_EXTENSIONS = [...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS];
export const PLAYLIST_EXTENSIONS = ['m3u', 'm3u8', 'pls', 'xspf', 'b4s'];

export const extOf = (name: string) => name.toLowerCase().split('.').pop() ?? '';
export const isAudio = (name: string) => AUDIO_EXTENSIONS.includes(extOf(name));
/** Anything RevAmp can play: audio or video. */
export const isMedia = (name: string) => MEDIA_EXTENSIONS.includes(extOf(name));
/** Should this file play as video? The header (`hasVideo`, once read) wins over the extension. */
export const playsAsVideo = (name: string, hasVideo: boolean | undefined) =>
  hasVideo ?? VIDEO_EXTENSIONS.includes(extOf(name.split(/[?#]/)[0]!));
export const isPlaylist = (name: string) => PLAYLIST_EXTENSIONS.includes(extOf(name));
export const isSkin = (name: string) => ['wsz', 'zip'].includes(extOf(name));

export interface Platform {
  readonly kind: 'browser' | 'tauri';
  pickFiles(opts: { accept: string[]; multiple: boolean }): Promise<FileRef[]>;
  pickFolder(): Promise<FileRef[]>;
  saveFile(suggestedName: string, data: Uint8Array | string): Promise<void>;
  loadSetting(key: string): string | null;
  saveSetting(key: string, value: string): void;
  /** Resolves a playlist entry location to a file, if the platform can (Tauri: real paths). */
  resolve(location: string): Promise<FileRef | null>;
  /** Called once with the crash report text. */
  writeCrashReport(text: string): void;
  setAlwaysOnTop?(on: boolean): void;
  /**
   * Desktop app: makes the page cover the whole monitor around page point (x, y), taskbar included, for fullscreen
   * video (true = the page now is that monitor), or puts it back over the work areas (on = false).
   */
  fullscreenMonitor?(on: boolean, x: number, y: number): Promise<boolean>;
  minimize?(): void;
  quit?(): void;
}
