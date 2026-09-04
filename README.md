# Sentience — Particle Humanoid (p5.js)

A fullscreen, realtime generative artwork: a humanoid bust made entirely of
GPU-driven particles, alive with coherent-noise motion, that turns its
attention toward the pointer and breathes/flows with whatever the
microphone hears. Built with **p5.js** (WEBGL renderer) for a Generative
Art university assignment. No mesh, no shell, no images — every pixel of
the figure is a particle, positioned by an analytic density field and
animated by hand-written GLSL shaders driven directly through p5's raw
WebGL context.

## Run it

The piece needs to be served over HTTP (the microphone requires a secure
context, and browsers block `getUserMedia` on `file://`). From the project
root:

```bash
python3 -m http.server 8080
# or: npx http-server -p 8080
```

Then open `http://localhost:8080/` and click **ACTIVAR EXPERIENCIA**. The
browser will ask for microphone permission — accept it to drive the
figure's internal energy with sound. If you decline or have no microphone,
the piece still runs: the autonomous noise-driven motion keeps it alive,
just without audio reactivity.

No build step, no bundler, no `npm install` required to run — `p5.js`,
`p5.sound` and `gl-matrix` are vendored locally under `lib/`.

## Controls

- **Mouse / pointer** — secondary input, "attention." The figure's face,
  head, neck, shoulders and torso turn toward the pointer in a cascade,
  each stage lagging and settling a little more than the last, with a
  smooth ease back to a neutral, centered pose a moment after the pointer
  leaves the window.
- **Microphone** — primary hardware input, "internal energy." Bass drives
  a slow structural breathing pulse, mid frequencies drive internal
  turbulence in the particle flow, treble adds fine sparkle at the figure's
  edges, and overall amplitude lifts global brightness. All of it is
  smoothed so it reads as a wave of energy, never a flash.
- **`?debug=1`** — append to the URL for a small overlay (fps, quality
  tier, particle count, mic status, audio levels, pointer position, head/
  torso yaw). Hidden by default; not part of the artwork's presentation.

## How it's built

| File | Responsibility |
| --- | --- |
| `index.html` | Loads the vendored libraries and project scripts, in order. |
| `style.css` | Fullscreen canvas, activation-screen overlay, debug panel styling, the CSS radial-gradient atmospheric backdrop behind the (alpha-transparent) WebGL canvas. |
| `config.js` | Every tunable constant: quality presets, palette, camera, skeleton proportions, body-part field shapes, particle sizing, audio-reactivity scales, idle motion, and the pointer-attention dynamics. |
| `attention.js` | The pointer-attention system: `SecondOrderDynamics` (a critically/under-damped spring filter), `PointerTracker` (raw pointer state + return-to-center-on-leave), and `AttentionController` (the face → head → neck → shoulders → torso cascade). Framework-agnostic plain JS. |
| `audio.js` | `AudioAnalyzer` — wraps `p5.AudioIn` + `p5.FFT`, started from the activation button's click (required by browser autoplay/mic policy), exposing smoothed `amplitude`/`bass`/`mid`/`treble`. |
| `humanoidField.js` | No mesh is ever built. This module decides *where particles are allowed to exist*: analytic ellipsoid volumes for head/face/neck/shoulders, shaped by direction-dependent radius functions (`headShape`, `shoulderShape`) that sculpt cranium, temples, jaw, clavicles, etc. purely through particle placement. |
| `particleSystem.js` | The GPU renderer. Compiles its own vertex/fragment shader programs and issues raw `gl.drawArrays(POINTS, …)` calls through p5's WEBGL context (`p.drawingContext`) — no per-particle JS objects or `ellipse()` calls. Contains the coherent-noise (simplex) flow field, the 3-bone shoulder→neck→head rigid skinning (via `gl-matrix`), audio-uniform wiring, and the adaptive-quality buffer rebuild. |
| `sketch.js` | p5 entry point: `setup()`/`draw()`, pointer/activation DOM wiring, the one-way adaptive-quality downgrade loop, and the debug overlay. |
| `lib/` | Vendored `p5.min.js`, `p5.sound.min.js`, `gl-matrix-min.js`. |

### Particle architecture

The humanoid is **never** a mesh. `humanoidField.js` samples particle
positions directly from analytic volumes (ellipsoids for head, face, neck,
shoulders), each with its own direction-dependent shape function that
adds/subtracts radius to sculpt anatomical landmarks (crown, temple, brow,
cheek, jaw, deltoid, clavicle) — a form built entirely out of *where dust
is allowed to settle*. Each part also gets a sparse, slightly displaced
"halo" fraction so the silhouette reads as soft volumetric matter rather
than a crisp cutout.

At render time, `particleSystem.js` uploads these positions as static GL
buffers once per quality tier, then does all *motion* on the GPU: each
particle carries a "part" id (shoulder/neck/head) and is transformed every
frame by that part's own rigid 4×4 matrix, computed once per frame on the
CPU from the attention system's pose and uploaded as a uniform — the same
technique as GPU bone/skin animation, with three bones. On top of that
rigid transform, the vertex shader adds: idle sinusoidal drift, the
coherent-noise flow field, a pointer-velocity-driven mass-flow toward
recent cursor motion (stronger toward the head, softer toward the
shoulders), and a face-specific shift that lets the face "notice" the
pointer a beat before the rest of the head turns.

### Environment: four cooperating particle layers

The humanoid doesn't float in flat black. `humanoidField.js`'s
`buildFarField`/`buildFogBandField`/`buildAuraField`/`buildForegroundField`
build four additional particle populations, all rendered through one
generic shader (`ENV_VERT`/`ENV_FRAG` in `particleSystem.js`) parameterized
per layer via `CONFIG.ENVIRONMENT`:

| Layer | Role |
| --- | --- |
| **far** | A broad, dim, distant population filling the whole viewport at depth, so the scene doesn't go to flat black once the humanoid's own silhouette ends. |
| **fog** | A horizon-like undulating band (layered sine terms, not a grid) low in frame, denser near its own crest line and thinning into rising dust above it. |
| **aura** | A halo immediately around the bust, blending its silhouette edge into the surrounding atmosphere instead of a hard cutoff into black. |
| **foreground** | Sparse, soft, close-to-camera particles for occasional depth parallax in front of the figure. Deliberately conservative in size/count — an earlier ambient-dust layer in this project once got this wrong and blew out into oversized near-camera points. |

Each layer's point size needs to be large — `gl_PointSize` scales with
`1 / distanceFromCamera`, and these layers sit far enough out that a
"normal" size constant renders as a near-invisible speck; they're tuned as
large, soft, bokeh-like discs rather than a sharp pinprick starfield.

### Particle counts per quality tier

Adaptive quality is **one-way** (downgrade only, never upgrades back) and
rebuilds every buffer in place — no shader recompilation — after several
consecutive seconds of sustained low FPS, with a cooldown between steps.

| Tier | Head | Face | Neck | Shoulders | Aura | Far | Fog | Foreground | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ULTRA | 32,000 | 22,000 | 6,000 | 40,000 | 1,500 | 3,600 | 2,800 | 260 | 108,160 |
| HIGH | 19,000 | 13,000 | 3,600 | 23,000 | 950 | 2,200 | 1,700 | 155 | 63,605 |
| MEDIUM | 9,500 | 6,500 | 1,800 | 11,500 | 560 | 1,150 | 900 | 85 | 31,995 |

### Audio mapping

| Band | Effect | Where |
| --- | --- | --- |
| Bass | Extra breathing amplitude (slow structural pulse) | `particleSystem.js` breathing term |
| Mid | Extra coherent-noise flow amount (internal turbulence) | `HUMANOID_VERT` `uAudioMid` |
| Treble | Fine sparkle brightness at edge/halo particles | `HUMANOID_FRAG` `uAudioTreble` |
| Amplitude | Global brightness lift | `HUMANOID_FRAG` `uAudioEnergy` |

All four are exponentially smoothed (`CONFIG.AUDIO.smoothing`) before they
touch anything visual, by design — the brief this was built against
explicitly forbids aggressive flashing on speech/sound.

### Perlin/coherent noise

A GLSL simplex-noise implementation (`NOISE_GLSL` in `particleSystem.js`)
evaluates a genuine 3D flow field every frame, sampled at each particle's
world position and slowly advected through time. This is the artwork's
autonomous motion — it runs whether or not anyone is present, is boosted
by mid-frequency audio energy, and is what keeps the figure reading as
alive rather than a static point cloud.

## Notes / limitations

- Requires WebGL and (for audio) a browser that grants microphone access
  under a secure/local context.
- Adaptive quality reacts to your machine's actual sustained frame rate —
  on a slow GPU or in a software-rendered environment it will settle at a
  lower tier automatically; this is expected, not a bug.
- The activation screen is intentionally the only UI. Once dismissed there
  is no further interface — the piece is meant to be looked at and spoken/
  played to, not operated.

See [`memoria.md`](memoria.md) for the assignment write-up.
