/**
 * Image field analysis.
 *
 * Turns the mirrored camera buffer + the person mask into a per-grid-cell
 * "importance" value:
 *
 *   importance = personMask * (base + luminance + localContrast + edge)
 *
 * Luminance, local contrast and the Sobel edge estimate are computed at the
 * (finer) processing resolution and only then reduced onto the particle grid,
 * so a particle can still be told apart from its neighbours by internal
 * detail — eyes, mouth, jaw, collar, arm boundaries — instead of by the
 * silhouette alone.
 *
 * Every buffer is a typed array allocated once per resize.
 */
(function (global) {
  'use strict';

  function smoothstep(a, b, x) {
    if (b <= a) return x < a ? 0 : 1;
    var t = (x - a) / (b - a);
    if (t < 0) t = 0; else if (t > 1) t = 1;
    return t * t * (3 - 2 * t);
  }

  var Field = {
    procW: 0, procH: 0,
    gridW: 0, gridH: 0,
    ss: 2,

    lum: null,      // 0..1 luminance, processing resolution
    blur: null,     // box-blurred luminance
    tmp: null,
    edge: null,     // Sobel magnitude 0..1
    subX: null, addX: null, subY: null, addY: null,
    _clampRadius: -1,

    gMask: null,    // temporally smoothed person mask, grid resolution
    gLum: null,
    gContrast: null,
    gEdge: null,
    importance: null,

    activeCells: 0,

    resize: function (procW, procH, gridW, gridH, ss) {
      this.procW = procW;
      this.procH = procH;
      this.gridW = gridW;
      this.gridH = gridH;
      this.ss = ss;

      var p = procW * procH;
      var g = gridW * gridH;

      this.lum = new Float32Array(p);
      this.blur = new Float32Array(p);
      this.tmp = new Float32Array(p);
      this.edge = new Float32Array(p);
      this._clampRadius = -1;

      this.gMask = new Float32Array(g);
      this.gLum = new Float32Array(g);
      this.gContrast = new Float32Array(g);
      this.gEdge = new Float32Array(g);
      this.importance = new Float32Array(g);
    },

    /** Rec.709 luminance straight out of the p5.Graphics pixel array. */
    computeLuminance: function (pixels) {
      var lum = this.lum;
      var n = lum.length;
      for (var i = 0, j = 0; i < n; i++, j += 4) {
        lum[i] = (0.2126 * pixels[j] + 0.7152 * pixels[j + 1] + 0.0722 * pixels[j + 2]) * 0.00392156862745098;
      }
    },

    /**
     * Separable box blur; the reference for local contrast.
     * Edge clamping is precomputed into lookup tables so the inner loops stay
     * free of branches and Math calls.
     */
    _buildClampTables: function (radius) {
      if (this._clampRadius === radius) return;
      this._clampRadius = radius;
      var w = this.procW, h = this.procH, i;

      this.subX = new Int32Array(w);
      this.addX = new Int32Array(w);
      for (i = 0; i < w; i++) {
        this.subX[i] = Math.min(w - 1, Math.max(0, i - radius));
        this.addX[i] = Math.min(w - 1, Math.max(0, i + radius + 1));
      }
      this.subY = new Int32Array(h);
      this.addY = new Int32Array(h);
      for (i = 0; i < h; i++) {
        this.subY[i] = Math.min(h - 1, Math.max(0, i - radius)) * w;
        this.addY[i] = Math.min(h - 1, Math.max(0, i + radius + 1)) * w;
      }
    },

    blurLuminance: function (radius) {
      var w = this.procW, h = this.procH;
      var src = this.lum, tmp = this.tmp, dst = this.blur;
      var r = radius | 0;
      var invW = 1 / (r * 2 + 1);
      var x, y, row, sum, i;

      this._buildClampTables(r);
      var subX = this.subX, addX = this.addX, subY = this.subY, addY = this.addY;

      for (y = 0; y < h; y++) {
        row = y * w;
        sum = src[row] * r;
        for (i = 0; i <= r; i++) sum += src[row + (i < w ? i : w - 1)];
        for (x = 0; x < w; x++) {
          tmp[row + x] = sum * invW;
          sum += src[row + addX[x]] - src[row + subX[x]];
        }
      }

      for (x = 0; x < w; x++) {
        sum = tmp[x] * r;
        for (i = 0; i <= r; i++) sum += tmp[(i < h ? i : h - 1) * w + x];
        for (y = 0; y < h; y++) {
          dst[y * w + x] = sum * invW;
          sum += tmp[addY[y] + x] - tmp[subY[y] + x];
        }
      }
    },

    /** 3x3 Sobel magnitude, normalised so a hard black/white edge is ~1. */
    computeEdges: function () {
      var w = this.procW, h = this.procH;
      var lum = this.lum, edge = this.edge;
      edge.fill(0);
      for (var y = 1; y < h - 1; y++) {
        var r0 = (y - 1) * w, r1 = y * w, r2 = (y + 1) * w;
        for (var x = 1; x < w - 1; x++) {
          var tl = lum[r0 + x - 1], tc = lum[r0 + x], tr = lum[r0 + x + 1];
          var ml = lum[r1 + x - 1], mr = lum[r1 + x + 1];
          var bl = lum[r2 + x - 1], bc = lum[r2 + x], br = lum[r2 + x + 1];
          var gx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
          var gy = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
          edge[r1 + x] = Math.sqrt(gx * gx + gy * gy) * 0.25;
        }
      }
    },

    /**
     * Reduce the processing-resolution fields onto the particle grid and
     * combine them into importance. `mask` is the segmenter output at
     * processing resolution.
     */
    reduce: function (mask, cfg, dtScale) {
      var gw = this.gridW, gh = this.gridH, ss = this.ss, pw = this.procW;
      var lum = this.lum, blur = this.blur, edge = this.edge;
      var gMask = this.gMask, gLum = this.gLum, gCon = this.gContrast, gEdge = this.gEdge;
      var imp = this.importance;

      var inv = 1 / (ss * ss);
      var kMask = global.CPB.rate(cfg.smoothing.mask, dtScale);
      var w = cfg.importance;
      var lo = w.maskThreshold - w.maskSoftness;
      var hi = w.maskThreshold + w.maskSoftness;
      var active = 0;

      for (var gy = 0; gy < gh; gy++) {
        var baseY = gy * ss;
        for (var gx = 0; gx < gw; gx++) {
          var baseX = gx * ss;
          var mSum = 0, lSum = 0, eMax = 0, cMax = 0;

          for (var sy = 0; sy < ss; sy++) {
            var row = (baseY + sy) * pw + baseX;
            for (var sx = 0; sx < ss; sx++) {
              var idx = row + sx;
              mSum += mask[idx];
              var l = lum[idx];
              lSum += l;
              var e = edge[idx];
              if (e > eMax) eMax = e;
              var c = l - blur[idx];
              if (c < 0) c = -c;
              if (c > cMax) cMax = c;
            }
          }

          var gi = gy * gw + gx;
          var mAvg = mSum * inv;
          gMask[gi] += (mAvg - gMask[gi]) * kMask;

          var lVal = lSum * inv;
          var cVal = cMax * w.contrastGain; if (cVal > 1) cVal = 1;
          var eVal = eMax * w.edgeGain; if (eVal > 1) eVal = 1;

          gLum[gi] = lVal;
          gCon[gi] = cVal;
          gEdge[gi] = eVal;

          var gate = smoothstep(lo, hi, gMask[gi]);
          var value = 0;
          if (gate > 0) {
            value = gate * (w.base + w.lumWeight * lVal + w.contrastWeight * cVal + w.edgeWeight * eVal);
            if (value > w.max) value = w.max;
            active++;
          }
          imp[gi] = value;
        }
      }
      this.activeCells = active;
    },

    update: function (pixels, mask, cfg, dtScale) {
      this.computeLuminance(pixels);
      this.blurLuminance(cfg.importance.blurRadius);
      this.computeEdges();
      this.reduce(mask, cfg, dtScale);
    }
  };

  Field.smoothstep = smoothstep;

  global.CPB = global.CPB || {};
  global.CPB.Field = Field;
})(window);
