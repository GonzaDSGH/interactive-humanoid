// ------------------------------------------------------------------
// env.vert — the living particle environment.  Fully procedural: seeds
// are static, motion comes from a coherent noise flow field, so these
// layers cost no CPU and no per-frame upload.
// ------------------------------------------------------------------

attribute vec4 a_seed;  // xy base position (0..1) · z depth · w phase

uniform sampler2D u_fieldA;
#ifdef INTERPOLATE
uniform sampler2D u_prevA;
uniform float u_blend;
#endif
uniform vec2  u_res;
uniform vec4  u_rect;
uniform float u_time;
uniform vec2  u_wind;
uniform vec4  u_env;   // speed, noiseScale, sizeBase, alpha
uniform vec4  u_misc;  // parallax, maxPointSize, core, spare
uniform float u_presence;

varying vec3  v_color;
varying float v_alpha;
varying float v_core;

void main() {
  vec2 base = a_seed.xy;
  float depth = a_seed.z;      // 0 far, 1 near
  float phase = a_seed.w;

  float t = u_time * u_env.x * (0.35 + depth);
  vec2 p = base + u_wind * t * 0.6;
  vec2 n = (vnoise2(vec3(base * u_env.y, t * 0.75 + phase * 11.0)) - 0.5) * 2.0;
  p += n * 0.14 * (0.35 + depth);
  p = fract(p + 1.0);

  vec2 scr = p * u_res;
  scr += (scr - u_res * 0.5) * (depth - 0.5) * u_misc.x * 0.6;

  // the environment steps back around a detected body so the figure reads
  float near = 0.0;
  vec2 uv = (scr - u_rect.xy) / u_rect.zw;
  if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
#ifdef INTERPOLATE
    vec4 A = mix(texture2D(u_prevA, uv), texture2D(u_fieldA, uv), u_blend);
#else
    vec4 A = texture2D(u_fieldA, uv);
#endif
    near = max(A.g, A.r);
  }

  float shade = 0.18 + 0.42 * depth + 0.20 * vnoise(vec3(base * 3.0, u_time * 0.1));
  v_color = coolPalette(shade * 0.75);
  v_alpha = u_env.w * (0.30 + 0.85 * depth) * (1.0 - 0.78 * near * u_presence);
  v_core  = 0.25;

  float sz = u_env.z * (0.55 + 0.9 * depth) * (0.8 + 0.5 * phase);
  gl_PointSize = clamp(sz, 0.8, u_misc.y);
  gl_Position = clipFromScreen(scr, u_res, 0.0);
}
