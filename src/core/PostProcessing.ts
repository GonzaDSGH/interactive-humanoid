import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { BLOOM, POST, RENDER } from '../config';

/** Subtle vignette + film grain + gentle tonal shaping, applied after bloom. */
const finishingShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignetteDarkness: { value: POST.vignetteDarkness },
    uVignetteOffset: { value: POST.vignetteOffset },
    uGrainAmount: { value: POST.grainAmount },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignetteDarkness;
    uniform float uVignetteOffset;
    uniform float uGrainAmount;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453123);
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);

      vec2 centered = vUv - 0.5;
      float vig = 1.0 - dot(centered, centered) * uVignetteOffset;
      vig = clamp(vig, 0.0, 1.0);
      vig = pow(vig, uVignetteDarkness);
      color.rgb *= mix(1.0, vig, 0.55);

      float grain = hash(vUv * uResolution.xy + fract(uTime * 60.0));
      color.rgb += (grain - 0.5) * uGrainAmount;

      color.rgb = mix(color.rgb, color.rgb * color.rgb * (3.0 - 2.0 * color.rgb), 0.12);

      gl_FragColor = color;
    }
  `,
};

export class PostProcessing {
  private readonly composer: EffectComposer;
  private readonly finishingPass: ShaderPass;
  private readonly bloomPass: UnrealBloomPass;
  private clock = 0;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      BLOOM.strength,
      BLOOM.radius,
      BLOOM.threshold
    );
    this.composer.addPass(this.bloomPass);

    this.finishingPass = new ShaderPass(finishingShader);
    this.composer.addPass(this.finishingPass);

    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);
  }

  resize(width: number, height: number): void {
    const pr = Math.min(window.devicePixelRatio, RENDER.maxPixelRatio);
    this.composer.setSize(width, height);
    this.composer.setPixelRatio(pr);
    this.bloomPass.setSize(width, height);
    (this.finishingPass.uniforms.uResolution.value as THREE.Vector2).set(
      width * pr,
      height * pr
    );
  }

  render(dt = 0): void {
    this.clock += dt;
    this.finishingPass.uniforms.uTime.value = this.clock;
    this.composer.render();
  }
}
