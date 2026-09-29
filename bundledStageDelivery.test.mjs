import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText
const asModule = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
const loading = asModule(compile(await fs.readFile(new URL('./magia-exedra-character-three/loadingProgress.ts', import.meta.url), 'utf8')))
const source = await fs.readFile(new URL('./src/viewer/runtimeProductDelivery.ts', import.meta.url), 'utf8')
const code = compile(source.replace("'../../magia-exedra-character-three/loadingProgress.ts'", JSON.stringify(loading)))
const pinned = 'https://a1b2c3d4.magius3dviewer.pages.dev/'
const root = '/stages/official/battle-616-00-01-001/'

function catalog() {
  return {
    schema: 'magius.runtime-product-delivery.v1', repository: 'HiiragiNemu/Magi3Dviewer',
    deliveryGateway: 'https://fixture.invalid',
    activation: { hosts: ['hiiraginemu.github.io', 'magius3dviewer.pages.dev'], queryOverride: 'runtimeDelivery=release', localMode: 'prefer-workspace-files' },
    counts: { products: 1, releaseAssets: 1, voiceProducts: 0 },
    bundledStageRoots: [root], bundledStageBaseUrl: pinned,
    entries: [{ stableKey: 'stage|battle-616-00-01-001', kind: 'stage', rootPath: root,
      releaseTag: 'runtime-products-v1-a', assetName: '0592-stage-battle-616-00-01-001.zip',
      packUrl: 'https://fixture.invalid/runtime-products-v1-a/0592-stage-battle-616-00-01-001.zip',
      originUrl: 'https://github.com/HiiragiNemu/Magi3Dviewer/releases/download/runtime-products-v1-a/0592-stage-battle-616-00-01-001.zip',
      fileCount: 1, unpackedBytes: 1, packedBytes: 1 }],
  }
}

async function fixture(t, { base = 'https://hiiraginemu.github.io/Magi3Dviewer/', manifest = catalog(), active = true } = {}) {
  const runtime = await import(asModule(code) + '#' + Math.random())
  const keys = ['document', 'location', 'fetch']
  const descriptors = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { baseURI: base } })
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL(base + (active ? '?runtimeDelivery=release' : '')) })
  const requests = []
  globalThis.fetch = async url => {
    requests.push(String(url))
    assert.equal(String(url), new URL('catalogs/runtime-product-delivery.v1.json', base).href, 'current bundled scenes must never fetch historical archives')
    return new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } })
  }
  t.after(() => {
    runtime.resetRuntimeProductDeliveryForTests()
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  return { runtime, requests, manifest }
}

test('GitHub Pages profiles and FBX carriers resolve to the same immutable build', async t => {
  const { runtime, requests } = await fixture(t)
  for (const relative of ['scene-profile.json', 'bg_3d_616_00_01_001.fbxdata', 'lightmap-data.json']) {
    const route = root + relative
    for (const input of [route, '.' + route, 'https://hiiraginemu.github.io/Magi3Dviewer' + route]) {
      assert.equal(await runtime.resolveRuntimeAssetUrl(input), pinned + route.slice(1))
      assert.equal(runtime.resolveCachedRuntimeAssetUrl(input), pinned + route.slice(1))
    }
  }
  assert.equal(requests.length, 1)
})

test('synchronous FBX textures and reviewed PNG aliases use pinned current bytes', async t => {
  const { runtime } = await fixture(t)
  await runtime.loadRuntimeProductDelivery()
  for (const suffix of ['col', 'nml']) {
    const png = root + 'bg3d616_01_01_ground_' + suffix + '.png'
    const webp = pinned + png.slice(1).replace(/\.png$/, '.webp')
    assert.equal(runtime.resolveCachedRuntimeAssetUrl(png), webp)
    assert.equal(runtime.resolveCachedRuntimeAssetUrl(pinned + png.slice(1)), webp)
  }
  assert.equal(runtime.resolveCachedRuntimeAssetUrl(root + 'unchanged.png'), pinned + root.slice(1) + 'unchanged.png')
  assert.equal(runtime.resolveCachedRuntimeAssetUrl(root + 'name%20with%20space.png'), pinned + root.slice(1) + 'name%20with%20space.png')
})

test('unrelated resources and external URLs do not inherit the bundled stage route', async t => {
  const { runtime } = await fixture(t)
  await runtime.loadRuntimeProductDelivery()
  for (const route of ['/assets/model.glb', '/character-actions/combat-jump/manifest.v1.json', '/stages/official/unlisted-stage/texture.png']) {
    assert.equal(runtime.resolveCachedRuntimeAssetUrl(route), 'https://hiiraginemu.github.io/Magi3Dviewer' + route)
  }
  assert.equal(await runtime.resolveRuntimeAssetUrl('/assets/model.glb'), 'https://hiiraginemu.github.io/Magi3Dviewer/assets/model.glb')
  const foreign = 'https://another.example' + root + 'bg3d616_01_01_ground_col.png'
  assert.equal(runtime.resolveCachedRuntimeAssetUrl(foreign), foreign)
  assert.equal(await runtime.resolveRuntimeAssetUrl(foreign), foreign)
})

test('full Cloudflare deployments without a delegated base retain their local stage bytes', async t => {
  const manifest = catalog(); delete manifest.bundledStageBaseUrl
  const { runtime } = await fixture(t, { base: 'https://magius3dviewer.pages.dev/', manifest })
  assert.equal(await runtime.resolveRuntimeAssetUrl(root + 'scene-profile.json'), 'https://magius3dviewer.pages.dev' + root + 'scene-profile.json')
  assert.equal(runtime.resolveCachedRuntimeAssetUrl(root + 'normal.png'), 'https://magius3dviewer.pages.dev' + root + 'normal.png')
})

test('local source mode does not silently become a CDN-only mode', async t => {
  const { runtime } = await fixture(t, { base: 'http://localhost:4175/', active: false })
  assert.equal(await runtime.resolveRuntimeAssetUrl(root + 'scene-profile.json'), 'http://localhost:4175' + root + 'scene-profile.json')
  assert.equal(runtime.resolveCachedRuntimeAssetUrl(root + 'normal.png'), 'http://localhost:4175' + root + 'normal.png')
})

for (const base of [
  'https://magius3dviewer.pages.dev/', 'https://main.magius3dviewer.pages.dev/',
  'http://a1b2c3d4.magius3dviewer.pages.dev/', 'https://a1b2c3d4.other.pages.dev/',
  'https://a1b2c3d4.magius3dviewer.pages.dev/?revision=fake',
  'https://a1b2c3d4.magius3dviewer.pages.dev/other/', '', null,
]) test('rejects non-immutable or ambiguous scene base: ' + String(base), async t => {
  const manifest = catalog(); manifest.bundledStageBaseUrl = base
  const { runtime } = await fixture(t, { manifest })
  await assert.rejects(runtime.loadRuntimeProductDelivery(), /Bundled stage base/)
})

test('a pinned base cannot replace unregistered or empty stage closures', async t => {
  const manifest = catalog(); manifest.bundledStageRoots = []
  const { runtime } = await fixture(t, { manifest })
  await assert.rejects(runtime.loadRuntimeProductDelivery(), /Bundled stage base/)
})
