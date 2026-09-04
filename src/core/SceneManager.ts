import * as THREE from 'three';
import { RENDER, COLORS } from '../config';
import { PostProcessing } from './PostProcessing';

export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly post: PostProcessing;

  private width = 1;
  private height = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.background);
    this.scene.fog = new THREE.FogExp2(COLORS.background, 0.052);

    this.camera = new THREE.PerspectiveCamera(RENDER.fov, 1, RENDER.near, RENDER.far);
    this.camera.position.set(0, RENDER.cameraLookY, RENDER.cameraDistance);
    this.camera.lookAt(0, RENDER.cameraLookY, 0);

    this.post = new PostProcessing(this.renderer, this.scene, this.camera);

    this.resize(window.innerWidth, window.innerHeight);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.post.resize(width, height);
  }

  render(dt: number): void {
    this.post.render(dt);
  }

  /**
   * Renders only objects on the given layer directly to the canvas, on
   * top of the already-composited (bloomed) frame. Used for elements that
   * must NOT pass through the bloom blur pyramid — a soft, translucent
   * radial shape there triggers visible mip-chain ringing artifacts.
   */
  renderOverlayLayer(layer: number): void {
    const prevMask = this.camera.layers.mask;
    this.camera.layers.set(layer);
    // Use the granular clear flags (not the master `autoClear`) so we don't
    // disturb whatever internal clearing state EffectComposer relies on
    // for its own passes on the next frame.
    this.renderer.autoClearColor = false;
    this.renderer.autoClearDepth = false;
    this.renderer.setRenderTarget(null);
    // The canvas's own depth buffer is never written by the composer's
    // full-screen passes, so it's left stale — clear just the depth
    // channel (not color) so this draw's depth test isn't comparing
    // against garbage.
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);
    this.renderer.autoClearColor = true;
    this.renderer.autoClearDepth = true;
    this.camera.layers.mask = prevMask;
  }

  get aspect(): number {
    return this.width / this.height;
  }
}
