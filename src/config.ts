/**
 * Central artistic + behavioral tuning constants.
 * Everything a designer would want to iterate on lives here.
 *
 * COLORS/RENDER/BLOOM/POST/FIELD/PARTICLE_FIELD/AMBIENT/ATMOSPHERE are the
 * visual system and can be freely retuned. DYNAMICS/LIMITS/POINTER are the
 * pointer-attention interaction core and should stay stable — the whole
 * visual layer is built to consume their output, not the other way round.
 */

export const COLORS = {
  background: 0x02040a,
  backgroundBottom: 0x01030a,
  backgroundTop: 0x050b16,
  cyanPrimary: 0x35d6ff,
  cyanSecondary: 0x0f6f96,
  cyanDim: 0x0a3a52,
  iceWhite: 0xd8f6ff,
  silver: 0x9fd4e8,
};

export const RENDER = {
  maxPixelRatio: 1.75,
  fov: 30,
  cameraDistance: 4.7,
  cameraLookY: -0.05,
  near: 0.1,
  far: 60,
};

export const BLOOM = {
  strength: 0.72,
  radius: 0.42,
  threshold: 0.28,
};

export const POST = {
  vignetteDarkness: 1.25,
  vignetteOffset: 1.1,
  grainAmount: 0.026,
};

/** Second order dynamics per hierarchy layer: f = responsiveness (Hz),
 *  z = damping ratio (<1 allows tiny overshoot), r = initial response / anticipation.
 *  INTERACTION CORE — do not retune casually, the whole particle system's
 *  cascade (face -> head -> neck -> shoulders -> torso) depends on this. */
export const DYNAMICS = {
  input: { f: 7.5, z: 1.0, r: 0 },
  faceCore: { f: 4.4, z: 0.62, r: 1.4 },
  head: { f: 2.6, z: 0.68, r: 1.0 },
  neck: { f: 1.55, z: 0.78, r: 0.5 },
  shoulders: { f: 0.95, z: 0.88, r: 0.3 },
  torso: { f: 0.62, z: 0.95, r: 0.2 },
};

const DEG = Math.PI / 180;

/** INTERACTION CORE — max rotation angles per layer. Do not retune casually. */
export const LIMITS = {
  head: { yaw: 24 * DEG, pitch: 14 * DEG, roll: 2.6 * DEG },
  neck: { yaw: 10 * DEG, pitch: 6 * DEG, roll: 1.2 * DEG },
  shoulders: { yaw: 4 * DEG, pitch: 1.6 * DEG, roll: 0.8 * DEG, bob: 0.014 },
  torso: { yaw: 5.5 * DEG, pitch: 2.4 * DEG, roll: 0.6 * DEG },
  faceCoreShift: 0.052,
};

/** INTERACTION CORE. Do not retune casually. */
export const POINTER = {
  /** ms with no movement (or pointer outside window) before we ease attention back to center */
  returnDelayMs: 900,
  /** seconds to ease raw target back to center once the delay has elapsed */
  returnEase: 1.0,
};

export const IDLE = {
  breathingRate: 0.19, // Hz
  breathingAmount: 0.012,
  driftRate: 0.055,
  driftYaw: 1.4 * DEG,
  driftPitch: 0.8 * DEG,
};

/**
 * The humanoid's rest-pose skeleton — joint offsets only. This defines the
 * Object3D pivot hierarchy (shoulder -> neck -> head) that the particle
 * field is sampled relative to and that AttentionController's pose rotates
 * each frame. No mesh, no geometry — just three joints.
 */
export const SKELETON = {
  neckHeight: 0.36,
  torsoDepth: 1.05,
  /** Static vertical recenter of the whole figure within the frame. */
  groupOffsetY: -0.58,
};

/**
 * Analytic volume the particles for each body part are sampled inside.
 * `radii` are ellipsoid semi-axes (x, y, z); `center` offsets the ellipsoid
 * within that part's own local pivot frame. The actual per-direction
 * boundary is further shaped by the part's shape function in
 * `humanoidField.ts` (cranium/jaw/temple for the head, deltoid bulge for
 * the shoulders) — these are just the base envelope.
 */
export const FIELD = {
  head: {
    radii: [0.62, 0.66, 0.52] as [number, number, number],
    center: [0, 0.6, 0] as [number, number, number],
  },
  face: {
    radii: [0.34, 0.42, 0.16] as [number, number, number],
    center: [0, 0.62, 0.42] as [number, number, number],
  },
  neck: {
    topRadius: 0.22,
    bottomRadius: 0.28,
  },
  shoulders: {
    radii: [1.02, 0.76, 0.46] as [number, number, number],
    center: [0, -0.5, 0] as [number, number, number],
  },
};

/**
 * The humanoid particle field itself — this is the whole figure. Counts
 * are deliberately large: the brief calls for a dense volumetric being,
 * not a sparse point cloud. `haloFraction` of each part's particles are
 * sampled just past the nominal boundary (soft, low-density, fading with
 * distance) for the fuzzy/floating edge the brief asks for, instead of a
 * crisp geometric cutoff.
 */
export const PARTICLE_FIELD = {
  headCount: 34000,
  faceCount: 11000,
  neckCount: 5000,
  shoulderCount: 38000,
  haloFraction: 0.15,
  haloDepth: 0.42,
  /** Radial distribution power: 1 = uniform-by-volume, >1 biases toward
   *  the interior (denser core), <1 biases toward the boundary. Kept close
   *  to 1 so the volume reads as an evenly dense form rather than a single
   *  bright hotspot with a faint shell around it. */
  centerBias: 1.05,
  pointSizeRange: [0.85, 1.9] as [number, number],
  facePointSizeRange: [0.8, 1.7] as [number, number],
  brightnessRange: [0.4, 1.0] as [number, number],
  /** How much faster/farther face-tagged particles react to the pointer,
   *  reusing AttentionController's faceShift on top of the head's own
   *  (already fastest-after-face) rigid rotation. */
  faceShiftScale: 1.6,
  /** Subtle organic "mass flow" toward the attention direction, layered
   *  on top of the rigid per-part rotation — scaled per part below. */
  flowInfluence: 0.075,
  flowInfluenceByPart: { shoulder: 0.35, neck: 0.65, head: 1.0 },
  idleDriftAmount: 0.014,
  idleDriftSpeed: 0.16,
};

/** Restrained environment dust — separate from and far sparser than the
 *  humanoid field itself, so it never competes for attention. */
export const AMBIENT = {
  count: 900,
  radius: 7.5,
  spread: 5.5,
  size: 1.0,
  velocityInfluence: 0.3,
};

/** Layered soft-glow depth haze standing in for volumetric atmosphere —
 *  large, low-opacity radial gradients at increasing depth behind the
 *  figure, plus a vertical-gradient backdrop plane. Cool tones only. */
export const ATMOSPHERE = {
  backdropTop: COLORS.backgroundTop,
  backdropMid: COLORS.background,
  backdropBottom: COLORS.backgroundBottom,
  layers: [
    { color: COLORS.cyanDim, opacity: 0.09, size: 11, x: 0, y: 0.6, z: -4.5, parallax: 0.05 },
    { color: COLORS.cyanDim, opacity: 0.07, size: 16, x: -2.2, y: 1.1, z: -7.5, parallax: 0.035 },
  ],
};
