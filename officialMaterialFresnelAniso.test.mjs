import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import ts from 'typescript'

const root = dirname(fileURLToPath(import.meta.url))
const sourcePath = join(root, 'magia-exedra-character-three', 'materialProfile.ts')
const runtimePath = join(root, `.official-material-profile-${process.pid}-${Date.now()}.mjs`)
const source = readFileSync(sourcePath, 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
})
writeFileSync(runtimePath, compiled.outputText, 'utf8')
const profiles = await import(pathToFileURL(runtimePath).href)
after(() => rmSync(runtimePath, { force: true }))

const general = readFileSync(
  join(root, 'magia-exedra-character-three', 'shaders', 'general.ts'),
  'utf8',
)
const stylization = readFileSync(
  join(root, 'magia-exedra-character-three', 'shaders', 'stylization.ts'),
  'utf8',
)
const gem = readFileSync(
  join(root, 'magia-exedra-character-three', 'shaders', 'gem.ts'),
  'utf8',
)
const gemExtension = readFileSync(
  join(root, 'magia-exedra-character-three', 'shaders', 'gemExtension.ts'),
  'utf8',
)
const cameraDepth = readFileSync(
  join(root, 'magia-exedra-character-three', 'scene', 'cameraDepth.ts'),
  'utf8',
)

test('100101/100107 shared body Aniso uses exact current-JP material values', () => {
  const value = profiles.getOfficialMaterialProfile('mt_chara_100101_body_Aniso')
  assert.equal(value.source, 'official-export')
  assert.equal(value.anisotropy, true)
  assert.equal(value.anisotropyProfile.enabled, true)
  assert.equal(value.anisotropyProfile.maskByMetallic, false)
  assert.deepEqual(value.anisotropyProfile.color, [
    0.7519999742507935,
    0.2753385901451111,
    0.4024481475353241,
  ])
  assert.equal(value.anisotropyProfile.threshold, 0.9139999747276306)
  assert.equal(value.anisotropyProfile.feather, 0)
})

test('100101 weapon Soul Gem uses exact material Fresnel defaults', () => {
  const value = profiles.getOfficialMaterialProfile('mt_chara_100101_weapon_a_sj')
  assert.equal(value.fresnel.enabled, true)
  assert.equal(value.fresnel.maskByMetallic, true)
  assert.deepEqual(value.fresnel.color, [1, 0.5047169923782349, 0.9053794741630554])
  assert.equal(value.fresnel.threshold, 0.6000000238418579)
  assert.equal(value.fresnel.feather, 0.20000000298023224)
  assert.equal(value.gem.useDepthDiff, true)
  assert.equal(value.gem.maskMatcapMetallic, true)
})

test('per-material uniforms override the global debug Fresnel without enabling it globally', () => {
  assert.match(gem, /uFresnelMaskByMetallic/)
  assert.match(gem, /fresnel\.enabled \? 1 : 0/)
  assert.match(stylization, /uFresnelMaskByMetallic/)
  assert.match(stylization, /rdToonMetallicMask/)
  assert.match(general, /uMaterialAnisoColor/)
  assert.match(general, /uMaterialAnisoThreshold/)
  assert.match(general, /rdAnisoBand/)
  assert.match(general, /directional coordinate remains the current/)
})

test('GemDepthDiff removes executable NdotV proxy code and pins recovered JP predicate/threshold arithmetic', () => {
  assert.doesNotMatch(gem, /float\s+rdGemDepthProxy\s*=/)
  assert.match(gem, /uGemUseDepthDiff == 0\.0/)
  assert.match(gem, /uGemTransparency == 0\.0/)
  assert.match(gem, /uRdCameraDepthEnabled < 0\.5/)
  assert.match(gem, /currentEye - 0\.00999999978/)
  assert.match(gem, /depthDifference \* 5\.0/)
  assert.match(gem, /1\.0 - uGemDepthDiffThreshold/)
  assert.match(gem, /depthDifference >= threshold \? 0\.0 : 1\.0/)
  assert.match(gem, /shader\.uniforms\.uGemTransparency \?\?= \{ value: 0 \}/)
  assert.match(gem, /runtime _Transparency MaterialPropertyBlock|Timeline\/MPB source/)
})

test('GemDepthDiff depth producer is requested only by a proven depth-diff profile', () => {
  assert.match(gemExtension, /profile\.gem\.enabled && profile\.gem\.useDepthDiff/)
  assert.match(gemExtension, /requestReDriveCameraDepth\(\)/)
  assert.match(gemExtension, /official-gem-v4-depthdiff/)
})

test('camera-depth transport stays explicitly approximate and unbinds its attachment while writing', () => {
  assert.match(cameraDepth, /formulaFidelity: 'exact'/)
  assert.match(cameraDepth, /transportFidelity: 'web-depth-transport-approximation'/)
  assert.match(cameraDepth, /runtime _Transparency MaterialPropertyBlock\/attribute receiver/)
  assert.match(
    cameraDepth,
    /reDriveCameraDepthUniformState\.enabled\.value = 0\s+reDriveCameraDepthUniformState\.map\.value = null/,
  )
  assert.match(
    cameraDepth,
    /renderer\.setRenderTarget\(oldTarget\)\s+reDriveCameraDepthUniformState\.map\.value = oldMap/,
  )
})
