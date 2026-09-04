import * as THREE from 'three';
import { ATMOSPHERE } from '../config';
import { damp } from '../utils/math';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uOpacity;

  void main() {
    vec2 c = vUv - 0.5;
    float d = length(c);
    float falloff = smoothstep(0.5, 0.0, d);
    falloff = pow(falloff, 1.4);
    gl_FragColor = vec4(uColor, falloff * uOpacity);
  }
`;

// A large backdrop plane with a true vertical gradient — the cinematic
// "sky" behind everything. Rendered as ordinary scene geometry (not
// scene.background) since a CanvasTexture background silently broke
// rendering in this project's target environment.
const backdropFragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uTop;
  uniform vec3 uMid;
  uniform vec3 uBottom;

  void main() {
    vec3 color = mix(uBottom, uMid, smoothstep(0.0, 0.55, vUv.y));
    color = mix(color, uTop, smoothstep(0.55, 1.0, vUv.y));
    gl_FragColor = vec4(color, 1.0);
  }
`;

interface HazeLayer {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  parallax: number;
  baseX: number;
  baseY: number;
}

/**
 * Soft, layered depth haze behind the humanoid — large low-opacity radial
 * gradient planes at increasing depth, standing in for volumetric fog at
 * a fraction of the cost. Replaces a flat backdrop with a sense of deep,
 * cinematic atmosphere the figure sits inside rather than in front of.
 */
export class Atmosphere {
  readonly group = new THREE.Group();
  private readonly layers: HazeLayer[] = [];
  private readonly backdropGeometry: THREE.PlaneGeometry;
  private readonly backdropMaterial: THREE.ShaderMaterial;
  private parallaxX = 0;
  private parallaxY = 0;

  constructor() {
    const backdropGeometry = new THREE.PlaneGeometry(1, 1);
    const backdropMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: backdropFragmentShader,
      transparent: false,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uTop: { value: new THREE.Color(ATMOSPHERE.backdropTop) },
        uMid: { value: new THREE.Color(ATMOSPHERE.backdropMid) },
        uBottom: { value: new THREE.Color(ATMOSPHERE.backdropBottom) },
      },
    });
    const backdrop = new THREE.Mesh(backdropGeometry, backdropMaterial);
    backdrop.scale.set(46, 30, 1);
    backdrop.position.set(0, 2, -16);
    backdrop.renderOrder = -20;
    this.group.add(backdrop);
    this.backdropGeometry = backdropGeometry;
    this.backdropMaterial = backdropMaterial;

    const specs = ATMOSPHERE.layers;

    for (const spec of specs) {
      const geometry = new THREE.PlaneGeometry(1, 1);
      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.NormalBlending,
        uniforms: {
          uColor: { value: new THREE.Color(spec.color) },
          uOpacity: { value: spec.opacity },
        },
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.scale.set(spec.size, spec.size, 1);
      mesh.position.set(spec.x, spec.y, spec.z);
      mesh.renderOrder = -10;
      this.group.add(mesh);
      this.layers.push({ mesh, material, parallax: spec.parallax, baseX: spec.x, baseY: spec.y });
    }
  }

  update(dt: number, pointerX: number, pointerY: number): void {
    this.parallaxX = damp(this.parallaxX, pointerX, 1.4, dt);
    this.parallaxY = damp(this.parallaxY, pointerY, 1.4, dt);
    for (const layer of this.layers) {
      layer.mesh.position.x = layer.baseX + this.parallaxX * layer.parallax;
      layer.mesh.position.y = layer.baseY + this.parallaxY * layer.parallax * 0.5;
    }
  }

  dispose(): void {
    this.backdropGeometry.dispose();
    this.backdropMaterial.dispose();
    for (const layer of this.layers) {
      layer.mesh.geometry.dispose();
      layer.material.dispose();
    }
  }
}
