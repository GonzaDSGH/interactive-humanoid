import { PointerTracker } from './PointerTracker';
import { SecondOrderDynamics } from './SecondOrderDynamics';
import { DYNAMICS, LIMITS } from '../config';
import { clamp } from '../utils/math';

export interface LayerPose {
  yaw: number;
  pitch: number;
  roll: number;
}

export interface AttentionPose {
  head: LayerPose;
  neck: LayerPose;
  shoulders: LayerPose & { bob: number };
  torso: LayerPose;
  faceShift: { x: number; y: number };
  pointerSpeed: number;
}

/**
 * Cascades the pointer position through a chain of second-order dynamics
 * filters — attention -> face core -> head -> neck -> shoulders -> torso —
 * each stage consuming the previous stage's smoothed output. This is what
 * produces the hierarchy of delay/inertia described in the brief: each
 * link lags and softens the one before it, rather than every part
 * snapping to the same lerped mouse position.
 */
export class AttentionController {
  private readonly inputX: SecondOrderDynamics;
  private readonly inputY: SecondOrderDynamics;

  private readonly faceX: SecondOrderDynamics;
  private readonly faceY: SecondOrderDynamics;

  private readonly headX: SecondOrderDynamics;
  private readonly headY: SecondOrderDynamics;

  private readonly neckX: SecondOrderDynamics;
  private readonly neckY: SecondOrderDynamics;

  private readonly shoulderX: SecondOrderDynamics;
  private readonly shoulderY: SecondOrderDynamics;

  private readonly torsoX: SecondOrderDynamics;
  private readonly torsoY: SecondOrderDynamics;

  readonly pose: AttentionPose = {
    head: { yaw: 0, pitch: 0, roll: 0 },
    neck: { yaw: 0, pitch: 0, roll: 0 },
    shoulders: { yaw: 0, pitch: 0, roll: 0, bob: 0 },
    torso: { yaw: 0, pitch: 0, roll: 0 },
    faceShift: { x: 0, y: 0 },
    pointerSpeed: 0,
  };

  constructor(readonly pointer: PointerTracker) {
    const d = DYNAMICS;
    this.inputX = new SecondOrderDynamics(d.input.f, d.input.z, d.input.r);
    this.inputY = new SecondOrderDynamics(d.input.f, d.input.z, d.input.r);

    this.faceX = new SecondOrderDynamics(d.faceCore.f, d.faceCore.z, d.faceCore.r);
    this.faceY = new SecondOrderDynamics(d.faceCore.f, d.faceCore.z, d.faceCore.r);

    this.headX = new SecondOrderDynamics(d.head.f, d.head.z, d.head.r);
    this.headY = new SecondOrderDynamics(d.head.f, d.head.z, d.head.r);

    this.neckX = new SecondOrderDynamics(d.neck.f, d.neck.z, d.neck.r);
    this.neckY = new SecondOrderDynamics(d.neck.f, d.neck.z, d.neck.r);

    this.shoulderX = new SecondOrderDynamics(d.shoulders.f, d.shoulders.z, d.shoulders.r);
    this.shoulderY = new SecondOrderDynamics(d.shoulders.f, d.shoulders.z, d.shoulders.r);

    this.torsoX = new SecondOrderDynamics(d.torso.f, d.torso.z, d.torso.r);
    this.torsoY = new SecondOrderDynamics(d.torso.f, d.torso.z, d.torso.r);
  }

  update(dt: number): AttentionPose {
    this.pointer.update(dt);

    const ax = this.inputX.update(dt, this.pointer.target.x);
    const ay = this.inputY.update(dt, this.pointer.target.y);

    // Face core: fastest, tiny internal shift, never leaves the head.
    const fx = this.faceX.update(dt, ax);
    const fy = this.faceY.update(dt, ay);
    this.pose.faceShift.x = clamp(fx, -1, 1) * LIMITS.faceCoreShift;
    this.pose.faceShift.y = clamp(fy, -1, 1) * LIMITS.faceCoreShift;

    // Head: strong response, slightly delayed relative to the raw target.
    const hx = this.headX.update(dt, ax);
    const hy = this.headY.update(dt, ay);
    this.pose.head.yaw = hx * LIMITS.head.yaw;
    this.pose.head.pitch = hy * LIMITS.head.pitch;
    this.pose.head.roll = clamp(-hx * hy, -1, 1) * LIMITS.head.roll;

    // Neck: fed by the head's own smoothed signal -> inherits its lag, adds more.
    const nx = this.neckX.update(dt, hx);
    const ny = this.neckY.update(dt, hy);
    this.pose.neck.yaw = nx * LIMITS.neck.yaw;
    this.pose.neck.pitch = ny * LIMITS.neck.pitch;
    this.pose.neck.roll = clamp(-nx * ny, -1, 1) * LIMITS.neck.roll;

    // Shoulders: subtle, fed by neck.
    const sx = this.shoulderX.update(dt, nx);
    const sy = this.shoulderY.update(dt, ny);
    this.pose.shoulders.yaw = sx * LIMITS.shoulders.yaw;
    this.pose.shoulders.pitch = sy * LIMITS.shoulders.pitch;
    this.pose.shoulders.roll = clamp(-sx * sy, -1, 1) * LIMITS.shoulders.roll;
    this.pose.shoulders.bob = sy * LIMITS.shoulders.bob;

    // Torso: very subtle and slow, fed by shoulders.
    const tx = this.torsoX.update(dt, sx);
    const ty = this.torsoY.update(dt, sy);
    this.pose.torso.yaw = tx * LIMITS.torso.yaw;
    this.pose.torso.pitch = ty * LIMITS.torso.pitch;
    this.pose.torso.roll = clamp(-tx * ty, -1, 1) * LIMITS.torso.roll;

    this.pose.pointerSpeed = this.pointer.speed;

    return this.pose;
  }
}
