/**
 * Analytic humanoid volume + particle sampling. No mesh is ever built —
 * these functions only decide WHERE particles are allowed to exist. Every
 * body part is sampled as a dense solid (uniform-ish through the interior,
 * not a thin shell) with a soft, sparse halo just past its boundary, so
 * the figure reads as volumetric digital matter with a fuzzy edge rather
 * than a crisp geometric cutout.
 */

const PART = { SHOULDER: 0, NECK: 1, HEAD: 2 };

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function gaussianMask(x, center, width) {
  const d = (x - center) / width;
  return Math.exp(-d * d);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Direction-dependent radius multiplier for the head volume: a broad
 * cranium, flared temples, a subtle brow, a flattened front face-plane,
 * cheekbone structure and a tapered jaw — real anatomical landmarks, but
 * ones that only ever shape where particles are allowed to exist.
 *
 * Additive bumps (cranium/temple/brow) read as natural protrusions even
 * at fairly high magnitude. Subtractive tapers do NOT: a strong reduction
 * over a narrow angular range fights the base ellipsoid's own curvature
 * and reads as a flat cut / box edge rather than a rounded taper — so
 * those stay gentler and spread over a wider angular range.
 */
function headShape(nx, ny, nz) {
  let r = 1.0;

  const crownFlatten = smoothstep(0.55, 1.0, ny);
  r -= 0.14 * crownFlatten;

  const craniumHeight = smoothstep(-0.05, 0.5, ny) * (1 - smoothstep(0.7, 0.98, ny));
  const craniumBack = smoothstep(0.2, -0.65, nz);
  r += 0.2 * craniumHeight * craniumBack;

  const templeBand = gaussianMask(ny, 0.06, 0.28);
  const sideness = smoothstep(0.15, 0.6, Math.abs(nx));
  r += 0.16 * templeBand * sideness;

  const browBand = gaussianMask(ny, 0.15, 0.05);
  const browFront = smoothstep(0.05, 0.5, nz);
  r += 0.06 * browBand * browFront;

  const plateFront = smoothstep(0.1, 0.6, nz);
  const plateHeight = 1 - smoothstep(0.3, 0.68, Math.abs(ny));
  r -= 0.07 * plateFront * plateHeight;

  const cheekBand = gaussianMask(ny, -0.08, 0.16);
  const cheekSide = smoothstep(0.18, 0.4, Math.abs(nx)) * smoothstep(0.75, 0.25, Math.abs(nx));
  const cheekFront = smoothstep(0.1, 0.5, nz);
  r += 0.045 * cheekBand * cheekSide * cheekFront;

  const jawMask = smoothstep(0.15, -0.7, ny) * smoothstep(-0.1, 0.5, nz);
  r -= 0.3 * jawMask;

  const sideJaw = smoothstep(0.1, -0.65, ny);
  r -= 0.1 * sideJaw * (1 - jawMask * 0.5);

  const poleMask = smoothstep(-0.35, -0.95, ny);
  r -= 0.2 * poleMask;

  return Math.max(0.35, r);
}

/** Direction-dependent radius multiplier for the shoulder/chest/clavicle
 *  volume: a defined deltoid bulge, tapering gently toward the collar and
 *  waist. Kept gentle relative to the base ellipsoid for the same reason
 *  as headShape's tapers. */
function shoulderShape(nx, ny, nz) {
  let r = 1.0;

  const deltoidBand = gaussianMask(ny, 0.5, 0.36);
  const sideness = smoothstep(0.1, 0.6, Math.abs(nx));
  r += 0.12 * deltoidBand * sideness;

  // Gentle collar taper only very near the pole — the neck cylinder needs
  // the shoulder cloud to stay full almost all the way to the top so the
  // two blend into one continuous mass instead of leaving a visible gap.
  const collarTaper = smoothstep(0.75, 1.0, ny);
  r -= 0.1 * collarTaper;

  const waistTaper = smoothstep(-0.45, -0.95, ny);
  r -= 0.1 * waistTaper;

  const chestBulge = gaussianMask(ny, 0.15, 0.35) * smoothstep(0.05, 0.5, nz);
  r += 0.05 * chestBulge;

  // Clavicle ridge — a thin bright line where neck meets shoulder, front-facing.
  const clavicleBand = gaussianMask(ny, 0.82, 0.06) * smoothstep(0.1, 0.55, nz);
  const clavicleSide = smoothstep(0.05, 0.35, Math.abs(nx)) * smoothstep(0.85, 0.4, Math.abs(nx));
  r += 0.06 * clavicleBand * clavicleSide;

  return Math.max(0.4, r);
}

function randomDirection() {
  const u = Math.random() * 2 - 1;
  const theta = Math.random() * Math.PI * 2;
  const s = Math.sqrt(Math.max(0, 1 - u * u));
  return [s * Math.cos(theta), u, s * Math.sin(theta)];
}

function radialFraction(centerBias) {
  return Math.pow(Math.random(), centerBias / 3);
}

function haloFractionSample(depth) {
  return 1 + depth * Math.pow(Math.random(), 2.4);
}

function allocate(count) {
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

function writeParticle(buf, i, x, y, z, part, isFace, edgeAmount, sizeRange, brightnessRange) {
  buf.positions[i * 3] = x;
  buf.positions[i * 3 + 1] = y;
  buf.positions[i * 3 + 2] = z;
  buf.part[i] = part;
  buf.face[i] = isFace ? 1 : 0;
  buf.edge[i] = edgeAmount;

  const rnd = Math.random();
  buf.random[i] = rnd;
  const edgeDim = 1 - Math.min(1, edgeAmount) * 0.55;
  buf.size[i] = lerp(sizeRange[0], sizeRange[1], rnd) * edgeDim;
  buf.brightness[i] = lerp(brightnessRange[0], brightnessRange[1], 1 - rnd * 0.6) * edgeDim;

  buf.seed[i * 3] = Math.random();
  buf.seed[i * 3 + 1] = Math.random();
  buf.seed[i * 3 + 2] = Math.random();
}

function sampleEllipsoidPart(buf, start, count, part, isFace, radii, center, shapeFn, sizeRange, brightnessRange) {
  const pf = CONFIG.PARTICLE_FIELD;
  const haloCount = Math.floor(count * pf.haloFraction);
  const coreCount = count - haloCount;

  for (let k = 0; k < count; k++) {
    const i = start + k;
    const [nx, ny, nz] = randomDirection();
    const shapeMul = shapeFn ? shapeFn(nx, ny, nz) : 1;
    const isHalo = k >= coreCount;
    const rFrac = isHalo ? haloFractionSample(pf.haloDepth) : radialFraction(pf.centerBias);

    const x = center[0] + nx * rFrac * shapeMul * radii[0];
    const y = center[1] + ny * rFrac * shapeMul * radii[1];
    const z = center[2] + nz * rFrac * shapeMul * radii[2];

    writeParticle(buf, i, x, y, z, part, isFace, isHalo ? rFrac : rFrac * 0.6, sizeRange, brightnessRange);
  }
}

function sampleNeck(buf, start, count, height) {
  const { topRadius, bottomRadius } = CONFIG.FIELD.neck;
  const pf = CONFIG.PARTICLE_FIELD;
  const haloCount = Math.floor(count * pf.haloFraction);
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
    const rFrac = isHalo ? haloFractionSample(pf.haloDepth) : Math.pow(Math.random(), pf.centerBias / 2);
    const angle = Math.random() * Math.PI * 2;
    const r = baseR * rFrac;

    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;

    writeParticle(buf, i, x, y, z, PART.NECK, false, isHalo ? rFrac : rFrac * 0.6, pf.pointSizeRange, pf.brightnessRange);
  }
}

/**
 * Builds the entire humanoid particle field for a given quality preset's
 * counts. Positions are local to each part's own pivot frame (shoulder /
 * neck / head) so the renderer can skin them to that part's rigid world
 * matrix every frame.
 */
function buildHumanoidField(counts) {
  const pf = CONFIG.PARTICLE_FIELD;
  const total = counts.head + counts.face + counts.neck + counts.shoulder;
  const buf = allocate(total);
  let offset = 0;

  sampleEllipsoidPart(
    buf, offset, counts.head, PART.HEAD, false,
    CONFIG.FIELD.head.radii, CONFIG.FIELD.head.center, headShape,
    pf.pointSizeRange, pf.brightnessRange
  );
  offset += counts.head;

  sampleEllipsoidPart(
    buf, offset, counts.face, PART.HEAD, true,
    CONFIG.FIELD.face.radii, CONFIG.FIELD.face.center, null,
    pf.facePointSizeRange, [0.6, 1.0]
  );
  offset += counts.face;

  sampleNeck(buf, offset, counts.neck, CONFIG.SKELETON.neckHeight);
  offset += counts.neck;

  sampleEllipsoidPart(
    buf, offset, counts.shoulder, PART.SHOULDER, false,
    CONFIG.FIELD.shoulders.radii, CONFIG.FIELD.shoulders.center, shoulderShape,
    pf.pointSizeRange, pf.brightnessRange
  );
  offset += counts.shoulder;

  return buf;
}

/** Sparse ambient environment dust — independent of the humanoid rig,
 *  static positions (drift happens on the GPU), restrained brightness. */
function buildAmbientField(count) {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const randoms = new Float32Array(count);
  const seeds = new Float32Array(count * 3);
  const A = CONFIG.AMBIENT;

  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(lerp(-0.3, 1, Math.random()));
    const r = A.radius * (0.55 + Math.pow(Math.random(), 1.6) * 0.45);

    // Kept entirely behind the humanoid (negative z, always farther from
    // the camera than the figure) so it never blows up into oversized
    // near-camera points — this is restrained atmospheric haze, not a
    // second mass competing with the humanoid silhouette.
    positions[i * 3] = Math.sin(phi) * Math.cos(theta) * r + (Math.random() - 0.5) * A.spread;
    positions[i * 3 + 1] = Math.cos(phi) * r * 0.6 + 0.3;
    positions[i * 3 + 2] = -2.2 - Math.abs(Math.sin(phi) * Math.sin(theta)) * r * 0.6;

    sizes[i] = lerp(0.4, 1.0, Math.random());
    randoms[i] = Math.random();
    seeds[i * 3] = Math.random();
    seeds[i * 3 + 1] = Math.random();
    seeds[i * 3 + 2] = Math.random();
  }

  return { positions, sizes, randoms, seeds, count };
}
