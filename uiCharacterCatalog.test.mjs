import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import ts from 'typescript'

const repo = process.cwd()
const sourcePath = path.join(repo, 'src', 'viewer', 'uiCharacterCatalog.ts')
const compiledRoot = path.join(
    repo,
    'artifacts',
    'verification',
    '20260903-s6-ui-character',
    'test-compiled',
)
fs.mkdirSync(compiledRoot, { recursive: true })
const compiledPath = path.join(compiledRoot, 'uiCharacterCatalog.mjs')
const source = fs.readFileSync(sourcePath, 'utf8')
fs.writeFileSync(compiledPath, ts.transpileModule(source, {
    compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
        verbatimModuleSyntax: true,
    },
    fileName: 'uiCharacterCatalog.ts',
}).outputText, 'utf8')
const typedCatalogSource = fs.readFileSync(path.join(
    repo,
    'magia-exedra-character-three',
    'nonBattleCharacterCatalog.ts',
), 'utf8')
const typedCatalogCompiledPath = path.join(compiledRoot, 'nonBattleCharacterCatalog.mjs')
fs.writeFileSync(typedCatalogCompiledPath, ts.transpileModule(typedCatalogSource, {
    compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
        verbatimModuleSyntax: true,
    },
    fileName: 'nonBattleCharacterCatalog.ts',
}).outputText, 'utf8')

const {
    characterUiControlState,
    createPrimaryCharacterCatalog,
    resolvePrimaryCharacterSelection,
    searchPrimaryCharacterCatalog,
} = await import(`${new URL(`file:///${compiledPath.replaceAll('\\', '/')}`).href}?s6-ui-character`)
const { listNonBattleCharacterCatalogEntries } = await import(
    `${new URL(`file:///${typedCatalogCompiledPath.replaceAll('\\', '/')}`).href}?s6-ui-character`
)
const displayNames = new Map([
    ['113401', '无名少女 / 名前のない少女 / Nameless Girl'],
    ['113501', 'A-Q'],
    ['113601', '夜鹰 / ヨダカ / Nighthawk'],
    ['100101', '鹿目圆（魔法少女） / 鹿目まどか（魔法少女） / Madoka Kaname (Magical Girl)'],
    ['101901', '里见灯花（魔法少女） / 里見灯花（魔法少女） / Touka Satomi (Magical Girl)'],
])
const entries = createPrimaryCharacterCatalog(
    ['100101', '101901'],
    listNonBattleCharacterCatalogEntries(),
    id => displayNames.get(id) ?? id,
)

test('typed nonbattle entries join the same primary ordering and resolve accepted aliases', () => {
    assert.deepEqual(entries.map(entry => entry.id), [
        '113401',
        '113501',
        '113601',
        '100101',
        '101901',
    ])
    assert.equal(new Set(entries.map(entry => entry.id)).size, entries.length)
    assert.deepEqual(entries.slice(0, 3).map(entry => entry.name), [
        '无名少女 / 名前のない少女 / Nameless Girl',
        'A-Q',
        '夜鹰 / ヨダカ / Nighthawk',
    ])
    for (const [query, expected] of [
        ['A-Q', '113501'],
        ['aq', '113501'],
        ['113501', '113501'],
        ['NAMAE', '113401'],
        ['ヨダカ', '113601'],
        ['ヨタカ', '113601'],
    ]) {
        assert.equal(searchPrimaryCharacterCatalog(entries, query)[0]?.id, expected, query)
    }
    assert.equal(
        resolvePrimaryCharacterSelection(entries, 113501).stableIdentity,
        'style3dCharacterMstId=113501|resourceName=chara_113501_model',
    )
})

test('list visibility is independent from typed battle, TPS and Dungeon capability gates', () => {
    const aq = resolvePrimaryCharacterSelection(entries, '113501')
    assert.ok(aq)
    assert.equal(aq.visible, true)
    assert.equal(aq.capabilities.magicalGirl, false)
    assert.equal(aq.capabilities.storyCutscene, true)
    assert.deepEqual(characterUiControlState(aq), {
        battleDisabled: true,
        tpsDisabled: true,
        dungeonDisabled: true,
        actionScope: 'story-cutscene',
        physicsScope: 'runtime-scoped',
    })

    const standard = resolvePrimaryCharacterSelection(entries, '101901')
    assert.ok(standard)
    assert.deepEqual(characterUiControlState(standard), {
        battleDisabled: false,
        tpsDisabled: false,
        dungeonDisabled: false,
        actionScope: 'runtime-scoped',
        physicsScope: 'runtime-scoped',
    })
})

test('selection and reselection keep the stable character id and object identity', () => {
    const firstAq = resolvePrimaryCharacterSelection(entries, '113501')
    const standard = resolvePrimaryCharacterSelection(entries, '100101')
    const secondAq = resolvePrimaryCharacterSelection(entries, 113501)
    assert.equal(firstAq.id, '113501')
    assert.equal(standard.id, '100101')
    assert.equal(secondAq.id, '113501')
    assert.equal(secondAq, firstAq)
})

test('Viewer wiring uses the unified catalog for selector, search and typed UI gates', () => {
    const viewer = fs.readFileSync(path.join(repo, 'src', 'viewer', 'index.ts'), 'utf8')
    const panels = fs.readFileSync(path.join(repo, 'src', 'viewer', 'runtimeSelectionPanels.ts'), 'utf8')
    const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8')
    assert.match(viewer, /createPrimaryCharacterCatalog\([\s\S]*characters\.getCharacterIdList\(\)[\s\S]*characters\.getNonBattleCharacterCatalog\(\)/)
    assert.match(viewer, /searchPrimaryCharacterCatalog\(primaryCharacterCatalog, query, limit\)/)
    assert.match(viewer, /option\.dataset\.characterStableIdentity = entry\.stableIdentity/)
    assert.match(viewer, /if \(state\.tpsDisabled\) setViewerLocomotionEnabled\(false\)/)
    assert.match(viewer, /combatVfxPanelToggle\.disabled = state\.battleDisabled/)
    assert.match(viewer, /actionPanelToggle\.dataset\.characterActionScope = state\.actionScope/)
    assert.match(viewer, /characterPhysicsActionOptions\.dataset\.characterPhysicsScope = state\.physicsScope/)
    assert.match(panels, /toggleLabel: 'Characters'/)
    assert.match(html, /id="character-list-panel-title">Characters</)
    assert.doesNotMatch(html, /id="character-list-panel-title">Magical girls</)
})
