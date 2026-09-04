import * as THREE from 'three';
import { COLORS } from '../../config';

/** Bright, thin emissive material for small mechanical accent geometry
 *  (collar rings, seams) — a fresnel-driven glow with a slow idle pulse. */
const vertexShader = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  void main() {
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  uniform float uTime;
  uniform vec3 uColor;
  uniform float uIntensity;

  void main() {
    vec3 n = normalize(vWorldNormal);
    vec3 v = normalize(vViewDir);
    float facing = clamp(dot(n, v), 0.0, 1.0);
    float rim = pow(1.0 - facing, 1.6);
    float pulse = 0.85 + 0.15 * sin(uTime * 1.3);
    float intensity = (mix(0.55, 1.0, facing) + rim * 0.4) * uIntensity * pulse;
    gl_FragColor = vec4(uColor * intensity, 1.0);
  }
`;

export function createAccentMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(COLORS.cyanPrimary) },
      uIntensity: { value: 0.85 },
    },
  });
}
