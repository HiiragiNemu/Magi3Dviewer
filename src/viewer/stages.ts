import { getLoadingTask, startLoadingTask, readLoadingResponse, yieldLoadingFrame } from '../../magia-exedra-character-three/loadingProgress.ts'
import * as THREE from 'three'
import { enableRigidStageCulling } from './stageRigidCulling'
import { loadNativeImageBackground, validateNativeImageBackground, type NativeImageBackground } from './stageNativeImage'
import { batchStaticStageMeshes, hasStageRuntimeMeshWriters } from './stageStaticBatching'
import { applyStageNativeVisibility, type StageNativeVisibilityProfile } from './stageNativeVisibility'
import { captureStageFields, captureStageRecord, captureStageUniforms } from './stageCommitState'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { fetchAndTryDecompressGzip } from 'magia-exedra-character-three/utils'
import { scene, recoveredFillLight, recoveredHemisphereLight } from './scene'
import { gui } from './controllers/GUI'
import { loadStageCatalogTree } from './stageCatalog'
import {
    resolveCachedRuntimeAssetUrl,
    resolvePageAssetUrl,
    resolveRuntimeAssetUrl,
} from './runtimeProductDelivery'
import { getUiLocale } from './localization/zhCN'
import {
    getStageSceneNameRecord,
    loadStageSceneNameIndex,
    resolveStageSceneDisplayName,
    type StageSceneNameIndex,
} from './stageSceneLocalization'
import officialCameraPresetRuntimeProfiles from './official-camera-presets.generated.json'
import { resolveStageCameraPresetId } from './stageCameraPresetRouting'
import { withBundledStageTransformAnimations } from './stageTransformAnimationCatalog'
import { resolveStageAnchor } from './stageHierarchy'
import { STAGE_CHARACTER_SHADOW_CASTERS_ENABLED } from './stageCharacterShadowBridge'
import {
    StageMainLightCascadeController,
    resolveOfficialMainShadowDistance,
    resolveOfficialUrpDirectionalShadowPlan,
    resolveOfficialUrpDirectionalCascadeBias,
    resolveStageShadowQualityProfile,
    type StageMainLightCascadeOptions,
    type StageShadowQuality,
} from './stageMainLightCascades'
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
    hasCompleteActiveStageLightmapCoverage,
    loadStageLightmap,
    matchStageLightmapBindings,
    type StageLightmapApplication,
    type StageLightmapBinding,
    type StageLightmapEncoding,
} from './stageLightmaps'
import {
    convertStageEnvironmentToCubemap,
    disposeStageEnvironmentTexture,
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
    captureReDriveVolumeRuntime,
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
    /** Serialized GameObject active-in-hierarchy state. */
    active?: boolean
    /** Serialized Light GameObject.m_IsActive, independent of parent phase. */
    activeSelf?: boolean
    /** Serialized Light.m_Enabled state. */
    enabled?: boolean
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

export interface StageVolumeChromaticAberrationProfile {
    active?: boolean
    /** Serialized URP intensity in [0, 1]; UberPost multiplies by 0.05. */
    intensity: number
    operator?: 'urp-2022.3-fast-3-sample'
    amountScale?: 0.05
}

export interface StageVolumeFilmGrainProfile {
    active?: boolean
    /** Serialized FilmGrainLookup enum (0..9 presets, 10 custom). */
    type: number
    lookupName?: string
    textureUrl: string
    /** Serialized URP intensity in [0, 1]; PostProcessUtils multiplies by 4. */
    intensity: number
    response: number
    intensityScale?: 4
    sampler?: {
        filter: 'linear'
        wrapU: 'repeat'
        wrapV: 'repeat'
    }
}

export interface StageVolumePostProcessingProfile {
    chromaticAberration?: StageVolumeChromaticAberrationProfile
    colorAdjustments?: StageVolumeColorAdjustmentsProfile
    filmGrain?: StageVolumeFilmGrainProfile
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
    /** Stable MasterData join key from getDioramaBackgroundMstList. */
    dioramaBackgroundMstId?: number
    /** Official scene resource key used by the AssetBundle path. */
    backgroundResourceName?: string
    /** Exact AssetBundle-manifest evidence retained with exported stages. */
    bundleProvenance?: StageBundleProvenance
    type: 'procedural' | 'gltf' | 'fbx' | 'group' | 'image'
    /** Verified pure native Sprite backgrounds have no missing 3D geometry. */
    nativeImage?: NativeImageBackground
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
    nativeVisibility?: StageNativeVisibilityProfile
    /** Verified load/draw and resource delivery, independent of full effect fidelity. */
    entryValidation?: {
        status: 'load-tested'
        visibleMeshCount: number
        resourceFileCount: number
        evidence: string[]
    }
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
            | 'product-presentation' | 'absent'
        clipNames?: string[]
        missing?: string[]
        evidence?: string[]
    }
    product?: {
        fullyResolved?: boolean
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
    nativeVisibility?: StageNativeVisibilityProfile
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
    {
        id: 'face-shadow-qa',
        name: '[QA] Face-shadow neutral lighting studio',
        category: 'research',
        official: false,
        type: 'procedural',
        preset: 'studio',
        renderProfile: {
            source: 'manual-research',
            backgroundColor: '#6f7480',
            fog: null,
            ambientLight: { color: '#ffffff', intensity: 0.42 },
            directionalLight: {
                name: 'FaceShadowKey',
                type: 'directional',
                color: '#fff6e8',
                intensity: 1.25,
                position: [4, 8, 6],
                target: [0, 1, 0],
                castShadow: true,
                role: 'character-key',
                shadow: { type: 2, strength: 0.82, bias: 0.0005, normalBias: 0.02, nearPlane: 0.1 },
            },
            renderer: { toneMapping: 'aces', exposure: 1 },
            colorFilter: { brightness: 1, contrast: 1, saturation: 1 },
            bloom: { enabled: false, strength: 0, radius: 0, threshold: 1 },
            camera: { position: [0, 1.7, 5.2], target: [0, 1.1, 0], fov: 32, near: 0.05, far: 100 },
        },
    },
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
let stageSceneNameIndex: StageSceneNameIndex | undefined
let stageSceneNameError: string | null = null
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
let activeStageMainLightCascades: StageMainLightCascadeController | undefined
let activeStageMainLightCascadeOptions: StageMainLightCascadeOptions | undefined
let stageShadowQuality: StageShadowQuality = 'official'
let stageLoadEpoch = 0
let pendingStageLoad: AbortController | undefined
let lastStageLoadFailure: {
    requestedStageId: string
    checkpoint: string
    message: string
} | undefined
export type StageVisibleContentClassification =
    | 'formal-scene'
    | 'native-2d-background'
    | 'product-presentation'
    | 'incomplete-product'
    | 'empty-geometry'

export interface StageVisibleContentSnapshot {
    stageId: string
    classification: StageVisibleContentClassification
    accepted: boolean
    reason: string
    meshCount: number
    visibleMeshCount: number
    drawableMeshCount: number
    materialSlotCount: number
    mappedMaterialSlotCount: number
    bounds: {
        min: [number, number, number]
        max: [number, number, number]
        size: [number, number, number]
        center: [number, number, number]
    } | null
    cameraFrustumMeshCount: number
    drawnMeshCount: number
    drawProbeFrames: number
    drawProbeComplete: boolean
    dynamicStatus: NonNullable<StageDefinition['dynamic']>['status'] | null
    markerEvidence: string[]
    materials: string[]
    geometryAttributeSets: Record<string, number>
    lightCount: number
    animationNames: string[]
}

interface StageVisibleContentInspection {
    snapshot: StageVisibleContentSnapshot
    meshes: THREE.Mesh[]
}

let activeStageVisibleContent: StageVisibleContentSnapshot | undefined
let lastCandidateVisibleContent: StageVisibleContentSnapshot | undefined
let cancelActiveStageDrawProbe: (() => void) | undefined
let activeCharacterKeyLightAnchor: THREE.Object3D | undefined
let activeCharacterKeyLightBaseVisible = true
interface ForegroundStageLightBinding {
    light: THREE.PointLight | THREE.SpotLight | THREE.DirectionalLight
    anchor?: THREE.Object3D
    profile: StageLightProfile
}
let activeForegroundStageLightBindings: ForegroundStageLightBinding[] = []

scene.addBeforeRenderCallback(() => activeStageMainLightCascades?.update())

export type { StageShadowQuality } from './stageMainLightCascades'

export const STAGE_SHADOW_QUALITY_CHANGE_EVENT =
    'magius:stage-shadow-quality-change' as const

export interface StageShadowQualityState {
    quality: StageShadowQuality
    active: boolean
    officialDefaultsActive: boolean
    cascadeCount: number
    cascadeMapSize: number
    cascadeSplits: number[]
}

export function getStageShadowQuality(): StageShadowQuality {
    return stageShadowQuality
}

export function getStageShadowQualityState(): StageShadowQualityState {
    const active = activeStageMainLightCascades?.getDebugState()
    const selected = resolveStageShadowQualityProfile(stageShadowQuality)
    return {
        quality: stageShadowQuality,
        active: active != undefined,
        officialDefaultsActive: stageShadowQuality === 'official',
        cascadeCount: active?.cascadeCount ?? selected.cascadeCount,
        cascadeMapSize: active?.cascadeMapSize ?? selected.cascadeMapSize,
        cascadeSplits: [
            ...(active?.cascadeSplits ?? selected.cascadeSplits),
        ],
    }
}

/**
 * Session-only opt-in quality switch. Startup always begins at `official`;
 * no localStorage or scene-profile field persists a lower budget.
 */
export function setStageShadowQuality(quality: StageShadowQuality): void {
    resolveStageShadowQualityProfile(quality)
    if (quality === stageShadowQuality) return

    const previousQuality = stageShadowQuality
    const options = activeStageMainLightCascadeOptions
    if (!options) {
        stageShadowQuality = quality
        dispatchStageShadowQualityChange()
        return
    }

    activeStageMainLightCascades?.dispose()
    activeStageMainLightCascades = undefined
    stageShadowQuality = quality
    try {
        activeStageMainLightCascades = createStageMainLightCascades(options)
    } catch (error) {
        stageShadowQuality = previousQuality
        try {
            activeStageMainLightCascades = createStageMainLightCascades(options)
            publishStageMainLightCascadeDebugState()
        } catch (rollbackError) {
            activeStageMainLightCascadeOptions = undefined
            throw new AggregateError(
                [error, rollbackError],
                'Stage shadow quality switch and rollback both failed',
            )
        }
        throw error
    }
    publishStageMainLightCascadeDebugState()
    dispatchStageShadowQualityChange()
}

function createStageMainLightCascades(
    options: StageMainLightCascadeOptions,
) {
    return new StageMainLightCascadeController({
        ...options,
        quality: stageShadowQuality,
    })
}

function installStageMainLightCascades(
    options: StageMainLightCascadeOptions,
) {
    activeStageMainLightCascades?.dispose()
    activeStageMainLightCascades = undefined
    activeStageMainLightCascadeOptions = options
    try {
        activeStageMainLightCascades = createStageMainLightCascades(options)
    } catch (error) {
        activeStageMainLightCascadeOptions = undefined
        throw error
    }
    publishStageMainLightCascadeDebugState()
}

function publishStageMainLightCascadeDebugState() {
    const debug = activeStageMainLightCascades?.getDebugState() ?? null
    const stageObject = activeStageMainLightCascadeOptions?.stageObject
    if (stageObject) stageObject.userData.stageMainLightCascades = debug
    stageRoot.userData.stageMainLightCascades = debug
}

function dispatchStageShadowQualityChange() {
    if (typeof document === 'undefined') return
    document.dispatchEvent(new CustomEvent(STAGE_SHADOW_QUALITY_CHANGE_EVENT, {
        detail: getStageShadowQualityState(),
    }))
}

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
    filmGrain?: THREE.Texture
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

function attachStageSceneMetadata(definition: StageDefinition) {
    const record = getStageSceneNameRecord(stageSceneNameIndex, definition.id)
    if (!record) return definition
    const recordDioramaBackgroundMstId = record.dioramaBackgroundMstId
    return {
        ...definition,
        ...(definition.dioramaBackgroundMstId === undefined
            && typeof recordDioramaBackgroundMstId === 'number'
            && Number.isFinite(recordDioramaBackgroundMstId)
            ? { dioramaBackgroundMstId: recordDioramaBackgroundMstId }
            : {}),
        backgroundResourceName:
            definition.backgroundResourceName ?? record.backgroundResourceName,
    }
}

function stageDisplayName(definition: StageDefinition) {
    return resolveStageSceneDisplayName(
        getStageSceneNameRecord(stageSceneNameIndex, definition.id),
        getUiLocale(),
        definition.name,
    )
}

function createStageSelectorOption(definition: StageDefinition) {
    const option = document.createElement('option')
    const record = getStageSceneNameRecord(stageSceneNameIndex, definition.id)
    option.value = definition.id
    option.textContent = stageDisplayName(definition)
    option.dataset.category = definition.category ?? 'research'
    option.dataset.official = definition.official ? 'true' : 'false'
    option.dataset.dynamic = definition.dynamic?.status ?? 'unspecified'
    option.dataset.i18nIgnore = 'true'
    option.dataset.nameEn = record?.names.en.value || definition.name
    option.dataset.nameJa = record?.names.ja.value || definition.name
    option.dataset.searchText = [definition.id, definition.name, definition.backgroundResourceName,
        record?.names.en.value, record?.names.ja.value, record?.names.zhHant.value].filter(Boolean).join(' ')
    if (definition.type === 'image') {
        try {
            validateNativeImageBackground(definition)
            option.textContent += getUiLocale() === 'en' ? ' · 2D background' : ' · 2D 背景'
            option.dataset.availability = 'native-2d-background'
            option.title = getUiLocale() === 'zh-CN' ? '原生二维图片背景，完整保留比例；不是三维场景。' : 'Original 2D image, full aspect preserved; not a 3D scene.'
        } catch {
            option.disabled = true
            option.title = 'Native image identity is unverified.'
        }
    }
    // A tested drawable carrier may be entered while fidelity work continues.
    // Do not equate entry readiness with recovered animation/effects, or enable
    // untested, empty and presentation-only carriers merely because a URL exists.
    const entry = definition.entryValidation
    const loadTested = definition.type === 'fbx' && !!definition.url
        && entry?.status === 'load-tested'
        && Number.isInteger(entry.visibleMeshCount) && entry.visibleMeshCount > 0
        && Number.isInteger(entry.resourceFileCount) && entry.resourceFileCount > 0
        && Array.isArray(entry.evidence) && entry.evidence.length > 0
        && entry.evidence.every(value => typeof value === 'string' && value.length > 0)
    if (
        definition.official
        && ((definition.dynamic?.status === 'partial' && !loadTested)
            || definition.dynamic?.status === 'pending'
            || definition.dynamic?.status === 'absent')
    ) {
        option.disabled = true
        option.title = 'Scene package is still incomplete; choose a recovered scene.'
    }
    if (loadTested && definition.dynamic?.status === 'partial') {
        option.dataset.availability = 'load-tested-partial'
        option.title = getUiLocale() === 'zh-CN'
            ? '场景可进入；部分效果仍在恢复中。'
            : getUiLocale() === 'ja-JP'
                ? 'シーンは読み込み確認済みです。一部のエフェクトは復元中です。'
                : 'Scene loading verified; some effects are still being restored.'
    }
    if (definition.dynamic?.status === 'product-presentation') {
        const reason = getUiLocale() === 'zh-CN' ? '真实场景待恢复' : 'Scene content awaiting restoration'
        option.disabled = true
        option.dataset.availability = 'restoration-pending'
        option.title = reason
        option.textContent += ` · ${reason}`
    }
    if (record) {
        if (
            typeof record.dioramaBackgroundMstId === 'number'
            && Number.isFinite(record.dioramaBackgroundMstId)
        ) {
            option.dataset.dioramaBackgroundMstId = String(record.dioramaBackgroundMstId)
        }
        option.dataset.backgroundResourceName = record.backgroundResourceName
    }
    return option
}

function refreshStageSelectorLabels() {
    for (const option of stageSelector.options) {
        const definition = definitions.find(stage => stage.id === option.value)
        if (definition) {
            const updated = createStageSelectorOption(definition)
            option.textContent = updated.textContent
            option.title = updated.title
            option.disabled = updated.disabled
            Object.assign(option.dataset, updated.dataset)
        }
    }
}

document.addEventListener('magius:localechange', refreshStageSelectorLabels)

let stageSelectorInitialization: Promise<void> | undefined
/** One initialization barrier owns catalog population AND the initial scene.
 * Project imports can await it before validating an entry. They must not race
 * a later default-sky load or install a duplicate change handler. */
export function setupStageSelector(): Promise<void> {
    return stageSelectorInitialization ??= initializeStageSelector()
}

async function initializeStageSelector() {
    try {
        stageSceneNameIndex = await loadStageSceneNameIndex()
        stageSceneNameError = null
    } catch (error) {
        stageSceneNameIndex = undefined
        stageSceneNameError = error instanceof Error ? error.message : String(error)
        console.warn('Could not load official stage names:', error)
    }

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
        const stageDefinitionQuality = (stage: StageDefinition) => {
            let score = 0
            if (stage.sceneProfileUrl) score += 4
            if (stage.dynamic?.status === 'recovered') score += 4
            if (stage.product?.fullyResolved) score += 2
            if (stage.url?.includes('-animated.')) score += 1
            if (stage.dynamic?.status === 'partial') score -= 2
            if (stage.dynamic?.status === 'pending') score -= 4
            return score
        }
        const catalogStages = [...loaded.stages]
            .sort((left, right) => stageDefinitionQuality(right) - stageDefinitionQuality(left))
            .filter((stage, index, all) =>
                all.findIndex(candidate => candidate.id === stage.id) === index
            )
            .map(attachStageSceneMetadata)
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

    stageSelector.replaceChildren(...definitions.map(createStageSelectorOption))
    stageSelector.addEventListener('change', () => void loadStageById(stageSelector.value))
    await loadStageById('sky-reference')
}

function isEffectivelyVisible(object: THREE.Object3D, root: THREE.Object3D) {
    let cursor: THREE.Object3D | null = object
    while (cursor) {
        if (!cursor.visible) return false
        if (cursor === root) return true
        cursor = cursor.parent
    }
    return false
}

function materialHasRenderableMap(material: THREE.Material) {
    if (Object.values(material).some(value => value instanceof THREE.Texture)) return true
    const uniforms = (material as THREE.ShaderMaterial).uniforms
    return uniforms != undefined && Object.values(uniforms).some(uniform =>
        uniform?.value instanceof THREE.Texture)
}

function inspectStageVisibleContent(
    definition: StageDefinition,
    object: THREE.Object3D,
): StageVisibleContentInspection {
    const meshes: THREE.Mesh[] = []
    const materials = new Set<string>()
    const geometryAttributeSets = new Map<string, number>()
    let visibleMeshCount = 0
    let drawableMeshCount = 0
    let materialSlotCount = 0
    let mappedMaterialSlotCount = 0
    let lightCount = 0

    object.updateWorldMatrix(true, true)
    object.traverse(child => {
        const mesh = child as THREE.Mesh
        if (mesh.isMesh) {
            meshes.push(mesh)
            const visible = isEffectivelyVisible(mesh, object) && mesh.layers.mask !== 0
            if (visible) visibleMeshCount++
            const attributeSet = Object.keys(mesh.geometry.attributes).sort().join(',')
                || '<none>'
            geometryAttributeSets.set(
                attributeSet,
                (geometryAttributeSets.get(attributeSet) ?? 0) + 1,
            )
            const meshMaterials = Array.isArray(mesh.material)
                ? mesh.material
                : [mesh.material]
            materialSlotCount += meshMaterials.length
            mappedMaterialSlotCount += meshMaterials.filter(materialHasRenderableMap).length
            meshMaterials.forEach(material => materials.add(material.name))
            const positionCount = mesh.geometry.getAttribute('position')?.count ?? 0
            const hasVisibleMaterial = meshMaterials.some(material =>
                material.visible && (!(material as THREE.Material & { opacity?: number }).transparent
                    || (material as THREE.Material & { opacity?: number }).opacity !== 0))
            if (visible && positionCount > 0 && hasVisibleMaterial) drawableMeshCount++
        }
        if ((child as THREE.Light).isLight) lightCount++
    })

    const markerEvidence = definition.dynamic?.evidence?.filter(value =>
        /marker|presentation/i.test(value)) ?? []
    const productPresentation = definition.dynamic?.status === 'product-presentation'
        || markerEvidence.length > 0
    const incompleteProduct = Boolean(
        definition.official
        && definition.type !== 'procedural'
        && definition.dynamic?.status === 'pending'
        && !definition.sceneProfileUrl
        && !(definition.materialBindings?.length)
        && materialSlotCount > 0
        && mappedMaterialSlotCount === 0,
    )
    const nativeImage = definition.type === 'image' && object.userData.nativeImageBackground?.id === definition.id
        && object.userData.nativeImageBackground?.sha256 === definition.nativeImage?.sha256
    const classification: StageVisibleContentClassification = nativeImage
        ? 'native-2d-background'
        : productPresentation
        ? 'product-presentation'
        : meshes.length === 0
            ? 'empty-geometry'
            : incompleteProduct
                ? 'incomplete-product'
                : 'formal-scene'
    const reason = {
        'native-2d-background': 'verified original 2D Sprite displayed as a screen-space background, not 3D geometry',
        'product-presentation': 'catalog identifies a marker/product-presentation, not formal scene content',
        'empty-geometry': 'loaded candidate contains no mesh geometry',
        'incomplete-product': 'official geometry is present but material/profile closure is pending',
        'formal-scene': drawableMeshCount > 0 && visibleMeshCount > 0
            ? 'candidate has formal drawable scene content'
            : 'formal scene candidate has no visible drawable mesh',
    }[classification]
    const bounds = meshes.length > 0 ? new THREE.Box3().setFromObject(object) : null
    const size = bounds?.getSize(new THREE.Vector3())
    const center = bounds?.getCenter(new THREE.Vector3())
    const snapshot: StageVisibleContentSnapshot = {
        stageId: definition.id,
        classification,
        accepted: (classification === 'formal-scene' || classification === 'native-2d-background')
            && drawableMeshCount > 0
            && visibleMeshCount > 0,
        reason,
        meshCount: meshes.length,
        visibleMeshCount,
        drawableMeshCount,
        materialSlotCount,
        mappedMaterialSlotCount,
        bounds: bounds && size && center ? {
            min: bounds.min.toArray(),
            max: bounds.max.toArray(),
            size: size.toArray(),
            center: center.toArray(),
        } : null,
        cameraFrustumMeshCount: 0,
        drawnMeshCount: 0,
        drawProbeFrames: 0,
        drawProbeComplete: false,
        dynamicStatus: definition.dynamic?.status ?? null,
        markerEvidence,
        materials: [...materials].sort(),
        geometryAttributeSets: Object.fromEntries([...geometryAttributeSets].sort()),
        lightCount,
        animationNames: object.animations.map(clip => clip.name),
    }
    return { snapshot, meshes }
}

function updateStageCameraEvidence(inspection: StageVisibleContentInspection) {
    if (inspection.snapshot.classification === 'native-2d-background') {
        inspection.snapshot.cameraFrustumMeshCount = 1
        inspection.snapshot.bounds = null
        return
    }
    scene.camera.updateMatrixWorld(true)
    const projectionView = new THREE.Matrix4().multiplyMatrices(
        scene.camera.projectionMatrix,
        scene.camera.matrixWorldInverse,
    )
    const frustum = new THREE.Frustum().setFromProjectionMatrix(projectionView)
    inspection.snapshot.cameraFrustumMeshCount = inspection.meshes.filter(mesh =>
        isEffectivelyVisible(mesh, activeStageObject ?? mesh)
        && mesh.layers.test(scene.camera.layers)
        && frustum.intersectsObject(mesh)).length
    if (activeStageObject) {
        const bounds = new THREE.Box3().setFromObject(activeStageObject)
        const size = bounds.getSize(new THREE.Vector3())
        const center = bounds.getCenter(new THREE.Vector3())
        inspection.snapshot.bounds = {
            min: bounds.min.toArray(),
            max: bounds.max.toArray(),
            size: size.toArray(),
            center: center.toArray(),
        }
    }
}

function armBoundedStageDrawProbe(inspection: StageVisibleContentInspection) {
    cancelActiveStageDrawProbe?.()
    const { snapshot, meshes } = inspection
    const drawHits = new Set<string>()
    const restorers = meshes.map(mesh => {
        const original = mesh.onBeforeRender
        mesh.onBeforeRender = function (renderer, renderedScene, camera, geometry, material, group) {
            drawHits.add(mesh.uuid)
            snapshot.drawnMeshCount = drawHits.size
            original.call(this, renderer, renderedScene, camera, geometry, material, group)
        }
        return () => {
            if (mesh.onBeforeRender !== original) mesh.onBeforeRender = original
        }
    })
    let frameHandle = 0
    let stopped = false
    const stop = () => {
        if (stopped) return
        stopped = true
        if (frameHandle) cancelAnimationFrame(frameHandle)
        restorers.forEach(restore => restore())
        snapshot.drawProbeComplete = true
        cancelActiveStageDrawProbe = undefined
    }
    const nextFrame = () => {
        snapshot.drawProbeFrames++
        if (snapshot.drawProbeFrames >= 2) stop()
        else frameHandle = requestAnimationFrame(nextFrame)
    }
    frameHandle = requestAnimationFrame(nextFrame)
    cancelActiveStageDrawProbe = stop
}

export async function loadStageById(id: string) {
    const loadEpoch = ++stageLoadEpoch
    const catalogDefinition =
        definitions.find(stage => stage.id === id) ?? builtInStages[0]
    let definition = catalogDefinition
    let loadCheckpoint = 'catalog-resolved'
    pendingStageLoad?.abort()
    const loadController = new AbortController()
    pendingStageLoad = loadController
    const loadingTask = startLoadingTask('场景加载', loadController.signal, 'stage')
    const reportStageLoadProgress = (text: string, fileName?: string) => {
        if (loadEpoch !== stageLoadEpoch || loadController.signal.aborted) return
        loadingTask.phase('assembling', fileName, text)
    }
    stageSelector.disabled = true
    let stageCommit: ReturnType<typeof createStageCommitTransaction> | undefined
    let candidateObject: THREE.Object3D | undefined
    let candidateTextures: THREE.Texture[] = []
    let candidateLightmap: StageLightmapApplication | undefined
    let candidateReflectionProbes: StageReflectionProbeApplication | undefined
    let candidateVisibleContent: StageVisibleContentInspection | undefined
    let sceneProfilePackage: StageSceneProfilePackage | undefined
    let resolvedCameraPresetId = resolveStageCameraPresetId(
        catalogDefinition.id,
        undefined,
        officialCameraPresetById,
    )

    try {
        reportStageLoadProgress(`Loading stage...`, catalogDefinition.id)
        if (catalogDefinition.sceneProfileUrl) {
            reportStageLoadProgress('Loading scene profile...', catalogDefinition.sceneProfileUrl.split('/').pop())
            sceneProfilePackage = await loadStageSceneProfilePackage(
                catalogDefinition.sceneProfileUrl,
                catalogDefinition.id,
                loadController.signal,
            )
            assertCurrentStageLoad(loadEpoch, loadController.signal)
            loadCheckpoint = 'scene-profile-loaded'
            resolvedCameraPresetId = resolveStageCameraPresetId(
                catalogDefinition.id,
                sceneProfilePackage.cameraPresetId,
                officialCameraPresetById,
            )
            definition = mergeGeneratedStageProfile(
                catalogDefinition,
                sceneProfilePackage,
            )
        } else {
            definition = applyOfficialCameraPreset(
                catalogDefinition,
                resolvedCameraPresetId,
            )
        }
        let profileTextures: LoadedProfileTextures = { textures: [] }
        if (definition.id !== 'none') {
            if (definition.type === 'procedural') {
                reportStageLoadProgress('Building procedural stage...', definition.id)
                candidateObject = createProceduralStage(
                    definition.preset ?? 'studio',
                )
            } else {
                reportStageLoadProgress('Loading stage model...', definition.url?.split('/').pop())
                const loaded = await loadExternalStage(
                    definition,
                    loadController.signal,
                )
                candidateObject = loaded.object
                candidateTextures.push(...loaded.textures)
                assertCurrentStageLoad(loadEpoch, loadController.signal)
                loadCheckpoint = 'external-stage-loaded'
            }

            profileTextures = await preloadStageProfileTextures(
                definition.renderProfile,
                loadController.signal,
            )
            candidateTextures.push(...profileTextures.textures)
            assertCurrentStageLoad(loadEpoch, loadController.signal)
            loadCheckpoint = 'profile-textures-loaded'
            const object = candidateObject!
            const nativeLightmapRootTransform = object.userData.stageSerializedRootTransform ?? {
                position: object.position.toArray(),
                rotation: object.quaternion.toArray(),
                scale: object.scale.toArray(),
            }
            object.name = `Stage:${definition.id}`
            prepareStageObject(object, definition.renderProfile?.stageLayer)
            object.userData.stageNativeVisibility =
                applyStageNativeVisibility(object, definition.nativeVisibility)?.debug ?? null
            reportStageLoadProgress('Checking stage content...', definition.id)
            candidateVisibleContent = inspectStageVisibleContent(definition, candidateObject!)
            lastCandidateVisibleContent = candidateVisibleContent.snapshot
            loadCheckpoint = 'visible-content-inspected'
            if (!candidateVisibleContent.snapshot.accepted) {
                throw new Error(
                    `Stage visible-content gate rejected ${definition.id}: `
                    + `${candidateVisibleContent.snapshot.classification}; `
                    + candidateVisibleContent.snapshot.reason,
                )
            }

            // Validate/mutate only candidate-owned geometry and materials. A
            // detached carrier supplies the prospective world transform without
            // moving the visible scene, lights, camera, or shader globals.
            const candidateCarrier = new THREE.Group()
            candidateCarrier.position.set(...(definition.position ?? [0, 0, 0]))
            candidateCarrier.rotation.y = definition.rotation?.[1] ?? 0
            candidateCarrier.scale.setScalar(definition.scale ?? 1)
            object.rotation.x = definition.rotation?.[0] ?? 0
            object.rotation.z = definition.rotation?.[2] ?? 0
            candidateCarrier.add(object)
            candidateCarrier.updateWorldMatrix(true, true)
            if (profileTextures.uv1Companion) {
                if (profileTextures.uv1Companion.stageId !== definition.id) {
                    throw new Error(
                        `Stage UV1 companion targets ${profileTextures.uv1Companion.stageId}, `
                        + `not ${definition.id}`,
                    )
                }
                loadCheckpoint = 'applying-uv1-companion'
                const activeLightmapRendererPaths =
                    profileTextures.lightmapBindings == undefined
                        ? undefined
                        : matchStageLightmapBindings(
                            object,
                            profileTextures.lightmapBindings,
                            { nativeRootTransform: nativeLightmapRootTransform },
                        ).matches.map(match => match.rendererHierarchyPath)
                const uv1Debug = applyStageUv1Companion(
                    object,
                    profileTextures.uv1Companion,
                    {
                        strict: true,
                        requiredRuntimePaths: activeLightmapRendererPaths,
                    },
                )
                object.userData.stageUv1Companion = uv1Debug
                loadCheckpoint = 'uv1-companion-applied'
            }
            if (profileTextures.lightmaps?.length && profileTextures.lightmapBindings) {
                loadCheckpoint = 'applying-lightmaps'
                candidateLightmap = applyStageLightmaps(
                    object,
                    profileTextures.lightmaps,
                    profileTextures.lightmapBindings,
                    {
                        intensity: profileTextures.lightmapIntensity ?? 1,
                        directionalLightmaps: profileTextures.directionalLightmaps,
                        encoding: profileTextures.lightmapEncoding,
                        nativeRootTransform: nativeLightmapRootTransform,
                    },
                )
                const {
                    matches,
                    dispose: _dispose,
                    ...lightmapDebug
                } = candidateLightmap
                object.userData.stageLightmaps = {
                    ...lightmapDebug,
                    matchedPaths: matches.map(match => match.rendererHierarchyPath),
                }
                loadCheckpoint = 'lightmaps-applied'
                if (!hasCompleteActiveStageLightmapCoverage(candidateLightmap)) {
                    console.warn(
                        `Stage "${definition.id}" active lightmap bindings are incomplete:`,
                        object.userData.stageLightmaps,
                    )
                }
            }
            const reflectionRenderProfile = definition.renderProfile
            if (
                reflectionRenderProfile
                && profileTextures.environment
                && isCubeTexture(profileTextures.environment)
            ) {
                candidateReflectionProbes = applyStageReflectionProbes(
                    object,
                    profileTextures.reflectionProbes ?? [],
                    profileTextures.environment,
                    reflectionRenderProfile.environmentIntensity ?? 1,
                    reflectionRenderProfile.reflectionProbeBindings,
                )
                object.userData.stageReflectionProbes =
                    candidateReflectionProbes.getDebugState()
            }

            // Exact-state batching excludes runtime source-object writers, not
            // separately owned particles or declarations. Retain the
            // original hierarchy and collision triangles; only submissions share.
            const batching = batchStaticStageMeshes(object, {
                hasRuntimeOrTransformWriter: hasStageRuntimeMeshWriters(definition.runtime, true),
                transformAnimations: definition.runtime?.transformAnimations,
            })
            object.userData.stageStaticBatching = batching.stats
            candidateVisibleContent.meshes.push(...batching.meshes)
            loadCheckpoint = 'candidate-bindings-prepared'
        }

        // Preserve the prior live resources and exact global state until every
        // global consumer has accepted the candidate. This commit is synchronous.
        stageCommit = createStageCommitTransaction()
        stageCommit.begin()
        clearStageObject(true)
        loadCheckpoint = 'restoring-default-profile'
        restoreSceneProfile()
        loadCheckpoint = 'previous-stage-detached'
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
                resolvedCameraPresetId ?? null
            lastStageLoadFailure = undefined
            stageRoot.userData.stageLoadFailure = null
            activeStageVisibleContent = undefined
            stageRoot.userData.stageVisibleContent = null
            stageCommit.commit()
            stageCommit = undefined
            return
        }

        const object = candidateObject!
        scene.stageCharacterShadows.stageLayer = definition.renderProfile?.stageLayer ?? 0
        if (definition.renderProfile?.stageLayer != undefined) {
            scene.camera.layers.enable(definition.renderProfile.stageLayer)
        }
        activeStageLightmap = candidateLightmap
        candidateLightmap = undefined
        activeStageReflectionProbes = candidateReflectionProbes
        candidateReflectionProbes = undefined
        stageRoot.userData.stageUv1Companion = object.userData.stageUv1Companion ?? null
        stageRoot.userData.stageLightmaps = object.userData.stageLightmaps ?? null
        stageRoot.userData.stageReflectionProbes = object.userData.stageReflectionProbes ?? null
        activeStageObject = object
        activeStageDefinition = definition
        stageRoot.add(object)
        loadCheckpoint = 'stage-object-activated'
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
            resolvedCameraPresetId ?? null

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
        const bakedLightmapsActive =
            hasCompleteActiveStageLightmapCoverage(activeStageLightmap)
        loadCheckpoint = 'applying-render-profile'
        applyStageRenderProfile(
            definition.renderProfile,
            object,
            profileTextures,
            bakedLightmapsActive,
            definition.category,
        )
        loadCheckpoint = 'render-profile-applied'
        loadCheckpoint = 'creating-volumetric-runtime'
        activeStageVolumetricLightBeams = createStageVolumetricLightBeamController(
            object,
            definition.runtime?.volumetricLightBeamConfig,
            definition.runtime?.volumetricLightBeams,
            definition.runtime?.volumetricDustParticles,
            stageCommit.depthRegistrar,
        )
        stageRoot.userData.stageVolumetricLightBeams =
            activeStageVolumetricLightBeams?.getDebugState() ?? null
        loadCheckpoint = 'creating-stage-runtime'
        activeStageRuntime = createStageRuntimeController(
            object,
            definition.runtime,
            updateActiveStageDynamicBindings,
            definition.materialBindings ?? [],
            activeProfileTextures,
            stageCommit.depthRegistrar,
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
        if (candidateVisibleContent) {
            activeStageVisibleContent = candidateVisibleContent.snapshot
            updateStageCameraEvidence(candidateVisibleContent)
            stageRoot.userData.stageVisibleContent = activeStageVisibleContent
        }
        stageFolder.controllersRecursive().forEach(controller => controller.updateDisplay())
        lastStageLoadFailure = undefined
        stageRoot.userData.stageLoadFailure = null
        stageCommit.commit()
        stageCommit = undefined
        loadingTask.complete()
        // The diagnostic probe is not a loading consumer. Its failure must not
        // misreport a successfully committed stage as a failed transaction.
        if (candidateVisibleContent) {
            try { armBoundedStageDrawProbe(candidateVisibleContent) }
            catch (error) { console.warn('Stage draw probe failed:', error) }
        }
    } catch (error) {
        loadingTask.fail(error)
        stageCommit?.rollback()
        candidateReflectionProbes?.dispose()
        candidateLightmap?.dispose()
        candidateObject && disposeStageObject(candidateObject)
        candidateTextures.forEach(disposeStageEnvironmentTexture)
        if (
            loadEpoch !== stageLoadEpoch
            || loadController.signal.aborted
            || isAbortError(error)
        ) return
        lastStageLoadFailure = {
            requestedStageId: catalogDefinition.id,
            checkpoint: loadCheckpoint,
            message: error instanceof Error ? error.message : String(error),
        }
        stageRoot.userData.stageLoadFailure = lastStageLoadFailure
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
    const canonicalUrl = resolvePageAssetUrl(reference)
    const url = await resolveRuntimeAssetUrl(reference, signal)
    const response = await fetch(url, { cache: 'no-cache', signal })
    if (!response.ok) {
        throw new Error(`Could not load generated scene profile: ${response.status}`)
    }
    const profileBytes = await readLoadingResponse(response, { url, signal })
    getLoadingTask(signal)?.phase('decoding', reference)
    await yieldLoadingFrame(signal)
    const value = JSON.parse(new TextDecoder().decode(profileBytes)) as StageSceneProfilePackage
    if (!value || value.schemaVersion !== 1) {
        throw new Error(`Generated scene profile ${canonicalUrl} has unsupported schema`)
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
        throw new Error(`Generated scene profile ${canonicalUrl} has unsupported coordinates`)
    }
    return withBundledStageTransformAnimations(value, expectedStageId)
}

function mergeGeneratedStageProfile(
    definition: StageDefinition,
    generated: StageSceneProfilePackage,
): StageDefinition {
    const serializedRenderProfile =
        generated.renderProfile ?? definition.renderProfile
    const cameraPresetId = resolveStageCameraPresetId(
        definition.id,
        generated.cameraPresetId,
        officialCameraPresetById,
    )
    return applyOfficialCameraPreset({
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
        nativeVisibility: generated.nativeVisibility ?? definition.nativeVisibility,
        // Lighting, Volume and renderer state are bundle truth and therefore
        // replace historical hand-copied render profiles atomically.
        renderProfile: serializedRenderProfile,
    }, cameraPresetId)
}

function applyOfficialCameraPreset(
    definition: StageDefinition,
    cameraPresetId: string | undefined,
): StageDefinition {
    const cameraPreset = resolveOfficialCameraPreset(cameraPresetId)
    if (!cameraPreset) return definition
    return {
        ...definition,
        renderProfile: {
            ...definition.renderProfile,
            camera: {
                ...definition.renderProfile?.camera,
                ...cameraPreset,
            },
        },
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
        particleMeshes: generated.particleMeshes ?? authored.particleMeshes,
        volumetricLightBeamConfig:
            generated.volumetricLightBeamConfig
            ?? authored.volumetricLightBeamConfig,
        volumetricLightBeams:
            generated.volumetricLightBeams ?? authored.volumetricLightBeams,
        volumetricDustParticles:
            generated.volumetricDustParticles
            ?? authored.volumetricDustParticles,
        transformAnimations: generated.transformAnimations ?? authored.transformAnimations,
        serializedComponentClips:
            generated.serializedComponentClips ?? authored.serializedComponentClips,
        animatorRandomizers:
            generated.animatorRandomizers ?? authored.animatorRandomizers,
        gameObjectStates:
            generated.gameObjectStates ?? authored.gameObjectStates,
        activationDirectors:
            generated.activationDirectors ?? authored.activationDirectors,
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
    const visibleContent = activeStageVisibleContent
    return {
        id: currentStageId,
        hasObject: activeStageObject != undefined,
        objectName: activeStageObject?.name,
        meshes: visibleContent?.meshCount ?? 0,
        geometryAttributeSets: visibleContent?.geometryAttributeSets ?? {},
        materials: visibleContent?.materials ?? [],
        lights: visibleContent?.lightCount ?? 0,
        animationNames: visibleContent?.animationNames ?? [],
        visibleContent: visibleContent ?? null,
        nativeVisibility: activeStageObject?.userData.stageNativeVisibility ?? null,
        lastCandidateVisibleContent: lastCandidateVisibleContent ?? null,
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
        mainLightCascades:
            stageRoot.userData.stageMainLightCascades ?? null,
        shadowQuality: getStageShadowQualityState(),
        loadFailure: lastStageLoadFailure ?? null,
        sceneProfilePackage:
            stageRoot.userData.sceneProfilePackage ?? null,
        sceneNameIndex: {
            loaded: Boolean(stageSceneNameIndex),
            error: stageSceneNameError,
            dioramaSceneCount: stageSceneNameIndex?.dioramaScenes.length ?? 0,
            current: getStageSceneNameRecord(stageSceneNameIndex, currentStageId) ?? null,
        },
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

function captureActiveStageResources() {
    return {
        object: activeStageObject, definition: activeStageDefinition,
        textures: activeProfileTextures, lightmap: activeStageLightmap,
        reflectionProbes: activeStageReflectionProbes, runtime: activeStageRuntime,
        volumetric: activeStageVolumetricLightBeams, cascades: activeStageMainLightCascades,
        cascadeOptions: activeStageMainLightCascadeOptions,
        keyAnchor: activeCharacterKeyLightAnchor, keyVisible: activeCharacterKeyLightBaseVisible,
        foregroundBindings: activeForegroundStageLightBindings,
        foregroundChildren: [...foregroundStageLightRoot.children],
        visibleContent: activeStageVisibleContent, cancelDrawProbe: cancelActiveStageDrawProbe,
    }
}

function releaseStageResources(resources: ReturnType<typeof captureActiveStageResources>) {
    // Retirement is after successful commit. One disposal listener must not
    // turn an accepted new scene into a false load failure or skip other cleanup.
    const release = (action: () => void) => {
        try { action() } catch (error) { console.error('Stage resource retirement failed:', error) }
    }
    release(() => resources.cancelDrawProbe?.())
    release(() => resources.runtime?.dispose())
    release(() => resources.volumetric?.dispose())
    release(() => resources.reflectionProbes?.dispose())
    release(() => resources.cascades?.dispose())
    release(() => resources.lightmap?.dispose())
    resources.foregroundBindings.forEach(({ light }) => release(() => {
        light.shadow.map?.dispose()
        light.shadow.map = null
    }))
    if (resources.object) release(() => disposeStageObject(resources.object!))
    resources.textures.forEach(texture => release(() => disposeStageEnvironmentTexture(texture)))
}

/** No await from begin through commit/rollback: no frame sees a partial state. */
function createStageCommitTransaction() {
    const previous = captureActiveStageResources()
    const previousId = currentStageId
    const previousSelector = stageSelector.value
    const previousShadow = scene.directionalLight.shadow
    const clearAlpha = scene.renderer.getClearAlpha()
    const restoreReDrive = captureReDriveVolumeRuntime()
    const restorers = [
        captureStageRecord(stageOptions), captureStageRecord(stageRuntimeOptions),
        captureStageRecord(stageRoot.userData),
        captureStageFields(stageRoot, ['position', 'quaternion', 'scale', 'visible', 'children']),
        captureStageFields(foregroundStageLightRoot, ['visible']),
        captureStageFields(scene, ['backgroundSceneEnabled']),
        captureStageRecord(scene.camera), captureStageRecord(scene.controls),
        captureStageFields(scene.renderer, ['toneMapping', 'toneMappingExposure']),
        captureStageFields(scene.renderer.domElement.style, ['filter']),
        captureStageRecord(scene.stageCharacterShadows),
        ...[scene.scene, scene.backgroundScene].flatMap(value => [
            captureStageFields(value, ['background', 'environment', 'environmentIntensity',
                'backgroundIntensity', 'fog']), captureStageRecord(value.userData),
        ]),
        ...[scene.ambientLight, scene.backgroundAmbientLight, recoveredHemisphereLight,
            recoveredFillLight, scene.directionalLight, recoveredFillLight.target,
            scene.directionalLight.target].map(light => captureStageRecord(light)),
        ...[scene.effects.bloomPass, scene.effects.urpBloomPass,
            scene.effects.volumePostProcessPass, scene.effects.backgroundColorAdjustPass,
            scene.effects.paraffinPass].map(pass => captureStageRecord(pass)),
        ...[scene.effects.volumePostProcessPass, scene.effects.backgroundColorAdjustPass,
            scene.effects.paraffinPass].map(pass => captureStageUniforms(pass.uniforms)),
        captureStageRecord(scene.effects.volumePostProcessPass.filmGrainRuntime),
    ]
    const candidateDepthReleases = new Set<() => void>()
    let started = false
    let finished = false
    return {
        // Includes registrations made by a constructor that throws before its
        // controller can be assigned to activeStageRuntime/VolumetricLightBeams.
        depthRegistrar: {
            registerBackgroundDepthConsumer(
                consumer: Parameters<typeof scene.effects.registerBackgroundDepthConsumer>[0],
            ) {
                const unregister = scene.effects.registerBackgroundDepthConsumer(consumer)
                const release = () => { candidateDepthReleases.delete(release); unregister() }
                candidateDepthReleases.add(release)
                return release
            },
        },
        begin() {
            const candidateShadow = previousShadow.clone()
            started = true
            previous.cascades?.suspend()
            // restoreSceneProfile/configureShadow may dispose a shadow map when
            // changing its resolution. Give them an unallocated candidate shadow.
            scene.directionalLight.shadow = candidateShadow
        },
        commit() {
            finished = true
            releaseStageResources(previous)
            try { previousShadow.dispose() }
            catch (error) { console.error('Stage shadow retirement failed:', error) }
            candidateDepthReleases.clear()
        },
        rollback() {
            if (!started || finished) return
            finished = true
            if (activeStageObject !== previous.object || activeProfileTextures !== previous.textures) {
                clearStageObject()
            }
            candidateDepthReleases.forEach(release => release())
            if (scene.directionalLight.shadow !== previousShadow) scene.directionalLight.shadow.dispose()
            scene.directionalLight.shadow = previousShadow
            restoreReDrive()
            restorers.forEach(restore => restore())
            scene.renderer.setClearAlpha(clearAlpha)
            activeStageObject = previous.object
            activeStageDefinition = previous.definition
            activeProfileTextures = previous.textures
            activeStageLightmap = previous.lightmap
            activeStageReflectionProbes = previous.reflectionProbes
            activeStageRuntime = previous.runtime
            activeStageVolumetricLightBeams = previous.volumetric
            activeStageMainLightCascades = previous.cascades
            activeStageMainLightCascadeOptions = previous.cascadeOptions
            activeCharacterKeyLightAnchor = previous.keyAnchor
            activeCharacterKeyLightBaseVisible = previous.keyVisible
            activeForegroundStageLightBindings = previous.foregroundBindings
            activeStageVisibleContent = previous.visibleContent
            cancelActiveStageDrawProbe = previous.cancelDrawProbe
            currentStageId = previousId
            stageSelector.value = previousSelector
            // The children array snapshot preserves order; restore parent links
            // without add() appending a duplicate to that exact original array.
            if (previous.object) previous.object.parent = stageRoot
            previous.foregroundChildren.forEach(child => foregroundStageLightRoot.add(child))
            previous.cascades?.resume()
            stageRoot.updateWorldMatrix(true, true)
        },
    }
}

function clearStageObject(retainResources = false) {
    const resources = captureActiveStageResources()
    if (!retainResources) releaseStageResources(resources)
    cancelActiveStageDrawProbe = undefined
    activeStageVisibleContent = undefined
    activeStageRuntime = undefined
    activeStageVolumetricLightBeams = undefined
    activeStageReflectionProbes = undefined
    activeStageMainLightCascades = undefined
    activeStageMainLightCascadeOptions = undefined
    activeStageLightmap = undefined
    activeCharacterKeyLightAnchor = undefined
    activeCharacterKeyLightBaseVisible = true
    activeForegroundStageLightBindings = []
    foregroundStageLightRoot.clear()
    if (activeStageObject) stageRoot.remove(activeStageObject)
    activeStageObject = undefined
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
    stageRoot.userData.stageMainLightCascades = null
    stageRoot.userData.sceneProfilePackage = null
    stageRoot.userData.cameraPresetId = null
    stageRoot.userData.stageVisibleContent = null
}

function prepareStageObject(object: THREE.Object3D, stageLayer?: number) {
    const maxAnisotropy = scene.renderer.capabilities.getMaxAnisotropy()
    object.traverse(child => {
        if (stageLayer != undefined) child.layers.set(stageLayer)
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.castShadow = mesh.userData.stageCastShadow ?? true
        if (mesh.userData.nativeImageBackground) return
        mesh.receiveShadow = mesh.userData.stageReceiveShadow ?? true
        enableRigidStageCulling(mesh)

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
        if ((mesh as THREE.InstancedMesh).isInstancedMesh && mesh.userData.stageStaticBatchOwned) {
            ;(mesh as THREE.InstancedMesh).dispose()
        }
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
    if (definition.type === 'image') return loadNativeImageBackground(definition, signal)
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
        getLoadingTask(signal)?.phase('assembling', undefined, '组装场景材质')
        await yieldLoadingFrame(signal)
        const bindingResult = await applyStageMaterialBindings(
            object,
            definition.materialBindings,
            scene.renderer,
            signal,
            resolveReDriveBackgroundShaderGlobals(
                definition.renderProfile?.reDriveVolume,
            ),
            scene.effects,
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
    const canonicalUrl = resolvePageAssetUrl(definition.url)
    const payloadUrl = await resolveRuntimeAssetUrl(definition.url, signal)
    const manager = new THREE.LoadingManager()
    manager.setURLModifier(resolveCachedRuntimeAssetUrl)
    const loadingTask = getLoadingTask(signal)
    manager.onStart = url => loadingTask?.resource(url, false)
    manager.onProgress = url => loadingTask?.resource(url, true)
    const blob = await fetchAndTryDecompressGzip(
        payloadUrl,
        undefined,
        undefined,
        signal,
    )
    signal.throwIfAborted()
    loadingTask?.phase('decoding', canonicalUrl)
    await yieldLoadingFrame(signal)
    const resourcePath = new URL('.', canonicalUrl).href
    const object = definition.type === 'gltf'
        ? await (async () => {
            const gltf = await new GLTFLoader(manager).parseAsync(
                await blob.text(),
                resourcePath,
            )
            signal.throwIfAborted()
            gltf.scene.animations = gltf.animations
            return gltf.scene
        })()
        : await (async () => {
            const arrayBuffer = await blob.arrayBuffer()
            signal.throwIfAborted()
            return new FBXLoader(manager).parse(arrayBuffer, resourcePath)
        })()

    // Keep the decoded carrier's native root, before asset placement (including
    // default zero/identity placement) changes the transform used by identity.
    object.userData.stageSerializedRootTransform = {
        position: object.position.toArray(),
        rotation: object.quaternion.toArray(),
        scale: object.scale.toArray(),
    }
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
        kind: 'environment' | 'lightmap' | 'film-grain' = 'environment',
    ) => {
        signal.throwIfAborted()
        const resolvedUrl = await resolveRuntimeAssetUrl(url, signal)
        const response = await fetch(resolvedUrl, {
            method: resolvedUrl.startsWith('blob:') ? 'GET' : 'HEAD',
            cache: 'no-cache',
            signal,
        })
        // Blob URLs support GET only; release the unused validation body.
        await response.body?.cancel().catch(() => undefined)
        signal.throwIfAborted()
        const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
        if (!response.ok) {
            throw new Error(`STAGE_ASSET_HTTP_${response.status}: ${resolvedUrl}`)
        }
        if (contentType.includes('text/html')) {
            throw new Error(`STAGE_ASSET_HTML_FALLBACK: ${resolvedUrl}`)
        }
        const loadingTask = getLoadingTask(signal)
        loadingTask?.phase('decoding', url, '载入场景材质贴图')
        loadingTask?.resource(url, false)
        await yieldLoadingFrame(signal)
        const texture = await new THREE.TextureLoader().loadAsync(resolvedUrl)
        loadingTask?.resource(url, true)
        if (signal.aborted) {
            texture.dispose()
            signal.throwIfAborted()
        }
        if (kind === 'environment') {
            texture.mapping = THREE.EquirectangularReflectionMapping
            texture.colorSpace = THREE.SRGBColorSpace
        } else if (kind === 'lightmap') {
            texture.mapping = THREE.UVMapping
            texture.colorSpace = THREE.NoColorSpace
            texture.flipY = false
        } else {
            // URP's UberPost binds the Alpha8 preset through
            // sampler_LinearRepeat; import filterMode does not own sampling.
            texture.mapping = THREE.UVMapping
            texture.colorSpace = THREE.NoColorSpace
            texture.flipY = false
            texture.wrapS = THREE.RepeatWrapping
            texture.wrapT = THREE.RepeatWrapping
            texture.minFilter = THREE.LinearFilter
            texture.magFilter = THREE.LinearFilter
            texture.generateMipmaps = false
            texture.anisotropy = 1
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
            let environment = await loadStageEnvironment(
                profile.environmentTextureUrl,
                profile.environmentEncoding ?? 'srgb-image',
                scene.renderer,
                signal,
            )
            if (profile.reflectionProbes?.length && !isCubeTexture(environment)) {
                environment = convertStageEnvironmentToCubemap(
                    environment,
                    scene.renderer,
                )
            }
            loaded.environment = environment
            loaded.textures.push(loaded.environment)
        }
        if (profile.reflectionProbes?.length) {
            loaded.reflectionProbes = []
            for (const probe of profile.reflectionProbes) {
                let texture = await loadStageEnvironment(
                    probe.textureUrl,
                    probe.encoding,
                    scene.renderer,
                    signal,
                )
                if (!isCubeTexture(texture)) {
                    texture = convertStageEnvironmentToCubemap(
                        texture,
                        scene.renderer,
                    )
                }
                if (!isCubeTexture(texture)) {
                    disposeStageEnvironmentTexture(texture)
                    throw new Error(`Reflection probe ${probe.id} did not load as a cubemap`)
                }
                loaded.reflectionProbes.push({ profile: probe, texture })
                loaded.textures.push(texture)
            }
        }
        const filmGrain = profile.postProcessing?.filmGrain
        if (
            filmGrain
            && filmGrain.active !== false
            && filmGrain.intensity > 0
        ) {
            if (!filmGrain.textureUrl) {
                throw new Error('Active serialized FilmGrain has no texture URL')
            }
            loaded.filmGrain = await load(filmGrain.textureUrl, 'film-grain')
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
            const bindingsUrl = await resolveRuntimeAssetUrl(profile.lightmap.bindingsUrl, signal)
            const response = await fetch(
                bindingsUrl,
                { cache: 'no-cache', signal },
            )
            if (!response.ok) {
                throw new Error(
                    `Could not load stage lightmap bindings: ${response.status}`,
                )
            }
            const bindingsContentType = response.headers.get('content-type')?.toLowerCase() ?? ''
            if (bindingsContentType.includes('text/html')) {
                throw new Error(`STAGE_ASSET_HTML_FALLBACK: ${bindingsUrl}`)
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
                    await resolveRuntimeAssetUrl(
                        profile.lightmap.uv1CompanionUrl,
                        signal,
                    ),
                    signal,
                )
            }
        }
        return loaded
    } catch (error) {
        loaded.textures.forEach(disposeStageEnvironmentTexture)
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

function visibleInStageHierarchy(object: THREE.Object3D | undefined) {
    let current = object
    while (current) {
        if (!current.visible) return false
        current = current.parent ?? undefined
    }
    return true
}

function updateCharacterKeyLightFromAnchor() {
    if (!activeCharacterKeyLightAnchor) return
    scene.directionalLight.visible = activeCharacterKeyLightBaseVisible
        && stageRoot.visible
        && visibleInStageHierarchy(activeCharacterKeyLightAnchor)
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
        light.visible = (profile.activeSelf ?? profile.active) !== false
            && profile.enabled !== false
            && (!anchor || visibleInStageHierarchy(anchor))
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

function profileRequestsRealtimeShadow(profile: StageLightProfile) {
    return profile.castShadow
        ?? Boolean(profile.shadow && profile.shadow.type !== 0)
}

function configureShadow(light: THREE.Light, profile: StageLightProfile) {
    const shadow = profile.shadow
    light.castShadow = profileRequestsRealtimeShadow(profile)
    if (!light.castShadow || !('shadow' in light)) return

    const shadowLight = light as THREE.DirectionalLight | THREE.PointLight | THREE.SpotLight
    shadowLight.shadow.camera.userData[
        STAGE_CHARACTER_SHADOW_CASTERS_ENABLED
    ] = profileAffectsUnityLayer(profile, 0)
    shadowLight.shadow.intensity = THREE.MathUtils.clamp(shadow?.strength ?? 1, 0, 1)
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
    if (shadowLight instanceof THREE.DirectionalLight) {
        const camera = shadowLight.shadow.camera as THREE.OrthographicCamera
        const bias = resolveOfficialUrpDirectionalCascadeBias({
            frustumSize: camera.right - camera.left,
            shadowResolution: resolution,
            shadowNear: camera.near,
            shadowFar: camera.far,
            unityShadowBias: shadow?.bias ?? 0,
            unityShadowNormalBias: shadow?.normalBias ?? 0,
        })
        shadowLight.shadow.bias = bias.receiverDepthBias
        shadowLight.shadow.normalBias = bias.receiverNormalBias
        shadowLight.shadow.camera.userData.officialUrpBias = bias
    } else {
        // Punctual-light projection needs its own range/FOV conversion. Keep
        // the existing bounded depth fallback and avoid treating Unity's
        // dimensionless normal bias as a world-space metre offset.
        shadowLight.shadow.bias = -(shadow?.bias ?? 0) * 0.001
        shadowLight.shadow.normalBias = 0
    }
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
    light.visible = (profile.activeSelf ?? profile.active) !== false
        && profile.enabled !== false
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
    stageCategory?: StageCategory,
) {
    if (!profiles?.length) return

    const directionalShadowPlan = resolveOfficialUrpDirectionalShadowPlan(
        profiles.map(profile => ({
            directional: (profile.type ?? 'directional') === 'directional',
            role: profile.role ?? null,
            active: (profile.activeSelf ?? profile.active) !== false
                && profile.enabled !== false,
            affectsStageLayer: stageLayer == undefined
                || profileAffectsUnityLayer(profile, stageLayer),
            skippedAsBaked:
                profile.lightmapping === 2 && bakedLightmapsActive,
            requestsShadow: profileRequestsRealtimeShadow(profile),
        })),
    )

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
        serializedCastShadow: boolean
        runtimeCastShadow: boolean
        shadowConsumer:
            | 'main-cascade'
            | 'additional-directional-unshadowed'
            | 'legacy-directional-shadow'
            | 'additional-punctual'
            | 'none'
    }> = []
    stageObject.userData.stageLights = {
        bakedLightmapValue: 2,
        bakedLightmapsActive,
        localLightIntensityScale: UNITY_TO_THREE_DIFFUSE_IRRADIANCE,
        localLightIntensityScaleReason:
            'Unity URP diffuse has no 1/pi; Three MeshStandard BRDF_Lambert does',
        sourceColorSpace: 'unity-srgb',
        directionalShadowAuthority:
            'URP14 one cascaded directional MainLight; additional realtime shadow atlas is punctual',
        mainDirectionalProfileIndex: directionalShadowPlan.mainProfileIndex,
        records: debugRecords,
    }

    profiles.forEach((profile, index) => {
        const type = profile.type ?? 'directional'
        const anchor = resolveStageAnchor(stageObject, profile)
        const effectiveIntensity = effectiveStageLightIntensity(profile, type)
        const affectsCharacterLayer = profileAffectsUnityLayer(profile, 0)
        const affectsStageLayer = stageLayer == undefined
            || profileAffectsUnityLayer(profile, stageLayer)
        const active = (profile.activeSelf ?? profile.active) !== false
            && profile.enabled !== false
        const skippedAsBaked = profile.lightmapping === 2
            && bakedLightmapsActive
        const serializedCastShadow = profileRequestsRealtimeShadow(profile)
        const directionalPlanRecord = directionalShadowPlan.records[index]
        const runtimeCastShadow = type === 'directional'
            ? directionalPlanRecord.runtimeCastShadow
            : active && !skippedAsBaked && serializedCastShadow
        const runtimeProfile = type === 'directional'
            && serializedCastShadow !== runtimeCastShadow
            ? { ...profile, castShadow: runtimeCastShadow }
            : profile
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
            serializedCastShadow,
            runtimeCastShadow,
            shadowConsumer: type === 'directional'
                ? directionalPlanRecord.consumer
                : runtimeCastShadow
                    ? 'additional-punctual' as const
                    : 'none' as const,
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
            activeCharacterKeyLightBaseVisible =
                (profile.activeSelf ?? profile.active) !== false
                && profile.enabled !== false
            light.visible = activeCharacterKeyLightBaseVisible
            configureShadow(light, runtimeProfile)

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
                    runtimeProfile,
                    effectiveIntensity,
                ) as THREE.DirectionalLight
                stageLight.name = `${profile.name ?? 'MainLight'}:Background`
                if (stageLayer != undefined) stageLight.layers.set(stageLayer)
                attachOfficialStageLight(stageLight, stageObject, profile, anchor)
                if (stageLight.castShadow) {
                    installStageMainLightCascades({
                        camera: scene.camera,
                        parent: scene.backgroundScene,
                        stageObject,
                        sourceLight: stageLight,
                        stageLayer: stageLayer ?? 0,
                        maxShadowDistance:
                            resolveOfficialMainShadowDistance(stageCategory),
                        shadowCasterGateKey:
                            STAGE_CHARACTER_SHADOW_CASTERS_ENABLED,
                        characterCastersEnabled: affectsCharacterLayer,
                        unityShadowBias: profile.shadow?.bias ?? 0,
                        unityShadowNormalBias:
                            profile.shadow?.normalBias ?? 0,
                    })
                }
            }
            debugRecords.push({
                ...debugBase,
                status: 'instantiated',
                instances: 1 + Number(affectsStageLayer),
            })
            return
        }

        if (affectsStageLayer) {
            const light = createOfficialLight(type, runtimeProfile, effectiveIntensity)
            light.name = profile.name ?? `OfficialStageLight:${index}`
            if (stageLayer != undefined) light.layers.set(stageLayer)

            attachOfficialStageLight(light, stageObject, profile, anchor)
        }
        if (affectsCharacterLayer) {
            addForegroundStageLight(
                type,
                runtimeProfile,
                effectiveIntensity,
                anchor,
            )
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
    stageCategory?: StageCategory,
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
            stageCategory,
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
        loadedTextures.filmGrain,
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
    filmGrainTexture?: THREE.Texture,
) {
    const pass = scene.effects.volumePostProcessPass
    const chromaticAberration = profile?.chromaticAberration
    const colorAdjustments = profile?.colorAdjustments
    const filmGrain = profile?.filmGrain
    const vignette = profile?.vignette
    const chromaticAberrationEnabled = Boolean(
        chromaticAberration
        && chromaticAberration.active !== false
        && chromaticAberration.intensity > 0,
    )
    const colorAdjustEnabled = Boolean(
        colorAdjustments && colorAdjustments.active !== false,
    )
    const filmGrainEnabled = Boolean(
        filmGrain
        && filmGrain.active !== false
        && filmGrain.intensity > 0
        && filmGrainTexture,
    )
    const vignetteEnabled = Boolean(
        vignette
        && vignette.active !== false
        && (vignette.intensity ?? 0) > 0,
    )

    pass.enabled = chromaticAberrationEnabled
        || colorAdjustEnabled
        || filmGrainEnabled
        || vignetteEnabled
        || toneMapping === 'aces'
    pass.uniforms.uChromaticAberrationEnabled.value =
        chromaticAberrationEnabled ? 1 : 0
    pass.uniforms.uChromaticAberrationIntensity.value =
        chromaticAberrationEnabled ? chromaticAberration?.intensity ?? 0 : 0
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

    pass.uniforms.uFilmGrainEnabled.value = filmGrainEnabled ? 1 : 0
    pass.uniforms.uFilmGrainTexture.value = filmGrainEnabled
        ? filmGrainTexture
        : null
    pass.uniforms.uFilmGrainIntensity.value = filmGrainEnabled
        ? filmGrain?.intensity ?? 0
        : 0
    pass.uniforms.uFilmGrainResponse.value = filmGrainEnabled
        ? THREE.MathUtils.clamp(filmGrain?.response ?? 0.8, 0, 1)
        : 0.8
    pass.resetFilmGrainRuntime()

    scene.scene.userData.stageVolumePostProcessing = pass.enabled
        ? {
            chromaticAberration: chromaticAberrationEnabled
                ? { ...chromaticAberration }
                : null,
            colorAdjustments: colorAdjustEnabled
                ? { ...colorAdjustments }
                : null,
            filmGrain: filmGrainEnabled ? {
                ...filmGrain,
                textureName: filmGrainTexture?.name || null,
                runtime: pass.filmGrainRuntime,
            } : null,
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
