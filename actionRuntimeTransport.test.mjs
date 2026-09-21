import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'

import {
    ACTION_RUNTIME_BROWSER_SUFFIX,
    browserSafeActionRuntimeUrl,
} from './src/viewer/characterActions/runtimeTransport.ts'

const repository = new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1')

async function readJson(path) {
    return JSON.parse(await readFile(join(repository, path), 'utf8'))
}

test('action runtime transport preserves manifest authority and uses neutral browser URLs', async () => {
    const nativeManifest = await readJson('public/character-actions/manifest.v1.json')
    const combatManifest = await readJson('public/character-actions/combat-jump/manifest.v1.json')
    const urls = [...new Set([
        ...nativeManifest.entries.map(entry => entry.runtime.url),
        ...combatManifest.characters.filter(character => character.runtime).map(character => character.runtime.url),
    ])]

    assert.equal(ACTION_RUNTIME_BROWSER_SUFFIX, '.magius-runtime')
    assert.equal(urls.length, 98)
    for (const sourceUrl of urls) {
        assert.match(sourceUrl, /\/runtime\.v1\.json\.gz$/)
        const browserUrl = browserSafeActionRuntimeUrl(sourceUrl)
        assert.match(browserUrl, /\/runtime\.v1\.magius-runtime$/)
        assert.doesNotMatch(browserUrl, /\.gz$/)

        const sourcePath = join(repository, 'public', sourceUrl.replace(/^\//, ''))
        const aliasPath = join(dirname(sourcePath), 'runtime.v1.magius-runtime')
        const [sourceBytes, aliasBytes] = await Promise.all([
            readFile(sourcePath),
            readFile(aliasPath),
        ])
        assert.equal(aliasBytes.equals(sourceBytes), true, `alias differs for ${sourceUrl}`)
        assert.deepEqual([...aliasBytes.subarray(0, 2)], [0x1f, 0x8b])
    }
})

test('action runtime URL rewrite preserves query and fragment data', () => {
    assert.equal(
        browserSafeActionRuntimeUrl('https://viewer.local/character-actions/x/runtime.v1.json.gz?v=1#clip'),
        'https://viewer.local/character-actions/x/runtime.v1.magius-runtime?v=1#clip',
    )
    assert.equal(browserSafeActionRuntimeUrl('/models/VisualRoot.fbx.gz'), '/models/VisualRoot.fbx.gz')
})

test('native and combat loaders request only neutral runtime aliases', async () => {
    const nativeManifest = await readJson('public/character-actions/manifest.v1.json')
    const combatManifest = await readJson('public/character-actions/combat-jump/manifest.v1.json')
    const nativeEntry = nativeManifest.entries.find(entry => entry.characterIdentity.dungeonCharacterId === 100301)
    const combatEntry = combatManifest.entries.find(entry => (
        entry.characterIdentity.characterId === '100107'
        && entry.availability.status === 'source-available'
    ))
    assert.ok(nativeEntry)
    assert.ok(combatEntry)

    const previousDocument = globalThis.document
    const previousFetch = globalThis.fetch
    const requested = []
    globalThis.document = { baseURI: 'http://action-runtime.local/' }
    globalThis.fetch = async input => {
        const url = new URL(typeof input === 'string' ? input : input.url, globalThis.document.baseURI)
        requested.push(url.pathname)
        const bytes = await readFile(join(repository, 'public', decodeURIComponent(url.pathname).replace(/^\//, '')))
        return new Response(bytes, {
            status: 200,
            headers: { 'content-length': String(bytes.length) },
        })
    }
    try {
        const { fetchNativeDungeonRuntime } = await import('./src/viewer/characterActions/loader.ts')
        const { fetchCombatJumpRuntime } = await import('./src/viewer/characterActions/combatLoader.ts')
        await fetchNativeDungeonRuntime(nativeEntry)
        await fetchCombatJumpRuntime(combatEntry)
        assert.equal(requested.length, 2)
        assert.equal(requested.every(path => path.endsWith('/runtime.v1.magius-runtime')), true)
        assert.equal(requested.some(path => path.endsWith('.json.gz')), false)
    } finally {
        globalThis.document = previousDocument
        globalThis.fetch = previousFetch
    }
})
