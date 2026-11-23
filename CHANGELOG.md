# Changelog

## 0.2.1 — 2026-11-23

### Changed

- The song crossfade setting moved from Preferences › Playback to the top of Preferences › Fades and is now
  called **General crossfade**.

### Fixed

- Seeking faded over the song crossfade length (seconds) instead of the "Fade on seek" time. A seek now
  crossfades from the old spot to the new one over the seek fade time only, like the classic output.

## 0.2.0 — 2026-11-23

### New

- **Video window:** a skinned window for MP4, WebM and MKV, with fullscreen, 1×/2× size, stretch and a menu. Skins
  without their own video frame get one made from their playlist look. Resize from every edge and corner.
  Fullscreen with `F` (video window), `Ctrl+F` or `Alt+Enter`; `Esc` leaves.
- **Many more formats** through a bundled FFmpeg (LGPL build): AVI, WMV, FLV, MPEG, TS, VOB, HEVC and 10-bit video,
  and sound formats such as WMA, AC-3, APE and WavPack. Seeking anywhere stays quick.
- **Visualization window** (`Ctrl+Shift+K`): presets in the `.milk` format (100 built in, plus your own files) and
  Drift, RevAmp's own warping, colour-cycling engine.
- **Explorer menu:** "Play in RevAmp" and "Enqueue in RevAmp" on files and folders; RevAmp appears in "Open with" and
  Windows' Default apps; Preferences has a File types page. Only one RevAmp runs at a time.
- **Ten built-in studio skins** in the Skins menu.
- **Classic keyboard shortcuts:** `Ctrl+Z` / `Ctrl+B` first / last track, `Shift+Z` / `Shift+B` ±5 seconds,
  `Ctrl+V` stop after this track, `Shift+V` fade out and stop, `Shift+R` manual advance, number pad ±10 tracks,
  equalizer keys, playlist sort keys and more. Full list in [docs/KEYS.md](docs/KEYS.md).
- **Seeking with crossfade on** now crossfades from the old spot to the new one.

### Fixed

- Big MP4 films (index at the end, or a large index) didn't open the video window and played as sound only.
- MKV files with chapters opened the video window but showed no picture.
- With crossfade on, the next song could stay silent until you seeked.
- ReplayGain couldn't be turned off for videos, converted files and songs longer than 15 minutes, and the volume
  could get stuck partway through a start fade.
- Window positions were reset to the top of the screen on restart.
- "Make RevAmp the default player…" opened Explorer instead of Windows Settings.
- Preferences, Song info and About blocked every screen and dimmed them; they now close when you click elsewhere,
  and the player keeps taking keys while they are open.
- The video window had no resize pointer, and resizing stopped when the pointer ran ahead of the window edge.

### For developers

- A QA run for the real Windows app (`REVAMP_SELFTEST=qa:<plan.json>`) plays real files and checks sound, video,
  crossfades, ReplayGain, dialogs, resizing and keys. See the README.
- `docs/KEYS.md` is made from the shortcut table (`npm run docs:keys`); a test fails when it is out of date.

## 0.1.0 — 2026-11-21

First test release: classic `.wsz` skins and the Graphite skin, gapless playback, crossfade, fades, ReplayGain,
10-band equalizer, playlists (M3U/M3U8, PLS, XSPF, B4S), docking windows, the Windows app.
