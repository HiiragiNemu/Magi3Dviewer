import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = dirname(fileURLToPath(import.meta.url))
const evidence = JSON.parse(
  readFileSync(join(root, 'research', 'official-character-material-evidence.json'), 'utf8'),
)

test('official character evidence is tied to current-JP raw bundles and shader hashes', () => {
  assert.equal(evidence.releaseProfile, 'jp-android-3.13.0')
  assert.equal(evidence.unityVersion, '2022.3.62f2')
  assert.equal(evidence.sourceArtifacts.length, 4)
  assert.deepEqual(Object.keys(evidence.sourceRoots).sort(), [
    'compiled-shader-evidence',
    'jp-asset-root',
    'project-root',
  ])
  for (const source of evidence.sourceArtifacts) {
    assert.ok(source.artifact.length > 0)
    assert.ok(evidence.sourceRoots[source.sourceRoot])
    assert.ok(source.size > 0)
    assert.match(source.sha256, /^[0-9a-f]{64}$/)
  }
  assert.equal(evidence.supplementaryArtifacts.length, 5)
  for (const source of evidence.supplementaryArtifacts) {
    assert.ok(source.artifact.length > 0)
    assert.ok(evidence.sourceRoots[source.sourceRoot])
    assert.ok(source.size > 0)
    assert.match(source.sha256, /^[0-9a-f]{64}$/)
  }
  assert.equal(evidence.bundleLocalPPtrs.redriveToonShader.pathId, '7704691985981102055')
  assert.equal(evidence.bundleLocalPPtrs.softMetallicMatCap.pathId, '835141015512989441')
  assert.equal(evidence.bundleLocalPPtrs.angelRingMap.pathId, '2265012383630109063')
  assert.match(evidence.bundleLocalPPtrs.resolutionBoundary, /dependency table/)

  const ring = evidence.supplementaryArtifacts.find(source => source.id === 'official-angel-ring-map')
  const gradient = evidence.supplementaryArtifacts.find(
    source => source.id === 'official-metallic-gradient-map-export',
  )
  assert.deepEqual(ring.dimensions, [512, 512])
  assert.equal(ring.mode, 'RGBA')
  assert.deepEqual(gradient.dimensions, [256, 2])
  assert.equal(gradient.mode, 'RGBA')
})

test('hair and Soul Gem profiles retain exact raw saved properties', () => {
  const hair = evidence.materials.mt_chara_100101_hair
  assert.equal(hair.features.isHair, 1)
  assert.equal(hair.features.useDepthTex, 1)
  assert.equal(hair.features.depthRimLightDiffThreshold, 0.02)
  assert.equal(hair.features.depthShadowDiffThreshold, 0.03)
  assert.equal(hair.features.faceOutlineAdjust, 0.59)
  assert.equal(hair.textures.specularGradientMap, 'RDToon_metallic_gradient_map')

  const bodyGem = evidence.materials.mt_chara_100101_body_SJ
  assert.equal(bodyGem.features.isGem, 1)
  assert.equal(bodyGem.features.useMatCap, 1)
  assert.equal(bodyGem.features.matCapIntensity, 2)
  assert.equal(bodyGem.features.useGemDepthDiff, 0)

  const weaponGem = evidence.materials.mt_chara_100101_weapon_a_sj
  assert.equal(weaponGem.features.useGemDepthDiff, 1)
  assert.equal(weaponGem.features.useFresnel, 1)
})

test('footwear-related highlight is property-driven rather than keyword or name-only', () => {
  const socks = evidence.materials.mt_chara_101901_body_Socks
  assert.equal(socks.features.isAniso, 1)
  assert.equal(socks.features.useFresnel, 1)
  assert.equal(socks.features.anisoThreshold, 1)
  assert.equal(socks.features.anisoFeather, 0.292)
  assert.match(socks.semanticBoundary, /does not identify every covered triangle/)

  const aniso = evidence.materials.mt_chara_100101_body_Aniso
  assert.equal(aniso.features.isAniso, 1)
  assert.match(aniso.activationNote, /keyword is absent/)
})

test('compiled formula records remain exact-evidence only and preserve fallback boundary', () => {
  assert.match(evidence.compiledShaderFacts.hair.sourceSha256, /^[0-9a-f]{64}$/)
  assert.match(evidence.compiledShaderFacts.gem.sourceSha256, /^[0-9a-f]{64}$/)
  assert.match(evidence.compiledShaderFacts.aniso.sourceSha256, /^[0-9a-f]{64}$/)
  assert.match(evidence.compiledShaderFacts.outline.sourceSha256, /^[0-9a-f]{64}$/)
  for (const fact of Object.values(evidence.compiledShaderFacts)) {
    assert.match(fact.artifact, /\.glsl$/)
    assert.equal(fact.sourceRoot, 'compiled-shader-evidence')
    assert.ok(fact.size > 0)
  }
  assert.equal(evidence.compiledShaderFacts.outline.serializedPassState.passName, 'ReDriveToonOutlinePass')
  assert.equal(evidence.compiledShaderFacts.outline.serializedPassState.culling, 1)
  assert.match(evidence.compiledShaderFacts.outline.serializedPassState.interpretation, /Cull Front/)
  assert.match(evidence.implementationPolicy.fallback, /compatibility fallbacks/)
  assert.match(evidence.implementationPolicy.forbiddenClaim, /triangle-level material mapping/)
})
