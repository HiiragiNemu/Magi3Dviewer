import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as THREE from 'three'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
import { loadStageTransformModules } from './tests/helpers/loadStageTransformModules.mjs'
const { batching: { hasStageRuntimeMeshWriters, batchStaticStageMeshes } } = loadStageTransformModules()

function fixture() {
    const root = new THREE.Group()
    for (let i = 0; i < 3; i++) {
        const material = new THREE.MeshStandardMaterial()
        material.userData.stageRigidBatchBinding = 'exact-static-test-binding'
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material)
        mesh.position.x = i * 2
        root.add(mesh)
    }
    return root
}

for (const [label, profile] of [
    ['absent', undefined], ['empty', {}],
    ['clock', { autoplay: false, loop: true, timeScale: 0, startTime: 20 }],
    ['particle-only', { particlePresets: [{ id: 'preset' }], particleSystems: [{ pathID: '1' }], particleMeshes: [] }],
    ['voice declaration', { voiceTracks: [{ id: 'v', url: '/not-fetched.ogg' }] }],
    ['serialized evidence without consumer', { serializedComponentClips: [{ bindings: [{ typeID: 4 }] }] }],
    ['known empty writer arrays', { clipNames: [], rotators: [], activationDirectors: [], gameObjectStates: [], animatorRandomizers: [], volumetricLightBeams: [], volumetricDustParticles: [] }],
]) test(`${label} does not reject an otherwise static stage`, () => {
    assert.equal(hasStageRuntimeMeshWriters(profile), false)
    const result = batchStaticStageMeshes(fixture(), { hasRuntimeOrTransformWriter: hasStageRuntimeMeshWriters(profile) })
    assert.equal(result.stats.batches, 1)
    assert.equal(result.stats.batchedSourceMeshes, 3)
    result.restore()
})

for (const [label, profile] of [
    ['declared missing FBX animation', { clipNames: ['not-currently-bound'] }],
    ['paused rotator', { autoplay: false, rotators: [{ hierarchyPath: 'not-bound', degreesPerSecond: [0, 0, 0] }] }],
    ['GameObject visibility restoration', { gameObjectStates: [{ hierarchyPath: 'root', activeSelf: true }] }],
    ['paused director', { activationDirectors: [{ initialState: 0, enabled: false, tracks: [] }] }],
    ['selected director', { activationDirectorPathID: 'unresolved' }],
    ['animator declaration', { animatorRandomizers: [{ enabled: false }] }],
    ['volumetric owner', { volumetricLightBeams: [{}] }],
    ['volumetric dust owner', { volumetricDustParticles: [{}] }],
    ['volumetric config', { volumetricLightBeamConfig: {} }],
    ['unknown future writer', { futureMaterialWriter: {} }],
    ['unknown empty field', { futureActivation: [] }],
]) test(`${label} retains the original unbatched path`, () => {
    assert.equal(hasStageRuntimeMeshWriters(profile), true)
    const root = fixture(), layers = root.children.map(n => n.layers.mask)
    const result = batchStaticStageMeshes(root, { hasRuntimeOrTransformWriter: hasStageRuntimeMeshWriters(profile) })
    assert.equal(result.stats.excludedDynamicStage, true)
    assert.equal(result.meshes.length, 0)
    assert.deepEqual(root.children.map(n => n.layers.mask), layers)
})

for (const kind of ['root animation', 'child animation', 'LOD', 'skin', 'morph']) test(`particle profile does not bypass ${kind} exclusion`, () => {
    const root = fixture()
    if (kind === 'root animation') root.animations.push(new THREE.AnimationClip('native', 1, []))
    if (kind === 'child animation') root.children[0].animations.push(new THREE.AnimationClip('native', 1, []))
    if (kind === 'LOD') root.add(new THREE.LOD())
    if (kind === 'skin') root.children.forEach(n => n.isSkinnedMesh = true)
    if (kind === 'morph') root.children.forEach(n => n.geometry.morphAttributes.position = [n.geometry.attributes.position.clone()])
    const result = batchStaticStageMeshes(root, { hasRuntimeOrTransformWriter: hasStageRuntimeMeshWriters({ particleSystems: [] }) })
    assert.equal(result.stats.batches, 0)
})

test('the exact stage caller consumes the gate without skipping runtime construction', () => {
    const stages = read('./src/viewer/stages.ts')
    assert.match(stages, /hasRuntimeOrTransformWriter: hasStageRuntimeMeshWriters\(definition\.runtime, true\)/)
    assert.match(stages, /activeStageRuntime = createStageRuntimeController\([\s\S]*?definition\.runtime,/)
    assert.match(stages, /activeStageVolumetricLightBeams = createStageVolumetricLightBeamController\(/)
})

test('component curves remain declaration-only in this owner, not silently treated as native parity', () => {
    const runtime = read('./src/viewer/stageRuntime.ts')
    assert.match(runtime, /serializedComponentClips\?: StageSerializedComponentClipProfile\[\]/)
    assert.doesNotMatch(runtime, /profile\.serializedComponentClips|profile\[['"]serializedComponentClips['"]\]/)
    assert.match(runtime, /this\.requestedClipNames = unique\(\[\s*\.\.\.\(profile\.clipNames \?\? \[\]\),/)
    assert.match(runtime, /object\.visible = profile\.activeSelf/)
    assert.match(runtime, /object\.quaternion\.multiply\(delta\)/)
})
