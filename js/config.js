/**
 * Configuration + query-string overrides.
 *
 * Everything that controls resolution, weighting or motion lives here so the
 * particle system can be scaled up later without touching the pipeline.
 */
(function (global) {
  'use strict';

  var params = new URLSearchParams(global.location.search);

  function num(name, fallback, min, max) {
    var raw = params.get(name);
    if (raw === null) return fallback;
    var v = parseFloat(raw);
    if (!isFinite(v)) return fallback;
    return Math.min(max, Math.max(min, v));
  }

  var CONFIG = {
    // --- debug -----------------------------------------------------------
    debug: params.get('debug') === '1',

    // --- camera ----------------------------------------------------------
    // Requested capture size. The browser may hand back something else; the
    // pipeline always re-reads the real dimensions from the video element.
    camera: {
      idealWidth: num('camw', 640, 160, 1920),
      idealHeight: num('camh', 480, 120, 1080),
      readyTimeoutMs: 15000
    },

    // --- segmentation ----------------------------------------------------
    segmentation: {
      model: 'SelfieSegmentation',
      // "mediapipe" ships the WASM/TFLite solution and is the faster of the
      // two ml5 runtimes for realtime video.
      runtime: 'mediapipe',
      modelType: 'general',
      // ml5's own flip is deliberately NOT used: it would mirror the mask but
      // not the luminance we sample ourselves. Mirroring happens once, in the
      // p5 rendering pipeline (see camera.js).
      flipped: false,
      maskType: 'person',
      loadTimeoutMs: 60000,
      // Frames without a fresh result before we call the stream stalled.
      stallFrames: 240
    },

    // --- sampling --------------------------------------------------------
    // Particle grid. gridHeight is derived from the real camera aspect ratio
    // so the figure is never stretched.
    grid: {
      width: Math.round(num('grid', 160, 40, 480)),
      // Each grid cell is backed by supersample^2 camera samples, so luminance
      // and edges are measured finer than the particle spacing.
      supersample: Math.round(num('ss', 2, 1, 4))
    },

    // --- importance weighting -------------------------------------------
    // importance = personMask * (base + luminance + localContrast + edge)
    importance: {
      maskThreshold: num('mask', 0.5, 0.05, 0.95),
      maskSoftness: 0.16,
      base: num('base', 0.34, 0, 1.5),
      lumWeight: num('wlum', 0.42, 0, 2),
      contrastWeight: num('wcon', 0.95, 0, 2),
      contrastGain: 6.0,
      edgeWeight: num('wedge', 0.6, 0, 2),
      edgeGain: 3.2,
      max: 1.4,
      blurRadius: 2
    },

    // --- density dithering ----------------------------------------------
    // Each particle keeps a fixed threshold, so sparse regions stay sparse
    // instead of twinkling frame to frame.
    density: {
      floor: 0.06,
      range: 0.42
    },

    // --- temporal smoothing ---------------------------------------------
    smoothing: {
      mask: 0.38,      // segmentation noise damping
      attack: 0.5,     // alpha rising
      release: 0.14,   // alpha falling
      energy: 0.22,    // size / brightness
      drift: 0.08      // how fast a particle chases its noise target
    },

    // --- generative motion (kept deliberately microscopic) ---------------
    noise: {
      amount: num('drift', 0.3, 0, 2),  // in grid cells
      speed: 0.35                       // noise units per second
    },

    // --- look ------------------------------------------------------------
    render: {
      background: [3, 6, 11],
      baseColor: 'rgb(40,170,225)',
      coreColor: 'rgb(205,248,255)',
      minSize: 0.16,   // grid cells
      maxSize: 0.62,   // grid cells
      coreScale: 0.52,
      coreStart: 0.55, // importance at which the blue-white core appears
      coreEnd: 1.15,
      alphaFloor: 0.012,
      pixelDensity: num('dpr', 1, 1, 3)
    }
  };

  /**
   * Convert a per-frame smoothing coefficient (tuned at 60fps) into one that
   * behaves the same at any frame rate. Without this, a slow machine reacts
   * sluggishly and a fast one twitches.
   */
  function rate(k, dtScale) {
    if (dtScale === 1) return k;
    return 1 - Math.pow(1 - k, dtScale);
  }

  global.CPB = global.CPB || {};
  global.CPB.CONFIG = CONFIG;
  global.CPB.rate = rate;
})(window);
