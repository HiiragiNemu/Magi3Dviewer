import assert from 'node:assert/strict'
import fs from 'node:fs'
import zlib from 'node:zlib'
import test from 'node:test'
import { createHash } from 'node:crypto'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { loadStageTransformModules } from './tests/helpers/loadStageTransformModules.mjs'
import { requiredDirectoryClosures, withBundledStageRoots } from './scripts/copy-deployment-public.mjs'
const { visibility: { applyStageNativeVisibility: apply } } = loadStageTransformModules()
const assetRoot = process.env.S6_STAGE_CORPUS_ROOT || 'public/stages/official'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
// Native initial-state evidence, not a declaration of full scene/lighting fidelity.
// Literal carrier paths below are independent expected targets, not runtime resolver results.
const corpus = [
  {
    "id": "battle-602-00-01-001",
    "fbxFile": "bg_3d_602_00_01_001.fbxdata",
    "fbxSha256": "d537f2e5d6eebed4a2c232cf562fe860b0e6e48019284133599679c945183787",
    "profileStateSha256": "d5daf75328259832faa0630e1c16a4d23254fb01522085b32fa4d0c0fa833752",
    "gameObjects": 310,
    "renderers": 262,
    "meshes": 262,
    "hidden": 0,
    "inactivePaths": [
      "/Stage:battle-602-00-01-001/Light"
    ],
    "disabledPaths": []
  },
  {
    "id": "battle-602-11-00-001",
    "fbxFile": "bg_3d_602_11_00_001.fbxdata",
    "fbxSha256": "22849531eba03861f5fc4d4532e1294c82583b144c770cf81b9924b8018520cb",
    "profileStateSha256": "aa15ce0488c0f2fb32a4a913e4775fd00236e71b1334257da428f92c3a3cdaea",
    "gameObjects": 1322,
    "renderers": 604,
    "meshes": 581,
    "hidden": 74,
    "inactivePaths": [
      "/Stage:battle-602-11-00-001/Light/VolumeLight",
      "/Stage:battle-602-11-00-001/Light/fillLight2",
      "/Stage:battle-602-11-00-001/Light/backLight_01",
      "/Stage:battle-602-11-00-001/Light/backLight",
      "/Stage:battle-602-11-00-001/Reflection_Probe"
    ],
    "disabledPaths": [
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Konpeito8/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Konpeito6/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Konpeito1/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander6/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Hide5/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander10/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Hide6/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander13/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Hide8/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander3/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Konpeito6/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Hide1/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Hide1/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Konpeito5/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander3/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-11-00-001/bg3d602HW2025_00/object_mid_grp/cokkie_grp/cokkieDB_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander3/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander4/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Hide9/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Hide9/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander7/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Hide8/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Hide6/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Hide1/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-11-00-001/bg3d602HW2025_00/object_mid_grp/cokkie_grp/cokkieDA_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Konpeito8/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Konpeito1/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Hide5/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander7/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Konpeito3/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Hide5/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Konpeito2/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Hide4/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander1/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander10/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander7/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander4/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander14/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Konpeito8/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Konpeito3/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Hide9/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-11-00-001/bg3d602HW2025_00/object_mid_grp/cokkie_grp/cokkieDC_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Konpeito1/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander6/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Hide8/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander9/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Hide4/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Konpeito2/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Konpeito6/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Konpeito7/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander13/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander1/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-11-00-001/bg3d602HW2025_00/object_mid_grp/cokkie_grp/cokkieDD_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Konpeito5/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Hide4/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-11-00-001/bg3d602HW2025_00/object_near_grp/gumBall_grp/gumBallI_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander13/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander9/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander14/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Konpeito2/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander14/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Konpeito7/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander8/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Hide6/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander9/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander4/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Konpeito3/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander8/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Konpeito5/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander8/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Konpeito7/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander1/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander10/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-11-00-001/pyotr_layout/pyotr_Wander6/konpeitouY_geo_world/konpeitou/konpeitouP_geo"
    ]
  },
  {
    "id": "battle-602-11-01-001",
    "fbxFile": "bg_3d_602_11_01_001.fbxdata",
    "fbxSha256": "abd28315b4552e4bc676b3b718ef3716c199d3a5a016ac1009d0013e6125fffd",
    "profileStateSha256": "9445718916875723cf603d43b2b6f7a54b1676900aa7e01f69c1ae587675b7b3",
    "gameObjects": 310,
    "renderers": 264,
    "meshes": 264,
    "hidden": 5,
    "inactivePaths": [],
    "disabledPaths": [
      "/Stage:battle-602-11-01-001/bg3d602HW2025_01_01/object_far_grp/syringe_grp/syringeB003_geo",
      "/Stage:battle-602-11-01-001/bg3d602HW2025_01_01/object_far_grp/syringe_grp/syringeA007_geo",
      "/Stage:battle-602-11-01-001/bg3d602HW2025_01_01/object_far_grp/syringe_grp/syringeA006_geo",
      "/Stage:battle-602-11-01-001/bg3d602HW2025_01_01/object_far_grp/syringe_grp/syringeC005_geo",
      "/Stage:battle-602-11-01-001/bg3d602HW2025_01_01/object_far_grp/syringe_grp/syringeC007_geo"
    ]
  },
  {
    "id": "battle-602-14-00-001",
    "fbxFile": "bg_3d_602_14_00_001.fbxdata",
    "fbxSha256": "49af6a4f6f25f4f297f750ab6dd16c3862dbb1db230d6b064e70b94aeddbe9ec",
    "profileStateSha256": "88a4a64e2ca07a0a9011de453a62bbc5b3f1648b8d35e3626c0a65da59f7144d",
    "gameObjects": 732,
    "renderers": 112,
    "meshes": 89,
    "hidden": 69,
    "inactivePaths": [
      "/Stage:battle-602-14-00-001/Light/backLight",
      "/Stage:battle-602-14-00-001/Light/VolumeLight",
      "/Stage:battle-602-14-00-001/Reflection_Probe",
      "/Stage:battle-602-14-00-001/Light/backLight_01",
      "/Stage:battle-602-14-00-001/Light/fillLight2"
    ],
    "disabledPaths": [
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Konpeito5/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander7/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Konpeito7/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Hide6/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Konpeito3/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Hide5/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander7/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander8/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander7/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Hide4/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander3/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Hide6/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Konpeito7/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander13/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Konpeito2/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander14/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Hide6/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander6/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Konpeito8/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Konpeito8/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Konpeito1/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Hide1/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander1/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Konpeito6/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander1/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Hide9/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander8/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Konpeito2/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Konpeito6/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander1/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Hide5/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Konpeito7/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander3/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Konpeito5/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Konpeito1/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Konpeito3/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander9/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander8/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Konpeito3/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Konpeito6/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Hide9/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander4/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Hide9/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander9/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Konpeito5/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Hide8/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander9/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Hide8/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Hide5/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Hide8/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Konpeito8/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Konpeito1/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander6/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander6/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Hide1/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Hide4/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander13/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander13/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander10/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander14/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Hide4/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Hide1/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander4/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander3/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Konpeito2/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander10/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander4/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander14/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-14-00-001/pyotr_layout/pyotr_Wander10/konpeitouY_geo_world/konpeitou/konpeitouG_geo"
    ]
  },
  {
    "id": "battle-602-15-00-001",
    "fbxFile": "bg_3d_602_15_00_001.fbxdata",
    "fbxSha256": "594049a1ae6d87e961ab693f53ac2ea597d890066a513ff4d9e6aebad38f5e38",
    "profileStateSha256": "274fac0ddda75f3b7b3bfdec1b9f03061331883e49643b00f9ace9150ec53d55",
    "gameObjects": 732,
    "renderers": 112,
    "meshes": 89,
    "hidden": 69,
    "inactivePaths": [
      "/Stage:battle-602-15-00-001/Light/fillLight2",
      "/Stage:battle-602-15-00-001/Reflection_Probe",
      "/Stage:battle-602-15-00-001/Light/backLight_01",
      "/Stage:battle-602-15-00-001/Light/backLight",
      "/Stage:battle-602-15-00-001/Light/VolumeLight"
    ],
    "disabledPaths": [
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander8/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander1/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander9/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Hide4/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Hide1/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Hide4/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander14/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander7/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Hide1/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Konpeito2/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Konpeito7/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander13/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander13/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander8/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Hide5/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander3/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander10/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander3/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander1/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Konpeito6/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Konpeito5/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander8/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Konpeito1/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Hide6/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander1/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Konpeito7/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Konpeito7/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Konpeito1/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Konpeito2/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander4/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Hide6/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander13/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Hide5/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander3/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander6/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander14/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Hide6/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander7/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Hide8/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Hide8/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Konpeito5/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Konpeito6/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Konpeito8/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander10/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Hide5/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Konpeito3/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander6/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Konpeito8/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Hide1/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Konpeito1/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander9/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander4/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Hide8/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Hide9/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Konpeito3/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Hide4/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander6/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Hide9/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander7/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Konpeito2/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Konpeito6/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander4/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Hide9/konpeitouY_geo_world/konpeitou/konpeitouG_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Konpeito3/konpeitouY_geo_world/konpeitou/konpeitouP_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander10/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander14/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Konpeito8/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Wander9/konpeitouY_geo_world/konpeitou/konpeitouY_geo",
      "/Stage:battle-602-15-00-001/pyotr_layout/pyotr_Konpeito5/konpeitouY_geo_world/konpeitou/konpeitouY_geo"
    ]
  },
  {
    "id": "battle-603-00-01-003",
    "fbxFile": "bg_3d_603_00_01_003.fbxdata",
    "fbxSha256": "134776d27234511c8e799d22319851a03c17170ba6627f58daead361316f8ae1",
    "profileStateSha256": "1808c0f33441c57d491f508c9d007b7725a64ec5de3392312129defb973b3b41",
    "gameObjects": 43,
    "renderers": 25,
    "meshes": 25,
    "hidden": 12,
    "inactivePaths": [
      "/Stage:battle-603-00-01-003/bg3d603_00/far_grp/bgFarA_ctrl/redhorseupper_ctrl/redhorseupper_geo01",
      "/Stage:battle-603-00-01-003/bg3d603_00/far_grp/bgFarB_ctrl/darkhorseupper_ctrl/darkhorseupper_geo01",
      "/Stage:battle-603-00-01-003/bg3d603_00/far_grp/bgFarA_ctrl/redhorseupper_ctrl/redhorseupper_geo02",
      "/Stage:battle-603-00-01-003/bg3d603_00/far_grp/bgFarB_ctrl/darkhorseupper_ctrl/darkhorseupper_geo02",
      "/Stage:battle-603-00-01-003/bg3d603_00/far_grp/bgFarB_ctrl/darkhorselower_ctrl/darkhorselower_geo03",
      "/Stage:battle-603-00-01-003/bg3d603_00/far_grp/bgFarB_ctrl/darkhorseupper_ctrl/darkhorseupper_geo03",
      "/Stage:battle-603-00-01-003/bg3d603_00/far_grp/bgFarA_ctrl/redhorselower_ctrl/redhorselower_geo03",
      "/Stage:battle-603-00-01-003/bg3d603_00/far_grp/bgFarB_ctrl/darkhorselower_ctrl/darkhorselower_geo01",
      "/Stage:battle-603-00-01-003/bg3d603_00/far_grp/bgFarA_ctrl/redhorselower_ctrl/redhorselower_geo01",
      "/Stage:battle-603-00-01-003/bg3d603_00/far_grp/bgFarB_ctrl/darkhorselower_ctrl/darkhorselower_geo02",
      "/Stage:battle-603-00-01-003/bg3d603_00/far_grp/bgFarA_ctrl/redhorselower_ctrl/redhorselower_geo02",
      "/Stage:battle-603-00-01-003/bg3d603_00/wall_grp"
    ],
    "disabledPaths": [
      "/Stage:battle-603-00-01-003/bg3d603_00/wall_grp/wall_geo",
      "/Stage:battle-603-00-01-003/bg3d603_00/far_grp/bgFarA_ctrl/redhorselower_ctrl/redhorselower_geo01"
    ]
  },
  {
    "id": "battle-604-00-00-001",
    "fbxFile": "bg_3d_604_00_00_001.fbxdata",
    "fbxSha256": "f9e5d7a051e7ed4f42be07d5a55ab9549bf7f12d33aa2947522e64f1c4c0ed80",
    "profileStateSha256": "a141522ea9c4c510fe6cd3b7c7e6cb1885d58094dc74599ca1aab7a15e829ffd",
    "gameObjects": 995,
    "renderers": 867,
    "meshes": 867,
    "hidden": 0,
    "inactivePaths": [
      "/Stage:battle-604-00-00-001/Light_bg3d6012_3/backLight",
      "/Stage:battle-604-00-00-001/Light_bg3d6012_3/fillLight2",
      "/Stage:battle-604-00-00-001/Light_bg3d6012_3/fillLight"
    ],
    "disabledPaths": []
  },
  {
    "id": "battle-604-00-01-001",
    "fbxFile": "bg_3d_604_00_01_001.fbxdata",
    "fbxSha256": "48986a4c691a60651fc80d3f8a30aba20163350d3618a5255bc87e5318d0bfd0",
    "profileStateSha256": "38b72205cf604c043e7b35600e1cc2771a13c9d592805e356cd1ceda7264c19f",
    "gameObjects": 683,
    "renderers": 560,
    "meshes": 560,
    "hidden": 0,
    "inactivePaths": [],
    "disabledPaths": []
  },
  {
    "id": "battle-604-00-01-002",
    "fbxFile": "bg_3d_604_00_01_002.fbxdata",
    "fbxSha256": "4b34b0e782f4cbce7a969963a6ada39ff91edf6567b9c25951f5e7cf9e9c2274",
    "profileStateSha256": "4e0dadd1da96e5474978061b02c6735b1298c6b831feeb9e38a58fcbc6c6b634",
    "gameObjects": 1210,
    "renderers": 1069,
    "meshes": 1068,
    "hidden": 25,
    "inactivePaths": [],
    "disabledPaths": [
      "/Stage:battle-604-00-01-002/bg3d604_01_02/prop_grp/deco_grp/deco_b_grp/deco_b_geo02",
      "/Stage:battle-604-00-01-002/bg3d604_01_02/prop_grp/bear_grp/A/bearA/maefoot_Up",
      "/Stage:battle-604-00-01-002/bg3d604_01_02/prop_grp/bear_grp/A/bearA/body",
      "/Stage:battle-604-00-01-002/bg3d604_01_02/prop_grp/bear_grp/A/bearA/mouth",
      "/Stage:battle-604-00-01-002/bg3d604_01_02/prop_grp/bear_grp/A/bearA/maeTop_Down",
      "/Stage:battle-604-00-01-002/bg3d604_01_02/prop_grp/bear_grp/A/bearA/maeTop_Up",
      "/Stage:battle-604-00-01-002/bg3d604_01_02/prop_grp/bear_grp/B/bearB/maefoot_Up",
      "/Stage:battle-604-00-01-002/bg3d604_01_02/prop_grp/bear_grp/B/bearB/maeTop_Down",
      "/Stage:battle-604-00-01-002/bg3d604_01_02/prop_grp/bear_grp/B/bearB/leg_Down",
      "/Stage:battle-604-00-01-002/bg3d604_01_02/prop_grp/bear_grp/B/bearB/momo_Down",
      "/Stage:battle-604-00-01-002/bg3d604_01_02/prop_grp/bear_grp/B/bearB/maeTop_Up",
      "/Stage:battle-604-00-01-002/bg3d604_01_02/prop_grp/bear_grp/B/bearB/momo_Up",
      "/Stage:battle-604-00-01-002/bg3d604_01_02/prop_grp/bear_grp/A/bearA/leg_Up",
      "/Stage:battle-604-00-01-002/bg3d604_01_02/prop_grp/bear_grp/A/bearA/leg_Down",
      "/Stage:battle-604-00-01-002/bg3d604_01_02/prop_grp/bear_grp/B/bearB/head",
      "/Stage:battle-604-00-01-002/bg3d604_01_02/prop_grp/bear_grp/A/bearA/momo_Up",
      "/Stage:battle-604-00-01-002/bg3d604_01_02/prop_grp/bear_grp/A/bearA/head",
      "/Stage:battle-604-00-01-002/bg3d604_01_02/prop_grp/deco_grp/deco_d_grp/deco_d_geo01",
      "/Stage:battle-604-00-01-002/bg3d604_01_02/prop_grp/bear_grp/A/bearA/maefoot_Down",
      "/Stage:battle-604-00-01-002/bg3d604_01_02/prop_grp/bear_grp/B/bearB/mouth",
      "/Stage:battle-604-00-01-002/bg3d604_01_02/prop_grp/deco_grp/deco_b_grp/deco_b_geo01",
      "/Stage:battle-604-00-01-002/bg3d604_01_02/prop_grp/bear_grp/B/bearB/maefoot_Down",
      "/Stage:battle-604-00-01-002/bg3d604_01_02/prop_grp/bear_grp/A/bearA/momo_Down",
      "/Stage:battle-604-00-01-002/bg3d604_01_02/prop_grp/bear_grp/B/bearB/body",
      "/Stage:battle-604-00-01-002/bg3d604_01_02/prop_grp/bear_grp/B/bearB/leg_Up"
    ]
  },
  {
    "id": "battle-605-00-01-001",
    "fbxFile": "bg_3d_605_00_01_001.fbxdata",
    "fbxSha256": "ef5babdf40746146fb28ea6eb0be01e5b7d03d36563e6e8e47ad8cce4c30abc4",
    "profileStateSha256": "322bd77ac5d5ecb0d2a5a7406fcba93a944c65fc71b7d0b3f1c8b7ac51be233c",
    "gameObjects": 3179,
    "renderers": 2550,
    "meshes": 2550,
    "hidden": 0,
    "inactivePaths": [],
    "disabledPaths": []
  },
  {
    "id": "battle-606-00-00-001",
    "fbxFile": "bg_3d_606_00_00_001.fbxdata",
    "fbxSha256": "0636f12161180b7feef7a8b069fc8a85f19057f9ea6eecd772f786e9be7db13e",
    "profileStateSha256": "daab7e13326781b1d18df9c756847e6bcd86cf868f7acdb728a02e6aa5a83a8b",
    "gameObjects": 45,
    "renderers": 17,
    "meshes": 17,
    "hidden": 7,
    "inactivePaths": [
      "/Stage:battle-606-00-00-001/Light/BG_CenterLight_04",
      "/Stage:battle-606-00-00-001/bg3d606_00_sky/skyPattern1B_geo",
      "/Stage:battle-606-00-00-001/Light/BG_CenterLight_02",
      "/Stage:battle-606-00-00-001/Light/BG_spotLight_frontR",
      "/Stage:battle-606-00-00-001/Light/BG_CenterLight_01",
      "/Stage:battle-606-00-00-001/Light/Point_Light",
      "/Stage:battle-606-00-00-001/Light/BG_CenterLight_03",
      "/Stage:battle-606-00-00-001/bg3d606_00_t00",
      "/Stage:battle-606-00-00-001/Light/BG_spotLight_frontL",
      "/Stage:battle-606-00-00-001/Light/BG_spotLight_frontC"
    ],
    "disabledPaths": []
  },
  {
    "id": "battle-606-00-01-001",
    "fbxFile": "bg_3d_606_00_01_001.fbxdata",
    "fbxSha256": "e05928ec572bdf0659223387ec77537e107908229bcd9c47aa014c54098fb70b",
    "profileStateSha256": "8d990511fea764cea047f6b6ddbffb57607498c95dbf47714ecbff8c9bf4bb2d",
    "gameObjects": 825,
    "renderers": 786,
    "meshes": 786,
    "hidden": 8,
    "inactivePaths": [
      "/Stage:battle-606-00-01-001/bg3d606_01_01/witchfog_grp/witchfog_geo7",
      "/Stage:battle-606-00-01-001/bg3d606_01_01/witchfog_grp/witchfog_geo10",
      "/Stage:battle-606-00-01-001/bg3d606_01_01_sky/skyPattern1B_geo",
      "/Stage:battle-606-00-01-001/bg3d606_01_01/fog_grp/fog_geo6",
      "/Stage:battle-606-00-01-001/bg3d_Eff_SmokeParticle_",
      "/Stage:battle-606-00-01-001/bg3d606_01_01/witchfog_grp/witchfog_geo4_01",
      "/Stage:battle-606-00-01-001/bg3d606_01_01/fog_grp/fog_geo7",
      "/Stage:battle-606-00-01-001/bg3d606_01_01/witchfog_grp/witchfog_geo9",
      "/Stage:battle-606-00-01-001/bg3d606_01_01/witchfog_grp/witchfog_geo8"
    ],
    "disabledPaths": []
  }
]

for (const row of corpus) test(row.id + ': native state targets, real FBX, shipping and exact rollback', () => {
 const dir = assetRoot + '/' + row.id
 const profile = JSON.parse(fs.readFileSync(dir + '/scene-profile.json', 'utf8'))
 assert.equal(profile.nativeVisibility?.gameObjects.length, row.gameObjects)
 assert.equal(profile.nativeVisibility?.renderers.length, row.renderers)
 assert.equal(hash(JSON.stringify(profile.nativeVisibility)), row.profileStateSha256)
 let bytes = fs.readFileSync(dir + '/' + row.fbxFile)
 assert.equal(hash(bytes), row.fbxSha256)
 if (bytes[0] === 31 && bytes[1] === 139) bytes = zlib.gunzipSync(bytes)
 const manager = new THREE.LoadingManager(); manager.addHandler(/./, { setPath() { return this }, load() { return new THREE.Texture() } })
 const scene = new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
 scene.name = 'Stage:' + row.id
 const original = new Map(), paths = new Map(), meshes = []
 const visit = (object, prefix = '') => { const p = prefix + '/' + object.name; assert.ok(!paths.has(p), p); paths.set(p, object); object.layers.set(6); original.set(object, {path:p, visible:object.visible, layers:object.layers.mask}); if(object.isMesh)meshes.push(object); for(const child of object.children)visit(child,p) }
 visit(scene)
 const drawable = o => { if (!o.layers.mask) return false; for (let p = o; p; p = p.parent) if (!p.visible) return false; return true }
 assert.equal(meshes.filter(drawable).length, row.meshes)
 const inactive = new Set(row.inactivePaths), disabled = new Set(row.disabledPaths)
 for (const p of [...inactive, ...disabled]) assert.ok(paths.has(p), p)
 const state = apply(scene, profile.nativeVisibility)
 for (const [o, expected] of original) {
  assert.equal(o.visible, inactive.has(expected.path) ? false : expected.visible, expected.path)
  assert.equal(o.layers.mask, disabled.has(expected.path) ? 0 : expected.layers, expected.path)
 }
 assert.deepEqual(state.debug.ambiguousGameObjectPaths, [])
 assert.deepEqual(state.debug.ambiguousRendererPaths, [])
 assert.equal(state.debug.inactiveGameObjects, inactive.size)
 assert.equal(state.debug.disabledRenderers, disabled.size)
 assert.equal(row.meshes - meshes.filter(drawable).length, row.hidden)
 state.restore(); state.restore()
 for (const [o, expected] of original) assert.deepEqual([o.visible, o.layers.mask], [expected.visible, expected.layers], expected.path)
 assert.equal(meshes.filter(drawable).length, row.meshes)
 assert.ok(requiredDirectoryClosures.some(c => c.output === 'stages/official/' + row.id))
 const catalog = JSON.parse(fs.readFileSync('public/catalogs/runtime-product-delivery.v1.json','utf8'))
 assert.ok(withBundledStageRoots(catalog).bundledStageRoots.includes('/stages/official/' + row.id + '/'))
 scene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose() } })
})
