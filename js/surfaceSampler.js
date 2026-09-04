// Area-weighted triangle surface sampling.
// Given a triangle mesh, produces N persistent points scattered across the
// surface with probability proportional to local triangle area (so the
// density of generated particles matches the density of real geometry,
// not just raw vertex count / topology).

function triangleArea(ax, ay, az, bx, by, bz, cx, cy, cz) {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const cx2 = uy * vz - uz * vy;
  const cy2 = uz * vx - ux * vz;
  const cz2 = ux * vy - uy * vx;
  return 0.5 * Math.sqrt(cx2 * cx2 + cy2 * cy2 + cz2 * cz2);
}

/**
 * @param {Float32Array} positions flat xyz
 * @param {Uint32Array} faces flat triangle vertex indices
 * @returns {{cumulative: Float64Array, totalArea: number, faceNormals: Float32Array}}
 */
export function buildAreaDistribution(positions, faces) {
  const triCount = faces.length / 3;
  const cumulative = new Float64Array(triCount);
  const faceNormals = new Float32Array(triCount * 3);
  let acc = 0;

  for (let t = 0; t < triCount; t++) {
    const i0 = faces[t * 3] * 3;
    const i1 = faces[t * 3 + 1] * 3;
    const i2 = faces[t * 3 + 2] * 3;
    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
    const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];

    acc += triangleArea(ax, ay, az, bx, by, bz, cx, cy, cz);
    cumulative[t] = acc;

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    faceNormals[t * 3] = nx;
    faceNormals[t * 3 + 1] = ny;
    faceNormals[t * 3 + 2] = nz;
  }

  return { cumulative, totalArea: acc, faceNormals, triCount };
}

function pickTriangle(cumulative, totalArea) {
  const r = Math.random() * totalArea;
  let lo = 0, hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cumulative[mid] < r) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Sample `targetCount` points across the mesh surface, weighted by area.
 * `keepProbability(x,y,z)` lets the caller reject/feather samples in a
 * region (e.g. fading out the cropped bottom edge) without biasing the
 * remaining distribution.
 *
 * @returns {{positions: Float32Array, normals: Float32Array, count: number}}
 */
export function sampleSurface(mesh, targetCount, keepProbability) {
  const { positions, faces } = mesh;
  const { cumulative, totalArea, faceNormals } = buildAreaDistribution(positions, faces);

  const outPos = new Float32Array(targetCount * 3);
  const outNrm = new Float32Array(targetCount * 3);
  let count = 0;
  let guard = 0;
  const maxGuard = targetCount * 40; // safety valve if keepProbability rejects almost everything

  while (count < targetCount && guard < maxGuard) {
    guard++;
    const t = pickTriangle(cumulative, totalArea);
    const i0 = faces[t * 3] * 3;
    const i1 = faces[t * 3 + 1] * 3;
    const i2 = faces[t * 3 + 2] * 3;

    let r1 = Math.random();
    let r2 = Math.random();
    if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
    const r0 = 1 - r1 - r2;

    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
    const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];

    const x = r0 * ax + r1 * bx + r2 * cx;
    const y = r0 * ay + r1 * by + r2 * cy;
    const z = r0 * az + r1 * bz + r2 * cz;

    if (keepProbability) {
      const p = keepProbability(x, y, z);
      if (p <= 0 || Math.random() > p) continue;
    }

    outPos[count * 3] = x;
    outPos[count * 3 + 1] = y;
    outPos[count * 3 + 2] = z;
    outNrm[count * 3] = faceNormals[t * 3];
    outNrm[count * 3 + 1] = faceNormals[t * 3 + 1];
    outNrm[count * 3 + 2] = faceNormals[t * 3 + 2];
    count++;
  }

  return { positions: outPos, normals: outNrm, count };
}
