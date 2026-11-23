/** Browser implementation of the platform layer (used for development and testing). */
import { blobSource } from '../audio/tags';
import type { FileRef, Platform } from './platform';
import { devConverter } from './dev-convert';

export function fileRefFromBlob(
  file: File,
  location = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
): FileRef {
  let url: string | null = null;
  return {
    name: file.name,
    location,
    size: file.size,
    read: () => file.arrayBuffer(),
    source: () => blobSource(file),
    mediaUrl: async () => (url ??= URL.createObjectURL(file)),
  };
}

function pick(accept: string, multiple: boolean, folder: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple || folder;
    if (accept) input.accept = accept;
    if (folder) (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      resolve([...(input.files ?? [])]);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve([]);
      input.remove();
    });
    input.click();
  });
}

/** Reads files and folders dropped on the page (folders are walked recursively). */
export async function filesFromDrop(dt: DataTransfer): Promise<FileRef[]> {
  const out: FileRef[] = [];
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return [...dt.files].map((f) => fileRefFromBlob(f));
  const walk = async (entry: FileSystemEntry, path: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push(fileRefFromBlob(file, path + file.name));
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let batch: FileSystemEntry[];
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e, `${path}${entry.name}/`);
      } while (batch.length);
    }
  };
  for (const e of entries) await walk(e, '');
  return out;
}

export class BrowserPlatform implements Platform {
  readonly kind = 'browser' as const;
  /** Only the dev server has a converter (scripts/dev-music.ts runs FFmpeg); a plain browser has none. */
  readonly converter = import.meta.env.DEV ? devConverter : undefined;

  async pickFiles(opts: { accept: string[]; multiple: boolean }): Promise<FileRef[]> {
    const files = await pick(opts.accept.map((e) => `.${e}`).join(','), opts.multiple, false);
    return files.map((f) => fileRefFromBlob(f));
  }

  async pickFolder(): Promise<FileRef[]> {
    const files = await pick('', true, true);
    return files
      .map((f) => fileRefFromBlob(f))
      .sort((a, b) => a.location.localeCompare(b.location, undefined, { numeric: true }));
  }

  async saveFile(name: string, data: Uint8Array | string): Promise<void> {
    const blob = new Blob([data as BlobPart], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  loadSetting(key: string): string | null {
    try {
      return localStorage.getItem(`revamp.${key}`);
    } catch {
      return null;
    }
  }

  saveSetting(key: string, value: string): void {
    try {
      localStorage.setItem(`revamp.${key}`, value);
    } catch {
      /* storage blocked: settings just don't persist */
    }
  }

  async resolve(location: string): Promise<FileRef | null> {
    // The browser can only reach URLs (e.g. files served by the dev server or radio streams).
    if (!/^https?:\/\//i.test(location) && !location.startsWith('/')) return null;
    return urlFileRef(location, location);
  }

  writeCrashReport(text: string): void {
    console.error(text);
    this.saveSetting('lastCrash', text);
  }
}

/** Size of a URL: HEAD first, then a 1-byte range request (some servers, like Tauri's asset protocol, skip HEAD). */
async function urlSize(url: string): Promise<number> {
  const timed = async (init: RequestInit) => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 4000);
    try {
      return await fetch(url, { ...init, signal: ac.signal });
    } finally {
      clearTimeout(t);
    }
  };
  try {
    const head = await timed({ method: 'HEAD' });
    const n = Number(head.headers.get('content-length') ?? 0);
    if (head.ok && n > 0) return n;
  } catch {
    /* try the range request */
  }
  try {
    const r = await timed({ headers: { Range: 'bytes=0-0' } });
    const total = /\/(\d+)$/.exec(r.headers.get('content-range') ?? '');
    void r.body?.cancel();
    if (total) return Number(total[1]);
  } catch {
    /* unknown size (e.g. a radio stream) */
  }
  return 0;
}

/**
 * A file reachable by URL. `location` is what the playlist stores (a URL or, in the desktop app, a real path);
 * `url` is where the bytes are fetched from. Small reads (tags) use HTTP range requests, so scanning a big
 * folder doesn't download whole files.
 */
export async function urlFileRef(location: string, url: string): Promise<FileRef> {
  const size = await urlSize(url);
  let blob: Promise<Blob> | null = null;
  const get = () => (blob ??= fetch(url).then((r) => r.blob()));
  return {
    name: decodeURIComponent(location.split(/[\\/]/).pop() ?? location),
    location,
    size,
    read: async () => (await get()).arrayBuffer(),
    source: () => ({
      size,
      read: async (o: number, l: number) => {
        if (blob) return new Uint8Array(await (await blob).slice(o, o + l).arrayBuffer());
        l = Math.max(0, Math.min(l, (size || Infinity) - o));
        // a server may answer a range with fewer bytes than asked (the desktop app's file server sends about
        // 1 MB at a time): keep asking until all of it is here, or a big MP4 index gets cut short
        const parts: Uint8Array[] = [];
        let got = 0;
        while (got < l) {
          const r = await fetch(url, { headers: { Range: `bytes=${o + got}-${o + l - 1}` } });
          const buf = new Uint8Array(await r.arrayBuffer());
          if (r.status !== 206) return buf.subarray(o, o + l); // whole file came back
          if (!buf.length) break;
          parts.push(buf);
          got += buf.length;
        }
        if (parts.length === 1) return parts[0]!;
        const out = new Uint8Array(got);
        let p = 0;
        for (const x of parts) (out.set(x, p), (p += x.length));
        return out;
      },
    }),
    mediaUrl: async () => url,
  };
}
