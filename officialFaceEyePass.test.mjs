import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const faceShader = readFileSync(
  new URL('./magia-exedra-character-three/shaders/face.ts', import.meta.url),
  'utf8',
)
const loader = readFileSync(
  new URL('./magia-exedra-character-three/loader.ts', import.meta.url),
  'utf8',
)
const extractor = readFileSync(
  new URL('./scripts/extract-official-material-profiles.py', import.meta.url),
  'utf8',
)
const profiles = JSON.parse(readFileSync(
  new URL(
    './magia-exedra-character-three/official-material-profiles.json',
    import.meta.url,
  ),
  'utf8',
))

test('all official materials carry the serialized face-family branch fields', () => {
  assert.equal(profiles.bundleCount, 95)
  assert.equal(profiles.materialCount, 1533)
  assert.ok(Object.values(profiles.materials).every(profile => profile.face))
  for (const token of [
    '"isFace": flag("_IsFace")',
    '"isEye": flag("_IsEye")',
    '"useGradientMap": flag("_UseFaceGradientMap")',
    '"shouldApplyAdditional": flag("_ShouldApplyFaceAdditional")',
    '"highlightThreshold": number("_HighlightThreshold", 0.5)',
    '"highlightRotation": number("_HighlightRotation", 0.0)',
    '"cheekColor": rgb("_CheekColor", (1.0, 0.7, 0.7))',
  ]) assert.ok(extractor.includes(token), `missing face extraction token: ${token}`)
})

test('101901 and 102601 select eye_mask as the distinct official eye pass', () => {
  for (const characterId of [101901, 102601]) {
    const face = profiles.materials[`mt_chara_${characterId}_face`].face
    const eyebrow = profiles.materials[`mt_chara_${characterId}_eyebrow_mask`].face
    const eye = profiles.materials[`mt_chara_${characterId}_eye_mask`].face
    assert.equal(face.isFace, true)
    assert.equal(face.isEye, false)
    assert.equal(face.useGradientMap, true)
    assert.equal(eyebrow.isEye, false)
    assert.equal(eyebrow.useGradientMap, false)
    assert.equal(eye.isFace, true)
    assert.equal(eye.isEye, true)
    assert.equal(eye.useGradientMap, false)
    assert.equal(eye.highlightThreshold, 0.5)
    assert.equal(eye.highlightRotation, 0)
  }
  assert.deepEqual(
    profiles.materials.mt_chara_102601_face.face.cheekColor,
    [0.9921568632125854, 0.43921568989753723, 0.43529412150382996],
  )
})

test('eye highlight uses the compiled post-light carrier and exact transition', () => {
  assert.match(faceShader, /export function setOfficialFaceMaterialProfileUniforms/)
  assert.match(faceShader, /uOfficialFaceIsEye/)
  assert.match(faceShader, /uOfficialFaceShouldApplyAdditional/)
  assert.match(faceShader, /uOfficialFaceHighlightRotation \* 6\.28318530718/)
  assert.match(
    faceShader,
    /min\(rdFaceSceneLightColor \* 2\.0, vec3\(1\.0\)\) \* 1\.5/,
  )
  assert.match(
    faceShader,
    /uOfficialFaceHighlightThreshold \+ 0\.05/,
  )
  assert.match(
    faceShader,
    /outgoingLight \+= rdFaceHighlightCarrier \* rdEyeHighlight[\s\S]*uOfficialFaceIsEye/,
  )
  assert.doesNotMatch(faceShader, /smoothstep\(0\.46, 0\.62/)
  assert.match(loader, /setOfficialFaceMaterialProfileUniforms\(shader, profile\)/)
})

test('face gradient shares the official global character light override', () => {
  assert.doesNotMatch(faceShader, /injectReDriveBakedNormalShader\(shader\)/)
  assert.match(faceShader, /vec3 rdFacePhysicalLightVS/)
  assert.match(
    faceShader,
    /mix\(\s*rdFacePhysicalLightVS,\s*uGlobalCharacterLightingOverrideDirection,/,
  )
  assert.match(
    faceShader,
    /step\(\s*0\.5,\s*uGlobalCharacterLightingOverrideDirectionEnabled/,
  )
  assert.match(
    faceShader,
    /mix\(\s*rdFaceSceneLightRaw,\s*uGlobalCharacterLightingOverrideColor,/,
  )
})
