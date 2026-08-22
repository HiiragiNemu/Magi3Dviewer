import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const artifactRoot = 'artifacts/runtime/20260817-home-transform-closure'
const summaryPath = 'research/home-animation-integrity-20260817.json'

function assertIntegrityContract(report) {
    assert.equal(report.schema, 'magia-home-animation-integrity-gate-v1')
    assert.deepEqual(report.generatorContract, {
        preserveAllNodes: true,
        clipSelection: 'exact-source-path-id',
        targetBinding: 'exact-character-local-path',
        nearestParentFallback: false,
    })
    assert.deepEqual(report.batchBuild, {
        requested: 90,
        passed: 89,
        skipped: 1,
        skippedCharacterIds: ['100101'],
    })
    assert.equal(report.sourceBinding.characterCount, 91)
    assert.equal(report.sourceBinding.strictSafeCount, 91)
    assert.equal(report.sourceBinding.charactersWithMissingTerminalPaths, 0)
    assert.equal(report.sourceBinding.missingTerminalPathCount, 0)
    assert.equal(report.sourceBinding.confirmedNearestParentOverwriteCount, 0)
    assert.equal(report.sourceBinding.confirmedNearestParentOverwriteCountRecomputed, 0)
    assert.equal(report.sourceBinding.actionFamilyCollisionCount, 0)
    assert.deepEqual(report.skinning.classificationCounts, {
        'no-same-source-evidence': 83,
        'native-visual-review': 8,
    })
    assert.equal(report.skinning.hardBlockerCount, 0)
    assert.equal(report.skinning.nativeVisualReviewCount, 8)
    assert.deepEqual(report.geometryReviewWarnings.map(item => item.characterId), [
        '100304', '100504', '101701', '107101', '108602', '110401', '115001', '115101',
    ])
    assert.deepEqual(report.geometryBlockers, [])
    assert.deepEqual(report.unresolved, [{
        characterId: '100101',
        reason: 'official Home runtime source is absent from the local JP corpus',
    }])
    assert.equal(report.character101901.before.runtimeTransformPaths, 184)
    assert.equal(report.character101901.before.missingTerminalPaths, 5)
    assert.equal(report.character101901.before.maximumHairEdgeRatio, 7.906)
    assert.equal(report.character101901.after.runtimeTransformPaths, 189)
    assert.equal(report.character101901.after.missingTerminalPaths, 0)
    assert.deepEqual(report.character101901.after.geometryWarningClips, [])
    assert.deepEqual(report.character101901.after.geometryHardBlockerClips, [])
    assert.ok(report.character101901.after.maximumHairEdgeRatio < 2)
    assert.ok(report.character101901.after.maximumFaceEdgeRatio < 2)
}

test('tracked global Home animation gate proves 101901 and same-class path closure', () => {
    assertIntegrityContract(JSON.parse(readFileSync(summaryPath, 'utf8')))
})

test('bounded raw Home audits regenerate the tracked gate', t => {
    const required = [
        `${artifactRoot}/source-binding-audit-final.json`,
        `${artifactRoot}/skinning-audit-final.json`,
        `${artifactRoot}/batch-build-schema2-full.json`,
    ]
    if (!required.every(existsSync)) {
        t.skip('full local Home audit artifacts are intentionally not committed')
        return
    }
    const temporary = mkdtempSync(join(tmpdir(), 'magius-home-integrity-'))
    try {
        const output = join(temporary, 'summary.json')
        const run = spawnSync(process.env.PYTHON ?? 'python', [
            'scripts/summarize-home-animation-integrity.py',
            '--source-audit', required[0],
            '--skinning-audit', required[1],
            '--batch-build', required[2],
            '--out', output,
        ], { encoding: 'utf8' })
        assert.equal(run.status, 0, run.stderr || run.stdout)
        const report = JSON.parse(readFileSync(output, 'utf8'))
        assertIntegrityContract(report)
        assert.deepEqual(report, JSON.parse(readFileSync(summaryPath, 'utf8')))
    } finally {
        rmSync(temporary, { recursive: true, force: true })
    }
})
