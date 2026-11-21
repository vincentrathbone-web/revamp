# RevAmp

A classic skinnable music player, rebuilt from scratch in TypeScript. Runs in the browser for development and as a
small Windows app (Tauri 2) for daily use.

- Loads classic `.wsz` skins (main window, equalizer, playlist, region shapes, cursors, visualizer colours)
- Ships with its own original skin, **Graphite**
- Gapless playback, crossfade, fades, silence skipping, ReplayGain
- 10-band equalizer (classic or ISO bands), preamp, limiter; imports and exports `.eqf` / `.q1` presets
- Playlists: M3U/M3U8, PLS, XSPF (load and save), B4S (load); 100,000+ entries stay quick
- Windows snap and dock together, shade mode, double size

MIT license. See [CLEANROOM.md](CLEANROOM.md) for the rules that keep this a clean-room project.

## Develop

```powershell
npm install
npm run dev          # http://localhost:5199
```

In the dev server only:

- the Skins menu lists the skins in `test-assets/skins` (served by `scripts/dev-music.ts`, never bundled)
- `revamp.addDevMusic(30)` in the console adds songs from the folder in `REVAMP_MUSIC` (read-only)

## Test

```powershell
npm test               # unit tests (Node)
npm run test:browser   # audio tests in real Microsoft Edge
npm run check          # types, formatting, licenses, all tests
```

Golden images of the Graphite skin live in `tests/golden`. After a deliberate drawing change, delete the PNG
(or set `UPDATE_GOLDEN=1`) and look at the new one before committing.

## Windows app

Needs Rust (stable) and the WebView2 runtime (part of Windows 11).

```powershell
npm run desktop   # dev app with live reload
npm run release   # installer in src-tauri/target/release/bundle/nsis
```

The desktop app is one transparent window over the screen's work area; clicks pass through wherever no player
window is drawn. Local files play through Tauri's asset protocol, so playlists with real paths reopen after a restart.

## Layout

| Folder          | What                                                                    |
| --------------- | ----------------------------------------------------------------------- |
| `src/audio`     | Web Audio engine, fades, silence, ReplayGain, tag reader                |
| `src/dsp`       | Biquad maths, EQ model, `.eqf` files                                    |
| `src/skin`      | BMP decoder, `.wsz` loader, sprite map, drawing surface, Graphite skin  |
| `src/ui`        | Skinned windows, controls, menus, dialogs, window manager               |
| `src/playlist`  | Playlist model and file formats                                         |
| `src/app`       | The app that connects everything, preferences                           |
| `src/platform`  | Browser and desktop (Tauri) file access                                 |
| `src-tauri`     | Rust shell                                                              |
