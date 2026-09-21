import { actualLoadingProgress, textureAssetUrlImports } from './textureTestImports.mjs'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import * as THREE from 'three'
import ts from 'typescript'

const read = path => readFileSync(path, 'utf8')
const profilePath = 'magia-exedra-character-three/materialProfile.ts'
const texturePath = 'magia-exedra-character-three/texture.ts'
const containerPath =
  'magia-exedra-character-three/officialTextureContainer.ts'
const payloadRegistryPath =
  'magia-exedra-character-three/officialHairTexturePayload.ts'
const payloadRoot =
  'magia-exedra-character-three/official-textures/hair'
const generalPath = 'magia-exedra-character-three/shaders/general.ts'
const facePath = 'magia-exedra-character-three/shaders/face.ts'
const userDataPath = 'magia-exedra-character-three/shaders/userdata.ts'
const extractorPath = 'scripts/extract-official-material-profiles.py'
const generatedPath = 'magia-exedra-character-three/official-material-profiles.json'

const profileSource = read(profilePath)
const textureSource = read(texturePath)
const containerSource = read(containerPath)
const payloadRegistrySource = read(payloadRegistryPath)
const generalSource = read(generalPath)
const faceSource = read(facePath)
const userDataSource = read(userDataPath)
const extractorSource = read(extractorPath)
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

test('generated profile carries the current serialized surface sampler corpus', () => {
  assert.equal(generated.schema, 4)
  assert.equal(generated.unityVersion, '2022.3.62f2')
  assert.equal(
    generated.textureSamplerCount,
    Object.keys(generated.textureSamplers).length,
  )
  assert.ok(generated.textureSamplerCount > 1000)
  assert.deepEqual(generated.textureSamplerTexEnv, {
    scale: [1, 1],
    offset: [0, 0],
  })
  assert.equal(generated.textureSamplerConflicts, 0)

  const samplers = Object.values(generated.textureSamplers)
  assert.ok(samplers.some(row => row.mipCount === 1))
  assert.ok(samplers.some(row => row.mipCount > 1))
  for (const row of samplers) {
    assert.equal(row.filterMode, 1, row.name)
    assert.equal(row.aniso, 1, row.name)
    assert.equal(row.mipBias, 0, row.name)
    const expectedWrap = row.name === 'chara_115201_hairhighlight'
      ? 2
      : row.name === 'rdtoon_angelringmap'
        ? 1
        : 0
    assert.equal(row.wrapU, expectedWrap, row.name)
    assert.equal(row.wrapV, expectedWrap, row.name)
    assert.equal(row.wrapW, expectedWrap, row.name)
    assert.ok(row.colorSpace === 0 || row.colorSpace === 1, row.name)
  }
})

test('four protected character families resolve Base Shadow and Control without IDs in the consumer', () => {
  const required = [
    'chara_100102_hair',
    'chara_108301_hair',
    'chara_101901_hair',
    'chara_100101_hair',
  ]
  for (const prefix of required) {
    for (const suffix of ['color', 'shadow', 'ctrl']) {
      const name = `${prefix}_${suffix}`
      const row = generated.textureSamplers[name]
      assert.ok(row, name)
      assert.equal(row.filterMode, 1, name)
      assert.equal(row.aniso, 1, name)
      assert.equal(row.mipBias, 0, name)
      assert.equal(row.wrapU, 0, name)
      assert.equal(row.wrapV, 0, name)
      assert.equal(row.colorSpace, suffix === 'ctrl' ? 0 : 1, name)
    }
  }

  for (const name of [
    'chara_108301_hair_color',
    'chara_108301_hair_shadow',
    'chara_108301_hair_ctrl',
  ]) {
    assert.deepEqual(
      [
        generated.textureSamplers[name].width,
        generated.textureSamplers[name].height,
        generated.textureSamplers[name].mipCount,
      ],
      [1024, 1024, 11],
      name,
    )
  }

  const helperStart = textureSource.indexOf(
    'export function ApplyOfficialCharacterSurfaceSampling',
  )
  const helperEnd = textureSource.indexOf(
    'export function MaximizeTextureQuality',
    helperStart,
  )
  assert.ok(helperStart >= 0 && helperEnd > helperStart)
  assert.doesNotMatch(
    textureSource.slice(helperStart, helperEnd),
    /100102|108301|101901|100107|100101/,
  )
})

test('108301 hair source pixels are the fresh current Steam exports', () => {
  const evidenceRoot = [
    'artifacts/verification/',
    '20260824-108301-hair-cheek-shadow-visual-fail/',
    'iteration-17-official-hair-texture-contract/evidence/',
  ].join('')
  const modelRoot = [
    'magia-exedra-character-three/models/',
    'chara_108301_battle_unit/',
  ].join('')
  for (const suffix of ['color', 'shadow', 'ctrl', 'highlight']) {
    assert.deepEqual(
      readFileSync(`${modelRoot}chara_108301_hair_${suffix}.png`),
      readFileSync(`${evidenceRoot}steam-chara_108301_hair_${suffix}.png`),
      suffix,
    )
  }
})

test('profile lookup normalizes emitted URLs and preserves literal sampler fields', async () => {
  const profileModule = loadTypeScriptModule(profileSource, profilePath, {
    './official-material-profiles.json?url': 'official-material-profiles.json',
  })
  await profileModule.loadOfficialMaterialProfiles(generated)
  const sampler = profileModule.getOfficialTextureSamplerProfile(
    'https://fixture/assets/CHARA_108301_HAIR_COLOR.PNG?cache=1',
  )
  assert.deepEqual(
    {
      name: sampler.name,
      slots: sampler.slots,
      width: sampler.width,
      height: sampler.height,
      textureFormat: sampler.textureFormat,
      mipCount: sampler.mipCount,
      colorSpace: sampler.colorSpace,
      filterMode: sampler.filterMode,
      aniso: sampler.aniso,
      mipBias: sampler.mipBias,
      wrapU: sampler.wrapU,
      wrapV: sampler.wrapV,
      wrapW: sampler.wrapW,
    },
    generated.textureSamplers.chara_108301_hair_color,
  )

  const emitted = profileModule.getOfficialTextureSamplerProfile(
    'https://fixture/assets/chara_108301_hair_color-BEuqtC_s.png',
  )
  assert.equal(emitted.name, 'chara_108301_hair_color')
  assert.equal(emitted.filterMode, 1)
  assert.equal(emitted.aniso, 1)
  assert.equal(emitted.mipCount, 11)
})

test('runtime sampler applies Unity bilinear mip selection and preserves single-mip maps', () => {
  const textureModule = loadTypeScriptModule(textureSource, texturePath, {
    './loadingProgress.ts': actualLoadingProgress,
    ...textureAssetUrlImports,
    three: THREE,
    './materialProfile': { getOfficialTextureSamplerProfile: () => undefined },
    './officialTextureContainer': {
      getOfficialCompressedTextureState: texture =>
        texture.userData.officialCompressedPayload,
      loadOfficialCompressedTexture: async () => undefined,
    },
    './renderer': { renderer: undefined },
  })
  const apply = textureModule.ApplyOfficialCharacterSurfaceSampling
  const texture = new THREE.Texture()
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.anisotropy = 16
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  const state = apply(
    texture,
    'chara_108301_hair_color.png',
    generated.textureSamplers.chara_108301_hair_color,
  )
  assert.equal(texture.colorSpace, THREE.SRGBColorSpace)
  assert.equal(texture.generateMipmaps, true)
  assert.equal(texture.magFilter, THREE.LinearFilter)
  assert.equal(texture.minFilter, THREE.LinearMipmapNearestFilter)
  assert.equal(texture.anisotropy, 1)
  assert.equal(texture.wrapS, THREE.RepeatWrapping)
  assert.equal(texture.wrapT, THREE.RepeatWrapping)
  assert.equal(state.authority, 'official-serialized')
  assert.equal(state.serializedMipBias, 0)

  const singleMipProfile = Object.values(generated.textureSamplers)
    .find(row => row.mipCount === 1)
  assert.ok(singleMipProfile)
  const singleMip = new THREE.Texture()
  apply(singleMip, `${singleMipProfile.name}.png`, singleMipProfile)
  assert.equal(singleMip.generateMipmaps, false)
  assert.equal(singleMip.minFilter, THREE.LinearFilter)

  const unresolved = new THREE.Texture()
  const fallback = apply(
    unresolved,
    'future_official_surface.png',
    undefined,
  )
  assert.equal(fallback.authority, 'viewer-fallback')
  assert.equal(fallback.profileName, null)
  assert.equal(unresolved.minFilter, THREE.LinearMipmapLinearFilter)

  const exact = new THREE.CompressedTexture([], 1024, 1024)
  exact.userData.officialCompressedPayload = {
    rawBytes: 699064,
    requiredExtension: 'WEBGL_compressed_texture_s3tc',
  }
  const exactState = apply(
    exact,
    'chara_108301_hair_color-BEuqtC_s.png',
    generated.textureSamplers.chara_108301_hair_color,
  )
  assert.equal(exact.generateMipmaps, false)
  assert.equal(exact.minFilter, THREE.LinearMipmapNearestFilter)
  assert.equal(exact.anisotropy, 1)
  assert.equal(exactState.mipSource, 'official-container')
  assert.equal(exactState.officialPayloadBytes, 699064)
})

test('fresh Steam DDS wrappers reopen as exact DXT1 DXT5 and BC7 mip spans', () => {
  const containerModule = loadTypeScriptModule(
    containerSource,
    containerPath,
    {
      three: THREE,
      './officialHairTexturePayload': {
        getOfficialHairTexturePayload: () => undefined,
      },
      './officialFaceTexturePayload': {
        getOfficialFaceTexturePayload: () => undefined,
      },
    },
  )
  const parse = containerModule.parseOfficialCompressedTexture
  const expectedNames = [
    'RDToon_AngelRingMap',
    'chara_100101_hair_color',
    'chara_100101_hair_ctrl',
    'chara_100101_hair_shadow',
    'chara_100102_hair_color',
    'chara_100102_hair_ctrl',
    'chara_100102_hair_shadow',
    'chara_100805_hair_color',
    'chara_100805_hair_ctrl',
    'chara_100805_hair_shadow',
    'chara_101901_hair_color',
    'chara_101901_hair_ctrl',
    'chara_101901_hair_shadow',
    'chara_108301_hair_color',
    'chara_108301_hair_ctrl',
    'chara_108301_hair_highlight',
    'chara_108301_hair_shadow',
  ]
  assert.deepEqual(
    readdirSync(payloadRoot).sort(),
    expectedNames.map(name => `${name}.dds`).sort(),
  )

  const mipBytes = (width, height, format) =>
    Math.max(1, Math.ceil(width / 4))
      * Math.max(1, Math.ceil(height / 4))
      * (format === 10 ? 8 : 16)
  const parseFixture = (name, profile, overrides = {}) => {
    const width = overrides.width ?? profile.width
    const height = overrides.height ?? profile.height
    const textureFormat = overrides.textureFormat ?? profile.textureFormat
    const mipCount = overrides.mipCount ?? profile.mipCount
    const colorSpace = overrides.colorSpace ?? profile.colorSpace
    const rawBytes = Array.from({ length: mipCount }, (_, level) =>
      mipBytes(
        Math.max(1, width >> level),
        Math.max(1, height >> level),
        textureFormat,
      )).reduce((sum, value) => sum + value, 0)
    const headerBytes = textureFormat === 25 ? 148 : 128
    const bytes = readFileSync(`${payloadRoot}/${name}.dds`)
    const payload = {
      name,
      url: `${name}.dds`,
      sourceRegion: 'Steam-JP',
      unityVersion: '2022.3.62f2',
      width,
      height,
      textureFormat,
      mipCount,
      colorSpace,
      rawBytes,
      containerBytes: rawBytes + headerBytes,
      requiredExtension: textureFormat === 25
        ? 'EXT_texture_compression_bptc'
        : 'WEBGL_compressed_texture_s3tc',
    }
    assert.equal(bytes.length, payload.containerBytes, name)
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    )
    const texture = parse(buffer, payload, profile)
    assert.equal(texture.name, name)
    assert.equal(texture.mipmaps.length, mipCount)
    assert.equal(
      texture.mipmaps.reduce((sum, mip) => sum + mip.data.byteLength, 0),
      rawBytes,
    )
    assert.equal(texture.flipY, false)
    assert.equal(texture.generateMipmaps, false)
    assert.equal(
      texture.userData.officialCompressedPayload.authority,
      'fresh-current-Steam-JP-serialized-Texture2D',
    )
    return texture
  }

  const dxt1 = parseFixture(
    'chara_100102_hair_color',
    generated.textureSamplers.chara_100102_hair_color,
  )
  assert.equal(dxt1.format, THREE.RGB_S3TC_DXT1_Format)
  const dxt5 = parseFixture(
    'chara_100805_hair_shadow',
    generated.textureSamplers.chara_100805_hair_shadow,
  )
  assert.equal(dxt5.format, THREE.RGBA_S3TC_DXT5_Format)
  const bc7 = parseFixture(
    'chara_100102_hair_ctrl',
    generated.textureSamplers.chara_100102_hair_ctrl,
  )
  assert.equal(bc7.format, THREE.RGBA_BPTC_Format)
  parseFixture(
    'chara_108301_hair_highlight',
    generated.textureSamplers.chara_108301_hair_highlight,
  )
  parseFixture('RDToon_AngelRingMap', undefined, {
    width: 512,
    height: 512,
    textureFormat: 25,
    mipCount: 1,
    colorSpace: 0,
  })
})

test('official payload registry resolves emitted URLs by Texture2D name', () => {
  const fixtureImports = Object.fromEntries(
    [...payloadRegistrySource.matchAll(/import \w+ from '([^']+)'/g)]
      .map(([, specifier]) => [specifier, specifier]),
  )
  const registry = loadTypeScriptModule(
    payloadRegistrySource,
    payloadRegistryPath,
    fixtureImports,
  )
  assert.equal(registry.listOfficialHairTexturePayloads().length, 17)
  const payload = registry.getOfficialHairTexturePayload(
    'https://fixture/assets/chara_100101_hair_ctrl-BEuqtC_s.png',
  )
  assert.equal(payload.name, 'chara_100101_hair_ctrl')
  assert.equal(payload.textureFormat, 25)
  assert.equal(payload.mipCount, 11)
  assert.equal(payload.rawBytes, 1398128)
  assert.equal(payload.requiredExtension, 'EXT_texture_compression_bptc')
  assert.equal(
    registry.getOfficialHairTexturePayload(
      'https://fixture/assets/chara_100101_body_ctrl-BEuqtC_s.png',
    ),
    undefined,
  )
})

test('general material consumes exact profiles and publishes actual sampler state', () => {
  assert.match(extractorSource, /SURFACE_TEXTURE_SLOTS/)
  assert.match(extractorSource, /textureSamplerTexEnv/)
  assert.match(profileSource, /getOfficialTextureSamplerProfile/)
  assert.match(profileSource, /Vite emits production assets/)
  assert.match(textureSource, /loadOfficialCompressedTexture/)
  assert.match(textureSource, /hasSerializedMipmaps && !exactPayload/)
  assert.match(containerSource, /parseOfficialCompressedTexture/)
  assert.match(payloadRegistrySource, /fresh-current|sourceRegion: 'Steam-JP'/)
  assert.doesNotMatch(
    `${textureSource}\n${containerSource}`,
    /100102|108301|101901|100107|100805/,
  )
  assert.match(textureSource, /ApplyOfficialCharacterSurfaceSampling/)
  assert.match(generalSource, /getOfficialTextureSamplerProfile/)
  assert.match(generalSource, /ApplyOfficialCharacterSurfaceSampling/)
  assert.doesNotMatch(
    generalSource,
    /MaximizeTextureQuality\(colorTex,\s*shadowTex,\s*ctrlTex\)/,
  )
  assert.match(generalSource, /userData\.officialTextureSampling\s*=/)
  assert.match(faceSource, /getOfficialTextureSamplerProfile/)
  assert.match(faceSource, /ApplyOfficialCharacterSurfaceSampling/)
  assert.doesNotMatch(
    faceSource,
    /MaximizeTextureQuality\(\s*colorTex,\s*shadowTex/,
  )
  assert.match(faceSource, /userData\.officialTextureSampling\s*=/)
  assert.match(userDataSource, /officialTextureSampling\?:/)
})
