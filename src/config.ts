/**
 * Central artistic + behavioral tuning constants.
 * Everything a designer would want to iterate on lives here.
 */

export const COLORS = {
  background: 0x03060a,
  backgroundBottom: 0x05090f,
  cyanPrimary: 0x00dfff,
  cyanSecondary: 0x008fbf,
  cyanDim: 0x035066,
  orange: 0xff8a20,
  hotYellow: 0xffc04a,
};

export const RENDER = {
  maxPixelRatio: 1.75,
  fov: 32,
  cameraDistance: 6.4,
  near: 0.1,
  far: 60,
};

export const BLOOM = {
  strength: 1.15,
  radius: 0.55,
  threshold: 0.18,
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
  headHeightScale: 1.18,
  headDepthScale: 0.86,
  neckRadius: 0.24,
  neckHeight: 0.34,
  shoulderWidth: 1.55,
  shoulderDepth: 0.62,
  torsoHeight: 1.1,
  bustY: 0.0,
};

export const CONTOUR = {
  headBandFrequency: 34,
  headBandSharpness: 0.42,
  torsoBandFrequency: 26,
  torsoBandSharpness: 0.4,
  lineBrightness: 1.35,
  rimPower: 2.2,
  rimStrength: 2.4,
  noiseAmount: 0.12,
  noiseSpeed: 0.05,
  centerlineWidth: 0.05,
  centerlineStrength: 1.4,
};

export const FACE_CORE = {
  coreWidth: 0.34,
  coreHeight: 0.5,
  turbulenceSpeed: 0.09,
  bandFrequency: 9.0,
  bandStrength: 0.35,
  intensity: 1.6,
};

export const LANDSCAPE = {
  layers: 5,
  pointsPerLine: 140,
  width: 22,
  baseY: -2.4,
  layerSpacing: 0.62,
  driftSpeed: 0.012,
  parallaxAmount: 0.06,
};

export const PARTICLES = {
  count: 2600,
  radius: 2.4,
  spread: 1.6,
  size: 2.4,
  velocityInfluence: 0.4,
};

export const HUD = {
  ringCount: 3,
  ringOpacity: 0.16,
  rotationSpeed: 0.015,
};
