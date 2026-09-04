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
    [R * 0.5, H * 0.09],
    [R * 0.74, H * 0.22],
    [R * 0.9, H * 0.38],
    [R * 1.0, H * 0.56],
    [R * 0.94, H * 0.72],
    [R * 0.72, H * 0.86],
    [R * 0.34, H * 0.96],
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

/** Curved patch hugging the front of the head, used to host the face energy core. */
export function buildFaceCoreGeometry(): THREE.BufferGeometry {
  const phiCenter = Math.PI * 0.5; // +Z (front) at the equator
  const phiLength = 1.5;
  const thetaCenter = Math.PI * 0.5;
  const thetaLength = 1.8;

  const geometry = new THREE.SphereGeometry(
    HUMANOID.headRadius * 0.965,
    48,
    48,
    phiCenter - phiLength / 2,
    phiLength,
    thetaCenter - thetaLength / 2,
    thetaLength
  );
  geometry.translate(0, HUMANOID.headRadius * HUMANOID.headHeightScale * 0.9, 0);
  geometry.scale(1, HUMANOID.headHeightScale * 0.92, HUMANOID.headDepthScale);
  return geometry;
}
