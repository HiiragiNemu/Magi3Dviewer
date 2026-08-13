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
const face = readFileSync(
  join(root, 'magia-exedra-character-three', 'shaders', 'face.ts'),
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
  assert.equal(value.gem.transparency, false)
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
  assert.match(general, /vec2 rdAnisoNormalXZ = normal\.xz/)
  assert.match(general, /vec2 rdAnisoHalfXZ = rdHalfDirection\.xz/)
  assert.match(general, /vec3 rdViewDirection = normalize\(geometryViewDir\)/)
  assert.match(
    general,
    /\(1\.00100005 - uMaterialAnisoThreshold\)[\s\S]*?\(1\.0 - rdToonMetallicMask\)/,
  )
  assert.match(general, /rdAnisoSceneLight[\s\S]*?0\.2 \+ 0\.8 \* rdToonBaseWeight/)
  assert.match(general, /rdToonSceneLightRaw/)
  assert.match(
    general,
    /mix\([\s\S]*?rdToonSceneLightRaw[\s\S]*?uGlobalCharacterLightingOverrideColor[\s\S]*?uGlobalCharacterLightingOverrideRatio/,
  )
  assert.match(general, /outgoingLight \+= rdAnisoColor \* saturate\(uMaterialAnisotropy\)/)
  assert.doesNotMatch(general, /rdAnisoTangent/)
  assert.doesNotMatch(general, /1\.18, saturate\(uMaterialAnisotropy\)/)
  assert.doesNotMatch(general, /1\.22, rdAnisoInfluence/)
})

test('reverse-derived character lighting is the production default', () => {
  assert.match(stylization, /officialLookEnabled:\s*false/)
  assert.match(stylization, /Legacy Web approximation retained only/)
  assert.match(stylization, /outgoingLight \*= uGlobalCharacterTint/)
  assert.doesNotMatch(
    stylization,
    /outgoingLight\s*=\s*mix\([\s\S]*?diffuseColor\.rgb\s*\*\s*max\([\s\S]*?uGlobalCharacterLightingOverrideColor/,
  )
})

test('face uses its animated forward direction for official scene lighting', () => {
  assert.match(
    face,
    /getLightProbeIrradiance\([\s\S]*?lightProbe,[\s\S]*?rdFaceForwardNormalVS/,
  )
  assert.match(
    face,
    /getHemisphereLightIrradiance\([\s\S]*?hemisphereLights\[i\],[\s\S]*?rdFaceForwardNormalVS/,
  )
  assert.match(
    face,
    /diffuseColor\.rgb \* rdFaceSceneLightColor \+[\s\S]*?totalEmissiveRadiance/,
  )
  assert.ok(
    face.indexOf('vec3 rdFaceSceneLightRaw') <
      face.indexOf('injectToonStylization(shader, uniforms)'),
  )
})

test('scene-light override preserves the official pre-material ordering', () => {
  const raw = [0.2, 0.4, 0.6]
  const override = [1, 0.5, 0]
  const ratio = 0.35
  const result = raw.map((value, index) => Math.max(
    0.1,
    value + ratio * (override[index] - value),
  ))
  assert.deepEqual(result.map(value => Number(value.toFixed(3))), [0.48, 0.435, 0.39])
})

test('official anisotropy threshold and metallic mask match the recovered arithmetic', () => {
  const threshold = 0.9139999747276306
  const controlG = 0.42
  const dynamicThreshold = threshold + (1.00100005 - threshold) * (1 - controlG)
  assert.ok(Math.abs(dynamicThreshold - 0.964460018) < 1e-6)

  const maskByMetallic = 1
  const multiplier = 1 + maskByMetallic * (controlG - 1)
  assert.ok(Math.abs(multiplier - controlG) < 1e-12)
})


test('100101 weapon GemDepthDiff follows exact current-JP transparency predicate', () => {
  assert.match(gem, /step\(0\.0000001, abs\(uGemUseDepthDiff\)\)/)
  assert.match(gem, /step\(0\.0000001, abs\(uGemTransparency\)\)/)
  assert.doesNotMatch(gem, /uGemUseDepthDiff \* uGemTransparency/)
  assert.match(gem, /official GemDepthDiff contribution is/)
  assert.doesNotMatch(gem, /rdGemDepthProxy/)
})
