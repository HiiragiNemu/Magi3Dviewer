import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = 'artifacts/runtime/20260817-tw-shader-capture'
const summaryPath = 'research/tw-gles-runtime-evidence-20260817.json'

function assertRuntimeContract(report) {
    assert.equal(report.programCount, 19)
    assert.deepEqual(report.classifiedPrograms.ReDriveToon, [315, 333, 336, 369])
    assert.deepEqual(report.classifiedPrograms.EnemyUber, [981, 1017])
    assert.deepEqual(report.classifiedPrograms.ColorGrading, [102])
    assert.deepEqual(report.fullBgUberPrograms, [1317, 1320])
    assert.deepEqual(report.requiredGenericGroundVertexChannels, [
        'POSITION', 'NORMAL', 'TANGENT', 'COLOR', 'TEXCOORD0', 'TEXCOORD1',
    ])
    assert.deepEqual(report.liveStageValues._BgColorAdjustments, [1, 1.0499999523162842, 1.148698329925537])
    assert.deepEqual(report.liveStageValues._AdditionalLightsCount, [8, 0, 0, 0])
    assert.deepEqual(report.liveColorGradingValues._HueSatCon, [0, 1.149999976158142, 1.100000023841858, 0])
    assert.deepEqual(report.liveColorGradingValues._Lut_Params, [16, 0.001953125, 0.03125, 1.0666667222976685])
    assert.ok(report.uniformBlockContracts.some(block => (
        block.program === 315
        && block.name === 'UnityPerMaterial'
        && block.dataSize === 552
        && block.memberCount === 88
    )))
    assert.ok(report.uniformBlockContracts.some(block => (
        block.program === 1317
        && block.name === 'UnityPerMaterial'
        && block.dataSize === 532
        && block.memberCount === 80
    )))
}

test('tracked TW battle evidence contract proves official ground channels and post values', () => {
    assertRuntimeContract(JSON.parse(readFileSync(summaryPath, 'utf8')))
})

test('bounded raw TW battle capture regenerates the tracked contract', t => {
    if (!existsSync(`${root}/tw-gles-program-interfaces.json`)) {
        t.skip('raw runtime capture is intentionally not committed')
        return
    }
    const temporary = mkdtempSync(join(tmpdir(), 'magius-tw-gles-'))
    try {
        const output = join(temporary, 'summary.json')
        const run = spawnSync(process.env.PYTHON ?? 'python', [
            'scripts/summarize-tw-gles-runtime.py',
            '--interfaces', `${root}/tw-gles-program-interfaces.json`,
            '--values', `${root}/tw-gles-values-blocks.json`,
            '--screenshot', `${root}/tw-battle-display3-baseline.png`,
            '--out', output,
        ], { encoding: 'utf8' })
        assert.equal(run.status, 0, run.stderr || run.stdout)
        const report = JSON.parse(readFileSync(output, 'utf8'))
        assertRuntimeContract(report)
        assert.deepEqual(report, JSON.parse(readFileSync(summaryPath, 'utf8')))
    } finally {
        rmSync(temporary, { recursive: true, force: true })
    }
})
