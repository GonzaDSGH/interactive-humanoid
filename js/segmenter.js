/**
 * ml5.js BodySegmentation wrapper — the only machine-learning layer.
 *
 * Model:   ml5.bodySegmentation("SelfieSegmentation")
 * Task:    person vs. background (no body-part classification)
 * Input:   the mirrored processing canvas produced by camera.js
 * Output:  a Float32Array of person probability, resampled to the processing
 *          resolution, reused in place (no per-frame allocation on our side).
 */
(function (global) {
  'use strict';

  var Segmenter = {
    model: null,
    running: false,
    loaded: false,

    mask: null,        // Float32Array(procW * procH), 0..1
    procW: 0,
    procH: 0,

    sourceW: 0,        // native size of the mask returned by ml5
    sourceH: 0,
    channel: -1,       // which RGBA byte carries the person signal (auto-probed)
    resultCount: 0,
    lastResultAt: 0,
    lastLatencyMs: 0,
    coverage: 0,       // fraction of mask pixels above 0.5
    error: null,

    _xMap: null,       // nearest-neighbour lookup tables, allocated once
    _yMap: null,
    _pendingAt: 0,

    load: async function (cfg) {
      if (typeof global.ml5 === 'undefined' || !global.ml5.bodySegmentation) {
        throw new Error('ml5.bodySegmentation is not available.');
      }

      var options = {
        runtime: cfg.runtime,
        modelType: cfg.modelType,
        maskType: cfg.maskType,
        flipped: cfg.flipped
      };

      var self = this;
      var model = global.ml5.bodySegmentation(cfg.model, options);

      var timeout = new Promise(function (_, reject) {
        setTimeout(function () {
          reject(new Error('The segmentation model did not finish loading within ' +
            Math.round(cfg.loadTimeoutMs / 1000) + 's.'));
        }, cfg.loadTimeoutMs);
      });

      await Promise.race([model.ready, timeout]);
      self.model = model;
      self.loaded = true;
      return model;
    },

    /** Allocate the mask buffer for a given processing resolution. */
    resize: function (procW, procH) {
      this.procW = procW;
      this.procH = procH;
      this.mask = new Float32Array(procW * procH);
      this._xMap = null;
      this._yMap = null;
    },

    /** Begin the continuous detection loop on the mirrored camera canvas. */
    start: function (canvasElement) {
      if (!this.model) throw new Error('Segmentation model is not loaded.');
      var self = this;
      this._pendingAt = performance.now();
      this.model.detectStart(canvasElement, function (result) {
        self._onResult(result);
      });
      this.running = true;
    },

    stop: function () {
      if (this.model && this.running) this.model.detectStop();
      this.running = false;
    },

    _onResult: function (result) {
      var now = performance.now();
      this.lastLatencyMs = now - this._pendingAt;
      this._pendingAt = now;
      this.lastResultAt = now;
      this.resultCount++;

      var img = result && result.imageData;
      if (!img || !img.width) {
        this.mask.fill(0);
        this.coverage = 0;
        return;
      }

      if (this.channel < 0) this.channel = this._probeChannel(img);
      if (img.width !== this.sourceW || img.height !== this.sourceH) {
        this.sourceW = img.width;
        this.sourceH = img.height;
        this._buildMaps();
      }

      this._resample(img);
    },

    /**
     * Different ml5/tfjs runtimes put the person probability in different
     * bytes of the returned ImageData (luminance in R, or coverage in A).
     * Probe once and use whichever channel actually carries signal.
     */
    _probeChannel: function (img) {
      var d = img.data;
      var step = Math.max(4, (Math.floor(d.length / 4 / 2048) | 0) * 4);
      var minR = 255, maxR = 0, minA = 255, maxA = 0;
      for (var i = 0; i < d.length; i += step) {
        var r = d[i], a = d[i + 3];
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (a < minA) minA = a;
        if (a > maxA) maxA = a;
      }
      var spreadR = maxR - minR;
      var spreadA = maxA - minA;
      // Prefer the red channel when both carry signal: it is the soft
      // probability, while alpha is often already thresholded.
      if (spreadR >= 8) return 0;
      if (spreadA >= 8) return 3;
      return 0;
    },

    _buildMaps: function () {
      var i;
      this._xMap = new Int32Array(this.procW);
      for (i = 0; i < this.procW; i++) {
        this._xMap[i] = Math.min(this.sourceW - 1,
          Math.floor((i + 0.5) * this.sourceW / this.procW));
      }
      this._yMap = new Int32Array(this.procH);
      for (i = 0; i < this.procH; i++) {
        this._yMap[i] = Math.min(this.sourceH - 1,
          Math.floor((i + 0.5) * this.sourceH / this.procH));
      }
    },

    _resample: function (img) {
      var data = img.data;
      var mask = this.mask;
      var xMap = this._xMap;
      var yMap = this._yMap;
      var sw = this.sourceW;
      var ch = this.channel;
      var pw = this.procW;
      var ph = this.procH;
      var inv = 1 / 255;
      var covered = 0;

      for (var y = 0; y < ph; y++) {
        var srcRow = yMap[y] * sw;
        var dstRow = y * pw;
        for (var x = 0; x < pw; x++) {
          var v = data[((srcRow + xMap[x]) << 2) + ch] * inv;
          mask[dstRow + x] = v;
          if (v > 0.5) covered++;
        }
      }
      this.coverage = covered / (pw * ph);
    },

    /** True when a fresh result arrived recently enough to trust. */
    isLive: function (maxAgeMs) {
      return this.resultCount > 0 && (performance.now() - this.lastResultAt) < maxAgeMs;
    }
  };

  global.CPB = global.CPB || {};
  global.CPB.Segmenter = Segmenter;
})(window);
