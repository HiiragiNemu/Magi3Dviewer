import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { test } from 'node:test'
import { gunzipSync } from 'node:zlib'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import ts from 'typescript'

const compressed = readFileSync(
  new URL(
    './magia-exedra-character-three/models/chara_100101_battle_unit/VisualRoot.fbx.gz',
    import.meta.url,
  ),
)
const bytes = gunzipSync(compressed)
const arrayBuffer = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
)

globalThis.document = {
  createElementNS() {
    const listeners = new Map()
    return {
      addEventListener(type, callback) { listeners.set(type, callback) },
      removeEventListener(type) { listeners.delete(type) },
      set src(value) {
        this._src = value
        queueMicrotask(() => listeners.get('load')?.({ target: this }))
      },
      get src() { return this._src },
    }
  },
}

const warnings = []
const originalWarn = console.warn
let root
try {
  console.warn = (...args) => warnings.push(args.map(String).join(' '))
  root = new FBXLoader().parse(arrayBuffer, '')
} finally {
  console.warn = originalWarn
}

let body
root.traverse(object => {
  if (body == null && object.isMesh && /body/i.test(object.name)) body = object
})

const loaderSource = readFileSync(
  new URL('./magia-exedra-character-three/loader.ts', import.meta.url),
  'utf8',
)
const patchSource = readFileSync(
  new URL('./patches/three+0.182.0.patch', import.meta.url),
  'utf8',
)
const bakedNormalSource = readFileSync(
  new URL('./magia-exedra-character-three/bakedNormal.ts', import.meta.url),
  'utf8',
)
const generalShaderSource = readFileSync(
  new URL('./magia-exedra-character-three/shaders/general.ts', import.meta.url),
  'utf8',
)
const faceShaderSource = readFileSync(
  new URL('./magia-exedra-character-three/shaders/face.ts', import.meta.url),
  'utf8',
)
const outlineShaderSource = readFileSync(
  new URL('./magia-exedra-character-three/shaders/outline.ts', import.meta.url),
  'utf8',
)
const characterSource = readFileSync(
  new URL('./src/viewer/character.ts', import.meta.url),
  'utf8',
)
const submeshSource = readFileSync(
  new URL(
    './magia-exedra-character-three/submeshGroups.generated.ts',
    import.meta.url,
  ),
  'utf8',
)

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
  Function('exports', 'require', 'module', compiled.outputText)(
    module.exports,
    specifier => {
      if (Object.hasOwn(requireMap, specifier)) return requireMap[specifier]
      throw new Error(`Unexpected fixture import ${specifier}`)
    },
    module,
  )
  return module.exports
}

const bakedNormalRuntime = loadTypeScriptCommonJs(
  'magia-exedra-character-three/bakedNormal.ts',
  { three: THREE },
)

function parseBakedNormalFixture() {
  const compressedNormals = readFileSync(new URL(
    './magia-exedra-character-three/models/chara_101901_battle_unit/redrive-baked-normals.bin.gz',
    import.meta.url,
  ))
  const payload = gunzipSync(compressedNormals)
  assert.equal(payload.subarray(0, 8).toString('utf8'), 'RDBN0001')
  const characterId = payload.readUInt32LE(8)
  const meshCount = payload.readUInt32LE(12)
  const meshes = new Map()
  let offset = 16
  for (let meshIndex = 0; meshIndex < meshCount; meshIndex++) {
    const nameLength = payload.readUInt16LE(offset)
    offset += 2
    const name = payload.subarray(offset, offset + nameLength).toString('utf8')
    offset = (offset + nameLength + 3) & ~3
    const vertexCount = payload.readUInt32LE(offset)
    offset += 4
    const first = [
      payload.readFloatLE(offset),
      payload.readFloatLE(offset + 4),
      payload.readFloatLE(offset + 8),
    ]
    meshes.set(name, { vertexCount, first })
    offset += vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT
  }
  return { compressedNormals, payload, characterId, meshes, offset }
}

function parseBakedNormalRuntime(path) {
  const payload = gunzipSync(readFileSync(path))
  const arrayBuffer = payload.buffer.slice(
    payload.byteOffset,
    payload.byteOffset + payload.byteLength,
  )
  return bakedNormalRuntime.parseReDriveBakedNormals(arrayBuffer)
}

function parseCharacterFbx(path) {
  const payload = gunzipSync(readFileSync(path))
  const arrayBuffer = payload.buffer.slice(
    payload.byteOffset,
    payload.byteOffset + payload.byteLength,
  )
  const originalTextureLoad = THREE.TextureLoader.prototype.load
  THREE.TextureLoader.prototype.load = function (_url, onLoad) {
    const texture = new THREE.Texture()
    if (onLoad) queueMicrotask(() => onLoad(texture))
    return texture
  }
  try {
    return new FBXLoader(new THREE.LoadingManager()).parse(
      arrayBuffer,
      'file:///baked-normal-runtime-fixture/',
    )
  } finally {
    THREE.TextureLoader.prototype.load = originalTextureLoad
  }
}

function getObjectPath(object, root) {
  const names = []
  let current = object
  while (current) {
    if (current.name) names.push(current.name)
    if (current === root) break
    current = current.parent
  }
  return names.reverse().join('/')
}

test('JP 100101 FBX preserves the serialized Direct vertex-colour channel', () => {
  assert.equal(bytes.length, 11_832_720)
  assert.ok(body, 'Body mesh must be present in the real tracked FBX')
  assert.equal(body.name, 'Body_Mesh')
  assert.equal(
    warnings.filter(message => message.includes('NoMappingInformation')).length,
    0,
    `FBXLoader emitted mapping warnings: ${warnings.join('\n')}`,
  )

  const { position, color, uv1 } = body.geometry.attributes
  assert.equal(position.count, 35_244)
  assert.equal(color.count, position.count)
  assert.equal(color.itemSize, 3)
  assert.equal(uv1.count, position.count)
  assert.equal(uv1.itemSize, 2)
  assert.equal(body.geometry.getAttribute('tangent'), undefined)
  assert.ok(Array.from(color.array).every(Number.isFinite))
  assert.ok(Array.from(uv1.array).every(Number.isFinite))
  assert.ok(Math.abs(color.getX(0) - 0.05126946419477463) < 1e-8)
  assert.notEqual(color.getX(0), uv1.getX(0))
})

test('character loader restores raw outline/rim channels without changing stage FBX', () => {
  const linear = body.geometry.attributes.color.getX(0)
  const raw = linear <= 0.0031308
    ? linear * 12.92
    : 1.055 * linear ** (1 / 2.4) - 0.055
  assert.ok(Math.abs(raw - 0.2509804) < 1e-6)

  assert.match(
    loaderSource,
    /export function restoreReDriveCharacterVertexColorChannels/,
  )
  assert.match(loaderSource, /reDriveVertexColorSpace === 'raw'/)
  assert.match(loaderSource, /linear <= 0\.0031308/)
  assert.match(loaderSource, /recoveredVertexColorGeometries/)
  assert.doesNotMatch(loaderSource, /stageMaterialBindings/)
})

test('patch-package persists only the bounded malformed colour mapping inference', () => {
  assert.match(
    patchSource,
    /MappingInformationType === 'NoMappingInformation'/,
  )
  assert.match(patchSource, /ReferenceInformationType === 'Direct'/)
  assert.match(
    patchSource,
    /colorNode\.Colors\.a\.length === geoInfo\.vertexPositions\.length \/ 3 \* 4/,
  )
  assert.match(patchSource, /MappingInformationType = 'ByVertice'/)
})

test('101901 restores the official object-space outline normal reconstructed from TEXCOORD3', () => {
  const fixture = parseBakedNormalFixture()
  assert.equal(fixture.compressedNormals.length, 336_598)
  assert.equal(fixture.payload.length, 1_078_572)
  assert.equal(fixture.offset, fixture.payload.length)
  assert.equal(fixture.characterId, 101901)
  assert.deepEqual(
    Object.fromEntries([...fixture.meshes].map(([name, value]) => [
      name,
      value.vertexCount,
    ])),
    {
      Acc_Mesh: 1_272,
      Body_Mesh: 42_414,
      Face_Mesh: 9_240,
      Hair_Mesh: 16_401,
      Weapon_a_Mesh: 12_144,
      Weapon_b_Mesh: 8_400,
    },
  )
  assert.equal(
    [...fixture.meshes.values()].reduce((sum, mesh) => sum + mesh.vertexCount, 0),
    89_871,
  )

  const bodyNormal = fixture.meshes.get('Body_Mesh').first
  const hairNormal = fixture.meshes.get('Hair_Mesh').first
  assert.ok(Math.abs(bodyNormal[0] - -0.641533613204956) < 1e-7)
  assert.ok(Math.abs(bodyNormal[1] - -0.5985895991325378) < 1e-7)
  assert.ok(Math.abs(bodyNormal[2] - -0.4797135889530182) < 1e-7)
  assert.ok(Math.abs(hairNormal[0] - -0.43867775797843933) < 1e-7)
  assert.ok(Math.abs(hairNormal[1] - -0.8972982168197632) < 1e-7)
  assert.ok(Math.abs(hairNormal[2] - -0.049170248210430145) < 1e-7)
  for (const { first } of fixture.meshes.values()) {
    assert.ok(Math.abs(Math.hypot(...first) - 1) < 1e-6)
  }

  assert.match(bakedNormalSource, /export const ReDriveBakedNormalAttribute/)
  assert.doesNotMatch(bakedNormalSource, /injectReDriveBakedNormalShader/)
  assert.doesNotMatch(generalShaderSource, /ReDriveBakedNormal/)
  assert.doesNotMatch(faceShaderSource, /ReDriveBakedNormal/)
  assert.match(
    outlineShaderSource,
    /objectNormal = normalize\(\$\{ReDriveBakedNormalAttribute\}\)/,
  )
  assert.match(loaderSource, /parseReDriveBakedNormals/)
  assert.match(loaderSource, /restoreReDriveBakedNormalAttribute/)
  assert.match(loaderSource, /selectReDriveBakedNormalValues/)
  assert.match(loaderSource, /reDriveBakedNormalBinding/)
  assert.match(loaderSource, /matchedBakedNormalMeshes\.size !== bakedNormalData\.meshes\.size/)
  assert.match(characterSource, /redrive-baked-normals\.bin\*/)
})

test('real duplicate-name Weapon meshes bind only exact-count official normals', () => {
  const fixtureIds = [
    111401, 109801, 108001, 107601, 107101, 106901, 102601, 102501,
    108002,
  ]
  const expectedRejectedCounts = new Map([
    [111401, [1572, 2862]],
    [109801, [1416, 2568]],
    [108001, [5910, 7152]],
    [107601, [3060, 6366]],
    [107101, [6000, 4770]],
    [106901, [5862, 3924]],
    [102601, [2436, 132]],
    [102501, [132, 2436]],
  ])
  const runtimeRows = []
  for (const characterId of fixtureIds) {
    const directory = `magia-exedra-character-three/models/chara_${characterId}_battle_unit`
    const root = parseCharacterFbx(`${directory}/VisualRoot.fbx.gz`)
    const official = parseBakedNormalRuntime(
      `${directory}/redrive-baked-normals.bin.gz`,
    )
    assert.equal(official.characterId, characterId)
    const matched = new Set()
    const rejected = []
    root.traverse(object => {
      if (!object.isMesh) return
      const normal = object.geometry.getAttribute('normal')
      assert.ok(normal && normal.itemSize >= 3, `${characterId} ${object.name}`)
      const selection = bakedNormalRuntime.selectReDriveBakedNormalValues(
        official,
        object.name,
        getObjectPath(object, root),
        normal.count,
      )
      if (selection.key) matched.add(selection.key)
      rejected.push(...selection.rejected.map(value => ({
        mesh: object.name,
        ...value,
      })))
    })
    assert.equal(
      matched.size,
      official.meshes.size,
      `${characterId} must consume every companion record`,
    )
    if (characterId === 108002) {
      assert.deepEqual(rejected, [])
    } else {
      assert.equal(rejected.length, 1, `${characterId} rejected candidate count`)
      const [officialVertexCount, fbxVertexCount] =
        expectedRejectedCounts.get(characterId)
      assert.equal(rejected[0].officialVertexCount, officialVertexCount)
      assert.equal(rejected[0].fbxVertexCount, fbxVertexCount)
    }
    runtimeRows.push({
      characterId,
      companionRecords: official.meshes.size,
      matchedRecords: matched.size,
      rejected,
    })
  }
  assert.equal(runtimeRows.filter(row => row.rejected.length === 1).length, 8)
  assert.equal(runtimeRows.find(row => row.characterId === 108002).rejected.length, 0)
})

test('all shipped Viewer models carry bounded official baked-normal companions', () => {
  const expectedByCharacter = new Map()
  for (const character of submeshSource.replace(/\r\n/g, '\n').matchAll(
    /^    (\d+): \{\n(?<body>.*?)^    \},$/gms,
  )) {
    const meshes = new Map()
    for (const mesh of character.groups.body.matchAll(
      /^        "([^"]+)": \[([^\]]+)\],$/gm,
    )) {
      meshes.set(
        mesh[1],
        mesh[2].split(',').reduce((sum, value) => sum + Number(value), 0),
      )
    }
    expectedByCharacter.set(Number(character[1]), meshes)
  }

  const modelRoot = new URL(
    './magia-exedra-character-three/models/',
    import.meta.url,
  )
  const modelDirectories = readdirSync(modelRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^chara_\d+_battle_unit$/.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
  assert.equal(modelDirectories.length, new Set(modelDirectories.map(entry => entry.name.match(/^chara_(\d+)_battle_unit$/)[1])).size)

  let compressedBytes = 0
  let recordCount = 0
  let vertexCount = 0
  const keysByCharacter = new Map()
  const totalsByCharacter = new Map()
  const migratedNative = new Map()
  for (const directory of modelDirectories) {
    const characterId = Number(directory.name.match(/chara_(\d+)_battle_unit/)[1])
    const packetPath = new URL(`${directory.name}/runtime-material-channel.json`, modelRoot)
    const packet = existsSync(packetPath) ? JSON.parse(readFileSync(packetPath, 'utf8')) : undefined
    const companionName = packet?.bakedNormalFile ?? 'redrive-baked-normals.bin.gz'
    assert.match(companionName, /^redrive-baked-normals?\.bin\.gz$/)
    const native = companionName === 'redrive-baked-normal.bin.gz' ? packet : undefined
    if (native) assert.equal(native.characterId, characterId)
    const nativeChannels = native ? readFileSync(new URL(`${directory.name}/${native.channelFile}`, modelRoot)) : undefined
    const expectedNative = new Map(native?.meshes.map(mesh => [mesh.name, mesh]) ?? [])
    if (native) assert.equal(expectedNative.size, native.meshes.length, 'Native companion names must be unambiguous')
    const compressedPayload = readFileSync(new URL(
      `${directory.name}/${companionName}`,
      modelRoot,
    ))
    compressedBytes += compressedPayload.length
    const payload = gunzipSync(compressedPayload)
    assert.equal(payload.subarray(0, 8).toString('utf8'), 'RDBN0001')
    assert.equal(payload.readUInt32LE(8), characterId)
    const meshRecords = payload.readUInt32LE(12)
    recordCount += meshRecords
    const keys = []
    let characterVertices = 0
    let offset = 16
    for (let meshIndex = 0; meshIndex < meshRecords; meshIndex++) {
      const nameLength = payload.readUInt16LE(offset)
      offset += 2
      const key = payload.subarray(offset, offset + nameLength).toString('utf8')
      offset = (offset + nameLength + 3) & ~3
      const count = payload.readUInt32LE(offset)
      offset += 4
      const meshName = key.split('\0', 1)[0]
      if (native) {
        const expected = expectedNative.get(meshName)
        assert.ok(expected, `Unregistered native normal mesh: ${characterId}/${meshName}`)
        assert.equal(count, expected.expandedVertexCount)
        assert.equal(expected.bakedNormal.count, count)
        assert.equal(expected.bakedNormal.byteLength, count * 12)
        assert.ok(payload.subarray(offset, offset + count * 12).equals(nativeChannels.subarray(
          expected.bakedNormal.offset, expected.bakedNormal.offset + expected.bakedNormal.byteLength,
        )), `Baked normals differ from model-local native channels: ${characterId}/${meshName}`)
      } else {
        assert.ok(expectedByCharacter.has(characterId), `Missing legacy mesh authority: ${characterId}`)
        assert.equal(count, expectedByCharacter.get(characterId).get(meshName))
      }
      keys.push(key)
      vertexCount += count
      characterVertices += count
      offset += count * 3 * Float32Array.BYTES_PER_ELEMENT
    }
    assert.equal(offset, payload.length)
    assert.equal(new Set(keys).size, keys.length)
    assert.ok(keys.some(key => key.toLowerCase().includes('hair')))
    assert.ok(keys.some(key => key.toLowerCase().includes('face')))
    keysByCharacter.set(characterId, keys)
    totalsByCharacter.set(characterId, {
      compressedBytes: compressedPayload.length, recordCount: meshRecords, vertexCount: characterVertices,
      sha256: createHash('sha256').update(compressedPayload).digest('hex'),
    })
    if (native) {
      assert.equal(meshRecords, expectedNative.size)
      migratedNative.set(characterId, totalsByCharacter.get(characterId))
    }
  }

  // New model-local native packets use their declared singular filename and
  // exact channel bytes, not an obsolete compressed legacy-file digest.
  assert.deepEqual([...migratedNative.keys()].sort((a,b)=>a-b), [100108,100208,110702])
  const migrated = [...migratedNative.values()]
  assert.equal(compressedBytes - migrated.reduce((n,r)=>n+r.compressedBytes,0), 25_639_438)
  assert.equal(recordCount - migrated.reduce((n,r)=>n+r.recordCount,0), 527)
  assert.equal(vertexCount - migrated.reduce((n,r)=>n+r.vertexCount,0), 6_886_551)
  assert.equal(migratedNative.get(110702).recordCount, 6)
  assert.equal(migratedNative.get(110702).vertexCount, 89_997)
  assert.equal(
    keysByCharacter.get(100403).filter(key => key.startsWith('Weapon_Mesh\0')).length,
    2,
  )
  assert.equal(
    keysByCharacter.get(100702).filter(key => key.startsWith('weapon_mesh\0')).length,
    2,
  )
  assert.match(loaderSource, /getModelObjectPath\(mesh, modelObject\)/)
})
