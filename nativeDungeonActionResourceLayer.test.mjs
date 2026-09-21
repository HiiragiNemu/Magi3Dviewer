import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import test from 'node:test'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'

const repository = new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1')
const manifestPath = join(repository, 'public', 'character-actions', 'manifest.v1.json')
const accepted100301Actions = [
    ['idle', 'official-dungeon:100301:idle:-6532624707838147585'],
    ['run', 'official-dungeon:100301:run:-2942221244478808616'],
    ['walk', 'official-dungeon:100301:walk:4412818012340897786'],
]
const accepted100301RuntimeUrl = '/character-actions/native-dungeon/100301/runtime.v1.json.gz'

async function readManifest() {
    return JSON.parse(await readFile(manifestPath, 'utf8'))
}

function readManifestAuthority(manifest) {
    const entries = manifest.entries
    const dungeonIds = [...new Set(
        entries.map(entry => entry.characterIdentity.dungeonCharacterId),
    )].sort((left, right) => left - right)
    const characterIds = new Set(entries.map(entry => entry.characterIdentity.characterMstId))
    const runtimeUrls = new Set(entries.map(entry => entry.runtime.url))
    return {
        entries,
        dungeonIds,
        distinctCharacters: characterIds.size,
        dungeonCharacterResources: runtimeUrls.size,
        actions: entries.length,
        runtimeReadyActions: entries.filter(entry => entry.availability.runtimeReady).length,
        tpsLoadableActions: entries.filter(entry => entry.availability.tpsLoadable).length,
    }
}

function installBrowserFixture() {
    class FakeImage {
        listeners = new Map()
        width = 1
        height = 1
        addEventListener(type, callback) { this.listeners.set(type, callback) }
        removeEventListener(type) { this.listeners.delete(type) }
        set src(value) {
            this.source = value
            queueMicrotask(() => this.listeners.get('load')?.({ target: this }))
        }
        get src() { return this.source }
    }
    globalThis.document = {
        baseURI: 'http://character-action.local/',
        createElementNS() { return new FakeImage() },
    }
    globalThis.fetch = async input => {
        const url = new URL(
            typeof input === 'string' ? input : input.url,
            globalThis.document.baseURI,
        )
        const path = join(repository, 'public', decodeURIComponent(url.pathname).replace(/^\//, ''))
        try {
            const data = await readFile(path)
            return new Response(data, {
                status: 200,
                headers: { 'content-length': String(data.length) },
            })
        } catch {
            return new Response('missing', { status: 404 })
        }
    }
}

test('manifest exposes authority-derived native resources and explicit loop actions', async () => {
    const manifest = await readManifest()
    const authority = readManifestAuthority(manifest)
    assert.equal(manifest.schema, 'magius.character-action-resource-manifest.v1')
    assert.equal(manifest.counts.distinctCharacters, authority.distinctCharacters)
    assert.equal(manifest.counts.dungeonCharacterResources, authority.dungeonCharacterResources)
    assert.equal(manifest.counts.dungeonCharacterResources, authority.dungeonIds.length)
    assert.equal(manifest.counts.actions, authority.actions)
    assert.equal(manifest.counts.runtimeReadyActions, authority.runtimeReadyActions)
    assert.equal(manifest.counts.tpsLoadableActions, authority.tpsLoadableActions)
    assert.equal(new Set(authority.entries.map(entry => entry.id)).size, authority.actions)
    for (const id of authority.dungeonIds) {
        const actions = manifest.entries.filter(entry => entry.characterIdentity.dungeonCharacterId === id)
        assert.deepEqual(actions.map(entry => entry.clip.semantic).sort(), ['idle', 'run', 'walk'])
        for (const action of actions) {
            assert.equal(action.id, `official-dungeon:${id}:${action.clip.semantic}:${action.clip.pathId}`)
            assert.equal(action.characterIdentity.style3dCharacterMstId, id)
            assert.equal(action.characterIdentity.modelKey, `battle/character/chara_${id}_battle_unit`)
            assert.equal(action.characterIdentity.modelRootName, `chara_${id}_battle_unit`)
            assert.equal(action.runtime.url, `/character-actions/native-dungeon/${id}/runtime.v1.json.gz`)
            assert.equal(action.group, '官方探索动作')
            assert.equal(action.groupId, 'official-dungeon-locomotion')
            assert.equal(action.playback, 'loop')
            assert.equal(action.availability.runtimeReady, true)
            assert.equal(action.availability.tpsLoadable, true)
            assert.equal(action.compatibility.mode, 'native-only')
            assert.equal(action.compatibility.crossCharacterFallback, false)
            assert.match(action.compatibility.externalAttachmentPolicy, /body-only/)
            assert.ok(action.motionReference.cycleSeconds > 0)
        }
    }
    const accepted100301 = authority.entries
        .filter(entry => entry.characterIdentity.dungeonCharacterId === 100301)
        .map(entry => [entry.clip.semantic, entry.id])
        .sort(([left], [right]) => left.localeCompare(right))
    assert.deepEqual(accepted100301, accepted100301Actions)
    assert.ok(authority.entries
        .filter(entry => entry.characterIdentity.dungeonCharacterId === 100301)
        .every(entry => entry.runtime.url === accepted100301RuntimeUrl))
    const kyokoIdle = manifest.entries.find(entry => (
        entry.characterIdentity.dungeonCharacterId === 100501
        && entry.clip.semantic === 'idle'
    ))
    assert.equal(kyokoIdle.clip.sourceName, 'Standby_L')
})

test('all runtime carriers preserve exact clip identities and structural rig bindings', async () => {
    const manifest = await readManifest()
    const authority = readManifestAuthority(manifest)
    for (const id of authority.dungeonIds) {
        const entry = manifest.entries.find(value => value.characterIdentity.dungeonCharacterId === id)
        const bytes = await readFile(join(repository, 'public', entry.runtime.url.replace(/^\//, '')))
        const runtime = JSON.parse(gunzipSync(bytes).toString('utf8'))
        assert.equal(runtime.schema, 'magius.native-dungeon-action-runtime.v1')
        assert.equal(runtime.dungeonCharacterId, id)
        assert.equal(runtime.modelKey, `battle/character/chara_${id}_battle_unit`)
        assert.equal(runtime.clips.length, 3)
        assert.ok(Object.keys(runtime.nodePaths).length > 30)
        assert.equal(Object.keys(runtime.nodePaths).length, Object.keys(runtime.nodeBindings).length)
        for (const clip of runtime.clips) {
            const descriptor = manifest.entries.find(value => value.id === clip.actionId)
            assert.ok(descriptor)
            assert.equal(clip.sourceClipPathId, descriptor.clip.pathId)
            assert.equal(clip.runtimeName, descriptor.clip.runtimeName)
            assert.equal(clip.tracks.length, descriptor.clip.serializedTrackCount)
            assert.ok(clip.tracks.length > 100)
            for (const track of clip.tracks) {
                const nodeId = track.name.split('.')[0]
                assert.ok(runtime.nodeBindings[nodeId])
                assert.ok(Array.isArray(runtime.nodeBindings[nodeId].ordinalPath))
            }
        }
    }
})

test('actual loader attaches and plays every native set against its Viewer model', async () => {
    const originalDocument = globalThis.document
    const originalFetch = globalThis.fetch
    installBrowserFixture()
    try {
        const { CharacterActionResourceManager } = await import('./src/viewer/characterActions/index.ts')
        const manager = new CharacterActionResourceManager()
        const catalog = await manager.ready()
        const manifest = await readManifest()
        const authority = readManifestAuthority(manifest)
        assert.equal(catalog.list().length, authority.actions)
        assert.deepEqual(
            catalog.list().map(entry => entry.id).sort(),
            authority.entries.map(entry => entry.id).sort(),
        )
        for (const id of authority.dungeonIds) {
            const compressed = await readFile(join(
                repository,
                'magia-exedra-character-three',
                'models',
                `chara_${id}_battle_unit`,
                'VisualRoot.fbx.gz',
            ))
            const fbx = gunzipSync(compressed)
            const buffer = fbx.buffer.slice(fbx.byteOffset, fbx.byteOffset + fbx.byteLength)
            const object = new FBXLoader().parse(buffer, '')
            const modelKey = `battle/character/chara_${id}_battle_unit`
            const loaded = await manager.attachCharacterActions(id, modelKey, object)
            assert.equal(loaded.actions.length, 3)
            assert.deepEqual(
                loaded.actions.map(action => action.descriptor.clip.semantic).sort(),
                ['idle', 'run', 'walk'],
            )
            assert.ok(loaded.actions.every(action => action.clip.tracks.length > 100))
            assert.ok(loaded.actions.every(action => object.animations.includes(action.clip)))
            const mixer = new THREE.AnimationMixer(object)
            const action = loaded.play(mixer, loaded.actions[1].descriptor.id)
            mixer.update(1 / 60)
            assert.equal(action.loop, THREE.LoopRepeat)
            assert.equal(action.isRunning(), true)
            mixer.stopAllAction()
            mixer.uncacheRoot(object)
        }
    } finally {
        globalThis.fetch = originalFetch
        if (originalDocument === undefined) delete globalThis.document
        else globalThis.document = originalDocument
    }
})

test('native-only guard rejects a cross-character model before attachment', async () => {
    const originalDocument = globalThis.document
    const originalFetch = globalThis.fetch
    installBrowserFixture()
    try {
        const { CharacterActionResourceManager, CharacterActionResourceError } = await import(
            './src/viewer/characterActions/index.ts'
        )
        const manager = new CharacterActionResourceManager()
        const object = new THREE.Group()
        object.name = 'chara_100201_battle_unit'
        await assert.rejects(
            manager.attachCharacterActions(
                100201,
                'battle/character/chara_100202_battle_unit',
                object,
            ),
            error => error instanceof CharacterActionResourceError && error.code === 'MODEL_MISMATCH',
        )
    } finally {
        globalThis.fetch = originalFetch
        if (originalDocument === undefined) delete globalThis.document
        else globalThis.document = originalDocument
    }
})
