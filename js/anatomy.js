// Anatomical landmarks + motion-hierarchy weighting for the head/neck/
// shoulder mesh (Y-up, +Z = face-front, mesh centered near x=0).
//
// The source OBJ is a single continuous bust sculpt (head, neck, trapezius,
// shoulders, a bit of upper chest). Because it's one real, connected mesh
// there is no seam to hide between "head" and "body" - the regions below
// exist only to drive motion weighting and visual emphasis, not to stitch
// separate geometry together.

import { sampleSurface } from './surfaceSampler.js';

export const LANDMARKS = {
  topHead: 1.02,
  browEye: 0.12,
  noseTip: -0.1,
  chin: -1.0,
  neckMid: -1.55,
  shoulderPeak: -2.8,
  cropFadeStart: -3.0,
  cropFadeEnd: -3.8,
};

// ascending-edge smoothstep; caller always passes edge0 < edge1.
function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function headBand(y) {
  return smoothstep(-1.7, -1.0, y);
}

function neckBand(y) {
  return smoothstep(-2.3, -1.9, y) * (1 - smoothstep(-1.5, -1.0, y));
}

function shoulderBand(y) {
  return smoothstep(-3.3, -2.9, y) * (1 - smoothstep(-2.5, -2.1, y));
}

function frontness(z) {
  return smoothstep(-0.2, 0.85, z);
}

function cropKeepProbability(y) {
  return smoothstep(LANDMARKS.cropFadeEnd, LANDMARKS.cropFadeStart, y);
}

function gauss(dx, dy, dz, sigma) {
  const d2 = dx * dx + dy * dy + dz * dz;
  return Math.exp(-d2 / (2 * sigma * sigma));
}

// Facial landmark "salience" bumps used to brighten/emphasize particles
// near features that make a face read as a face, without hand-picking
// individual mesh vertices. Kept tight (small sigma) so features stay
// distinct instead of blurring into one glowing patch.
const SALIENCE_POINTS = [
  { x: 0.24, y: 0.2, z: 0.85, sigma: 0.26, w: 0.8 }, // brow ridge
  { x: -0.24, y: 0.2, z: 0.85, sigma: 0.26, w: 0.8 },
  { x: 0, y: 0.12, z: 0.9, sigma: 0.16, w: 0.7 }, // nose bridge
  { x: 0, y: -0.08, z: 1.02, sigma: 0.14, w: 1.0 }, // nose tip
  { x: 0, y: -0.6, z: 0.82, sigma: 0.16, w: 0.75 }, // lips
  { x: 0.3, y: -0.25, z: 0.75, sigma: 0.22, w: 0.4 }, // cheekbone
  { x: -0.3, y: -0.25, z: 0.75, sigma: 0.22, w: 0.4 },
  { x: 0, y: -0.98, z: 0.72, sigma: 0.16, w: 0.35 }, // chin
];

// Eye-socket recesses: darken instead of brighten, so eyes read as shadowed
// pockets under the brow rather than another bright patch.
const EYE_SOCKETS = [
  { x: 0.24, y: 0.02, z: 0.85, sigma: 0.16 },
  { x: -0.24, y: 0.02, z: 0.85, sigma: 0.16 },
];

function salience(x, y, z) {
  let s = 0;
  for (const p of SALIENCE_POINTS) {
    s = Math.max(s, p.w * gauss(x - p.x, y - p.y, z - p.z, p.sigma));
  }
  return Math.min(1, s);
}

function socketDarken(x, y, z) {
  let s = 0;
  for (const p of EYE_SOCKETS) {
    s = Math.max(s, gauss(x - p.x, y - p.y, z - p.z, p.sigma));
  }
  return Math.min(1, s);
}

/**
 * Builds the full set of static per-particle attribute buffers consumed by
 * the anatomy renderer. Structural particles sit near the real surface;
 * aura particles are pushed outward along the surface normal to form a
 * soft halo. Both are drawn from the same area-weighted sample so density
 * still follows real geometry.
 */
export function buildAnatomyParticles(mesh, count) {
  const sample = sampleSurface(mesh, count, (x, y, z) => cropKeepProbability(y));
  const n = sample.count;

  const basePos = new Float32Array(n * 3);
  const normal = new Float32Array(n * 3);
  const influence = new Float32Array(n * 3); // gaze, head, neck+shoulder
  const attribs = new Float32Array(n * 4); // offset, size, alpha, seed
  const extra = new Float32Array(n * 2); // colorMix, breath

  for (let i = 0; i < n; i++) {
    const x = sample.positions[i * 3];
    const y = sample.positions[i * 3 + 1];
    const z = sample.positions[i * 3 + 2];
    const nx = sample.normals[i * 3];
    const ny = sample.normals[i * 3 + 1];
    const nz = sample.normals[i * 3 + 2];

    basePos[i * 3] = x;
    basePos[i * 3 + 1] = y;
    basePos[i * 3 + 2] = z;
    normal[i * 3] = nx;
    normal[i * 3 + 1] = ny;
    normal[i * 3 + 2] = nz;

    const head = headBand(y);
    const front = frontness(z);
    const w1 = head * front; // gaze - fast, only the front of the face
    const w2 = head * (1 - front) * 0.8; // head/skull - medium, mostly back/sides
    const w3 = neckBand(y) * 0.18 + shoulderBand(y) * 0.04; // neck/shoulder - slow, tiny
    influence[i * 3] = w1;
    influence[i * 3 + 1] = w2;
    influence[i * 3 + 2] = w3;

    const sal = salience(x, y, z);
    const socket = socketDarken(x, y, z);
    const isAura = Math.random() < 0.22;

    const offset = isAura ? 0.03 + Math.random() * 0.14 : Math.random() * 0.012;
    const size = isAura
      ? (1.8 + Math.random() * 2.2) * (1 + sal * 0.2)
      : (0.85 + Math.random() * 0.95) * (1 + sal * 1.3);
    let alpha = isAura ? 0.012 + Math.random() * 0.026 : 0.11 + Math.random() * 0.16 + sal * 0.4;
    if (!isAura) alpha *= 1 - socket * 0.6;
    const seed = Math.random();

    attribs[i * 4] = offset;
    attribs[i * 4 + 1] = size;
    attribs[i * 4 + 2] = Math.min(1, alpha);
    attribs[i * 4 + 3] = seed;

    const colorMix = Math.min(1, sal * (isAura ? 0.3 : 1.4));
    const breath = Math.max(1 - w1 * 1.3, isAura ? 0.3 : 0);
    extra[i * 2] = colorMix;
    extra[i * 2 + 1] = Math.min(1, breath);
  }

  return { count: n, basePos, normal, influence, attribs, extra };
}
