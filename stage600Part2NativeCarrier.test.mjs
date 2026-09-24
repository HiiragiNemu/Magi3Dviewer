import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

const source = process.env.S6_SOURCE_ROOT || path.dirname(fileURLToPath(import.meta.url))
const req = createRequire(path.join(source, 'package.json'))
const THREE = await import(pathToFileURL(path.join(source, 'node_modules/three/build/three.module.js')))
const ts = req('typescript')
const { FBXLoader } = await import(pathToFileURL(path.join(source, 'node_modules/three/examples/jsm/loaders/FBXLoader.js')))
const { DDSLoader } = await import(pathToFileURL(path.join(source, 'node_modules/three/examples/jsm/loaders/DDSLoader.js')))
const id = 'battle-600-01-01-002'
const assets = process.env.S6_STAGE_CORPUS_ROOT || path.join(source, 'public/stages/official')
const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))
const profile = read(path.join(assets, id, 'scene-profile.json'))
const uv1 = read(path.join(assets, id, 'uv1-companion.json'))
const lightmap = read(path.join(assets, id, 'lightmap-bindings.json'))
const cache = new Map(), loops = new Set()
function load(name) {
  if (name === 'three') return THREE
  if (name === 'three/addons/loaders/DDSLoader.js') return { DDSLoader }
  if (name === 'magia-exedra-character-three/renderer') return {
    addAnimationLoop: cb => loops.add(cb), removeAnimationLoop: cb => loops.delete(cb), getClockDelta: () => 0,
  }
  // GPU/network loading is exercised in the browser, not by this graph test.
  if (name === './runtimeProductDelivery') return { resolveRuntimeAssetUrl: async url => url }
  if (name === './stageNativeLightmapMips') return {}
  if (cache.has(name)) return cache.get(name)
  let file = name.includes('coordinateSpace')
    ? path.join(source, 'magia-exedra-character-three/coordinateSpace.ts')
    : path.join(source, 'src/viewer', name.replace(/^\.\//, '') + (name.endsWith('.json') ? '' : '.ts'))
  if (file.endsWith('.json')) return read(process.env.S6_BASELINE_ROOT ? path.join(process.env.S6_BASELINE_ROOT, path.relative(source, file)) : file)
  const module = { exports: {} }; cache.set(name, module.exports)
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText
  Function('exports', 'require', 'module', js)(module.exports, load, module)
  return module.exports
}
const hierarchy = load('./stageHierarchy'), visibility = load('./stageNativeVisibility')
const uv = load('./stageUv1Companion'), lm = load('./stageLightmaps')
const reflection = load('./stageReflectionProbes'), batching = load('./stageStaticBatching')
const runtime = load('./stageRuntime'), catalog = load('./stageTransformAnimationCatalog')
function graph() {
  const bytes = zlib.gunzipSync(fs.readFileSync(path.join(assets, id, 'bg_3d_600_01_01_002.fbxdata')))
  const manager = new THREE.LoadingManager()
  manager.addHandler(/./, { setPath() { return this }, load() { return new THREE.Texture() } })
  const root = new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
  root.name = `Stage:${id}`
  const meshes = []; root.traverse(o => { o.layers.set(6); if (o.isMesh) meshes.push(o) })
  root.updateMatrixWorld(true)
  return { root, meshes }
}
const effective = o => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true }
const release = root => root.traverse(o => { if (o.isMesh) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose() } })

test('Part II floor 2 publishes one complete native-ID carrier set, not only 512 lightmapped renderers', () => {
  assert.equal(profile.stageId, id)
  assert.equal(profile.nativeVisibility.renderers.length, 1249)
  assert.equal(uv1.nodes.length, 1249)
  assert.equal(new Set(uv1.nodes.map(n => n.rendererPathID)).size, 1249)
  assert.equal(lightmap.renderers.length, 512)
  assert.equal(profile.renderProfile.reflectionProbeBindings.length, 1249)
  const animation = catalog.withBundledStageTransformAnimations(profile, id).runtime.transformAnimations
  assert.equal(animation.groups.length, 51)
  assert.equal(animation.groups.reduce((sum, g) => sum + g.sources.length, 0), 99)
  assert.deepEqual(animation.groups.map(g => g.expectedCarrierCount).sort((a,b) => b-a).slice(0,2), [49,1])
  assert.match(uv1.fbxPath, /bg_3d_600_01_01_002\.fbxdata$/)
})

test('actual renamed FBX resolves every UV1, lightmap, reflection and native visibility binding', () => {
  const { root, meshes } = graph()
  try {
    assert.equal(meshes.length, 1249)
    let clips = 0; root.traverse(o => clips += o.animations.length); assert.equal(clips, 0)
    const matches = lm.matchStageLightmapBindings(root, lightmap.renderers)
    assert.equal(matches.matches.length, 512)
    assert.deepEqual(matches.ambiguousBindingPaths, []); assert.deepEqual(matches.unmatchedBindingPaths, [])
    const result = uv.applyStageUv1Companion(root, uv1, { strict: true, requiredRuntimePaths: matches.matches.map(m => m.rendererHierarchyPath) })
    assert.equal(result.declaredNodeCount, 1249); assert.equal(result.matchedNodeCount, 1249); assert.equal(result.installedMeshCount, 1249)
    assert.deepEqual(result.unmatchedCompanionPaths, []); assert.deepEqual(result.missingRequiredRuntimePaths, [])
    assert.equal(meshes.filter(m => m.geometry.getAttribute('uv1')).length, 1249)
    const probes = reflection.matchStageReflectionProbeBindings(root, profile.renderProfile.reflectionProbeBindings)
    assert.equal(probes.matches.length, 1249); assert.deepEqual(probes.ambiguousBindingPaths, []); assert.deepEqual(probes.unmatchedBindingPaths, [])
    for (const light of profile.renderProfile.lights) assert.ok(hierarchy.resolveStageHierarchyPath(root, light.anchorPath), light.anchorPath)
    const original = new Map(); root.traverse(o => original.set(o, [o.visible,o.layers.mask]))
    const state = visibility.applyStageNativeVisibility(root, profile.nativeVisibility)
    assert.equal(meshes.filter(m => effective(m) && m.layers.mask).length, 857)
    state.restore()
    for (const [o, pair] of original) assert.deepEqual([o.visible,o.layers.mask], pair)
  } finally { release(root) }
})

test('native visibility survives batching and the real StageRuntime clock, then restores exactly', () => {
  const { root, meshes } = graph(), originals = new Map()
  root.traverse(o => originals.set(o, { visible:o.visible, mask:o.layers.mask, q:o.quaternion.clone() }))
  // Explicit CPU material doubles make batching eligible; actual shader/texture output has a separate browser gate.
  const materials = new Map()
  const convert = old => {
    if (!materials.has(old)) {
      const m = new THREE.MeshStandardMaterial({ transparent:old.transparent, depthWrite:old.depthWrite })
      m.name = old.name; m.userData.stageRigidBatchBinding = old.name; materials.set(old,m)
    }
    return materials.get(old)
  }
  meshes.forEach(o => o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material))
  const state = visibility.applyStageNativeVisibility(root, profile.nativeVisibility)
  const hidden = meshes.filter(m => !effective(m) || !m.layers.mask)
  assert.equal(hidden.length, 392)
  const joined = catalog.withBundledStageTransformAnimations(profile, id)
  const batch = batching.batchStaticStageMeshes(root, { hasRuntimeOrTransformWriter:false, transformAnimations:joined.runtime.transformAnimations })
  const controller = new runtime.StageRuntimeController(root, joined.runtime)
  const debug = controller.getDebugState()
  assert.deepEqual(debug.missingClipNames, [])
  assert.equal(loops.size, 1)
  assert.ok(batch.stats.animatedBatchedMeshes > 0)
  assert.equal(debug.transformAnimations.sourceAnimators, 99)
  assert.equal(debug.transformAnimations.carrierRoots, 99)
  assert.equal(debug.transformAnimations.rotationTargets, 687)
  assert.equal(debug.transformAnimations.clips, 2)
  const initialMatrices = batch.meshes.map(m => m.instanceMatrix.array.slice())
  for (const time of [0,.2,.5,1,3]) {
    controller.seek(time)
    for (const m of hidden) assert.ok(!effective(m) || !m.layers.mask)
    for (const m of batch.meshes) assert.ok([...m.instanceMatrix.array].every(Number.isFinite))
    const drawable = meshes.filter(m => effective(m) && m.layers.mask !== 0).length
      + batch.meshes.filter(effective).reduce((sum,m) => sum + m.count, 0)
    assert.equal(drawable, 857)
    // Compare the complete instance-matrix multiset to the retained source transforms.
    // Float32 conversion matches the GPU instance buffer without tolerating wrong transforms.
    root.updateWorldMatrix(true, true)
    const inverse = root.matrixWorld.clone().invert(), matrix = new THREE.Matrix4()
    const expected = meshes.filter(m => m.userData.stageStaticBatchSource).map(m =>
      [...new Float32Array(matrix.multiplyMatrices(inverse,m.matrixWorld).elements)].join(',')).sort()
    const actual = batch.meshes.flatMap(m => Array.from({length:m.count}, (_,i) =>
      [...m.instanceMatrix.array.slice(i*16,i*16+16)].join(','))).sort()
    assert.deepEqual(actual, expected)
  }
  assert.ok(batch.meshes.some((m,i) => m.instanceMatrix.array.some((v,j) => v !== initialMatrices[i][j])))
  console.log(JSON.stringify({ stage:id, transform:debug.transformAnimations, batching:batch.stats, hidden: hidden.length }))
  controller.dispose(); assert.equal(loops.size, 0)
  batch.restore(); state.restore()
  for (const [o, v] of originals) {
    assert.deepEqual([o.visible,o.layers.mask],[v.visible,v.mask]); assert.ok(o.quaternion.equals(v.q))
  }
  release(root)
})
