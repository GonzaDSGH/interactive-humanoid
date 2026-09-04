import * as THREE from 'three';
import { COLORS, PARTICLES, HUMANOID, HEAD_LOCAL_CENTER_Y } from '../config';
import { damp } from '../utils/math';

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aRandom;
  attribute vec3 aSeed;
  attribute float aTrailPhase;

  uniform float uTime;
  uniform vec2 uPointerVelocity;
  uniform vec2 uLagVel0;
  uniform vec2 uLagVel1;
  uniform vec2 uLagVel2;
  uniform float uVelocityInfluence;
  uniform float uPixelRatio;
  uniform float uSpeedFactor;

  varying float vAlpha;
  varying float vHeat;

  void main() {
    vec3 pos = position;

    float drift = sin(uTime * (0.15 + aRandom * 0.25) + aSeed.x * 6.283);
    float driftY = cos(uTime * (0.12 + aRandom * 0.2) + aSeed.y * 6.283);
    pos.x += drift * 0.05 * (0.4 + aRandom);
    pos.y += driftY * 0.045 * (0.4 + aRandom);
    pos.z += sin(uTime * 0.08 + aSeed.z * 6.283) * 0.04;

    // Non-trail dust drifts with the near-instant pointer velocity; the
    // marked trail sparks instead pick one of three progressively laggier
    // damped copies, giving a cheap multi-echo motion streak without a
    // real per-particle position history. Trail sparks are also gated by
    // current pointer speed — near-invisible at rest, only appearing as a
    // streak during fast movement — instead of sitting as a static clump.
    vec2 vel = uPointerVelocity;
    float trailFade = 1.0;
    if (aTrailPhase > -0.5 && aTrailPhase < 0.5) { vel = uLagVel0; trailFade = uSpeedFactor * 0.9; }
    else if (aTrailPhase >= 0.5 && aTrailPhase < 1.5) { vel = uLagVel1; trailFade = uSpeedFactor * 0.6; }
    else if (aTrailPhase >= 1.5) { vel = uLagVel2; trailFade = uSpeedFactor * 0.4; }

    pos.xy += vel * uVelocityInfluence * (0.3 + aRandom * 0.7);

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    float sizeAtten = 1.0 / max(-mvPosition.z, 0.001);
    gl_PointSize = aSize * uPixelRatio * sizeAtten * 90.0;
    gl_Position = projectionMatrix * mvPosition;

    float depthFade = smoothstep(-14.0, -1.0, mvPosition.z);
    vAlpha = (0.2 + aRandom * 0.45) * depthFade * trailFade;
    vHeat = clamp(length(uPointerVelocity) * 1.8, 0.0, 1.0) * step(-0.5, aTrailPhase);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying float vAlpha;
  varying float vHeat;
  uniform vec3 uColor;
  uniform vec3 uHotColor;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float alpha = smoothstep(0.5, 0.0, d) * vAlpha;
    if (alpha < 0.01) discard;
    vec3 color = mix(uColor, uHotColor, vHeat);
    gl_FragColor = vec4(color, alpha);
  }
`;

interface Cluster {
  offset: THREE.Vector3;
  spread: number;
}

/** Cheap, mildly center-weighted random in roughly [-1, 1] — biased
 *  toward a cluster's center without being so peaked that most particles
 *  land nearly on top of one another (which blooms into a bright,
 *  ring-artifact-prone blob rather than a loose gathering of dust). */
function gaussianRandom(): number {
  return (Math.random() + Math.random() - 1) * 0.85 + (Math.random() - 0.5) * 0.3;
}

/** GPU-driven dust: a single draw call, all drift computed in the vertex shader. */
export class Particles {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private velocityX = 0;
  private velocityY = 0;
  private lag0 = { x: 0, y: 0 };
  private lag1 = { x: 0, y: 0 };
  private lag2 = { x: 0, y: 0 };

  constructor() {
    const R = HUMANOID.headRadius;

    // Clusters hug the sculpted head's actual structural landmarks —
    // crown, temples, jaw — instead of scattering over a uniform shell.
    const clusters: Cluster[] = [
      { offset: new THREE.Vector3(0, 1.05 * R, -0.6 * R), spread: 0.65 },
      { offset: new THREE.Vector3(-1.0 * R, 0.1 * R, 0.22 * R), spread: 0.55 },
      { offset: new THREE.Vector3(1.0 * R, 0.1 * R, 0.22 * R), spread: 0.55 },
      { offset: new THREE.Vector3(0, -0.85 * R, 0.7 * R), spread: 0.55 },
      { offset: new THREE.Vector3(0, 1.15 * R, 0.3 * R), spread: 0.6 },
    ];

    const dustCount = PARTICLES.count;
    const trailCount = PARTICLES.trailCount;
    const count = dustCount + trailCount;

    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const randoms = new Float32Array(count);
    const seeds = new Float32Array(count * 3);
    const trailPhases = new Float32Array(count);

    const haloCount = Math.floor(dustCount * PARTICLES.haloFraction);

    for (let i = 0; i < dustCount; i++) {
      let x: number, y: number, z: number;

      if (i < haloCount) {
        const cluster = clusters[i % clusters.length];
        x = cluster.offset.x + gaussianRandom() * R * cluster.spread;
        y = HEAD_LOCAL_CENTER_Y + cluster.offset.y + gaussianRandom() * R * cluster.spread;
        z = cluster.offset.z + gaussianRandom() * R * cluster.spread * 0.75;
      } else {
        x = (Math.random() - 0.5) * 20;
        y = THREE.MathUtils.lerp(-2.2, 1.4, Math.random());
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
      trailPhases[i] = -1;
    }

    for (let i = 0; i < trailCount; i++) {
      const idx = dustCount + i;
      const cluster = clusters[i % clusters.length];
      const x = cluster.offset.x + gaussianRandom() * R * cluster.spread * 0.7;
      const y = HEAD_LOCAL_CENTER_Y + cluster.offset.y + gaussianRandom() * R * cluster.spread * 0.7;
      const z = cluster.offset.z + gaussianRandom() * R * cluster.spread * 0.55;

      positions[idx * 3] = x;
      positions[idx * 3 + 1] = y;
      positions[idx * 3 + 2] = z;

      sizes[idx] = THREE.MathUtils.lerp(0.7, 1.2, Math.random()) * PARTICLES.size;
      randoms[idx] = Math.random();
      seeds[idx * 3] = Math.random();
      seeds[idx * 3 + 1] = Math.random();
      seeds[idx * 3 + 2] = Math.random();
      trailPhases[idx] = i % 3;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    geometry.setAttribute('aTrailPhase', new THREE.BufferAttribute(trailPhases, 1));

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(COLORS.cyanPrimary) },
        uHotColor: { value: new THREE.Color(COLORS.warmWhite) },
        uPointerVelocity: { value: new THREE.Vector2(0, 0) },
        uLagVel0: { value: new THREE.Vector2(0, 0) },
        uLagVel1: { value: new THREE.Vector2(0, 0) },
        uLagVel2: { value: new THREE.Vector2(0, 0) },
        uVelocityInfluence: { value: PARTICLES.velocityInfluence },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uSpeedFactor: { value: 0 },
      },
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
  }

  update(dt: number, pointerVelX: number, pointerVelY: number): void {
    this.velocityX = damp(this.velocityX, pointerVelX, 3, dt);
    this.velocityY = damp(this.velocityY, pointerVelY, 3, dt);

    this.lag0.x = damp(this.lag0.x, pointerVelX, PARTICLES.trailLagFast, dt);
    this.lag0.y = damp(this.lag0.y, pointerVelY, PARTICLES.trailLagFast, dt);
    this.lag1.x = damp(this.lag1.x, pointerVelX, PARTICLES.trailLagMedium, dt);
    this.lag1.y = damp(this.lag1.y, pointerVelY, PARTICLES.trailLagMedium, dt);
    this.lag2.x = damp(this.lag2.x, pointerVelX, PARTICLES.trailLagSlow, dt);
    this.lag2.y = damp(this.lag2.y, pointerVelY, PARTICLES.trailLagSlow, dt);

    this.material.uniforms.uTime.value += dt;
    (this.material.uniforms.uPointerVelocity.value as THREE.Vector2).set(
      this.velocityX * 0.06,
      this.velocityY * 0.06
    );
    (this.material.uniforms.uLagVel0.value as THREE.Vector2).set(this.lag0.x * 0.09, this.lag0.y * 0.09);
    (this.material.uniforms.uLagVel1.value as THREE.Vector2).set(this.lag1.x * 0.09, this.lag1.y * 0.09);
    (this.material.uniforms.uLagVel2.value as THREE.Vector2).set(this.lag2.x * 0.09, this.lag2.y * 0.09);

    const rawSpeed = Math.hypot(pointerVelX, pointerVelY);
    const targetSpeedFactor = Math.min(1, rawSpeed / 3.5);
    this.material.uniforms.uSpeedFactor.value = damp(
      this.material.uniforms.uSpeedFactor.value,
      targetSpeedFactor,
      5,
      dt
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
