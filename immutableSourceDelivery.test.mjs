import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import ts from 'typescript'
import { prepareGitHubPages } from './scripts/prepare-github-pages.mjs'

const revision = 'a'.repeat(40)
const sourceBase = `https://raw.githubusercontent.com/HiiragiNemu/Magi3Dviewer/${revision}/public/`
const root = '/stages/official/battle-616-00-01-001/'
const moduleUrl = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64')
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
const loading = moduleUrl(compile(await fs.readFile(new URL('./magia-exedra-character-three/loadingProgress.ts', import.meta.url), 'utf8')))
const source = await fs.readFile(new URL('./src/viewer/runtimeProductDelivery.ts', import.meta.url), 'utf8')
const code = compile(source.replace("'../../magia-exedra-character-three/loadingProgress.ts'", JSON.stringify(loading)))

async function runtimeFixture(t) {
  const runtime = await import(moduleUrl(code) + '#' + Math.random())
  const keys = ['document', 'location', 'fetch']
  const descriptors = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { baseURI: 'https://hiiraginemu.github.io/Magi3Dviewer/' } })
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL('https://hiiraginemu.github.io/Magi3Dviewer/') })
  const manifest = { schema: 'magius.runtime-product-delivery.v1', repository: 'HiiragiNemu/Magi3Dviewer', deliveryGateway: 'https://fixture.invalid',
    activation: { hosts: ['hiiraginemu.github.io'], queryOverride: 'runtimeDelivery=release', localMode: 'prefer-workspace-files' },
    counts: { products: 1, releaseAssets: 1, voiceProducts: 0 }, bundledStageRoots: [root], bundledStageBaseUrl: sourceBase,
    entries: [{ kind: 'stage', stableKey: 'fixture', rootPath: root, releaseTag: 'old', assetName: 'old.zip',
      packUrl: 'https://fixture.invalid/old/old.zip', originUrl: 'https://github.com/HiiragiNemu/Magi3Dviewer/releases/download/old/old.zip' }] }
  const requests = []
  globalThis.fetch = async url => {
    requests.push(String(url))
    assert.ok(String(url).endsWith('/Magi3Dviewer/catalogs/runtime-product-delivery.v1.json'), 'Must not substitute an old release archive')
    return new Response(JSON.stringify(manifest))
  }
  t.after(() => {
    runtime.resetRuntimeProductDeliveryForTests()
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]
    }
  })
  return { runtime, requests }
}

test('source commit prefix is removed exactly once for profile, carrier and texture routing', async t => {
  const { runtime, requests } = await runtimeFixture(t)
  for (const name of ['scene-profile.json', 'native.fbxdata', 'a%20texture.webp']) {
    const reference = root + name
    const expected = sourceBase + reference.slice(1)
    assert.equal(await runtime.resolveRuntimeAssetUrl(reference), expected)
    assert.equal(runtime.resolveCachedRuntimeAssetUrl(reference), expected)
    assert.equal(runtime.resolveCachedRuntimeAssetUrl(expected), expected)
    assert.equal(runtime.runtimeAssetPath(expected), decodeURIComponent(reference))
  }
  assert.equal(requests.length, 1)
})

test('reviewed WebP aliases still work after FBX supplies absolute repository texture URLs', async t => {
  const { runtime } = await runtimeFixture(t)
  await runtime.loadRuntimeProductDelivery()
  const png = sourceBase + root.slice(1) + 'bg3d616_01_01_ground_col.png'
  assert.equal(runtime.resolveCachedRuntimeAssetUrl(png), png.replace(/\.png$/, '.webp'))
  const foreign = 'https://raw.githubusercontent.com/another/repo/' + revision + '/public' + root + 'bg3d616_01_01_ground_col.png'
  assert.equal(runtime.resolveCachedRuntimeAssetUrl(foreign), foreign, 'Another repository must not be rewritten')
})

test('only the exact repository and full immutable commit form are accepted', async t => {
  const { runtime } = await runtimeFixture(t)
  assert.equal(runtime.isImmutableBundledStageBase(sourceBase), true)
  for (const invalid of [sourceBase.replace(revision, 'main'), sourceBase.replace(revision, 'magius3dviewer'),
    sourceBase.replace(revision, revision.slice(0, 7)), sourceBase.replace('HiiragiNemu', 'another'),
    sourceBase + '?fake=1', sourceBase.replace('https:', 'http:')]) {
    assert.equal(runtime.isImmutableBundledStageBase(invalid), false, invalid)
  }
})

async function packFixture(t, { remoteJson = '{\n  "current": true\n}', remoteTexture = 'same-pixels', cors = true } = {}) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'magius-raw-test-'))
  t.after(() => fs.rm(temp, { recursive: true, force: true }))
  const output = path.join(temp, 'dist-deploy')
  const files = new Map([
    ['site-version.json', JSON.stringify({ revision })], ['assets/client.js', 'unaltered-client'],
    ['catalogs/runtime-product-delivery.v1.json', JSON.stringify({ bundledStageRoots: [root], entries: [{ kind: 'stage', rootPath: root }] })],
    [root.slice(1) + 'scene-profile.json', '{"current":true}'],
    [root.slice(1) + 'texture.webp', 'same-pixels'],
  ])
  for (const [name, content] of files) {
    const target = path.join(output, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content)
  }
  const requests = []
  const fetchResource = async url => {
    assert.ok(url.startsWith(sourceBase)); requests.push(url)
    assert.ok(url.includes('/stages/official/'), 'Generated site-version must not be requested from source')
    return new Response(url.endsWith('.json') ? remoteJson : remoteTexture, { headers: cors ? { 'access-control-allow-origin': '*' } : {} })
  }
  return { output, requests, run: overrides => prepareGitHubPages({ output, base: sourceBase, expectedRevision: revision, fetchResource, ...overrides }),
    stageExists: async () => !!(await fs.stat(path.join(output, root.slice(1) + 'texture.webp')).catch(() => null)) }
}

test('source delivery accepts only the packager existing JSON whitespace transform and exact binary bytes', async t => {
  const f = await packFixture(t)
  const summary = await f.run()
  assert.equal(summary.delegatedStageDelivery.source, 'exact-public-repository-commit')
  assert.equal(summary.delegatedStageDelivery.files, 2)
  assert.equal(f.requests.length, 2)
  assert.equal(await f.stageExists(), false)
  assert.equal(await fs.readFile(path.join(f.output, 'assets/client.js'), 'utf8'), 'unaltered-client')
})

for (const [fault, options] of [
  ['changed JSON value', { remoteJson: '{"current":false}' }],
  ['changed image', { remoteTexture: 'wrong-pixels' }],
  ['missing CORS', { cors: false }],
]) test('source delegation cannot conceal ' + fault, async t => {
  const f = await packFixture(t, options)
  await assert.rejects(f.run())
  assert.equal(await f.stageExists(), true)
})

test('another immutable source revision cannot replace the tested commit', async t => {
  const f = await packFixture(t)
  await assert.rejects(f.run({ base: sourceBase.replace(revision, 'b'.repeat(40)) }), /stale or mismatched/)
  assert.equal(f.requests.length, 0)
  assert.equal(await f.stageExists(), true)
})
