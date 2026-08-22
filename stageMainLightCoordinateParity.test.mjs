import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'
import * as THREE from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { unityWorldToViewerVector } from './src/viewer/unityLighting.ts'

const stageId = 'battle-600-00-01-001'
const stageRoot = `public/stages/official/${stageId}`
const exactMainLightPath =
  'bg_3d_600_00_01_001/Light/bg3d600A_01_01_Light/MainLight'

function objectPath(object, root) {
  const parts = []
  for (let current = object; current; current = current.parent) {
    if (current.name) parts.unshift(current.name)
    if (current === root) break
  }
  return parts.join('/')
}

function loadStageFbx() {
  globalThis.document = {
    createElementNS() {
      return {
        addEventListener() {},
        removeEventListener() {},
        set src(_value) {},
        get src() { return '' },
      }
    },
  }

  const encoded = readFileSync(`${stageRoot}/bg_3d_600_00_01_001.fbxdata`)
  assert.deepEqual([...encoded.subarray(0, 2)], [0x1f, 0x8b])
  const decoded = gunzipSync(encoded)
  assert.match(decoded.subarray(0, 23).toString('ascii'), /^Kaydara FBX Binary/)

  const warnings = []
  const originalWarn = console.warn
  console.warn = (...values) => warnings.push(values.map(String).join(' '))
  try {
    const buffer = decoded.buffer.slice(
      decoded.byteOffset,
      decoded.byteOffset + decoded.byteLength,
    )
    return { root: new FBXLoader().parse(buffer, ''), warnings }
  } finally {
    console.warn = originalWarn
  }
}

test('600-001 MainLight keeps the official FBX and serialized profile direction identical', () => {
  const profile = JSON.parse(
    readFileSync(`${stageRoot}/scene-profile.json`, 'utf8'),
  )
  assert.deepEqual(profile.coordinateSpace, {
    source: 'unity-world',
    viewer: 'assetstudio-fbx-reflect-x',
  })

  const mainLight = profile.renderProfile.lights.find(
    (light) => light.name === 'MainLight',
  )
  assert.ok(mainLight)
  assert.equal(mainLight.role, 'character-key')
  assert.equal(mainLight.anchorPath, exactMainLightPath)

  const { root, warnings } = loadStageFbx()
  root.updateMatrixWorld(true)
  const anchors = []
  root.traverse((object) => {
    if (object.name === 'MainLight') anchors.push(object)
  })
  assert.equal(anchors.length, 1)
  assert.equal(objectPath(anchors[0], root), exactMainLightPath)
  assert.deepEqual(warnings, [])

  const importedRay = anchors[0]
    .getWorldDirection(new THREE.Vector3())
    .normalize()
  const serializedPosition = new THREE.Vector3(
    ...unityWorldToViewerVector(mainLight.position),
  )
  const serializedTarget = new THREE.Vector3(
    ...unityWorldToViewerVector(mainLight.target),
  )
  const serializedRay = serializedTarget
    .sub(serializedPosition)
    .normalize()

  assert.ok(
    importedRay.dot(serializedRay) > 1 - 1e-12,
    `MainLight direction drifted: FBX=${importedRay.toArray()} profile=${serializedRay.toArray()}`,
  )
  assert.deepEqual(
    serializedRay.clone().negate().toArray(),
    [
      -0.4131758861264719,
      0.7660443915787982,
      0.49240397769948363,
    ],
    'surface-to-light must retain the official direction used by character shading',
  )
})
