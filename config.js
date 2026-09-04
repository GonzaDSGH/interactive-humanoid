/**
 * Central tuning constants — quality presets, palette, camera, field
 * shapes and interaction dynamics all live here.
 *
 * DYNAMICS / LIMITS / POINTER are the pointer-attention interaction core
 * (see attention.js) and should stay stable. Everything else is the
 * generative visual system and is safe to retune freely.
 */

const DEG = Math.PI / 180;

const CONFIG = {
  // ---- Quality presets -----------------------------------------------
  // Particle counts per body-part field, at each adaptive-quality level.
  // ULTRA is attempted first; see sketch.js for the adaptive downgrade.
  QUALITY: {
    ULTRA: { head: 34000, face: 11000, neck: 5000, shoulder: 38000, ambient: 900 },
    HIGH: { head: 20000, face: 6500, neck: 3000, shoulder: 22000, ambient: 600 },
    MEDIUM: { head: 10000, face: 3200, neck: 1600, shoulder: 11000, ambient: 350 },
  },
  QUALITY_ORDER: ['ULTRA', 'HIGH', 'MEDIUM'],
  // Sustained-FPS check: sample window, threshold, and cooldown between
  // possible downgrades (never upgrades — avoids visible quality flicker).
  ADAPTIVE: {
    checkIntervalMs: 1000,
    downgradeFpsThreshold: 44,
    consecutiveBadChecksToDowngrade: 3,
    cooldownMs: 9000,
  },

  // ---- Palette (cold only — no warm center) ---------------------------
  COLOR_PRIMARY: [0.21, 0.84, 1.0],
  COLOR_SECONDARY: [0.06, 0.44, 0.6],
  COLOR_HIGHLIGHT: [0.85, 0.97, 1.0],
  BACKGROUND_ALPHA_CLEAR: true,

  // ---- Camera -----------------------------------------------------------
  CAMERA: {
    fovDeg: 34,
    distance: 5.0,
    lookY: -0.15,
    near: 0.1,
    far: 60,
  },

  // ---- Skeleton (joint offsets only — no mesh) -------------------------
  SKELETON: {
    neckHeight: 0.26,
    groupOffsetY: -0.4,
  },

  // ---- Analytic body-part volumes (ellipsoid semi-axes + center) ------
  FIELD: {
    head: { radii: [0.62, 0.66, 0.52], center: [0, 0.6, 0] },
    face: { radii: [0.34, 0.42, 0.16], center: [0, 0.62, 0.42] },
    neck: { topRadius: 0.24, bottomRadius: 0.3 },
    shoulders: { radii: [1.02, 0.62, 0.46], center: [0, -0.5, 0] },
  },

  PARTICLE_FIELD: {
    haloFraction: 0.15,
    haloDepth: 0.42,
    centerBias: 1.05,
    pointSizeRange: [0.85, 1.9],
    facePointSizeRange: [0.8, 1.7],
    brightnessRange: [0.4, 1.0],
    faceShiftScale: 1.6,
    flowInfluence: 0.075,
    flowInfluenceByPart: { shoulder: 0.35, neck: 0.65, head: 1.0 },
    idleDriftAmount: 0.014,
    idleDriftSpeed: 0.16,
    // Coherent-noise flow field (Perlin-style, evaluated in GLSL) —
    // autonomous organic motion independent of pointer/audio input.
    noiseFlowAmount: 0.028,
    noiseFlowSpeed: 0.05,
    noiseFlowScale: 1.6,
  },

  AMBIENT: {
    radius: 2.6,
    spread: 1.8,
    velocityInfluence: 0.3,
  },

  // ---- Point rendering --------------------------------------------------
  POINT_SIZE_CONSTANT: 10.5,
  MAX_PIXEL_RATIO: 1.75,

  // ---- Idle autonomous motion --------------------------------------------
  IDLE: {
    breathingRate: 0.19,
    breathingAmount: 0.012,
    driftRate: 0.055,
    driftYaw: 1.4 * DEG,
    driftPitch: 0.8 * DEG,
  },

  // ---- Audio reactivity ---------------------------------------------------
  AUDIO: {
    smoothing: 0.82, // exponential smoothing factor for amplitude/bass/mid/treble
    // How strongly each band affects the system. Kept restrained — the
    // brief explicitly forbids aggressive flashing/explosion on speech.
    bassBreathScale: 0.6, // extra breathing amplitude from bass energy
    midFlowScale: 0.5, // extra noise-flow amount from mid energy
    trebleSparkleScale: 0.6, // extra edge-particle brightness from treble
    energyBrightnessScale: 0.35, // overall brightness lift from amplitude
  },

  // ---- Pointer -> attention dynamics (INTERACTION CORE) ------------------
  DYNAMICS: {
    input: { f: 7.5, z: 1.0, r: 0 },
    face: { f: 4.4, z: 0.62, r: 1.4 },
    head: { f: 2.6, z: 0.68, r: 1.0 },
    neck: { f: 1.55, z: 0.78, r: 0.5 },
    shoulders: { f: 0.95, z: 0.88, r: 0.3 },
    torso: { f: 0.62, z: 0.95, r: 0.2 },
  },

  LIMITS: {
    head: { yaw: 24 * DEG, pitch: 14 * DEG, roll: 2.6 * DEG },
    neck: { yaw: 10 * DEG, pitch: 6 * DEG, roll: 1.2 * DEG },
    shoulders: { yaw: 4 * DEG, pitch: 1.6 * DEG, roll: 0.8 * DEG, bob: 0.014 },
    torso: { yaw: 5.5 * DEG, pitch: 2.4 * DEG, roll: 0.6 * DEG },
    faceShift: 0.052,
  },

  POINTER: {
    returnDelayMs: 900,
    returnEase: 1.0,
  },
};
