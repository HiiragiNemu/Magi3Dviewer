import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

export const textureAssetUrlImports = {
  './shaders/face_ctrl_base.png?url': '/magia-exedra-character-three/shaders/face_ctrl_base.png',
  './shaders/face_ctrl_nose.png?url': '/magia-exedra-character-three/shaders/face_ctrl_nose.png',
  './models/chara_100202_battle_unit/chara_100202_face_ctrl.png?url': '/magia-exedra-character-three/models/chara_100202_battle_unit/chara_100202_face_ctrl.png',
}
for (const url of Object.values(textureAssetUrlImports)) {
  const bytes = readFileSync(new URL('.' + url, import.meta.url))
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
}
const filename = 'magia-exedra-character-three/loadingProgress.ts'
const compiled = ts.transpileModule(readFileSync(new URL('./' + filename, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  fileName: filename, reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics ?? [], [])
const module = { exports: {} }
Function('exports', 'require', 'module', compiled.outputText)(module.exports, name => { throw Error('Unexpected loadingProgress import: ' + name) }, module)
export const actualLoadingProgress = module.exports
