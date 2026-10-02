import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const repo = process.cwd()
const manifestPath = path.join(repo, 'public', 'ui-thumbnails', 'runtime-selection', 'manifest.v1.json')
const authorityPath = path.join(
    repo,
    'artifacts',
    'verification',
    '20260829-runtime-selection-thumbnail-panels',
    'thumbnail-source-authority.json',
)

const readText = relativePath => readFile(path.join(repo, relativePath), 'utf8')

function publicPathFor(url) {
    return path.join(repo, 'public', ...url.replace(/^\//, '').split('/'))
}

async function assertWebp(url) {
    const file = publicPathFor(url)
    const bytes = await readFile(file)
    assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF', url)
    assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WEBP', url)
    return bytes.length
}

test('declared native thumbnail product stays source-backed; newer unindexed variants retain explicit placeholders', async () => {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const authority = JSON.parse(await readFile(authorityPath, 'utf8'))
    const modelEntries = await readdir(path.join(repo, 'magia-exedra-character-three', 'models'), {
        withFileTypes: true,
    })
    const characterIds = modelEntries
        .filter(entry => entry.isDirectory() && /^chara_\d{6}_battle_unit$/.test(entry.name))
        .map(entry => entry.name.match(/^chara_(\d{6})_battle_unit$/)[1])
        .sort()

    assert.equal(manifest.schema, 'magius.runtime-selection-thumbnails.v1')
    assert.equal(Object.keys(manifest.characters).length,90)
    assert.ok(Object.keys(manifest.characters).every(id=>characterIds.includes(id)))
    assert.deepEqual(characterIds.filter(id=>!manifest.characters[id]),['100108','100208','101002','110702'])
    assert.equal(Object.values(authority.characterSources).filter(source => /\\style\\/.test(source)).length, 89)
    assert.match(authority.characterSources['100205'], /\\outer\\character\\1002_thumbnail/i)

    let totalBytes = 0
    for (const url of Object.values(manifest.characters)) totalBytes += await assertWebp(url)
    assert.ok(totalBytes > 500_000)
    assert.ok(totalBytes < 3_000_000)
})

test('scene thumbnail product exposes exact diorama, field, gallery and dollhouse mappings', async () => {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const authority = JSON.parse(await readFile(authorityPath, 'utf8'))

    assert.equal(manifest.counts.characterThumbnails, 90)
    assert.ok(manifest.counts.sceneIds >= 240)
    assert.ok(manifest.counts.sceneResourceNames >= 380)
    assert.ok(Object.keys(authority.sceneSources).filter(key => key.startsWith('diorama:')).length >= 139)
    assert.ok(Object.keys(authority.sceneSources).some(key => key.startsWith('field:')))
    assert.ok(Object.keys(authority.sceneSources).some(key => key.startsWith('dollhouse:')))
    assert.ok(manifest.scenes['battle-600-00-01-001'])
    assert.ok(manifest.sceneResources['map_bg_60000'])
    assert.ok(manifest.sceneResources['bg_3d_661_00_00_001'])

    const urls = new Set([
        ...Object.values(manifest.scenes),
        ...Object.values(manifest.sceneResources),
    ])
    let totalBytes = 0
    for (const url of urls) totalBytes += await assertWebp(url)
    assert.ok(totalBytes > 1_000_000)
    assert.ok(totalBytes < 5_000_000)

    const outputFiles = await readdir(path.dirname(manifestPath), { recursive: true })
    assert.equal(outputFiles.some(file => /\.(png|jpe?g)$/i.test(file)), false)
})

test('magical girl and scene panels render lazy thumbnail cards while retaining real selector change events', async () => {
    const [html, runtime, css] = await Promise.all([
        readText('index.html'),
        readText('src/viewer/runtimeSelectionPanels.ts'),
        readText('src/viewer/style/viewer.css'),
    ])

    for (const id of [
        'character-list-grid',
        'character-list-preview',
        'stage-list-grid',
        'stage-list-preview',
    ]) assert.match(html, new RegExp(`id="${id}"`))
    assert.match(html, /id="character-list-select"[^>]*hidden/)
    assert.match(html, /id="stage-list-select"[^>]*hidden/)
    assert.match(runtime, /fetch\('\/ui-thumbnails\/runtime-selection\/manifest\.v1\.json'\)/)
    const helper=await readText('src/viewer/resourcePanelUi.ts')
    assert.match(helper,/img\.loading='lazy'/)
    assert.match(helper,/tile\.addEventListener\('dblclick'/)
    assert.match(runtime,/createResourceTile/)
    assert.match(runtime, /elements\.source\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/)
    assert.match(runtime, /thumbnailManifest\.scenes\[sourceOption\.value\][\s\S]*thumbnailManifest\.sceneResources\[resourceName\]/)
    assert.match(css, /\.runtime-selection-thumbnail-grid\s*\{[^}]*display:\s*grid[^}]*overflow:\s*auto/)
    assert.match(css, /\.runtime-selection-tile\.is-selected\s*\{[^}]*border-color:\s*#22c9a2/)
    assert.match(css, /\.scene-thumbnail-grid \.runtime-selection-tile-image\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/)

    const manifestStat = await stat(manifestPath)
    assert.ok(manifestStat.size > 1_000)
})
