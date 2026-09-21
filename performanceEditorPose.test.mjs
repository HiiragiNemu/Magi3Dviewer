import assert from 'node:assert/strict'
import test from 'node:test'
import { Bone, Group, Quaternion, Vector3 } from 'three'
import { applyTransform, blendPose, captureTransform, clonePose, solveTwoLinkIK } from './src/viewer/performanceEditor/pose.ts'

const transform = (x = 0, rotation = [0, 0, 0, 1]) => ({ position: [x, 0, 0], rotation, scale: [1, 1, 1] })
const pose = (x = 0) => ({ root: transform(x), bones: { arm: transform(x) }, morphs: { smile: x } })
const near = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`)

function rig() {
    const actor = new Group()
    const root = new Bone()
    const joint = new Bone()
    const end = new Bone()
    actor.add(root)
    root.add(joint)
    joint.add(end)
    joint.position.set(1, 0, 0)
    end.position.set(1, 0, 0)
    return { actor, root, joint, end }
}

function snapshot(rig) {
    return [rig.actor, rig.root, rig.joint, rig.end].map(object => ({
        transform: captureTransform(object), matrix: object.matrix.toArray(), world: object.matrixWorld.toArray(),
        dirty: object.matrixWorldNeedsUpdate,
    }))
}

test('transform capture is detached and apply validates every field before mutation', () => {
    const object = new Group()
    const saved = captureTransform(object)
    saved.position[0] = 9
    assert.equal(object.position.x, 0)
    applyTransform(object, transform(3, [0, 0, 0, 2]))
    assert.equal(object.position.x, 3)
    near(object.quaternion.length(), 1)
    const before = captureTransform(object)
    for (const invalid of [
        { ...transform(8), scale: [1, NaN, 1] },
        { ...transform(8), position: [Infinity, 0, 0] },
        transform(8, [0, 0, 0, 0]),
        transform(8, [NaN, 0, 0, 1]),
    ]) {
        assert.throws(() => applyTransform(object, invalid), TypeError)
        assert.deepEqual(captureTransform(object), before)
    }
})

test('clone and blend preserve signed morphs, target ownership and dictionary intersection', () => {
    const source = pose(-1)
    source.bones.sourceOnly = transform(5)
    const target = { bones: { arm: transform(4), missing: transform(8) }, morphs: { smile: 2, missing: 3 } }
    const copy = clonePose(source)
    copy.bones.arm.position[0] = 99
    assert.equal(source.bones.arm.position[0], -1)
    const result = blendPose(source, target, 0.5)
    assert.deepEqual(Object.keys(result.bones), ['arm'])
    assert.deepEqual(Object.keys(result.morphs), ['smile'])
    assert.equal(result.root, undefined)
    near(result.bones.arm.position[0], 1.5)
    near(result.morphs.smile, 0.5)
    assert.deepEqual(blendPose({ bones: {}, morphs: {} }, pose(), 0), { bones: {}, morphs: {} })
    const dangerousNames = JSON.parse('{"bones":{"__proto__":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]}},"morphs":{"constructor":2}}')
    assert.deepEqual(blendPose(dangerousNames, dangerousNames, 0), dangerousNames)
})

test('all non-finite pose and blend values are rejected', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
        assert.throws(() => blendPose(pose(), pose(), value), TypeError)
        assert.throws(() => clonePose({ bones: {}, morphs: { smile: value } }), TypeError)
        assert.throws(() => blendPose(pose(), { bones: { arm: transform(value) }, morphs: {} }, 0), TypeError)
    }
    assert.deepEqual(blendPose(pose(2), pose(8), -1), pose(2))
    assert.deepEqual(blendPose(pose(2), pose(8), 2), pose(8))
})

test('interrupted and retriggered transitions start at the current evaluated pose', () => {
    const current = blendPose(pose(2), pose(10), 0.375)
    assert.deepEqual(blendPose(current, pose(-4), 0), current)
    const interrupted = blendPose(current, pose(-4), 0.2)
    assert.deepEqual(blendPose(interrupted, pose(-4), 0), interrupted)
    assert.deepEqual(blendPose(interrupted, pose(-4), 1), pose(-4))
})

test('rotation blend uses normalized shortest-arc SLERP', () => {
    const a = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI * 170 / 180)
    const b = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI * 170 / 180)
    const result = blendPose({ bones: { arm: transform(0, a.toArray()) }, morphs: {} },
        { bones: { arm: transform(0, b.toArray().map(value => -2 * value)) }, morphs: {} }, 0.5)
    const q = new Quaternion(...result.bones.arm.rotation)
    near(q.length(), 1)
    near(Math.abs(q.y), 1)
    near(Math.abs(q.w), 0)
})

test('pose application and IK isolate two instances of the same rig', () => {
    const a = rig()
    const b = rig()
    const beforeB = snapshot(b)
    applyTransform(a.actor, transform(3))
    const result = solveTwoLinkIK(a.root, a.joint, a.end, new Vector3(4, 1, 0), new Vector3(3, 0, 1))
    assert.equal(result.status, 'ready')
    assert.deepEqual(snapshot(b), beforeB)
    assert.equal(a.actor.position.x, 3)
})

test('IK reaches a world target under rotated and uniformly scaled ancestors without changing lengths or placement', () => {
    const chain = rig()
    chain.actor.position.set(4, -2, 1)
    chain.actor.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), 0.6)
    chain.actor.scale.setScalar(2)
    const before = [chain.actor, chain.root, chain.joint, chain.end].map(captureTransform)
    const target = new Vector3(5, 0, 2)
    const result = solveTwoLinkIK(chain.root, chain.joint, chain.end, target, new Vector3(3, 1, 4))
    assert.equal(result.status, 'ready')
    assert.equal(result.value.clamped, false)
    near(chain.end.getWorldPosition(new Vector3()).distanceTo(target), 0)
    for (const [index, object] of [chain.actor, chain.root, chain.joint, chain.end].entries()) {
        assert.deepEqual(captureTransform(object).position, before[index].position)
        assert.deepEqual(captureTransform(object).scale, before[index].scale)
    }
    assert.deepEqual(captureTransform(chain.actor), before[0])
    assert.deepEqual(captureTransform(chain.end).rotation, before[3].rotation)
    near(chain.root.getWorldPosition(new Vector3()).distanceTo(chain.joint.getWorldPosition(new Vector3())), 2)
    near(chain.joint.getWorldPosition(new Vector3()).distanceTo(chain.end.getWorldPosition(new Vector3())), 2)
})

test('IK clamps unreachable outer and inner targets and handles an equal-length folded target', () => {
    for (const [length, target, expected] of [[1, new Vector3(8, 0, 0), 2], [0.5, new Vector3(0, 0, 0), 0.5]]) {
        const chain = rig()
        chain.end.position.x = length
        const result = solveTwoLinkIK(chain.root, chain.joint, chain.end, target)
        assert.equal(result.status, 'ready')
        assert.equal(result.value.clamped, true)
        near(result.value.distance, expected)
        near(chain.end.getWorldPosition(new Vector3()).length(), expected)
    }
    const chain = rig()
    const folded = solveTwoLinkIK(chain.root, chain.joint, chain.end, new Vector3())
    assert.equal(folded.status, 'ready')
    near(chain.end.getWorldPosition(new Vector3()).length(), 0)
})

test('invalid, missing, degenerate and unsupported-scale IK chains have zero mutation', () => {
    for (const kind of ['zero', 'missing', 'target', 'pole', 'scale', 'quaternion', 'manual-matrix']) {
        const chain = rig()
        if (kind === 'zero') chain.joint.position.set(0, 0, 0)
        if (kind === 'missing') chain.actor.add(chain.end)
        if (kind === 'scale') chain.actor.scale.set(1, 2, 1)
        if (kind === 'quaternion') chain.root.quaternion.set(0, 0, 0, 0)
        if (kind === 'manual-matrix') chain.root.matrixAutoUpdate = false
        const before = [chain.actor, chain.root, chain.joint, chain.end].map(object => ({
            p: object.position.toArray(), q: object.quaternion.toArray(), s: object.scale.toArray(),
            m: object.matrix.toArray(), w: object.matrixWorld.toArray(), dirty: object.matrixWorldNeedsUpdate,
        }))
        const result = solveTwoLinkIK(chain.root, chain.joint, chain.end,
            new Vector3(kind === 'target' ? NaN : 1, 1, 0), kind === 'pole' ? new Vector3(Infinity, 0, 0) : undefined)
        assert.equal(result.status, 'unavailable', kind)
        assert.deepEqual([chain.actor, chain.root, chain.joint, chain.end].map(object => ({
            p: object.position.toArray(), q: object.quaternion.toArray(), s: object.scale.toArray(),
            m: object.matrix.toArray(), w: object.matrixWorld.toArray(), dirty: object.matrixWorldNeedsUpdate,
        })), before, kind)
    }
    assert.equal(solveTwoLinkIK(null, null, null, new Vector3()).status, 'unavailable')
})
