import * as THREE from 'three';
import {
  buildHeadGeometry,
  buildTorsoGeometry,
  buildNeckGeometry,
  buildFaceCoreGeometry,
} from './geometry';
import { createContourMaterial } from './materials/contourMaterial';
import { createFaceCoreMaterial } from './materials/faceCoreMaterial';
import { AttentionPose } from '../input/AttentionController';
import { HUMANOID, IDLE, CONTOUR } from '../config';

const EULER_ORDER: THREE.EulerOrder = 'YXZ';

function applyPose(
  object: THREE.Object3D,
  yaw: number,
  pitch: number,
  roll: number,
  euler: THREE.Euler,
  quat: THREE.Quaternion
): void {
  euler.set(pitch, yaw, roll, EULER_ORDER);
  quat.setFromEuler(euler);
  object.quaternion.copy(quat);
}

export class Humanoid {
  readonly group = new THREE.Group();

  private readonly torsoGroup = new THREE.Group();
  private readonly shouldersMesh: THREE.Mesh;
  private readonly neckGroup = new THREE.Group();
  private readonly neckMesh: THREE.Mesh;
  private readonly headGroup = new THREE.Group();
  private readonly headMesh: THREE.Mesh;
  private readonly faceCoreMesh: THREE.Mesh;

  private readonly headMaterial: THREE.ShaderMaterial;
  private readonly torsoMaterial: THREE.ShaderMaterial;
  private readonly faceMaterial: THREE.ShaderMaterial;

  private clock = 0;
  private readonly scratchEuler = new THREE.Euler();
  private readonly scratchQuat = new THREE.Quaternion();
  private idleSeed = Math.random() * 1000;

  constructor() {
    this.headMaterial = createContourMaterial({
      bandFrequency: CONTOUR.headBandFrequency,
      bandSharpness: CONTOUR.headBandSharpness,
      centerlineStrength: 0,
    });
    this.torsoMaterial = createContourMaterial({
      bandFrequency: CONTOUR.torsoBandFrequency,
      bandSharpness: CONTOUR.torsoBandSharpness,
      centerlineStrength: CONTOUR.centerlineStrength,
    });
    this.faceMaterial = createFaceCoreMaterial();

    this.shouldersMesh = new THREE.Mesh(buildTorsoGeometry(), this.torsoMaterial);
    this.shouldersMesh.position.set(0, -HUMANOID.torsoHeight, 0);
    this.torsoGroup.add(this.shouldersMesh);

    this.neckMesh = new THREE.Mesh(buildNeckGeometry(), this.headMaterial);
    this.neckMesh.position.set(0, HUMANOID.neckHeight / 2, 0);
    this.neckGroup.add(this.neckMesh);
    this.neckGroup.position.set(0, HUMANOID.torsoHeight, 0);
    this.shouldersMesh.add(this.neckGroup);

    this.headMesh = new THREE.Mesh(buildHeadGeometry(), this.headMaterial);
    this.headGroup.add(this.headMesh);
    this.headGroup.position.set(0, HUMANOID.neckHeight, 0);
    this.neckGroup.add(this.headGroup);

    this.faceCoreMesh = new THREE.Mesh(buildFaceCoreGeometry(), this.faceMaterial);
    this.headGroup.add(this.faceCoreMesh);

    this.group.add(this.torsoGroup);

    // Recenter the whole bust so the head sits near the composition's
    // vertical center and the shoulders crop out toward the bottom.
    this.group.position.y = -0.62;
  }

  update(dt: number, pose: AttentionPose): void {
    this.clock += dt;

    const t = this.clock;
    const breathe =
      Math.sin(t * IDLE.breathingRate * Math.PI * 2 + this.idleSeed) * IDLE.breathingAmount;
    const driftYaw =
      Math.sin(t * IDLE.driftRate * Math.PI * 2 + this.idleSeed * 1.7) * IDLE.driftYaw;
    const driftPitch =
      Math.cos(t * IDLE.driftRate * Math.PI * 2 * 0.83 + this.idleSeed) * IDLE.driftPitch;

    applyPose(
      this.torsoGroup,
      pose.torso.yaw,
      pose.torso.pitch,
      pose.torso.roll,
      this.scratchEuler,
      this.scratchQuat
    );
    this.torsoGroup.scale.setScalar(1 + breathe * 0.4);

    applyPose(
      this.shouldersMesh,
      pose.shoulders.yaw,
      pose.shoulders.pitch,
      pose.shoulders.roll,
      this.scratchEuler,
      this.scratchQuat
    );
    this.shouldersMesh.position.y = -HUMANOID.torsoHeight + pose.shoulders.bob + breathe;

    applyPose(
      this.neckGroup,
      pose.neck.yaw,
      pose.neck.pitch,
      pose.neck.roll,
      this.scratchEuler,
      this.scratchQuat
    );

    applyPose(
      this.headGroup,
      pose.head.yaw + driftYaw,
      pose.head.pitch + driftPitch,
      pose.head.roll,
      this.scratchEuler,
      this.scratchQuat
    );

    const shiftScale = HUMANOID.headRadius * 1.4;
    this.faceMaterial.uniforms.uShift.value.set(
      pose.faceShift.x * shiftScale,
      pose.faceShift.y * shiftScale
    );

    this.headMaterial.uniforms.uTime.value = t;
    this.torsoMaterial.uniforms.uTime.value = t;
    this.faceMaterial.uniforms.uTime.value = t;
  }

  dispose(): void {
    this.headMesh.geometry.dispose();
    this.shouldersMesh.geometry.dispose();
    this.neckMesh.geometry.dispose();
    this.faceCoreMesh.geometry.dispose();
    this.headMaterial.dispose();
    this.torsoMaterial.dispose();
    this.faceMaterial.dispose();
  }
}
