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
 * Direction-dependent radius multiplier for the SKULL volume only — the
 * face's own landmarks (brow, eyes, nose, cheekbones, mouth, chin) are no
 * longer sculpted here. They live in faceRelief() below as a proper
 * displacement field, because a spherical radius multiplier averaged over
 * solid angle cannot place a feature precisely enough to read as a face;
 * it can only ever read as a lumpy ball. This function's only job is the
 * skull silhouette: a rounder, fuller back/crown, defined temples, and —
 * critically — a flattened, RECESSED front face-plane that gets out of the
 * way so faceRelief's own protrusions (the nose especially) are what the
 * viewer sees, not a doubled-up mass of skull-plus-face.
 */
function headShape(nx, ny, nz) {
  let r = 1.0;

  const crownFlatten = smoothstep(0.6, 1.0, ny);
  r -= 0.16 * crownFlatten;

  // Occipital bulge — the back of the skull stays fuller/rounder than the
  // front, which is what makes the head read as front-to-back asymmetric
  // (a real head) instead of a uniform ball.
  const craniumHeight = smoothstep(-0.05, 0.5, ny) * (1 - smoothstep(0.7, 0.98, ny));
  const craniumBack = smoothstep(0.15, -0.7, nz);
  r += 0.24 * craniumHeight * craniumBack;

  const templeBand = gaussianMask(ny, 0.02, 0.24);
  const sideness = smoothstep(0.2, 0.65, Math.abs(nx));
  r += 0.15 * templeBand * sideness;

  // Recess the front face-plane a little below the skull's natural radius
  // — the "canvas" faceRelief paints onto. Kept modest: too deep a cut
  // hollows out the whole front of the skull (barely any skull particles
  // land in the visible front silhouette, reading as sparse/empty) rather
  // than just making room for the nose/brow/chin to read as protruding
  // above a still-solid base.
  const facePlaneFront = smoothstep(0.12, 0.55, nz);
  const facePlaneHeight = 1 - smoothstep(0.15, 0.75, Math.abs(ny - 0.0));
  r -= 0.13 * facePlaneFront * facePlaneHeight;

  const jawMask = smoothstep(0.2, -0.78, ny) * smoothstep(-0.15, 0.5, nz);
  r -= 0.32 * jawMask;

  const sideJaw = smoothstep(0.12, -0.7, ny);
  r -= 0.12 * sideJaw * (1 - jawMask * 0.5);

  const poleMask = smoothstep(-0.4, -0.98, ny);
  r -= 0.22 * poleMask;

  return Math.max(0.32, r);
}

/**
 * Face silhouette taper as seen from the front: cheek-width up top,
 * narrowing steadily into the jaw and chin. This alone (before any relief
 * is added) is what keeps the face patch from reading as an oval blob.
 * v: 1 = forehead top, -1 = chin bottom.
 */
function faceWidthLimit(v) {
  if (v > 0.2) return lerp(0.86, 1.0, smoothstep(0.2, 0.85, v));
  const t = smoothstep(0.2, -0.92, v);
  return lerp(1.0, 0.34, t);
}

/**
 * The face's actual anatomy: a proper displacement field over (u, v) face-
 * plane coordinates, not a radius multiplier. Every landmark — brow ridge,
 * eye sockets, nose bridge/tip, cheekbones, philtrum, mouth-plane, chin —
 * is placed at an explicit (u, v) location with an explicit sign (additive
 * protrusion or subtractive depression), which is the only way to get
 * precise, recognizably-human placement out of a particle scatter.
 *
 * Returns { z: forward displacement (face-local units), feature: signed
 * "how strong a landmark is this point on" used to bias brightness/size so
 * ridges read brighter and sockets read dimmer — an implicit shading cue,
 * since the renderer itself has no lighting model.
 */
function faceRelief(u, v) {
  let z = 0;
  let feature = 0;

  const dome = Math.sqrt(Math.max(0, 1 - u * u * 0.85 - v * v * 0.3));
  z += 0.5 * dome;

  const foreheadMask = gaussianMask(v, 0.58, 0.3);
  z += 0.035 * foreheadMask;

  // Two separate brow bumps (one per eye) rather than one bar spanning the
  // full width — a continuous bar reads as a single hard line once
  // sparsely sampled; two softer, localized bumps read as "brow ridge
  // above each eye" instead, and integrate better with the eye sockets
  // directly beneath them.
  const browL = gaussianMask(u, -0.32, 0.19) * gaussianMask(v, 0.24, 0.08);
  const browR = gaussianMask(u, 0.32, 0.19) * gaussianMask(v, 0.24, 0.08);
  const browMask = browL + browR;
  z += 0.055 * browMask;
  feature += 0.3 * browMask;

  const eyeL = gaussianMask(u, -0.36, 0.15) * gaussianMask(v, 0.12, 0.1);
  const eyeR = gaussianMask(u, 0.36, 0.15) * gaussianMask(v, 0.12, 0.1);
  const eyeMask = eyeL + eyeR;
  z -= 0.19 * eyeMask;
  feature -= 0.75 * eyeMask;

  // gaussianMask(u, 0, width) is exactly 1 whenever u===0 REGARDLESS of
  // width — width only controls how fast it falls off away from center.
  // That means noseRun alone controls the ridge's vertical extent; it must
  // stay tightly confined to the actual bridge-to-tip span (roughly
  // "between/just under the eyes" down to "the tip"), or the ridge reads
  // as a seam running the full face height instead of a nose.
  const noseWidth = lerp(0.04, 0.1, smoothstep(0.06, -0.14, v));
  const noseRun = smoothstep(-0.52, -0.32, v) * (1 - smoothstep(0.02, 0.17, v));
  const noseMask = gaussianMask(u, 0, noseWidth) * noseRun;
  const noseTip = gaussianMask(v, -0.08, 0.075);
  z += 0.24 * noseMask * (0.5 + 0.85 * noseTip);
  feature += 0.9 * noseMask * (0.35 + noseTip);

  const cheekL = gaussianMask(u, -0.44, 0.16) * gaussianMask(v, -0.07, 0.17);
  const cheekR = gaussianMask(u, 0.44, 0.16) * gaussianMask(v, -0.07, 0.17);
  const cheekMask = cheekL + cheekR;
  z += 0.095 * cheekMask;
  feature += 0.4 * cheekMask;

  const philtrum = gaussianMask(u, 0, 0.04) * gaussianMask(v, -0.29, 0.07);
  z -= 0.028 * philtrum;

  const mouthMask = gaussianMask(v, -0.4, 0.065) * (1 - smoothstep(0.24, 0.42, Math.abs(u)));
  z += 0.026 * mouthMask;
  feature += 0.22 * mouthMask;

  const chinMask = gaussianMask(v, -0.74, 0.13) * (1 - smoothstep(0.2, 0.4, Math.abs(u)));
  z += 0.095 * chinMask;
  feature += 0.45 * chinMask;

  return { z, feature };
}

/** Direction-dependent radius multiplier for the shoulder/chest/clavicle
 *  volume: a defined deltoid bulge, a subtle sternum ridge, and a sharper
 *  clavicle line — the strongest single readable landmark where the neck
 *  meets the shoulders. */
function shoulderShape(nx, ny, nz) {
  let r = 1.0;

  const deltoidBand = gaussianMask(ny, 0.48, 0.32);
  const sideness = smoothstep(0.12, 0.62, Math.abs(nx));
  r += 0.16 * deltoidBand * sideness;

  const collarTaper = smoothstep(0.78, 1.0, ny);
  r -= 0.1 * collarTaper;

  const waistTaper = smoothstep(-0.4, -0.95, ny);
  r -= 0.14 * waistTaper;

  const chestBulge =
    gaussianMask(ny, 0.18, 0.32) * smoothstep(0.08, 0.5, nz) * (1 - smoothstep(0.5, 0.85, Math.abs(nx)));
  r += 0.075 * chestBulge;

  const sternumMask = gaussianMask(nx, 0, 0.1) * smoothstep(0.15, 0.55, nz) * gaussianMask(ny, 0.05, 0.4);
  r += 0.03 * sternumMask;

  const clavicleBand = gaussianMask(ny, 0.8, 0.05) * smoothstep(0.08, 0.5, nz);
  const clavicleSide = smoothstep(0.04, 0.3, Math.abs(nx)) * smoothstep(0.88, 0.42, Math.abs(nx));
  r += 0.08 * clavicleBand * clavicleSide;

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

/** featureBoost (-1..1ish, default 0) biases size/brightness so anatomical
 *  ridges (brow/nose/cheek/chin) read brighter and larger, and depressions
 *  (eye sockets) read dimmer/smaller — an implicit shading cue standing in
 *  for the lighting model this unlit additive-blend renderer doesn't have. */
function writeParticle(buf, i, x, y, z, part, isFace, edgeAmount, sizeRange, brightnessRange, featureBoost) {
  buf.positions[i * 3] = x;
  buf.positions[i * 3 + 1] = y;
  buf.positions[i * 3 + 2] = z;
  buf.part[i] = part;
  buf.face[i] = isFace ? 1 : 0;
  buf.edge[i] = edgeAmount;

  // rnd is the mean of two draws (not one) — a tighter, bell-ish spread
  // instead of uniform, so few particles roll near the extremes. Combined
  // with a real (not randomly-gated) featureBoost multiplier, ridges get a
  // *consistent* moderate brightening across all their particles — a soft
  // shading gradient — instead of a handful of lottery-bright outliers
  // that, under sparse sampling, read as a false "connect the dots" line.
  const fb = Math.max(-1, Math.min(1, featureBoost || 0));
  const rnd = (Math.random() + Math.random()) * 0.5;
  buf.random[i] = rnd;
  const edgeDim = 1 - Math.min(1, edgeAmount) * 0.55;
  buf.size[i] = lerp(sizeRange[0], sizeRange[1], rnd) * edgeDim;
  const baseBrightness = lerp(brightnessRange[0], brightnessRange[1], 1 - rnd * 0.55);
  buf.brightness[i] = Math.min(1.15, baseBrightness * (1 + fb * 0.16)) * edgeDim;

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

    writeParticle(buf, i, x, y, z, part, isFace, isHalo ? rFrac : rFrac * 0.6, sizeRange, brightnessRange, 0);
  }
}

/**
 * Samples the face as a proper displacement-mapped relief (see
 * faceRelief/faceWidthLimit above) instead of a flat oval patch. (u, v)
 * are drawn uniformly inside the tapered silhouette via rejection — cheap,
 * since the taper only trims the corners of the square.
 */
/**
 * Sampled in mirrored (u, -u) pairs rather than independently at random:
 * a real face reads as symmetric, and independent left/right random draws
 * — even from the same distribution — reliably produce a visibly lopsided
 * result (confirmed while tuning this: identical settings, two different
 * random seeds, two noticeably different-looking faces). One (u>=0, v)
 * sample and its relief are computed once per pair and placed at both
 * +u and -u; only the per-particle sparkle (size/brightness/seed) is
 * still independently randomized per side, so it stays organic rather
 * than perfectly identical either side.
 */
function sampleFace(buf, start, count, field) {
  const pf = CONFIG.PARTICLE_FIELD;
  const haloCount = Math.floor(count * pf.haloFraction);
  const coreCount = count - haloCount;
  const pairCount = Math.ceil(count / 2);

  for (let p = 0; p < pairCount; p++) {
    const k0 = p * 2;
    const k1 = k0 + 1;

    let uAbs = 0;
    let v = 0;
    let wLimit = 1;
    let tries = 0;
    do {
      uAbs = Math.random();
      v = Math.random() * 2 - 1;
      wLimit = faceWidthLimit(v);
      tries++;
    } while (tries < 40 && (uAbs > wLimit || v * v * 1.05 + uAbs * uAbs * 0.4 > 1.08));

    const { z: reliefZ, feature } = faceRelief(uAbs, v);
    const y = field.center[1] + v * field.height;
    const edgeBase = (uAbs / Math.max(0.001, wLimit)) * 0.5;

    for (let side = 0; side < 2; side++) {
      const k = side === 0 ? k0 : k1;
      if (k >= count) break;
      const isHalo = k >= coreCount;
      const haloPush = isHalo ? haloFractionSample(pf.haloDepth) - 1 : 0;
      const signedU = side === 0 ? uAbs : -uAbs;

      const x = field.center[0] + signedU * field.width;
      const z = field.center[2] + reliefZ * field.reliefScale + haloPush * 0.12;
      const edgeAmount = isHalo ? 1 + haloPush : edgeBase;

      writeParticle(
        buf, start + k, x, y, z, PART.HEAD, true, edgeAmount,
        pf.facePointSizeRange, pf.faceBrightnessRange, feature
      );
    }
  }
}

/**
 * The neck as an elliptical (wider left-right than front-back) tapered
 * column with a subtle front throat-flatten and a flare at its base into
 * the trapezius/clavicle mass — a real neck reads nothing like a circular
 * tube, which is what a uniform-angle cylinder sample would give.
 */
function sampleNeck(buf, start, count, height) {
  const N = CONFIG.FIELD.neck;
  const pf = CONFIG.PARTICLE_FIELD;
  const haloCount = Math.floor(count * pf.haloFraction);
  const coreCount = count - haloCount;
  const overlapBottom = height * 0.5;
  const overlapTop = height * 0.68;

  for (let k = 0; k < count; k++) {
    const i = start + k;
    const y = lerp(-overlapBottom, height + overlapTop, Math.random());
    const yClamped = Math.min(height, Math.max(0, y));
    const tNorm = yClamped / height;

    const flare = smoothstep(0.22, 0, tNorm) * 0.35;
    const baseR = lerp(N.bottomRadius, N.topRadius, tNorm) + flare * N.bottomRadius;

    const isHalo = k >= coreCount;
    const rFrac = isHalo ? haloFractionSample(pf.haloDepth) : Math.pow(Math.random(), pf.centerBias / 2);
    const angle = Math.random() * Math.PI * 2;

    let ex = Math.cos(angle) * N.widthRatio;
    let ez = Math.sin(angle) * N.depthRatio;
    if (ez > 0) {
      ez -= ez * smoothstep(0.3, 0.9, ez / N.depthRatio) * 0.22;
    }

    const r = baseR * rFrac;
    const x = ex * r;
    const z = ez * r;

    writeParticle(buf, i, x, y, z, PART.NECK, false, isHalo ? rFrac : rFrac * 0.6, pf.pointSizeRange, pf.brightnessRange, 0);
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

  sampleFace(buf, offset, counts.face, CONFIG.FIELD.face);
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
