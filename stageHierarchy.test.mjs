import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import * as THREE from 'three'
import ts from 'typescript'

const root = dirname(fileURLToPath(import.meta.url))
const sourcePath = join(root, 'src', 'viewer', 'stageHierarchy.ts')
const runtimePath = join(root, `.stage-hierarchy-${process.pid}-${Date.now()}.mjs`)
const compiled = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
})
writeFileSync(runtimePath, compiled.outputText, 'utf8')
const api = await import(pathToFileURL(runtimePath).href)
after(() => rmSync(runtimePath, { force: true }))

function makeTree() {
  const wrapper = new THREE.Group(); wrapper.name = 'AssetStudioWrapper'
  const prefab = new THREE.Group(); prefab.name = 'StageRoot'; wrapper.add(prefab)
  const a = new THREE.Group(); a.name = 'SectorA'; prefab.add(a)
  const b = new THREE.Group(); b.name = 'SectorB'; prefab.add(b)
  const lightA = new THREE.Group(); lightA.name = 'MainLight'; a.add(lightA)
  const lightB = new THREE.Group(); lightB.name = 'MainLight'; b.add(lightB)
  return { wrapper, lightA, lightB }
}

test('hierarchy path resolves the intended duplicate-named stage node', () => {
  const { wrapper, lightA, lightB } = makeTree()
  assert.equal(api.resolveStageHierarchyPath(wrapper, 'StageRoot/SectorA/MainLight'), lightA)
  assert.equal(api.resolveStageHierarchyPath(wrapper, 'StageRoot\\SectorB\\MainLight'), lightB)
})

test('anchorPath wins while legacy anchorNode remains a fallback', () => {
  const { wrapper, lightB } = makeTree()
  assert.equal(api.resolveStageAnchor(wrapper, {
    anchorPath: 'StageRoot/SectorB/MainLight',
    anchorNode: 'MainLight',
  }), lightB)
  assert.equal(api.resolveStageAnchor(wrapper, { anchorNode: 'MainLight' }).name, 'MainLight')
})

test('invalid hierarchy path does not loosely skip missing intermediate nodes', () => {
  const { wrapper } = makeTree()
  assert.equal(api.resolveStageHierarchyPath(wrapper, 'StageRoot/Unknown/MainLight'), undefined)
})
