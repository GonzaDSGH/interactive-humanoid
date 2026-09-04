import * as THREE from 'three';

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function gaussian(x: number, center: number, width: number): number {
  const d = (x - center) / width;
  return Math.exp(-d * d);
}

/**
 * Radius multiplier for a unit-sphere vertex (nx,ny,nz), sculpting a
 * stylized robotic humanoid skull out of an icosahedron: a broad cranium,
 * flared temples, a brow ridge, a flattened/recessed face plate (a socket
 * for the energy core to sit inside rather than float in front of), and a
 * tapered jaw. Because this is a pure radial displacement (it only scales
 * each vertex along its own direction from the origin), the result is
 * always a valid closed manifold — it cannot self-intersect.
 */
export function sculptHeadRadius(nx: number, ny: number, nz: number): number {
  let r = 1.0;

  // Crown: flattened rather than fully domed — a deliberate plate, not a
  // rounded ball — with the cranium bulging out toward the back.
  const crownFlatten = smoothstep(0.68, 0.97, ny);
  r -= 0.12 * crownFlatten;

  const craniumHeight = smoothstep(-0.05, 0.5, ny) * (1 - smoothstep(0.72, 0.97, ny));
  const craniumBack = smoothstep(0.25, -0.6, nz);
  r += 0.13 * craniumHeight * craniumBack;

  // Temple flare: the head's widest point, at the sides just above
  // center — a defined ridge, not a soft bump.
  const templeBand = gaussian(ny, 0.08, 0.26);
  const sideness = smoothstep(0.22, 0.6, Math.abs(nx));
  r += 0.1 * templeBand * sideness;

  // Brow ridge: a pronounced horizontal bulge, front-facing, above center.
  const browBand = gaussian(ny, 0.16, 0.05);
  const browFront = smoothstep(0.05, 0.5, nz);
  r += 0.075 * browBand * browFront;

  // Face plate: a shallow, gentle recess across the central front —
  // a socket the energy core sits inside instead of floating on top.
  const plateFront = smoothstep(0.1, 0.58, nz);
  const plateHeight = 1 - smoothstep(0.28, 0.62, Math.abs(ny - 0.02));
  r -= 0.09 * plateFront * plateHeight;

  // Cheek plateau: keeps the profile fuller through the cheek line so the
  // head doesn't narrow immediately below the temples (avoids a
  // "mushroom cap" silhouette) before the jaw actually tapers in.
  const cheekPlateau = gaussian(ny, -0.18, 0.22);
  const cheekSide = smoothstep(0.16, 0.4, Math.abs(nx));
  r += 0.05 * cheekPlateau * cheekSide;

  // Jaw taper: narrows gradually toward the chin on the front half — a
  // readable mandible line, without pinching in right below the temples.
  const jawMask = smoothstep(-0.08, -0.62, ny) * smoothstep(-0.1, 0.5, nz);
  r -= 0.3 * jawMask;

  // Jawline edge: a slightly harder transition at the jaw's lower border
  // to read as a mechanical plate edge rather than soft organic tissue.
  const jawEdge = gaussian(ny, -0.44, 0.06) * smoothstep(-0.1, 0.5, nz);
  r -= 0.04 * jawEdge;

  // Side jaw taper (narrows the profile from directly in front too, not
  // only front-on, so the yaw-rotated silhouette reads as tapered).
  const sideJaw = smoothstep(-0.12, -0.58, ny);
  r -= 0.075 * sideJaw * (1 - jawMask * 0.5);

  // Chin / neck hand-off: pull the pole in tight so the head tapers down
  // to roughly the neck's radius rather than a wide flat bottom.
  const poleMask = smoothstep(-0.5, -0.98, ny);
  r -= 0.32 * poleMask;

  return Math.max(0.28, r);
}

/** Builds a smooth, radially-displaced icosahedron. Because the displacement
 *  only scales each vertex along its own ray from the origin, the result
 *  is always a valid closed manifold — it cannot self-intersect. */
export function buildDisplacedIcosahedron(
  radius: number,
  detail: number,
  radiusFn: (nx: number, ny: number, nz: number) => number
): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(radius, detail);
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const inv = 1 / radius;
    const mul = radiusFn(v.x * inv, v.y * inv, v.z * inv);
    v.multiplyScalar(mul);
    pos.setXYZ(i, v.x, v.y, v.z);
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}
