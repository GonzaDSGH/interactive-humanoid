'use strict';

/* ==================================================================
   config.js — URL options, quality ladder and every tunable constant.
   ================================================================== */

const QUERY = (function parseQuery() {
  const p = new URLSearchParams(window.location.search);
  const flag = (k, d) => (p.has(k) ? !['0', 'false', 'no'].includes(String(p.get(k)).toLowerCase()) : d);
  const str = (k, d) => (p.has(k) ? String(p.get(k)) : d);
  return {
    debug: flag('debug', false),
    quality: str('quality', '').toUpperCase(),
    face: flag('face', true),     // FaceMesh salience (analysis only, never drawn)
    pose: flag('pose', false),    // BodyPose salience (analysis only, never drawn)
    mirror: flag('mirror', true), // single controlled mirroring stage
    adaptive: flag('adaptive', true),
    // Development harness only: synthesises an analysis field so the particle
    // pipeline can be inspected on a machine with no camera. Never on by default.
    mock: flag('mock', false)
  };
})();

/* ---------------- quality ladder ----------------
   aw/ah      analysis (and particle grid) resolution
   detail     extra particles per cell for the high-information population
   aura       aura particles per cell
   env        procedural environment populations (GPU only, no CPU cost)
   freePool   CPU pool for detached motion particles                        */
const QUALITY_LEVELS = [
  {
    name: 'LOW', aw: 160, ah: 120, structuralPerCell: 3, detailPerCell: 1, silPerCell: 1, auraPerCell: 0.5,
    env: { back: 9000, mid: 6000, haze: 1100, fore: 200 }, freePool: 1200
  },
  {
    name: 'MEDIUM', aw: 256, ah: 192, structuralPerCell: 3, detailPerCell: 1, silPerCell: 1, auraPerCell: 0.5,
    env: { back: 14000, mid: 9000, haze: 1700, fore: 280 }, freePool: 2200
  },
  {
    name: 'HIGH', aw: 320, ah: 240, structuralPerCell: 3, detailPerCell: 2, silPerCell: 1, auraPerCell: 0.5,
    env: { back: 19000, mid: 12000, haze: 2200, fore: 360 }, freePool: 3000
  },
  {
    name: 'ULTRA', aw: 480, ah: 360, structuralPerCell: 2, detailPerCell: 2, silPerCell: 1, auraPerCell: 0.5,
    env: { back: 24000, mid: 15000, haze: 2800, fore: 440 }, freePool: 3600
  }
];

const CONFIG = {
  /* start conservatively; the adaptive controller climbs when frames allow */
  startQuality: 1,
  minQuality: 0,
  maxQuality: 3,

  camera: {
    idealWidth: 1280,
    idealHeight: 720,
    idealFrameRate: 30,
    readyTimeoutMs: 12000,
    restartDelayMs: 220
  },

  analysis: {
    /* importance = person * (base + weighted real camera information) */
    base: 0.30,
    lumWeight: 0.55,
    contrastWeight: 1.30,
    edgeWeight: 0.95,
    faceWeight: 1.25,
    poseWeight: 0.55,
    motionWeight: 0.45,

    /* gains applied when normalising the raw analysis buffers */
    contrastGain: 4.6,
    edgeGain: 2.7,
    motionGain: 7.0,
    motionDecay: 0.84,

    /* asymmetric temporal smoothing: quick to accept a body, slow to drop it,
       which removes segmentation jitter and produces a natural dissolve */
    personRise: 0.55,
    personFall: 0.16,

    /* blur radii, in analysis cells */
    contrastRadius: 2,
    auraRadius: 7,
    auraGain: 1.8,
    faceRadius: 2.2,

    /* fraction of cells that must belong to a person for presence to latch */
    presenceEnter: 0.010,
    presenceExit: 0.0045,
    presenceRise: 2.2,   // per second
    presenceFall: 1.1    // per second
  },

  motion: {
    spawnThreshold: 0.26,
    spawnPerFrame: 180,
    scanStride: 7,
    life: [0.45, 1.25],
    speed: [40, 190],
    drag: 1.35,
    size: [1.1, 2.6]
  },

  /* per-population rendering parameters, in cell units where relevant.
     kind: 0 structural · 1 detail · 2 silhouette · 3 aura                  */
  layers: {
    structural: { kind: 0, density: 0.70, sizeBase: 0.34, sizeVar: 0.16, alpha: 0.85, jitter: 1.05, drift: 0.55, push: 0.35, core: 0.45 },
    detail: { kind: 1, density: 1.40, sizeBase: 0.20, sizeVar: 0.14, alpha: 0.55, jitter: 1.20, drift: 0.70, push: 0.55, core: 1.00 },
    silhouette: { kind: 2, density: 1.00, sizeBase: 0.22, sizeVar: 0.20, alpha: 0.20, jitter: 1.35, drift: 1.20, push: 1.40, core: 0.70 },
    aura: { kind: 3, density: 1.15, sizeBase: 0.55, sizeVar: 0.60, alpha: 0.16, jitter: 1.60, drift: 2.60, push: 0.90, core: 0.20 }
  },

  env: {
    back: { speed: 0.020, scale: 2.4, size: 1.35, alpha: 0.190, depth: [0.00, 0.30] },
    mid: { speed: 0.045, scale: 3.6, size: 2.10, alpha: 0.260, depth: [0.30, 0.65] },
    haze: { speed: 0.012, scale: 1.5, size: 15.0, alpha: 0.075, depth: [0.10, 0.45] },
    fore: { speed: 0.085, scale: 5.0, size: 6.00, alpha: 0.180, depth: [0.80, 1.00] }
  },

  render: {
    backgroundColor: [3, 7, 13],
    maxPointSize: 90,
    dispersion: 0.085,    // outward drift applied while the body dissolves
    parallax: 0.045
  },

  adaptive: {
    sampleFrames: 90,
    downFps: 34,
    upFps: 56,
    cooldownMs: 3500
  }
};
