'use strict';

/* ==================================================================
   sketch.js — p5.js owns everything here: preload, setup, the WEBGL
   canvas, the camera lifecycle, the draw loop, resizing and the final
   composition.  ml5 is only consulted as an analysis layer.

   pipeline
     live camera -> body segmentation -> person mask
                 -> real camera information inside that mask
                 -> importance field -> particle populations -> image
   ================================================================== */

/* ml5 1.0.1 reads a sketch-level `video` binding when it builds a model
   (the pattern every ml5 example uses), so the live capture lives here. */
var video = null;

const APP = {
  state: 'boot',          // boot | idle | permission | select | starting | running | error
  quality: null,
  qualityIndex: CONFIG.startQuality,
  analysisGfx: null,
  aw: 0,
  ah: 0,
  sourceW: 1280,
  sourceH: 960,
  aspect: 4 / 3,
  rect: { x: 0, y: 0, w: 1, h: 1 },
  time: 0,
  lastMs: 0,
  fps: 60,
  analysisMs: 0,
  renderMs: 0,
  freeCount: 0,
  activeEstimate: 0,
  _activeTick: 0,
  _fpsAccum: 0,
  _fpsFrames: 0,
  _lastQualityChange: 0,
  hasSource: false
};

const SHADER_FILES = {
  common: 'shaders/common.glsl',
  fieldVert: 'shaders/field.vert',
  envVert: 'shaders/env.vert',
  freeVert: 'shaders/free.vert',
  spriteFrag: 'shaders/sprite.frag',
  atmoVert: 'shaders/atmosphere.vert',
  atmoFrag: 'shaders/atmosphere.frag'
};
const SHADER_RAW = {};
const SHADER_SRC = {};
let shaderLoadError = '';

/* ---------------------------------------------------------------- */
function preload() {
  for (const key of Object.keys(SHADER_FILES)) {
    const path = SHADER_FILES[key];
    /* p5 assigns callbacks by scanning the arguments for functions, in order,
       so the success handler has to be a real function, not a placeholder. */
    SHADER_RAW[key] = loadStrings(
      path,
      () => { },
      () => {
        shaderLoadError = `Could not load ${path}. Serve the project from a local web server (see README).`;
      }
    );
  }
}

/* ---------------------------------------------------------------- */
function setup() {
  pixelDensity(1);
  const cnv = createCanvas(windowWidth, windowHeight, WEBGL);
  cnv.addClass('artwork-canvas');
  noStroke();
  setAttributes && setAttributes('antialias', false);

  Debug.init();

  for (const key of Object.keys(SHADER_RAW)) {
    SHADER_SRC[key] = (SHADER_RAW[key] || []).join('\n');
  }

  const gl = drawingContext;
  const instance = (typeof p5 !== 'undefined' && p5.instance) ? p5.instance : null;

  if (shaderLoadError) {
    fail('Shader files missing', shaderLoadError, 'Run: python3 -m http.server 8000 and open http://localhost:8000');
    return;
  }
  if (!Renderer.init(gl, instance ? instance._renderer : null, SHADER_SRC)) {
    fail('WebGL initialisation failed', Renderer.error, 'Try a desktop Chrome/Edge/Firefox build with hardware acceleration enabled.');
    return;
  }

  if (QUERY.quality) {
    const forced = QUALITY_LEVELS.findIndex((q) => q.name === QUERY.quality);
    if (forced >= 0) APP.qualityIndex = forced;
    else console.warn(`[presencia] unknown quality "${QUERY.quality}", using ${QUALITY_LEVELS[APP.qualityIndex].name}`);
  }
  buildQuality(APP.qualityIndex, 4 / 3);

  if (QUERY.mock) {
    MockSource.active = true;
    APP.hasSource = true;
    APP.state = 'running';
    document.getElementById('ui').hidden = true;
  } else {
    initUI();
  }

  APP.lastMs = millis();
}

/* ---------------- quality / buffers ---------------- */

function analysisSizeFor(quality, aspect) {
  const cells = quality.aw * quality.ah;
  let ah = Math.round(Math.sqrt(cells / aspect));
  let aw = Math.round(ah * aspect);
  ah = Math.max(60, ah - (ah % 2));
  aw = Math.max(80, aw - (aw % 2));
  return { aw, ah };
}

function buildQuality(index, aspect) {
  const gl = drawingContext;
  APP.qualityIndex = constrain(index, CONFIG.minQuality, CONFIG.maxQuality);
  const q = QUALITY_LEVELS[APP.qualityIndex];
  APP.quality = q;
  APP.aspect = aspect;

  const size = analysisSizeFor(q, aspect);
  APP.aw = size.aw;
  APP.ah = size.ah;

  APP.analysisGfx = new PixelBuffer(APP.aw, APP.ah);

  Analysis.resize(APP.aw, APP.ah);
  Segmentation.resize(APP.aw, APP.ah);
  FaceAnalysis.resize(APP.aw, APP.ah);
  PoseAnalysis.resize(APP.aw, APP.ah);
  if (MockSource.active || QUERY.mock) MockSource.resize(APP.aw, APP.ah);

  Renderer.resizeFields(APP.aw, APP.ah);
  Renderer.uploadFields(Analysis.texA, Analysis.texB, Analysis.texC);

  Particles.build(gl, {
    aw: APP.aw, ah: APP.ah,
    structuralPerCell: q.structuralPerCell,
    detailPerCell: q.detailPerCell,
    silPerCell: q.silPerCell,
    auraPerCell: q.auraPerCell,
    freePool: q.freePool
  });
  Environment.build(gl, q);

  computeRect();
  APP._lastQualityChange = millis();
}

function computeRect() {
  const s = Math.max(width / APP.aw, height / APP.ah);
  const w = APP.aw * s;
  const h = APP.ah * s;
  APP.rect = { x: (width - w) * 0.5, y: (height - h) * 0.5, w, h };
}

/* ---------------- main loop ---------------- */

function draw() {
  const now = millis();
  let dt = (now - APP.lastMs) / 1000;
  APP.lastMs = now;
  dt = constrain(dt, 1 / 240, 1 / 15);
  APP.time += dt;

  const bg = CONFIG.render.backgroundColor;
  background(bg[0], bg[1], bg[2]);
  if (!Renderer.ok) return;

  const t0 = performance.now();
  updateSources(dt);
  const t1 = performance.now();
  renderFrame(dt);
  const t2 = performance.now();

  APP.analysisMs = APP.analysisMs * 0.9 + (t1 - t0) * 0.1;
  APP.renderMs = APP.renderMs * 0.9 + (t2 - t1) * 0.1;
  APP.fps = APP.fps * 0.92 + (1 / dt) * 0.08;

  adaptQuality(now);
  watchSegmentation();

  if (Debug.enabled) {
    if (++APP._activeTick % 15 === 0) APP.activeEstimate = Particles.activeEstimate();
    Debug.update(collectStats());
    if (APP._activeTick % 6 === 0) Debug.drawFields();
  }
}

/* ---------------- analysis ---------------- */

function updateSources(dt) {
  let personRaw = null;

  if (MockSource.active) {
    const px = MockSource.update(APP.time);
    Analysis.readLuminance(px);
    personRaw = MockSource.field;
    APP.hasSource = true;
  } else if (CameraManager.ready && CameraManager.capture) {
    /* the single, controlled mirroring stage of the whole pipeline */
    const g = APP.analysisGfx;
    if (g.capture(CameraManager.capture, QUERY.mirror, false)) {
      Analysis.readLuminance(g.pixels);
    }

    Segmentation.sample(QUERY.mirror);
    personRaw = Segmentation.field;

    FaceAnalysis.update(QUERY.mirror, CameraManager.width, CameraManager.height, dt);
    PoseAnalysis.update(QUERY.mirror, CameraManager.width, CameraManager.height, dt);
    APP.hasSource = true;
  } else {
    APP.hasSource = false;
  }

  if (!APP.hasSource) {
    Analysis.presence = Math.max(0, Analysis.presence - dt * 1.5);
    return;
  }

  Analysis.update(dt, personRaw, FaceAnalysis.field, PoseAnalysis.field);
  Analysis.pack();
  Renderer.uploadFields(Analysis.texA, Analysis.texB, Analysis.texC);

  APP.freeCount = MotionParticles.update(dt, APP.rect, APP.time);
  Particles.uploadFree(drawingContext, APP.freeCount);
}

/* ---------------- rendering ---------------- */

function renderFrame(dt) {
  Environment.update(APP.time);

  const dpr = constrain(height / 900, 0.7, 2.0);
  const state = {
    width: width,
    height: height,
    rect: APP.rect,
    time: APP.time,
    presence: Analysis.presence,
    energy: constrain(Analysis.motionEnergy * 14, 0, 1),
    dispersion: CONFIG.render.dispersion,
    pointScale: Math.max(2.8, APP.rect.h / APP.ah),
    dpr: dpr,
    core: 1.0,
    only: null
  };

  Renderer.begin({ width: width, height: height });

  const cx = (APP.rect.x + Analysis.centroidX * APP.rect.w) / width;
  const cy = (APP.rect.y + Analysis.centroidY * APP.rect.h) / height;
  Renderer.drawAtmosphere(APP.time, cx, cy, Analysis.presence);

  state.only = ['back', 'haze', 'mid'];
  Renderer.drawEnvironment(state);

  state.only = null;
  Renderer.drawHuman(state);
  Renderer.drawFree(state, APP.freeCount);

  state.only = ['fore'];
  Renderer.drawEnvironment(state);

  Renderer.end();
}

/* A model load fails asynchronously, long after startCamera() returned, so
   the failure is surfaced here rather than left as a silent empty screen. */
let _segReported = false;
function watchSegmentation() {
  if (_segReported || MockSource.active || APP.state !== 'running') return;
  if (Segmentation.status !== 'error') return;
  _segReported = true;
  document.getElementById('ui').hidden = false;
  document.getElementById('activate').hidden = true;
  document.getElementById('picker').hidden = true;
  showError({
    title: 'Body segmentation unavailable',
    message: Segmentation.errorMessage,
    hint: 'ml5.js downloads its model at runtime. Check the network connection and reload.'
  });
}

/* ---------------- adaptive quality ---------------- */

function adaptQuality(now) {
  if (!QUERY.adaptive || QUERY.quality) return;
  if (now - APP._lastQualityChange < CONFIG.adaptive.cooldownMs) return;
  APP._fpsAccum += APP.fps;
  APP._fpsFrames++;
  if (APP._fpsFrames < CONFIG.adaptive.sampleFrames) return;
  const avg = APP._fpsAccum / APP._fpsFrames;
  APP._fpsAccum = 0;
  APP._fpsFrames = 0;
  if (avg < CONFIG.adaptive.downFps && APP.qualityIndex > CONFIG.minQuality) {
    buildQuality(APP.qualityIndex - 1, APP.aspect);
  } else if (avg > CONFIG.adaptive.upFps && APP.qualityIndex < CONFIG.maxQuality) {
    buildQuality(APP.qualityIndex + 1, APP.aspect);
  }
}

/* ---------------- p5 lifecycle ---------------- */

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  computeRect();
}

function keyPressed() {
  if (!Debug.enabled) return;
  const k = String(key).toLowerCase();
  if (k === 'd') Debug.toggleStats();
  else if (k === 'v') Debug.toggleViz();
  else if (k === 'q') buildQuality((APP.qualityIndex + 1) % (CONFIG.maxQuality + 1), APP.aspect);
}

/* ---------------- activation interface ---------------- */

function initUI() {
  const ui = document.getElementById('ui');
  ui.hidden = false;
  APP.state = 'idle';

  const activate = document.getElementById('activate');
  const picker = document.getElementById('picker');
  const select = document.getElementById('devices');
  const useBtn = document.getElementById('use-device');
  const retry = document.getElementById('retry');

  const hint = CameraManager.secureContextHint();
  if (hint) setStatus(hint);

  activate.addEventListener('click', async () => {
    hideError();
    activate.disabled = true;
    setStatus('Requesting camera permission…');
    APP.state = 'permission';
    try {
      await CameraManager.requestPermission();
      const devices = await CameraManager.listDevices();
      if (devices.length <= 1) {
        await startCamera(devices.length ? devices[0].deviceId : null);
      } else {
        select.innerHTML = '';
        devices.forEach((d, i) => {
          const opt = document.createElement('option');
          opt.value = d.deviceId;
          opt.textContent = d.label || `Camera ${i + 1}`;
          select.appendChild(opt);
        });
        picker.hidden = false;
        activate.hidden = true;
        setStatus(`${devices.length} cameras available`);
        APP.state = 'select';
      }
    } catch (err) {
      showError(err);
      activate.disabled = false;
    }
  });

  useBtn.addEventListener('click', async () => {
    useBtn.disabled = true;
    await startCamera(select.value);
    useBtn.disabled = false;
  });

  retry.addEventListener('click', () => {
    hideError();
    picker.hidden = true;
    activate.hidden = false;
    activate.disabled = false;
    setStatus('');
    APP.state = 'idle';
  });

  CameraManager.onLost = (info) => {
    APP.state = 'error';
    document.getElementById('ui').hidden = false;
    document.getElementById('activate').hidden = false;
    document.getElementById('activate').disabled = false;
    document.getElementById('picker').hidden = true;
    showError(info);
  };

  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', () => {
      CameraManager.listDevices();
    });
  }
}

async function startCamera(deviceId) {
  APP.state = 'starting';
  setStatus('Opening camera…');
  try {
    await CameraManager.start(deviceId);
  } catch (err) {
    showError(err);
    document.getElementById('activate').hidden = false;
    document.getElementById('activate').disabled = false;
    document.getElementById('picker').hidden = true;
    APP.state = 'error';
    return false;
  }

  video = CameraManager.capture;
  APP.sourceW = CameraManager.width;
  APP.sourceH = CameraManager.height;
  buildQuality(APP.qualityIndex, CameraManager.width / CameraManager.height);

  setStatus('Loading body segmentation…');
  Segmentation.init(video);
  FaceAnalysis.init(video);
  PoseAnalysis.init(video);

  if (Segmentation.status === 'error') {
    showError({
      title: 'Body segmentation unavailable',
      message: Segmentation.errorMessage,
      hint: 'The ml5.js library must be reachable (it is loaded from a CDN). Check your network connection.'
    });
    APP.state = 'error';
    return false;
  }

  /* the artwork takes over: every element of the interface disappears */
  document.getElementById('ui').hidden = true;
  APP.state = 'running';
  return true;
}

function setStatus(msg) {
  const el = document.getElementById('status');
  if (el) el.textContent = msg || '';
}

function hideError() {
  const el = document.getElementById('error');
  if (el) el.hidden = true;
}

function showError(info) {
  setStatus('');
  const box = document.getElementById('error');
  if (!box) return;
  document.getElementById('error-title').textContent = info.title || 'Camera error';
  document.getElementById('error-message').textContent = info.message || '';
  document.getElementById('error-hint').textContent = info.hint || '';
  const devs = document.getElementById('error-devices');
  if (QUERY.debug) {
    devs.hidden = false;
    devs.textContent = 'video inputs:\n' + CameraManager.describeDevices();
  } else {
    devs.hidden = true;
  }
  box.hidden = false;
  console.error('[presencia]', info);
}

function fail(title, message, hint) {
  APP.state = 'error';
  const ui = document.getElementById('ui');
  if (ui) ui.hidden = false;
  const act = document.getElementById('activate');
  if (act) act.hidden = true;
  showError({ title, message, hint });
}

/* ---------------- debug stats ---------------- */

function collectStats() {
  return {
    fps: APP.fps,
    quality: APP.quality ? APP.quality.name : '-',
    cameraLabel: MockSource.active ? 'MOCK SOURCE (dev)' : (CameraManager.label || '-'),
    cameraW: MockSource.active ? MockSource.width : CameraManager.width,
    cameraH: MockSource.active ? MockSource.height : CameraManager.height,
    cameraFps: CameraManager.frameRate,
    aw: APP.aw,
    ah: APP.ah,
    canvasW: width,
    canvasH: height,
    segStatus: MockSource.active ? 'mock' : Segmentation.status,
    segEncoding: Segmentation.encodingLabel(),
    segMs: Segmentation.intervalMs,
    faceStatus: FaceAnalysis.status,
    faceCount: FaceAnalysis.faceCount,
    poseStatus: PoseAnalysis.status,
    poseCount: PoseAnalysis.poseCount,
    presence: Analysis.presence,
    area: Analysis.personArea,
    energy: Analysis.motionEnergy,
    humanTotal: Particles.total,
    humanActive: APP.activeEstimate,
    envTotal: Environment.total,
    freeCount: APP.freeCount,
    analysisMs: APP.analysisMs,
    renderMs: APP.renderMs
  };
}
