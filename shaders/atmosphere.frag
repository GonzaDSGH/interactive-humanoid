// ------------------------------------------------------------------
// atmosphere.frag — very low amplitude blue-black depth so the frame is
// never a flat empty screen.  No grid, no horizon, no HUD.
// ------------------------------------------------------------------
precision mediump float;

varying vec2 v_uv;

uniform float u_time;
uniform vec2  u_center;
uniform float u_presence;
uniform float u_aspect;

float h(vec2 p) {
  return fract(sin(dot(p, vec2(41.7, 289.3))) * 43758.5453);
}

float n2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x),
             mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec2 uv = v_uv;

  float vertical = smoothstep(1.05, -0.15, uv.y);
  vec3 col = mix(vec3(0.008, 0.022, 0.045), vec3(0.020, 0.062, 0.100), vertical);

  float cloud = n2(uv * 2.6 + vec2(u_time * 0.012, u_time * -0.008));
  cloud = cloud * 0.6 + n2(uv * 6.0 - vec2(u_time * 0.02)) * 0.4;
  col += vec3(0.012, 0.034, 0.052) * cloud;

  // a faint halo behind a detected body
  vec2 d = (uv - u_center) * vec2(u_aspect, 1.0);
  float halo = exp(-dot(d, d) * 5.0) * u_presence;
  col += vec3(0.025, 0.075, 0.110) * halo;

  // vignette keeps the focus centred
  float vig = smoothstep(1.15, 0.28, length((uv - 0.5) * vec2(u_aspect, 1.0)));
  col *= 0.45 + 0.55 * vig;

  gl_FragColor = vec4(col, 1.0);
}
