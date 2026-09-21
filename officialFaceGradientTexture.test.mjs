import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import * as THREE from 'three'
import ts from 'typescript'

const containerPath = 'magia-exedra-character-three/officialTextureContainer.ts'
const registryPath = 'magia-exedra-character-three/officialFaceTexturePayload.ts'
const texturePath = 'magia-exedra-character-three/texture.ts'
const facePath = 'magia-exedra-character-three/shaders/face.ts'
const payloadRoot = 'magia-exedra-character-three/official-textures/face'
const generatedPath = 'magia-exedra-character-three/official-material-profiles.json'

const read = path => readFileSync(path, 'utf8')
const containerSource = read(containerPath)
const registrySource = read(registryPath)
const textureSource = read(texturePath)
const faceSource = read(facePath)
const generated = JSON.parse(read(generatedPath))

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

function registryModule() {
  const imports = Object.fromEntries(
    [...registrySource.matchAll(/import \w+ from '([^']+)'/g)]
      .map(([, specifier]) => [specifier, specifier]),
  )
  return loadTypeScriptModule(registrySource, registryPath, imports)
}

function containerModule() {
  return loadTypeScriptModule(containerSource, containerPath, {
    three: THREE,
    './officialHairTexturePayload': {
      getOfficialHairTexturePayload: () => undefined,
    },
    './officialFaceTexturePayload': {
      getOfficialFaceTexturePayload: () => undefined,
    },
  })
}

function textureModule() {
  return loadTypeScriptModule(textureSource, texturePath, {
    three: THREE,
    './materialProfile': { getOfficialTextureSamplerProfile: () => undefined },
    './officialTextureContainer': {
      getOfficialCompressedTextureState: texture =>
        texture.userData.officialCompressedPayload,
      loadOfficialCompressedTexture: async () => undefined,
    },
    './renderer': { renderer: undefined },
  })
}

test('fresh Steam face registry resolves exact and emitted Texture2D names', () => {
  assert.deepEqual(readdirSync(payloadRoot).sort(), [
    'chara_100202_face_ctrl.dds',
    'face_ctrl_base.dds',
    'face_ctrl_nose.dds',
  ])
  const registry = registryModule()
  assert.equal(registry.listOfficialFaceTexturePayloads().length, 3)
  const base = registry.getOfficialFaceTexturePayload(
    'https://fixture/assets/face_ctrl_base-BljCJBTs.png',
  )
  assert.deepEqual(
    {
      name: base.name,
      width: base.width,
      height: base.height,
      textureFormat: base.textureFormat,
      mipCount: base.mipCount,
      colorSpace: base.colorSpace,
      rawBytes: base.rawBytes,
      containerBytes: base.containerBytes,
      requiredExtension: base.requiredExtension,
    },
    {
      name: 'face_ctrl_base',
      width: 1024,
      height: 1024,
      textureFormat: 24,
      mipCount: 1,
      colorSpace: 0,
      rawBytes: 1048576,
      containerBytes: 1048724,
      requiredExtension: 'EXT_texture_compression_bptc',
    },
  )
  assert.equal(
    registry.getOfficialFaceTexturePayload('face_ctrl_nose.png').rawBytes,
    65536,
  )
  const akumaHomura = registry.getOfficialFaceTexturePayload(
    'https://fixture/assets/chara_100202_face_ctrl-3r6pJSWe.png',
  )
  assert.deepEqual(
    {
      name: akumaHomura.name,
      width: akumaHomura.width,
      height: akumaHomura.height,
      textureFormat: akumaHomura.textureFormat,
      mipCount: akumaHomura.mipCount,
      colorSpace: akumaHomura.colorSpace,
      rawBytes: akumaHomura.rawBytes,
      containerBytes: akumaHomura.containerBytes,
    },
    {
      name: 'chara_100202_face_ctrl',
      width: 1024,
      height: 1024,
      textureFormat: 24,
      mipCount: 1,
      colorSpace: 0,
      rawBytes: 1048576,
      containerBytes: 1048724,
    },
  )
  assert.equal(
    registry.getOfficialFaceTexturePayload('face_ctrl_future.png'),
    undefined,
  )
})

test('BC6H DDS wrappers reopen as DXGI 95 with exact single mip spans', () => {
  const parse = containerModule().parseOfficialCompressedTexture
  const registry = registryModule()
  for (const payload of registry.listOfficialFaceTexturePayloads()) {
    const bytes = readFileSync(`${payloadRoot}/${payload.name}.dds`)
    assert.equal(bytes.length, payload.containerBytes)
    assert.equal(bytes.readUInt32LE(128), 95)
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    )
    const texture = parse(buffer, payload)
    assert.equal(texture.format, THREE.RGB_BPTC_UNSIGNED_Format)
    assert.equal(texture.mipmaps.length, 1)
    assert.equal(texture.mipmaps[0].data.byteLength, payload.rawBytes)
    assert.equal(texture.colorSpace, THREE.NoColorSpace)
    assert.equal(texture.flipY, false)
    assert.equal(texture.generateMipmaps, false)
    assert.equal(
      texture.userData.officialCompressedPayload.textureFormat,
      24,
    )
  }
})

test('FaceGradient sampler restores serialized linear bilinear aniso1 repeat state', () => {
  const apply = textureModule().ApplyOfficialFaceGradientSampling
  const texture = new THREE.CompressedTexture([], 1024, 1024)
  texture.userData.officialCompressedPayload = {
    authority: 'fresh-current-Steam-JP-serialized-Texture2D',
    name: 'face_ctrl_base',
    sourceRegion: 'Steam-JP',
    unityVersion: '2022.3.62f2',
    width: 1024,
    height: 1024,
    textureFormat: 24,
    mipCount: 1,
    colorSpace: 0,
    rawBytes: 1048576,
    containerBytes: 1048724,
    requiredExtension: 'EXT_texture_compression_bptc',
    flipY: false,
  }
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = true
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.anisotropy = 16
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.MirroredRepeatWrapping
  const state = apply(texture, 'face_ctrl_base-BljCJBTs.png')
  assert.equal(texture.colorSpace, THREE.NoColorSpace)
  assert.equal(texture.flipY, false)
  assert.equal(texture.generateMipmaps, false)
  assert.equal(texture.magFilter, THREE.LinearFilter)
  assert.equal(texture.minFilter, THREE.LinearFilter)
  assert.equal(texture.anisotropy, 1)
  assert.equal(texture.wrapS, THREE.RepeatWrapping)
  assert.equal(texture.wrapT, THREE.RepeatWrapping)
  assert.equal(state.textureFormat, 24)
  assert.equal(state.dxgiFormat, 95)
  assert.equal(state.rawBytes, 1048576)
})

test('character-specific FaceGradient uses the same exact Steam BC6H contract', () => {
  const apply = textureModule().ApplyOfficialFaceGradientSampling
  const texture = new THREE.CompressedTexture([], 1024, 1024)
  texture.userData.officialCompressedPayload = {
    authority: 'fresh-current-Steam-JP-serialized-Texture2D',
    name: 'chara_100202_face_ctrl',
    sourceRegion: 'Steam-JP',
    unityVersion: '2022.3.62f2',
    width: 1024,
    height: 1024,
    textureFormat: 24,
    mipCount: 1,
    colorSpace: 0,
    rawBytes: 1048576,
    containerBytes: 1048724,
    requiredExtension: 'EXT_texture_compression_bptc',
    flipY: false,
  }
  const state = apply(
    texture,
    'https://fixture/assets/chara_100202_face_ctrl-3r6pJSWe.png',
  )
  assert.equal(state.name, 'chara_100202_face_ctrl')
  assert.equal(state.textureFormat, 24)
  assert.equal(state.dxgiFormat, 95)
  assert.equal(texture.colorSpace, THREE.NoColorSpace)
  assert.equal(texture.flipY, false)
  assert.equal(texture.generateMipmaps, false)
  assert.equal(texture.wrapS, THREE.RepeatWrapping)
  assert.equal(texture.wrapT, THREE.RepeatWrapping)
})

test('five protected neighbors keep profile-driven FaceGradient routing', () => {
  const matrix = [
    ['100102', 'mt_chara_100102_face'],
    ['108301', 'mt_chara_108301_face'],
    ['101901', 'mt_chara_101901_face'],
    ['100107', 'mt_chara_100101_face'],
    ['100805', 'mt_chara_100805_face'],
  ]
  for (const [characterId, material] of matrix) {
    assert.equal(
      generated.materials[material]?.face?.useGradientMap,
      true,
      `${characterId}: ${material}`,
    )
  }
  const helperStart = textureSource.indexOf(
    'export function ApplyOfficialFaceGradientSampling',
  )
  const helperEnd = textureSource.indexOf(
    '/** Match shader/redrive_toon',
    helperStart,
  )
  assert.ok(helperStart >= 0 && helperEnd > helperStart)
  assert.doesNotMatch(
    `${textureSource.slice(helperStart, helperEnd)}
${containerSource}`,
    /100102|108301|101901|100107|100805/,
  )
})

test('compiled formula remains literal and consumer removes PNG quality override', () => {
  assert.match(faceSource, /rdFaceForward \* 0\.111/)
  assert.match(faceSource, /rdFaceRight \* 0\.333/)
  assert.match(faceSource, /0\.985 - \(rdFaceDirection\.y \* 0\.5 \+ 0\.5\)/)
  assert.match(faceSource, /rdFaceThreshold - 0\.01/)
  assert.match(faceSource, /ApplyOfficialFaceGradientSampling\(\s*ctrlTex/)
  assert.match(faceSource, /ApplyOfficialFaceGradientSampling\(\s*noseGradientTex/)
  assert.doesNotMatch(
    faceSource,
    /MaximizeTextureQuality\(ctrlTex|MaximizeTextureQuality\(noseGradientTex/,
  )
  assert.doesNotMatch(
    faceSource,
    /camera.*gradient.*(?:clamp|limit)|skull|head.*mask/i,
  )
})

test('production fallbacks preserve serialized face-control identity before Vite transport', () => {
  assert.match(
    faceSource,
    /const OFFICIAL_FACE_CTRL_BASE_TEXTURE = 'face_ctrl_base'/,
  )
  assert.match(
    faceSource,
    /const OFFICIAL_FACE_CTRL_NOSE_TEXTURE = 'face_ctrl_nose'/,
  )
  assert.match(
    faceSource,
    /const faceGradientSource = options\.ctrlMap \|\| OFFICIAL_FACE_CTRL_BASE_TEXTURE/,
  )
  assert.match(
    faceSource,
    /const noseGradientSource = options\.noseGradientMap \|\| OFFICIAL_FACE_CTRL_NOSE_TEXTURE/,
  )
  assert.match(faceSource, /loadTexture\(faceGradientSource\)/)
  assert.match(faceSource, /loadTexture\(noseGradientSource\)/)
  assert.match(
    faceSource,
    /ApplyOfficialFaceGradientSampling\(\s*ctrlTex,\s*faceGradientSource/,
  )
  assert.match(
    faceSource,
    /ApplyOfficialFaceGradientSampling\(\s*noseGradientTex,\s*noseGradientSource/,
  )
  assert.doesNotMatch(faceSource, /import FaceCtrl(?:Base|Nose)/)
  assert.doesNotMatch(faceSource, /data:image\/png/)
})
