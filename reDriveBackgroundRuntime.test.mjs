import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const effects = readFileSync('magia-exedra-character-three/scene/effects.ts', 'utf8')
const runtime = readFileSync('src/viewer/reDriveVolumeRuntime.ts', 'utf8')
const stages = readFileSync('src/viewer/stages.ts', 'utf8')
const shader = readFileSync('magia-exedra-character-three/scene/backgroundColorAdjustments.ts', 'utf8')

test('ReDrive background adjustments execute between background and character passes', () => {
  assert.match(effects, /backgroundColorAdjustPass: ShaderPass/)
  const background = effects.indexOf('this.composer.addPass(this.backgroundRenderPass)')
  const adjustment = effects.indexOf('this.composer.addPass(this.backgroundColorAdjustPass)')
  const character = effects.indexOf('this.composer.addPass(this.renderPass)')
  assert.ok(background >= 0 && adjustment > background && character > adjustment)
})

test('background grading keeps Unity parameter semantics explicit', () => {
  assert.match(shader, /exp2\(uPostExposure\)/)
  assert.match(shader, /uContrast \* 0\.01/)
  assert.match(shader, /uSaturation \* 0\.01/)
  assert.match(shader, /uGlobalTint \* uBackgroundTint/)
})

test('ReDriveVolume drives background-only pass and disables legacy global CSS approximation', () => {
  assert.match(runtime, /function applyBackgroundColorAdjustments/)
  assert.match(runtime, /profile\.backgroundPostExposure/)
  assert.match(runtime, /profile\.backgroundContrast/)
  assert.match(runtime, /profile\.backgroundSaturation/)
  assert.match(runtime, /profile\.backgroundBackgroundTint/)
  assert.match(stages, /profile\.source !== 'ReDriveVolume'/)
})
