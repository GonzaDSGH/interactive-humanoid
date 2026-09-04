import * as THREE from 'three';
import { COLORS, HUD as HUD_CONFIG, HUMANOID } from '../config';

function buildArc(radius: number, start: number, length: number, segments: number): THREE.BufferGeometry {
  const positions = new Float32Array((segments + 1) * 3);
  for (let i = 0; i <= segments; i++) {
    const a = start + (length * i) / segments;
    positions[i * 3] = Math.cos(a) * radius;
    positions[i * 3 + 1] = Math.sin(a) * radius;
    positions[i * 3 + 2] = 0;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geometry;
}

/**
 * Restrained circular scan geometry sitting behind the head — incomplete
 * concentric arcs and a scattering of orbital dots. No text, no labels;
 * just enough geometry to feel like the being is instrumented, not a UI.
 */
export class HUD {
  readonly group = new THREE.Group();
  private readonly arcs: THREE.Line[] = [];
  private readonly dotsGroup = new THREE.Group();
  private readonly dots: { mesh: THREE.Points; radius: number; speed: number; offset: number }[] = [];

  constructor() {
    const color = new THREE.Color(COLORS.cyanPrimary);
    const centerY = HUMANOID.headRadius * HUMANOID.headHeightScale * 0.55;

    for (let i = 0; i < HUD_CONFIG.ringCount; i++) {
      const radius = HUMANOID.headRadius * (1.5 + i * 0.42);
      const start = Math.random() * Math.PI * 2;
      const length = THREE.MathUtils.lerp(1.1, 2.6, Math.random());
      const geometry = buildArc(radius, start, length, 64);
      const material = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: HUD_CONFIG.ringOpacity * (1 - i * 0.18),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const arc = new THREE.Line(geometry, material);
      arc.position.y = centerY;
      arc.position.z = -0.65 - i * 0.12;
      arc.userData.speed = HUD_CONFIG.rotationSpeed * (i % 2 === 0 ? 1 : -1) * (0.6 + i * 0.25);
      this.arcs.push(arc);
      this.group.add(arc);
    }

    const dotCount = 10;
    for (let i = 0; i < dotCount; i++) {
      const radius = HUMANOID.headRadius * THREE.MathUtils.lerp(1.6, 2.3, Math.random());
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
      const material = new THREE.PointsMaterial({
        color,
        size: THREE.MathUtils.lerp(2.2, 4.5, Math.random()),
        transparent: true,
        opacity: THREE.MathUtils.lerp(0.15, 0.4, Math.random()),
        sizeAttenuation: false,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Points(geometry, material);
      mesh.position.y = centerY;
      mesh.position.z = -0.7;
      this.dots.push({
        mesh,
        radius,
        speed: HUD_CONFIG.rotationSpeed * (0.4 + Math.random() * 0.8) * (Math.random() < 0.5 ? -1 : 1),
        offset: Math.random() * Math.PI * 2,
      });
      this.dotsGroup.add(mesh);
    }
    this.group.add(this.dotsGroup);

    this.group.position.z = -0.4;
  }

  update(dt: number, parallaxX: number, parallaxY: number): void {
    for (const arc of this.arcs) {
      arc.rotation.z += (arc.userData.speed as number) * dt;
    }
    for (const dot of this.dots) {
      const a = performance.now() * 0.001 * dot.speed + dot.offset;
      const pos = dot.mesh.geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, Math.cos(a) * dot.radius, Math.sin(a) * dot.radius * 0.94, 0);
      pos.needsUpdate = true;
    }
    this.group.position.x = parallaxX * 0.4;
    this.group.position.y = parallaxY * 0.4;
  }

  dispose(): void {
    for (const arc of this.arcs) {
      arc.geometry.dispose();
      (arc.material as THREE.Material).dispose();
    }
    for (const dot of this.dots) {
      dot.mesh.geometry.dispose();
      (dot.mesh.material as THREE.Material).dispose();
    }
  }
}
