import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const runtime = readFileSync('src/viewer/reDriveVolumeRuntime.ts', 'utf8')

test('ReDrive skybox intensity is override-gated and drives both split scenes', () => {
  assert.match(runtime, /function applySkyboxIntensity/)
  assert.match(runtime, /profileOverride\([\s\S]*?'skyboxIntensity'/)
  assert.match(runtime, /environmentIntensity = intensity/g)
  assert.match(runtime, /backgroundIntensity = intensity/g)
})

test('ReDrive skybox intensity reset restores environment/background intensity state', () => {
  assert.match(runtime, /sceneEnvironmentIntensity/)
  assert.match(runtime, /backgroundSceneEnvironmentIntensity/)
  assert.match(runtime, /sceneBackgroundIntensity/)
  assert.match(runtime, /backgroundSceneBackgroundIntensity/)
  assert.match(runtime, /delete scene\.scene\.userData\.reDriveSkyboxIntensity/)
})
