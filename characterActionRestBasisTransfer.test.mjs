import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import ts from 'typescript'

const repo = 'D:/magia/MyProducts/Magius3Dviewer-JP'
const authority = 'C:/Users/proje/Documents/Codex/2026-09-03/magius3dviewer-s6-unified-supervisor-successor/artifacts/20260905-resume-universal-performance/g22-authored-helper-channel-authority'
const prototype = 'C:/Users/proje/Documents/Codex/2026-09-03/magius3dviewer-s6-unified-supervisor-successor/artifacts/20260905-resume-universal-performance/g22-cross-rig-basis-prototype/transaction-target'

async function json(path) {
    return JSON.parse(await readFile(path, 'utf8'))
}

async function loadModule() {
    const source = await readFile(join(repo, 'src/viewer/characterActions/restBasisTransfer.ts'), 'utf8')
    const transpiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText
    return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`)
}

function adaptHelper(raw, target, semantic) {
    const product = raw.products.find(value => value.semantic === semantic)
    const declarations = product.declarations.map(value => ({
        ...value,
        relativePath: value.targetPath.slice(value.targetPath.indexOf('/Root/') + 1),
    }))
    return {
        clip: product.clip,
        declarations,
        sourceClipPathId: product.sourceClipPathId,
        semantic,
        sourceResourceId: '100201',
        targetResourceId: target,
    }
}

async function makeInput(target, semantic, mod) {
    const coreRaw = await json(join(prototype, `clips-${target}.json`))
    const helperRaw = await json(join(authority, `helper-clips-${target}.json`))
    const core = coreRaw.products.find(value => value.semantic === semantic)
    const modelKey = `chara_${target}_battle_unit`
    const modelRootName = `chara_${target}_model/chara_${target}`
    return {
        sourceResourceId: '100201',
        targetResourceId: target,
        semantic,
        sourceClipPathId: core.sourceClipPathId,
        modelKey,
        modelRootName,
        writableSnapshot: { status: 'ready', rootIdentity: modelKey },
        coreClip: core.clip,
        helper: adaptHelper(helperRaw, target, semantic),
    }
}

const mod = await loadModule()

test('rest basis exposes exactly six authored helper roles and immutable source constants', () => {
    assert.equal(mod.REST_BASIS_HELPER_ROLES.length, 6)
    assert.deepEqual(mod.REST_BASIS_HELPER_ROLES.map(value => value.sourceBindingId), [
        '975d658a-2941-4b39-aa0c-dac629161bea',
        'f5644770-914b-472e-a4e5-11ec77b9947e',
        '80bc9f34-2b4a-4881-ab18-a483646b12b0',
        '604e72dc-ab6f-43d7-aab5-d5fe321d14b0',
        '175f0496-48bd-453e-8741-1d6cea9589a7',
        '77eda2fc-b51e-4f31-9109-b444a447dea7',
    ])
    assert.equal(Object.isFrozen(mod.REST_BASIS_HELPER_ROLES), true)
})

for (const target of ['101901', '100304']) {
    for (const semantic of ['idle', 'walk', 'run']) {
        test(`composes ${semantic} 24-track core plus six helpers for ${target}`, async () => {
            const input = await makeInput(target, semantic, mod)
            const before = JSON.stringify(input.coreClip)
            const result = mod.buildRestBasisTransfer(input)
            assert.equal(result.schema, 'magius.g22.rest-basis-transfer.v1')
            assert.equal(result.trackCount, 30)
            assert.equal(result.coreTrackCount, 24)
            assert.equal(result.helperTrackCount, 6)
            assert.equal(result.clip.tracks.length, 30)
            assert.equal(result.helperBindings.length, 6)
            assert.equal(result.nativePhysicsPolicy, 'retain-target-native-post-mixer')
            assert.equal(result.integrationMode, 'declarative-transfer-only')
            assert.equal(JSON.stringify(input.coreClip), before)
            assert.equal(result.helperBindings.every(value => value.declaration.property === 'quaternion'), true)
        })
    }
}

test('rejects stale writable snapshot and root identity drift before composition', async () => {
    const input = await makeInput('101901', 'idle', mod)
    assert.throws(() => mod.buildRestBasisTransfer({ ...input, writableSnapshot: { status: 'pending', rootIdentity: input.modelKey } }), /writable-channel-not-ready/)
    assert.throws(() => mod.buildRestBasisTransfer({ ...input, writableSnapshot: { status: 'ready', rootIdentity: 'other-root' } }), /root-identity/)
})

test('rejects duplicate core bindings and helper collisions', async () => {
    const input = await makeInput('101901', 'walk', mod)
    const duplicateCore = { ...input.coreClip, tracks: [...input.coreClip.tracks, input.coreClip.tracks[0]] }
    assert.throws(() => mod.buildRestBasisTransfer({ ...input, coreClip: duplicateCore }), /core-track-count/)
    const collision = { ...input.helper, clip: { ...input.helper.clip, tracks: [...input.helper.clip.tracks] } }
    collision.clip.tracks[0] = { ...input.coreClip.tracks[0] }
    assert.throws(() => mod.buildRestBasisTransfer({ ...input, helper: collision }), /binding-collision/)
})

test('helper declaration helper is target-specific and does not schedule mixer/native writes', () => {
    const d = mod.helperDeclarationFor('100304', 'chara_100304_battle_unit', 'chara_100304_model/chara_100304', 0)
    assert.equal(d.property, 'quaternion')
    assert.match(d.targetPath, /^chara_100304_battle_unit\/VisualRoot\/chara_100304_model\/chara_100304\/Root\//)
    assert.equal(d.targetModelId, '2512601346704')
    const source = requireSourceForStaticScan
    assert.equal(/AnimationMixer|setLoop|\.update\(/.test(source), false)
})

const requireSourceForStaticScan = await readFile(join(repo, 'src/viewer/characterActions/restBasisTransfer.ts'), 'utf8')