import { SelectionHighlight } from '../../src/viewer/selectionHighlight'
import { attachCharacterAngelRing } from '../angelRing/runtime'
import { startLoadingTask } from '../loadingProgress.ts'
import * as THREE from 'three';
import type MagiaExedraCharacterThree from '..'
import {
    createRenderer,
    getRenderPauseState,
    updateCameraRenderLoops,
} from '../renderer'
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
import { readDiagnosticCameraInitialState } from './diagnosticCamera'
import { installLinearOrbitWheel } from './linearOrbitWheel'

export interface SceneCharacter {
    character?: MagiaExedraCharacter3D
    loading: boolean
    loadGeneration?: number
    loadController?: AbortController
    loadPromise?: Promise<SceneCharacter>
    requestedId?: number | string
    retainedCharacter?: MagiaExedraCharacter3D
    activeProgressCallback?: (progress: string) => any
    /** @deprecated superseded by the single generation-owned transaction */
    pending?: number | string
    /** @deprecated superseded by loadPromise */
    pendingResolve?: (value: SceneCharacter) => void
    removed: boolean
}

export interface ColorFilter {
    brightness: number
    contrast: number
    saturation: number
}

interface ReDriveDiagnosticUniform {
    id?: string | number
    type?: number
    size?: number
    seq?: ReDriveDiagnosticUniform[]
}

interface ReDriveDiagnosticProgram {
    id?: number
    name?: string
    cacheKey?: string
    program?: WebGLProgram
    getUniforms?: () => { seq?: ReDriveDiagnosticUniform[] }
}

interface ReDriveTextureUnitOverflowRecord {
    programId: number | null
    programName: string | null
    cacheKey: string
    requestedTextureUnits: number
    count: number
    samplers: Array<{ name: string; type: number; size: number }>
}

interface ReDriveTextureUnitAssignmentRecord {
    programId: number | null
    programName: string | null
    uniformName: string
    assignedUnits: number[]
    count: number
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
    // Official ReDrive camera globals write 1 / Camera.fieldOfView to
    // _GlobalFOVorOrthoSizeFix. The live 1536x864 character draw and its
    // MatrixVP both resolve to 40 degrees. Keeping the Viewer at 15 degrees
    // inflated every projected-common AngelRing footprint by 40 / 15.
    static cameraInitialFov = 40
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
    private beforeRenderCallbacks = new Set<() => void>()
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
                || this.effects.bloomPass.enabled
                || this.effects.urpBloomPass.enabled
                || this.effects.backgroundColorAdjustPass.enabled
                || this.effects.paraffinPass.enabled
            || this.effects.volumePostProcessPass.enabled
            || this.effects.combatVfxScreenPass.enabled
            || this.effects.effectiveAntiAliasing !== 'None'
            ) {
                return true
            }
        }

        return false
    }

    // Selecting an actor owns animation/TPS input, not the edit overlay.
    characterTransformEditing = false
    readonly selectionHighlight = new SelectionHighlight()

    get characterSelectionVisible() {
        return this.characterTransformEditing && this.effects.outlinePass.selectedObjects.length > 0
    }

    animateLoopCallback: () => any = () => { }

    private foregroundCaptureActive = false
    private captureRenderIntervalMs = 0
    private nextCaptureRenderAt = 0
    private nextVisualDiagnosticAt = 0
    private textureUnitOverflowRecords = new Map<
        string,
        ReDriveTextureUnitOverflowRecord
    >()
    private textureUnitOverflowAssignments = new Map<
        string,
        ReDriveTextureUnitAssignmentRecord
    >()
    private textureUnitAssignments = new Map<
        string,
        ReDriveTextureUnitAssignmentRecord
    >()

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
            // Photo/export paths render and copy synchronously below. Keeping
            // every interactive frame alive forces Chromium to retain another
            // full-resolution back buffer for every open Viewer page.
            preserveDrawingBuffer: false,
        });
        this.renderer.setPixelRatio(this.getRenderPixelRatio());
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.xr.enabled = true
        this.installTextureUnitOverflowDiagnostic()

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
        installLinearOrbitWheel(this.controls, this.camera)
        this.controls.enableDamping = true;
        this.controls.target.set(...MagiaExedraScene3D.controlsInitialTarget);
        const diagnosticCamera = readDiagnosticCameraInitialState(
            window.location.search,
        )
        if (diagnosticCamera?.position) {
            this.camera.position.set(...diagnosticCamera.position)
        }
        if (diagnosticCamera?.target) {
            this.controls.target.set(...diagnosticCamera.target)
        }
        if (diagnosticCamera) {
            this.controls.update()
            this.renderer.domElement.dataset.reDriveDiagnosticCameraInitialState =
                JSON.stringify({
                    ...diagnosticCamera,
                    orbitUnrestricted:
                        this.controls.minPolarAngle === 0
                        && this.controls.maxPolarAngle === Math.PI
                        && this.controls.minDistance === 0
                        && this.controls.maxDistance === Infinity,
                })
        }

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
            // enabled gates Orbit input, not OrbitControls.update itself. An
            // external camera owner (TPS/editor) must also own the rendered
            // pose: pending Orbit damping must not overwrite it after update.
            if (this.controls.enabled) this.controls.update();
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
            updateCameraRenderLoops(this.camera)
            this.stageCharacterShadows.update()
            this.beforeRenderCallbacks.forEach(callback => callback())
            updateReDriveCharacterLightingDirection(this.camera)
            this.selfShadow.render()
            this.cameraDepth.render()

            // Highlight in existing outline draws, never redraw the full stage.
            this.effects.outlinePass.enabled = false
            // Dismissed edit handles stay dismissed while actor selection remains intact.
            const transformVisible = this.characterSelectionVisible && Boolean(this.transformControls.object)
            this.transformControls.enabled = transformVisible
            this.transformControlsHelper.visible = transformVisible

            this.perfRender.start()
            this.renderCurrentFrame()
            this.perfRender.stop()
            this.publishVisualDiagnostic(timestamp)
        })

        window.addEventListener('resize', () => {
            const host = this.renderer.domElement.parentElement
            this.setViewportSize(
                host?.clientWidth || window.innerWidth,
                host?.clientHeight || window.innerHeight,
            )
        });
    }

    private installTextureUnitOverflowDiagnostic() {
        if (
            new URLSearchParams(window.location.search).get('diagnostic')
            !== 'gem-view-angle'
        ) return

        const gl = this.renderer.getContext() as WebGL2RenderingContext
        const maxTextureUnits = Number(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS))
        const samplerTypes = new Set<number>([
            gl.SAMPLER_2D,
            gl.SAMPLER_CUBE,
            gl.SAMPLER_2D_SHADOW,
            gl.SAMPLER_CUBE_SHADOW,
            gl.SAMPLER_2D_ARRAY,
            gl.SAMPLER_2D_ARRAY_SHADOW,
            gl.INT_SAMPLER_2D,
            gl.INT_SAMPLER_2D_ARRAY,
            gl.UNSIGNED_INT_SAMPLER_2D,
            gl.UNSIGNED_INT_SAMPLER_2D_ARRAY,
        ])
        const originalWarn = console.warn.bind(console)
        console.warn = (...args: unknown[]) => {
            const message = args.map(value => String(value)).join(' ')
            const match = message.match(
                /Trying to use (\d+) texture units while this GPU supports only (\d+)/,
            )
            if (match) {
                const requestedTextureUnits = Number(match[1])
                const currentProgram = gl.getParameter(
                    gl.CURRENT_PROGRAM,
                ) as WebGLProgram | null
                const programs = (this.renderer.info.programs ?? []) as unknown as
                    ReDriveDiagnosticProgram[]
                const program = programs.find(entry =>
                    entry.program === currentProgram
                )
                const samplers: ReDriveTextureUnitOverflowRecord['samplers'] = []
                if (currentProgram) {
                    const uniformCount = Number(gl.getProgramParameter(
                        currentProgram,
                        gl.ACTIVE_UNIFORMS,
                    ))
                    for (let index = 0; index < uniformCount; index += 1) {
                        const uniform = gl.getActiveUniform(currentProgram, index)
                        if (!uniform || !samplerTypes.has(uniform.type)) continue
                        samplers.push({
                            name: uniform.name.replace(/\[0\]$/, ''),
                            type: uniform.type,
                            size: Math.max(1, uniform.size),
                        })
                    }
                }
                const cacheKey = String(program?.cacheKey ?? '')
                const key = [
                    program?.id ?? 'unknown',
                    program?.name ?? '',
                    requestedTextureUnits,
                    samplers.map(sampler =>
                        `${sampler.name}:${sampler.size}`
                    ).join(','),
                ].join('|')
                const existing = this.textureUnitOverflowRecords.get(key)
                if (existing) existing.count += 1
                else this.textureUnitOverflowRecords.set(key, {
                    programId: program?.id ?? null,
                    programName: program?.name ?? null,
                    cacheKey,
                    requestedTextureUnits,
                    count: 1,
                    samplers,
                })
            }
            originalWarn(...args)
        }

        this.renderer.domElement.dataset.reDriveTextureUnitLimit = String(
            maxTextureUnits,
        )
        this.renderer.domElement.dataset.reDriveTextureUnitDiagnosticMode =
            'periodic-program-snapshot'
    }

    private publishVisualDiagnostic(timestamp: number) {
        if (
            new URLSearchParams(window.location.search).get('diagnostic')
            !== 'gem-view-angle'
            || timestamp < this.nextVisualDiagnosticAt
        ) return
        this.nextVisualDiagnosticAt = timestamp + 5000

        const gl = this.renderer.getContext() as WebGL2RenderingContext
        const maxTextureUnits = Number(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS))
        const rendererInfo = gl.getExtension('WEBGL_debug_renderer_info')
        const samplerTypes = new Set<number>([
            gl.SAMPLER_2D,
            gl.SAMPLER_CUBE,
            gl.SAMPLER_2D_SHADOW,
            gl.SAMPLER_CUBE_SHADOW,
            gl.SAMPLER_2D_ARRAY,
            gl.SAMPLER_2D_ARRAY_SHADOW,
            gl.INT_SAMPLER_2D,
            gl.INT_SAMPLER_2D_ARRAY,
            gl.UNSIGNED_INT_SAMPLER_2D,
            gl.UNSIGNED_INT_SAMPLER_2D_ARRAY,
        ])
        const collectSamplers = (
            uniforms: readonly ReDriveDiagnosticUniform[] = [],
            prefix = '',
        ): Array<{ name: string; type: number; size: number }> =>
            uniforms.flatMap(uniform => {
                const name = prefix
                    ? `${prefix}.${String(uniform.id ?? '')}`
                    : String(uniform.id ?? '')
                if (uniform.seq) return collectSamplers(uniform.seq, name)
                if (uniform.type == undefined || !samplerTypes.has(uniform.type)) {
                    return []
                }
                return [{
                    name,
                    type: uniform.type,
                    size: Math.max(1, uniform.size ?? 1),
                }]
            })
        const programs = (this.renderer.info.programs ?? []) as unknown as
            ReDriveDiagnosticProgram[]
        const programSamplers = programs.map(program => {
            const samplers = collectSamplers(program.getUniforms?.().seq).map(
                sampler => {
                    if (!program.program) return {
                        ...sampler,
                        assignedUnits: [] as number[],
                    }
                    const location = gl.getUniformLocation(
                        program.program,
                        sampler.size > 1
                            ? `${sampler.name}[0]`
                            : sampler.name,
                    )
                    const assigned = location
                        ? gl.getUniform(program.program, location)
                        : null
                    return {
                        ...sampler,
                        assignedUnits: typeof assigned === 'number'
                            ? [assigned]
                            : assigned && typeof assigned.length === 'number'
                                ? Array.from(assigned as ArrayLike<number>)
                                : [],
                    }
                },
            )
            const cacheKey = String(program.cacheKey ?? '')
            return {
                id: program.id ?? null,
                name: program.name ?? null,
                kind: cacheKey.includes('"faceSdf":true')
                    ? 'face'
                    : cacheKey.includes('"specialJewel":true')
                        ? 'gem-capable'
                        : cacheKey.includes('angelRing')
                            ? 'hair-capable'
                            : 'other',
                textureUnits: samplers.reduce(
                    (total, sampler) => total + sampler.size,
                    0,
                ),
                samplers,
            }
        }).sort((a, b) => b.textureUnits - a.textureUnits)

        // Read the current sampler assignments once per diagnostic snapshot.
        // Never wrap uniform1i/uniform1iv/getUniformLocation: those functions
        // are hot for every draw and made multiple diagnostic Viewer tabs
        // spend CPU time recording the renderer rather than rendering.
        this.textureUnitAssignments.clear()
        this.textureUnitOverflowAssignments.clear()
        for (const program of programSamplers) {
            for (const sampler of program.samplers) {
                if (sampler.assignedUnits.length === 0) continue
                const key = [
                    program.id ?? 'unknown',
                    program.name ?? '',
                    sampler.name,
                    sampler.assignedUnits.join(','),
                ].join('|')
                const record: ReDriveTextureUnitAssignmentRecord = {
                    programId: program.id,
                    programName: program.name,
                    uniformName: sampler.name,
                    assignedUnits: sampler.assignedUnits,
                    count: 1,
                }
                this.textureUnitAssignments.set(key, record)
                if (sampler.assignedUnits.some(unit => unit >= maxTextureUnits)) {
                    this.textureUnitOverflowAssignments.set(key, record)
                }
            }
        }

        const lightPosition = this.directionalLight.getWorldPosition(
            new THREE.Vector3(),
        )
        const lightTarget = this.directionalLight.target.getWorldPosition(
            new THREE.Vector3(),
        )
        const mainLightWorld = lightPosition.sub(lightTarget).normalize()
        const mainLightView = mainLightWorld.clone().transformDirection(
            this.camera.matrixWorldInverse,
        )
        const characters = this.characters.flatMap(entry => {
            const character = entry.character
            if (!character) return []
            const meshes: Array<Record<string, unknown>> = []
            character.object.traverse(object => {
                const mesh = object as THREE.Mesh
                if (!mesh.isMesh) return
                const materials = Array.isArray(mesh.material)
                    ? mesh.material
                    : [mesh.material]
                if (
                    !/(face|hair|body|gem|eye|eyebrow)/i.test(mesh.name)
                    && !materials.some(material =>
                        /(face|hair|body|gem|eye|eyebrow|_sj)/i.test(material.name)
                    )
                ) return
                meshes.push({
                    name: mesh.name,
                    renderOrder: mesh.renderOrder,
                    groups: mesh.geometry.groups.map(group => ({
                        start: group.start,
                        count: group.count,
                        materialIndex: group.materialIndex ?? 0,
                    })),
                    materials: materials.map((material, materialIndex) => ({
                        materialIndex,
                        name: material.name,
                        depthTest: material.depthTest,
                        depthWrite: material.depthWrite,
                        transparent: material.transparent,
                        opacity: material.opacity,
                        stencilWrite: material.stencilWrite,
                        stencilRef: material.stencilRef,
                        stencilFunc: material.stencilFunc,
                        stencilFuncMask: material.stencilFuncMask,
                        stencilWriteMask: material.stencilWriteMask,
                    })),
                    stencilWriters:
                        mesh.userData.officialStencilWriters ?? null,
                    stencilSelectors:
                        mesh.userData.officialStencilSelectors ?? null,
                    gemRuntime: mesh.userData.officialGemRuntime ?? null,
                    toonShadowRuntime:
                        mesh.userData.officialToonShadowRuntime ?? null,
                    angelRingRuntime:
                        mesh.userData.officialAngelRingRuntime ?? null,
                })
            })
            return [{
                characterId: character.object.userData.characterId ?? null,
                meshes,
            }]
        })

        this.renderer.domElement.dataset.reDriveVisualDiagnostic = JSON.stringify({
            schemaVersion: 1,
            camera: {
                fov: this.camera.fov,
                aspect: this.camera.aspect,
                near: this.camera.near,
                far: this.camera.far,
                position: this.camera.position.toArray(),
                target: this.controls.target.toArray(),
                forwardElevationDegrees:
                    (this.controls.getPolarAngle() - Math.PI / 2)
                    * 180 / Math.PI,
                interactiveOrbitLimits: {
                    minPolarAngleRadians: this.controls.minPolarAngle,
                    maxPolarAngleRadians: this.controls.maxPolarAngle,
                    minDistance: this.controls.minDistance,
                    maxDistance: Number.isFinite(this.controls.maxDistance)
                        ? this.controls.maxDistance
                        : null,
                    unrestricted:
                        this.controls.minPolarAngle === 0
                        && this.controls.maxPolarAngle === Math.PI
                        && this.controls.minDistance === 0
                        && this.controls.maxDistance === Infinity,
                },
            },
            mainLight: {
                world: mainLightWorld.toArray(),
                view: mainLightView.toArray(),
                color: this.directionalLight.color.toArray(),
                intensity: this.directionalLight.intensity,
                castShadow: this.directionalLight.castShadow,
            },
            reDriveCharacterLightingOverrideDirection:
                this.scene.userData.reDriveCharacterLightingOverrideDirection
                ?? null,
            gpu: {
                acceleratedRenderer: rendererInfo
                    ? gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL)
                    : gl.getParameter(gl.RENDERER),
                vendor: rendererInfo
                    ? gl.getParameter(rendererInfo.UNMASKED_VENDOR_WEBGL)
                    : gl.getParameter(gl.VENDOR),
                isWebGL2: this.renderer.capabilities.isWebGL2,
                maxFragmentTextureUnits:
                    gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
                drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
                render: { ...this.renderer.info.render },
                memory: { ...this.renderer.info.memory },
                programs: programSamplers,
                textureUnitOverflows: [
                    ...this.textureUnitOverflowRecords.values(),
                ].sort((a, b) =>
                    b.requestedTextureUnits - a.requestedTextureUnits
                    || b.count - a.count
                ),
                textureUnitOverflowAssignments: [
                    ...this.textureUnitOverflowAssignments.values(),
                ].sort((a, b) =>
                    Math.max(...b.assignedUnits) - Math.max(...a.assignedUnits)
                    || b.count - a.count
                ),
                textureUnitAssignments: [
                    ...this.textureUnitAssignments.values(),
                ],
            },
            renderPause: getRenderPauseState(),
            characters,
        })
    }

    addBeforeRenderCallback(callback: () => void) {
        this.beforeRenderCallbacks.add(callback)
        return () => this.beforeRenderCallbacks.delete(callback)
    }

    renderCurrentFrame() {
        this.selectionHighlight.select(!this.foregroundCaptureActive && this.characterSelectionVisible
            ? this.characterSelected?.character?.object : undefined)
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
            this.selectionHighlight.clear()
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
        this.selectionHighlight.clear()
        this._characterSelected = value
        this.characterTransformEditing = false
        this.effects.outlinePass.enabled = false
        this.transformControls.detach()
        this.transformControls.enabled = false
        this.transformControlsHelper.visible = false
        let obj = value?.character?.object
        if (obj) {
            this.effects.outlinePass.selectedObjects = [obj]
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

    switchCharacter(
        sceneCharacter: SceneCharacter | undefined,
        id: number | string,
        callbacks?: Partial<LoadCharacterCallbacks>,
    ): Promise<SceneCharacter> {
        if (!sceneCharacter) {
            sceneCharacter = {
                loading: false,
                loadGeneration: 0,
                removed: false,
            }
            this.characters.push(sceneCharacter)
        }

        const target = sceneCharacter
        const targetKey = String(id)
        if (target.removed) {
            return Promise.reject(new Error('Character already removed'))
        }
        if (
            target.loading
            && String(target.requestedId) === targetKey
            && target.loadPromise
        ) {
            return target.loadPromise
        }
        if (
            !target.loading
            && String(target.character?.userData.characterId) === targetKey
        ) {
            return Promise.resolve(target)
        }

        target.loadController?.abort(
            new DOMException('Superseded by a newer character selection', 'AbortError'),
        )
        const generation = (target.loadGeneration ?? 0) + 1
        const controller = new AbortController()
        const externalSignal = callbacks?.signal
        const forwardExternalAbort = () => controller.abort(externalSignal?.reason)
        externalSignal?.addEventListener('abort', forwardExternalAbort, { once: true })
        if (externalSignal?.aborted) forwardExternalAbort()

        target.loadGeneration = generation
        target.loadController = controller
        target.requestedId = id
        target.loading = true
        target.activeProgressCallback = callbacks?.loadProgressCallback
        target.pending = undefined
        target.pendingResolve = undefined

        const isSelected = this.characterSelected === target
        if (target.character && !target.retainedCharacter) {
            if (isSelected) this.characterSelected = undefined
            target.retainedCharacter = target.character
            this.stageCharacterShadows.remove(target.character.object)
            this.scene.remove(target.character.object)
            target.character = undefined
            if (isSelected) this.characterSelected = target
        }

        const loadingTask = startLoadingTask('角色加载', controller.signal)
        let loaderReachedFinish = false
        let lastProgress = ''
        const guardedCallbacks: Partial<LoadCharacterCallbacks> = {
            ...callbacks,
            signal: controller.signal,
            loadProgressCallback: (progress, detail) => {
                lastProgress = progress
                if (
                    target.loadGeneration === generation
                    && !target.removed
                ) callbacks?.loadProgressCallback?.(progress, detail)
            },
            modelLoadedCallback: model => {
                if (
                    target.loadGeneration === generation
                    && !target.removed
                ) callbacks?.modelLoadedCallback?.(model)
            },
            loadFinishCallback: () => {
                loaderReachedFinish = true
            },
        }

        const transaction = (async (): Promise<SceneCharacter> => {
            let loadedCharacter: MagiaExedraCharacter3D | undefined
            let registrationStarted = false
            let committed = false
            const assertCurrent = () => {
                if (controller.signal.aborted || target.removed || target.loadGeneration !== generation) {
                    throw (controller.signal.reason instanceof Error
                        ? controller.signal.reason
                        : new DOMException('Stale character transaction', 'AbortError'))
                }
            }
            try {
                loadedCharacter = await this.characterManager.loadCharacterById(
                    id,
                    guardedCallbacks,
                )
                if (!loaderReachedFinish) {
                    throw new Error(
                        `Character ${targetKey} resolved before loadFinish`,
                    )
                }
                assertCurrent()
                await attachCharacterAngelRing(this, loadedCharacter, controller.signal)
                assertCurrent()

                loadingTask.phase('assembling')
                // Register the replacement before retiring the retained model.
                // A scene/shadow registration failure must still be reversible.
                registrationStarted = true
                this.scene.add(loadedCharacter.object)
                this.stageCharacterShadows.add(loadedCharacter.object)
                assertCurrent()
                target.character = loadedCharacter
                if (this.characterSelected === target) {
                    this.characterSelected = target
                }
                committed = true
                const retained = target.retainedCharacter
                target.retainedCharacter = undefined
                try { retained?.dispose() }
                catch (disposeError) { console.error('Retained character cleanup failed:', disposeError) }
                try {
                    callbacks?.loadFinishCallback?.(loadedCharacter)
                } catch (callbackError) {
                    console.error('Character loadFinish callback failed:', callbackError)
                }
                loadingTask.complete()
                return target
            } catch (error) {
                loadingTask.fail(error)
                // This transaction owns its candidate even after another load
                // takes over the slot, or the user removes the slot entirely.
                if (loadedCharacter && !committed) {
                    if (registrationStarted) {
                        this.stageCharacterShadows.remove(loadedCharacter.object)
                        this.scene.remove(loadedCharacter.object)
                    }
                    if (target.character === loadedCharacter) target.character = undefined
                    if (!loadedCharacter.disposed) loadedCharacter.dispose()
                }
                if (
                    target.loadGeneration === generation
                    && !target.removed
                ) {
                    if (lastProgress !== '') {
                        lastProgress = ''
                        try { callbacks?.loadProgressCallback?.('') }
                        catch (callbackError) { console.error('Character progress cleanup failed:', callbackError) }
                    }
                    const retained = target.retainedCharacter
                    if (retained && !retained.disposed) {
                        target.character = retained
                        target.retainedCharacter = undefined
                        this.scene.add(retained.object)
                        this.stageCharacterShadows.add(retained.object)
                        if (this.characterSelected === target) {
                            this.characterSelected = target
                        }
                    }
                }
                throw error
            } finally {
                externalSignal?.removeEventListener(
                    'abort',
                    forwardExternalAbort,
                )
                if (target.loadGeneration === generation) {
                    target.loading = false
                    target.loadController = undefined
                    target.loadPromise = undefined
                    target.requestedId = undefined
                    target.activeProgressCallback = undefined
                }
            }
        })()
        target.loadPromise = transaction
        return transaction
    }

    async addCharacter(id: number | string, callbacks?: Partial<LoadCharacterCallbacks>) {
        return await this.switchCharacter(undefined, id, callbacks)
    }

    async addNonBattleCharacter(
        stableKey: string,
        callbacks?: Partial<LoadCharacterCallbacks>,
    ) {
        const entry = this.characterManager.getNonBattleCharacterEntryByStableKey(stableKey)
        return await this.switchCharacter(
            undefined,
            entry.style3dCharacterMstId,
            callbacks,
        )
    }

    removeCharacter(sceneCharacter: SceneCharacter) {
        sceneCharacter.removed = true
        sceneCharacter.loadGeneration = (sceneCharacter.loadGeneration ?? 0) + 1
        sceneCharacter.loadController?.abort(
            new DOMException('Character was removed', 'AbortError'),
        )
        try { sceneCharacter.activeProgressCallback?.('') }
        catch (callbackError) { console.error('Character progress cleanup failed:', callbackError) }
        sceneCharacter.activeProgressCallback = undefined
        sceneCharacter.loadController = undefined
        sceneCharacter.loadPromise = undefined
        sceneCharacter.requestedId = undefined
        sceneCharacter.loading = false
        if (sceneCharacter.character) {
            this.stageCharacterShadows.remove(sceneCharacter.character.object)
            this.scene.remove(sceneCharacter.character.object)
            sceneCharacter.character.dispose()
            sceneCharacter.character = undefined
        }
        if (sceneCharacter.retainedCharacter) {
            sceneCharacter.retainedCharacter.dispose()
            sceneCharacter.retainedCharacter = undefined
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
