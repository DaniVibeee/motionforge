# Nameless Editing

A desktop motion-graphics and video editor — multi-layer timeline, keyframe graph editor,
on-canvas transform handles, effects, and watermark-free H.264 MP4 export.

Built from scratch with Electron + Canvas2D + a bundled ffmpeg. No cloud, no account,
no watermarks.

---

## Run it

**Packaged app**

```
release/NamelessEditing-1.0.0-portable.exe
```

Double-click it. The portable build unpacks itself to a temp folder and starts.

**From source**

```bash
npm install
npm start
```

If the Electron binary did not download during `npm install` (npm 12 blocks install
scripts by default), run:

```bash
node node_modules/electron/install.js
```

---

## Quick start

1. The app opens with a small animated demo scene so you can see it working.
2. Press **Space** or the ▶ button to play it.
3. Select a layer on the canvas or in the timeline, then drag it, scale it with a
   corner handle, or rotate it with the pink handle above the box.
4. Use the **Properties** panel on the right for precise numbers.
5. Click the small ◇ next to any property to add a keyframe at the playhead.
   The property becomes animated, and every value change then writes keyframes.
6. Open **Graph editor** (bottom left) to drag keyframes and shape the bezier easing.
7. Add effects from the **Effects** tab: blur, glow, drop shadow, brightness, contrast,
   saturation, hue, grayscale, invert, colour tint, chroma key.
8. Hit **Export MP4**.

---

## Features

**Layers**

- Text (font, size, weight, colour, alignment, line height, max width, letter spacing,
  stroke, drop shadow)
- Shapes (rectangle with corner radius, ellipse, polygon, triangle, fill + stroke)
- Solid colour fills
- Images (PNG / JPG / WebP / GIF / BMP / SVG)
- Video (MP4 / MOV / WebM / MKV …) with speed, source offset and volume
- Visibility toggle, drag-to-reorder, duplicate, delete
- Blend modes: normal, multiply, screen, overlay, darken, lighten, colour dodge/burn,
  hard/soft light, difference, exclusion, hue, saturation, colour, luminosity, add

**Animation**

- Keyframes on position, scale, rotation, opacity, and every numeric effect parameter
- Per-keyframe cubic-bezier easing with presets (linear, ease in/out, smooth, snappy,
  overshoot, anticipate, hold)
- Graph editor: property chips, draggable keyframes, draggable bezier handles,
  live value readout

**Timeline**

- Multi-layer tracks, drag clips to move, drag edges to trim
- Keyframe diamonds, drag to retime, right-click to delete
- Ruler scrubbing, zoom, snapping to whole seconds with Shift

**Export**

- H.264 MP4 (yuv420p, `+faststart`) — plays in Windows Media Player, browsers, phones
- 100% / 75% / 50% resolution, 24 / 30 / 60 fps, three quality levels
- Optional audio: when the project contains exactly one video layer with volume > 0,
  its audio is trimmed/delayed and muxed into the MP4 (AAC)
- Frame-accurate offline rendering (not screen capture)
- Progress, ETA, cancel
- If ffmpeg is unavailable, falls back to a WebM recording so you are never stuck

---

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → | Step one frame (Shift = one second) |
| Home / End | Jump to start / end |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z / Ctrl+Y | Redo |
| Ctrl+S | Save project |
| Ctrl+O | Open project |
| Ctrl+D | Duplicate selected layer |
| Delete | Delete selected layer |
| F12 | DevTools (also useful for reporting bugs) |

Canvas handles: drag the box to move, corners to scale (uniform), pink handle to rotate
(Shift snaps to 15°).

---

## Project files

Projects are saved as readable JSON (`.neproj`-style; any extension works) containing
the composition, layers, keyframes, effects and absolute media paths. Media is not
copied into the project — keep your source files where they are.

---

## Windows / ffmpeg notes

MP4 export uses a bundled `bin/ffmpeg.exe` (a GPL FFmpeg build from BtbN).
The binary is **not** committed to this repository because it is ~170 MB, above
GitHub's 100 MB file limit. Restore it with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/get-ffmpeg.ps1
```

Without it the app still runs and falls back to WebM export. If Windows
SmartScreen warns about the portable exe the first time, choose
"More info → Run anyway" (the app is unsigned).

If MP4 export ever reports a failure, export again at 50% to rule out memory pressure,
and check that `resources/bin/ffmpeg.exe` exists next to the app executable.

---

## Development

```
nameless-editing/
  main.js              Electron main process, media protocol, ffmpeg pipe
  preload.js           Safe IPC bridge (window.api)
  src/
    index.html         Editor shell
    styles/app.css     Dark editor theme
    js/core.js         Project/layer model, keyframes, easing, effects, undo store
    js/compositor.js   Canvas2D renderer (text layout, shapes, chroma key, filters)
    js/timeline.js     Multi-layer timeline
    js/graph.js        Keyframe graph / bezier editor
    js/inspector.js    Properties + effects panels
    js/export.js       Frame loop → ffmpeg, WebM fallback
    js/app.js          App controller, stage handles, playback, file ops
    js/ui.js           DOM helpers, toasts, context menu
  bin/ffmpeg.exe       Bundled encoder
  scripts/             Automated smoke / interaction / export tests (Playwright)
```

Automated checks (require `npx playwright` and a built app):

```bash
node scripts/smoke.js        # launch, console errors, screenshot
node scripts/interact.js     # preview + selection + inspector + graph
node scripts/full-test.js    # playback, drag, effects, timeline, graph, video
node scripts/export-test.js  # full MP4 export + ffmpeg verification
```

---

## Known limits (v1)

- No vector paths / masks / 3D camera / motion blur.
- Audio is only exported for a single video layer (no independent audio tracks yet).
- Export with video layers is slower than realtime because every frame is seeked
  precisely. Projects made only of text/shapes export much faster.
- No automatic recovery; save your work with Ctrl+S.
