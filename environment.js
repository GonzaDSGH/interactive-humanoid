'use strict';

/* ==================================================================
   environment.js — the alive particle world around the person.

   Four depth layers (deep background, midground, haze, foreground) plus
   a slow p5 Perlin wind that all of them share.  Entirely procedural on
   the GPU: static seed buffers, animated by coherent noise.
   ================================================================== */

const Environment = {
  layers: [],
  windX: 0,
  windY: 0,
  total: 0,

  ORDER: ['back', 'haze', 'mid', 'fore'],

  build(gl, quality) {
    this.dispose(gl);
    this.layers = [];
    this.total = 0;
    randomSeed(77013);

    for (const name of this.ORDER) {
      const count = quality.env[name];
      const cfg = CONFIG.env[name];
      const data = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        const o = i * 4;
        data[o] = random();
        data[o + 1] = random();
        data[o + 2] = random(cfg.depth[0], cfg.depth[1]);
        data[o + 3] = random();
      }
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      this.layers.push({ name, cfg, count, buffer });
      this.total += count;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  },

  /* a slow coherent wind, straight from p5's Perlin noise */
  update(time) {
    this.windX = (noise(time * 0.045, 0.0) - 0.5) * 0.9;
    this.windY = (noise(0.0, time * 0.045 + 31.7) - 0.5) * 0.55 - 0.16;
  },

  dispose(gl) {
    for (const l of this.layers) if (l.buffer) gl.deleteBuffer(l.buffer);
    this.layers = [];
  }
};
