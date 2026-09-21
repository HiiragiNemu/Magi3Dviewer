import assert from 'node:assert/strict'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import * as THREE from 'three'

const { CharacterExpressionController } = await import(process.env.HOME_MORPH_SOURCE
    ? pathToFileURL(process.env.HOME_MORPH_SOURCE).href
    : './magia-exedra-character-three/homeRuntime.ts')

function fixture() {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
    mesh.name = 'Face_Mesh'
    mesh.morphTargetDictionary = {
        Brow: 0, Cheek: 1, Eyelid_Close_L: 2, Mouth_Open: 3,
        Mouth_Up_L: 4, Mouth_Down_L: 5, Signed: 6, Uncontrolled: 7,
    }
    mesh.morphTargetInfluences = [0, 0, 0, 0, 0, 0, 0, 0.33]
    const runtime = {
        schema: 1, characterId: 1, unityVersion: 'fixture', source: 'fixture',
        defaultExpression: 'Default', morphTargetCount: 8,
        expressionOrder: ['Default', 'Selected'], aliases: {},
        expressions: {
            Default: { duration: 0, weights: { Brow: 0.1, Cheek: 0.2, Signed: -1 } },
            Selected: { duration: 0, weights: { Brow: 0.9, Cheek: 0.8, Signed: 2 } },
        },
        blink: {
            duration: 0.1, weights: { Eyelid_Close_L: 1 },
            controller: {
                emptyExitTime: 0.2, fadeInSeconds: 0.1, blinkExitTime: 1,
                fadeOutSeconds: 0.1, afterBlinkExitTime: 0.2,
                afterBlinkTransitionSeconds: 0.1, intervalSpeed: 1,
                intervalExitTime: 0.5, intervalTransitionSeconds: 0.1,
            },
        },
        mouth: {
            duration: 2, curveTarget: 'Mouth_Open',
            curveSegments: [{ time: 0, coeff: [0, 0, 100, 0] }],
            constantWeights: {}, unresolvedAttributes: [],
        },
    }
    return { mesh, runtime, controller: new CharacterExpressionController([mesh], runtime) }
}

function binding(f, index = 0) {
    return { mesh: f.mesh, index, influences: f.mesh.morphTargetInfluences }
}

function acquire(f, bindings = [binding(f)], options = {}) {
    return f.controller.acquireMorphChannels({
        bindings, releaseTransitionSeconds: 1, isCurrent: () => true, ...options,
    })
}

function ready(result) {
    assert.equal(result.status, 'ready', JSON.stringify(result))
    assert.equal(typeof result.release, 'function')
    return result
}

function unavailable(result, reason) {
    assert.deepEqual(result, { status: 'unavailable', reason })
}

function near(actual, expected) {
    assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`)
}

test('lease requires existing positive finite caller timing, live generation, and owned storage', () => {
    const f = fixture()
    for (const seconds of [undefined, 0, -1, NaN, Infinity]) {
        unavailable(acquire(f, [binding(f)], { releaseTransitionSeconds: seconds }), 'transition-unavailable')
    }
    unavailable(acquire(f, []), 'empty-bindings')
    unavailable(acquire(f, [binding(f)], { isCurrent: () => false }), 'stale')
    unavailable(acquire(f, [binding(f)], { isCurrent: () => { throw new Error('disposed') } }), 'stale')
    for (const index of [-1, 0.5, 7, 8, NaN]) unavailable(acquire(f, [binding(f, index)]), 'invalid-binding')
    unavailable(acquire(f, [{ ...binding(f), influences: [...f.mesh.morphTargetInfluences] }]), 'invalid-binding')
    ready(acquire(f)).release()
})

test('every native setter yields only its exact leased slot while blink and nonleased mouth keep running', () => {
    const f = fixture()
    const native = fixture()
    const lease = ready(acquire(f))
    f.mesh.morphTargetInfluences[0] = 3
    const actions = [
        c => { c.mouthOpen = true; c.update(0.25) },
        c => c.set('Selected', true), c => c.setExpressionTransitionSeconds(0.8),
        c => c.setExpressionWeight(0.5), c => c.setMouthCornerWeight(0.6),
        c => c.setManualBlinkWeight(0.7), c => c.setAutomaticBlink(false),
        c => c.setAutomaticBlink(true), c => c.update(0.05),
        c => c.resetToDefault(), c => c.set('HomeFace00_Default'),
    ]
    for (const action of actions) {
        action(f.controller)
        action(native.controller)
        assert.equal(f.mesh.morphTargetInfluences[0], 3)
        assert.deepEqual(f.mesh.morphTargetInfluences.slice(1), native.mesh.morphTargetInfluences.slice(1))
    }
    assert.ok(f.mesh.morphTargetInfluences[2] > 0)
    near(f.mesh.morphTargetInfluences[3], 0.3)
    assert.equal(f.mesh.morphTargetInfluences[7], 0.33)
    lease.release()
})

test('partial unknown, duplicate, and overlapping acquisition leave no partial lease or lost return', () => {
    const f = fixture()
    const foreign = fixture()
    unavailable(acquire(f, [binding(f), binding(foreign)]), 'invalid-binding')
    f.controller.set('Selected')
    near(f.mesh.morphTargetInfluences[0], 0.9)
    const first = ready(acquire(f))
    unavailable(acquire(f, [binding(f, 3), binding(f)]), 'overlap')
    unavailable(acquire(f, [binding(f, 1), binding(f, 1)]), 'overlap')
    const mouth = ready(acquire(f, [binding(f, 3)]))
    const cheek = ready(acquire(f, [binding(f, 1)]))
    f.mesh.morphTargetInfluences[0] = 0.5
    first.release()
    unavailable(acquire(f, [binding(f), binding(foreign)]), 'invalid-binding')
    f.controller.update(0.5)
    near(f.mesh.morphTargetInfluences[0], 0.7)
    mouth.release()
    cheek.release()
})

test('equal-name actors and equal-name meshes remain distinct objects, not name-wide gates', () => {
    const a = fixture()
    const b = fixture()
    unavailable(acquire(a, [binding(b)]), 'invalid-binding')
    const pair = { ...a, controller: new CharacterExpressionController([a.mesh, b.mesh], a.runtime) }
    const lease = ready(acquire(pair, [binding(a)]))
    a.mesh.morphTargetInfluences[0] = 4
    pair.controller.set('Selected')
    assert.equal(a.mesh.morphTargetInfluences[0], 4)
    near(b.mesh.morphTargetInfluences[0], 0.9)
    lease.release()
})

test('reentrant acquisition is unavailable and callback exceptions never reserve a partial batch', () => {
    const f = fixture()
    let inner
    const lease = ready(acquire(f, [binding(f)], {
        isCurrent: () => { inner = acquire(f); return true },
    }))
    unavailable(inner, 'reentrant')
    f.mesh.morphTargetInfluences[0] = 1
    lease.release()
    unavailable(inner, 'reentrant')
    f.controller.update(0.5)
    unavailable(inner, 'reentrant')
    near(f.mesh.morphTargetInfluences[0], 0.55)
    unavailable(acquire(f, [binding(f, 1)], { isCurrent: () => { throw new Error('stale') } }), 'stale')
    ready(acquire(f, [binding(f, 1)])).release()
})

test('release reads displayed values once, preserves signed weights, and reaches continuing native targets', () => {
    const f = fixture()
    const native = fixture()
    f.controller.setExpressionTransitionSeconds(1)
    native.controller.setExpressionTransitionSeconds(1)
    const lease = ready(acquire(f, [binding(f), binding(f, 6)]))
    f.controller.set('Selected')
    native.controller.set('Selected')
    f.controller.update(0.25)
    native.controller.update(0.25)
    f.mesh.morphTargetInfluences[0] = -0.5
    f.mesh.morphTargetInfluences[6] = 3
    lease.release()
    near(f.mesh.morphTargetInfluences[0], -0.5)
    f.controller.update(0)
    near(f.mesh.morphTargetInfluences[0], -0.5)
    for (const [delta, progress] of [[0.25, 0.25], [0.25, 0.5], [0.5, 1]]) {
        f.controller.update(delta)
        native.controller.update(delta)
        near(f.mesh.morphTargetInfluences[0], THREE.MathUtils.lerp(-0.5, native.mesh.morphTargetInfluences[0], progress))
        near(f.mesh.morphTargetInfluences[6], THREE.MathUtils.lerp(3, native.mesh.morphTargetInfluences[6], progress))
    }
    assert.deepEqual(f.mesh.morphTargetInfluences, native.mesh.morphTargetInfluences)
})

test('release of a leased mouth follows its running curve, not a frozen release-time snapshot', () => {
    const f = fixture()
    const lease = ready(acquire(f, [binding(f, 3)], { releaseTransitionSeconds: 0.5 }))
    f.controller.mouthOpen = true
    f.controller.update(0.4)
    f.mesh.morphTargetInfluences[3] = 1.6
    lease.release()
    f.controller.update(0.25)
    near(f.mesh.morphTargetInfluences[3], (1.6 + 0.65) / 2)
    f.controller.update(0.25)
    near(f.mesh.morphTargetInfluences[3], 0.9)
})

test('interrupted and repeated releases preserve continuity and do not clear a newer lease', () => {
    const f = fixture()
    const first = ready(acquire(f))
    f.mesh.morphTargetInfluences[0] = 0.9
    first.release()
    f.controller.update(0.25)
    near(f.mesh.morphTargetInfluences[0], 0.7)
    first.release()
    f.controller.update(0.25)
    near(f.mesh.morphTargetInfluences[0], 0.5)
    const second = ready(acquire(f))
    f.controller.update(0.25)
    near(f.mesh.morphTargetInfluences[0], 0.5)
    f.mesh.morphTargetInfluences[0] = 0.8
    first.release()
    f.controller.update(0.25)
    near(f.mesh.morphTargetInfluences[0], 0.8)
    second.release()
    f.controller.update(0)
    near(f.mesh.morphTargetInfluences[0], 0.8)
    f.controller.update(0.5)
    near(f.mesh.morphTargetInfluences[0], 0.45)
    f.controller.update(0.5)
    near(f.mesh.morphTargetInfluences[0], 0.1)
})

test('array replacement never redirects the old controller or release into new storage', () => {
    const f = fixture()
    const old = binding(f)
    const lease = ready(acquire(f, [old]))
    old.influences[0] = 0.8
    const replacement = Array(8).fill(0.77)
    f.mesh.morphTargetInfluences = replacement
    unavailable(acquire(f, [binding(f)]), 'invalid-binding')
    lease.release()
    f.controller.set('Selected')
    f.controller.update(0.5)
    assert.deepEqual(replacement, Array(8).fill(0.77))
    near(old.influences[0], 0.8)
})

test('dictionary remapping and mesh replacement never make a retained channel follow a new target', () => {
    const f = fixture()
    const lease = ready(acquire(f))
    f.mesh.morphTargetDictionary.Brow = 7
    f.mesh.morphTargetInfluences[0] = 0.55
    f.mesh.morphTargetInfluences[7] = 0.66
    lease.release()
    f.controller.update(0.5)
    near(f.mesh.morphTargetInfluences[0], 0.55)
    near(f.mesh.morphTargetInfluences[7], 0.66)
    unavailable(acquire(f, [binding(f, 7)]), 'invalid-binding')
    const replacement = fixture()
    f.controller.meshes.splice(0, 1, replacement.mesh)
    replacement.mesh.morphTargetInfluences.fill(0.77)
    f.controller.update(0.5)
    assert.deepEqual(replacement.mesh.morphTargetInfluences, Array(8).fill(0.77))
})

test('stale and disposed callers release without writes and stale return callbacks reject remapped arrays', () => {
    const f = fixture()
    let current = true
    const lease = ready(acquire(f, [binding(f)], { isCurrent: () => current }))
    f.mesh.morphTargetInfluences[0] = 0.8
    current = false
    lease.release()
    near(f.mesh.morphTargetInfluences[0], 0.8)
    lease.release()
    unavailable(acquire(f, [binding(f)], { isCurrent: () => current }), 'stale')
    current = true
    const next = ready(acquire(f, [binding(f)], { isCurrent: () => current }))
    next.release()
    current = false
    f.controller.update(0.5)
    near(f.mesh.morphTargetInfluences[0], 0.8)
    const replacement = Array(8).fill(0.77)
    f.mesh.morphTargetInfluences = replacement
    f.controller.update(0.5)
    assert.deepEqual(replacement, Array(8).fill(0.77))
})

test('return validation rechecks storage after the caller callback and remembers the acquired timing', () => {
    const f = fixture()
    let replace = false
    const replacement = Array(8).fill(0.77)
    const lease = ready(acquire(f, [binding(f)], {
        releaseTransitionSeconds: 0.5,
        isCurrent: () => { if (replace) f.mesh.morphTargetInfluences = replacement; return true },
    }))
    f.mesh.morphTargetInfluences[0] = 0.9
    lease.release()
    f.controller.setExpressionTransitionSeconds(10)
    f.controller.update(0.25)
    near(f.mesh.morphTargetInfluences[0], 0.5)
    replace = true
    f.controller.update(0.25)
    assert.deepEqual(replacement, Array(8).fill(0.77))
})

test('evaluator-only return has no synchronous write or native blend and retains overlap until final release', () => {
    const f = fixture()
    const lease = ready(acquire(f, [binding(f)], { releaseTransitionSeconds: 0.18 }))
    f.controller.set('Selected')
    f.mesh.morphTargetInfluences[0] = 0.8
    assert.deepEqual(lease.releaseToEvaluator(), { status: 'ready' })
    near(f.mesh.morphTargetInfluences[0], 0.8)
    unavailable(acquire(f), 'overlap')
    f.controller.update(0.09)
    near(f.mesh.morphTargetInfluences[0], 0.9)
    assert.deepEqual(lease.releaseToEvaluator(), { status: 'ready' })
    f.mesh.morphTargetInfluences[0] = 0.85
    lease.release(); lease.release()
    near(f.mesh.morphTargetInfluences[0], 0.85)
    f.controller.update(0)
    near(f.mesh.morphTargetInfluences[0], 0.9)
    unavailable(lease.releaseToEvaluator(), 'released')
})

test('evaluator preparation is pure and rollback restores only the held mask without pose writes', () => {
    const f = fixture(), lease = ready(acquire(f))
    f.controller.set('Selected'); f.mesh.morphTargetInfluences[0] = 0.8
    const plan = lease.prepareReleaseToEvaluator()
    assert.equal(plan.status, 'ready')
    f.controller.update(0.1); near(f.mesh.morphTargetInfluences[0], 0.8)
    assert.deepEqual(plan.commit(), { status: 'ready' })
    near(f.mesh.morphTargetInfluences[0], 0.8)
    plan.rollback(); plan.rollback()
    f.controller.update(0.1); near(f.mesh.morphTargetInfluences[0], 0.8)
    assert.deepEqual(plan.commit(), { status: 'ready' })
    f.controller.update(0.1); near(f.mesh.morphTargetInfluences[0], 0.9)
    lease.release()
})

test('evaluator return revalidates stale actor and exact storage at prepare and commit', () => {
    for (const invalid of ['stale', 'array', 'dictionary']) {
        const f = fixture(); let current = true
        const lease = ready(acquire(f, [binding(f)], { isCurrent: () => current }))
        f.mesh.morphTargetInfluences[0] = 0.8
        const plan = lease.prepareReleaseToEvaluator(); assert.equal(plan.status, 'ready')
        if (invalid === 'stale') current = false
        if (invalid === 'array') f.mesh.morphTargetInfluences = Array(8).fill(0.77)
        if (invalid === 'dictionary') f.mesh.morphTargetDictionary.Brow = 7
        const reason = invalid === 'stale' ? 'stale' : 'invalid-binding'
        unavailable(plan.commit(), reason)
        unavailable(lease.releaseToEvaluator(), reason)
        near(f.mesh.morphTargetInfluences[0], invalid === 'array' ? 0.77 : 0.8)
        lease.release()
    }
})

test('evaluator phase retains live generation checks and stale updates leave both storage authorities untouched', () => {
    const f = fixture(); let current = true
    const old = f.mesh.morphTargetInfluences
    const lease = ready(acquire(f, [binding(f)], { isCurrent: () => current }))
    f.controller.set('Selected'); old[0] = 0.8
    assert.equal(lease.releaseToEvaluator().status, 'ready')
    current = false; f.controller.update(0.09); near(old[0], 0.8)
    const replacement = Array(8).fill(0.77); f.mesh.morphTargetInfluences = replacement
    current = true; f.controller.update(0.09)
    assert.deepEqual(replacement, Array(8).fill(0.77)); near(old[0], 0.8)
    lease.release()
})

test('old evaluator handles and preparations never alter a regrabbed mask or another actor', () => {
    const a = fixture(), b = fixture()
    const first = ready(acquire(a)); const plan = first.prepareReleaseToEvaluator()
    assert.equal(plan.status, 'ready'); assert.equal(plan.commit().status, 'ready')
    first.release()
    const second = ready(acquire(a)); a.mesh.morphTargetInfluences[0] = 0.85
    plan.rollback(); first.release(); unavailable(plan.commit(), 'released')
    a.controller.set('Selected'); b.controller.set('Selected')
    near(a.mesh.morphTargetInfluences[0], 0.85); near(b.mesh.morphTargetInfluences[0], 0.9)
    second.release()
})

test('evaluator-only signed and running-mouth targets remain fresh while unrelated channels are native', () => {
    const f = fixture(), native = fixture()
    const lease = ready(acquire(f, [binding(f, 3), binding(f, 6)]))
    for (const c of [f.controller, native.controller]) { c.mouthOpen = true; c.set('Selected') }
    f.mesh.morphTargetInfluences[3] = 4; f.mesh.morphTargetInfluences[6] = -3
    assert.equal(lease.releaseToEvaluator().status, 'ready')
    for (const dt of [0.09, 0.09, 0.2]) {
        f.controller.update(dt); native.controller.update(dt)
        assert.deepEqual(f.mesh.morphTargetInfluences, native.mesh.morphTargetInfluences)
    }
    lease.release()
})
