import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = dirname(fileURLToPath(import.meta.url))
const script = join(root, 'scripts', 'extract-official-stage-raw-truth.py')

function run(args) {
  return spawnSync('python', [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })
}

test('describe-only resolves the priority-2 JP candidate without opening bundles', () => {
  const result = run(['--scene-id', '600_01_00_001', '--describe-only'])
  assert.equal(result.status, 0, result.stderr)
  const description = JSON.parse(result.stdout)
  assert.equal(description.releaseProfile, 'jp-android-3.13.0')
  assert.equal(description.unityVersion, '2022.3.62f2')
  assert.equal(description.stageId, 'battle-600-01-00-001')
  assert.equal(description.bundle, 'battle/stage/bg_3d_600_01_00_001')
  assert.equal(description.expectedRootGameObject, 'bg_3d_600_01_00_001')
  assert.equal(description.manifestKey, 11310)
  assert.equal(description.manifestHash128, 'e6339b15722a9c63ba00a8bad43270f0')
  assert.equal(description.directDependencies.length, 12)
  assert.equal(description.closureFileCount, 13)
  assert.equal(description.closureBytes, 16309195)
  assert.equal(description.rootBytes, 2802466)
  assert.equal(description.rootSha256, '7b5ec33cf1a3ed9b5f1cf422b1965c23dfc4f9b992034bbda122c402e019ee25')
})

test('unknown scene identifiers fail closed', () => {
  const result = run(['--scene-id', '999_99_99_999', '--describe-only'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /matches=0/)
})

test('full extraction requires an explicit output boundary', () => {
  const result = run(['--scene-id', '600_01_00_001'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /--out is required/)
})
