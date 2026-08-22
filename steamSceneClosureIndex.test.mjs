import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repo = dirname(fileURLToPath(import.meta.url))
const artifact = join(repo, 'artifacts', 'bulk-stage-expansion-20260817')
const readJson = (name) => JSON.parse(readFileSync(join(artifact, name), 'utf8'))

test('Steam scene inventory accounts for every direct official battle scene', () => {
  const inventory = readJson('steam-scene-inventory.json')
  const direct = inventory.sceneBundles.filter((row) => row.family === 'battle-direct')

  assert.equal(inventory.unityVersion, '2022.3.62f2')
  assert.ok(direct.length >= 142, `expected at least 142 direct battle scenes, got ${direct.length}`)
  assert.equal(direct.length, inventory.counts.directBattleScenes)
  assert.equal(new Set(direct.map((row) => row.logicalPath)).size, direct.length)
  assert.equal(direct.every((row) => row.catalogPresent && row.localPresent), true)
  assert.equal(inventory.counts.families['gallery-diorama-original'], 79)
  assert.equal(inventory.counts.families['battle-bosspoint-helper'], 9)
  assert.equal(inventory.counts.families['battle-tower-data'], 76)

  // The decrypted Steam root is verified locally and deliberately absent from Pages CI.
  if (!existsSync(inventory.sources.steamRoot)) return

  for (const row of direct) {
    assert.equal(
      existsSync(join(inventory.sources.steamRoot, row.logicalPath)),
      true,
      `missing in-place source ${row.logicalPath}`,
    )
  }
})

test('complete CAB index covers the whole decrypted AssetBundle catalog', () => {
  const index = readJson('cab-index.json')
  const cache = readJson('cab-scan-cache.json')

  assert.equal(index.complete, true)
  assert.equal(cache.complete, true)
  assert.equal(index.scanErrorCount, 0)
  assert.equal(index.inspectedAssetBundleCount, index.assetBundleEntryCount)
  assert.equal(cache.records.length, index.assetBundleEntryCount)
  assert.equal(index.cabCount, index.assetBundleEntryCount)
  assert.equal(index.duplicateCabCount, 0)
})

test('all direct battle scene external tables resolve without source copies', () => {
  const document = readJson('steam-scene-dependency-closures.json')
  const direct = document.closures.filter((row) => row.family === 'battle-direct')

  assert.equal(document.copyMode, 'none-read-source-in-place')
  assert.ok(direct.length >= 142)
  assert.equal(document.summary.directBattleClosures, direct.length)
  assert.equal(document.summary.directBattleFullyResolved, direct.length)
  assert.equal(document.summary.directBattleWithUnresolved, 0)
  assert.equal(document.summary.unresolvedUniqueExternalCabs, 0)
  assert.deepEqual(document.unresolvedUniqueExternalCabs, [])
  assert.equal(
    direct.every(
      (row) =>
        row.fullyResolved &&
        row.externalCabCount === row.resolvedExternalCabCount &&
        row.unresolvedExternalCabs.length === 0 &&
        row.dependencies.every(
          (dependency) =>
            dependency.resolved &&
            dependency.preferredLogicalPath.startsWith('AssetBundles/'),
        ),
    ),
    true,
  )
})

test('602 sample closure is discovered from its official external table', () => {
  const sample = readJson('bg_3d_602_00_00_001-dependency-closure.json').closure
  const paths = sample.dependencies.map((dependency) => dependency.preferredLogicalPath)

  assert.equal(sample.resourceName, 'bg_3d_602_00_00_001')
  assert.equal(sample.externalCabCount, 16)
  assert.equal(sample.resolvedExternalCabCount, 16)
  assert.equal(sample.fullyResolved, true)
  assert.deepEqual(sample.unresolvedExternalCabs, [])
  assert.equal(paths.includes('AssetBundles/shader/bg_uber'), true)
  assert.equal(paths.includes('AssetBundles/shader/common/texture/cloud_noise'), true)
  assert.equal(paths.includes('AssetBundles/shader/common/texture/simple_noise'), true)
  assert.equal(paths.filter((path) => path.startsWith('AssetBundles/texture/bg/')).length, 12)
})

test('resolver contains no hard-coded sample CAB or per-scene dependency table', () => {
  const source = readFileSync(join(repo, 'scripts', 'build-steam-scene-closure-index.py'), 'utf8')
  assert.equal(/CAB-[0-9a-f]{32}/i.test(source), false)
  assert.equal(source.includes('bg_3d_602_00_00_001'), false)
  assert.equal(source.includes('privateClosureCopies'), false)
  assert.equal(source.includes('inspect_bundle(path, include_truth)'), true)
})
