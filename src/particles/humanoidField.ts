import { FIELD, PARTICLE_FIELD, SKELETON } from '../config';

/** Which rigid-part matrix (see HumanoidParticles) a particle is skinned to. */
export const PART = {
  SHOULDER: 0,
  NECK: 1,
  HEAD: 2,
} as const;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function gaussian(x: number, center: number, width: number): number {
  const d = (x - center) / width;
  return Math.exp(-d * d);
}

/**
 * Direction-dependent radius multiplier for the head volume: a broad
 * cranium, flared temples, a subtle brow, a flattened front (face) plane,
 * and a tapered jaw — the same anatomical landmarks a sculpted mesh would
 * have, but here they only ever shape where PARTICLES are allowed to
 * exist, never a visible surface.
 */
function headShape(nx: number, ny: number, nz: number): number {
  // Additive bumps (cranium/temple/brow) read as natural protrusions even
  // at fairly high magnitude. Subtractive tapers do not: a strong
  // reduction over a narrow angular range fights the base ellipsoid's own
  // curvature and reads as a flat cut/box edge rather than a rounded
  // taper, so those stay gentler and spread over a wider range.
  let r = 1.0;

  const crownFlatten = smoothstep(0.55, 1.0, ny);
  r -= 0.14 * crownFlatten;

  const craniumHeight = smoothstep(-0.05, 0.5, ny) * (1 - smoothstep(0.7, 0.98, ny));
  const craniumBack = smoothstep(0.2, -0.65, nz);
  r += 0.2 * craniumHeight * craniumBack;

  const templeBand = gaussian(ny, 0.06, 0.28);
  const sideness = smoothstep(0.15, 0.6, Math.abs(nx));
  r += 0.16 * templeBand * sideness;

  const browBand = gaussian(ny, 0.15, 0.05);
  const browFront = smoothstep(0.05, 0.5, nz);
  r += 0.06 * browBand * browFront;

  const plateFront = smoothstep(0.1, 0.6, nz);
  const plateHeight = 1 - smoothstep(0.3, 0.68, Math.abs(ny));
  r -= 0.07 * plateFront * plateHeight;

  const jawMask = smoothstep(0.15, -0.7, ny) * smoothstep(-0.1, 0.5, nz);
  r -= 0.3 * jawMask;

  const sideJaw = smoothstep(0.1, -0.65, ny);
  r -= 0.1 * sideJaw * (1 - jawMask * 0.5);

  const poleMask = smoothstep(-0.35, -0.95, ny);
  r -= 0.2 * poleMask;

  return Math.max(0.35, r);
}

/** Direction-dependent radius multiplier for the shoulder/chest volume: a
 *  defined deltoid bulge near the top, tapering below. */
function shoulderShape(nx: number, ny: number, nz: number): number {
  // Kept gentle relative to the base ellipsoid: a taper that dominates
  // (large magnitude, narrow angular range) fights the ellipsoid's own
  // curvature and reads as a flat-topped box rather than a rounded form —
  // this only needs to add character, not redefine the silhouette.
  let r = 1.0;

  const deltoidBand = gaussian(ny, 0.5, 0.36);
  const sideness = smoothstep(0.1, 0.6, Math.abs(nx));
  r += 0.12 * deltoidBand * sideness;

  const collarTaper = smoothstep(0.45, 1.0, ny);
  r -= 0.22 * collarTaper;

  const waistTaper = smoothstep(-0.45, -0.95, ny);
  r -= 0.1 * waistTaper;

  const chestBulge = gaussian(ny, 0.15, 0.35) * smoothstep(0.05, 0.5, nz);
  r += 0.05 * chestBulge;

  return Math.max(0.4, r);
}

/** Uniform-random point on the unit sphere. */
function randomDirection(): [number, number, number] {
  const u = Math.random() * 2 - 1;
  const theta = Math.random() * Math.PI * 2;
  const s = Math.sqrt(Math.max(0, 1 - u * u));
  return [s * Math.cos(theta), u, s * Math.sin(theta)];
}

/** Radial fraction within [0, 1] for a solid volume: 1 = uniform-by-volume,
 *  >1 biases toward the interior (denser core). */
function radialFraction(centerBias: number): number {
  return Math.pow(Math.random(), centerBias / 3);
}

/** Radial fraction just past the boundary (>= 1), decaying with distance —
 *  the soft, sparse "floating particle" edge instead of a hard cutoff. */
function haloFraction(depth: number): number {
  return 1 + depth * Math.pow(Math.random(), 2.4);
}

export interface FieldBuffers {
  positions: Float32Array;
  part: Float32Array;
  face: Float32Array;
  size: Float32Array;
  brightness: Float32Array;
  random: Float32Array;
  seed: Float32Array;
  edge: Float32Array;
  count: number;
}

function allocate(count: number): FieldBuffers {
  return {
    positions: new Float32Array(count * 3),
    part: new Float32Array(count),
    face: new Float32Array(count),
    size: new Float32Array(count),
    brightness: new Float32Array(count),
    random: new Float32Array(count),
    seed: new Float32Array(count * 3),
    edge: new Float32Array(count),
    count,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function writeParticle(
  buf: FieldBuffers,
  i: number,
  x: number,
  y: number,
  z: number,
  part: number,
  isFace: boolean,
  edgeAmount: number,
  sizeRange: [number, number],
  brightnessRange: [number, number]
): void {
  buf.positions[i * 3] = x;
  buf.positions[i * 3 + 1] = y;
  buf.positions[i * 3 + 2] = z;
  buf.part[i] = part;
  buf.face[i] = isFace ? 1 : 0;
  buf.edge[i] = edgeAmount;

  const rnd = Math.random();
  buf.random[i] = rnd;
  // Edge particles are pushed slightly smaller/dimmer, and the interior
  // still varies, so the volume doesn't look flatly uniform.
  const edgeDim = 1 - Math.min(1, edgeAmount) * 0.55;
  buf.size[i] = lerp(sizeRange[0], sizeRange[1], rnd) * edgeDim;
  buf.brightness[i] = lerp(brightnessRange[0], brightnessRange[1], 1 - rnd * 0.6) * edgeDim;

  buf.seed[i * 3] = Math.random();
  buf.seed[i * 3 + 1] = Math.random();
  buf.seed[i * 3 + 2] = Math.random();
}

function sampleEllipsoidPart(
  buf: FieldBuffers,
  start: number,
  count: number,
  part: number,
  isFace: boolean,
  radii: [number, number, number],
  center: [number, number, number],
  shapeFn: ((nx: number, ny: number, nz: number) => number) | null,
  sizeRange: [number, number],
  brightnessRange: [number, number]
): void {
  const haloCount = Math.floor(count * PARTICLE_FIELD.haloFraction);
  const coreCount = count - haloCount;

  for (let k = 0; k < count; k++) {
    const i = start + k;
    const [nx, ny, nz] = randomDirection();
    const shapeMul = shapeFn ? shapeFn(nx, ny, nz) : 1;
    const isHalo = k >= coreCount;
    const rFrac = isHalo
      ? haloFraction(PARTICLE_FIELD.haloDepth)
      : radialFraction(PARTICLE_FIELD.centerBias);

    const x = center[0] + nx * rFrac * shapeMul * radii[0];
    const y = center[1] + ny * rFrac * shapeMul * radii[1];
    const z = center[2] + nz * rFrac * shapeMul * radii[2];

    writeParticle(buf, i, x, y, z, part, isFace, isHalo ? rFrac : rFrac * 0.6, sizeRange, brightnessRange);
  }
}

function sampleNeck(buf: FieldBuffers, start: number, count: number, height: number): void {
  const { topRadius, bottomRadius } = FIELD.neck;
  const haloCount = Math.floor(count * PARTICLE_FIELD.haloFraction);
  const coreCount = count - haloCount;
  // Extend well past [0, height] at both ends so the cylinder's flat caps
  // bury themselves inside the shoulder/head clouds instead of showing as
  // a visible hard seam where the neck meets them.
  const overlapBottom = height * 0.55;
  const overlapTop = height * 0.7;

  for (let k = 0; k < count; k++) {
    const i = start + k;
    const y = lerp(-overlapBottom, height + overlapTop, Math.random());
    const yClamped = Math.min(height, Math.max(0, y));
    const baseR = lerp(bottomRadius, topRadius, yClamped / height);
    const isHalo = k >= coreCount;
    const rFrac = isHalo
      ? haloFraction(PARTICLE_FIELD.haloDepth)
      : Math.pow(Math.random(), PARTICLE_FIELD.centerBias / 2);
    const angle = Math.random() * Math.PI * 2;
    const r = baseR * rFrac;

    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;

    writeParticle(
      buf,
      i,
      x,
      y,
      z,
      PART.NECK,
      false,
      isHalo ? rFrac : rFrac * 0.6,
      PARTICLE_FIELD.pointSizeRange,
      PARTICLE_FIELD.brightnessRange
    );
  }
}

/**
 * Builds the entire humanoid particle field: head, face, neck and
 * shoulder/chest volumes, each sampled as a dense solid (not a shell) with
 * a soft, sparse halo just past its nominal boundary. Positions are local
 * to each part's own pivot frame (shoulder / neck / head) so the caller
 * can skin them to that part's world matrix every frame.
 */
export function buildHumanoidField(): FieldBuffers {
  const total =
    PARTICLE_FIELD.headCount +
    PARTICLE_FIELD.faceCount +
    PARTICLE_FIELD.neckCount +
    PARTICLE_FIELD.shoulderCount;

  const buf = allocate(total);
  let offset = 0;

  sampleEllipsoidPart(
    buf,
    offset,
    PARTICLE_FIELD.headCount,
    PART.HEAD,
    false,
    FIELD.head.radii,
    FIELD.head.center,
    headShape,
    PARTICLE_FIELD.pointSizeRange,
    PARTICLE_FIELD.brightnessRange
  );
  offset += PARTICLE_FIELD.headCount;

  sampleEllipsoidPart(
    buf,
    offset,
    PARTICLE_FIELD.faceCount,
    PART.HEAD,
    true,
    FIELD.face.radii,
    FIELD.face.center,
    null,
    PARTICLE_FIELD.facePointSizeRange,
    [0.6, 1.0]
  );
  offset += PARTICLE_FIELD.faceCount;

  sampleNeck(buf, offset, PARTICLE_FIELD.neckCount, SKELETON.neckHeight);
  offset += PARTICLE_FIELD.neckCount;

  sampleEllipsoidPart(
    buf,
    offset,
    PARTICLE_FIELD.shoulderCount,
    PART.SHOULDER,
    false,
    FIELD.shoulders.radii,
    FIELD.shoulders.center,
    shoulderShape,
    PARTICLE_FIELD.pointSizeRange,
    PARTICLE_FIELD.brightnessRange
  );
  offset += PARTICLE_FIELD.shoulderCount;

  return buf;
}
