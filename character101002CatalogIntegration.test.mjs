import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { parseHomeExpressionSchema2, evaluateHomeExpression } from './magia-exedra-character-three/homeExpressionSchema2.ts'

const root = new URL('.', import.meta.url)
const json = relative => JSON.parse(readFileSync(new URL(relative, root), 'utf8'))
const mst = json('./magia-exedra-character-three/getStyle3dCharacterMstList.json')
const entry = mst.payload.mstList.find(row => row.style3dCharacterMstId === 101002)
const required = [
  'chara_101002.fbx', 'home-animations.json.gz', 'home-expressions.json',
  'runtime-material-channel.json', 'native-extra-channels.bin', 'redrive-baked-normals.bin.gz',
]

test('101002 is a distinct exact catalog identity, not 101001 alias', () => {
  assert.ok(entry)
  assert.equal(entry.resourceName, 'chara_101002_battle_unit')
  assert.equal(entry.homeMotionResourceName, 'chara_10100201_home')
  assert.equal(entry.sortOrder, 101002)
  assert.equal(mst.payload.mstList.filter(row => row.style3dCharacterMstId === 101002).length, 1)
  assert.notEqual(entry.resourceName, 'chara_101001_battle_unit')
})

test('101002 exact model/Home closure is present with no guessed substitutions', () => {
  const dir = new URL('./magia-exedra-character-three/models/chara_101002_battle_unit/', root)
  for (const name of required) assert.ok(existsSync(new URL(name, dir)), name)
  const expression = json('./magia-exedra-character-three/models/chara_101002_battle_unit/home-expressions.json')
  const schema = parseHomeExpressionSchema2({ ...expression, schema: 'home-expression-schema2' })
  assert.equal(schema.characterId, 101002)
  assert.equal(schema.styleId, 10100201)
  assert.equal(schema.expressionOrder.length, 15)
  assert.equal(schema.morphTargetCount, 64)
  assert.equal(evaluateHomeExpression(schema, 'HomeFace04_Annoyed', 0.11)['Bs.Mouth_Down_L'] > 1, true)
  assert.deepEqual(schema.expressions.Annoyed.unresolvedAttributes, [])
})

test('all declared runtime files retain sealed byte sizes', () => {
  const manifest = JSON.parse(readFileSync('D:/magia/MyProducts/Magius3Dviewer-JP/artifacts/verification/20260906-s6-101002-model-catalog-assets/asset-copy.json', 'utf8'))
  const transaction = JSON.parse(readFileSync('D:/magia/MyProducts/Magius3Dviewer-JP/artifacts/verification/20260906-s6-101002-model-catalog-assets/transaction/transaction-manifest.json', 'utf8'))
  const currentRuntimeMaterial = JSON.parse(readFileSync('C:/Users/proje/Documents/Codex/2026-09-12/codex-threads-01a06bac-2bc0-7011-8471/outputs/repair-100102-manifest-test-20260913/current-runtime-material-evidence.json', 'utf8'))
  const modifiedHome = new Map(transaction.sourceFiles
    .filter(row => /models[\\/]chara_101002_battle_unit[\\/]home-(?:animations\.json\.gz|expressions\.json)$/.test(row.repoPath))
    .map(row => [row.repoPath.split(/[\\/]/).pop(), { bytes: row.modifiedBytes, sha256: row.modifiedSha256 }]))
  const dir = new URL('./magia-exedra-character-three/models/chara_101002_battle_unit/', root)
  for (const row of manifest.rows) {
    const name = row.destination.split(/[\\/]/).pop()
    const expected = modifiedHome.get(name) ?? (name === 'runtime-material-channel.json'
      ? { bytes: currentRuntimeMaterial.bytes, sha256: currentRuntimeMaterial.sha256 }
      : { bytes: row.bytes, sha256: row.sourceSha256 })
    const path = new URL(name, dir)
    const bytes = readFileSync(path)
    assert.equal(bytes.byteLength, expected.bytes, path.href)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, path.href)
  }
})
