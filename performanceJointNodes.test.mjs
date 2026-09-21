import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { registeredJointNodes, createJointNodeLayer, beginJointPointerDrag } from './src/viewer/performanceEditor/jointNodes.ts'
import { PerformanceActorAdapter } from './src/viewer/performanceEditor/actorAdapter.ts'

class Canvas {
    style = {}; listeners = new Map(); captures = new Set(); ownerDocument = { pointerLockElement: null }
    getRootNode() { return this.ownerDocument }
    getBoundingClientRect() { return { left: 40, top: 30, width: 800, height: 600, right: 840, bottom: 630 } }
    addEventListener(type, fn, capture = false) { const list = this.listeners.get(type) ?? []; list.push({ fn, capture: !!capture }); this.listeners.set(type, list) }
    removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(row => row.fn !== fn)) }
    setPointerCapture(id) { this.captures.add(id) }
    hasPointerCapture(id) { return this.captures.has(id) }
    releasePointerCapture(id) { this.captures.delete(id) }
    dispatch(type, properties = {}) {
        const event = { type, button: 0, isPrimary: true, pointerId: 7, pointerType: 'mouse', clientX: 440, clientY: 330,
            prevented: false, stopped: false, preventDefault() { this.prevented = true }, stopImmediatePropagation() { this.stopped = true }, ...properties }
        for (const row of [...this.listeners.get(type) ?? []].sort((a, b) => Number(b.capture) - Number(a.capture))) {
            if (event.stopped) break; row.fn(event)
        }
        return event
    }
    count() { return [...this.listeners.values()].reduce((sum, list) => sum + list.length, 0) }
}
function rig(label = 'same', overlap = false) {
    const object = new THREE.Group(), a = new THREE.Bone(), b = new THREE.Bone(), bare = new THREE.Bone()
    a.name = b.name = 'duplicate'; b.position.set(overlap ? 0 : 0.6, 0.5, 0); if (overlap) b.position.set(0, 0, 0)
    object.add(a, bare); a.add(b); object.updateMatrixWorld(true)
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3))
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0], 4)); geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0], 4))
    for (let i = 0; i < 2; i++) { const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial()); object.add(mesh); mesh.bind(new THREE.Skeleton([a, b])) }
    let current = true
    const descriptor = { object, label, generation: 1, actions: [], isCurrent: () => current }
    return { object, a, b, bare, descriptor, adapter: new PerformanceActorAdapter(descriptor), invalidate() { current = false } }
}
function fixture(overlap = false) {
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 4 / 3, 0.1, 100), canvas = new Canvas(), actor = rig('same', overlap)
    camera.position.set(0, 0, 5); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true); scene.add(actor.object)
    const actors = new Map([[actor.adapter.key, actor.adapter]]), subscriptions = new Set(), selectionListeners = new Set(), frames = new Set()
    let selection = { actorKey: actor.adapter.key, generation: 1, boneKey: [...actor.adapter.bones.keys()][0] }, ended = 0, blocked = false, candidates = [], choose, failure
    const selections = [], errors = []
    const runtime = { actors, subscribe: callback => { subscriptions.add(callback); return () => subscriptions.delete(callback) }, endDrag: () => { ended++ } }
    const layer = createJointNodeLayer({ scene, camera, canvas, runtime, selection: () => selection,
        subscribeSelection: fn => { selectionListeners.add(fn); return () => selectionListeners.delete(fn) },
        subscribeFrame: fn => { frames.add(fn); return () => frames.delete(fn) }, interactionBlocked: () => blocked,
        select: (identity, pointer) => { selections.push({ identity, pointer }); return failure ? { status: 'unavailable', reason: failure } : { status: 'ready', value: undefined } },
        showCandidates: (values, callback) => { candidates = values; choose = callback }, clearCandidates: () => { candidates = [] }, report: reason => errors.push(reason) })
    const screen = bone => { const v = bone.getWorldPosition(new THREE.Vector3()).project(camera), r = canvas.getBoundingClientRect(); return { clientX: r.left + (v.x + 1) * r.width / 2, clientY: r.top + (1 - v.y) * r.height / 2 } }
    return { scene, camera, canvas, actor, actors, layer, screen, selections, errors, frames, subscriptions, selectionListeners,
        setActor(next) { actors.set(next.adapter.key, next.adapter); scene.add(next.object); selection = { actorKey: next.adapter.key, generation: next.descriptor.generation, boneKey: [...next.adapter.bones.keys()][0] }; for (const fn of selectionListeners) fn() },
        frame() { for (const fn of frames) fn() }, invalidate() { actor.invalidate(); for (const fn of subscriptions) fn('actors') },
        setBlocked(value) { blocked = value }, setFailure(value) { failure = value }, get candidates() { return candidates }, get choose() { return choose }, get ended() { return ended } }
}
test('registered nodes deduplicate exact skin bones, exclude unbound helpers and keep duplicate names distinct', () => {
    const f = fixture(), rows = registeredJointNodes(f.actor.adapter)
    assert.equal(rows.length, 2); assert.equal(new Set(rows.map(row => row.identity.boneUuid)).size, 2)
    assert.ok(rows.every(row => row.bone !== f.actor.bare)); assert.notEqual(rows[0].identity.label, rows[1].identity.label)
    assert.ok(rows.every(row => row.identity.actorKey === f.actor.object.uuid && row.identity.generation === 1))
})
test('real scene/camera raycasting follows live bones without altering skin TRS or bone lengths', () => {
    const f = fixture(); f.actor.object.position.set(0.2, -0.1, 0); f.actor.object.rotation.z = 0.3; f.actor.object.scale.setScalar(1.4)
    f.actor.object.updateMatrixWorld(true)
    const before = f.actor.object.toJSON(); f.layer.setEnabled(true)
    assert.equal(f.layer.identities.length, 2)
    const hits = f.layer.pick(...Object.values(f.screen(f.actor.b)))
    assert.equal(hits.length, 1); assert.equal(hits[0].boneUuid, f.actor.b.uuid)
    assert.deepEqual(f.actor.object.toJSON(), before)
    f.actor.a.rotation.y = 0.6; f.frame()
    assert.equal(f.layer.pick(...Object.values(f.screen(f.actor.b)))[0].boneUuid, f.actor.b.uuid)
    f.layer.dispose()
})
test('overlapping registered nodes require exact selection instead of arbitrary hit-order binding', () => {
    const f = fixture(true); f.layer.setEnabled(true); const event = f.canvas.dispatch('pointerdown', f.screen(f.actor.a))
    assert.equal(event.prevented, true); assert.equal(f.selections.length, 0); assert.equal(f.candidates.length, 2)
    const expected = f.candidates.find(row => row.boneUuid === f.actor.b.uuid); f.choose(expected)
    assert.equal(f.selections[0].identity.boneUuid, f.actor.b.uuid); f.layer.dispose()
})
test('node hits own only their pointer; misses and existing gizmo ownership remain with Orbit/host', () => {
    const f = fixture(); let orbit = 0; f.canvas.addEventListener('pointerdown', () => { orbit++ }); f.layer.setEnabled(true)
    f.canvas.dispatch('pointerdown', { clientX: 55, clientY: 45 }); assert.equal(orbit, 1)
    const e = f.canvas.dispatch('pointerdown', f.screen(f.actor.b)); assert.equal(orbit, 1); assert.equal(f.selections[0].pointer, e)
    f.setBlocked(true); f.canvas.dispatch('pointerdown', f.screen(f.actor.b)); assert.equal(orbit, 2); assert.equal(f.selections.length, 1)
    f.layer.dispose()
})
test('provider failures are reported verbatim without a fallback mesh selection', () => {
    const f = fixture(); f.layer.setEnabled(true); f.setFailure('Voice pose-channel yield provider pending')
    f.canvas.dispatch('pointerdown', f.screen(f.actor.b)); assert.equal(f.errors.at(-1), 'Voice pose-channel yield provider pending'); f.layer.dispose()
})
test('close/reopen releases geometry and every layer listener/subscription, keeping original actor intact', () => {
    const f = fixture(); f.layer.setEnabled(true); const group = f.scene.getObjectByName('PerformanceJointNodes')
    let disposed = 0; const marker = group.children.find(node => node.isMesh); marker.geometry.addEventListener('dispose', () => disposed++)
    assert.equal(f.canvas.count(), 1); f.layer.setEnabled(false)
    assert.equal(disposed, 1); assert.equal(f.canvas.count(), 0); assert.equal(f.frames.size + f.subscriptions.size + f.selectionListeners.size, 0)
    assert.equal(f.scene.getObjectByName('PerformanceJointNodes'), undefined); assert.equal(f.actor.object.parent, f.scene)
    f.layer.setEnabled(true); assert.equal(f.layer.identities.length, 2); f.layer.dispose(); f.layer.dispose(); assert.equal(f.canvas.count(), 0)
})
test('switch/removal clears prior gizmo and rejects an old overlapping chooser by actor/generation', () => {
    const f = fixture(true); f.layer.setEnabled(true); f.canvas.dispatch('pointerdown', f.screen(f.actor.a)); const old = f.candidates[0], choose = f.choose
    const next = rig(); f.setActor(next); const ended = f.ended; choose(old)
    assert.equal(f.selections.length, 0); assert.match(f.errors.at(-1), /已变化/); assert.ok(ended >= 2)
    next.invalidate(); f.frame(); assert.equal(f.layer.identities.length, 0); assert.equal(f.scene.getObjectByName('PerformanceJointNodes'), undefined); f.layer.dispose()
})
test('unregistered model and off-camera nodes provide no false raycast target', () => {
    const f = fixture(); f.actor.object.children.filter(node => node.isSkinnedMesh).forEach(mesh => mesh.removeFromParent())
    f.layer.setEnabled(true); assert.equal(f.layer.identities.length, 0); assert.match(f.errors.at(-1), /蒙皮骨架/); f.layer.dispose()
    const back = fixture(); back.actor.object.position.z = 10; back.layer.setEnabled(true); assert.deepEqual(back.layer.pick(440, 330), []); back.layer.dispose()
})
for (const mode of ['joint', 'ik']) test(`original node pointer drives real TransformControls ${mode} proxy and releases on cancellation`, () => {
    const canvas = new Canvas(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 4 / 3, 0.1, 100)
    camera.position.z = 5; camera.updateMatrixWorld(true)
    const proxy = new THREE.Object3D(); scene.add(proxy)
    const control = new TransformControls(camera, canvas); scene.add(control.getHelper()); control.mode = mode === 'joint' ? 'rotate' : 'translate'; control.attach(proxy)
    const before = { p: proxy.position.clone(), q: proxy.quaternion.clone() }; let changes = 0, ended = 0
    control.addEventListener('objectChange', () => changes++); control.addEventListener('mouseUp', () => ended++)
    const release = beginJointPointerDrag(control, canvas, { pointerId: 7, clientX: 440, clientY: 330, button: 0 }, mode)
    assert.equal(control.dragging, true); assert.equal(canvas.hasPointerCapture(7), true)
    canvas.dispatch('pointermove', { clientX: 490, clientY: 350, button: -1 })
    assert.ok(changes > 0)
    if (mode === 'joint') { assert.ok(proxy.quaternion.angleTo(before.q) > 0.01); assert.deepEqual(proxy.position, before.p) }
    else { assert.ok(proxy.position.distanceTo(before.p) > 0.01); assert.deepEqual(proxy.quaternion.toArray(), before.q.toArray()) }
    canvas.dispatch('pointercancel'); assert.equal(ended, 1); assert.equal(control.dragging, false); assert.equal(canvas.hasPointerCapture(7), false)
    release(); control.dispose(); assert.equal(canvas.count(), 0)
})
