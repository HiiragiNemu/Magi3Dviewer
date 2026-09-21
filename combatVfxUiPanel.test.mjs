import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

test('combat VFX panel exposes the complete data-driven runtime controls', async () => {
    const html = await read('./index.html')
    const viewer = await read('./src/viewer/index.ts')
    const panel = await read('./src/viewer/combatVfxPanel.ts')

    for (const id of [
        'combat-vfx-panel-toggle',
        'combat-vfx-panel',
        'combat-vfx-panel-close',
        'combat-vfx-enabled',
        'combat-vfx-domain',
        'combat-vfx-search',
        'combat-vfx-list',
        'combat-vfx-catalog-status',
        'combat-vfx-selection-detail',
        'combat-vfx-selection-reason',
        'combat-vfx-play',
        'combat-vfx-stop',
        'combat-vfx-runtime-status',
        'combat-vfx-operation-status',
    ]) {
        assert.match(html, new RegExp(`id="${id}"`), `missing Combat VFX UI control: ${id}`)
    }

    assert.ok(html.indexOf('id="combat-vfx-panel-toggle"') < html.indexOf('id="menu-collapse-toggle"'))
    assert.doesNotMatch(html, /id="official-resource-panel-toggle"|id="official-resource-panel"/)
    assert.match(viewer, /import \{ setupCombatVfxPanel \} from '\.\/combatVfxPanel'/)
    assert.match(viewer, /setupRuntimeSelectionPanels\(\)[\s\S]*setupCombatVfxPanel\(\)[\s\S]*setupViewerInputHandler\(\)/)

    for (const runtimeCall of [
        'listCombatVfxSelections',
        'playCombatVfxSelection',
        'setCombatVfxEnabled',
        'stopCombatVfx',
        'getCombatVfxDebugState',
    ]) {
        assert.match(panel, new RegExp(runtimeCall), `missing Combat VFX consumer call: ${runtimeCall}`)
    }
    assert.match(panel, /entry\.domain !== domain/)
    assert.match(panel, /entry\.stableKey/)
    assert.match(panel, /entry\.runtimeReady/)
    assert.match(panel, /entry\.failClosedReasons\.join\('; '\)/)
    assert.match(panel, /api\.playSelection\(\{ stableKey: entry\.stableKey \}\)/)
    assert.match(panel, /state = api\.setEnabled\(elements\.enabled\.checked\)/)
    assert.match(panel, /state = api\.stop\(\)/)
    assert.match(panel, /state\.active\.length/)
    assert.match(panel, /result\.status === 'played'/)
    assert.match(panel, /COMBAT_VFX_STATE_CHANGE_EVENT/)
})

test('target catalog keeps all 654 selections runtime-ready and retains generic unavailable rendering', async () => {
    const catalog = JSON.parse(await read('./public/vfx/catalog.v1.json'))
    const panel = await read('./src/viewer/combatVfxPanel.ts')
    const targets = catalog.entries.filter(entry => entry.publicationScope === 'target')
    const enemy = targets.filter(entry => entry.domain === 'enemy')
    const character = targets.filter(entry => entry.domain === 'character')
    const ready = targets.filter(entry => entry.runtimeReady)
    const failClosed = targets.filter(entry => !entry.runtimeReady)

    assert.equal(targets.length, 654)
    assert.equal(enemy.length, 443)
    assert.equal(character.length, 211)
    assert.equal(ready.length, 654)
    assert.equal(failClosed.length, 0)

    for (const stableKey of [
        'character|special_skill_direction_10020201',
        'enemy|enemy_650002_wholeskill',
        'enemy|enemy_650002_wholeskill_sp',
    ]) {
        const entry = targets.find(candidate => candidate.stableKey === stableKey)
        assert.ok(entry, `missing promoted Combat VFX entry: ${stableKey}`)
        assert.equal(entry.status, 'runtime-ready')
        assert.equal(entry.runtimeReady, true)
        assert.deepEqual(entry.failClosedReasons, [])
        assert.doesNotMatch(panel, new RegExp(stableKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    }

    assert.match(panel, /option\.dataset\.availability = entry\.status/)
    assert.match(panel, /elements\.play\.disabled = operationPending[\s\S]*!entry\.runtimeReady/)
    assert.match(panel, /entry\.failClosedReasons\.join\('; '\)/)
})

test('combat VFX panel remains compact, responsive and localized', async () => {
    const style = await read('./src/viewer/style/viewer.css')
    const localization = await read('./src/viewer/localization/zhCN.ts')

    assert.match(style, /#combat-vfx-panel\s*\{[^}]*width:\s*min\(720px, calc\(100vw - 24px\)\)[^}]*height:\s*min\(74vh, 640px\)/)
    assert.match(style, /\.combat-vfx-panel-toolbar\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:/)
    assert.match(style, /\.combat-vfx-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/)
    assert.match(style, /@media \(max-width: 520px\)[\s\S]*\.combat-vfx-panel-toolbar\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/)

    for (const key of [
        "'Combat effects': '战斗特效'",
        "'Enemy combat effects': '敌人战斗特效'",
        "'Magical girl combat effects': '魔法少女战斗特效'",
        "'Play selected effect': '播放所选特效'",
        "'Combat effects disabled; active effects cleared': '战斗特效已关闭；活动特效已清空'",
        "'Unavailable reason': '不可用原因'",
    ]) {
        assert.ok(localization.includes(key), `missing Combat VFX localization: ${key}`)
    }
})
