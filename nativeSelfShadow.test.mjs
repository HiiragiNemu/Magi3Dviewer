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

test('camera depth is produced before self-shadow and both passes unbind their own sampled attachments', () => {
  const selfShadow = read('magia-exedra-character-three/scene/selfShadow.ts')
  const cameraDepth = read('magia-exedra-character-three/scene/cameraDepth.ts')
  assert.match(selfShadow, /this\.cameraDepth\.render\(\)/)
  assert.ok(
    selfShadow.indexOf('this.cameraDepth.render()') <
      selfShadow.indexOf('this.renderCharactersToDepth(characters)'),
    'camera-depth pass must precede the self-shadow depth pass',
  )
  assert.match(
    selfShadow,
    /reDriveSelfShadowUniformState\.enabled\.value = 0\s+reDriveSelfShadowUniformState\.map\.value = null/,
  )
  assert.match(
    selfShadow,
    /renderer\.setRenderTarget\(oldTarget\)\s+reDriveSelfShadowUniformState\.map\.value = oldSelfShadowMap/,
  )
  assert.match(
    cameraDepth,
    /reDriveCameraDepthUniformState\.enabled\.value = 0\s+reDriveCameraDepthUniformState\.map\.value = null/,
  )
})

test('self-shadow is applied through authored toon shadow textures and face SDF', () => {
  const general = read('magia-exedra-character-three/shaders/general.ts')
  const face = read('magia-exedra-character-three/shaders/face.ts')
  const stylization = read('magia-exedra-character-three/shaders/stylization.ts')
  const scene = read('magia-exedra-character-three/scene/index.ts')
  assert.match(stylization, /injectReDriveSelfShadowShader\(shader\)/)
  assert.match(general, /rdToonBaseWeight \*= rdToonSelfShadowVisibility/)
  assert.match(face, /rdCombinedFaceLight \*= rdToonSelfShadowVisibility/)
  assert.match(scene, /this\.selfShadow\.render\(\)/)
})
