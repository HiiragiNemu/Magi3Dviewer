import assert from 'node:assert/strict'
import test from 'node:test'
import { AnimationClip, AnimationMixer, Bone, Group, Mesh, NumberKeyframeTrack, Quaternion, Vector3 } from 'three'
import { PerformanceActorAdapter } from './src/viewer/performanceEditor/actorAdapter.ts'
import { applyTransform, blendPose, clonePose } from './src/viewer/performanceEditor/pose.ts'
import { PerformanceEditorRuntime } from './src/viewer/performanceEditor/runtime.ts'

function fixture(options = {}) {
    const events = [], callbacks = {}, descriptors = [], changes = [], phases = [], nativeOutputs = new Map()
    for (let i = 0; i < 2; i++) {
        const object = new Group(); object.name = 'same-resource'
        const bone = new Bone(); bone.name = 'joint'; object.add(bone)
        if (options.chain) {
            const middle = new Bone(), end = new Bone(); middle.name = 'middle'; end.name = 'end'
            middle.position.x = 1; end.position.x = 1; bone.add(middle); middle.add(end)
        }
        if (options.native && i === 0) nativeOutputs.set(bone, { ownerStableKey: 'exact-native-fixture' })
        const mesh = new Mesh(); mesh.name = 'face'; mesh.morphTargetDictionary = { smile: 0 }; mesh.morphTargetInfluences = [0]; object.add(mesh)
        descriptors.push({ object, generation: 1, label: 'same-resource', actions: ['Action'], isCurrent: () => descriptors.includes(descriptor) })
        const descriptor = descriptors.at(-1)
    }
    let sourceListener, drag, frameId = 0, inActorPhase = false
    const lastOutputs = new Map(), selectedChannels = new Map()
    const authored = new Map(descriptors.map(descriptor => {
        const object = descriptor.object.clone(true)
        return [descriptor.object, new PerformanceActorAdapter({ ...descriptor, object })]
    }))
    const runtime = new PerformanceEditorRuntime({
        actorSource: { list: () => descriptors, subscribe: callback => { sourceListener = callback; return () => { sourceListener = null } } },
        framePort: { subscribeBeforePhysics: cb => { callbacks.body = cb; return () => delete callbacks.body }, subscribeFinalPoseBeforeCamera: cb => { callbacks.face = cb; return () => delete callbacks.face } },
        channelHost: {
            acquire: (actor, channels) => {
                if (options.deny) return { status: 'unavailable', reason: 'Lease held by another writer' }
                if (options.native) {
                    const adapter = runtime.actors.get(actor.object.uuid)
                    assert.ok(Array.isArray(channels.exclusiveBones), 'Explicit manual subset must be supplied')
                    assert.ok(channels.exclusiveBones.every(key => channels.bones.includes(key)))
                    if (!channels.action) assert.deepEqual(channels.exclusiveBones, channels.bones)
                    const collisions = channels.exclusiveBones.map(key => adapter.bones.get(key)).filter(bone => nativeOutputs.has(bone))
                    if (collisions.length) return { status: 'unavailable', reason: 'Exact native manual-channel conflict' }
                }
                selectedChannels.set(actor.object.uuid, channels)
                const lease = { active: true, playActionBeat: beat => events.push([actor.object.uuid, beat]),
                    captureEvaluated: () => options.cachedPriorDisplay && inActorPhase && lastOutputs.has(actor.object.uuid)
                        ? structuredClone(lastOutputs.get(actor.object.uuid)) : runtime.actors.get(actor.object.uuid).capture(channels),
                    sampleActionAt: (_name, time) => { phases.push(['action', actor.object.uuid, time]); actor.object.children[0].position.x = time; authored.get(actor.object).descriptor.object.children[0].position.x = time },
                    captureEvaluatorFrame: context => ({ status: 'ready', value: { ...context, pose: authored.get(actor.object).capture(channels) } }),
                    commitManualBody: (_frame, pose) => { runtime.actors.get(actor.object.uuid).apply(pose, 'body'); return { status: 'ready', value: undefined } },
                    releaseFromEvaluated: pose => { lease.active = false; changes.push(['release', actor.object.uuid, pose]) } }
                changes.push(['acquire', actor.object.uuid, channels]); return { status: 'ready', value: lease }
            }, notifyRootTransformChanged: key => changes.push(['root', key]),
        },
        transformHost: { acquire: request => { drag = request; return { status: 'ready', value: () => { drag = null } } } },
        transitionSeconds: options.transition ?? 0,
    })
    const context = (actor, frame = frameId) => ({ frameId: frame, actorKey: actor.object.uuid, generation: actor.generation })
    return { runtime, events, descriptors, changes, callbacks, context, phases, nativeOutputs, frame: delta => {
        ++frameId; for (const actor of descriptors) {
            inActorPhase = true; callbacks.body?.(delta, context(actor)); inActorPhase = false
            for (const bone of nativeOutputs.keys()) if (bone === actor.object.children[0]) {
                phases.push(['native', actor.object.uuid, bone.position.x]); bone.position.y = 7
            }
        }
        callbacks.face?.()
        for (const actor of descriptors) if (selectedChannels.has(actor.object.uuid)) lastOutputs.set(actor.object.uuid, runtime.actors.get(actor.object.uuid).capture(selectedChannels.get(actor.object.uuid)))
    },
        remove: () => { descriptors.shift(); sourceListener?.() }, drag: () => drag }
}
const rootTrack = key => ({ id: 'root', actorKey: key, channel: 'root-position', keys: [{ id: 'root0', time: 0, value: [0, 0, 0] }, { id: 'root1', time: 1, value: [10, 0, 0] }] })
const doc = tracks => ({ schema: 'performance-editor-v1', duration: 2, loop: false, tracks })

test('two actors sharing resource remain isolated through root play, pause and hand-back', () => {
    const f = fixture(), a = f.descriptors[0].object, b = f.descriptors[1].object
    f.runtime.setDocument(doc([rootTrack(a.uuid)])); f.runtime.play(); f.frame(0.5)
    assert.equal(a.position.x, 5); assert.equal(b.position.x, 0)
    f.runtime.pause(); a.position.x = 99; f.frame(0.2); assert.equal(a.position.x, 5)
    f.runtime.stop(); assert.equal(f.changes.filter(row => row[0] === 'release').length, 1)
    f.runtime.dispose()
})
test('lease denial and absent actors stop with zero transform writes', () => {
    const f = fixture({ deny: true }), a = f.descriptors[0].object
    f.runtime.setDocument(doc([rootTrack(a.uuid)])); f.runtime.play(); f.frame(0.5)
    assert.match(f.runtime.lastError, /Lease held/); assert.equal(a.position.x, 0)
    f.runtime.setDocument(doc([rootTrack('removed')])); f.runtime.play(); assert.match(f.runtime.lastError, /actor absent/)
    f.runtime.dispose()
})
test('zero-second cue and same-action retrigger dispatch once per beat; scrub dispatches none', () => {
    const f = fixture(), key = f.descriptors[0].object.uuid
    f.runtime.setDocument(doc([{ id: 'action', actorKey: key, channel: 'action', keys: [
        { id: 'beat0', time: 0, value: { name: 'Action', loop: false } },
        { id: 'beat1', time: 0.5, value: { name: 'Action', loop: false } },
    ] }]))
    f.runtime.play(); f.frame(0.2); f.frame(0.4); f.frame(0.1)
    assert.deepEqual(f.events.map(row => row[1].keyId), ['beat0', 'beat1'])
    f.runtime.pause(); f.runtime.seek(0.3); f.frame(0); assert.equal(f.events.length, 2)
    assert.equal(f.descriptors[1].object.children[0].position.x, 0)
    f.runtime.dispose()
})
test('interrupt/seek first output equals current evaluated pose, then blends naturally', () => {
    const f = fixture({ transition: 0.2 }), a = f.descriptors[0].object
    a.position.x = 3
    f.runtime.setDocument(doc([rootTrack(a.uuid)])); f.runtime.play(); f.frame(0)
    assert.equal(a.position.x, 3)
    f.frame(0.1); f.frame(0.1); const interrupted = a.position.x
    f.runtime.seek(0.8); f.frame(0); assert.equal(a.position.x, interrupted)
    f.frame(0.1); f.frame(0.1); assert.ok(a.position.x > interrupted)
    f.runtime.dispose()
})
test('body and face apply in distinct supplied phases, preserving other actor morphs', () => {
    const f = fixture(), a = [...f.runtime.actors.values()][0], morph = [...a.morphs.keys()][0]
    f.runtime.setDocument(doc([{ id: 'face', actorKey: a.key, channel: 'morph', property: morph, keys: [{ id: 'face0', time: 0, value: 1.5 }] }]))
    f.runtime.play(); f.callbacks.body(0, f.context(f.descriptors[0], 1)); assert.equal(a.descriptor.object.children[1].morphTargetInfluences[0], 0)
    f.callbacks.face(); assert.equal(a.descriptor.object.children[1].morphTargetInfluences[0], 1.5)
    assert.equal(f.descriptors[1].object.children[1].morphTargetInfluences[0], 0); f.runtime.dispose()
})
test('root versus FK drag leases different objects/channels; removal disposes only one instance', () => {
    const f = fixture(), actor = [...f.runtime.actors.values()][0], boneKey = [...actor.bones.keys()][0]
    assert.equal(f.runtime.beginDrag(actor.key, 'root').status, 'ready')
    assert.equal(f.drag().object, actor.descriptor.object)
    f.drag().object.position.x = 4; f.drag().onChange(); f.frame(0); assert.equal(actor.descriptor.object.position.x, 4)
    assert.equal(f.runtime.beginDrag(actor.key, 'joint', boneKey).status, 'ready')
    assert.notEqual(f.drag().object, actor.bones.get(boneKey)); assert.equal(f.runtime.beginDrag(actor.key, 'ik', boneKey).status, 'unavailable')
    f.remove(); assert.equal(f.runtime.actors.size, 1); assert.equal(f.runtime.actors.has(actor.key), false)
    f.runtime.dispose(); f.runtime.dispose(); assert.equal(Object.keys(f.callbacks).length, 0)
})
test('joint drag is rotation-only and preserves local pivot, scale, and child lengths', () => {
    const f = fixture({ chain: true }), actor = f.runtime.actors.values().next().value
    const key = [...actor.bones.keys()][1], joint = actor.bones.get(key), end = [...actor.bones.values()][2]
    const position = joint.position.clone(), scale = joint.scale.clone(), length = joint.children[0].position.length()
    assert.equal(f.runtime.beginDrag(actor.key, 'joint', key).status, 'ready')
    const request = f.drag(); request.object.position.x += 99; request.object.scale.setScalar(4)
    request.object.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.5)); request.onChange(); f.frame(0)
    assert.deepEqual(joint.position.toArray(), position.toArray())
    assert.deepEqual(joint.scale.toArray(), scale.toArray())
    assert.equal(joint.children[0].position.length(), length)
    assert.notDeepEqual(joint.quaternion.toArray(), [0, 0, 0, 1])
    f.runtime.dispose()
})
test('capture pose/action keys and delete operate on exact instance identity', () => {
    const f = fixture(), actor = [...f.runtime.actors.values()][0]
    f.runtime.capturePoseKeys(actor.key); f.runtime.captureKey(actor.key, 'action', undefined, { name: 'Action', loop: true })
    assert.equal(f.runtime.timeline.value.tracks.length, 2) // Pose keys now own rotations, not joint length/scale.
    assert.ok(f.runtime.timeline.value.tracks.every(track => track.actorKey === actor.key))
    const t = f.runtime.timeline.value.tracks[0]; f.runtime.deleteKey(t.id, t.keys[0].id)
    assert.equal(f.runtime.timeline.value.tracks.length, 1); f.runtime.dispose()
})
test('invalid delta and excessive loop span stop rather than emitting unbounded actions', () => {
    const f = fixture(), a = f.descriptors[0].object
    f.runtime.setDocument({ ...doc([rootTrack(a.uuid)]), loop: true }); f.runtime.play(); f.frame(100)
    assert.match(f.runtime.lastError, /16 loops/); assert.equal(f.runtime.playing, false)
    f.frame(NaN); assert.match(f.runtime.lastError, /Invalid frame/); f.runtime.dispose()
})

test('interleaved mixerA/poseA/physicsA then mixerB/poseB/physicsB advances once and never commits B early', () => {
    const f = fixture(), [a, b] = f.descriptors
    const ta = rootTrack(a.object.uuid), tb = rootTrack(b.object.uuid)
    tb.id = 'root-b'; tb.keys.forEach(key => { key.id += '-b'; key.value = key.value.map(value => value * 2) })
    f.runtime.setDocument(doc([ta, tb])); f.runtime.play()
    a.object.position.x = 100; b.object.position.x = 200
    f.callbacks.body(0.25, f.context(a, 100))
    assert.equal(f.runtime.time, 0.25); assert.equal(a.object.position.x, 2.5)
    assert.equal(b.object.position.x, 200, 'A seam must not touch B before its mixer')
    a.object.position.y = 7 // physicsA owns another channel after A commit
    b.object.position.x = 300 // mixerB evaluates now
    f.callbacks.body(0.25, f.context(b, 100))
    assert.equal(f.runtime.time, 0.25); assert.equal(b.object.position.x, 5)
    assert.equal(a.object.position.y, 7, 'B seam must not rewrite A after physicsA')
    b.object.position.y = 9; f.callbacks.body(0.25, f.context(b, 100))
    assert.equal(b.object.position.y, 9, 'duplicate seam has no second commit')
    f.callbacks.face(); f.runtime.dispose()
})
test('stale generation/old frame/zero leased actors cannot advance global timeline', () => {
    const f = fixture(), a = f.descriptors[0]
    f.runtime.setDocument(doc([rootTrack(a.object.uuid)])); f.runtime.play()
    f.callbacks.body(0.5, { ...f.context(a, 10), generation: 999 }); assert.equal(f.runtime.time, 0)
    f.callbacks.body(0.2, f.context(a, 10)); assert.equal(f.runtime.time, 0.2)
    f.callbacks.body(0.5, f.context(a, 9)); assert.equal(f.runtime.time, 0.2)
    f.runtime.stop(); f.callbacks.body(1, f.context(a, 11)); assert.equal(f.runtime.time, 0.2)
    f.runtime.dispose()
})

test('loop/retrigger occurrences are distinct while duplicate frame callbacks remain once-only', () => {
    const f = fixture(), a = f.descriptors[0]
    f.runtime.setDocument({ ...doc([{ id: 'action', actorKey: a.object.uuid, channel: 'action', keys: [
        { id: 'beat', time: 0, value: { name: 'Action', loop: false } },
    ] }]), duration: 1, loop: true })
    f.runtime.play(); f.frame(0); f.frame(1); f.runtime.pause(); f.runtime.play(); f.frame(0)
    assert.equal(f.events.length, 3)
    assert.deepEqual(f.events.map(row => row[1].keyId), ['beat', 'beat', 'beat'])
    assert.equal(new Set(f.events.map(row => row[1].occurrenceId)).size, 3)
    f.runtime.dispose()
})

test('cached prior displayed host source never replaces newly sampled action destination', () => {
    const f = fixture({ cachedPriorDisplay: true }), a = f.descriptors[0].object
    f.runtime.setDocument(doc([{ id: 'action', actorKey: a.uuid, channel: 'action', keys: [{ id: 'beat', time: 0, value: { name: 'Action', loop: false } }] }]))
    f.runtime.play()
    const samples = []
    for (let i = 0; i < 3; i++) { f.frame(0.25); samples.push(a.children[0].position.x) }
    assert.deepEqual(samples, [0.25, 0.5, 0.75])
    assert.equal(f.descriptors[1].object.children[0].position.x, 0)
    f.runtime.dispose()
})
test('cached-display retrigger preserves prior from pose at t0 and blends toward live restarted target', () => {
    const f = fixture({ cachedPriorDisplay: true, transition: 0.2 }), a = f.descriptors[0].object
    f.runtime.setDocument(doc([{ id: 'action', actorKey: a.uuid, channel: 'action', keys: [
        { id: 'beat-a', time: 0, value: { name: 'Action', loop: false } },
        { id: 'beat-b', time: 0.5, value: { name: 'Action', loop: false } },
    ] }]))
    f.runtime.play(); for (let i = 0; i < 4; i++) f.frame(0.1)
    const from = a.children[0].position.x; assert.ok(Math.abs(from - 0.4) < 1e-8)
    f.frame(0.1); assert.equal(a.children[0].position.x, from, 't0 equals displayed pose, not restarted zero')
    f.frame(0.1); assert.ok(Math.abs(a.children[0].position.x - 0.25) < 1e-8, 'midpoint from0.4 to current target0.1')
    f.frame(0.1); assert.ok(Math.abs(a.children[0].position.x - 0.2) < 1e-8, 'settles to live target instead of freezing prior output')
    assert.deepEqual(f.events.map(row => row[1].keyId), ['beat-a', 'beat-b'])
    f.runtime.dispose()
})

test('ordinary action captures rig bones without exclusive native ownership and leaves later physics output intact', () => {
    const f = fixture({ native: true }), [a, b] = f.descriptors
    f.runtime.setDocument(doc([{ id: 'action', actorKey: a.object.uuid, channel: 'action', keys: [{ id: 'beat', time: 0, value: { name: 'Action' } }] }]))
    f.runtime.play(); assert.equal(f.runtime.lastError, null); assert.equal(f.runtime.playing, true)
    const channels = f.changes.find(row => row[0] === 'acquire')[2]
    assert.equal(channels.action, true); assert.equal(channels.bones.length, 1); assert.deepEqual(channels.exclusiveBones, [])
    f.frame(0.25); f.frame(0.25)
    assert.deepEqual(f.phases.map(row => [row[0], row[2]]), [['action', 0.25], ['native', 0.25], ['action', 0.5], ['native', 0.5]])
    assert.equal(a.object.children[0].position.y, 7); assert.equal(b.object.children[0].position.x, 0)
    assert.equal(f.events.length, 1); f.runtime.dispose()
})
test('explicit and mixed action/manual tracks retain exact native bone conflict rather than hiding it', () => {
    for (const mixed of [false, true]) {
        const f = fixture({ native: true }), actor = [...f.runtime.actors.values()][0], bone = [...actor.bones.keys()][0]
        const tracks = [{ id: 'manual', actorKey: actor.key, channel: 'bone-rotation', property: bone, keys: [{ id: 'pose', time: 0, value: [0, 0, Math.sin(.3), Math.cos(.3)] }] }]
        if (mixed) tracks.push({ id: 'action', actorKey: actor.key, channel: 'action', keys: [{ id: 'beat', time: 0, value: { name: 'Action' } }] })
        f.runtime.setDocument(doc(tracks)); f.runtime.play()
        assert.equal(f.runtime.playing, false); assert.match(f.runtime.lastError, /Exact native manual-channel conflict/)
        assert.deepEqual(actor.bones.get(bone).position.toArray(), [0, 0, 0]); assert.equal(f.events.length, 0)
        f.frame(0.1); assert.equal(f.phases.filter(row => row[0] === 'native').length, 1); f.runtime.dispose()
    }
})
test('manual requests reserve only exact FK or IK objects; root drag reserves no bones', () => {
    const f = fixture({ chain: true }), actor = [...f.runtime.actors.values()][0], keys = [...actor.bones.keys()]
    for (const [mode, key, expected] of [['root', undefined, []], ['joint', keys[1], [keys[1]]], ['ik', keys[2], keys]]) {
        assert.equal(f.runtime.beginDrag(actor.key, mode, key).status, 'ready')
        const channels = f.changes.filter(row => row[0] === 'acquire').at(-1)[2]
        assert.deepEqual(channels.exclusiveBones, expected); assert.deepEqual(channels.bones, expected)
        assert.equal(channels.action, false)
    }
    f.runtime.dispose()
})
test('native FK/IK collision preserves transforms while same-named independent actor remains editable', () => {
    const f = fixture({ native: true, chain: true }), [a, b] = [...f.runtime.actors.values()]
    const aKeys = [...a.bones.keys()], bKeys = [...b.bones.keys()]
    assert.equal(f.runtime.beginDrag(a.key, 'joint', aKeys[0]).status, 'unavailable')
    assert.equal(f.runtime.beginDrag(a.key, 'ik', aKeys[2]).status, 'unavailable')
    assert.equal(f.runtime.beginDrag(b.key, 'joint', bKeys[0]).status, 'ready')
    assert.deepEqual(a.bones.get(aKeys[0]).position.toArray(), [0, 0, 0]); f.runtime.dispose()
})
test('native action retrigger uses displayed output while stale generation and duplicate frame stay inert', () => {
    const f = fixture({ native: true, cachedPriorDisplay: true, transition: 0.2 }), a = f.descriptors[0]
    f.runtime.setDocument(doc([{ id: 'action', actorKey: a.object.uuid, channel: 'action', keys: [
        { id: 'first', time: 0, value: { name: 'Action' } }, { id: 'again', time: 0.5, value: { name: 'Action' } },
    ] }]))
    f.runtime.play(); assert.equal(f.runtime.playing, true)
    for (let i = 0; i < 4; i++) f.frame(0.1)
    const displayed = a.object.children[0].position.clone(); f.frame(0.1)
    assert.equal(a.object.children[0].position.x, displayed.x); assert.equal(a.object.children[0].position.y, 7)
    const count = f.phases.length, time = f.runtime.time
    f.callbacks.body(0.3, { ...f.context(a, 6), generation: 900 }); f.callbacks.body(0.3, f.context(a, 5))
    assert.equal(f.phases.length, count); assert.equal(f.runtime.time, time)
    f.frame(0.1); assert.ok(Math.abs(a.object.children[0].position.x - 0.25) < 1e-8)
    assert.equal(f.phases.filter(row => row[0] === 'native').length, 6); assert.equal(f.events.length, 2); f.runtime.dispose()
})


// Protocol fixture: a real Three AnimationMixer on an independent authored rig.
// Only host issuance/commit/return lifecycle is simulated here, not native physics.
function provenanceFixture(options = {}) {
    const callbacks = {}, rows = [], leases = [], records = [], descriptors = []
    let drag, frameId = 0, sourceListener
    function rig() {
        const root = new Group(), keyed = new Bone(), unkeyed = new Bone(), end = new Bone()
        root.position.set(3, 2, 1); root.rotation.z = 0.2; root.scale.setScalar(2)
        keyed.name = 'keyed'; unkeyed.name = 'unkeyed'; end.name = 'end'
        unkeyed.position.x = 1; end.position.x = 1
        root.add(keyed); keyed.add(unkeyed); unkeyed.add(end)
        return { root, keyed, unkeyed, end }
    }
    for (let i = 0; i < 2; i++) {
        const display = rig(), evaluated = rig()
        const descriptor = { object: display.root, generation: 1, actions: ['Action'], label: 'same-resource', isCurrent: () => descriptors.includes(descriptor) && descriptor.generation === 1 }
        descriptors.push(descriptor)
        const mixer = new AnimationMixer(evaluated.root)
        mixer.clipAction(new AnimationClip('Action', 2, [new NumberKeyframeTrack('keyed.position[x]', [0, 2], [0, 2])])).play()
        const adapter = new PerformanceActorAdapter({ ...descriptor, object: evaluated.root })
        records.push({ display, evaluated, mixer, adapter, descriptor })
    }
    const runtime = new PerformanceEditorRuntime({ transitionSeconds: options.transition ?? 0,
        actorSource: { list: () => descriptors, subscribe: cb => { sourceListener = cb; return () => {} } },
        framePort: { subscribeBeforePhysics: cb => { callbacks.body = cb; return () => {} }, subscribeFinalPoseBeforeCamera: cb => { callbacks.face = cb; return () => {} } },
        transformHost: { acquire: request => { drag = request; return { status: 'ready', value: () => { drag = undefined } } } },
        channelHost: { notifyRootTransformChanged() {}, acquire: (actor, channels) => {
            const record = records.find(row => row.descriptor === actor), adapter = runtime.actors.get(actor.object.uuid)
            let issued, consumed = false
            const lease = { active: true, state: 'held', channels,
                captureEvaluated: () => adapter.capture(channels),
                playActionBeat: () => rows.push(['beat', actor.object.uuid]),
                sampleActionAt: (_name, time) => { record.mixer.setTime(time); rows.push(['action', actor.object.uuid, time]) },
                captureEvaluatorFrame: context => {
                    if (options.missingFrame) return { status: 'unavailable', reason: 'WAIT_EVALUATED_FRAME: no producer frame' }
                    assert.equal(context.frameId, frameId)
                    const pose = record.adapter.capture(channels)
                    issued = { ...context, pose }; consumed = false
                    if (options.badIdentity) issued.generation++
                    if (options.incomplete) delete issued.pose.bones[channels.bones[0]]
                    if (options.nonfinite) issued.pose.bones[channels.bones[0]].position = [NaN, 0, 0]
                    rows.push(['issued', actor.object.uuid, context.frameId, clonePose(record.adapter.capture(channels))])
                    return { status: 'ready', value: issued }
                },
                commitManualBody: (frame, output) => {
                    assert.equal(frame, issued, 'Original host-issued object identity must survive the MODEL clone')
                    assert.equal(consumed, false); assert.equal(frame.frameId, frameId); assert.equal(frame.actorKey, actor.object.uuid)
                    assert.equal(actor.isCurrent(), true)
                    consumed = true
                    if (options.rejectCommit) return { status: 'unavailable', reason: 'WAIT_EVALUATED_FRAME: host rejected stale token' }
                    rows.push(['submit-evaluator', actor.object.uuid, frame.frameId, clonePose(frame.pose)])
                    rows.push(['manual-commit', actor.object.uuid, frame.frameId, clonePose(output)])
                    adapter.apply(output, 'body')
                    return { status: 'ready', value: undefined }
                },
                releaseFromEvaluated: (pose, duration) => {
                    lease.active = false; lease.state = 'returning'
                    rows.push(['begin-return', actor.object.uuid, clonePose(pose), duration])
                },
            }
            if (options.noProtocol) { delete lease.captureEvaluatorFrame; delete lease.commitManualBody }
            leases.push(lease); return { status: 'ready', value: lease }
        } },
    })
    return { runtime, records, rows, leases, callbacks, drag: () => drag,
        context: (index, id = frameId) => ({ frameId: id, actorKey: records[index].display.root.uuid, generation: records[index].descriptor.generation }),
        frame(delta = 0.1, indexes = [0, 1]) {
            ++frameId
            for (const index of indexes) {
                const record = records[index]
                record.mixer.update(delta); rows.push(['evaluator', record.display.root.uuid, frameId])
                callbacks.body(delta, { frameId, actorKey: record.display.root.uuid, generation: record.descriptor.generation })
                rows.push(['native-phase', record.display.root.uuid, frameId])
            }
            callbacks.face()
        },
        remove(index) { descriptors.splice(descriptors.indexOf(records[index].descriptor), 1); sourceListener() },
        dispose() { runtime.dispose(); records.forEach(record => record.mixer.uncacheRoot(record.evaluated.root)) },
    }
}
const boneKeys = (f, i = 0) => [...f.runtime.actors.get(f.records[i].display.root.uuid).bones.keys()]

test('provenance FK edit before a frame stages detached TRS without contaminating an unkeyed evaluator bone', () => {
    const f = provenanceFixture(), r = f.records[0], key = boneKeys(f)[1]
    assert.equal(f.runtime.beginDrag(r.display.root.uuid, 'joint', key).status, 'ready')
    const proxy = f.drag().object
    assert.notEqual(proxy, r.display.unkeyed); assert.notEqual(proxy.parent, r.display.keyed)
    r.display.root.position.x = 8
    proxy.position.x = 9; f.drag().onChange()
    assert.equal(r.display.unkeyed.position.x, 1); assert.equal(r.evaluated.unkeyed.position.x, 1)
    assert.ok(proxy.parent.getWorldPosition(new Vector3()).distanceTo(r.display.keyed.getWorldPosition(new Vector3())) < 1e-8)
    f.frame(); assert.equal(r.display.unkeyed.position.x, 1)
    assert.equal(f.rows.find(row => row[0] === 'submit-evaluator')[3].bones[key].position[0], 1)
    assert.equal(f.rows.filter(row => row[0] === 'manual-commit').length, 1)
    f.dispose()
})

test('provenance IK solves a detached exact chain with placed rotated scaled ancestry before a single commit', () => {
    const f = provenanceFixture(), r = f.records[0], keys = boneKeys(f)
    const before = r.display.keyed.quaternion.clone()
    assert.equal(f.runtime.beginDrag(r.display.root.uuid, 'ik', keys[2]).status, 'ready')
    const target = r.display.root.localToWorld(new Vector3(1, 1, 0))
    f.drag().onChange(target)
    assert.ok(r.display.keyed.quaternion.equals(before)); assert.equal(f.runtime.lastError, null)
    f.frame(0)
    assert.ok(r.display.end.getWorldPosition(new Vector3()).distanceTo(target) < 1e-7)
    assert.ok(r.evaluated.keyed.quaternion.equals(before)); assert.equal(f.rows.filter(row => row[0] === 'manual-commit').length, 1)
    f.dispose()
})

test('provenance mixed action and manual track captures after actual independent mixer sample including unkeyed fields', () => {
    const f = provenanceFixture(), r = f.records[0], [keyed, unkeyed] = boneKeys(f)
    f.runtime.setDocument(doc([
        { id: 'a', actorKey: r.display.root.uuid, channel: 'action', keys: [{ id: 'a0', time: 0, value: { name: 'Action' } }] },
        { id: 'b', actorKey: r.display.root.uuid, channel: 'bone-rotation', property: unkeyed, keys: [{ id: 'b0', time: 0, value: [0, 0, Math.sin(.3), Math.cos(.3)] }] },
    ])); f.runtime.play(); f.frame(0.25); f.frame(0.25)
    assert.equal(r.display.keyed.position.x, 0.5); assert.equal(r.display.unkeyed.position.x, 1)
    assert.ok(r.display.unkeyed.quaternion.angleTo(new Quaternion(0,0,Math.sin(.3),Math.cos(.3))) < 1e-7)
    const submits = f.rows.filter(row => row[0] === 'submit-evaluator')
    assert.deepEqual(submits.map(row => row[3].bones[keyed].position[0]), [0.25, 0.5])
    assert.deepEqual(submits.map(row => row[3].bones[unkeyed].position[0]), [1, 1])
    const phases = f.rows.filter(row => row[1] === r.display.root.uuid).map(row => row[0])
    for (let i = 0; i < phases.length; i++) if (phases[i] === 'manual-commit') assert.deepEqual(phases.slice(i - 3, i + 2), ['action', 'issued', 'submit-evaluator', 'manual-commit', 'native-phase'])
    f.dispose()
})

test('provenance same renderer token is actor-local and duplicate callbacks never write a second time', () => {
    const f = provenanceFixture()
    const tracks = f.records.map((r, i) => ({ id: `b${i}`, actorKey: r.display.root.uuid, channel: 'bone-rotation', property: boneKeys(f, i)[1], keys: [{ id: `p${i}`, time: 0, value: [0, 0, Math.sin(.2+i*.1), Math.cos(.2+i*.1)] }] }))
    f.runtime.setDocument(doc(tracks)); f.runtime.play(); f.frame(0.25)
    assert.equal(f.runtime.time, 0.25)
    assert.deepEqual(f.rows.filter(row => row[0] === 'manual-commit').map(row => row[2]), [1, 1])
    f.callbacks.body(0.25, f.context(0)); f.callbacks.body(0.25, f.context(1))
    assert.equal(f.rows.filter(row => row[0] === 'manual-commit').length, 2)
    assert.equal(f.records[0].display.unkeyed.position.x, 1); assert.equal(f.records[1].display.unkeyed.position.x, 1)
    f.records.forEach((r,i)=>assert.ok(r.display.unkeyed.quaternion.angleTo(new Quaternion(0,0,Math.sin(.2+i*.1),Math.cos(.2+i*.1)))<1e-7))
    f.dispose()
})

test('provenance missing host protocol fails closed before manual gizmo attachment without disabling root controls', () => {
    const f = provenanceFixture({ noProtocol: true }), r = f.records[0]
    const result = f.runtime.beginDrag(r.display.root.uuid, 'joint', boneKeys(f)[1])
    assert.equal(result.status, 'unavailable'); assert.match(result.reason, /WAIT_EVALUATED_FRAME/)
    assert.equal(f.drag(), undefined); assert.equal(r.display.unkeyed.position.x, 1)
    assert.equal(f.runtime.beginDrag(r.display.root.uuid, 'root').status, 'ready')
    f.drag().object.position.x = 7; f.drag().onChange(); f.frame(); assert.equal(r.display.root.position.x, 7)
    f.dispose()
})

test('provenance missing incomplete mismatched or rejected frames preserve live bones and never fall back to displayed capture', () => {
    for (const option of ['missingFrame', 'incomplete', 'badIdentity', 'rejectCommit', 'nonfinite']) {
        const f = provenanceFixture({ [option]: true }), r = f.records[0]
        assert.equal(f.runtime.beginDrag(r.display.root.uuid, 'joint', boneKeys(f)[1]).status, 'ready')
        f.drag().object.position.x = 9; f.drag().onChange(); f.frame()
        assert.equal(r.display.unkeyed.position.x, 1, option)
        assert.equal(f.rows.filter(row => row[0] === 'manual-commit').length, 0)
        assert.match(f.runtime.lastError, /WAIT_EVALUATED_FRAME|finite/); f.dispose()
    }
})

test('provenance stale generation old frame and detached stale gizmo callbacks cannot change either actor', () => {
    const f = provenanceFixture(), r = f.records[0]
    f.runtime.beginDrag(r.display.root.uuid, 'joint', boneKeys(f)[1]); const request = f.drag()
    request.object.position.x = 9; request.onChange(); f.frame()
    const count = f.rows.length
    f.callbacks.body(0.2, { ...f.context(0), frameId: 0 }); f.callbacks.body(0.2, { ...f.context(0), generation: 2 })
    assert.equal(f.rows.length, count)
    f.remove(0); request.object.position.x = 100; request.onChange(); f.frame()
    assert.equal(r.display.unkeyed.position.x, 1); assert.equal(f.records[1].display.unkeyed.position.x, 1)
    f.dispose()
})

test('provenance held return and regrab retain displayed interruption while only host owns return writes', () => {
    const f = provenanceFixture({ transition: 0.2 }), r = f.records[0], key = boneKeys(f)[1]
    f.runtime.beginDrag(r.display.root.uuid, 'joint', key); f.drag().object.position.x = 9; f.drag().onChange()
    f.frame(); f.frame(); assert.equal(r.display.unkeyed.position.x, 1)
    f.runtime.stop()
    const handoff = f.rows.find(row => row[0] === 'begin-return')
    assert.equal(handoff[2].bones[key].position[0], 1); assert.equal(handoff[3], 0.2)
    const count = f.rows.filter(row => row[0] === 'manual-commit').length
    // External host/native has now produced a returning displayed pose; MODEL must not remix it.
    r.display.unkeyed.rotation.z = .5; f.frame()
    assert.ok(Math.abs(r.display.unkeyed.rotation.z-.5)<1e-7); assert.equal(f.rows.filter(row => row[0] === 'manual-commit').length, count)
    f.runtime.beginDrag(r.display.root.uuid, 'joint', key)
    assert.ok(Math.abs(f.drag().object.rotation.z-.5)<1e-7); f.drag().object.rotation.z=.7; f.drag().onChange()
    assert.ok(Math.abs(r.display.unkeyed.rotation.z-.5)<1e-7); f.frame(); assert.ok(Math.abs(r.display.unkeyed.rotation.z-.7)<1e-7)
    assert.equal(r.display.unkeyed.position.x,1)
    assert.equal(f.rows.filter(row => row[0] === 'submit-evaluator').at(-1)[3].bones[key].position[0], 1)
    f.dispose()
})

test('provenance frame acquisition failure does not advance the manual transition or commit faces', () => {
    const options = { transition: 0.2, missingFrame: true }, f = provenanceFixture(options), r = f.records[0], key = boneKeys(f)[1]
    f.runtime.setDocument(doc([{ id: 'b', actorKey: r.display.root.uuid, channel: 'bone-rotation', property: key, keys: [{ id: 'p', time: 0, value: [0, 0, Math.sin(.4), Math.cos(.4)] }] }]))
    f.runtime.play(); f.frame(0.2); f.frame(0.2); assert.equal(r.display.unkeyed.position.x, 1)
    options.missingFrame = false; f.frame(0.1); assert.equal(r.display.unkeyed.position.x, 1)
    f.frame(0.1); assert.ok(Math.abs(r.display.unkeyed.rotation.z-.4)<1e-7)
    f.frame(0.1); assert.ok(Math.abs(r.display.unkeyed.rotation.z-.8)<1e-7)
    assert.equal(r.display.unkeyed.position.x,1)
    f.dispose()
})
