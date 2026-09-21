import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as THREE from 'three'
import ts from 'typescript'

function loadTypeScriptCommonJs(path, requireMap = {}) {
  const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
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
    if (Object.hasOwn(requireMap, specifier)) return requireMap[specifier]
    throw new Error(`Unexpected fixture import ${specifier} from ${path}`)
  }
  Function('exports', 'require', 'module', compiled.outputText)(
    module.exports,
    localRequire,
    module,
  )
  return module.exports
}

function pngDimensions(path) {
  const bytes = readFileSync(path)
  assert.equal(bytes.toString('ascii', 1, 4), 'PNG')
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}

test('official metallic gradient uses its serialized one-level bilinear sampler', () => {
  const texture = loadTypeScriptCommonJs(
    'magia-exedra-character-three/texture.ts',
    {
      three: THREE,
      './materialProfile': {
        getOfficialTextureSamplerProfile: () => undefined,
      },
      './officialTextureContainer': {
        getOfficialCompressedTextureState: () => undefined,
        loadOfficialCompressedTexture: async () => undefined,
      },
      './renderer': { renderer: undefined },
    },
  )
  assert.equal(
    typeof texture.ApplyOfficialSpecularGradientSampling,
    'function',
  )

  const gradient = new THREE.Texture()
  gradient.colorSpace = THREE.SRGBColorSpace
  gradient.generateMipmaps = true
  gradient.minFilter = THREE.LinearMipmapLinearFilter
  gradient.magFilter = THREE.NearestFilter
  gradient.anisotropy = 16
  gradient.wrapS = THREE.RepeatWrapping
  gradient.wrapT = THREE.MirroredRepeatWrapping

  texture.ApplyOfficialSpecularGradientSampling(gradient)

  // Unity Texture2D serialization for the JP 2022.3.62f2 asset:
  // m_ColorSpace=0 (TextureColorSpace.Linear), m_MipCount=1,
  // FilterMode=Bilinear, Aniso=1, WrapU/V=Clamp.
  assert.equal(gradient.colorSpace, THREE.NoColorSpace)
  assert.equal(gradient.generateMipmaps, false)
  assert.equal(gradient.minFilter, THREE.LinearFilter)
  assert.equal(gradient.magFilter, THREE.LinearFilter)
  assert.equal(gradient.anisotropy, 1)
  assert.equal(gradient.wrapS, THREE.ClampToEdgeWrapping)
  assert.equal(gradient.wrapT, THREE.ClampToEdgeWrapping)
})

test('100107 and 101901 ship the same official 256 by 2 gradient carrier', () => {
  for (const characterId of [100107, 101901]) {
    assert.deepEqual(
      pngDimensions(
        `magia-exedra-character-three/models/chara_${characterId}_battle_unit/` +
          'RDToon_metallic_gradient_map.png',
      ),
      [256, 2],
    )
  }
})

test('compiled character shader uses SH, MatCap and gradient but no SpecCube', () => {
  const official = readFileSync(
    'artifacts/verification/20260820-hair-hard-shadow-official-input/' +
      'official-selfshadow-variants/main_hair_reference_blob-98.glsl',
    'utf8',
  )
  assert.match(official, /Xhlslcc_UnusedXunity_SpecCube0_HDR/)
  assert.match(official, /dot\(unity_SHAr,/)
  assert.match(official, /texture\(_MatCapTex,/)
  assert.match(official, /texture\(_SpecularGradientMap,/)
  assert.doesNotMatch(official, /texture\(unity_SpecCube/)
})
