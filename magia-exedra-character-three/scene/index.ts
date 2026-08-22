import * as THREE from 'three';
import type MagiaExedraCharacterThree from '..'
import { createRenderer } from '../renderer'
import type MagiaExedraCharacter3D from '../character'
import type { LoadCharacterCallbacks } from '../loader';
import { SceneShadowController } from './shadow'
import { PerformanceController } from '../performance'
import { SceneEffectsController } from './effects'
import { ReDriveSelfShadowController } from './selfShadow'
import { ReDriveCameraDepthController } from './cameraDepth'
import { updateReDriveCharacterLightingDirection } from '../shaders/stylization'
import { StageCharacterShadowBridge } from '../../src/viewer/stageCharacterShadowBridge'

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
    stageCharacterShadows: StageCharacterShadowBridge
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
    selfShadow: ReDriveSelfShadowController
    cameraDepth: ReDriveCameraDepthController
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
                || this.effects.urpBloomPass.enabled
                || this.effects.backgroundColorAdjustPass.enabled
                || this.effects.paraffinPass.enabled
                || this.effects.volumePostProcessPass.enabled
                || this.effects.effectiveAntiAliasing !== 'None'
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

    private foregroundCaptureActive = false
    private captureRenderIntervalMs = 0
    private nextCaptureRenderAt = 0

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
            // Composer AA is the single source of truth. Avoid paying for an
            // implicit multisampled default framebuffer on top of FXAA/SMAA.
            antialias: false,
            powerPreference: 'high-performance',
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
        this.stageCharacterShadows = new StageCharacterShadowBridge(
            this.backgroundScene,
        )
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

        this.selfShadow = new ReDriveSelfShadowController(this)
        this.cameraDepth = new ReDriveCameraDepthController(this)

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
        this.renderer.setAnimationLoop(timestamp => {
            this.controls.update();
            // apply user rotation
            if (this.cameraRotation != undefined) {
                const rad = THREE.MathUtils.degToRad(this.cameraRotation)
                this.camera.quaternion.multiply(
                    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rad)
                )
            }

            this.animateLoopCallback()
            if (this.captureRenderIntervalMs > 0) {
                if (timestamp < this.nextCaptureRenderAt) return
                do {
                    this.nextCaptureRenderAt += this.captureRenderIntervalMs
                } while (this.nextCaptureRenderAt <= timestamp)
            }
            this.stageCharacterShadows.update()
            updateReDriveCharacterLightingDirection(this.camera)
            this.selfShadow.render()
            this.cameraDepth.render()

            this.effects.outlinePass.enabled = this.characterSelectionVisible
            this.transformControls.enabled = this.characterSelectionVisible
            this.transformControlsHelper.visible = this.characterSelectionVisible

            this.perfRender.start()
            this.renderCurrentFrame()
            this.perfRender.stop()
        })

        window.addEventListener('resize', () => {
            const host = this.renderer.domElement.parentElement
            this.setViewportSize(
                host?.clientWidth || window.innerWidth,
                host?.clientHeight || window.innerHeight,
            )
        });
    }

    renderCurrentFrame() {
        this.effects.syncBackgroundSceneState()
        this.effects.syncParaffinLightDirection()
        if (this.foregroundCaptureActive) {
            this.renderer.clear(true, true, true)
            this.renderer.render(this.scene, this.camera)
            return
        }
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
            this.effects.composer.render()
            return
        }

        if (this.backgroundSceneEnabled) {
            const autoClear = this.renderer.autoClear
            this.renderer.autoClear = true
            this.renderer.render(this.backgroundScene, this.camera)
            // Background geometry uses independent lighting but not a shared
            // depth hierarchy. Clear depth before drawing the character scene.
            this.renderer.clearDepth()
            this.renderer.autoClear = false
            this.renderer.render(this.scene, this.camera)
            this.renderer.autoClear = autoClear
            return
        }

        this.renderer.render(this.scene, this.camera)
    }

    /**
     * Draw the character scene alone into the existing drawing buffer, copy it
     * synchronously, then restore the normal stage/composer frame. No viewport,
     * camera or character transform is changed by capture.
     */
    captureForegroundFrame(copy: (source: HTMLCanvasElement) => void) {
        const renderer = this.renderer
        const previousAutoClear = renderer.autoClear
        const previousClearColor = renderer.getClearColor(new THREE.Color())
        const previousClearAlpha = renderer.getClearAlpha()
        const previousBackground = this.scene.background
        const previousTransformVisible = this.transformControlsHelper.visible
        const previousAxesVisible = this.axesHelper.visible
        const previousXrEnabled = renderer.xr.enabled
        const previousRenderTarget = renderer.getRenderTarget()

        try {
            renderer.xr.enabled = false
            renderer.autoClear = true
            renderer.setRenderTarget(null)
            renderer.setClearColor(0x000000, 0)
            this.scene.background = null
            this.transformControlsHelper.visible = false
            this.axesHelper.visible = false
            renderer.clear(true, true, true)
            renderer.render(this.scene, this.camera)
            copy(renderer.domElement)
        } finally {
            this.scene.background = previousBackground
            this.transformControlsHelper.visible = previousTransformVisible
            this.axesHelper.visible = previousAxesVisible
            renderer.autoClear = previousAutoClear
            renderer.setClearColor(previousClearColor, previousClearAlpha)
            renderer.xr.enabled = previousXrEnabled
            renderer.setRenderTarget(null)
            this.renderCurrentFrame()
            renderer.setRenderTarget(previousRenderTarget)
        }
    }

    /**
     * Keep the live renderer in transparent character-only mode for a recording.
     * This removes the former second full scene render on every captured frame.
     */
    beginForegroundCapture() {
        const renderer = this.renderer
        const previousBackground = this.scene.background
        const previousTransformVisible = this.transformControlsHelper.visible
        const previousAxesVisible = this.axesHelper.visible
        const previousAutoClear = renderer.autoClear
        const previousClearColor = renderer.getClearColor(new THREE.Color())
        const previousClearAlpha = renderer.getClearAlpha()
        const previousActive = this.foregroundCaptureActive
        let restored = false

        this.foregroundCaptureActive = true
        this.scene.background = null
        this.transformControlsHelper.visible = false
        this.axesHelper.visible = false
        renderer.autoClear = true
        renderer.setClearColor(0x000000, 0)
        this.renderCurrentFrame()

        return {
            restore: () => {
                if (restored) return
                restored = true
                this.foregroundCaptureActive = previousActive
                this.scene.background = previousBackground
                this.transformControlsHelper.visible = previousTransformVisible
                this.axesHelper.visible = previousAxesVisible
                renderer.autoClear = previousAutoClear
                renderer.setClearColor(previousClearColor, previousClearAlpha)
                this.renderCurrentFrame()
            },
        }
    }

    /**
     * Temporarily raise the WebGL drawing buffer for export without changing
     * the canvas CSS size, camera aspect or viewer layout. The returned lease
     * must be restored after the still frame or recording is complete.
     */
    beginCaptureResolution(targetLongEdge: number, allowDownscale = false) {
        const renderer = this.renderer
        const logicalSize = renderer.getSize(new THREE.Vector2())
        const drawingSize = renderer.getDrawingBufferSize(new THREE.Vector2())
        const previousRendererPixelRatio = renderer.getPixelRatio()
        const composer = this.effects.composer
        const previousComposerPixelRatio = previousRendererPixelRatio
        const previousOutlineThickness = this.effects.outlinePass.edgeThickness
        const previousOutlineStrength = this.effects.outlinePass.edgeStrength
        const gl = renderer.getContext()
        const maxRenderbufferSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number
        const supportedLongEdge = Math.max(
            1,
            Math.min(renderer.capabilities.maxTextureSize, maxRenderbufferSize),
        )
        const currentLongEdge = Math.max(drawingSize.x, drawingSize.y, 1)
        const requestedLongEdge = Math.min(
            Math.max(
                1,
                allowDownscale
                    ? Math.round(targetLongEdge)
                    : Math.max(currentLongEdge, Math.round(targetLongEdge)),
            ),
            supportedLongEdge,
        )
        const capturePixelRatio = previousRendererPixelRatio * requestedLongEdge / currentLongEdge
        let restored = false

        renderer.setPixelRatio(capturePixelRatio)
        renderer.setSize(logicalSize.x, logicalSize.y, false)
        composer.setPixelRatio(capturePixelRatio)
        composer.setSize(logicalSize.x, logicalSize.y)
        this.effects.outlinePass.edgeThickness = capturePixelRatio
        this.effects.outlinePass.edgeStrength = capturePixelRatio * 3
        this.renderCurrentFrame()

        const captureSize = renderer.getDrawingBufferSize(new THREE.Vector2())
        return {
            width: Math.round(captureSize.x),
            height: Math.round(captureSize.y),
            restore: () => {
                if (restored) return
                restored = true
                renderer.setPixelRatio(previousRendererPixelRatio)
                renderer.setSize(logicalSize.x, logicalSize.y, false)
                composer.setPixelRatio(previousComposerPixelRatio)
                composer.setSize(logicalSize.x, logicalSize.y)
                this.effects.outlinePass.edgeThickness = previousOutlineThickness
                this.effects.outlinePass.edgeStrength = previousOutlineStrength
                this.renderCurrentFrame()
            },
        }
    }

    /**
     * Temporarily render at an exact export frame size and aspect ratio while
     * keeping the canvas' CSS box unchanged. This avoids allocating a much
     * wider hidden drawing buffer merely to crop it back to a portrait, square
     * or 4:3 recording frame.
     */
    beginCaptureFrameSize(
        targetWidth: number,
        targetHeight: number,
        frameRate = 30,
        includePostProcessing = true,
    ) {
        const renderer = this.renderer
        const logicalSize = renderer.getSize(new THREE.Vector2())
        const previousRendererPixelRatio = renderer.getPixelRatio()
        const composer = this.effects.composer
        const previousComposerPixelRatio = previousRendererPixelRatio
        const previousCameraAspect = this.camera.aspect
        const previousOutlineThickness = this.effects.outlinePass.edgeThickness
        const previousOutlineStrength = this.effects.outlinePass.edgeStrength
        const previousObjectFit = renderer.domElement.style.objectFit
        const previousCaptureRenderIntervalMs = this.captureRenderIntervalMs
        const previousNextCaptureRenderAt = this.nextCaptureRenderAt
        const gl = renderer.getContext()
        const supportedEdge = Math.max(
            1,
            Math.min(renderer.capabilities.maxTextureSize, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number),
        )
        const requestedWidth = Math.max(2, Math.round(targetWidth / 2) * 2)
        const requestedHeight = Math.max(2, Math.round(targetHeight / 2) * 2)
        const supportedScale = Math.min(1, supportedEdge / Math.max(requestedWidth, requestedHeight))
        const captureWidth = Math.max(2, Math.floor(requestedWidth * supportedScale / 2) * 2)
        const captureHeight = Math.max(2, Math.floor(requestedHeight * supportedScale / 2) * 2)
        let restored = false

        renderer.domElement.style.objectFit = 'contain'
        this.captureRenderIntervalMs = 1000 / Math.max(1, frameRate)
        this.nextCaptureRenderAt = performance.now()
        this.camera.aspect = captureWidth / captureHeight
        this.camera.updateProjectionMatrix()
        renderer.setPixelRatio(1)
        renderer.setSize(captureWidth, captureHeight, false)
        if (includePostProcessing) {
            composer.setPixelRatio(1)
            composer.setSize(captureWidth, captureHeight)
        }
        this.effects.outlinePass.edgeThickness = 1
        this.effects.outlinePass.edgeStrength = 3
        this.renderCurrentFrame()

        return {
            width: captureWidth,
            height: captureHeight,
            restore: () => {
                if (restored) return
                restored = true
                renderer.domElement.style.objectFit = previousObjectFit
                this.captureRenderIntervalMs = previousCaptureRenderIntervalMs
                this.nextCaptureRenderAt = previousNextCaptureRenderAt
                this.camera.aspect = previousCameraAspect
                this.camera.updateProjectionMatrix()
                renderer.setPixelRatio(previousRendererPixelRatio)
                renderer.setSize(logicalSize.x, logicalSize.y, false)
                if (includePostProcessing) {
                    composer.setPixelRatio(previousComposerPixelRatio)
                    composer.setSize(logicalSize.x, logicalSize.y)
                }
                this.effects.outlinePass.edgeThickness = previousOutlineThickness
                this.effects.outlinePass.edgeStrength = previousOutlineStrength
                this.renderCurrentFrame()
            },
        }
    }

    setViewportSize(width: number, height: number) {
        const safeWidth = Math.max(1, Math.round(width))
        const safeHeight = Math.max(1, Math.round(height))

        this.camera.aspect = safeWidth / safeHeight
        this.camera.updateProjectionMatrix()

        this.renderer.setSize(safeWidth, safeHeight)
        this.effects.composer.setSize(safeWidth, safeHeight)
        this.updateRenderPixelRatio()
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
                this.stageCharacterShadows.remove(sceneCharacter.character.object)
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
                    this.stageCharacterShadows.add(sceneCharacter.character.object)

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
            this.stageCharacterShadows.remove(sceneCharacter.character.object)
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
