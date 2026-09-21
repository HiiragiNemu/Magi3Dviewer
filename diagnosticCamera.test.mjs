import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const sourcePath = 'magia-exedra-character-three/scene/diagnosticCamera.ts'
const scenePath = 'magia-exedra-character-three/scene/index.ts'

function loadDiagnosticCameraModule() {
  const result = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
    reportDiagnostics: true,
  })
  assert.deepEqual(result.diagnostics ?? [], [])
  const module = { exports: {} }
  Function('exports', 'require', 'module', result.outputText)(
    module.exports,
    () => { throw new Error('diagnostic camera parser has no imports') },
    module,
  )
  return module.exports
}

const { readDiagnosticCameraInitialState } = loadDiagnosticCameraModule()

test('diagnostic camera vectors require an explicit diagnostic session', () => {
  assert.equal(
    readDiagnosticCameraInitialState(
      '?diagnosticCameraPosition=1,2,3&diagnosticCameraTarget=4,5,6',
    ),
    undefined,
  )
})

test('diagnostic camera vectors accept finite generic triples only', () => {
  assert.deepEqual(
    readDiagnosticCameraInitialState(
      '?diagnostic=gem-view-angle'
      + '&diagnosticCameraPosition=0.65,1.23,0.05'
      + '&diagnosticCameraTarget=0,1.23,0',
    ),
    {
      diagnostic: 'gem-view-angle',
      position: [0.65, 1.23, 0.05],
      target: [0, 1.23, 0],
    },
  )
  assert.equal(
    readDiagnosticCameraInitialState(
      '?diagnostic=gem-view-angle&diagnosticCameraPosition=1,NaN,3',
    ),
    undefined,
  )
  assert.equal(
    readDiagnosticCameraInitialState(
      '?diagnostic=gem-view-angle&diagnosticCameraPosition=1,2,3,4',
    ),
    undefined,
  )
})

test('scene applies only initial vectors and keeps orbit and zoom unrestricted', () => {
  const scene = readFileSync(scenePath, 'utf8')
  assert.match(scene, /readDiagnosticCameraInitialState\(\s*window\.location\.search/)
  assert.match(scene, /this\.camera\.position\.set\(\.\.\.diagnosticCamera\.position\)/)
  assert.match(scene, /this\.controls\.target\.set\(\.\.\.diagnosticCamera\.target\)/)
  assert.match(scene, /orbitUnrestricted:[\s\S]*?minPolarAngle === 0[\s\S]*?maxPolarAngle === Math\.PI[\s\S]*?minDistance === 0[\s\S]*?maxDistance === Infinity/)
  assert.doesNotMatch(
    scene,
    /diagnosticCamera[\s\S]{0,500}controls\.(?:min|max)(?:PolarAngle|Distance)\s*=(?!=)/,
  )
})
