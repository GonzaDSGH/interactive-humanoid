// GLSL ES 1.00 shaders. All per-particle animation (hierarchical rotation,
// breathing, drift, twinkle) happens on the GPU against static attribute
// buffers uploaded once - the CPU only updates a handful of uniforms per
// frame, so particle count stays cheap regardless of scene complexity.

export const ANATOMY_VERT = `
attribute vec3 aBasePos;
attribute vec3 aNormal;
attribute vec3 aInfluence;
attribute vec4 aAttribs;
attribute vec2 aExtra;

uniform mat4 uProj;
uniform mat4 uView;
uniform vec3 uPivot;
uniform vec2 uGazeAngle;
uniform vec2 uHeadAngle;
uniform vec2 uNeckAngle;
uniform float uTime;
uniform float uMicEnergy;
uniform float uPixelDensity;
uniform vec3 uLightDir;

varying float vAlpha;
varying float vColorMix;

vec3 rotateY(vec3 p, float a) {
  float c = cos(a); float s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}
vec3 rotateX(vec3 p, float a) {
  float c = cos(a); float s = sin(a);
  return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}

void main() {
  float yaw = aInfluence.x * uGazeAngle.x + aInfluence.y * uHeadAngle.x + aInfluence.z * uNeckAngle.x;
  float pitch = aInfluence.x * uGazeAngle.y + aInfluence.y * uHeadAngle.y + aInfluence.z * uNeckAngle.y;

  vec3 local = aBasePos - uPivot;
  local = rotateX(rotateY(local, yaw), pitch);
  vec3 worldPos = local + uPivot;

  vec3 rotNormal = rotateX(rotateY(aNormal, yaw), pitch);
  worldPos += rotNormal * aAttribs.x;

  float breathAmt = (0.5 + uMicEnergy * 0.9) * aExtra.y;
  worldPos += aNormal * sin(uTime * 0.55 + aAttribs.w * 6.28318) * 0.035 * breathAmt;

  float jitterScale = mix(0.014, 0.002, aInfluence.x) * (0.4 + 0.6 * uMicEnergy);
  float ph = uTime * 0.9 + aAttribs.w * 37.0;
  vec3 jitter = vec3(
    sin(ph * 1.3 + aAttribs.w * 10.0),
    cos(ph * 1.7 + aAttribs.w * 5.0),
    sin(ph * 0.8 + aAttribs.w * 20.0)
  ) * jitterScale;
  worldPos += jitter;

  vec4 viewPos = uView * vec4(worldPos, 1.0);
  gl_Position = uProj * viewPos;

  float dist = max(-viewPos.z, 0.001);
  float twinkle = 0.85 + 0.15 * sin(uTime * 1.6 + aAttribs.w * 50.0);
  gl_PointSize = clamp(aAttribs.y * uPixelDensity * (260.0 / dist), 1.0, 38.0);

  vec3 n = normalize(rotNormal);
  float ndotl = dot(n, normalize(uLightDir));
  float shade = mix(0.32, 1.0, clamp(ndotl * 0.5 + 0.5, 0.0, 1.0));

  // camera looks down -Z with no rotation between world/view space, so
  // "toward camera" is simply +Z here - fade particles facing away from
  // the viewer instead of depth-sorting a translucent point cloud.
  float ndotcam = dot(n, vec3(0.0, 0.0, 1.0));
  float facing = mix(0.26, 1.0, smoothstep(-0.35, 0.2, ndotcam));

  vAlpha = aAttribs.z * twinkle * shade * facing;
  vColorMix = aExtra.x;
}
`;

export const ANATOMY_FRAG = `
precision mediump float;
varying float vAlpha;
varying float vColorMix;
uniform vec3 uColorCool;
uniform vec3 uColorWarm;

void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv) * 2.0;
  float edge = smoothstep(1.0, 0.0, d);
  edge = pow(edge, 2.2);
  if (edge <= 0.001) discard;
  vec3 color = mix(uColorCool, uColorWarm, vColorMix);
  gl_FragColor = vec4(color * edge, vAlpha * edge);
}
`;

export const FIELD_VERT = `
attribute vec3 aBasePos;
attribute vec3 aAmp;
attribute vec4 aAttribs; // size, alpha, seed, isForeground

uniform mat4 uProj;
uniform mat4 uView;
uniform float uTime;
uniform float uMicEnergy;
uniform vec2 uParallax;
uniform float uPixelDensity;

varying float vAlpha;

void main() {
  float t = uTime * 0.15 + aAttribs.z * 40.0;
  vec3 drift = vec3(
    sin(t * 0.7 + aAttribs.z * 6.0),
    sin(t * 0.9 + aAttribs.z * 3.0 + 1.7),
    sin(t * 0.5 + aAttribs.z * 9.0 + 3.1)
  ) * aAmp * (0.6 + 0.6 * uMicEnergy);

  vec3 pos = aBasePos + drift;
  pos.xy += uParallax * aAttribs.w * 0.7;

  vec4 viewPos = uView * vec4(pos, 1.0);
  gl_Position = uProj * viewPos;

  float dist = max(-viewPos.z, 0.001);
  gl_PointSize = clamp(aAttribs.x * uPixelDensity * (260.0 / dist), 1.0, 34.0);

  float twinkle = 0.5 + 0.5 * sin(uTime * 1.1 + aAttribs.z * 70.0);
  vAlpha = aAttribs.y * (0.5 + 0.5 * twinkle);
}
`;

export const FIELD_FRAG = `
precision mediump float;
varying float vAlpha;
uniform vec3 uFieldColor;

void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv) * 2.0;
  float edge = smoothstep(1.0, 0.0, d);
  edge = pow(edge, 1.6);
  if (edge <= 0.001) discard;
  gl_FragColor = vec4(uFieldColor * edge, vAlpha * edge);
}
`;
