# Oscillo

Turns one track into moving and printable pictures. Drop in an audio file and Oscillo
works out its tempo, key, loudness, drums and notes. It then draws the song in 46 looks,
and everything can be exported as video, poster or cover art. It runs offline on Windows.

## Run it

Double-click `dist\Oscillo 0.1.0.exe`. It is a portable app, so there is nothing to
install. It isn't code-signed, so Windows SmartScreen may warn the first time.

To run from source:

```bash
npm install
```

```bash
npm start
```

## Using it

- **Tracks:** drop audio files on the window, or press Add. MP3, WAV, AIFF, FLAC, M4A, OGG,
  Opus and AAC all work. *Load demo beat* gives you something to try straight away.
- **MIDI:** a `.mid` file with the same name beside the audio attaches itself and drives the
  MIDI looks. Without one, those looks use the notes found in the audio.
- **Looks:** Footage, Text, Panels, Sheet, Meters, Scenes, Organic and MIDI groups, used in one of three modes:
  *Single*, *Compose* (a grid of looks) or *Auto edit* (changes look with the song's sections).
- **Compose layout:** a small map of the page shows the grid, in the shape chosen under Export.
  Drag one tile onto another to swap them. Click a tile to set its width and height, centre it
  in a row with free space, or move it earlier or later. Columns can be set by hand too.
- **Settings:** every look has its own sliders and switches, shown on the Looks tab. In Compose,
  click a tile to adjust that look. In Auto edit, choose a pick from the list. Reset puts that
  look back to its defaults.
- **Video:** choose a clip in Studio or the Video look, or drop one on the window. It's turned
  into frames on disk first, so long clips take a moment and use temporary space. If no track is
  loaded, the video's own sound becomes the track.
- **Beat Chop:** a switch on the Video look. It locks the clip to the track's bars with 18 time
  patterns and 10 gate patterns, including stutters, tape stops, rewinds and strobes. There's no
  BPM to type, because it uses the beat grid Oscillo already found. Mix moves between
  patterns as the bars go by, and you tick which ones it can use.
- **Video effects:** on the Video look, Kick zoom punches in on each kick, Snare RGB split pulls
  the colours apart on each snare, and Palette recolour maps the footage onto your palette.
- **Presets:** the Presets tab saves your layout, looks, settings, effects, colours, fonts and
  page shape under a name. Loading one leaves your tracks, video, picture and title alone.
- **Advanced:** a fourth mode beside Compose. Click looks to add them, drag them anywhere on
  the picture, pull the handles to size them, and overlap them in any order. Things snap to the
  page and each other; hold Alt to stop that, or Shift to keep the shape. The panel takes exact
  percentages, arrow keys nudge, Delete removes. It starts from whatever was on screen.
- **Opacity:** every element in Advanced and every tile in Compose has an Opacity slider.
- **Title:** Advanced brings the title in as an element, so you can drag it, size it, layer it and
  give it its own colours, font, opacity and alignment. In Compose or an existing Advanced layout,
  add it from the Text group of the look list. It replaces the fixed title while it's on the page.
- **Preview volume:** the Vol slider next to the waveform only changes what you hear in the app.
  Exports always use the track at its full level.
- **Comet:** a MIDI look that hangs notes in space as a long trail the camera circles, with links,
  dust and note names. Pair it with Roll's Page turns on the Paper colours for a score page.
- **Panels:** Beat Clock, Dot Matrix, Glow Grid, Tape Strip, Level Numbers and Synth Panel are small
  instruments that sit well together on a page. Other new looks: Note Stage, Ink Wash, Smoke Plume
  and Star Burst.
- **Image Cuts:** add several pictures in the look's settings, then cut between them on beats, bars
  or snares, with kick zoom, flash, stripes and recolour.
- **Ready-made pages:** the Presets tab has five tall layouts to start from. Loading one replaces
  your current layout and colours.
- **Custom shape:** in Export, choose Custom under Shape and type the width and height in pixels.
  Sides are rounded to even numbers and can be 64 to 7680. The preview takes the same shape.
- **Bottom text:** in Studio, choose which parts show (BPM, key, loudness, look or mode name, time,
  length), and give the line its own font and colour.
- **Share codes:** in Presets, press Copy code for this setup, or Code beside a saved preset, and
  send the text to a friend. They paste it and press Load. Layout, looks, settings, colours, fonts
  and page shape travel; tracks, pictures, video and installed fonts don't.
- **Undo:** Ctrl+Z undoes layout, look, setting and colour changes; Ctrl+Y or Ctrl+Shift+Z redoes.
- **Replace in place:** select an element in Advanced or Compose and use Replace with. It keeps
  its spot and size. If the new look is already on the page, the two trade places.
- **Corner labels:** untick "Show corner labels on elements" in Studio to hide names like SCOPE.
- **Colours:** the Custom tile in Studio opens colour wells for the background, text, accent and
  a five-step ramp. In Advanced, any element can use another palette or its own custom colours,
  on its own background or over what's behind it.
- **Fonts:** Studio sets the title and readout fonts, from a shortlist or all your installed
  fonts. In Advanced, an element can have its own.
- **Tempo:** if the track was heard wrong, type the right tempo in the Heard panel or use ÷2
  and ×2. Bars, Auto edit cuts and Beat Chop all follow it.
- **Studio:** palette, picture, brush, motion and density. Portrait needs a picture chosen here.
- **Export:** video in 16:9, 9:16, 1:1 or 4:5, at 15 s, 30 s or full length, in HD or 4K.
  Transparent overlays come out as ProRes 4444. Stills are A3 posters (PNG, SVG, PDF) and
  3000×3000 covers.
- **Listen:** a small always-on-top window that reacts to whatever the computer is playing.

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Runs the app |
| `npm test` | Checks Compose layout, then analysis against known tracks, FFmpeg's loudness meter, live mode and MIDI |
| `npm run smoke` | Drives the real app: every look, every export, a bad file, Listen |
| `node test/syncCheck.mjs clip.mp4` | Measures picture-to-sound lag in an export (60 fps Spectrum clip) |
| `npm run dist` | Builds the portable `.exe` |

## Known limits

- Analysis has only been checked on synthetic tracks with a known answer, not on real
  recordings. Expect less accuracy on dense or live music.
- Telling a key from its relative major or minor is a heuristic based on the track's opening.
- Kick, snare and hat are detected, not separated into stems.
- In Listen, BPM and key are rough, and Sheet and MIDI looks aren't available.
- Some looks can't become vector art, so their PDFs hold a picture instead.
- 4K export runs at about 10 fps on the machine it was built on.
- Only tested on Windows 11.
