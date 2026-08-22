import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'

const stageId = 'battle-601-00-01-001'
const stageRoot = `public/stages/official/${stageId}`
const catalogPath = `public/stages/catalog/${stageId}.json`
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function fileSha256(path) {
  return sha256(readFileSync(path))
}

function pngSize(path) {
  const bytes = readFileSync(path)
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.equal(bytes.subarray(12, 16).toString('ascii'), 'IHDR')
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}

function pathOf(object, root) {
  const parts = []
  for (let current = object; current; current = current.parent) {
    if (current.name) parts.unshift(current.name)
    if (current === root) break
  }
  return parts.join('/')
}

function suffixScore(left, right) {
  const leftParts = left.split('/').filter(Boolean)
  const rightParts = right.split('/').filter(Boolean)
  let score = 0
  while (
    score < leftParts.length
    && score < rightParts.length
    && leftParts[leftParts.length - 1 - score] === rightParts[rightParts.length - 1 - score]
  ) score++
  return score > 0 ? score : -1
}

function reopenFbx() {
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
  const encoded = readFileSync(`${stageRoot}/bg_3d_601_00_01_001.fbxdata`)
  assert.equal(encoded[0], 0x1f)
  assert.equal(encoded[1], 0x8b)
  const decoded = gunzipSync(encoded)
  assert.equal(sha256(decoded), catalog.transport.fbx.sourceSha256)
  assert.match(decoded.subarray(0, 23).toString('ascii'), /^Kaydara FBX Binary/)
  assert.equal(decoded.readUInt32LE(23), 7300)
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...values) => warnings.push(values.map(String).join(' '))
  try {
    const buffer = decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset + decoded.byteLength)
    return { root: new FBXLoader().parse(buffer, ''), warnings }
  } finally {
    console.warn = originalWarn
  }
}

test('601 shard preserves the current-JP Unity and frozen closure identities', () => {
  assert.equal(catalog.id, stageId)
  assert.equal(catalog.assetBundleName, 'battle/stage/bg_3d_601_00_01_001')
  assert.equal(catalog.bundleProvenance.manifest.unityVersion, '2022.3.62f2')
  assert.equal(catalog.bundleProvenance.manifestTargetId, 2619)
  assert.equal(catalog.bundleProvenance.manifestHash128BytesHex, '05f7b24dbff611cd910a5b4d19178be5')
  assert.equal(catalog.bundleProvenance.dependencyCount, 18)
  assert.equal(catalog.bundleProvenance.closureFileCount, 19)
  assert.equal(catalog.bundleProvenance.closureBytes, 16720423)
  assert.equal(
    catalog.bundleProvenance.sourceBundleSha256,
    '93ef10aa93679de71ae27788b20b8570f09bc2557d0d52c8e3c66d2398ef9dae',
  )
})

test('601 package reopens every product with exact hashes and byte total', () => {
  const entries = Object.entries(catalog.packageEvidence.files)
  assert.equal(entries.length, 23)
  let bytes = 0
  for (const [name, expected] of entries) {
    const path = `${stageRoot}/${name}`
    assert.equal(existsSync(path), true, `missing ${name}`)
    assert.equal(fileSha256(path), expected, `hash drift: ${name}`)
    bytes += statSync(path).size
    if (name.endsWith('.png')) {
      const [width, height] = pngSize(path)
      assert.ok(width > 0 && height > 0, `invalid PNG dimensions: ${name}`)
    }
  }
  assert.equal(bytes, catalog.packageEvidence.totalBytes)
  assert.equal(entries.filter(([name]) => name.endsWith('.png')).length, 20)
  assert.deepEqual(pngSize(`${stageRoot}/Lightmap-0_comp_light.png`), [128, 128])
})

test('601 gzip carrier reopens in Three r182 with all geometry and material identities', () => {
  const { root, warnings } = reopenFbx()
  assert.equal(root.name, 'bg_3d_601_00_01_001')
  assert.equal(warnings.length, 0)
  const meshes = []
  const materials = new Set()
  const renamed = []
  let nodes = 0
  let nonFinite = 0
  root.traverse((object) => {
    nodes++
    if (object.name.includes('__lm_')) renamed.push(object.name)
    if (!object.isMesh) return
    meshes.push(object)
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material) materials.add(material.name)
    }
    assert.ok(object.geometry.getAttribute('uv'))
    for (const value of object.geometry.getAttribute('position').array) {
      if (!Number.isFinite(value)) nonFinite++
    }
  })
  assert.equal(nodes, 536)
  assert.equal(meshes.length, 312)
  assert.equal(materials.size, 14)
  assert.equal(renamed.length, 4)
  assert.equal(nonFinite, 0)
  assert.equal(root.animations.length, 0)
})

test('601 strict UV1 and lightmap evidence resolves 173/173 without ambiguity', () => {
  const { root } = reopenFbx()
  const uv1 = JSON.parse(readFileSync(`${stageRoot}/uv1-companion.json`, 'utf8'))
  const lightmaps = JSON.parse(readFileSync(`${stageRoot}/lightmap-bindings.json`, 'utf8'))
  assert.equal(uv1.schemaVersion, 3)
  assert.equal(uv1.status, 'verified-runtime-strict')
  assert.equal(lightmaps.status, 'verified-runtime-strict')
  assert.equal(uv1.nodes.length, 173)
  assert.equal(lightmaps.renderers.length, 173)
  assert.equal(Object.keys(uv1.geometries).length, 7)
  assert.equal(new Set(uv1.nodes.map((item) => item.hierarchyPath)).size, 173)
  assert.deepEqual(
    lightmaps.renderers.map((item) => item.rendererHierarchyPath),
    uv1.nodes.map((item) => item.hierarchyPath),
  )
  for (const [key, geometry] of Object.entries(uv1.geometries)) {
    const bytes = Buffer.from(geometry.uv1Base64, 'base64')
    assert.equal(bytes.length, geometry.vertexCount * 2 * 4, key)
    assert.equal(sha256(bytes), geometry.uv1Sha256, key)
  }

  const candidates = []
  root.traverse((object) => {
    if (object.isMesh) candidates.push({ object, path: pathOf(object, root) })
  })
  const claimed = new Set()
  for (const node of [...uv1.nodes].sort((a, b) => b.hierarchyPath.length - a.hierarchyPath.length)) {
    let bestScore = -1
    let matches = []
    for (const candidate of candidates) {
      if (claimed.has(candidate.object)) continue
      const score = suffixScore(candidate.path, node.hierarchyPath)
      if (score > bestScore) {
        bestScore = score
        matches = score >= 0 ? [candidate] : []
      } else if (score >= 0 && score === bestScore) matches.push(candidate)
    }
    assert.equal(matches.length, 1, `strict hierarchy match: ${node.hierarchyPath}`)
    const geometry = uv1.geometries[node.geometryKey]
    assert.ok(geometry)
    assert.equal(matches[0].object.geometry.getAttribute('position').count, geometry.vertexCount)
    claimed.add(matches[0].object)
  }
  assert.equal(claimed.size, 173)
})

test('601 material, light, ReDrive and post values come from serialized profiles', () => {
  assert.equal(catalog.materialBindings.length, 14)
  const grid = catalog.materialBindings.find((item) => item.materialName === 'bg3d601_00_grid')
  assert.equal(grid.textureWrap, 'repeat')
  assert.equal(grid.alphaTest, 0.15000000596046448)
  assert.equal(grid.unlitness, 0.546999990940094)
  assert.equal(grid.depthWrite, true)
  const matcap = catalog.materialBindings.find((item) => item.materialName.endsWith('_03'))
  assert.equal(matcap.matCapIntensity, 1)
  assert.ok(matcap.smoothnessMapUrl.endsWith('bg3d601_00_01_002_lightJunglegym_col.png'))
  for (const binding of catalog.materialBindings) {
    for (const key of ['baseMapUrl', 'normalMapUrl', 'smoothnessMapUrl', 'matCapMapUrl']) {
      if (!binding[key]) continue
      const name = binding[key].split('/').at(-1)
      assert.ok(catalog.packageEvidence.files[name], `${binding.materialName}:${key}`)
    }
  }

  const profile = catalog.renderProfile
  assert.deepEqual(profile.fog.color, [0, 0, 0, 1])
  assert.equal(profile.fog.near, 50)
  assert.equal(profile.fog.far, 100)
  assert.deepEqual(profile.lights.map((item) => item.name).sort(), ['BgLightFront', 'MainLight'])
  assert.equal(profile.bloom.strength, 1.25)
  assert.equal(profile.bloom.radius, 0.75)
  assert.equal(profile.postProcessing.colorAdjustments.contrast, 10)
  assert.equal(profile.postProcessing.colorAdjustments.saturation, 15)
  assert.equal(profile.postProcessing.vignette.intensity, 0.20000000298023224)
  assert.equal(profile.reDriveVolume.shAmbient.length, 27)
  assert.ok(profile.reDriveVolume.shAmbient.every((value) => value === 0))
  assert.deepEqual(
    profile.reDriveVolume.characterAdditionalRimLightColor,
    [2, 1.02983558177948, 0.4464559555053711, 1],
  )
  assert.equal(profile.reDriveVolume.backgroundPostExposure, 0.20000000298023224)
  assert.equal(profile.reDriveVolume.backgroundContrast, 5)
  assert.equal(profile.reDriveVolume.backgroundSaturation, 10)
})

test('601 fidelity layers keep source dynamics distinct from the web carrier', () => {
  const { source, carrier, runtime } = catalog.fidelity.layers
  assert.equal(source.gameObjectCount, 535)
  assert.equal(source.meshCount, 149)
  assert.equal(source.meshRendererCount, 312)
  assert.equal(source.materialCount, 18)
  assert.equal(source.particleSystemCount, 84)
  assert.equal(source.animatorCount, 83)
  assert.equal(source.animationClipCount, 5)
  assert.equal(source.lightmapBindingCount, 173)
  assert.equal(carrier.meshCount, 312)
  assert.equal(carrier.materialCount, 14)
  assert.equal(carrier.animationClipCount, 0)
  assert.equal(runtime.lightCount, 2)
  assert.equal(runtime.lightmapBindingCount, 173)
  assert.equal(runtime.particleSystemCount, 84)
  assert.equal(catalog.dynamic.status, 'partial')
  assert.equal(catalog.dynamic.clipNames.length, 5)
  assert.ok(!catalog.dynamic.missing.some((item) => item.includes('84 Unity ParticleSystem')))
  assert.ok(catalog.dynamic.missing.some((item) => item.includes('shooting-star Trail')))
  assert.equal(catalog.restorationStatus.commonLoaderChanges, false)
  assert.equal(catalog.restorationStatus.gameDirectoryTouched, false)
})
