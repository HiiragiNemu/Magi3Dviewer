import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import zlib from 'node:zlib'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { applyStageUv1Companion } from './src/viewer/stageUv1Companion.ts'

function parseStage(stageId) {
  const stageRoot = path.join('public', 'stages', 'official', stageId)
  const companion = JSON.parse(
    fs.readFileSync(path.join(stageRoot, 'uv1-companion.json'), 'utf8'),
  )
  const bindings = JSON.parse(
    fs.readFileSync(path.join(stageRoot, 'lightmap-bindings.json'), 'utf8'),
  ).renderers
  const compressed = fs.readFileSync(
    path.join(stageRoot, path.basename(companion.fbxPath)),
  )
  const buffer = zlib.gunzipSync(compressed)
  const previousDocument = globalThis.document
  globalThis.document = {
    createElementNS() {
      return {
        addEventListener() {},
        removeEventListener() {},
        set src(_value) {},
        style: {},
      }
    },
  }
  try {
    const root = new FBXLoader().parse(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      '',
    )
    root.name = `Stage:${stageId}`
    return { root, companion, bindings }
  } finally {
    globalThis.document = previousDocument
  }
}

function applyRequiredActiveCarriers(stageId) {
  const { root, companion, bindings } = parseStage(stageId)
  const requiredRuntimePaths = matchActiveLightmapPaths(root, bindings)
  const result = applyStageUv1Companion(root, companion, {
    strict: true,
    requiredRuntimePaths,
  })
  return { root, requiredRuntimePaths, result }
}

function matchActiveLightmapPaths(root, bindings) {
  const normalize = value => value.replaceAll('\\', '/').split('/').filter(Boolean)
  const runtimePaths = []
  root.traverse(object => {
    if (object.isMesh !== true) return
    const parts = []
    let current = object
    while (current) {
      if (current.name) parts.unshift(current.name)
      if (current === root) break
      current = current.parent
    }
    runtimePaths.push(parts.join('/'))
  })
  const claimed = new Set()
  const matches = []
  const ordered = [...bindings].sort((left, right) =>
    normalize(right.rendererHierarchyPath).length
    - normalize(left.rendererHierarchyPath).length
  )
  for (const binding of ordered) {
    const right = normalize(binding.rendererHierarchyPath)
    let best = -1
    let candidates = []
    for (const candidate of runtimePaths) {
      if (claimed.has(candidate)) continue
      const left = normalize(candidate)
      let score = 0
      while (
        score < left.length
        && score < right.length
        && left[left.length - 1 - score] === right[right.length - 1 - score]
      ) score++
      score = score > 0 ? score : -1
      if (score > best) {
        best = score
        candidates = score >= 0 ? [candidate] : []
      } else if (score >= 0 && score === best) {
        candidates.push(candidate)
      }
    }
    if (candidates.length === 1) {
      claimed.add(candidates[0])
      matches.push(candidates[0])
    }
  }
  return matches
}

test('606 applies all 26 active FBX carriers while 120 dependency records stay diagnostic', () => {
  const { root, requiredRuntimePaths, result } = applyRequiredActiveCarriers(
    'battle-606-00-01-002',
  )

  assert.equal(requiredRuntimePaths.length, 25)
  assert.equal(result.coverageMode, 'required-runtime-paths')
  assert.equal(result.declaredNodeCount, 146)
  assert.equal(result.matchedNodeCount, 26)
  assert.equal(result.installedMeshCount, 26)
  assert.equal(result.unmatchedCompanionPaths.length, 120)
  assert.equal(result.requiredRuntimePathCount, 25)
  assert.equal(result.matchedRequiredRuntimePathCount, 25)
  assert.deepEqual(result.missingRequiredRuntimePaths, [])

  let installed = 0
  root.traverse(object => {
    if (object.isMesh === true && object.geometry.getAttribute('uv1')) installed++
  })
  assert.equal(installed, 26)
})

test('stage loader derives required paths with the production lightmap matcher', () => {
  const stages = fs.readFileSync('src/viewer/stages.ts', 'utf8')
  assert.match(stages, /matchStageLightmapBindings\([\s\S]*?\.matches\.map\(/)
  assert.match(
    stages,
    /applyStageUv1Companion\([\s\S]*?requiredRuntimePaths:\s*activeLightmapRendererPaths/,
  )
})

test('606 baked-light authority removes all 21 active point-shadow samplers', () => {
  const profile = JSON.parse(fs.readFileSync(
    'public/stages/official/battle-606-00-01-002/scene-profile.json',
    'utf8',
  ))
  const activePointShadows = profile.renderProfile.lights.filter(light =>
    light.type === 'point'
    && (light.activeSelf ?? light.active) !== false
    && light.enabled !== false
    && light.castShadow === true
  )
  assert.equal(activePointShadows.length, 21)
  assert.ok(activePointShadows.every(light => light.lightmapping === 2))

  const stages = fs.readFileSync('src/viewer/stages.ts', 'utf8')
  assert.match(
    stages,
    /const bakedLightmapsActive\s*=\s*[\s\S]*?hasCompleteActiveStageLightmapCoverage\(activeStageLightmap\)/,
  )
  assert.match(stages, /profile\.lightmapping === 2\s*&& bakedLightmapsActive/)
})

for (const [stageId, expected] of [
  ['battle-603-00-01-003', { declared: 25, matched: 25, inactive: 0 }],
  ['battle-616-00-01-001', { declared: 177, matched: 177, inactive: 0 }],
]) {
  test(`${stageId} remains exact under active-carrier coverage`, () => {
    const { result } = applyRequiredActiveCarriers(stageId)
    assert.equal(result.declaredNodeCount, expected.declared)
    assert.equal(result.matchedNodeCount, expected.matched)
    assert.equal(result.unmatchedCompanionPaths.length, expected.inactive)
    assert.deepEqual(result.missingRequiredRuntimePaths, [])
  })
}

test('a missing required active carrier remains fail-closed', () => {
  const root = new THREE.Group()
  root.name = 'Root'
  const active = new THREE.Mesh(
    new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0], 3),
    ),
    new THREE.MeshBasicMaterial(),
  )
  active.name = 'Active'
  root.add(active)
  const uv1 = new Float32Array([0, 0])
  const companion = {
    schemaVersion: 4,
    stageId: 'negative-neighbor',
    sourceRevision: 'fixture',
    sourceBundle: 'fixture',
    fbxPath: 'fixture',
    uvConvention: 'fixture',
    geometries: {
      dormant: {
        vertexCount: 1,
        sourceMeshPathID: '1',
        sourceMeshCab: 'CAB-fixture',
        uv1Base64: Buffer.from(uv1.buffer).toString('base64'),
      },
    },
    nodes: [{ hierarchyPath: 'Root/Dormant', geometryKey: 'dormant' }],
  }

  assert.throws(
    () => applyStageUv1Companion(root, companion, {
      strict: true,
      requiredRuntimePaths: ['Root/Active'],
    }),
    /coverage=required-runtime-paths.*required=1.*matchedRequired=0.*missingRequired=1/,
  )
})
