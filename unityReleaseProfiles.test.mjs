import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = dirname(fileURLToPath(import.meta.url))
const manifestPath = join(root, 'research', 'unity-release-profiles.json')
const resolverPath = join(root, 'scripts', 'resolve-unity-release-profile.py')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

test('current client releases use explicit JP f2 and TW f3 profiles', () => {
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.policy.requireExplicitProfile, true)
  assert.equal(manifest.policy.unknownProfile, 'reject')
  assert.equal(manifest.profiles['jp-android-3.13.0'].unityVersion, '2022.3.62f2')
  assert.equal(manifest.profiles['jp-steam-24586478'].unityVersion, '2022.3.62f2')
  assert.equal(manifest.profiles['tw-android-1.1.2'].unityVersion, '2022.3.62f3')
  assert.equal(manifest.profiles['legacy-unclassified-2022.3.21f1'].selectable, false)
  for (const profile of Object.values(manifest.profiles).filter(value => value.selectable !== false)) {
    assert.match(profile.unityVersion, /^2022\.3\.62f[23]$/)
    assert.ok(profile.evidence.length > 0)
    for (const evidence of profile.evidence) {
      assert.ok(manifest.sourceRoots[evidence.sourceRoot])
      assert.ok(evidence.size > 0)
      assert.match(evidence.sha256, /^[0-9a-f]{64}$/)
      assert.ok(evidence.locator.length > 0)
      if (evidence.zipEntry) {
        assert.ok(evidence.zipEntry.size > 0)
        assert.match(evidence.zipEntry.sha256, /^[0-9a-f]{64}$/)
        assert.equal(evidence.zipEntry.expectedAscii, profile.unityVersion)
      }
    }
  }
})

test('profile resolver returns the selected version and rejects unknown releases', () => {
  const resolved = execFileSync('python', [resolverPath, '--profile', 'tw-android-1.1.2'], {
    cwd: root,
    encoding: 'utf8',
  }).trim()
  assert.equal(resolved, '2022.3.62f3')

  const rejected = spawnSync('python', [resolverPath, '--profile', 'tw-android'], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.notEqual(rejected.status, 0)
  assert.match(rejected.stderr, /unknown release profile/)

  const legacy = spawnSync('python', [resolverPath, '--profile', 'legacy-unclassified-2022.3.21f1'], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.notEqual(legacy.status, 0)
  assert.match(legacy.stderr, /evidence-only/)
})

test('legacy batch exporters no longer silently claim a current release version', () => {
  for (const file of ['export_models_battle.bat', 'export_models_dungeon.bat']) {
    const source = readFileSync(join(root, 'scripts', file), 'utf8')
    assert.match(source, /--unity-version/)
    assert.match(source, /UNITY_VERSION/)
    assert.match(source, /RELEASE_PROFILE/)
    assert.doesNotMatch(source, /set "RELEASE_PROFILE=legacy-unclassified/)
    assert.match(source, /RELEASE_PROFILE is required/)
  }
})
