import { POINTER } from '../config';

/**
 * Tracks raw pointer position via Pointer Events and reduces it to a
 * normalized attention target in [-1, 1] on both axes. When the pointer
 * has been idle or has left the window for a while, the target eases
 * back toward center on its own so the entity never stays frozen
 * "looking" out of the screen.
 */
export class PointerTracker {
  /** Raw normalized pointer position, updated instantly on move. */
  readonly raw = { x: 0, y: 0 };

  /** The value fed into the attention cascade — equals `raw` while active,
   *  blends back to (0,0) after inactivity/leave. */
  readonly target = { x: 0, y: 0 };

  velocity = { x: 0, y: 0 };
  speed = 0;

  private lastMoveAt = performance.now();
  private inside = true;
  private hasMoved = false;
  private prevRaw = { x: 0, y: 0 };

  constructor(private readonly element: HTMLElement) {
    element.addEventListener('pointermove', this.onPointerMove, { passive: true });
    element.addEventListener('pointerleave', this.onPointerLeave, { passive: true });
    element.addEventListener('pointerenter', this.onPointerEnter, { passive: true });
    window.addEventListener('blur', this.onPointerLeave);
  }

  private onPointerMove = (event: PointerEvent) => {
    const rect = this.element.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    this.raw.x = x;
    this.raw.y = y;
    this.inside = true;
    this.hasMoved = true;
    this.lastMoveAt = performance.now();
  };

  private onPointerLeave = () => {
    this.inside = false;
  };

  private onPointerEnter = () => {
    this.inside = true;
    this.lastMoveAt = performance.now();
  };

  update(dt: number): void {
    this.velocity.x = dt > 0 ? (this.raw.x - this.prevRaw.x) / dt : 0;
    this.velocity.y = dt > 0 ? (this.raw.y - this.prevRaw.y) / dt : 0;
    this.speed = Math.hypot(this.velocity.x, this.velocity.y);
    this.prevRaw.x = this.raw.x;
    this.prevRaw.y = this.raw.y;

    const idleFor = performance.now() - this.lastMoveAt;
    const shouldReturn = !this.inside || idleFor > POINTER.returnDelayMs;

    if (shouldReturn || !this.hasMoved) {
      const t = 1 - Math.exp(-dt / Math.max(0.05, POINTER.returnEase));
      this.target.x += (0 - this.target.x) * t;
      this.target.y += (0 - this.target.y) * t;
    } else {
      this.target.x = this.raw.x;
      this.target.y = this.raw.y;
    }
  }

  dispose(): void {
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerleave', this.onPointerLeave);
    this.element.removeEventListener('pointerenter', this.onPointerEnter);
    window.removeEventListener('blur', this.onPointerLeave);
  }
}
