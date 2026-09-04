/**
 * Central tuning constants — quality presets, palette, camera, field
 * shapes and interaction dynamics all live here.
 *
 * DYNAMICS / LIMITS / POINTER are the pointer-attention interaction core
 * (see attention.js) and should stay stable. Everything else is the
 * generative visual system and is safe to retune freely.
 */

const DEG = Math.PI / 180;

const CONFIG = {
  // ---- Quality presets -----------------------------------------------
  // Particle counts per body-part field, at each adaptive-quality level.
  // ULTRA is attempted first; see sketch.js for the adaptive downgrade.
  QUALITY: {
    // Face count roughly doubled vs. earlier tiers — the face is now a
    // displacement-mapped relief (brow/eyes/nose/cheeks/chin), which needs
    // real density to read clearly rather than a flat bright patch did.
    // aura/far/fog/fg are the four environment layers (see ENVIRONMENT
    // below and buildFarField/buildFogBandField/buildAuraField/
    // buildForegroundField in humanoidField.js) — the scene is no longer
    // "humanoid + one ambient dust cloud".
    // Trimmed from the previous pass's counts on purpose: rendering
    // quality now comes from the layered particle shader + bloom
    // pipeline (see PARTICLE_LAYERS/BLOOM below and particleSystem.js),
    // not from raw density — a smaller, better-rendered population reads
    // richer than a larger flat one.
    ULTRA: { head: 27000, face: 19000, neck: 5000, shoulder: 34000, aura: 1300, far: 3000, fog: 2400, foreground: 220 },
    HIGH: { head: 16000, face: 11500, neck: 3000, shoulder: 20000, aura: 820, far: 1850, fog: 1450, foreground: 130 },
    MEDIUM: { head: 8000, face: 5800, neck: 1500, shoulder: 10000, aura: 480, far: 950, fog: 750, foreground: 70 },
  },
  QUALITY_ORDER: ['ULTRA', 'HIGH', 'MEDIUM'],
  // Sustained-FPS check: sample window, threshold, and cooldown between
  // possible downgrades (never upgrades — avoids visible quality flicker).
  ADAPTIVE: {
    checkIntervalMs: 1000,
    downgradeFpsThreshold: 44,
    consecutiveBadChecksToDowngrade: 3,
    cooldownMs: 9000,
  },

  // ---- Palette (cold only — no warm center) ---------------------------
  COLOR_PRIMARY: [0.21, 0.84, 1.0],
  COLOR_SECONDARY: [0.06, 0.44, 0.6],
  COLOR_HIGHLIGHT: [0.85, 0.97, 1.0],
  BACKGROUND_ALPHA_CLEAR: true,

  // ---- Camera -----------------------------------------------------------
  CAMERA: {
    fovDeg: 34,
    // Pulled in from 5.0 for stronger screen occupancy — the bust should
    // fill a strong portion of the viewport, not float small in it.
    distance: 4.55,
    lookY: -0.15,
    near: 0.1,
    far: 60,
  },

  // ---- Skeleton (joint offsets only — no mesh) -------------------------
  SKELETON: {
    neckHeight: 0.26,
    groupOffsetY: -0.4,
  },

  // ---- Head geometry source: real OBJ mesh, sampled -> particles ---------
  // The head/face is no longer procedural (see headMesh.js): the visible
  // head particles are area-weighted surface samples of a real scanned/
  // sculpted human head mesh (assets/head-mesh.json — positions + triangle
  // indices only, in the mesh's own coordinate space; loaded once via
  // p5's loadJSON in preload()). The mesh itself is NEVER rendered — only
  // sampled points feed the exact same particle pipeline the old
  // procedural head used (writeParticle, the structural/luminous/
  // peripheral layer split, the shoulder->neck->head skinning). scale/
  // offsetY/offsetZ map the mesh's own meters into this project's
  // head-local particle space (head-local y=0 is the rigid head pivot —
  // see particleSystem.js Pivots — which sits below the visible head,
  // roughly at the atlanto-occipital joint, matching where the old
  // procedural head/face content also bottomed out).
  HEAD_MESH: {
    url: 'assets/head-mesh.json',
    // Uniform scale only (no per-axis stretch) — the whole point of using
    // a real mesh is real proportions; a non-uniform scale would distort
    // them right back into the "blob" look this replaces.
    scale: 3.6,
    offsetX: 0,
    // Calibrated so the mesh's own neck-narrowest point (y ~= 0.155 in
    // the mesh's own space, found via a radius-vs-height profile of the
    // vertex data) lands just above the head pivot (head-local y ~= 0.05),
    // safely inside the existing procedural neck's own upward overlap
    // reach (sampleNeck samples up to neck-local y = height*1.68).
    offsetY: -0.508,
    offsetZ: 0,
    // Mesh-space (pre-scale) Y band over which triangles fade OUT of the
    // sample pool: below fadeLowY is the mesh's shirt-collar/bust base
    // (never sampled — the procedural neck/shoulders own that territory
    // entirely), between fadeLowY and fadeHighY inclusion weight ramps
    // 0->1 so the OBJ-derived jaw/neck stub feathers into the procedural
    // neck instead of a hard geometric seam.
    fadeLowY: 0.06,
    fadeHighY: 0.16,
    // Landmark centers in the mesh's OWN (pre-transform) space, found by
    // querying the actual vertex data for local extrema (most-forward
    // point for the nose tip, widest point per height band for cheek/jaw,
    // most-recessed point for the eye socket, etc.) rather than guessed —
    // this mesh's own anatomy, not a hand-authored formula.
    // Eye sockets are deliberately NOT in this list: a real eye socket is
    // a recessed, dimmer landmark, not a bright one (the old procedural
    // faceRelief agreed — eyeMask was always subtracted, never added).
    // Listing them as a brighten-salience landmark was tried and produced
    // two solid saturated-white ovals where the eyes should be (additive
    // luminous particles piling up on a small screen-space area) — the
    // single worst readability failure in an early pass of this system.
    landmarks: {
      browR: [0.021, 0.329, 0.139], browL: [-0.021, 0.329, 0.139],
      noseBridge: [0, 0.295, 0.125], noseTip: [0, 0.266, 0.160],
      cheekR: [0.100, 0.289, 0.007], cheekL: [-0.100, 0.289, 0.007],
      mouth: [0, 0.1875, 0.1275],
      jawR: [0.109, 0.131, -0.035], jawL: [-0.109, 0.131, -0.035],
      chin: [0, 0.1785, 0.0965],
    },
    // Gaussian falloff radius for landmark proximity (mesh-space units,
    // pre-scale) and how strongly it biases the salience population's
    // rejection sampling / brightness. Kept tight — a wide radius lets
    // neighboring landmarks' gaussians sum together into one big bright
    // patch instead of distinct accents (also found the hard way).
    landmarkRadius: 0.032,
    // How far peripheral/aura samples get pushed outward along the local
    // surface normal, in head-local units (post-scale) — a loose shell
    // just outside the strict surface, not sitting on it.
    auraPush: [0.02, 0.11],
    // Population split of the combined old head+face particle budget
    // (counts.head + counts.face) across the three explicitly distinct
    // mesh-derived populations. Must sum to 1.
    structuralFraction: 0.78,
    salienceFraction: 0.06,
    peripheralFraction: 0.16,
  },

  // ---- Analytic body-part volumes (ellipsoid semi-axes + center) ------
  // Head/face no longer live here — see CONFIG.HEAD_MESH above; that
  // geometry now comes from the real head mesh, not an analytic shape.
  FIELD: {
    // widthRatio/depthRatio give the neck an elliptical (not circular)
    // cross-section — wider side-to-side than front-to-back, like a real
    // neck rather than a tube.
    neck: { topRadius: 0.2, bottomRadius: 0.29, widthRatio: 1.2, depthRatio: 0.76 },
    // Widened slightly for stronger bust presence (closer to the ~2.2x
    // head-width anthropometric shoulder span the reference asked for).
    shoulders: { radii: [1.14, 0.62, 0.5], center: [0, -0.5, 0] },
  },

  PARTICLE_FIELD: {
    haloFraction: 0.15,
    haloDepth: 0.42,
    centerBias: 1.05,
    pointSizeRange: [0.85, 1.9],
    facePointSizeRange: [0.85, 1.55],
    brightnessRange: [0.4, 1.0],
    // Narrower than the old flat-patch range on purpose: with a real
    // relief field now driving depth, a wide per-particle brightness
    // lottery on top of it produces occasional outlier-bright particles
    // that, under sparse sampling, connect into false "line" artifacts
    // rather than reading as soft shading. Depth cues the anatomy instead
    // (the shader's perspective size falloff already makes closer/raised
    // particles read subtly larger); brightness just needs to stay gentle.
    faceBrightnessRange: [0.55, 0.95],
    faceShiftScale: 1.6,
    flowInfluence: 0.075,
    flowInfluenceByPart: { shoulder: 0.35, neck: 0.65, head: 1.0 },
    idleDriftAmount: 0.014,
    idleDriftSpeed: 0.16,
    // Coherent-noise flow field (Perlin-style, evaluated in GLSL) —
    // autonomous organic motion independent of pointer/audio input.
    noiseFlowAmount: 0.028,
    noiseFlowSpeed: 0.05,
    noiseFlowScale: 1.6,
  },

  // ---- Environment: four cooperating particle layers ---------------------
  // (see humanoidField.js buildFarField/buildFogBandField/buildAuraField/
  // buildForegroundField, and particleSystem.js's single generic
  // ENV_VERT/ENV_FRAG shader that all four are rendered with, parameterized
  // per layer). Depth values are WORLD-space z; depthFadeNear/Far below are
  // VIEW-space z (camera-relative, always negative) — always pass Far more
  // negative than Near so smoothstep(Far, Near, viewZ) reads as "closer
  // within this layer's own range = brighter, farther = dimmer".
  ENVIRONMENT: {
    // Distant field: fills the whole viewport at depth so the scene never
    // goes to flat black once the humanoid's own silhouette ends.
    // sizeConstant looks small on paper but isn't: gl_PointSize = aSize *
    // pixelRatio * sizeConstant / distanceFromCamera, and these layers
    // sit 8-20+ units out — at that range 1/distance alone is ~0.05-0.14,
    // so a "normal" constant (like the humanoid's own ~10.5) renders as a
    // near-invisible 2-3px speck. These need to be large, soft, bokeh-like
    // discs (matching the reference pack's fullscreen composition, not a
    // sharp pinprick starfield) to read as atmosphere at all.
    far: {
      halfWidth: 11, halfHeight: 6.5, yBias: 0.4, depthNear: -8, depthFar: -19,
      color: [0.14, 0.42, 0.58], sizeConstant: 55, alphaBase: 0.1, alphaRandomScale: 0.16,
      depthFadeFar: -24, depthFadeNear: -10, driftAmount: 0.05, driftSpeedScale: 0.45, softness: 0.82,
    },
    // Horizon-like undulating band (reference: blue particle fog / wave
    // field), denser near its own crest line, thinning into rising dust
    // above it. See buildFogBandField's layered-sine undulation. Pushed
    // clearly below the shoulder line — at the earlier baseY it mostly
    // sat behind/inside the shoulder silhouette and never read as its own
    // distinct floor-level haze.
    fog: {
      halfWidth: 8.5, baseY: -2.6, waveAmplitude: 0.34, thickness: 0.44, riseHeight: 2.6,
      depthNear: -3.2, depthFar: -9,
      color: [0.24, 0.64, 0.86], sizeConstant: 85, alphaBase: 0.1, alphaRandomScale: 0.2,
      depthFadeFar: -14, depthFadeNear: -6, driftAmount: 0.09, driftSpeedScale: 0.75, softness: 0.68,
    },
    // Halo immediately around the bust — blends its silhouette edge into
    // the surrounding atmosphere instead of a hard cutoff into black.
    aura: {
      radius: 1.95, spread: 1.25, yBias: 0.12, depthBias: -1.75,
      color: [0.3, 0.78, 0.97], sizeConstant: 60, alphaBase: 0.1, alphaRandomScale: 0.19,
      depthFadeFar: -9, depthFadeNear: -5.5, driftAmount: 0.065, driftSpeedScale: 1.0, softness: 0.6,
    },
    // Sparse, soft, close-to-camera particles for occasional foreground
    // parallax. Kept far enough from the camera (depthFar well short of
    // CAMERA.distance) and modestly sized — an earlier ambient-dust layer
    // in this project once got this wrong and blew out into oversized
    // near-camera points; kept deliberately conservative here.
    foreground: {
      halfWidth: 2.6, halfHeight: 1.5, yBias: -0.1, depthNear: 1.2, depthFar: 3.6,
      color: [0.55, 0.85, 0.97], sizeConstant: 11, alphaBase: 0.028, alphaRandomScale: 0.06,
      depthFadeFar: -4.2, depthFadeNear: -1.0, driftAmount: 0.045, driftSpeedScale: 0.6, softness: 0.9,
    },
  },

  // ---- Point rendering --------------------------------------------------
  POINT_SIZE_CONSTANT: 10.5,
  MAX_PIXEL_RATIO: 1.75,

  // ---- Humanoid particle hierarchy ---------------------------------------
  // Every humanoid particle is tagged structural/luminous/peripheral at
  // generation time (see humanoidField.js writeParticle's LAYER_* consts,
  // and splitByLayer which buckets them into three genuinely separate
  // buffers/draw calls). These per-layer multipliers are what makes the
  // three read as visually distinct populations: sizeMul/brightMul scale
  // the particle's own base size/brightness, softness blends the
  // fragment shader's tight core profile (0) toward its wide soft-glow
  // profile (1) — see PARTICLE_CORE_GLSL — highlightMix pulls the color
  // toward the hot highlight tone, and motionSizeResponse is how much
  // this layer's sprites grow under fast pointer motion (0 = stable;
  // structural stays completely stable, anatomy must never wobble).
  //
  // Earlier tuning history worth keeping: the first pass rendered every
  // layer with one additive blend mode for the whole humanoid, including
  // the dense structural bulk — overlapping particles at anatomical
  // landmarks (the nose ridge especially, from importance sampling)
  // stacked straight to saturated white before bloom even applied, and
  // the only lever available was dimming structural brightness/size to
  // compensate. Structural/peripheral now composite with soft (bounded,
  // premultiplied "over") alpha instead — see particleSystem.js
  // _renderScene's SOFT_ALPHA()/ADDITIVE() — so overlap naturally caps at
  // opaque instead of blowing out, and structural brightness could be
  // restored back toward its intended strength.
  PARTICLE_LAYERS: {
    structural: { sizeMul: 0.9, brightMul: 1.0, softness: 0.08, highlightMix: 0.0, motionSizeResponse: 0.0 },
    luminous: { sizeMul: 1.4, brightMul: 1.5, softness: 0.35, highlightMix: 0.5, motionSizeResponse: 0.08 },
    peripheral: { sizeMul: 2.1, brightMul: 0.65, softness: 0.85, highlightMix: 0.15, motionSizeResponse: 0.12 },
  },

  // ---- Depth-based luminance -----------------------------------------------
  // Camera-space depth as an optical signal, not just a size falloff: an
  // eased (not linear) curve centered on the camera's own focal distance
  // (CAMERA.distance) — particles near it read at full contrast, particles
  // further away in front of OR behind it dim gently. See uDepthLumRange/
  // uDepthLumStrength in HUMANOID_VERT.
  DEPTH_LUMINANCE: {
    range: 2.2,
    strength: 0.35,
  },

  // ---- Bloom post-process -------------------------------------------------
  // Real multi-pass bloom over offscreen framebuffers (bright-pass -> blur
  // -> composite), not "bigger/more transparent particles". Two blur
  // scales (tight + wide) composited together for a believable multi-
  // scale glow — a tight hot core plus a broad soft halo, rather than one
  // uniform blur radius. See particleSystem.js's FBO/quad pipeline.
  // threshold is intentionally high: it must catch only genuine luminous-
  // layer accents and dense-cluster hot spots, not the general structural
  // mass — a low threshold bloomed the whole face into a blown-out patch
  // (caught during visual QA; see the pipeline's RENDER_before/after
  // comparison this was verified against).
  BLOOM: {
    threshold: 0.78,
    knee: 0.22,
    tightStrength: 0.5,
    wideStrength: 0.3,
    tightResDivisor: 2,
    wideResDivisor: 4,
    tonemapGamma: 0.92,
  },

  // ---- Idle autonomous motion --------------------------------------------
  IDLE: {
    breathingRate: 0.19,
    breathingAmount: 0.012,
    driftRate: 0.055,
    driftYaw: 1.4 * DEG,
    driftPitch: 0.8 * DEG,
  },

  // ---- Audio reactivity ---------------------------------------------------
  AUDIO: {
    smoothing: 0.82, // exponential smoothing factor for amplitude/bass/mid/treble
    // How strongly each band affects the system. Kept restrained — the
    // brief explicitly forbids aggressive flashing/explosion on speech.
    bassBreathScale: 0.6, // extra breathing amplitude from bass energy
    midFlowScale: 0.5, // extra noise-flow amount from mid energy
    trebleSparkleScale: 0.6, // extra edge-particle brightness from treble
    energyBrightnessScale: 0.35, // overall brightness lift from amplitude
  },

  // ---- Pointer -> attention dynamics (INTERACTION CORE) ------------------
  DYNAMICS: {
    input: { f: 7.5, z: 1.0, r: 0 },
    face: { f: 4.4, z: 0.62, r: 1.4 },
    head: { f: 2.6, z: 0.68, r: 1.0 },
    neck: { f: 1.55, z: 0.78, r: 0.5 },
    shoulders: { f: 0.95, z: 0.88, r: 0.3 },
    torso: { f: 0.62, z: 0.95, r: 0.2 },
  },

  LIMITS: {
    head: { yaw: 24 * DEG, pitch: 14 * DEG, roll: 2.6 * DEG },
    neck: { yaw: 10 * DEG, pitch: 6 * DEG, roll: 1.2 * DEG },
    shoulders: { yaw: 4 * DEG, pitch: 1.6 * DEG, roll: 0.8 * DEG, bob: 0.014 },
    torso: { yaw: 5.5 * DEG, pitch: 2.4 * DEG, roll: 0.6 * DEG },
    faceShift: 0.052,
  },

  POINTER: {
    returnDelayMs: 900,
    returnEase: 1.0,
  },
};
