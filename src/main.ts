import * as THREE from 'three';
import { SceneManager } from './core/SceneManager';
import { PointerTracker } from './input/PointerTracker';
import { AttentionController } from './input/AttentionController';
import { Humanoid } from './humanoid/Humanoid';
import { Landscape } from './environment/Landscape';
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
const landscape = new Landscape();
const hud = new HUD();
const particles = new Particles();
const debugPanel = new DebugPanel();

landscape.group.position.z = 0;
sceneManager.scene.add(humanoid.group);
sceneManager.scene.add(landscape.group);
sceneManager.scene.add(hud.group);
sceneManager.scene.add(particles.points);

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
  landscape.update(dt, pointer.target.x, pointer.target.y);
  hud.update(dt, pointer.target.x, pointer.target.y);
  particles.update(dt, pointer.velocity.x, pointer.velocity.y);

  sceneManager.render(dt);
  debugPanel.update(dt, pose, pointer.target);

  if (firstFrame) {
    firstFrame = false;
    loadingEl?.classList.add('hidden');
    window.setTimeout(() => loadingEl?.remove(), 900);
  }
}

animate();
