import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(
  readFileSync(join(root, 'research', 'next-official-stage-candidates.json'), 'utf8'),
)

test('next official stage candidates are current-JP raw-bundle inventories', () => {
  assert.equal(manifest.releaseProfile, 'jp-android-3.13.0')
  assert.equal(manifest.unityVersion, '2022.3.62f2')
  assert.match(manifest.policy.rawBundleRole, /authoritative/)
  assert.match(manifest.policy.payloadPolicy, /do not copy large assets/)
  assert.match(manifest.policy.readinessBoundary, /does not mean deploy-safe/)
  assert.equal(manifest.candidates.length, 7)
})

test('candidate order preserves the source audit without claiming deploy parity', () => {
  assert.deepEqual(manifest.candidates.map(candidate => candidate.priority), [1, 2, 3, 4, 5, 6, 7])
  assert.equal(manifest.candidates[0].sceneId, '600_00_01_003')
  assert.equal(manifest.candidates[0].components.ParticleSystem ?? 0, 0)
  assert.equal(manifest.candidates[3].sceneId, '605_00_00_001')
  assert.equal(manifest.candidates[3].components.Light, 444)
  assert.equal(manifest.candidates[3].components.MonoBehaviour, 545)
  assert.equal(manifest.candidates.at(-1).sceneId, '602_00_00_001')
  for (const candidate of manifest.candidates) {
    assert.ok(candidate.closureFileCount > 0)
    assert.ok(candidate.closureBytesJP > 0)
    assert.equal(candidate.directDependencyCount, candidate.directDependencies.length)
    assert.equal(candidate.closureFileCount, candidate.transitiveClosure.length)
    assert.match(candidate.manifestHash128, /^[0-9a-f]{32}$/)
    assert.match(candidate.jpRootSha256, /^[0-9a-f]{64}$/)
    assert.equal(candidate.jpRoot.exists, true)
    assert.equal(candidate.rootGameObjects[0].name, candidate.expectedRootGameObject)
    assert.equal(candidate.status, 'inventory-ready-not-deploy-safe')
    assert.match(candidate.reason, /.+/)
  }
})

test('candidate source evidence has reproducible identity', () => {
  for (const source of Object.values(manifest.sourceEvidence)) {
    assert.ok(manifest.sourceRoots[source.sourceRoot])
    assert.ok(source.artifact.length > 0)
    assert.ok(source.size > 0)
    assert.match(source.sha256, /^[0-9a-f]{64}$/)
  }
})
