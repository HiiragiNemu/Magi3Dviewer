import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import * as THREE from 'three'
import ts from 'typescript'

const document = JSON.parse(fs.readFileSync(
  'magia-exedra-character-three/official-material-profiles.json',
  'utf8',
))
const loaderSource = fs.readFileSync(
  'magia-exedra-character-three/loader.ts',
  'utf8',
)
const shaderSource = fs.readFileSync(
  'magia-exedra-character-three/shaders/namae.ts',
  'utf8',
)
const submeshSource = fs.readFileSync(
  'magia-exedra-character-three/submeshGroups.generated.ts',
  'utf8',
)

function loadTypeScriptCommonJs(path, requireMap = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
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
  Function('exports', 'require', 'module', compiled.outputText)(
    module.exports,
    specifier => {
      if (Object.hasOwn(requireMap, specifier)) return requireMap[specifier]
      throw new Error(`Unexpected import ${specifier} from ${path}`)
    },
    module,
  )
  return module.exports
}

const materialProfiles = loadTypeScriptCommonJs(
  'magia-exedra-character-three/materialProfile.ts',
  {
    './official-material-profiles.json?url':
      'fixture://official-material-profiles.json',
  },
)
await materialProfiles.loadOfficialMaterialProfiles(document)
const userDataModule = loadTypeScriptCommonJs(
  'magia-exedra-character-three/shaders/userdata.ts',
  { three: THREE },
)
const loadedTextures = []
const samplingCalls = []
const customShader = loadTypeScriptCommonJs(
  'magia-exedra-character-three/shaders/namae.ts',
  {
    three: THREE,
    '../texture': {
      async loadTexture(url, properties) {
        const texture = new THREE.Texture()
        Object.assign(texture, properties)
        texture.userData.fixtureUrl = url
        loadedTextures.push(texture)
        return texture
      },
      ApplyOfficialCharacterSurfaceSampling(texture, sourceName, sampler) {
        samplingCalls.push({ texture, sourceName, sampler })
        return { sourceName }
      },
    },
    '../models/chara_113401_model/cloud_noise_tex.png':
      'fixture://cloud_noise_tex.png',
    '.': userDataModule,
  },
)

function submeshCounts(characterId, meshName) {
  const block = submeshSource.match(
    new RegExp(`\\n    ${characterId}: \\{([\\s\\S]*?)\\n    \\},`),
  )?.[1]
  assert.ok(block, `missing generated character ${characterId}`)
  const values = block.match(
    new RegExp(`"${meshName}": \\[([^\\]]+)\\]`),
  )?.[1]
  assert.ok(values, `missing generated mesh ${characterId}/${meshName}`)
  return values.split(',').map(value => Number(value.trim()))
}

test('100805 official Hair_Mesh keeps ordinary/custom/hair_out slots isolated', () => {
  assert.deepEqual(submeshCounts(100805, 'Hair_Mesh'), [10281, 3396, 6030])
  const names = [
    'mt_chara_100805_hair',
    'mt_chara_100805_hair_alpha',
    'mt_chara_100805_hair_out',
  ]
  const profiles = names.map(name =>
    materialProfiles.getOfficialMaterialProfile(name))
  assert.equal(profiles[0].customShader, undefined)
  assert.equal(
    profiles[1].customShader.name,
    'Creative/Character/ReDriveToon-DoppelIroha',
  )
  assert.equal(profiles[2].customShader, undefined)
  assert.equal(profiles[1].customRenderQueue, 2002)
  assert.equal(profiles[1].surface.zWrite, true)
  assert.equal(profiles[1].surface.srcBlend, 1)
  assert.equal(profiles[1].surface.dstBlend, 0)
  assert.equal(profiles[1].stencil.mode, 0)
  assert.equal(profiles[2].customRenderQueue, 2002)
  assert.deepEqual(profiles[2].stencil, {
    mode: 2,
    comparison: 6,
    reference: 128,
    passOperation: 0,
    transparency: 0.75,
  })
  assert.equal(profiles[0].angelRing.enabled, true)
  assert.equal(profiles[1].angelRing.enabled, false)
  assert.equal(profiles[2].angelRing.enabled, true)
})

test('serialized DoppelIroha cosmic fields and sampler remain literal', () => {
  const profile = materialProfiles
    .getOfficialMaterialProfile('mt_chara_100805_hair_alpha')
    .customShader
  assert.equal(profile.baseTexture, 'chara_100805_hair_color')
  assert.equal(profile.shadowTexture, 'chara_100805_hair_shadow')
  assert.equal(profile.controlTexture, 'chara_100805_hair_ctrl')
  assert.equal(profile.cosmicTexture, 'chara_100805_hair_cosmic')
  assert.equal(profile.cosmicNoiseTexture, null)
  assert.equal(profile.isCosmic, true)
  assert.equal(profile.alphaClipping, true)
  assert.deepEqual(profile.fillColor, [0, 1, 0, 1])
  assert.equal(profile.cosmicTiling, 0.20000000298023224)
  assert.deepEqual(profile.cosmicScroll, [0, 0])
  assert.equal(profile.cosmicMaskByControlAlpha, false)
  assert.equal(profile.cosmicNoiseInfluence, 1)
  assert.equal(profile.cosmicNoiseTiling, 1)
  assert.equal(profile.cosmicNoiseSpeed, 1)
  const sampler = materialProfiles.getOfficialTextureSamplerProfile(
    profile.cosmicTexture,
  )
  assert.equal(sampler.width, 512)
  assert.equal(sampler.height, 512)
  assert.equal(sampler.colorSpace, 1)
  assert.equal(sampler.filterMode, 1)
  assert.deepEqual(sampler.slots, ['_CosmicTex'])
})

test('runtime clones the ordinary ReDrive carrier and injects official cosmic branch', async () => {
  const materialProfile = materialProfiles
    .getOfficialMaterialProfile('mt_chara_100805_hair_alpha')
  const profile = materialProfile.customShader
  const base = new THREE.MeshStandardMaterial({ color: 0xffffff })
  base.userData = new userDataModule.MaterialUserData()
  base.onBeforeCompile = function (shader) {
    this.userData.shader = shader
    shader.defines ??= {}
    shader.defines.HAS_CTRL = true
    shader.uniforms.tCtrl = { value: new THREE.Texture() }
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      'void main() { vec4 texCtrl = vec4(1.0);',
    ).replace(
      '#include <opaque_fragment>',
      '// RD_OFFICIAL_COSMIC_COMPOSITE\n#include <opaque_fragment>',
    )
  }
  base.customProgramCacheKey = () => 'fixture-redrive'
  const headBone = new THREE.Object3D()
  headBone.position.set(1, 2, 3)
  headBone.updateMatrixWorld(true)
  const result = await customShader.createOfficialCustomCharacterMaterial({
    profile,
    materialProfile,
    baseMaterial: base,
    cosmicMap: 'fixture://chara_100805_hair_cosmic.png',
    cosmicTextureSampler:
      materialProfiles.getOfficialTextureSamplerProfile(profile.cosmicTexture),
    cosmicReference: {
      headBone,
      localUp: new THREE.Vector3(0, 1, 0),
      localRight: new THREE.Vector3(1, 0, 0),
      localForward: new THREE.Vector3(0, 0, 1),
      headOffset: 0.2,
      characterCancelPerspective: 1,
      bandHalfWidth: 0.03,
      projectionRadius: 0.2,
      uvMode: false,
      estimated: false,
    },
  })
  assert.ok(result.material instanceof THREE.MeshStandardMaterial)
  assert.notEqual(result.material, base)
  assert.equal(result.material.transparent, false)
  assert.equal(result.material.alphaTest, 0.5)
  assert.equal(
    result.material.depthWrite,
    true,
    'DoppelIroha Forward pass must retain serialized _ZWrite=1',
  )
  assert.equal(result.material.userData.officialCompiledPassState, undefined)
  assert.deepEqual(
    result.material.userData.officialCustomCharacterShader.renderStateBinding,
    {
      depthWrite: 'serialized:_ZWrite',
      srcBlend: 'serialized:_SrcBlend',
      dstBlend: 'serialized:_DstBlend',
    },
  )
  assert.equal(result.resources.kind, 'doppel-iroha')
  assert.equal(loadedTextures.length, 1)
  assert.equal(samplingCalls.length, 1)
  assert.equal(samplingCalls[0].sourceName,
    'fixture://chara_100805_hair_cosmic.png')
  assert.equal(result.textures.length, 2)
  assert.ok(result.textures[1] instanceof THREE.DataTexture)

  const shader = {
    defines: {},
    uniforms: {},
    vertexShader: `#include <common>
      void main() { #include <project_vertex> }`,
    fragmentShader: `#include <common>
      void main() {
        vec4 diffuseColor = vec4(1.0);
        #include <opaque_fragment>
      }`,
  }
  result.material.onBeforeCompile(shader, {})
  assert.match(shader.vertexShader, /uOfficialCosmicFacePosition/)
  assert.match(shader.vertexShader, /officialCosmicFaceView = viewMatrix \*/)
  assert.match(
    shader.vertexShader,
    /officialCosmicFaceClip = projectionMatrix \*/,
  )
  assert.match(shader.vertexShader, /officialCosmicFaceView\.z \*/)
  assert.match(shader.vertexShader, /uOfficialCosmicCameraFov \* 0\.015/)
  assert.match(shader.vertexShader, /officialCosmicSafeClipW/)
  assert.match(shader.vertexShader, /uOfficialCosmicAspectFix \/\s*officialCosmicSafeProjectionScale/)
  assert.doesNotMatch(shader.vertexShader, /abs\(officialCosmicFaceView\.z\)/)
  assert.doesNotMatch(shader.vertexShader, /uOfficialCosmicCancelPerspective/)
  assert.match(shader.fragmentShader, /officialCosmicRgbToHsv/)
  assert.match(shader.fragmentShader, /officialCosmicOverlay/)
  assert.match(shader.fragmentShader, /officialCosmicProjection3/)
  assert.match(shader.fragmentShader, /officialCosmicProjection9/)
  assert.match(
    shader.fragmentShader,
    /vec2 officialCosmicRectHalf = vOfficialCosmicFaceRect\.zw/,
  )
  assert.doesNotMatch(
    shader.fragmentShader,
    /abs\(vOfficialCosmicFaceRect\.zw\)/,
  )
  assert.match(shader.fragmentShader, /officialCosmicNoiseA/)
  assert.match(shader.fragmentShader, /officialCosmicNoiseB/)
  assert.match(shader.fragmentShader, /uOfficialCosmicTime \* 0\.1/)
  assert.match(
    shader.fragmentShader,
    /2\.0 \* officialCosmicNoise \* officialCosmicNoise - 1\.0/,
  )
  assert.match(shader.fragmentShader, /uOfficialCosmicMaskByControlAlpha/)
  assert.match(shader.fragmentShader, /outgoingLight = mix/)
  assert.ok(
    shader.fragmentShader.indexOf('outgoingLight = mix') <
    shader.fragmentShader.indexOf('#include <opaque_fragment>'),
  )
  assert.equal(shader.uniforms.uOfficialCosmicTiling.value,
    0.20000000298023224)
  assert.deepEqual(shader.uniforms.uOfficialCosmicScroll.value.toArray(), [0, 0])

  const renderer = {
    getRenderTarget: () => null,
    getDrawingBufferSize(value) { return value.set(1600, 900) },
  }
  const camera = new THREE.PerspectiveCamera(40, 16 / 9)
  assert.doesNotThrow(() =>
    customShader.setOfficialCustomCharacterRuntimeUniforms(
      { uniforms: {} },
      renderer,
      camera,
      result.resources,
    ),
    'camera-depth override without Doppel forward uniforms must be ignored',
  )
  customShader.setOfficialCustomCharacterRuntimeUniforms(
    shader,
    renderer,
    camera,
    result.resources,
  )
  assert.deepEqual(
    shader.uniforms.uOfficialCosmicViewport.value.toArray(),
    [1600, 900],
  )
  assert.deepEqual(
    shader.uniforms.uOfficialCosmicFacePosition.value.toArray(),
    [1, 2.2, 3],
  )
  assert.deepEqual(
    shader.uniforms.uOfficialCosmicAspectFix.value.toArray(),
    [0.5625, 1],
  )
  assert.equal(shader.uniforms.uOfficialCosmicCameraFov.value, 40)
  assert.equal(shader.uniforms.uOfficialCosmicOrthographic.value, 0)
  assert.equal(shader.uniforms.uOfficialCosmicCancelPerspective, undefined)
})

test('Doppel face rectangle preserves official signed view-depth mapping', () => {
  const faceViewZ = -8
  const fov = 40
  const aspectFix = [0.5625, 1]
  const signedScale = faceViewZ * fov * 0.015
  const half = aspectFix.map(value => value / signedScale)
  assert.deepEqual(half, [-0.1171875, -0.20833333333333334])

  const center = [0.1, -0.2]
  const fragment = [0.2, 0.1]
  const official = fragment.map((value, index) =>
    (value - (center[index] - half[index])) / (2 * half[index]))
  const absMirrored = fragment.map((value, index) =>
    (value - (center[index] - Math.abs(half[index]))) /
      (2 * Math.abs(half[index])))
  assert.notDeepEqual(official, absMirrored)
  assert.ok(Math.abs(official[0] - 0.07333333333333333) < 1e-12)
  assert.ok(Math.abs(official[1] + 0.22) < 1e-12)
})

test('loader routes custom shaders per material slot without a character exception', () => {
  assert.match(loaderSource, /customShaderSlots/)
  assert.match(loaderSource, /customMaterialOverrides/)
  assert.match(loaderSource, /customShaderResourcesBySlot/)
  assert.match(loaderSource, /officialCustomCharacterShaderSlots/)
  assert.match(loaderSource, /setOfficialCustomCharacterRuntimeUniforms/)
  assert.doesNotMatch(loaderSource, /characterId\s*={2,3}\s*100805/)
  assert.doesNotMatch(loaderSource, /name\.includes\(['"]doppel/i)
  assert.match(shaderSource, /profile\.name === DOPPEL_IROHA_SHADER/)
  assert.match(shaderSource, /DoppelIroha\/pass3\/blob19/)
  assert.match(loaderSource,
    /compiledPassState\?\.depthWrite \?\? surface\.zWrite/)
})

test('four protected neighbors and Namae remain outside the Doppel branch', () => {
  for (const [character, material] of [
    ['100102', 'mt_chara_100102_face'],
    ['108301', 'mt_chara_108301_face'],
    ['101901', 'mt_chara_101901_body_sj'],
    ['100107', 'mt_chara_100101_body_sj'],
  ]) {
    const profile = materialProfiles.getOfficialMaterialProfile(material)
    assert.equal(profile.customShader, undefined,
      `${character} unexpectedly entered a custom shader branch`)
  }
  const namae = materialProfiles
    .getOfficialMaterialProfile('NamaeShader_Body')
    .customShader
  assert.equal(namae.name, 'Creative/Character/NamaeShader')
  assert.equal(namae.isCosmic, false)
  assert.equal(customShader.supportsOfficialCustomCharacterShader(namae), true)
})
