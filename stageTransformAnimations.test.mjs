import assert from 'node:assert/strict'
import test from 'node:test'
import { loadStageTransformModules } from './tests/helpers/loadStageTransformModules.mjs'
const { THREE, bridge, batching } = loadStageTransformModules()
const constant = value => [{ time: 0, value, storage: 'constant' }]
function fixture(mixed = false) {
    const root = new THREE.Group(); root.name = 'Fixture'
    const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial()
    material.userData.stageRigidBatchBinding = 'unit-fixture'
    material.lightMap = new THREE.Texture()
    const joints = [], sources = []
    for (let i = 0; i < 3; i++) {
        const carrier = new THREE.Group(); carrier.name = 'Carrier'; carrier.position.x = i * 3
        if (mixed && i === 2) carrier.scale.set(2, 1, 1)
        const joint = new THREE.Group(); joint.name = 'Joint'; joint.position.y = 2
        const source = new THREE.Mesh(geometry, material); source.castShadow = source.receiveShadow = true
        joint.add(source); carrier.add(joint); root.add(carrier); joints.push(joint); sources.push(source)
    }
    const profile = {
        schemaVersion: 1, sourceBundleSHA256: 'a'.repeat(64), coordinateConvention: 'unity-reflect-x',
        carrierPolicy: 'preserve-rendered-carriers-including-native-inactive',
        clips: [{ id: 'clip', name: 'Unit', sourceClipPathID: '1', duration: 2, startTime: 0, loop: true, speed: 1, cycleOffset: 0,
            bindings: [{ relativePath: 'Joint', transformPathHash: 0, attribute: 4, eulerAxis: 1,
                curves: [constant(0), [{ time: 0, value: 0, storage: 'streamed', coefficients: [0, 0, -180, 0] },
                    { time: 2, value: -360, storage: 'streamed', coefficients: [0, 0, 0, -360] }], constant(0)] }] }],
        groups: [{ hierarchyPath: 'Fixture/Carrier', clipId: 'clip', expectedCarrierCount: 3,
            sources: [0, 1, 2].map(i => ({ animatorPathID: String(i), gameObjectPathID: String(i + 10),
                controllerPathID: '100', clipId: 'clip', enabled: true, activeInHierarchy: i !== 2 })),
            authority: 'same-absolute-rotation-fields' }],
    }
    return { root, joints, sources, geometry, material, profile }
}
function player(f) {
    const plan = bridge.prepareStageTransformAnimations(f.root, f.profile)
    const mixer = new THREE.AnimationMixer(f.root)
    for (const { clip } of plan.clips) mixer.clipAction(clip).play()
    plan.claim()
    return { plan, seek(t) { mixer.setTime(t); plan.updateBatches() }, dispose() {
        mixer.stopAllAction(); mixer.uncacheRoot(f.root); plan.dispose()
    } }
}
test('authored polynomial/dense channels and full-turn Euler retain intermediate motion', () => {
    assert.equal(bridge.evaluateStageTransformScalar([{ time: 0, value: 5, storage: 'streamed', coefficients: [2, -3, 4, 5] },
        { time: 1, value: 8, storage: 'streamed', coefficients: [0, 0, 0, 8] }], .25), 5.84375)
    assert.equal(bridge.evaluateStageTransformScalar([{ time: 0, value: 0, storage: 'dense' },
        { time: 1, value: 10, storage: 'dense' }], .25), 2.5)
    const f = fixture(), p = player(f); p.seek(.5)
    for (const joint of f.joints) assert(joint.quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)) < 1e-6)
    assert.equal(p.plan.debug.nativeInactiveSourcesAnimated, 1)
    p.dispose(); f.joints.forEach(j => assert.deepEqual(j.quaternion.toArray(), [0, 0, 0, 1]))
})
test('matrix updates retain count/material/shadows, bounds and exact disposal bytes', () => {
    const f = fixture(), originalPositions = f.joints.map(j => j.position.toArray())
    const batch = batching.batchStaticStageMeshes(f.root, { hasRuntimeOrTransformWriter: false, transformAnimations: f.profile })
    assert.equal(batch.stats.batches, 1); assert.equal(batch.stats.animatedBatchedMeshes, 3)
    const mesh = batch.meshes[0], array = mesh.instanceMatrix.array, original = array.slice(), box = mesh.boundingBox, sphere = mesh.boundingSphere
    const p = player(f); p.seek(.5)
    assert.equal(mesh.count, 3); assert.equal(mesh.geometry, f.geometry); assert.equal(mesh.material, f.material)
    assert(mesh.castShadow && mesh.receiveShadow); assert.equal(mesh.boundingBox, box); assert.equal(mesh.boundingSphere, sphere)
    assert.equal(mesh.instanceMatrix.array, array); assert.notDeepEqual(array, original)
    const local = new THREE.Matrix4(), expected = new THREE.Matrix4(), inverse = f.root.matrixWorld.clone().invert()
    for (let i = 0; i < 3; i++) {
        mesh.getMatrixAt(i, local); expected.multiplyMatrices(inverse, f.sources[i].matrixWorld)
        assert(local.elements.every((v, j) => Math.abs(v - expected.elements[j]) < 1e-6))
        const bound = f.geometry.boundingBox.clone().applyMatrix4(local); assert(box.containsBox(bound))
        const boundSphere = f.geometry.boundingSphere.clone().applyMatrix4(local)
        assert(boundSphere.center.distanceTo(sphere.center) + boundSphere.radius <= sphere.radius + 1e-6)
    }
    const updates = batch.stats.matrixUpdateCalls; p.seek(.5); assert.equal(batch.stats.matrixUpdateCalls, updates)
    assert.deepEqual(f.joints.map(j => j.position.toArray()), originalPositions)
    p.dispose(); assert.deepEqual(array, original); batch.restore(); batch.restore()
    f.sources.forEach(s => { assert.equal(s.layers.mask, 1); assert.equal(s.visible, true) })
    assert.equal(f.root.children.length, 3)
})
test('nonuniform local ancestor retains its source while compatible siblings remain instanced', () => {
    const f = fixture(true), batch = batching.batchStaticStageMeshes(f.root, { hasRuntimeOrTransformWriter: false, transformAnimations: f.profile, minimumGroup: 2 })
    assert.equal(batch.stats.animatedBatchedMeshes, 2); assert.equal(batch.stats.excludedAnimatedMeshes, 1)
    assert.equal(f.sources[2].layers.mask, 1); const p = player(f); p.seek(.5); assert(Math.abs(f.joints[2].quaternion.y) > .7)
    p.dispose(); batch.restore()
})
test('duplicate matrix/runtime writers and non-equivalent certificates fail before graph mutation', () => {
    const f = fixture(), batch = batching.batchStaticStageMeshes(f.root, { hasRuntimeOrTransformWriter: false, transformAnimations: f.profile })
    const children = [...f.root.children], layers = f.sources.map(s => s.layers.mask)
    assert.throws(() => batching.batchStaticStageMeshes(f.root, { hasRuntimeOrTransformWriter: false, transformAnimations: f.profile }), /duplicate instance-matrix owner/)
    assert.deepEqual(f.root.children, children); assert.deepEqual(f.sources.map(s => s.layers.mask), layers)
    const p = player(f); assert.throws(() => bridge.prepareStageTransformAnimations(f.root, f.profile), /duplicate runtime owner/)
    p.dispose(); batch.restore()
    const invalid = structuredClone(f.profile); invalid.groups[0].sources[0].clipId = 'different'
    assert.throws(() => bridge.prepareStageTransformAnimations(f.root, invalid), /non-equivalent/)
    assert.throws(() => bridge.prepareStageTransformAnimations(f.root, f.profile, true), /rotator writer/)
    f.root.animations.push(new THREE.AnimationClip('existing', 1, []))
    assert.throws(() => bridge.prepareStageTransformAnimations(f.root, f.profile), /loaded animation writer/)
})
test('non-loop authored speed and offset clamp and allow reverse seek', () => {
    const f = fixture(); f.profile.clips[0].speed = 2; f.profile.clips[0].cycleOffset = .25; f.profile.clips[0].loop = false
    const plan = bridge.prepareStageTransformAnimations(f.root, f.profile)
    const interpolant = plan.clips[0].clip.tracks[0].createInterpolant(new Float64Array(4))
    const end = [...interpolant.evaluate(5)], back = [...interpolant.evaluate(0)]
    assert(new THREE.Quaternion().fromArray(end).angleTo(new THREE.Quaternion().fromArray(back)) > 1)
    plan.dispose()
})
