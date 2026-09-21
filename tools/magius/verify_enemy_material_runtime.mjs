#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const manifest = JSON.parse(await readFile(
    join(repository, 'public', 'enemies', 'manifest.v1.json'),
    'utf8',
))

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
    baseURI: 'http://enemy-runtime.local/',
    createElementNS() {
        return new FakeImage()
    },
}
globalThis.fetch = async input => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    const path = join(
        repository,
        'public',
        decodeURIComponent(url.pathname).replace(/^\//, ''),
    )
    try {
        const data = await readFile(path)
        return new Response(data, {
            status: 200,
            headers: { 'content-length': String(data.length) },
        })
    } catch {
        return new Response('not found', { status: 404 })
    }
}

const report = {
    schema: 'magius.enemy-material-runtime-verification.v1',
    requestedModels: 0,
    loadedModels: 0,
    meshCount: 0,
    materialBindings: 0,
    alphaTestBindings: 0,
    transparentBindings: 0,
    nullMaterialBindings: 0,
    runtimeTextureReadyModels: 0,
    runtimeTextureBindings: 0,
    runtimeMainTextureBindings: 0,
    target600012: {
        bodyTextureProduct: false,
        thornMainTexture: false,
        mercuryMatCap: false,
    },
    failures: [],
}

try {
    const { FbxEnemyModelLoader } = await import('../../src/viewer/enemies/loader.ts')
    const loader = new FbxEnemyModelLoader()
    const byModel = new Map()
    for (const entry of manifest.entries) {
        if (!byModel.has(entry.modelPrefabName)) byModel.set(entry.modelPrefabName, entry)
    }
    report.requestedModels = byModel.size
    for (const [modelPrefabName, entry] of byModel) {
        try {
            if (modelPrefabName === 'enemy_600012_battle_unit') {
                const product = JSON.parse(await readFile(join(
                    repository,
                    'public',
                    'enemies',
                    'models',
                    modelPrefabName,
                    'material-profile.v1.json',
                ), 'utf8'))
                report.target600012.bodyTextureProduct = product.profiles.some(material =>
                    Object.values(material.textures).some(texture =>
                        texture.runtimeReady === true
                        && texture.stableKey
                        === 'unity-object:cab=CAB-06961b30e4c8fddf6fdb4fecccc51ee3|pathID=-7317668928191225749'))
            }
            const object = await loader.load(entry)
            assert.equal(object.userData.enemyTextureRuntimeStatus, 'runtime-ready')
            assert.ok(object.userData.enemyRuntimeTextureCount > 0)
            report.runtimeTextureReadyModels += 1
            let modelMeshes = 0
            object.traverse(child => {
                if (!child.isMesh) return
                modelMeshes += 1
                report.meshCount += 1
                const materials = Array.isArray(child.material)
                    ? child.material
                    : [child.material]
                for (const material of materials) {
                    const profileKey = material.userData.magiusEnemyMaterialProfile ?? ''
                    assert.ok(
                        /^unity-material:cab=.+\|pathID=-?\d+$/.test(profileKey)
                        || profileKey === 'unity-null-material',
                        `${modelPrefabName}:${child.name}:${material.name}`,
                    )
                    report.materialBindings += 1
                    report.nullMaterialBindings += Number(
                        profileKey === 'unity-null-material',
                    )
                    report.alphaTestBindings += Number(material.alphaTest > 0)
                    report.transparentBindings += Number(material.transparent)
                    const runtimeBindings = material.userData
                        .magiusEnemyRuntimeTextureProperties ?? {}
                    const runtimeStableKeys = material.userData
                        .magiusEnemyRuntimeTextureStableKeys ?? {}
                    for (const [propertyName, materialProperty] of Object.entries(runtimeBindings)) {
                        assert.equal(
                            material[materialProperty]?.isTexture,
                            true,
                            `${modelPrefabName}:${material.name}:${propertyName}`,
                        )
                        report.runtimeTextureBindings += 1
                        report.runtimeMainTextureBindings += Number(materialProperty === 'map')
                        if (modelPrefabName === 'enemy_600012_battle_unit') {
                            const stableKey = runtimeStableKeys[propertyName]
                            report.target600012.thornMainTexture ||= stableKey
                                === 'unity-object:cab=CAB-deca81954fbd67b2aacb2928a61012c3|pathID=5394078111709246722'
                            report.target600012.mercuryMatCap ||= stableKey
                                === 'unity-object:cab=CAB-c0b111b2efabd4edfcc1623b7de66b4a|pathID=2092558988712092452'
                        }
                    }
                }
                child.geometry?.dispose()
                for (const material of materials) {
                    for (const value of Object.values(material)) {
                        if (value?.isTexture) value.dispose()
                    }
                    material.dispose()
                }
            })
            assert.ok(modelMeshes > 0, `${modelPrefabName} has no runtime mesh`)
            report.loadedModels += 1
        } catch (error) {
            report.failures.push({
                modelPrefabName,
                code: error?.code ?? null,
                message: String(error?.message ?? error),
                detail: error?.detail ?? null,
            })
        }
        if ((report.loadedModels + report.failures.length) % 25 === 0) {
            process.stdout.write(
                `ENEMY_MATERIAL_RUNTIME_PROGRESS=${report.loadedModels + report.failures.length}/${report.requestedModels} `
                + `FAILURES=${report.failures.length}\n`,
            )
        }
    }
} finally {
    globalThis.fetch = originalFetch
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
}

const outputArg = process.argv.indexOf('--output')
if (outputArg >= 0) {
    const output = resolve(process.argv[outputArg + 1])
    await writeFile(output, JSON.stringify(report, null, 2) + '\n', 'utf8')
}
process.stdout.write(JSON.stringify(report) + '\n')
if (report.failures.length > 0 || report.loadedModels !== report.requestedModels) {
    process.exitCode = 2
}
if (
    report.runtimeTextureReadyModels !== report.requestedModels
    || !Object.values(report.target600012).every(Boolean)
) {
    process.exitCode = 2
}
