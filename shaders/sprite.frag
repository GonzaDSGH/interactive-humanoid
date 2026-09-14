// ------------------------------------------------------------------
// sprite.frag — one high quality point sprite for every population:
// circular support, smooth radial falloff, anti-aliased rim and a
// slightly brighter core.  No square pixels anywhere.
// ------------------------------------------------------------------
precision mediump float;

varying vec3  v_color;
varying float v_alpha;
varying float v_core;

void main() {
  vec2 pc = gl_PointCoord - vec2(0.5);
  float r = length(pc) * 2.0;
  if (r > 1.0) discard;

  float rim  = 1.0 - smoothstep(0.50, 1.0, r);   // anti-aliased perimeter
  float glow = exp(-r * r * 2.6);                // soft luminous body
  float core = pow(max(0.0, 1.0 - r), 3.5) * v_core;

  float a = v_alpha * (rim * 0.55 * glow + core * 0.9);
  if (a <= 0.002) discard;

  vec3 c = v_color + vec3(0.22, 0.30, 0.36) * core;
  gl_FragColor = vec4(c, a);
}
