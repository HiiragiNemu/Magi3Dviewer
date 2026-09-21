import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { fetchAndTryDecompressGzip } from '../../magia-exedra-character-three/utils.ts'
import {
    CombatVfxCatalogClient,
    normalizeCombatVfxBundleKey,
} from '../viewer/combatVfxCatalog.ts'
import {
    createCombatVfxPreview,
    type CombatVfxPreviewHandle,
} from '../viewer/combatVfx.ts'
import { EnemyResourceManager } from '../viewer/enemies/index.ts'
import { loadStageCatalogTree } from '../viewer/stageCatalog.ts'
import {
    resolveCachedRuntimeAssetUrl,
    resolvePageAssetUrl,
    resolveRuntimeAssetUrl,
} from '../viewer/runtimeProductDelivery.ts'
import {
    applyStageMaterialBindings,
    type StageMaterialBinding,
} from '../viewer/stageMaterialBindings.ts'

interface PreviewStage {
    id: string
    stableKey: string
    name: string
    names?: { en?: string | null; ja?: string | null; zhHant?: string | null }
    type: 'fbx' | 'gltf'
    url: string
    sceneProfileUrl?: string
}

const identity = document.querySelector<HTMLDivElement>('#identity')!
const status = document.querySelector<HTMLDivElement>('#status')!
const error = document.querySelector<HTMLDivElement>('#error')!
const parameters = new URLSearchParams(location.search)
const kind = parameters.get('kind') ?? 'stage'
const key = parameters.get('key') ?? 'battle-612-00-00-002'

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1
document.body.prepend(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color('#121827')
scene.fog = new THREE.Fog('#121827', 35, 140)
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.05, 500)
camera.position.set(7, 5, 9)
const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 1.2, 0)
controls.enableDamping = true

scene.add(new THREE.HemisphereLight('#dce9ff', '#252839', 2.4))
const keyLight = new THREE.DirectionalLight('#ffffff', 3.2)
keyLight.position.set(-6, 9, 7)
scene.add(keyLight)
const rimLight = new THREE.DirectionalLight('#779cff', 1.4)
rimLight.position.set(7, 4, -6)
scene.add(rimLight)
scene.add(new THREE.GridHelper(30, 30, '#405274', '#263044'))

let preview: CombatVfxPreviewHandle | undefined
let mixer: THREE.AnimationMixer | undefined
let loadedRoot: THREE.Object3D | undefined

function frameObject(object: THREE.Object3D, fallbackSize = 5) {
    object.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(object)
    if (box.isEmpty()) return undefined
    return frameBounds(box, fallbackSize)
}

function frameBounds(box: THREE.Box3, fallbackSize = 5) {
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const radius = Math.max(fallbackSize, size.length() * 0.55)
    controls.target.copy(center)
    camera.position.copy(center).add(new THREE.Vector3(radius, radius * 0.55, radius))
    camera.near = Math.max(0.01, radius / 1000)
    camera.far = Math.max(500, radius * 20)
    camera.updateProjectionMatrix()
    controls.update()
    return { center, size, radius }
}

function frameVfx(actor: THREE.Object3D | undefined, handle: CombatVfxPreviewHandle) {
    const effect = handle.root
    effect.updateMatrixWorld(true)
    const box = actor
        ? new THREE.Box3().setFromObject(actor)
        : new THREE.Box3()
    const point = new THREE.Vector3()
    for (const clip of handle.product.timeline.controlClips) {
        const source = effect.getObjectByName(clip.source.name)
        if (source) box.expandByPoint(source.getWorldPosition(point))
        else if (clip.source.localPosition?.length === 3) {
            box.expandByPoint(point.fromArray(clip.source.localPosition))
        }
    }
    return box.isEmpty() ? undefined : frameBounds(box, 8)
}

async function loadFbx(url: string) {
    const canonical = resolvePageAssetUrl(url)
    const payload = await resolveRuntimeAssetUrl(canonical)
    const blob = await fetchAndTryDecompressGzip(payload)
    const manager = new THREE.LoadingManager()
    manager.setURLModifier(resolveCachedRuntimeAssetUrl)
    return new FBXLoader(manager).parse(
        await blob.arrayBuffer(),
        new URL('.', canonical).href,
    )
}

async function loadGltf(url: string) {
    const canonical = resolvePageAssetUrl(url)
    const response = await fetch(await resolveRuntimeAssetUrl(canonical))
    if (!response.ok) throw new Error(`stage GLTF HTTP ${response.status}`)
    const manager = new THREE.LoadingManager()
    manager.setURLModifier(resolveCachedRuntimeAssetUrl)
    return (await new GLTFLoader(manager).parseAsync(
        await response.text(),
        new URL('.', canonical).href,
    )).scene
}

async function loadStage(stageKey: string) {
    const catalog = await loadStageCatalogTree<PreviewStage>('/stages/catalog.json')
    const stage = catalog.stages.find(value => (
        value.id === stageKey || value.stableKey === stageKey
    ))
    if (!stage) throw new Error(`stage product not found: ${stageKey}`)
    if (stage.type === 'fbx') loadedRoot = await loadFbx(stage.url)
    else loadedRoot = await loadGltf(stage.url)
    let boundMaterials = 0
    if (stage.sceneProfileUrl) {
        const profileResponse = await fetch(
            await resolveRuntimeAssetUrl(stage.sceneProfileUrl),
        )
        if (!profileResponse.ok) throw new Error(`stage profile HTTP ${profileResponse.status}`)
        const profile = await profileResponse.json() as { materialBindings?: StageMaterialBinding[] }
        const bindingResult = await applyStageMaterialBindings(
            loadedRoot,
            profile.materialBindings,
            renderer,
        )
        boundMaterials = bindingResult.matchedMaterials.length
    }
    scene.add(loadedRoot)
    const frame = frameObject(loadedRoot, 18)
    // Official battle scenes can span several hundred Unity units. The small
    // character-preview fog range would otherwise hide the dependency-closed
    // scene completely even though all meshes loaded successfully.
    scene.fog = null
    identity.textContent = `${stage.name} / ${stage.names?.ja ?? stage.id}`
    status.textContent = [
        `kind=stage`,
        `id=${stage.id}`,
        `stableKey=${stage.stableKey}`,
        `meshes=${countMeshes(loadedRoot)}`,
        `boundMaterials=${boundMaterials}`,
        frame ? `bounds=${frame.size.toArray().map(value => value.toFixed(2)).join('x')}` : 'bounds=empty',
    ].join('\n')
}

function countMeshes(object: THREE.Object3D) {
    let count = 0
    object.traverse(child => { if ((child as THREE.Mesh).isMesh) count++ })
    return count
}

async function loadEnemy(enemyMstId: number) {
    const manager = new EnemyResourceManager()
    const catalog = await manager.ready()
    const entry = catalog.require(enemyMstId)
    loadedRoot = await manager.loadEnemy(enemyMstId)
    scene.add(loadedRoot)
    const clips = loadedRoot.animations
    if (clips.length) {
        mixer = new THREE.AnimationMixer(loadedRoot)
        mixer.clipAction(clips.find(clip => /wait/i.test(clip.name)) ?? clips[0]).play()
    }
    frameObject(loadedRoot, 3)
    identity.textContent = `${entry.names.en ?? entry.modelPrefabName} / ${entry.names.ja ?? ''}`
    status.textContent = [
        `kind=enemy`,
        `enemyMstId=${entry.enemyMstId}`,
        `model=${entry.modelPrefabName}`,
        `meshes=${countMeshes(loadedRoot)}`,
        `animations=${loadedRoot.animations.length}`,
    ].join('\n')
}

async function loadVfx(productKey: string) {
    const catalog = await new CombatVfxCatalogClient().ready()
    const entry = catalog.getByStableKey(productKey)
        ?? catalog.getByBundleKey(normalizeCombatVfxBundleKey(productKey))
    if (!entry) throw new Error(`VFX product not found: ${productKey}`)
    const enemyId = entry.domain === 'enemy'
        ? Number(entry.ownerKey.match(/^enemy_(\d+)/)?.[1])
        : NaN
    if (Number.isFinite(enemyId)) {
        const manager = new EnemyResourceManager()
        loadedRoot = await manager.loadEnemy(enemyId)
        scene.add(loadedRoot)
        const clips = loadedRoot.animations
        if (clips.length) {
            mixer = new THREE.AnimationMixer(loadedRoot)
            mixer.clipAction(clips.find(clip => /wait/i.test(clip.name)) ?? clips[0]).play()
        }
    }
    preview = await createCombatVfxPreview(entry.bundleKey, scene)
    // Seek directly into the first active interval, then include every effect
    // hierarchy transform when framing (particle controls often have no mesh
    // bounds until their first runtime update).
    preview.update(Math.min(1.55, preview.product.timeline.lifetimeSeconds * 0.55))
    const frame = frameVfx(loadedRoot, preview)
    const debug = preview.getDebugState()
    identity.textContent = `${entry.ownerKey} / ${entry.directionKey}`
    status.textContent = [
        `kind=vfx`,
        `stableKey=${entry.stableKey}`,
        `bundleKey=${entry.bundleKey}`,
        `particles=${entry.particleSystemCount}`,
        `textures=${entry.textureCount}`,
        `controls=${debug.activeControlCount}/${debug.controlCount}`,
        `activeParticles=${debug.activeParticleCount}`,
        `missingPaths=${debug.missingSourcePaths.length}`,
        frame ? `bounds=${frame.size.toArray().map(value => value.toFixed(2)).join('x')}` : 'bounds=empty',
        `runtime=playing`,
    ].join('\n')
}

async function main() {
    if (kind === 'stage') await loadStage(key)
    else if (kind === 'enemy') await loadEnemy(Number(key))
    else if (kind === 'vfx') await loadVfx(key)
    else throw new Error(`unknown preview kind: ${kind}`)
}

const clock = new THREE.Clock()
function render() {
    requestAnimationFrame(render)
    const delta = Math.min(clock.getDelta(), 1 / 15)
    controls.update()
    mixer?.update(delta)
    preview?.update(delta)
    renderer.render(scene, camera)
}
render()

addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
})

void main().catch(reason => {
    error.textContent = reason instanceof Error ? reason.stack ?? reason.message : String(reason)
})
