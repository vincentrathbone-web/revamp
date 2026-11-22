/**
 * Dev server only (never part of a build): serves local test folders read-only, so the app can be tested in a
 * browser without bundling them.
 *   /dev-music/  -> a local music folder (REVAMP_MUSIC)
 *   /dev-skins/  -> test-assets/skins (third-party skins, never shipped)
 *   /dev-assets/ -> test-assets/generated (made by npm run assets)
 * Each route answers index.json with the file list and supports HTTP range requests.
 * Plus a stand-in for the desktop app's FFmpeg converter (src-tauri/src/convert.rs), for files under those routes:
 *   /dev-probe?f=<location>                         -> ffprobe JSON
 *   /dev-convert?f=<location>&t=<s>&copy=0|1&video=0|1 -> fragmented MP4 stream (header X-Start)
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import type { Connect, Plugin } from 'vite';

const FFMPEG_DIR =
  process.env.REVAMP_FFMPEG_DIR ?? 'D:/Dev/toolshed/ffmpeg-lgpl/ffmpeg-n9.0-latest-win64-lgpl-shared-9.0/bin';
const MEDIA = [
  ...['.mp3', '.flac', '.ogg', '.opus', '.m4a', '.wav', '.mp4', '.webm', '.mkv', '.mov', '.m4v'],
  ...['.avi', '.wmv', '.flv', '.mpg', '.mpeg', '.ts', '.vob', '.3gp', '.wma', '.ac3', '.mka'],
];

/** Same arguments as convert_args in src-tauri/src/convert.rs: keep the two in step. */
export function convertArgs(path: string, start: number, copyVideo: boolean, hasVideo: boolean): string[] {
  const a = ['-hide_banner', '-nostdin', '-v', 'error'];
  if (start > 0) a.push('-ss', start.toFixed(3));
  a.push('-i', path);
  if (hasVideo) {
    a.push('-map', '0:v:0');
    if (copyVideo) a.push('-c:v', 'copy');
    else
      a.push(
        '-vf',
        'yadif=deint=interlaced,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=nv12',
        '-c:v',
        'h264_mf',
        '-b:v',
        '6M',
      );
  } else a.push('-vn');
  a.push(
    ...['-map', '0:a:0?', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-sn', '-dn', '-f', 'mp4'],
    ...['-movflags', 'empty_moov+default_base_moof', '-frag_duration', '500000', 'pipe:1'],
  );
  return a;
}

function run(tool: string, args: string[]): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(join(FFMPEG_DIR, tool), args, { windowsHide: true });
    let out = '',
      err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => resolve({ code: -1, out, err: String(e) }));
    p.on('close', (code) => resolve({ code: code ?? -1, out, err }));
  });
}

async function keyframeBefore(path: string, t: number): Promise<number> {
  const r = await run('ffprobe', [
    ...['-v', 'error', '-select_streams', 'v:0', '-read_intervals', `${t.toFixed(3)}%+#1`],
    ...['-show_entries', 'packet=pts_time:format=start_time', '-of', 'default=nw=1', path],
  ]);
  const pts = Number(/pts_time=([\d.]+)/.exec(r.out)?.[1]);
  const st = Number(/start_time=([\d.]+)/.exec(r.out)?.[1] ?? 0);
  return Number.isFinite(pts) && pts - st <= t + 0.001 ? Math.max(0, pts - st) : t;
}

function converterRoutes(roots: Record<string, string>): Connect.NextHandleFunction {
  const fileOf = (loc: string) => {
    const m = /^\/(dev-[a-z]+)\/(.+)$/.exec(loc);
    const root = m && roots[m[1]!];
    if (!root) return null;
    const file = normalize(join(root, decodeURIComponent(m[2]!)));
    return file.startsWith(normalize(root) + sep) && existsSync(file) ? file : null;
  };
  return async (req, res, next) => {
    const u = new URL(req.url ?? '/', 'http://x');
    if (u.pathname !== '/dev-probe' && u.pathname !== '/dev-convert') return next();
    const file = fileOf(u.searchParams.get('f') ?? '');
    if (!file) return void ((res.statusCode = 404), res.end('not found'));
    if (u.pathname === '/dev-probe') {
      const r = await run('ffprobe', [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        file,
      ]);
      res.statusCode = r.code === 0 ? 200 : 500;
      res.setHeader('Content-Type', 'application/json');
      return void res.end(r.code === 0 ? r.out : r.err);
    }
    const t = Math.max(0, Number(u.searchParams.get('t') ?? 0) || 0);
    const copy = u.searchParams.get('copy') === '1';
    const video = u.searchParams.get('video') === '1';
    const start = copy && video && t > 0 ? await keyframeBefore(file, t) : t;
    const p = spawn(join(FFMPEG_DIR, 'ffmpeg'), convertArgs(file, t, copy, video), { windowsHide: true });
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('X-Start', String(start));
    res.setHeader('Access-Control-Expose-Headers', 'X-Start');
    p.stdout.pipe(res);
    p.stderr.on('data', (d) => console.warn('[dev-convert]', String(d).trim()));
    p.on('error', () => res.end());
    res.on('close', () => p.kill());
  };
}

const TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.wsz': 'application/zip',
};

const TYPES_VIDEO: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
};

function folderRoute(folder: string, exts: string[]): Connect.NextHandleFunction {
  const root = normalize(folder);
  return (req, res) => {
    if (!existsSync(root)) return void ((res.statusCode = 404), res.end());
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    if (url === '/' || url === '/index.json') {
      const files = readdirSync(root)
        .filter((f) => exts.includes(extname(f).toLowerCase()))
        .sort();
      res.setHeader('Content-Type', 'application/json');
      return void res.end(JSON.stringify(files));
    }
    const file = normalize(join(root, url));
    if (!file.startsWith(root + sep) || !existsSync(file) || !exts.includes(extname(file).toLowerCase()))
      return void ((res.statusCode = 404), res.end());
    const size = statSync(file).size;
    res.setHeader(
      'Content-Type',
      TYPES[extname(file).toLowerCase()] ??
        TYPES_VIDEO[extname(file).toLowerCase()] ??
        'application/octet-stream',
    );
    res.setHeader('Accept-Ranges', 'bytes');
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      return void createReadStream(file, { start, end }).pipe(res);
    }
    res.setHeader('Content-Length', String(size));
    createReadStream(file).pipe(res);
  };
}

export function devMusic(musicFolder: string, skinsFolder = 'test-assets/skins'): Plugin {
  return {
    name: 'revamp-dev-folders',
    apply: 'serve',
    configureServer(server) {
      const assets = 'test-assets/generated';
      server.middlewares.use('/dev-music', folderRoute(musicFolder, MEDIA));
      server.middlewares.use('/dev-skins', folderRoute(skinsFolder, ['.wsz']));
      server.middlewares.use('/dev-assets', folderRoute(assets, MEDIA));
      server.middlewares.use(converterRoutes({ 'dev-music': musicFolder, 'dev-assets': assets }));
    },
  };
}
