import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')

test('native ReDrive self-shadow keeps recovered TW/JP-shared pass constants', () => {
  const source = read('magia-exedra-character-three/scene/selfShadow.ts')
  assert.match(source, /shadowAngleDegrees:\s*15/)
  assert.match(source, /boundSize:\s*1/)
  assert.match(source, /resolution:\s*2048/)
  assert.match(source, /shadowRange:\s*10/)
  assert.match(source, /depthBiasScale:\s*0\.005/)
  assert.match(source, /useNdotLFix:\s*true/)
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
