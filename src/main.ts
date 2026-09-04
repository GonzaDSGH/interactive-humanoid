import * as THREE from 'three';
import { SceneManager } from './core/SceneManager';
import { PointerTracker } from './input/PointerTracker';
import { AttentionController } from './input/AttentionController';
import { Humanoid, FACE_CORE_LAYER } from './humanoid/Humanoid';
import { Landscape } from './environment/Landscape';
import { Atmosphere } from './environment/Atmosphere';
import { HUD } from './environment/HUD';
import { Particles } from './environment/Particles';
import { DebugPanel } from './debug/DebugPanel';
import { RENDER } from './config';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const loadingEl = document.getElementById('loading');

const sceneManager = new SceneManager(canvas);
const pointer = new PointerTracker(canvas);
const attention = new AttentionController(pointer);
const humanoid = new Humanoid();
const atmosphere = new Atmosphere();
const landscape = new Landscape();
const hud = new HUD();
const particles = new Particles();
const debugPanel = new DebugPanel();

landscape.group.position.z = 0;
// Atmosphere first — it renders behind everything else (renderOrder -10).
sceneManager.scene.add(atmosphere.group);
sceneManager.scene.add(humanoid.group);
sceneManager.scene.add(landscape.group);
// HUD and particles are parented to the humanoid's stable (non-rotating)
// group so their head-relative positioning stays correct automatically.
humanoid.group.add(hud.group);
humanoid.group.add(particles.points);

function handleResize(): void {
  sceneManager.resize(window.innerWidth, window.innerHeight);
  particles.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
}
window.addEventListener('resize', handleResize);

const clock = new THREE.Clock();
let firstFrame = true;

function animate(): void {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 1 / 20);

  const pose = attention.update(dt);
  humanoid.update(dt, pose);
  atmosphere.update(dt, pointer.target.x, pointer.target.y);
  landscape.update(dt, pointer.target.x, pointer.target.y);
  hud.update(dt, pointer.target.x, pointer.target.y);
  particles.update(dt, pointer.velocity.x, pointer.velocity.y);

  sceneManager.render(dt);
  sceneManager.renderOverlayLayer(FACE_CORE_LAYER);
  debugPanel.update(dt, pose, pointer.target);

  if (firstFrame) {
    firstFrame = false;
    loadingEl?.classList.add('hidden');
    window.setTimeout(() => loadingEl?.remove(), 900);
  }
}

animate();
