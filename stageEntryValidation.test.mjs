import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
const source = fs.readFileSync(process.env.S6_STAGE_ENTRY_SOURCE || 'src/viewer/stages.ts', 'utf8')
const start = source.indexOf('function createStageSelectorOption(')
const end = source.indexOf('function refreshStageSelectorLabels', start)
const compiled = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const create = new Function('document', 'getStageSceneNameRecord', 'stageSceneNameIndex', 'stageDisplayName', 'getUiLocale', compiled + ';return createStageSelectorOption')(
    { createElement: () => ({ dataset: {}, disabled: false, title: '' }) }, () => undefined, {}, d => d.name, () => 'zh-CN',
)
const validation = { status: 'load-tested', visibleMeshCount: 284, resourceFileCount: 25, evidence: ['actual-loader-draw-probe', 'same-origin-resource-byte-check'] }
const stage = extra => ({ id: 'sample', name: 'Scene', official: true, type: 'fbx', url: './scene.fbxdata', dynamic: { status: 'partial', missing: ['native effects'] }, ...extra })
test('load-tested formal scene is enterable while dynamic fidelity remains partial', () => {
    const definition = stage({ entryValidation: validation }), before = structuredClone(definition)
    const option = create(definition)
    assert.equal(option.disabled, false)
    assert.equal(option.dataset.dynamic, 'partial')
    assert.equal(option.dataset.availability, 'load-tested-partial')
    assert.match(option.title, /效果.*恢复/)
    assert.deepEqual(definition, before)
})
test('mere profile presence and geometry type do not bypass restoration status', () => {
    for (const extra of [{}, { sceneProfileUrl: './profile.json' }, { nativeVisibility: { gameObjects: [{}] } }]) assert.equal(create(stage(extra)).disabled, true)
})
test('zero geometry, absent resources, no evidence and wrong entry kind remain pending', () => {
    for (const delta of [{ visibleMeshCount: 0 }, { resourceFileCount: 0 }, { evidence: [] }, { status: 'declared' }, { visibleMeshCount: NaN }, { resourceFileCount: 1.5 }]) {
        assert.equal(create(stage({ entryValidation: { ...validation, ...delta } })).disabled, true)
    }
    assert.equal(create(stage({ type: 'procedural', entryValidation: validation })).disabled, true)
})
test('pending, absent and presentation products are not promoted by a load record', () => {
    for (const status of ['pending', 'absent', 'product-presentation']) assert.equal(create(stage({ dynamic: { status }, entryValidation: validation })).disabled, true)
})
test('verified entry hint is localized without overwriting native names', () => {
    for (const [locale, pattern] of [['zh-CN', /效果.*恢复/], ['ja-JP', /エフェクト/], ['en-US', /effects/]]) {
        const factory = new Function('document','getStageSceneNameRecord','stageSceneNameIndex','stageDisplayName','getUiLocale',compiled+';return createStageSelectorOption')({createElement:()=>({dataset:{},disabled:false,title:''})},()=>undefined,{},d=>d.name,()=>locale)
        const option = factory(stage({ entryValidation: validation }))
        assert.match(option.title, pattern); assert.equal(option.textContent, 'Scene')
    }
})
