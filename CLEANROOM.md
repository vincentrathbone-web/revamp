# Clean-room rules

RevAmp is an independent player that can load classic `.wsz` skins. It is **not** a port or a translation
of any existing player's source code.

## Allowed
- Using the original player as a black box: running it, watching how it behaves, measuring timings and
  pixel positions, and saving files from it (presets, playlists, settings) to test that our files work with it.
- Public file-format facts needed to load skins, presets and playlists: file names, image sizes,
  sprite rectangles, text-file keys, binary preset layouts. These are interoperability facts, written
  down in our own tables.
- Public maths (filter design, loudness, resampling) from textbooks and papers.
- Code from libraries whose licenses are compatible with MIT (checked by `npm run licenses`).
- Separate LGPL programs shipped unchanged next to the app (FFmpeg), with their license text and a link to
  their source.
- Other players' behaviour and file formats (for example visualizer presets) used the same way: as a black
  box and as interoperability facts, never their code, art, palettes or wording.

## Not allowed
- Copying, translating or "porting" source code from the original player or its plugins, line by line
  or function by function.
- Copying its help texts, dialog wording, preset names, art, icons, sounds or default skin.
- Using its product names or trademarks in RevAmp's name, UI or marketing. Neutral phrases such as
  "loads classic .wsz skins" are fine.
- Bundling third-party skins. Skins used for testing stay in `test-assets/skins/` (not committed).

## Workflow
1. Write down the behaviour in your own words (issue or note) - what it does, not how the old code does it.
2. Implement from that note.
3. Test against the reference build by behaviour, screenshots or file interop.
