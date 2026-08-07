import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import ts from 'typescript'

const root = dirname(fileURLToPath(import.meta.url))
const sourcePath = join(root, 'src', 'viewer', 'stageBundleProvenance.ts')
const runtimePath = join(root, `.stage-bundle-multi-manifest-${process.pid}-${Date.now()}.mjs`)
const compiled = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
})
writeFileSync(runtimePath, compiled.outputText, 'utf8')
const api = await import(pathToFileURL(runtimePath).href)
after(() => rmSync(runtimePath, { force: true }))

test('TW provenance retains all normalized root/text manifest sources', () => {
  const value = api.normalizeStageBundleProvenance({
    rootBundle: 'field/bg/tw-stage',
    manifest: {
      region: 'tw',
      kind: 'text-manifest',
      path: 'AssetBundles\\manifest-a.manifest',
      sha256: 'AA'.repeat(32),
    },
    manifestSources: [
      {
        region: 'tw',
        kind: 'text-manifest',
        path: 'AssetBundles/manifest-a.manifest',
        sha256: 'aa'.repeat(32),
      },
      {
        region: 'tw',
        kind: 'text-manifest',
        path: 'AssetBundles/manifest-b.manifest',
        sha256: 'BB'.repeat(32),
      },
    ],
    directDependencies: ['shaders/common'],
    dependencyClosure: ['shaders/common'],
  })
  assert.equal(value.manifestSources.length, 2)
  assert.equal(value.manifestSources[0].path, 'AssetBundles/manifest-a.manifest')
  assert.equal(value.manifestSources[1].sha256, 'bb'.repeat(32))
})

test('one stage provenance cannot mix JP and TW manifest sources', () => {
  assert.throws(() => api.validateStageBundleProvenance({
    rootBundle: 'field/bg/tw-stage',
    manifest: { region: 'tw', kind: 'text-manifest' },
    manifestSources: [
      { region: 'jp', kind: 'unity-assetbundle-manifest' },
    ],
  }), /mixed regions/)
})
