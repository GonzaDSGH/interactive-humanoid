/**
 * Camera layer.
 *
 * The webcam is a data source and nothing else: the capture element is hidden,
 * never drawn to the visible canvas, and read only into an offscreen
 * p5.Graphics ("processing buffer") at a low working resolution.
 *
 * Mirroring happens exactly once, here, when the frame is blitted into that
 * buffer. The same mirrored buffer is then handed to ml5, so the mask and the
 * luminance we sample always live in the same coordinate space. (p5's
 * `{flipped:true}` only mirrors p5's own internal read of the element, which
 * would desynchronise it from ml5's read of the raw video — see README.)
 */
(function (global) {
  'use strict';

  var CameraError = {
    NotAllowedError: {
      title: 'Camera permission denied',
      message: 'The browser blocked access to the webcam. Allow camera access for this page and try again.'
    },
    NotFoundError: {
      title: 'No camera found',
      message: 'No webcam is connected, or the browser cannot see one.'
    },
    NotReadableError: {
      title: 'Camera is busy',
      message: 'Another application is already using the webcam. Close it and try again.'
    },
    OverconstrainedError: {
      title: 'Camera resolution unavailable',
      message: 'The camera cannot deliver the requested resolution.'
    },
    SecurityError: {
      title: 'Camera blocked by the browser',
      message: 'Camera access needs a secure context. Serve this page over https:// or http://localhost.'
    }
  };

  var Camera = {
    capture: null,
    width: 0,
    height: 0,
    proc: null,
    procW: 0,
    procH: 0,

    describeError: function (err) {
      var known = err && CameraError[err.name];
      if (known) return known;
      return {
        title: 'Camera could not be started',
        message: 'The webcam stream failed to start.'
      };
    },

    /**
     * Ask for permission up front so a denial produces a real, named error
     * instead of a silent console warning inside p5's createCapture().
     */
    requestPermission: async function (cfg) {
      if (!global.navigator || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        var e = new Error('getUserMedia is not available in this browser.');
        e.name = 'SecurityError';
        throw e;
      }
      var stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: cfg.idealWidth },
          height: { ideal: cfg.idealHeight }
        }
      });
      // Release it immediately; p5 opens its own stream next.
      stream.getTracks().forEach(function (t) { t.stop(); });
      await new Promise(function (r) { setTimeout(r, 120); });
    },

    /** Start the p5 capture. The element is hidden and stays hidden. */
    start: function (p, cfg) {
      var capture = p.createCapture(p.VIDEO, {
        audio: false,
        video: {
          width: { ideal: cfg.idealWidth },
          height: { ideal: cfg.idealHeight }
        },
        // Requested for mirror-like behaviour; the pipeline mirrors explicitly
        // anyway so the data path never depends on it.
        flipped: true
      });
      capture.hide();
      capture.elt.setAttribute('playsinline', '');
      capture.elt.muted = true;
      this.capture = capture;
      return capture;
    },

    /** Resolve once the video element actually has pixels, or reject. */
    waitUntilReady: function (timeoutMs) {
      var self = this;
      return new Promise(function (resolve, reject) {
        var started = Date.now();
        (function poll() {
          var elt = self.capture && self.capture.elt;
          if (elt && elt.videoWidth > 0 && elt.videoHeight > 0 && elt.readyState >= 2) {
            self.width = elt.videoWidth;
            self.height = elt.videoHeight;
            // p5 sizes the element from metadata; keep it authoritative.
            self.capture.width = self.width;
            self.capture.height = self.height;
            resolve({ width: self.width, height: self.height });
            return;
          }
          if (Date.now() - started > timeoutMs) {
            reject(new Error('The webcam stream never produced a frame (' +
              Math.round(timeoutMs / 1000) + 's timeout).'));
            return;
          }
          setTimeout(poll, 100);
        })();
      });
    },

    /** Allocate the offscreen buffer everything downstream reads from. */
    createProcessingBuffer: function (p, w, h) {
      if (this.proc) this.proc.remove();
      this.procW = w;
      this.procH = h;
      this.proc = p.createGraphics(w, h);
      this.proc.pixelDensity(1);
      this.proc.noSmooth();
      this.proc.background(0);
      return this.proc;
    },

    /**
     * Blit the current camera frame into the processing buffer, mirrored.
     * Reads capture.elt (the raw <video>) directly, bypassing p5's own
     * flip-aware canvas so there is exactly one mirror in the pipeline.
     */
    blitMs: 0,
    readMs: 0,

    update: function () {
      if (!this.proc || !this.capture) return false;
      var elt = this.capture.elt;
      if (!elt || elt.videoWidth === 0) return false;

      var t0 = performance.now();
      var ctx = this.proc.drawingContext;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(elt, -this.procW, 0, this.procW, this.procH);
      ctx.restore();
      var t1 = performance.now();
      this.proc.loadPixels();
      var t2 = performance.now();
      this.blitMs += (t1 - t0 - this.blitMs) * 0.1;
      this.readMs += (t2 - t1 - this.readMs) * 0.1;
      return true;
    },

    stop: function () {
      if (this.capture && this.capture.elt && this.capture.elt.srcObject) {
        this.capture.elt.srcObject.getTracks().forEach(function (t) { t.stop(); });
      }
      if (this.capture) {
        this.capture.remove();
        this.capture = null;
      }
    }
  };

  global.CPB = global.CPB || {};
  global.CPB.Camera = Camera;
})(window);
