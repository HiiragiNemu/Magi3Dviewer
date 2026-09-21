import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const repository = new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1')

test('600003 chooses animated Wait_L instead of empty Wait', async () => {
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
    const originalDocument = globalThis.document
    const originalFetch = globalThis.fetch
    globalThis.document = {
        baseURI: 'http://enemy.local/',
        createElementNS() { return new FakeImage() },
    }
    globalThis.fetch = async input => {
        const url = new URL(typeof input === 'string' ? input : input.url)
        const path = join(repository, 'public', decodeURIComponent(url.pathname).replace(/^\//, ''))
        return new Response(await readFile(path), { status: 200 })
    }
    try {
        const manifest = JSON.parse(await readFile(join(repository, 'public/enemies/manifest.v1.json'), 'utf8'))
        const entry = manifest.entries.find(value => value.enemyMstId === 600003)
        assert.ok(entry)
        const { FbxEnemyModelLoader, EnemyInstance } = await import('./src/viewer/enemies/loader.ts')
        const object = await new FbxEnemyModelLoader().load(entry)
        const instance = new EnemyInstance('audit-600003', entry, object)
        assert.equal(instance.defaultAnimationName, 'Wait_L')
        assert.equal(instance.currentAnimationName, 'Wait_L')
        const wait = object.animations.find(clip => clip.name === 'Wait')
        const waitL = object.animations.find(clip => clip.name === 'Wait_L')
        assert.equal(wait?.tracks.length, 0)
        assert.ok((waitL?.tracks.length ?? 0) > 0)
    } finally {
        globalThis.document = originalDocument
        globalThis.fetch = originalFetch
    }
})
