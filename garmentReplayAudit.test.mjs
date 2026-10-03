import test from 'node:test'
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { recordSkinComparison, applyGarmentFrame } from './scripts/audit-garment-replay.mjs'

test('replay skin measurement counts actual comparisons, not an initialized zero', () => {
    const stats = { count: 0, maxError: 0 }
    recordSkinComparison(stats, new Vector3(1, 2, 3), new Vector3(1 + 1e-7, 2, 3))
    assert.equal(stats.count, 1)
    assert.ok(stats.maxError > 0 && stats.maxError < 1e-5)
    assert.throws(() => recordSkinComparison(stats, new Vector3(), new Vector3(0, 0.1, 0)), /skin cache differs/)
    assert.equal(stats.count, 2)
    assert.equal(stats.maxError, 0.1)
})

test('replay skin measurement rejects missing and non-finite samples', () => {
    const stats = { count: 0, maxError: 0 }
    assert.throws(() => recordSkinComparison(stats, undefined, new Vector3()), /missing skin sample/)
    assert.throws(() => recordSkinComparison(stats, new Vector3(NaN, 0, 0), new Vector3()), /non-finite/)
    assert.equal(stats.count, 0)
})

test('replay rejects incomplete or non-finite held poses instead of silently filling them', () => {
    const f = { nodes: [{}] }
    assert.throws(() => applyGarmentFrame(f, { transforms: [] }))
    assert.throws(() => applyGarmentFrame(f, { transforms: Array(10).fill(NaN) }), /non-finite/)
})
