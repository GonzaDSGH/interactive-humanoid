/**
 * Browser test for Camera Particle Body.
 *
 * Serves the project over http://localhost, feeds Chromium a synthetic webcam
 * (Y4M file), walks the real permission -> model -> particles flow, and asserts
 * that the artwork is particles driven by the person mask.
 *
 * Environment:
 *   CPB_FAKE_CAM    path to a .y4m file used as the fake webcam    (required)
 *   CPB_VENDOR_DIR  directory holding p5.min.js / ml5.min.js /
 *                   mediapipe/ — used to answer CDN requests when the
 *                   machine running the test has no CDN access      (optional)
 *   CPB_OUT         directory for screenshots and the report        (default ./test-output)
 *   CPB_HEADED      "1" to run headed under an X server             (optional)
 *   CPB_SW_RENDER   "1" when there is no GPU: keeps Chromium's 2D canvas and
 *                   video decode on the CPU. Without it, SwiftShader makes
 *                   drawImage(video) ~10x slower and the measured frame rate
 *                   says nothing about real hardware.                (optional)
 *   CPB_CHROME      explicit Chromium binary, when the local build is
 *                   not the one Playwright expects                   (optional)
 *
 * Usage: node tools/camera-test.mjs
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FAKE_CAM = process.env.CPB_FAKE_CAM;
const VENDOR = process.env.CPB_VENDOR_DIR || '';
const OUT = path.resolve(process.env.CPB_OUT || path.join(ROOT, 'test-output'));

if (!FAKE_CAM || !fs.existsSync(FAKE_CAM)) {
  console.error('CPB_FAKE_CAM must point to an existing .y4m file');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png'
};

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/') file = path.join(ROOT, 'index.html');
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** Map a blocked CDN request onto the vendored copy of the same file. */
function vendorPathFor(url) {
  if (!VENDOR) return null;
  let m = url.match(/cdn\.jsdelivr\.net\/npm\/p5@[^/]+\/lib\/(p5(?:\.min)?\.js)$/);
  if (m) return path.join(VENDOR, 'p5.min.js');
  m = url.match(/cdn\.jsdelivr\.net\/npm\/ml5@[^/]+\/dist\/(ml5(?:\.min)?\.js)$/);
  if (m) return path.join(VENDOR, 'ml5.min.js');
  m = url.match(/cdn\.jsdelivr\.net\/npm\/@mediapipe\/selfie_segmentation[^/]*\/(.+)$/);
  if (m) return path.join(VENDOR, 'mediapipe', m[1].split('?')[0]);
  return null;
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Park until the synthetic feed actually has a person on screen. */
async function waitForPerson(page, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const s = await page.evaluate(() => ({
      v: window.CPB.app.visible,
      c: window.CPB.Segmenter.coverage
    }));
    if (s.c > 0.15 && s.v > 2000) return s;
    await sleep(400);
  }
  return null;
}

async function main() {
  const server = await serve();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  console.log(`serving ${ROOT} at ${base}`);

  const browser = await chromium.launch({
    headless: process.env.CPB_HEADED !== '1',
    executablePath: process.env.CPB_CHROME || undefined,
    args: [
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${FAKE_CAM}`,
      '--autoplay-policy=no-user-gesture-required',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      ...(process.env.CPB_SW_RENDER === '1'
        ? ['--disable-accelerated-2d-canvas', '--disable-accelerated-video-decode']
        : [])
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ['camera']
  });

  const consoleErrors = [];
  const pageErrors = [];
  const blocked = [];

  const installRoutes = (target, opts = {}) => target.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (opts.breakML5 && /ml5@/.test(url)) return route.abort();
    const local = vendorPathFor(url);
    if (local && fs.existsSync(local)) {
      const ext = path.extname(local);
      const type = ext === '.js' ? 'text/javascript'
        : ext === '.wasm' ? 'application/wasm'
        : 'application/octet-stream';
      return route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(local) });
    }
    if (!opts.quiet) blocked.push(url);
    return route.abort();
  });
  await installRoutes(context);

  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  const url = `${base}/index.html?debug=1`;
  await page.goto(url, { waitUntil: 'load' });

  // --- libraries + activation screen ------------------------------------
  await page.waitForFunction(() => window.CPB && window.CPB.app && window.CPB.app.p, null, { timeout: 20000 });
  check('p5.js is the runtime', await page.evaluate(() =>
    typeof window.p5 === 'function' && typeof window.setup === 'function' && typeof window.draw === 'function'));
  check('ml5 BodySegmentation API present', await page.evaluate(() =>
    typeof window.ml5 !== 'undefined' && typeof window.ml5.bodySegmentation === 'function'));
  check('activation screen shown before camera use', await page.isVisible('#panel-activate'));
  check('no camera permission requested before activation', await page.evaluate(() =>
    window.CPB.app.state === 'idle'));
  await page.screenshot({ path: path.join(OUT, '01-activation.png') });

  // --- start ------------------------------------------------------------
  const t0 = Date.now();
  await page.click('#start-button');

  await page.waitForFunction(() => window.CPB.app.state === 'running' || window.CPB.app.state === 'error',
    null, { timeout: 120000 });
  const state = await page.evaluate(() => window.CPB.app.state);
  if (state === 'error') {
    const msg = await page.textContent('#error-text');
    const detail = await page.textContent('#error-detail');
    check('pipeline started', false, `${msg} / ${detail}`);
    await page.screenshot({ path: path.join(OUT, '02-error.png') });
    await finish(browser, server);
    return;
  }

  await page.waitForFunction(() => window.CPB.Segmenter.resultCount > 0, null, { timeout: 120000 });
  check('segmentation produced a mask', true, `first result after ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  await page.waitForFunction(() => document.getElementById('overlay').hidden === true, null, { timeout: 20000 });
  check('overlay dismissed — artwork only', true);

  // --- steady state -----------------------------------------------------
  await sleep(4000);

  const info = await page.evaluate(() => ({
    camera: [window.CPB.app.cameraW, window.CPB.app.cameraH],
    proc: [window.CPB.app.procW, window.CPB.app.procH],
    grid: [window.CPB.app.gridW, window.CPB.app.gridH],
    total: window.CPB.Particles.count,
    visible: window.CPB.app.visible,
    maskSource: [window.CPB.Segmenter.sourceW, window.CPB.Segmenter.sourceH],
    maskChannel: window.CPB.Segmenter.channel,
    coverage: window.CPB.Segmenter.coverage,
    maskRate: 1000 / window.CPB.Segmenter.lastLatencyMs,
    fps: window.CPB.Debug.fps,
    timers: { ...window.CPB.Debug.timers },
    videoHidden: (() => {
      const v = document.querySelector('video');
      if (!v) return 'no video element';
      const cs = getComputedStyle(v);
      return cs.display === 'none' || cs.visibility === 'hidden' || v.offsetParent === null;
    })(),
    captureSize: (() => {
      const v = document.querySelector('video');
      return v ? [v.videoWidth, v.videoHeight] : null;
    })()
  }));
  console.log('\ninfo:', JSON.stringify(info, null, 2));

  check('webcam element hidden', info.videoHidden === true, String(info.videoHidden));
  check('grid keeps camera aspect ratio',
    Math.abs((info.grid[0] / info.grid[1]) - (info.camera[0] / info.camera[1])) < 0.02,
    `${info.grid.join('x')} vs ${info.camera.join('x')}`);
  check('particles active on a person', info.visible > 500, `${info.visible} of ${info.total}`);
  check('mask covers a plausible share of frame',
    info.coverage > 0.03 && info.coverage < 0.95, `${(info.coverage * 100).toFixed(1)}%`);

  // --- realtime updates -------------------------------------------------
  const samples = [];
  for (let i = 0; i < 10; i++) {
    samples.push(await page.evaluate(() => ({
      visible: window.CPB.app.visible,
      coverage: window.CPB.Segmenter.coverage,
      results: window.CPB.Segmenter.resultCount,
      fps: window.CPB.Debug.fps,
      frames: window.frameCount
    })));
    await sleep(900);
  }
  const varied = new Set(samples.map((s) => s.visible)).size;
  check('particle field advances continuously',
    samples[samples.length - 1].frames - samples[0].frames > 10,
    `+${samples[samples.length - 1].frames - samples[0].frames} p5 frames`);
  check('segmentation runs continuously',
    samples[samples.length - 1].results - samples[0].results > 10,
    `+${samples[samples.length - 1].results - samples[0].results} masks`);
  check('figure tracks the moving subject', varied >= 5, `${varied}/10 distinct active counts`);

  // --- pixel-level assertions on the rendered artwork -------------------
  check('person present for the render assertions', !!(await waitForPerson(page)));
  await page.screenshot({ path: path.join(OUT, '03-person-particles.png') });
  const pix = await page.evaluate(() => {
    const c = document.querySelector('#stage canvas');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let lit = 0, total = c.width * c.height, blueish = 0, warm = 0, maxV = 0;
    const hist = new Array(8).fill(0);
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const v = Math.max(r, g, b);
      if (v > maxV) maxV = v;
      if (v > 24) {
        lit++;
        if (b >= g && g >= r) blueish++;
        if (r > b + 10) warm++;
        hist[Math.min(7, v >> 5)]++;
      }
    }
    return { lit, total, ratio: lit / total, blueish, warm, maxV, hist };
  });
  console.log('pixels:', JSON.stringify(pix));
  check('background stays near-black', pix.ratio < 0.5, `${(pix.ratio * 100).toFixed(1)}% of pixels lit`);
  check('palette is cyan / blue-white', pix.blueish / Math.max(1, pix.lit) > 0.9 && pix.warm / Math.max(1, pix.lit) < 0.02,
    `${((pix.blueish / pix.lit) * 100).toFixed(1)}% blue-dominant`);
  check('figure has internal tonal structure (not a flat silhouette)',
    pix.hist.filter((h) => h > pix.lit * 0.02).length >= 3,
    `levels: ${pix.hist.join(',')}`);

  // --- particles follow the mask, limbs included ------------------------
  // If the active-particle set matches the person mask cell for cell, then
  // whatever the segmenter calls "person" — a raised arm included — becomes
  // particles by construction.
  await waitForPerson(page);
  const agree = await page.evaluate(() => {
    const C = window.CPB;
    const th = C.CONFIG.importance.maskThreshold;
    let inter = 0, union = 0, maskCells = 0, litCells = 0;
    for (let i = 0; i < C.Particles.count; i++) {
      const a = C.Particles.alpha[i] > 0.05;
      const m = C.Field.gMask[i] > th;
      if (a) litCells++;
      if (m) maskCells++;
      if (a && m) inter++;
      if (a || m) union++;
    }
    return { iou: union ? inter / union : 0, inMask: maskCells ? inter / maskCells : 0, maskCells, litCells };
  });
  check('active particles coincide with the person mask',
    agree.iou > 0.55 && agree.inMask > 0.6,
    `IoU ${agree.iou.toFixed(2)}, ${(agree.inMask * 100).toFixed(0)}% of mask cells lit ` +
    `(${agree.litCells} lit / ${agree.maskCells} mask)`);

  // --- a full-body pose, so limbs are visible in the capture ------------
  for (let i = 0; i < 40; i++) {
    const s = await page.evaluate(() => window.CPB.Segmenter.coverage);
    if (s > 0.05 && s < 0.22) {
      await page.screenshot({ path: path.join(OUT, '06-full-body.png') });
      break;
    }
    await sleep(400);
  }

  // --- resize -----------------------------------------------------------
  await page.setViewportSize({ width: 700, height: 1000 });
  await sleep(1500);
  const resized = await page.evaluate(() => ({
    w: window.CPB.app.viewW, h: window.CPB.app.viewH,
    canvasW: document.querySelector('#stage canvas').width,
    scale: window.CPB.Renderer.scale,
    ox: window.CPB.Renderer.offsetX,
    oy: window.CPB.Renderer.offsetY
  }));
  check('windowResized rebuilds the layout',
    resized.w === 700 && resized.h === 1000,
    JSON.stringify(resized));
  await page.screenshot({ path: path.join(OUT, '04-portrait-resize.png') });
  await page.setViewportSize({ width: 1280, height: 800 });
  await sleep(1200);

  // --- no person in frame ----------------------------------------------
  // The synthetic feed contains empty-room stretches; sample until one shows up.
  let empty = null;
  for (let i = 0; i < 40; i++) {
    const s = await page.evaluate(() => ({
      coverage: window.CPB.Segmenter.coverage,
      visible: window.CPB.app.visible
    }));
    if (s.coverage < 0.02) { empty = s; break; }
    await sleep(500);
  }
  if (empty) {
    // Give the release ramp time to run down at whatever frame rate we get.
    let decayed = empty;
    for (let i = 0; i < 30; i++) {
      decayed = await page.evaluate(() => ({
        coverage: window.CPB.Segmenter.coverage,
        visible: window.CPB.app.visible
      }));
      if (decayed.visible < 500 || decayed.coverage > 0.05) break;
      await sleep(400);
    }
    check('empty frame collapses the figure', decayed.visible < 500,
      `${decayed.visible} particles at ${(decayed.coverage * 100).toFixed(2)}% coverage`);
    await page.screenshot({ path: path.join(OUT, '05-no-person.png') });
  } else {
    check('empty frame collapses the figure', false, 'no empty stretch observed in the feed window');
  }

  // --- input independence ----------------------------------------------
  const usesInput = await page.evaluate(() => ({
    mouse: typeof window.mousePressed === 'function' || typeof window.mouseMoved === 'function' ||
      typeof window.mouseDragged === 'function',
    audio: typeof window.p5 !== 'undefined' && !!window.p5.AudioIn && !!window.__cpbAudio
  }));
  check('no mouse handlers registered', !usesInput.mouse);
  check('no microphone input', !usesInput.audio);

  // --- debug mode gating -----------------------------------------------
  const dbgOn = await page.evaluate(() => window.CPB.CONFIG.debug);
  check('debug HUD enabled by ?debug=1', dbgOn === true);

  const plain = await context.newPage();
  await plain.goto(`${base}/index.html`, { waitUntil: 'load' });
  await plain.waitForFunction(() => window.CPB && window.CPB.CONFIG, null, { timeout: 20000 });
  check('debug HUD off without the flag', await plain.evaluate(() => window.CPB.CONFIG.debug === false));
  await plain.close();

  // --- error paths: no infinite spinner ---------------------------------
  const denied = await browser.newContext({ viewport: { width: 900, height: 600 }, permissions: [] });
  await installRoutes(denied, { quiet: true });
  const deniedPage = await denied.newPage();
  await deniedPage.goto(`${base}/index.html`, { waitUntil: 'load' });
  await deniedPage.waitForFunction(() => window.CPB && window.CPB.app && window.CPB.app.p, null, { timeout: 20000 });
  await deniedPage.click('#start-button');
  await deniedPage.waitForFunction(() => window.CPB.app.state === 'error', null, { timeout: 30000 });
  const deniedTitle = await deniedPage.textContent('#error-title');
  check('denied camera shows a real error, not a spinner',
    (await deniedPage.isVisible('#panel-error')) && !(await deniedPage.isVisible('#panel-status')),
    deniedTitle);
  await deniedPage.screenshot({ path: path.join(OUT, '07-permission-denied.png') });
  await denied.close();

  const noML5 = await browser.newContext({ viewport: { width: 900, height: 600 }, permissions: ['camera'] });
  await installRoutes(noML5, { breakML5: true, quiet: true });
  const noML5Page = await noML5.newPage();
  await noML5Page.goto(`${base}/index.html`, { waitUntil: 'load' });
  await noML5Page.waitForFunction(() => window.CPB && window.CPB.app, null, { timeout: 20000 });
  await noML5Page.waitForFunction(() => window.CPB.app.state === 'error', null, { timeout: 20000 });
  check('failed ml5 load is reported immediately',
    await noML5Page.isVisible('#panel-error'),
    await noML5Page.textContent('#error-title'));
  await noML5Page.screenshot({ path: path.join(OUT, '08-ml5-missing.png') });
  await noML5.close();

  // --- fps --------------------------------------------------------------
  const fpsSamples = samples.map((s) => s.fps).filter((f) => f > 0);
  const avgFps = fpsSamples.reduce((a, b) => a + b, 0) / Math.max(1, fpsSamples.length);
  console.log(`\nmeasured fps (software-rendered headless): ${avgFps.toFixed(1)}`);

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  if (blocked.length) console.log('blocked external requests:', [...new Set(blocked)].slice(0, 10));

  fs.writeFileSync(path.join(OUT, 'report.json'),
    JSON.stringify({ info, pix, samples, agree, resized, avgFps, results, consoleErrors, pageErrors }, null, 2));

  await finish(browser, server);
}

async function finish(browser, server) {
  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
