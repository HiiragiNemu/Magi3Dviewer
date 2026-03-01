import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

import { createRenderer } from 'magia-exedra-character-three'
import type MagiaExedraCharacter3D from 'magia-exedra-character-three/character'
import { characters } from './character';
import type { LoadCharacterCallbacks } from 'magia-exedra-character-three/loader';

import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { TAARenderPass } from 'three/addons/postprocessing/TAARenderPass.js';
import { SSAARenderPass } from 'three/addons/postprocessing/SSAARenderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';

export interface SceneCharacter {
    character?: MagiaExedraCharacter3D
    loading: boolean
    pending?: number | string
    pendingResolve?: (value: SceneCharacter) => void
    removed: boolean
}

export type SceneComposerAntiAliasing = 'None' | 'MSAA' | 'TAA' | 'SSAA' | 'SMAA' | 'FXAA'

export class ViewerScene {
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene

    camera: THREE.PerspectiveCamera
    static cameraInitialFov = 15
    static cameraInitialPosition: [number, number, number] = [0, 1.5, 7.5]

    controls: OrbitControls
    static controlsInitialTarget: [number, number, number] = [0, 0.9, 0]

    ambientLight: THREE.AmbientLight
    static ambientLightInitialColor = '#ffffff'
    static ambientLightInitialIntensity = 2

    directionalLight: THREE.DirectionalLight
    static directionalLightInitialColor = '#ffffff'
    static directionalLightInitialIntensity = 1.5
    static directionalLightInitialAngle = 15
    static directionalLightInitialDistance = 10
    static directionalLightInitialHeight = 2.5

    axesHelper: THREE.AxesHelper

    raycaster: THREE.Raycaster

    transformControls: TransformControls
    transformControlsHelper

    composerEnabled: 'Auto' | 'Always' | 'Never' = 'Auto'
    composerRenderTarget: THREE.WebGLRenderTarget | undefined
    composer: EffectComposer | undefined
    taaRenderPass: TAARenderPass
    ssaaRenderPass: SSAARenderPass
    renderPass: RenderPass
    outlinePass: OutlinePass
    static outlineColorLight = new THREE.Color(0xffff00)
    static outlineColorDark = new THREE.Color(0xff00ff)
    smaaPass: SMAAPass
    outputPass: OutputPass
    fxaaPass: FXAAPass

    animateLoopCallback: () => any = () => { }

    get characterSelectionVisible() {
        return this.outlinePass.selectedObjects.length > 0 && this.characters.length > 1
    }

    taaCount = 0

    constructor(element: HTMLElement) {
        //
        // Renderer, scene, camera & controls
        //
        this.renderer = createRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.xr.enabled = true

        element.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        // scene.background = new THREE.Color(0x333333);

        this.ambientLight = new THREE.AmbientLight(ViewerScene.ambientLightInitialColor, ViewerScene.ambientLightInitialIntensity);
        this.scene.add(this.ambientLight);

        this.directionalLight = new THREE.DirectionalLight(ViewerScene.directionalLightInitialColor, ViewerScene.directionalLightInitialIntensity);
        const {
            x: directionalLightPositionX,
            z: directionalLightPositionZ
        } = deg2pos(ViewerScene.directionalLightInitialAngle, ViewerScene.directionalLightInitialDistance)
        this.directionalLight.position.set(
            directionalLightPositionX,
            ViewerScene.directionalLightInitialHeight,
            directionalLightPositionZ
        );
        this.scene.add(this.directionalLight);

        this.axesHelper = new THREE.AxesHelper(2);
        this.axesHelper.visible = false
        this.scene.add(this.axesHelper);

        this.camera = new THREE.PerspectiveCamera(ViewerScene.cameraInitialFov, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(...ViewerScene.cameraInitialPosition);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.target.set(...ViewerScene.controlsInitialTarget);

        this.raycaster = new THREE.Raycaster();

        this.transformControls = new TransformControls(this.camera, this.renderer.domElement)
        this.transformControls.addEventListener('dragging-changed', e => {
            this.controls.enabled = !e.value;
        });
        this.transformControlsHelper = this.transformControls.getHelper();
        this.scene.add(this.transformControlsHelper);

        //
        // Post effects
        //
        // TAA
        this.taaRenderPass = new TAARenderPass(this.scene, this.camera);
        this.taaRenderPass.stencilBuffer = true
        this.taaRenderPass.enabled = false

        // SSAA
        this.ssaaRenderPass = new SSAARenderPass(this.scene, this.camera);
        this.ssaaRenderPass.stencilBuffer = true
        this.ssaaRenderPass.enabled = false

        // render pass (disable if using TAA or SSAA)
        this.renderPass = new RenderPass(this.scene, this.camera);

        // outline pass
        this.outlinePass = new OutlinePass(new THREE.Vector2(window.innerWidth, window.innerHeight), this.scene, this.camera);
        this.outlinePass.visibleEdgeColor = ViewerScene.outlineColorLight
        this.outlinePass.edgeThickness = window.devicePixelRatio
        this.outlinePass.edgeStrength = window.devicePixelRatio * 3
        this.outlinePass.enabled = false

        // SMAA
        this.smaaPass = new SMAAPass();
        this.smaaPass.enabled = false

        // output pass
        this.outputPass = new OutputPass();

        // FXAA
        this.fxaaPass = new FXAAPass();
        this.fxaaPass.enabled = false

        // composer
        this.createComposer()

        //
        // Rendering
        //
        this.renderer.setAnimationLoop(() => {
            this.controls.update();
            this.animateLoopCallback()

            this.outlinePass.enabled = this.characterSelectionVisible
            this.transformControls.enabled = this.characterSelectionVisible
            this.transformControlsHelper.visible = this.characterSelectionVisible

            if (
                (this.composerEnabled == 'Auto' && this.characterSelectionVisible) ||
                this.composerEnabled == 'Always'
            ) {
                if (this.taaRenderPass.enabled) {
                    if (this.taaCount < 1) {
                        this.taaCount++
                    } else {
                        if ((this.taaRenderPass as any).accumulateIndex >= 32) {
                            this.taaRenderPass.accumulate = false
                        } else {
                            this.taaRenderPass.accumulate = true
                        }
                    }
                }
                this.composer?.render();
            } else {
                this.renderer.render(this.scene, this.camera);
            }
        })

        window.addEventListener('resize', () => {
            const width = window.innerWidth;
            const height = window.innerHeight;

            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();

            this.renderer.setPixelRatio(window.devicePixelRatio);
            this.renderer.setSize(width, height);

            this.composer?.setPixelRatio(window.devicePixelRatio);
            this.composer?.setSize(width, height)

            this.outlinePass.edgeThickness = window.devicePixelRatio
            this.outlinePass.edgeStrength = window.devicePixelRatio * 3
        });
    }

    createComposer(msaaSamples = 0) {
        this.composer?.dispose()
        this.composerRenderTarget?.dispose()
        this.composerRenderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
            stencilBuffer: true,
            samples: msaaSamples,
            type: THREE.HalfFloatType, // ensure no color bands
        });
        this.composer = new EffectComposer(this.renderer, this.composerRenderTarget);
        this.composer.setPixelRatio(window.devicePixelRatio);
        this.composer.addPass(this.taaRenderPass);
        this.composer.addPass(this.ssaaRenderPass);
        this.composer.addPass(this.renderPass);
        this.composer.addPass(this.outlinePass);
        this.composer.addPass(this.smaaPass);
        this.composer.addPass(this.outputPass);
        this.composer.addPass(this.fxaaPass);
    }

    setAntiAliasing(aa: SceneComposerAntiAliasing, level: number) {
        this.taaRenderPass.enabled = false
        this.ssaaRenderPass.enabled = false
        this.renderPass.enabled = false
        this.smaaPass.enabled = false
        this.fxaaPass.enabled = false

        if (aa != 'MSAA' && this.composerRenderTarget && this.composerRenderTarget.samples > 0) {
            this.createComposer(0)
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
                this.createComposer(level)
            } else if (aa == 'SMAA') {
                this.smaaPass.enabled = true
            } else if (aa == 'FXAA') {
                this.fxaaPass.enabled = true
            }
        }
    }

    resetCameraControl() {
        this.camera.position.set(...ViewerScene.cameraInitialPosition)
        this.controls.target.set(...ViewerScene.controlsInitialTarget)
    }

    getIntersectedCharacter(x: number, y: number) {
        const coords = new THREE.Vector2(
            (x / this.renderer.domElement.offsetWidth) * 2 - 1,
            - (y / this.renderer.domElement.offsetHeight) * 2 + 1,
        )
        this.raycaster.setFromCamera(coords, this.camera);
        const intersects = this.raycaster.intersectObject(this.scene, true);
        // console.log(coords, intersects)

        for (const intersect of intersects) {
            for (const character of this.characters) {
                if (!character.character) continue
                for (const mesh of character.character.userData.meshes) {
                    if (mesh == intersect.object) {
                        return character
                    }
                }
            }
        }
    }

    characters: SceneCharacter[] = []
    _characterSelected?: SceneCharacter
    get characterSelected() {
        return this._characterSelected
    }
    set characterSelected(value) {
        this._characterSelected = value
        let obj = value?.character?.object
        if (obj) {
            this.outlinePass.selectedObjects = [obj]
            this.transformControls.attach(obj)
            console.log('Set scene selected character (with object):', value)
        } else {
            this.outlinePass.selectedObjects = []
            this.transformControls.detach()
            if (!value) {
                console.log('Deselected scene character')
            } else {
                console.log('Set scene selected character (without object):', value)
            }
        }
    }

    async switchCharacter(sceneCharacter: SceneCharacter | undefined, id: number | string, callbacks?: Partial<LoadCharacterCallbacks>): Promise<SceneCharacter> {
        if (!sceneCharacter) {
            sceneCharacter = {
                loading: false,
                removed: false,
            }
            this.characters.push(sceneCharacter)
        }

        return new Promise((resolve, reject) => {
            const isSelected = this.characterSelected == sceneCharacter

            if (sceneCharacter.removed) {
                reject('Character already removed')
            }

            if (sceneCharacter.loading) {
                sceneCharacter.pending = id
                sceneCharacter.pendingResolve = resolve
                return
            }
            sceneCharacter.loading = true
            sceneCharacter.pending = undefined

            if (sceneCharacter.character) {
                if (isSelected) this.characterSelected = undefined // clear selected temporarily to avoid errors in OutlinePass / TransformControls
                this.scene.remove(sceneCharacter.character.object)
                sceneCharacter.character.dispose()
                sceneCharacter.character = undefined
                if (isSelected) this.characterSelected = sceneCharacter // select it afterwards but with empty character
            }

            characters.loadCharacterById(id, callbacks)
                .then(character => {
                    if (sceneCharacter.pending || sceneCharacter.removed) {
                        character.dispose() // dispose if not adding to scene
                        return
                    }

                    sceneCharacter.character = character
                    this.scene.add(sceneCharacter.character.object)

                    if (this.characterSelected == sceneCharacter) {
                        this.characterSelected = sceneCharacter // select again to restore OutlinePass and TransformControls
                    }

                    resolve(sceneCharacter)
                })
                .catch(e => {
                    if (sceneCharacter.pending || sceneCharacter.removed) return // skip errors if stale
                    reject(e)
                })
                .finally(() => {
                    sceneCharacter.loading = false

                    if (sceneCharacter.removed) return

                    if (sceneCharacter.pending) {
                        // load and resolve pending character
                        this.switchCharacter(sceneCharacter, sceneCharacter.pending, callbacks).then(x => {
                            if (!sceneCharacter.pending) sceneCharacter.pendingResolve!(x)
                        })
                    }
                })
        })
    }

    async addCharacter(id: number | string, callbacks?: Partial<LoadCharacterCallbacks>) {
        return await this.switchCharacter(undefined, id, callbacks)
    }

    removeCharacter(sceneCharacter: SceneCharacter) {
        if (sceneCharacter.character) {
            this.scene.remove(sceneCharacter.character.object)
            sceneCharacter.character.dispose()
            sceneCharacter.character = undefined
        }
        this.characters = this.characters.filter(x => x != sceneCharacter)
        if (this.characterSelected == sceneCharacter) this.characterSelected = undefined
    }
}

export function deg2pos(degrees: number, radius: number) {
    const rad = THREE.MathUtils.degToRad(degrees);
    const x = radius * Math.sin(rad);
    const z = radius * Math.cos(rad);
    return { x, z }
}

export const viewerEl = document.getElementById('viewer')!

export const scene = new ViewerScene(viewerEl)
Object.assign(window, { scene })
