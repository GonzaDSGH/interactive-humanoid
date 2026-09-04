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
  uniform float uRingFrequency;
  uniform float uRingSpeed;
  uniform float uRingStrength;
  uniform float uSpokeCount;
  uniform float uSpokeStrength;
  uniform float uSpokeSpeed;
  uniform float uBezelStrength;
  uniform vec3 uColorHot;
  uniform vec3 uColorWarm;
  uniform vec3 uColorBezel;
  uniform vec2 uShift;

  ${noiseGLSL}

  void main() {
    vec2 p = (vUv - vec2(0.5)) * 2.0 - uShift;
    vec2 scaled = p / vec2(uCoreWidth, uCoreHeight);
    float dist = length(scaled);

    float alpha = 1.0 - smoothstep(0.68, 0.97, dist);
    if (alpha < 0.006) discard;

    float turb = fbm(vLocalPos * 1.6 + vec3(0.0, 0.0, uTime * uTurbulenceSpeed));

    // Organic horizontal energy bands, as before — the "living" texture.
    float bands = sin((p.y * uBandFrequency) + turb * 0.9 + uTime * 0.6) * 0.5 + 0.5;
    bands = mix(1.0, bands, uBandStrength);

    // Concentric reactor-iris rings emanating from the core center —
    // reads as a mechanical/intelligence energy source, not a flat blob.
    float ringCoord = dist * uRingFrequency - uTime * uRingSpeed;
    float ringPattern = abs(fract(ringCoord) - 0.5) * 2.0;
    float ringAA = max(fwidth(ringCoord), 0.01);
    float rings = (1.0 - smoothstep(0.12 - ringAA, 0.12 + ringAA, ringPattern)) * uRingStrength;
    rings *= smoothstep(0.08, 0.3, dist); // keep the very center clean

    // Faint rotating iris spokes — the pattern fades in with distance so
    // it never dims (let alone darkens) the hot center itself.
    float angle = atan(p.y, p.x);
    float spokePattern = sin(angle * uSpokeCount + uTime * uSpokeSpeed) * 0.5 + 0.5;
    float spokes = mix(1.0, spokePattern, uSpokeStrength * smoothstep(0.15, 0.4, dist));

    // Gentle radial falloff (broad, low-contrast) gives the center-weighted
    // glow the reference has without a sharp gradient for bloom to ring on.
    float radial = mix(0.55, 1.0, exp(-dist * dist * 0.9));
    vec3 color = mix(uColorWarm, uColorHot, clamp(radial * bands, 0.0, 1.0));
    float glow = uIntensity * radial * mix(0.85, 1.0, bands) * spokes * (0.9 + 0.15 * turb) + rings;

    // A bright, crisp bezel right at the lens edge — an embedded, defined
    // aperture rather than a soft pasted-on oval.
    float bezel = (1.0 - smoothstep(0.0, 0.09, abs(dist - 0.82))) * uBezelStrength;
    color = mix(color, uColorBezel, clamp(bezel, 0.0, 1.0));
    glow += bezel * 1.1;

    gl_FragColor = vec4(color * glow, alpha);
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
      uRingFrequency: { value: FACE_CORE.ringFrequency },
      uRingSpeed: { value: FACE_CORE.ringSpeed },
      uRingStrength: { value: FACE_CORE.ringStrength },
      uSpokeCount: { value: FACE_CORE.spokeCount },
      uSpokeStrength: { value: FACE_CORE.spokeStrength },
      uSpokeSpeed: { value: FACE_CORE.spokeSpeed },
      uBezelStrength: { value: FACE_CORE.bezelStrength },
      uColorHot: { value: new THREE.Color(COLORS.hotYellow) },
      uColorWarm: { value: new THREE.Color(COLORS.orange) },
      uColorBezel: { value: new THREE.Color(COLORS.warmWhite) },
      uShift: { value: new THREE.Vector2(0, 0) },
    },
  });
}
