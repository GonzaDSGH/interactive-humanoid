/**
 * Analytic humanoid volume + particle sampling. No mesh is ever built —
 * these functions only decide WHERE particles are allowed to exist, and
 * how bright/large each one is. Every region below (cranial vault, face
 * plane, neck, clavicles/trapezius, deltoid/thorax) is its own weighted
 * field rather than one broad head mass and one broad torso mass: each
 * has its own shape contribution AND its own density salience, so
 * particles concentrate at anatomical landmarks (brow, orbital rim, nasal
 * bridge, cheekbones, jaw contour, clavicles, deltoid edges) instead of
 * being spread uniformly over solid angle / area and only differing in
 * brightness.
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

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

// ---------------------------------------------------------------------
// HEAD — real anatomical geometry, sampled from a scanned/sculpted human
// head mesh rather than an analytic formula. See headMesh.js: the mesh
// (assets/head-mesh.json) is loaded once, and its surface is turned into
// three explicitly distinct particle populations (structural/salience/
// peripheral, via sampleHeadMeshPoints) that plug into the exact same
// writeParticle -> layer-split -> per-population blend-mode pipeline the
// old procedural head/face used. The mesh itself is never rendered.
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// NECK — elliptical, anatomically directional column: anterior mass with
// a laryngeal bulge, lateral transition, a suggestion of the paired
// sternocleidomastoid (SCM) diagonals running from behind the jaw down
// to the sternal/clavicular base, and a flare into the trapezius mass.
// ---------------------------------------------------------------------

/**
 * How close a sampled (rawAngle, tNorm) point is to either SCM line.
 * rawAngle is the pre-ellipse-scaling circle parameter (0 = pure side,
 * PI/2 = pure front, PI = pure other side — see sampleNeck), tNorm is
 * height fraction (0 = base/sternum, 1 = top/jaw). A real SCM runs from a
 * lateral, slightly-forward attachment near the mastoid (behind the ear,
 * high on the neck) diagonally down to a near-frontal attachment at the
 * sternum/clavicle — i.e. more lateral at the top, more frontal at the
 * base, on both the left and right lateral-front quadrants.
 */
function scmProximity(rawAngle, tNorm) {
  const idealRight = lerp(1.35, 0.42, tNorm);
  const idealLeft = Math.PI - idealRight;
  const diffR = Math.abs(rawAngle - idealRight);
  const diffL = Math.abs(rawAngle - idealLeft);
  const diffMin = Math.min(diffR, diffL);
  return gaussianMask(diffMin, 0, 0.22) * smoothstep(0.03, 0.16, tNorm) * (1 - smoothstep(0.85, 0.98, tNorm));
}

/**
 * The neck as an elliptical (wider left-right than front-back) tapered
 * column with a subtle front throat-flatten, a small anterior laryngeal
 * bulge, paired SCM diagonals, and a flare at its base into the
 * trapezius/clavicle mass — a real neck reads nothing like a circular
 * tube, which is what a uniform-angle cylinder sample would give.
 */
function sampleNeck(buf, start, count, height) {
  const N = CONFIG.FIELD.neck;
  const pf = CONFIG.PARTICLE_FIELD;
  const haloCount = Math.floor(count * pf.haloFraction);
  const coreCount = count - haloCount;
  const overlapBottom = height * 0.5;
  const overlapTop = height * 0.68;
  const maxSalience = 2.3;

  for (let k = 0; k < count; k++) {
    const i = start + k;
    const y = lerp(-overlapBottom, height + overlapTop, Math.random());
    const yClamped = Math.min(height, Math.max(0, y));
    const tNorm = yClamped / height;

    // Importance-sample the angle toward the SCM lines and the base/
    // trapezius transition rather than uniformly around the column.
    let angle = 0;
    let scm = 0;
    let tries = 0;
    do {
      angle = Math.random() * Math.PI * 2;
      const rawAngle = angle < 0 ? angle + Math.PI * 2 : angle;
      scm = scmProximity(rawAngle, tNorm);
      const baseEdge = gaussianMask(tNorm, 0.1, 0.14);
      const weight = 1 + 0.6 * scm + 0.3 * baseEdge;
      tries++;
      if (tries >= 20 || Math.random() * maxSalience <= weight) break;
    } while (true);

    const flare = smoothstep(0.22, 0, tNorm) * 0.35;
    let baseR = lerp(N.bottomRadius, N.topRadius, tNorm) + flare * N.bottomRadius;
    baseR *= 1 + 0.035 * scm;

    const isHalo = k >= coreCount;
    const rFrac = isHalo ? haloFractionSample(pf.haloDepth) : Math.pow(Math.random(), pf.centerBias / 2);

    let ex = Math.cos(angle) * N.widthRatio;
    let ez = Math.sin(angle) * N.depthRatio;
    if (ez > 0) {
      ez -= ez * smoothstep(0.3, 0.9, ez / N.depthRatio) * 0.22;
      // Laryngeal prominence: a small anterior bulge roughly mid-upper
      // neck, right where the throat-flatten would otherwise be flattest.
      const larynx = gaussianMask(tNorm, 0.62, 0.14) * smoothstep(0.55, 0.95, ez / N.depthRatio);
      ez += larynx * 0.09;
    }

    const r = baseR * rFrac;
    const x = ex * r;
    const z = ez * r;

    // Depth cue: frontal mass (throat/larynx side) reads slightly
    // brighter than the lateral/rear mass, plus the SCM lines themselves
    // get a modest brightening as an implicit-shading ridge cue.
    const frontness = clamp01(ez / N.depthRatio);
    const depthCue = (frontness * 2 - 1) * 0.3 + scm * 0.5;

    writeParticle(
      buf, i, x, y, z, PART.NECK, false, isHalo ? rFrac : rFrac * 0.6,
      pf.pointSizeRange, pf.brightnessRange, depthCue
    );
  }
}

// ---------------------------------------------------------------------
// SHOULDERS / UPPER THORAX — clavicular span, sternum, trapezius slope,
// deltoid masses, upper pectoral/thorax volume.
// ---------------------------------------------------------------------
function shoulderShape(nx, ny, nz) {
  let r = 1.0;

  const deltoidBand = gaussianMask(ny, 0.48, 0.32);
  const sideness = smoothstep(0.12, 0.62, Math.abs(nx));
  r += 0.16 * deltoidBand * sideness;

  const collarTaper = smoothstep(0.78, 1.0, ny);
  r -= 0.1 * collarTaper;

  const waistTaper = smoothstep(-0.4, -0.95, ny);
  r -= 0.14 * waistTaper;

  // Upper pectoral / thorax volume, front-facing, center-weighted.
  const chestBulge =
    gaussianMask(ny, 0.18, 0.32) * smoothstep(0.08, 0.5, nz) * (1 - smoothstep(0.5, 0.85, Math.abs(nx)));
  r += 0.075 * chestBulge;

  // Suprasternal / sternum region.
  const sternumMask = gaussianMask(nx, 0, 0.1) * smoothstep(0.15, 0.55, nz) * gaussianMask(ny, 0.05, 0.4);
  r += 0.03 * sternumMask;

  // Trapezius slope — a diagonal ridge from the neck base out toward each
  // shoulder point, rather than a flat collar: real trapezius mass slopes
  // down and outward, it isn't a horizontal shelf.
  const trapDeviation = ny - (0.8 - 0.55 * Math.abs(nx));
  const trapMask =
    gaussianMask(trapDeviation, 0, 0.07) * smoothstep(0.08, 0.32, Math.abs(nx)) * (1 - smoothstep(0.55, 0.85, Math.abs(nx)));
  r += 0.05 * trapMask;

  // Clavicle ridge — sharper and slightly wider than before, the clearest
  // single readable landmark where the neck meets the shoulders.
  const clavicleBand = gaussianMask(ny, 0.8, 0.05) * smoothstep(0.08, 0.5, nz);
  const clavicleSide = smoothstep(0.04, 0.3, Math.abs(nx)) * smoothstep(0.88, 0.42, Math.abs(nx));
  r += 0.08 * clavicleBand * clavicleSide;

  return Math.max(0.4, r);
}

/** Density salience for the shoulder/thorax volume: clavicle line,
 *  deltoid edge (where the shoulder mass rolls over into the arm) and
 *  the trapezius slope get more particles than the smooth chest/back
 *  filler volume. Returned in roughly [1, 2.5]. */
function shoulderSalience(nx, ny, nz) {
  const clavicleBand = gaussianMask(ny, 0.8, 0.06) * smoothstep(0.08, 0.5, nz);
  const deltoidEdge = gaussianMask(Math.abs(nx), 0.58, 0.16);
  const sternum = gaussianMask(nx, 0, 0.12) * smoothstep(0.15, 0.55, nz);
  const trapDeviation = ny - (0.8 - 0.55 * Math.abs(nx));
  const trapEdge = gaussianMask(trapDeviation, 0, 0.09) * smoothstep(0.08, 0.32, Math.abs(nx));
  return 1 + 0.55 * clavicleBand + 0.4 * deltoidEdge + 0.25 * sternum + 0.35 * trapEdge;
}
const SHOULDER_MAX_SALIENCE = 2.6;

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
    layer: new Float32Array(count),
    count,
  };
}

// Humanoid particle population — NOT a single homogeneous cloud. Every
// particle is tagged into one of three visual layers at generation time,
// from signals already being computed anyway (featureBoost, halo edge):
//   0 STRUCTURAL — the bulk. Small, sharp, precise: carries the actual
//     anatomical definition (see particleSystem.js's per-layer size/
//     softness/brightness multipliers).
//   1 LUMINOUS   — a minority subset drawn from strong-landmark particles
//     (high |featureBoost|), rendered larger/brighter/softer-edged for a
//     sparkling "energy" accent concentrated at brow/nose/cheek/jaw/chin/
//     clavicle — not the whole figure.
//   2 PERIPHERAL — the existing halo/edge particles (already sampled with
//     a soft displaced boundary), rendered larger and much softer so the
//     silhouette itself reads as glowing energy rather than a hard edge.
const LAYER_STRUCTURAL = 0;
const LAYER_LUMINOUS = 1;
const LAYER_PERIPHERAL = 2;
const LUMINOUS_FEATURE_THRESHOLD = 0.32;
const LUMINOUS_PICK_PROBABILITY = 0.4;

/** featureBoost (roughly -1..1) biases size/brightness so anatomical
 *  ridges read brighter and larger, and depressions/rear volume read
 *  dimmer/smaller — an implicit shading + depth cue standing in for the
 *  lighting model this unlit additive-blend renderer doesn't have. */
function writeParticle(buf, i, x, y, z, part, isFace, edgeAmount, sizeRange, brightnessRange, featureBoost) {
  buf.positions[i * 3] = x;
  buf.positions[i * 3 + 1] = y;
  buf.positions[i * 3 + 2] = z;
  buf.part[i] = part;
  buf.face[i] = isFace ? 1 : 0;
  buf.edge[i] = edgeAmount;

  // rnd is the mean of two draws (not one) — a tighter, bell-ish spread
  // instead of uniform, so few particles roll near the extremes. Combined
  // with a real (not randomly-gated) featureBoost multiplier, ridges get
  // a *consistent* moderate brightening across all their particles — a
  // soft shading gradient — instead of a handful of lottery-bright
  // outliers that, under sparse sampling, read as a false "connect the
  // dots" line (found and fixed while tuning this).
  const fb = Math.max(-1, Math.min(1, featureBoost || 0));
  const rnd = (Math.random() + Math.random()) * 0.5;
  buf.random[i] = rnd;
  const edgeDim = 1 - Math.min(1, edgeAmount) * 0.55;
  buf.size[i] = lerp(sizeRange[0], sizeRange[1], rnd) * edgeDim * (1 + Math.max(0, fb) * 0.12);
  const baseBrightness = lerp(brightnessRange[0], brightnessRange[1], 1 - rnd * 0.55);
  buf.brightness[i] = Math.min(1.15, baseBrightness * (1 + fb * 0.18)) * edgeDim;

  buf.seed[i * 3] = Math.random();
  buf.seed[i * 3 + 1] = Math.random();
  buf.seed[i * 3 + 2] = Math.random();

  if (edgeAmount >= 1.0) {
    buf.layer[i] = LAYER_PERIPHERAL;
  } else if (Math.abs(fb) >= LUMINOUS_FEATURE_THRESHOLD && Math.random() < LUMINOUS_PICK_PROBABILITY) {
    buf.layer[i] = LAYER_LUMINOUS;
  } else {
    buf.layer[i] = LAYER_STRUCTURAL;
  }
}

/**
 * Samples a body part's volume as a deformed ellipsoid (see headShape/
 * shoulderShape). When salienceFn is given, the sampling direction
 * itself is importance-weighted toward that function's high-salience
 * regions (landmark edges) via rejection sampling, rather than uniform
 * over solid angle — real anatomical density redistribution, not just a
 * brightness cosmetic. Every particle also gets a generic front-vs-back
 * depth cue from nz: frontal/near planes read brighter and slightly
 * larger than rear filler volume.
 */
function sampleEllipsoidPart(buf, start, count, part, isFace, radii, center, shapeFn, sizeRange, brightnessRange, salienceFn, maxSalience) {
  const pf = CONFIG.PARTICLE_FIELD;
  const haloCount = Math.floor(count * pf.haloFraction);
  const coreCount = count - haloCount;

  for (let k = 0; k < count; k++) {
    const i = start + k;
    let nx, ny, nz;
    if (salienceFn) {
      let tries = 0;
      do {
        [nx, ny, nz] = randomDirection();
        const weight = salienceFn(nx, ny, nz);
        tries++;
        if (tries >= 22 || Math.random() * maxSalience <= weight) break;
      } while (true);
    } else {
      [nx, ny, nz] = randomDirection();
    }

    const shapeMul = shapeFn ? shapeFn(nx, ny, nz) : 1;
    const isHalo = k >= coreCount;
    const rFrac = isHalo ? haloFractionSample(pf.haloDepth) : radialFraction(pf.centerBias);

    const x = center[0] + nx * rFrac * shapeMul * radii[0];
    const y = center[1] + ny * rFrac * shapeMul * radii[1];
    const z = center[2] + nz * rFrac * shapeMul * radii[2];

    const depthCue = smoothstep(-0.3, 0.75, nz) * 2 - 1;

    writeParticle(buf, i, x, y, z, part, isFace, isHalo ? rFrac : rFrac * 0.6, sizeRange, brightnessRange, depthCue * 0.4);
  }
}

/**
 * Builds the entire humanoid particle field for a given quality preset's
 * counts. Positions are local to each part's own pivot frame (shoulder /
 * neck / head) so the renderer can skin them to that part's rigid world
 * matrix every frame.
 *
 * The old procedural head+face budget (counts.head + counts.face) is now
 * spent on the real head mesh instead (see headMesh.js), split across its
 * three explicitly distinct populations per CONFIG.HEAD_MESH's fractions —
 * the mesh must already be loaded and initHeadMesh()'d before this runs
 * (see sketch.js preload()/setup()).
 */
function buildHumanoidField(counts) {
  const pf = CONFIG.PARTICLE_FIELD;
  const HM = CONFIG.HEAD_MESH;
  const headBudget = counts.head + counts.face;
  const structCount = Math.round(headBudget * HM.structuralFraction);
  const salienceCount = Math.round(headBudget * HM.salienceFraction);
  const peripheralCount = headBudget - structCount - salienceCount;

  const total = headBudget + counts.neck + counts.shoulder;
  const buf = allocate(total);
  let offset = 0;

  sampleHeadMeshPoints(buf, offset, structCount, 'structural');
  offset += structCount;

  sampleHeadMeshPoints(buf, offset, salienceCount, 'salience');
  offset += salienceCount;

  sampleHeadMeshPoints(buf, offset, peripheralCount, 'peripheral');
  offset += peripheralCount;

  sampleNeck(buf, offset, counts.neck, CONFIG.SKELETON.neckHeight);
  offset += counts.neck;

  sampleEllipsoidPart(
    buf, offset, counts.shoulder, PART.SHOULDER, false,
    CONFIG.FIELD.shoulders.radii, CONFIG.FIELD.shoulders.center, shoulderShape,
    pf.pointSizeRange, pf.brightnessRange, shoulderSalience, SHOULDER_MAX_SALIENCE
  );
  offset += counts.shoulder;

  return splitByLayer(buf);
}

/**
 * Buckets the combined buffer into three genuinely separate buffers, one
 * per visual layer (structural/luminous/peripheral). This is what lets
 * particleSystem.js give each population its own GL blend mode via a
 * separate draw call — additive blending applied to the whole humanoid
 * (including the dense structural bulk) is what let overlapping particles
 * at anatomical landmarks stack straight to saturated white; each
 * population needs its own compositing, not just its own shading.
 */
function splitByLayer(buf) {
  const counts = [0, 0, 0];
  for (let i = 0; i < buf.count; i++) counts[buf.layer[i]]++;

  const buckets = counts.map(allocate);
  const cursors = [0, 0, 0];

  for (let i = 0; i < buf.count; i++) {
    const layer = buf.layer[i];
    const dst = buckets[layer];
    const j = cursors[layer]++;

    dst.positions[j * 3] = buf.positions[i * 3];
    dst.positions[j * 3 + 1] = buf.positions[i * 3 + 1];
    dst.positions[j * 3 + 2] = buf.positions[i * 3 + 2];
    dst.part[j] = buf.part[i];
    dst.face[j] = buf.face[i];
    dst.size[j] = buf.size[i];
    dst.brightness[j] = buf.brightness[i];
    dst.random[j] = buf.random[i];
    dst.seed[j * 3] = buf.seed[i * 3];
    dst.seed[j * 3 + 1] = buf.seed[i * 3 + 1];
    dst.seed[j * 3 + 2] = buf.seed[i * 3 + 2];
    dst.edge[j] = buf.edge[i];
    dst.layer[j] = layer;
  }

  return { structural: buckets[0], luminous: buckets[1], peripheral: buckets[2] };
}

function allocateEnv(count) {
  return {
    positions: new Float32Array(count * 3),
    sizes: new Float32Array(count),
    randoms: new Float32Array(count),
    seeds: new Float32Array(count * 3),
    count,
  };
}

function writeEnvParticle(buf, i, x, y, z, size) {
  buf.positions[i * 3] = x;
  buf.positions[i * 3 + 1] = y;
  buf.positions[i * 3 + 2] = z;
  buf.sizes[i] = size;
  buf.randoms[i] = Math.random();
  buf.seeds[i * 3] = Math.random();
  buf.seeds[i * 3 + 1] = Math.random();
  buf.seeds[i * 3 + 2] = Math.random();
}

/**
 * The environment is four cooperating particle layers (all rendered with
 * the same generic shader in particleSystem.js, parameterized per layer —
 * see ENV_VERT/ENV_FRAG) rather than a single ambient dust cloud:
 *
 *  - far field: a broad, dim, distant population that fills the whole
 *    viewport at depth — the scene no longer goes to flat black once the
 *    humanoid's own silhouette ends.
 *  - fog band: a horizon-like undulating layer low in frame (the
 *    reference pack's blue-fog / wave-field mood), denser near its own
 *    "crest" line, thinning into rising dust above it — built from
 *    layered sine terms for the undulation, not a visible grid.
 *  - aura: a halo immediately around the bust that blends its edges into
 *    the surrounding atmosphere instead of a hard cutoff into black.
 *  - foreground: sparse, large, very soft particles between the camera
 *    and the figure — occasional depth parallax in front of the subject.
 */
function buildFarField(count) {
  const E = CONFIG.ENVIRONMENT.far;
  const buf = allocateEnv(count);
  for (let i = 0; i < count; i++) {
    const x = (Math.random() * 2 - 1) * E.halfWidth;
    const y = (Math.random() * 2 - 1) * E.halfHeight + E.yBias;
    const z = lerp(E.depthNear, E.depthFar, Math.pow(Math.random(), 0.7));
    writeEnvParticle(buf, i, x, y, z, lerp(0.3, 0.95, Math.random()));
  }
  return buf;
}

function buildFogBandField(count) {
  const E = CONFIG.ENVIRONMENT.fog;
  const buf = allocateEnv(count);
  const riserCount = Math.floor(count * 0.22);
  const bandCount = count - riserCount;

  for (let i = 0; i < count; i++) {
    const xNorm = Math.random() * 2 - 1;
    const x = xNorm * E.halfWidth;
    // Layered sine terms stand in for coherent noise here (deterministic,
    // no dependency needed) — a soft horizon undulation, not a hard wave.
    const wave =
      Math.sin(xNorm * 3.1 + 0.7) * 0.5 +
      Math.sin(xNorm * 7.3 + 2.1) * 0.28 +
      Math.sin(xNorm * 13.7 + 4.4) * 0.14;
    const crestY = E.baseY + wave * E.waveAmplitude;

    let y, size;
    if (i < bandCount) {
      // Dense near the undulating crest line itself, biased toward it
      // rather than uniformly filling the band's full thickness.
      const t = Math.pow(Math.random(), 1.8) * (Math.random() < 0.5 ? -1 : 1);
      y = crestY + t * E.thickness;
      size = lerp(0.55, 1.35, Math.random());
    } else {
      // Sparse dust rising off the band into the dark space above it.
      const rise = Math.pow(Math.random(), 1.7) * E.riseHeight;
      y = crestY + E.thickness * 0.4 + rise;
      size = lerp(0.3, 0.75, Math.random());
    }

    const z = lerp(E.depthNear, E.depthFar, Math.random());
    writeEnvParticle(buf, i, x, y, z, size);
  }
  return buf;
}

function buildAuraField(count) {
  const E = CONFIG.ENVIRONMENT.aura;
  const buf = allocateEnv(count);
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(lerp(-0.3, 1, Math.random()));
    const r = E.radius * (0.55 + Math.pow(Math.random(), 1.6) * 0.45);

    const x = Math.sin(phi) * Math.cos(theta) * r + (Math.random() - 0.5) * E.spread;
    const y = Math.cos(phi) * r * 0.62 + E.yBias;
    const z = E.depthBias - Math.abs(Math.sin(phi) * Math.sin(theta)) * r * 0.6;

    writeEnvParticle(buf, i, x, y, z, lerp(0.4, 1.05, Math.random()));
  }
  return buf;
}

function buildForegroundField(count) {
  const E = CONFIG.ENVIRONMENT.foreground;
  const buf = allocateEnv(count);
  for (let i = 0; i < count; i++) {
    const x = (Math.random() * 2 - 1) * E.halfWidth;
    const y = (Math.random() * 2 - 1) * E.halfHeight + E.yBias;
    const z = lerp(E.depthNear, E.depthFar, Math.random());
    writeEnvParticle(buf, i, x, y, z, lerp(0.6, 1.4, Math.random()));
  }
  return buf;
}
