import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const outline = readFileSync(
  new URL('./magia-exedra-character-three/shaders/outline.ts', import.meta.url),
  'utf8',
)
const loader = readFileSync(
  new URL('./magia-exedra-character-three/loader.ts', import.meta.url),
  'utf8',
)
const gui = readFileSync(
  new URL('./src/viewer/controllers/GUICharacter.ts', import.meta.url),
  'utf8',
)
const guiShader = readFileSync(
  new URL('./src/viewer/controllers/GUIShader.ts', import.meta.url),
  'utf8',
)

const perspectiveScale = (depth, fov, width) =>
  Math.min(Math.abs(depth), 60 / fov) * fov * 0.003 * (width * 0.01)
const orthographicScale = (orthoY, width) =>
  Math.min(Math.abs(orthoY), 0.5) * 100 * 0.003 * (width * 0.01)

test('official outline defaults and camera scale match recovered ReDrive units', () => {
  assert.match(outline, /export const OutlineThickness = 5/)
  assert.match(outline, /export const OutlineColor = '#000000'/)
  assert.match(outline, /60\.0 \/ currentFOV/)
  assert.match(outline, /0\.003 \* \(uThickness \* 0\.01\)/)
  assert.match(outline, /clamp\(color\.r, 0\.0, 1\.0\)/)
  assert.match(outline, /clamp\(color\.b, 0\.0, 1\.0\)/)
  assert.match(outline, /gl_Position\.z \+= 2\.0 \* outlineDepthOffset/)
  assert.match(outline, /abs\(gl_Position\.w\) \+ outlineDepthOffset/)
  assert.match(outline, /projectionMatrix\[2\]\[2\]/)
  assert.match(outline, /projectionMatrix\[3\]\[2\]/)
  assert.doesNotMatch(outline, /gl_Position\.z -= outlineDepthOffset/)

  assert.ok(Math.abs(perspectiveScale(0.1, 60, 5) - 0.0009) < 1e-12)
  assert.ok(Math.abs(perspectiveScale(0.5, 60, 5) - 0.0045) < 1e-12)
  assert.ok(Math.abs(perspectiveScale(1, 60, 5) - 0.009) < 1e-12)
  assert.ok(Math.abs(perspectiveScale(2, 60, 5) - 0.009) < 1e-12)
  assert.ok(Math.abs(perspectiveScale(1, 30, 5) - 0.0045) < 1e-12)
  assert.ok(Math.abs(perspectiveScale(2, 30, 5) - 0.009) < 1e-12)
  assert.ok(Math.abs(orthographicScale(0.5, 5) - 0.0075) < 1e-12)
})

test('official outline reuses authored shadow texture and scene light', () => {
  assert.match(outline, /shadowTex\?: THREE\.Texture/)
  assert.match(outline, /texture2D\(tShadow, vUv\)\.rgb \* uShadowColor/)
  assert.match(outline, /uOutlineTexBlend: \{ value: options\?\.texBlend \?\? 0\.2 \}/)
  assert.match(outline, /getAmbientLightIrradiance/)
  assert.match(outline, /getLightProbeIrradiance/)
  assert.match(outline, /getHemisphereLightIrradiance/)
  assert.match(outline, /vec3\(0\.1\)/)
  assert.match(loader, /shadowTex: outlineShadowTex/)
  assert.match(loader, /let outlineFaceAdjust = 0/)
  assert.match(loader, /outlineFaceAdjust = faceProfile\.faceOutlineAdjust/)
  assert.match(loader, /faceOutlineAdjust: outlineFaceAdjust/)
  assert.doesNotMatch(loader, /thickness: featureProfile\.outlineOffset/)
})

test('outline controls and recovered fallback use the serialized width scale', () => {
  assert.match(gui, /'OutlineThickness', 0\.001, 10, 0\.001/g)
  assert.match(guiShader, /OutlineThickness: 5/)
  assert.doesNotMatch(guiShader, /OutlineThickness: 0\.0020/)
})
