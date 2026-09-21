import assert from 'node:assert/strict'
import test from 'node:test'
import { Group } from 'three'
import { PerformanceTimeline, emptyPerformanceDocument } from './src/viewer/performanceEditor/timeline.ts'
import { PerformanceEditorRuntime } from './src/viewer/performanceEditor/runtime.ts'

const audio = { id: 'voice-a', sourceStableKey: 'cri-cue:cueSheetName=SAMPLE|cueName=voice-a', startTime: 0.25, offsetSeconds: 0.1, durationSeconds: 1.2, volume: 0.8, lipSync: true }

test('audio lane metadata is explicit, detached from pose tracks, and round-trips', () => {
    const doc = { ...emptyPerformanceDocument(), duration: 2, audioTracks: [audio] }
    const timeline = new PerformanceTimeline(doc)
    assert.deepEqual(timeline.value.audioTracks, [audio])
    assert.deepEqual(PerformanceTimeline.deserialize(timeline.serialize()).value.audioTracks, [audio])
    assert.deepEqual(timeline.sample(1), [])
})

test('audio lane metadata rejects duplicate IDs, empty sources, and out-of-range values', () => {
    const base = { ...emptyPerformanceDocument(), duration: 2 }
    assert.throws(() => new PerformanceTimeline({ ...base, audioTracks: [{ ...audio, id: 'x' }, { ...audio, id: 'x' }] }), /audio track metadata/)
    assert.throws(() => new PerformanceTimeline({ ...base, audioTracks: [{ ...audio, sourceStableKey: ' ' }] }), /audio track metadata/)
    assert.throws(() => new PerformanceTimeline({ ...base, audioTracks: [{ ...audio, startTime: 3 }] }), /audio track metadata/)
    assert.throws(() => new PerformanceTimeline({ ...base, audioTracks: [{ ...audio, volume: 2 }] }), /audio track metadata/)
})

function fixture() {
    const object = new Group()
    const descriptor = { object, generation: 1, label: 'SAMPLE', actions: [], isCurrent: () => true }
    const callbacks = {}
    const runtime = new PerformanceEditorRuntime({
        actorSource: { list: () => [descriptor], subscribe: () => () => {} },
        framePort: { subscribeBeforePhysics: callback => { callbacks.body = callback; return () => {} }, subscribeFinalPoseBeforeCamera: () => () => {} },
        channelHost: { acquire: () => ({ status: 'ready', value: {
            active: true,
            captureEvaluated: () => ({ root: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, bones: {}, morphs: {} }),
            sampleActionAt: () => {}, playActionBeat: () => {}, releaseFromEvaluated: () => {},
        } }), notifyRootTransformChanged: () => {} },
    })
    return { runtime, object, callbacks }
}

test('shared clock emits state without touching audio or starting playback', () => {
    const f = fixture(); const events = []
    const unsubscribe = f.runtime.subscribeClock(snapshot => events.push(snapshot))
    f.runtime.setDocument({ ...emptyPerformanceDocument(), duration: 2, audioTracks: [audio], tracks: [{ id: 'root', actorKey: f.object.uuid, channel: 'root-position', keys: [{ id: 'k0', time: 0, value: [0, 0, 0] }, { id: 'k1', time: 2, value: [2, 0, 0] }] }] })
    f.runtime.play()
    f.callbacks.body(0.5, { frameId: 1, actorKey: f.object.uuid, generation: 1 })
    f.runtime.pause(); f.runtime.seek(0.25); f.runtime.stop()
    assert.deepEqual(events.map(event => event.reason), ['document', 'play', 'frame', 'pause', 'seek', 'stop'])
    assert.equal(events.find(event => event.reason === 'frame').time, 0.5)
    assert.equal(events.find(event => event.reason === 'frame').playing, true)
    assert.equal(f.runtime.timeline.value.audioTracks[0].sourceStableKey, audio.sourceStableKey)
    unsubscribe(); f.runtime.dispose()
})

