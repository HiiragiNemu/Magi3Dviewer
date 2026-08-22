import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const python = process.env.PYTHON ?? 'python'
const script = 'scripts/audit-home-runtime-corpus.py'
const root = 'magia-exedra-character-three/models'
const officialHomeRoot = 'D:/magia/Madoka Magica Magia Exedra Steam JP/AssetBundles/home/doll_house'

test('all locally shipped official Home runtimes pass the global corpus gate', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'magius-home-corpus-'))
    try {
        const output = join(temporary, 'corpus.json')
        const normal = spawnSync(python, [script, '--root', root, '--out', output], {
            encoding: 'utf8',
        })
        assert.equal(normal.status, 0, normal.stderr || normal.stdout)
        const report = JSON.parse(readFileSync(output, 'utf8'))
        assert.equal(report.summary.characterDirectoryCount, 91)
        assert.equal(report.summary.animationRuntimeCount, 91)
        assert.equal(report.summary.expressionRuntimeCount, 91)
        assert.deepEqual(report.summary.missingAnimationCharacterIds, [])
        assert.deepEqual(report.summary.missingExpressionCharacterIds, [])
        // 100101 intentionally uses the exact Style3DCharacterMst alias to
        // 100107.  Keep it visible as a retarget rather than mislabelling it
        // as a native per-character Home bundle.
        assert.deepEqual(report.summary.styleRetargetCharacterIds, [100101])
        assert.deepEqual(report.summary.invalidCharacterIds, [])
        assert.deepEqual(
            report.summary.characterIdsWithSignedOrOverOneWeights,
            [100201, 100205, 100207, 112401, 112601],
        )
        assert.equal(report.summary.signedOrOverOneWeightCount, 32)
        assert.equal(
            report.characters
                .filter(row => row.expressionRuntime)
                .every(row => row.expressionRuntime.morphChannelValidation
                    === 'homeCharacterRuntime.test.mjs'),
            true,
        )

        const strict = spawnSync(
            python,
            [script, '--root', root, '--out', output, '--strict-coverage'],
            { encoding: 'utf8' },
        )
        assert.equal(strict.status, 0, strict.stderr || strict.stdout)

        const officialStrict = spawnSync(
            python,
            [
                script,
                '--root', root,
                '--out', output,
                '--official-home-root', officialHomeRoot,
                '--strict-coverage',
            ],
            { encoding: 'utf8' },
        )
        // Four official Home sources are not yet represented by a Viewer model
        // directory, so the source-aware release gate must remain red rather
        // than claiming complete game coverage.
        assert.equal(officialStrict.status, 2, officialStrict.stderr || officialStrict.stdout)
        const officialReport = JSON.parse(readFileSync(output, 'utf8'))
        assert.equal(officialReport.summary.officialHomeSourceCharacterCount, 94)
        assert.deepEqual(
            officialReport.summary.missingAnimationWithOfficialSourceCharacterIds,
            [],
        )
        assert.deepEqual(
            officialReport.summary.missingExpressionWithOfficialSourceCharacterIds,
            [],
        )
        assert.deepEqual(
            officialReport.summary.missingRuntimeWithoutOfficialHomeSourceCharacterIds,
            [],
        )
        assert.deepEqual(
            officialReport.summary.styleRetargetWithoutOfficialHomeSourceCharacterIds,
            [100101],
        )
        assert.deepEqual(
            officialReport.summary.officialHomeSourceWithoutCharacterDirectoryIds,
            [100306, 100407, 100903, 111402],
        )
    } finally {
        rmSync(temporary, { recursive: true, force: true })
    }
})
