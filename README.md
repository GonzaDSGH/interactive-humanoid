# Sentience — Interactive Humanoid

A fullscreen, realtime WebGL digital being that watches and follows your cursor.
Built with Vite, TypeScript and Three.js. No backend, no webcam, no external
3D models — the humanoid, its contour lines, its energy core and the
environment are all generated procedurally in code.

## Install

```bash
npm install
```

## Run (development)

```bash
npm run dev
```

Opens a local dev server (default `http://localhost:5173`). Append
`?debug=1` to the URL to show a small readout of pointer position, FPS and
per-layer rotation values, useful for tuning.

## Build

```bash
npm run build
```

Type-checks the project and produces a static production build in `dist/`.
Preview it with `npm run preview`.

## Where the tuning constants live

All artistic and behavioral constants are centralized in
[`src/config.ts`](src/config.ts):

- **`COLORS`** — the cyan/orange/yellow palette.
- **`RENDER`** — camera FOV, distance, framing.
- **`BLOOM`** / **`POST`** — bloom strength/threshold/radius, vignette, grain.
- **`DYNAMICS`** — per-layer second-order spring parameters (`f` response
  frequency, `z` damping ratio, `r` anticipation) that drive the
  pointer → face → head → neck → shoulders → torso attention cascade.
- **`LIMITS`** — max rotation angles per layer.
- **`HUMANOID`** — head/neck/torso proportions.
- **`CONTOUR`** — contour-line frequency, thickness, rim/fresnel strength.
- **`FACE_CORE`** — the energy core's size, color banding and intensity.
- **`LANDSCAPE`** / **`PARTICLES`** / **`HUD`** — the background environment.

## Architecture

- `src/core/` — renderer, camera, `EffectComposer` + `UnrealBloomPass` +
  a small vignette/grain finishing pass.
- `src/input/` — `PointerTracker` (raw pointer → normalized target, with
  idle/leave-to-center handling) and `AttentionController`, which cascades
  the pointer through a chain of `SecondOrderDynamics` filters (a proper
  damped-spring integrator, not a plain lerp) to produce each body layer's
  yaw/pitch/roll with increasing delay and decreasing amplitude down the
  chain.
- `src/humanoid/` — procedural geometry (lathe-revolved, non-uniformly
  scaled profiles for the head/torso so they don't read as bare
  spheres/cylinders), the custom GLSL contour-line `ShaderMaterial`, and
  the face energy core material. The transform hierarchy
  (torso → shoulders → neck → head → face core) is real nested
  `Object3D`s pivoted at each joint, so a rigged GLB could be substituted
  later without touching the interaction system.
- `src/environment/` — the procedural cyan/orange ridge-line landscape,
  sparse HUD arcs/orbital dots, and a single-draw-call GPU particle system
  (`Points` + a vertex shader that does all the per-particle drift).

## A implementation note worth knowing

The face energy core is rendered in a **separate pass, after bloom**
(`SceneManager.renderOverlayLayer`, on its own camera layer) instead of
going through `UnrealBloomPass` like the rest of the scene. Bloom's
downsample/blur pyramid produces a visible ring artifact around small,
soft-edged, saturated shapes (classic Gibbs-phenomenon ringing) — occluding
the core from the bloom composite and drawing it directly on top removes
that artifact while keeping everything else glowing normally.

## Known limitations

- The head/torso silhouette is close to rotationally symmetric (a lathed
  profile), so a yaw turn is conveyed mainly through the face core's
  internal shift and rim/fresnel shading rather than a dramatically
  changing outline. This was a deliberate trade-off for a clean procedural
  volume; swapping in a sculpted/asymmetric GLB head later (the geometry
  layer is isolated for exactly this) would make the turn read more
  strongly from off-axis angles.
- Tuned and screenshot-tested against a software (SwiftShader) renderer in
  a headless sandbox; frame rate there is not representative of a real
  GPU — expect smoother 60fps on actual hardware.
