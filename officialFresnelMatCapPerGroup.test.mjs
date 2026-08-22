import fs from 'node:fs'
import assert from 'node:assert/strict'

const general = fs.readFileSync(
  'magia-exedra-character-three/shaders/general.ts',
  'utf8',
)
const stylization = fs.readFileSync(
  'magia-exedra-character-three/shaders/stylization.ts',
  'utf8',
)
const gem = fs.readFileSync(
  'magia-exedra-character-three/shaders/gem.ts',
  'utf8',
)
const loader = fs.readFileSync(
  'magia-exedra-character-three/loader.ts',
  'utf8',
)

// main_hair blob 98 lines 788-808 and 911-924: the serialized Fresnel band
// receives the same scene-light/BaseWeight carrier as the native toon terms.
for (const token of [
  'float rdToonFresnelNdotV = saturate(dot(',
  '(1.0 - rdToonFresnelNdotV) *',
  'rdToonSceneLightColor *',
  '(rdToonBaseWeight * 0.800000012 + 0.200000003)',
  'rdToonFresnelSceneCarrier *',
  'uFresnelColor *',
  'rdToonFresnelMask *',
  'saturate(uFresnelEnabled)',
]) assert.ok(general.includes(token), `missing official Fresnel token: ${token}`)

assert.ok(
  general.indexOf('vec3 rdToonFresnelSceneCarrier') >
    general.indexOf('#ifdef HAS_SPECULAR_GRADIENT'),
  'Fresnel must follow the compiled SpecularGradient branch',
)
assert.doesNotMatch(
  stylization,
  /outgoingLight\s*\+=\s*uFresnelColor\s*\*/,
  'legacy lighting-independent Fresnel addition must stay removed',
)

// Every geometry draw group must bind both the scalar profile and the texture
// selected by that exact profile. This prevents Gem/Shoe slots inheriting the
// first compiled material's MatCap sampler.
assert.match(gem, /export function selectOfficialMatCap\s*\(/)
for (const token of [
  'gemResources?: OfficialGemResources',
  'const profile = slotProfiles[index] ?? slotProfiles[0]',
  'const matCap = selectOfficialMatCap(gemResources, profile)',
  'shader.uniforms.tGemMatCap.value = matCap ?? null',
  'officialGemResources = extension.resources',
  'officialGemResources,',
]) assert.ok(loader.includes(token), `missing per-group MatCap token: ${token}`)

const profileIndex = loader.indexOf(
  'const profile = slotProfiles[index] ?? slotProfiles[0]',
)
const scalarIndex = loader.indexOf(
  'setOfficialMaterialProfileUniforms(shader, profile)',
  profileIndex,
)
const textureIndex = loader.indexOf(
  'selectOfficialMatCap(gemResources, profile)',
  profileIndex,
)
assert.ok(
  profileIndex >= 0 && scalarIndex > profileIndex && textureIndex > scalarIndex,
  'draw group must select profile, scalar uniforms, then its MatCap texture',
)

console.log('official Fresnel carrier and per-group MatCap gate passed')
