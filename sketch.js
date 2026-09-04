/**
 * sketch.js — p5.js entry point and orchestration.
 *
 * Ties together: the pointer-attention system (attention.js), the
 * microphone/FFT analysis (audio.js) and the GPU particle renderer
 * (particleSystem.js, humanoidField.js). p5 itself is only used for the
 * WEBGL canvas/context, the render loop and window/DOM plumbing — all of
 * the actual particle animation happens in particleSystem.js's own
 * shaders and raw gl calls.
 */

let pointer, attention, audio, particleSystem;
let qualityIndex = 0; // index into CONFIG.QUALITY_ORDER — starts at ULTRA
let debugMode = false;
let debugEl = null;
let audioStarted = false;

// Adaptive quality bookkeeping.
let lastAdaptiveCheck = 0;
let consecutiveBadChecks = 0;
let adaptiveCooldownUntil = 0;

function currentQualityCounts() {
  return CONFIG.QUALITY[CONFIG.QUALITY_ORDER[qualityIndex]];
}

// p5 calls this once the DOM + p5 core are ready.
function setup() {
  // Tell the boot watchdog (index.html) that p5 itself loaded and started
  // running our code — if this line is never reached, every earlier script
  // load/parse/MIME failure is still caught, but this is the confirmation
  // that everything up to and including p5 succeeded.
  if (window.__markAppStarted) window.__markAppStarted();

  try {
    // Let the WebGL context composite with alpha so the CSS radial-gradient
    // behind the canvas (see style.css) reads through as the atmospheric
    // backdrop — no extra background draw call needed.
    setAttributes('alpha', true);
    const canvas = createCanvas(windowWidth, windowHeight, WEBGL);
    canvas.parent(document.body);
    pixelDensity(Math.min(window.devicePixelRatio || 1, CONFIG.MAX_PIXEL_RATIO));
    noStroke();

    debugMode = new URLSearchParams(window.location.search).get('debug') === '1';
    debugEl = document.getElementById('debug');
    if (debugMode && debugEl) debugEl.hidden = false;

    pointer = new PointerTracker();
    attention = new AttentionController(pointer);
    audio = new AudioAnalyzer();
    particleSystem = new ParticleSystem(this, currentQualityCounts());
    particleSystem.setCamera(width / height);

    setupPointerEvents();
    setupActivation();

    frameRate(60);
  } catch (err) {
    // A thrown error here (e.g. WebGL unavailable, a shader compile
    // failure) would otherwise leave the activation screen sitting inert
    // forever with nothing in the UI explaining why. Surface it instead.
    console.error('Fatal error during setup():', err);
    if (window.__bootErrors) {
      window.__bootErrors.push('setup() failed: ' + (err && err.message ? err.message : err));
    }
    const el = document.getElementById('fatal-error');
    if (el) {
      el.hidden = false;
      const pre = el.querySelector('pre');
      if (pre) {
        pre.textContent =
          'No se pudo iniciar la experiencia / Failed to start.\n\nsetup() failed: ' +
          (err && err.stack ? err.stack : err) +
          '\n\nCheck the browser console for details.';
      }
    }
    noLoop();
  }
}

function draw() {
  // p5's own clear — alpha 0 so the CSS radial-gradient behind the canvas
  // shows through as the atmospheric backdrop (no extra draw call needed).
  clear();

  const dt = Math.min(deltaTime / 1000, 1 / 20);
  const nowMs = performance.now();

  const pose = attention.update(dt);
  audio.update();
  particleSystem.update(dt, pose, pointer.velocity.x, pointer.velocity.y, audio);
  particleSystem.draw(pose, audio);

  checkAdaptiveQuality(nowMs);
  updateDebugPanel(pose);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  particleSystem.setCamera(width / height);
}

// ---- Pointer (attention target) -------------------------------------------
// Raw DOM events rather than p5's mouseX/mouseY: precise normalization and a
// real "pointer left the window" signal (mouseleave/blur), matching the
// original interaction design this system's behavior was preserved from.
function setupPointerEvents() {
  window.addEventListener(
    'pointermove',
    (e) => {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = -((e.clientY / window.innerHeight) * 2 - 1);
      pointer.onMove(nx, ny);
    },
    { passive: true }
  );
  document.addEventListener('mouseleave', () => pointer.onLeave());
  document.addEventListener('mouseenter', () => pointer.onEnter());
  window.addEventListener('blur', () => pointer.onLeave());
}

// ---- Activation screen (mandatory user gesture for microphone) -----------
function setupActivation() {
  const overlay = document.getElementById('activation');
  const btn = document.getElementById('activate-btn');
  if (!btn || !overlay) return;

  btn.addEventListener('click', async () => {
    if (audioStarted) return;
    audioStarted = true;
    btn.textContent = 'CONECTANDO…';
    await audio.start();
    overlay.classList.add('hidden');
    window.setTimeout(() => overlay.remove(), 1000);
  });
}

// ---- Adaptive performance ---------------------------------------------------
// Sustained-FPS check: only ever downgrades (never upgrades back — the
// brief explicitly asks to avoid visible quality flicker), and only after
// several consecutive bad samples, with a cooldown between downgrades.
function checkAdaptiveQuality(nowMs) {
  const A = CONFIG.ADAPTIVE;
  if (nowMs < adaptiveCooldownUntil) return;
  if (nowMs - lastAdaptiveCheck < A.checkIntervalMs) return;
  lastAdaptiveCheck = nowMs;

  const fps = frameRate();
  if (fps > 0 && fps < A.downgradeFpsThreshold) {
    consecutiveBadChecks++;
  } else {
    consecutiveBadChecks = 0;
  }

  if (consecutiveBadChecks >= A.consecutiveBadChecksToDowngrade) {
    if (qualityIndex < CONFIG.QUALITY_ORDER.length - 1) {
      qualityIndex++;
      particleSystem.rebuild(currentQualityCounts());
    }
    consecutiveBadChecks = 0;
    adaptiveCooldownUntil = nowMs + A.cooldownMs;
  }
}

// ---- Debug overlay (?debug=1 only) -----------------------------------------
function updateDebugPanel(pose) {
  if (!debugMode || !debugEl) return;
  const envTotal = Object.values(particleSystem.envCounts || {}).reduce((sum, n) => sum + n, 0);
  const totalParticles = (particleSystem.humanoidCount || 0) + envTotal;
  debugEl.textContent = [
    `fps         ${frameRate().toFixed(0)}`,
    `quality     ${CONFIG.QUALITY_ORDER[qualityIndex]}`,
    `particles   ${totalParticles}`,
    `mic ready   ${audio.ready}`,
    `amplitude   ${audio.amplitude.toFixed(3)}`,
    `bass        ${audio.bass.toFixed(3)}`,
    `mid         ${audio.mid.toFixed(3)}`,
    `treble      ${audio.treble.toFixed(3)}`,
    `pointer     ${pointer.target.x.toFixed(2)}, ${pointer.target.y.toFixed(2)}`,
    `head yaw    ${(pose.head.yaw * (180 / Math.PI)).toFixed(1)}°`,
    `torso yaw   ${(pose.torso.yaw * (180 / Math.PI)).toFixed(1)}°`,
  ].join('\n');
}
