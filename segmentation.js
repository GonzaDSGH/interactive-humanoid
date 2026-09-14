'use strict';

/* ==================================================================
   segmentation.js — ml5 BodySegmentation.

   This is the first analysis stage and the source of truth for "is a
   real human here, and which camera pixels are theirs".  The mask is
   never drawn: it is resampled into a float field that later stages
   weight with real camera information.

   The mask encoding differs between ml5 builds and maskType options
   (person-opaque vs background-opaque, alpha vs colour channel), so the
   channel and the polarity are detected at runtime instead of assumed.
   ================================================================== */

const Segmentation = {
  model: null,
  status: 'idle',          // idle | loading | ready | running | error
  errorMessage: '',
  result: null,
  resultCount: 0,
  lastResultAt: 0,
  intervalMs: 0,
  field: null,             // Float32Array(aw*ah), raw personness 0..1
  aw: 0,
  ah: 0,

  _gfx: null,
  _scratch: null,
  _scratchCtx: null,
  _consumed: -1,
  _useAlpha: true,
  _spreadAlpha: 0,
  _spreadColor: 0,
  _borderEma: 0,
  _borderInit: false,
  _invert: false,
  _samples: 0,

  init(video) {
    if (typeof ml5 === 'undefined' || !ml5.bodySegmentation) {
      this.status = 'error';
      this.errorMessage = 'ml5.js did not load (offline?). Body segmentation is unavailable.';
      return false;
    }
    this.status = 'loading';
    try {
      if (typeof ml5.setBackend === 'function') ml5.setBackend('webgl');
    } catch (e) { /* optional */ }

    try {
      /* ml5 calls this back as (result, error) */
      this.model = ml5.bodySegmentation(
        'SelfieSegmentation',
        { maskType: 'background' },
        (result, error) => {
          if (error) {
            this.status = 'error';
            this.errorMessage = 'the segmentation model could not be loaded: ' +
              (error.message || error);
            return;
          }
          this.status = 'ready';
          try {
            this.model.detectStart(video, (r) => this._onResult(r));
            this.status = 'running';
          } catch (err) {
            this.status = 'error';
            this.errorMessage = 'detectStart failed: ' + (err && err.message ? err.message : err);
          }
        }
      );
      /* the ready promise rejects on failure; the callback above reports it */
      if (this.model && this.model.ready && this.model.ready.catch) this.model.ready.catch(() => { });
    } catch (err) {
      this.status = 'error';
      this.errorMessage = 'bodySegmentation failed: ' + (err && err.message ? err.message : err);
      return false;
    }
    return true;
  },

  _onResult(result) {
    const now = performance.now();
    if (this.lastResultAt) {
      this.intervalMs = this.intervalMs * 0.85 + (now - this.lastResultAt) * 0.15;
    }
    this.lastResultAt = now;
    this.result = result;
    this.resultCount++;
  },

  resize(aw, ah) {
    this.aw = aw;
    this.ah = ah;
    this.field = new Float32Array(aw * ah);
    this._gfx = new PixelBuffer(aw, ah);
    this._consumed = -1;
  },

  hasFreshResult() {
    return this.result !== null && this.resultCount !== this._consumed;
  },

  /* Returns a drawable source for the current mask, whatever ml5 handed us. */
  _source() {
    const r = this.result;
    if (!r) return null;
    if (r.mask) return r.mask;
    const data = r.maskImageData || r.imageData || r.data;
    if (data && data.width && data.data) {
      if (!this._scratch || this._scratch.width !== data.width || this._scratch.height !== data.height) {
        this._scratch = document.createElement('canvas');
        this._scratch.width = data.width;
        this._scratch.height = data.height;
        this._scratchCtx = this._scratch.getContext('2d');
      }
      this._scratchCtx.putImageData(data, 0, 0);
      return this._scratch;
    }
    return null;
  },

  /* Resample the mask into the analysis grid, mirrored exactly once.
     Segmentation usually runs slower than the render loop, so this is a no-op
     until ml5 delivers a new result; `field` keeps the most recent mask. */
  sample(mirror) {
    if (!this.field) return false;
    if (!this.hasFreshResult()) return false;
    const src = this._source();
    if (!src) return false;

    const g = this._gfx;
    const aw = this.aw;
    const ah = this.ah;

    /* cleared first so the mask's own alpha survives the resample */
    if (!g.capture(src, mirror, true)) return false;
    const px = g.pixels;
    if (!px || px.length < aw * ah * 4) return false;

    this._detectEncoding(px, aw, ah);

    const off = this._useAlpha ? 3 : 0;
    const inv = this._invert;
    const field = this.field;
    for (let i = 0, p = off; i < field.length; i++, p += 4) {
      const v = px[p] * (1 / 255);
      field[i] = inv ? 1 - v : v;
    }
    this._consumed = this.resultCount;
    return true;
  },

  /* Which channel carries the mask, and which way round is it? */
  _detectEncoding(px, aw, ah) {
    let minA = 255, maxA = 0, minC = 255, maxC = 0;
    const step = 4 * 4; // every 4th pixel
    for (let p = 0; p < px.length; p += step) {
      const a = px[p + 3];
      const c = px[p];
      if (a < minA) minA = a;
      if (a > maxA) maxA = a;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
    }
    const sA = (maxA - minA) / 255;
    const sC = (maxC - minC) / 255;
    this._spreadAlpha = this._spreadAlpha * 0.9 + sA * 0.1;
    this._spreadColor = this._spreadColor * 0.9 + sC * 0.1;
    if (this._samples < 240) this._samples++;
    if (this._spreadAlpha > 0.02 || this._spreadColor > 0.02) {
      this._useAlpha = this._spreadAlpha >= this._spreadColor;
    }

    /* The background reliably touches the frame border, so whichever
       polarity keeps the border low is the "person" polarity. */
    const off = this._useAlpha ? 3 : 0;
    let sum = 0, n = 0;
    const rows = [0, 1, ah - 2, ah - 1];
    for (const y of rows) {
      if (y < 0 || y >= ah) continue;
      for (let x = 0; x < aw; x += 2) { sum += px[(y * aw + x) * 4 + off]; n++; }
    }
    const cols = [0, 1, aw - 2, aw - 1];
    for (const x of cols) {
      if (x < 0 || x >= aw) continue;
      for (let y = 0; y < ah; y += 2) { sum += px[(y * aw + x) * 4 + off]; n++; }
    }
    const border = n ? sum / n / 255 : 0;
    if (!this._borderInit) { this._borderEma = border; this._borderInit = true; }
    else this._borderEma = this._borderEma * 0.9 + border * 0.1;

    /* hysteresis so a person filling the frame cannot flip the polarity */
    if (this._borderEma > 0.62) this._invert = true;
    else if (this._borderEma < 0.38) this._invert = false;
  },

  encodingLabel() {
    return (this._useAlpha ? 'alpha' : 'rgb') + (this._invert ? '/inverted' : '/direct');
  },

  dispose() {
    if (this.model && typeof this.model.detectStop === 'function') {
      try { this.model.detectStop(); } catch (e) { /* ignore */ }
    }
    this.model = null;
    this.status = 'idle';
  }
};
