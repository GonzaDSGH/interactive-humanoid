'use strict';

/* ==================================================================
   poseAnalysis.js — optional ml5 BodyPose salience (?pose=1).

   Never drawn.  When enabled it reinforces limb continuity (shoulder →
   elbow → wrist, hip → knee → ankle) inside the segmentation mask, which
   keeps thin arms from breaking apart while they move quickly.
   ================================================================== */

const PoseAnalysis = {
  model: null,
  status: 'disabled',
  poses: [],
  poseCount: 0,
  field: null,
  aw: 0,
  ah: 0,

  _bones: [
    ['left_shoulder', 'right_shoulder'], ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
    ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
    ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip'], ['left_hip', 'right_hip'],
    ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'],
    ['right_hip', 'right_knee'], ['right_knee', 'right_ankle'],
    ['nose', 'left_shoulder'], ['nose', 'right_shoulder']
  ],

  init(video) {
    if (!QUERY.pose) { this.status = 'disabled'; return false; }
    if (typeof ml5 === 'undefined' || !ml5.bodyPose) { this.status = 'error'; return false; }
    this.status = 'loading';
    try {
      this.model = ml5.bodyPose('MoveNet', { flipped: false }, (result, error) => {
        if (error) { this.status = 'error'; return; }
        try {
          this.model.detectStart(video, (results) => {
            this.poses = results || [];
            this.poseCount = this.poses.length;
          });
          this.status = 'running';
        } catch (err) { this.status = 'error'; }
      });
      if (this.model && this.model.ready && this.model.ready.catch) this.model.ready.catch(() => { });
    } catch (err) {
      this.status = 'error';
      return false;
    }
    return true;
  },

  resize(aw, ah) {
    this.aw = aw;
    this.ah = ah;
    this.field = new Float32Array(aw * ah);
  },

  _stroke(x0, y0, x1, y1, radius, weight) {
    const aw = this.aw, ah = this.ah, f = this.field;
    const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    const r = Math.max(1, Math.round(radius));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = Math.round(x0 + (x1 - x0) * t);
      const cy = Math.round(y0 + (y1 - y0) * t);
      for (let y = -r; y <= r; y++) {
        const yy = cy + y;
        if (yy < 0 || yy >= ah) continue;
        for (let x = -r; x <= r; x++) {
          const xx = cx + x;
          if (xx < 0 || xx >= aw) continue;
          const d = Math.hypot(x, y) / (r + 0.001);
          if (d > 1) continue;
          const v = (1 - d) * weight;
          const idx = yy * aw + xx;
          if (f[idx] < v) f[idx] = v;
        }
      }
    }
  },

  update(mirror, videoW, videoH, dt) {
    if (!this.field) return;
    const f = this.field;
    const decay = Math.exp(-dt * 6.0);
    for (let i = 0; i < f.length; i++) f[i] *= decay;
    if (this.status !== 'running' || !this.poses.length || !videoW || !videoH) return;

    const sx = this.aw / videoW;
    const sy = this.ah / videoH;
    const radius = Math.max(1.5, this.ah * 0.020);

    for (const pose of this.poses) {
      const map = {};
      const pts = pose.keypoints || [];
      for (const p of pts) if (p && p.name) map[p.name] = p;
      for (const [a, b] of this._bones) {
        const pa = map[a], pb = map[b];
        if (!pa || !pb) continue;
        if ((pa.confidence || 0) < 0.3 || (pb.confidence || 0) < 0.3) continue;
        const ax = mirror ? (videoW - pa.x) * sx : pa.x * sx;
        const bx = mirror ? (videoW - pb.x) * sx : pb.x * sx;
        this._stroke(ax, pa.y * sy, bx, pb.y * sy, radius, 1.0);
      }
    }
  },

  dispose() {
    if (this.model && typeof this.model.detectStop === 'function') {
      try { this.model.detectStop(); } catch (e) { /* ignore */ }
    }
    this.model = null;
  }
};
