// ------------------------------------------------------------------
// field.vert — the human.  Every particle owns one fixed analysis cell
// and a fixed random seed, so its identity never pops.  Its existence,
// size, colour and drift are read from the live camera fields.
//
// layer kinds: 0 structural · 1 detail · 2 silhouette · 3 aura
// ------------------------------------------------------------------

attribute vec2 a_cell;   // fixed cell centre in analysis uv space
attribute vec4 a_seed;   // fixed per-particle randomness

uniform sampler2D u_fieldA; // r importance · g person · b motion · a luminance
uniform sampler2D u_fieldB; // r edge · g contrast · b face · a silhouette
uniform sampler2D u_fieldC; // r aura · g held · ba flow
#ifdef INTERPOLATE
// the previous analysis state, tweened towards the current one
uniform sampler2D u_prevA;
uniform sampler2D u_prevB;
uniform sampler2D u_prevC;
uniform float u_blend;
#endif

uniform vec2  u_res;
uniform vec4  u_rect;   // cover rect of the camera frame, in pixels
uniform vec2  u_cell;   // one analysis cell, in uv
uniform float u_time;
uniform float u_presence;
uniform float u_energy;
uniform float u_dispersion;
uniform float u_pointScale;
uniform vec4  u_layer;  // kind, density, sizeBase, alpha
uniform vec4  u_layer2; // sizeVar, jitter, drift, push
uniform vec4  u_misc;   // parallax, maxPointSize, core, spare

varying vec3  v_color;
varying float v_alpha;
varying float v_core;

void main() {
#ifdef INTERPOLATE
  // Analysis runs at the camera's rate, rendering at the display's. Reading
  // the field as a tween between the last two analysis states is what keeps
  // the body moving smoothly at 60fps instead of stepping.
  vec4 A = mix(texture2D(u_prevA, a_cell), texture2D(u_fieldA, a_cell), u_blend);
  vec4 B = mix(texture2D(u_prevB, a_cell), texture2D(u_fieldB, a_cell), u_blend);
  vec4 C = mix(texture2D(u_prevC, a_cell), texture2D(u_fieldC, a_cell), u_blend);
#else
  vec4 A = texture2D(u_fieldA, a_cell);
  vec4 B = texture2D(u_fieldB, a_cell);
  vec4 C = texture2D(u_fieldC, a_cell);
#endif

  float imp      = A.r;
  float motion   = A.b;
  float lum      = A.a;
  float edge     = B.r;
  float contrast = B.g;
  float face     = B.b;
  float silh     = B.a;
  float aura     = C.r;
  float held     = C.g;
  vec2  flow     = C.ba * 2.0 - 1.0;

  float kind = u_layer.x;

  // activation weight: only real camera information switches a particle on
  float w;
  if (kind < 0.5) {
    // `held` outlives `person` by roughly half a second, so when somebody
    // walks out the body lingers briefly and disperses instead of blinking off
    w = max(imp, held * 0.55 * (1.0 - u_presence));              // structural body
  } else if (kind < 1.5) {
    w = imp * (0.20 + 1.75 * contrast + 1.30 * edge + 1.75 * face); // detail
  } else if (kind < 2.5) {
    w = silh * (0.85 + 1.10 * motion);                           // silhouette
  } else {
    w = aura * (0.45 + 0.90 * u_energy);                         // body aura
  }

  // stable stochastic density: the threshold comes from the particle's own
  // seed, so density changes smoothly and no particle flickers
  float thr = u_layer.y;
  float vis = smoothstep(a_seed.x * thr, a_seed.x * thr + 0.16, w);
  if (vis < 0.004) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    v_alpha = 0.0;
    v_color = vec3(0.0);
    v_core = 0.0;
    return;
  }

  vec2 uv = a_cell + (a_seed.yz - 0.5) * u_cell * u_layer2.y;

  // coherent micro-life, amplified where the real body is moving
  vec3 np = vec3(a_cell * 7.0, u_time * 0.28 + a_seed.w * 23.0);
  vec2 drift = (vnoise2(np) - 0.5) * 2.0;
  uv += drift * u_cell * u_layer2.z * (0.55 + 2.4 * motion);

  // lag along the estimated optical flow of the real movement
  uv += flow * u_cell * u_layer2.w * motion * 2.5;

  // dissolve outwards while the presence fades away
  uv += drift * u_dispersion * (0.25 + a_seed.x) * (1.0 - u_presence);

  vec2 scr = u_rect.xy + uv * u_rect.zw;
  float depth = (a_seed.w - 0.5) * 0.9;
  scr += (scr - u_res * 0.5) * depth * u_misc.x;

  // brightness carries the actual camera image: eyes, mouth, folds, edges
  float shade = clamp(0.20 + 0.88 * lum + 0.95 * contrast + 0.45 * edge + 0.35 * face, 0.0, 1.35);
  if (kind > 2.5) shade *= 0.55;

  v_color = coolPalette(shade);
  v_alpha = vis * u_layer.w * (0.55 + 0.62 * shade);
  v_core  = u_misc.z * (0.35 + 0.80 * shade);

  float sz = u_pointScale * (u_layer.z + u_layer2.x * a_seed.w) * (0.78 + 0.42 * shade) * (1.0 + depth * 0.25);
  // a floor keeps particles legible at high analysis resolutions, where one
  // cell maps to only a few screen pixels
  gl_PointSize = clamp(sz, 1.5, u_misc.y);
  gl_Position = clipFromScreen(scr, u_res, 0.0);
}
