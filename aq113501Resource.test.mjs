import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'

const repository = new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1')
const modelDirectory = join(
    repository,
    'magia-exedra-character-three',
    'models',
    'chara_113501_model',
)

async function readActions() {
    return JSON.parse(await readFile(join(modelDirectory, 'home-actions.v1.json'), 'utf8'))
}

async function readRuntime() {
    return JSON.parse(gunzipSync(
        await readFile(join(modelDirectory, 'home-animations.json.gz')),
    ).toString('utf8'))
}

function pngDimensions(bytes) {
    assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG')
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}

test('A-Q source manifest closes the direct controller, all actions and textures', async () => {
    const actions = await readActions()
    assert.equal(actions.schema, 'magius.direct-home-actions.v1')
    assert.equal(actions.characterId, 113501)
    assert.equal(actions.resourceName, 'chara_113501_model')
    assert.equal(actions.sourceBundleLogicalKey, 'AssetBundles/home/chara_113501_model')
    assert.deepEqual(actions.dependencyBundleKeys, ['AssetBundles/shader/redrive_toon'])
    assert.equal(actions.defaultAction, 'Wait')
    assert.equal(actions.animatorOverrideControllerCount, 0)
    assert.equal(actions.activeControllerPathId, '-4278097510018638778')
    assert.equal(actions.controllers.length, 2)
    const active = actions.controllers.find(controller => controller.active)
    assert.equal(active.pathId, '-4278097510018638778')
    assert.equal(active.layerCount, 2)
    assert.equal(active.stateCount, 160)
    assert.deepEqual(active.layers.map(layer => layer.name), ['Base Layer', 'Eyes Layer'])

    assert.equal(actions.boardActions.length, 67)
    assert.equal(new Set(actions.boardActions.map(action => action.name)).size, 67)
    assert.equal(
        new Set(actions.boardActions.map(action => action.sourceClipPathId)).size,
        67,
    )
    assert.ok(actions.boardActions.every(action => action.sampleRate === 60))
    assert.ok(actions.boardActions.every(action => action.bindingCount === 246))
    for (const name of [
        'Wait', 'Wait02_S', 'Wait02_L', 'Wait02_E',
        'Wait03_S', 'Wait03_L', 'Wait03_E',
        'chara_113501_Talk_S', 'chara_113501_Talk_L', 'chara_113501_Talk_E',
        'chara_113501_Joy_S', 'chara_113501_Joy_L', 'chara_113501_Joy_E',
        'Take 001', 'chara_113501_Run-Down-Run',
    ]) {
        assert.ok(actions.boardActions.some(action => action.name === name), name)
    }

    assert.equal(actions.materials.length, 3)
    assert.equal(actions.textureClosure.localCount, 7)
    assert.equal(actions.textureClosure.dependencyCount, 2)
    assert.equal(actions.textureClosure.textures.length, 9)
    for (const texture of actions.textureClosure.textures) {
        await stat(join(modelDirectory, texture.outputFile))
    }
    assert.deepEqual(
        pngDimensions(await readFile(join(modelDirectory, '113501_thumbnail.png'))),
        [456, 296],
    )
})

test('A-Q FBX and Home runtime expose all 67 official clips on the real rig', async () => {
    class FakeImage {
        listeners = new Map()
        addEventListener(type, callback) { this.listeners.set(type, callback) }
        removeEventListener(type) { this.listeners.delete(type) }
        set src(value) {
            this.source = value
            queueMicrotask(() => this.listeners.get('load')?.({ target: this }))
        }
        get src() { return this.source }
    }
    const originalDocument = globalThis.document
    globalThis.document = {
        createElementNS() { return new FakeImage() },
    }
    try {
        const compressed = await readFile(join(modelDirectory, 'chara_113501_model.fbx.gz'))
        const fbx = gunzipSync(compressed)
        assert.match(fbx.subarray(0, 24).toString('ascii'), /^Kaydara FBX Binary/)
        const buffer = fbx.buffer.slice(fbx.byteOffset, fbx.byteOffset + fbx.byteLength)
        const root = new FBXLoader().parse(buffer, '')
        assert.equal(root.name, 'chara_113501_model')
        assert.equal(root.animations.length, 67)
        const skinnedMeshes = []
        root.traverse(object => { if (object.isSkinnedMesh) skinnedMeshes.push(object) })
        assert.equal(skinnedMeshes.length, 2)
        assert.ok(skinnedMeshes.every(mesh => mesh.skeleton.bones.length > 0))

        const runtime = await readRuntime()
        assert.equal(runtime.schema, 2)
        assert.equal(runtime.characterId, 113501)
        assert.equal(runtime.source, 'home/chara_113501_model')
        assert.equal(runtime.defaultAction, 'Wait')
        assert.equal(runtime.activeControllerPathId, '-4278097510018638778')
        assert.equal(runtime.clips.length, 67)
        assert.equal(runtime.boardActions.length, 67)
        assert.equal(Object.keys(runtime.nodePaths).length, 82)
        assert.ok(runtime.clips.every(clip => clip.tracks.length === 246))
        assert.deepEqual(
            new Set(runtime.clips.map(clip => clip.name)),
            new Set(runtime.boardActions.map(action => action.name)),
        )

        const { attachHomeAnimationRuntime } = await import(
            './magia-exedra-character-three/homeRuntime.ts'
        )
        const attached = attachHomeAnimationRuntime(root, runtime)
        assert.equal(attached.length, 67)
        assert.equal(root.animations.length, 67)
    } finally {
        if (originalDocument === undefined) delete globalThis.document
        else globalThis.document = originalDocument
    }
})

test('A-Q enters the existing character list from its real FBX path without hardcoding', async () => {
    const files = await readdir(modelDirectory)
    const fileKeys = files.map(name => (
        `../../node_modules/magia-exedra-character-three/models/chara_113501_model/${name}`
    ))
    const ids = fileKeys
        .filter(path => path.includes('.fbx'))
        .map(path => path.match(/chara_(\d+).*\//)[1])
    assert.deepEqual(ids, ['113501'])

    const master = JSON.parse(await readFile(
        join(repository, 'magia-exedra-character-three', 'getStyle3dCharacterMstList.json'),
        'utf8',
    ))
    const row = master.payload.mstList.find(item => item.style3dCharacterMstId === 113501)
    assert.deepEqual(
        { name: row.name, resourceName: row.resourceName, sortOrder: row.sortOrder },
        { name: 'A-Q', resourceName: 'chara_113501_model', sortOrder: 200 },
    )
    assert.ok(row.resourceName.includes(ids[0]))

    const characterSource = await readFile(
        join(repository, 'magia-exedra-character-three', 'character.ts'),
        'utf8',
    )
    assert.match(characterSource, /animations\.find\(x => x === 'Wait'\)/)
})
