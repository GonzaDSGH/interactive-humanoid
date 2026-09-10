# Camera Particle Body

A live webcam turned into a figure made of particles, built with **p5.js** as the
runtime and **ml5.js** as the machine-learning layer. The video itself is never
shown: it is only ever a source of numbers.

```
webcam ──▶ mirrored processing buffer ──▶ luminance · local contrast · Sobel
                    │                                     │
                    └──▶ ml5 BodySegmentation ──▶ mask ────┴──▶ importance
                                                                   │
                                                    persistent particles ──▶ canvas
```

## Stack

| Layer | Used for |
| --- | --- |
| HTML5 / CSS3 | activation screen, status and error panels |
| **p5.js 1.11** | `setup()` / `draw()`, fullscreen canvas, `createCapture(VIDEO)`, `windowResized()`, Perlin noise, animation lifecycle |
| **ml5.js 1.4** | `ml5.bodySegmentation("SelfieSegmentation")` — person vs. background only |

No Three.js, no React, no OBJ/GLB models, no mouse control, no microphone.
Your movement in front of the camera is the whole interaction.

## Running it

Any static server over `http://localhost` or `https://` (browsers refuse camera
access from `file://`):

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Click **Enable camera** — browsers require a gesture before granting access.

## How it works

**Camera → mirrored buffer.** `createCapture(VIDEO, { flipped: true })` opens the
webcam and the element is hidden immediately. Every frame the raw `<video>` is
blitted into an offscreen `p5.Graphics` at the processing resolution, mirrored
there with a single `scale(-1, 1)`.

That one mirror matters. p5's `flipped` option only mirrors p5's *own* read of
the element, while ml5 reads the raw video — so relying on it would leave the
mask and the luminance in opposite coordinate spaces. Instead the mirrored
buffer is what both the image analysis *and* ml5 receive, and ml5's own
`flipped` option stays off.

**Segmentation.** `ml5.bodySegmentation("SelfieSegmentation")` runs a continuous
`detectStart()` loop on that buffer. Its `imageData` is resampled into a
`Float32Array` of person probability. Which RGBA byte carries the signal differs
between ml5 runtimes, so the channel is probed once from the first result rather
than assumed.

**Detail preservation.** A binary silhouette would throw away the person. So at
the processing resolution the sketch also computes Rec.709 luminance, local
contrast (luminance minus a box blur) and a 3×3 Sobel magnitude, then reduces all
of it onto the particle grid:

```
importance = personMask * (base + w_lum·luminance + w_contrast·contrast + w_edge·edge)
```

Edges carry the jaw, collar, arm boundaries and the eye/nose/mouth region;
contrast carries mid-frequency structure; luminance carries overall tone. The
result is a figure with internal structure, not an outlined blob.

**Particles.** One persistent particle per grid cell, held in typed arrays
allocated once. Nothing is created or destroyed while the sketch runs — only
alpha, size and drift are mutated. Each particle keeps a fixed dither threshold
(so faint regions stay sparse instead of twinkling) and a fixed sub-cell offset
(so the grid does not read as a grid). Visibility is smoothed with a fast attack
and slow release, and all smoothing constants are rescaled by frame time, so the
figure settles at the same speed on fast and slow machines.

**Motion.** The camera is the motion. On top of it each active particle drifts by
a fraction of a cell using p5's Perlin noise — enough to breathe, not enough to
dissolve the body.

**Layout.** The particle grid takes its aspect ratio from the *real* camera
dimensions, and is cover-fitted to the viewport: cropped, never stretched.

## Query parameters

| Parameter | Default | Effect |
| --- | --- | --- |
| `debug` | off | `?debug=1` shows FPS, camera / processing / grid resolution, segmentation status, active particle count and per-stage CPU cost. Normal mode shows only the artwork. |
| `grid` | `160` | Particle grid width; height follows the camera aspect (`?grid=240` → 240×180 = 43,200 particles) |
| `ss` | `2` | Camera samples per grid cell, per axis |
| `dpr` | `1` | Canvas pixel density. `?dpr=2` is sharper on HiDPI displays and roughly 4× the fill cost |
| `camw`, `camh` | `640`, `480` | Requested capture size |
| `mask` | `0.5` | Person-mask threshold |
| `base`, `wlum`, `wcon`, `wedge` | `0.34`, `0.42`, `0.95`, `0.6` | Importance weights |
| `drift` | `0.3` | Perlin drift amplitude, in grid cells |

## Errors

There is no state that spins forever. Camera permission denied, no camera, camera
busy, a video that never produces a frame, a CDN that fails to serve p5 or ml5,
and a segmentation model that fails to load or stops mid-run each land on a named
error panel with the underlying exception.

## Browser test

`tools/camera-test.mjs` drives the real page in Chromium with a synthetic webcam
and asserts the whole flow — permission, model load, mask, particle/mask
agreement, palette, resize, the empty-frame case and both error paths.

```bash
npm install
CPB_FAKE_CAM=/path/to/feed.y4m node tools/camera-test.mjs
```

Any Y4M file works as the fake camera; build one with ffmpeg:

```bash
ffmpeg -i clip.mp4 -vf "scale=640:480,fps=12" -pix_fmt yuv420p feed.y4m
```

Other environment variables: `CPB_VENDOR_DIR` (answer CDN requests from local
copies of `p5.min.js`, `ml5.min.js` and `mediapipe/`, for machines without CDN
access), `CPB_CHROME`, `CPB_OUT`, `CPB_HEADED`, and `CPB_SW_RENDER=1` for hosts
with no GPU.

## Scope

This is the first checkpoint: a technically correct camera-driven particle
person. Deliberately not here yet — bloom, cinematic fog, long trails, depth
estimation, face mesh, post-processing. The sampling resolution and the particle
count are configuration, so the system can be pushed further (typed arrays are
already in place; a WebGL/shader path is the next step) without reworking the
pipeline.
