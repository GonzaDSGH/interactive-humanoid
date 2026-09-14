# PRESENCIA — a real body, rendered as particles

A fullscreen realtime generative artwork built with **p5.js**. The live camera
detects the real person standing in front of it, and that person — not a
virtual character — is redrawn entirely as luminous particle matter.

> The device observes a real human body through the camera and reinterprets
> that physical presence as living digital particle matter.

There is no predefined humanoid anywhere in the project. If nobody is in front
of the camera, no figure exists. When somebody steps in, particles organise
into *their* body: their silhouette, their pose, their luminance, their face.
When they leave, the figure disperses and only the environment remains.

---

## Concept

The webcam is the only source of the human. Every visible human particle exists
because a real person is currently in frame, and its brightness, size, density
and drift are read from the actual camera pixels inside that person.

The raw video is never displayed. Neither is the segmentation mask, a
silhouette fill, a mesh, a skeleton or a face wireframe. The final canvas
contains particles and nothing else.

## Pipeline

```
live camera (p5 createCapture, hidden)
        │
        ├─► analysis buffer, mirrored exactly once
        │        └─► luminance · local contrast · Sobel edges
        │            frame difference · optical-flow estimate
        │
        ├─► ml5 BodySegmentation  ──► person mask  (never drawn)
        ├─► ml5 FaceMesh          ──► facial salience (never drawn, optional)
        └─► ml5 BodyPose          ──► limb salience   (never drawn, optional)
                 │
                 ▼
     importance = person × (base + luminance + contrast
                            + edges + face + pose + motion)
                 │
                 ▼
   three RGBA field textures ──► persistent GPU particle buffers
                 │
                 ▼
        WEBGL point sprites  ──►  the final image
```

Analysis runs at a low internal resolution; rendering runs fullscreen. Particle
positions are computed in the vertex shader from a fixed cell and a fixed seed,
so only a few small textures cross the CPU/GPU boundary each frame.

## Stack

| Layer | Technology |
|---|---|
| Runtime / creative framework | **p5.js 1.11** — `setup()`, `draw()`, WEBGL canvas, camera lifecycle, `windowResized()`, Perlin noise, final composition |
| Machine learning (analysis only) | **ml5.js 1.x** — BodySegmentation (SelfieSegmentation), FaceMesh, BodyPose |
| Rendering | WEBGL point sprites with custom GLSL shaders, driven through p5's own context |
| Page | HTML5, CSS3, vanilla JavaScript |

ml5 never draws anything. p5 owns the canvas and the frame.

## Running it

`getUserMedia` needs a secure context, and the shaders are loaded over HTTP, so
the project must be served — opening `index.html` from the filesystem will not
work.

```bash
cd interactive-humanoid
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static server works (`npx serve`, VS Code Live Server, …). Use a recent
desktop Chrome, Edge or Firefox with hardware acceleration enabled.

Click **ACTIVATE CAMERA** once. If more than one camera is available a small
selector appears; after that the interface disappears completely and only the
artwork remains.

## Cameras, including virtual ones

No device id is hardcoded. At startup the project asks for permission, then
enumerates `videoinput` devices:

* one usable camera → it is opened automatically;
* several cameras → a temporary selector is shown, then hidden for good.

Integrated webcams, USB webcams and virtual cameras (**DroidCam**, OBS Virtual
Camera, EpocCam, …) all work, because they are exposed to the browser as
ordinary video inputs.

**Using DroidCam or another virtual camera**

1. Start the virtual camera software *before* loading the page, and make sure it
   is actually transmitting a picture.
2. Load the page and click ACTIVATE CAMERA.
3. Pick the virtual device in the selector (for example `DroidCam Source 3`).

If a virtual camera is installed but idle, the browser opens the device and
never receives a frame; the project detects this and reports *"Camera produced
no video"* instead of spinning forever.

Constraints are relaxed automatically (exact device → preferred device → any
camera) so devices that reject a requested resolution still open.

Every failure mode is reported with a readable message: permission denied,
no camera found, camera busy (`NotReadableError`), unsupported constraints
(`OverconstrainedError`), aborted, insecure context, no frames, and the camera
being disconnected while running.

## Options

All options are URL parameters.

| Parameter | Default | Meaning |
|---|---|---|
| `?debug=1` | off | Debug overlay: FPS, camera name and resolution, processing resolution, segmentation status and timing, particle counts, quality level, analysis and render times, plus live mask / luminance / edge / importance maps |
| `?quality=LOW\|MEDIUM\|HIGH\|ULTRA` | adaptive | Pin a quality level and disable the adaptive controller |
| `?face=0` | on | Disable the FaceMesh salience pass |
| `?pose=1` | off | Enable the BodyPose limb salience pass |
| `?mirror=0` | on | Disable the mirroring stage |
| `?adaptive=0` | on | Disable automatic quality scaling |
| `?mock=1` | off | Development harness: synthesises an analysis field so the particle pipeline can be inspected on a machine with no camera. Not part of the artwork |

In debug mode: **D** toggles the stats, **V** the analysis maps, **Q** cycles
the quality level.

## Quality levels

| Level | Analysis grid | Human particles (approx.) |
|---|---|---|
| LOW | 160×120 | ~105,000 |
| MEDIUM | 256×192 | ~270,000 |
| HIGH | 320×240 | ~500,000 |
| ULTRA | 480×360 | ~950,000 |

The grid is reshaped to the camera's aspect ratio, so body proportions are never
stretched. The renderer starts at MEDIUM and climbs or drops on its own based on
measured frame rate.

## Project structure

```
index.html          page, activation interface, debug overlay
style.css           interface and overlay styling
config.js           URL options, quality ladder, every tunable constant
camera.js           enumeration, acquisition, constraint fallback, error handling
segmentation.js     ml5 BodySegmentation -> person field (mask encoding auto-detected)
faceAnalysis.js     ml5 FaceMesh -> facial salience field
poseAnalysis.js     ml5 BodyPose -> limb salience field (optional)
analysis.js         luminance, contrast, edges, motion, flow, aura, importance
motion.js           recycled pool of detached motion particles
particles.js        persistent GPU buffers for the human populations
environment.js      procedural background / midground / haze / foreground layers
renderer.js         WEBGL programs, field textures, draw order
debug.js            debug overlay and the development mock source
sketch.js           p5 entry point: preload, setup, draw, resize, state machine
shaders/            common.glsl, field.vert, env.vert, free.vert,
                    sprite.frag, atmosphere.vert, atmosphere.frag
```

## Particle populations

* **structural** — dense, small, stable; the recognisable anatomy
* **detail** — brighter, placed where contrast, edges and facial information are
* **silhouette** — the body outline, more reactive to movement
* **aura** — sparse matter around the body, connecting it to the environment
* **motion** — detached particles shed by fast real movement
* **environment** — background, midground, haze and foreground depth layers

## Notes

* ml5 downloads its models at runtime, so the first activation needs a network
  connection.
* `memoria.md` contains the short academic write-up.
