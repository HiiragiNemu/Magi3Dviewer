import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const shader = readFileSync(
  'magia-exedra-character-three/scene/volumePostProcessing.ts',
  'utf8',
)
const effects = readFileSync(
  'magia-exedra-character-three/scene/effects.ts',
  'utf8',
)
const bloom = readFileSync(
  'magia-exedra-character-three/scene/urpBloom.ts',
  'utf8',
)
const scene = readFileSync(
  'magia-exedra-character-three/scene/index.ts',
  'utf8',
)
const guiShader = readFileSync('src/viewer/controllers/GUIShader.ts', 'utf8')
const stages = readFileSync('src/viewer/stages.ts', 'utf8')

test('Unity Volume subset retains serialized ColorAdjustments units', () => {
  assert.match(shader, /color \*= exp2\(uPostExposure\)/)
  assert.match(shader, /uContrast \* 0\.01/)
  assert.match(shader, /uSaturation \* 0\.01/)
  assert.match(shader, /uColorFilter/)
})

test('serialized Vignette has an explicit full-composite runtime pass', () => {
  assert.match(shader, /uVignetteCenter/)
  assert.match(shader, /uVignetteIntensity/)
  assert.match(shader, /uVignetteSmoothness/)
  assert.match(shader, /uVignetteRounded/)
  assert.match(shader, /uVignetteAspectRatio/)
  assert.match(shader, /uVignetteIntensity \* 3\.0/)
  assert.match(shader, /uVignetteSmoothness \* 5\.0/)
  assert.match(shader, /1\.0 - dot\(dist, dist\)/)
  assert.match(shader, /color \*= mix\(uVignetteColor, vec3\(1\.0\), vfactor\)/)
  assert.doesNotMatch(shader, /smoothstep\(/)

  const vignette = shader.indexOf('if (uVignetteEnabled > 0.5')
  const grading = shader.indexOf('if (uColorAdjustEnabled > 0.5')
  assert.ok(vignette >= 0 && grading > vignette)
  assert.match(effects, /volumePostProcessPass = new ShaderPass/)

  const paraffin = effects.indexOf('this.composer.addPass(this.paraffinPass)')
  const volume = effects.indexOf('this.composer.addPass(this.volumePostProcessPass)')
  const output = effects.indexOf('this.composer.addPass(this.outputPass)')
  assert.ok(paraffin >= 0 && volume > paraffin && output > volume)
  assert.match(scene, /this\.effects\.volumePostProcessPass\.enabled/)
})

test('stage profiles apply and reset both recovered Volume components', () => {
  assert.match(stages, /interface StageVolumePostProcessingProfile/)
  assert.match(stages, /function applyStageVolumePostProcessing/)
  assert.match(stages, /pass\.uniforms\.uColorAdjustEnabled\.value/)
  assert.match(stages, /pass\.uniforms\.uVignetteEnabled\.value/)
  assert.match(stages, /pass\.uniforms\.uVignetteAspectRatio\.value/)
  assert.match(
    stages,
    /profile\.source === 'ReDriveVolume'[\s\S]*scene\.setColorFilter\(\{ brightness: 1, contrast: 1, saturation: 1 \}\)/,
  )
  assert.match(stages, /applyStageVolumePostProcessing\(undefined\)/)
})

test('recovered Unity Bloom uses the 2022.3 URP operator, not Unreal units', () => {
  assert.match(effects, /urpBloomPass: ReDriveUrpBloomPass/)
  assert.match(effects, /this\.composer\.addPass\(this\.urpBloomPass\)/)
  assert.match(bloom, /gammaToLinear\(Math\.max\(0, this\.threshold\)\)/)
  assert.match(bloom, /uThresholdKnee\.value = threshold \* 0\.5/)
  assert.match(bloom, /0\.01621622/)
  assert.match(bloom, /3\.23076923/)
  assert.match(bloom, /THREE\.MathUtils\.lerp\([\s\S]*0\.05,[\s\S]*0\.95/)
  assert.match(bloom, /mix\(highMip, lowMip, uScatter\)/)
  assert.match(bloom, /source\.rgb \+ bloom/)
  assert.match(
    stages,
    /profile\.source === 'ReDriveVolume'[\s\S]*scene\.effects\.bloomPass\.enabled = false[\s\S]*pass\.intensity = profile\.bloom\.strength[\s\S]*pass\.scatter = profile\.bloom\.radius[\s\S]*pass\.threshold = profile\.bloom\.threshold/,
  )
  assert.doesNotMatch(stages, /profile\.bloom\.strength \* 0\.08/)
})

test('composer Auto runs URP Bloom and recovered baseline cannot double Bloom', () => {
  const composerCondition = scene.slice(
    scene.indexOf('get shouldUseComposer'),
    scene.indexOf('get characterSelectionVisible'),
  )
  assert.match(composerCondition, /this\.effects\.urpBloomPass\.enabled/)
  assert.match(
    guiShader,
    /applyRecoveredBaseline\(\)[\s\S]*scene\.effects\.urpBloomPass\.enabled = false[\s\S]*scene\.effects\.bloomPass\.enabled = true/,
  )
})
