import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { gunzipSync } from 'node:zlib'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'

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
  assert.match(loaderSource, /matchedBakedNormalMeshes\.size !== bakedNormalData\.meshes\.size/)
  assert.match(characterSource, /redrive-baked-normals\.bin\*/)
})

test('all 90 Viewer models carry bounded official baked-normal companions', () => {
  const expectedByCharacter = new Map()
  for (const character of submeshSource.matchAll(
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
  assert.equal(modelDirectories.length, 90)

  let compressedBytes = 0
  let recordCount = 0
  let vertexCount = 0
  const keysByCharacter = new Map()
  for (const directory of modelDirectories) {
    const characterId = Number(directory.name.match(/chara_(\d+)_battle_unit/)[1])
    const compressedPayload = readFileSync(new URL(
      `${directory.name}/redrive-baked-normals.bin.gz`,
      modelRoot,
    ))
    compressedBytes += compressedPayload.length
    const payload = gunzipSync(compressedPayload)
    assert.equal(payload.subarray(0, 8).toString('utf8'), 'RDBN0001')
    assert.equal(payload.readUInt32LE(8), characterId)
    const meshRecords = payload.readUInt32LE(12)
    recordCount += meshRecords
    const keys = []
    let offset = 16
    for (let meshIndex = 0; meshIndex < meshRecords; meshIndex++) {
      const nameLength = payload.readUInt16LE(offset)
      offset += 2
      const key = payload.subarray(offset, offset + nameLength).toString('utf8')
      offset = (offset + nameLength + 3) & ~3
      const count = payload.readUInt32LE(offset)
      offset += 4
      const meshName = key.split('\0', 1)[0]
      assert.equal(count, expectedByCharacter.get(characterId).get(meshName))
      keys.push(key)
      vertexCount += count
      offset += count * 3 * Float32Array.BYTES_PER_ELEMENT
    }
    assert.equal(offset, payload.length)
    assert.equal(new Set(keys).size, keys.length)
    assert.ok(keys.some(key => key.toLowerCase().includes('hair')))
    assert.ok(keys.some(key => key.toLowerCase().includes('face')))
    keysByCharacter.set(characterId, keys)
  }

  assert.equal(compressedBytes, 25_282_929)
  assert.equal(recordCount, 519)
  assert.equal(vertexCount, 6_795_993)
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
