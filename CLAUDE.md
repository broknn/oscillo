# Oscillo

Original Electron music visualiser for Windows, called Soundprint until 2026-11-05 (the folder keeps that name; old presets are copied across on first run). It was inspired by the idea of
otoinstrument.shop, but its name, look and visual styles are its own: don't copy that
product's branding, and don't add licence keys or payment. User docs are in README.md.

## How it fits together

- `src/main/`: Electron main process and preload (`window.sp`). Owns FFmpeg: decoding to
  48 kHz stereo floats, and video export from raw RGBA frames piped to stdin.
- `src/core/`: no DOM dependency except `stage.js`. ESM, so Node tests import it directly.
  - `analysis.js`: offline pass, fixed at 48 kHz. HOP 512, WIN 2048, LONG 8192, 93.75 frames/s,
    48 log bands, 4 voices. Do not change the rate: the K-weight coefficients are exact for it.
  - `live.js`: `LiveAnalysis`, the same read API as `Analysis`, fed in chunks for Listen.
  - `chop.js`: Beat Chop, a pure map from song time to footage time and gate level. Our own
    patterns and name: don't copy Gross Clip's.
  - `stage.js`: picks and composes looks. `layout.js`: pure Compose grid, shared by the renderer
    and the layout editor. `freeform.js`: pure Advanced mode moves, sizing and snapping; boxes are
    fractions of the page. `svgctx.js` records canvas calls as SVG.
  - `pages.js`: ready-made Advanced layouts in preset form.
  - `sharecode.js`: presets as text. Codes are untrusted, so `cleanShared` rebuilds them field by
    field; new scene settings must be added there as well as to `KEPT`.
  - `history.js`: undo over snapshots. Anything a preset keeps can be undone with no extra code.
  - `presets.js`: pure save and load. New scene settings must be added to its `KEPT` list; things
    that belong to the project (track, video, picture, title) must stay out.
- `src/looks/`: 46 looks, registered through `index.js`.
- `src/renderer/`: UI (`app.js`), `exporter.js`, `video.js` (footage frames on demand), `freeEditor.js` (Advanced overlay), analysis `worker.js`, Listen, `smoke.js`.

## Rules that keep it working

- **Rendering is a pure function of the analysis.** Motion comes from `f.cum`, a music-driven
  clock, in closed form with no simulation state. That gives seeking and frame-exact export.
- `kind: 'instant'` looks use `draw(g, s)` and must give identical pixels for the same moment.
- `kind: 'sheet'` looks use additive `step(g, s, i, tick)` on a layer. Going backwards replays
  from 0, so the result can't depend on how the playhead got there. The smoke test checks both.
- A look that can't go through `SvgContext` sets `svg: false` and exports raster. New canvas
  calls in a vector look must be added to `SvgContext` too.
- Settings live in each look's `params`, built with `num`, `flag`, `choice` and `picks` from
  `style.js`; `when` (with an optional `is` value) shows a setting only under its parent. Defaults
  must keep the look as it was. Each one must visibly change the picture at its extremes: the
  smoke test renders both ends of every setting and fails on any that does nothing.
- Footage is decoded to a folder of 30 fps JPEGs at import. `draw` is synchronous, so export
  must `await stage.prepare()` before each frame. The preview uses `lookAhead` and the nearest
  frame in memory, which is why only exports are frame exact.
- Colours go through `paletteOf`, which takes an id or a `{ bg, fg, accent, colors }` object, so
  `scene.palette` and an Advanced element's `palette` can be either. Text in looks uses `s.mono`,
  never the `MONO` constant, or font choices won't reach it.
- Opacity must go through `Stage.withOpacity`, not `globalAlpha`, because looks set their own alpha.
- `drawChrome` leaves the title out while the Title element is showing. Corner text goes behind
  `s.labels`.
- `offline: true` keeps a look out of Listen, which has no track-wide data such as the beat grid.
- Sizes are relative: use `s.u` (a thousandth of the frame box), never raw pixels.
- Kick vs bass relies on `fluxM` (140–600 Hz) as a punch gate. That was a fix for a real
  failure, so re-run tests if you touch it.
- Tempo: `tempoComb` scores fractional periods at beat and bar level, because 150 BPM is 37.5
  frames and whole-frame lags misread it. `pickOctave` then decides between half and double from
  kick and snare weight between beats, and `steadyTempo` finds the exact value from a pulse held
  across the whole track. Octaves are truly ambiguous, so the UI has a typed tempo and ÷2/×2,
  which call `Analysis.setTempo`.

## Checking changes

`npm test` for analysis, `npm run smoke` for everything else. The smoke test writes pictures
and `report.json` to `--out=<dir>` (default: a temp folder), so look at the contact sheets
`looks-dark.png` and `looks-light.png`. The `audio:decode` error it logs is the deliberate
bad-file test. Remove test output afterwards. Tests must stay silent: smoke mode mutes the window's output, and
analysers still read the signal.

Build with `CSC_IDENTITY_AUTO_DISCOVERY=false` set, then run
`dist\win-unpacked\Oscillo.exe --smoke --out=<dir>` to prove the packaged FFmpeg path works.
