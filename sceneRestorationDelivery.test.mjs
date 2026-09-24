import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'
import { requiredDirectoryClosures, withBundledStageRoots } from './scripts/copy-deployment-public.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const read = file => JSON.parse(readFileSync(join(root, file), 'utf8'))
// First batch verified against native GO/Renderer state and actual FBX carriers.
// This is a shipping denominator, not a claim of completed scene fidelity.
const stages = ['battle-601-00-01-001', 'battle-608-00-00-001',
    'battle-616-00-01-001', 'battle-602-00-00-001', 'battle-601-00-01-002',
    'battle-600-00-00-001', 'battle-600-00-01-003', 'battle-603-00-00-001']
const catalog = read('public/catalogs/runtime-product-delivery.v1.json')
const publishedCatalog = withBundledStageRoots(catalog)
function definitionFor(id) {
    const file = `public/stages/catalog/${id}.json`
    return existsSync(join(root, file)) ? read(file)
        : read('public/stages/catalog.json').stages.find(stage => stage.id === id)
}
for (const id of stages) test(`${id}: current carrier, native states and companions ship together`, () => {
    const output = `stages/official/${id}`
    assert.ok(requiredDirectoryClosures.some(c => c.output === output), `Missing deployment closure: ${id}`)
    assert.ok(publishedCatalog.bundledStageRoots.includes(`/${output}/`))
    const definition = definitionFor(id)
    const profile = definition.sceneProfileUrl
        ? read('public/' + definition.sceneProfileUrl.replace(/^\.\//, '')) : definition
    assert.ok(profile.nativeVisibility?.gameObjects.length > 0)
    assert.ok(profile.nativeVisibility?.renderers.length > 0)
    const references = new Set()
    function collect(value) {
        if (typeof value === 'string' && /^\.?\/stages\//.test(value)) references.add(value)
        else if (Array.isArray(value)) value.forEach(collect)
        else if (value && typeof value === 'object') Object.values(value).forEach(collect)
    }
    collect(definition); collect(profile)
    for (const ref of references) {
        const local = ref.replace(/^\.?\//, '')
        assert.ok(statSync(join(root, 'public', local)).isFile(), ref)
        assert.ok(local.startsWith('stages/catalog/') || local.startsWith(output + '/'), `External stage companion requires its own closure: ${ref}`)
    }
    for (const name of readdirSync(join(root, 'public', output))) {
        const meta = statSync(join(root, 'public', output, name))
        if (meta.isFile()) assert.ok(meta.size <= 25 * 1024 ** 2, name)
    }
})

test('release runtime selects bundled current scene assets without contacting old archives', async t => {
    const sourceFile = join(root, 'src/viewer/runtimeProductDelivery.ts')
    const progress = ts.transpileModule(readFileSync(join(root, 'magia-exedra-character-three/loadingProgress.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const source = readFileSync(sourceFile, 'utf8').replace(
        "'../../magia-exedra-character-three/loadingProgress.ts'",
        JSON.stringify(`data:text/javascript;base64,${Buffer.from(progress).toString('base64')}`),
    )
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
    const globals = Object.fromEntries(['fetch', 'location', 'document'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]))
    const calls = []
    Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL('https://magius3dviewer.pages.dev/?runtimeDelivery=release') })
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { baseURI: 'https://magius3dviewer.pages.dev/' } })
    globalThis.fetch = async url => {
        calls.push(String(url))
        assert.match(String(url), /\/catalogs\/runtime-product-delivery\.v1\.json$/)
        return new Response(JSON.stringify(publishedCatalog))
    }
    t.after(() => { for (const [k, d] of Object.entries(globals)) d ? Object.defineProperty(globalThis, k, d) : delete globalThis[k] })
    const runtime = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
    for (const id of stages) {
        const definition = definitionFor(id)
        assert.equal(await runtime.resolveRuntimeAssetUrl(definition.url), new URL(definition.url, document.baseURI).href)
    }
    assert.equal(calls.length, 1)
})
