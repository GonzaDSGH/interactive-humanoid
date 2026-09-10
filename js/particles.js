/**
 * Particle system.
 *
 * One persistent particle per grid cell. Identities never change: the arrays
 * are allocated once per resize and mutated in place, so no JavaScript objects
 * are created or destroyed while the sketch runs.
 *
 * A particle is anchored to its cell. What the camera changes is how visible,
 * how large and how bright it is — plus a microscopic Perlin drift that keeps
 * the figure alive without dissolving it.
 */
(function (global) {
  'use strict';

  var Particles = {
    count: 0,
    gridW: 0,
    gridH: 0,

    alpha: null,    // smoothed visibility 0..1
    energy: null,   // smoothed importance, drives size + core brightness
    driftX: null,   // current drift, grid-cell units
    driftY: null,
    seedX: null,    // stable per-particle noise seeds
    seedY: null,
    thresh: null,   // stable per-particle density threshold
    jitterX: null,  // stable sub-cell offset, breaks up the grid
    jitterY: null,

    visible: 0,

    init: function (gridW, gridH, rand) {
      var n = gridW * gridH;
      this.gridW = gridW;
      this.gridH = gridH;
      this.count = n;

      this.alpha = new Float32Array(n);
      this.energy = new Float32Array(n);
      this.driftX = new Float32Array(n);
      this.driftY = new Float32Array(n);
      this.seedX = new Float32Array(n);
      this.seedY = new Float32Array(n);
      this.thresh = new Float32Array(n);
      this.jitterX = new Float32Array(n);
      this.jitterY = new Float32Array(n);

      for (var i = 0; i < n; i++) {
        this.seedX[i] = rand() * 1000;
        this.seedY[i] = rand() * 1000;
        this.thresh[i] = rand();
        this.jitterX[i] = (rand() - 0.5) * 0.7;
        this.jitterY[i] = (rand() - 0.5) * 0.7;
      }
      this.visible = 0;
    },

    /**
     * @param {Float32Array} importance  per-cell importance from Field
     * @param {object}       cfg         CPB.CONFIG
     * @param {function}     noise       p5's Perlin noise, bound to the sketch
     * @param {number}       t           noise time, in noise units
     * @param {number}       dtScale      frame time / 16.67ms
     */
    update: function (importance, cfg, noise, t, dtScale) {
      var n = this.count;
      var alpha = this.alpha, energy = this.energy;
      var driftX = this.driftX, driftY = this.driftY;
      var seedX = this.seedX, seedY = this.seedY, thresh = this.thresh;

      var floorD = cfg.density.floor;
      var rangeD = cfg.density.range;
      var rate = global.CPB.rate;
      var attack = rate(cfg.smoothing.attack, dtScale);
      var release = rate(cfg.smoothing.release, dtScale);
      var kEnergy = rate(cfg.smoothing.energy, dtScale);
      var kDrift = rate(cfg.smoothing.drift, dtScale);
      var amount = cfg.noise.amount;
      var floorA = cfg.render.alphaFloor;

      var visible = 0;

      for (var i = 0; i < n; i++) {
        var imp = importance[i];

        // Stable per-particle dithering: sparse where the image is faint,
        // dense where it is structured. Because the threshold never changes,
        // low-importance regions stay quiet instead of flickering.
        var gate = floorD + thresh[i] * rangeD;
        var target = imp > gate ? Math.min(1, imp) : 0;

        var a = alpha[i];
        a += (target - a) * (target > a ? attack : release);
        alpha[i] = a;

        energy[i] += (imp - energy[i]) * kEnergy;

        if (a > floorA) {
          visible++;
          if (amount > 0) {
            var tx = (noise(seedX[i], t) - 0.5) * amount;
            var ty = (noise(seedY[i], t) - 0.5) * amount;
            driftX[i] += (tx - driftX[i]) * kDrift;
            driftY[i] += (ty - driftY[i]) * kDrift;
          }
        }
      }

      this.visible = visible;
      return visible;
    }
  };

  global.CPB = global.CPB || {};
  global.CPB.Particles = Particles;
})(window);
