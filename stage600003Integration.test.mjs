import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import test from 'node:test'

const stageId = 'battle-600-00-01-003'
const stageRoot = `public/stages/official/${stageId}`
const catalogPath = `public/stages/catalog/${stageId}.json`
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function pngSize(path) {
  const bytes = readFileSync(path)
  assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG')
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}
test('600-003 is registered once with the audited JP bundle identity', () => {
  const root = JSON.parse(readFileSync('public/stages/catalog.json', 'utf8'))
  assert.equal(
    root.entries.filter((entry) => entry === `./stages/catalog/${stageId}.json`).length,
    1,
  )
  assert.equal(catalog.id, stageId)
  assert.equal(catalog.type, 'fbx')
  assert.equal(catalog.assetBundleName, 'battle/stage/bg_3d_600_00_01_003')
  assert.equal(catalog.bundleProvenance.unityVersion, '2022.3.62f2')
  assert.equal(catalog.bundleProvenance.manifestTargetId, 10992)
  assert.equal(catalog.bundleProvenance.manifestHash128BytesHex, '6b9b4bcb258eb5f3af8ba028d449cb68')
  assert.equal(catalog.bundleProvenance.manifest.sha256, 'c243499e1d304cc14cd1e0abe15f6992d71937e90365e89b03ecbf035cf7b3c8')
  assert.equal(catalog.bundleProvenance.closureEvidence.sha256, catalog.bundleProvenance.closureSha256)
  assert.equal(catalog.bundleProvenance.dependencyCount, 13)
  assert.equal(catalog.bundleProvenance.closureFileCount, 14)
  assert.equal(catalog.bundleProvenance.closureBytes, 17_769_135)
  assert.equal(
    catalog.bundleProvenance.sourceBundleSha256,
    '827d8fe45f0b345a544de09982a0737146832021c080ed48deb9c618472db5e4',
  )
  assert.equal(catalog.restorationStatus.aggregateCatalogChanged, false)
  assert.match(
    readFileSync(`${stageRoot}/bg_3d_600_00_01_003-animated.fbxdata`)
      .subarray(0, 20)
      .toString('ascii'),
    /^Kaydara FBX Binary/,
  )
})
test('600-003 runtime package reopens with exact hashes and byte total', () => {
  const entries = Object.entries(catalog.packageEvidence.files)
  assert.equal(entries.length, catalog.packageEvidence.fileCount)
  let bytes = 0
  for (const [name, expectedHash] of entries) {
    const path = `${stageRoot}/${name}`
    assert.equal(existsSync(path), true, `missing ${name}`)
    assert.equal(sha256(path), expectedHash, `hash drift: ${name}`)
    bytes += statSync(path).size
  }
  assert.equal(bytes, catalog.packageEvidence.totalBytes)
})
test('600-003 package contains exactly the isolated 20-file product and no raw bundles', () => {
  const diskFiles = readdirSync(stageRoot).sort()
  const declaredFiles = Object.keys(catalog.packageEvidence.files).sort()
  assert.deepEqual(diskFiles, declaredFiles)
  assert.equal(diskFiles.length, 20)
  assert.equal(catalog.packageEvidence.totalBytes, 29_038_236)
  assert.equal(diskFiles.some((name) => name.includes('unitypy')), false)
  const provenance = JSON.parse(readFileSync(`${stageRoot}/asset-provenance.json`, 'utf8'))
  assert.equal(provenance.networkUsed, false)
  assert.equal(provenance.sourceBundlesCopied, false)
  assert.equal(provenance.transport.publicAssetsContainRawBundles, false)
  assert.deepEqual(pngSize(`${stageRoot}/Lightmap-0_comp_light.png`), [512, 512])
  assert.deepEqual(pngSize(`${stageRoot}/ReflectionProbe-0-equirectangular.png`), [256, 128])
})
test('600-003 UV1 and RGBM lightmap sidecars close all 128 renderers strictly', () => {
  const uv1 = JSON.parse(readFileSync(`${stageRoot}/uv1-companion.json`, 'utf8'))
  const lightmaps = JSON.parse(readFileSync(`${stageRoot}/lightmap-bindings.json`, 'utf8'))
  assert.equal(uv1.schemaVersion, 3)
  assert.equal(uv1.status, 'verified-runtime')
  assert.equal(uv1.threeRevision, 'r182')
  assert.equal(uv1.mappedMeshCount, 128)
  assert.equal(uv1.nodes.length, 128)
  assert.equal(new Set(uv1.nodes.map((node) => node.hierarchyPath)).size, 128)
  assert.equal(Object.keys(uv1.geometries).length, 77)
  for (const [key, geometry] of Object.entries(uv1.geometries)) {
    const bytes = Buffer.from(geometry.uv1Base64, 'base64')
    assert.equal(bytes.length, geometry.vertexCount * 2 * 4, `UV1 byte length: ${key}`)
    assert.equal(key, `${geometry.vertexCount}:${geometry.uv1Sha256}`)
  }
  for (const node of uv1.nodes) {
    assert.ok(uv1.geometries[node.geometryKey], `UV1 geometry reference: ${node.hierarchyPath}`)
  }
  assert.equal(lightmaps.schemaVersion, 1)
  assert.equal(lightmaps.status, 'verified-runtime')
  assert.equal(lightmaps.encoding, 'unity-rgbm-linear')
  assert.equal(lightmaps.renderers.length, 128)
  assert.equal(new Set(lightmaps.renderers.map((entry) => entry.rendererHierarchyPath)).size, 128)
  assert.deepEqual(
    lightmaps.renderers.map((entry) => entry.rendererHierarchyPath).sort(),
    uv1.nodes.map((node) => node.hierarchyPath).sort(),
  )
  for (const entry of lightmaps.renderers) {
    assert.equal(entry.lightmapIndex, 0)
    assert.equal(entry.lightmapScaleOffset.length, 4)
    assert.equal(entry.lightmapScaleOffset.every(Number.isFinite), true)
  }
})
test('600-003 binds seven mesh materials with exact ground and Anthony operators', () => {
  const names = catalog.materialBindings.map((binding) => binding.materialName)
  assert.deepEqual(names, [
    'mt_bg3d600A_01_03_anthonyAlphaA',
    'mt_bg3d600A_01_03_anthonyAlphaB',
    'mt_bg3d600A_01_03_ground',
    'mt_bg3d600A_01_03_propAAlpha',
    'mt_bg3d600A_01_03_propBAlpha',
    'mt_bg3d600A_01_03_rockAlpha',
    'mt_bg3d600A_01_03_sky',
  ])
  assert.equal(names.includes('SkyBox_bg3d600A_01_01'), false)
  const ground = catalog.materialBindings.find((binding) => binding.materialName.endsWith('_ground'))
  assert.equal(ground.baseMapUrl, `./stages/official/${stageId}/bg3d600A_01_03_groundB_col.png`)
  assert.equal(ground.blendMapUrl, `./stages/official/${stageId}/bg3d600A_01_03_groundA_col.png`)
  assert.equal(ground.vertexColorBlend, true)
  assert.equal(ground.normalScale, 2)
  const anthonyA = catalog.materialBindings.find((binding) => binding.materialName.endsWith('anthonyAlphaA'))
  const anthonyB = catalog.materialBindings.find((binding) => binding.materialName.endsWith('anthonyAlphaB'))
  assert.deepEqual(anthonyA.atlas, { columns: 6, rows: 3, offset: 0, framesPerSecond: 8 })
  assert.deepEqual(anthonyB.atlas, { columns: 6, rows: 3, offset: 3, framesPerSecond: 8 })
})
test('600-003 preserves all eight lights, Cubemap environment, volume and post values', () => {
  const profile = catalog.renderProfile
  assert.deepEqual(profile.lights.map((light) => light.name), [
    'MainLight', 'FillLight01', 'BgLight03', 'BgLight01',
    'BgLight01_01', 'BgCenterLight', 'BgLight02', 'BgLight04',
  ])
  assert.deepEqual(profile.lights.map((light) => light.type), [
    'directional', 'spot', 'point', 'point', 'point', 'spot', 'point', 'point',
  ])
  assert.deepEqual(profile.lights.map((light) => light.lightmapping), [1, 2, 2, 2, 2, 1, 2, 2])
  assert.deepEqual(profile.lights.map((light) => light.castShadow), [true, false, false, false, false, true, false, false])
  assert.equal(profile.environmentTextureUrl, `./stages/official/${stageId}/ReflectionProbe-0-equirectangular.png`)
  assert.equal('boxProjection' in profile, false)
  assert.deepEqual(profile.fog.color, [0.15600000321865082, 0.15600000321865082, 0.15600000321865082, 1])
  assert.equal(profile.fog.near, 0)
  assert.equal(profile.fog.far, 95)
  assert.equal(profile.bloom.strength, 1)
  assert.equal(profile.bloom.radius, 0.699999988079071)
  assert.equal(profile.bloom.threshold, 0.800000011920929)
  assert.equal(profile.postProcessing.colorAdjustments.contrast, 10)
  assert.equal(profile.postProcessing.colorAdjustments.saturation, 15)
  assert.equal(profile.postProcessing.colorAdjustments.sourceValues.postExposure, 0.20000000298023224)
  assert.equal(profile.postProcessing.colorAdjustments.overrideStates.postExposure, false)
  assert.equal(profile.postProcessing.vignette.intensity, 0.25)
  assert.equal(profile.postProcessing.vignette.smoothness, 0.5)
  assert.equal(profile.reDriveVolume.characterLightingOverrideRatio, 0.25)
  assert.equal(profile.reDriveVolume.backgroundPostExposure, 0.20000000298023224)
  assert.equal(profile.reDriveVolume.backgroundContrast, 2)
  assert.equal(profile.reDriveVolume.overrides.backgroundSaturation, false)
  assert.equal(profile.reDriveVolume.overrides.useFixedLightDirection, true)
  assert.equal(profile.reDriveVolume.paraffin.width, 1.399999976158142)
  assert.equal(profile.reDriveVolume.paraffin.bottomBlendMode, 3)
})
test('600-003 runtime and fidelity stop at the verified partial boundary', () => {
  const expectedClips = [
    'bg3d600A_01_02_circleA',
    'bg3d600A_01_02_circleCD',
    'bg3d600A_01_02_circleE',
    'bg3d600A_01_02_window',
    'bg3d600A_01_02_window02',
  ]
  assert.deepEqual(catalog.runtime.clipNames, expectedClips)
  assert.deepEqual(catalog.dynamic.clipNames, expectedClips)
  assert.equal(catalog.runtime.autoplay, true)
  assert.equal(catalog.runtime.loop, true)
  assert.equal(catalog.dynamic.expected, true)
  assert.equal(catalog.dynamic.status, 'partial')
  assert.equal(catalog.fidelity.exact, false)
  const provenance = JSON.parse(readFileSync(`${stageRoot}/asset-provenance.json`, 'utf8'))
  assert.deepEqual(provenance.animationBoundary.trackCounts, {
    bg3d600A_01_02_circleA: 1,
    bg3d600A_01_02_circleCD: 1,
    bg3d600A_01_02_circleE: 1,
    bg3d600A_01_02_window: 0,
    bg3d600A_01_02_window02: 4,
  })
  assert.deepEqual(provenance.animationBoundary.zeroTrackClips, ['bg3d600A_01_02_window'])
  assert.ok(catalog.dynamic.missing.some((item) => item.includes('zero-track')))
  assert.ok(catalog.dynamic.missing.some((item) => item.includes('AnimatorController')))
  const { source, carrier, runtime } = catalog.fidelity.layers
  assert.equal(source.gameObjectCount, 278)
  assert.equal(source.meshCount, 142)
  assert.equal(source.materialCount, 8)
  assert.equal(source.textureCount, 16)
  assert.equal(source.lightCount, 8)
  assert.equal(source.animatorCount, 3)
  assert.equal(source.animationClipCount, 5)
  assert.equal(source.lightmapBindingCount, 128)
  assert.equal(carrier.nodeCount, 279)
  assert.equal(carrier.meshCount, 182)
  assert.equal(carrier.materialCount, 7)
  assert.equal(carrier.animationClipCount, 5)
  assert.equal(runtime.lightCount, 8)
  assert.equal(runtime.animationClipCount, 5)
  assert.equal(runtime.lightmapBindingCount, 128)
})
