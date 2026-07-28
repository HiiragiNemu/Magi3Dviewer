import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { fetchAndTryDecompressGzip } from 'magia-exedra-character-three/utils'
import { scene } from './scene'
import { gui } from './controllers/GUI'
import { applyReDriveVolumeRuntime, resetReDriveVolumeRuntime, type ReDriveVolumeRuntimeProfile } from './reDriveVolumeRuntime'

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
    color: string
    intensity: number
    position?: [number, number, number]
    target?: [number, number, number]
    castShadow?: boolean
}

export interface StageRenderProfile {
    /** Source ReDriveVolume or export profile ID. */
    id?: string
    source?: 'ReDriveVolume' | 'exported-prefab' | 'manual-research'
    backgroundColor?: string
    backgroundTextureUrl?: string
    environmentTextureUrl?: string
    environmentIntensity?: number
    fog?: {
        color: string
        near: number
        far: number
    } | null
    ambientLight?: {
        color: string
        intensity: number
    }
    directionalLight?: StageLightProfile
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
    reDriveVolume?: {
        skyboxIntensity?: number
        reflectionProbe?: string
        shAmbient?: number[]
        characterTint?: string
        characterShadowTint?: string
        backgroundTint?: string
        characterLightingOverrideColor?: string
        characterLightingOverrideRatio?: number
        characterLightingOverrideDirection?: [number, number, number]
        characterAdditionalRimLightColor?: string
        characterAdditionalRimLightDirection?: [number, number]
        characterFaceAwayTint?: string
        characterCancelPerspective?: number
        backgroundShadowStrengthAdditive?: number
        backgroundPostExposure?: number
        backgroundContrast?: number
        backgroundSaturation?: number
    }
}

export interface StageDefinition {
    id: string
    name: string
    category?: StageCategory
    official?: boolean
    assetBundleName?: string
    type: 'procedural' | 'gltf' | 'fbx' | 'group'
    preset?: 'sky-reference' | 'studio' | 'battle-arena'
    url?: string
    assets?: StageAssetDefinition[]
    scale?: number
    position?: [number, number, number]
    rotation?: [number, number, number]
    spawnPoints?: StageSpawnPoint[]
    renderProfile?: StageRenderProfile
    credit?: string
    evidence?: string[]
}

interface StageCatalog {
    version: number
    generatedAt?: string
    sourceRevision?: string
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
scene.scene.add(stageRoot)

const stageFolder = gui.addFolder('3D Stage').close()
const stageActions = {
    PlaceCharactersAtSpawns: () => placeCharactersAtStageSpawns(),
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

let definitions = [...builtInStages]
let activeStageObject: THREE.Object3D | undefined
let activeStageDefinition: StageDefinition | undefined
let currentStageId = 'none'
let activeProfileTextures: THREE.Texture[] = []

const initialSceneState = {
    background: scene.scene.background,
    environment: scene.scene.environment,
    fog: scene.scene.fog,
    ambientColor: scene.ambientLight.color.clone(),
    ambientIntensity: scene.ambientLight.intensity,
    directionalColor: scene.directionalLight.color.clone(),
    directionalIntensity: scene.directionalLight.intensity,
    directionalPosition: scene.directionalLight.position.clone(),
    directionalTarget: scene.directionalLight.target.position.clone(),
    directionalCastShadow: scene.directionalLight.castShadow,
    toneMapping: scene.renderer.toneMapping,
    exposure: scene.renderer.toneMappingExposure,
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
}

export async function setupStageSelector() {
    try {
        const response = await fetch('./stages/catalog.json', { cache: 'no-cache' })
        if (response.ok) {
            const catalog = await response.json() as StageCatalog
            definitions = [
                ...builtInStages,
                ...(catalog.stages || []).filter(stage => !builtInStages.some(builtIn => builtIn.id === stage.id)),
            ]
            console.log('Loaded stage catalog:', {
                version: catalog.version,
                generatedAt: catalog.generatedAt,
                sourceRevision: catalog.sourceRevision,
                total: catalog.stages?.length ?? 0,
                official: catalog.stages?.filter(stage => stage.official).length ?? 0,
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
        return option
    }))
    stageSelector.addEventListener('change', () => void loadStageById(stageSelector.value))
    await loadStageById('sky-reference')
}

export async function loadStageById(id: string) {
    const definition = definitions.find(stage => stage.id === id) ?? builtInStages[0]
    const previousId = currentStageId
    stageSelector.disabled = true

    try {
        clearStageObject()
        restoreSceneProfile()
        if (definition.id === 'none') {
            currentStageId = definition.id
            activeStageDefinition = definition
            stageOptions.id = definition.id
            stageSelector.value = definition.id
            stageRoot.userData.stageDefinition = definition
            return
        }

        const object = definition.type === 'procedural'
            ? createProceduralStage(definition.preset ?? 'studio')
            : await loadExternalStage(definition)

        prepareStageObject(object)
        object.name = `Stage:${definition.id}`
        activeStageObject = object
        activeStageDefinition = definition
        stageRoot.add(object)

        currentStageId = definition.id
        stageOptions.id = definition.id
        stageSelector.value = definition.id
        stageRoot.userData.stageDefinition = definition
        stageRoot.userData.reDriveVolume = definition.renderProfile?.reDriveVolume ?? null
        stageRoot.userData.spawnPoints = definition.spawnPoints ?? []

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
        await applyStageRenderProfile(definition.renderProfile)
        stageFolder.controllersRecursive().forEach(controller => controller.updateDisplay())
    } catch (error) {
        console.error(`Could not load 3D stage "${definition.name}":`, error)
        stageSelector.value = previousId
        if (previousId && previousId !== definition.id) {
            await loadStageById(previousId)
        }
    } finally {
        stageSelector.disabled = false
    }
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

    characters.forEach((character, index) => {
        const spawn = spawns[index % spawns.length]
        const [x, y, z] = spawn.position
        const [rx, ry, rz] = spawn.rotation ?? [0, 0, 0]
        character!.object.position.set(x, y, z)
        character!.object.rotation.set(rx, ry, rz)
        if (spawn.scale != undefined) character!.object.scale.setScalar(spawn.scale)
    })
}

function updateStageTransform() {
    stageRoot.position.set(stageOptions.X, stageOptions.Y, stageOptions.Z)
    stageRoot.rotation.y = THREE.MathUtils.degToRad(stageOptions.RotateY)
    stageRoot.scale.setScalar(stageOptions.Scale)
    stageRoot.visible = stageOptions.Visible
}

function clearStageObject() {
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
}

function prepareStageObject(object: THREE.Object3D) {
    const maxAnisotropy = scene.renderer.capabilities.getMaxAnisotropy()
    object.traverse(child => {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.castShadow = true
        mesh.receiveShadow = true
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
    object.traverse(child => {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.geometry?.dispose()
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        materials.forEach(material => {
            Object.values(material).forEach(value => {
                if (value instanceof THREE.Texture) value.dispose()
            })
            material.dispose()
        })
    })
}

async function loadExternalStage(definition: StageDefinition): Promise<THREE.Object3D> {
    if (definition.type === 'group') {
        if (!definition.assets?.length) throw new Error(`Stage ${definition.id} has no asset parts`)
        const group = new THREE.Group()
        group.name = `StageParts:${definition.id}`
        const parts = await Promise.all(definition.assets.map(loadExternalStageAsset))
        parts.forEach(part => group.add(part))
        return group
    }

    if (!definition.url) throw new Error(`Stage ${definition.id} has no URL`)
    return loadExternalStageAsset({
        id: definition.id,
        type: definition.type as StageAssetType,
        url: definition.url,
    })
}

async function loadExternalStageAsset(definition: StageAssetDefinition): Promise<THREE.Object3D> {
    const url = new URL(definition.url, document.baseURI).href
    const object = definition.type === 'gltf'
        ? (await new GLTFLoader().loadAsync(url)).scene
        : await (async () => {
            const blob = await fetchAndTryDecompressGzip(url)
            const arrayBuffer = await blob.arrayBuffer()
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

async function loadProfileTexture(url: string, mapping: THREE.Mapping) {
    const texture = await new THREE.TextureLoader().loadAsync(new URL(url, document.baseURI).href)
    texture.mapping = mapping
    texture.colorSpace = THREE.SRGBColorSpace
    texture.needsUpdate = true
    activeProfileTextures.push(texture)
    return texture
}

async function applyStageRenderProfile(profile?: StageRenderProfile) {
    if (!profile) return

    if (profile.backgroundColor) {
        scene.scene.background = new THREE.Color(profile.backgroundColor)
    }
    if (profile.backgroundTextureUrl) {
        scene.scene.background = await loadProfileTexture(
            profile.backgroundTextureUrl,
            THREE.EquirectangularReflectionMapping,
        )
    }
    if (profile.environmentTextureUrl) {
        scene.scene.environment = await loadProfileTexture(
            profile.environmentTextureUrl,
            THREE.EquirectangularReflectionMapping,
        )
    }
    if (profile.environmentIntensity != undefined) {
        ;(scene.scene as THREE.Scene & { environmentIntensity?: number }).environmentIntensity = profile.environmentIntensity
    }

    if (profile.fog === null) {
        scene.scene.fog = null
    } else if (profile.fog) {
        scene.scene.fog = new THREE.Fog(profile.fog.color, profile.fog.near, profile.fog.far)
    }

    if (profile.ambientLight) {
        scene.ambientLight.color.set(profile.ambientLight.color)
        scene.ambientLight.intensity = profile.ambientLight.intensity
    }
    if (profile.directionalLight) {
        scene.directionalLight.color.set(profile.directionalLight.color)
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
        scene.effects.bloomPass.strength = profile.bloom.strength
        scene.effects.bloomPass.radius = profile.bloom.radius
        scene.effects.bloomPass.threshold = profile.bloom.threshold
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
    applyReDriveVolumeRuntime(
        profile.reDriveVolume as ReDriveVolumeRuntimeProfile | undefined,
    )
}

function restoreSceneProfile() {
    resetReDriveVolumeRuntime()
    scene.scene.background = initialSceneState.background
    scene.scene.environment = initialSceneState.environment
    scene.scene.fog = initialSceneState.fog
    scene.ambientLight.color.copy(initialSceneState.ambientColor)
    scene.ambientLight.intensity = initialSceneState.ambientIntensity
    scene.directionalLight.color.copy(initialSceneState.directionalColor)
    scene.directionalLight.intensity = initialSceneState.directionalIntensity
    scene.directionalLight.position.copy(initialSceneState.directionalPosition)
    scene.directionalLight.target.position.copy(initialSceneState.directionalTarget)
    scene.directionalLight.castShadow = initialSceneState.directionalCastShadow
    scene.directionalLight.target.updateMatrixWorld()
    scene.renderer.toneMapping = initialSceneState.toneMapping
    scene.renderer.toneMappingExposure = initialSceneState.exposure
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
    applyStagePreset,
    placeCharactersAtStageSpawns,
})
