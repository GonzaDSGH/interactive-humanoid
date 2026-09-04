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
- **`CONTOUR`** — contour-line frequency, thickness, rim/fresnel strength,
  shell fill, micro-line and panel-seam intensity.
- **`FACE_CORE`** — the energy core's size, color banding, reactor rings,
  iris spokes and bezel.
- **`LANDSCAPE`** / **`PARTICLES`** / **`HUD`** / **`ATMOSPHERE`** — the
  background environment.
- `src/utils/sculpt.ts` — the head's radial-displacement sculpting
  function (`sculptHeadRadius`): cranium, temple flare, brow ridge, face
  plate, cheekbones, jaw taper — tune these to reshape the skull.

## Architecture

- `src/core/` — renderer, camera, `EffectComposer` + `UnrealBloomPass` +
  a small vignette/grain finishing pass.
- `src/input/` — `PointerTracker` (raw pointer → normalized target, with
  idle/leave-to-center handling) and `AttentionController`, which cascades
  the pointer through a chain of `SecondOrderDynamics` filters (a proper
  damped-spring integrator, not a plain lerp) to produce each body layer's
  yaw/pitch/roll with increasing delay and decreasing amplitude down the
  chain. **This interaction system is the stable core of the project** —
  the visual layers below are built on top of it and can be redesigned
  independently.
- `src/humanoid/` — procedural geometry and materials:
  - The head is a subdivided icosahedron sculpted by displacing every
    vertex along its own ray from the origin (`buildDisplacedIcosahedron`
    + `sculptHeadRadius`) into a cranium, flared temples, a brow ridge, a
    recessed front face-plate, cheekbones and a tapered jaw. Being a pure
    radial displacement it can never self-intersect, and — unlike a
    lathed/revolved profile — it isn't rotationally symmetric, so the
    silhouette actually changes as the head yaws.
  - The neck is a lathe with subtle periodic ring bumps (armored/segmented
    look) and overlaps up into the head's own volume so no seam is ever
    visible at the join. A thin torus collar ring sits at its base.
  - The torso/shoulders lathe profile has a defined deltoid bulge and a
    collar step rather than a smooth monotonic taper.
  - The contour `ShaderMaterial` layers a primary + secondary "micro
    circuit" line pattern, a faint translucent shell fill, a two-tone
    fresnel rim, and geometry-driven panel-seam accents (computed
    analytically from the same normalized coordinates the sculpting used)
    on top of the original stable, object-space contour bands.
  - The face core reads as an embedded reactor — concentric iris rings, a
    faint rotating spoke pattern and a bright lens bezel — sunk into the
    head's recessed face-plate socket instead of floating in front of it.
  - The transform hierarchy (torso → shoulders → neck → head → face core)
    is real nested `Object3D`s pivoted at each joint, so a rigged GLB
    could be substituted later without touching the interaction system.
- `src/environment/` — `Atmosphere` (a vertical-gradient backdrop plane
  plus a few soft low-opacity radial haze planes at increasing depth,
  standing in for volumetric fog), the procedural cyan/orange ridge-line
  `Landscape`, sparse HUD arcs/orbital dots, and a single-draw-call GPU
  `Particles` system: dust is gathered into Gaussian clusters around the
  head's actual structural landmarks (crown, temples, jaw) rather than
  scattered over a uniform shell, and a small marked subset renders as a
  3-phase velocity-lag "trail spark" streak, gated by pointer speed so it
  stays invisible at rest and only appears during fast movement.

## Implementation notes worth knowing

- The face energy core is rendered in a **separate pass, after bloom**
  (`SceneManager.renderOverlayLayer`, on its own camera layer) instead of
  going through `UnrealBloomPass` like the rest of the scene. Bloom's
  downsample/blur pyramid produces a visible ring artifact around small,
  soft-edged, saturated shapes (classic Gibbs-phenomenon ringing) —
  occluding the core from the bloom composite and drawing it directly on
  top removes that artifact while keeping everything else glowing
  normally.
- The scene background is a real plane mesh with a vertical-gradient
  shader (`Atmosphere`'s backdrop plane), not `scene.background` set to a
  `CanvasTexture`. The latter renders fine in most browsers but silently
  broke the entire frame in this project's headless/software-rendered
  test environment (no thrown error — every subsequent draw call just
  stopped painting) — the plane-based approach sidesteps that risk
  entirely and looks identical.

## Known limitations

- Tuned and screenshot-tested against a software (SwiftShader) renderer in
  a headless sandbox; frame rate there is not representative of a real
  GPU — expect smoother 60fps on actual hardware.
- The sculpted head is a stylized, faceless bust rather than a
  photorealistic robot; it's tuned for a strong silhouette and clean
  contour-line shading at the camera distances/angles the pointer-tracking
  range actually reaches, not for extreme close-ups.
