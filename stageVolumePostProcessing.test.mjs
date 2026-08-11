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
const scene = readFileSync(
  'magia-exedra-character-three/scene/index.ts',
  'utf8',
)
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
  assert.match(stages, /applyStageVolumePostProcessing\(undefined\)/)
})
