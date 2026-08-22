import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const catalog = JSON.parse(readFileSync('public/stages/catalog.json', 'utf8'))
const gem = readFileSync('magia-exedra-character-three/shaders/gem.ts', 'utf8')
const gemExtension = readFileSync('magia-exedra-character-three/shaders/gemExtension.ts', 'utf8')
const loader = readFileSync('magia-exedra-character-three/loader.ts', 'utf8')
const stylization = readFileSync('magia-exedra-character-three/shaders/stylization.ts', 'utf8')
const general = readFileSync('magia-exedra-character-three/shaders/general.ts', 'utf8')
const officialGem = readFileSync(
  'artifacts/research/20260813-shader-reverse/official-shaders/main_gem__blob-95__FOG_LINEAR___MAIN_LIGHT_SHADOWS___MAIN_LIGHT_SHADOWS_CASCADE___ADDITIONAL_LIGHT_SHADOWS___USE_RIM_LIGHT___ISGEM.glsl',
  'utf8',
)

test('600-00-00-001 no longer stacks unverified character-brightening effects', () => {
  const stage = catalog.stages.find(stage => stage.id === 'battle-600-00-00-001')
  assert.ok(stage)
  assert.equal(stage.renderProfile.source, 'manual-research')
  assert.equal(stage.renderProfile.directionalLight.intensity, 0.85)
  assert.equal(stage.renderProfile.ambientLight.intensity, 0.4)
  assert.equal(stage.renderProfile.renderer.exposure, 0.85)
  assert.equal(stage.renderProfile.bloom.enabled, false)
  assert.equal(stage.renderProfile.reDriveVolume, undefined)
  assert.equal(stage.dynamic.status, 'pending')
})

test('MatCap uses exported texture and the official view-normal coordinates', () => {
  assert.match(gem, /profile\?\.matCap/)
  assert.match(gem, /resources\.matCaps\.get\(exactName\)/)
  assert.match(gem, /matcap_softmetallic/)
  assert.match(officialGem, /vs_TEXCOORD5\.xy/)
  assert.match(gem, /rdGemMatCapUv = vNormal\.xy \* 0\.5 \+ 0\.5/)
  assert.doesNotMatch(gem, /rdGemMatCapUv = rdGemNormalVs\.xy/)
  assert.doesNotMatch(gem, /rdGemMatCapX/)
  assert.match(gem, /rdGemHighlightCoordinateOne = saturate\(dot\([\s\S]*?rdGemNormalVs,[\s\S]*?rdGemHalfOneVs/)
  assert.match(gem, /rdGemHighlightCoordinateTwo = saturate\(dot\([\s\S]*?rdGemNormalVs,[\s\S]*?rdGemHalfTwoVs/)
  assert.match(gem, /rdGemLightVs = normalize\(rdToonCharacterLightDirection\)/)
  assert.doesNotMatch(gem, /rdGemLightVs = normalize\(rdToonMainLightDirection\)/)
  assert.match(gem, /rdGemHardHighlightMask = min\([\s\S]*?rdGemHighlightCoordinateOne[\s\S]*?rdGemHighlightCoordinateTwo/)
  assert.doesNotMatch(gem, /rdGemHardHighlightMask = min\([\s\S]*?rdGemCoordinateOne[\s\S]*?rdGemCoordinateTwo/)
  assert.match(gemExtension, /official-matcap-gem-v9/)
  assert.match(loader, /extendMaterialWithOfficialGem\([\s\S]*texturePathUrl/)
})

test('Control G drives the compiled RGB SpecularGradient Overlay', () => {
  assert.doesNotMatch(stylization, /rdToonMetalGradientPosition/)
  assert.match(general, /texture2D\([\s\S]*?tSpecularGradient[\s\S]*?\)\.rgb/)
  assert.match(general, /outgoingLight \* rdSpecularGradient \* 2\.0/)
  assert.match(general, /rdToonMetallicMask \* rdSpecularFresnelGate/)
  assert.doesNotMatch(general, /rdSpecularGradient = pow/)
  assert.doesNotMatch(general, /rdSpecular = min\(rdSpecular, 1\.5\)/)
})
