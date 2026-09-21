import assert from 'node:assert/strict'
import test from 'node:test'
import { PerformanceTimeline, emptyPerformanceDocument } from './src/viewer/performanceEditor/timeline.ts'

const rootTrack = (actorKey = 'actor-a') => ({ id: actorKey, actorKey, channel: 'root-position', keys: [
    { id: `${actorKey}-0`, time: 0, value: [0, 0, 0] }, { id: `${actorKey}-1`, time: 1, value: [10, 0, 0] },
] })
const make = tracks => new PerformanceTimeline({ ...emptyPerformanceDocument(), duration: 2, tracks })

test('pure sample interpolates independently for two resource instances', () => {
    const timeline = make([rootTrack(), rootTrack('actor-b')])
    assert.deepEqual(timeline.sample(0.25).map(row => [row.track.actorKey, row.value]), [['actor-a', [2.5, 0, 0]], ['actor-b', [2.5, 0, 0]]])
    const detached = timeline.value; detached.tracks[0].keys[0].value[0] = 500
    assert.equal(timeline.sample(0)[0].value[0], 0)
})
test('same-action keys retain distinct beat identities and never start before first authored key', () => {
    const timeline = make([{ id: 'action', actorKey: 'actor-a', channel: 'action', keys: [
        { id: 'beat-a', time: 0.2, value: { name: 'Action', loop: false } },
        { id: 'beat-b', time: 0.8, value: { name: 'Action', loop: false } },
    ] }])
    assert.equal(timeline.sample(0).length, 0)
    assert.equal(timeline.sample(0.4)[0].keyId, 'beat-a')
    assert.deepEqual(timeline.actionCrossings(0, 1).map(row => row.key.id), ['beat-a', 'beat-b'])
    assert.equal(timeline.sample(1)[0].keyId, 'beat-b')
    assert.ok(Math.abs(timeline.sample(1)[0].localTime - 0.2) < 1e-8)
})
test('serialization, key insert/update/delete and fixed-time sampling round trip', () => {
    const timeline = make([rootTrack()])
    timeline.upsertKey('actor-a', { id: 'middle', time: 0.5, value: [3, 1, 0] })
    assert.deepEqual(PerformanceTimeline.deserialize(timeline.serialize()).sample(0.5), timeline.sample(0.5))
    timeline.upsertKey('actor-a', { id: 'middle', time: 0.75, value: [4, 2, 0] })
    assert.deepEqual(timeline.sample(0.75)[0].value, [4, 2, 0])
    timeline.deleteKey('actor-a', 'middle'); assert.deepEqual(timeline.sample(0.5)[0].value, [5, 0, 0])
})
test('invalid edit is atomic; duplicate channels, key IDs and nonfinite values fail', () => {
    const timeline = make([rootTrack()]); const before = timeline.serialize()
    assert.throws(() => timeline.upsertKey('actor-a', { id: 'bad', time: NaN, value: [1, 2, 3] }))
    assert.equal(timeline.serialize(), before)
    assert.throws(() => make([rootTrack(), { ...rootTrack(), id: 'another' }]))
    assert.throws(() => make([{ ...rootTrack(), keys: [{ id: 'bad', time: 0, value: [Infinity, 0, 0] }] }]))
})
test('bone quaternion and signed expression channels preserve authored values', () => {
    const timeline = make([
        { id: 'bone', actorKey: 'a', channel: 'bone-rotation', property: './0:joint', keys: [
            { id: 'r0', time: 0, value: [0, 0, 0, 1] }, { id: 'r1', time: 1, value: [0, 1, 0, 0] },
        ] },
        { id: 'face', actorKey: 'a', channel: 'morph', property: './1:face#Smile', keys: [
            { id: 'm0', time: 0, value: -1 }, { id: 'm1', time: 1, value: 2 },
        ] },
    ])
    assert.ok(Math.abs(timeline.sample(0.5)[0].value[1] - Math.SQRT1_2) < 1e-8)
    assert.equal(timeline.sample(0)[1].value, -1); assert.equal(timeline.sample(1)[1].value, 2)
})
test('empty document stays executable without actor capability assumptions', () => {
    const timeline = new PerformanceTimeline()
    assert.deepEqual(timeline.sample(0), [])
    assert.throws(() => timeline.sample(NaN))
})
