'use strict';

/* ==================================================================
   motion.js — detached particles shed by fast real movement.

   A fixed pool is allocated once and recycled; nothing is created or
   destroyed per frame.  Particles are emitted only from cells that are
   both inside the person mask and moving, so they trail the actual
   body, and they drift with p5's Perlin noise while they fade.
   ================================================================== */

const MotionParticles = {
  capacity: 0,
  active: 0,
  x: null, y: null, vx: null, vy: null,
  life: null, maxLife: null, size: null, seed: null,
  data: null,        // interleaved GPU buffer: x, y, z, size, alpha, seed
  _scanOffset: 0,

  resize(capacity) {
    this.capacity = capacity;
    this.active = 0;
    const f = () => new Float32Array(capacity);
    this.x = f(); this.y = f(); this.vx = f(); this.vy = f();
    this.life = f(); this.maxLife = f(); this.size = f(); this.seed = f();
    this.data = new Float32Array(capacity * 6);
  },

  _spawn(px, py, vx, vy, energy) {
    if (this.active >= this.capacity) return;
    const i = this.active++;
    const M = CONFIG.motion;
    this.x[i] = px;
    this.y[i] = py;
    const speed = M.speed[0] + (M.speed[1] - M.speed[0]) * energy * random(0.5, 1.2);
    const a = random(TWO_PI);
    this.vx[i] = vx * speed + Math.cos(a) * speed * 0.35;
    this.vy[i] = vy * speed + Math.sin(a) * speed * 0.35;
    this.maxLife[i] = random(M.life[0], M.life[1]);
    this.life[i] = this.maxLife[i];
    this.size[i] = random(M.size[0], M.size[1]);
    this.seed[i] = random(1);
  },

  /* `spawn` is true only on an analysis tick: the motion field has not
     changed between ticks, so re-scanning it every frame found nothing new.
     Integration still happens every frame, which is what keeps trails smooth.
     `tickDt` scales the emission budget so the rate per second is unchanged. */
  update(dt, rect, time, spawn, tickDt) {
    if (!this.capacity) return 0;
    const M = CONFIG.motion;

    /* --- emit from moving body cells --- */
    const aw = Analysis.aw, ah = Analysis.ah;
    if (spawn && aw && Analysis.presence > 0.15) {
      const rate = Math.min(3, Math.max(1, (tickDt || dt) * 60));
      const motion = Analysis.motion, person = Analysis.person;
      const fx = Analysis.flowX, fy = Analysis.flowY;
      const stride = M.scanStride;
      const budget = M.spawnPerFrame * rate;
      let spawned = 0;
      this._scanOffset = (this._scanOffset + 1) % stride;
      const cellW = rect.w / aw, cellH = rect.h / ah;
      for (let y = this._scanOffset; y < ah && spawned < budget; y += stride) {
        const row = y * aw;
        for (let x = this._scanOffset; x < aw && spawned < budget; x += stride) {
          const i = row + x;
          const e = motion[i] * person[i];
          if (e < M.spawnThreshold) continue;
          if (Math.random() > e * 0.55 * rate) continue;
          const sx = rect.x + (x + 0.5) * cellW;
          const sy = rect.y + (y + 0.5) * cellH;
          this._spawn(sx, sy, fx[i], fy[i], e);
          spawned++;
        }
      }
    }

    /* --- integrate and compact the pool in place --- */
    const drag = Math.exp(-M.drag * dt);
    const data = this.data;
    let w = 0;
    for (let i = 0; i < this.active; i++) {
      let l = this.life[i] - dt;
      if (l <= 0) continue;
      const s = this.seed[i];
      const nx = (noise(this.x[i] * 0.0035, this.y[i] * 0.0035, time * 0.25 + s * 13) - 0.5) * 2;
      const ny = (noise(this.x[i] * 0.0035 + 41.7, this.y[i] * 0.0035 + 17.3, time * 0.25 + s * 13) - 0.5) * 2;
      let vx = this.vx[i] * drag + nx * 26 * dt;
      let vy = this.vy[i] * drag + ny * 26 * dt - 6 * dt;
      const px = this.x[i] + vx * dt;
      const py = this.y[i] + vy * dt;

      this.x[w] = px; this.y[w] = py;
      this.vx[w] = vx; this.vy[w] = vy;
      this.life[w] = l; this.maxLife[w] = this.maxLife[i];
      this.size[w] = this.size[i]; this.seed[w] = s;

      const t = l / this.maxLife[i];
      const o = w * 6;
      data[o] = px;
      data[o + 1] = py;
      data[o + 2] = 0.2 + s * 0.3;
      data[o + 3] = this.size[i] * (0.55 + t * 0.75);
      data[o + 4] = t * t * 0.85;
      data[o + 5] = s;
      w++;
    }
    this.active = w;
    return w;
  }
};
