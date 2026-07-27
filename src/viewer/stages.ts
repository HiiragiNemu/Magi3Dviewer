import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { fetchAndTryDecompressGzip } from 'magia-exedra-character-three/utils'
import { scene } from './scene'
import { gui } from './controllers/GUI'

export interface StageDefinition {
    id: string
    name: string
    type: 'procedural' | 'gltf' | 'fbx'
    preset?: 'official-sky' | 'studio' | 'battle-arena'
    url?: string
    scale?: number
    position?: [number, number, number]
    rotation?: [number, number, number]
    credit?: string
}

interface StageCatalog {
    version: number
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
    { id: 'none', name: 'No 3D stage', type: 'procedural' },
    { id: 'official-sky', name: 'Official-style blue sky pavilion', type: 'procedural', preset: 'official-sky' },
    { id: 'studio', name: 'Neutral shader studio', type: 'procedural', preset: 'studio' },
    { id: 'battle-arena', name: 'Battle arena prototype', type: 'procedural', preset: 'battle-arena' },
]

const stageSelector = document.getElementById('stage-selector') as HTMLSelectElement
const stageRoot = new THREE.Group()
stageRoot.name = 'Magius3DviewerStageRoot'
scene.scene.add(stageRoot)

const stageFolder = gui.addFolder('3D Stage').close()
const stageOptions: StagePreset & { Reset: () => void } = {
    id: 'official-sky',
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

let definitions = [...builtInStages]
let activeStageObject: THREE.Object3D | undefined
let currentStageId = 'none'

export async function setupStageSelector() {
    try {
        const response = await fetch('./stages/catalog.json', { cache: 'no-cache' })
        if (response.ok) {
            const catalog = await response.json() as StageCatalog
            definitions = [
                ...builtInStages,
                ...(catalog.stages || []).filter(stage => !builtInStages.some(builtIn => builtIn.id === stage.id)),
            ]
        }
    } catch (error) {
        console.warn('Could not load external stage catalog:', error)
    }

    stageSelector.replaceChildren(...definitions.map(definition => {
        const option = document.createElement('option')
        option.value = definition.id
        option.textContent = definition.name
        return option
    }))
    stageSelector.addEventListener('change', () => void loadStageById(stageSelector.value))
    await loadStageById('official-sky')
}

export async function loadStageById(id: string) {
    const definition = definitions.find(stage => stage.id === id) ?? builtInStages[0]
    currentStageId = definition.id
    stageOptions.id = definition.id
    stageSelector.value = definition.id

    clearStageObject()
    if (definition.id === 'none') return

    const object = definition.type === 'procedural'
        ? createProceduralStage(definition.preset ?? 'studio')
        : await loadExternalStage(definition)

    object.name = `Stage:${definition.id}`
    activeStageObject = object
    stageRoot.add(object)

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
    stageFolder.controllersRecursive().forEach(controller => controller.updateDisplay())
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

export async function applyStagePreset(preset?: Partial<StagePreset>) {
    if (!preset?.id) return
    await loadStageById(preset.id)
    Object.assign(stageOptions, preset)
    updateStageTransform()
    stageFolder.controllersRecursive().forEach(controller => controller.updateDisplay())
}

function updateStageTransform() {
    stageRoot.position.set(stageOptions.X, stageOptions.Y, stageOptions.Z)
    stageRoot.rotation.y = THREE.MathUtils.degToRad(stageOptions.RotateY)
    stageRoot.scale.setScalar(stageOptions.Scale)
    stageRoot.visible = stageOptions.Visible
}

function clearStageObject() {
    if (!activeStageObject) return
    stageRoot.remove(activeStageObject)
    disposeStageObject(activeStageObject)
    activeStageObject = undefined
}

function disposeStageObject(object: THREE.Object3D) {
    object.traverse(child => {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.geometry?.dispose()
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        materials.forEach(material => {
            Object.values(material).forEach(value => {
                if (value instanceof THREE.Texture) (value as THREE.Texture).dispose()
            })
            material.dispose()
        })
    })
}

async function loadExternalStage(definition: StageDefinition): Promise<THREE.Object3D> {
    if (!definition.url) throw new Error(`Stage ${definition.id} has no URL`)
    const url = new URL(definition.url, document.baseURI).href

    if (definition.type === 'gltf') {
        return (await new GLTFLoader().loadAsync(url)).scene
    }

    const blob = await fetchAndTryDecompressGzip(url)
    const blobUrl = URL.createObjectURL(blob)
    try {
        return await new FBXLoader().loadAsync(blobUrl)
    } finally {
        URL.revokeObjectURL(blobUrl)
    }
}

function createProceduralStage(preset: NonNullable<StageDefinition['preset']>): THREE.Group {
    if (preset === 'official-sky') return createOfficialSkyStage()
    if (preset === 'battle-arena') return createBattleArenaStage()
    return createStudioStage()
}

function createOfficialSkyStage() {
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

Object.assign(window, { loadStageById, getCurrentStagePreset, applyStagePreset })
