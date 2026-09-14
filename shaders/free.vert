// ------------------------------------------------------------------
// free.vert — detached particles shed by fast real movement.
// Positions are integrated on the CPU in a recycled pool.
// ------------------------------------------------------------------

attribute vec4 a_state; // x, y (screen px), depth, size
attribute vec2 a_extra; // alpha, seed

uniform vec2  u_res;
uniform vec4  u_misc;
uniform float u_pointScale;

varying vec3  v_color;
varying float v_alpha;
varying float v_core;

void main() {
  float shade = 0.65 + 0.45 * a_extra.y;
  v_color = coolPalette(shade);
  v_alpha = a_extra.x * 0.75;
  v_core  = 0.9;

  float sz = a_state.w * u_pointScale * 0.55;
  gl_PointSize = clamp(sz, 0.8, u_misc.y);
  gl_Position = clipFromScreen(a_state.xy, u_res, 0.0);
}
