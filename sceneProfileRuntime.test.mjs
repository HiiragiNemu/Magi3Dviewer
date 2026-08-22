import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const stagesSource = await readFile(
  new URL('./src/viewer/stages.ts', import.meta.url),
  'utf8',
)
const catalog = JSON.parse(await readFile(
  new URL('./public/stages/catalog.json', import.meta.url),
  'utf8',
))
const profile = JSON.parse(await readFile(
  new URL(
    './public/stages/official/battle-600-00-01-002/scene-profile.json',
    import.meta.url,
  ),
  'utf8',
))
const cameraPresets = JSON.parse(await readFile(
  new URL(
    './src/viewer/official-camera-presets.generated.json',
    import.meta.url,
  ),
  'utf8',
))
const stage601Profile = JSON.parse(await readFile(
  new URL(
    './public/stages/official/battle-601-00-01-001/scene-profile.json',
    import.meta.url,
  ),
  'utf8',
))
const stage608Profile = JSON.parse(await readFile(
  new URL(
    './public/stages/official/battle-608-00-00-001/scene-profile.json',
    import.meta.url,
  ),
  'utf8',
))

test('runtime atomically loads a generated bundle scene profile', () => {
  assert.match(stagesSource, /sceneProfileUrl\?: string/)
  assert.match(stagesSource, /loadStageSceneProfilePackage/)
  assert.match(stagesSource, /value\.schemaVersion !== 1/)
  assert.match(stagesSource, /value\.stageId !== expectedStageId/)
  assert.match(stagesSource, /assetstudio-fbx-reflect-x/)
  assert.match(
    stagesSource,
    /const serializedRenderProfile =\s*generated\.renderProfile \?\? definition\.renderProfile/,
  )
  assert.match(
    stagesSource,
    /materialBindings: mergeGeneratedMaterialBindings\([\s\S]*?definition\.materialBindings,[\s\S]*?generated\.materialBindings/,
  )
  assert.match(
    stagesSource,
    /return \{ \.\.\.binding, \.\.\.official \}/,
    'generated Unity material truth must override historical copied fields',
  )
  assert.match(
    stagesSource,
    /merged\.push\(\.\.\.generated\.filter\(binding => !consumed\.has\(binding\)\)\)/,
    'new official materials must not be hidden by an older catalog list',
  )
  assert.match(stagesSource, /particlePresets: generated\.particlePresets/)
  assert.match(stagesSource, /particleSystems: generated\.particleSystems/)
  assert.match(stagesSource, /const authoredOwnsPlayback =/)
})

test('Stage 600-002 consumes its dedicated serialized Cinemachine lens', () => {
  assert.equal(profile.cameraPresetId, '600000102')
  assert.equal(cameraPresets.profileCount, 55)
  const camera = cameraPresets.profiles.find(
    item => item.cameraPresetId === profile.cameraPresetId,
  )
  assert.ok(camera)
  assert.equal(camera.defaultCameraIndex, 0)
  assert.equal(camera.defaultCameraEntryType, 'LevelCameraBase')
  assert.deepEqual(
    {
      fov: camera.lens.fieldOfView,
      near: camera.lens.nearClipPlane,
      far: camera.lens.farClipPlane,
    },
    {
      fov: 40,
      near: 0.30000001192092896,
      far: 1000,
    },
  )
  assert.match(stagesSource, /resolveOfficialCameraPreset/)
  assert.match(stagesSource, /position\?: \[number, number, number\]/)
  assert.match(stagesSource, /target\?: \[number, number, number\]/)
  assert.match(stagesSource, /if \(profile\.camera\.position\)/)
  assert.match(stagesSource, /if \(profile\.camera\.target\)/)
})

test('Stage 600 consumes automatically extracted Light and Volume records', () => {
  const stage = catalog.stages.find(item => item.id === 'battle-600-00-01-002')
  assert.equal(
    stage.sceneProfileUrl,
    './stages/official/battle-600-00-01-002/scene-profile.json',
  )
  assert.equal(profile.schemaVersion, 1)
  assert.equal(profile.stageId, stage.id)
  assert.deepEqual(profile.coordinateSpace, {
    source: 'unity-world',
    viewer: 'assetstudio-fbx-reflect-x',
  })
  assert.equal(profile.renderProfile.lights.length, 7)
  assert.equal(profile.materialBindings.length, 10)
  assert.equal(profile.renderProfile.renderer.toneMapping, 'aces')
  assert.equal(profile.renderProfile.postProcessing.colorAdjustments.contrast, 10)
  assert.equal(profile.renderProfile.postProcessing.colorAdjustments.saturation, 15)
  assert.equal(profile.renderProfile.postProcessing.vignette.intensity, 0.30000001192092896)
  assert.equal(
    profile.renderProfile.reDriveVolume.characterLightingOverrideDirectionEnabled,
    false,
  )
  const main = profile.renderProfile.lights.find(light => light.name === 'MainLight')
  const center = profile.renderProfile.lights.find(light => light.name === 'BgCenterLight')
  assert.equal(main.role, 'character-key')
  assert.equal(main.intensity, 1)
  assert.equal(center.role, 'background')
  assert.equal(center.intensity, 500)
  assert.deepEqual(main.additionalLightData, {
    renderingLayers: 1,
    lightLayerMask: 1,
    shadowResolutionTier: 2,
    softShadowQuality: 1,
  })
  assert.equal(center.range, 40)

  const propB = profile.materialBindings.find(
    material => material.materialName === 'mt_bg3d600A_01_02_propBAlpha',
  )
  assert.equal(propB.renderQueue, 2450)
  assert.deepEqual(propB.validKeywords, ['_ALPHATEST_ON'])
  assert.ok(propB.disabledShaderPasses.includes('SHADOWCASTER'))
  assert.equal(propB.alphaTest, 0.5)
  assert.equal(propB.castShadow, false)

  const propC = profile.materialBindings.find(
    material => material.materialName === 'mt_bg3d600A_01_02_propC',
  )
  assert.equal(propC.useMatCap, true)
  assert.equal(propC.normalPacking, 'unity-dxt5nm-ag')
  assert.equal(propC.smoothnessFromBaseAlpha, true)
  assert.equal(propC.useSmoothnessMaskMatCap, false)

  const ground = profile.materialBindings.find(
    material => material.materialName === 'mt_bg3d600A_01_02_ground',
  )
  assert.ok(ground.validKeywords.includes('_METALLICSPECGLOSSMAP'))
  assert.ok(ground.validKeywords.includes('_VERTEX_COLOR_BLEND'))
  assert.equal(ground.vertexColorBlend, true)
  assert.equal(ground.metallicFromSmoothnessMap, true)
  assert.equal(ground.normalPacking, 'unity-dxt5nm-ag')

  const sky = profile.materialBindings.find(
    material => material.materialName === 'mt_bg3d600A_01_02_sky',
  )
  assert.equal(sky.fogInfluence, 0)
  assert.equal(propC.fogInfluence, 1)
})

test('Stage 601 keeps untextured and textured official emission automatically', () => {
  assert.equal(stage601Profile.materialBindings.length, 17)
  const light = stage601Profile.materialBindings.find(
    material => material.materialName === 'bg3d601_00_light',
  )
  assert.equal(light.sourceShader, 'Creative/Bg/BgUberShader')
  assert.equal(light.textures.base, undefined)
  assert.equal(light.textures.emission, undefined)
  assert.deepEqual(light.emissionColor, [
    12.075472831726074,
    10.270232200622559,
    6.208615779876709,
    1,
  ])

  const glow = stage601Profile.materialBindings.find(
    material => material.materialName === 'bg3d601_00_lightGlowParticle',
  )
  assert.equal(
    glow.textures.emission.sourceTexturePathId,
    glow.textures.base.sourceTexturePathId,
  )
  assert.equal(glow.textures.emission.sourceProperty, '_EmissionMap')
})

test('generated component runtime carries particle and native rotator records', () => {
  assert.equal(stage601Profile.runtime.particlePresets.length, 2)
  assert.equal(stage601Profile.runtime.particleSystems.length, 84)
  assert.equal(stage601Profile.runtime.serializedComponentClips.length, 5)
  assert.equal(stage601Profile.runtime.animatorRandomizers.length, 82)
  assert.equal(stage601Profile.runtime.autoplay, true)
  assert.equal(
    stage601Profile.runtime.particleSystems.filter(
      system => system.carrierHierarchyPath,
    ).length,
    82,
  )
  assert.equal(stage608Profile.runtime.particlePresets.length, 1)
  assert.equal(stage608Profile.runtime.particleSystems.length, 6)
  assert.equal(stage608Profile.runtime.rotators.length, 1)
  assert.equal(
    stage608Profile.runtime.rotators[0].hierarchyPath,
    'bg_3d_608_00_00_001/bg3d608_00_red/chair_grp',
  )
})

test('generated scene profiles preserve exact ReDrive fog RGBA floats', () => {
  for (const document of [profile, stage601Profile, stage608Profile]) {
    const source =
      document.sourceRecords.volumeComponents.ReDriveVolume[0]
        .fields._fogColor.m_Value
    assert.ok(Array.isArray(document.renderProfile.backgroundColor))
    assert.deepEqual(document.renderProfile.backgroundColor, source)
    assert.deepEqual(document.renderProfile.fog.color, source)
  }
})

test('serialized shader keyword validity gates generated material behavior', () => {
  const fish = stage608Profile.materialBindings.find(
    material => material.materialName === 'bg3d608_00_blue_Fish',
  )
  assert.ok(fish.validKeywords.includes('_MULTI_UV_SCROLL'))
  assert.ok(!fish.validKeywords.includes('_ALPHATEST_ON'))
  assert.equal(fish.alphaTest, undefined)

  const shootingStar = stage601Profile.materialBindings.find(
    material => material.materialName === 'bg3d601_00_EffShootingStar_A',
  )
  assert.equal(shootingStar.sourceShader, 'Creative/Effect/Particle/Common')
  assert.deepEqual(shootingStar.validKeywords, [])
  assert.ok(shootingStar.invalidKeywords.includes('_SURFACE_TYPE_TRANSPARENT'))
  assert.equal(shootingStar.renderQueue, -1)
  assert.equal(shootingStar.transparent, true)
  assert.equal(shootingStar.depthWrite, false)
})
