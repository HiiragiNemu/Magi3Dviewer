import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = dirname(fileURLToPath(import.meta.url))
const checkedInPath = join(root, 'research', 'official-stage-deployment-queue.json')
const manifest = JSON.parse(readFileSync(checkedInPath, 'utf8'))

test('official stage deployment queue preserves audited order and fails closed', () => {
  assert.equal(manifest.releaseProfile, 'jp-android-3.13.0')
  assert.equal(manifest.unityVersion, '2022.3.62f2')
  assert.equal(manifest.summary.entryCount, 7)
  assert.equal(manifest.summary.readyForDeployment, 0)
  assert.equal(manifest.summary.pendingRawTruth, 7)
  assert.deepEqual(
    manifest.queue.map(entry => entry.sceneId),
    [
      '600_00_01_003',
      '600_01_00_001',
      '604_00_00_001',
      '605_00_00_001',
      '601_00_00_001',
      '601_00_01_001',
      '602_00_00_001',
    ],
  )
  for (const entry of manifest.queue) {
    assert.equal(entry.readyForDeployment, false)
    assert.equal(entry.nextAction, 'extract-and-verify-raw-component-truth')
    assert.ok(entry.gates.some(gate => gate.status === 'pending-raw-truth'))
  }
})

test('queue contains references and gate evidence, not copied payload paths', () => {
  assert.match(manifest.policy.payload, /references only/)
  const serialized = JSON.stringify(manifest)
  assert.doesNotMatch(serialized, /\.fbx|\.glb|\.png|data:[^,]+,|base64/i)
  for (const entry of manifest.queue) {
    assert.ok(entry.closureReference.fileCount > 0)
    assert.equal(entry.closureReference.fileCount, entry.closureReference.names.length)
    assert.match(entry.rawRootIdentity.jpSha256, /^[0-9a-f]{64}$/)
    assert.ok(entry.gates.some(gate => gate.id === 'material-texture-pptr'))
    assert.ok(entry.gates.some(gate => gate.id === 'external-chrome-visual-regression'))
  }
})

test('queue generator reproduces the checked-in manifest exactly', () => {
  const tempPath = join(root, 'research', '.official-stage-deployment-queue.test.json')
  try {
    execFileSync(
      'python',
      [
        join(root, 'scripts', 'build-official-stage-queue.py'),
        '--input',
        join(root, 'research', 'next-official-stage-candidates.json'),
        '--out',
        tempPath,
      ],
      { cwd: root, stdio: 'pipe' },
    )
    assert.equal(readFileSync(tempPath, 'utf8'), readFileSync(checkedInPath, 'utf8'))
  } finally {
    rmSync(tempPath, { force: true })
  }
})
