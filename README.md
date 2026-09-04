# Sentience — Particle Humanoid (p5.js)

A fullscreen, realtime generative artwork: a humanoid bust made entirely of
GPU-driven particles, alive with coherent-noise motion, that turns its
attention toward the pointer and breathes/flows with whatever the
microphone hears. Built with **p5.js** (WEBGL renderer) for a Generative
Art university assignment. No mesh, no shell, no images are ever drawn —
every pixel of the figure is a particle. The head's particle positions are
sampled from a real human head mesh (`assets/head-mesh.json`, see "Head
geometry" below) purely as an invisible geometric guide; the rest of the
body is positioned by an analytic density field; everything is animated by
hand-written GLSL shaders driven directly through p5's raw WebGL context.

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

- **Mouse / pointer** — secondary input, "attention," modeled as human gaze
  rather than object rotation: an anatomical motion hierarchy where the
  face/head does almost all of the visible turning, the neck absorbs a
  small secondary fraction of it, the shoulders barely move, and the torso
  doesn't rotate toward the pointer at all — it's a fixed anchor the rest
  of the figure sits on (see `attention.js`/`config.js`'s `LIMITS`). Each
  stage still lags and settles a little more than the last (a real spring-
  damper cascade, not a lerp), with a smooth ease back to a neutral,
  centered pose a moment after the pointer leaves the window.
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
| `config.js` | Every tunable constant: quality presets, palette, camera, skeleton proportions, body-part field shapes, the head mesh's transform/sampling constants (`CONFIG.HEAD_MESH`), particle sizing, audio-reactivity scales, idle motion, and the pointer-attention dynamics. |
| `attention.js` | The pointer-attention system: `SecondOrderDynamics` (a critically/under-damped spring filter), `PointerTracker` (raw pointer state + return-to-center-on-leave), and `AttentionController` (the face → head → neck → shoulders cascade — torso is deliberately not part of it, see "Motion hierarchy" below). Framework-agnostic plain JS. |
| `audio.js` | `AudioAnalyzer` — wraps `p5.AudioIn` + `p5.FFT`, started from the activation button's click (required by browser autoplay/mic policy), exposing smoothed `amplitude`/`bass`/`mid`/`treble`. |
| `humanoidField.js` | No mesh is ever *rendered*. This module decides *where particles are allowed to exist*: the head/face come from real mesh surface samples (see `headMesh.js`), neck/shoulders from analytic ellipsoid volumes shaped by direction-dependent radius functions (`shoulderShape`) that sculpt clavicles, deltoids, trapezius, etc. purely through particle placement. |
| `headMesh.js` | Turns `assets/head-mesh.json` (a real scanned/sculpted human head — positions + triangle indices only) into particle sample data: area-weighted triangle surface sampling, landmark-biased salience weighting, and three explicit particle populations (structural/salience/peripheral). See "Head geometry" below. |
| `assets/head-mesh.json` | The real head mesh's raw vertex positions and triangle indices (no materials/UVs/normals — those aren't needed since the mesh is never rendered), in its own coordinate space. `CONFIG.HEAD_MESH` holds the transform into this project's particle space. |
| `particleSystem.js` | The GPU renderer. Compiles its own vertex/fragment shader programs and issues raw `gl.drawArrays(POINTS, …)` calls through p5's WEBGL context (`p.drawingContext`) — no per-particle JS objects or `ellipse()` calls. Contains the coherent-noise (simplex) flow field, the 3-bone shoulder→neck→head rigid skinning (via `gl-matrix`), audio-uniform wiring, and the adaptive-quality buffer rebuild. |
| `sketch.js` | p5 entry point: `preload()` (loads the head mesh JSON), `setup()`/`draw()`, pointer/activation DOM wiring, the one-way adaptive-quality downgrade loop, and the debug overlay. |
| `lib/` | Vendored `p5.min.js`, `p5.sound.min.js`, `gl-matrix-min.js`. |

### Head geometry: a real mesh, sampled into particles

The head is not a hand-authored formula — its particle positions are
sampled from `assets/head-mesh.json`, a real human head mesh (positions +
triangle indices only; currently `male_head_mid_jc.OBJ` — a higher-poly
`male_head_high_jc.OBJ`, ~16x the triangle count, was profiled too, but the
mid mesh already reads clearly human at both frontal and profile angles at
a fraction of the asset weight). **The mesh itself is never drawn**: there
is no mesh renderer anywhere in this project, no solid shading, no
wireframe, no textured face. It exists purely as an invisible geometric
guide that `headMesh.js` turns into particle sample data, once, at load
time — the exact same job `humanoidField.js`'s analytic shape functions do
for the neck and shoulders, just sourced from real anatomy instead of a
formula. Source meshes aren't always triangulated or Z-forward the same
way: this one ships as quads with no vertex normals (triangulated into
`head-mesh.json` at prep time) and its own front-facing direction is -Z,
the opposite of this project's +Z-is-front convention — `CONFIG.HEAD_MESH.
flipZ` mirrors it back (a sign, not a stretch, so proportions stay real)
and `headMesh.js` corrects the resulting inverted triangle handedness so
peripheral/aura samples still push outward, not into the head.

- **Area-weighted surface sampling** (`pickHeadMeshTriangle` /
  `sampleHeadMeshTriangle`): each triangle's contribution to the sampling
  distribution is proportional to its own area, not its vertex count — raw
  OBJ vertex density follows the source mesh's own retopology, not
  anatomical importance, so sampling vertices directly would silently
  over-represent whatever region happened to be triangulated densest.
  Points are placed uniformly within the chosen triangle via barycentric
  coordinates.
- **Three explicitly distinct particle populations** (`sampleHeadMeshPoints`,
  `CONFIG.HEAD_MESH.*Fraction`), all built from the *same* underlying
  mesh sample:
  | Population | Role |
  | --- | --- |
  | **structural** | Direct area-weighted surface samples — the bulk, carries facial readability. |
  | **salience** | Rejection-sampled toward a set of anatomical landmarks (brow, nose bridge/tip, cheekbones, mouth, jaw, chin — found by querying the mesh's own vertex data for real local extrema, not guessed), forced into the luminous layer as an explicit brighter/larger accent. |
  | **peripheral** | Surface samples pushed outward along the local triangle normal into a loose shell, tagged so they land in the existing halo/aura layer. |

  These feed the exact same `writeParticle` → `splitByLayer` →
  per-population-blend-mode pipeline described above — the rendering
  architecture didn't change, only where the head's points come from.
- **Eye sockets are deliberately excluded from the salience landmark set.**
  An early version listed them as a "brighten" landmark like the others;
  under additive luminous blending that produced two solid saturated-white
  ovals where the eyes should be — the single worst readability failure
  while tuning this. A real eye socket is a recessed, *dimmer* landmark
  (the old procedural `faceRelief` agreed: it always subtracted there,
  never added) — leaving it out of the brighten set instead of trying to
  fight the additive blend into submission fixed it outright.
- **Neck integration, not a hard seam:** `CONFIG.HEAD_MESH.fadeLowY`/
  `fadeHighY` fade the mesh's own per-triangle sampling weight to zero
  below the mesh's shirt-collar/bust base and ramp it in through the
  jaw/neck transition, so the OBJ-derived jaw/neck stub feathers into the
  existing procedural neck/shoulders (`sampleNeck`/`shoulderShape`,
  unchanged) instead of a visible geometric cut.
- **Transform** (`CONFIG.HEAD_MESH.scale`/`offsetX`/`offsetY`/`offsetZ`):
  one uniform scale (never a per-axis stretch — the entire point of using
  a real mesh is real proportions) plus a translation calibrated so the
  mesh's own neck-narrowest point lands just above the rigid head pivot
  (`particleSystem.js`'s `Pivots`), inside the existing neck sampler's own
  upward overlap reach.

### Motion hierarchy: gaze, not object rotation

Pointer tracking is an anatomical motion hierarchy, not one global
rotation applied to the whole figure. `particleSystem.js`'s `Pivots` chains
transforms torso → shoulders → neck → head, each one the *parent* frame
the next sits inside — so torso is the root every other part inherits, and
rotating it necessarily visibly rotates the entire figure with it. An
earlier pass gave torso a small nonzero pointer-driven rotation (a few
degrees, same as the other stages) and that alone read as "the whole bust
turning toward the pointer," because a few degrees at the root scales up
through everything downstream of it.

The fix was architectural, not a tuning number: `attention.js`'s
`AttentionController` never computes a torso rotation at all any more —
`pose.torso` is a fixed `{yaw: 0, pitch: 0, roll: 0}` for the object's
whole lifetime, a genuine static anchor rather than a pointer stage with a
small limit. `CONFIG.LIMITS`/`CONFIG.DYNAMICS` have no `torso` entry
either, since there's nothing left to tune. What the pointer *does* drive
(`CONFIG.LIMITS`, in `config.js`):

| Region | Yaw limit | Pitch limit | Role |
| --- | --- | --- | --- |
| face (`faceShift`) | — (2D screen-space nudge) | — | Highest priority — the face notices first, before any rotation. |
| head | ±22° | ±11° | The dominant, strongly visible response — this is what should read as "looking at you." |
| neck | ±4° | ±2° | A small secondary fraction of the head's own motion (~18%), not an independent response. |
| shoulders | ±1° | ±0.4° | Near-motionless — a hint of life, never directional tracking. |
| torso | 0° | 0° | Not part of the cascade. Fixed. |

Verified numerically (not just visually): at a held pointer extreme, the
computed `torsoMat` carries only the autonomous breathing scale (no
rotation terms at all), `shoulderMat`'s rotation stays under a degree, and
`headMat` does essentially all of the visible turning — see the pivot
chain in `particleSystem.js`'s `Pivots.update()`. The pitch sign
convention (pointer-up looks up, not down) is unchanged from before — only
the per-region magnitudes and the torso decoupling changed here.

### Particle architecture

The humanoid is **never** a rendered mesh. The head/face particle
positions come from area-weighted surface sampling of a real head mesh
(`headMesh.js`, see "Head geometry" above); the neck and shoulders sample
analytic ellipsoid volumes, each with its own direction-dependent shape
function that adds/subtracts radius to sculpt anatomical landmarks
(clavicle, deltoid, trapezius) — a form built entirely out of *where dust
is allowed to settle*. Each part also gets a sparse, slightly displaced
"halo"/peripheral fraction so the silhouette reads as soft volumetric
matter rather than a crisp cutout.

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

### Rendering pipeline: layered particles + real bloom

The humanoid is not one uniform point cloud. Every particle is tagged at
generation time (`humanoidField.js` `writeParticle`) into one of three
populations, each with its own size/brightness/softness treatment
(`CONFIG.PARTICLE_LAYERS`):

| Layer | Role |
| --- | --- |
| **structural** | The bulk — small, sharp, precise. Carries the actual anatomical definition. |
| **luminous** | A minority subset drawn from strong-landmark particles (high `\|featureBoost\|` — brow, nose, cheek, jaw, chin, clavicle), rendered larger/brighter for a sparkling accent concentrated at those landmarks, not the whole figure. |
| **peripheral** | The existing halo/edge particles, rendered larger and much softer so the silhouette itself reads as glowing energy rather than a hard cutoff. |

Every particle — humanoid or environment — is shaded by the same
`particleProfile()` function (`PARTICLE_CORE_GLSL` in `particleSystem.js`):
a per-particle blend between a tight bright core and a wide soft Gaussian
glow (its `softness`), with an explicit circular cutoff so the point
sprite's square bounding box never shows.

**Each population is also a separate draw call with its own GL blend
mode** — `humanoidField.js`'s `splitByLayer` buckets the generated
particles into three genuinely separate buffers so this is possible.
Every shader outputs premultiplied color (`color * alpha, alpha`), which
is what lets the same output work correctly under two different
compositing modes: structural and peripheral use soft, bounded
"over"-style alpha (`gl.blendFunc(ONE, ONE_MINUS_SRC_ALPHA)`) so dense
overlap at anatomical landmarks caps at opaque instead of accumulating;
luminous uses true additive (`gl.blendFunc(ONE, ONE)`) for its sparkle
accents. Environment layers (far/fog/aura/foreground) use the same soft
alpha mode — atmosphere, not an accumulating glow.

Two other cues shape the humanoid shader beyond size/brightness/softness:
a **camera-space depth luminance curve** (`uDepthLumRange`/
`uDepthLumStrength`, `CONFIG.DEPTH_LUMINANCE`) — an eased, non-linear
falloff centered on the camera's own focal distance, not a flat linear
fade — and **motion-render coupling**: peripheral/luminous sprites grow
subtly under fast pointer movement (`uPointerSpeed` × each layer's
`motionSizeResponse`) while structural stays completely stable, since
anatomy must never wobble.

The scene then renders into an offscreen framebuffer and goes through a
real multi-pass bloom before reaching the canvas: bright-pass (luminance
threshold + soft knee) → two independent blur scales (a tight, sharp glow
and a broad, soft halo — separate downsample + horizontal/vertical Gaussian
blur passes, `CONFIG.BLOOM`) → composite with a Reinhard-style tonemap. If
framebuffer creation fails on an unusual GL implementation, it falls back
to rendering directly to the canvas rather than crashing.

Tuning this taught a real lesson worth recording: an earlier pass gave
every population the same additive blend mode for the whole humanoid,
including the dense structural bulk — overlapping particles at
anatomical landmarks (the nose ridge especially, from importance
sampling) stacked straight to saturated white before bloom even applied,
and the only lever available at the time was dimming structural
brightness/size to compensate, which dulled the whole figure along with
it. The real fix was architectural, not a tuning number: give structural
its own bounded, non-additive blend mode so overlap literally cannot
accumulate past opaque, then bloom only needs to catch genuine luminous
accents rather than general dense overlap.

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
Counts were trimmed from an earlier pass on purpose: rendering quality now
comes from the layered particle shader and bloom pipeline above, not from
raw density — a smaller, better-rendered population reads richer than a
larger flat one. The Head/Face columns below are the combined budget
handed to the head mesh sampler (`CONFIG.HEAD_MESH.*Fraction` then splits
it across the structural/salience/peripheral populations) — the numbers
themselves are unchanged from the earlier procedural head/face system,
only their source is different now.

| Tier | Head | Face | Neck | Shoulders | Aura | Far | Fog | Foreground | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ULTRA | 27,000 | 19,000 | 5,000 | 34,000 | 1,300 | 3,000 | 2,400 | 220 | 91,920 |
| HIGH | 16,000 | 11,500 | 3,000 | 20,000 | 820 | 1,850 | 1,450 | 130 | 54,750 |
| MEDIUM | 8,000 | 5,800 | 1,500 | 10,000 | 480 | 950 | 750 | 70 | 27,550 |

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
