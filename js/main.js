import { parseOBJ } from './objParser.js';
import { buildAnatomyParticles } from './anatomy.js';
import { buildFieldParticles } from './environment.js';
import { ParticleRenderer } from './renderer.js';
import { MicEnergy } from './audio.js';

const DEG2RAD = Math.PI / 180;
const YAW_MAX = 22 * DEG2RAD;
const PITCH_MAX = 11 * DEG2RAD;

const ANATOMY_COUNT = 15000;
const BACKGROUND_COUNT = 5000;
const FOREGROUND_COUNT = 350;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function easeTowards(current, target, rate, dt) {
  const t = 1 - Math.exp(-rate * dt);
  return current + (target - current) * t;
}

const sketch = (p) => {
  let objLines = null;
  let renderer = null;
  let mic = null;
  let ready = false;

  const angles = {
    gazeYaw: 0, gazePitch: 0,
    headYaw: 0, headPitch: 0,
    neckYaw: 0, neckPitch: 0,
  };
  const parallax = { x: 0, y: 0 };

  p.preload = () => {
    objLines = p.loadStrings('assets/models/male_head_mid_jc.obj');
  };

  p.setup = () => {
    const density = Math.min(2, window.devicePixelRatio || 1);
    p.pixelDensity(density);
    p.createCanvas(window.innerWidth, window.innerHeight, p.WEBGL);
    p.noStroke();

    const gl = p.drawingContext;
    renderer = new ParticleRenderer(gl);

    const mesh = parseOBJ(objLines.join('\n'));
    const anatomy = buildAnatomyParticles(mesh, ANATOMY_COUNT);
    renderer.setAnatomyData(anatomy);

    const field = buildFieldParticles(BACKGROUND_COUNT, FOREGROUND_COUNT);
    renderer.setFieldData(field);

    renderer.resize(window.innerWidth, window.innerHeight);

    mic = new MicEnergy();
    const micButton = document.getElementById('mic-enable');
    if (micButton) {
      micButton.addEventListener('click', () => {
        if (p.getAudioContext && p.getAudioContext().state !== 'running') {
          p.userStartAudio();
        }
        mic.start();
        micButton.classList.add('mic-enabled');
        micButton.textContent = 'Listening…';
      });
    }

    ready = true;
  };

  p.draw = () => {
    if (!ready) return;
    const dt = Math.min(0.05, p.deltaTime / 1000 || 0.016);
    const time = p.millis() / 1000;

    const nx = clamp((p.mouseX - p.width / 2) / (p.width / 2), -1, 1);
    const ny = clamp((p.mouseY - p.height / 2) / (p.height / 2), -1, 1);
    const targetYaw = nx * YAW_MAX;
    const targetPitch = -ny * PITCH_MAX;

    angles.gazeYaw = easeTowards(angles.gazeYaw, targetYaw, 9.0, dt);
    angles.gazePitch = easeTowards(angles.gazePitch, targetPitch, 9.0, dt);
    angles.headYaw = easeTowards(angles.headYaw, targetYaw, 3.4, dt);
    angles.headPitch = easeTowards(angles.headPitch, targetPitch, 3.4, dt);
    angles.neckYaw = easeTowards(angles.neckYaw, targetYaw, 1.4, dt);
    angles.neckPitch = easeTowards(angles.neckPitch, targetPitch, 1.4, dt);

    parallax.x = easeTowards(parallax.x, nx, 0.8, dt);
    parallax.y = easeTowards(parallax.y, ny, 0.8, dt);

    const micEnergy = mic.update(dt);

    p.background(3, 7, 13);

    renderer.draw({
      time,
      micEnergy,
      pixelDensity: p.pixelDensity(),
      gazeAngle: [angles.gazeYaw, angles.gazePitch],
      headAngle: [angles.headYaw, angles.headPitch],
      neckAngle: [angles.neckYaw, angles.neckPitch],
      parallax: [parallax.x, parallax.y],
    });
  };

  p.windowResized = () => {
    p.resizeCanvas(window.innerWidth, window.innerHeight);
    if (renderer) renderer.resize(window.innerWidth, window.innerHeight);
  };
};

window.addEventListener('DOMContentLoaded', () => {
  const P5 = window.p5;
  // eslint-disable-next-line no-new
  new P5(sketch, 'sketch-holder');
});
