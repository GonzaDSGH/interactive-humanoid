import * as THREE from 'three';
import { noiseGLSL } from '../../shaders/chunks';
import { COLORS, CONTOUR, HUMANOID } from '../../config';

export interface ContourMaterialOptions {
  bandFrequency: number;
  bandSharpness: number;
  centerlineStrength: number;
  /** Enables geometry-driven panel-seam accents (brow/temple/jaw edges) —
   *  only meaningful for the sculpted head material. */
  seamAccents?: boolean;
  faceHole?: { center: [number, number]; size: [number, number] };
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
  uniform vec3 uColorHot;
  uniform vec3 uColorWarm;
  uniform float uOpacity;
  uniform vec2 uFaceHoleCenter;
  uniform vec2 uFaceHoleSize;
  uniform float uFaceHoleEnable;
  uniform float uSeamEnable;
  uniform float uHeadR;
  uniform float uHeadHeightScale;
  uniform float uHeadDepthScale;
  uniform float uHeadTranslateFactor;
  uniform float uShellFill;
  uniform float uMicroFrequency;
  uniform float uMicroStrength;

  ${noiseGLSL}

  float gaussianMask(float x, float center, float width) {
    float d = (x - center) / width;
    return exp(-d * d);
  }

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
    float aa = max(fwidth(bandCoord), 0.0015);
    float line = 1.0 - smoothstep(uBandSharpness - aa, uBandSharpness + aa, pattern);

    // A second, much finer line layer at a different phase — reads as a
    // dense internal circuit/panel texture underneath the primary bands
    // rather than a single wireframe pass.
    float microCoord = bandCoord * uMicroFrequency + vLocalPos.x * 3.1;
    float microPattern = abs(fract(microCoord) - 0.5) * 2.0;
    float microAA = max(fwidth(microCoord), 0.002);
    float microLine = (1.0 - smoothstep(0.06 - microAA, 0.06 + microAA, microPattern)) * uMicroStrength;

    float fresnel = pow(clamp(1.0 - dot(n, v), 0.0, 1.0), uRimPower);
    float hotRim = pow(clamp(1.0 - dot(n, v), 0.0, 1.0), uRimPower * 2.4);

    float facing = clamp(dot(n, v), 0.0, 1.0);
    float interiorFade = mix(0.12, 1.0, facing);

    // A faint translucent base fill (independent of the line pattern) so
    // the surface reads as a semi-transparent energy shell rather than a
    // pure line drawing over black.
    float shellFill = uShellFill * mix(0.3, 1.0, facing);

    float intensity = (line + microLine) * uLineBrightness * interiorFade
      + fresnel * uRimStrength
      + shellFill;
    intensity = clamp(intensity, 0.0, 1.15);

    // Faint bright seam down the front centerline (sternum / midline accent).
    float centerDist = abs(vLocalPos.x);
    float frontFacing = smoothstep(-0.1, 0.35, vLocalPos.z / max(radial, 0.001));
    float centerline = (1.0 - smoothstep(0.0, uCenterlineWidth, centerDist)) * frontFacing * uCenterlineStrength;
    centerline = clamp(centerline, 0.0, 1.0);

    // Structural panel-seam accents, derived analytically from the same
    // normalized coordinates the head sculpting used — genuine geometric
    // boundaries (brow ridge, temple flare, jawline), not a generic guess.
    float seam = 0.0;
    if (uSeamEnable > 0.5) {
      float nx = vLocalPos.x / uHeadR;
      float ny = vLocalPos.y / (uHeadR * uHeadHeightScale) - uHeadTranslateFactor;
      float nz = vLocalPos.z / (uHeadR * uHeadDepthScale);
      float browSeam = gaussianMask(ny, 0.1, 0.028) * smoothstep(0.05, 0.5, nz);
      float templeSeam = gaussianMask(abs(nx), 0.44, 0.045) * smoothstep(-0.2, 0.15, ny) * smoothstep(0.5, 0.05, ny);
      float jawSeam = gaussianMask(ny, -0.4, 0.032) * smoothstep(-0.15, 0.45, nz);
      seam = clamp(browSeam + templeSeam + jawSeam, 0.0, 1.0);
    }
    intensity += seam * 0.65;

    vec3 color = mix(uColorSecondary, uColorPrimary, clamp(line + fresnel * 0.5, 0.0, 1.0));
    color = mix(color, uColorHot, clamp(hotRim * 0.8, 0.0, 1.0));
    color = mix(color, uColorPrimary, seam * 0.6);
    color = mix(color, uColorWarm, centerline * 0.7);

    // Carve a hole where the face energy core sits, on the front side
    // only, so that mesh can occupy the area without the two additively
    // blending into a magenta fringe at their overlap.
    vec2 fp = (vLocalPos.xy - uFaceHoleCenter) / uFaceHoleSize;
    float faceDist = length(fp);
    float faceHole = uFaceHoleEnable * (1.0 - smoothstep(0.72, 0.94, faceDist)) * step(0.0, vLocalPos.z);

    float alpha = clamp(intensity + centerline * 0.9, 0.0, 1.0) * uOpacity * (1.0 - faceHole);

    if (alpha < 0.008) discard;

    gl_FragColor = vec4(color * (intensity + centerline * 0.9) * (1.0 - faceHole), alpha);
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
      uColorHot: { value: new THREE.Color(COLORS.cyanHot) },
      uColorWarm: { value: new THREE.Color(COLORS.orange) },
      uOpacity: { value: 1.0 },
      uFaceHoleCenter: {
        value: new THREE.Vector2(...(options.faceHole?.center ?? [0, 0])),
      },
      uFaceHoleSize: {
        value: new THREE.Vector2(...(options.faceHole?.size ?? [1, 1])),
      },
      uFaceHoleEnable: { value: options.faceHole ? 1.0 : 0.0 },
      uSeamEnable: { value: options.seamAccents ? 1.0 : 0.0 },
      uHeadR: { value: HUMANOID.headRadius },
      uHeadHeightScale: { value: HUMANOID.headHeightScale },
      uHeadDepthScale: { value: HUMANOID.headDepthScale },
      uHeadTranslateFactor: { value: HUMANOID.headTranslateFactor },
      uShellFill: { value: CONTOUR.shellFill },
      uMicroFrequency: { value: CONTOUR.microFrequency },
      uMicroStrength: { value: CONTOUR.microStrength },
    },
  });
}
