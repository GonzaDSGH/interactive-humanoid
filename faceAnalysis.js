'use strict';

/* ==================================================================
   faceAnalysis.js — ml5 FaceMesh used strictly as a salience map.

   No landmark, triangle, contour or wireframe is ever drawn.  The mesh
   only tells the particle system where facial information lives, so
   that eyes, brows, nose, mouth and jaw keep their density instead of
   flattening into a smooth oval head.
   ================================================================== */

const FaceAnalysis = {
  model: null,
  status: 'disabled',     // disabled | loading | running | error
  faces: [],
  faceCount: 0,
  field: null,
  aw: 0,
  ah: 0,
  _kernel: null,
  _kr: 0,

  /* MediaPipe FaceMesh groups that deserve extra particle density. */
  _groups: ['leftEye', 'rightEye', 'leftEyebrow', 'rightEyebrow', 'lips', 'leftIris', 'rightIris'],

  init(video) {
    if (!QUERY.face) { this.status = 'disabled'; return false; }
    if (typeof ml5 === 'undefined' || !ml5.faceMesh) { this.status = 'error'; return false; }
    this.status = 'loading';
    try {
      this.model = ml5.faceMesh(
        { maxFaces: 2, refineLandmarks: false, flipped: false },
        (result, error) => {
          if (error) { this.status = 'error'; return; }
          try {
            this.model.detectStart(video, (results) => {
              this.faces = results || [];
              this.faceCount = this.faces.length;
            });
            this.status = 'running';
          } catch (err) {
            this.status = 'error';
          }
        }
      );
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
    this._buildKernel(Math.max(1, Math.round(CONFIG.analysis.faceRadius * (ah / 192))));
  },

  _buildKernel(r) {
    this._kr = r;
    const size = r * 2 + 1;
    const k = new Float32Array(size * size);
    const sigma = Math.max(0.6, r * 0.62);
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        k[(y + r) * size + (x + r)] = Math.exp(-(x * x + y * y) / (2 * sigma * sigma));
      }
    }
    this._kernel = k;
  },

  _splat(px, py, weight) {
    const r = this._kr;
    const size = r * 2 + 1;
    const aw = this.aw, ah = this.ah;
    const cx = Math.round(px), cy = Math.round(py);
    if (cx < -r || cy < -r || cx > aw + r || cy > ah + r) return;
    const f = this.field, k = this._kernel;
    for (let y = -r; y <= r; y++) {
      const yy = cy + y;
      if (yy < 0 || yy >= ah) continue;
      const row = yy * aw;
      const krow = (y + r) * size;
      for (let x = -r; x <= r; x++) {
        const xx = cx + x;
        if (xx < 0 || xx >= aw) continue;
        f[row + xx] += k[krow + x + r] * weight;
      }
    }
  },

  /* Project video-pixel landmarks into the mirrored analysis grid. */
  update(mirror, videoW, videoH, dt) {
    if (!this.field) return;
    const f = this.field;
    const decay = Math.exp(-dt * 7.0);
    for (let i = 0; i < f.length; i++) f[i] *= decay;

    if (this.status !== 'running' || !this.faces.length || !videoW || !videoH) return;
    const sx = this.aw / videoW;
    const sy = this.ah / videoH;

    for (const face of this.faces) {
      const pts = face && face.keypoints;
      if (!pts) continue;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const x = mirror ? (videoW - p.x) * sx : p.x * sx;
        this._splat(x, p.y * sy, 0.55);
      }
      for (const name of this._groups) {
        const grp = face[name];
        const gpts = grp && grp.keypoints;
        if (!gpts) continue;
        for (let i = 0; i < gpts.length; i++) {
          const p = gpts[i];
          const x = mirror ? (videoW - p.x) * sx : p.x * sx;
          this._splat(x, p.y * sy, 1.15);
        }
      }
    }
    for (let i = 0; i < f.length; i++) if (f[i] > 1) f[i] = 1;
  },

  dispose() {
    if (this.model && typeof this.model.detectStop === 'function') {
      try { this.model.detectStop(); } catch (e) { /* ignore */ }
    }
    this.model = null;
  }
};
