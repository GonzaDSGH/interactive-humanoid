import * as THREE from 'three';
import { HUMANOID } from '../config';
import { buildDisplacedIcosahedron, sculptHeadRadius } from '../utils/sculpt';

/** Samples a smooth spline through control points so lathe profiles never look faceted. */
function sampleProfile(points: [number, number][], samples: number): THREE.Vector2[] {
  const curve = new THREE.SplineCurve(points.map(([x, y]) => new THREE.Vector2(x, y)));
  return curve.getPoints(samples);
}

/** Head-local Y (0 = neck attachment) for a given unit-sphere latitude
 *  `ny`, matching the scale/translate baked into `buildHeadGeometry`. */
export function headSculptY(ny: number): number {
  return (ny + HUMANOID.headTranslateFactor) * HUMANOID.headRadius * HUMANOID.headHeightScale;
}

/**
 * Robotic humanoid skull, sculpted via radial displacement of a
 * subdivided icosahedron: a broad cranium, flared temples, a brow ridge,
 * a recessed front face-plate (a socket for the energy core), cheek
 * structure and a tapered jaw. Because every vertex only moves along its
 * own ray from the origin, the surface can never self-intersect — and
 * because it isn't a surface of revolution, the silhouette genuinely
 * changes as the head yaws, unlike a lathed profile.
 */
export function buildHeadGeometry(): THREE.BufferGeometry {
  const R = HUMANOID.headRadius;
  const geometry = buildDisplacedIcosahedron(R, 5, sculptHeadRadius);
  geometry.scale(1, HUMANOID.headHeightScale, HUMANOID.headDepthScale);
  geometry.translate(0, HUMANOID.headTranslateFactor * R * HUMANOID.headHeightScale, 0);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Wide, structured torso/shoulder volume: a defined deltoid bulge at the
 * shoulders (not a smooth monotonic taper), a distinct collar step where
 * it hands off to the neck, and a broad, strong chest silhouette.
 */
export function buildTorsoGeometry(): THREE.BufferGeometry {
  const Rt = HUMANOID.headRadius; // reference radius before non-uniform scale
  const H = HUMANOID.torsoHeight;
  const neckR = HUMANOID.neckRadius;

  const raw: [number, number][] = [
    [Rt * 0.9, -0.05],
    [Rt * 0.87, H * 0.14],
    [Rt * 0.9, H * 0.32],
    [Rt * 1.0, H * 0.48],
    [Rt * 1.06, H * 0.62], // deltoid bulge — the shoulder's widest point
    [Rt * 1.0, H * 0.72],
    [Rt * 0.78, H * 0.83],
    [Rt * 0.56, H * 0.91],
    [Rt * 0.48, H * 0.94], // collar step
    [neckR * 1.35, H * 0.965],
    [neckR * 1.1, H * 1.0],
  ];

  const profile = sampleProfile(raw, 44);
  const geometry = new THREE.LatheGeometry(profile, 96, 0, Math.PI * 2);
  const widthScale = HUMANOID.shoulderWidth / Rt;
  const depthScale = HUMANOID.shoulderDepth / Rt;
  geometry.scale(widthScale, 1, depthScale);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Segmented, mechanical neck: a tapered column with subtle ring bands
 * suggesting armored/articulated segments rather than a bare cylinder.
 */
export function buildNeckGeometry(): THREE.BufferGeometry {
  const baseTop = HUMANOID.neckRadius * 0.96;
  const baseBottom = HUMANOID.neckRadius * 1.22;
  const height = HUMANOID.neckHeight + HUMANOID.neckOverlap;
  const rings = 4;

  const raw: [number, number][] = [];
  const samples = 20;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const y = t * height;
    const baseR = THREE.MathUtils.lerp(baseBottom, baseTop, t);
    const ringPhase = t * rings * Math.PI * 2;
    const ringBulge = Math.max(0, Math.sin(ringPhase)) * 0.028 * smoothEdgeFade(t);
    raw.push([baseR + ringBulge, y]);
  }

  const profile = raw.map(([x, y]) => new THREE.Vector2(x, y));
  const geometry = new THREE.LatheGeometry(profile, 64, 0, Math.PI * 2);
  geometry.computeVertexNormals();
  return geometry;
}

function smoothEdgeFade(t: number): number {
  const edge = Math.min(t, 1 - t) * 6;
  return Math.min(1, Math.max(0, edge));
}

/** Thin mechanical collar ring accent sitting where the neck meets the shoulders. */
export function buildCollarRingGeometry(): THREE.BufferGeometry {
  const radius = HUMANOID.neckRadius * 1.32;
  const tube = radius * 0.05;
  return new THREE.TorusGeometry(radius, tube, 10, 64);
}

/**
 * Flat panel hosting the face energy core, seated inside the head's
 * recessed face-plate socket. A flat plane (rather than a curved sphere
 * patch) guarantees zero self-overlap in screen space at any viewing
 * angle within the head's limited yaw range, and gives the shader a
 * clean, linear, undistorted UV space to work with.
 */
export function buildFaceCoreGeometry(): THREE.BufferGeometry {
  const width = HUMANOID.headRadius * 1.35;
  const height = HUMANOID.headRadius * HUMANOID.headHeightScale * 1.05;
  const geometry = new THREE.PlaneGeometry(width, height, 24, 24);
  const centerY = headSculptY(0.02);
  const centerZ = HUMANOID.headRadius * HUMANOID.headDepthScale * 0.52;
  geometry.translate(0, centerY, centerZ);
  return geometry;
}
