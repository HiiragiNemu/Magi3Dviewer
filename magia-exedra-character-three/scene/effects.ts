import * as THREE from 'three';
import type { MagiaExedraScene3D } from '..';

import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { ReDriveBackgroundColorAdjustmentsShader } from './backgroundColorAdjustments';
import { ReDriveVolumePostProcessingPass } from './volumePostProcessing';
import { ReDriveUrpBloomPass } from './urpBloom';
import { ReDriveParaffinShader } from './reDriveParaffin';
import {
    BackgroundDepthPass,
    type BackgroundDepthConsumer,
} from './backgroundDepth';

import { TAARenderPass } from 'three/addons/postprocessing/TAARenderPass.js';
import { SSAARenderPass } from 'three/addons/postprocessing/SSAARenderPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';

import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { CombatVfxScreenPass } from '../../src/viewer/combatVfxScreenEffects';

export type SceneComposerAntiAliasing = 'None' | 'MSAA' | 'TAA' | 'SSAA' | 'SMAA' | 'FXAA'
// Preserve high-frequency toon outlines and texture hatching. FXAA smooths by
// blurring contrast edges, which visibly softens the official line work even
// when the drawing buffer is already native DPR. SMAA keeps the post-process
// path required by split-light scenes without stacking renderer MSAA.
export const defaultSceneComposerAntiAliasing: SceneComposerAntiAliasing = 'SMAA'

export class SceneEffectsController {
    scene: MagiaExedraScene3D

    composer: EffectComposer
    renderTarget: THREE.WebGLRenderTarget

    taaRenderPass: TAARenderPass
    ssaaRenderPass: SSAARenderPass
    /** Independent stage depth sampled by transparent official VLB geometry. */
    backgroundDepthPass: BackgroundDepthPass
    backgroundRenderPass: RenderPass
    /** ReDriveVolume background-only ColorAdjustments. */
    backgroundColorAdjustPass: ShaderPass
    renderPass: RenderPass

    outlinePass: OutlinePass
    static outlineColorLight = new THREE.Color(0xffff00)
    static outlineColorDark = new THREE.Color(0xff00ff)

    bloomPass: UnrealBloomPass
    /** Source-equivalent Unity 2022.3 URP Bloom for recovered volumes. */
    urpBloomPass: ReDriveUrpBloomPass
    paraffinPass: ShaderPass
    /** Full-composite serialized Unity Volume operator pass. */
    volumePostProcessPass: ReDriveVolumePostProcessingPass
    /** Transient Q/E Timeline screen tracks; one persistent pass, no frame RT churn. */
    combatVfxScreenPass: CombatVfxScreenPass

    smaaPass: SMAAPass
    outputPass: OutputPass
    fxaaPass: FXAAPass
    requestedAntiAliasing: SceneComposerAntiAliasing = defaultSceneComposerAntiAliasing
    requestedAntiAliasingLevel = 2
    effectiveAntiAliasing: SceneComposerAntiAliasing = defaultSceneComposerAntiAliasing
    effectiveAntiAliasingLevel = 2
    antiAliasingFallbackReason?: string
    private lastBackgroundSceneEnabled?: boolean

    constructor(scene: MagiaExedraScene3D) {
        this.scene = scene

        this.taaRenderPass = new TAARenderPass(this.scene.scene, this.scene.camera)
        this.taaRenderPass.stencilBuffer = true
        this.taaRenderPass.enabled = false

        this.ssaaRenderPass = new SSAARenderPass(this.scene.scene, this.scene.camera)
        this.ssaaRenderPass.stencilBuffer = true
        this.ssaaRenderPass.enabled = false

        this.backgroundDepthPass = new BackgroundDepthPass(
            this.scene.backgroundScene,
            this.scene.camera,
        )

        this.backgroundRenderPass = new RenderPass(
            this.scene.backgroundScene,
            this.scene.camera,
        )
        this.backgroundRenderPass.enabled = false
        this.backgroundColorAdjustPass = new ShaderPass(
            ReDriveBackgroundColorAdjustmentsShader,
        )
        this.backgroundColorAdjustPass.enabled = false
        this.renderPass = new RenderPass(this.scene.scene, this.scene.camera)

        this.outlinePass = new OutlinePass(new THREE.Vector2(window.innerWidth, window.innerHeight), this.scene.scene, this.scene.camera)
        this.outlinePass.visibleEdgeColor = SceneEffectsController.outlineColorLight
        this.outlinePass.edgeThickness = this.scene.getRenderPixelRatio()
        this.outlinePass.edgeStrength = this.scene.getRenderPixelRatio() * 3
        this.outlinePass.enabled = false

        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.05, 0, 0.5)
        this.bloomPass.enabled = false
        this.urpBloomPass = new ReDriveUrpBloomPass()

        this.paraffinPass = new ShaderPass(ReDriveParaffinShader)
        this.paraffinPass.enabled = false

        this.volumePostProcessPass = new ReDriveVolumePostProcessingPass()

        this.combatVfxScreenPass = new CombatVfxScreenPass()

        this.smaaPass = new SMAAPass()
        this.smaaPass.enabled = false
        this.outputPass = new OutputPass()
        this.fxaaPass = new FXAAPass()
        this.fxaaPass.enabled = false

        ;[this.composer, this.renderTarget] = this._createComposer()
        this.applyEffectiveAntiAliasing()
    }

    private _createComposer(msaaSamples = 0): [EffectComposer, THREE.WebGLRenderTarget] {
        this.renderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
            stencilBuffer: true,
            samples: msaaSamples,
            type: THREE.HalfFloatType,
        })
        this.composer = new EffectComposer(this.scene.renderer, this.renderTarget)
        this.composer.setPixelRatio(this.scene.getRenderPixelRatio())
        this.composer.addPass(this.backgroundDepthPass)
        this.composer.addPass(this.backgroundRenderPass)
        // Official ReDriveVolume background grading happens before
        // characters are composited, so it cannot tint the actors.
        this.composer.addPass(this.backgroundColorAdjustPass)
        this.composer.addPass(this.taaRenderPass)
        this.composer.addPass(this.ssaaRenderPass)
        this.composer.addPass(this.renderPass)
        this.composer.addPass(this.bloomPass)
        this.composer.addPass(this.urpBloomPass)
        this.composer.addPass(this.outlinePass)
        this.composer.addPass(this.paraffinPass)
        this.composer.addPass(this.volumePostProcessPass)
        this.composer.addPass(this.combatVfxScreenPass)
        this.composer.addPass(this.smaaPass)
        this.composer.addPass(this.outputPass)
        this.composer.addPass(this.fxaaPass)
        return [this.composer, this.renderTarget]
    }

    registerBackgroundDepthConsumer(consumer: BackgroundDepthConsumer) {
        return this.backgroundDepthPass.register(consumer)
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

        if (this.lastBackgroundSceneEnabled !== enabled) {
            this.lastBackgroundSceneEnabled = enabled
            this.applyEffectiveAntiAliasing()
        }
    }

    syncParaffinLightDirection() {
        if (!this.paraffinPass.enabled) return
        const uniforms = this.paraffinPass.uniforms
        if (uniforms.uUseFixedLightDirection.value > 0.5) return

        const direction = new THREE.Vector3()
        const target = new THREE.Vector3()
        this.scene.directionalLight.getWorldPosition(direction)
        this.scene.directionalLight.target.getWorldPosition(target)
        direction.sub(target)
        if (direction.lengthSq() === 0) direction.set(0, 0, -1)
        direction.normalize().transformDirection(this.scene.camera.matrixWorldInverse)
        uniforms.uGlobalMainLightDirectionVS.value.copy(direction)
    }

    updateComposerMsaa(msaaSamples: number) {
        this.composer.dispose()
        this.renderTarget.dispose()
        this._createComposer(msaaSamples)
    }

    setAntiAliasing(aa: SceneComposerAntiAliasing, level: number) {
        this.requestedAntiAliasing = aa
        this.requestedAntiAliasingLevel = level
        this.applyEffectiveAntiAliasing()
    }

    getAntiAliasingState() {
        return {
            requested: this.requestedAntiAliasing,
            requestedLevel: this.requestedAntiAliasingLevel,
            effective: this.effectiveAntiAliasing,
            effectiveLevel: this.effectiveAntiAliasingLevel,
            fallbackReason: this.antiAliasingFallbackReason ?? null,
            renderTargetSamples: this.renderTarget.samples,
        }
    }

    private applyEffectiveAntiAliasing() {
        // Three's TAA/SSAA passes render one scene into a private target and
        // cannot retain the separately lit background pass. Keep the user's
        // requested mode intact and use a reversible SMAA fallback while a
        // split-light stage is active.
        const needsSplitSceneFallback =
            this.scene.backgroundSceneEnabled
            && (
                this.requestedAntiAliasing === 'TAA'
                || this.requestedAntiAliasing === 'SSAA'
            )
        const aa = needsSplitSceneFallback
            ? 'SMAA'
            : this.requestedAntiAliasing
        const level = aa === 'TAA' || aa === 'SSAA'
            ? THREE.MathUtils.clamp(
                Math.round(this.requestedAntiAliasingLevel),
                0,
                5,
            )
            : this.requestedAntiAliasingLevel

        this.taaRenderPass.enabled = false
        this.ssaaRenderPass.enabled = false
        this.renderPass.enabled = false
        this.smaaPass.enabled = false
        this.fxaaPass.enabled = false

        this.taaRenderPass.accumulate = false
        this.scene.taaCount = 0
        if (aa != 'MSAA' && this.renderTarget.samples > 0) this.updateComposerMsaa(0)
        if (aa == 'TAA') {
            this.taaRenderPass.enabled = true
            this.taaRenderPass.sampleLevel = level
        } else if (aa == 'SSAA') {
            this.ssaaRenderPass.enabled = true
            this.ssaaRenderPass.sampleLevel = level
        } else {
            this.renderPass.enabled = true
            if (aa == 'MSAA' && this.renderTarget.samples !== level) {
                this.updateComposerMsaa(level)
            }
            else if (aa == 'SMAA') this.smaaPass.enabled = true
            else if (aa == 'FXAA') this.fxaaPass.enabled = true
        }

        this.effectiveAntiAliasing = aa
        this.effectiveAntiAliasingLevel = level
        this.antiAliasingFallbackReason = needsSplitSceneFallback
            ? 'split-light-stage-does-not-support-three-taa-ssaa'
            : undefined
    }
}
