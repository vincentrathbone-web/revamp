# RevAmp

A classic skinnable music player, rebuilt from scratch in TypeScript. Runs in the browser for development and as a
Windows app (Tauri 2) for daily use.

**Download:** the Windows installer is on the [Releases](../../releases) page. Changes per version are in
[CHANGELOG.md](CHANGELOG.md).

## What it does

- **Skins:** loads classic `.wsz` skins (main window, equalizer, playlist, video window, region shapes, cursors,
  visualizer colours). Ships with its own original skin, **Graphite**, and ten built-in studio skins (Meridian MD,
  Obsidian Core, Silverline, Nautilus, Sakura, Bubblegum, Reference Receiver, Heartwood Valve, Studio Rack, Chroma
  Deck).
- **Sound:** gapless playback, crossfade, fades (a seek crossfades over the short seek fade time), silence skipping, ReplayGain, fast start
  (sound in under 0.1 s).
- **Equalizer:** 10 bands (classic or ISO), preamp, limiter; imports and exports `.eqf` / `.q1` presets.
- **Playlists:** M3U/M3U8, PLS, XSPF (load and save), B4S (load); 100,000+ entries stay quick.
- **Video:** a skinned video window with fullscreen (`F`, `Ctrl+F` or `Alt+Enter`), 1×/2× size, stretch and
  resizing from every edge. MP4, WebM and MKV play directly; AVI, WMV, FLV, MPEG, TS, VOB, HEVC, 10-bit video and
  more play through a bundled FFmpeg. Video sound goes through the equalizer and visualizer like music.
- **More sound formats** through FFmpeg: WMA, AC-3, APE, WavPack, AMR and others, with their tags.
- **Visualization window** (`Ctrl+Shift+K`): presets in the `.milk` format (100 built in, plus your own files)
  through Butterchurn, and **Drift**, RevAmp's own warping, colour-cycling engine.
- **Windows:** snap and dock together, shade mode, double size, window positions kept between runs; dialogs never
  block other screens.
- **Explorer:** "Play in RevAmp" and "Enqueue in RevAmp" on music, video, playlist files and folders; RevAmp shows
  in "Open with" and in Windows' Default apps. Only one RevAmp runs; a second start hands its files to the first.
- **Keyboard:** the classic player's shortcuts, by physical key. Full list: [docs/KEYS.md](docs/KEYS.md).

MIT license. See [CLEANROOM.md](CLEANROOM.md) for the rules that keep this a clean-room project.

## Third-party parts

| Part                                   | License   | Use                                                   |
| -------------------------------------- | --------- | ----------------------------------------------------- |
| FFmpeg (LGPL shared build, BtbN)       | LGPL v3   | Bundled in the Windows app for extra formats; its license and source link ship in `ffmpeg/` |
| Butterchurn, butterchurn-presets       | MIT       | `.milk` presets in the visualization window           |
| milkdrop-preset-converter              | MIT       | Turns your own `.milk` files into presets             |
| Tauri and its plugins                  | MIT/Apache-2.0 | Windows app shell                                |

`npm run licenses` checks every npm dependency for an MIT-compatible license.

## Develop

```powershell
npm install
npm run dev          # http://localhost:5199
```

In the dev server only:

- the Skins menu lists the skins in `test-assets/skins` (served by `scripts/dev-music.ts`, never bundled)
- `revamp.addDevMusic(30)` in the console adds songs from the folder in `REVAMP_MUSIC` (read-only)
- formats that need FFmpeg are converted by the dev server (set `REVAMP_FFMPEG_DIR`)

## Test

```powershell
npm test               # unit tests (Node)
npm run test:browser   # audio, video and dialog tests in real Microsoft Edge
npm run check          # types, formatting, licenses, all tests
npm run docs:keys      # rewrite docs/KEYS.md after changing src/app/keys.ts
```

Golden images of the Graphite skin live in `tests/golden`. After a deliberate drawing change, delete the PNG
(or set `UPDATE_GOLDEN=1`) and look at the new one before committing.

### Tests in the real Windows app

Debug builds of the Windows app can run a **QA plan** that plays real files through the real app and measures what a
listener would notice: silence, loudness, crossfades, replay gain, video pictures, window resizing, dialogs and every
shortcut key. Build a test copy with its own identity (so it never talks to an installed RevAmp), then start it with
a plan:

```powershell
$env:TAURI_CONFIG = '{"identifier":"app.revamp.player.selftest"}'
npx tauri build --debug --no-bundle
$env:REVAMP_SELFTEST = 'qa:C:\path\to\plan.json'; $env:REVAMP_SELFTEST_OUT = 'C:\path\to\report.json'
& <target>\debug\revamp.exe
```

A plan is `{ "cases": [ { "kind": "crossfade", "files": [...] }, ... ] }`; the kinds are `play` (with `video`,
`at`, `seconds`), `crossfade`, `seekCrossfade`, `replayGain`, `dialogs`, `keys` and `videoWindow`
(see `src/platform/qa.ts`). The report lists each case with `ok`, its problems and the numbers behind them.

## Windows app

Needs Rust (stable) and the WebView2 runtime (part of Windows 11). The FFmpeg files are copied from
`FFMPEG_LGPL_DIR` by `npm run ffmpeg` (run by both commands below); only LGPL builds are accepted.

```powershell
npm run desktop   # dev app with live reload
npm run release   # installer in <cargo target>/release/bundle/nsis
```

The desktop app is one transparent window over all screens; clicks pass through wherever no player window or dialog
is drawn. Local files play through Tauri's asset protocol, so playlists with real paths reopen after a restart. The
installer adds the Explorer entries; the uninstaller removes them.

## Layout

| Folder          | What                                                                         |
| --------------- | ---------------------------------------------------------------------------- |
| `src/audio`     | Web Audio engine, fades, crossfade, ReplayGain, tag reader, FFmpeg streaming |
| `src/dsp`       | Biquad maths, EQ model, `.eqf` files                                         |
| `src/skin`      | BMP decoder, `.wsz` loader, sprite map, drawing surface, built-in skins      |
| `src/ui`        | Skinned windows (main, EQ, playlist, video, visualization), menus, dialogs   |
| `src/vis`       | Visualization engines: Butterchurn (`.milk` presets) and Drift               |
| `src/playlist`  | Playlist model and file formats                                              |
| `src/app`       | The app that connects everything, preferences, keyboard shortcuts            |
| `src/platform`  | Browser and desktop (Tauri) file access, the desktop QA run                  |
| `src-tauri`     | Rust shell: FFmpeg converter, Explorer entries, single instance              |
| `docs`          | Keyboard shortcut list                                                       |
