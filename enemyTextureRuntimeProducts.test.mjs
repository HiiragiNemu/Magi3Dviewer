import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const repository = new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1')
const publicRoot = join(repository, 'public')
const enemyRoot = join(publicRoot, 'enemies')

async function readJson(path) {
    return JSON.parse(await readFile(path, 'utf8'))
}

test('enemy texture runtime manifest publishes every exact stable key', async () => {
    const manifest = await readJson(join(enemyRoot, 'texture-runtime-products.v1.json'))
    assert.equal(manifest.schema, 'magius.enemy-texture-runtime-products.v1')
    assert.equal(manifest.lookup.idSpecialCases, false)
    assert.equal(manifest.counts.models, 493)
    assert.equal(manifest.counts.uniqueTextureProducts, 1969)
    assert.equal(manifest.counts.runtimeReadyTextureProducts, 1969)
    assert.equal(manifest.counts.failClosedTextureProducts, 0)
    assert.equal(manifest.counts.textureReferences, 22372)
    assert.equal(manifest.counts.runtimeReadyTextureReferences, 22372)
    assert.equal(manifest.counts.failClosedTextureReferences, 0)
    assert.equal(manifest.counts.textureRuntimeReadyModels, 493)
    assert.equal(manifest.counts.textureFailClosedModels, 0)
    assert.equal(new Set(manifest.entries.map(entry => entry.stableKey)).size, 1969)
    for (const entry of manifest.entries) {
        assert.equal(entry.status, 'runtime-ready')
        assert.equal(entry.runtimeReady, true)
        assert.deepEqual(entry.failClosedReasons, [])
        assert.match(entry.stableKey, /^unity-object:cab=CAB-.+\|pathID=-?\d+$/i)
        assert.match(entry.runtimeUrl, /^\/enemies\/textures\/.+\.png$/)
        const file = await stat(join(publicRoot, entry.runtimeUrl.replace(/^\//, '')))
        assert.equal(file.size, entry.bytes)
        assert.ok(file.size > 0)
    }
})

test('all 493 material products consume the shared texture catalog fail-closed', async () => {
    const manifest = await readJson(join(enemyRoot, 'texture-runtime-products.v1.json'))
    const byStableKey = new Map(manifest.entries.map(entry => [entry.stableKey, entry]))
    const resourceManifest = await readJson(join(enemyRoot, 'manifest.v1.json'))
    const modelNames = [...new Set(resourceManifest.entries.map(entry => entry.modelPrefabName))]
    assert.equal(modelNames.length, 493)
    let references = 0
    let requiredReferences = 0
    for (const modelName of modelNames) {
        const product = await readJson(join(
            enemyRoot,
            'models',
            modelName,
            'material-profile.v1.json',
        ))
        assert.equal(product.textureStatus, 'runtime-ready', modelName)
        assert.equal(product.textureRuntimeReady, true, modelName)
        assert.deepEqual(product.textureFailClosedReasons, [], modelName)
        assert.equal(product.counts.missingRuntimeTextureReferences, 0, modelName)
        assert.equal(product.counts.missingRequiredRuntimeTextureReferences, 0, modelName)
        references += product.counts.runtimeTextureReferences
        requiredReferences += product.counts.requiredRuntimeTextureReferences
        for (const material of product.profiles) {
            assert.deepEqual(material.runtime.missingRequiredTextureProperties, [])
            for (const texture of Object.values(material.textures)) {
                const catalog = byStableKey.get(texture.stableKey)
                assert.ok(catalog, `${modelName}:${texture.stableKey}`)
                assert.equal(texture.runtimeReady, true)
                assert.equal(texture.runtimeUrl, catalog.runtimeUrl)
                assert.equal(texture.runtimeFile, catalog.runtimeFile)
            }
        }
    }
    assert.equal(references, 22372)
    assert.equal(requiredReferences, 7182)
})

test('enemy 600012 publishes body, thorn and Mercury inputs by stable key', async () => {
    const product = await readJson(join(
        enemyRoot,
        'models',
        'enemy_600012_battle_unit',
        'material-profile.v1.json',
    ))
    const textures = product.profiles.flatMap(material =>
        Object.entries(material.textures).map(([propertyName, texture]) => ({
            materialName: material.materialName,
            propertyName,
            ...texture,
        })))
    const body = textures.find(texture =>
        texture.stableKey
        === 'unity-object:cab=CAB-06961b30e4c8fddf6fdb4fecccc51ee3|pathID=-7317668928191225749')
    const thorn = textures.find(texture =>
        texture.stableKey
        === 'unity-object:cab=CAB-deca81954fbd67b2aacb2928a61012c3|pathID=5394078111709246722')
    const mercury = textures.find(texture =>
        texture.stableKey
        === 'unity-object:cab=CAB-c0b111b2efabd4edfcc1623b7de66b4a|pathID=2092558988712092452')
    for (const texture of [body, thorn, mercury]) {
        assert.ok(texture)
        assert.equal(texture.runtimeReady, true)
        assert.match(texture.runtimeUrl, /^\/enemies\/textures\/.+\.png$/)
        const bytes = await readFile(join(publicRoot, texture.runtimeUrl.replace(/^\//, '')))
        assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
    }
    assert.equal(mercury.propertyName, '_MercuryMatCap')
    assert.equal(product.textureRuntimeReady, true)
})
