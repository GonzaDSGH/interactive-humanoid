import * as THREE from 'three';
import { noiseGLSL } from '../../shaders/chunks';
import { COLORS, CONTOUR } from '../../config';

export interface ContourMaterialOptions {
  bandFrequency: number;
  bandSharpness: number;
  centerlineStrength: number;
}

const vertexShader = /* glsl */ `
  varying vec3 vLocalPos;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  void main() {
    vLocalPos = position;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);

    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vViewDir = normalize(cameraPosition - worldPos.xyz);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  varying vec3 vLocalPos;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  uniform float uTime;
  uniform float uBandFrequency;
  uniform float uBandSharpness;
  uniform float uNoiseAmount;
  uniform float uNoiseSpeed;
  uniform float uRimPower;
  uniform float uRimStrength;
  uniform float uLineBrightness;
  uniform float uCenterlineWidth;
  uniform float uCenterlineStrength;
  uniform vec3 uColorPrimary;
  uniform vec3 uColorSecondary;
  uniform vec3 uColorWarm;
  uniform float uOpacity;

  ${noiseGLSL}

  void main() {
    vec3 n = normalize(vWorldNormal);
    vec3 v = normalize(vViewDir);

    // Bands are computed from OBJECT-SPACE position so they stay locked to
    // the surface (and therefore stable / non-swimming) as the mesh rotates.
    float radial = length(vLocalPos.xz);
    float bandCoord = (vLocalPos.y * 1.0 + radial * 0.22) * uBandFrequency;

    float wobble = fbm(vLocalPos * 1.6 + vec3(0.0, uTime * uNoiseSpeed, 0.0)) * uNoiseAmount;
    bandCoord += wobble;

    float pattern = abs(fract(bandCoord) - 0.5) * 2.0;
    float aa = max(fwidth(bandCoord), 0.0008);
    float line = 1.0 - smoothstep(uBandSharpness - aa, uBandSharpness + aa, pattern);

    float fresnel = pow(clamp(1.0 - dot(n, v), 0.0, 1.0), uRimPower);

    float facing = clamp(dot(n, v), 0.0, 1.0);
    float interiorFade = mix(0.35, 1.0, facing);

    float intensity = line * uLineBrightness * interiorFade + fresnel * uRimStrength;

    // Faint bright seam down the front centerline (sternum / midline accent).
    float centerDist = abs(vLocalPos.x);
    float frontFacing = smoothstep(-0.1, 0.35, vLocalPos.z / max(radial, 0.001));
    float centerline = (1.0 - smoothstep(0.0, uCenterlineWidth, centerDist)) * frontFacing * uCenterlineStrength;

    vec3 color = mix(uColorSecondary, uColorPrimary, clamp(line + fresnel * 0.6, 0.0, 1.0));
    color = mix(color, uColorWarm, clamp(centerline * 0.85, 0.0, 1.0));

    float alpha = clamp(intensity + centerline, 0.0, 1.6) * uOpacity;

    if (alpha < 0.006) discard;

    gl_FragColor = vec4(color * (intensity + centerline * 1.4), alpha);
  }
`;

export function createContourMaterial(options: ContourMaterialOptions): THREE.ShaderMaterial {
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
      uBandFrequency: { value: options.bandFrequency },
      uBandSharpness: { value: options.bandSharpness },
      uNoiseAmount: { value: CONTOUR.noiseAmount },
      uNoiseSpeed: { value: CONTOUR.noiseSpeed },
      uRimPower: { value: CONTOUR.rimPower },
      uRimStrength: { value: CONTOUR.rimStrength },
      uLineBrightness: { value: CONTOUR.lineBrightness },
      uCenterlineWidth: { value: CONTOUR.centerlineWidth },
      uCenterlineStrength: { value: options.centerlineStrength },
      uColorPrimary: { value: new THREE.Color(COLORS.cyanPrimary) },
      uColorSecondary: { value: new THREE.Color(COLORS.cyanSecondary) },
      uColorWarm: { value: new THREE.Color(COLORS.orange) },
      uOpacity: { value: 1.0 },
    },
  });
}
