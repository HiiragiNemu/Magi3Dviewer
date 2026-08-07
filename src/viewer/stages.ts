import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { fetchAndTryDecompressGzip } from 'magia-exedra-character-three/utils'
import { scene, recoveredFillLight, recoveredHemisphereLight } from './scene'
import { gui } from './controllers/GUI'
import {
    applyStageMaterialBindings,
    type StageMaterialBinding,
} from './stageMaterialBindings'
import {
    applyStageLightmaps,
    type StageLightmapApplication,
    type StageLightmapBinding,
} from './stageLightmaps'
import {
    applyReDriveVolumeRuntime,
    resetReDriveVolumeRuntime,
    type ReDriveVolumeRuntimeProfile,
    type Rgba,
} from './reDriveVolumeRuntime'
import {
    createStageRuntimeController,
    type StageRuntimeController,
    type StageRuntimeProfile,
} from './stageRuntime'
import {
    normalizeStageBundleProvenance,
    validateStageBundleProvenance,
    type StageBundleProvenance,
} from './stageBundleProvenance'

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
    /** Existing FBX node whose converted transform drives this light. */
    anchorNode?: string
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
}

export interface StageRenderProfile {
    /** Source ReDriveVolume or export profile ID. */
    id?: string
    source?: 'ReDriveVolume' | 'exported-prefab' | 'manual-research'
    backgroundColor?: string
    backgroundTextureUrl?: string
    environmentTextureUrl?: string
    environmentIntensity?: number
    lightmap?: {
        textureUrl: string
        bindingsUrl: string
        encoding: 'unity-rgbm-linear'
        intensity?: number
    }
    fog?: {
        color: string
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
        strength: number
        radius: number
        threshold: number
    }
    camera?: {
        position: [number, number, number]
        target: [number, number, number]
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
    renderProfile?: StageRenderProfile
    runtime?: StageRuntimeProfile
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

interface StageCatalog {
    version: number
    generatedAt?: string
    sourceRevision?: string
    /** Optional modular entries keep large official catalogs incremental. */
    entries?: string[]
    stages: StageDefinition[]
}

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
let activeStageRuntime: StageRuntimeController | undefined

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
let stageLoadEpoch = 0
let pendingStageLoad: AbortController | undefined
let activeCharacterKeyLightAnchor: THREE.Object3D | undefined

interface LoadedExternalStage {
    object: THREE.Object3D
    textures: THREE.Texture[]
}

interface LoadedProfileTextures {
    background?: THREE.Texture
    environment?: THREE.Texture
    lightmap?: THREE.Texture
    lightmapBindings?: StageLightmapBinding[]
    lightmapIntensity?: number
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
    cameraPosition: scene.camera.position.clone(),
    cameraTarget: scene.controls.target.clone(),
    cameraFov: scene.camera.fov,
    cameraNear: scene.camera.near,
    cameraFar: scene.camera.far,
    cameraLayersMask: scene.camera.layers.mask,
}

export async function setupStageSelector() {
    try {
        const response = await fetch('./stages/catalog.json', { cache: 'no-cache' })
        if (response.ok) {
            const catalog = await response.json() as StageCatalog
            const modularStages: StageDefinition[] = []
            for (const entryUrl of catalog.entries ?? []) {
                try {
                    const entryResponse = await fetch(entryUrl, { cache: 'no-cache' })
                    if (!entryResponse.ok) {
                        throw new Error(`${entryResponse.status} ${entryResponse.statusText}`)
                    }
                    modularStages.push(
                        await entryResponse.json() as StageDefinition,
                    )
                } catch (error) {
                    console.warn(
                        `Could not load stage catalog entry ${entryUrl}:`,
                        error,
                    )
                }
            }
            const catalogStages = [
                ...(catalog.stages ?? []),
                ...modularStages,
            ].filter((stage, index, all) =>
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
            console.log('Loaded stage catalog:', {
                version: catalog.version,
                generatedAt: catalog.generatedAt,
                sourceRevision: catalog.sourceRevision,
                total: catalogStages.length,
                modular: modularStages.length,
                official: catalogStages.filter(stage => stage.official).length,
            })
        }
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
    const definition = definitions.find(stage => stage.id === id) ?? builtInStages[0]
    pendingStageLoad?.abort()
    const loadController = new AbortController()
    pendingStageLoad = loadController
    stageSelector.disabled = true
    let candidateObject: THREE.Object3D | undefined
    let candidateTextures: THREE.Texture[] = []

    try {
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
        if (profileTextures.lightmap && profileTextures.lightmapBindings) {
            activeStageLightmap = applyStageLightmaps(
                object,
                profileTextures.lightmap,
                profileTextures.lightmapBindings,
                { intensity: profileTextures.lightmapIntensity ?? 1 },
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
        applyStageRenderProfile(
            definition.renderProfile,
            object,
            profileTextures,
            bakedLightmapsActive,
        )
        activeStageRuntime = createStageRuntimeController(
            object,
            definition.runtime,
            updateActiveStageDynamicBindings,
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
        officialLights:
            activeStageObject?.userData.stageLights ?? null,
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
    stageRoot.updateWorldMatrix(true, false)
    updateActiveStageDynamicBindings()
}

function clearStageObject() {
    activeStageRuntime?.dispose()
    activeStageRuntime = undefined
    activeStageLightmap?.dispose()
    activeStageLightmap = undefined
    activeCharacterKeyLightAnchor = undefined
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
    stageRoot.userData.stageDynamic = null
    stageRoot.userData.stageLightmaps = null
}

function prepareStageObject(object: THREE.Object3D, stageLayer?: number) {
    const maxAnisotropy = scene.renderer.capabilities.getMaxAnisotropy()
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
            loaded.environment = await load(profile.environmentTextureUrl)
        }
        if (profile.lightmap) {
            if (profile.lightmap.encoding !== 'unity-rgbm-linear') {
                throw new Error(
                    `Unsupported stage lightmap encoding: ${profile.lightmap.encoding}`,
                )
            }
            loaded.lightmap = await load(profile.lightmap.textureUrl, 'lightmap')
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
        }
        return loaded
    } catch (error) {
        loaded.textures.forEach(texture => texture.dispose())
        throw error
    }
}

function applyLightColor(light: THREE.Light, value: string | Rgba) {
    if (Array.isArray(value)) {
        light.color.setRGB(value[0], value[1], value[2])
    } else {
        light.color.set(value)
    }
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

function updateActiveStageDynamicBindings() {
    updateCharacterKeyLightFromAnchor()
    stageRoot.userData.stageRuntime =
        activeStageRuntime?.getDebugState()
        ?? activeStageObject?.userData.stageRuntime
        ?? null
}

function configureShadow(light: THREE.Light, profile: StageLightProfile) {
    const shadow = profile.shadow
    light.castShadow = profile.castShadow ?? Boolean(shadow && shadow.type !== 0)
    if (!light.castShadow || !('shadow' in light)) return

    const shadowLight = light as THREE.DirectionalLight | THREE.PointLight | THREE.SpotLight
    shadowLight.shadow.bias = -(shadow?.bias ?? 0) * 0.001
    shadowLight.shadow.normalBias = shadow?.normalBias ?? 0
    if (shadow?.nearPlane != undefined) shadowLight.shadow.camera.near = shadow.nearPlane
    shadowLight.shadow.mapSize.set(1024, 1024)
}

/**
 * Recovered Unity local-light intensities use the project's serialized
 * percent-like scale (typical values are 500-1000), while modern Three.js
 * point/spot lights consume a much smaller physical-light unit. Keeping the
 * conversion explicit prevents raw Unity values from washing out the scene and
 * makes future calibration against captured frames a one-constant change.
 * Directional lights already use comparable unitless multipliers.
 */
const UNITY_LOCAL_LIGHT_TO_THREE_INTENSITY = 0.01

function effectiveStageLightIntensity(
    profile: StageLightProfile,
    type: NonNullable<StageLightProfile['type']>,
) {
    const rawIntensity = Number.isFinite(profile.intensity)
        ? Math.max(0, profile.intensity)
        : 0
    return type === 'directional'
        ? rawIntensity
        : rawIntensity * UNITY_LOCAL_LIGHT_TO_THREE_INTENSITY
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
        anchorResolved: boolean
        instances: number
    }> = []
    stageObject.userData.stageLights = {
        bakedLightmapValue: 2,
        bakedLightmapsActive,
        localLightIntensityScale: UNITY_LOCAL_LIGHT_TO_THREE_INTENSITY,
        records: debugRecords,
    }

    profiles.forEach((profile, index) => {
        const type = profile.type ?? 'directional'
        const anchor = profile.anchorNode
            ? stageObject.getObjectByName(profile.anchorNode)
            : undefined
        const effectiveIntensity = effectiveStageLightIntensity(profile, type)
        const debugBase = {
            index,
            name: profile.name ?? `OfficialStageLight:${index}`,
            type,
            role: profile.role ?? null,
            lightmapping: profile.lightmapping ?? null,
            rawIntensity: profile.intensity,
            effectiveIntensity,
            anchorNode: profile.anchorNode ?? null,
            anchorResolved: profile.anchorNode == undefined || anchor != undefined,
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
                if (profile.position) light.position.set(...profile.position)
                if (profile.target) light.target.position.set(...profile.target)
            }
            light.layers.enable(0)
            if (stageLayer != undefined) light.layers.enable(stageLayer)
            light.target.updateMatrixWorld()

            // Unity's MainLight reaches both characters and the stage. A
            // separate instance is required because the background scene is a
            // distinct render pass used to enforce the original culling masks.
            const stageLight = new THREE.DirectionalLight(
                light.color,
                light.intensity,
            )
            stageLight.name = `${profile.name ?? 'MainLight'}:Background`
            applyLightColor(stageLight, profile.color)
            configureShadow(stageLight, profile)
            if (stageLayer != undefined) stageLight.layers.set(stageLayer)
            if (anchor) {
                anchor.add(stageLight)
                stageLight.position.set(0, 0, 0)
                stageLight.target.position.set(0, 0, 1)
                anchor.add(stageLight.target)
            } else {
                stageObject.add(stageLight)
                if (profile.position) stageLight.position.set(...profile.position)
                if (profile.target) stageLight.target.position.set(...profile.target)
                stageObject.add(stageLight.target)
            }
            debugRecords.push({
                ...debugBase,
                status: 'instantiated',
                instances: 2,
            })
            return
        }

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
        light.name = profile.name ?? `OfficialStageLight:${index}`
        applyLightColor(light, profile.color)
        configureShadow(light, profile)
        if (stageLayer != undefined) light.layers.set(stageLayer)

        if (anchor) {
            anchor.add(light)
            light.position.set(0, 0, 0)
            if (light instanceof THREE.SpotLight || light instanceof THREE.DirectionalLight) {
                light.target.name = `${light.name}:Target`
                light.target.position.set(0, 0, 1)
                anchor.add(light.target)
            }
        } else {
            stageObject.add(light)
            if (profile.position) light.position.set(...profile.position)
            if (
                profile.target
                && (light instanceof THREE.SpotLight || light instanceof THREE.DirectionalLight)
            ) {
                light.target.position.set(...profile.target)
                stageObject.add(light.target)
            }
        }
        debugRecords.push({
            ...debugBase,
            status: 'instantiated',
            instances: 1,
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
            new THREE.Color(profile.backgroundColor)
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
        scene.backgroundScene.fog =
            new THREE.Fog(profile.fog.color, profile.fog.near, profile.fog.far)
        scene.scene.fog = profile.fog.affectsCharacters === false
            ? null
            : new THREE.Fog(profile.fog.color, profile.fog.near, profile.fog.far)
    }

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
            scene.directionalLight.position.set(...profile.directionalLight.position)
        }
        if (profile.directionalLight.target) {
            scene.directionalLight.target.position.set(...profile.directionalLight.target)
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

    if (profile.renderer?.toneMapping) {
        scene.renderer.toneMapping = {
            none: THREE.NoToneMapping,
            linear: THREE.LinearToneMapping,
            aces: THREE.ACESFilmicToneMapping,
        }[profile.renderer.toneMapping]
    }
    if (profile.renderer?.exposure != undefined) {
        scene.renderer.toneMappingExposure = profile.renderer.exposure
    }
    if (profile.renderer?.clearAlpha != undefined) {
        scene.renderer.setClearAlpha(profile.renderer.clearAlpha)
    }
    if (profile.colorFilter) scene.setColorFilter(profile.colorFilter)
    if (profile.bloom) {
        scene.effects.bloomPass.enabled = profile.bloom.enabled
        if (profile.source === 'ReDriveVolume') {
            // Unity/URP Bloom volume values are not numerically compatible with
            // Three's UnrealBloomPass. Convert only recovered Unity profiles.
            scene.effects.bloomPass.strength = THREE.MathUtils.clamp(
                profile.bloom.strength * 0.08,
                0,
                0.35,
            )
            scene.effects.bloomPass.radius = THREE.MathUtils.clamp(
                profile.bloom.radius * 0.5,
                0,
                1,
            )
            scene.effects.bloomPass.threshold = THREE.MathUtils.clamp(
                0.52 + profile.bloom.threshold * 0.5,
                0,
                1,
            )
        } else {
            // Manual research stages already store UnrealBloomPass units.
            scene.effects.bloomPass.strength = profile.bloom.strength
            scene.effects.bloomPass.radius = profile.bloom.radius
            scene.effects.bloomPass.threshold = profile.bloom.threshold
        }
    }
    if (profile.camera) {
        scene.camera.position.set(...profile.camera.position)
        scene.controls.target.set(...profile.camera.target)
        if (profile.camera.fov != undefined) scene.camera.fov = profile.camera.fov
        if (profile.camera.near != undefined) scene.camera.near = profile.camera.near
        if (profile.camera.far != undefined) scene.camera.far = profile.camera.far
        scene.camera.updateProjectionMatrix()
        scene.controls.update()
    }
    applyReDriveVolumeRuntime(profile.reDriveVolume)
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
    scene.camera.position.copy(initialSceneState.cameraPosition)
    scene.controls.target.copy(initialSceneState.cameraTarget)
    scene.camera.fov = initialSceneState.cameraFov
    scene.camera.near = initialSceneState.cameraNear
    scene.camera.far = initialSceneState.cameraFar
    scene.camera.layers.mask = initialSceneState.cameraLayersMask
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
