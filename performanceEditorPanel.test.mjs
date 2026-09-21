import assert from 'node:assert/strict'
import test from 'node:test'
import { Bone, Group } from 'three'
import { mountPerformanceEditor } from './src/viewer/performanceEditor/index.ts'
import { PerformanceActorAdapter } from './src/viewer/performanceEditor/actorAdapter.ts'

// Small DOM fixture for the scoped panel; browser interaction remains a separate gate.
class Element {
    constructor(tagName, ownerDocument) {
        Object.assign(this, { tagName, ownerDocument, children: [], attributes: {}, listeners: {}, style: {}, _value: '', textContent: '', disabled: false, checked: false, parent: null })
    }
    set value(value) { this._value = String(value) }
    get value() { return this._value || (this.tagName === 'select' ? this.children[0]?.value || '' : '') }
    setAttribute(name, value) { this.attributes[name] = value }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child) } }
    replaceChildren(...children) { for (const child of this.children) child.parent = null; this.children = []; this._value = ''; this.append(...children) }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback) }
    dispatch(type) { for (const listener of this.listeners[type] || []) listener({ target: this }) }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null }
    find(predicate) { if (predicate(this)) return this; for (const child of this.children) { const found = child.find(predicate); if (found) return found } }
}
function fixture(count = 2) {
    const document = { activeElement: null, createElement: tag => new Element(tag, document) }
    const container = document.createElement('aside'), callbacks = {}, descriptors = [], releases = [], evaluators = new Map()
    for (let i = 0; i < count; i++) {
        const object = new Group(), bone = new Bone(); bone.name = 'joint'; object.add(bone)
        const descriptor = { object, generation: 1, label: 'Same resource', actions: ['Action'], isCurrent: () => true }
        descriptors.push(descriptor)
        evaluators.set(object.uuid, new PerformanceActorAdapter({ ...descriptor, object: object.clone(true) }))
    }
    const editor = mountPerformanceEditor(container, {
        actorSource: { list: () => descriptors, subscribe: cb => { callbacks.actors = cb; return () => { delete callbacks.actors; releases.push('source') } } },
        framePort: { subscribeBeforePhysics: cb => { callbacks.body = cb; return () => delete callbacks.body }, subscribeFinalPoseBeforeCamera: cb => { callbacks.face = cb; return () => delete callbacks.face } },
        channelHost: { acquire: (actor, channels) => {
            let issued
            const lease = { active: true, captureEvaluated: () => editor.runtime.actors.get(actor.object.uuid).capture(channels),
                captureEvaluatorFrame: context => ({ status: 'ready', value: issued = { ...context, pose: evaluators.get(actor.object.uuid).capture(channels) } }),
                commitManualBody: (frame, pose) => { assert.equal(frame, issued); issued = undefined; editor.runtime.actors.get(actor.object.uuid).apply(pose, 'body'); return { status: 'ready', value: undefined } },
                playActionBeat() {}, sampleActionAt() {}, releaseFromEvaluated() {
                    lease.active = false
                    if (actor.isCurrent() && channels.exclusiveBones.length) editor.runtime.actors.get(actor.object.uuid)?.apply(evaluators.get(actor.object.uuid).capture(channels), 'body')
                } }
            return { status: 'ready', value: lease }
        }, notifyRootTransformChanged() {} },
        transformHost: { acquire: request => { callbacks.drag = request; return { status: 'ready', value: () => { if (callbacks.drag === request) delete callbacks.drag } } } },
        transitionSeconds: 0,
    })
    const byLabel = label => container.find(node => node.attributes['aria-label'] === label)
    const click = label => { const button = container.find(node => node.tagName === 'button' && node.textContent === label); assert.ok(button, label); button.dispatch('click') }
    let frameId = 0
    const frame = () => { ++frameId; for (const actor of descriptors) callbacks.body(0, { frameId, actorKey: actor.object.uuid, generation: actor.generation }); callbacks.face() }
    return { editor, container, descriptors, callbacks, releases, byLabel, click, frame }
}
test('scoped panel completes two-actor key editing, playback, scrub, save/load and disposal', () => {
    const f = fixture(), first = f.descriptors[0].object, second = f.descriptors[1].object
    assert.equal(f.byLabel('Performance actor').children.length, 2)
    f.byLabel('Performance actor').value = first.uuid
    first.position.x = 1; f.click('Capture key')
    f.byLabel('Timeline seconds').value = '1'; f.byLabel('Timeline seconds').dispatch('change')
    first.position.x = 5; f.click('Capture key')
    f.click('Save to JSON'); const json = f.byLabel('Performance document JSON').value
    assert.equal(JSON.parse(json).tracks[0].keys.length, 2)
    f.click('Load from JSON'); f.byLabel('Timeline seconds').value = '0'; f.byLabel('Timeline seconds').dispatch('change')
    f.click('Play')
    for (const actor of f.descriptors) f.callbacks.body(0.5, { frameId: 1, actorKey: actor.object.uuid, generation: actor.generation })
    f.callbacks.face()
    assert.equal(first.position.x, 3); assert.equal(second.position.x, 0)
    f.click('Pause'); assert.equal(f.editor.runtime.playing, false)
    f.byLabel('Timeline keyframe').value = JSON.stringify([JSON.parse(json).tracks[0].id, JSON.parse(json).tracks[0].keys[0].id])
    f.click('Delete key'); assert.equal(f.editor.runtime.timeline.value.tracks[0].keys.length, 1)
    f.editor.dispose(); f.editor.dispose(); assert.equal(f.container.children.length, 0)
    assert.equal(Object.keys(f.callbacks).length, 0); assert.deepEqual(f.releases, ['source'])
})
test('empty actor capability does not invent expression, bone, gizmo or action support', () => {
    const f = fixture(0)
    assert.equal(f.byLabel('Performance actor').disabled, true)
    assert.equal(f.byLabel('Expression channel').disabled, true)
    f.click('Drag selected')
    assert.match(f.container.find(node => node.tagName === 'output').textContent, /absent/)
    f.click('Load from JSON')
    assert.equal(f.editor.runtime.timeline.value.tracks.length, 0)
    f.editor.dispose()
})
test('panel actor choices use UUID rather than resource label and root/FK modes are distinct', () => {
    const f = fixture()
    const choices = f.byLabel('Performance actor').children.map(row => row.value)
    assert.equal(new Set(choices).size, 2)
    assert.deepEqual(f.byLabel('Drag mode').children.map(row => row.value), ['root', 'joint', 'ik'])
    assert.deepEqual(f.byLabel('Drag mode').children.map(row => row.textContent), ['Root placement', 'Joint rotation', 'IK target'])
    assert.deepEqual(f.byLabel('Keyframe channel').children.map(row => row.value), ['root-position', 'root-rotation', 'root-scale', 'bone-rotation', 'morph', 'action'])
    assert.equal(f.byLabel('Pose joint').children.length, 1)
    assert.equal(f.byLabel('Expression channel').children.length, 0)
    f.byLabel('Keyframe channel').value = 'action'; f.click('Capture key')
    assert.equal(f.editor.runtime.timeline.value.tracks[0].keys[0].value.name, 'Action')
    f.editor.dispose()
})

test('timeline ruler follows imported duration instead of stale initial ticks', () => {
    const f = fixture();
    const ruler = f.container.find(node => node.attributes['data-testid'] === 'performance-timeline-ruler');
    assert.equal(ruler.find(node => node.className?.split(' ').includes('performance-timeline-scale')).children.filter(node => node.className === 'performance-timeline-tick').at(-1).textContent, '10.0s');
    f.byLabel('Duration seconds').value = '8'; f.byLabel('Duration seconds').dispatch('change');
    assert.equal(ruler.find(node => node.className?.split(' ').includes('performance-timeline-scale')).children.filter(node => node.className === 'performance-timeline-tick').at(-1).textContent, '8.0s');
    f.editor.dispose();
})

const poseButton = (f, label) => {
    const element = f.container.find(node => node.tagName === 'button' && node.textContent === label)
    assert.ok(element, label)
    return element
}
const poseLabels = ['撤销姿态', '恢复官方姿态']
const jointIdentity = f => { const actor = f.editor.runtime.actors.get(f.byLabel('Performance actor').value), [boneKey, bone] = [...actor.bones][0]
    return { actorKey: actor.key, generation: actor.descriptor.generation, boneKey, boneUuid: bone.uuid, label: `${bone.name} · ${boneKey} · ${bone.uuid}` } }

test('canvas joint selection validates exact identity and enters existing detached joint drag directly', () => {
    const f = fixture(1)
    try {
        const identity = jointIdentity(f), bone = f.descriptors[0].object.children[0]
        const result = f.editor.panel.selectJointFromCanvas(identity)
        assert.equal(result.status, 'ready'); assert.equal(f.byLabel('Pose joint').value, identity.boneKey)
        assert.equal(f.byLabel('Drag mode').value, 'joint'); assert.notEqual(f.callbacks.drag.object, bone)
        assert.equal(f.callbacks.drag.mode, 'joint')
        f.callbacks.drag.object.rotation.y = 0.4; f.callbacks.drag.onChange(); f.frame()
        assert.ok(Math.abs(bone.rotation.y - 0.4) < 1e-7)
    } finally { f.editor.dispose() }
})
test('canvas selection rejects stale UUID generation and bone identity and preserves actual provider reason', () => {
    const f = fixture()
    try {
        const identity = jointIdentity(f), calls = []
        f.editor.runtime.beginDrag = (...args) => { calls.push(args); return { status: 'unavailable', reason: 'Voice pose-channel yield provider pending' } }
        for (const row of [{ ...identity, generation: 9 }, { ...identity, boneUuid: 'old' }, { ...identity, actorKey: f.descriptors[1].object.uuid }]) {
            assert.equal(f.editor.panel.selectJointFromCanvas(row).status, 'unavailable')
        }
        assert.equal(calls.length, 0)
        f.byLabel('Drag mode').value = 'ik'
        assert.equal(f.editor.panel.selectJointFromCanvas(identity).status, 'unavailable')
        assert.deepEqual(calls, [[identity.actorKey, 'ik', identity.boneKey]])
        f.editor.runtime.pause(); assert.equal(f.editor.panel.status.textContent, 'Voice pose-channel yield provider pending')
    } finally { f.editor.dispose() }
})
test('overlap choices expose distinct exact identities and disappear on actor switch or panel disposal', () => {
    const f = fixture(), chosen = [], notifications = []
    try {
        const release = f.editor.panel.subscribePoseSelection(() => notifications.push(f.editor.panel.getPoseSelection()))
        const a = jointIdentity(f), b = { ...a, boneUuid: 'second-helper', label: 'same name · different hierarchy · second-helper' }
        f.editor.panel.showJointCandidates([a, b], row => chosen.push(row))
        const chooser = f.byLabel('重叠关节')
        assert.equal(chooser.children.length, 2); assert.equal(chooser.children[1].attributes['data-joint-uuid'], b.boneUuid)
        chooser.children[1].dispatch('click'); assert.deepEqual(chosen, [b])
        f.byLabel('Performance actor').value = f.descriptors[1].object.uuid; f.byLabel('Performance actor').dispatch('change')
        assert.equal(chooser.hidden, true); assert.equal(chooser.children.length, 0)
        assert.equal(notifications.at(-1).actorKey, f.descriptors[1].object.uuid); release()
        f.editor.panel.dispose(); assert.equal(chooser.children.length, 0)
    } finally { f.editor.dispose() }
})

test('pose controls sit beside drag controls in Properties and use the selected actor UUID', () => {
    const f = fixture(), calls = []
    try {
        for (const label of poseLabels) {
            const control = poseButton(f, label)
            assert.equal(control.parent, f.editor.panel.regions.properties)
            assert.equal(control.disabled, false)
        }
        const children = f.editor.panel.regions.properties.children
        assert.equal(children[children.findIndex(node => node.textContent === 'End drag') + 1], poseButton(f, '撤销姿态'))
        f.editor.runtime.undoPose = key => { calls.push(['undo', key]); return { status: 'ready', value: undefined } }
        f.editor.runtime.resetPose = key => { calls.push(['reset', key]); return { status: 'ready', value: undefined } }
        f.click('撤销姿态')
        f.byLabel('Performance actor').value = f.descriptors[1].object.uuid
        f.byLabel('Performance actor').dispatch('change')
        f.click('恢复官方姿态')
        assert.deepEqual(calls, [['undo', f.descriptors[0].object.uuid], ['reset', f.descriptors[1].object.uuid]])
    } finally { f.editor.dispose() }
})

test('pose controls report each non-ready reason instead of claiming success', () => {
    const f = fixture()
    try {
        for (const [label, operation, reason] of [['撤销姿态', 'undoPose', 'Pose undo history empty'], ['恢复官方姿态', 'resetPose', 'Current pose lease absent']]) {
            f.editor.runtime[operation] = () => ({ status: 'unavailable', reason })
            f.click(label)
            assert.equal(f.editor.panel.status.textContent, reason)
            assert.notEqual(f.editor.panel.status.textContent, 'Ready')
            f.editor.runtime.pause()
            assert.equal(f.editor.panel.status.textContent, reason, 'state/frame updates retain the unavailable reason')
        }
    } finally { f.editor.dispose() }
})

test('pose controls disable with no actors and ignore forced stale button events', () => {
    const f = fixture(0), calls = []
    try {
        f.editor.runtime.undoPose = key => { calls.push(key); return { status: 'ready', value: undefined } }
        f.editor.runtime.resetPose = f.editor.runtime.undoPose
        for (const label of poseLabels) {
            assert.equal(poseButton(f, label).disabled, true)
            f.click(label) // Dispatch deliberately bypasses native disabled-button filtering.
        }
        assert.deepEqual(calls, [])
        assert.match(f.editor.panel.status.textContent, /角色/)
    } finally { f.editor.dispose() }
})

test('pose controls reject a stale actor before its source notification is delivered', () => {
    const f = fixture(1), calls = []
    try {
        f.editor.runtime.undoPose = key => { calls.push(key); return { status: 'ready', value: undefined } }
        f.editor.runtime.resetPose = f.editor.runtime.undoPose
        f.descriptors[0].isCurrent = () => false
        for (const label of poseLabels) f.click(label)
        assert.deepEqual(calls, [])
        for (const label of poseLabels) assert.equal(poseButton(f, label).disabled, true)
    } finally { f.editor.dispose() }
})

test('pose controls follow actor removal and same-label replacement without targeting the former actor', () => {
    const f = fixture(), calls = []
    try {
        f.editor.runtime.undoPose = key => { calls.push(['undo', key]); return { status: 'ready', value: undefined } }
        f.editor.runtime.resetPose = key => { calls.push(['reset', key]); return { status: 'ready', value: undefined } }
        const removed = f.descriptors.shift()
        removed.isCurrent = () => false; f.callbacks.actors()
        f.click('撤销姿态')
        assert.deepEqual(calls, [['undo', f.descriptors[0].object.uuid]])
        const second = f.descriptors.pop(); second.isCurrent = () => false; f.callbacks.actors()
        for (const label of poseLabels) assert.equal(poseButton(f, label).disabled, true)
        const object = new Group(); object.add(new Bone())
        f.descriptors.push({ object, generation: 2, label: 'Same resource', actions: [], isCurrent: () => true }); f.callbacks.actors()
        f.click('恢复官方姿态')
        assert.deepEqual(calls.at(-1), ['reset', object.uuid])
        assert.ok(calls.every(([, key]) => key !== removed.object.uuid))
        assert.equal(poseButton(f, '恢复官方姿态').disabled, false)
    } finally { f.editor.dispose() }
})

test('pose controls operate released ACTION APIs and remain usable after editor hand-back', () => {
    const f = fixture(1), bone = f.descriptors[0].object.children[0]
    try {
        for (const label of poseLabels) poseButton(f, label)
        f.editor.runtime.seek(2)
        const documentBefore = f.editor.runtime.exportProject()
        const edit = angle => {
            f.byLabel('Drag mode').value = 'joint'; f.click('Drag selected')
            assert.ok(f.callbacks.drag, f.editor.panel.status.textContent)
            f.callbacks.drag.object.rotation.y = angle; f.callbacks.drag.onChange(); f.frame()
            assert.ok(Math.abs(bone.rotation.y - angle) < 1e-7)
        }
        edit(0.4); f.click('撤销姿态'); f.frame(); assert.ok(Math.abs(bone.rotation.y) < 1e-7)
        edit(0.6); f.click('恢复官方姿态'); f.frame(); assert.ok(Math.abs(bone.rotation.y) < 1e-7)
        f.click('Stop / hand back')
        assert.equal(f.editor.runtime.playing, false)
        assert.equal(f.callbacks.drag, undefined)
        f.click('撤销姿态'); assert.equal(f.editor.panel.status.textContent, 'Current pose lease absent')
        edit(0.3); f.click('撤销姿态'); f.frame(); assert.ok(Math.abs(bone.rotation.y) < 1e-7)
        assert.equal(f.editor.runtime.time, 2)
        assert.equal(f.editor.runtime.exportProject(), documentBefore)
        assert.equal(poseButton(f, '撤销姿态').disabled, false)
    } finally { f.editor.dispose() }
})

