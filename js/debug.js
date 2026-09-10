/**
 * Debug HUD — only ever drawn when the page is opened with ?debug=1.
 * Normal mode shows the artwork and nothing else.
 */
(function (global) {
  'use strict';

  var Debug = {
    fps: 0,
    /** Exponentially-averaged cost of each pipeline stage, in ms. */
    timers: { field: 0, particles: 0, render: 0 },

    time: function (name, fn) {
      var t0 = performance.now();
      var out = fn();
      var dt = performance.now() - t0;
      this.timers[name] += (dt - this.timers[name]) * 0.1;
      return out;
    },

    _samples: new Float32Array(30),
    _index: 0,
    _filled: 0,

    sample: function (deltaMs) {
      if (deltaMs > 0) {
        this._samples[this._index] = deltaMs;
        this._index = (this._index + 1) % this._samples.length;
        if (this._filled < this._samples.length) this._filled++;
        var sum = 0;
        for (var i = 0; i < this._filled; i++) sum += this._samples[i];
        this.fps = this._filled > 0 ? 1000 / (sum / this._filled) : 0;
      }
      return this.fps;
    },

    lines: function (state) {
      var seg = state.segmenter;
      var status;
      if (seg.error) status = 'error';
      else if (!seg.loaded) status = 'loading';
      else if (seg.resultCount === 0) status = 'waiting for first mask';
      else if (!seg.isLive(1500)) status = 'stalled';
      else status = 'live';

      return [
        'fps            ' + this.fps.toFixed(1),
        'camera         ' + state.cameraW + ' x ' + state.cameraH,
        'processing     ' + state.procW + ' x ' + state.procH,
        'grid           ' + state.gridW + ' x ' + state.gridH +
          '  (' + (state.gridW * state.gridH).toLocaleString() + ' particles)',
        'segmentation   ' + status,
        'mask source    ' + (seg.sourceW ? seg.sourceW + ' x ' + seg.sourceH : 'n/a') +
          '  ch=' + (seg.channel === 3 ? 'A' : 'R'),
        'mask rate      ' + (seg.lastLatencyMs ? (1000 / seg.lastLatencyMs).toFixed(1) + '/s' : 'n/a') +
          '  coverage ' + (seg.coverage * 100).toFixed(1) + '%',
        'active         ' + state.visible.toLocaleString() + ' particles',
        'cpu ms         blit ' + state.blitMs.toFixed(2) +
          '  read ' + state.readMs.toFixed(2) +
          '  field ' + this.timers.field.toFixed(2) +
          '  part ' + this.timers.particles.toFixed(2) +
          '  draw ' + this.timers.render.toFixed(2),
        'canvas         ' + state.viewW + ' x ' + state.viewH + ' @ dpr ' + state.pixelDensity
      ];
    },

    draw: function (p, state) {
      var lines = this.lines(state);
      var pad = 12;
      var lh = 16;
      var w = 430;
      var h = pad * 2 + lines.length * lh;

      p.push();
      p.resetMatrix();
      p.noStroke();
      p.fill(0, 0, 0, 165);
      p.rect(14, 14, w, h, 6);
      p.fill(140, 235, 255);
      p.textFont('monospace');
      p.textSize(12);
      p.textAlign(p.LEFT, p.TOP);
      for (var i = 0; i < lines.length; i++) {
        p.text(lines[i], 14 + pad, 14 + pad + i * lh);
      }
      p.pop();
    }
  };

  global.CPB = global.CPB || {};
  global.CPB.Debug = Debug;
})(window);
