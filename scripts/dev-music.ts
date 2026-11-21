/**
 * Dev server only (never part of a build): serves local test folders read-only, so the app can be tested in a
 * browser without bundling them.
 *   /dev-music/  -> a local music folder (REVAMP_MUSIC)
 *   /dev-skins/  -> test-assets/skins (third-party skins, never shipped)
 * Each route answers index.json with the file list and supports HTTP range requests.
 */
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import type { Connect, Plugin } from 'vite';

const TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.wsz': 'application/zip',
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
    res.setHeader('Content-Type', TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream');
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
      server.middlewares.use(
        '/dev-music',
        folderRoute(musicFolder, ['.mp3', '.flac', '.ogg', '.opus', '.m4a', '.wav']),
      );
      server.middlewares.use('/dev-skins', folderRoute(skinsFolder, ['.wsz']));
    },
  };
}
