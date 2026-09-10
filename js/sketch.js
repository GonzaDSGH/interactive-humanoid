/**
 * Camera Particle Body — p5.js runtime.
 *
 * p5 owns setup(), draw(), the fullscreen canvas, the webcam capture, resizing
 * and the animation lifecycle. ml5 is called only to segment person from
 * background. There is no mouse input, no microphone input, and no 3D model:
 * the live camera is the sole source of the figure.
 *
 * Pipeline, once per frame:
 *   video -> mirrored processing buffer -> luminance / contrast / Sobel
 *         -> combined with the ml5 person mask -> per-cell importance
 *         -> persistent particles -> additive canvas draw
 */
(function (global) {
  'use strict';

  var CPB = global.CPB;
  var CONFIG = CPB.CONFIG;

  var STATE = {
    IDLE: 'idle',
    STARTING: 'starting',
    RUNNING: 'running',
    ERROR: 'error'
  };

  var noise2d = null;   // p5's Perlin noise, bound once

  var app = {
    state: STATE.IDLE,
    p: null,
    ctx: null,
    gridW: 0,
    gridH: 0,
    procW: 0,
    procH: 0,
    cameraW: 0,
    cameraH: 0,
    viewW: 0,
    viewH: 0,
    visible: 0,
    firstMaskAt: 0,
    stallFrames: 0
  };

  /** Deterministic PRNG so the particle dither pattern is reproducible. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function fail(title, message, detail) {
    app.state = STATE.ERROR;
    CPB.Segmenter.stop();
    CPB.UI.showError(title, message, detail);
  }

  // -----------------------------------------------------------------------
  // p5 lifecycle
  // -----------------------------------------------------------------------

  global.setup = function () {
    var p = global;                     // p5 global mode
    app.p = p;

    p.pixelDensity(CONFIG.render.pixelDensity);
    var canvas = p.createCanvas(p.windowWidth, p.windowHeight);
    canvas.parent('stage');
    app.ctx = p.drawingContext;
    noise2d = p.noise.bind(p);
    app.viewW = p.width;
    app.viewH = p.height;

    p.noStroke();
    p.background(CONFIG.render.background[0], CONFIG.render.background[1], CONFIG.render.background[2]);
    p.frameRate(60);

    CPB.UI.init({ onStart: start });

    var boot = global.__CPB_BOOT__;
    if (boot && boot.libErrors.length) {
      fail('A required library failed to load',
        'Could not load ' + boot.libErrors.join(' and ') + '. Check the network connection and reload.');
      return;
    }
    if (typeof global.ml5 === 'undefined' || !global.ml5.bodySegmentation) {
      fail('ml5.js is unavailable',
        'ml5 loaded without a bodySegmentation API, so the person mask cannot be produced.');
      return;
    }

    CPB.UI.showActivation();
  };

  global.draw = function () {
    var p = app.p;
    if (!p) return;

    var bg = CONFIG.render.background;
    p.background(bg[0], bg[1], bg[2]);

    if (app.state === STATE.RUNNING) {
      step();
    }

    if (CONFIG.debug && app.state !== STATE.ERROR) {
      CPB.Debug.sample(p.deltaTime);
      CPB.Debug.draw(p, {
        segmenter: CPB.Segmenter,
        cameraW: app.cameraW,
        cameraH: app.cameraH,
        procW: app.procW,
        procH: app.procH,
        gridW: app.gridW,
        gridH: app.gridH,
        visible: app.visible,
        viewW: app.viewW,
        viewH: app.viewH,
        pixelDensity: CONFIG.render.pixelDensity,
        blitMs: CPB.Camera.blitMs,
        readMs: CPB.Camera.readMs
      });
    }
  };

  function step() {
    var p = app.p;
    var D = CPB.Debug;

    // Smoothing is expressed per 60fps frame; rescale it to the real frame
    // time so the figure settles at the same speed on any machine.
    var dtScale = Math.min(4, Math.max(0.2, p.deltaTime / 16.6667));

    // Camera.update times its own blit/readback split.
    if (!CPB.Camera.update()) return;

    D.time('field', function () {
      CPB.Field.update(CPB.Camera.proc.pixels, CPB.Segmenter.mask, CONFIG, dtScale);
    });

    var t = p.millis() * 0.001 * CONFIG.noise.speed;
    app.visible = D.time('particles', function () {
      return CPB.Particles.update(CPB.Field.importance, CONFIG, noise2d, t, dtScale);
    });

    D.time('render', function () {
      CPB.Renderer.draw(app.ctx, CPB.Particles, CONFIG);
    });

    // A segmentation loop that dies mid-run must not fail silently.
    if (CPB.Segmenter.resultCount > 0 && !CPB.Segmenter.isLive(8000)) {
      app.stallFrames++;
      if (app.stallFrames > 60) {
        fail('Segmentation stopped',
          'The body segmentation loop stopped returning results. Reload to restart it.');
      }
    } else {
      app.stallFrames = 0;
    }
  }

  global.windowResized = function () {
    var p = app.p;
    if (!p) return;
    p.resizeCanvas(p.windowWidth, p.windowHeight);
    app.viewW = p.width;
    app.viewH = p.height;
    if (app.gridW) {
      CPB.Renderer.layout(app.viewW, app.viewH, app.gridW, app.gridH);
    }
  };

  // -----------------------------------------------------------------------
  // Startup sequence
  // -----------------------------------------------------------------------

  async function start() {
    if (app.state === STATE.STARTING || app.state === STATE.RUNNING) return;
    app.state = STATE.STARTING;
    CPB.Segmenter.error = null;

    try {
      CPB.UI.showStatus('Requesting camera access…');
      try {
        await CPB.Camera.requestPermission(CONFIG.camera);
      } catch (err) {
        var described = CPB.Camera.describeError(err);
        fail(described.title, described.message, err && (err.name + ': ' + err.message));
        return;
      }

      CPB.UI.showStatus('Starting the camera…');
      CPB.Camera.start(app.p, CONFIG.camera);

      var size;
      try {
        size = await CPB.Camera.waitUntilReady(CONFIG.camera.readyTimeoutMs);
      } catch (err) {
        fail('Camera never delivered a frame',
          'The webcam was opened but produced no video. Check that no other application is using it.',
          err && err.message);
        return;
      }

      configureResolutions(size.width, size.height);

      CPB.UI.showStatus('Loading the body segmentation model…');
      try {
        await CPB.Segmenter.load(CONFIG.segmentation);
      } catch (err) {
        CPB.Segmenter.error = err;
        fail('Segmentation model failed to load',
          'ml5 could not initialise BodySegmentation (' + CONFIG.segmentation.model + ').',
          err && (err.message || String(err)));
        return;
      }

      // Prime the buffer so ml5 never sees an empty canvas, then run.
      CPB.Camera.update();
      app.state = STATE.RUNNING;
      CPB.Segmenter.start(CPB.Camera.proc.elt);

      CPB.UI.showStatus('Detecting a person…');
      try {
        await waitForFirstMask(20000);
      } catch (err) {
        fail('No segmentation result',
          'The model loaded but never returned a mask for the camera stream.',
          err && err.message);
        return;
      }

      app.firstMaskAt = performance.now();
      CPB.UI.showArtwork();
    } catch (err) {
      fail('Unexpected error', 'The sketch could not be started.', err && (err.stack || err.message));
    }
  }

  function waitForFirstMask(timeoutMs) {
    return new Promise(function (resolve, reject) {
      var started = Date.now();
      (function poll() {
        if (CPB.Segmenter.resultCount > 0) { resolve(); return; }
        if (Date.now() - started > timeoutMs) {
          reject(new Error('Timed out after ' + Math.round(timeoutMs / 1000) + 's.'));
          return;
        }
        setTimeout(poll, 80);
      })();
    });
  }

  /**
   * Derive the particle grid from the *real* camera aspect ratio so the figure
   * is never stretched, then size the processing buffer as an integer multiple
   * of the grid.
   */
  function configureResolutions(camW, camH) {
    app.cameraW = camW;
    app.cameraH = camH;

    var ss = CONFIG.grid.supersample;
    var gridW = CONFIG.grid.width;
    var gridH = Math.max(2, Math.round(gridW * camH / camW));

    app.gridW = gridW;
    app.gridH = gridH;
    app.procW = gridW * ss;
    app.procH = gridH * ss;

    CPB.Camera.createProcessingBuffer(app.p, app.procW, app.procH);
    CPB.Field.resize(app.procW, app.procH, gridW, gridH, ss);
    CPB.Segmenter.resize(app.procW, app.procH);
    CPB.Particles.init(gridW, gridH, mulberry32(0x5EED));
    CPB.Renderer.layout(app.viewW, app.viewH, gridW, gridH);
  }

  // Small read-only surface for automated checks and the debug HUD.
  CPB.app = app;
  CPB.STATE = STATE;
  CPB.start = start;
})(window);
