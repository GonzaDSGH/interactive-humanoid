/**
 * GPU particle renderer — a real rendering pipeline, not raw GL_POINTS with
 * a circular alpha mask. Three things make this a different rendering
 * model from a plain point cloud, not just "the same points with more
 * particles":
 *
 *  1. Every particle is a Gaussian-profile anti-aliased sprite (tight core
 *     blended toward a soft wide glow per-particle, see
 *     PARTICLE_CORE_GLSL) instead of a hard-edged smoothstep disc.
 *  2. The humanoid is three visually distinct populations — structural /
 *     luminous / peripheral (see humanoidField.js's LAYER_* tagging) —
 *     each with its own size/brightness/softness treatment, not one
 *     uniform cloud.
 *  3. The whole scene renders into an offscreen framebuffer first, then
 *     goes through a real multi-pass bloom (bright-pass -> two blur
 *     scales -> tonemapped composite) before it ever reaches the canvas.
 *
 * Still deliberately bypasses p5's high-level drawing API for the actual
 * particle draw — a single raw gl.drawArrays(POINTS, ...) call per
 * population, no per-particle JS object or vertex()/ellipse() call — and
 * rigid body-part motion (shoulder -> neck -> head) is still three 4x4
 * matrices (gl-matrix) computed once per frame and skinned per-vertex by a
 * part-id attribute, unchanged from before.
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

// ---- Shared particle sprite profile ----------------------------------------
// Every particle (humanoid or environment) is shaded by this one function:
// a per-particle blend between a tight, bright, nearly-hard core and a
// wide, soft Gaussian glow, with an explicit circular cutoff so the point
// sprite's own square bounding box never shows (no "square dot" artifact).
// `softness` (0 = sharp core dominant, 1 = wide glow dominant) is what
// gives structural/luminous/peripheral — and far/fog/aura/foreground —
// their distinct optical character from the exact same shader.
const PARTICLE_CORE_GLSL = `
  float particleProfile(vec2 pointCoord, float softness) {
    vec2 c = (pointCoord - 0.5) * 2.0;
    float d = length(c);
    if (d > 1.0) return 0.0;
    float core = exp(-d * d * 4.0);
    float glow = exp(-d * d * 1.3);
    float profile = mix(core, glow, clamp(softness, 0.0, 1.0));
    float edgeMask = smoothstep(1.0, 0.8, d);
    return profile * edgeMask;
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
  attribute float aLayer;

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
  // .x = structural, .y = luminous, .z = peripheral — see humanoidField.js
  // LAYER_STRUCTURAL/LUMINOUS/PERIPHERAL and aLayer.
  uniform vec3 uLayerSizeMul;
  uniform vec3 uLayerBrightMul;
  uniform vec3 uLayerSoftness;

  varying float vBrightness;
  varying float vEdge;
  varying float vRandom;
  varying float vSoftness;
  varying float vLayer;

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

    float sizeMul, brightMul, softnessVal;
    if (aLayer < 0.5) {
      sizeMul = uLayerSizeMul.x; brightMul = uLayerBrightMul.x; softnessVal = uLayerSoftness.x;
    } else if (aLayer < 1.5) {
      sizeMul = uLayerSizeMul.y; brightMul = uLayerBrightMul.y; softnessVal = uLayerSoftness.y;
    } else {
      sizeMul = uLayerSizeMul.z; brightMul = uLayerBrightMul.z; softnessVal = uLayerSoftness.z;
    }

    float sizeAtten = 1.0 / max(-viewPos.z, 0.001);
    gl_PointSize = aSize * uSizeScale * uPixelRatio * sizeAtten * sizeMul;

    vBrightness = aBrightness * brightMul;
    vEdge = aEdge;
    vRandom = aRandom;
    vSoftness = softnessVal;
    vLayer = aLayer;
  }
`;

const HUMANOID_FRAG = `
  precision highp float;
  varying float vBrightness;
  varying float vEdge;
  varying float vRandom;
  varying float vSoftness;
  varying float vLayer;

  uniform vec3 uColorPrimary;
  uniform vec3 uColorSecondary;
  uniform vec3 uColorHighlight;
  uniform float uAudioTreble;
  uniform float uTrebleSparkleScale;
  uniform float uAudioEnergy;
  uniform float uEnergyBrightnessScale;

  ${PARTICLE_CORE_GLSL}

  void main() {
    float profile = particleProfile(gl_PointCoord, vSoftness);
    if (profile <= 0.0015) discard;

    float edgeFade = 1.0 - smoothstep(0.6, 1.7, vEdge);

    vec3 color = mix(uColorSecondary, uColorPrimary, clamp(vRandom * 1.3, 0.0, 1.0));
    color = mix(color, uColorHighlight, clamp((vBrightness - 0.7) * 1.6, 0.0, 1.0) * step(0.7, vRandom));
    // Luminous/peripheral layers lean toward the hot highlight color for a
    // stronger "energy accent" read, distinct from the structural bulk.
    color = mix(color, uColorHighlight, clamp(vLayer - 0.5, 0.0, 1.0) * 0.4);

    // Treble -> fine sparkle concentrated at the peripheral/edge particles.
    float sparkle = uAudioTreble * uTrebleSparkleScale * smoothstep(0.5, 1.3, vEdge) * step(0.6, vRandom);

    float energyLift = 1.0 + uAudioEnergy * uEnergyBrightnessScale;
    float alpha = profile * vBrightness * edgeFade * energyLift + sparkle * profile;
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
  }
`;

// ---- Environment layers: one generic shader, four parameterizations -----
// far field / fog band / aura / foreground (see humanoidField.js's
// buildFarField/buildFogBandField/buildAuraField/buildForegroundField and
// CONFIG.ENVIRONMENT) all share this program — only the per-layer uniforms
// (color, size, alpha, softness, depth-fade range, drift amount/speed)
// differ, set fresh before each of the four draw calls in
// ParticleSystem._drawEnvLayer().
const ENV_VERT = `
  attribute vec3 aPosition;
  attribute float aSize;
  attribute float aRandom;
  attribute vec3 aSeed;

  uniform mat4 uProjectionMatrix;
  uniform mat4 uViewMatrix;
  uniform float uTime;
  uniform vec2 uFlowVelocity;
  uniform float uPixelRatio;
  uniform float uSizeConstant;
  uniform float uAlphaBase;
  uniform float uAlphaRandomScale;
  uniform float uDepthFadeFar;
  uniform float uDepthFadeNear;
  uniform float uDriftAmount;
  uniform float uDriftSpeedScale;

  varying float vAlpha;
  varying float vSoftness;

  void main() {
    vec3 pos = aPosition;
    float t = uTime * uDriftSpeedScale;
    pos.x += sin(t * (0.1 + aRandom * 0.15) + aSeed.x * 6.283) * uDriftAmount;
    pos.y += cos(t * (0.08 + aRandom * 0.12) + aSeed.y * 6.283) * uDriftAmount * 0.85;
    pos.xy += uFlowVelocity * (0.15 + aRandom * 0.3);

    vec4 viewPos = uViewMatrix * vec4(pos, 1.0);
    gl_Position = uProjectionMatrix * viewPos;

    float sizeAtten = 1.0 / max(-viewPos.z, 0.001);
    gl_PointSize = aSize * uPixelRatio * sizeAtten * uSizeConstant;

    float depthFade = smoothstep(uDepthFadeFar, uDepthFadeNear, viewPos.z);
    vAlpha = (uAlphaBase + aRandom * uAlphaRandomScale) * depthFade;
  }
`;

const ENV_FRAG = `
  precision highp float;
  varying float vAlpha;
  uniform vec3 uColor;
  uniform float uSoftness;

  ${PARTICLE_CORE_GLSL}

  void main() {
    float profile = particleProfile(gl_PointCoord, uSoftness);
    float alpha = profile * vAlpha;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

// ---- Fullscreen-quad post-processing passes --------------------------------
const QUAD_VERT = `
  attribute vec2 aPos;
  attribute vec2 aUV;
  varying vec2 vUV;
  void main() {
    vUV = aUV;
    gl_Position = vec4(aPos, 0.0, 1.0);
  }
`;

const BRIGHT_FRAG = `
  precision highp float;
  varying vec2 vUV;
  uniform sampler2D uScene;
  uniform float uThreshold;
  uniform float uKnee;
  void main() {
    vec4 c = texture2D(uScene, vUV);
    float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
    float knee = uKnee + 0.0001;
    float soft = clamp(lum - uThreshold + knee, 0.0, 2.0 * knee);
    soft = (soft * soft) / (4.0 * knee);
    float contrib = max(soft, lum - uThreshold);
    float scale = contrib / max(lum, 0.0001);
    gl_FragColor = vec4(c.rgb * scale, 1.0);
  }
`;

// Separable 5-tap Gaussian (linear-sampling optimized: 2 texture fetches
// cover the outer 4 taps), run twice per bloom scale (horizontal, then
// vertical) — the standard cheap real-time blur.
const BLUR_FRAG = `
  precision highp float;
  varying vec2 vUV;
  uniform sampler2D uTex;
  uniform vec2 uTexel;
  uniform vec2 uDirection;
  void main() {
    vec3 sum = texture2D(uTex, vUV).rgb * 0.227027;
    vec2 off1 = uDirection * uTexel * 1.3846153846;
    vec2 off2 = uDirection * uTexel * 3.2307692308;
    sum += texture2D(uTex, vUV + off1).rgb * 0.3162162162;
    sum += texture2D(uTex, vUV - off1).rgb * 0.3162162162;
    sum += texture2D(uTex, vUV + off2).rgb * 0.0702702703;
    sum += texture2D(uTex, vUV - off2).rgb * 0.0702702703;
    gl_FragColor = vec4(sum, 1.0);
  }
`;

const PASSTHROUGH_FRAG = `
  precision highp float;
  varying vec2 vUV;
  uniform sampler2D uTex;
  void main() {
    gl_FragColor = texture2D(uTex, vUV);
  }
`;

// Recomposites scene + two bloom scales (a tight hot core, a broad soft
// halo) with a Reinhard-style tonemap so accumulated brightness rolls off
// smoothly instead of hard-clipping into a flat cyan blob.
const COMPOSITE_FRAG = `
  precision highp float;
  varying vec2 vUV;
  uniform sampler2D uScene;
  uniform sampler2D uBloomTight;
  uniform sampler2D uBloomWide;
  uniform float uTightStrength;
  uniform float uWideStrength;
  uniform float uGamma;
  void main() {
    vec4 scene = texture2D(uScene, vUV);
    vec3 bloomT = texture2D(uBloomTight, vUV).rgb;
    vec3 bloomW = texture2D(uBloomWide, vUV).rgb;
    vec3 color = scene.rgb + bloomT * uTightStrength + bloomW * uWideStrength;
    color = color / (1.0 + color);
    color = pow(max(color, 0.0), vec3(uGamma));
    gl_FragColor = vec4(color, scene.a);
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

// ---- Offscreen framebuffer helpers -----------------------------------------
function createFBO(gl, width, height) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    throw new Error('Framebuffer incomplete: 0x' + status.toString(16));
  }
  return { fbo, tex, width, height };
}

function deleteFBO(gl, obj) {
  if (!obj) return;
  gl.deleteFramebuffer(obj.fbo);
  gl.deleteTexture(obj.tex);
}

function createQuadBuffer(gl) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  // x, y, u, v — two triangles covering clip space.
  const data = new Float32Array([
    -1, -1, 0, 0,
     1, -1, 1, 0,
    -1,  1, 0, 1,
    -1,  1, 0, 1,
     1, -1, 1, 0,
     1,  1, 1, 1,
  ]);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buf;
}

function bindQuadAttribs(gl, program, quadBuffer) {
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  const posLoc = gl.getAttribLocation(program, 'aPos');
  const uvLoc = gl.getAttribLocation(program, 'aUV');
  if (posLoc >= 0) {
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
  }
  if (uvLoc >= 0) {
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);
  }
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

// The four environment layers share one buffer shape ({position, size,
// random, seed}) and one draw call recipe — only the source buffers, the
// particle count and CONFIG.ENVIRONMENT's per-layer params differ.
const ENV_LAYERS = [
  { key: 'far', builder: buildFarField },
  { key: 'fog', builder: buildFogBandField },
  { key: 'aura', builder: buildAuraField },
  { key: 'foreground', builder: buildForegroundField },
];

const FBO_KEYS = ['sceneFBO', 'brightFBO', 'tightBlurA', 'tightBlurB', 'wideDownFBO', 'wideBlurA', 'wideBlurB'];

class ParticleSystem {
  constructor(p, counts) {
    this.p = p;
    this.gl = p.drawingContext;
    this.pivots = new Pivots();

    this.humanoidProgram = createProgram(this.gl, HUMANOID_VERT, HUMANOID_FRAG);
    this.envProgram = createProgram(this.gl, ENV_VERT, ENV_FRAG);

    this.clock = 0;
    this.idleSeed = Math.random() * 1000;
    this.flowVelX = 0;
    this.flowVelY = 0;

    this.buildBuffers(counts);

    this.projectionMatrix = window.glMatrix.mat4.create();
    this.viewMatrix = window.glMatrix.mat4.create();

    this._initBloom();
  }

  /** Sets up the post-processing pipeline. Failure here (an unusual GL
   *  implementation that can't complete a render-to-texture framebuffer)
   *  falls back to rendering the scene straight to the canvas — degraded,
   *  but never a crash. */
  _initBloom() {
    const gl = this.gl;
    this.bloomSupported = false;
    try {
      this.brightProgram = createProgram(gl, QUAD_VERT, BRIGHT_FRAG);
      this.blurProgram = createProgram(gl, QUAD_VERT, BLUR_FRAG);
      this.passProgram = createProgram(gl, QUAD_VERT, PASSTHROUGH_FRAG);
      this.compositeProgram = createProgram(gl, QUAD_VERT, COMPOSITE_FRAG);
      this.quadBuffer = createQuadBuffer(gl);
      this._buildFBOs();
      this.bloomSupported = true;
    } catch (err) {
      console.warn('Bloom post-processing unavailable — rendering without it.', err);
      this.bloomSupported = false;
    }
  }

  _disposeFBOs() {
    const gl = this.gl;
    for (const key of FBO_KEYS) {
      if (this[key]) {
        deleteFBO(gl, this[key]);
        this[key] = null;
      }
    }
  }

  _buildFBOs() {
    const gl = this.gl;
    this._disposeFBOs();
    const w = Math.max(2, gl.drawingBufferWidth);
    const h = Math.max(2, gl.drawingBufferHeight);
    const B = CONFIG.BLOOM;
    const tw = Math.max(2, Math.floor(w / B.tightResDivisor));
    const th = Math.max(2, Math.floor(h / B.tightResDivisor));
    const ww = Math.max(2, Math.floor(w / B.wideResDivisor));
    const wh = Math.max(2, Math.floor(h / B.wideResDivisor));

    this.sceneFBO = createFBO(gl, w, h);
    this.brightFBO = createFBO(gl, tw, th);
    this.tightBlurA = createFBO(gl, tw, th);
    this.tightBlurB = createFBO(gl, tw, th);
    this.wideDownFBO = createFBO(gl, ww, wh);
    this.wideBlurA = createFBO(gl, ww, wh);
    this.wideBlurB = createFBO(gl, ww, wh);

    this._fboWidth = w;
    this._fboHeight = h;
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
      layer: makeAttribBuffer(gl, field.layer),
    };

    this.envBuffers = {};
    this.envCounts = {};
    for (const layer of ENV_LAYERS) {
      const data = layer.builder(counts[layer.key]);
      this.envCounts[layer.key] = data.count;
      this.envBuffers[layer.key] = {
        position: makeAttribBuffer(gl, data.positions),
        size: makeAttribBuffer(gl, data.sizes),
        random: makeAttribBuffer(gl, data.randoms),
        seed: makeAttribBuffer(gl, data.seeds),
      };
    }
  }

  /** Rebuilds particle buffers at a different quality preset (adaptive
   *  downgrade) without recreating shader programs or the GL context. */
  rebuild(counts) {
    const gl = this.gl;
    for (const buf of Object.values(this.humanoidBuffers)) gl.deleteBuffer(buf);
    for (const layer of ENV_LAYERS) {
      for (const buf of Object.values(this.envBuffers[layer.key])) gl.deleteBuffer(buf);
    }
    this.buildBuffers(counts);
  }

  setCamera(aspect) {
    const { mat4 } = window.glMatrix;
    const C = CONFIG.CAMERA;
    mat4.perspective(this.projectionMatrix, C.fovDeg * (Math.PI / 180), aspect, C.near, C.far);
    mat4.lookAt(this.viewMatrix, [0, C.lookY, C.distance], [0, C.lookY, 0], [0, 1, 0]);

    if (this.bloomSupported) {
      const gl = this.gl;
      if (gl.drawingBufferWidth !== this._fboWidth || gl.drawingBufferHeight !== this._fboHeight) {
        try {
          this._buildFBOs();
        } catch (err) {
          console.warn('Failed to resize bloom framebuffers — disabling bloom.', err);
          this.bloomSupported = false;
        }
      }
    }
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

  /** Draws one environment layer (far / fog / aura / foreground) — same
   *  program and buffer shape throughout, only CONFIG.ENVIRONMENT[key]'s
   *  uniforms and the flow-velocity sensitivity differ. */
  _drawEnvLayer(key, flowScale) {
    const gl = this.gl;
    const E = CONFIG.ENVIRONMENT[key];
    const buffers = this.envBuffers[key];
    const program = this.envProgram;
    const u = (name) => gl.getUniformLocation(program, name);

    gl.uniform3fv(u('uColor'), E.color);
    gl.uniform1f(u('uSizeConstant'), E.sizeConstant);
    gl.uniform1f(u('uAlphaBase'), E.alphaBase);
    gl.uniform1f(u('uAlphaRandomScale'), E.alphaRandomScale);
    gl.uniform1f(u('uSoftness'), E.softness);
    gl.uniform1f(u('uDepthFadeFar'), E.depthFadeFar);
    gl.uniform1f(u('uDepthFadeNear'), E.depthFadeNear);
    gl.uniform1f(u('uDriftAmount'), E.driftAmount);
    gl.uniform1f(u('uDriftSpeedScale'), E.driftSpeedScale);
    gl.uniform2f(u('uFlowVelocity'), this.flowVelX * flowScale, this.flowVelY * flowScale);

    bindAttrib(gl, program, 'aPosition', buffers.position, 3);
    bindAttrib(gl, program, 'aSize', buffers.size, 1);
    bindAttrib(gl, program, 'aRandom', buffers.random, 1);
    bindAttrib(gl, program, 'aSeed', buffers.seed, 3);
    gl.drawArrays(gl.POINTS, 0, this.envCounts[key]);
  }

  /** Renders the full scene (environment + humanoid) into whatever
   *  framebuffer is currently bound — the offscreen sceneFBO when bloom
   *  is active, or straight to the canvas in the fallback path. */
  _renderScene(pose, audio) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // ---- Environment: back-to-front (far -> fog -> aura). ----------------
    resetAttribs(gl);
    gl.useProgram(this.envProgram);
    this._setCommonUniforms(gl, this.envProgram, audio);
    this._drawEnvLayer('far', 0.012);
    this._drawEnvLayer('fog', 0.03);
    this._drawEnvLayer('aura', 0.06);

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

    const PL = CONFIG.PARTICLE_LAYERS;
    gl.uniform3f(u('uLayerSizeMul'), PL.structural.sizeMul, PL.luminous.sizeMul, PL.peripheral.sizeMul);
    gl.uniform3f(u('uLayerBrightMul'), PL.structural.brightMul, PL.luminous.brightMul, PL.peripheral.brightMul);
    gl.uniform3f(u('uLayerSoftness'), PL.structural.softness, PL.luminous.softness, PL.peripheral.softness);

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
    bindAttrib(gl, hp, 'aLayer', this.humanoidBuffers.layer, 1);

    gl.drawArrays(gl.POINTS, 0, this.humanoidCount);

    // ---- Foreground: sparse, soft, close-to-camera parallax dust drawn
    // last so it reads as being in front of the figure. -------------------
    resetAttribs(gl);
    gl.useProgram(this.envProgram);
    this._setCommonUniforms(gl, this.envProgram, audio);
    this._drawEnvLayer('foreground', 0.09);
  }

  _blurPass(srcTex, destFBO, dirX, dirY) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, destFBO.fbo);
    gl.viewport(0, 0, destFBO.width, destFBO.height);
    resetAttribs(gl);
    gl.useProgram(this.blurProgram);
    bindQuadAttribs(gl, this.blurProgram, this.quadBuffer);
    const u = (name) => gl.getUniformLocation(this.blurProgram, name);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(u('uTex'), 0);
    gl.uniform2f(u('uTexel'), 1 / destFBO.width, 1 / destFBO.height);
    gl.uniform2f(u('uDirection'), dirX, dirY);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Full pipeline: scene -> offscreen FBO -> bright-pass -> two blur
   *  scales (tight + wide) -> tonemapped composite onto the canvas. */
  _drawWithBloom(pose, audio) {
    const gl = this.gl;
    const B = CONFIG.BLOOM;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFBO.fbo);
    gl.viewport(0, 0, this.sceneFBO.width, this.sceneFBO.height);
    this._renderScene(pose, audio);

    gl.disable(gl.BLEND);

    // Bright-pass.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.brightFBO.fbo);
    gl.viewport(0, 0, this.brightFBO.width, this.brightFBO.height);
    resetAttribs(gl);
    gl.useProgram(this.brightProgram);
    bindQuadAttribs(gl, this.brightProgram, this.quadBuffer);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneFBO.tex);
    gl.uniform1i(gl.getUniformLocation(this.brightProgram, 'uScene'), 0);
    gl.uniform1f(gl.getUniformLocation(this.brightProgram, 'uThreshold'), B.threshold);
    gl.uniform1f(gl.getUniformLocation(this.brightProgram, 'uKnee'), B.knee);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Tight bloom: brightFBO -> blur H -> blur V.
    this._blurPass(this.brightFBO.tex, this.tightBlurA, 1, 0);
    this._blurPass(this.tightBlurA.tex, this.tightBlurB, 0, 1);

    // Downsample brightFBO into the wide scale's smaller resolution.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.wideDownFBO.fbo);
    gl.viewport(0, 0, this.wideDownFBO.width, this.wideDownFBO.height);
    resetAttribs(gl);
    gl.useProgram(this.passProgram);
    bindQuadAttribs(gl, this.passProgram, this.quadBuffer);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.brightFBO.tex);
    gl.uniform1i(gl.getUniformLocation(this.passProgram, 'uTex'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Wide bloom: wideDownFBO -> blur H -> blur V.
    this._blurPass(this.wideDownFBO.tex, this.wideBlurA, 1, 0);
    this._blurPass(this.wideBlurA.tex, this.wideBlurB, 0, 1);

    // Composite -> canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    resetAttribs(gl);
    gl.useProgram(this.compositeProgram);
    bindQuadAttribs(gl, this.compositeProgram, this.quadBuffer);
    const cu = (name) => gl.getUniformLocation(this.compositeProgram, name);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneFBO.tex);
    gl.uniform1i(cu('uScene'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.tightBlurB.tex);
    gl.uniform1i(cu('uBloomTight'), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.wideBlurB.tex);
    gl.uniform1i(cu('uBloomWide'), 2);
    gl.uniform1f(cu('uTightStrength'), B.tightStrength);
    gl.uniform1f(cu('uWideStrength'), B.wideStrength);
    gl.uniform1f(cu('uGamma'), B.tonemapGamma);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  draw(pose, audio) {
    const gl = this.gl;
    if (this.bloomSupported) {
      this._drawWithBloom(pose, audio);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      this._renderScene(pose, audio);
    }
  }

  dispose() {
    const gl = this.gl;
    for (const buf of Object.values(this.humanoidBuffers)) gl.deleteBuffer(buf);
    for (const layer of ENV_LAYERS) {
      for (const buf of Object.values(this.envBuffers[layer.key])) gl.deleteBuffer(buf);
    }
    gl.deleteProgram(this.humanoidProgram);
    gl.deleteProgram(this.envProgram);
    if (this.bloomSupported) {
      this._disposeFBOs();
      gl.deleteBuffer(this.quadBuffer);
      gl.deleteProgram(this.brightProgram);
      gl.deleteProgram(this.blurProgram);
      gl.deleteProgram(this.passProgram);
      gl.deleteProgram(this.compositeProgram);
    }
  }
}
