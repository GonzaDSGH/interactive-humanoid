import * as THREE from 'three';
import { noiseGLSL } from '../../shaders/chunks';
import { COLORS, FACE_CORE } from '../../config';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vLocalPos;

  void main() {
    vUv = uv;
    vLocalPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  varying vec2 vUv;
  varying vec3 vLocalPos;

  uniform float uTime;
  uniform float uCoreWidth;
  uniform float uCoreHeight;
  uniform float uBandFrequency;
  uniform float uBandStrength;
  uniform float uTurbulenceSpeed;
  uniform float uIntensity;
  uniform vec3 uColorHot;
  uniform vec3 uColorWarm;
  uniform vec2 uShift;

  ${noiseGLSL}

  void main() {
    vec2 p = (vUv - vec2(0.5)) * 2.0 - uShift;
    vec2 scaled = p / vec2(uCoreWidth, uCoreHeight);
    float dist = length(scaled);

    float mask = exp(-pow(dist, 2.4) * 2.6);
    mask *= smoothstep(1.35, 0.55, dist);

    float turb = fbm(vLocalPos * 3.2 + vec3(0.0, 0.0, uTime * uTurbulenceSpeed));
    float bands = sin((p.y * uBandFrequency) + turb * 2.4 + uTime * 0.6) * 0.5 + 0.5;
    bands = mix(1.0, bands, uBandStrength);

    float centerHeat = exp(-pow(dist, 2.0) * 3.2);
    vec3 color = mix(uColorWarm, uColorHot, clamp(centerHeat * 1.4, 0.0, 1.0));

    float intensity = mask * bands * uIntensity * (0.75 + 0.35 * turb);

    if (intensity < 0.004) discard;

    gl_FragColor = vec4(color * intensity, intensity);
  }
`;

export function createFaceCoreMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uCoreWidth: { value: FACE_CORE.coreWidth },
      uCoreHeight: { value: FACE_CORE.coreHeight },
      uBandFrequency: { value: FACE_CORE.bandFrequency },
      uBandStrength: { value: FACE_CORE.bandStrength },
      uTurbulenceSpeed: { value: FACE_CORE.turbulenceSpeed },
      uIntensity: { value: FACE_CORE.intensity },
      uColorHot: { value: new THREE.Color(COLORS.hotYellow) },
      uColorWarm: { value: new THREE.Color(COLORS.orange) },
      uShift: { value: new THREE.Vector2(0, 0) },
    },
  });
}
