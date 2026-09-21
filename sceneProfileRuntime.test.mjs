import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const stagesSource = await readFile(
  new URL('./src/viewer/stages.ts', import.meta.url),
  'utf8',
)
const stageParticlesSource = await readFile(
  new URL('./src/viewer/stageParticles.ts', import.meta.url),
  'utf8',
)
const stageRuntimeSource = await readFile(
  new URL('./src/viewer/stageRuntime.ts', import.meta.url),
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
const introProfile = JSON.parse(await readFile(
  new URL(
    './public/stages/official/dungeon-intro-0001-001/scene-profile.json',
    import.meta.url,
  ),
  'utf8',
))
const memoryStoryProfile = JSON.parse(await readFile(
  new URL(
    './public/stages/official/gallery-memory-room-story/scene-profile.json',
    import.meta.url,
  ),
  'utf8',
))
const battle616Definition = JSON.parse(await readFile(
  new URL(
    './public/stages/catalog/battle-616-00-01-001.json',
    import.meta.url,
  ),
  'utf8',
))
const battle616Profile = JSON.parse(await readFile(
  new URL(
    './public/stages/official/battle-616-00-01-001/scene-profile.json',
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
  const stage608Presets = new Map(
    stage608Profile.runtime.particlePresets.map(preset => [preset.id, preset]),
  )
  const stage608Noise = stage608Profile.runtime.particleSystems.map(
    system => stage608Presets.get(system.presetId).modules.noise,
  )
  assert.equal(stage608Noise.filter(noise => noise.enabled).length, 6)
  assert.ok(stage608Noise.every(noise => (
    noise.frequency === 0.5
    && noise.quality === 1
    && noise.damping === true
    && noise.positionAmount.scalar === 1
    && noise.rotationAmount.scalar === 0
    && noise.sizeAmount.scalar === 0
  )))
  assert.equal(stage608Profile.runtime.rotators.length, 1)
  assert.equal(
    stage608Profile.runtime.rotators[0].hierarchyPath,
    'bg_3d_608_00_00_001/bg3d608_00_red/chair_grp',
  )
})

test('particle noise consumer is serialized-field gated and leaves protected neighbors inactive', () => {
  assert.match(stageParticlesSource, /'noise',/)
  assert.match(stageParticlesSource, /if \(noiseModule\.enabled === true\)/)
  assert.match(stageParticlesSource, /noiseModule\.positionAmount/)
  assert.match(stageParticlesSource, /noiseModule\.rotationAmount/)
  assert.match(stageParticlesSource, /noiseModule\.sizeAmount/)
  assert.match(stageParticlesSource, /noise\.frequency/)
  assert.match(stageParticlesSource, /noise\.quality/)
  assert.match(stageParticlesSource, /noise\.damping/)
  assert.match(stageParticlesSource, /noise\.octaves/)
  assert.doesNotMatch(
    stageParticlesSource,
    /gallery-memory-room-story|battle-608-00-00-001|battle-600-00-01-002|dungeon-intro-0001-001|battle-616-00-01-001/,
  )
  assert.equal(profile.runtime?.particleSystems, undefined)
  assert.equal(introProfile.runtime?.particleSystems, undefined)
  const battle616Preset = battle616Profile.runtime.particlePresets[0]
  assert.equal(battle616Preset.modules.noise, undefined)
})

test('particle trails consume the serialized second material slot without stage or character IDs', () => {
  const presets = new Map(
    stage601Profile.runtime.particlePresets.map(preset => [preset.id, preset]),
  )
  const trailSystems = stage601Profile.runtime.particleSystems.filter(system =>
    presets.get(system.presetId).modules.trails?.enabled)
  assert.equal(trailSystems.length, 2)
  assert.ok(trailSystems.every(system => (
    system.materials[0] === 'bg3d601_00_EffShootingStar_A'
    && system.materials[1] === 'bg3d601_00_EffShootingStar_B'
  )))
  assert.ok(trailSystems.every(system => {
    const trails = presets.get(system.presetId).modules.trails
    return trails.mode === 0
      && trails.ratio === 1
      && trails.lifetime.scalar === 1
      && trails.minVertexDistance === 0.20000000298023224
      && trails.textureMode === 0
      && trails.dieWithParticles === true
      && trails.sizeAffectsWidth === true
      && trails.inheritParticleColor === true
  }))
  assert.match(stageParticlesSource, /'trails',/)
  assert.match(stageParticlesSource, /profile\.materials\[1\]/)
  assert.match(stageParticlesSource, /UnityParticleTrail:/)
  assert.match(stageParticlesSource, /module\.minVertexDistance/)
  assert.match(stageParticlesSource, /module\.lifetime/)
  assert.match(stageParticlesSource, /module\.widthOverTrail/)
  assert.match(stageParticlesSource, /module\.colorOverLifetime/)
  assert.match(stageParticlesSource, /module\.colorOverTrail/)
  assert.match(stageParticlesSource, /module\.textureMode/)
  assert.match(stageParticlesSource, /module\.sizeAffectsWidth/)
  assert.match(stageParticlesSource, /module\.inheritParticleColor/)
  assert.doesNotMatch(
    stageParticlesSource,
    /battle-601-00-01-001|battle-600-00-01-002|dungeon-intro-0001-001|gallery-memory-room-story|battle-616-00-01-001|100102|108301|101901|100107/,
  )
  const memoryPresets = new Map(
    memoryStoryProfile.runtime.particlePresets.map(preset => [preset.id, preset]),
  )
  assert.equal(
    memoryStoryProfile.runtime.particleSystems.filter(system =>
      memoryPresets.get(system.presetId).modules.trails?.enabled).length,
    0,
  )
  assert.equal(profile.runtime?.particleSystems, undefined)
  assert.equal(introProfile.runtime?.particleSystems, undefined)
  const battle616Preset = battle616Profile.runtime.particlePresets[0]
  assert.equal(battle616Preset.modules.trails, undefined)
})

test('Particle Common soft depth consumes compiled keywords and serialized fade fields only', () => {
  const materials = new Map(
    memoryStoryProfile.sourceRecords.materials.map(material => [
      material.name,
      material,
    ]),
  )
  const presets = new Map(
    memoryStoryProfile.runtime.particlePresets.map(preset => [preset.id, preset]),
  )
  const activeDrawable = memoryStoryProfile.runtime.particleSystems.filter(system => {
    const renderer = presets.get(system.presetId).renderer
    return system.active
      && system.materials.length > 0
      && renderer.enabled
      && renderer.renderMode !== 5
  })
  const soft = activeDrawable.filter(system => {
    const material = materials.get(system.materials[0])
    return material.validKeywords.includes('IS_SOFT_PARTICLE')
      && !material.invalidKeywords.includes('IS_SOFT_PARTICLE')
      && material.floats._IsSoftParticle === 1
  })
  assert.equal(activeDrawable.length, 14)
  assert.equal(soft.length, 9)
  assert.deepEqual(
    [...new Set(soft.map(system =>
      materials.get(system.materials[0]).floats._SurfaceFadeFar,
    ))].sort((left, right) => left - right),
    [
      0.10000000149011612,
      0.20000000298023224,
      0.30000001192092896,
      0.4000000059604645,
      1,
      5,
    ],
  )
  assert.ok(soft.every(system =>
    materials.get(system.materials[0]).floats._SurfaceFadeNear === 0))
  assert.equal(
    activeDrawable.filter(system =>
      materials.get(system.materials[0]).floats._ZTest === 8).length,
    1,
  )
  assert.match(stageParticlesSource, /uUseSoftParticle/)
  assert.match(stageParticlesSource, /uSurfaceFadeNear/)
  assert.match(stageParticlesSource, /uSurfaceFadeFar/)
  assert.match(stageParticlesSource, /rdSoftDepthDelta/)
  assert.match(
    stageParticlesSource,
    /rdSoftT \* rdSoftT \* \(3\.0 - 2\.0 \* rdSoftT\)/,
  )
  assert.match(stageParticlesSource, /registerBackgroundDepthConsumer/)
  assert.match(stageParticlesSource, /unityDepthFunction/)
  assert.match(stageRuntimeSource, /depthRegistrar/)
  assert.match(stagesSource, /resources\.textures\.forEach/)
  assert.doesNotMatch(
    stageParticlesSource,
    /gallery-memory-room-story|battle-600-00-01-002|dungeon-intro-0001-001|battle-616-00-01-001|100102|108301|101901|100107/,
  )
  assert.equal(profile.runtime?.particleSystems, undefined)
  assert.equal(introProfile.runtime?.particleSystems, undefined)
  const battle616Fog = battle616Profile.sourceRecords.materials.find(
    material => material.name === 'mt_bg3d616_01_01_fog',
  )
  assert.ok(battle616Fog.validKeywords.includes('IS_SOFT_PARTICLE'))
  assert.equal(battle616Fog.floats._IsSoftParticle, 1)
  assert.equal(battle616Fog.floats._SurfaceFadeNear, 0)
  assert.equal(battle616Fog.floats._SurfaceFadeFar, 1)
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

test('Intro consumes exact serialized phase roots, ActivationTracks, and light self-state', () => {
  assert.equal(introProfile.bundle, 'dungeon/level/10000/level_intro_0001_001')
  assert.equal(introProfile.renderProfile.lights.length, 5)
  assert.equal(introProfile.materialBindings.length, 29)
  assert.equal(introProfile.sourceRecords.objectTypeCounts.Texture2D, 14)
  assert.equal(introProfile.runtime.activationDirectors.length, 2)
  assert.equal(introProfile.runtime.gameObjectStates.length, 6)

  const phases = Object.fromEntries(
    introProfile.runtime.gameObjectStates
      .filter(state => /intro_3dbg_000[123]$/.test(state.hierarchyPath))
      .map(state => [state.hierarchyPath.split('/').at(-1), state.activeSelf]),
  )
  assert.deepEqual(phases, {
    intro_3dbg_0001: false,
    intro_3dbg_0002: true,
    intro_3dbg_0003: false,
  })
  const directors = Object.fromEntries(
    introProfile.runtime.activationDirectors.map(director => [
      director.hierarchyPath.split('/').at(-1),
      director,
    ]),
  )
  assert.deepEqual(
    directors['01'].tracks.map(track => ({
      name: track.name,
      target: track.targetHierarchyPath.split('/').at(-1),
      start: track.clips[0].start,
      duration: track.clips[0].duration,
      post: track.postPlaybackState,
    })),
    [
      {
        name: 'Bg02',
        target: 'intro_3dbg_0002',
        start: 13.000000000000002,
        duration: 13.433333333333332,
        post: 3,
      },
      {
        name: 'Bg01',
        target: 'intro_3dbg_0001',
        start: 0,
        duration: 13.000000000000002,
        post: 3,
      },
    ],
  )
  assert.deepEqual(
    directors['02'].tracks.map(track => ({
      name: track.name,
      target: track.targetHierarchyPath.split('/').at(-1),
      start: track.clips[0].start,
      duration: track.clips[0].duration,
      post: track.postPlaybackState,
    })),
    [
      {
        name: 'Bg03',
        target: 'intro_3dbg_0003',
        start: 3,
        duration: 5.166666666666668,
        post: 3,
      },
      {
        name: 'Bg02',
        target: 'intro_3dbg_0002',
        start: 0,
        duration: 3,
        post: 3,
      },
    ],
  )
  assert.ok(introProfile.renderProfile.lights.every(light => (
    typeof light.activeSelf === 'boolean'
    && typeof light.active === 'boolean'
  )))
  assert.match(stagesSource, /generated\.gameObjectStates \?\? authored\.gameObjectStates/)
  assert.match(stagesSource, /generated\.activationDirectors \?\? authored\.activationDirectors/)
  assert.match(stagesSource, /profile\.activeSelf \?\? profile\.active/)
  assert.match(stagesSource, /visibleInStageHierarchy\(anchor\)/)
})

test('Memory story keeps complete serialized scene operators without global exposure guesses', () => {
  assert.equal(memoryStoryProfile.bundle, 'gallery/bg3d_gallery_story')
  assert.equal(memoryStoryProfile.renderProfile.lights.length, 5)
  assert.equal(memoryStoryProfile.materialBindings.length, 26)
  assert.equal(memoryStoryProfile.sourceRecords.objectTypeCounts.Texture2D, 29)
  assert.equal(memoryStoryProfile.runtime.particleSystems.length, 20)
  assert.ok(memoryStoryProfile.runtime.particleSystems.every(system => (
    Array.isArray(system.serializedWorldMatrix)
    && system.serializedWorldMatrix.length === 16
    && system.serializedWorldMatrix.every(Number.isFinite)
  )))
  assert.deepEqual(
    memoryStoryProfile.runtime.particleSystems.map(system => ({
      pathID: system.pathID,
      matrix: system.serializedWorldMatrix,
    })),
    memoryStoryProfile.sourceRecords.particleSystems.map(system => ({
      pathID: system.pathID,
      matrix: system.serializedWorldMatrix,
    })),
  )
  assert.equal(
    memoryStoryProfile.runtime.particleSystems.filter(system => system.active).length,
    16,
  )
  const materials = new Set(
    memoryStoryProfile.materialBindings.map(binding => binding.materialName),
  )
  const activeDrawable = memoryStoryProfile.runtime.particleSystems.filter(
    system => system.active
      && system.materials.length > 0
      && system.materials.every(name => materials.has(name)),
  )
  assert.equal(activeDrawable.length, 14)
  assert.equal(memoryStoryProfile.runtime.particleMeshes.length, 3)
  assert.deepEqual(
    memoryStoryProfile.runtime.particleMeshes.map(mesh => ({
      pathID: mesh.pathID,
      vertices: mesh.vertexCount,
      indices: mesh.indexCount,
    })),
    [
      { pathID: '-4439418188548447165', vertices: 130, indices: 600 },
      { pathID: '-1282498721865224950', vertices: 150, indices: 720 },
      { pathID: '-759386857069231524', vertices: 132, indices: 576 },
    ],
  )
  const presets = new Map(
    memoryStoryProfile.runtime.particlePresets.map(preset => [preset.id, preset]),
  )
  const noisePresets = [...presets.values()].filter(
    preset => preset.modules.noise?.enabled,
  )
  assert.deepEqual(
    noisePresets.map(preset => ({
      frequency: preset.modules.noise.frequency,
      quality: preset.modules.noise.quality,
      damping: preset.modules.noise.damping,
      strengthMode: preset.modules.noise.strength.minMaxState,
      strength: preset.modules.noise.strength.scalar,
      strengthMin: preset.modules.noise.strength.minScalar,
      scroll: preset.modules.noise.scrollSpeed.scalar,
    })).sort((left, right) => left.frequency - right.frequency),
    [
      {
        frequency: 0.44999998807907104,
        quality: 2,
        damping: true,
        strengthMode: 0,
        strength: 0.36000001430511475,
        strengthMin: 1.2000000476837158,
        scroll: 1,
      },
      {
        frequency: 0.6499999761581421,
        quality: 2,
        damping: true,
        strengthMode: 3,
        strength: 0.10000000149011612,
        strengthMin: 0.15000000596046448,
        scroll: 0,
      },
    ],
  )
  const meshSystems = activeDrawable.filter(system => (
    presets.get(system.presetId).renderer.renderMode === 4
  ))
  assert.equal(meshSystems.length, 5)
  assert.ok(meshSystems.every(system => (
    presets.get(system.presetId).renderer.meshes.length === 1
  )))
  assert.match(stagesSource, /generated\.particleMeshes \?\? authored\.particleMeshes/)
  assert.match(stageParticlesSource, /createSerializedParticleAnchor/)
  assert.match(stageParticlesSource, /multiply\(particleCoordinateReflection\)/)
  assert.match(stageParticlesSource, /basis = cameraWorldBasis\(\)/)
  assert.match(stageParticlesSource, /vec3\(viewMatrix\[0\]\[0\], viewMatrix\[1\]\[0\], viewMatrix\[2\]\[0\]\)/)
  assert.doesNotMatch(stageParticlesSource, /cameraMatrixWorld/)
  assert.doesNotMatch(
    stageParticlesSource,
    /gallery-memory-room-story|battle-600-00-01-002|dungeon-intro-0001-001|battle-616-00-01-001|100102|108301|101901|100107/,
  )
  assert.equal(memoryStoryProfile.runtime.activationDirectors, undefined)
})

test('battle-616 consumes its serialized smoke, probe, material, and light records', () => {
  assert.equal(battle616Definition.id, 'battle-616-00-01-001')
  assert.equal(
    battle616Definition.sceneProfileUrl,
    './stages/official/battle-616-00-01-001/scene-profile.json',
  )
  assert.equal(battle616Definition.runtime?.activationDirectors, undefined)
  assert.equal(battle616Profile.schemaVersion, 1)
  assert.equal(battle616Profile.stageId, battle616Definition.id)
  assert.equal(battle616Profile.sourceRecords.objectTypeCounts.ParticleSystem, 1)
  assert.equal(battle616Profile.sourceRecords.objectTypeCounts.ReflectionProbe, 1)
  assert.equal(battle616Profile.sourceRecords.objectTypeCounts.Light, 25)
  assert.equal(battle616Profile.materialBindings.length, 19)

  assert.equal(battle616Profile.runtime.particleSystems.length, 1)
  assert.equal(battle616Profile.runtime.particlePresets.length, 1)
  assert.equal(battle616Profile.runtime.particleMeshes.length, 1)
  const smoke = battle616Profile.runtime.particleSystems[0]
  assert.deepEqual(smoke, {
    pathID: '2413252179800569828',
    hierarchyPath: 'bg_3d_616_00_01_001/EFf_smoke',
    carrierHierarchyPath: null,
    serializedWorldMatrix: [
      1, 0, 0, 0,
      0, 2.3299999237060547, 0, 5,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ],
    active: true,
    presetId: 'particle-preset-001',
    materials: ['mt_bg3d616_01_01_fog'],
  })
  const smokePreset = battle616Profile.runtime.particlePresets[0]
  assert.equal(smokePreset.looping, true)
  assert.equal(smokePreset.playOnAwake, true)
  assert.equal(smokePreset.emission.rateOverTime.scalar, 10)
  assert.equal(smokePreset.initial.startLifetime.minMaxState, 3)
  assert.equal(smokePreset.initial.startLifetime.scalar, 8)
  assert.equal(smokePreset.initial.startLifetime.minScalar, 4)
  assert.equal(smokePreset.initial.startSize.scalar, 2)
  assert.equal(smokePreset.initial.startSize.minScalar, 1)
  assert.equal(smokePreset.shape.type, 10)
  assert.deepEqual(smokePreset.shape.m_Rotation, [-90, 0, 0])
  assert.deepEqual(smokePreset.shape.m_Scale, [30, 30, 1])
  assert.equal(smokePreset.renderer.renderMode, 4)
  assert.equal(smokePreset.renderer.meshes[0].pathID, '-3199273668296762249')
  assert.deepEqual(
    battle616Profile.runtime.particleMeshes.map(mesh => ({
      pathID: mesh.pathID,
      vertices: mesh.vertexCount,
      indices: mesh.indexCount,
    })),
    [{ pathID: '-3199273668296762249', vertices: 15, indices: 48 }],
  )

  assert.equal(battle616Profile.renderProfile.reflectionProbes.length, 1)
  assert.deepEqual(
    battle616Profile.renderProfile.reflectionProbes[0],
    {
      id: '-4955861551429771061',
      name: 'Reflection Probe',
      textureUrl: './stages/official/battle-616-00-01-001/ReflectionProbe-0-equirectangular.png',
      encoding: 'linear-image',
      position: [0, 7.639585494995117, 0],
      boxMin: [-25, 2.639585494995117, -40],
      boxMax: [25, 12.639585494995117, 40],
      importance: 1,
      intensity: 1.100000023841858,
      blendDistance: 1,
      boxProjection: false,
    },
  )
  assert.equal(battle616Profile.renderProfile.lights.length, 25)
  assert.equal(
    battle616Profile.renderProfile.lights.filter(
      light => light.lightmapping === 2,
    ).length,
    23,
  )
  assert.match(stagesSource, /profile\.lightmapping === 2 && bakedLightmapsActive/)
  assert.match(stagesSource, /status: 'skipped-baked'/)

  const fog = battle616Profile.materialBindings.find(
    material => material.materialName === 'mt_bg3d616_01_01_fog',
  )
  assert.equal(fog.sourceShader, 'Creative/Effect/Particle/Common')
  assert.equal(fog.textures.base.url, './stages/official/battle-616-00-01-001/bg3d615_00_PropB_mask_col.png')
  assert.equal(fog.transparent, true)
  assert.equal(fog.depthWrite, false)
  assert.ok(fog.validKeywords.includes('IS_SOFT_PARTICLE'))

  const ground = battle616Profile.materialBindings.find(
    material => material.materialName === 'mt_bg3d616_01_01_ground',
  )
  assert.equal(ground.textures.base.url, './stages/official/battle-616-00-01-001/bg3d616_01_01_ground_col.webp')
  assert.equal(ground.textures.normal.url, './stages/official/battle-616-00-01-001/bg3d616_01_01_ground_nml.webp')

  const lightning = battle616Profile.materialBindings.find(
    material => material.materialName === 'mt_bg3d616_01_01_Lightning',
  )
  assert.ok(lightning)
  assert.equal(lightning.sourceShader, 'Creative/Bg/BgUnlit')
  assert.equal(lightning.blending, 'additive')
  assert.equal(lightning.depthWrite, false)
  assert.equal(lightning.unlitness, 1)
  assert.equal(battle616Profile.runtime.serializedComponentClips.length, 1)
  const lightningClip = battle616Profile.runtime.serializedComponentClips[0]
  assert.deepEqual(
    {
      pathID: lightningClip.pathID,
      name: lightningClip.name,
      sampleRate: lightningClip.sampleRate,
      duration: lightningClip.duration,
      loop: lightningClip.loop,
      streamedCurveCount: lightningClip.streamedCurveCount,
      denseCurveCount: lightningClip.denseCurveCount,
      constantCurveCount: lightningClip.constantCurveCount,
      bindingCount: lightningClip.bindings.length,
    },
    {
      pathID: '682054998611788941',
      name: 'Lightning Animation',
      sampleRate: 60,
      duration: 8.533333778381348,
      loop: true,
      streamedCurveCount: 38,
      denseCurveCount: 0,
      constantCurveCount: 16,
      bindingCount: 54,
    },
  )
  for (const [bindingIndex, binding] of lightningClip.bindings.entries()) {
    assert.equal(binding.bindingIndex, bindingIndex)
    assert.equal(binding.propertyName, null)
    assert.equal(binding.propertyNameAuthority, 'hash-only-player-serialization')
    assert.equal(typeof binding.propertyNameHash, 'number')
    assert.equal(typeof binding.transformPathHash, 'number')
    assert.ok(binding.curves.length > 0)
  }
})
