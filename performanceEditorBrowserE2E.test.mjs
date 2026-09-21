import assert from 'node:assert/strict'
import test from 'node:test'
import { Bone, Group } from 'three'
import { mountPerformanceEditor } from './src/viewer/performanceEditor/index.ts'

// Browser-shaped DOM fixture: the same semantic controls and events used by CUA/browser tests.
class Element {
    constructor(tagName, ownerDocument) { Object.assign(this, { tagName, ownerDocument, children: [], attributes: {}, listeners: {}, style: {}, _value: '', textContent: '', disabled: false, checked: false, parent: null }) }
    set value(value) { this._value = String(value) }
    get value() { return this._value || (this.tagName === 'select' ? this.children[0]?.value || '' : '') }
    setAttribute(name, value) { this.attributes[name] = String(value) }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child) } }
    replaceChildren(...children) { for (const child of this.children) child.parent = null; this.children = []; this._value = ''; this.append(...children) }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback) }
    dispatch(type) { for (const listener of this.listeners[type] || []) listener({ target: this }) }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null }
    find(predicate) { if (predicate(this)) return this; for (const child of this.children) { const found = child.find(predicate); if (found) return found } }
}
function fixture() {
    const document = { activeElement: null, createElement: tag => new Element(tag, document) }
    const container = document.createElement('aside'), callbacks = {}, descriptors = [], releases = []
    for (let i = 0; i < 2; i++) {
        const object = new Group(); object.name = `actor-${i}`
        const bone = new Bone(); bone.name = 'joint'; object.add(bone)
        const descriptor = { object, generation: 1, label: `Actor ${i}`, actions: ['Walk'], isCurrent: () => descriptors.includes(descriptor) }
        descriptors.push(descriptor)
    }
    let editor, sourceListener
    const storage = new Map()
    const previousStorage = globalThis.localStorage
    globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) }
    editor = mountPerformanceEditor(container, {
        actorSource: { list: () => descriptors, subscribe: listener => { sourceListener = listener; return () => { sourceListener = undefined; releases.push('source') } } },
        framePort: { subscribeBeforePhysics: cb => { callbacks.body = cb; return () => delete callbacks.body }, subscribeFinalPoseBeforeCamera: cb => { callbacks.face = cb; return () => delete callbacks.face } },
        channelHost: { acquire: (actor, channels) => {
            const lease = { active: true, captureEvaluated: () => editor.runtime.actors.get(actor.object.uuid).capture(channels), playActionBeat() {}, sampleActionAt() {}, releaseFromEvaluated() { lease.active = false } }
            return { status: 'ready', value: lease }
        }, notifyRootTransformChanged() {} },
        transformHost: { acquire: request => { callbacks.drag = request; return { status: 'ready', value: () => { callbacks.drag = undefined } } } },
        transitionSeconds: 0,
    })
    const find = predicate => container.find(predicate)
    const button = label => find(node => node.tagName === 'button' && node.textContent === label)
    const select = label => find(node => node.attributes['aria-label'] === label)
    return { editor, container, callbacks, descriptors, releases, storage, find, button, select, removeFirst: () => { descriptors.shift(); sourceListener?.() }, restoreStorage: () => { globalThis.localStorage = previousStorage } }
}
test('browser contract exposes semantic timeline lanes, scrubber and UUID-scoped actors', () => {
    const f = fixture()
    assert.equal(f.select('Performance actor').children.length, 2)
    assert.equal(new Set(f.select('Performance actor').children.map(row => row.value)).size, 2)
    assert.equal(f.find(node => node.attributes['data-testid'] === 'performance-timeline-scrubber').tagName, 'input')
    assert.equal(f.find(node => node.attributes['data-testid'] === 'performance-timeline-lanes').attributes.role, 'group')
    assert.equal(f.find(node => node.attributes['data-testid'] === 'performance-actors-section').attributes['aria-label'], 'Actors / Scene outliner')
    assert.equal(f.find(node => node.attributes['data-testid'] === 'performance-manipulation-section').attributes['aria-label'], 'Manipulation / Inspector')
    assert.equal(f.find(node => node.attributes['data-testid'] === 'performance-timeline-section').attributes['aria-label'], 'Timeline')
    assert.equal(f.find(node => node.attributes['data-testid'] === 'performance-project-section').attributes['aria-label'], 'Project / Presets')
    assert.equal(f.find(node => node.attributes['data-testid'] === 'performance-project-import').type, 'file')
    assert.equal(f.find(node => node.attributes['data-testid'] === 'performance-timeline-ruler').children.length, 11)
    assert.match(f.find(node => node.attributes['data-testid'] === 'performance-timeline-lanes').style.cssText, /max-height:180px/)
    f.editor.dispose(); f.restoreStorage()
})
test('browser contract drives independent keyframes, playback and pointer drag without cross-actor writes', () => {
    const f = fixture(), [a, b] = f.descriptors.map(row => row.object)
    const actors = f.select('Performance actor'); actors.value = a.uuid; a.position.x = 2
    f.button('Capture key').dispatch('click'); f.select('Timeline seconds').value = '1'; f.select('Timeline seconds').dispatch('change'); a.position.x = 8; f.button('Capture key').dispatch('click')
    const lanes = f.find(node => node.attributes['data-testid'] === 'performance-timeline-lanes'); assert.equal(lanes.children.length, 1)
    const marker = f.find(node => node.attributes['data-key-id'])
    assert.ok(marker); assert.match(marker.style.cssText, /left:.*%/)
    f.button('Play').dispatch('click'); f.callbacks.body(0.5, { frameId: 1, actorKey: a.uuid, generation: 1 }); f.callbacks.body(0.5, { frameId: 1, actorKey: b.uuid, generation: 1 }); f.callbacks.face()
    assert.notEqual(a.position.x, b.position.x); assert.equal(b.position.x, 0)
    f.button('Drag selected').dispatch('click'); assert.ok(f.callbacks.drag); f.callbacks.drag.object.position.x = 11; f.callbacks.drag.onChange(); f.callbacks.body(0, { frameId: 2, actorKey: a.uuid, generation: 1 }); f.callbacks.face(); assert.equal(a.position.x, 11); assert.equal(b.position.x, 0)
    f.editor.dispose(); f.restoreStorage()
})
test('browser contract saves and restores a project, and rejects malformed or stale state closed', () => {
    const f = fixture(), actor = f.descriptors[0].object
    f.select('Performance actor').value = actor.uuid; f.button('Capture key').dispatch('click'); f.button('Save project').dispatch('click')
    const saved = f.storage.get('magius.performance.editor.v1'); assert.ok(saved); const before = f.editor.runtime.exportProject()
    f.editor.runtime.importProject(saved); assert.equal(f.editor.runtime.exportProject(), before)
    assert.throws(() => f.editor.runtime.importProject('{"schema":"bad"}'), /Invalid performance document/)
    f.removeFirst(); f.callbacks.body(0.1, { frameId: 4, actorKey: actor.uuid, generation: 1 }); assert.equal(f.editor.runtime.actors.has(actor.uuid), false)
    f.editor.dispose(); f.restoreStorage()
})
