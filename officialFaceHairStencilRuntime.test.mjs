import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import test from 'node:test'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import ts from 'typescript'

const officialProfiles = JSON.parse(readFileSync(
  'magia-exedra-character-three/official-material-profiles.json',
  'utf8',
))
const stencilRuntimeSource = readFileSync(
  'magia-exedra-character-three/officialStencilRuntime.ts',
  'utf8',
)
const loaderSource = readFileSync(
  'magia-exedra-character-three/loader.ts',
  'utf8',
)
const officialShaderStructure = JSON.parse(readFileSync(
  'artifacts/research/20260813-shader-reverse/official-shaders/redrive-toon-structure.json',
  'utf8',
))
const freshTwStencilStateMatrix = JSON.parse(readFileSync(
  'artifacts/verification/20260828-official-stencil-forward-mask-pass/fresh-tw-stencil-state-matrix-authority.json',
  'utf8',
))
const freshTwEyeEyebrowUboFrame = JSON.parse(readFileSync(
  'artifacts/research/20260828-eye-eyebrow-draw-attachment-authority/fresh-tw-eye-eyebrow-ubo-frame.json',
  'utf8',
))
const freshTwCompositeReference = JSON.parse(readFileSync(
  'artifacts/research/20260830-fresh-tw-eye-battle-runtime/fresh-tw-eye-depth-vertex-state-pid-20913.json',
  'utf8',
)).payload

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
  assert.deepEqual(
    compiled.diagnostics ?? [],
    [],
    `TypeScript fixture failed to transpile: ${path}`,
  )
  const module = { exports: {} }
  const localRequire = specifier => {
    if (Object.hasOwn(requireMap, specifier)) return requireMap[specifier]
    throw new Error(`Unexpected fixture import ${specifier} from ${path}`)
  }
  Function(
    'exports',
    'require',
    'module',
    '__filename',
    '__dirname',
    compiled.outputText,
  )(
    module.exports,
    localRequire,
    module,
    path,
    path.replace(/[\\/][^\\/]+$/, ''),
  )
  return module.exports
}

const generatedGroups = loadTypeScriptCommonJs(
  'magia-exedra-character-three/submeshGroups.generated.ts',
)
const { restoreOfficialSubmeshGroups } = loadTypeScriptCommonJs(
  'magia-exedra-character-three/submeshGroups.ts',
  {
    three: THREE,
    './submeshGroups.generated': generatedGroups,
  },
)
const materialProfiles = loadTypeScriptCommonJs(
  'magia-exedra-character-three/materialProfile.ts',
  {
    './official-material-profiles.json?url':
      'fixture://official-material-profiles.json',
  },
)
await materialProfiles.loadOfficialMaterialProfiles(officialProfiles)
const userDataModule = loadTypeScriptCommonJs(
  'magia-exedra-character-three/shaders/userdata.ts',
  { three: THREE },
)
const stencilRuntime = loadTypeScriptCommonJs(
  'magia-exedra-character-three/officialStencilRuntime.ts',
  {
    three: THREE,
    './shaders/userdata': userDataModule,
  },
)

const fixtures = [
  {
    characterId: 100102,
    path: 'magia-exedra-character-three/models/chara_100102/chara_100102.fbx.gz',
    faceCounts: [6996, 996, 192],
    faceSlots: [
      'mt_chara_100102_face',
      'mt_chara_100102_eyebrow_mask',
      'mt_chara_100102_eye_mask',
    ],
    writerIndices: [1, 2],
    hairCounts: [3261, 5709],
    hairSlots: ['mt_chara_100102_hair_out', 'mt_chara_100102_hair'],
    selectorIndex: 0,
    bodyCounts: [29658, 3342],
    gemIndices: [],
  },
  {
    characterId: 108301,
    path: 'magia-exedra-character-three/models/chara_108301_battle_unit/VisualRoot.fbx.gz',
    faceCounts: [978, 6681, 144],
    faceSlots: [
      'mt_chara_108301_eyebrow_mask',
      'mt_chara_108301_face',
      'mt_chara_108301_eye_mask',
    ],
    writerIndices: [2],
    hairCounts: [11196, 5487],
    hairSlots: ['mt_chara_108301_hair', 'mt_chara_108301_hair_out'],
    selectorIndex: 1,
    bodyCounts: [2634, 1740, 780, 2022, 28734],
    gemIndices: [2],
  },
  {
    characterId: 101901,
    path: 'magia-exedra-character-three/models/chara_101901_battle_unit/VisualRoot.fbx.gz',
    faceCounts: [1704, 7392, 144],
    faceSlots: [
      'mt_chara_101901_eyebrow_mask',
      'mt_chara_101901_face',
      'mt_chara_101901_eye_mask',
    ],
    writerIndices: [0, 2],
    hairCounts: [14001, 2400],
    hairSlots: ['mt_chara_101901_hair', 'mt_chara_101901_hair_out'],
    selectorIndex: 1,
    bodyCounts: [38058, 312, 1020, 3024],
    gemIndices: [1],
  },
  {
    characterId: 100107,
    path: 'magia-exedra-character-three/models/chara_100107_battle_unit/VisualRoot.fbx.gz',
    faceCounts: [6996, 996, 192],
    faceSlots: [
      'mt_chara_100101_face',
      'mt_chara_100101_eyebrow_mask',
      'mt_chara_100101_eye_mask',
    ],
    writerIndices: [1, 2],
    hairCounts: [3261, 5709],
    hairSlots: ['mt_chara_100101_hair_out', 'mt_chara_100101_hair'],
    selectorIndex: 0,
    bodyCounts: [34164, 834, 246],
    gemIndices: [2],
  },
  {
    characterId: 100805,
    path: 'magia-exedra-character-three/models/chara_100805_battle_unit/VisualRoot.fbx.gz',
    faceCounts: [6264, 1278, 132],
    faceSlots: [
      'mt_chara_100805_face',
      'mt_chara_100805_eyebrow_mask',
      'mt_chara_100805_eye_mask',
    ],
    writerIndices: [1, 2],
    hairCounts: [10281, 3396, 6030],
    hairSlots: [
      'mt_chara_100805_hair',
      'mt_chara_100805_hair_alpha',
      'mt_chara_100805_hair_out',
    ],
    selectorIndex: 2,
    bodyCounts: [2688, 22125, 3060, 228, 714],
    gemIndices: [3],
  },
]
const fixtureCharacterReference = 7
const fixtureCompositeReference = 128 | fixtureCharacterReference

function parseActualCharacterFbx(fixture) {
  const bytes = gunzipSync(readFileSync(fixture.path))
  const originalTextureLoad = THREE.TextureLoader.prototype.load
  THREE.TextureLoader.prototype.load = function (_url, onLoad) {
    const texture = new THREE.Texture()
    if (onLoad) queueMicrotask(() => onLoad(texture))
    return texture
  }
  try {
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    )
    return new FBXLoader(new THREE.LoadingManager()).parse(
      arrayBuffer,
      'file:///official-stencil-fixture/',
    )
  } finally {
    THREE.TextureLoader.prototype.load = originalTextureLoad
  }
}

function findMesh(root, name) {
  let result
  root.traverse(object => {
    if (object.isMesh && object.name === name) result = object
  })
  assert.ok(result, `missing actual FBX mesh ${name}`)
  return result
}

function materialNames(mesh) {
  return (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
    .map(material => material.name)
}

function restore(mesh, fixture, expectedCounts) {
  assert.deepEqual(mesh.geometry.groups, [])
  const state = restoreOfficialSubmeshGroups(
    mesh,
    fixture.characterId,
    materialNames(mesh).length,
  )
  assert.deepEqual(state?.counts, expectedCounts)
  return state
}

function createOutlineFixtures(mesh) {
  return mesh.geometry.groups.map(group => {
    const outline = new THREE.SkinnedMesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial(),
    )
    outline.name = `${mesh.name}:official-outline:${group.materialIndex ?? 0}`
    return outline
  })
}

test('transparent mode-2 slot suppresses only the outline shell and retains selector passes', () => {
  const profile = materialProfiles.getOfficialMaterialProfiles([
    'mt_chara_114501_body_trans',
  ])[0]
  assert.equal(profile.outline.enabled, true)
  assert.equal(profile.gem.transparency, true)
  assert.equal(profile.stencil.mode, 2)
  assert.equal(stencilRuntime.isOfficialOutlineExtrusionEnabled(profile), false)

  const opaqueOutlineProfile = materialProfiles.getOfficialMaterialProfiles([
    'mt_chara_100102_hair_out',
  ])[0]
  assert.equal(
    stencilRuntime.isOfficialOutlineExtrusionEnabled(opaqueOutlineProfile),
    true,
  )

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  )
  geometry.addGroup(0, 3, 0)
  const material = new THREE.MeshBasicMaterial()
  material.name = profile.name
  const mesh = new THREE.SkinnedMesh(geometry, [material])
  mesh.name = 'Body_Mesh'
  const bone = new THREE.Bone()
  mesh.add(bone)
  mesh.bind(new THREE.Skeleton([bone]))
  const registry = { meshes: [] }

  const state = stencilRuntime.installOfficialStencilSelectorRuntime(
    mesh,
    [profile],
    [],
    registry,
    fixtureCharacterReference,
  )
  assert.equal(state?.selectors.length, 1)
  assert.equal(state?.selectors[0].materialName, 'mt_chara_114501_body_trans')
  assert.deepEqual(state?.selectors[0].groups, [{ start: 0, count: 3 }])
  assert.equal(registry.meshes.length, 2)
  assert.deepEqual(
    registry.meshes.map(value => value.userData.officialStencilRole),
    ['selector-forward', 'selector-mask'],
  )

  assert.match(
    loaderSource,
    /enabled: isOfficialOutlineExtrusionEnabled\(profile\)/,
  )
  assert.equal(
    [...stencilRuntimeSource.matchAll(/isOfficialOutlineExtrusionEnabled\(profile\)/g)]
      .length,
    2,
  )
})

function findPass(node, name) {
  if (!node || typeof node !== 'object') return undefined
  if (node.name === name && node.state) return node
  for (const value of Object.values(node)) {
    const found = findPass(value, name)
    if (found) return found
  }
  return undefined
}

function findFreshTwState(predicate, label) {
  const record = freshTwStencilStateMatrix.selectedScreenRecords.find(predicate)
  assert.ok(record, `missing fresh TW ${label} draw state`)
  return record.state
}

test('fresh TW eye and eyebrow writers enable blend and replace exact ref 128', () => {
  for (const [label, predicate] of [
    ['eye writer', record => record.meta.eye && record.state.stencilZPass === 7681],
    ['eyebrow writer', record =>
      !record.meta.eye
      && record.meta.names.includes('_FaceAdditionalMap')
      && record.state.stencilZPass === 7681],
  ]) {
    const state = findFreshTwState(predicate, label)
    assert.equal(state.blend, true)
    assert.equal(state.depthWrite, true)
    assert.equal(state.stencilFunc, 519)
    assert.equal(state.stencilRef, 128)
    assert.equal(state.stencilValueMask, 255)
    assert.equal(state.stencilWriteMask, 255)
    assert.equal(state.cullFaceMode, 1029)
    assert.equal(state.blendSrcRgb, 1)
    assert.equal(state.blendDstRgb, 0)
    assert.equal(state.blendSrcAlpha, 1)
    assert.equal(state.blendDstAlpha, 771)
  }
})

test('fresh TW selector forward and mask preserve exact blend stencil and depth state', () => {
  const forward = findFreshTwState(
    record => record.meta.hair && !record.meta.mask && record.state.stencilFunc === 517,
    'selector forward',
  )
  assert.equal(forward.blend, true)
  assert.equal(forward.depthWrite, true)
  assert.equal(forward.stencilRef, 128)
  assert.equal(forward.stencilValueMask, 255)
  assert.equal(forward.stencilWriteMask, 255)
  assert.equal(forward.blendSrcRgb, 1)
  assert.equal(forward.blendDstRgb, 0)

  const mask = findFreshTwState(record => record.meta.mask, 'stencil mask')
  assert.equal(mask.blend, true)
  assert.equal(mask.depthWrite, true)
  assert.equal(mask.stencilFunc, 514)
  assert.equal(mask.stencilRef, 128)
  assert.equal(mask.stencilValueMask, 255)
  assert.equal(mask.stencilWriteMask, 255)
  assert.equal(mask.blendSrcRgb, 770)
  assert.equal(mask.blendDstRgb, 771)
  assert.equal(mask.blendSrcAlpha, 1)
  assert.equal(mask.blendDstAlpha, 771)
})

test('fresh TW outline draws use Always ref128 Keep before the Equal mask pass', () => {
  const screen = freshTwEyeEyebrowUboFrame.records.filter(record =>
    record.state.framebuffer === 20
    && record.state.viewport[0] === 0
    && record.state.viewport[1] === 0
    && record.state.viewport[2] === 1536
    && record.state.viewport[3] === 864
  )
  const select = (count, predicate, label) => {
    const record = screen.find(record =>
      record.state.count === count && predicate(record.state)
    )
    assert.ok(record, `missing fresh TW ${label}`)
    return record
  }
  const writerForward = [
    select(204, state => state.stencilZPass === 7681, 'eye writer forward'),
    select(786, state => state.stencilZPass === 7681, 'eyebrow writer forward'),
  ]
  const writerOutline = [
    select(204, state => state.cullFaceMode === 1028, 'eye writer outline'),
    select(786, state => state.cullFaceMode === 1028, 'eyebrow writer outline'),
  ]
  const selectorForward = select(
    3402,
    state => state.stencilFunc === 517 && state.blend,
    'hair selector forward',
  )
  const selectorOutline = select(
    3402,
    state => state.cullFaceMode === 1028,
    'hair selector outline',
  )
  const selectorMask = select(
    3402,
    state => state.stencilFunc === 514,
    'hair selector mask',
  )

  for (const record of writerForward) {
    assert.equal(record.state.stencilFunc, 519)
    assert.equal(record.state.stencilRef, 128)
    assert.equal(record.state.stencilValueMask, 255)
    assert.equal(record.state.stencilWriteMask, 255)
    assert.equal(record.state.stencilZPass, 7681)
  }
  for (const record of [...writerOutline, selectorOutline]) {
    assert.equal(record.state.blend, false)
    assert.equal(record.state.depthWrite, true)
    assert.equal(record.state.stencilFunc, 519)
    assert.equal(record.state.stencilRef, 128)
    assert.equal(record.state.stencilValueMask, 255)
    assert.equal(record.state.stencilWriteMask, 255)
    assert.equal(record.state.stencilZPass, 7680)
    assert.equal(record.state.cullFaceMode, 1028)
  }
  assert.equal(selectorForward.state.stencilFunc, 517)
  assert.equal(selectorForward.state.stencilRef, 128)
  assert.equal(selectorForward.state.stencilWriteMask, 255)
  assert.equal(selectorMask.state.stencilFunc, 514)
  assert.equal(selectorMask.state.stencilRef, 128)
  assert.equal(selectorMask.state.stencilWriteMask, 255)
  assert.ok(writerForward[0].drawSequence < writerOutline[0].drawSequence)
  assert.ok(selectorForward.drawSequence < selectorOutline.drawSequence)
  assert.ok(selectorOutline.drawSequence < selectorMask.drawSequence)
})

test('fresh TW battle composes serialized bit 7 with the live character stencil id', () => {
  assert.equal(freshTwCompositeReference.pid, 20913)
  assert.equal(freshTwCompositeReference.relevantDraws, 83)
  assert.deepEqual(
    generatedGroups.officialCharacterSubmeshIndexCounts[106101].Face_Mesh,
    [1890, 144, 6690],
  )
  assert.deepEqual(
    generatedGroups.officialCharacterSubmeshIndexCounts[106101].Hair_Mesh,
    [8259, 3105],
  )
  const records = freshTwCompositeReference.records.filter(record =>
    record.state.framebuffer !== 0
    && record.state.colorWriteMask.every(Boolean)
    && record.state.cullFaceMode === 1029
  )
  const find = (count, predicate, label) => {
    const record = records.find(record =>
      record.state.count === count && predicate(record.state)
    )
    assert.ok(record, `missing fresh TW composite ${label}`)
    return record.state
  }
  const states = [
    find(144, state => state.stencilZPass === 7681, 'eye writer'),
    find(1890, state => state.stencilZPass === 7681, 'eyebrow writer'),
    find(3105, state => state.stencilFunc === 517, 'hair selector'),
    find(3105, state => state.stencilFunc === 514, 'hair mask'),
  ]
  for (const state of states) {
    assert.equal(state.stencilRef, 137)
    assert.equal(state.stencilRef & 0x80, 128)
    assert.equal(state.stencilRef & 0x7f, 9)
  }
})

test('compiled mask pass keeps an Equal stencil read and serialized alpha output', () => {
  const pass = findPass(
    officialShaderStructure,
    'ReDriveToonStencilMaskPass',
  )
  assert.ok(pass)
  assert.equal(pass.state.stencilReadMask, 255)
  assert.match(pass.state.stencilOp, /comp=.*val=3\.0/)
  assert.match(stencilRuntimeSource, /maskMaterial\.depthWrite = true/)
  assert.match(stencilRuntimeSource, /THREE\.EqualStencilFunc/)
  assert.match(stencilRuntimeSource, /uOfficialStencilTransparency/)
})

test('five protected FBX Face meshes split queue-2001 writers by serialized slot order', () => {
  for (const fixture of fixtures) {
    const root = parseActualCharacterFbx(fixture)
    const face = findMesh(root, 'Face_Mesh')
    assert.deepEqual(materialNames(face), fixture.faceSlots)
    restore(face, fixture, fixture.faceCounts)
    const profiles = materialProfiles.getOfficialMaterialProfiles(
      fixture.faceSlots,
    )
    assert.equal(
      stencilRuntime.ensureOfficialSingleMaterialGroup(face, profiles),
      undefined,
      `${fixture.characterId} multi-slot Face must retain official groups`,
    )
    const outlines = createOutlineFixtures(face)
    const runtimeUserData = { meshes: [] }
    const state = stencilRuntime.installOfficialStencilWriters(
      face,
      profiles,
      outlines,
      runtimeUserData,
      fixtureCharacterReference,
    )
    assert.deepEqual(
      state?.writers.map(writer => writer.materialIndex),
      fixture.writerIndices,
      `${fixture.characterId} writer slot regression`,
    )
    assert.deepEqual(
      state?.writers.map(writer => writer.materialName),
      fixture.writerIndices.map(index => fixture.faceSlots[index].toLowerCase()),
    )
    assert.equal(state?.outlineReference, 7)
    assert.ok(state?.writers.every(writer =>
      writer.serializedReference === 128
      && writer.characterReference === fixtureCharacterReference
      && writer.reference === fixtureCompositeReference
    ))
    const startForIndex = index => fixture.faceCounts
      .slice(0, index)
      .reduce((sum, count) => sum + count, 0)
    assert.deepEqual(
      state?.writers.map(writer => ({
        materialIndex: writer.materialIndex,
        queue: writer.queue,
        groups: writer.groups,
      })),
      fixture.writerIndices.map(materialIndex => ({
        materialIndex,
        queue: 2001,
        groups: [{
          start: startForIndex(materialIndex),
          count: fixture.faceCounts[materialIndex],
        }],
      })),
    )
    const remainingIndices = fixture.faceSlots
      .map((_name, index) => index)
      .filter(index => !fixture.writerIndices.includes(index))
    assert.deepEqual(
      state?.remainingGroups,
      remainingIndices.map(materialIndex => ({
        start: startForIndex(materialIndex),
        count: fixture.faceCounts[materialIndex],
        materialIndex,
      })),
    )
    assert.deepEqual(
      face.geometry.groups.map(group => ({
        start: group.start,
        count: group.count,
        materialIndex: group.materialIndex ?? 0,
      })),
      state?.remainingGroups,
    )
    assert.equal(runtimeUserData.meshes.length, fixture.writerIndices.length)
    for (const materialIndex of fixture.writerIndices) {
      const child = runtimeUserData.meshes.find(mesh =>
        mesh.userData.officialSourceMaterialIndex === materialIndex
      )
      assert.ok(child, `${fixture.characterId} writer child ${materialIndex}`)
      assert.equal(child.parent, face)
      assert.equal(child.material, face.material[materialIndex])
      assert.equal(child.renderOrder, 2.001)
      assert.equal(child.material.depthWrite, true)
      assert.equal(child.material.transparent, false)
      assert.equal(child.material.blending, THREE.CustomBlending)
      assert.equal(child.material.blendSrc, THREE.OneFactor)
      assert.equal(child.material.blendDst, THREE.ZeroFactor)
      assert.equal(child.geometry.drawRange.start, startForIndex(materialIndex))
      assert.equal(child.geometry.drawRange.count, fixture.faceCounts[materialIndex])
      assert.equal(child.userData.officialStencilRole, 'writer-forward')
      const outline = outlines.find(value =>
        value.name.endsWith(`official-outline:${materialIndex}`)
      )
      assert.equal(outline?.renderOrder, 3.001)
      assert.equal(outline?.material.stencilWrite, true)
      assert.equal(outline?.material.stencilFunc, THREE.AlwaysStencilFunc)
      assert.equal(
        outline?.material.stencilRef,
        fixtureCompositeReference,
      )
      assert.equal(outline?.material.stencilFuncMask, 255)
      assert.equal(outline?.material.stencilWriteMask, 255)
      assert.equal(outline?.material.stencilZPass, THREE.KeepStencilOp)
      assert.equal(outline?.material.depthWrite, true)
    }
    assert.ok(Array.isArray(face.material))
    for (let index = 0; index < face.material.length; index++) {
      const material = face.material[index]
      const isWriter = fixture.writerIndices.includes(index)
      assert.equal(material.stencilFuncMask, isWriter ? 0xff : 0x7f)
      assert.equal(material.stencilWriteMask, isWriter ? 0xff : 0x7f)
      if (isWriter) {
        assert.equal(material.stencilRef, fixtureCompositeReference)
        assert.equal(material.stencilFunc, THREE.AlwaysStencilFunc)
        assert.equal(material.stencilZPass, THREE.ReplaceStencilOp)
      }
    }
    const eyeIndex = fixture.faceSlots.findIndex(name => name.endsWith('_eye_mask'))
    const eyebrowIndex = fixture.faceSlots.findIndex(name =>
      name.endsWith('_eyebrow_mask')
    )
    assert.equal(profiles[eyeIndex].face.isEye, true)
    assert.equal(profiles[eyebrowIndex].face.isEye, false)
    assert.equal(profiles[eyeIndex].customRenderQueue, 2001)
    if (fixture.characterId === 108301) {
      assert.equal(profiles[eyebrowIndex].customRenderQueue, -1)
      assert.equal(profiles[eyebrowIndex].stencil.mode, 0)
      assert.ok(state?.remainingGroups.some(group =>
        group.materialIndex === eyebrowIndex
      ))
      assert.ok(runtimeUserData.meshes.every(mesh =>
        mesh.userData.officialSourceMaterialIndex !== eyebrowIndex
      ))
    }
  }
})

test('115201 split Face meshes route their one selector slot through official stencil', () => {
  const fixture = {
    characterId: 115201,
    path: 'magia-exedra-character-three/models/chara_115201_battle_unit/VisualRoot.fbx.gz',
  }
  const root = parseActualCharacterFbx(fixture)
  for (const meshName of ['Face_L_Mesh', 'Face_R_Mesh']) {
    const face = findMesh(root, meshName)
    assert.deepEqual(materialNames(face), ['mt_chara_115201_face'])
    assert.deepEqual(face.geometry.groups, [])
    const profiles = materialProfiles.getOfficialMaterialProfiles(
      materialNames(face),
    )
    assert.equal(Math.round(profiles[0].stencil.mode), 2)
    assert.equal(Math.round(profiles[0].stencil.comparison), 6)
    assert.equal(Math.round(profiles[0].stencil.reference), 128)
    const group = stencilRuntime.ensureOfficialSingleMaterialGroup(
      face,
      profiles,
    )
    assert.deepEqual(group, {
      source: 'official-single-material-stencil',
      materialIndex: 0,
      start: 0,
      count: 3558,
      stencilMode: 2,
    })
    assert.deepEqual(face.geometry.groups, [{
      start: 0,
      count: 3558,
      materialIndex: 0,
    }])
    if (!Array.isArray(face.material)) face.material = [face.material]
    const outlines = createOutlineFixtures(face)
    const registry = { meshes: [] }
    const state = stencilRuntime.installOfficialStencilSelectorRuntime(
      face,
      profiles,
      outlines,
      registry,
      fixtureCharacterReference,
    )
    assert.equal(state?.selectors.length, 1)
    assert.deepEqual(state?.selectors[0].groups, [{ start: 0, count: 3558 }])
    assert.equal(state?.selectors[0].queue, 2002)
    assert.equal(registry.meshes.length, 2)
    assert.equal(registry.meshes[0].material.stencilFunc, THREE.NotEqualStencilFunc)
    assert.equal(
      registry.meshes[0].material.stencilRef,
      fixtureCompositeReference,
    )
    assert.equal(registry.meshes[0].material.stencilFuncMask, 255)
    assert.equal(registry.meshes[0].material.stencilWriteMask, 255)
    assert.equal(registry.meshes[0].material.depthWrite, true)
    assert.equal(registry.meshes[0].material.transparent, false)
    assert.equal(registry.meshes[0].material.blending, THREE.CustomBlending)
    assert.equal(registry.meshes[1].material.stencilFunc, THREE.EqualStencilFunc)
    assert.equal(registry.meshes[1].material.stencilFuncMask, 255)
    assert.equal(registry.meshes[1].material.stencilWriteMask, 255)
    assert.equal(registry.meshes[1].material.depthWrite, true)
    assert.equal(registry.meshes[1].material.transparent, true)
    assert.deepEqual(face.geometry.groups, [])
  }
})

test('five protected FBX Hair meshes install one profile-driven selector pair', () => {
  for (const fixture of fixtures) {
    const root = parseActualCharacterFbx(fixture)
    const hair = findMesh(root, 'Hair_Mesh')
    assert.deepEqual(materialNames(hair), fixture.hairSlots)
    restore(hair, fixture, fixture.hairCounts)
    const profiles = materialProfiles.getOfficialMaterialProfiles(
      fixture.hairSlots,
    )
    let forwardedGroup
    hair.onBeforeRender = (
      _renderer,
      _scene,
      _camera,
      _geometry,
      _material,
      group,
    ) => {
      forwardedGroup = group
    }
    const outlines = createOutlineFixtures(hair)
    const registry = { meshes: [] }
    const state = stencilRuntime.installOfficialStencilSelectorRuntime(
      hair,
      profiles,
      outlines,
      registry,
      fixtureCharacterReference,
    )
    assert.equal(state?.selectors.length, 1)
    const selector = state.selectors[0]
    const selectorCount = fixture.hairCounts[fixture.selectorIndex]
    assert.deepEqual(selector, {
      materialIndex: fixture.selectorIndex,
      materialName: fixture.hairSlots[fixture.selectorIndex].toLowerCase(),
      queue: 2002,
      comparison: 6,
      serializedReference: 128,
      characterReference: fixtureCharacterReference,
      reference: fixtureCompositeReference,
      passOperation: 0,
      transparency: 0.75,
      groups: [{
        start: fixture.hairCounts
          .slice(0, fixture.selectorIndex)
          .reduce((sum, count) => sum + count, 0),
        count: selectorCount,
      }],
      forwardMeshes: [
        `Hair_Mesh:${fixture.hairSlots[fixture.selectorIndex].toLowerCase()}:forward`,
      ],
      maskMeshes: [
        `Hair_Mesh:${fixture.hairSlots[fixture.selectorIndex].toLowerCase()}:stencil-mask`,
      ],
    })
    assert.equal(registry.meshes.length, 2)
    const [forward, mask] = registry.meshes
    assert.equal(forward.geometry.drawRange.count, selectorCount)
    assert.equal(mask.geometry.drawRange.count, selectorCount)
    assert.equal(forward.material, hair.material[fixture.selectorIndex])
    assert.equal(forward.material.stencilFunc, THREE.NotEqualStencilFunc)
    assert.equal(forward.material.stencilRef, fixtureCompositeReference)
    assert.equal(forward.material.stencilFuncMask, 255)
    assert.equal(forward.material.stencilWriteMask, 255)
    assert.equal(forward.material.depthWrite, true)
    assert.equal(forward.material.transparent, false)
    assert.equal(forward.material.blending, THREE.CustomBlending)
    assert.equal(forward.material.blendSrc, THREE.OneFactor)
    assert.equal(forward.material.blendDst, THREE.ZeroFactor)
    assert.equal(forward.renderOrder, 2.002)
    assert.equal(forward.userData.officialStencilRole, 'selector-forward')
    forward.onBeforeRender(
      {},
      {},
      {},
      forward.geometry,
      forward.material,
      null,
    )
    assert.deepEqual(forwardedGroup, {
      start: fixture.hairCounts
        .slice(0, fixture.selectorIndex)
        .reduce((sum, count) => sum + count, 0),
      count: selectorCount,
      materialIndex: fixture.selectorIndex,
    })
    assert.equal(mask.material.stencilFunc, THREE.EqualStencilFunc)
    assert.equal(mask.material.stencilRef, fixtureCompositeReference)
    assert.equal(mask.material.stencilFuncMask, 255)
    assert.equal(mask.material.stencilWriteMask, 255)
    assert.equal(mask.material.opacity, 0.25)
    assert.equal(mask.material.transparent, true)
    assert.equal(mask.material.blendSrc, THREE.SrcAlphaFactor)
    assert.equal(mask.material.blendDst, THREE.OneMinusSrcAlphaFactor)
    assert.equal(mask.material.blendSrcAlpha, THREE.OneFactor)
    assert.equal(mask.material.blendDstAlpha, THREE.OneMinusSrcAlphaFactor)
    assert.equal(mask.material.blendEquationAlpha, THREE.AddEquation)
    assert.equal(mask.material.depthWrite, true)
    const maskShader = {
      uniforms: {},
      fragmentShader: 'void main() {\n#include <opaque_fragment>\n}',
    }
    mask.material.onBeforeCompile(maskShader, {})
    assert.equal(maskShader.uniforms.uOfficialStencilTransparency.value, 0.75)
    assert.match(
      maskShader.fragmentShader,
      /gl_FragColor\.a = clamp\(\s*1\.0 - uOfficialStencilTransparency/,
    )
    assert.equal(mask.castShadow, false)
    assert.equal(mask.renderOrder, 4.002)
    assert.ok(2.001 < forward.renderOrder)
    assert.ok(forward.renderOrder < mask.renderOrder)
    assert.ok(3.002 < mask.renderOrder)
    assert.equal(mask.userData.officialStencilRole, 'selector-mask')
    assert.equal(forward.skeleton, hair.skeleton)
    assert.equal(mask.skeleton, hair.skeleton)
    assert.equal(forward.morphTargetInfluences, hair.morphTargetInfluences)
    assert.equal(mask.morphTargetDictionary, hair.morphTargetDictionary)
    const remainingIndices = fixture.hairSlots
      .map((_name, index) => index)
      .filter(index => index !== fixture.selectorIndex)
    assert.deepEqual(state.remainingGroups, remainingIndices.map(materialIndex => ({
      start: fixture.hairCounts
        .slice(0, materialIndex)
        .reduce((sum, count) => sum + count, 0),
      count: fixture.hairCounts[materialIndex],
      materialIndex,
    })))
    assert.deepEqual(hair.geometry.groups, state.remainingGroups)
    const selectorOutline = outlines.find(outline =>
      outline.name.endsWith(`official-outline:${fixture.selectorIndex}`)
    )
    assert.equal(selectorOutline.renderOrder, 3.002)
    assert.ok(selectorOutline.renderOrder < mask.renderOrder)
    assert.equal(selectorOutline.material.stencilFunc, THREE.AlwaysStencilFunc)
    assert.equal(
      selectorOutline.material.stencilRef,
      fixtureCompositeReference,
    )
    assert.equal(selectorOutline.material.stencilFuncMask, 255)
    assert.equal(selectorOutline.material.stencilWriteMask, 255)
    assert.equal(selectorOutline.material.stencilZPass, THREE.KeepStencilOp)
    assert.equal(selectorOutline.material.depthWrite, true)
  }
})

test('Body/Gem neighbors retain their exact official groups and profile slots', () => {
  for (const fixture of fixtures) {
    const root = parseActualCharacterFbx(fixture)
    const body = findMesh(root, 'Body_Mesh')
    restore(body, fixture, fixture.bodyCounts)
    const profiles = materialProfiles.getOfficialMaterialProfiles(
      materialNames(body),
    )
    assert.deepEqual(
      profiles.flatMap((profile, index) => profile.gem.enabled ? [index] : []),
      fixture.gemIndices,
      `${fixture.characterId} Gem slot regression`,
    )
    assert.deepEqual(
      body.geometry.groups.map(group => group.count),
      fixture.bodyCounts,
    )
  }
})

test('runtime source contains no character id, fixed slot or fixture draw count', () => {
  assert.doesNotMatch(
    stencilRuntimeSource,
    /100102|108301|101901|100107|100805|2400|3261|5487|5709|11196|14001/,
  )
  assert.match(
    stencilRuntimeSource,
    /Math\.round\(profile\.stencil\.mode\) === 1/,
  )
  assert.match(
    stencilRuntimeSource,
    /Math\.round\(profile\.stencil\.mode\) === 2/,
  )
  assert.match(
    stencilRuntimeSource,
    /serializedWriterBit \| characterBits/,
  )
  assert.doesNotMatch(
    stencilRuntimeSource,
    /profile\.stencil\.comparison\) === 6/,
  )
})
