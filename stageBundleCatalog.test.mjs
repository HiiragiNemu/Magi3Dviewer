import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const catalog = JSON.parse(readFileSync('public/stages/catalog.json', 'utf8'))
const byId = new Map(catalog.stages.map(stage => [stage.id, stage]))

const authoritativeBattleRoots = new Map([
  ['battle-600-00-00-001', 'battle/stage/bg_3d_600_00_00_001'],
  ['battle-600-00-01-001', 'battle/stage/bg_3d_600_00_01_001'],
  ['battle-600-00-01-002', 'battle/stage/bg_3d_600_00_01_002'],
])

test('known JP battle stages use real AssetBundle root names', () => {
  for (const [id, bundleName] of authoritativeBattleRoots) {
    const stage = byId.get(id)
    assert.ok(stage, `missing catalog stage ${id}`)
    assert.equal(stage.assetBundleName, bundleName)
  }
})

test('official battle catalog does not use filesystem-like synthetic bg/3d paths', () => {
  const offenders = catalog.stages
    .filter(stage => stage.official && stage.category === 'battle')
    .filter(stage => String(stage.assetBundleName ?? '').includes('/bg/3d/'))
    .map(stage => ({ id: stage.id, assetBundleName: stage.assetBundleName }))
  assert.deepEqual(offenders, [])
})
