// ------------------------------------------------------------------
// common.glsl — shared vertex-stage helpers (coherent noise, palette,
// screen -> clip mapping).  Prepended to every vertex shader.
// ------------------------------------------------------------------

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

// value noise: coherent, cheap, no trigonometry
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);

  float n000 = hash13(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));

  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}

vec2 vnoise2(vec3 p) {
  return vec2(vnoise(p), vnoise(p + vec3(19.31, 7.77, 41.13)));
}

// deep blue -> cyan -> ice white. No warm hues anywhere.
vec3 coolPalette(float t) {
  t = clamp(t, 0.0, 1.35);
  vec3 deep = vec3(0.020, 0.200, 0.380);
  vec3 cyan = vec3(0.090, 0.700, 0.920);
  vec3 ice  = vec3(0.720, 0.960, 1.000);
  vec3 c = mix(deep, cyan, smoothstep(0.0, 0.55, t));
  c = mix(c, ice, smoothstep(0.58, 1.15, t));
  return c;
}

vec4 clipFromScreen(vec2 s, vec2 res, float z) {
  return vec4((s.x / res.x) * 2.0 - 1.0, 1.0 - (s.y / res.y) * 2.0, z, 1.0);
}
