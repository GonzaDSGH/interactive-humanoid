/**
 * Pointer-attention interaction system — ported near-verbatim from the
 * project's earlier Three.js implementation. This is the proven core the
 * whole redesign was told to preserve: a real second-order (spring-damper)
 * filter cascaded through face -> head -> neck -> shoulders -> torso, not
 * a plain lerp. Framework-agnostic; only reads normalized pointer values.
 */

/**
 * Second-order dynamics filter (critically/under-damped harmonic
 * oscillator). f = natural frequency (Hz, higher = snappier), z = damping
 * ratio (1 = no overshoot, <1 = a small controlled overshoot), r =
 * initial response (0 = eases in from rest).
 */
class SecondOrderDynamics {
  constructor(f, z, r, initial = 0) {
    this.k1 = z / (Math.PI * f);
    this.k2 = 1 / (2 * Math.PI * f * (2 * Math.PI * f));
    this.k3 = (r * z) / (2 * Math.PI * f);
    this.xp = initial;
    this.y = initial;
    this.yd = 0;
  }

  update(dt, x) {
    if (dt <= 0) return this.y;

    const steps = Math.max(1, Math.ceil(dt / Math.max(1e-4, Math.sqrt(this.k2) * 1.6)));
    const subDt = dt / steps;

    for (let i = 0; i < steps; i++) {
      const xd = (x - this.xp) / subDt;
      this.xp = x;

      const k2Stable = Math.max(this.k2, (subDt * subDt) / 2 + (subDt * this.k1) / 2, subDt * this.k1);

      this.y = this.y + subDt * this.yd;
      this.yd = this.yd + (subDt * (x + this.k3 * xd - this.y - this.k1 * this.yd)) / k2Stable;
    }

    return this.y;
  }
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Tracks the raw pointer via p5's mouseX/mouseY (falls back smoothly to
 * center when the pointer hasn't moved or has left the canvas).
 */
class PointerTracker {
  constructor() {
    this.raw = { x: 0, y: 0 };
    this.target = { x: 0, y: 0 };
    this.velocity = { x: 0, y: 0 };
    this.speed = 0;
    this.lastMoveAt = performance.now();
    this.hasMoved = false;
    this.inside = true;
    this._prevRaw = { x: 0, y: 0 };
  }

  /** Call whenever the browser reports pointer movement inside the canvas. */
  onMove(nx, ny) {
    this.raw.x = nx;
    this.raw.y = ny;
    this.inside = true;
    this.hasMoved = true;
    this.lastMoveAt = performance.now();
  }

  onLeave() {
    this.inside = false;
  }

  onEnter() {
    this.inside = true;
    this.lastMoveAt = performance.now();
  }

  update(dt) {
    this.velocity.x = dt > 0 ? (this.raw.x - this._prevRaw.x) / dt : 0;
    this.velocity.y = dt > 0 ? (this.raw.y - this._prevRaw.y) / dt : 0;
    this.speed = Math.hypot(this.velocity.x, this.velocity.y);
    this._prevRaw.x = this.raw.x;
    this._prevRaw.y = this.raw.y;

    const idleFor = performance.now() - this.lastMoveAt;
    const shouldReturn = !this.inside || idleFor > CONFIG.POINTER.returnDelayMs;

    if (shouldReturn || !this.hasMoved) {
      const t = 1 - Math.exp(-dt / Math.max(0.05, CONFIG.POINTER.returnEase));
      this.target.x += (0 - this.target.x) * t;
      this.target.y += (0 - this.target.y) * t;
    } else {
      this.target.x = this.raw.x;
      this.target.y = this.raw.y;
    }
  }
}

/**
 * Cascades the pointer through a chain of second-order dynamics filters —
 * attention -> face -> head -> neck -> shoulders -> torso — each stage
 * consuming the previous stage's smoothed output. This produces the
 * hierarchy of delay/inertia: each link lags and softens the one before
 * it, rather than every part snapping to the same lerped position.
 */
class AttentionController {
  constructor(pointer) {
    this.pointer = pointer;
    const d = CONFIG.DYNAMICS;
    this.inputX = new SecondOrderDynamics(d.input.f, d.input.z, d.input.r);
    this.inputY = new SecondOrderDynamics(d.input.f, d.input.z, d.input.r);
    this.faceX = new SecondOrderDynamics(d.face.f, d.face.z, d.face.r);
    this.faceY = new SecondOrderDynamics(d.face.f, d.face.z, d.face.r);
    this.headX = new SecondOrderDynamics(d.head.f, d.head.z, d.head.r);
    this.headY = new SecondOrderDynamics(d.head.f, d.head.z, d.head.r);
    this.neckX = new SecondOrderDynamics(d.neck.f, d.neck.z, d.neck.r);
    this.neckY = new SecondOrderDynamics(d.neck.f, d.neck.z, d.neck.r);
    this.shoulderX = new SecondOrderDynamics(d.shoulders.f, d.shoulders.z, d.shoulders.r);
    this.shoulderY = new SecondOrderDynamics(d.shoulders.f, d.shoulders.z, d.shoulders.r);
    this.torsoX = new SecondOrderDynamics(d.torso.f, d.torso.z, d.torso.r);
    this.torsoY = new SecondOrderDynamics(d.torso.f, d.torso.z, d.torso.r);

    this.pose = {
      head: { yaw: 0, pitch: 0, roll: 0 },
      neck: { yaw: 0, pitch: 0, roll: 0 },
      shoulders: { yaw: 0, pitch: 0, roll: 0, bob: 0 },
      torso: { yaw: 0, pitch: 0, roll: 0 },
      faceShift: { x: 0, y: 0 },
      pointerSpeed: 0,
    };
  }

  update(dt) {
    this.pointer.update(dt);
    const L = CONFIG.LIMITS;

    const ax = this.inputX.update(dt, this.pointer.target.x);
    const ay = this.inputY.update(dt, this.pointer.target.y);

    const fx = this.faceX.update(dt, ax);
    const fy = this.faceY.update(dt, ay);
    this.pose.faceShift.x = clamp(fx, -1, 1) * L.faceShift;
    this.pose.faceShift.y = clamp(fy, -1, 1) * L.faceShift;

    const hx = this.headX.update(dt, ax);
    const hy = this.headY.update(dt, ay);
    this.pose.head.yaw = hx * L.head.yaw;
    this.pose.head.pitch = hy * L.head.pitch;
    this.pose.head.roll = clamp(-hx * hy, -1, 1) * L.head.roll;

    const nx = this.neckX.update(dt, hx);
    const ny = this.neckY.update(dt, hy);
    this.pose.neck.yaw = nx * L.neck.yaw;
    this.pose.neck.pitch = ny * L.neck.pitch;
    this.pose.neck.roll = clamp(-nx * ny, -1, 1) * L.neck.roll;

    const sx = this.shoulderX.update(dt, nx);
    const sy = this.shoulderY.update(dt, ny);
    this.pose.shoulders.yaw = sx * L.shoulders.yaw;
    this.pose.shoulders.pitch = sy * L.shoulders.pitch;
    this.pose.shoulders.roll = clamp(-sx * sy, -1, 1) * L.shoulders.roll;
    this.pose.shoulders.bob = sy * L.shoulders.bob;

    const tx = this.torsoX.update(dt, sx);
    const ty = this.torsoY.update(dt, sy);
    this.pose.torso.yaw = tx * L.torso.yaw;
    this.pose.torso.pitch = ty * L.torso.pitch;
    this.pose.torso.roll = clamp(-tx * ty, -1, 1) * L.torso.roll;

    this.pose.pointerSpeed = this.pointer.speed;

    return this.pose;
  }
}
