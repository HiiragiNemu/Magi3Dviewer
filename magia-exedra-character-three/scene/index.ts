import * as THREE from 'three';
import type MagiaExedraCharacterThree from '..'
import { createRenderer } from '../renderer'
import type MagiaExedraCharacter3D from '../character'
import type { LoadCharacterCallbacks } from '../loader';
import { SceneShadowController } from './shadow'
import { PerformanceController } from '../performance'
import { SceneEffectsController } from './effects'

import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

export interface SceneCharacter {
    character?: MagiaExedraCharacter3D
    loading: boolean
    pending?: number | string
    pendingResolve?: (value: SceneCharacter) => void
    removed: boolean
}

export interface ColorFilter {
    brightness: number
    contrast: number
    saturation: number
}

export class MagiaExedraScene3D {
    characterManager: MagiaExedraCharacterThree

    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    /**
     * Official background-only lights use Unity culling masks. Three.js light
     * layers are camera-global, so the stage is rendered in a separate scene
     * and composited before characters instead.
     */
    backgroundScene: THREE.Scene
    backgroundSceneEnabled = false
    backgroundAmbientLight: THREE.AmbientLight
    static defaultPixelRatio = 1
    private _pixelRatio = MagiaExedraScene3D.defaultPixelRatio

    camera: THREE.PerspectiveCamera
    cameraRotation: number | undefined = undefined
    static cameraInitialFov = 15
    static cameraInitialPosition: [number, number, number] = [0, 1.5, 7.5]

    controls: OrbitControls
    static controlsInitialTarget: [number, number, number] = [0, 0.9, 0]

    ambientLight: THREE.AmbientLight
    static ambientLightInitialColor = '#aaaaaa'
    static ambientLightInitialIntensity = 5

    directionalLight: THREE.DirectionalLight
    static directionalLightInitialColor = '#999999'
    static directionalLightInitialIntensity = 5
    static directionalLightInitialAngle = 15
    static directionalLightInitialDistance = 10
    static directionalLightInitialHeight = 2.5

    shadow: SceneShadowController
    static shadowEnabled = true
    static shadowResolution = 4096
    static shadowBias = 0

    axesHelper: THREE.AxesHelper

    raycaster: THREE.Raycaster

    transformControls: TransformControls
    transformControlsHelper

    composerEnabled: 'Auto' | 'Always' | 'Never' = 'Auto'
    effects: SceneEffectsController

    get shouldUseComposer(): boolean {
        if (this.composerEnabled == 'Always') {
            return true
        }

        if (this.composerEnabled == 'Auto') {
            if (
                this.backgroundSceneEnabled
                || this.characterSelectionVisible
                || this.effects.bloomPass.enabled
                || this.effects.backgroundColorAdjustPass.enabled
            ) {
                return true
            }
        }

        return false
    }

    get characterSelectionVisible() {
        return this.effects.outlinePass.selectedObjects.length > 0 && this.characters.length > 1
    }

    animateLoopCallback: () => any = () => { }

    taaCount = 0

    static colorFilter: ColorFilter = {
        brightness: 1.0,
        contrast: 1.0,
        saturation: 1.15,
    }

    perfRender = new PerformanceController('Scene')

    constructor(characterManager: MagiaExedraCharacterThree) {
        this.characterManager = characterManager

        //
        // Renderer, scene, camera & controls
        //
        this.renderer = createRenderer({
            antialias: true,
            alpha: true, // transparent background
            preserveDrawingBuffer: true, // allow it to be captured, for photo mode
        });
        this.renderer.setPixelRatio(this.getRenderPixelRatio());
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.xr.enabled = true

        this.setColorFilter(MagiaExedraScene3D.colorFilter)

        this.scene = new THREE.Scene();
        this.backgroundScene = new THREE.Scene();
        this.backgroundAmbientLight = new THREE.AmbientLight(
            MagiaExedraScene3D.ambientLightInitialColor,
            MagiaExedraScene3D.ambientLightInitialIntensity,
        )
        this.backgroundScene.add(this.backgroundAmbientLight)
        // scene.background = new THREE.Color(0x333333);

        this.ambientLight = new THREE.AmbientLight(MagiaExedraScene3D.ambientLightInitialColor, MagiaExedraScene3D.ambientLightInitialIntensity);
        this.scene.add(this.ambientLight);

        this.directionalLight = new THREE.DirectionalLight(MagiaExedraScene3D.directionalLightInitialColor, MagiaExedraScene3D.directionalLightInitialIntensity);
        const {
            x: directionalLightPositionX,
            z: directionalLightPositionZ
        } = deg2pos(MagiaExedraScene3D.directionalLightInitialAngle, MagiaExedraScene3D.directionalLightInitialDistance)
        this.directionalLight.position.set(
            directionalLightPositionX,
            MagiaExedraScene3D.directionalLightInitialHeight,
            directionalLightPositionZ
        );
        this.scene.add(this.directionalLight);

        // enable shadows
        this.shadow = new SceneShadowController(this)
        this.shadow.enabled = MagiaExedraScene3D.shadowEnabled
        this.shadow.resolution = MagiaExedraScene3D.shadowResolution
        this.shadow.bias = MagiaExedraScene3D.shadowBias

        this.axesHelper = new THREE.AxesHelper(2);
        this.axesHelper.visible = false
        this.scene.add(this.axesHelper);

        this.camera = new THREE.PerspectiveCamera(MagiaExedraScene3D.cameraInitialFov, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(...MagiaExedraScene3D.cameraInitialPosition);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.target.set(...MagiaExedraScene3D.controlsInitialTarget);

        this.raycaster = new THREE.Raycaster();

        this.transformControls = new TransformControls(this.camera, this.renderer.domElement)
        this.transformControls.addEventListener('dragging-changed', e => {
            this.controls.enabled = !e.value;
        });
        this.transformControlsHelper = this.transformControls.getHelper();
        this.scene.add(this.transformControlsHelper);

        // composer
        this.effects = new SceneEffectsController(this)

        //
        // Rendering
        //
        this.renderer.setAnimationLoop(() => {
            this.controls.update();
            // apply user rotation
            if (this.cameraRotation != undefined) {
                const rad = THREE.MathUtils.degToRad(this.cameraRotation)
                this.camera.quaternion.multiply(
                    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rad)
                )
            }

            this.animateLoopCallback()

            this.effects.outlinePass.enabled = this.characterSelectionVisible
            this.transformControls.enabled = this.characterSelectionVisible
            this.transformControlsHelper.visible = this.characterSelectionVisible

            this.perfRender.start()
            this.effects.syncBackgroundSceneState()
            if (this.shouldUseComposer) {
                if (this.effects.taaRenderPass.enabled) {
                    if (this.taaCount < 1) {
                        this.taaCount++
                    } else {
                        if ((this.effects.taaRenderPass as any).accumulateIndex >= 32) {
                            this.effects.taaRenderPass.accumulate = false
                        } else {
                            this.effects.taaRenderPass.accumulate = true
                        }
                    }
                }
                this.effects.composer.render();
            } else {
                if (this.backgroundSceneEnabled) {
                    const autoClear = this.renderer.autoClear
                    this.renderer.autoClear = true
                    this.renderer.render(this.backgroundScene, this.camera)
                    // Background geometry uses independent lighting but not a
                    // shared depth hierarchy. Clear depth before drawing the
                    // character scene so the stage cannot occlude its colour
                    // pass while leaving only the outline visible.
                    this.renderer.clearDepth()
                    this.renderer.autoClear = false
                    this.renderer.render(this.scene, this.camera)
                    this.renderer.autoClear = autoClear
                } else {
                    this.renderer.render(this.scene, this.camera);
                }
            }
            this.perfRender.stop()
        })

        window.addEventListener('resize', () => {
            const width = window.innerWidth;
            const height = window.innerHeight;

            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();

            this.renderer.setSize(width, height);
            this.effects.composer.setSize(width, height)
            this.updateRenderPixelRatio()
        });
    }

    get pixelRatio() {
        return this._pixelRatio
    }

    set pixelRatio(value) {
        this._pixelRatio = value
        this.updateRenderPixelRatio()
    }

    getRenderPixelRatio() {
        return window.devicePixelRatio * this.pixelRatio
    }

    updateRenderPixelRatio() {
        this.renderer.setPixelRatio(this.getRenderPixelRatio());
        this.effects.composer.setPixelRatio(this.getRenderPixelRatio());

        this.effects.outlinePass.edgeThickness = this.getRenderPixelRatio()
        this.effects.outlinePass.edgeStrength = this.getRenderPixelRatio() * 3
    }

    setColorFilter(filter: ColorFilter) {
        this.renderer.domElement.style.filter = `brightness(${filter.brightness}) contrast(${filter.contrast}) saturate(${filter.saturation})`
    }

    getColorFilterCSS() {
        return this.renderer.domElement.style.filter
    }

    resetCameraControl() {
        this.camera.position.set(...MagiaExedraScene3D.cameraInitialPosition)
        this.controls.target.set(...MagiaExedraScene3D.controlsInitialTarget)
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
                    if (mesh == intersect.object && intersect.object.visible) {
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
            this.effects.outlinePass.selectedObjects = [obj]
            this.transformControls.attach(obj)
            console.log('Set scene selected character (with object):', value)
        } else {
            this.effects.outlinePass.selectedObjects = []
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
                // reject('Character already removed')
                return
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

            this.characterManager.loadCharacterById(id, callbacks)
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
        sceneCharacter.removed = true
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
