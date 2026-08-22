import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const stageId = 'battle-600-00-01-001'
const stageRoot = `public/stages/official/${stageId}`
const catalog = JSON.parse(readFileSync('public/stages/catalog.json', 'utf8'))
const stage = catalog.stages.find((entry) => entry.id === stageId)
const profile = JSON.parse(readFileSync(`${stageRoot}/scene-profile.json`, 'utf8'))
const lightmaps = JSON.parse(readFileSync(`${stageRoot}/lightmap-bindings.json`, 'utf8'))
const uv1 = JSON.parse(readFileSync(`${stageRoot}/uv1-companion.json`, 'utf8'))

test('600-001 selects the generated official scene profile over catalog fallback values', () => {
  assert.equal(
    stage.sceneProfileUrl,
    `./stages/official/${stageId}/scene-profile.json`,
  )
  assert.equal(profile.schemaVersion, 1)
  assert.equal(profile.stageId, stageId)
  assert.deepEqual(profile.coordinateSpace, {
    source: 'unity-world',
    viewer: 'assetstudio-fbx-reflect-x',
  })
  assert.equal(profile.renderProfile.lights.length, 9)
  assert.equal(
    profile.renderProfile.lights.find((light) => light.name === 'MainLight')
      .lightmapping,
    1,
  )
  assert.equal(
    profile.renderProfile.lights.find((light) => light.name === 'BgFillLight')
      .lightmapping,
    2,
  )
})

test('600-001 restores exact BC6H lightmap data and all automated renderer joins', () => {
  assert.deepEqual(profile.renderProfile.lightmap, {
    bindingsUrl: `./stages/official/${stageId}/lightmap-bindings.json`,
    encoding: 'unity-bc6h-linear',
    intensity: 1,
    textureUrl: `./stages/official/${stageId}/Lightmap-0_comp_light-bc6h.dds`,
    uv1CompanionUrl: `./stages/official/${stageId}/uv1-companion.json`,
  })
  assert.equal(lightmaps.schemaVersion, 1)
  assert.equal(lightmaps.encoding, 'unity-bc6h-linear')
  assert.equal(lightmaps.renderers.length, 77)
  assert.equal(
    new Set(lightmaps.renderers.map((entry) => entry.rendererHierarchyPath)).size,
    77,
  )
  assert.deepEqual(profile.sourceRecords.lightmapAutomation.bindingFailures, [])
  assert.deepEqual(profile.sourceRecords.lightmapAutomation.textureFailures, [])
  assert.deepEqual(profile.sourceRecords.lightmapAutomation.uv1Failures, [])
  assert.equal(uv1.schemaVersion, 4)
  assert.equal(uv1.stageId, stageId)
  assert.equal(uv1.mappedMeshCount, 134)
  assert.equal(uv1.nodes.length, 134)

  const dds = readFileSync(`${stageRoot}/Lightmap-0_comp_light-bc6h.dds`)
  assert.equal(dds.toString('ascii', 0, 4), 'DDS ')
  assert.equal(dds.toString('ascii', 84, 88), 'DX10')
  assert.equal(dds.readUInt32LE(128), 95, 'DXGI_FORMAT_BC6H_UF16')
  assert.equal(dds.readUInt32LE(16), 1024)
  assert.equal(dds.readUInt32LE(12), 1024)
  assert.equal(dds.readUInt32LE(28), 11)
})

test('600-001 restores the official BC6H reflection environment and renderer usage', () => {
  assert.equal(
    profile.renderProfile.environmentTextureUrl,
    `./stages/official/${stageId}/ReflectionProbe-0-bc6h.dds`,
  )
  assert.equal(profile.renderProfile.environmentEncoding, 'unity-bc6h-uf16')
  assert.equal(profile.renderProfile.reflectionProbeBindings.length, 134)
  assert.deepEqual(profile.sourceRecords.rendererReflectionProbeFailures, [])

  const dds = readFileSync(`${stageRoot}/ReflectionProbe-0-bc6h.dds`)
  assert.equal(dds.toString('ascii', 0, 4), 'DDS ')
  assert.equal(dds.toString('ascii', 84, 88), 'DX10')
  assert.equal(dds.readUInt32LE(128), 95, 'DXGI_FORMAT_BC6H_UF16')
  assert.equal(dds.readUInt32LE(136), 4, 'DDS_RESOURCE_MISC_TEXTURECUBE')
  assert.equal(dds.readUInt32LE(16), 64)
  assert.equal(dds.readUInt32LE(28), 7)
})

test('600-001 uses serialized BgUber fields instead of the old posterized material guess', () => {
  const ground = profile.materialBindings.find(
    (binding) => binding.materialName === 'mt_bg3d600A_01_01_ground',
  )
  assert.equal(ground.sourceShader, 'Creative/Bg/BgUberShader')
  assert.deepEqual(ground.validKeywords, [
    '_METALLICSPECGLOSSMAP',
    '_VERTEX_COLOR_BLEND',
  ])
  assert.equal(ground.vertexColorBlend, true)
  assert.equal(ground.metallicFromSmoothnessMap, true)
  assert.equal(ground.smoothness, 0.699999988079071)
  assert.equal(ground.metallic, 0.16599999368190765)
  assert.equal(ground.normalScale, 2)
  assert.equal(ground.receiveShadow, true)
  assert.equal(ground.castShadow, false)
  assert.equal(ground.textures.base.evidence, 'exact-unity-texture2d')
  assert.equal(ground.textures.normal.colorSpace, 'linear')
  assert.equal(ground.textures.smoothness.colorSpace, 'linear')
})

test('600-001 public product excludes rejected LDR and RGBM approximations', () => {
  for (const name of [
    'Lightmap-0_comp_light.REJECTED_LDR.png',
    'lightmap-bindings.REJECTED_RGBM.json',
    'scene-profile.REJECTED_RGBM.json',
  ]) {
    assert.equal(existsSync(`${stageRoot}/${name}`), false, name)
  }
})
