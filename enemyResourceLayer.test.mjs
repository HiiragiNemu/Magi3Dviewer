import { assertReleaseEnemyManifest } from './releaseCorpusTestSupport.mjs'
import assert from 'node:assert/strict'
import { gunzipSync } from 'node:zlib'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import * as THREE from 'three'

const repository = new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1')
const manifestPath = join(repository, 'public', 'enemies', 'manifest.v1.json')

async function readManifest() {
    return JSON.parse(await readFile(manifestPath, 'utf8'))
}

test('enemy manifest has complete current JP/Steam non-magical-girl coverage', async () => {
    const manifest = await readManifest()
    assert.equal(manifest.schema, 'magius.enemy-resource-manifest.v1')
    assertReleaseEnemyManifest(manifest)
    assert.equal(manifest.counts.enemyRecords, 516)
    assert.equal(manifest.counts.modelResources, 495)
    assert.equal(manifest.counts.enemyFamilies, 84)
    assert.equal(manifest.counts.renderReadyModels, 495)
    assert.equal(manifest.counts.materialProfileModels, 495)
    assert.equal(manifest.counts.materialProfileRuntimeReadyModels, 495)
    assert.equal(manifest.counts.localizedNames.en, 507)
    assert.equal(manifest.counts.localizedNames.ja, 509)
    assert.equal(manifest.counts.localizedNames.zhHant, 469)
    assert.equal(new Set(manifest.entries.map(entry => entry.enemyMstId)).size, 516)
    assert.ok(manifest.entries.every(entry => entry.enemyType !== 4))
    assert.ok(manifest.entries.every(entry => entry.model.renderReady))
})

test('every manifest model and thumbnail points to a real local runtime artifact', async () => {
    const manifest = await readManifest()
    const models = new Map()
    for (const entry of manifest.entries) {
        models.set(entry.modelPrefabName, entry.model.runtimeUrl)
        assert.equal(typeof entry.thumbnail.url, 'string')
        await stat(join(repository, 'public', entry.thumbnail.url.replace(/^\//, '')))
    }
    let materialProfileCount = 0
    let alphaTestProfileCount = 0
    const alphaTestByModel = new Map()
    for (const [modelName, runtimeUrl] of models) {
        assert.equal(typeof runtimeUrl, 'string')
        const bytes = await readFile(join(repository, 'public', runtimeUrl.replace(/^\//, '')))
        const fbx = gunzipSync(bytes)
        assert.match(fbx.subarray(0, 24).toString('ascii'), /^Kaydara FBX Binary/)
        const runtime = JSON.parse(await readFile(
            join(repository, 'public', 'enemies', 'models', modelName, 'model-runtime.v1.json'),
            'utf8',
        ))
        assert.equal(runtime.schema, 'magius.enemy-model-runtime.v1')
        assert.equal(runtime.modelPrefabName, modelName)
        assert.ok(runtime.clips.length > 0)
        assert.ok(
            runtime.animatorBundleKeys.length > 0 || runtime.controllers.length > 0,
            `${modelName} has neither an Animator dependency nor an embedded controller`,
        )
        const profile = JSON.parse(await readFile(
            join(repository, 'public', 'enemies', 'models', modelName, 'material-profile.v1.json'),
            'utf8',
        ))
        assert.equal(profile.schema, 'magius.enemy-material-profile.v1')
        assert.equal(profile.modelPrefabName, modelName)
        assert.equal(profile.status, 'runtime-ready')
        assert.equal(profile.runtimeReady, true)
        assert.deepEqual(profile.failClosedReasons, [])
        assert.equal(
            profile.counts.resolvedMaterialObjects,
            profile.counts.declaredMaterialObjects,
        )
        assert.ok(profile.profiles.length > 0)
        materialProfileCount += 1
        alphaTestProfileCount += profile.counts.alphaTestProfiles
        alphaTestByModel.set(modelName, profile.counts.alphaTestProfiles)
    }
    assert.equal(materialProfileCount - 2, 493)
    assert.equal(materialProfileCount, 495)
    assert.equal(alphaTestByModel.get('enemy_605025_battle_unit'), 3)
    assert.equal(alphaTestByModel.get('enemy_605026_battle_unit'), 2)
    assert.equal(alphaTestProfileCount - 3 - 2, 244)
    assert.equal(alphaTestProfileCount, 249)
})

test('2-4 enemy records expose model, Animator, action, material and VFX keys', async () => {
    const manifest = await readManifest()
    for (const enemyMstId of [600002, 600007, 600003, 600015]) {
        const entry = manifest.entries.find(value => value.enemyMstId === enemyMstId)
        assert.ok(entry, `missing enemy ${enemyMstId}`)
        assert.match(entry.model.bundleKey, /^AssetBundles\/battle\/enemy\/enemy_/)
        assert.ok(entry.model.animatorBundleKeys.length > 0)
        assert.ok(entry.model.modelBundleKeys.length > 0)
        assert.ok(entry.model.textureBundleKeys.length > 0)
        assert.ok(entry.model.shaderBundleKeys.includes('AssetBundles/shader/enemy_uber'))
        assert.ok(entry.model.baseClips.length > 0)
        assert.ok(entry.model.materialObjects.length > 0)
        assert.equal(
            entry.model.materialProfileUrl,
            `/enemies/models/${entry.modelPrefabName}/material-profile.v1.json`,
        )
        assert.ok(entry.actions.directions.length > 0)
        assert.ok(entry.effects.skillDirectionBundleKeys.length > 0)
    }
})

test('actual loader parses all four 2-4 enemy FBX runtimes', async () => {
    class FakeImage {
        listeners = new Map()
        width = 1
        height = 1

        addEventListener(type, callback) {
            this.listeners.set(type, callback)
        }

        removeEventListener(type) {
            this.listeners.delete(type)
        }

        set src(value) {
            this.source = value
            queueMicrotask(() => this.listeners.get('load')?.({ target: this }))
        }

        get src() {
            return this.source
        }
    }

    const originalDocument = globalThis.document
    const originalFetch = globalThis.fetch
    globalThis.document = {
        baseURI: 'http://enemy.local/',
        createElementNS() {
            return new FakeImage()
        },
    }
    globalThis.fetch = async input => {
        const url = new URL(typeof input === 'string' ? input : input.url)
        const path = join(repository, 'public', decodeURIComponent(url.pathname).replace(/^\//, ''))
        const data = await readFile(path)
        return new Response(data, {
            status: 200,
            headers: { 'content-length': String(data.length) },
        })
    }
    try {
        const manifest = await readManifest()
        const { FbxEnemyModelLoader } = await import('./src/viewer/enemies/loader.ts')
        const loader = new FbxEnemyModelLoader()
        for (const enemyMstId of [600002, 600003, 600007, 600012, 600015]) {
            const entry = manifest.entries.find(value => value.enemyMstId === enemyMstId)
            const object = await loader.load(entry)
            let meshCount = 0
            object.traverse(child => { if (child.isMesh) meshCount += 1 })
            assert.equal(object.name, entry.modelPrefabName)
            assert.equal(object.userData.enemyMstId, enemyMstId)
            assert.equal(object.animations.length, 15)
            assert.ok(meshCount > 0)
            assert.equal(
                object.userData.enemyMaterialProfileSchema,
                'magius.enemy-material-profile.v1',
            )
            assert.equal(object.userData.enemyTextureRuntimeStatus, 'runtime-ready')
            assert.ok(object.userData.enemyRuntimeTextureCount > 0)
            if (enemyMstId === 600012) {
                const materials = []
                object.traverse(child => {
                    if (!child.isMesh) return
                    materials.push(...(
                        Array.isArray(child.material)
                            ? child.material
                            : [child.material]
                    ))
                })
                const mercury = materials.find(
                    material => material.name === 'mt_eff_mercury_anthony',
                )
                assert.ok(mercury, '600012 mercury material was not imported')
                assert.equal(mercury.alphaTest, 0.5)
                assert.equal(mercury.transparent, false)
                assert.equal(mercury.depthWrite, true)
                assert.equal(mercury.map.colorSpace, THREE.SRGBColorSpace)
                assert.match(
                    mercury.map.userData.magiusEnemyRuntimeUrl,
                    /\/enemies\/textures\/cab-deca81954fbd67b2aacb2928a61012c3__pathid-p5394078111709246722\.png$/,
                )
                assert.equal(
                    mercury.userData.magiusEnemyRuntimeTextureProperties._MainTex,
                    'map',
                )
                const mercuryProperty = mercury.userData
                    .magiusEnemyRuntimeTextureProperties._MercuryMatCap
                assert.equal(
                    mercuryProperty,
                    'magiusEnemyTexture__MercuryMatCap',
                )
                assert.equal(mercury[mercuryProperty].isTexture, true)
                assert.match(
                    mercury[mercuryProperty].userData.magiusEnemyRuntimeUrl,
                    /\/enemies\/textures\/cab-c0b111b2efabd4edfcc1623b7de66b4a__pathid-p2092558988712092452\.png$/,
                )
                assert.match(
                    mercury.userData.magiusEnemyMaterialProfile,
                    /^unity-material:cab=.+\|pathID=2827004867434397280$/,
                )
                const body = object.getObjectByName('Body_Mesh')
                assert.ok(body?.isMesh, '600012 Body_Mesh renderer was not imported')
                assert.match(
                    body.material.userData.magiusEnemyMaterialProfile,
                    /^unity-material:cab=.+\|pathID=759405822609610206$/,
                    'priority-0 battle renderer binding must override FBX material fallback',
                )
            }
        }
    } finally {
        globalThis.fetch = originalFetch
        if (originalDocument === undefined) delete globalThis.document
        else globalThis.document = originalDocument
    }
})

test('manager contract permits duplicate IDs and removes individual instances', async () => {
    const { EnemyResourceManager } = await import('./src/viewer/enemies/index.ts')
    const manifest = await readManifest()
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response(JSON.stringify(manifest), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    })
    try {
        const fakeLoader = {
            async load(entry) {
                const object = new THREE.Group()
                object.userData.enemyMstId = entry.enemyMstId
                return object
            },
        }
        const manager = new EnemyResourceManager({ modelLoader: fakeLoader })
        const parent = new THREE.Group()
        const instances = await manager.addEnemies([600002, 600002, 600003], parent)
        assert.equal(instances.length, 3)
        assert.equal(parent.children.length, 3)
        assert.notEqual(instances[0].instanceId, instances[1].instanceId)
        assert.equal(manager.removeEnemy(instances[0].instanceId), true)
        assert.equal(parent.children.length, 2)
        assert.equal(manager.clearEnemies(), 2)
        assert.equal(parent.children.length, 0)
    } finally {
        globalThis.fetch = originalFetch
    }
})
