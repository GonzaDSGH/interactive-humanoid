import * as THREE from 'three';
import { SceneManager } from './core/SceneManager';
import { PointerTracker } from './input/PointerTracker';
import { AttentionController } from './input/AttentionController';
import { HumanoidParticles } from './particles/HumanoidParticles';
import { Atmosphere } from './environment/Atmosphere';
import { AmbientDust } from './environment/AmbientDust';
import { DebugPanel } from './debug/DebugPanel';
import { RENDER } from './config';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const loadingEl = document.getElementById('loading');

const sceneManager = new SceneManager(canvas);
const pointer = new PointerTracker(canvas);
const attention = new AttentionController(pointer);
const humanoid = new HumanoidParticles();
const atmosphere = new Atmosphere();
const ambientDust = new AmbientDust();
const debugPanel = new DebugPanel();

// Atmosphere first — it renders behind everything else (renderOrder -10/-20).
sceneManager.scene.add(atmosphere.group);
sceneManager.scene.add(ambientDust.points);
sceneManager.scene.add(humanoid.points);

function handleResize(): void {
  sceneManager.resize(window.innerWidth, window.innerHeight);
  const pr = Math.min(window.devicePixelRatio, RENDER.maxPixelRatio);
  humanoid.setPixelRatio(pr);
  ambientDust.setPixelRatio(pr);
}
window.addEventListener('resize', handleResize);

const clock = new THREE.Clock();
let firstFrame = true;

function animate(): void {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 1 / 20);

  const pose = attention.update(dt);
  humanoid.update(dt, pose, pointer.velocity.x, pointer.velocity.y);
  atmosphere.update(dt, pointer.target.x, pointer.target.y);
  ambientDust.update(dt, pointer.velocity.x, pointer.velocity.y);

  sceneManager.render(dt);
  debugPanel.update(dt, pose, pointer.target);

  if (firstFrame) {
    firstFrame = false;
    loadingEl?.classList.add('hidden');
    window.setTimeout(() => loadingEl?.remove(), 900);
  }
}

animate();
