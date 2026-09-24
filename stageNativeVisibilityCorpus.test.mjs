import assert from 'node:assert/strict'
import fs from 'node:fs'
import zlib from 'node:zlib'
import test from 'node:test'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { loadStageTransformModules } from './tests/helpers/loadStageTransformModules.mjs'
const { visibility: { applyStageNativeVisibility: apply } } = loadStageTransformModules()
const assetRoot = process.env.S6_STAGE_CORPUS_ROOT || 'public/stages/official'
const corpus = [
  {
    "id": "alternative-background-alternative-bg-model-00",
    "fbxFile": "alternative_bg_model_00.fbxdata",
    "gameObjects": 12,
    "renderers": 3,
    "hidden": 0
  },
  {
    "id": "alternative-background-alternative-bg-model-01",
    "fbxFile": "alternative_bg_model_01.fbxdata",
    "gameObjects": 20,
    "renderers": 5,
    "hidden": 1
  },
  {
    "id": "alternative-stage-model-alternative-stage-model-01-released",
    "fbxFile": "alternative_stage_model_01_released.fbxdata",
    "gameObjects": 69,
    "renderers": 5,
    "hidden": 0
  },
  {
    "id": "alternative-stage-model-alternative-stage-model-1-released",
    "fbxFile": "alternative_stage_model_1_released.fbxdata",
    "gameObjects": 69,
    "renderers": 5,
    "hidden": 0
  },
  {
    "id": "alternative-stage-model-alternative-stage-model-1-unreleased",
    "fbxFile": "alternative_stage_model_1_unreleased.fbxdata",
    "gameObjects": 22,
    "renderers": 1,
    "hidden": 0
  },
  {
    "id": "battle-600-00-01-001",
    "fbxFile": "bg_3d_600_00_01_001.fbxdata",
    "gameObjects": 209,
    "renderers": 134,
    "hidden": 5
  },
  {
    "id": "battle-600-00-01-002",
    "fbxFile": "bg_3d_600_00_01_002.fbxdata",
    "gameObjects": 215,
    "renderers": 158,
    "hidden": 0
  },
  {
    "id": "battle-600-01-00-001",
    "fbxFile": "bg_3d_600_01_00_001.fbxdata",
    "gameObjects": 517,
    "renderers": 353,
    "hidden": 1
  },
  {
    "id": "battle-600-01-01-001",
    "fbxFile": "bg_3d_600_01_01_001.fbxdata",
    "gameObjects": 213,
    "renderers": 133,
    "hidden": 0
  },
  {
    "id": "battle-600-01-01-003",
    "fbxFile": "bg_3d_600_01_01_003.fbxdata",
    "gameObjects": 84,
    "renderers": 54,
    "hidden": 0
  },
  {
    "id": "battle-600-10-00-001",
    "fbxFile": "bg_3d_600_10_00_001.fbxdata",
    "gameObjects": 870,
    "renderers": 691,
    "hidden": 1
  },
  {
    "id": "battle-600-10-01-001",
    "fbxFile": "bg_3d_600_10_01_001.fbxdata",
    "gameObjects": 628,
    "renderers": 529,
    "hidden": 0
  },
  {
    "id": "battle-600-10-01-002",
    "fbxFile": "bg_3d_600_10_01_002.fbxdata",
    "gameObjects": 2396,
    "renderers": 2193,
    "hidden": 2
  },
  {
    "id": "battle-600-10-01-003",
    "fbxFile": "bg_3d_600_10_01_003.fbxdata",
    "gameObjects": 87,
    "renderers": 56,
    "hidden": 0
  },
  {
    "id": "battle-601-00-00-001",
    "fbxFile": "bg_3d_601_00_00_001.fbxdata",
    "gameObjects": 526,
    "renderers": 299,
    "hidden": 19
  },
  {
    "id": "battle-601-00-01-003",
    "fbxFile": "bg_3d_601_00_01_003.fbxdata",
    "gameObjects": 1087,
    "renderers": 311,
    "hidden": 24
  },
  {
    "id": "battle-601-14-00-001",
    "fbxFile": "bg_3d_601_14_00_001.fbxdata",
    "gameObjects": 526,
    "renderers": 299,
    "hidden": 19
  },
  {
    "id": "battle-601-15-00-001",
    "fbxFile": "bg_3d_601_15_00_001.fbxdata",
    "gameObjects": 526,
    "renderers": 299,
    "hidden": 19
  }
]
for (const row of corpus) test(row.id + ': native initial visibility and complete restoration on real FBX', () => {
 const dir = assetRoot + '/' + row.id
 const profile = JSON.parse(fs.readFileSync(dir + '/scene-profile.json', 'utf8'))
 assert.equal(profile.nativeVisibility?.gameObjects.length, row.gameObjects)
 assert.equal(profile.nativeVisibility?.renderers.length, row.renderers)
 assert.ok(fs.existsSync(dir + '/' + row.fbxFile))
 let bytes = fs.readFileSync(dir + '/' + row.fbxFile); if (bytes[0] === 31 && bytes[1] === 139) bytes = zlib.gunzipSync(bytes)
 const manager = new THREE.LoadingManager(); manager.addHandler(/./, { setPath() { return this }, load() { return new THREE.Texture() } })
 const scene = new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
 scene.name = 'Stage:' + row.id
 const original = new Map(), meshes = []; scene.traverse(o => { o.layers.set(6); original.set(o, [o.visible, o.layers.mask]); if (o.isMesh) meshes.push(o) })
 const drawable = o => { if (!o.layers.mask) return false; for (let p = o; p; p = p.parent) if (!p.visible) return false; return true }
 const before = meshes.filter(drawable).length; const state = apply(scene, profile.nativeVisibility)
 assert.ok(before > 0); assert.equal(before - meshes.filter(drawable).length, row.hidden)
 state.restore(); for (const [o, values] of original) assert.deepEqual([o.visible, o.layers.mask], values)
 scene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose() } })
})
