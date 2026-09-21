import { actualLoadingProgress, textureAssetUrlImports } from './textureTestImports.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as THREE from 'three'
import ts from 'typescript'

const read = path => readFileSync(path, 'utf8')
const extractorSource = read('scripts/extract-official-material-profiles.py')
const profileSource = read('magia-exedra-character-three/materialProfile.ts')
const textureSource = read('magia-exedra-character-three/texture.ts')
const hairSource = read('magia-exedra-character-three/shaders/hair.ts')
const loaderSource = read('magia-exedra-character-three/loader.ts')
const generated = JSON.parse(read(
  'magia-exedra-character-three/official-material-profiles.json',
))
const officialHairBlob = read(
  'artifacts/verification/20260820-hair-hard-shadow-official-input/' +
  'official-selfshadow-variants/main_hair_reference_blob-98.glsl',
)

function loadTypeScriptModule(source, path, imports) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: path,
    reportDiagnostics: true,
  })
  assert.deepEqual(compiled.diagnostics ?? [], [])
  const module = { exports: {} }
  const localRequire = specifier => {
    if (Object.hasOwn(imports, specifier)) return imports[specifier]
    throw new Error(`Unexpected fixture import: ${specifier}`)
  }
  Function('exports', 'require', 'module', compiled.outputText)(
    module.exports,
    localRequire,
    module,
  )
  return module.exports
}

test('108301 official YuugenHighlight is UV locked and camera zoom invariant', () => {
  assert.match(
    officialHairBlob,
    /texture\(_AngelRingMap, vs_TEXCOORD0\.xy, _GlobalMipBias\.x\)/,
  )
  const uvStart = hairSource.indexOf("if (branch === 'uv')")
  const projectedStart = hairSource.indexOf('projectedShaders.add(shader)', uvStart)
  assert.ok(uvStart >= 0 && projectedStart > uvStart)
  const afterStylizationStart = hairSource.indexOf('onAfterStylization(shader)')
  const afterStylization = afterStylizationStart < 0 ? '' : hairSource.slice(
    afterStylizationStart,
    hairSource.indexOf('onBeforeCompile(shader)', afterStylizationStart),
  )
  const uvBranch = hairSource.slice(uvStart, projectedStart) + afterStylization
  assert.match(uvBranch, /uniform sampler2D tAngelRingMap/)
  assert.match(uvBranch, /vAngelRingUv = uv/)
  assert.match(uvBranch, /texture2D\(\s*tAngelRingMap,\s*vAngelRingUv/)
  assert.doesNotMatch(uvBranch, /vMapUv|tAngelRingCommon|tAngelRingCharacter/)
  assert.doesNotMatch(
    uvBranch,
    /cameraPosition|uAngelRingFovOrOrthoFix|uAngelRingAspectFix|gl_FragCoord/,
  )
  const projectedBranch = hairSource.slice(projectedStart)
  assert.match(projectedBranch, /viewMatrix/)
  assert.match(projectedBranch, /uAngelRingFovOrOrthoFix/)
  assert.match(projectedBranch, /texture2D\(\s*tAngelRingMap,\s*rdAngelMapUv/)
  assert.match(
    projectedBranch,
    /texture2D\(\s*tAngelRingMap,\s*rdAngelMapUv\s*\)\.r/,
  )
  assert.doesNotMatch(projectedBranch, /tAngelRingCommon|tAngelRingCharacter/)
  assert.doesNotMatch(
    hairSource,
    /rdAngelProjectedRectMask|rdAngelMapLowerBounds|angelRingHeadAttachment|FreeOrbitBasisBlend/,
  )
  assert.match(
    hairSource,
    /viewer-angel-ring-head-frame-ylock-v1/,
  )

  const material = generated.materials.mt_chara_108301_hair
  assert.deepEqual(
    {
      enabled: material.angelRing.enabled,
      uvMode: material.angelRing.uvMode,
      map: material.angelRing.map,
      texture: material.angelRing.texture,
    },
    {
      enabled: true,
      uvMode: true,
      map: 'character',
      texture: 'chara_108301_hair_highlight',
    },
  )
})

test('projected AngelRing restores the historical 1/FOV camera contract at 32/40/60 degrees', () => {
  // Historical Viewer contract plus same-pose contribution evidence; this is
  // not a claim that the native CPU camera setter has been fully recovered.
  const renderer = {
    getRenderTarget: () => null,
    getDrawingBufferSize: target => target.set(1920, 1080),
  }
  for (const fov of [32, 40, 60]) {
    const shader = { uniforms: {
      uAngelRingViewportSize: { value: new THREE.Vector2() },
      uAngelRingAspectFix: { value: new THREE.Vector2() },
      uAngelRingFovOrOrthoFix: { value: 0 },
      uAngelRingOrthographic: { value: 0 },
    } }
    constructionHair.setAngelRingCameraUniforms(shader, renderer, new THREE.PerspectiveCamera(fov, 16 / 9))
    assert.equal(shader.uniforms.uAngelRingFovOrOrthoFix.value, 1 / fov, `${fov} degree current consumer`)
    assert.deepEqual(shader.uniforms.uAngelRingViewportSize.value.toArray(), [1920, 1080])
    assert.deepEqual(shader.uniforms.uAngelRingAspectFix.value.toArray(), [1080 / 1920, 1])
    assert.equal(shader.uniforms.uAngelRingOrthographic.value, 0)
  }
})

test('projected AngelRing preserves orthographic zoom and current render-target dimensions', () => {
  const camera = new THREE.OrthographicCamera(-4, 4, 3, -3)
  camera.zoom = 2
  const shader = { uniforms: {
    uAngelRingViewportSize: { value: new THREE.Vector2() },
    uAngelRingAspectFix: { value: new THREE.Vector2() },
    uAngelRingFovOrOrthoFix: { value: 0 },
    uAngelRingOrthographic: { value: 0 },
  } }
  const renderer = {
    getRenderTarget: () => ({ width: 800, height: 600 }),
    getDrawingBufferSize: () => { throw new Error('Active render target must take precedence') },
  }
  constructionHair.setAngelRingCameraUniforms(shader, renderer, camera)
  assert.equal(shader.uniforms.uAngelRingFovOrOrthoFix.value, 1 / 150)
  assert.equal(shader.uniforms.uAngelRingOrthographic.value, 1)
  assert.deepEqual(shader.uniforms.uAngelRingViewportSize.value.toArray(), [800, 600])
  assert.deepEqual(shader.uniforms.uAngelRingAspectFix.value.toArray(), [0.75, 1])
})

test('all resolved character AngelRing maps carry exact serialized samplers', () => {
  const expected = {
    rdtoon_angelringmap: [512, 512, 1, 1],
    chara_108101_hair_highlight: [1024, 1024, 11, 0],
    chara_108201_hair_highlight: [1024, 1024, 11, 0],
    chara_108301_hair_highlight: [1024, 1024, 11, 0],
    chara_115201_hairhighlight: [512, 512, 10, 2],
  }
  const angelRingSamplers = Object.values(generated.textureSamplers)
    .filter(row => row.slots.includes('_AngelRingMap'))
  assert.equal(angelRingSamplers.length, 5)
  for (const [name, [width, height, mipCount, wrap]] of Object.entries(expected)) {
    const row = generated.textureSamplers[name]
    assert.ok(row, name)
    assert.deepEqual(row.slots, ['_AngelRingMap'], name)
    assert.deepEqual(
      [row.width, row.height, row.mipCount],
      [width, height, mipCount],
      name,
    )
    assert.equal(row.colorSpace, name === 'rdtoon_angelringmap' ? 0 : 1, name)
    assert.equal(row.filterMode, 1, name)
    assert.equal(row.aniso, 1, name)
    assert.equal(row.mipBias, 0, name)
    assert.deepEqual([row.wrapU, row.wrapV, row.wrapW], [wrap, wrap, wrap], name)
  }
})

test('AngelRing texture identity and sampler routing use serialized fields, not IDs or name lists', () => {
  assert.match(
    extractorSource,
    /SURFACE_TEXTURE_SLOTS\s*=\s*\([^)]*"_AngelRingMap"/s,
  )
  assert.match(profileSource, /\| '_AngelRingMap'/)
  assert.doesNotMatch(textureSource, /OFFICIAL_CHARACTER_ANGEL_RING_WRAPPING/)
  assert.doesNotMatch(
    textureSource,
    /chara_108101_hair_highlight|chara_108201_hair_highlight|chara_108301_hair_highlight|chara_115201_hairhighlight/,
  )
  assert.match(textureSource, /getOfficialTextureSamplerProfile/)
  assert.match(textureSource, /profile\?\.slots\.includes\('_AngelRingMap'\)/)
  assert.doesNotMatch(loaderSource, /hair_highlight|hairhighlight/)
  assert.match(loaderSource, /profile\.angelRing\.texture/)
  assert.match(loaderSource, /normalizeOfficialTextureName/)
  assert.doesNotMatch(
    loaderSource.slice(
      loaderSource.indexOf('requiresCharacterAngelRingMap'),
      loaderSource.indexOf('const result = await createHairMaterial'),
    ),
    /100102|108301|101901|100107/,
  )
})

test('generic runtime sampler applies Repeat and MirrorOnce contracts and fails closed', () => {
  const module = loadTypeScriptModule(
    textureSource,
    'magia-exedra-character-three/texture.ts',
    {
      './loadingProgress.ts': actualLoadingProgress,
      ...textureAssetUrlImports,
      three: THREE,
      './materialProfile': {
        getOfficialTextureSamplerProfile: name =>
          generated.textureSamplers[
            name.replace(/\\/g, '/').split('/').pop().replace(/\.png$/i, '').toLowerCase()
          ],
      },
      './officialTextureContainer': {
        getOfficialCompressedTextureState: () => undefined,
        loadOfficialCompressedTexture: async () => undefined,
      },
      './renderer': {
        renderer: { capabilities: { getMaxAnisotropy: () => 16 } },
      },
    },
  )

  const repeat = new THREE.Texture()
  const repeatState = module.ApplyOfficialCharacterAngelRingSampling(
    repeat,
    'models/chara_108301_hair_highlight.png',
  )
  assert.equal(repeatState.authority, 'official-serialized')
  assert.deepEqual(repeatState.slots, ['_AngelRingMap'])
  assert.equal(repeat.colorSpace, THREE.SRGBColorSpace)
  assert.equal(repeat.generateMipmaps, true)
  assert.equal(repeat.minFilter, THREE.LinearMipmapNearestFilter)
  assert.equal(repeat.anisotropy, 1)
  assert.equal(repeat.wrapS, THREE.RepeatWrapping)
  assert.equal(repeat.wrapT, THREE.RepeatWrapping)

  const mirrored = new THREE.Texture()
  const mirroredState = module.ApplyOfficialCharacterAngelRingSampling(
    mirrored,
    'chara_115201_hairhighlight.png',
  )
  assert.equal(mirroredState.authority, 'official-serialized')
  assert.equal(mirrored.wrapS, THREE.MirroredRepeatWrapping)
  assert.equal(mirrored.wrapT, THREE.MirroredRepeatWrapping)

  assert.equal(
    module.ApplyOfficialCharacterAngelRingSampling(
      new THREE.Texture(),
      'unknown_future_highlight.png',
    ),
    undefined,
  )
})

test('four protected character neighbors keep their official AngelRing branch', () => {
  const cases = {
    mt_chara_100102_hair: [true, false, 'common', 'RDToon_AngelRingMap'],
    mt_chara_108301_hair: [true, true, 'character', 'chara_108301_hair_highlight'],
    mt_chara_101901_hair: [true, false, 'common', 'RDToon_AngelRingMap'],
    mt_chara_100101_hair: [true, false, 'common', 'RDToon_AngelRingMap'],
  }
  for (const [name, expected] of Object.entries(cases)) {
    const profile = generated.materials[name].angelRing
    assert.deepEqual(
      [profile.enabled, profile.uvMode, profile.map, profile.texture],
      expected,
      name,
    )
  }
})

// Exercise the actual current material construction pipeline, rather than
// searching hair.ts for an insertion that may never reach the final shader.
// These five modules are real. Named adapters below remove texture/network I/O
// and unrelated self-shadow/perspective/native passes; no GPU result is implied.
function loadHairConstructionModule() {
  const source = name => read(`magia-exedra-character-three/shaders/${name}.ts`)
  const userdata = loadTypeScriptModule(source('userdata'), 'userdata.ts', { three: THREE })
  const depthRim = loadTypeScriptModule(source('depthRim'), 'depthRim.ts', { three: THREE })
  const stylization = loadTypeScriptModule(source('stylization'), 'stylization.ts', {
    three: THREE,
    './userdata': userdata,
    '../scene/selfShadow': { injectReDriveSelfShadowShader() {} },
    '../coordinateSpace': { unityWorldToViewerVector: value => value },
  })
  const texture = {
    async loadTexture(name) {
      const texture = new THREE.Texture()
      texture.name = name
      return texture
    },
    ApplyOfficialCharacterSurfaceSampling: () => ({}),
    ApplyOfficialSpecularGradientSampling() {},
    ApplyOfficialCommonAngelRingSampling() {},
    ApplyOfficialCharacterAngelRingSampling: () => ({}),
  }
  const general = loadTypeScriptModule(source('general'), 'general.ts', {
    three: THREE,
    '.': userdata,
    '../texture': texture,
    '../materialProfile': { getOfficialTextureSamplerProfile() {} },
    './stylization': stylization,
    './depthRim': depthRim,
    './gem': { setOfficialMaterialProfileUniforms: depthRim.setDepthRimMaterialProfileUniforms },
    './perspective': { injectCharacterPerspectiveCancellation() {} },
    '../nativeMaterialScope': { applyNativeSlotShaderBindings() {} },
  })
  return loadTypeScriptModule(hairSource, 'hair.ts', {
    three: THREE,
    '.': { ...userdata, ...general },
    '../texture': texture,
    './RDToon_AngelRingMap.png': 'RDToon_AngelRingMap.png',
  })
}

const constructionHair = loadHairConstructionModule()

async function constructHairShader(profile, check) {
  const headBone = new THREE.Bone()
  headBone.name = 'Head'
  const result = await constructionHair.createHairMaterial({
    colorMap: 'fixture-base-map',
    materialProfiles: [profile],
    angelRingMap: profile.angelRing.texture,
    angelRingMapName: profile.angelRing.texture,
    angelRingReference: {
      headBone,
      localUp: new THREE.Vector3(0, 1, 0),
      localForward: new THREE.Vector3(1, 0, 0),
      headOffset: 0.18,
    },
  })
  try {
    result.material.userData.officialMaterialProfile = profile
    const shader = {
      uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),
      defines: {},
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    }
    result.material.onBeforeCompile(shader, {})
    check(shader)
  } finally {
    result.material.dispose()
    for (const texture of result.textures) texture.dispose()
  }
}

const uvProfiles = Object.entries(generated.materials).filter(([, profile]) =>
  profile.angelRing.enabled && profile.angelRing.uvMode && profile.angelRing.map !== 'none',
)

test('current serialized UV denominator contains all six hair/hair_out material slots', () => {
  assert.deepEqual(uvProfiles.map(([name]) => name).sort(), [
    'mt_chara_108101_hair', 'mt_chara_108101_hair_out',
    'mt_chara_108201_hair', 'mt_chara_108201_hair_out',
    'mt_chara_108301_hair', 'mt_chara_108301_hair_out',
  ])
})

for (const [name, value] of uvProfiles) {
  test(`complete shader assembly includes one UV sample before character tint: ${name}`, async () => {
    await constructHairShader({ ...value, name }, shader => {
      const fragment = shader.fragmentShader
      const samples = [...fragment.matchAll(/texture2D\(\s*tAngelRingMap,\s*vAngelRingUv\s*\)/g)]
      assert.equal(samples.length, 1, 'Sampler binding and vertex varying alone are insufficient')
      const contribution = /outgoingLight\s*\+=\s*rdAngelMap\s*\*\s*uAngelRingColor\s*\*\s*rdAngelCurrentLighting\s*\*\s*rdAngelActive/.exec(fragment)
      assert.ok(contribution, 'Authored UV sample must contribute to outgoing light')
      const tint = fragment.indexOf('outgoingLight *= uGlobalCharacterTint;')
      assert.ok(samples[0].index < contribution.index && contribution.index < tint, 'UV addition must precede the final character tint')
      assert.equal(shader.uniforms.tAngelRingMap.value.name, value.angelRing.texture)
      assert.match(shader.vertexShader, /vAngelRingUv = uv;/)
      assert.doesNotMatch(fragment, /vec2 rdAngelMapUv/)
    })
  })
}

for (const name of [
  'mt_chara_101901_hair', 'mt_chara_101901_hair_out',
  'mt_chara_100101_hair', 'mt_chara_100101_hair_out',
  'mt_chara_115201_hair', 'mt_chara_115201_hair_out',
  'mt_chara_101101_hair_out', 'mt_chara_109201_hair_out', 'mt_chara_112601_hair_out',
]) {
  test(`complete shader assembly retains projected map and shared depth-rim contribution: ${name}`, async () => {
    const profile = { ...generated.materials[name], name }
    assert.equal(constructionHair.resolveOfficialAngelRingBranch(profile), 'projected')
    await constructHairShader(profile, shader => {
      const fragment = shader.fragmentShader
      assert.equal([...fragment.matchAll(/texture2D\(\s*tAngelRingMap,\s*rdAngelMapUv\s*\)/g)].length, 1)
      assert.match(fragment, /rdDepthRimMainCompositeSignal\s*=\s*clamp\(/)
      assert.match(fragment, /rdDepthRimMainCompositeSignal\s*\*\s*uRdDepthRimMainColor/)
      assert.ok(fragment.indexOf('vec2 rdAngelMapUv') < fragment.indexOf('rdDepthRimMainCompositeSignal *'))
      assert.match(shader.vertexShader, /vAngelRingWorldPosition\s*=\s*\(modelMatrix \* vec4\(transformed, 1\.0\)\)\.xyz/)
      assert.doesNotMatch(fragment, /texture2D\(\s*tAngelRingMap,\s*vAngelRingUv/)
      const texture = profile.angelRing.map === 'common' ? 'RDToon_AngelRingMap.png' : profile.angelRing.texture
      assert.equal(shader.uniforms.tAngelRingMap.value.name, texture)
    })
  })
}

for (const name of ['mt_chara_101101_hair', 'mt_chara_109201_hair', 'mt_chara_112601_hair']) {
  test(`complete shader assembly leaves serialized-disabled AngelRing neutral: ${name}`, async () => {
    const profile = { ...generated.materials[name], name }
    assert.equal(profile.angelRing.enabled, false, 'Use the actual serialized disabled slot, not a character-wide override')
    await constructHairShader(profile, shader => {
      assert.equal(shader.uniforms.uAngelRingMaterialEnabled.value, 0)
      assert.equal(shader.uniforms.tAngelRingMap, undefined)
      assert.doesNotMatch(shader.fragmentShader, /rdAngelMapUv|vAngelRingUv/)
    })
  })
}
