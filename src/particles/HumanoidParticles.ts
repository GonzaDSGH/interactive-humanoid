import * as THREE from 'three';
import { AttentionPose } from '../input/AttentionController';
import { COLORS, SKELETON, IDLE, PARTICLE_FIELD, RENDER } from '../config';
import { buildHumanoidField } from './humanoidField';

const EULER_ORDER: THREE.EulerOrder = 'YXZ';

const vertexShader = /* glsl */ `
  attribute float aPart;
  attribute float aFace;
  attribute float aSize;
  attribute float aBrightness;
  attribute float aRandom;
  attribute vec3 aSeed;
  attribute float aEdge;

  uniform mat4 uShoulderMatrix;
  uniform mat4 uNeckMatrix;
  uniform mat4 uHeadMatrix;
  uniform float uTime;
  uniform vec2 uFaceShift;
  uniform vec2 uFlowVelocity;
  uniform float uPixelRatio;
  uniform float uSizeScale;

  varying float vBrightness;
  varying float vEdge;
  varying float vRandom;

  void main() {
    mat4 partMatrix = aPart < 0.5 ? uShoulderMatrix : (aPart < 1.5 ? uNeckMatrix : uHeadMatrix);
    vec4 worldPos = partMatrix * vec4(position, 1.0);

    // Tiny per-particle idle drift, in world space so it reads as ambient
    // life rather than distorting the pose itself.
    float t = uTime * PARTICLE_FIELD_IDLE_SPEED;
    worldPos.x += sin(t * (0.6 + aSeed.x * 0.8) + aSeed.x * 6.283) * PARTICLE_FIELD_IDLE_AMOUNT;
    worldPos.y += cos(t * (0.5 + aSeed.y * 0.7) + aSeed.y * 6.283) * PARTICLE_FIELD_IDLE_AMOUNT;
    worldPos.z += sin(t * (0.4 + aSeed.z * 0.6) + aSeed.z * 6.283) * PARTICLE_FIELD_IDLE_AMOUNT * 0.7;

    // Face particles get an extra nudge toward the attention target, on
    // top of the head's own (already-fastest-after-face) rigid rotation —
    // reinforcing "the face notices first."
    worldPos.xy += aFace * uFaceShift;

    // Subtle organic mass-flow toward the pointer's recent velocity,
    // layered on top of the rigid per-part rotation — stronger toward the
    // head, softer toward the shoulders, so fast moves read as the whole
    // figure's particle mass trailing slightly rather than a rigid snap.
    float flowScale = aPart < 0.5 ? FLOW_SHOULDER : (aPart < 1.5 ? FLOW_NECK : FLOW_HEAD);
    worldPos.xy += uFlowVelocity * flowScale * (0.7 + 0.3 * aRandom);

    vec4 viewPos = viewMatrix * worldPos;
    gl_Position = projectionMatrix * viewPos;

    float sizeAtten = 1.0 / max(-viewPos.z, 0.001);
    gl_PointSize = aSize * uSizeScale * uPixelRatio * sizeAtten * 10.5;

    vBrightness = aBrightness;
    vEdge = aEdge;
    vRandom = aRandom;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  varying float vBrightness;
  varying float vEdge;
  varying float vRandom;

  uniform vec3 uColorPrimary;
  uniform vec3 uColorSecondary;
  uniform vec3 uColorHighlight;
  uniform float uOpacity;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float core = smoothstep(0.5, 0.0, d);
    if (core < 0.02) discard;

    // Soft falloff toward the volume's boundary/halo instead of a crisp cutoff.
    float edgeFade = 1.0 - smoothstep(0.6, 1.7, vEdge);

    vec3 color = mix(uColorSecondary, uColorPrimary, clamp(vRandom * 1.3, 0.0, 1.0));
    color = mix(color, uColorHighlight, clamp((vBrightness - 0.7) * 2.2, 0.0, 1.0) * step(0.82, vRandom));

    float alpha = core * core * vBrightness * edgeFade * uOpacity;
    gl_FragColor = vec4(color, alpha);
  }
`;

function applyLayerPose(
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

/**
 * The humanoid itself, as a single dense GPU point cloud. No mesh, no
 * shell, no shader-drawn surface anywhere — every visible pixel of the
 * figure is a particle sprite. Rigid body-part motion is driven by three
 * world matrices (shoulder/neck/head, read off a detached Object3D pivot
 * hierarchy that mirrors AttentionController's cascade exactly), and a
 * small amount of additional per-particle drift/flow is layered on top in
 * the vertex shader for organic life.
 */
export class HumanoidParticles {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;

  private readonly torsoPivot = new THREE.Object3D();
  private readonly shoulderPivot = new THREE.Object3D();
  private readonly neckPivot = new THREE.Object3D();
  private readonly headPivot = new THREE.Object3D();

  private readonly scratchEuler = new THREE.Euler();
  private readonly scratchQuat = new THREE.Quaternion();
  private clock = 0;
  private idleSeed = Math.random() * 1000;
  private flowVelX = 0;
  private flowVelY = 0;

  constructor() {
    this.torsoPivot.position.set(0, SKELETON.groupOffsetY, 0);
    this.torsoPivot.add(this.shoulderPivot);
    this.shoulderPivot.add(this.neckPivot);
    this.neckPivot.position.set(0, 0, 0);
    this.neckPivot.add(this.headPivot);
    this.headPivot.position.set(0, SKELETON.neckHeight, 0);

    const field = buildHumanoidField();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(field.positions, 3));
    geometry.setAttribute('aPart', new THREE.BufferAttribute(field.part, 1));
    geometry.setAttribute('aFace', new THREE.BufferAttribute(field.face, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(field.size, 1));
    geometry.setAttribute('aBrightness', new THREE.BufferAttribute(field.brightness, 1));
    geometry.setAttribute('aRandom', new THREE.BufferAttribute(field.random, 1));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(field.seed, 3));
    geometry.setAttribute('aEdge', new THREE.BufferAttribute(field.edge, 1));
    // Rigid part transforms move particles far from their bounding-sphere
    // origin; frustum culling against the untransformed geometry would
    // incorrectly clip the figure as it turns.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.4, 0), 4);

    const finalVertexShader = vertexShader
      .replace(/PARTICLE_FIELD_IDLE_SPEED/g, PARTICLE_FIELD.idleDriftSpeed.toFixed(4))
      .replace(/PARTICLE_FIELD_IDLE_AMOUNT/g, PARTICLE_FIELD.idleDriftAmount.toFixed(4))
      .replace(/FLOW_SHOULDER/g, (PARTICLE_FIELD.flowInfluence * PARTICLE_FIELD.flowInfluenceByPart.shoulder).toFixed(5))
      .replace(/FLOW_NECK/g, (PARTICLE_FIELD.flowInfluence * PARTICLE_FIELD.flowInfluenceByPart.neck).toFixed(5))
      .replace(/FLOW_HEAD/g, (PARTICLE_FIELD.flowInfluence * PARTICLE_FIELD.flowInfluenceByPart.head).toFixed(5));

    this.material = new THREE.ShaderMaterial({
      vertexShader: finalVertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uShoulderMatrix: { value: new THREE.Matrix4() },
        uNeckMatrix: { value: new THREE.Matrix4() },
        uHeadMatrix: { value: new THREE.Matrix4() },
        uTime: { value: 0 },
        uFaceShift: { value: new THREE.Vector2(0, 0) },
        uFlowVelocity: { value: new THREE.Vector2(0, 0) },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, RENDER.maxPixelRatio) },
        uSizeScale: { value: 1 },
        uColorPrimary: { value: new THREE.Color(COLORS.cyanPrimary) },
        uColorSecondary: { value: new THREE.Color(COLORS.cyanSecondary) },
        uColorHighlight: { value: new THREE.Color(COLORS.iceWhite) },
        uOpacity: { value: 1 },
      },
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
  }

  update(dt: number, pose: AttentionPose, pointerVelX: number, pointerVelY: number): void {
    this.clock += dt;
    const t = this.clock;

    const breathe = Math.sin(t * IDLE.breathingRate * Math.PI * 2 + this.idleSeed) * IDLE.breathingAmount;
    const driftYaw = Math.sin(t * IDLE.driftRate * Math.PI * 2 + this.idleSeed * 1.7) * IDLE.driftYaw;
    const driftPitch = Math.cos(t * IDLE.driftRate * Math.PI * 2 * 0.83 + this.idleSeed) * IDLE.driftPitch;

    applyLayerPose(
      this.torsoPivot,
      pose.torso.yaw,
      pose.torso.pitch,
      pose.torso.roll,
      this.scratchEuler,
      this.scratchQuat
    );
    this.torsoPivot.scale.setScalar(1 + breathe * 0.4);

    applyLayerPose(
      this.shoulderPivot,
      pose.shoulders.yaw,
      pose.shoulders.pitch,
      pose.shoulders.roll,
      this.scratchEuler,
      this.scratchQuat
    );
    this.shoulderPivot.position.y = pose.shoulders.bob + breathe;

    applyLayerPose(
      this.neckPivot,
      pose.neck.yaw,
      pose.neck.pitch,
      pose.neck.roll,
      this.scratchEuler,
      this.scratchQuat
    );

    applyLayerPose(
      this.headPivot,
      pose.head.yaw + driftYaw,
      pose.head.pitch + driftPitch,
      pose.head.roll,
      this.scratchEuler,
      this.scratchQuat
    );

    this.torsoPivot.updateMatrixWorld(true);

    (this.material.uniforms.uShoulderMatrix.value as THREE.Matrix4).copy(this.shoulderPivot.matrixWorld);
    (this.material.uniforms.uNeckMatrix.value as THREE.Matrix4).copy(this.neckPivot.matrixWorld);
    (this.material.uniforms.uHeadMatrix.value as THREE.Matrix4).copy(this.headPivot.matrixWorld);

    const shiftScale = 1.4 * PARTICLE_FIELD.faceShiftScale;
    (this.material.uniforms.uFaceShift.value as THREE.Vector2).set(
      pose.faceShift.x * shiftScale,
      pose.faceShift.y * shiftScale
    );

    // Damped copy of pointer velocity for the organic mass-flow term —
    // deliberately smoother/slower than the raw signal so it reads as
    // trailing weight, not jitter.
    const lambda = 3.4;
    const alpha = 1 - Math.exp(-lambda * dt);
    this.flowVelX += (pointerVelX - this.flowVelX) * alpha;
    this.flowVelY += (pointerVelY - this.flowVelY) * alpha;
    (this.material.uniforms.uFlowVelocity.value as THREE.Vector2).set(this.flowVelX, this.flowVelY);

    this.material.uniforms.uTime.value = t;
  }

  setPixelRatio(pr: number): void {
    this.material.uniforms.uPixelRatio.value = pr;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
