'use strict';

/* ==================================================================
   analysis.js — turns the live camera + the person mask into the float
   fields that drive every particle.

     importance = person * (base + luminance + local contrast + edges
                            + face salience + pose salience + motion)

   Nothing here is ever drawn.  The buffers are packed into three small
   RGBA textures that the vertex shaders sample.
   ================================================================== */

/* ------------------------------------------------------------------
   PixelBuffer — a small CPU-side sampling surface.

   Both analysis readbacks happen every frame, so these canvases are
   created with willReadFrequently: true.  Without it the browser keeps
   the surface on the GPU and every getImageData becomes a stall.
   p5 still owns the visible canvas and the whole render loop; this is
   purely the measurement path.
   ------------------------------------------------------------------ */
function PixelBuffer(w, h) {
  this.canvas = document.createElement('canvas');
  this.canvas.width = w;
  this.canvas.height = h;
  this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  this.ctx.imageSmoothingEnabled = true;
  this.w = w;
  this.h = h;
  this.pixels = null;
}

/* Draw any source into the buffer, mirrored exactly once when asked. */
PixelBuffer.prototype.capture = function (source, mirror, clearFirst) {
  const el = (source && source.elt) || (source && source.canvas) || source;
  if (!el) return false;
  const ctx = this.ctx;
  if (clearFirst) ctx.clearRect(0, 0, this.w, this.h);
  ctx.save();
  if (mirror) {
    ctx.translate(this.w, 0);
    ctx.scale(-1, 1);
  }
  try {
    ctx.drawImage(el, 0, 0, this.w, this.h);
  } catch (e) {
    ctx.restore();
    return false;
  }
  ctx.restore();
  this.pixels = ctx.getImageData(0, 0, this.w, this.h).data;
  return true;
};

const Analysis = {
  aw: 0, ah: 0, n: 0,

  lum: null, lumPrev: null, lumBlur: null,
  contrast: null, edge: null, motion: null,
  person: null, personBlur: null, personEdge: null, held: null,
  aura: null, importance: null,
  flowX: null, flowY: null,
  _tmp: null, _tmp2: null,

  texA: null, texB: null, texC: null,

  personArea: 0,
  presence: 0,
  motionEnergy: 0,
  centroidX: 0.5,
  centroidY: 0.5,
  _latched: false,
  _primed: false,

  resize(aw, ah) {
    this.aw = aw; this.ah = ah;
    const n = this.n = aw * ah;
    const f = () => new Float32Array(n);
    this.lum = f(); this.lumPrev = f(); this.lumBlur = f();
    this.contrast = f(); this.edge = f(); this.motion = f();
    this.person = f(); this.personBlur = f(); this.personEdge = f(); this.held = f();
    this.aura = f(); this.importance = f();
    this.flowX = f(); this.flowY = f();
    this._tmp = f(); this._tmp2 = f();
    this.texA = new Uint8Array(n * 4);
    this.texB = new Uint8Array(n * 4);
    this.texC = new Uint8Array(n * 4);
    this._primed = false;
    this.presence = 0;
    this._latched = false;
  },

  /* ---- stage 1: real camera luminance (already mirrored upstream) ---- */
  readLuminance(px) {
    const lum = this.lum, prev = this.lumPrev, n = this.n;
    prev.set(lum);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      lum[i] = (px[p] * 0.2126 + px[p + 1] * 0.7152 + px[p + 2] * 0.0722) * (1 / 255);
    }
    if (!this._primed) { prev.set(lum); this._primed = true; }
  },

  /* ---- stage 2: every derived field ---- */
  update(dt, personRaw, faceField, poseField) {
    const A = CONFIG.analysis;
    const aw = this.aw, ah = this.ah, n = this.n;
    const lum = this.lum, prev = this.lumPrev;

    /* local contrast = |luminance - blurred luminance| */
    this._boxBlur(lum, this.lumBlur, A.contrastRadius);
    const contrast = this.contrast, lumBlur = this.lumBlur;
    for (let i = 0; i < n; i++) {
      const c = Math.abs(lum[i] - lumBlur[i]) * A.contrastGain;
      contrast[i] = c > 1 ? 1 : c;
    }

    this._sobel(lum, this.edge, A.edgeGain);

    /* motion energy with decay, plus a Lucas-Kanade style flow estimate */
    const motion = this.motion, flowX = this.flowX, flowY = this.flowY;
    const decay = Math.pow(A.motionDecay, Math.max(0.25, dt * 60));
    let motionSum = 0;
    for (let y = 0; y < ah; y++) {
      const row = y * aw;
      const up = (y > 0 ? y - 1 : 0) * aw;
      const dn = (y < ah - 1 ? y + 1 : ah - 1) * aw;
      for (let x = 0; x < aw; x++) {
        const i = row + x;
        const xl = row + (x > 0 ? x - 1 : 0);
        const xr = row + (x < aw - 1 ? x + 1 : aw - 1);
        const ft = lum[i] - prev[i];
        let m = Math.abs(ft) * A.motionGain;
        if (m > 1) m = 1;
        const d = motion[i] * decay;
        motion[i] = m > d ? m : d;
        motionSum += motion[i];

        const fx = (lum[xr] - lum[xl]) * 0.5;
        const fy = (lum[dn + x] - lum[up + x]) * 0.5;
        const denom = fx * fx + fy * fy + 0.0015;
        let vx = -ft * fx / denom;
        let vy = -ft * fy / denom;
        vx = vx < -1 ? -1 : vx > 1 ? 1 : vx;
        vy = vy < -1 ? -1 : vy > 1 ? 1 : vy;
        flowX[i] += (vx - flowX[i]) * 0.35;
        flowY[i] += (vy - flowY[i]) * 0.35;
      }
    }
    this.motionEnergy = motionSum / n;

    /* person mask: fast to accept, slow to release (jitter + dissolve) */
    const person = this.person, held = this.held;
    const rise = 1 - Math.pow(1 - A.personRise, Math.max(0.25, dt * 60));
    const fall = 1 - Math.pow(1 - A.personFall, Math.max(0.25, dt * 60));
    const holdDecay = Math.exp(-dt * 1.7);
    let area = 0, cx = 0, cy = 0, wsum = 0;
    for (let i = 0; i < n; i++) {
      const raw = personRaw ? personRaw[i] : 0;
      const p = person[i];
      person[i] = p + (raw - p) * (raw > p ? rise : fall);
      const v = person[i];
      const h = held[i] * holdDecay;
      held[i] = v > h ? v : h;
      if (v > 0.35) {
        area++;
        const x = i % aw, y = (i / aw) | 0;
        cx += x * v; cy += y * v; wsum += v;
      }
    }
    this.personArea = area / n;
    if (wsum > 0) {
      const tx = cx / wsum / aw, ty = cy / wsum / ah;
      this.centroidX += (tx - this.centroidX) * Math.min(1, dt * 4);
      this.centroidY += (ty - this.centroidY) * Math.min(1, dt * 4);
    }

    /* presence latch with hysteresis: no person => no human particles */
    if (this.personArea > A.presenceEnter) this._latched = true;
    else if (this.personArea < A.presenceExit) this._latched = false;
    const target = this._latched ? 1 : 0;
    const rate = target > this.presence ? A.presenceRise : A.presenceFall;
    this.presence += (target - this.presence) * Math.min(1, dt * rate * 3);
    this.presence = Math.max(0, Math.min(1, this.presence));

    /* silhouette = gradient of the mask, aura = blurred mask minus mask */
    this._gradient(person, this.personEdge, 2.2);
    this._boxBlur(person, this.personBlur, A.auraRadius);
    const aura = this.aura, personBlur = this.personBlur;
    for (let i = 0; i < n; i++) {
      let a = (personBlur[i] - person[i]) * A.auraGain;
      aura[i] = a < 0 ? 0 : a > 1 ? 1 : a;
    }

    /* the importance field */
    const imp = this.importance;
    const edge = this.edge;
    const face = faceField;
    const pose = poseField;
    for (let i = 0; i < n; i++) {
      const p = person[i];
      if (p <= 0.004) { imp[i] = 0; continue; }
      let v = A.base
        + A.lumWeight * lum[i]
        + A.contrastWeight * contrast[i]
        + A.edgeWeight * edge[i]
        + A.motionWeight * motion[i];
      if (face) v += A.faceWeight * face[i];
      if (pose) v += A.poseWeight * pose[i];
      v *= p;
      imp[i] = v > 1 ? 1 : v;
    }
  },

  /* ---- stage 3: pack into GPU textures ---- */
  pack() {
    const n = this.n;
    const A = this.texA, B = this.texB, C = this.texC;
    const imp = this.importance, person = this.person, motion = this.motion, lum = this.lum;
    const edge = this.edge, contrast = this.contrast, personEdge = this.personEdge;
    const aura = this.aura, held = this.held, fx = this.flowX, fy = this.flowY;
    const face = FaceAnalysis.field;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      A[p] = imp[i] * 255;
      A[p + 1] = person[i] * 255;
      A[p + 2] = motion[i] * 255;
      A[p + 3] = lum[i] * 255;

      B[p] = edge[i] * 255;
      B[p + 1] = contrast[i] * 255;
      B[p + 2] = face ? face[i] * 255 : 0;
      B[p + 3] = personEdge[i] * 255;

      C[p] = aura[i] * 255;
      C[p + 1] = held[i] * 255;
      C[p + 2] = (fx[i] * 0.5 + 0.5) * 255;
      C[p + 3] = (fy[i] * 0.5 + 0.5) * 255;
    }
  },

  /* ---- helpers ---- */
  _boxBlur(src, dst, r) {
    const w = this.aw, h = this.ah, tmp = this._tmp;
    const norm = 1 / (2 * r + 1);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = sum * norm;
        sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        dst[y * w + x] = sum * norm;
        sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
  },

  _sobel(src, dst, gain) {
    const w = this.aw, h = this.ah;
    for (let y = 0; y < h; y++) {
      const y0 = (y > 0 ? y - 1 : 0) * w;
      const y1 = y * w;
      const y2 = (y < h - 1 ? y + 1 : h - 1) * w;
      for (let x = 0; x < w; x++) {
        const x0 = x > 0 ? x - 1 : 0;
        const x2 = x < w - 1 ? x + 1 : w - 1;
        const gx = (src[y0 + x2] + 2 * src[y1 + x2] + src[y2 + x2])
                 - (src[y0 + x0] + 2 * src[y1 + x0] + src[y2 + x0]);
        const gy = (src[y2 + x0] + 2 * src[y2 + x] + src[y2 + x2])
                 - (src[y0 + x0] + 2 * src[y0 + x] + src[y0 + x2]);
        const m = Math.sqrt(gx * gx + gy * gy) * gain * 0.25;
        dst[y1 + x] = m > 1 ? 1 : m;
      }
    }
  },

  _gradient(src, dst, gain) {
    const w = this.aw, h = this.ah;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      const up = (y > 0 ? y - 1 : 0) * w;
      const dn = (y < h - 1 ? y + 1 : h - 1) * w;
      for (let x = 0; x < w; x++) {
        const xl = row + (x > 0 ? x - 1 : 0);
        const xr = row + (x < w - 1 ? x + 1 : w - 1);
        const gx = src[xr] - src[xl];
        const gy = src[dn + x] - src[up + x];
        const m = Math.sqrt(gx * gx + gy * gy) * gain;
        dst[row + x] = m > 1 ? 1 : m;
      }
    }
  }
};
