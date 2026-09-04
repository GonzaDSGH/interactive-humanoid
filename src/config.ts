/**
 * Central artistic + behavioral tuning constants.
 * Everything a designer would want to iterate on lives here.
 */

export const COLORS = {
  background: 0x03060a,
  backgroundBottom: 0x05090f,
  backgroundTop: 0x060c16,
  cyanPrimary: 0x00dfff,
  cyanSecondary: 0x008fbf,
  cyanDim: 0x035066,
  /** Near-white hot edge for the sharpest grazing-angle rim highlight. */
  cyanHot: 0xd6faff,
  orange: 0xff8a20,
  hotYellow: 0xffc04a,
  /** Warm-white lens-highlight for the face core's bezel edge. */
  warmWhite: 0xfff1d9,
};

export const RENDER = {
  maxPixelRatio: 1.75,
  fov: 32,
  cameraDistance: 5.15,
  cameraLookY: 0.32,
  near: 0.1,
  far: 60,
};

export const BLOOM = {
  strength: 0.82,
  radius: 0.32,
  threshold: 0.32,
};

export const POST = {
  vignetteDarkness: 1.15,
  vignetteOffset: 1.05,
  grainAmount: 0.028,
};

/** Second order dynamics per hierarchy layer: f = responsiveness (Hz),
 *  z = damping ratio (<1 allows tiny overshoot), r = initial response / anticipation. */
export const DYNAMICS = {
  input: { f: 7.5, z: 1.0, r: 0 },
  faceCore: { f: 4.4, z: 0.62, r: 1.4 },
  head: { f: 2.6, z: 0.68, r: 1.0 },
  neck: { f: 1.55, z: 0.78, r: 0.5 },
  shoulders: { f: 0.95, z: 0.88, r: 0.3 },
  torso: { f: 0.62, z: 0.95, r: 0.2 },
};

const DEG = Math.PI / 180;

export const LIMITS = {
  head: { yaw: 24 * DEG, pitch: 14 * DEG, roll: 2.6 * DEG },
  neck: { yaw: 10 * DEG, pitch: 6 * DEG, roll: 1.2 * DEG },
  shoulders: { yaw: 4 * DEG, pitch: 1.6 * DEG, roll: 0.8 * DEG, bob: 0.014 },
  torso: { yaw: 5.5 * DEG, pitch: 2.4 * DEG, roll: 0.6 * DEG },
  faceCoreShift: 0.052,
};

export const POINTER = {
  /** ms with no movement (or pointer outside window) before we ease attention back to center */
  returnDelayMs: 900,
  /** seconds to ease raw target back to center once the delay has elapsed */
  returnEase: 1.0,
};

export const IDLE = {
  breathingRate: 0.19, // Hz
  breathingAmount: 0.014,
  driftRate: 0.055,
  driftYaw: 1.4 * DEG,
  driftPitch: 0.8 * DEG,
  corePulseRate: 0.12,
};

export const HUMANOID = {
  headRadius: 0.62,
  headHeightScale: 1.04,
  headDepthScale: 0.8,
  /** How far below the head-local origin (y=0, the neck attachment point)
   *  the sculpted geometry's unit-sphere pole sits — see sculptHeadRadius
   *  and headSculptY. Kept slightly under 1 so the pole tucks inside the
   *  neck's own volume instead of exposing a visible cone tip. */
  headTranslateFactor: 0.94,
  neckRadius: 0.24,
  neckHeight: 0.34,
  /** Extra neck height hidden inside the head's own volume, so no seam
   *  is visible where the sculpted skull's tapered base meets the neck. */
  neckOverlap: 0.16,
  shoulderWidth: 1.72,
  shoulderDepth: 0.5,
  torsoHeight: 1.1,
  bustY: 0.0,
};

/** Local-space Y (inside `humanoid.group`, before its static centering
 *  offset) of the head's visual center — used to align particles/HUD. */
export const HEAD_LOCAL_CENTER_Y =
  HUMANOID.neckHeight + HUMANOID.headRadius * HUMANOID.headHeightScale;

export const CONTOUR = {
  headBandFrequency: 17,
  headBandSharpness: 0.1,
  torsoBandFrequency: 13,
  torsoBandSharpness: 0.11,
  lineBrightness: 1.0,
  rimPower: 2.8,
  rimStrength: 1.2,
  noiseAmount: 0.045,
  noiseSpeed: 0.05,
  centerlineWidth: 0.045,
  centerlineStrength: 1.1,
  /** Faint translucent base fill so the shell reads as semi-transparent
   *  material, not just a line drawing over black. */
  shellFill: 0.04,
  /** Secondary fine circuit-line layer, phase-locked to the primary bands. */
  microFrequency: 3.4,
  microStrength: 0.13,
};

export const FACE_CORE = {
  // Must stay below ~0.74 so the radial falloff (which needs dist up to
  // 1.35) completes before the patch UV edge (|p| = 1) — otherwise the
  // ellipse gets hard-clipped into an irregular "kidney" shape.
  coreWidth: 0.6,
  coreHeight: 0.86,
  turbulenceSpeed: 0.09,
  bandFrequency: 11.0,
  bandStrength: 0.3,
  intensity: 1.35,
  /** Concentric reactor-iris rings emanating from the core center. */
  ringFrequency: 5.5,
  ringSpeed: 0.16,
  ringStrength: 0.3,
  /** Faint rotating mechanical iris spokes. */
  spokeCount: 10,
  spokeStrength: 0.14,
  spokeSpeed: 0.05,
  /** Bright lens bezel right at the core's outer edge. */
  bezelStrength: 0.55,
};

export const LANDSCAPE = {
  layers: 5,
  pointsPerLine: 140,
  width: 24,
  baseY: -0.75,
  layerSpacing: 0.62,
  driftSpeed: 0.012,
  parallaxAmount: 0.06,
};

export const PARTICLES = {
  count: 1500,
  haloFraction: 0.46,
  haloRadiusMin: 1.16,
  haloRadiusMax: 1.55,
  size: 1.0,
  velocityInfluence: 0.4,
  /** Small subset rendered as multi-phase velocity-lag "trail sparks" —
   *  a cheap 3-echo motion streak rather than a true per-particle history.
   *  All three stay slower than the main dust's own damping (lambda 3)
   *  so the sparks genuinely trail behind rather than lead. */
  trailCount: 150,
  trailLagFast: 2.3,
  trailLagMedium: 1.3,
  trailLagSlow: 0.65,
};

export const HUD = {
  ringCount: 3,
  ringOpacity: 0.16,
  rotationSpeed: 0.015,
};

/** Layered soft-glow depth haze standing in for volumetric atmosphere —
 *  large, low-opacity radial gradients at increasing depth behind the
 *  figure. Ordered near to far; `parallax` scales how much each layer
 *  drifts with the pointer (nearer layers move more). */
export const ATMOSPHERE = {
  backdropTop: COLORS.backgroundTop,
  backdropMid: COLORS.background,
  backdropBottom: COLORS.backgroundBottom,
  layers: [
    { color: COLORS.cyanDim, opacity: 0.1, size: 10, x: 0, y: 0.6, z: -4.5, parallax: 0.05 },
    { color: COLORS.cyanDim, opacity: 0.09, size: 15, x: -2.5, y: 1.2, z: -7, parallax: 0.035 },
    { color: COLORS.orange, opacity: 0.035, size: 9, x: 0, y: 0.3, z: -3, parallax: 0.06 },
  ],
};
