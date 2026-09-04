import * as THREE from 'three';
import { COLORS, AMBIENT, RENDER } from '../config';
import { damp } from '../utils/math';

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aRandom;
  attribute vec3 aSeed;

  uniform float uTime;
  uniform vec2 uPointerVelocity;
  uniform float uVelocityInfluence;
  uniform float uPixelRatio;

  varying float vAlpha;

  void main() {
    vec3 pos = position;

    pos.x += sin(uTime * (0.1 + aRandom * 0.15) + aSeed.x * 6.283) * 0.06;
    pos.y += cos(uTime * (0.08 + aRandom * 0.12) + aSeed.y * 6.283) * 0.05;
    pos.xy += uPointerVelocity * uVelocityInfluence * (0.2 + aRandom * 0.4);

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    float sizeAtten = 1.0 / max(-mvPosition.z, 0.001);
    gl_PointSize = aSize * uPixelRatio * sizeAtten * 55.0;
    gl_Position = projectionMatrix * mvPosition;

    float depthFade = smoothstep(-16.0, -2.0, mvPosition.z);
    vAlpha = (0.08 + aRandom * 0.18) * depthFade;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying float vAlpha;
  uniform vec3 uColor;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float alpha = smoothstep(0.5, 0.0, d) * vAlpha;
    if (alpha < 0.008) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

/**
 * Sparse, restrained environment dust — deliberately far lower density and
 * dimmer than the humanoid field so it reads as ambient atmosphere, never
 * competing with the figure for attention.
 */
export class AmbientDust {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private velocityX = 0;
  private velocityY = 0;

  constructor() {
    const count = AMBIENT.count;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const randoms = new Float32Array(count);
    const seeds = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(THREE.MathUtils.lerp(-0.3, 1, Math.random()));
      const r = AMBIENT.radius * (0.55 + Math.pow(Math.random(), 1.6) * 0.45);

      positions[i * 3] = Math.sin(phi) * Math.cos(theta) * r + (Math.random() - 0.5) * AMBIENT.spread;
      positions[i * 3 + 1] = Math.cos(phi) * r * 0.6 + 0.6;
      positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r * 0.6 - 2;

      sizes[i] = THREE.MathUtils.lerp(0.4, 1.0, Math.random()) * AMBIENT.size;
      randoms[i] = Math.random();
      seeds[i * 3] = Math.random();
      seeds[i * 3 + 1] = Math.random();
      seeds[i * 3 + 2] = Math.random();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(COLORS.silver) },
        uPointerVelocity: { value: new THREE.Vector2(0, 0) },
        uVelocityInfluence: { value: AMBIENT.velocityInfluence },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, RENDER.maxPixelRatio) },
      },
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
  }

  update(dt: number, pointerVelX: number, pointerVelY: number): void {
    this.velocityX = damp(this.velocityX, pointerVelX, 2.5, dt);
    this.velocityY = damp(this.velocityY, pointerVelY, 2.5, dt);
    this.material.uniforms.uTime.value += dt;
    (this.material.uniforms.uPointerVelocity.value as THREE.Vector2).set(
      this.velocityX * 0.05,
      this.velocityY * 0.05
    );
  }

  setPixelRatio(pr: number): void {
    this.material.uniforms.uPixelRatio.value = pr;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
