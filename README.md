# Interactive Humanoid — Particle Portrait

A fullscreen p5.js generative artwork: a human head/neck/shoulders portrait
made entirely of particles, sampled from a real sculpted head mesh, whose
gaze and head follow the pointer while a microphone drives subtle
"aliveness" in the surrounding field. This is a from-scratch rebuild — no
code or geometry is carried over from any earlier version.

## Running it

Any static file server works, e.g.:

```
python3 -m http.server 8000
```

then open `http://localhost:8000/`. No build step, no bundler — plain
ES modules loaded directly by the browser. p5.js and p5.sound are vendored
in `vendor/` so the project has no external runtime dependency.

## Anatomy pipeline

`assets/models/male_head_mid_jc.obj` is a single continuous bust sculpt —
head, neck, trapezius, and the start of the shoulders/upper chest, all one
mesh. That matters: because the head-to-shoulder transition already exists
as real, connected geometry, there is no seam to fake and nothing to stitch
together.

1. `js/objParser.js` parses the OBJ into a flat vertex/triangle list
   (fan-triangulating the source file's quads).
2. `js/surfaceSampler.js` performs area-weighted triangle sampling —
   particle density follows real surface area, not raw vertex density.
3. `js/anatomy.js` turns each sampled point into a fully-attributed
   particle: continuous motion-hierarchy weights (see below), landmark
   "salience" (brow/nose/lips/cheek/chin) for facial emphasis, an
   eye-socket darkening term so eyes read as shadowed recesses rather than
   another bright patch, and a soft probabilistic fade for the bottom crop
   so the figure dissolves into particles instead of ending in a hard
   amputated edge.
4. `js/environment.js` generates an independent atmospheric field
   (background + a sparse foreground depth layer) that never touches the
   anatomy rig.

## Motion hierarchy

The mouse never rotates "the humanoid" as a rigid object. Every anatomy
particle carries a continuous 3-vector of influence weights baked in at
generation time:

- **gaze** (fast easing, full clamp range) — front-of-face particles only
- **head** (medium easing) — skull/back-of-head particles
- **neck** (slow easing, small weight) — neck and the very top of the
  shoulder slope
- everything below that (shoulders, upper chest) carries ~0 weight and
  stays put

`js/main.js` eases three yaw/pitch angle pairs toward the same
mouse-derived, clamped target (±22°/±11°) at three different speeds; the
GPU vertex shader blends them per-particle by that particle's baked
weights and rotates around a pivot near the base of the skull — not the
chest. The result is temporal *and* spatial hierarchy: the face leads, the
head follows with a lag, the neck barely moves, and the torso is static.

## Rendering

`js/renderer.js` is a small raw-WebGL layer (accessed through p5's
`drawingContext`) with two point-sprite shader programs
(`js/shaders.js`):

- **anatomy** — hierarchical rotation, breathing (mic-modulated), per-particle
  alive jitter (suppressed near the face so it stays legible), normal-based
  shading plus a view-facing fade that substitutes for depth-sorting a
  translucent point cloud.
- **field** — independent drifting background/foreground atmosphere with
  mouse-parallax on the foreground layer only (never the figure itself).

All particle attributes are static buffers uploaded once; every frame only
updates a handful of uniforms (time, mic energy, three angle pairs), so
particle count stays cheap regardless of scene complexity.

## Audio

`js/audio.js` wraps `p5.AudioIn`/`p5.Amplitude` behind a single smoothed
0–1 "energy" value. Before the user grants mic permission (gated behind
the "Enable microphone" button, as autoplay policy requires a gesture) it
falls back to a slow simulated idle breathing signal, so the piece is
alive immediately and the mic only adds to that, never gates it.
