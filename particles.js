'use strict';

/* ==================================================================
   particles.js — persistent, GPU resident particle populations.

   Every human particle is permanently bound to one analysis cell and to
   four fixed random numbers.  The buffers are uploaded once (they only
   change when the quality level changes); the live camera fields reach
   the GPU as three small textures instead of megabytes of vertices.
   ================================================================== */

const Particles = {
  layers: [],
  free: { buffer: null, capacity: 0, count: 0 },
  total: 0,

  /* human populations, drawn back to front */
  DEFS: [
    { name: 'aura', cfg: 'aura', perCell: 'auraPerCell' },
    { name: 'structural', cfg: 'structural', perCell: 'structuralPerCell' },
    { name: 'silhouette', cfg: 'silhouette', perCell: 'silPerCell' },
    { name: 'detail', cfg: 'detail', perCell: 'detailPerCell' }
  ],

  build(gl, quality) {
    this.dispose(gl);
    const aw = quality.aw, ah = quality.ah;
    const cells = aw * ah;
    this.layers = [];
    this.total = 0;

    /* fixed seed: the same particle identities every run */
    randomSeed(20240914);

    for (const def of this.DEFS) {
      const per = typeof def.perCell === 'number' ? def.perCell : quality[def.perCell];
      const count = Math.max(1, Math.floor(cells * per));
      const data = new Float32Array(count * 6);
      for (let i = 0; i < count; i++) {
        const cell = i % cells;
        const cx = cell % aw;
        const cy = (cell / aw) | 0;
        const o = i * 6;
        data[o] = (cx + 0.5) / aw;
        data[o + 1] = (cy + 0.5) / ah;
        data[o + 2] = random();   // density threshold seed (stable)
        data[o + 3] = random();   // jitter x
        data[o + 4] = random();   // jitter y
        data[o + 5] = random();   // phase / size / depth
      }
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      this.layers.push({
        name: def.name,
        params: CONFIG.layers[def.cfg],
        count,
        buffer
      });
      this.total += count;
    }

    /* dynamic pool for detached motion particles */
    MotionParticles.resize(quality.freePool);
    this.free.capacity = quality.freePool;
    this.free.count = 0;
    this.free.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.free.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, MotionParticles.data.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  },

  uploadFree(gl, count) {
    this.free.count = count;
    if (!count || !this.free.buffer) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.free.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, MotionParticles.data.subarray(0, count * 6));
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  },

  /* how many human particles are actually switched on right now */
  activeEstimate() {
    if (!Analysis.n) return 0;
    let cells = 0;
    const imp = Analysis.importance;
    for (let i = 0; i < Analysis.n; i++) if (imp[i] > 0.05) cells++;
    const ratio = cells / Analysis.n;
    return Math.round(this.total * ratio * 0.72);
  },

  dispose(gl) {
    for (const l of this.layers) if (l.buffer) gl.deleteBuffer(l.buffer);
    this.layers = [];
    if (this.free.buffer) { gl.deleteBuffer(this.free.buffer); this.free.buffer = null; }
  }
};
