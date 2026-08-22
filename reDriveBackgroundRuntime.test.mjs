import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const effects = readFileSync('magia-exedra-character-three/scene/effects.ts', 'utf8')
const runtime = readFileSync('src/viewer/reDriveVolumeRuntime.ts', 'utf8')
const stages = readFileSync('src/viewer/stages.ts', 'utf8')
const shader = readFileSync('magia-exedra-character-three/scene/backgroundColorAdjustments.ts', 'utf8')
const paraffin = readFileSync('magia-exedra-character-three/scene/reDriveParaffin.ts', 'utf8')
const extractor = readFileSync('tools/magius/extract_magius_scene_profile.py', 'utf8')
const stageMaterials = readFileSync('src/viewer/stageMaterialBindings.ts', 'utf8')
const stage600 = JSON.parse(readFileSync(
  'public/stages/official/battle-600-00-01-002/scene-profile.json',
  'utf8',
))

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

test('ReDrive parameters resolve to the native captured Bg uniform vector', () => {
  assert.match(runtime, /1 \+ contrast \* 0\.01/)
  assert.match(runtime, /1 \+ saturation \* 0\.01/)
  assert.match(runtime, /2 \*\* postExposure/)
  const profile = stage600.renderProfile.reDriveVolume
  const actual = [
    1 + (profile.backgroundContrast ?? 0) * 0.01,
    1 + (profile.backgroundSaturation ?? 0) * 0.01,
    2 ** (profile.backgroundPostExposure ?? 0),
  ]
  const captured = [1, 1.0499999523162842, 1.148698329925537]
  actual.forEach((value, index) => {
    assert.ok(Math.abs(value - captured[index]) < 1e-6)
  })
})

test('ReDrive runtime defers scene access until the viewer scene is initialized', () => {
  const guard = runtime.indexOf('function ensureReDriveRuntimeInitialized')
  assert.ok(guard >= 0)
  assert.doesNotMatch(runtime, /lightProbe\.name[^\n]*\nscene\.scene\.add\(lightProbe\)/)
  assert.doesNotMatch(runtime, /const initial = \{\s*sceneEnvironmentIntensity:/)
  assert.match(runtime.slice(guard), /scene\.scene\.add\(lightProbe\)/)
  assert.match(runtime.slice(guard), /initialState \?\?= captureInitialState\(\)/)
})

test('complete official material coverage disables the old fullscreen approximation', () => {
  assert.match(
    stages,
    /resolveReDriveBackgroundShaderGlobals\([\s\S]*?definition\.renderProfile\?\.reDriveVolume/,
  )
  assert.match(
    stages,
    /backgroundShaderGlobalsApplied:[\s\S]*?stageObject\?\.userData\.stageMaterialBindings[\s\S]*?\.backgroundShaderGlobalsApplied === true/,
  )
  assert.match(runtime, /const fullscreenFallbackEnabled = enabled && !shaderGlobalsApplied/)
  assert.match(stageMaterials, /official-bg-globals-v1/)
})

test('ReDriveVolume drives background-only pass and disables legacy global CSS approximation', () => {
  assert.match(runtime, /function applyBackgroundColorAdjustments/)
  assert.match(runtime, /profile\.backgroundPostExposure/)
  assert.match(runtime, /profile\.backgroundContrast/)
  assert.match(runtime, /profile\.backgroundSaturation/)
  assert.match(runtime, /profile\.backgroundBackgroundTint/)
  assert.match(
    stages,
    /profile\.source === 'ReDriveVolume'[\s\S]*scene\.setColorFilter\(\{ brightness: 1, contrast: 1, saturation: 1 \}\)/,
  )
})

test('Paraffin requires both effective Volume activation and compiled operator proof', () => {
  assert.match(runtime, /profile\.runtimeVerified !== true/)
  assert.match(runtime, /profile\.operatorVerified !== true/)
  assert.match(runtime, /native-runtime-gate-unverified/)
  assert.match(runtime, /compiled-operator-unverified/)
  assert.match(extractor, /serialized-effective-global-volume/)
  assert.match(extractor, /D3D11-fragment-69-89-93/)
  assert.match(runtime, /profile\.useFixedLightDirection \? 1 : 0/)
})

test('Paraffin uses the compiled radial light-origin operator, not a vertical tint guess', () => {
  assert.match(paraffin, /vec3\(0\.0, -12\.99, 0\.0\)/)
  assert.match(paraffin, /paraOrigin = -normalize\(uGlobalMainLightDirectionVS\)/)
  assert.match(paraffin, /length\(screenPosition \* 0\.5 \+ paraOrigin\)/)
  assert.match(paraffin, /mix\(topResult, bottomResult, factor\)/)
  assert.doesNotMatch(paraffin, /float vertical/)
  assert.doesNotMatch(paraffin, /uLightScreen/)
})
