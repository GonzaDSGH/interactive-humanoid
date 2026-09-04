/**
 * GPU particle renderer. Deliberately bypasses p5's high-level drawing API
 * for the particle draw itself: we compile our own shader program and
 * issue a single raw gl.drawArrays(POINTS, ...) call per particle group,
 * using p5 only for the canvas/context/window/event plumbing. This is
 * what makes a hundred-thousand-particle humanoid possible at 60fps — no
 * per-particle JS object, no per-particle vertex()/ellipse() call.
 *
 * Rigid body-part motion (shoulder -> neck -> head) is computed once per
 * frame on the CPU as three 4x4 matrices (gl-matrix), mirroring exactly
 * the joint hierarchy the pointer-attention system expects, and skinned
 * to each particle in the vertex shader by a part-id attribute — the same
 * technique as GPU bone/skin animation, with 3 "bones".
 */

// ---- Shared GLSL noise (Ashima simplex noise, 3D) --------------------------
// Used for the coherent (Perlin-style) autonomous flow field — NOT decorative:
// it drives real per-particle displacement every frame, evaluated in the shader.
const NOISE_GLSL = `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
`;

const HUMANOID_VERT = `
  attribute vec3 aPosition;
  attribute float aPart;
  attribute float aFace;
  attribute float aSize;
  attribute float aBrightness;
  attribute float aRandom;
  attribute vec3 aSeed;
  attribute float aEdge;

  uniform mat4 uProjectionMatrix;
  uniform mat4 uViewMatrix;
  uniform mat4 uShoulderMatrix;
  uniform mat4 uNeckMatrix;
  uniform mat4 uHeadMatrix;
  uniform float uTime;
  uniform vec2 uFaceShift;
  uniform vec2 uFlowVelocity;
  uniform float uPixelRatio;
  uniform float uSizeScale;
  uniform float uIdleDriftAmount;
  uniform float uIdleDriftSpeed;
  uniform float uNoiseFlowAmount;
  uniform float uNoiseFlowSpeed;
  uniform float uNoiseFlowScale;
  uniform float uAudioMid;
  uniform float uMidFlowScale;
  uniform float uFlowShoulder;
  uniform float uFlowNeck;
  uniform float uFlowHead;

  varying float vBrightness;
  varying float vEdge;
  varying float vRandom;

  ${NOISE_GLSL}

  void main() {
    mat4 partMatrix = aPart < 0.5 ? uShoulderMatrix : (aPart < 1.5 ? uNeckMatrix : uHeadMatrix);
    vec4 worldPos = partMatrix * vec4(aPosition, 1.0);

    // Idle autonomous drift (small sinusoidal life), in world space.
    float t = uTime * uIdleDriftSpeed;
    worldPos.x += sin(t * (0.6 + aSeed.x * 0.8) + aSeed.x * 6.283) * uIdleDriftAmount;
    worldPos.y += cos(t * (0.5 + aSeed.y * 0.7) + aSeed.y * 6.283) * uIdleDriftAmount;
    worldPos.z += sin(t * (0.4 + aSeed.z * 0.6) + aSeed.z * 6.283) * uIdleDriftAmount * 0.7;

    // Coherent noise flow field — autonomous, evolves over time, boosted
    // by mid-frequency audio energy ("internal turbulence" from voice).
    vec3 flowP = worldPos.xyz * uNoiseFlowScale + vec3(0.0, 0.0, uTime * uNoiseFlowSpeed);
    vec3 flow = vec3(
      snoise(flowP),
      snoise(flowP + vec3(19.1, 7.3, 3.7)),
      snoise(flowP + vec3(41.7, 2.9, 11.3))
    );
    worldPos.xyz += flow * (uNoiseFlowAmount + uAudioMid * uMidFlowScale) * (0.5 + 0.5 * aRandom);

    // Face particles nudge toward the attention target, reinforcing "the
    // face notices first" on top of the head's own rigid rotation.
    worldPos.xy += aFace * uFaceShift;

    // Subtle organic mass-flow toward the pointer's recent velocity —
    // stronger toward the head, softer toward the shoulders.
    float flowScale = aPart < 0.5 ? uFlowShoulder : (aPart < 1.5 ? uFlowNeck : uFlowHead);
    worldPos.xy += uFlowVelocity * flowScale * (0.7 + 0.3 * aRandom);

    vec4 viewPos = uViewMatrix * worldPos;
    gl_Position = uProjectionMatrix * viewPos;

    float sizeAtten = 1.0 / max(-viewPos.z, 0.001);
    gl_PointSize = aSize * uSizeScale * uPixelRatio * sizeAtten;

    vBrightness = aBrightness;
    vEdge = aEdge;
    vRandom = aRandom;
  }
`;

const HUMANOID_FRAG = `
  precision highp float;
  varying float vBrightness;
  varying float vEdge;
  varying float vRandom;

  uniform vec3 uColorPrimary;
  uniform vec3 uColorSecondary;
  uniform vec3 uColorHighlight;
  uniform float uAudioTreble;
  uniform float uTrebleSparkleScale;
  uniform float uAudioEnergy;
  uniform float uEnergyBrightnessScale;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float core = smoothstep(0.5, 0.0, d);
    if (core < 0.02) discard;

    float edgeFade = 1.0 - smoothstep(0.6, 1.7, vEdge);

    vec3 color = mix(uColorSecondary, uColorPrimary, clamp(vRandom * 1.3, 0.0, 1.0));
    color = mix(color, uColorHighlight, clamp((vBrightness - 0.7) * 2.2, 0.0, 1.0) * step(0.82, vRandom));

    // Treble -> fine sparkle concentrated at the peripheral/edge particles.
    float sparkle = uAudioTreble * uTrebleSparkleScale * smoothstep(0.5, 1.3, vEdge) * step(0.6, vRandom);

    float energyLift = 1.0 + uAudioEnergy * uEnergyBrightnessScale;
    float alpha = core * core * vBrightness * edgeFade * energyLift + sparkle * core;
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
  }
`;

const AMBIENT_VERT = `
  attribute vec3 aPosition;
  attribute float aSize;
  attribute float aRandom;
  attribute vec3 aSeed;

  uniform mat4 uProjectionMatrix;
  uniform mat4 uViewMatrix;
  uniform float uTime;
  uniform vec2 uFlowVelocity;
  uniform float uPixelRatio;

  varying float vAlpha;

  void main() {
    vec3 pos = aPosition;
    pos.x += sin(uTime * (0.1 + aRandom * 0.15) + aSeed.x * 6.283) * 0.06;
    pos.y += cos(uTime * (0.08 + aRandom * 0.12) + aSeed.y * 6.283) * 0.05;
    pos.xy += uFlowVelocity * (0.2 + aRandom * 0.4);

    vec4 viewPos = uViewMatrix * vec4(pos, 1.0);
    gl_Position = uProjectionMatrix * viewPos;

    float sizeAtten = 1.0 / max(-viewPos.z, 0.001);
    gl_PointSize = aSize * uPixelRatio * sizeAtten * 13.0;

    float depthFade = smoothstep(-16.0, -2.0, viewPos.z);
    vAlpha = (0.08 + aRandom * 0.18) * depthFade;
  }
`;

const AMBIENT_FRAG = `
  precision highp float;
  varying float vAlpha;
  uniform vec3 uColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float alpha = smoothstep(0.5, 0.0, d) * vAlpha;
    if (alpha < 0.008) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

function compileShader(gl, type, src) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error('Shader compile error: ' + info);
  }
  return shader;
}

function createProgram(gl, vertSrc, fragSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    throw new Error('Program link error: ' + info);
  }
  return program;
}

function makeAttribBuffer(gl, data) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buf;
}

function bindAttrib(gl, program, name, buffer, size) {
  const loc = gl.getAttribLocation(program, name);
  if (loc < 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
}

// Enabled vertex attribute arrays are global GL state, not per-program —
// switching shader programs can leave a location enabled from the
// previous draw with no buffer re-bound for the new program at that same
// numeric location, which WebGL flags as an error. Disable a generous
// range before each draw call and only re-enable what that draw uses.
const MAX_ATTRIB_LOCATIONS = 12;
function resetAttribs(gl) {
  for (let i = 0; i < MAX_ATTRIB_LOCATIONS; i++) gl.disableVertexAttribArray(i);
}

/** Rigid body-part hierarchy: shoulder -> neck -> head, driven each frame
 *  by AttentionController's pose. Mirrors the earlier Three.js Object3D
 *  pivot chain exactly, using gl-matrix instead of THREE's math classes. */
class Pivots {
  constructor() {
    const { mat4, quat, vec3 } = window.glMatrix;
    this._mat4 = mat4;
    this._quat = quat;
    this._vec3 = vec3;

    this.torsoPos = vec3.fromValues(0, CONFIG.SKELETON.groupOffsetY, 0);
    this.shoulderLocalPos = vec3.fromValues(0, 0, 0);
    this.neckLocalPos = vec3.fromValues(0, 0, 0);
    this.headLocalPos = vec3.fromValues(0, CONFIG.SKELETON.neckHeight, 0);

    this.torsoMat = mat4.create();
    this.shoulderMat = mat4.create();
    this.neckMat = mat4.create();
    this.headMat = mat4.create();

    this._q = quat.create();
    this._qy = quat.create();
    this._qx = quat.create();
    this._qz = quat.create();
    this._localMat = mat4.create();
  }

  _eulerYXZ(yaw, pitch, roll, out) {
    const quat = this._quat;
    quat.setAxisAngle(this._qy, [0, 1, 0], yaw);
    quat.setAxisAngle(this._qx, [1, 0, 0], pitch);
    quat.setAxisAngle(this._qz, [0, 0, 1], roll);
    quat.multiply(out, this._qy, this._qx);
    quat.multiply(out, out, this._qz);
    return out;
  }

  update(pose, breathe, driftYaw, driftPitch) {
    const mat4 = this._mat4;

    this._eulerYXZ(pose.torso.yaw, pose.torso.pitch, pose.torso.roll, this._q);
    const s = 1 + breathe * 0.4;
    mat4.fromRotationTranslationScale(this.torsoMat, this._q, this.torsoPos, [s, s, s]);

    this._eulerYXZ(pose.shoulders.yaw, pose.shoulders.pitch, pose.shoulders.roll, this._q);
    this.shoulderLocalPos[1] = pose.shoulders.bob + breathe;
    mat4.fromRotationTranslation(this._localMat, this._q, this.shoulderLocalPos);
    mat4.multiply(this.shoulderMat, this.torsoMat, this._localMat);

    this._eulerYXZ(pose.neck.yaw, pose.neck.pitch, pose.neck.roll, this._q);
    mat4.fromRotationTranslation(this._localMat, this._q, this.neckLocalPos);
    mat4.multiply(this.neckMat, this.shoulderMat, this._localMat);

    this._eulerYXZ(pose.head.yaw + driftYaw, pose.head.pitch + driftPitch, pose.head.roll, this._q);
    mat4.fromRotationTranslation(this._localMat, this._q, this.headLocalPos);
    mat4.multiply(this.headMat, this.neckMat, this._localMat);
  }
}

class ParticleSystem {
  constructor(p, counts) {
    this.p = p;
    this.gl = p.drawingContext;
    this.pivots = new Pivots();

    this.humanoidProgram = createProgram(this.gl, HUMANOID_VERT, HUMANOID_FRAG);
    this.ambientProgram = createProgram(this.gl, AMBIENT_VERT, AMBIENT_FRAG);

    this.clock = 0;
    this.idleSeed = Math.random() * 1000;
    this.flowVelX = 0;
    this.flowVelY = 0;

    this.buildBuffers(counts);

    this.projectionMatrix = window.glMatrix.mat4.create();
    this.viewMatrix = window.glMatrix.mat4.create();
  }

  buildBuffers(counts) {
    const gl = this.gl;
    const field = buildHumanoidField(counts);
    this.humanoidCount = field.count;
    this.humanoidBuffers = {
      position: makeAttribBuffer(gl, field.positions),
      part: makeAttribBuffer(gl, field.part),
      face: makeAttribBuffer(gl, field.face),
      size: makeAttribBuffer(gl, field.size),
      brightness: makeAttribBuffer(gl, field.brightness),
      random: makeAttribBuffer(gl, field.random),
      seed: makeAttribBuffer(gl, field.seed),
      edge: makeAttribBuffer(gl, field.edge),
    };

    const ambient = buildAmbientField(counts.ambient);
    this.ambientCount = ambient.count;
    this.ambientBuffers = {
      position: makeAttribBuffer(gl, ambient.positions),
      size: makeAttribBuffer(gl, ambient.sizes),
      random: makeAttribBuffer(gl, ambient.randoms),
      seed: makeAttribBuffer(gl, ambient.seeds),
    };
  }

  /** Rebuilds particle buffers at a different quality preset (adaptive
   *  downgrade) without recreating shader programs or the GL context. */
  rebuild(counts) {
    const gl = this.gl;
    for (const buf of Object.values(this.humanoidBuffers)) gl.deleteBuffer(buf);
    for (const buf of Object.values(this.ambientBuffers)) gl.deleteBuffer(buf);
    this.buildBuffers(counts);
  }

  setCamera(aspect) {
    const { mat4 } = window.glMatrix;
    const C = CONFIG.CAMERA;
    mat4.perspective(this.projectionMatrix, C.fovDeg * (Math.PI / 180), aspect, C.near, C.far);
    mat4.lookAt(this.viewMatrix, [0, C.lookY, C.distance], [0, C.lookY, 0], [0, 1, 0]);
  }

  update(dt, pose, pointerVelX, pointerVelY, audio) {
    this.clock += dt;
    const t = this.clock;
    const IDLE = CONFIG.IDLE;
    const AU = CONFIG.AUDIO;

    const breathe =
      Math.sin(t * IDLE.breathingRate * Math.PI * 2 + this.idleSeed) *
      IDLE.breathingAmount *
      (1 + audio.bass * AU.bassBreathScale);
    const driftYaw = Math.sin(t * IDLE.driftRate * Math.PI * 2 + this.idleSeed * 1.7) * IDLE.driftYaw;
    const driftPitch = Math.cos(t * IDLE.driftRate * Math.PI * 2 * 0.83 + this.idleSeed) * IDLE.driftPitch;

    this.pivots.update(pose, breathe, driftYaw, driftPitch);

    const lambda = 3.4;
    const alpha = 1 - Math.exp(-lambda * dt);
    this.flowVelX += (pointerVelX - this.flowVelX) * alpha;
    this.flowVelY += (pointerVelY - this.flowVelY) * alpha;
  }

  _setCommonUniforms(gl, program, audio) {
    const u = (name) => gl.getUniformLocation(program, name);
    gl.uniformMatrix4fv(u('uProjectionMatrix'), false, this.projectionMatrix);
    gl.uniformMatrix4fv(u('uViewMatrix'), false, this.viewMatrix);
    gl.uniform1f(u('uTime'), this.clock);
    gl.uniform1f(u('uPixelRatio'), Math.min(window.devicePixelRatio || 1, CONFIG.MAX_PIXEL_RATIO));
  }

  draw(pose, audio) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.disable(gl.DEPTH_TEST);

    // ---- Ambient dust (drawn first, behind) --------------------------
    resetAttribs(gl);
    gl.useProgram(this.ambientProgram);
    this._setCommonUniforms(gl, this.ambientProgram, audio);
    gl.uniform3fv(gl.getUniformLocation(this.ambientProgram, 'uColor'), [0.62, 0.83, 0.92]);
    gl.uniform2f(
      gl.getUniformLocation(this.ambientProgram, 'uFlowVelocity'),
      this.flowVelX * 0.05,
      this.flowVelY * 0.05
    );
    bindAttrib(gl, this.ambientProgram, 'aPosition', this.ambientBuffers.position, 3);
    bindAttrib(gl, this.ambientProgram, 'aSize', this.ambientBuffers.size, 1);
    bindAttrib(gl, this.ambientProgram, 'aRandom', this.ambientBuffers.random, 1);
    bindAttrib(gl, this.ambientProgram, 'aSeed', this.ambientBuffers.seed, 3);
    gl.drawArrays(gl.POINTS, 0, this.ambientCount);

    // ---- Humanoid field ------------------------------------------------
    resetAttribs(gl);
    const hp = this.humanoidProgram;
    gl.useProgram(hp);
    this._setCommonUniforms(gl, hp, audio);
    const u = (name) => gl.getUniformLocation(hp, name);

    gl.uniformMatrix4fv(u('uShoulderMatrix'), false, this.pivots.shoulderMat);
    gl.uniformMatrix4fv(u('uNeckMatrix'), false, this.pivots.neckMat);
    gl.uniformMatrix4fv(u('uHeadMatrix'), false, this.pivots.headMat);

    const pf = CONFIG.PARTICLE_FIELD;
    gl.uniform1f(u('uSizeScale'), CONFIG.POINT_SIZE_CONSTANT);
    gl.uniform1f(u('uIdleDriftAmount'), pf.idleDriftAmount);
    gl.uniform1f(u('uIdleDriftSpeed'), pf.idleDriftSpeed);
    gl.uniform1f(u('uNoiseFlowAmount'), pf.noiseFlowAmount);
    gl.uniform1f(u('uNoiseFlowSpeed'), pf.noiseFlowSpeed);
    gl.uniform1f(u('uNoiseFlowScale'), pf.noiseFlowScale);
    gl.uniform1f(u('uFlowShoulder'), pf.flowInfluence * pf.flowInfluenceByPart.shoulder);
    gl.uniform1f(u('uFlowNeck'), pf.flowInfluence * pf.flowInfluenceByPart.neck);
    gl.uniform1f(u('uFlowHead'), pf.flowInfluence * pf.flowInfluenceByPart.head);

    const shiftScale = 1.4 * pf.faceShiftScale;
    gl.uniform2f(u('uFaceShift'), pose.faceShift.x * shiftScale, pose.faceShift.y * shiftScale);
    gl.uniform2f(u('uFlowVelocity'), this.flowVelX, this.flowVelY);

    gl.uniform3fv(u('uColorPrimary'), CONFIG.COLOR_PRIMARY);
    gl.uniform3fv(u('uColorSecondary'), CONFIG.COLOR_SECONDARY);
    gl.uniform3fv(u('uColorHighlight'), CONFIG.COLOR_HIGHLIGHT);

    const AU = CONFIG.AUDIO;
    gl.uniform1f(u('uAudioMid'), audio.mid);
    gl.uniform1f(u('uMidFlowScale'), AU.midFlowScale);
    gl.uniform1f(u('uAudioTreble'), audio.treble);
    gl.uniform1f(u('uTrebleSparkleScale'), AU.trebleSparkleScale);
    gl.uniform1f(u('uAudioEnergy'), audio.amplitude);
    gl.uniform1f(u('uEnergyBrightnessScale'), AU.energyBrightnessScale);

    bindAttrib(gl, hp, 'aPosition', this.humanoidBuffers.position, 3);
    bindAttrib(gl, hp, 'aPart', this.humanoidBuffers.part, 1);
    bindAttrib(gl, hp, 'aFace', this.humanoidBuffers.face, 1);
    bindAttrib(gl, hp, 'aSize', this.humanoidBuffers.size, 1);
    bindAttrib(gl, hp, 'aBrightness', this.humanoidBuffers.brightness, 1);
    bindAttrib(gl, hp, 'aRandom', this.humanoidBuffers.random, 1);
    bindAttrib(gl, hp, 'aSeed', this.humanoidBuffers.seed, 3);
    bindAttrib(gl, hp, 'aEdge', this.humanoidBuffers.edge, 1);

    gl.drawArrays(gl.POINTS, 0, this.humanoidCount);
  }

  dispose() {
    const gl = this.gl;
    for (const buf of Object.values(this.humanoidBuffers)) gl.deleteBuffer(buf);
    for (const buf of Object.values(this.ambientBuffers)) gl.deleteBuffer(buf);
    gl.deleteProgram(this.humanoidProgram);
    gl.deleteProgram(this.ambientProgram);
  }
}
