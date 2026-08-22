import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { fetchAndTryDecompressGzip } from 'magia-exedra-character-three/utils'
import { scene, recoveredFillLight, recoveredHemisphereLight } from './scene'
import { gui } from './controllers/GUI'
import { loadStageCatalogTree } from './stageCatalog'
import officialCameraPresetRuntimeProfiles from './official-camera-presets.generated.json'
import { resolveStageAnchor } from './stageHierarchy'
import { STAGE_CHARACTER_SHADOW_CASTERS_ENABLED } from './stageCharacterShadowBridge'
import type {
    StageFidelityComponentEvidence,
    StageFidelityLayerCounts,
} from './stageFidelity'
import {
    applyStageMaterialBindings,
    type StageMaterialBinding,
} from './stageMaterialBindings'
import {
    applyStageLightmaps,
    loadStageLightmap,
    type StageLightmapApplication,
    type StageLightmapBinding,
    type StageLightmapEncoding,
} from './stageLightmaps'
import {
    loadStageEnvironment,
    type StageEnvironmentEncoding,
} from './stageEnvironment'
import {
    applyStageReflectionProbes,
    type LoadedStageReflectionProbe,
    type StageReflectionProbeApplication,
    type StageReflectionProbeProfile,
    type StageReflectionProbeRendererBinding,
} from './stageReflectionProbes'
import {
    applyStageUv1Companion,
    loadStageUv1Companion,
    type StageUv1Companion,
} from './stageUv1Companion'
import {
    applyReDriveVolumeRuntime,
    resetReDriveVolumeRuntime,
    resolveReDriveBackgroundShaderGlobals,
    type ReDriveVolumeRuntimeProfile,
    type Rgba,
} from './reDriveVolumeRuntime'
import {
    createStageRuntimeController,
    type StageRuntimeController,
    type StageRuntimeProfile,
} from './stageRuntime'
import {
    createStageVolumetricLightBeamController,
    type StageVolumetricLightBeamController,
} from './stageVolumetricLightBeams'
import {
    normalizeStageBundleProvenance,
    validateStageBundleProvenance,
    type StageBundleProvenance,
} from './stageBundleProvenance'
import {
    UNITY_TO_THREE_DIFFUSE_IRRADIANCE,
    unityDiffuseRadianceToThree,
    unityLightColorToLinear,
    unityWorldToViewerVector,
} from './unityLighting'

export type StageCategory = 'research' | 'battle' | 'field' | 'dungeon' | 'gallery' | 'adv'
export type StageAssetType = 'gltf' | 'fbx'

export interface StageAssetDefinition {
    id?: string
    type: StageAssetType
    url: string
    scale?: number
    position?: [number, number, number]
    rotation?: [number, number, number]
}

export interface StageSpawnPoint {
    id: string
    name?: string
    role?: 'ally' | 'enemy' | 'actor' | 'camera-target' | 'generic'
    position: [number, number, number]
    rotation?: [number, number, number]
    scale?: number
}

export interface StageLightProfile {
    name?: string
    type?: 'directional' | 'point' | 'spot'
    /** Legacy loose FBX node-name anchor. */
    anchorNode?: string
    /** Exact serialized Unity hierarchy path; preferred when available. */
    anchorPath?: string
    color: string | Rgba
    intensity: number
    range?: number
    outerAngleDegrees?: number
    innerAngleDegrees?: number
    cullingMask?: number
    /** Unity LightmapBakeType: Mixed=1, Baked=2, Realtime=4. */
    lightmapping?: number
    role?: 'character-key' | 'background'
    position?: [number, number, number]
    target?: [number, number, number]
    castShadow?: boolean
    shadow?: {
        type: 0 | 1 | 2
        strength: number
        bias: number
        normalBias: number
        nearPlane?: number
    }
    /** Serialized UniversalAdditionalLightData; tier values require the active URP asset. */
    additionalLightData?: {
        renderingLayers?: number | null
        lightLayerMask?: number | null
        shadowResolutionTier?: number | null
        softShadowQuality?: number | null
    }
}

export interface StageVolumeColorAdjustmentsProfile {
    active?: boolean
    /** Unity postExposure in EV stops. */
    postExposure?: number
    /** Unity percentage value, normally [-100, 100]. */
    contrast?: number
    colorFilter?: string | Rgba
    /** Unity hueShift in degrees, normally [-180, 180]. */
    hueShift?: number
    /** Unity percentage value, normally [-100, 100]. */
    saturation?: number
}

export interface StageVolumeVignetteProfile {
    active?: boolean
    color?: string | Rgba
    center?: [number, number]
    intensity?: number
    smoothness?: number
    rounded?: boolean
}

export interface StageVolumePostProcessingProfile {
    colorAdjustments?: StageVolumeColorAdjustmentsProfile
    vignette?: StageVolumeVignetteProfile
}

export interface StageRenderProfile {
    /** Source ReDriveVolume or export profile ID. */
    id?: string
    source?: 'ReDriveVolume' | 'exported-prefab' | 'manual-research'
    backgroundColor?: string | Rgba
    backgroundTextureUrl?: string
    environmentTextureUrl?: string
    environmentEncoding?: StageEnvironmentEncoding
    environmentIntensity?: number
    /** Serialized active Unity ReflectionProbe components. */
    reflectionProbes?: StageReflectionProbeProfile[]
    /** Per-Renderer ReflectionProbeUsage and optional probeAnchor. */
    reflectionProbeBindings?: StageReflectionProbeRendererBinding[]
    lightmap?: {
        /** Backwards-compatible single lightmap. */
        textureUrl?: string
        /** Ordered Unity lightmap array addressed by renderer lightmapIndex. */
        textureUrls?: string[]
        /** Backwards-compatible single Unity directionality map. */
        directionalTextureUrl?: string
        /** Ordered Unity directionality maps paired with textureUrls. */
        directionalTextureUrls?: string[]
        bindingsUrl: string
        /** Restores Unity UV1 dropped by the FBX export before lightmap binding. */
        uv1CompanionUrl?: string
        encoding: StageLightmapEncoding
        intensity?: number
    }
    fog?: {
        color: string | Rgba
        near: number
        far: number
        /**
         * Unity background volumes do not always render the character through
         * the same fog pass. Keep the historical behaviour when omitted, but
         * allow recovered gallery profiles to scope fog to stage geometry.
         */
        affectsCharacters?: boolean
    } | null
    ambientLight?: {
        color: string
        intensity: number
    }
    /** Three.js layer used by official background geometry and background-only lights. */
    stageLayer?: number
    directionalLight?: StageLightProfile
    /** Serialized Unity lights; directionalLight remains for procedural presets. */
    lights?: StageLightProfile[]
    renderer?: {
        toneMapping?: 'none' | 'linear' | 'aces'
        exposure?: number
        clearAlpha?: number
    }
    colorFilter?: {
        brightness: number
        contrast: number
        saturation: number
    }
    bloom?: {
        enabled: boolean
        /** Serialized Unity URP Bloom intensity. */
        strength: number
        /** Serialized Unity URP Bloom scatter. */
        radius: number
        /** Serialized gamma-space Unity URP Bloom threshold. */
        threshold: number
        clamp?: number
        maxIterations?: number
        tint?: string | Rgba
    }
    /** Serialized Unity Volume overrides applied to the full composite. */
    postProcessing?: StageVolumePostProcessingProfile
    camera?: {
        /** Optional until the Cinemachine target/follow chain is also resolved. */
        position?: [number, number, number]
        target?: [number, number, number]
        fov?: number
        near?: number
        far?: number
    }
    /**
     * Recovered values retained for shader/Timeline integration. Current scene
     * lighting fields above are applied immediately; these source values remain
     * attached to stageRoot.userData and are not silently approximated.
     */
    reDriveVolume?: ReDriveVolumeRuntimeProfile
}

export interface StageDefinition {
    id: string
    name: string
    category?: StageCategory
    official?: boolean
    assetBundleName?: string
    /** Exact AssetBundle-manifest evidence retained with exported stages. */
    bundleProvenance?: StageBundleProvenance
    type: 'procedural' | 'gltf' | 'fbx' | 'group'
    preset?: 'sky-reference' | 'studio' | 'battle-arena'
    url?: string
    assets?: StageAssetDefinition[]
    scale?: number
    position?: [number, number, number]
    rotation?: [number, number, number]
    spawnPoints?: StageSpawnPoint[]
    materialBindings?: StageMaterialBinding[]
    /** Generated bundle-derived scene/light/material profile loaded at runtime. */
    sceneProfileUrl?: string
    renderProfile?: StageRenderProfile
    runtime?: StageRuntimeProfile
    fidelity?: {
        exact?: boolean
        components?: StageFidelityComponentEvidence
        layers?: {
            source?: StageFidelityLayerCounts
            carrier?: StageFidelityLayerCounts
            runtime?: StageFidelityLayerCounts
        }
        omissions?: string[]
        sourceRevision?: string
        generated?: boolean
    }
    /**
     * Official Exedra stages are normally living scenes rather than static
     * meshes. This field prevents a geometry-only export from being mistaken
     * for a completed scene reconstruction while clip/particle/Timeline
     * evidence is still being recovered.
     */
    dynamic?: {
        expected: boolean
        status: 'recovered' | 'partial' | 'pending' | 'static'
        clipNames?: string[]
        missing?: string[]
        evidence?: string[]
    }
    credit?: string
    evidence?: string[]
}

export interface StageSceneProfilePackage {
    schemaVersion: 1
    stageId?: string
    /** Dedicated dungeon/camera/camera_preset_* bundle joined to this stage. */
    cameraPresetId?: string
    coordinateSpace?: {
        source: 'unity-world'
        viewer: 'assetstudio-fbx-reflect-x'
    }
    renderProfile?: StageRenderProfile
    materialBindings?: StageMaterialBinding[]
    spawnPoints?: StageSpawnPoint[]
    runtime?: StageRuntimeProfile
    sourceRecords?: Record<string, unknown>
}

interface OfficialCameraPresetRuntimeProfile {
    cameraPresetId: string
    lens: {
        fieldOfView: number
        nearClipPlane: number
        farClipPlane: number
    }
}

const officialCameraPresetProfiles = (
    officialCameraPresetRuntimeProfiles.profiles
) as unknown as OfficialCameraPresetRuntimeProfile[]
const officialCameraPresetById = new Map(
    officialCameraPresetProfiles.map(
        profile => [profile.cameraPresetId, profile] as const,
    ),
)

export interface StagePreset {
    id: string
    X: number
    Y: number
    Z: number
    RotateY: number
    Scale: number
    Visible: boolean
}

const builtInStages: StageDefinition[] = [
    { id: 'none', name: '[Research] No 3D stage', category: 'research', official: false, type: 'procedural' },
    { id: 'sky-reference', name: '[Research] Sky lighting reference (procedural)', category: 'research', official: false, type: 'procedural', preset: 'sky-reference' },
    { id: 'studio', name: '[Research] Neutral shader studio', category: 'research', official: false, type: 'procedural', preset: 'studio' },
    { id: 'battle-arena', name: '[Research] Battle arena prototype', category: 'research', official: false, type: 'procedural', preset: 'battle-arena' },
]

const stageSelector = document.getElementById('stage-selector') as HTMLSelectElement
const stageRoot = new THREE.Group()
stageRoot.name = 'Magius3DviewerStageRoot'
scene.backgroundScene.add(stageRoot)
const foregroundStageLightRoot = new THREE.Group()
foregroundStageLightRoot.name = 'Magius3DviewerForegroundStageLightRoot'
scene.scene.add(foregroundStageLightRoot)
let activeStageRuntime: StageRuntimeController | undefined
let activeStageVolumetricLightBeams: StageVolumetricLightBeamController | undefined

const stageFolder = gui.addFolder('3D Stage').close()
const stageActions = {
    PlaceCharactersAtSpawns: () => placeCharactersAtStageSpawns(),
}
const stageRuntimeOptions = {
    SeekSeconds: 0,
    TimeScale: 1,
    Play: () => activeStageRuntime?.play(),
    Pause: () => activeStageRuntime?.pause(),
    Restart: () => {
        stageRuntimeOptions.SeekSeconds = 0
        activeStageRuntime?.seek(0)
        activeStageRuntime?.play()
        stageRuntimeFolder.controllersRecursive()
            .forEach(controller => controller.updateDisplay())
    },
}
const stageOptions: StagePreset & { Reset: () => void } = {
    id: 'sky-reference',
    X: 0,
    Y: 0,
    Z: 0,
    RotateY: 0,
    Scale: 1,
    Visible: true,
    Reset() {
        Object.assign(stageOptions, { X: 0, Y: 0, Z: 0, RotateY: 0, Scale: 1, Visible: true })
        updateStageTransform()
        stageFolder.controllersRecursive().forEach(controller => controller.updateDisplay())
    },
}

stageFolder.add(stageOptions, 'X', -20, 20, 0.01).onChange(updateStageTransform)
stageFolder.add(stageOptions, 'Y', -10, 10, 0.01).onChange(updateStageTransform)
stageFolder.add(stageOptions, 'Z', -20, 20, 0.01).onChange(updateStageTransform)
stageFolder.add(stageOptions, 'RotateY', -180, 180, 0.1).onChange(updateStageTransform)
stageFolder.add(stageOptions, 'Scale', 0.05, 10, 0.01).onChange(updateStageTransform)
stageFolder.add(stageOptions, 'Visible').onChange(updateStageTransform)
stageFolder.add(stageOptions, 'Reset').name('Reset stage transform')
stageFolder.add(stageActions, 'PlaceCharactersAtSpawns').name('Place characters at stage spawns')
const stageRuntimeFolder = stageFolder.addFolder('Stage Runtime').close()
stageRuntimeFolder
    .add(stageRuntimeOptions, 'SeekSeconds', 0, 120, 0.01)
    .name('Seek (seconds)')
    .onChange(value => activeStageRuntime?.seek(value))
stageRuntimeFolder
    .add(stageRuntimeOptions, 'TimeScale', 0, 4, 0.01)
    .name('Time scale')
    .onChange(value => activeStageRuntime?.setTimeScale(value))
stageRuntimeFolder.add(stageRuntimeOptions, 'Play')
stageRuntimeFolder.add(stageRuntimeOptions, 'Pause')
stageRuntimeFolder.add(stageRuntimeOptions, 'Restart')

let definitions = [...builtInStages]
let activeStageObject: THREE.Object3D | undefined
let activeStageDefinition: StageDefinition | undefined
let currentStageId = 'none'
let activeProfileTextures: THREE.Texture[] = []
let activeStageLightmap: StageLightmapApplication | undefined
let activeStageReflectionProbes: StageReflectionProbeApplication | undefined
let stageLoadEpoch = 0
let pendingStageLoad: AbortController | undefined
let activeCharacterKeyLightAnchor: THREE.Object3D | undefined
interface ForegroundStageLightBinding {
    light: THREE.PointLight | THREE.SpotLight | THREE.DirectionalLight
    anchor?: THREE.Object3D
    profile: StageLightProfile
}
let activeForegroundStageLightBindings: ForegroundStageLightBinding[] = []

interface LoadedExternalStage {
    object: THREE.Object3D
    textures: THREE.Texture[]
}

interface LoadedProfileTextures {
    background?: THREE.Texture
    environment?: THREE.Texture
    reflectionProbes?: LoadedStageReflectionProbe[]
    lightmaps?: THREE.Texture[]
    directionalLightmaps?: THREE.Texture[]
    lightmapBindings?: StageLightmapBinding[]
    lightmapIntensity?: number
    lightmapEncoding?: StageLightmapEncoding
    uv1Companion?: StageUv1Companion
    textures: THREE.Texture[]
}

type SceneWithEnvironmentIntensity = THREE.Scene & {
    environmentIntensity?: number
}

const initialSceneState = {
    background: scene.scene.background,
    backgroundSceneBackground: scene.backgroundScene.background,
    environment: scene.scene.environment,
    backgroundSceneEnvironment: scene.backgroundScene.environment,
    environmentIntensity:
        (scene.scene as SceneWithEnvironmentIntensity).environmentIntensity,
    backgroundSceneEnvironmentIntensity:
        (scene.backgroundScene as SceneWithEnvironmentIntensity).environmentIntensity,
    fog: scene.scene.fog,
    backgroundSceneFog: scene.backgroundScene.fog,
    ambientColor: scene.ambientLight.color.clone(),
    ambientIntensity: scene.ambientLight.intensity,
    backgroundAmbientColor: scene.backgroundAmbientLight.color.clone(),
    backgroundAmbientIntensity: scene.backgroundAmbientLight.intensity,
    hemisphereColor: recoveredHemisphereLight.color.clone(),
    hemisphereGroundColor: recoveredHemisphereLight.groundColor.clone(),
    hemisphereIntensity: recoveredHemisphereLight.intensity,
    fillColor: recoveredFillLight.color.clone(),
    fillIntensity: recoveredFillLight.intensity,
    fillPosition: recoveredFillLight.position.clone(),
    fillTarget: recoveredFillLight.target.position.clone(),
    directionalColor: scene.directionalLight.color.clone(),
    directionalIntensity: scene.directionalLight.intensity,
    directionalPosition: scene.directionalLight.position.clone(),
    directionalTarget: scene.directionalLight.target.position.clone(),
    directionalCastShadow: scene.directionalLight.castShadow,
    directionalLayersMask: scene.directionalLight.layers.mask,
    directionalShadowBias: scene.directionalLight.shadow.bias,
    directionalShadowIntensity: scene.directionalLight.shadow.intensity,
    directionalShadowNormalBias: scene.directionalLight.shadow.normalBias,
    directionalShadowNear: scene.directionalLight.shadow.camera.near,
    directionalShadowMapSize: scene.directionalLight.shadow.mapSize.clone(),
    toneMapping: scene.renderer.toneMapping,
    exposure: scene.renderer.toneMappingExposure,
    clearAlpha: scene.renderer.getClearAlpha(),
    colorFilter: scene.getColorFilterCSS(),
    bloomEnabled: scene.effects.bloomPass.enabled,
    bloomStrength: scene.effects.bloomPass.strength,
    bloomRadius: scene.effects.bloomPass.radius,
    bloomThreshold: scene.effects.bloomPass.threshold,
    urpBloomEnabled: scene.effects.urpBloomPass.enabled,
    urpBloomIntensity: scene.effects.urpBloomPass.intensity,
    urpBloomScatter: scene.effects.urpBloomPass.scatter,
    urpBloomThreshold: scene.effects.urpBloomPass.threshold,
    urpBloomClamp: scene.effects.urpBloomPass.clamp,
    urpBloomMaxIterations: scene.effects.urpBloomPass.maxIterations,
    urpBloomTint: scene.effects.urpBloomPass.tint.clone(),
    cameraPosition: scene.camera.position.clone(),
    cameraTarget: scene.controls.target.clone(),
    cameraFov: scene.camera.fov,
    cameraNear: scene.camera.near,
    cameraFar: scene.camera.far,
    cameraLayersMask: scene.camera.layers.mask,
}

export async function setupStageSelector() {
    try {
        const loaded = await loadStageCatalogTree<StageDefinition>(
            './stages/catalog.json',
        )
        const catalog = loaded.root
        for (const error of loaded.errors) {
            console.warn(
                `Could not load stage ${error.kind} ${error.url}: ${error.message}`,
            )
        }
        const catalogStages = loaded.stages.filter((stage, index, all) =>
            all.findIndex(candidate => candidate.id === stage.id) === index
        )
        for (const stage of catalogStages) {
            if (!stage.bundleProvenance) continue
            stage.bundleProvenance = normalizeStageBundleProvenance(
                stage.bundleProvenance,
            )
            validateStageBundleProvenance(
                stage.bundleProvenance,
                stage.assetBundleName,
            )
        }
        definitions = [
            ...builtInStages,
            ...catalogStages.filter(stage =>
                !builtInStages.some(builtIn => builtIn.id === stage.id)
            ),
        ]
        console.log('Loaded stage catalog tree:', {
            version: catalog.version,
            generatedAt: catalog.generatedAt,
            sourceRevision: catalog.sourceRevision,
            catalogs: loaded.catalogCount,
            entries: loaded.entryCount,
            errors: loaded.errors.length,
            total: catalogStages.length,
            official: catalogStages.filter(stage => stage.official).length,
            dynamicRecovered: catalogStages.filter(
                stage => stage.dynamic?.status === 'recovered'
            ).length,
            dynamicPartial: catalogStages.filter(
                stage => stage.dynamic?.status === 'partial'
            ).length,
            dynamicPending: catalogStages.filter(
                stage => stage.dynamic?.status === 'pending'
            ).length,
        })
    } catch (error) {
        console.warn('Could not load external stage catalog:', error)
    }

    stageSelector.replaceChildren(...definitions.map(definition => {
        const option = document.createElement('option')
        option.value = definition.id
        option.textContent = definition.name
        option.dataset.category = definition.category ?? 'research'
        option.dataset.official = definition.official ? 'true' : 'false'
        option.dataset.dynamic = definition.dynamic?.status ?? 'unspecified'
        return option
    }))
    stageSelector.addEventListener('change', () => void loadStageById(stageSelector.value))
    await loadStageById('sky-reference')
}

export async function loadStageById(id: string) {
    const loadEpoch = ++stageLoadEpoch
    const catalogDefinition =
        definitions.find(stage => stage.id === id) ?? builtInStages[0]
    let definition = catalogDefinition
    pendingStageLoad?.abort()
    const loadController = new AbortController()
    pendingStageLoad = loadController
    stageSelector.disabled = true
    let candidateObject: THREE.Object3D | undefined
    let candidateTextures: THREE.Texture[] = []
    let sceneProfilePackage: StageSceneProfilePackage | undefined

    try {
        if (catalogDefinition.sceneProfileUrl) {
            sceneProfilePackage = await loadStageSceneProfilePackage(
                catalogDefinition.sceneProfileUrl,
                catalogDefinition.id,
                loadController.signal,
            )
            assertCurrentStageLoad(loadEpoch, loadController.signal)
            definition = mergeGeneratedStageProfile(
                catalogDefinition,
                sceneProfilePackage,
            )
        }
        let profileTextures: LoadedProfileTextures = { textures: [] }
        if (definition.id !== 'none') {
            if (definition.type === 'procedural') {
                candidateObject = createProceduralStage(
                    definition.preset ?? 'studio',
                )
            } else {
                const loaded = await loadExternalStage(
                    definition,
                    loadController.signal,
                )
                assertCurrentStageLoad(loadEpoch, loadController.signal)
                candidateObject = loaded.object
                candidateTextures.push(...loaded.textures)
            }

            profileTextures = await preloadStageProfileTextures(
                definition.renderProfile,
                loadController.signal,
            )
            assertCurrentStageLoad(loadEpoch, loadController.signal)
            candidateTextures.push(...profileTextures.textures)
        }

        // Every asynchronous operation has completed. Only now replace the
        // currently visible stage, so a failed/superseded load cannot leave the
        // selector pointing at an empty scene.
        clearStageObject()
        restoreSceneProfile()
        if (definition.id === 'none') {
            scene.backgroundSceneEnabled = false
            currentStageId = definition.id
            activeStageDefinition = definition
            stageOptions.id = definition.id
            stageSelector.value = definition.id
            stageRoot.userData.stageDefinition = definition
            stageRoot.userData.bundleProvenance = definition.bundleProvenance ?? null
            stageRoot.userData.stageDynamic = definition.dynamic ?? null
            stageRoot.userData.sceneProfilePackage = sceneProfilePackage ?? null
            stageRoot.userData.cameraPresetId =
                sceneProfilePackage?.cameraPresetId ?? null
            return
        }

        const object = candidateObject!
        prepareStageObject(object, definition.renderProfile?.stageLayer)
        object.name = `Stage:${definition.id}`
        activeStageObject = object
        activeStageDefinition = definition
        stageRoot.add(object)
        activeProfileTextures = candidateTextures
        candidateTextures = []
        candidateObject = undefined
        scene.backgroundSceneEnabled = true
        scene.scene.background = null
        scene.backgroundScene.background = initialSceneState.background

        currentStageId = definition.id
        stageOptions.id = definition.id
        stageSelector.value = definition.id
        stageRoot.userData.stageDefinition = definition
        stageRoot.userData.bundleProvenance = definition.bundleProvenance ?? null
        stageRoot.userData.reDriveVolume = definition.renderProfile?.reDriveVolume ?? null
        stageRoot.userData.spawnPoints = definition.spawnPoints ?? []
        stageRoot.userData.stageRuntime = activeStageRuntime?.getDebugState() ?? null
        stageRoot.userData.stageDynamic = definition.dynamic ?? null
        stageRoot.userData.sceneProfilePackage = sceneProfilePackage ?? null
        stageRoot.userData.cameraPresetId =
            sceneProfilePackage?.cameraPresetId ?? null

        const [x, y, z] = definition.position ?? [0, 0, 0]
        const [rx, ry, rz] = definition.rotation ?? [0, 0, 0]
        Object.assign(stageOptions, {
            X: x,
            Y: y,
            Z: z,
            RotateY: THREE.MathUtils.radToDeg(ry),
            Scale: definition.scale ?? 1,
            Visible: true,
        })
        object.rotation.x = rx
        object.rotation.z = rz
        updateStageTransform()
        if (profileTextures.uv1Companion) {
            if (profileTextures.uv1Companion.stageId !== definition.id) {
                throw new Error(
                    `Stage UV1 companion targets ${profileTextures.uv1Companion.stageId}, `
                    + `not ${definition.id}`,
                )
            }
            const uv1Debug = applyStageUv1Companion(
                object,
                profileTextures.uv1Companion,
                { strict: true },
            )
            object.userData.stageUv1Companion = uv1Debug
            stageRoot.userData.stageUv1Companion = uv1Debug
        }
        if (profileTextures.lightmaps?.length && profileTextures.lightmapBindings) {
            activeStageLightmap = applyStageLightmaps(
                object,
                profileTextures.lightmaps,
                profileTextures.lightmapBindings,
                {
                    intensity: profileTextures.lightmapIntensity ?? 1,
                    directionalLightmaps: profileTextures.directionalLightmaps,
                    encoding: profileTextures.lightmapEncoding,
                },
            )
            const {
                matches,
                dispose: _dispose,
                ...lightmapDebug
            } = activeStageLightmap
            object.userData.stageLightmaps = {
                ...lightmapDebug,
                matchedPaths: matches.map(match => match.rendererHierarchyPath),
            }
            stageRoot.userData.stageLightmaps = object.userData.stageLightmaps
            if (
                activeStageLightmap.unmatchedBindingPaths.length > 0
                || activeStageLightmap.ambiguousBindingPaths.length > 0
                || activeStageLightmap.missingSecondUvPaths.length > 0
                || activeStageLightmap.unsupportedMaterialPaths.length > 0
                || activeStageLightmap.missingLightmapPaths.length > 0
                || activeStageLightmap.missingDirectionalLightmapPaths.length > 0
            ) {
                console.warn(
                    `Stage "${definition.id}" lightmap bindings are incomplete:`,
                    object.userData.stageLightmaps,
                )
            }
        }
        // Decide whether baked Unity lights are already represented only after
        // the lightmap pass has inspected the exported geometry. AssetStudio's
        // FBX export currently drops UV2 on several official stages, so blindly
        // skipping every Baked light leaves those stages almost black. Partial
        // coverage is not sufficient either: unmatched or UV2-less renderers
        // still need the bounded realtime fallback.
        const bakedLightmapsActive = activeStageLightmap != undefined
            && activeStageLightmap.matchedRendererCount > 0
            && activeStageLightmap.matchedRendererCount
                === profileTextures.lightmapBindings?.length
            && activeStageLightmap.unmatchedBindingPaths.length === 0
            && activeStageLightmap.ambiguousBindingPaths.length === 0
            && activeStageLightmap.missingSecondUvPaths.length === 0
            && activeStageLightmap.unsupportedMaterialPaths.length === 0
            && activeStageLightmap.missingLightmapPaths.length === 0
            && activeStageLightmap.missingDirectionalLightmapPaths.length === 0
        if (
            definition.renderProfile?.environmentEncoding === 'unity-bc6h-uf16'
            && profileTextures.environment
            && isCubeTexture(profileTextures.environment)
        ) {
            activeStageReflectionProbes = applyStageReflectionProbes(
                object,
                profileTextures.reflectionProbes ?? [],
                profileTextures.environment,
                definition.renderProfile.environmentIntensity ?? 1,
                definition.renderProfile.reflectionProbeBindings,
            )
            object.userData.stageReflectionProbes =
                activeStageReflectionProbes.getDebugState()
            stageRoot.userData.stageReflectionProbes =
                object.userData.stageReflectionProbes
        }
        applyStageRenderProfile(
            definition.renderProfile,
            object,
            profileTextures,
            bakedLightmapsActive,
        )
        activeStageVolumetricLightBeams = createStageVolumetricLightBeamController(
            object,
            definition.runtime?.volumetricLightBeamConfig,
            definition.runtime?.volumetricLightBeams,
            definition.runtime?.volumetricDustParticles,
            scene.effects,
        )
        stageRoot.userData.stageVolumetricLightBeams =
            activeStageVolumetricLightBeams?.getDebugState() ?? null
        activeStageRuntime = createStageRuntimeController(
            object,
            definition.runtime,
            updateActiveStageDynamicBindings,
            definition.materialBindings ?? [],
            activeProfileTextures,
        )
        if (activeStageRuntime) {
            const debugState = activeStageRuntime.getDebugState()
            stageRuntimeOptions.SeekSeconds = debugState.time
            stageRuntimeOptions.TimeScale = debugState.timeScale
            stageRoot.userData.stageRuntime = debugState
            if (debugState.missingClipNames.length > 0) {
                console.warn(
                    `Stage "${definition.id}" is missing declared clips:`,
                    debugState.missingClipNames,
                )
            }
            console.log('Started official stage runtime:', debugState)
        }
        updateActiveStageDynamicBindings()
        stageFolder.controllersRecursive().forEach(controller => controller.updateDisplay())
    } catch (error) {
        candidateObject && disposeStageObject(candidateObject)
        candidateTextures.forEach(texture => texture.dispose())
        if (
            loadEpoch !== stageLoadEpoch
            || loadController.signal.aborted
            || isAbortError(error)
        ) return
        console.error(`Could not load 3D stage "${definition.name}":`, error)
        stageSelector.value = currentStageId
    } finally {
        if (pendingStageLoad === loadController) pendingStageLoad = undefined
        if (loadEpoch === stageLoadEpoch) stageSelector.disabled = false
    }
}

async function loadStageSceneProfilePackage(
    reference: string,
    expectedStageId: string,
    signal: AbortSignal,
): Promise<StageSceneProfilePackage> {
    const url = new URL(reference, document.baseURI).href
    const response = await fetch(url, { cache: 'no-cache', signal })
    if (!response.ok) {
        throw new Error(`Could not load generated scene profile: ${response.status}`)
    }
    const value = await response.json() as StageSceneProfilePackage
    if (!value || value.schemaVersion !== 1) {
        throw new Error(`Generated scene profile ${url} has unsupported schema`)
    }
    if (value.stageId && value.stageId !== expectedStageId) {
        throw new Error(
            `Generated scene profile targets ${value.stageId}, not ${expectedStageId}`,
        )
    }
    if (
        value.coordinateSpace
        && (
            value.coordinateSpace.source !== 'unity-world'
            || value.coordinateSpace.viewer !== 'assetstudio-fbx-reflect-x'
        )
    ) {
        throw new Error(`Generated scene profile ${url} has unsupported coordinates`)
    }
    return value
}

function mergeGeneratedStageProfile(
    definition: StageDefinition,
    generated: StageSceneProfilePackage,
): StageDefinition {
    const serializedRenderProfile =
        generated.renderProfile ?? definition.renderProfile
    const cameraPreset = resolveOfficialCameraPreset(generated.cameraPresetId)
    const renderProfile = cameraPreset
        ? {
            ...serializedRenderProfile,
            camera: {
                ...serializedRenderProfile?.camera,
                ...cameraPreset,
            },
        }
        : serializedRenderProfile
    return {
        ...definition,
        // Serialized bundle truth owns shader/material fields. Historical
        // carrier entries can still supply animation-only extensions that the
        // general extractor has not emitted yet.
        materialBindings: mergeGeneratedMaterialBindings(
            definition.materialBindings,
            generated.materialBindings,
        ),
        spawnPoints: definition.spawnPoints ?? generated.spawnPoints,
        runtime: mergeGeneratedStageRuntime(definition.runtime, generated.runtime),
        // Lighting, Volume and renderer state are bundle truth and therefore
        // replace historical hand-copied render profiles atomically.
        renderProfile,
    }
}

function resolveOfficialCameraPreset(
    cameraPresetId: string | undefined,
): StageRenderProfile['camera'] | undefined {
    if (!cameraPresetId) return undefined
    const profile = officialCameraPresetById.get(cameraPresetId)
    if (!profile) {
        throw new Error(`Official camera preset ${cameraPresetId} is unavailable`)
    }
    const { fieldOfView, nearClipPlane, farClipPlane } = profile.lens
    if (
        !Number.isFinite(fieldOfView)
        || !Number.isFinite(nearClipPlane)
        || !Number.isFinite(farClipPlane)
        || fieldOfView <= 0
        || nearClipPlane <= 0
        || farClipPlane <= nearClipPlane
    ) {
        throw new Error(`Official camera preset ${cameraPresetId} has an invalid lens`)
    }
    return {
        fov: fieldOfView,
        near: nearClipPlane,
        far: farClipPlane,
    }
}

export function mergeGeneratedStageRuntime(
    authored: StageRuntimeProfile | undefined,
    generated: StageRuntimeProfile | undefined,
): StageRuntimeProfile | undefined {
    if (!generated) return authored
    if (!authored) return generated
    const authoredOwnsPlayback = (authored.clipNames?.length ?? 0) > 0
        || (authored.voiceTracks?.length ?? 0) > 0
    return {
        ...generated,
        ...authored,
        // Bundle serialization owns component records. Authored carrier clips,
        // voice tracks and playback controls remain valid extensions.
        particlePresets: generated.particlePresets ?? authored.particlePresets,
        particleSystems: generated.particleSystems ?? authored.particleSystems,
        volumetricLightBeamConfig:
            generated.volumetricLightBeamConfig
            ?? authored.volumetricLightBeamConfig,
        volumetricLightBeams:
            generated.volumetricLightBeams ?? authored.volumetricLightBeams,
        volumetricDustParticles:
            generated.volumetricDustParticles
            ?? authored.volumetricDustParticles,
        serializedComponentClips:
            generated.serializedComponentClips ?? authored.serializedComponentClips,
        animatorRandomizers:
            generated.animatorRandomizers ?? authored.animatorRandomizers,
        rotators: generated.rotators ?? authored.rotators,
        autoplay: authoredOwnsPlayback
            ? authored.autoplay
            : generated.autoplay ?? authored.autoplay,
        loop: authoredOwnsPlayback
            ? authored.loop
            : generated.loop ?? authored.loop,
        timeScale: authoredOwnsPlayback
            ? authored.timeScale
            : generated.timeScale ?? authored.timeScale,
    }
}

export function mergeGeneratedMaterialBindings(
    authored: StageMaterialBinding[] | undefined,
    generated: StageMaterialBinding[] | undefined,
) {
    if (!generated?.length) return authored
    if (!authored?.length) return generated

    const generatedByName = new Map(
        generated
            .filter(binding => binding.materialName)
            .map(binding => [binding.materialName!, binding]),
    )
    const consumed = new Set<StageMaterialBinding>()
    const merged = authored.map(binding => {
        const official = binding.materialName
            ? generatedByName.get(binding.materialName)
            : undefined
        if (!official) return binding
        consumed.add(official)
        return { ...binding, ...official }
    })
    merged.push(...generated.filter(binding => !consumed.has(binding)))
    return merged
}

function assertCurrentStageLoad(epoch: number, signal: AbortSignal) {
    signal.throwIfAborted()
    if (epoch !== stageLoadEpoch) {
        throw new DOMException('Superseded stage load', 'AbortError')
    }
}

function isAbortError(error: unknown) {
    return error instanceof DOMException && error.name === 'AbortError'
}

export function getCurrentStagePreset(): StagePreset {
    return {
        id: currentStageId,
        X: stageOptions.X,
        Y: stageOptions.Y,
        Z: stageOptions.Z,
        RotateY: stageOptions.RotateY,
        Scale: stageOptions.Scale,
        Visible: stageOptions.Visible,
    }
}

export function getCurrentStageDefinition() {
    return activeStageDefinition
}

export function getCurrentStageSpawnPoints(): StageSpawnPoint[] {
    return activeStageDefinition?.spawnPoints ?? []
}

export function getCurrentStageRuntimeDebugState() {
    return activeStageRuntime?.getDebugState()
}

export function getCurrentStageDebugState() {
    let meshes = 0
    let lights = 0
    const materials = new Set<string>()
    const geometryAttributeSets = new Map<string, number>()
    activeStageObject?.traverse(child => {
        const mesh = child as THREE.Mesh
        if (mesh.isMesh) {
            meshes++
            const attributeSet =
                Object.keys(mesh.geometry.attributes).sort().join(',')
                || '<none>'
            geometryAttributeSets.set(
                attributeSet,
                (geometryAttributeSets.get(attributeSet) ?? 0) + 1,
            )
            const meshMaterials = Array.isArray(mesh.material)
                ? mesh.material
                : [mesh.material]
            meshMaterials.forEach(material => materials.add(material.name))
        }
        if ((child as THREE.Light).isLight) lights++
    })
    return {
        id: currentStageId,
        hasObject: activeStageObject != undefined,
        objectName: activeStageObject?.name,
        meshes,
        geometryAttributeSets:
            Object.fromEntries([...geometryAttributeSets].sort()),
        materials: [...materials].sort(),
        lights,
        animationNames:
            activeStageObject?.animations.map(clip => clip.name) ?? [],
        materialBindings:
            activeStageObject?.userData.stageMaterialBindings ?? null,
        lightmaps:
            activeStageObject?.userData.stageLightmaps ?? null,
        uv1Companion:
            activeStageObject?.userData.stageUv1Companion ?? null,
        officialLights:
            activeStageObject?.userData.stageLights ?? null,
        reflectionProbes:
            activeStageObject?.userData.stageReflectionProbes ?? null,
        sceneProfilePackage:
            stageRoot.userData.sceneProfilePackage ?? null,
        cameraPresetId:
            stageRoot.userData.cameraPresetId ?? null,
        dynamic: activeStageDefinition?.dynamic ?? null,
        runtime: getCurrentStageRuntimeDebugState() ?? null,
        antiAliasing: scene.effects.getAntiAliasingState(),
        preset: getCurrentStagePreset(),
    }
}

export async function applyStagePreset(preset?: Partial<StagePreset>) {
    if (!preset?.id) return
    await loadStageById(preset.id)
    Object.assign(stageOptions, preset)
    updateStageTransform()
    stageFolder.controllersRecursive().forEach(controller => controller.updateDisplay())
}

export function placeCharactersAtStageSpawns() {
    const spawns = getCurrentStageSpawnPoints()
    if (spawns.length === 0) {
        console.warn(`Stage "${currentStageId}" has no exported spawn points`)
        return
    }

    const characters = scene.characters
        .map(entry => entry.character)
        .filter(character => Boolean(character))

    stageRoot.updateWorldMatrix(true, false)
    const worldPosition = new THREE.Vector3()
    const worldRotation = new THREE.Quaternion()
    const stageWorldRotation = stageRoot.getWorldQuaternion(
        new THREE.Quaternion(),
    )
    characters.forEach((character, index) => {
        const spawn = spawns[index % spawns.length]
        const [x, y, z] = spawn.position
        const [rx, ry, rz] = spawn.rotation ?? [0, 0, 0]
        worldPosition.set(x, y, z)
        stageRoot.localToWorld(worldPosition)

        worldRotation
            .setFromEuler(new THREE.Euler(rx, ry, rz))
            .premultiply(stageWorldRotation)

        const parent = character!.object.parent
        if (parent) {
            parent.updateWorldMatrix(true, false)
            parent.worldToLocal(worldPosition)
            const parentWorldRotation = parent.getWorldQuaternion(
                new THREE.Quaternion(),
            )
            character!.object.quaternion.copy(
                parentWorldRotation.invert().multiply(worldRotation),
            )
        } else {
            character!.object.quaternion.copy(worldRotation)
        }
        character!.object.position.copy(worldPosition)

        const previousFactor =
            Number(character!.object.userData.stageSpawnScaleFactor) || 1
        const scaleFactor = (spawn.scale ?? 1) * stageOptions.Scale
        character!.object.scale
            .divideScalar(previousFactor)
            .multiplyScalar(scaleFactor)
        character!.object.userData.stageSpawnScaleFactor = scaleFactor
    })
}

function updateStageTransform() {
    stageRoot.position.set(stageOptions.X, stageOptions.Y, stageOptions.Z)
    stageRoot.rotation.y = THREE.MathUtils.degToRad(stageOptions.RotateY)
    stageRoot.scale.setScalar(stageOptions.Scale)
    stageRoot.visible = stageOptions.Visible
    foregroundStageLightRoot.visible = stageOptions.Visible
    stageRoot.updateWorldMatrix(true, false)
    updateActiveStageDynamicBindings()
}

function clearStageObject() {
    activeStageRuntime?.dispose()
    activeStageRuntime = undefined
    activeStageVolumetricLightBeams?.dispose()
    activeStageVolumetricLightBeams = undefined
    activeStageReflectionProbes?.dispose()
    activeStageReflectionProbes = undefined
    activeStageLightmap?.dispose()
    activeStageLightmap = undefined
    activeCharacterKeyLightAnchor = undefined
    activeForegroundStageLightBindings.forEach(({ light }) => {
        light.shadow.map?.dispose()
        light.shadow.map = null
    })
    activeForegroundStageLightBindings = []
    foregroundStageLightRoot.clear()
    if (activeStageObject) {
        stageRoot.remove(activeStageObject)
        disposeStageObject(activeStageObject)
        activeStageObject = undefined
    }
    activeProfileTextures.forEach(texture => texture.dispose())
    activeProfileTextures = []
    stageRoot.userData.stageDefinition = null
    stageRoot.userData.reDriveVolume = null
    stageRoot.userData.spawnPoints = []
    stageRoot.userData.stageRuntime = null
    stageRoot.userData.stageVolumetricLightBeams = null
    stageRoot.userData.stageDynamic = null
    stageRoot.userData.stageLightmaps = null
    stageRoot.userData.stageUv1Companion = null
    stageRoot.userData.stageReflectionProbes = null
    stageRoot.userData.sceneProfilePackage = null
    stageRoot.userData.cameraPresetId = null
}

function prepareStageObject(object: THREE.Object3D, stageLayer?: number) {
    const maxAnisotropy = scene.renderer.capabilities.getMaxAnisotropy()
    scene.stageCharacterShadows.stageLayer = stageLayer ?? 0
    if (stageLayer != undefined) scene.camera.layers.enable(stageLayer)
    object.traverse(child => {
        if (stageLayer != undefined) child.layers.set(stageLayer)
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.castShadow = mesh.userData.stageCastShadow ?? true
        mesh.receiveShadow = mesh.userData.stageReceiveShadow ?? true
        mesh.frustumCulled = false

        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        materials.forEach(material => {
            material.side = material.side ?? THREE.FrontSide
            const standardMaterial = material as THREE.MeshStandardMaterial
            const colorTextures = [
                standardMaterial.map,
                standardMaterial.emissiveMap,
            ].filter((texture): texture is THREE.Texture => Boolean(texture))
            colorTextures.forEach(texture => {
                texture.colorSpace = THREE.SRGBColorSpace
                texture.anisotropy = maxAnisotropy
                texture.needsUpdate = true
            })
            Object.values(material)
                .filter((value): value is THREE.Texture => value instanceof THREE.Texture)
                .forEach(texture => {
                    texture.anisotropy = maxAnisotropy
                    texture.needsUpdate = true
                })
        })
    })
}

function disposeStageObject(object: THREE.Object3D) {
    const disposedGeometries = new Set<THREE.BufferGeometry>()
    const disposedMaterials = new Set<THREE.Material>()
    const disposedTextures = new Set<THREE.Texture>()
    object.traverse(child => {
        const light = child as THREE.Light & {
            shadow?: THREE.LightShadow<THREE.Camera>
        }
        if (light.isLight) {
            light.shadow?.dispose()
        }

        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) return
        if (mesh.geometry && !disposedGeometries.has(mesh.geometry)) {
            mesh.geometry.dispose()
            disposedGeometries.add(mesh.geometry)
        }
        const skinnedMesh = mesh as THREE.SkinnedMesh
        if (skinnedMesh.isSkinnedMesh && skinnedMesh.skeleton.boneTexture) {
            skinnedMesh.skeleton.boneTexture.dispose()
            skinnedMesh.skeleton.boneTexture = null
        }
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        materials.forEach(material => {
            if (disposedMaterials.has(material)) return
            Object.values(material).forEach(value => {
                if (
                    value instanceof THREE.Texture
                    && !disposedTextures.has(value)
                ) {
                    value.dispose()
                    disposedTextures.add(value)
                }
            })
            material.dispose()
            disposedMaterials.add(material)
        })
        mesh.customDepthMaterial?.dispose()
        mesh.customDistanceMaterial?.dispose()
    })
}

async function loadExternalStage(
    definition: StageDefinition,
    signal: AbortSignal,
): Promise<LoadedExternalStage> {
    let object: THREE.Object3D
    if (definition.type === 'group') {
        if (!definition.assets?.length) throw new Error(`Stage ${definition.id} has no asset parts`)
        const group = new THREE.Group()
        group.name = `StageParts:${definition.id}`
        const parts: THREE.Object3D[] = []
        try {
            // Load one part at a time. Besides making failure ownership
            // deterministic, this bounds the peak FBX/GLTF decode memory for
            // large official multi-part stages.
            for (const asset of definition.assets) {
                signal.throwIfAborted()
                const part = await loadExternalStageAsset(asset, signal)
                signal.throwIfAborted()
                parts.push(part)
                group.add(part)
            }
        } catch (error) {
            parts.forEach(disposeStageObject)
            throw error
        }
        group.animations = parts.flatMap(part => part.animations)
        object = group
    } else {
        if (!definition.url) throw new Error(`Stage ${definition.id} has no URL`)
        object = await loadExternalStageAsset({
            id: definition.id,
            type: definition.type as StageAssetType,
            url: definition.url,
        }, signal)
    }

    try {
        const bindingResult = await applyStageMaterialBindings(
            object,
            definition.materialBindings,
            scene.renderer,
            signal,
            resolveReDriveBackgroundShaderGlobals(
                definition.renderProfile?.reDriveVolume,
            ),
        )
        signal.throwIfAborted()
        return {
            object,
            textures: bindingResult.textures,
        }
    } catch (error) {
        disposeStageObject(object)
        throw error
    }
}

async function loadExternalStageAsset(
    definition: StageAssetDefinition,
    signal: AbortSignal,
): Promise<THREE.Object3D> {
    const url = new URL(definition.url, document.baseURI).href
    const object = definition.type === 'gltf'
        ? await (async () => {
            signal.throwIfAborted()
            const gltf = await new GLTFLoader().loadAsync(url)
            signal.throwIfAborted()
            gltf.scene.animations = gltf.animations
            return gltf.scene
        })()
        : await (async () => {
            const blob = await fetchAndTryDecompressGzip(
                url,
                undefined,
                undefined,
                signal,
            )
            signal.throwIfAborted()
            const arrayBuffer = await blob.arrayBuffer()
            signal.throwIfAborted()
            const resourcePath = new URL('.', url).href
            return new FBXLoader().parse(arrayBuffer, resourcePath)
        })()

    if (definition.id) object.name = definition.id
    const [x, y, z] = definition.position ?? [0, 0, 0]
    const [rx, ry, rz] = definition.rotation ?? [0, 0, 0]
    object.position.set(x, y, z)
    object.rotation.set(rx, ry, rz)
    object.scale.setScalar(definition.scale ?? 1)
    return object
}

async function preloadStageProfileTextures(
    profile: StageRenderProfile | undefined,
    signal: AbortSignal,
): Promise<LoadedProfileTextures> {
    const loaded: LoadedProfileTextures = { textures: [] }
    if (!profile) return loaded

    const load = async (
        url: string,
        kind: 'environment' | 'lightmap' = 'environment',
    ) => {
        signal.throwIfAborted()
        const texture = await new THREE.TextureLoader().loadAsync(
            new URL(url, document.baseURI).href,
        )
        if (signal.aborted) {
            texture.dispose()
            signal.throwIfAborted()
        }
        if (kind === 'environment') {
            texture.mapping = THREE.EquirectangularReflectionMapping
            texture.colorSpace = THREE.SRGBColorSpace
        } else {
            texture.mapping = THREE.UVMapping
            texture.colorSpace = THREE.NoColorSpace
            texture.flipY = false
        }
        texture.needsUpdate = true
        loaded.textures.push(texture)
        return texture
    }

    try {
        if (profile.backgroundTextureUrl) {
            loaded.background = await load(profile.backgroundTextureUrl)
        }
        if (profile.environmentTextureUrl) {
            loaded.environment = await loadStageEnvironment(
                profile.environmentTextureUrl,
                profile.environmentEncoding ?? 'srgb-image',
                scene.renderer,
                signal,
            )
            loaded.textures.push(loaded.environment)
        }
        if (profile.reflectionProbes?.length) {
            loaded.reflectionProbes = []
            for (const probe of profile.reflectionProbes) {
                if (probe.encoding !== 'unity-bc6h-uf16') {
                    throw new Error(
                        `Reflection probe ${probe.id} has unsupported encoding ${probe.encoding}`,
                    )
                }
                const texture = await loadStageEnvironment(
                    probe.textureUrl,
                    probe.encoding,
                    scene.renderer,
                    signal,
                )
                if (!isCubeTexture(texture)) {
                    texture.dispose()
                    throw new Error(`Reflection probe ${probe.id} did not load as a cubemap`)
                }
                loaded.reflectionProbes.push({ profile: probe, texture })
                loaded.textures.push(texture)
            }
        }
        if (profile.lightmap) {
            if (
                profile.lightmap.encoding !== 'unity-rgbm-linear'
                && profile.lightmap.encoding !== 'unity-bc6h-linear'
            ) {
                throw new Error(
                    `Unsupported stage lightmap encoding: ${profile.lightmap.encoding}`,
                )
            }
            const lightmapUrls = profile.lightmap.textureUrls
                ?? (profile.lightmap.textureUrl ? [profile.lightmap.textureUrl] : [])
            if (lightmapUrls.length === 0) {
                throw new Error('Stage lightmap profile has no texture URLs')
            }
            loaded.lightmapEncoding = profile.lightmap.encoding
            loaded.lightmaps = []
            for (const url of lightmapUrls) {
                const texture = await loadStageLightmap(
                    url,
                    profile.lightmap.encoding,
                    scene.renderer,
                    signal,
                )
                loaded.lightmaps.push(texture)
                loaded.textures.push(texture)
            }
            const directionalUrls = profile.lightmap.directionalTextureUrls
                ?? (profile.lightmap.directionalTextureUrl
                    ? [profile.lightmap.directionalTextureUrl]
                    : [])
            if (directionalUrls.length > 0) {
                if (directionalUrls.length !== lightmapUrls.length) {
                    throw new Error(
                        'Stage directional lightmaps do not match the color lightmap count',
                    )
                }
                loaded.directionalLightmaps = []
                for (const url of directionalUrls) {
                    const texture = url.toLowerCase().endsWith('.dds')
                        ? await loadStageLightmap(
                            url,
                            'unity-bc6h-linear',
                            scene.renderer,
                            signal,
                        )
                        : await load(url, 'lightmap')
                    loaded.directionalLightmaps.push(texture)
                    if (!loaded.textures.includes(texture)) {
                        loaded.textures.push(texture)
                    }
                }
            }
            const response = await fetch(
                new URL(profile.lightmap.bindingsUrl, document.baseURI).href,
                { cache: 'no-cache', signal },
            )
            if (!response.ok) {
                throw new Error(
                    `Could not load stage lightmap bindings: ${response.status}`,
                )
            }
            const bindingDocument = await response.json() as {
                renderers?: StageLightmapBinding[]
            }
            if (!Array.isArray(bindingDocument.renderers)) {
                throw new Error('Stage lightmap binding document has no renderers array')
            }
            loaded.lightmapBindings = bindingDocument.renderers
            loaded.lightmapIntensity = profile.lightmap.intensity
            if (profile.lightmap.uv1CompanionUrl) {
                loaded.uv1Companion = await loadStageUv1Companion(
                    profile.lightmap.uv1CompanionUrl,
                    signal,
                )
            }
        }
        return loaded
    } catch (error) {
        loaded.textures.forEach(texture => texture.dispose())
        throw error
    }
}

function applyLightColor(light: THREE.Light, value: string | Rgba) {
    if (Array.isArray(value)) {
        light.color.setRGB(...unityLightColorToLinear(value))
    } else {
        light.color.set(value)
    }
}

function createStageColor(value: string | Rgba) {
    return Array.isArray(value)
        ? new THREE.Color().setRGB(value[0], value[1], value[2])
        : new THREE.Color(value)
}

const keyLightAnchorPosition = new THREE.Vector3()
const keyLightAnchorDirection = new THREE.Vector3()

function updateCharacterKeyLightFromAnchor() {
    if (!activeCharacterKeyLightAnchor) return
    activeCharacterKeyLightAnchor.updateWorldMatrix(true, false)
    activeCharacterKeyLightAnchor.getWorldPosition(keyLightAnchorPosition)
    activeCharacterKeyLightAnchor
        .getWorldDirection(keyLightAnchorDirection)
        .normalize()
    scene.directionalLight.position
        .copy(keyLightAnchorPosition)
        .addScaledVector(keyLightAnchorDirection, -10)
    scene.directionalLight.target.position.copy(keyLightAnchorPosition)
    scene.directionalLight.target.updateMatrixWorld()
}

const foregroundLightPosition = new THREE.Vector3()
const foregroundLightTarget = new THREE.Vector3()
const foregroundLightDirection = new THREE.Vector3()

function updateForegroundStageLightBindings() {
    foregroundStageLightRoot.visible = stageRoot.visible
    stageRoot.updateWorldMatrix(true, false)
    activeForegroundStageLightBindings.forEach(({ light, anchor, profile }) => {
        if (anchor) {
            anchor.updateWorldMatrix(true, false)
            anchor.getWorldPosition(foregroundLightPosition)
            if (light instanceof THREE.PointLight) {
                light.position.copy(foregroundLightPosition)
                return
            }
            anchor.getWorldDirection(foregroundLightDirection).normalize()
            if (light instanceof THREE.DirectionalLight) {
                light.position
                    .copy(foregroundLightPosition)
                    .addScaledVector(foregroundLightDirection, -10)
                light.target.position.copy(foregroundLightPosition)
            } else {
                light.position.copy(foregroundLightPosition)
                light.target.position
                    .copy(foregroundLightPosition)
                    .add(foregroundLightDirection)
            }
            light.target.updateMatrixWorld()
            return
        }

        if (profile.position) {
            foregroundLightPosition.set(...unityWorldToViewerVector(profile.position))
            stageRoot.localToWorld(foregroundLightPosition)
            light.position.copy(foregroundLightPosition)
        }
        if (
            profile.target
            && (light instanceof THREE.SpotLight || light instanceof THREE.DirectionalLight)
        ) {
            foregroundLightTarget.set(...unityWorldToViewerVector(profile.target))
            stageRoot.localToWorld(foregroundLightTarget)
            light.target.position.copy(foregroundLightTarget)
            light.target.updateMatrixWorld()
        }
    })
}

function updateActiveStageDynamicBindings() {
    updateCharacterKeyLightFromAnchor()
    updateForegroundStageLightBindings()
    activeStageReflectionProbes?.update()
    if (activeStageObject && activeStageReflectionProbes) {
        activeStageObject.userData.stageReflectionProbes =
            activeStageReflectionProbes.getDebugState()
        stageRoot.userData.stageReflectionProbes =
            activeStageObject.userData.stageReflectionProbes
    }
    stageRoot.userData.stageRuntime =
        activeStageRuntime?.getDebugState()
        ?? activeStageObject?.userData.stageRuntime
        ?? null
    stageRoot.userData.stageVolumetricLightBeams =
        activeStageVolumetricLightBeams?.getDebugState()
        ?? activeStageObject?.userData.stageVolumetricLightBeams
        ?? null
}

function isCubeTexture(
    texture: THREE.Texture,
): texture is THREE.CubeTexture | THREE.CompressedCubeTexture {
    return 'isCubeTexture' in texture && texture.isCubeTexture === true
}

// Steam JP Unity 2022.3.62f2, active UniversalRenderPipelineAsset (pathID 14160):
// main-light atlas 2048, additional-light atlas 1024, per-light tiers 256/512/1024.
// Stage profiles preserve UniversalAdditionalLightData.shadowResolutionTier, so
// additional lights can select the same tier instead of inheriting one fixed size.
const officialUrpShadowResolution = {
    mainLight: 2048,
    additionalLight: 1024,
    additionalTiers: [256, 512, 1024] as const,
}

function resolveOfficialShadowMapResolution(profile: StageLightProfile) {
    if (profile.type === 'directional' && profile.role === 'character-key') {
        return officialUrpShadowResolution.mainLight
    }

    const tier = profile.additionalLightData?.shadowResolutionTier
    if (
        tier != undefined
        && Number.isInteger(tier)
        && tier >= 0
        && tier < officialUrpShadowResolution.additionalTiers.length
    ) {
        return officialUrpShadowResolution.additionalTiers[tier]
    }
    return officialUrpShadowResolution.additionalLight
}

function configureShadow(light: THREE.Light, profile: StageLightProfile) {
    const shadow = profile.shadow
    light.castShadow = profile.castShadow ?? Boolean(shadow && shadow.type !== 0)
    if (!light.castShadow || !('shadow' in light)) return

    const shadowLight = light as THREE.DirectionalLight | THREE.PointLight | THREE.SpotLight
    shadowLight.shadow.camera.userData[
        STAGE_CHARACTER_SHADOW_CASTERS_ENABLED
    ] = profileAffectsUnityLayer(profile, 0)
    shadowLight.shadow.intensity = THREE.MathUtils.clamp(shadow?.strength ?? 1, 0, 1)
    shadowLight.shadow.bias = -(shadow?.bias ?? 0) * 0.001
    shadowLight.shadow.normalBias = shadow?.normalBias ?? 0
    if (shadow?.nearPlane != undefined) shadowLight.shadow.camera.near = shadow.nearPlane
    const resolution = resolveOfficialShadowMapResolution(profile)
    if (
        shadowLight.shadow.mapSize.x !== resolution
        || shadowLight.shadow.mapSize.y !== resolution
    ) {
        shadowLight.shadow.map?.dispose()
        shadowLight.shadow.map = null
        shadowLight.shadow.mapSize.set(resolution, resolution)
    }
    shadowLight.shadow.camera.updateProjectionMatrix()
}

function profileAffectsUnityLayer(profile: StageLightProfile, layer: number) {
    if (profile.cullingMask == undefined) return true
    return ((profile.cullingMask >>> layer) & 1) === 1
}

function createOfficialLight(
    type: NonNullable<StageLightProfile['type']>,
    profile: StageLightProfile,
    effectiveIntensity: number,
) {
    let light: THREE.PointLight | THREE.SpotLight | THREE.DirectionalLight
    if (type === 'point') {
        light = new THREE.PointLight('#ffffff', effectiveIntensity, profile.range ?? 0)
    } else if (type === 'spot') {
        const outer = profile.outerAngleDegrees ?? 30
        const inner = Math.min(profile.innerAngleDegrees ?? outer, outer)
        light = new THREE.SpotLight(
            '#ffffff',
            effectiveIntensity,
            profile.range ?? 0,
            THREE.MathUtils.degToRad(outer * 0.5),
            THREE.MathUtils.clamp(1 - inner / Math.max(outer, 0.001), 0, 1),
        )
    } else {
        light = new THREE.DirectionalLight('#ffffff', effectiveIntensity)
    }
    applyLightColor(light, profile.color)
    configureShadow(light, profile)
    return light
}

const stageLightProfilePosition = new THREE.Vector3()
const stageLightProfileTarget = new THREE.Vector3()
const stageLightProfileDirection = new THREE.Vector3()

function attachOfficialStageLight(
    light: THREE.PointLight | THREE.SpotLight | THREE.DirectionalLight,
    stageObject: THREE.Object3D,
    profile: StageLightProfile,
    anchor?: THREE.Object3D,
) {
    if (anchor) {
        anchor.add(light)
        if (light instanceof THREE.PointLight) {
            light.position.set(0, 0, 0)
            return
        }
        light.target.name = `${light.name}:Target`
        if (light instanceof THREE.DirectionalLight) {
            // Unity stores a direction in the anchor rotation; its Transform
            // position has no lighting meaning. Three also uses the light
            // position as its shadow-camera origin, so place that camera back
            // along the same +Z direction instead of leaving it inside the
            // character at the common (0, 0, 0) stage anchor.
            light.position.set(0, 0, -10)
            light.target.position.set(0, 0, 0)
        } else {
            light.position.set(0, 0, 0)
            light.target.position.set(0, 0, 1)
        }
        anchor.add(light.target)
        light.target.updateMatrixWorld()
        return
    }

    stageObject.add(light)
    stageLightProfilePosition.set(0, 0, 0)
    if (profile.position) {
        stageLightProfilePosition.set(
            ...unityWorldToViewerVector(profile.position),
        )
    }
    light.position.copy(stageLightProfilePosition)
    if (light instanceof THREE.PointLight) return

    light.target.name = `${light.name}:Target`
    if (profile.target) {
        stageLightProfileTarget.set(...unityWorldToViewerVector(profile.target))
        if (light instanceof THREE.DirectionalLight) {
            stageLightProfileDirection
                .subVectors(stageLightProfileTarget, stageLightProfilePosition)
            if (stageLightProfileDirection.lengthSq() > 1e-12) {
                stageLightProfileDirection.normalize()
                light.position
                    .copy(stageLightProfilePosition)
                    .addScaledVector(stageLightProfileDirection, -10)
                light.target.position.copy(stageLightProfilePosition)
            } else {
                light.target.position.set(0, 0, 1)
            }
        } else {
            light.target.position.copy(stageLightProfileTarget)
        }
    }
    stageObject.add(light.target)
    light.target.updateMatrixWorld()
}

function addForegroundStageLight(
    type: NonNullable<StageLightProfile['type']>,
    profile: StageLightProfile,
    effectiveIntensity: number,
    anchor?: THREE.Object3D,
) {
    const light = createOfficialLight(type, profile, effectiveIntensity)
    light.name = `${profile.name ?? 'OfficialStageLight'}:Foreground`
    light.layers.set(0)
    foregroundStageLightRoot.add(light)
    if (light instanceof THREE.SpotLight || light instanceof THREE.DirectionalLight) {
        light.target.name = `${light.name}:Target`
        foregroundStageLightRoot.add(light.target)
    }
    activeForegroundStageLightBindings.push({ light, anchor, profile })
    return light
}

function effectiveStageLightIntensity(
    profile: StageLightProfile,
    _type: NonNullable<StageLightProfile['type']>,
) {
    return unityDiffuseRadianceToThree(profile.intensity)
}

function applyOfficialStageLights(
    profiles: StageLightProfile[] | undefined,
    stageObject: THREE.Object3D,
    stageLayer?: number,
    bakedLightmapsActive = false,
) {
    if (!profiles?.length) return

    const debugRecords: Array<{
        index: number
        name: string
        type: NonNullable<StageLightProfile['type']>
        role: StageLightProfile['role'] | null
        lightmapping: number | null
        status: 'instantiated' | 'skipped-baked'
        rawIntensity: number
        effectiveIntensity: number
        anchorNode: string | null
        anchorPath: string | null
        anchorResolved: boolean
        instances: number
        cullingMask: number | null
        affectsCharacterLayer: boolean
        affectsStageLayer: boolean
        additionalLightData: StageLightProfile['additionalLightData'] | null
    }> = []
    stageObject.userData.stageLights = {
        bakedLightmapValue: 2,
        bakedLightmapsActive,
        localLightIntensityScale: UNITY_TO_THREE_DIFFUSE_IRRADIANCE,
        localLightIntensityScaleReason:
            'Unity URP diffuse has no 1/pi; Three MeshStandard BRDF_Lambert does',
        sourceColorSpace: 'unity-srgb',
        records: debugRecords,
    }

    profiles.forEach((profile, index) => {
        const type = profile.type ?? 'directional'
        const anchor = resolveStageAnchor(stageObject, profile)
        const effectiveIntensity = effectiveStageLightIntensity(profile, type)
        const affectsCharacterLayer = profileAffectsUnityLayer(profile, 0)
        const affectsStageLayer = stageLayer == undefined
            || profileAffectsUnityLayer(profile, stageLayer)
        const debugBase = {
            index,
            name: profile.name ?? `OfficialStageLight:${index}`,
            type,
            role: profile.role ?? null,
            lightmapping: profile.lightmapping ?? null,
            rawIntensity: profile.intensity,
            effectiveIntensity,
            cullingMask: profile.cullingMask ?? null,
            affectsCharacterLayer,
            affectsStageLayer,
            additionalLightData: profile.additionalLightData ?? null,
            anchorNode: profile.anchorNode ?? null,
            anchorPath: profile.anchorPath ?? null,
            anchorResolved:
                (profile.anchorPath == undefined && profile.anchorNode == undefined)
                || anchor != undefined,
        }

        // Baked lights are already represented by the recovered lightmap.
        // Instantiating them again double-counts their contribution and was the
        // primary cause of the white/grey veil in bright official stages.
        if (profile.lightmapping === 2 && bakedLightmapsActive) {
            debugRecords.push({
                ...debugBase,
                status: 'skipped-baked',
                instances: 0,
            })
            return
        }

        if (type === 'directional' && profile.role === 'character-key') {
            const light = scene.directionalLight
            light.name = profile.name ?? light.name
            applyLightColor(light, profile.color)
            light.intensity = effectiveIntensity
            configureShadow(light, profile)

            if (anchor) {
                activeCharacterKeyLightAnchor = anchor
                updateCharacterKeyLightFromAnchor()
            } else {
                activeCharacterKeyLightAnchor = undefined
                if (profile.position) {
                    light.position.set(...unityWorldToViewerVector(profile.position))
                }
                if (profile.target) {
                    light.target.position.set(...unityWorldToViewerVector(profile.target))
                }
            }
            light.layers.set(0)
            light.target.updateMatrixWorld()

            // Unity's MainLight reaches both characters and the stage. A
            // separate instance is required because the background scene is a
            // distinct render pass used to enforce the original culling masks.
            if (affectsStageLayer) {
                const stageLight = createOfficialLight(
                    type,
                    profile,
                    effectiveIntensity,
                ) as THREE.DirectionalLight
                stageLight.name = `${profile.name ?? 'MainLight'}:Background`
                if (stageLayer != undefined) stageLight.layers.set(stageLayer)
                attachOfficialStageLight(stageLight, stageObject, profile, anchor)
            }
            debugRecords.push({
                ...debugBase,
                status: 'instantiated',
                instances: 1 + Number(affectsStageLayer),
            })
            return
        }

        if (affectsStageLayer) {
            const light = createOfficialLight(type, profile, effectiveIntensity)
            light.name = profile.name ?? `OfficialStageLight:${index}`
            if (stageLayer != undefined) light.layers.set(stageLayer)

            attachOfficialStageLight(light, stageObject, profile, anchor)
        }
        if (affectsCharacterLayer) {
            addForegroundStageLight(type, profile, effectiveIntensity, anchor)
        }
        debugRecords.push({
            ...debugBase,
            status: 'instantiated',
            instances: Number(affectsStageLayer) + Number(affectsCharacterLayer),
        })
    })
}

function applyStageRenderProfile(
    profile?: StageRenderProfile,
    stageObject?: THREE.Object3D,
    loadedTextures: LoadedProfileTextures = { textures: [] },
    bakedLightmapsActive = false,
) {
    if (!profile) return

    if (profile.backgroundColor) {
        scene.backgroundScene.background =
            createStageColor(profile.backgroundColor)
        scene.scene.background = null
    }
    if (loadedTextures.background) {
        scene.backgroundScene.background = loadedTextures.background
        scene.scene.background = null
    }
    if (loadedTextures.environment) {
        scene.scene.environment = loadedTextures.environment
        scene.backgroundScene.environment = loadedTextures.environment
    }
    if (profile.environmentIntensity != undefined) {
        ;(scene.scene as SceneWithEnvironmentIntensity).environmentIntensity =
            profile.environmentIntensity
        ;(scene.backgroundScene as SceneWithEnvironmentIntensity).environmentIntensity =
            profile.environmentIntensity
    }

    if (profile.fog === null) {
        scene.scene.fog = null
        scene.backgroundScene.fog = null
    } else if (profile.fog) {
        const fogColor = createStageColor(profile.fog.color)
        scene.backgroundScene.fog =
            new THREE.Fog(fogColor, profile.fog.near, profile.fog.far)
        scene.scene.fog = profile.fog.affectsCharacters === false
            ? null
            : new THREE.Fog(fogColor, profile.fog.near, profile.fog.far)
    }

    // ReDrive owns global SH/character/background state. Apply it before the
    // explicit scene profile so a reset cannot erase recovered ambient/light
    // values from the same generated bundle package.
    applyReDriveVolumeRuntime(profile.reDriveVolume, {
        backgroundShaderGlobalsApplied:
            stageObject?.userData.stageMaterialBindings
                ?.backgroundShaderGlobalsApplied === true,
    })

    if (profile.ambientLight) {
        scene.ambientLight.color.set(profile.ambientLight.color)
        scene.ambientLight.intensity = profile.ambientLight.intensity
        scene.backgroundAmbientLight.color.set(profile.ambientLight.color)
        scene.backgroundAmbientLight.intensity = profile.ambientLight.intensity
    }
    if (profile.directionalLight) {
        applyLightColor(scene.directionalLight, profile.directionalLight.color)
        scene.directionalLight.intensity = profile.directionalLight.intensity
        if (profile.directionalLight.position) {
            scene.directionalLight.position.set(
                ...unityWorldToViewerVector(profile.directionalLight.position),
            )
        }
        if (profile.directionalLight.target) {
            scene.directionalLight.target.position.set(
                ...unityWorldToViewerVector(profile.directionalLight.target),
            )
            scene.directionalLight.target.updateMatrixWorld()
        }
        if (profile.directionalLight.castShadow != undefined) {
            scene.directionalLight.castShadow = profile.directionalLight.castShadow
        }
    }
    if (stageObject) {
        applyOfficialStageLights(
            profile.lights,
            stageObject,
            profile.stageLayer,
            bakedLightmapsActive,
        )
    }

    const unityAces = profile.source === 'ReDriveVolume'
        && profile.renderer?.toneMapping === 'aces'
    if (profile.renderer?.toneMapping) {
        scene.renderer.toneMapping = {
            none: THREE.NoToneMapping,
            linear: THREE.LinearToneMapping,
            aces: unityAces
                ? THREE.NoToneMapping
                : THREE.ACESFilmicToneMapping,
        }[profile.renderer.toneMapping]
    }
    if (profile.renderer?.exposure != undefined) {
        scene.renderer.toneMappingExposure = profile.renderer.exposure
    }
    if (profile.renderer?.clearAlpha != undefined) {
        scene.renderer.setClearAlpha(profile.renderer.clearAlpha)
    }
    // ReDriveVolume bg ColorAdjustments are background-only in the
    // official renderer. The historical CSS filter affects characters too and
    // would double-grade recovered scene profiles, so retain it only for manual
    // research/procedural presets.
    if (profile.source === 'ReDriveVolume') {
        scene.setColorFilter({ brightness: 1, contrast: 1, saturation: 1 })
    } else if (profile.colorFilter) {
        scene.setColorFilter(profile.colorFilter)
    }
    if (profile.bloom) {
        if (profile.source === 'ReDriveVolume') {
            // Recovered volumes use the dedicated Unity 2022.3 URP operator;
            // never reinterpret these serialized values as UnrealBloom units.
            scene.effects.bloomPass.enabled = false
            const pass = scene.effects.urpBloomPass
            pass.enabled = profile.bloom.enabled
            pass.intensity = profile.bloom.strength
            pass.scatter = profile.bloom.radius
            pass.threshold = profile.bloom.threshold
            pass.clamp = profile.bloom.clamp ?? 65472
            pass.maxIterations = profile.bloom.maxIterations ?? 6
            setVolumePassColor(pass.tint, profile.bloom.tint, '#ffffff')
        } else {
            // Manual research stages already store UnrealBloomPass units.
            scene.effects.urpBloomPass.enabled = false
            scene.effects.bloomPass.enabled = profile.bloom.enabled
            scene.effects.bloomPass.strength = profile.bloom.strength
            scene.effects.bloomPass.radius = profile.bloom.radius
            scene.effects.bloomPass.threshold = profile.bloom.threshold
        }
    }
    applyStageVolumePostProcessing(
        resolveStageVolumePostProcessing(profile),
        unityAces ? 'aces' : 'none',
    )
    if (profile.camera) {
        if (profile.camera.position) {
            scene.camera.position.set(...profile.camera.position)
        }
        if (profile.camera.target) {
            scene.controls.target.set(...profile.camera.target)
        }
        if (profile.camera.fov != undefined) scene.camera.fov = profile.camera.fov
        if (profile.camera.near != undefined) scene.camera.near = profile.camera.near
        if (profile.camera.far != undefined) scene.camera.far = profile.camera.far
        scene.camera.updateProjectionMatrix()
        scene.controls.update()
    }
}

function setVolumePassColor(
    target: THREE.Color,
    value: string | Rgba | undefined,
    fallback: string,
) {
    if (Array.isArray(value)) {
        target.setRGB(value[0], value[1], value[2])
    } else {
        target.set(value ?? fallback)
    }
}

function applyStageVolumePostProcessing(
    profile: StageVolumePostProcessingProfile | undefined,
    toneMapping: 'none' | 'aces' = 'none',
) {
    const pass = scene.effects.volumePostProcessPass
    const colorAdjustments = profile?.colorAdjustments
    const vignette = profile?.vignette
    const colorAdjustEnabled = Boolean(
        colorAdjustments && colorAdjustments.active !== false,
    )
    const vignetteEnabled = Boolean(
        vignette
        && vignette.active !== false
        && (vignette.intensity ?? 0) > 0,
    )

    pass.enabled = colorAdjustEnabled || vignetteEnabled || toneMapping === 'aces'
    pass.uniforms.uToneMappingMode.value = toneMapping === 'aces' ? 1 : 0
    pass.uniforms.uColorAdjustEnabled.value = colorAdjustEnabled ? 1 : 0
    pass.uniforms.uPostExposure.value = colorAdjustEnabled
        ? colorAdjustments?.postExposure ?? 0
        : 0
    pass.uniforms.uContrast.value = colorAdjustEnabled
        ? colorAdjustments?.contrast ?? 0
        : 0
    pass.uniforms.uSaturation.value = colorAdjustEnabled
        ? colorAdjustments?.saturation ?? 0
        : 0
    pass.uniforms.uHueShift.value = colorAdjustEnabled
        ? colorAdjustments?.hueShift ?? 0
        : 0
    setVolumePassColor(
        pass.uniforms.uColorFilter.value,
        colorAdjustEnabled ? colorAdjustments?.colorFilter : undefined,
        '#ffffff',
    )

    pass.uniforms.uVignetteEnabled.value = vignetteEnabled ? 1 : 0
    setVolumePassColor(
        pass.uniforms.uVignetteColor.value,
        vignetteEnabled ? vignette?.color : undefined,
        '#000000',
    )
    pass.uniforms.uVignetteCenter.value.set(
        ...(vignetteEnabled && vignette?.center
            ? vignette.center
            : [0.5, 0.5] as [number, number]),
    )
    pass.uniforms.uVignetteIntensity.value = vignetteEnabled
        ? THREE.MathUtils.clamp(vignette?.intensity ?? 0, 0, 1)
        : 0
    pass.uniforms.uVignetteSmoothness.value = vignetteEnabled
        ? THREE.MathUtils.clamp(vignette?.smoothness ?? 0.2, 0, 1)
        : 0.2
    pass.uniforms.uVignetteRounded.value =
        vignetteEnabled && vignette?.rounded ? 1 : 0
    const drawingBufferSize = scene.renderer.getDrawingBufferSize(
        new THREE.Vector2(),
    )
    pass.uniforms.uVignetteAspectRatio.value = drawingBufferSize.x
        / Math.max(drawingBufferSize.y, 1)

    scene.scene.userData.stageVolumePostProcessing = pass.enabled
        ? {
            colorAdjustments: colorAdjustEnabled
                ? { ...colorAdjustments }
                : null,
            vignette: vignetteEnabled ? { ...vignette } : null,
            toneMapping,
        }
        : null
}

/**
 * Older recovered catalog entries store the official URP ColorAdjustments
 * values in the historical CSS-shaped `colorFilter` field. ReDriveVolume
 * profiles must apply those values to the complete composite (stage and
 * characters), while the separate `_BgColorAdjustments` pass remains scoped
 * to background geometry.
 *
 * The conversion is unit-preserving:
 *   brightness scalar -> postExposure EV
 *   contrast scalar   -> Unity percentage
 *   saturation scalar -> Unity percentage
 *
 * Explicit serialized post-processing always wins. If an entry already has a
 * vignette but no ColorAdjustments, retain the vignette and fill only the
 * missing component from the recovered catalog values.
 */
function resolveStageVolumePostProcessing(
    profile: StageRenderProfile,
): StageVolumePostProcessingProfile | undefined {
    const explicit = profile.postProcessing
    const recovered = profile.source === 'ReDriveVolume'
        ? profile.colorFilter
        : undefined

    if (!recovered || explicit?.colorAdjustments) return explicit

    return {
        ...explicit,
        colorAdjustments: {
            active: true,
            postExposure: Math.log2(Math.max(recovered.brightness, 1e-6)),
            contrast: (recovered.contrast - 1) * 100,
            saturation: (recovered.saturation - 1) * 100,
        },
    }
}

function restoreSceneProfile() {
    resetReDriveVolumeRuntime()
    scene.scene.background = initialSceneState.background
    scene.backgroundScene.background =
        initialSceneState.backgroundSceneBackground
    scene.scene.environment = initialSceneState.environment
    scene.backgroundScene.environment =
        initialSceneState.backgroundSceneEnvironment
    ;(scene.scene as SceneWithEnvironmentIntensity).environmentIntensity =
        initialSceneState.environmentIntensity
    ;(scene.backgroundScene as SceneWithEnvironmentIntensity).environmentIntensity =
        initialSceneState.backgroundSceneEnvironmentIntensity
    scene.scene.fog = initialSceneState.fog
    scene.backgroundScene.fog = initialSceneState.backgroundSceneFog
    scene.ambientLight.color.copy(initialSceneState.ambientColor)
    scene.ambientLight.intensity = initialSceneState.ambientIntensity
    scene.backgroundAmbientLight.color.copy(
        initialSceneState.backgroundAmbientColor,
    )
    scene.backgroundAmbientLight.intensity =
        initialSceneState.backgroundAmbientIntensity
    recoveredHemisphereLight.color.copy(initialSceneState.hemisphereColor)
    recoveredHemisphereLight.groundColor.copy(
        initialSceneState.hemisphereGroundColor,
    )
    recoveredHemisphereLight.intensity = initialSceneState.hemisphereIntensity
    recoveredFillLight.color.copy(initialSceneState.fillColor)
    recoveredFillLight.intensity = initialSceneState.fillIntensity
    recoveredFillLight.position.copy(initialSceneState.fillPosition)
    recoveredFillLight.target.position.copy(initialSceneState.fillTarget)
    recoveredFillLight.target.updateMatrixWorld()
    scene.directionalLight.color.copy(initialSceneState.directionalColor)
    scene.directionalLight.intensity = initialSceneState.directionalIntensity
    scene.directionalLight.position.copy(initialSceneState.directionalPosition)
    scene.directionalLight.target.position.copy(initialSceneState.directionalTarget)
    scene.directionalLight.castShadow = initialSceneState.directionalCastShadow
    scene.directionalLight.layers.mask = initialSceneState.directionalLayersMask
    scene.directionalLight.shadow.bias = initialSceneState.directionalShadowBias
    scene.directionalLight.shadow.intensity = initialSceneState.directionalShadowIntensity
    scene.directionalLight.shadow.normalBias =
        initialSceneState.directionalShadowNormalBias
    scene.directionalLight.shadow.camera.near =
        initialSceneState.directionalShadowNear
    if (
        !scene.directionalLight.shadow.mapSize.equals(
            initialSceneState.directionalShadowMapSize,
        )
    ) {
        scene.directionalLight.shadow.map?.dispose()
        scene.directionalLight.shadow.map = null
        scene.directionalLight.shadow.mapSize.copy(
            initialSceneState.directionalShadowMapSize,
        )
    }
    scene.directionalLight.shadow.camera.updateProjectionMatrix()
    scene.directionalLight.target.updateMatrixWorld()
    scene.renderer.toneMapping = initialSceneState.toneMapping
    scene.renderer.toneMappingExposure = initialSceneState.exposure
    scene.renderer.setClearAlpha(initialSceneState.clearAlpha)
    scene.renderer.domElement.style.filter = initialSceneState.colorFilter
    scene.effects.bloomPass.enabled = initialSceneState.bloomEnabled
    scene.effects.bloomPass.strength = initialSceneState.bloomStrength
    scene.effects.bloomPass.radius = initialSceneState.bloomRadius
    scene.effects.bloomPass.threshold = initialSceneState.bloomThreshold
    scene.effects.urpBloomPass.enabled = initialSceneState.urpBloomEnabled
    scene.effects.urpBloomPass.intensity = initialSceneState.urpBloomIntensity
    scene.effects.urpBloomPass.scatter = initialSceneState.urpBloomScatter
    scene.effects.urpBloomPass.threshold = initialSceneState.urpBloomThreshold
    scene.effects.urpBloomPass.clamp = initialSceneState.urpBloomClamp
    scene.effects.urpBloomPass.maxIterations = initialSceneState.urpBloomMaxIterations
    scene.effects.urpBloomPass.tint.copy(initialSceneState.urpBloomTint)
    applyStageVolumePostProcessing(undefined)
    scene.camera.position.copy(initialSceneState.cameraPosition)
    scene.controls.target.copy(initialSceneState.cameraTarget)
    scene.camera.fov = initialSceneState.cameraFov
    scene.camera.near = initialSceneState.cameraNear
    scene.camera.far = initialSceneState.cameraFar
    scene.camera.layers.mask = initialSceneState.cameraLayersMask
    scene.stageCharacterShadows.stageLayer = 0
    scene.camera.updateProjectionMatrix()
    scene.controls.update()
}

function createProceduralStage(preset: NonNullable<StageDefinition['preset']>): THREE.Group {
    if (preset === 'sky-reference') return createSkyReferenceStage()
    if (preset === 'battle-arena') return createBattleArenaStage()
    return createStudioStage()
}

function createSkyReferenceStage() {
    const group = new THREE.Group()
    const sky = new THREE.Mesh(
        new THREE.SphereGeometry(35, 48, 24),
        new THREE.ShaderMaterial({
            side: THREE.BackSide,
            depthWrite: false,
            vertexShader: /* glsl */ `
                varying vec3 vSkyPosition;
                void main() {
                    vSkyPosition = position;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */ `
                varying vec3 vSkyPosition;
                void main() {
                    vec3 direction = normalize(vSkyPosition);
                    float height = direction.y * 0.5 + 0.5;
                    vec3 horizon = vec3(0.60, 0.75, 0.98);
                    vec3 zenith = vec3(0.16, 0.43, 0.90);
                    vec3 color = mix(horizon, zenith, smoothstep(0.25, 0.95, height));
                    float cloudNoise = sin(direction.x * 13.0 + direction.z * 5.0) * sin(direction.z * 9.0 - direction.x * 3.0);
                    float clouds = smoothstep(0.48, 0.82, cloudNoise * 0.5 + 0.5);
                    clouds *= smoothstep(0.35, 0.70, height) * (1.0 - smoothstep(0.82, 1.0, height));
                    color = mix(color, vec3(0.92, 0.95, 1.0), clouds * 0.22);
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
        }),
    )
    sky.renderOrder = -100
    group.add(sky)

    const floor = new THREE.Mesh(
        new THREE.CircleGeometry(9, 96),
        new THREE.MeshToonMaterial({ color: '#cfdbf3', transparent: true, opacity: 0.72, side: THREE.DoubleSide }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.015
    floor.receiveShadow = true
    group.add(floor)

    const ring = new THREE.Mesh(
        new THREE.RingGeometry(3.8, 4.05, 96),
        new THREE.MeshBasicMaterial({ color: '#f3d7e8', transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.006
    group.add(ring)
    return group
}

function createStudioStage() {
    const group = new THREE.Group()
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(24, 24),
        new THREE.MeshStandardMaterial({ color: '#777985', roughness: 0.92 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    group.add(floor)

    const backdrop = new THREE.Mesh(
        new THREE.PlaneGeometry(24, 12),
        new THREE.MeshStandardMaterial({ color: '#a8a9b1', roughness: 1 }),
    )
    backdrop.position.set(0, 6, -7)
    backdrop.receiveShadow = true
    group.add(backdrop)
    return group
}

function createBattleArenaStage() {
    const group = new THREE.Group()
    const floor = new THREE.Mesh(
        new THREE.CylinderGeometry(5.5, 5.9, 0.32, 64),
        new THREE.MeshStandardMaterial({ color: '#35394c', roughness: 0.78, metalness: 0.08 }),
    )
    floor.position.y = -0.18
    floor.receiveShadow = true
    group.add(floor)

    for (let index = 0; index < 3; index++) {
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(1.6 + index * 1.2, 1.68 + index * 1.2, 64),
            new THREE.MeshBasicMaterial({
                color: index % 2 === 0 ? '#8fa9ff' : '#f0a6cf',
                transparent: true,
                opacity: 0.58,
                side: THREE.DoubleSide,
            }),
        )
        ring.rotation.x = -Math.PI / 2
        ring.position.y = 0.005
        group.add(ring)
    }
    return group
}

Object.assign(window, {
    loadStageById,
    getCurrentStagePreset,
    getCurrentStageDefinition,
    getCurrentStageSpawnPoints,
    getCurrentStageRuntimeDebugState,
    getCurrentStageDebugState,
    applyStagePreset,
    placeCharactersAtStageSpawns,
})
