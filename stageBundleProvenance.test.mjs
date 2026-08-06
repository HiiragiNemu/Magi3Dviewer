import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import ts from 'typescript'

const repositoryRoot = dirname(fileURLToPath(import.meta.url))
const sourcePath = join(repositoryRoot, 'src', 'viewer', 'stageBundleProvenance.ts')
const runtimePath = join(repositoryRoot, `.stage-bundle-provenance-${process.pid}-${Date.now()}.mjs`)
const source = readFileSync(sourcePath, 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourcePath,
})
writeFileSync(runtimePath, compiled.outputText, 'utf8')
const api = await import(pathToFileURL(runtimePath).href)

after(() => rmSync(runtimePath, { force: true }))

test('resolves an exact deterministic dependency closure', () => {
  const index = {
    schemaVersion: 1,
    source: {
      path: 'gamedata/AssetBundles/Android',
      sha256: '1'.repeat(64),
      format: 'UnityFS AssetBundleManifest',
    },
    bundles: [
      { name: 'battle/stage/root', directDependencies: ['shared/material', 'shared/light'] },
      { name: 'shared/material', directDependencies: ['shared/texture'] },
      { name: 'shared/light', directDependencies: ['shared/texture'] },
      { name: 'shared/texture', directDependencies: [] },
    ],
  }
  assert.deepEqual(
    api.resolveBundleDependencyClosure(index, 'battle/stage/root'),
    ['shared/light', 'shared/material', 'shared/texture'],
  )
})

test('normalizes provenance without allowing root duplication', () => {
  const value = api.normalizeStageBundleProvenance({
    rootBundle: '\\battle\\stage\\root\\',
    manifest: {
      region: 'jp',
      kind: 'unity-assetbundle-manifest',
      path: 'gamedata\\AssetBundles\\Android',
      sha256: 'AB'.repeat(32),
    },
    directDependencies: ['shared\\material', 'shared/material'],
    dependencyClosure: ['shared/material', 'shared/texture'],
  })
  assert.equal(value.rootBundle, 'battle/stage/root')
  assert.equal(value.manifest.path, 'gamedata/AssetBundles/Android')
  assert.equal(value.manifest.sha256, 'ab'.repeat(32))
  assert.deepEqual(value.directDependencies, ['shared/material'])
})

test('rejects a provenance root that disagrees with the stage catalog', () => {
  assert.throws(
    () => api.validateStageBundleProvenance({
      rootBundle: 'battle/stage/a',
      manifest: { region: 'tw', kind: 'text-manifest' },
    }, 'battle/stage/b'),
    /root mismatch/,
  )
})

test('rejects cycles and missing dependencies in manifest graphs', () => {
  assert.throws(
    () => api.resolveBundleDependencyClosure({
      schemaVersion: 1,
      source: { path: 'Android', sha256: '0'.repeat(64), format: 'UnityFS AssetBundleManifest' },
      bundles: [
        { name: 'a', directDependencies: ['b'] },
        { name: 'b', directDependencies: ['a'] },
      ],
    }, 'a'),
    /cycle/,
  )
  assert.throws(
    () => api.resolveBundleDependencyClosure({
      schemaVersion: 1,
      source: { path: 'Android', sha256: '0'.repeat(64), format: 'UnityFS AssetBundleManifest' },
      bundles: [{ name: 'a', directDependencies: ['missing'] }],
    }, 'a'),
    /Unknown AssetBundle dependency/,
  )
})
