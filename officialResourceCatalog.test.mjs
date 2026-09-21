import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import ts from 'typescript'

const root = new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1')
const sourcePath = join(root, 'src', 'viewer', 'officialResourceCatalog.ts')
const runtimePath = join(root, `.official-resource-catalog-${process.pid}-${Date.now()}.mjs`)
const compiled = ts.transpileModule(await readFile(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
})
await writeFile(runtimePath, compiled.outputText, 'utf8')
const api = await import(pathToFileURL(runtimePath).href)
after(() => rm(runtimePath, { force: true }))

const scene = {
  id: 'stage-key',
  stableKey: 'AssetBundles/stage/key',
  family: 'fixture',
  category: 'fixture',
  displayName: 'Stage',
  names: { en: 'Stage', ja: null, zhHant: null },
  type: 'gltf',
  url: '/stage.gltf',
  sceneProfileUrl: null,
  product: { fullyResolved: true },
}
const enemy = {
  modelPrefabName: 'enemy_model',
  stableKey: 'AssetBundles/enemy/model',
  recordIds: [1],
  enemyUniqueIds: [1],
  displayName: 'Enemy',
  names: { en: 'Enemy', ja: null, zhHant: null },
  modelUrl: '/enemy.fbxdata',
  thumbnailUrl: '/enemy.png',
  renderReady: true,
}
const vfx = {
  stableKey: 'enemy/1/skill',
  productStableKey: 'product/enemy/1/skill',
  domain: 'enemy',
  ownerKey: '1',
  directionKey: 'skill',
  displayName: 'skill',
  bundleKey: 'battle/skill/enemy_1_skill',
  productUrl: '/vfx/product.json',
  status: 'runtime-ready',
  runtimeReady: true,
  failClosedReasons: [],
}
const fixture = {
  schema: api.OFFICIAL_RESOURCE_CATALOG_SCHEMA,
  counts: {
    scenes: 1,
    sceneTarget: 581,
    enemyRecords: 1,
    enemyModels: 1,
    enemyModelTarget: 493,
    enemyVfx: 1,
    enemyVfxTarget: 443,
    enemyVfxRuntimeReady: 1,
    characterVfx: 0,
    characterVfxTarget: 211,
    characterVfxRuntimeReady: 0,
    vfxFailClosed: 0,
  },
  scenes: [scene],
  enemyModels: [enemy],
  vfx: [vfx],
}

test('official resource API resolves each product class by stable key', () => {
  const catalog = new api.OfficialResourceCatalog(fixture)
  assert.equal(catalog.requireScene(scene.stableKey).id, scene.id)
  assert.equal(catalog.requireEnemyModel(enemy.stableKey).modelPrefabName, enemy.modelPrefabName)
  assert.equal(catalog.requireVfx(vfx.stableKey).bundleKey, vfx.bundleKey)
})

test('official resource API fails closed for missing and unresolved products', () => {
  const catalog = new api.OfficialResourceCatalog(fixture)
  assert.throws(() => catalog.requireScene('missing'), error => error.code === 'NOT_FOUND')
  assert.throws(() => catalog.requireEnemyModel('missing'), error => error.code === 'NOT_FOUND')
  assert.throws(() => catalog.requireVfx('missing'), error => error.code === 'NOT_FOUND')
  assert.throws(
    () => new api.OfficialResourceCatalog({ ...fixture, counts: { ...fixture.counts, scenes: 2 } }),
    error => error.code === 'SCHEMA_ERROR',
  )
})
