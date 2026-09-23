import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

test('enemy panel is independent from the character selector and uses the resource manager contract', async () => {
    const html = await read('./index.html')
    const viewer = await read('./src/viewer/index.ts')
    const panel = await read('./src/viewer/enemyPanel.ts')

    for (const id of [
        'enemy-toolbar-select',
        'enemy-toolbar-add',
        'enemy-toolbar-remove',
        'enemy-panel-toggle',
        'enemy-panel',
        'enemy-catalog-search',
        'enemy-catalog-select',
        'enemy-preview-image',
        'enemy-add-quantity',
        'enemy-add-button',
        'enemy-instance-list',
        'enemy-clear-button',
    ]) {
        assert.match(html, new RegExp(`id="${id}"`), `missing enemy UI control: ${id}`)
    }

    assert.match(viewer, /import \{ setupEnemyPanel, type EnemyPanelController \} from '\.\/enemyPanel'/)
    assert.match(viewer, /enemyPanelController = setupEnemyPanel\(\{/)
    assert.match(panel, /new EnemyResourceManager\(\)/)
    assert.match(panel, /enemyResources\.listEnemies\(abortController\.signal\)/)
    assert.match(panel, /elements\.toolbarCatalog\.onchange[\s\S]*renderCatalog\(\)/)
    assert.match(panel, /elements\.toolbarAdd\.onclick[\s\S]*elements\.add\.click\(\)/)
    assert.match(panel, /renderToolbarCatalog\(\)[\s\S]*renderCatalog\(\)/)
    assert.match(panel, /enemyResources\.addEnemy\([\s\S]*entry\.enemyMstId,[\s\S]*scene\.scene/)
    assert.match(panel, /for \(let index = 0; index < quantity; index \+= 1\)[\s\S]*nextEnemySpawnPosition\(\)/)
    assert.match(panel, /enemyResources\.removeEnemy\(instance\.instanceId\)/)
    assert.match(panel, /enemyResources\.clearEnemies\(\)/)
    assert.match(panel, /row\.dataset\.instanceId = instance\.instanceId/)
    assert.match(panel, /entry\.thumbnail\.url/)
    assert.match(panel, /resolveEnemyDisplayName\(entry, currentEnemyLocale\(\)\)/)
    assert.match(panel, /selectedInstanceId = added\.at\(-1\)\?\.instanceId/)
    assert.doesNotMatch(panel, /characterSelector|characterSelectDict|changeCharacter/)
})

test('enemy instances support deterministic spacing, selection, removal and canvas XYZ translation', async () => {
    const html = await read('./index.html')
    const viewer = await read('./src/viewer/index.ts')
    const panel = await read('./src/viewer/enemyPanel.ts')
    const style = await read('./src/viewer/style/viewer.css')

    assert.match(html, /id="enemy-toolbar-remove"[\s\S]*title="Remove: Selected enemy"/)
    assert.match(panel, /const nextEnemySpawnPosition = \(\): THREE\.Vector3Tuple/)
    assert.match(panel, /const spacing = 2\.5/)
    assert.match(panel, /minimumDistanceSq = 1\.75 \*\* 2/)
    assert.match(panel, /scene\.characters\.flatMap/)
    assert.match(panel, /\{ position: nextEnemySpawnPosition\(\) \}/)
    assert.match(panel, /getIntersectedEnemy[\s\S]*new THREE\.Raycaster\(\)[\s\S]*intersectObjects\(/)
    assert.match(panel, /row\.setAttribute\('aria-selected'/)
    assert.match(panel, /row\.dataset\.position = instance\.object\.position\.toArray\(\)/)
    assert.match(panel, /translateUiText\('Remove'\)[\s\S]*translateUiText\('Selected enemy'\)/)
    assert.match(panel, /elements\.toolbarRemove\.onclick[\s\S]*removeInstance\(instance\)/)
    assert.match(panel, /options\.onInstanceWillRemove\?\.\(instance\)/)
    assert.match(viewer, /enemyPanelController\?\.getIntersectedEnemy\(e\.clientX, e\.clientY\)/)
    assert.match(viewer, /enemyPanelController\?\.selectInstance\(enemy\.instanceId\)/)
    assert.match(viewer, /activateObjectTransform\(enemy\.object, \(\) => enemyPanelController\?\.refreshInstances\(\)\)/)
    assert.match(viewer, /singleCharacterTransformControls\.attach\(object\)[\s\S]*singleCharacterTransformControls\.enabled = true[\s\S]*singleCharacterTransformControlsHelper\.visible = true/)
    assert.match(style, /\.enemy-instance-row\.is-selected/)
})

test('enemy manager update loop is registered once and removed by panel disposal', async () => {
    const panel = await read('./src/viewer/enemyPanel.ts')

    assert.match(panel, /let activeController: EnemyPanelController \| undefined/)
    assert.match(panel, /if \(activeController\) return activeController/)
    assert.match(panel, /const tick = \(\) => \{\s*enemyResources\.update\(getClockDelta\(\)\)[\s\S]*renderAnimationProgress\(\)/)
    assert.equal((panel.match(/addAnimationLoop\(tick\)/g) ?? []).length, 1)
    assert.equal((panel.match(/removeAnimationLoop\(tick\)/g) ?? []).length, 1)
    assert.match(panel, /window\.addEventListener\('pagehide', dispose, \{ once: true \}\)/)
})

test('enemy errors, localization, viewport sizing and manifest identity remain explicit', async () => {
    const panel = await read('./src/viewer/enemyPanel.ts')
    const style = await read('./src/viewer/style/viewer.css')
    const localization = await read('./src/viewer/localization/zhCN.ts')
    const manifest = JSON.parse(await read('./public/enemies/manifest.v1.json'))

    for (const code of [
        'MANIFEST_HTTP_ERROR',
        'MANIFEST_SCHEMA_ERROR',
        'ENEMY_NOT_FOUND',
        'MODEL_NOT_READY',
        'MODEL_HTTP_ERROR',
        'MODEL_PARSE_ERROR',
    ]) {
        assert.match(panel, new RegExp(code), `missing error code: ${code}`)
    }
    for (const key of [
        "'Enemies': '敌人'",
        "'Search enemies': '搜索敌人'",
        "'Add enemy': '添加敌人'",
        "'Active enemies': '已添加的敌人'",
        "'Clear all': '全部移除'",
    ]) {
        assert.ok(localization.includes(key), `missing enemy localization: ${key}`)
    }

    assert.match(style, /#enemy-panel \{[\s\S]*width: min\(760px, calc\(100vw - 24px\)\);[\s\S]*height: min\(76vh, 660px\);/)
    assert.match(style, /\.enemy-panel-content \{[\s\S]*grid-template-columns:/)
    assert.match(style, /@media \(max-width: 520px\)[\s\S]*\.enemy-panel-content \{[\s\S]*grid-template-columns: minmax\(0, 1fr\);/)
    assert.equal(manifest.schema, 'magius.enemy-resource-manifest.v1')
    assert.equal(manifest.entries.length, manifest.counts.enemyRecords)
    assert.equal(manifest.entries.length, 516)
    assert.ok(manifest.entries.every(entry => entry.thumbnail.url && entry.model.renderReady))
})
