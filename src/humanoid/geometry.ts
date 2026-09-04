import * as THREE from 'three';
import { HUMANOID } from '../config';

/** Samples a smooth spline through control points so lathe profiles never look faceted. */
function sampleProfile(points: [number, number][], samples: number): THREE.Vector2[] {
  const curve = new THREE.SplineCurve(points.map(([x, y]) => new THREE.Vector2(x, y)));
  return curve.getPoints(samples);
}

/**
 * Stylized skull/bust profile: rounded crown, widest at the temples,
 * narrowing through the cheek line to a chin that hands off to the neck.
 * Revolved around Y so it stays a convincing volume from any yaw angle,
 * then flattened front-to-back so it doesn't read as a bare sphere.
 */
export function buildHeadGeometry(): THREE.BufferGeometry {
  const R = HUMANOID.headRadius;
  const H = R * 2 * HUMANOID.headHeightScale;
  const neckR = HUMANOID.neckRadius;

  const raw: [number, number][] = [
    [neckR * 0.92, 0.0],
    [R * 0.62, H * 0.08],
    [R * 0.86, H * 0.2],
    [R * 0.98, H * 0.34],
    [R * 1.0, H * 0.48],
    [R * 0.97, H * 0.62],
    [R * 0.86, H * 0.76],
    [R * 0.58, H * 0.9],
    [R * 0.2, H * 0.98],
    [R * 0.02, H * 1.0],
  ];

  const profile = sampleProfile(raw, 48);
  const geometry = new THREE.LatheGeometry(profile, 96, 0, Math.PI * 2);
  geometry.scale(1, 1, HUMANOID.headDepthScale);
  geometry.computeVertexNormals();
  return geometry;
}

/** Wide, shallow torso/shoulder volume: flares out at the shoulders, narrows to the collar. */
export function buildTorsoGeometry(): THREE.BufferGeometry {
  const Rt = HUMANOID.headRadius; // reference radius before non-uniform scale
  const H = HUMANOID.torsoHeight;
  const neckR = HUMANOID.neckRadius;

  const raw: [number, number][] = [
    [Rt * 0.88, -0.05],
    [Rt * 0.86, H * 0.18],
    [Rt * 0.92, H * 0.4],
    [Rt * 1.0, H * 0.58],
    [Rt * 0.98, H * 0.72],
    [Rt * 0.7, H * 0.86],
    [Rt * 0.42, H * 0.95],
    [neckR * 1.05, H * 1.0],
  ];

  const profile = sampleProfile(raw, 40);
  const geometry = new THREE.LatheGeometry(profile, 96, 0, Math.PI * 2);
  const widthScale = HUMANOID.shoulderWidth / Rt;
  const depthScale = HUMANOID.shoulderDepth / Rt;
  geometry.scale(widthScale, 1, depthScale);
  geometry.computeVertexNormals();
  return geometry;
}

/** Short tapered neck bridging the head and torso. */
export function buildNeckGeometry(): THREE.BufferGeometry {
  const topR = HUMANOID.neckRadius * 0.98;
  const bottomR = HUMANOID.neckRadius * 1.18;
  const height = HUMANOID.neckHeight;
  const geometry = new THREE.CylinderGeometry(topR, bottomR, height, 48, 6, true);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Flat panel hosting the face energy core, positioned just in front of
 * the head's surface. A flat plane (rather than a curved sphere patch)
 * guarantees zero self-overlap in screen space at any viewing angle
 * within the head's limited yaw range, and gives the shader a clean,
 * linear, undistorted UV space to work with.
 */
export function buildFaceCoreGeometry(): THREE.BufferGeometry {
  const width = HUMANOID.headRadius * 1.5;
  const height = HUMANOID.headRadius * HUMANOID.headHeightScale * 1.15;
  const geometry = new THREE.PlaneGeometry(width, height, 24, 24);
  geometry.translate(0, HUMANOID.headRadius * HUMANOID.headHeightScale * 0.82, HUMANOID.headRadius * HUMANOID.headDepthScale * 0.62);
  return geometry;
}
