import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const repository = new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1')
const manifestPath = join(
    repository,
    'public',
    'stages',
    'official',
    'scene-visual-products.v1.json',
)

async function readJson(path) {
    return JSON.parse(await readFile(path, 'utf8'))
}

function publicPath(url) {
    return join(repository, 'public', url.replace(/^\.\//, ''))
}

test('all 581 catalog scenes have exactly one published visual product mode', async () => {
    const manifest = await readJson(manifestPath)
    assert.equal(manifest.schema, 'magius.scene-visual-products.v1')
    assert.equal(manifest.authority.inventoryRescan, false)
    assert.equal(manifest.counts.catalogScenes, 581)
    assert.equal(manifest.counts.catalogSerializedSceneProfiles, 390)
    assert.equal(manifest.counts.catalogOfficialImagePlanes, 190)
    assert.equal(manifest.counts.catalogExactEmptyRootMarkers, 1)
    assert.equal(manifest.catalogProducts.length, 581)
    assert.equal(new Set(manifest.catalogProducts.map(entry => entry.stageId)).size, 581)
    assert.ok(manifest.catalogProducts.every(entry => entry.runtimeReady === true))
})

test('399 serialized scene profiles retain exact material and effect corpus counts', async () => {
    const manifest = await readJson(manifestPath)
    assert.equal(manifest.counts.totalSceneProfiles, 399)
    assert.equal(manifest.counts.baselineOnlySceneProfiles, 9)
    assert.equal(manifest.counts.materialBindings, 6160)
    assert.equal(manifest.counts.alphaTestBindings, 1268)
    assert.equal(manifest.counts.transparentBindings, 1012)
    assert.equal(manifest.counts.particleSystems, 7128)
    assert.equal(manifest.counts.sourceShaderTotalBindings, 6160)
    assert.equal(manifest.counts.sourceShaderNamedBindings, 6149)
    assert.equal(manifest.counts.sourceShaderBuiltinKeyOnlyBindings, 3)
    assert.equal(manifest.counts.sourceShaderFailClosedBindings, 8)
    assert.equal(manifest.counts.shaderNamesResolvedByExactPathID, 48)
})

test('every visual product reference exists and stable keys remain unique', async () => {
    const manifest = await readJson(manifestPath)
    const stableKeys = new Set()
    for (const entry of manifest.catalogProducts) {
        assert.equal(typeof entry.stableKey, 'string')
        assert.ok(!stableKeys.has(entry.stableKey), `duplicate stable key: ${entry.stableKey}`)
        stableKeys.add(entry.stableKey)
        if (entry.sceneProfileUrl) await stat(publicPath(entry.sceneProfileUrl))
        if (entry.productUrl) await stat(publicPath(entry.productUrl))
    }
    for (const entry of manifest.baselineProfileProducts) {
        await stat(publicPath(entry.sceneProfileUrl))
    }
})

test('shader name repair is pointer-exact and unresolved bindings stay typed', async () => {
    const manifest = await readJson(manifestPath)
    const repaired = manifest.shaderResolutionRecords.filter(
        record => record.status === 'cross-profile-exact-pathid',
    )
    const builtin = manifest.shaderResolutionRecords.filter(
        record => record.status === 'builtin-source-key-only',
    )
    const failed = manifest.shaderResolutionRecords.filter(
        record => record.status === 'fail-closed',
    )
    assert.equal(repaired.length, 48)
    assert.equal(builtin.length, 3)
    assert.equal(failed.length, 8)
    assert.ok(repaired.every(record => record.sourceShaderStableKey.startsWith('unity-shader:cab=')))
    assert.ok(builtin.every(record => record.sourcePathID === '10753'))
    assert.ok(failed.every(record => record.sourceFileID === 0 && record.sourcePathID === '0'))

    const intro = await readJson(join(
        repository,
        'public',
        'stages',
        'official',
        'dungeon-intro-0001-001',
        'scene-profile.json',
    ))
    assert.equal(intro.materialBindings[0].sourceShader, 'Creative/Bg/BgUberShader')
    assert.equal(
        intro.materialBindings[27].sourceShader,
        'Creative/Effect/Particle/Common',
    )
})
