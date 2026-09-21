import { assertReleaseEnemyManifest } from './releaseCorpusTestSupport.mjs'
import assert from 'node:assert/strict'
import { gunzipSync } from 'node:zlib'
import { readFile, stat, writeFile, rm, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import ts from 'typescript'

const root = new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1')
const publicRoot = join(root, 'public')
const catalog = JSON.parse(await readFile(join(publicRoot, 'vfx', 'catalog.v1.json'), 'utf8'))
const enemies = JSON.parse(await readFile(join(publicRoot, 'enemies', 'manifest.v1.json'), 'utf8'))

test('direction-keyed VFX catalog publishes the complete target without concrete-ID runtime tables', async () => {
  assert.equal(catalog.schema, 'magius.combat-vfx-catalog.v1')
  assert.deepEqual(catalog.counts, {
    products: 656,
    enemyProducts: 443,
    characterProducts: 213,
    runtimeReady: 656,
    failClosed: 0,
    targetProducts: 654,
    targetEnemyProducts: 443,
    targetCharacterProducts: 211,
    targetRuntimeReady: 654,
    targetFailClosed: 0,
    legacyProducts: 2,
  })
  assert.equal(catalog.lookupContract.primary, 'subjectKind + directionName')
  assert.equal(new Set(catalog.entries.map(entry => entry.stableKey)).size, 656)
  assert.equal(new Set(catalog.entries.map(entry => entry.productStableKey)).size, 656)
  assert.equal(new Set(catalog.entries.map(entry => entry.bundleKey)).size, 656)
  assert.ok(catalog.entries.every(entry => entry.stableKey === `${entry.domain}|${entry.directionName}`))
  assert.equal(catalog.entries.filter(entry => entry.publicationScope === 'target').length, 654)
  assert.equal(catalog.entries.filter(entry => !entry.runtimeReady).length, 0)
  const consumer = await readFile(join(root, 'src', 'viewer', 'combatVfx.ts'), 'utf8')
  assert.doesNotMatch(consumer, /PRODUCT_BY_BUNDLE/)
  assert.doesNotMatch(consumer, /enemy_60000[123]/)
  assert.match(consumer, /CombatVfxCatalogClient/)
})

test('all catalog products and declared textures reopen through public URLs', async () => {
  for (const entry of catalog.entries) {
    const productPath = join(publicRoot, entry.productUrl.replace(/^\//, ''))
    const bytes = await readFile(productPath)
    const payload = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes
    const product = JSON.parse(payload.toString('utf8'))
    assert.equal(product.schemaVersion, 2)
    assert.equal(product.productType, 'magius-official-combat-vfx-v2')
    assert.equal(product.vfxKey, entry.productStableKey)
    assert.equal(product.bundleLogicalPath, entry.bundleKey)
    assert.equal(product.particleRuntime.particleSystems.length, entry.particleSystemCount)
    assert.equal(product.particleRuntime.textureUrls.length, entry.textureCount)
    for (const url of product.particleRuntime.textureUrls) {
      await stat(join(dirname(productPath), url))
    }
  }
  const targetProducts = catalog.entries.filter(entry => entry.publicationScope === 'target')
  assert.ok(targetProducts.every(entry => entry.productUrl.endsWith('/product.vfxdata')))
  const targetRoots = [join(publicRoot, 'vfx', 'enemy'), join(publicRoot, 'vfx', 'character')]
  for (const targetRoot of targetRoots) {
    const names = await readdir(targetRoot, { recursive: true })
    assert.ok(names.every(name => !/(^|[\\/])(bundle-closure|profile\.json|closure\.json)([\\/]|$)/.test(name)))
  }
})

test('enemy manifest exposes and loads all 443 runtime-ready products', () => {
  assertReleaseEnemyManifest(enemies)
  assert.equal(enemies.counts.enemyRecords, 516)
  assert.equal(enemies.counts.modelResources, 495)
  assert.equal(enemies.counts.renderReadyModels, 495)
  assert.equal(enemies.counts.directionRecords, 1234)
  assert.equal(enemies.counts.directionRecordsWithCatalogProduct, 1234)
  assert.equal(enemies.counts.uniqueCatalogVfxProducts, 443)
  assert.equal(enemies.counts.directionRecordsWithRuntimeProduct, 1234)
  assert.equal(enemies.counts.uniqueRuntimeVfxProducts, 443)
  const directions = enemies.entries.flatMap(entry => entry.actions.directions)
  assert.ok(directions.every(direction => direction.stableDirectionKey.startsWith('enemy-direction:')))
  assert.ok(directions.every(direction => direction.catalogProduct))
  const connected = directions.filter(direction => direction.runtimeProduct)
  assert.equal(new Set(connected.map(direction => direction.runtimeProduct.stableKey)).size, 443)
  const failClosed = directions.filter(direction => !direction.runtimeProduct)
  assert.equal(failClosed.length, 0)
  assert.ok(directions.every(direction => direction.catalogProduct.status === 'runtime-ready'))
})

const sourcePath = join(root, 'src', 'viewer', 'combatVfxCatalog.ts')
const runtimePath = join(root, `.combat-vfx-catalog-${process.pid}-${Date.now()}.mjs`)
const compiled = ts.transpileModule(await readFile(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
})
await writeFile(runtimePath, compiled.outputText, 'utf8')
const api = await import(pathToFileURL(runtimePath).href)
after(() => rm(runtimePath, { force: true }))

test('catalog API resolves normalized bundle keys and fails closed for missing products', () => {
  const index = new api.CombatVfxCatalog(catalog)
  const entry = catalog.entries.find(value => value.domain === 'enemy' && value.runtimeReady)
  assert.equal(index.requireByBundleKey(`AssetBundles/${entry.bundleKey}`).stableKey, entry.stableKey)
  assert.equal(index.getByStableKey(entry.stableKey).productUrl, entry.productUrl)
  assert.equal(index.getByStableKey(entry.productStableKey).stableKey, entry.stableKey)
  assert.equal(index.getByDirection(entry.domain, entry.directionName).stableKey, entry.stableKey)
  const blockedEntry = {
    ...entry,
    status: 'fail-closed',
    runtimeReady: false,
    failClosedReasons: ['typed-fixture-unavailable'],
  }
  const blockedCatalog = {
    ...catalog,
    entries: catalog.entries.map(value => value.stableKey === entry.stableKey
      ? blockedEntry
      : value),
  }
  const blockedIndex = new api.CombatVfxCatalog(blockedCatalog)
  assert.equal(blockedIndex.getByStableKey(blockedEntry.stableKey).status, 'fail-closed')
  assert.throws(
    () => blockedIndex.requireByBundleKey(blockedEntry.bundleKey),
    error => error.code === 'NOT_FOUND',
  )
  assert.throws(
    () => index.requireByBundleKey('battle/skill/missing'),
    error => error.code === 'NOT_FOUND',
  )
})
