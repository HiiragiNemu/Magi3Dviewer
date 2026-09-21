import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import test from 'node:test'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import ts from 'typescript'

const profileDocument = JSON.parse(readFileSync(
  'magia-exedra-character-three/official-face-mesh-switcher-profiles.generated.json',
  'utf8',
))
const runtimeSource = readFileSync(
  'magia-exedra-character-three/faceMeshSwitcher.ts',
  'utf8',
)
const loaderSource = readFileSync(
  'magia-exedra-character-three/loader.ts',
  'utf8',
)
const rendererSource = readFileSync(
  'magia-exedra-character-three/renderer.ts',
  'utf8',
)
const sceneSource = readFileSync(
  'magia-exedra-character-three/scene/index.ts',
  'utf8',
)
const characterSource = readFileSync(
  'magia-exedra-character-three/character.ts',
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
      throw new Error('Unexpected import ' + specifier + ' from ' + path)
    },
    module,
  )
  return module.exports
}

const cameraCallbacks = []
function axisToVector(axis) {
  const vectors = {
    x: [1, 0, 0],
    y: [0, 1, 0],
    z: [0, 0, 1],
    '-x': [-1, 0, 0],
    '-y': [0, -1, 0],
    '-z': [0, 0, -1],
  }
  const value = new THREE.Vector3(...vectors[axis])
  value.x *= -1
  return value
}

const runtimeModule = loadTypeScriptCommonJs(
  'magia-exedra-character-three/faceMeshSwitcher.ts',
  {
    three: THREE,
    './official-face-mesh-switcher-profiles.generated.json': profileDocument,
    './renderProfile': { unityDirectionToThreeFbx: axisToVector },
    './renderer': {
      addCameraRenderLoop(callback) {
        if (!cameraCallbacks.includes(callback)) cameraCallbacks.push(callback)
      },
      removeCameraRenderLoop(callback) {
        const index = cameraCallbacks.indexOf(callback)
        if (index >= 0) cameraCallbacks.splice(index, 1)
      },
    },
  },
)

const fixturePaths = {
  115201:
    'magia-exedra-character-three/models/chara_115201_battle_unit/VisualRoot.fbx.gz',
  100102:
    'magia-exedra-character-three/models/chara_100102/chara_100102.fbx.gz',
  108301:
    'magia-exedra-character-three/models/chara_108301_battle_unit/VisualRoot.fbx.gz',
  101901:
    'magia-exedra-character-three/models/chara_101901_battle_unit/VisualRoot.fbx.gz',
  100107:
    'magia-exedra-character-three/models/chara_100107_battle_unit/VisualRoot.fbx.gz',
}
const parsedFixtures = new Map()

function parseActualCharacterFbx(characterId) {
  const cached = parsedFixtures.get(characterId)
  if (cached) return cached
  const bytes = gunzipSync(readFileSync(fixturePaths[characterId]))
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
    const root = new FBXLoader(new THREE.LoadingManager()).parse(
      arrayBuffer,
      'file:///official-face-switcher-fixture/',
    )
    parsedFixtures.set(characterId, root)
    return root
  } finally {
    THREE.TextureLoader.prototype.load = originalTextureLoad
  }
}

function findObject(root, name) {
  let result
  root.traverse(object => {
    if (!result && object.name === name) result = object
  })
  assert.ok(result, 'missing ' + name)
  return result
}

function meshVisibility(root, profile) {
  return Object.fromEntries(
    Object.entries(profile.meshes).map(([role, name]) => [
      role,
      findObject(root, name).visible,
    ]),
  )
}

function positionCamera(root, profile, horizontal, elevation) {
  const head = findObject(root, profile.head.name)
  root.updateMatrixWorld(true)
  head.updateWorldMatrix(true, false)
  const headPosition = new THREE.Vector3()
  const headQuaternion = new THREE.Quaternion()
  head.getWorldPosition(headPosition)
  head.getWorldQuaternion(headQuaternion)
  const forward = axisToVector(profile.faceForwardAxis)
    .applyQuaternion(headQuaternion)
    .normalize()
  const right = axisToVector(profile.faceRightAxis)
    .applyQuaternion(headQuaternion)
    .normalize()
  const up = axisToVector(profile.faceUpAxis)
    .applyQuaternion(headQuaternion)
    .normalize()
  const horizontalRadians = THREE.MathUtils.degToRad(horizontal)
  const elevationRadians = THREE.MathUtils.degToRad(elevation)
  const direction = forward
    .multiplyScalar(Math.cos(horizontalRadians) * Math.cos(elevationRadians))
    .addScaledVector(
      right,
      Math.sin(horizontalRadians) * Math.cos(elevationRadians),
    )
    .addScaledVector(up, Math.sin(elevationRadians))
    .normalize()
  const camera = new THREE.PerspectiveCamera(40, 16 / 9)
  camera.name = 'fixture-' + horizontal + '-' + elevation
  camera.position.copy(headPosition).addScaledVector(direction, 3)
  camera.lookAt(headPosition)
  camera.updateMatrixWorld(true)
  return camera
}

test('92 official battle units generate one exact serialized component profile', () => {
  assert.equal(profileDocument.schemaVersion, 1)
  assert.equal(profileDocument.scannedBattleUnitCount, 92)
  assert.equal(profileDocument.profileCount, 1)
  const [profile] = profileDocument.profiles
  assert.equal(profile.source.bundle,
    'battle/character/chara_115201_battle_unit')
  assert.equal(profile.source.componentPathId, '8280859703183668957')
  assert.equal(profile.source.rootGameObjectPathId, '4217548358760434280')
  assert.equal(profile.faceForwardDirection, 3)
  assert.equal(profile.faceForwardAxis, '-x')
  assert.equal(profile.faceUpAxis, 'y')
  assert.equal(profile.faceRightAxis, 'z')
  assert.deepEqual(profile.meshes, {
    faceFrontRight: 'Face_R_Mesh',
    faceFrontLeft: 'Face_L_Mesh',
    faceSide: 'Face_Side_Mesh',
    facepartsFront: 'Faceparts_Front_Mesh',
    facepartsSide: 'Faceparts_Side_Mesh',
    mouthFrontRight: 'Mouth_R_Mesh',
    mouthFrontLeft: 'Mouth_L_Mesh',
    mouthSide: 'Mouth_Side_Mesh',
  })
  assert.equal(profile.switchAngle, 65)
  assert.equal(profile.hysteresisAngle, 2.5)
  assert.equal(profile.elevationMin, 5)
  assert.equal(profile.elevationMax, 85)
  assert.equal(profile.cameraDownOffsetAtMax, 0.10000000149011612)
  assert.equal(profile.yScaleAtMax, 0)
  assert.equal(profile.localZElevationMin, 5)
  assert.equal(profile.localZElevationMax, 85)
  assert.equal(profile.localZOffsetAtMax, -0.10000000149011612)
  assert.equal(profile.localZFrontBackBlend, 0.5)
  assert.equal(profile.boneHideAngle, 95)
  assert.equal(profile.boneHideElevationAngle, 40)
  assert.equal(runtimeModule.OFFICIAL_FACE_BONE_HIDE_SCALE, 0.0001)
})

test('FaceState uses serialized 65 degree switch with 2.5 degree hysteresis', () => {
  const evaluate = runtimeModule.evaluateOfficialFaceState
  assert.equal(evaluate(0, 'FrontRight', 65, 2.5), 'FrontRight')
  assert.equal(evaluate(-0.01, 'FrontRight', 65, 2.5), 'FrontLeft')
  assert.equal(evaluate(67.49, 'FrontRight', 65, 2.5), 'FrontRight')
  assert.equal(evaluate(67.51, 'FrontRight', 65, 2.5), 'Side')
  assert.equal(evaluate(62.51, 'Side', 65, 2.5), 'Side')
  assert.equal(evaluate(62.49, 'Side', 65, 2.5), 'FrontRight')
  assert.equal(evaluate(-67.51, 'FrontLeft', 65, 2.5), 'Side')
  assert.equal(evaluate(-62.49, 'Side', 65, 2.5), 'FrontLeft')
})

test('real 115201 FBX switches exactly one face, faceparts, and mouth set', () => {
  const root = parseActualCharacterFbx(115201)
  const [profile] = profileDocument.profiles
  assert.deepEqual(meshVisibility(root, profile), {
    faceFrontRight: true,
    faceFrontLeft: true,
    faceSide: true,
    facepartsFront: true,
    facepartsSide: true,
    mouthFrontRight: true,
    mouthFrontLeft: true,
    mouthSide: true,
  }, 'FBX baseline exposes all official alternatives simultaneously')

  const runtime = runtimeModule.installOfficialFaceMeshSwitcher(root)
  assert.ok(runtime)
  assert.equal(cameraCallbacks.length, 1)
  assert.equal(
    runtimeModule.getActiveOfficialFaceMeshSwitcherDebugStates().length,
    1,
  )
  assert.equal(runtime.debug.matchedBy, 'complete-semantic-mesh-set')
  assert.deepEqual(meshVisibility(root, profile), {
    faceFrontRight: true,
    faceFrontLeft: false,
    faceSide: false,
    facepartsFront: true,
    facepartsSide: false,
    mouthFrontRight: true,
    mouthFrontLeft: false,
    mouthSide: false,
  })

  runtime.update(positionCamera(root, profile, -10, 0))
  assert.equal(runtime.debug.state, 'FrontLeft')
  assert.deepEqual(meshVisibility(root, profile), {
    faceFrontRight: false,
    faceFrontLeft: true,
    faceSide: false,
    facepartsFront: true,
    facepartsSide: false,
    mouthFrontRight: false,
    mouthFrontLeft: true,
    mouthSide: false,
  })

  runtime.update(positionCamera(root, profile, 80, 0))
  assert.equal(runtime.debug.state, 'Side')
  assert.deepEqual(meshVisibility(root, profile), {
    faceFrontRight: false,
    faceFrontLeft: false,
    faceSide: true,
    facepartsFront: false,
    facepartsSide: true,
    mouthFrontRight: false,
    mouthFrontLeft: false,
    mouthSide: true,
  })

  runtime.update(positionCamera(root, profile, 0, 50))
  assert.equal(runtime.debug.controlBoneAvailable, false)
  assert.equal(runtime.debug.controlBoneName, 'MouthScaleOffset')
  assert.equal(runtime.debug.controlBoneScale, null)

  const scene = new THREE.Scene()
  scene.add(root)
  assert.equal(runtime.debug.disposed, false,
    'initial FBX parser-wrapper reparent must not dispose the runtime')
  assert.equal(cameraCallbacks.length, 1)
  scene.remove(root)
  assert.equal(runtime.debug.disposed, true)
  assert.equal(cameraCallbacks.length, 0)
  assert.equal(
    runtimeModule.getActiveOfficialFaceMeshSwitcherDebugStates().length,
    0,
  )
})

test('serialized control-bone fields apply when the FBX carries that transform', () => {
  const [profile] = profileDocument.profiles
  const root = new THREE.Group()
  root.name = 'synthetic-semantic-profile'
  const head = new THREE.Bone()
  head.name = profile.head.name
  const controlBone = new THREE.Bone()
  controlBone.name = profile.controlBone.name
  controlBone.position.set(0.1, 0.2, 0.3)
  controlBone.scale.set(1, 2, 3)
  head.add(controlBone)
  root.add(head)
  for (const name of Object.values(profile.meshes)) {
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial(),
    )
    mesh.name = name
    root.add(mesh)
  }

  const runtime = runtimeModule.installOfficialFaceMeshSwitcher(root)
  assert.ok(runtime)
  assert.equal(runtime.debug.controlBoneAvailable, true)
  runtime.update(positionCamera(root, profile, 0, 30))
  assert.equal(runtime.debug.controlHiddenByElevation, false)
  assert.ok(Math.abs(runtime.debug.controlElevationFactor - 0.3125) < 1e-12)
  assert.ok(Math.abs(runtime.debug.controlLocalZFactor - 0.3125) < 1e-12)
  assert.ok(Math.abs(controlBone.scale.y - 1.375) < 1e-12)
  assert.ok(Math.abs(controlBone.position.z - 0.2687499995343387) < 1e-12)

  runtime.update(positionCamera(root, profile, 0, 50))
  assert.equal(runtime.debug.controlHiddenByElevation, true)
  assert.deepEqual(
    runtime.debug.controlBoneScale,
    [0.0001, 0.0001, 0.0001],
  )
  runtime.dispose()
  assert.equal(cameraCallbacks.length, 0)
  assert.equal(
    runtimeModule.getActiveOfficialFaceMeshSwitcherDebugStates().length,
    0,
  )
})

test('100102, 108301, 101901, and 100107 remain negative neighbors', () => {
  for (const characterId of [100102, 108301, 101901, 100107]) {
    const root = parseActualCharacterFbx(characterId)
    const before = []
    root.traverse(object => {
      if (object.isMesh) before.push([object.name, object.visible])
    })
    assert.equal(
      runtimeModule.findOfficialFaceMeshSwitcherProfile(root),
      undefined,
      characterId + ' must not match the 115201 semantic component',
    )
    assert.equal(
      runtimeModule.installOfficialFaceMeshSwitcher(root),
      undefined,
      characterId + ' must not install the alternate-face runtime',
    )
    const after = []
    root.traverse(object => {
      if (object.isMesh) after.push([object.name, object.visible])
    })
    assert.deepEqual(after, before, characterId + ' visibility changed')
  }
})

test('loader and renderer consume the generic profile at the render-camera boundary', () => {
  assert.match(loaderSource, /installOfficialFaceMeshSwitcher\(modelObject\)/)
  assert.match(loaderSource,
    /disposeCallbacks\.push\(faceMeshSwitcherRuntime\.dispose\)/)
  assert.match(characterSource,
    /this\.userData\.disposeCallbacks\.forEach\(callback => callback\(\)\)/)
  assert.match(rendererSource,
    /export function updateCameraRenderLoops\(camera: THREE\.Camera\)/)
  assert.match(sceneSource, /updateCameraRenderLoops\(this\.camera\)/)
  assert.ok(
    sceneSource.indexOf('updateCameraRenderLoops(this.camera)')
      < sceneSource.indexOf('this.selfShadow.render()'),
  )
  assert.doesNotMatch(rendererSource, /renderer\.render\s*=/)
  assert.doesNotMatch(runtimeSource, /characterId\s*===\s*115201/)
  assert.doesNotMatch(runtimeSource, /switch\s*\(\s*profile\.source\.characterId/)
  assert.match(runtimeSource, /complete-semantic-mesh-set/)
  assert.match(runtimeSource,
    /root\.userData\.officialFaceMeshSwitcherRuntime = debug/)
  assert.match(runtimeSource,
    /OFFICIAL_FACE_MESH_SWITCHER_RUNTIME/)
  assert.match(runtimeSource,
    /dataset\.officialFaceMeshSwitcherRuntime = payload/)
})
