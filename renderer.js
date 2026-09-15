'use strict';

/* ==================================================================
   renderer.js — WEBGL point-sprite renderer living inside the p5 canvas.

   p5 creates and owns the WEBGL context, the canvas and the frame loop;
   this module drives that same context directly so that hundreds of
   thousands of particles can be drawn from persistent GPU buffers.
   The live analysis fields travel to the GPU as three small textures.
   ================================================================== */

const Renderer = {
  gl: null,
  p5renderer: null,
  programs: {},
  /* two complete field states; the vertex shaders interpolate between them so
     analysis can run below the render rate without the motion stepping */
  sets: [{ A: null, B: null, C: null }, { A: null, B: null, C: null }],
  current: 0,
  interpolate: true,
  blend: 1,
  texW: 0,
  texH: 0,
  quad: null,
  maxPointSize: 64,
  ok: false,
  error: '',

  init(gl, p5renderer, sources) {
    this.gl = gl;
    this.p5renderer = p5renderer;

    const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
    this.maxPointSize = Math.min(CONFIG.render.maxPointSize, range ? range[1] : 64);

    const vtf = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS);
    if (!vtf || vtf < 3) {
      this.ok = false;
      this.error = 'This GPU/driver exposes no vertex texture units, which the particle pipeline requires.';
      return false;
    }
    /* interpolation samples both field states, so it needs six vertex texture
       units; below that the pipeline still runs, just without the tween */
    this.interpolate = vtf >= 6;

    const header = this.interpolate ? '#define INTERPOLATE 1\n' : '';
    const common = header + sources.common + '\n';
    try {
      this.programs.field = this._program(common + sources.fieldVert, sources.spriteFrag, 'field');
      this.programs.env = this._program(common + sources.envVert, sources.spriteFrag, 'env');
      this.programs.free = this._program(common + sources.freeVert, sources.spriteFrag, 'free');
      this.programs.atmo = this._program(sources.atmoVert, sources.atmoFrag, 'atmosphere');
    } catch (err) {
      this.ok = false;
      this.error = String(err.message || err);
      return false;
    }

    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this.ok = true;
    return true;
  },

  _compile(type, src, label) {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(`${label} shader failed to compile: ${log}`);
    }
    return sh;
  },

  _program(vsSrc, fsSrc, label) {
    const gl = this.gl;
    const vs = this._compile(gl.VERTEX_SHADER, vsSrc, label + ' vertex');
    const fs = this._compile(gl.FRAGMENT_SHADER, fsSrc, label + ' fragment');
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      throw new Error(`${label} program failed to link: ${log}`);
    }
    const p = { program, u: {}, a: {} };
    const nu = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < nu; i++) {
      const info = gl.getActiveUniform(program, i);
      p.u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(program, info.name);
    }
    const na = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < na; i++) {
      const info = gl.getActiveAttrib(program, i);
      p.a[info.name] = gl.getAttribLocation(program, info.name);
    }
    return p;
  },

  /* ---------------- field textures ---------------- */

  _makeTexture(w, h) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  },

  resizeFields(w, h) {
    const gl = this.gl;
    for (const set of this.sets) {
      for (const k of ['A', 'B', 'C']) {
        if (set[k]) gl.deleteTexture(set[k]);
        set[k] = this._makeTexture(w, h);
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.texW = w;
    this.texH = h;
    this.current = 0;
    this.blend = 1;
  },

  _upload(set, a, b, c) {
    const gl = this.gl;
    const w = this.texW, h = this.texH;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, set.A);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, a);
    gl.bindTexture(gl.TEXTURE_2D, set.B);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b);
    gl.bindTexture(gl.TEXTURE_2D, set.C);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.bindTexture(gl.TEXTURE_2D, null);
  },

  /* Write both states at once: used on the first tick and after a rebuild, so
     the tween never starts from an empty field. */
  primeFields(a, b, c) {
    if (!this.texW) return;
    this._upload(this.sets[0], a, b, c);
    this._upload(this.sets[1], a, b, c);
    this.blend = 1;
  },

  /* One new analysis state. The previous one stays resident as the tween
     origin, so this costs exactly one upload per analysis tick. */
  pushFields(a, b, c) {
    if (!this.texW) return;
    this.current ^= 1;
    this._upload(this.sets[this.current], a, b, c);
    this.blend = 0;
  },

  _bindFields(p) {
    const gl = this.gl;
    const next = this.sets[this.current];
    const prev = this.sets[this.current ^ 1];
    const bind = (loc, tex, unit) => {
      if (!loc || !tex) return;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(loc, unit);
    };
    bind(p.u.u_fieldA, next.A, 0);
    bind(p.u.u_fieldB, next.B, 1);
    bind(p.u.u_fieldC, next.C, 2);
    bind(p.u.u_prevA, prev.A, 3);
    bind(p.u.u_prevB, prev.B, 4);
    bind(p.u.u_prevC, prev.C, 5);
    if (p.u.u_blend) gl.uniform1f(p.u.u_blend, this.interpolate ? this.blend : 1.0);
  },

  /* ---------------- frame ---------------- */

  begin(view) {
    const gl = this.gl;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    this.view = view;
  },

  drawAtmosphere(time, centerX, centerY, presence) {
    const gl = this.gl;
    const p = this.programs.atmo;
    gl.disable(gl.BLEND);
    gl.useProgram(p.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(p.a.a_pos);
    gl.vertexAttribPointer(p.a.a_pos, 2, gl.FLOAT, false, 0, 0);
    if (p.u.u_time) gl.uniform1f(p.u.u_time, time);
    if (p.u.u_center) gl.uniform2f(p.u.u_center, centerX, centerY);
    if (p.u.u_presence) gl.uniform1f(p.u.u_presence, presence);
    if (p.u.u_aspect) gl.uniform1f(p.u.u_aspect, this.view.width / Math.max(1, this.view.height));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(p.a.a_pos);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    /* everything after this point is luminous, additive matter */
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  },

  _commonUniforms(p, s) {
    const gl = this.gl;
    if (p.u.u_res) gl.uniform2f(p.u.u_res, s.width, s.height);
    if (p.u.u_rect) gl.uniform4f(p.u.u_rect, s.rect.x, s.rect.y, s.rect.w, s.rect.h);
    if (p.u.u_time) gl.uniform1f(p.u.u_time, s.time);
    if (p.u.u_presence) gl.uniform1f(p.u.u_presence, s.presence);
    if (p.u.u_energy) gl.uniform1f(p.u.u_energy, s.energy);
    if (p.u.u_dispersion) gl.uniform1f(p.u.u_dispersion, s.dispersion);
    if (p.u.u_pointScale) gl.uniform1f(p.u.u_pointScale, s.pointScale);
    if (p.u.u_misc) gl.uniform4f(p.u.u_misc, CONFIG.render.parallax, this.maxPointSize, s.core || 1.0, 0.0);
  },

  drawEnvironment(s) {
    const gl = this.gl;
    const p = this.programs.env;
    gl.useProgram(p.program);
    this._commonUniforms(p, s);
    this._bindFields(p);
    if (p.u.u_wind) gl.uniform2f(p.u.u_wind, Environment.windX, Environment.windY);
    gl.enableVertexAttribArray(p.a.a_seed);
    for (const layer of Environment.layers) {
      if (s.only && s.only.indexOf(layer.name) < 0) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, layer.buffer);
      gl.vertexAttribPointer(p.a.a_seed, 4, gl.FLOAT, false, 16, 0);
      gl.uniform4f(p.u.u_env, layer.cfg.speed, layer.cfg.scale, layer.cfg.size * s.dpr, layer.cfg.alpha);
      gl.drawArrays(gl.POINTS, 0, layer.count);
    }
    gl.disableVertexAttribArray(p.a.a_seed);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  },

  drawHuman(s) {
    const gl = this.gl;
    const p = this.programs.field;
    gl.useProgram(p.program);
    this._commonUniforms(p, s);
    this._bindFields(p);
    if (p.u.u_cell) gl.uniform2f(p.u.u_cell, 1 / this.texW, 1 / this.texH);
    gl.enableVertexAttribArray(p.a.a_cell);
    gl.enableVertexAttribArray(p.a.a_seed);
    for (const layer of Particles.layers) {
      const q = layer.params;
      gl.bindBuffer(gl.ARRAY_BUFFER, layer.buffer);
      gl.vertexAttribPointer(p.a.a_cell, 2, gl.FLOAT, false, 24, 0);
      gl.vertexAttribPointer(p.a.a_seed, 4, gl.FLOAT, false, 24, 8);
      gl.uniform4f(p.u.u_layer, q.kind, q.density, q.sizeBase, q.alpha);
      gl.uniform4f(p.u.u_layer2, q.sizeVar, q.jitter, q.drift, q.push);
      if (p.u.u_misc) gl.uniform4f(p.u.u_misc, CONFIG.render.parallax, this.maxPointSize, q.core, 0.0);
      gl.drawArrays(gl.POINTS, 0, layer.count);
    }
    gl.disableVertexAttribArray(p.a.a_cell);
    gl.disableVertexAttribArray(p.a.a_seed);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  },

  drawFree(s, count) {
    if (!count) return;
    const gl = this.gl;
    const p = this.programs.free;
    gl.useProgram(p.program);
    this._commonUniforms(p, s);
    gl.bindBuffer(gl.ARRAY_BUFFER, Particles.free.buffer);
    gl.enableVertexAttribArray(p.a.a_state);
    gl.enableVertexAttribArray(p.a.a_extra);
    gl.vertexAttribPointer(p.a.a_state, 4, gl.FLOAT, false, 24, 0);
    gl.vertexAttribPointer(p.a.a_extra, 2, gl.FLOAT, false, 24, 16);
    gl.drawArrays(gl.POINTS, 0, count);
    gl.disableVertexAttribArray(p.a.a_state);
    gl.disableVertexAttribArray(p.a.a_extra);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  },

  end() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(null);
    /* p5 caches the program it last bound; clear it so p5 rebinds safely */
    if (this.p5renderer) this.p5renderer._curShader = null;
  }
};
