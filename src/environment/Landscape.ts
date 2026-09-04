import * as THREE from 'three';
import { COLORS, LANDSCAPE } from '../config';
import { fbmNoise1D } from '../utils/noise';
import { damp } from '../utils/math';

interface RidgeLine {
  line: THREE.Line;
  positions: Float32Array;
  colors: Float32Array;
  seed: number;
  amplitude: number;
  baseY: number;
  speed: number;
}

/**
 * Procedural cyan/orange "energy topology" behind the humanoid: several
 * depth layers of thin ridge lines, each built from summed noise rather
 * than a static sine wave, drifting extremely slowly on their own with a
 * tiny pointer-driven parallax on top.
 */
export class Landscape {
  readonly group = new THREE.Group();
  private readonly ridges: RidgeLine[] = [];
  private clock = 0;
  private parallaxX = 0;
  private parallaxY = 0;

  constructor() {
    const cyan = new THREE.Color(COLORS.cyanPrimary);
    const cyanDim = new THREE.Color(COLORS.cyanDim);
    const orange = new THREE.Color(COLORS.orange);

    for (let layer = 0; layer < LANDSCAPE.layers; layer++) {
      const depth = -4.6 - layer * LANDSCAPE.layerSpacing * 2.2;
      const layerT = layer / (LANDSCAPE.layers - 1);
      const linesInLayer = 3;

      for (let li = 0; li < linesInLayer; li++) {
        const seed = layer * 11.7 + li * 3.31 + 4.2;
        const amplitude = (0.55 + layerT * 1.35) * (1 - li * 0.12);
        const baseY = LANDSCAPE.baseY + layerT * 1.9 + li * 0.09;

        const points = LANDSCAPE.pointsPerLine;
        const positions = new Float32Array(points * 3);
        const colors = new Float32Array(points * 3);

        const brightness = THREE.MathUtils.lerp(0.68, 0.2, layerT);
        const baseColor = cyanDim.clone().lerp(cyan, brightness);

        for (let i = 0; i < points; i++) {
          const xN = i / (points - 1);
          const x = (xN - 0.5) * LANDSCAPE.width;
          positions[i * 3] = x;
          positions[i * 3 + 1] = baseY;
          positions[i * 3 + 2] = depth;

          const veinMask = Math.max(
            0,
            fbmNoise1D(xN * 6 + seed * 3.1, 3, seed + 9.4) - 0.18
          );
          const c = baseColor.clone().lerp(orange, Math.min(1, veinMask * 2.1) * 0.85);
          colors[i * 3] = c.r;
          colors[i * 3 + 1] = c.g;
          colors[i * 3 + 2] = c.b;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: THREE.MathUtils.lerp(0.62, 0.24, layerT) * (1 - li * 0.15),
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });

        const line = new THREE.Line(geometry, material);
        this.group.add(line);

        this.ridges.push({
          line,
          positions,
          colors,
          seed,
          amplitude,
          baseY,
          speed: LANDSCAPE.driftSpeed * (0.6 + layerT * 0.8),
        });
      }
    }
  }

  update(dt: number, pointerX: number, pointerY: number): void {
    this.clock += dt;

    for (const ridge of this.ridges) {
      const points = LANDSCAPE.pointsPerLine;
      const pos = ridge.positions;
      const t = this.clock * ridge.speed;

      for (let i = 0; i < points; i++) {
        const xN = i / (points - 1);
        // Rises toward the outer edges (visible beside the shoulders) and
        // settles low through the center, where the figure occludes it.
        const edgeRise = Math.pow(Math.abs(xN - 0.5) * 2.0, 0.75);
        const n = fbmNoise1D(xN * 3.4 + t, 4, ridge.seed);
        pos[i * 3 + 1] = ridge.baseY + n * ridge.amplitude * edgeRise + ridge.amplitude * 0.35 * edgeRise;
      }

      (ridge.line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }

    this.parallaxX = damp(this.parallaxX, pointerX * LANDSCAPE.parallaxAmount, 2.2, dt);
    this.parallaxY = damp(this.parallaxY, pointerY * LANDSCAPE.parallaxAmount * 0.5, 2.2, dt);
    this.group.position.x = this.parallaxX;
    this.group.position.y = this.parallaxY;
  }

  dispose(): void {
    for (const ridge of this.ridges) {
      ridge.line.geometry.dispose();
      (ridge.line.material as THREE.Material).dispose();
    }
  }
}
