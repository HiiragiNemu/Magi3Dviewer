import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

export const releaseCorpus = JSON.parse(readFileSync(new URL('./test-fixtures/release-corpus-20260916.json', import.meta.url)))
function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]))
  return value
}
const digest = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')

export function assertReleaseMaterialCorpus(document) {
  const historicalNames = releaseCorpus.historicalMaterialNames
  const addedNames = releaseCorpus.addedMaterialNames
  assert.equal(releaseCorpus.historicalBundleCount, 97)
  assert.equal(historicalNames.length, 1538)
  assert.equal(releaseCorpus.addedBundleCount, 1)
  assert.equal(addedNames.length, 21)
  assert.deepEqual(Object.keys(document.materials).sort(), [...historicalNames, ...addedNames].sort())
  const historical = Object.fromEntries(historicalNames.map(k => [k, document.materials[k]]))
  const added = Object.fromEntries(addedNames.map(k => [k, document.materials[k]]))
  assert.equal(digest(historical), releaseCorpus.historicalMaterialsSha256, 'all 1538 existing material records remain exact')
  assert.equal(digest(added), releaseCorpus.addedMaterialsSha256, 'all 21 Ashley material records remain exact')
  assert.equal(document.bundleCount - releaseCorpus.addedBundleCount, 97)
  assert.equal(document.bundleCount, 98)
  assert.equal(document.materialCount, 1559)
  return { historical: Object.values(historical), added: Object.values(added) }
}

export function assertReleaseEnemyManifest(manifest) {
  const delta = releaseCorpus.enemyDelta
  const historical = manifest.entries.filter(e => !delta.addedEntryIds.includes(e.enemyMstId))
  const added = manifest.entries.filter(e => delta.addedEntryIds.includes(e.enemyMstId))
  assert.equal(historical.length, 514)
  assert.equal(added.length, 2)
  assert.deepEqual(historical.map(e => e.enemyMstId).sort((a, b) => a - b), delta.historicalEntryIds)
  assert.deepEqual(added.map(e => e.enemyMstId).sort((a, b) => a - b), [605025, 605026])
  assert.equal(digest(historical), delta.historicalEntriesSha256, 'all 514 historical enemy records remain exact')
  assert.equal(digest(added), delta.addedEntriesSha256, 'only the two source-backed Android JP records are added')
  assert.equal(new Set(historical.map(e => e.modelPrefabName)).size, 493)
  assert.equal(new Set(added.map(e => e.modelPrefabName)).size, 2)
  assert.equal(manifest.counts.enemyRecords, 516)
  assert.equal(manifest.counts.modelResources, 495)
  assert.equal(manifest.counts.renderReadyModels, 495)
  assert.equal(manifest.counts.materialProfileModels, 495)
  assert.equal(manifest.counts.materialProfileRuntimeReadyModels, 495)
  assert.equal(historical.filter(e => e.names.ja).length, 507)
  assert.equal(added.filter(e => e.names.ja).length, 2)
  assert.equal(manifest.counts.localizedNames.ja, 509)
  for (const entry of added) {
    assert.equal(entry.sourceAuthority.platform, 'AndroidJP')
    assert.deepEqual(entry.actions.directions, [])
    assert.equal(entry.actions.completeness, 'BASE_CLIPS_ONLY__EMBEDDED_DIRECTOR_AND_ATTACK_VFX_PENDING')
    assert.equal(entry.acceptance.fullDirection, 'NOT_IMPLEMENTED')
    assert.equal(entry.actions.embeddedDirectionGapUrl, '/enemies/models/' + entry.modelPrefabName + '/direction-gaps.v1.json')
  }
  return { historical, added }
}

export function assertReleaseEnemyCatalog(catalog) {
  const delta = releaseCorpus.enemyDelta
  const historical = catalog.enemyModels.filter(e => !delta.addedModelNames.includes(e.modelPrefabName))
  const added = catalog.enemyModels.filter(e => delta.addedModelNames.includes(e.modelPrefabName))
  assert.equal(historical.length, 493)
  assert.equal(added.length, 2)
  assert.equal(catalog.enemyModels.length, 495)
  assert.deepEqual(historical.map(e => e.modelPrefabName).sort(), delta.historicalModelNames)
  assert.deepEqual(added.map(e => e.modelPrefabName).sort(), delta.addedModelNames)
  assert.equal(digest(historical), delta.historicalModelsSha256)
  assert.equal(digest(added), delta.addedModelsSha256)
  return { historical, added }
}
