// Copies the bundled FFmpeg (an LGPL build) into src-tauri/ffmpeg/, which the installer ships as a resource.
// Source folder: FFMPEG_LGPL_DIR, default D:\Dev\toolshed\ffmpeg-lgpl\ffmpeg-n9.0-latest-win64-lgpl-shared-9.0
// (from github.com/BtbN/FFmpeg-Builds). Refuses GPL or non-free builds, so RevAmp stays MIT.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SRC =
  process.env.FFMPEG_LGPL_DIR ?? 'D:\\Dev\\toolshed\\ffmpeg-lgpl\\ffmpeg-n9.0-latest-win64-lgpl-shared-9.0';
const OUT = join(process.cwd(), 'src-tauri', 'ffmpeg');
const bin = join(SRC, 'bin');

if (!existsSync(join(bin, 'ffmpeg.exe'))) {
  console.error(`No FFmpeg in ${bin}. Set FFMPEG_LGPL_DIR to an unpacked LGPL "shared" build.`);
  process.exit(1);
}
const conf = spawnSync(join(bin, 'ffmpeg.exe'), ['-hide_banner', '-buildconf'], { encoding: 'utf8' });
const version = spawnSync(join(bin, 'ffmpeg.exe'), ['-hide_banner', '-version'], { encoding: 'utf8' })
  .stdout.split('\n')[0]
  ?.trim();
if (conf.status !== 0 || /--enable-(gpl|nonfree)\b/.test(conf.stdout)) {
  console.error('This FFmpeg is a GPL or non-free build; RevAmp may only ship an LGPL build.');
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const files = readdirSync(bin).filter((f) => /^(ffmpeg|ffprobe)\.exe$|\.dll$/i.test(f));
for (const f of files) copyFileSync(join(bin, f), join(OUT, f));
copyFileSync(join(SRC, 'LICENSE.txt'), join(OUT, 'LICENSE.txt'));
const commit = /-g([0-9a-f]{7,})/.exec(version ?? '')?.[1];
writeFileSync(
  join(OUT, 'README.txt'),
  [
    'RevAmp uses FFmpeg to play video and sound formats the built-in player cannot (AVI, WMV, FLV, MPEG, WMA...).',
    '',
    `Version: ${version}`,
    'FFmpeg is licensed under the GNU Lesser General Public License version 3 (see LICENSE.txt).',
    'RevAmp runs ffmpeg.exe and ffprobe.exe as separate programs; the libraries are the unchanged DLLs in this folder',
    'and can be replaced with any compatible build.',
    '',
    'Source code: https://ffmpeg.org/download.html',
    commit ? `Exact source revision: https://git.ffmpeg.org/gitweb/ffmpeg.git/commit/${commit}` : '',
    'Build scripts: https://github.com/BtbN/FFmpeg-Builds',
    '',
  ].join('\r\n'),
);
console.log(`Copied ${files.length} FFmpeg files (${version}) to ${OUT}`);
