import * as THREE from 'three';
import type { MagiaExedraScene3D } from '..';

import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { TAARenderPass } from 'three/addons/postprocessing/TAARenderPass.js';
import { SSAARenderPass } from 'three/addons/postprocessing/SSAARenderPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';

import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';

export type SceneComposerAntiAliasing = 'None' | 'MSAA' | 'TAA' | 'SSAA' | 'SMAA' | 'FXAA'

/**
 * ReDriveVolume "パラフィンエフェクト" reconstruction.
 * RdBlendMode values recovered from dump.processed.cs:
 * 0 Screen, 1 Multiply, 2 Overlay, 3 HardLight.
 */
const ReDriveParaffinShader = {
    uniforms: {
        tDiffuse: { value: null },
        uEnabled: { value: 0 },
        uTopColor: { value: new THREE.Color(1, 1, 1) },
        uBottomColor: { value: new THREE.Color(1, 1, 1) },
        uOpacity: { value: 0 },
        uParaWidth: { value: 1 },
        uTopBlendMode: { value: 0 },
        uBottomBlendMode: { value: 0 },
        uLightScreenIntensity: { value: 0 },
        uLightScreenTopColor: { value: new THREE.Color(0, 0, 0) },
        uLightScreenBottomColor: { value: new THREE.Color(0, 0, 0) },
        uLightScreenPow: { value: 1 },
        uLightScreenRoundness: { value: 0 },
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
        uniform float uEnabled;
        uniform vec3 uTopColor;
        uniform vec3 uBottomColor;
        uniform float uOpacity;
        uniform float uParaWidth;
        uniform int uTopBlendMode;
        uniform int uBottomBlendMode;
        uniform float uLightScreenIntensity;
        uniform vec3 uLightScreenTopColor;
        uniform vec3 uLightScreenBottomColor;
        uniform float uLightScreenPow;
        uniform float uLightScreenRoundness;
        varying vec2 vUv;

        vec3 rdScreen(vec3 base, vec3 blend) {
            return 1.0 - (1.0 - base) * (1.0 - blend);
        }
        vec3 rdOverlay(vec3 base, vec3 blend) {
            return mix(
                2.0 * base * blend,
                1.0 - 2.0 * (1.0 - base) * (1.0 - blend),
                step(vec3(0.5), base)
            );
        }
        vec3 rdHardLight(vec3 base, vec3 blend) {
            return mix(
                2.0 * base * blend,
                1.0 - 2.0 * (1.0 - base) * (1.0 - blend),
                step(vec3(0.5), blend)
            );
        }
        vec3 rdBlend(vec3 base, vec3 blend, int mode) {
            if (mode == 1) return base * blend;
            if (mode == 2) return rdOverlay(base, blend);
            if (mode == 3) return rdHardLight(base, blend);
            return rdScreen(base, blend);
        }

        void main() {
            vec4 source = texture2D(tDiffuse, vUv);
            if (uEnabled < 0.5 || uOpacity <= 0.0001) {
                gl_FragColor = source;
                return;
            }

            float width = max(uParaWidth, 0.0001);
            float vertical = clamp((vUv.y - 0.5) / width + 0.5, 0.0, 1.0);
            vec3 tint = mix(uBottomColor, uTopColor, vertical);
            vec3 bottomResult = rdBlend(source.rgb, tint, uBottomBlendMode);
            vec3 topResult = rdBlend(source.rgb, tint, uTopBlendMode);
            vec3 paraffin = mix(bottomResult, topResult, vertical);
            vec3 color = mix(source.rgb, paraffin, clamp(uOpacity, 0.0, 1.0));

            if (uLightScreenIntensity > 0.0001) {
                vec2 centered = vUv * 2.0 - 1.0;
                centered.x *= mix(1.0, 1.6, clamp(uLightScreenRoundness, 0.0, 1.0));
                float radial = pow(clamp(1.0 - length(centered), 0.0, 1.0), max(uLightScreenPow, 0.0001));
                vec3 lightColor = mix(uLightScreenBottomColor, uLightScreenTopColor, vertical);
                color = rdScreen(color, lightColor * radial * uLightScreenIntensity);
            }

            gl_FragColor = vec4(color, source.a);
        }
    `,
}

export class SceneEffectsController {
    scene: MagiaExedraScene3D

    composer: EffectComposer
    renderTarget: THREE.WebGLRenderTarget

    taaRenderPass: TAARenderPass
    ssaaRenderPass: SSAARenderPass
    backgroundRenderPass: RenderPass
    renderPass: RenderPass

    outlinePass: OutlinePass
    static outlineColorLight = new THREE.Color(0xffff00)
    static outlineColorDark = new THREE.Color(0xff00ff)

    bloomPass: UnrealBloomPass
    paraffinPass: ShaderPass

    smaaPass: SMAAPass
    outputPass: OutputPass
    fxaaPass: FXAAPass

    constructor(scene: MagiaExedraScene3D) {
        this.scene = scene

        this.taaRenderPass = new TAARenderPass(this.scene.scene, this.scene.camera)
        this.taaRenderPass.stencilBuffer = true
        this.taaRenderPass.enabled = false

        this.ssaaRenderPass = new SSAARenderPass(this.scene.scene, this.scene.camera)
        this.ssaaRenderPass.stencilBuffer = true
        this.ssaaRenderPass.enabled = false

        this.backgroundRenderPass = new RenderPass(
            this.scene.backgroundScene,
            this.scene.camera,
        )
        this.backgroundRenderPass.enabled = false
        this.renderPass = new RenderPass(this.scene.scene, this.scene.camera)

        this.outlinePass = new OutlinePass(new THREE.Vector2(window.innerWidth, window.innerHeight), this.scene.scene, this.scene.camera)
        this.outlinePass.visibleEdgeColor = SceneEffectsController.outlineColorLight
        this.outlinePass.edgeThickness = this.scene.getRenderPixelRatio()
        this.outlinePass.edgeStrength = this.scene.getRenderPixelRatio() * 3
        this.outlinePass.enabled = false

        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.05, 0, 0.5)
        this.bloomPass.enabled = false

        this.paraffinPass = new ShaderPass(ReDriveParaffinShader)
        this.paraffinPass.enabled = false

        this.smaaPass = new SMAAPass()
        this.smaaPass.enabled = false
        this.outputPass = new OutputPass()
        this.fxaaPass = new FXAAPass()
        this.fxaaPass.enabled = false

        ;[this.composer, this.renderTarget] = this._createComposer()
    }

    private _createComposer(msaaSamples = 0): [EffectComposer, THREE.WebGLRenderTarget] {
        this.renderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
            stencilBuffer: true,
            samples: msaaSamples,
            type: THREE.HalfFloatType,
        })
        this.composer = new EffectComposer(this.scene.renderer, this.renderTarget)
        this.composer.setPixelRatio(this.scene.getRenderPixelRatio())
        this.composer.addPass(this.backgroundRenderPass)
        this.composer.addPass(this.taaRenderPass)
        this.composer.addPass(this.ssaaRenderPass)
        this.composer.addPass(this.renderPass)
        this.composer.addPass(this.bloomPass)
        this.composer.addPass(this.outlinePass)
        this.composer.addPass(this.paraffinPass)
        this.composer.addPass(this.smaaPass)
        this.composer.addPass(this.outputPass)
        this.composer.addPass(this.fxaaPass)
        return [this.composer, this.renderTarget]
    }

    syncBackgroundSceneState() {
        const enabled = this.scene.backgroundSceneEnabled
        this.backgroundRenderPass.enabled = enabled
        this.renderPass.clear = !enabled
        // The stage/background pass must not leave its depth buffer behind.
        // Otherwise the character pass is depth-rejected by the floor/sky
        // geometry and only outline or a few foreground fragments remain,
        // producing the purple-black "silhouette" regression.
        this.renderPass.clearDepth = enabled

        // Three's TAA/SSAA passes render a single scene into a freshly-cleared
        // private target, so they cannot preserve the separately lit stage.
        // Use the ordinary render pass while an official split-light stage is
        // active; MSAA/SMAA/FXAA remain available.
        if (enabled && (this.taaRenderPass.enabled || this.ssaaRenderPass.enabled)) {
            this.taaRenderPass.enabled = false
            this.ssaaRenderPass.enabled = false
            this.renderPass.enabled = true
        }
    }

    updateComposerMsaa(msaaSamples: number) {
        this.composer.dispose()
        this.renderTarget.dispose()
        this._createComposer(msaaSamples)
    }

    setAntiAliasing(aa: SceneComposerAntiAliasing, level: number) {
        this.taaRenderPass.enabled = false
        this.ssaaRenderPass.enabled = false
        this.renderPass.enabled = false
        this.smaaPass.enabled = false
        this.fxaaPass.enabled = false

        if (aa != 'MSAA' && this.renderTarget.samples > 0) this.updateComposerMsaa(0)
        if (aa == 'TAA') {
            this.taaRenderPass.enabled = true
            this.taaRenderPass.sampleLevel = level
        } else if (aa == 'SSAA') {
            this.ssaaRenderPass.enabled = true
            this.ssaaRenderPass.sampleLevel = level
        } else {
            this.renderPass.enabled = true
            if (aa == 'MSAA') this.updateComposerMsaa(level)
            else if (aa == 'SMAA') this.smaaPass.enabled = true
            else if (aa == 'FXAA') this.fxaaPass.enabled = true
        }
    }
}
