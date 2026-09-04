/**
 * headMesh.js — turns the real head mesh (assets/head-mesh.json: raw
 * vertex positions + triangle indices from realistic_human_head_main.obj,
 * nothing else) into particle *sample data*. The mesh geometry itself is
 * never drawn — no mesh renderer exists in this project at all. This file
 * only decides WHERE on that mesh's surface particles are allowed to
 * exist, exactly the same job humanoidField.js's analytic ellipsoid/
 * relief functions used to do for the head — the anatomical SOURCE
 * changed (a real scanned/sculpted head instead of a hand-authored
 * formula), the particle pipeline downstream of it (writeParticle, the
 * structural/luminous/peripheral layer split, per-part skinning) did not.
 *
 * Sampling is area-weighted over the mesh's triangles (see pickTriangle/
 * sampleTrianglePoint) — NOT uniform-per-vertex — because raw OBJ vertex
 * density follows the source mesh's own retopology/tessellation, not
 * anatomical importance; a naive per-vertex sample would silently
 * over-represent whatever region happened to be triangulated densest.
 */

// Populated once by initHeadMesh() after assets/head-mesh.json loads
// (see sketch.js preload()/setup()). Never rebuilt per-frame or per-quality
// -tier — quality tiers just draw a different SAMPLE COUNT from the same
// underlying mesh, not a different mesh.
const HEAD_MESH = {
  ready: false,
  positions: null, // Float32Array, head-local space (already scaled+offset)
  faces: null, // Uint32Array, 3 indices per triangle
  triCum: null, // Float64Array, cumulative (area * neck-fade weight)
  totalWeight: 0,
  triCount: 0,
  landmarks: null, // [{x,y,z}] in head-local space
  landmarkRadius2: 0,
  maxSalience: 1.8,
};

function headMeshGaussian(distSq, radius2) {
  return Math.exp(-distSq / radius2);
}

/** Sum of Gaussian proximity to every anatomical landmark — the salience
 *  signal used to (a) bias where the SALIENCE population's points land,
 *  and (b) give the STRUCTURAL population's own particles a gentle
 *  brightness/size lift near the same landmarks (see sampleHeadMeshPoints).
 *  Landmarks come from querying the mesh's own vertex data for real local
 *  extrema (see CONFIG.HEAD_MESH.landmarks' comment) — not a formula. */
function headMeshSalience(x, y, z) {
  const L = HEAD_MESH.landmarks;
  const r2 = HEAD_MESH.landmarkRadius2;
  let s = 0;
  for (let i = 0; i < L.length; i++) {
    const dx = x - L[i].x, dy = y - L[i].y, dz = z - L[i].z;
    s += headMeshGaussian(dx * dx + dy * dy + dz * dz, r2);
  }
  return s;
}

/** Builds all derived sampling data from the raw {positions, faces} JSON
 *  (positions/faces are the OBJ's own untransformed vertex data — see
 *  assets/head-mesh.json and CONFIG.HEAD_MESH's transform constants).
 *  Runs once, synchronously, before the first buildHumanoidField() call. */
function initHeadMesh(raw) {
  const HM = CONFIG.HEAD_MESH;
  const rawPos = raw.positions;
  const vertCount = rawPos.length / 3;

  // flipZ is a sign only (a mirror to match this project's +Z-is-front
  // convention), never a magnitude difference from the X/Y scale — see
  // CONFIG.HEAD_MESH's comment.
  const zSign = HM.flipZ ? -1 : 1;
  const positions = new Float32Array(rawPos.length);
  for (let i = 0; i < vertCount; i++) {
    positions[i * 3] = rawPos[i * 3] * HM.scale + HM.offsetX;
    positions[i * 3 + 1] = rawPos[i * 3 + 1] * HM.scale + HM.offsetY;
    positions[i * 3 + 2] = rawPos[i * 3 + 2] * HM.scale * zSign + HM.offsetZ;
  }

  const faces = new Uint32Array(raw.faces);
  const triCount = faces.length / 3;
  const triCum = new Float64Array(triCount);

  let acc = 0;
  const ax = new Float32Array(3), bx = new Float32Array(3), cx = new Float32Array(3);
  for (let t = 0; t < triCount; t++) {
    const ia = faces[t * 3], ib = faces[t * 3 + 1], ic = faces[t * 3 + 2];

    // Mesh-space (pre-transform) average height decides the neck fade —
    // scale/offset are uniform+additive, so this is just the raw y's,
    // no need to invert the transform.
    const rawAvgY = (rawPos[ia * 3 + 1] + rawPos[ib * 3 + 1] + rawPos[ic * 3 + 1]) / 3;
    const fade = smoothstep(HM.fadeLowY, HM.fadeHighY, rawAvgY);

    ax[0] = positions[ia * 3]; ax[1] = positions[ia * 3 + 1]; ax[2] = positions[ia * 3 + 2];
    bx[0] = positions[ib * 3]; bx[1] = positions[ib * 3 + 1]; bx[2] = positions[ib * 3 + 2];
    cx[0] = positions[ic * 3]; cx[1] = positions[ic * 3 + 1]; cx[2] = positions[ic * 3 + 2];
    const e1x = bx[0] - ax[0], e1y = bx[1] - ax[1], e1z = bx[2] - ax[2];
    const e2x = cx[0] - ax[0], e2y = cx[1] - ax[1], e2z = cx[2] - ax[2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const area = 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);

    acc += Math.max(0, area * fade);
    triCum[t] = acc;
  }

  const landmarks = [];
  for (const key in HM.landmarks) {
    const p = HM.landmarks[key];
    landmarks.push({
      x: p[0] * HM.scale + HM.offsetX,
      y: p[1] * HM.scale + HM.offsetY,
      z: p[2] * HM.scale * zSign + HM.offsetZ,
    });
  }

  HEAD_MESH.positions = positions;
  HEAD_MESH.faces = faces;
  HEAD_MESH.triCum = triCum;
  HEAD_MESH.totalWeight = acc;
  HEAD_MESH.triCount = triCount;
  HEAD_MESH.landmarks = landmarks;
  HEAD_MESH.normalSign = HM.flipZ ? -1 : 1;
  HEAD_MESH.landmarkRadius2 = (HM.landmarkRadius * HM.scale) * (HM.landmarkRadius * HM.scale);
  HEAD_MESH.ready = true;
}

/** Binary search for the first triangle whose cumulative weight >= target —
 *  standard inverse-CDF sampling over the per-triangle (area * fade)
 *  distribution built in initHeadMesh(). */
function pickHeadMeshTriangle(rnd) {
  const cum = HEAD_MESH.triCum;
  const target = rnd * HEAD_MESH.totalWeight;
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cum[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const _headMeshSample = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 1 };

/** Uniform random point within one triangle via barycentric coordinates
 *  (the standard "fold the unit square" method), plus that triangle's
 *  face normal (used only for pushing peripheral/aura samples outward —
 *  the normal itself is never a rendered surface). */
function sampleHeadMeshTriangle(tri) {
  const F = HEAD_MESH.faces, P = HEAD_MESH.positions;
  const ia = F[tri * 3], ib = F[tri * 3 + 1], ic = F[tri * 3 + 2];
  const ax = P[ia * 3], ay = P[ia * 3 + 1], az = P[ia * 3 + 2];
  const bx = P[ib * 3], by = P[ib * 3 + 1], bz = P[ib * 3 + 2];
  const cx = P[ic * 3], cy = P[ic * 3 + 1], cz = P[ic * 3 + 2];

  let u = Math.random(), v = Math.random();
  if (u + v > 1) { u = 1 - u; v = 1 - v; }
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;

  _headMeshSample.x = ax + u * e1x + v * e2x;
  _headMeshSample.y = ay + u * e1y + v * e2y;
  _headMeshSample.z = az + u * e1z + v * e2z;

  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  // A single-axis mirror (CONFIG.HEAD_MESH.flipZ) inverts triangle
  // handedness, which flips cross(e1,e2) to point inward instead of
  // outward — negate it back so peripheral/aura samples still push away
  // from the surface, not into it.
  const sign = HEAD_MESH.normalSign;
  _headMeshSample.nx = (nx / len) * sign;
  _headMeshSample.ny = (ny / len) * sign;
  _headMeshSample.nz = (nz / len) * sign;
  return _headMeshSample;
}

/**
 * Fills `count` particles starting at `start` from the head mesh, as one
 * of three explicitly distinct populations (see CONFIG.HEAD_MESH's
 * fraction split in buildHumanoidField):
 *
 *  - 'structural' — direct area-weighted surface samples, the bulk that
 *    carries facial readability. A mild landmark-proximity brightness
 *    lift only (never enough to flip into the luminous layer via
 *    writeParticle's own threshold).
 *  - 'salience'   — importance-sampled toward the landmark set (rejection
 *    sampling on top of the same area-weighted proposal distribution),
 *    then forced into the luminous layer explicitly: this population
 *    exists specifically to be the brighter/larger landmark accent, not
 *    left to chance.
 *  - 'peripheral' — surface samples pushed outward along the local face
 *    normal into a loose shell, tagged with edge >= 1 so writeParticle's
 *    own layer logic routes them into the peripheral/aura population
 *    exactly like the old halo particles did.
 */
function sampleHeadMeshPoints(buf, start, count, mode) {
  const HM = CONFIG.HEAD_MESH;
  const pf = CONFIG.PARTICLE_FIELD;
  const sizeRange = pf.facePointSizeRange;
  const brightRange = pf.faceBrightnessRange;
  const maxSalience = HEAD_MESH.maxSalience;

  for (let k = 0; k < count; k++) {
    const i = start + k;
    let s;

    if (mode === 'salience') {
      let tries = 0;
      let sal = 0;
      do {
        s = sampleHeadMeshTriangle(pickHeadMeshTriangle(Math.random()));
        sal = headMeshSalience(s.x, s.y, s.z);
        tries++;
        if (tries >= 24 || Math.random() * maxSalience <= sal) break;
      } while (true);
    } else {
      s = sampleHeadMeshTriangle(pickHeadMeshTriangle(Math.random()));
    }

    let x = s.x, y = s.y, z = s.z;
    let edgeAmount, featureBoost;

    if (mode === 'peripheral') {
      const push = lerp(HM.auraPush[0], HM.auraPush[1], Math.random());
      x += s.nx * push;
      y += s.ny * push;
      z += s.nz * push;
      edgeAmount = 1 + Math.random() * 0.6;
      featureBoost = 0;
    } else if (mode === 'salience') {
      edgeAmount = Math.random() * 0.3;
      featureBoost = Math.min(1, headMeshSalience(x, y, z) * 0.7);
    } else {
      edgeAmount = Math.random() * 0.4;
      featureBoost = Math.min(1, headMeshSalience(x, y, z) * 0.35);
    }

    writeParticle(buf, i, x, y, z, PART.HEAD, true, edgeAmount, sizeRange, brightRange, featureBoost);
    if (mode === 'salience') buf.layer[i] = LAYER_LUMINOUS;
  }
}
