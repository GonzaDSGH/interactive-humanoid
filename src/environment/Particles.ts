import * as THREE from 'three';
import { COLORS, PARTICLES, HUMANOID } from '../config';
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

    float drift = sin(uTime * (0.15 + aRandom * 0.25) + aSeed.x * 6.283);
    float driftY = cos(uTime * (0.12 + aRandom * 0.2) + aSeed.y * 6.283);
    pos.x += drift * 0.05 * (0.4 + aRandom);
    pos.y += driftY * 0.045 * (0.4 + aRandom);
    pos.z += sin(uTime * 0.08 + aSeed.z * 6.283) * 0.04;

    pos.xy += uPointerVelocity * uVelocityInfluence * (0.3 + aRandom * 0.7);

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    float sizeAtten = 1.0 / max(-mvPosition.z, 0.001);
    gl_PointSize = aSize * uPixelRatio * sizeAtten * 260.0;
    gl_Position = projectionMatrix * mvPosition;

    float depthFade = smoothstep(-14.0, -1.0, mvPosition.z);
    vAlpha = (0.35 + aRandom * 0.65) * depthFade;
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
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

/** GPU-driven dust: a single draw call, all drift computed in the vertex shader. */
export class Particles {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private velocityX = 0;
  private velocityY = 0;

  constructor() {
    const count = PARTICLES.count;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const randoms = new Float32Array(count);
    const seeds = new Float32Array(count * 3);

    const haloCount = Math.floor(count * 0.6);

    for (let i = 0; i < count; i++) {
      let x: number, y: number, z: number;

      if (i < haloCount) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(THREE.MathUtils.lerp(-0.2, 1, Math.random()));
        const r = HUMANOID.headRadius * THREE.MathUtils.lerp(1.05, 2.5, Math.pow(Math.random(), 1.5));
        x = Math.sin(phi) * Math.cos(theta) * r;
        y = Math.cos(phi) * r * 1.3 + 0.55;
        z = Math.sin(phi) * Math.sin(theta) * r * 0.8;
      } else {
        x = (Math.random() - 0.5) * 20;
        y = THREE.MathUtils.lerp(-2.6, 1.6, Math.random());
        z = THREE.MathUtils.lerp(-11, -2, Math.random());
      }

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      sizes[i] = THREE.MathUtils.lerp(0.5, 1.0, Math.random()) * PARTICLES.size;
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
        uColor: { value: new THREE.Color(COLORS.cyanPrimary) },
        uPointerVelocity: { value: new THREE.Vector2(0, 0) },
        uVelocityInfluence: { value: PARTICLES.velocityInfluence },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
  }

  update(dt: number, pointerVelX: number, pointerVelY: number): void {
    this.velocityX = damp(this.velocityX, pointerVelX, 3, dt);
    this.velocityY = damp(this.velocityY, pointerVelY, 3, dt);
    this.material.uniforms.uTime.value += dt;
    (this.material.uniforms.uPointerVelocity.value as THREE.Vector2).set(
      this.velocityX * 0.06,
      this.velocityY * 0.06
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
