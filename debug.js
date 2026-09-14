'use strict';

/* ==================================================================
   debug.js — ?debug=1 overlay, plus a development-only mock source.

   Nothing in this file runs in normal mode.  The overlay is plain DOM,
   so the WEBGL canvas itself stays pure particles.
   ================================================================== */

const Debug = {
  enabled: false,
  showStats: true,
  showViz: true,
  root: null,
  statsEl: null,
  vizEl: null,
  canvases: {},
  _lines: [],

  VIZ: [
    { key: 'person', label: 'person mask' },
    { key: 'lum', label: 'luminance' },
    { key: 'edge', label: 'edges' },
    { key: 'importance', label: 'importance' }
  ],

  init() {
    this.enabled = QUERY.debug;
    this.root = document.getElementById('debug');
    this.statsEl = document.getElementById('debug-stats');
    this.vizEl = document.getElementById('debug-viz');
    if (!this.enabled || !this.root) return;
    this.root.hidden = false;
    for (const v of this.VIZ) {
      const fig = document.createElement('figure');
      const cv = document.createElement('canvas');
      const cap = document.createElement('figcaption');
      cap.textContent = v.label;
      fig.appendChild(cv);
      fig.appendChild(cap);
      this.vizEl.appendChild(fig);
      this.canvases[v.key] = cv;
    }
  },

  toggleStats() { this.showStats = !this.showStats; this.statsEl.hidden = !this.showStats; },
  toggleViz() { this.showViz = !this.showViz; this.vizEl.hidden = !this.showViz; },

  update(stats) {
    if (!this.enabled || !this.showStats) return;
    const l = [];
    l.push(`fps            ${stats.fps.toFixed(1)}`);
    l.push(`quality        ${stats.quality}`);
    l.push(`camera         ${stats.cameraLabel}`);
    l.push(`camera res     ${stats.cameraW}x${stats.cameraH} @${stats.cameraFps || '?'}`);
    l.push(`analysis res   ${stats.aw}x${stats.ah}`);
    l.push(`canvas         ${stats.canvasW}x${stats.canvasH}`);
    l.push(`segmentation   ${stats.segStatus} (${stats.segEncoding})`);
    l.push(`seg interval   ${stats.segMs.toFixed(1)} ms`);
    l.push(`facemesh       ${stats.faceStatus} · ${stats.faceCount}`);
    l.push(`bodypose       ${stats.poseStatus} · ${stats.poseCount}`);
    l.push(`presence       ${stats.presence.toFixed(2)}  area ${(stats.area * 100).toFixed(1)}%`);
    l.push(`motion energy  ${stats.energy.toFixed(3)}`);
    l.push(`human parts    ${stats.humanTotal.toLocaleString()} (~${stats.humanActive.toLocaleString()} on)`);
    l.push(`env parts      ${stats.envTotal.toLocaleString()}`);
    l.push(`motion parts   ${stats.freeCount.toLocaleString()}`);
    l.push(`analysis time  ${stats.analysisMs.toFixed(2)} ms`);
    l.push(`render time    ${stats.renderMs.toFixed(2)} ms`);
    this.statsEl.textContent = l.join('\n');
  },

  drawFields() {
    if (!this.enabled || !this.showViz || !Analysis.n) return;
    const aw = Analysis.aw, ah = Analysis.ah;
    for (const v of this.VIZ) {
      const cv = this.canvases[v.key];
      if (!cv) continue;
      if (cv.width !== aw || cv.height !== ah) { cv.width = aw; cv.height = ah; }
      const ctx = cv.getContext('2d');
      const img = ctx.createImageData(aw, ah);
      const src = Analysis[v.key];
      const d = img.data;
      for (let i = 0, p = 0; i < aw * ah; i++, p += 4) {
        const val = Math.max(0, Math.min(1, src[i])) * 255;
        d[p] = val * 0.35;
        d[p + 1] = val * 0.9;
        d[p + 2] = val;
        d[p + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }
  }
};

/* ------------------------------------------------------------------
   MockSource — development harness only (?mock=1).

   It fabricates a camera frame and a segmentation mask so the particle
   pipeline can be inspected on a machine without a webcam.  It is never
   reachable in normal mode and is not part of the artwork.
   ------------------------------------------------------------------ */
const MockSource = {
  active: false,
  gfx: null,
  mask: null,
  field: null,
  width: 960,
  height: 720,
  aw: 0,
  ah: 0,

  resize(aw, ah) {
    this.aw = aw; this.ah = ah;
    this.gfx = createGraphics(aw, ah);
    this.gfx.pixelDensity(1);
    this.mask = createGraphics(aw, ah);
    this.mask.pixelDensity(1);
    this.field = new Float32Array(aw * ah);
  },

  _figure(g, t, shaded) {
    const w = this.aw, h = this.ah;
    const raise = Math.sin(t * 0.9) * 0.5 + 0.5;          // right arm rises
    const sway = Math.sin(t * 0.55) * 0.016;
    const cx = w * (0.5 + sway);
    const unit = h;

    const body = shaded ? g.color(178, 186, 196) : g.color(255);
    const dark = shaded ? g.color(96, 104, 116) : g.color(255);
    g.noStroke();

    // torso
    g.fill(body);
    g.beginShape();
    g.vertex(cx - unit * 0.115, h * 0.33);
    g.vertex(cx + unit * 0.115, h * 0.33);
    g.vertex(cx + unit * 0.098, h * 0.66);
    g.vertex(cx - unit * 0.098, h * 0.66);
    g.endShape(CLOSE);

    // neck + head
    g.rect(cx - unit * 0.033, h * 0.25, unit * 0.066, h * 0.09);
    g.ellipse(cx, h * 0.19, unit * 0.155, unit * 0.195);

    // limbs
    const limb = (x0, y0, x1, y1, thick) => {
      g.push();
      g.stroke(body);
      g.strokeWeight(thick);
      g.strokeCap(ROUND);
      g.line(x0, y0, x1, y1);
      g.pop();
    };
    const shoulderY = h * 0.35;
    const sl = cx - unit * 0.115, sr = cx + unit * 0.115;
    // left arm hangs, right arm raises
    const elx = sl - unit * 0.075, ely = shoulderY + unit * 0.135;
    limb(sl, shoulderY, elx, ely, unit * 0.052);
    limb(elx, ely, elx - unit * 0.03, ely + unit * 0.135, unit * 0.044);
    g.fill(body); g.noStroke();
    g.ellipse(elx - unit * 0.03, ely + unit * 0.145, unit * 0.05);

    const erx = sr + unit * 0.085, ery = shoulderY + unit * 0.11 - raise * unit * 0.16;
    limb(sr, shoulderY, erx, ery, unit * 0.052);
    const wx = erx + unit * 0.02, wy = ery + unit * 0.12 - raise * unit * 0.26;
    limb(erx, ery, wx, wy, unit * 0.044);
    g.ellipse(wx, wy - unit * 0.012, unit * 0.05);

    // legs
    limb(cx - unit * 0.052, h * 0.64, cx - unit * 0.062, h * 0.82, unit * 0.068);
    limb(cx - unit * 0.062, h * 0.82, cx - unit * 0.058, h * 0.985, unit * 0.056);
    limb(cx + unit * 0.052, h * 0.64, cx + unit * 0.064, h * 0.82, unit * 0.068);
    limb(cx + unit * 0.064, h * 0.82, cx + unit * 0.060, h * 0.985, unit * 0.056);

    if (!shaded) return;

    // internal camera-like information: face, clothing, shading
    g.fill(70, 78, 92);
    g.ellipse(cx - unit * 0.033, h * 0.178, unit * 0.026, unit * 0.017);
    g.ellipse(cx + unit * 0.033, h * 0.178, unit * 0.026, unit * 0.017);
    g.fill(64, 70, 84);
    g.rect(cx - unit * 0.026, h * 0.222, unit * 0.052, unit * 0.011);
    g.fill(120, 128, 140);
    g.triangle(cx, h * 0.186, cx - unit * 0.012, h * 0.212, cx + unit * 0.012, h * 0.212);
    g.fill(58, 64, 78);                 // hair
    g.arc(cx, h * 0.185, unit * 0.158, unit * 0.2, PI, TWO_PI);
    g.fill(dark);                       // garment
    g.rect(cx - unit * 0.115, h * 0.42, unit * 0.23, h * 0.16);
    g.fill(210, 218, 228);
    g.rect(cx - unit * 0.012, h * 0.35, unit * 0.024, h * 0.30);
  },

  update(t) {
    const g = this.gfx, m = this.mask;
    const w = this.aw, h = this.ah;
    // a cycle with the person leaving and returning, to exercise presence
    const cycle = (t % 26) / 26;
    const present = cycle < 0.78;

    g.push();
    g.background(18, 22, 30);
    for (let i = 0; i < 26; i++) {
      g.noStroke();
      g.fill(26 + (i % 5) * 4, 30 + (i % 3) * 5, 40);
      g.rect((i * 97) % w, (i * 53) % h, 24, 18);
    }
    m.background(0);
    if (present) {
      this._figure(g, t, true);
      this._figure(m, t, false);
    }
    g.pop();

    m.loadPixels();
    const px = m.pixels;
    for (let i = 0, p = 0; i < this.field.length; i++, p += 4) {
      this.field[i] = px[p] / 255;
    }
    g.loadPixels();
    return g.pixels;
  }
};
