import { AttentionPose } from '../input/AttentionController';

const DEG = 180 / Math.PI;

export class DebugPanel {
  readonly enabled: boolean;
  private readonly el: HTMLElement | null;
  private frames = 0;
  private fpsAcc = 0;
  private fps = 0;

  constructor() {
    const params = new URLSearchParams(window.location.search);
    this.enabled = params.get('debug') === '1';
    this.el = document.getElementById('debug');
    if (this.enabled && this.el) {
      this.el.hidden = false;
    }
  }

  update(dt: number, pose: AttentionPose, pointer: { x: number; y: number }): void {
    if (!this.enabled || !this.el) return;

    this.frames++;
    this.fpsAcc += dt;
    if (this.fpsAcc >= 0.5) {
      this.fps = Math.round(this.frames / this.fpsAcc);
      this.frames = 0;
      this.fpsAcc = 0;
    }

    this.el.textContent = [
      `fps        ${this.fps}`,
      `pointer    ${pointer.x.toFixed(2)}, ${pointer.y.toFixed(2)}`,
      `speed      ${pose.pointerSpeed.toFixed(2)}`,
      `head yaw   ${(pose.head.yaw * DEG).toFixed(1)}°`,
      `head pitch ${(pose.head.pitch * DEG).toFixed(1)}°`,
      `neck yaw   ${(pose.neck.yaw * DEG).toFixed(1)}°`,
      `should yaw ${(pose.shoulders.yaw * DEG).toFixed(1)}°`,
      `torso yaw  ${(pose.torso.yaw * DEG).toFixed(1)}°`,
      `face shift ${pose.faceShift.x.toFixed(3)}, ${pose.faceShift.y.toFixed(3)}`,
    ].join('\n');
  }
}
