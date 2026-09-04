/**
 * Second-order dynamics filter (critically/under-damped harmonic oscillator).
 *
 * Gives physically-inspired smoothing with genuine acceleration, inertia,
 * deceleration and a small controlled overshoot when the damping ratio is
 * below 1 — exactly the "alive" quality a spring-damper provides versus a
 * plain lerp. Frame-rate independent via a stability-clamped integration
 * step (subdivides the frame when dt is too large relative to k2).
 *
 * f = natural frequency in Hz (higher = snappier / less delay)
 * z = damping ratio (1 = critically damped/no overshoot, <1 = slight bounce)
 * r = initial response (0 = eases in from rest, >1 = slight anticipation)
 */
export class SecondOrderDynamics {
  private xp: number;
  private y: number;
  private yd: number;

  private k1: number;
  private k2: number;
  private k3: number;

  constructor(f: number, z: number, r: number, initial = 0) {
    this.k1 = z / (Math.PI * f);
    this.k2 = 1 / (2 * Math.PI * f * (2 * Math.PI * f));
    this.k3 = (r * z) / (2 * Math.PI * f);

    this.xp = initial;
    this.y = initial;
    this.yd = 0;
  }

  reset(value: number): void {
    this.xp = value;
    this.y = value;
    this.yd = 0;
  }

  get value(): number {
    return this.y;
  }

  update(dt: number, x: number): number {
    if (dt <= 0) return this.y;

    // Subdivide for stability if the timestep is large relative to k2.
    const steps = Math.max(1, Math.ceil(dt / Math.max(1e-4, Math.sqrt(this.k2) * 1.6)));
    const subDt = dt / steps;

    for (let i = 0; i < steps; i++) {
      const xd = (x - this.xp) / subDt;
      this.xp = x;

      const k2Stable = Math.max(
        this.k2,
        (subDt * subDt) / 2 + (subDt * this.k1) / 2,
        subDt * this.k1
      );

      this.y = this.y + subDt * this.yd;
      this.yd =
        this.yd +
        (subDt * (x + this.k3 * xd - this.y - this.k1 * this.yd)) / k2Stable;
    }

    return this.y;
  }
}
