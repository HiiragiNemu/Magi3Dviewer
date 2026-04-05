import * as THREE from 'three';
import type { MagiaExedraScene3D } from '..';

import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';

import { TAARenderPass } from 'three/addons/postprocessing/TAARenderPass.js';
import { SSAARenderPass } from 'three/addons/postprocessing/SSAARenderPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';

import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';

export type SceneComposerAntiAliasing = 'None' | 'MSAA' | 'TAA' | 'SSAA' | 'SMAA' | 'FXAA'

export class SceneEffectsController {
    scene: MagiaExedraScene3D

    composer: EffectComposer
    renderTarget: THREE.WebGLRenderTarget

    taaRenderPass: TAARenderPass
    ssaaRenderPass: SSAARenderPass
    renderPass: RenderPass

    outlinePass: OutlinePass
    static outlineColorLight = new THREE.Color(0xffff00)
    static outlineColorDark = new THREE.Color(0xff00ff)

    bloomPass: UnrealBloomPass

    smaaPass: SMAAPass
    outputPass: OutputPass
    fxaaPass: FXAAPass

    constructor(scene: MagiaExedraScene3D) {
        this.scene = scene

        // TAA
        this.taaRenderPass = new TAARenderPass(this.scene.scene, this.scene.camera);
        this.taaRenderPass.stencilBuffer = true
        this.taaRenderPass.enabled = false

        // SSAA
        this.ssaaRenderPass = new SSAARenderPass(this.scene.scene, this.scene.camera);
        this.ssaaRenderPass.stencilBuffer = true
        this.ssaaRenderPass.enabled = false

        // render pass (disable if using TAA or SSAA)
        this.renderPass = new RenderPass(this.scene.scene, this.scene.camera);

        // outline pass
        this.outlinePass = new OutlinePass(new THREE.Vector2(window.innerWidth, window.innerHeight), this.scene.scene, this.scene.camera);
        this.outlinePass.visibleEdgeColor = SceneEffectsController.outlineColorLight
        this.outlinePass.edgeThickness = this.scene.getRenderPixelRatio()
        this.outlinePass.edgeStrength = this.scene.getRenderPixelRatio() * 3
        this.outlinePass.enabled = false

        // bloom
        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.05, 0, 0.5)
        this.bloomPass.enabled = false

        // SMAA
        this.smaaPass = new SMAAPass();
        this.smaaPass.enabled = false

        // output pass
        this.outputPass = new OutputPass();

        // FXAA
        this.fxaaPass = new FXAAPass();
        this.fxaaPass.enabled = false;

        // create composer and add passes
        [this.composer, this.renderTarget] = this._createComposer();
    }

    private _createComposer(msaaSamples = 0): [EffectComposer, THREE.WebGLRenderTarget] {
        this.renderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
            stencilBuffer: true,
            samples: msaaSamples,
            type: THREE.HalfFloatType, // ensure no color bands
        });
        this.composer = new EffectComposer(this.scene.renderer, this.renderTarget);

        this.composer.setPixelRatio(this.scene.getRenderPixelRatio());

        this.composer.addPass(this.taaRenderPass);
        this.composer.addPass(this.ssaaRenderPass);
        this.composer.addPass(this.renderPass);

        this.composer.addPass(this.bloomPass);
        this.composer.addPass(this.outlinePass);

        this.composer.addPass(this.smaaPass);
        this.composer.addPass(this.outputPass);
        this.composer.addPass(this.fxaaPass);

        return [this.composer, this.renderTarget]
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

        if (aa != 'MSAA' && this.renderTarget.samples > 0) {
            this.updateComposerMsaa(0)
        }

        if (aa == 'TAA') {
            this.taaRenderPass.enabled = true
            this.taaRenderPass.sampleLevel = level
        } else if (aa == 'SSAA') {
            this.ssaaRenderPass.enabled = true
            this.ssaaRenderPass.sampleLevel = level
        } else {
            this.renderPass.enabled = true
            if (aa == 'MSAA') {
                this.updateComposerMsaa(level)
            } else if (aa == 'SMAA') {
                this.smaaPass.enabled = true
            } else if (aa == 'FXAA') {
                this.fxaaPass.enabled = true
            }
        }
    }
}