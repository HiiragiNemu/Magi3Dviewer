import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
