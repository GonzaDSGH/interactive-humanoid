/**
 * Rendering.
 *
 * Only particles are drawn — never the webcam image, a silhouette fill, the
 * mask, or a mesh. Two additive passes keep the palette cyan/blue-white on
 * near-black while touching fillStyle exactly twice per frame:
 *
 *   1. a blue body pass, alpha = particle visibility
 *   2. a blue-white core pass for the highest-importance particles
 */
(function (global) {
  'use strict';

  var Renderer = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,

    /**
     * Cover-fit the particle grid to the viewport, preserving the camera
     * aspect ratio (the grid is built from it), cropping the overflow rather
     * than stretching the person.
     */
    layout: function (viewW, viewH, gridW, gridH) {
      this.scale = Math.max(viewW / gridW, viewH / gridH);
      this.offsetX = (viewW - gridW * this.scale) * 0.5;
      this.offsetY = (viewH - gridH * this.scale) * 0.5;
      return this;
    },

    draw: function (ctx, particles, cfg) {
      var gw = particles.gridW;
      var n = particles.count;
      var alpha = particles.alpha;
      var energy = particles.energy;
      var driftX = particles.driftX;
      var driftY = particles.driftY;
      var jitterX = particles.jitterX;
      var jitterY = particles.jitterY;

      var s = this.scale;
      var ox = this.offsetX;
      var oy = this.offsetY;

      var r = cfg.render;
      var floorA = r.alphaFloor;
      var minS = r.minSize * s;
      var spanS = (r.maxSize - r.minSize) * s;
      var invMax = 1 / cfg.importance.max;
      var coreStart = r.coreStart;
      var coreEnd = r.coreEnd;
      var coreScale = r.coreScale;
      var smoothstep = global.CPB.Field.smoothstep;

      var prevOp = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = 'lighter';

      // --- pass 1: body -------------------------------------------------
      ctx.fillStyle = r.baseColor;
      var i, a, e, size, px, py;
      for (i = 0; i < n; i++) {
        a = alpha[i];
        if (a <= floorA) continue;
        e = energy[i] * invMax;
        if (e > 1) e = 1;
        size = minS + spanS * e;
        px = ox + ((i % gw) + 0.5 + jitterX[i] + driftX[i]) * s;
        py = oy + (((i / gw) | 0) + 0.5 + jitterY[i] + driftY[i]) * s;
        ctx.globalAlpha = a * 0.85;
        ctx.fillRect(px - size * 0.5, py - size * 0.5, size, size);
      }

      // --- pass 2: blue-white core --------------------------------------
      ctx.fillStyle = r.coreColor;
      for (i = 0; i < n; i++) {
        a = alpha[i];
        if (a <= floorA) continue;
        var core = smoothstep(coreStart, coreEnd, energy[i]);
        if (core <= 0.01) continue;
        e = energy[i] * invMax;
        if (e > 1) e = 1;
        size = (minS + spanS * e) * coreScale;
        px = ox + ((i % gw) + 0.5 + jitterX[i] + driftX[i]) * s;
        py = oy + (((i / gw) | 0) + 0.5 + jitterY[i] + driftY[i]) * s;
        ctx.globalAlpha = a * core;
        ctx.fillRect(px - size * 0.5, py - size * 0.5, size, size);
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = prevOp;
    }
  };

  global.CPB = global.CPB || {};
  global.CPB.Renderer = Renderer;
})(window);
