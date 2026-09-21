import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import zlib from 'node:zlib'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const decoderStage = path.join(
    root,
    'artifacts/verification/20260901-combat-vfx-pptr-sprite-closure/decoder-stage',
)
const candidateGate = JSON.parse(fs.readFileSync(path.join(
    root,
    'artifacts/verification/20260901-combat-vfx-pptr-sprite-closure/',
    'real-viewer-candidate-gate.v2.json',
), 'utf8'))
const formalGate = JSON.parse(fs.readFileSync(path.join(
    root,
    'artifacts/verification/20260901-combat-vfx-pptr-sprite-closure/',
    'real-viewer-formal-runtime-gate.v1.json',
), 'utf8'))

const cases = [
    {
        file: 'enemy_650002_wholeskill.profile.json',
        clipPathID: '7647310951316806553',
        bindings: 28,
        mappings: 532,
        sprites: 19,
    },
    {
        file: 'enemy_650002_wholeskill_sp.profile.json',
        clipPathID: '2224183788328514242',
        bindings: 33,
        mappings: 891,
        sprites: 16,
    },
    {
        file: 'special_skill_direction_10020201.profile.json',
        clipPathID: '-7021196539137194789',
        bindings: 1,
        mappings: 1,
        sprites: 1,
    },
]

const readProfile = file => JSON.parse(fs.readFileSync(
    path.join(decoderStage, file),
    'utf8',
))

const productCases = [
    ['enemy', 'enemy_650002_wholeskill', 28, 532, 19],
    ['enemy', 'enemy_650002_wholeskill_sp', 33, 891, 16],
    ['character', 'special_skill_direction_10020201', 1, 1, 1],
]

test('three bounded clips decode exact PPtr sprite curves and targets', () => {
    for (const expected of cases) {
        const profile = readProfile(expected.file)
        const clips = profile.runtime.serializedComponentClips.filter(
            clip => clip.pathID === expected.clipPathID,
        )
        assert.equal(clips.length, 1, expected.file)
        const clip = clips[0]
        const bindings = clip.bindings.filter(binding => binding.isPPtrCurve)
        const keys = bindings.flatMap(binding => binding.curves[0])

        assert.equal(clip.decodeStatus, 'complete')
        assert.equal(bindings.length, expected.bindings)
        assert.equal(clip.pptrCurveMapping.length, expected.mappings)
        assert.equal(clip.spriteAssets.length, expected.sprites)
        assert.equal(keys.length, expected.mappings)
        assert.equal(new Set(keys.map(key => key.mappingIndex)).size, expected.mappings)
        assert.ok(bindings.every(binding => binding.propertyName === 'm_Sprite'))
        assert.ok(bindings.every(binding => binding.targets.length === 1))
        assert.ok(keys.every(key => key.interpolation === 'step'))
        assert.ok(keys.every(key => Number.isInteger(key.mappingIndex)))
        assert.ok(keys.every(
            key => key.mappingIndex >= 0 && key.mappingIndex < expected.mappings,
        ))
    }
})

test('PPtr mapping validation fails closed for fractional and out-of-range values', () => {
    const source = String.raw`
import importlib.util
from pathlib import Path

source = Path(r'${path.join(root, 'tools/magius/extract_magius_scene_profile.py')}')
spec = importlib.util.spec_from_file_location('magius_extractor', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

assert module.validated_pptr_mapping_index(0.0, 1, 'fixture') == 0
for value, count, fragment in [
    (0.5, 1, 'non-integral'),
    (-1.0, 1, 'out of range'),
    (1.0, 1, 'out of range'),
    (float('nan'), 1, 'non-integral'),
]:
    try:
        module.validated_pptr_mapping_index(value, count, 'fixture')
    except ValueError as error:
        assert fragment in str(error), (value, error)
    else:
        raise AssertionError(f'accepted invalid PPtr mapping index: {value}')
print('NEGATIVE_PPTR_GATE=4/4 PASS')
`
    const output = execFileSync('python', ['-c', source], {
        cwd: root,
        encoding: 'utf8',
    })
    assert.match(output, /NEGATIVE_PPTR_GATE=4\/4 PASS/)
})

test('deterministic research and public products close every Sprite dependency', () => {
    for (const [kind, direction, bindingCount, frameCount, assetCount] of productCases) {
        const researchDirectory = path.join(
            root,
            'artifacts/research/20260826-all-enemy-character-skill-vfx-products-v2/products',
            kind,
            direction,
        )
        const publicDirectory = path.join(root, 'public/vfx', kind, direction)
        const research = JSON.parse(fs.readFileSync(
            path.join(researchDirectory, 'product.json'),
            'utf8',
        ))
        const published = JSON.parse(zlib.gunzipSync(fs.readFileSync(
            path.join(publicDirectory, 'product.vfxdata'),
        )))
        for (const product of [research, published]) {
            const runtime = product.spriteRuntime
            assert.equal(runtime.schema, 'magius.combat-vfx-pptr-sprite-runtime.v1')
            assert.equal(runtime.interpolation, 'step')
            assert.equal(runtime.clips.length, 1)
            assert.equal(runtime.clips[0].bindings.length, bindingCount)
            assert.equal(runtime.clips[0].mappings.length, frameCount)
            assert.equal(
                runtime.clips[0].bindings.reduce(
                    (sum, binding) => sum + binding.keys.length,
                    0,
                ),
                frameCount,
            )
            assert.equal(runtime.assets.length, assetCount)
            assert.ok(runtime.clips[0].bindingHierarchy.length > 0)
            assert.ok(runtime.clips[0].bindingHierarchy.every(row => row.name))
            assert.equal(
                product.authority.pptrSpriteClosure.status,
                'runtime-ready-verified',
            )
            assert.match(
                product.authority.pptrSpriteClosure.formalRuntimeGate,
                /real-viewer-formal-runtime-gate\.v1\.json$/,
            )
        }
        for (const asset of research.spriteRuntime.assets) {
            const relative = asset.runtimeUrl.replace(/^\.\//, '')
            const researchBytes = fs.readFileSync(path.join(researchDirectory, relative))
            const publicBytes = fs.readFileSync(path.join(publicDirectory, relative))
            assert.deepEqual(publicBytes, researchBytes, asset.stableKey)
            assert.ok(asset.imageWidth > 0 && asset.imageHeight > 0)
        }
    }
})

test('accepted real Viewer gate promotes only the three decoded stable keys', () => {
    const expected = productCases
        .map(([kind, direction]) => `${kind}|${direction}`)
        .sort()
    assert.equal(candidateGate.schema, 'magius.combat-vfx-pptr-real-viewer-candidate-gate.v2')
    assert.equal(candidateGate.passed, true)
    assert.deepEqual([...candidateGate.candidateStableKeys].sort(), expected)
    assert.deepEqual(
        candidateGate.ordinaryCalls.map(row => row.stableKey).sort(),
        expected,
    )
    assert.ok(candidateGate.ordinaryCalls.every(
        row => row.rejected === true && row.code === 'NOT_FOUND',
    ))
    assert.deepEqual(candidateGate.previews.map(row => row.stableKey).sort(), expected)
    assert.ok(candidateGate.previews.every(row => row.passed && row.disposed))
    assert.ok(candidateGate.previews.every(row =>
        row.final.spriteBindingCount > 0
        && row.final.spriteAppliedFrames > 0
        && row.final.missingSpritePaths.length === 0))

    const catalog = JSON.parse(fs.readFileSync(
        path.join(root, 'public/vfx/catalog.v1.json'),
        'utf8',
    ))
    assert.equal(catalog.counts.targetRuntimeReady, 654)
    assert.equal(catalog.counts.targetFailClosed, 0)
    for (const stableKey of expected) {
        const entry = catalog.entries.find(row => row.stableKey === stableKey)
        assert.equal(entry?.status, 'runtime-ready')
        assert.equal(entry?.runtimeReady, true)
        assert.deepEqual(entry?.failClosedReasons, [])
    }
})

test('formal Viewer path plays, stops, suppresses and resumes all promoted products', () => {
    const expected = productCases
        .map(([kind, direction]) => `${kind}|${direction}`)
        .sort()
    assert.equal(formalGate.schema, 'magius.combat-vfx-pptr-formal-runtime-gate.v1')
    assert.equal(formalGate.passed, true)
    assert.deepEqual(formalGate.playStop.map(row => row.stableKey).sort(), expected)
    assert.ok(formalGate.playStop.every(row =>
        row.passed
        && row.result.status === 'played'
        && row.active.spriteBindingCount > 0
        && row.active.spriteAppliedFrames > 0
        && row.active.timelineTime > 0
        && row.active.missingSpritePaths.length === 0
        && row.stopActiveCount === 0))
    assert.equal(formalGate.catalog.targetProducts, 654)
    assert.equal(formalGate.catalog.targetRuntimeReady, 654)
    assert.equal(formalGate.catalog.targetFailClosed, 0)
    assert.equal(formalGate.disable.passed, true)
    assert.equal(formalGate.disable.enabledAfterDisable, false)
    assert.equal(formalGate.disable.activeAfterDisable, 0)
    assert.equal(formalGate.disable.suppressedResult.status, 'suppressed')
    assert.equal(
        formalGate.disable.suppressedAfter,
        formalGate.disable.suppressedBefore + 1,
    )
    assert.equal(formalGate.disable.enabledAfterReenable, true)
    assert.equal(formalGate.disable.replayResult.status, 'played')
    assert.equal(formalGate.disable.finalActiveCount, 0)
})

test('publisher discovers the bounded authority and consumer remains data-driven', () => {
    const publisher = fs.readFileSync(
        path.join(root, 'scripts/close-combat-vfx-pptr-sprite-products.py'),
        'utf8',
    )
    const consumer = fs.readFileSync(path.join(root, 'src/viewer/combatVfx.ts'), 'utf8')
    assert.match(publisher, /fail-closed-authority\.v2\.json/)
    assert.match(publisher, /runtime-consumer-verification-pending/)
    assert.doesNotMatch(publisher, /enemy_650002_wholeskill/)
    assert.doesNotMatch(publisher, /special_skill_direction_10020201/)
    assert.match(consumer, /function createSpriteRuntime\(/)
    assert.match(consumer, /spriteClipTime\(/)
    assert.match(consumer, /spriteFrameChanges/)
    assert.match(consumer, /async function loadCombatVfxProductInternal\(/)
    assert.match(consumer, /export async function loadCombatVfxProduct\(bundleKey: string\)/)
    assert.match(consumer, /loadCombatVfxProductInternal\(bundleKey, false\)/)
    assert.match(consumer, /loadCombatVfxProductInternal\(bundleKey, true\)/)
    assert.doesNotMatch(
        consumer,
        /export async function loadCombatVfxProduct\([\s\S]{0,160}allowFailClosedPreview/,
    )
    assert.doesNotMatch(consumer, /enemy_650002_wholeskill/)
    assert.doesNotMatch(consumer, /special_skill_direction_10020201/)
})
