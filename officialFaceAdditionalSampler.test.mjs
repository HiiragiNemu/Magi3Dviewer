import { actualLoadingProgress, textureAssetUrlImports } from './textureTestImports.mjs'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import * as THREE from 'three'
import ts from 'typescript'

const texturePath = 'magia-exedra-character-three/texture.ts'
const facePath = 'magia-exedra-character-three/shaders/face.ts'
const loaderPath = 'magia-exedra-character-three/loader.ts'
const generatedPath =
  'magia-exedra-character-three/official-material-profiles.json'
const evidencePath = [
  'artifacts/verification/',
  '20260824-108301-hair-cheek-shadow-visual-fail/',
  'iteration-05-official-face-additional-sampler/',
  'official-evidence/steam/official-face-additional-four-fixtures.json',
].join('')

const textureSource = readFileSync(texturePath, 'utf8')
const faceSource = readFileSync(facePath, 'utf8')
const loaderSource = readFileSync(loaderPath, 'utf8')
const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
const generated = JSON.parse(readFileSync(generatedPath, 'utf8'))
const liveBinding = JSON.parse(readFileSync(
  'artifacts/research/20260828-fresh-tw-eye-texture-binding-authority/' +
    'fresh-tw-eye-texture-bindings.json',
  'utf8',
))
const defaultReadback = JSON.parse(readFileSync(
  'artifacts/research/20260828-fresh-tw-default-faceadditional-authority/' +
    'fresh-tw-default-faceadditional-pixels-clean-error-queue.json',
  'utf8',
))

function loadTextureModule() {
  const compiled = ts.transpileModule(textureSource, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: texturePath,
    reportDiagnostics: true,
  })
  assert.deepEqual(compiled.diagnostics ?? [], [])
  const module = { exports: {} }
  const localRequire = specifier => {
    if (specifier === 'three') return THREE
    if (specifier === './loadingProgress.ts') return actualLoadingProgress
    if (Object.hasOwn(textureAssetUrlImports, specifier)) return textureAssetUrlImports[specifier]
    if (specifier === './materialProfile') {
      return { getOfficialTextureSamplerProfile: () => undefined }
    }
    if (specifier === './officialTextureContainer') {
      return {
        getOfficialCompressedTextureState: () => undefined,
        loadOfficialCompressedTexture: async () => undefined,
      }
    }
    if (specifier === './renderer') return { renderer: undefined }
    throw new Error(`Unexpected fixture import: ${specifier}`)
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
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.equal(bytes.subarray(12, 16).toString('ascii'), 'IHDR')
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}

test('official FaceAdditional sampler restores the serialized Texture2D state after the quality helper', () => {
  const { ApplyOfficialFaceAdditionalSampling } = loadTextureModule()
  const texture = new THREE.Texture()
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = false
  texture.generateMipmaps = false
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.anisotropy = 16
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.MirroredRepeatWrapping

  const state = ApplyOfficialFaceAdditionalSampling(texture)

  assert.equal(texture.colorSpace, THREE.NoColorSpace)
  assert.equal(texture.flipY, true)
  assert.equal(texture.generateMipmaps, true)
  assert.equal(texture.magFilter, THREE.LinearFilter)
  assert.equal(texture.minFilter, THREE.LinearMipmapNearestFilter)
  assert.equal(texture.anisotropy, 1)
  assert.equal(texture.wrapS, THREE.RepeatWrapping)
  assert.equal(texture.wrapT, THREE.RepeatWrapping)
  assert.deepEqual(state, {
    colorSpace: THREE.NoColorSpace,
    flipY: true,
    generateMipmaps: true,
    magFilter: THREE.LinearFilter,
    minFilter: THREE.LinearMipmapNearestFilter,
    anisotropy: 1,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    pngFileRow: '1-v',
  })
})

test('fresh Steam fixtures preserve four Face slot orders and one common sampler', () => {
  assert.equal(evidence.records.length, 4)
  assert.deepEqual(
    evidence.records.map(record => [
      record.characterId,
      record.faceSlot,
      record.materials,
      record.texture,
    ]),
    [
      ['100102', 0, [
        'mt_chara_100102_face',
        'mt_chara_100102_eyebrow_mask',
        'mt_chara_100102_eye_mask',
      ], {
        width: 512, height: 512, mipCount: 10, colorSpace: 'linear',
        filterMode: 'bilinear', aniso: 1, mipBias: 0,
        wrapU: 'repeat', wrapV: 'repeat',
      }],
      ['108301', 1, [
        'mt_chara_108301_eyebrow_mask',
        'mt_chara_108301_face',
        'mt_chara_108301_eye_mask',
      ], {
        width: 512, height: 512, mipCount: 10, colorSpace: 'linear',
        filterMode: 'bilinear', aniso: 1, mipBias: 0,
        wrapU: 'repeat', wrapV: 'repeat',
      }],
      ['101901', 1, [
        'mt_chara_101901_eyebrow_mask',
        'mt_chara_101901_face',
        'mt_chara_101901_eye_mask',
      ], {
        width: 512, height: 512, mipCount: 10, colorSpace: 'linear',
        filterMode: 'bilinear', aniso: 1, mipBias: 0,
        wrapU: 'repeat', wrapV: 'repeat',
      }],
      ['100107', 0, [
        'mt_chara_100101_face',
        'mt_chara_100101_eyebrow_mask',
        'mt_chara_100101_eye_mask',
      ], {
        width: 512, height: 512, mipCount: 10, colorSpace: 'linear',
        filterMode: 'bilinear', aniso: 1, mipBias: 0,
        wrapU: 'repeat', wrapV: 'repeat',
      }],
    ],
  )
  for (const record of evidence.records) {
    assert.ok(
      record.sampling.pngRowEquals1MinusV.nonzero >
        record.sampling.pngRowEqualsV.nonzero,
      `${record.characterId}: vertical upload orientation regression`,
    )
    assert.ok(
      record.sampling.pngRowEquals1MinusV.mean >
        record.sampling.pngRowEqualsV.mean,
      `${record.characterId}: authored UV1 carrier regression`,
    )
  }
})

test('all four local FaceAdditional PNG fixtures remain 512 square', () => {
  const paths = [
    'magia-exedra-character-three/models/chara_100102/chara_100102_eyehighlight_ctrl.png',
    'magia-exedra-character-three/models/chara_108301_battle_unit/chara_108301_eyehighlight_ctrl.png',
    'magia-exedra-character-three/models/chara_101901_battle_unit/chara_101901_eyehighlight_ctrl.png',
    'magia-exedra-character-three/models/chara_100107_battle_unit/chara_100101_eyehighlight_ctrl.png',
  ]
  for (const path of paths) {
    assert.equal(existsSync(path), true, path)
    assert.deepEqual(pngDimensions(path), [512, 512], path)
  }
})

test('serialized FaceAdditional PPtrs preserve slot-order variants and null defaults', () => {
  const matrix = [
    ['100102', ['face', 'eyebrow_mask', 'eye_mask'], [
      'chara_100102_eyehighlight_ctrl', null,
      'chara_100102_eyehighlight_ctrl',
    ]],
    ['108301', ['eyebrow_mask', 'face', 'eye_mask'], [
      'chara_108301_eyehighlight_ctrl',
      'chara_108301_eyehighlight_ctrl',
      'chara_108301_eyehighlight_ctrl',
    ]],
    ['101901', ['eyebrow_mask', 'face', 'eye_mask'], [
      null, 'chara_101901_eyehighlight_ctrl',
      'chara_101901_eyehighlight_ctrl',
    ]],
    ['100101', ['face', 'eyebrow_mask', 'eye_mask'], [
      'chara_100101_eyehighlight_ctrl', null,
      'chara_100101_eyehighlight_ctrl',
    ]],
    ['100805', ['face', 'eyebrow_mask', 'eye_mask'], [
      'chara_100805_eyehighlight_ctrl', null,
      'chara_100805_eyehighlight_ctrl',
    ]],
  ]
  for (const [characterId, slotOrder, expected] of matrix) {
    assert.deepEqual(
      slotOrder.map(slot =>
        generated.materials[`mt_chara_${characterId}_${slot}`]
          .face.additionalTexture),
      expected,
      characterId,
    )
  }
  assert.equal(generated.schema, 4)
  assert.deepEqual(
    generated.textureSamplers.chara_100102_eyehighlight_ctrl.slots,
    ['_FaceAdditionalMap'],
  )
})

test('fresh TW null PPtr binds a readable 4x4 transparent-black default', () => {
  const records = liveBinding.payload.records
  const eyebrow = records.find(record => record.count === 786)
  const eye = records.find(record => record.count === 204)
  const sampler = record => record.samplers.find(
    value => value.name === '_FaceAdditionalMap',
  )
  assert.deepEqual(
    {
      eye: [sampler(eye).texture, sampler(eye).width, sampler(eye).height],
      eyebrow: [
        sampler(eyebrow).texture,
        sampler(eyebrow).width,
        sampler(eyebrow).height,
      ],
    },
    { eye: [1021, 512, 512], eyebrow: [4, 4, 4] },
  )
  const payload = defaultReadback.payload
  assert.equal(payload.pid, 3607)
  assert.equal(payload.binding.texture, 4)
  assert.equal(payload.readback.complete, true)
  assert.deepEqual(payload.readback.priorErrors, [])
  assert.equal(payload.readback.error, 0)
  assert.deepEqual(
    [...new Set(
      Array.from({ length: 16 }, (_, index) =>
        payload.readback.rgba.slice(index * 4, index * 4 + 4).join(',')),
    )],
    ['0,0,0,0'],
  )
  assert.match(faceSource, /new Uint8Array\(4 \* 4 \* 4\)/)
  assert.match(faceSource, /texture\.colorSpace = THREE\.SRGBColorSpace/)
})

test('FaceAdditional runtime consumer stays UV1/profile-driven and exposes debug state', () => {
  const maximize = faceSource.indexOf('MaximizeTextureQuality(texture)')
  const restore = faceSource.indexOf(
    'ApplyOfficialFaceAdditionalSampling(texture)',
  )
  const baseCarrier = faceSource.indexOf('float rdBaseCheekBlend')
  const optionalGate = faceSource.indexOf(
    'if (uOfficialFaceShouldApplyAdditional != 0.0)',
  )
  assert.ok(maximize >= 0 && restore > maximize)
  assert.ok(baseCarrier >= 0 && optionalGate > baseCarrier)
  assert.match(faceSource, /vFaceUv2 = uv1;/)
  assert.match(faceSource, /texture2D\(\s*tEyehighlight,\s*vFaceUv2\s*\)/)
  assert.match(
    faceSource,
    /baseCarrierBeforeShouldApplyGate:\s*'_FACE_SHADOW_GRADIENTMAP-only'/,
  )
  assert.match(faceSource, /baseCarrierEyeExcluded: true/)
  assert.match(
    faceSource,
    /saturate\(uUseFaceGradient\);/,
  )
  assert.match(faceSource, /options\.faceAdditionalMaps\.map/)
  assert.match(loaderSource, /const textureName = profile\.face\.additionalTexture/)
  assert.match(loaderSource, /findOfficialTextureUrl\(textureName\)/)
  assert.doesNotMatch(
    loaderSource,
    /eyehighlightMap|path => path\.includes\('eye'\)/,
  )
  assert.match(
    loaderSource,
    /mesh\.userData\.officialFaceAdditionalRuntime\s*=\s*\n\s*result\.officialFaceAdditionalRuntime/,
  )

  const helperStart = textureSource.indexOf(
    'export function ApplyOfficialFaceAdditionalSampling',
  )
  const helperEnd = textureSource.indexOf(
    '/** Match shader/redrive_toon',
    helperStart,
  )
  const helper = textureSource.slice(helperStart, helperEnd)
  assert.doesNotMatch(helper, /100102|108301|101901|100107/)
  assert.doesNotMatch(
    faceSource,
    /ApplyOfficialFaceAdditionalSampling\((?:ctrlTex|noseGradientTex)\)/,
  )
  assert.doesNotMatch(
    `${faceSource}\n${loaderSource}`,
    /(?:characterId|faceProfile\.characterId)\s*(?:===|==)\s*(?:100102|108301|101901|100107|100805)/,
  )
})


test('100601 face_a uses its serialized FaceGradient without replacing ordinary control or adjacent routes', () => {
  const ast = ts.createSourceFile(loaderPath, loaderSource, ts.ScriptTarget.Latest, true)
  const calls = []
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'createFaceMaterial'
      && node.arguments[0]?.getText(ast).includes('...sharedMaterialOptions')) calls.push(node.arguments[0])
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(calls.length, 1)
  const parameters = ['characterId', 'meshMaterialNames', 'ctrlMap', 'sharedMaterialOptions',
    'shadowMap', 'faceAdditionalMaps', 'texturePathUrl', 'faceProfile', 'faceReference', 'ObjFindByKey']
  const compiled = ts.transpileModule(
    `const resolve = (${parameters.join(',')}) => (${calls[0].getText(ast)})`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }, reportDiagnostics: true },
  )
  assert.deepEqual(compiled.diagnostics ?? [], [])
  const resolve = Function(`${compiled.outputText}; return resolve`)()
  const control = '/magia-exedra-character-three/models/chara_100601_battle_unit/chara_100601_face_a_ctrl.png'
  const shared = Object.freeze({ colorMap: 'native-face-a-color', shadowMap: 'native-face-a-shadow', ctrlMap: control })
  const additional = [null], profile = { characterId: 100601 }, reference = {}, nose = 'native-nose-gradient'
  const invoke = (id, names, ctrl) => resolve(id, names, ctrl, shared, shared.shadowMap, additional,
    { face_ctrl_nose: nose }, profile, reference, (values, predicate) => Object.entries(values).find(([key]) => predicate(key))?.[1])
  const selected = invoke(100601, ['mt_chara_100601_face_a'], control)
  assert.equal(selected.ctrlMap, 'face_ctrl_base')
  assert.equal(selected.colorMap, shared.colorMap)
  assert.equal(selected.shadowMap, shared.shadowMap)
  assert.equal(shared.ctrlMap, control)
  assert.equal(selected.faceAdditionalMaps, additional)
  assert.equal(selected.faceProfile, profile)
  assert.equal(selected.faceReference, reference)
  assert.equal(selected.noseGradientMap, nose)
  assert.deepEqual(pngDimensions(control.slice(1)), [1024, 1024])
  for (const [id, names, ctrl] of [
    [100202, ['mt_chara_100202_face'], 'chara_100202_face_ctrl'],
    [100301, ['mt_chara_100301_face_a'], 'other_ctrl'],
    [100301, ['mt_chara_100601_face_a'], control],
    [100601, ['mt_chara_100601_face'], undefined],
    [100601, ['mt_chara_100601_face_a_other'], control],
  ]) assert.equal(invoke(id, names, ctrl).ctrlMap, ctrl)
})
