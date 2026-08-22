import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as THREE from 'three'

const read = path => fs.readFileSync(path, 'utf8')

test('native ReDrive self-shadow keeps recovered TW/JP-shared pass constants', () => {
  const source = read('magia-exedra-character-three/scene/selfShadow.ts')
  assert.match(source, /shadowAngleDegrees:\s*15/)
  assert.match(source, /boundSize:\s*1/)
  assert.match(source, /resolution:\s*2048/)
  assert.match(source, /shadowRange:\s*10/)
  assert.match(source, /depthBiasScale:\s*0\.005/)
  // Both the TW battle and JP home runtime captures report the official
  // ReDriveToon self-shadow selector with NdotLFix disabled.
  assert.match(source, /useNdotLFix:\s*false/)
  assert.match(source, /charaBoundSize:\s*\[0\.75, 1\.5, 0\.5\]/)
  assert.match(source, /THREE\.UnsignedShortType/)
  assert.match(source, /cameraFrustum\.setFromProjectionMatrix/)
  assert.match(source, /cameraFrustum\.intersectsBox\(this\.casterBounds\)/)
  assert.match(source, /RotateX\(shadowAngle \* Deg2Rad\)/)
  assert.match(source, /_RdToonSelfShadowMapRT/)
  assert.match(source, /vRdToonWorldPosition/)
})

test('self-shadow depth writer uses a separate comparison sampler', () => {
  const source = read('magia-exedra-character-three/scene/selfShadow.ts')
  assert.match(
    source,
    /this\.depthPassSampler = new THREE\.DepthTexture\(\s*1,\s*1,\s*THREE\.UnsignedShortType/,
  )
  assert.match(
    source,
    /this\.depthPassSampler\.compareFunction = THREE\.LessEqualCompare/,
  )
  assert.match(source, /this\.depthPassSampler\.needsUpdate = true/)
  assert.match(source, /this\.depthPassSampler\.dispose\(\)/)
  assert.match(
    source,
    /const oldSelfShadowMap = reDriveSelfShadowUniformState\.map\.value/,
  )
  assert.match(
    source,
    /reDriveSelfShadowUniformState\.enabled\.value = 0\s+reDriveSelfShadowUniformState\.map\.value = this\.depthPassSampler/,
  )
  assert.match(
    source,
    /renderer\.setRenderTarget\(oldTarget\)\s+reDriveSelfShadowUniformState\.map\.value = oldSelfShadowMap/,
  )
})

test('self-shadow is applied through authored toon shadow textures and face SDF', () => {
  const general = read('magia-exedra-character-three/shaders/general.ts')
  const face = read('magia-exedra-character-three/shaders/face.ts')
  const stylization = read('magia-exedra-character-three/shaders/stylization.ts')
  const scene = read('magia-exedra-character-three/scene/index.ts')
  assert.match(stylization, /injectReDriveSelfShadowShader\(shader\)/)
  assert.match(general, /rdToonBaseWeight \*= mix\(/)
  assert.match(general, /rdToonSelfShadowVisibility\(/)
  assert.match(general, /uMaterialReceiveSelfShadow/)
  assert.match(face, /rdCombinedFaceLight \*= rdToonSelfShadowVisibility/)
  assert.match(scene, /this\.selfShadow\.render\(\)/)
})

test('self-shadow depth writer suppresses official non-casters and restores writes', () => {
  const source = read('magia-exedra-character-three/scene/selfShadow.ts')
  assert.match(source, /profile\?\.shadow\.castSelfShadow !== false/)
  assert.match(source, /material\.colorWrite = false/)
  assert.match(source, /material\.depthWrite = false/)
  assert.match(
    source,
    /finally \{[\s\S]*state\.material\.colorWrite = state\.colorWrite[\s\S]*state\.material\.depthWrite = state\.depthWrite/,
  )
  assert.match(
    source,
    /reDriveSelfShadowUniformState\.map\.value = oldSelfShadowMap\s+reDriveSelfShadowUniformState\.enabled\.value = oldSelfShadowEnabled/,
  )
})

test('camera-relative self-shadow reproduces the complete TW runtime coordinate fixture', () => {
  // Fresh TW frame: program 1014, draw 415, 1536x864. GLSL arrays are
  // column-major, matching Matrix4.fromArray/toArray.
  const cameraView = new THREE.Matrix4().fromArray([
    0.9754433035850525, -0.06240301579236984, 0.21122565865516663, 0,
    0.03458993881940842, 0.9905260801315308, 0.13289715349674225, 0,
    0.2175177037715912, 0.12232735008001328, -0.9683604836463928, 0,
    0.5093202590942383, -0.3381728529930115, -8.200127601623535, 1,
  ])
  const shadowView = new THREE.Matrix4().multiplyMatrices(
    new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(15)),
    cameraView,
  )
  const shadowDirection = new THREE.Vector3(0, 0, 1)
    .transformDirection(new THREE.Matrix4().copy(shadowView).invert())
  const officialDirection = [
    0.18787722289562225,
    0.3847358226776123,
    -0.9037038087844849,
  ]
  assert.ok(Math.max(
    ...shadowDirection.toArray().map(
      (value, index) => Math.abs(value - officialDirection[index]),
    ),
  ) < 1e-6)

  const projection = new THREE.Matrix4().makeOrthographic(
    -1.7688280086554837,
    2.23241256848022,
    1.303694455417016,
    -0.8547479072267282,
    1.1346568578785778,
    3.2865462616318815,
  )
  const actualWorldToClip = new THREE.Matrix4()
    .multiplyMatrices(projection, shadowView)
    .toArray()
  const officialWorldToClip = [
    0.4875704348087311, -0.10650820285081863, -0.17461608350276947, 0,
    0.017289606854319572, 0.8546704053878784, -0.3575795590877533, 0,
    0.10872513055801392, 0.34171798825263977, 0.8399165272712708, 0,
    0.13872095942497253, 1.4558888673782349, 5.3884172439575195, 1,
  ]
  assert.ok(Math.max(
    ...actualWorldToClip.map(
      (value, index) => Math.abs(value - officialWorldToClip[index]),
    ),
  ) < 1e-6)
})
