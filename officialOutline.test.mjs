import { assertReleaseMaterialCorpus } from './releaseCorpusTestSupport.mjs'
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
const stencilRuntime = readFileSync(
  new URL(
    './magia-exedra-character-three/officialStencilRuntime.ts',
    import.meta.url,
  ),
  'utf8',
)
const materialProfile = readFileSync(
  new URL('./magia-exedra-character-three/materialProfile.ts', import.meta.url),
  'utf8',
)
const officialProfiles = JSON.parse(readFileSync(
  new URL(
    './magia-exedra-character-three/official-material-profiles.json',
    import.meta.url,
  ),
  'utf8',
))
const submeshGroups = readFileSync(
  new URL(
    './magia-exedra-character-three/submeshGroups.generated.ts',
    import.meta.url,
  ),
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
const officialCompiledOutline = readFileSync(
  new URL(
    './artifacts/research/20260813-shader-reverse/official-shaders/outline__blob-6__no-keyword.glsl',
    import.meta.url,
  ),
  'utf8',
)
const bakedNormalExtractor = readFileSync(
  new URL('./scripts/extract-official-baked-normals.py', import.meta.url),
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
  assert.match(outline, /outlineShadow,\s+uOutlineTexBlend/)
  assert.doesNotMatch(outline, /clamp\(uOutlineTexBlend/)
  assert.match(outline, /getAmbientLightIrradiance/)
  assert.match(outline, /getLightProbeIrradiance/)
  assert.match(outline, /getHemisphereLightIrradiance/)
  assert.match(outline, /vec3\(0\.1\)/)
  assert.match(loader, /shadowTex: outlineShadowTex/)
  assert.match(loader, /let outlineFaceAdjust = 0/)
  assert.match(loader, /outlineFaceAdjust = faceProfile\.faceOutlineAdjust/)
  assert.match(loader, /profile\.outline\.faceOutlineAdjust/)
  assert.doesNotMatch(loader, /thickness: featureProfile\.outlineOffset/)
})

test('outline shell consumes the official baked-normal direction lost by FBX', () => {
  assert.match(officialCompiledOutline, /_UseBakedNormal/)
  assert.match(officialCompiledOutline, /in_TANGENT0\.w/)
  assert.match(officialCompiledOutline, /in_TEXCOORD3\.xxx/)
  assert.match(officialCompiledOutline, /in_TEXCOORD3\.yyy/)
  assert.match(officialCompiledOutline, /in_TEXCOORD3\.zzz/)
  assert.match(bakedNormalExtractor, /cross\(normal_xyz, tangent_xyz\)/)
  assert.match(bakedNormalExtractor, /component \* tangent\[3\]/)
  assert.match(bakedNormalExtractor, /tangent_xyz\[axis\] \* texcoord3\[0\]/)
  assert.match(bakedNormalExtractor, /bitangent\[axis\] \* texcoord3\[1\]/)
  assert.match(bakedNormalExtractor, /normal_xyz\[axis\] \* texcoord3\[2\]/)
  assert.match(outline, /ReDriveBakedNormalAttribute/)
  assert.match(
    outline,
    /objectNormal = normalize\(\$\{ReDriveBakedNormalAttribute\}\);[\s\S]*#include <skinnormal_vertex>/,
  )
})

test('official outline profile is bound per Unity geometry material group', () => {
  for (const token of [
    'enabled: boolean;',
    'color: readonly [number, number, number];',
    'emissionColor: readonly [number, number, number];',
    'texBlend: number;',
    'zOffset: number;',
    'faceOutlineAdjust: number;',
  ]) assert.ok(materialProfile.includes(token), `missing outline profile token: ${token}`)

  assert.match(outline, /export function addOfficialOutlineGroupsToMesh\(/)
  assert.match(outline, /mesh\.geometry\.groups/)
  assert.match(outline, /group\.materialIndex \?\? 0/)
  assert.match(outline, /if \(options\?\.enabled === false\) continue/)
  assert.match(outline, /geometry\.setDrawRange\(start, count\)/)
  assert.match(loader, /enabled: isOfficialOutlineExtrusionEnabled\(profile\)/)
  assert.match(
    stencilRuntime,
    /return profile\.outline\.enabled && !Boolean\(profile\.gem\.transparency\)/,
  )
  assert.match(loader, /thickness: profile\.outlineWidth/)
  assert.match(loader, /texBlend: profile\.outline\.texBlend/)
  assert.match(loader, /outlineZOffset: profile\.outline\.zOffset/)
  assert.match(loader, /userData\.outlineMeshes\.push\(\.\.\.outlineMeshes\)/)
  assert.doesNotMatch(loader, /uniformOutlineWidth/)
})

test('97 historical bundles plus exact Ashley delta preserve outline switches and parameters', () => {
  const { historical, added } = assertReleaseMaterialCorpus(officialProfiles)
  const profiles = Object.values(officialProfiles.materials)
  // The independent native 113801 orb correction changed this one existing
  // slot from outline-on to outline-off before Ashley was added.
  const orb = officialProfiles.materials.mt_chara_113801_weapon_a_orb
  assert.equal(orb.outline.enabled, false)
  assert.equal(historical.filter(profile => profile !== orb && !profile.outline.enabled).length, 56)
  assert.equal(added.filter(profile => !profile.outline.enabled).length, 0)
  assert.equal(profiles.filter(profile => !profile.outline.enabled).length, 57)
  assert.ok(profiles.every(profile => 'customRenderQueue' in profile))

  const alpha = officialProfiles.materials.mt_chara_100101_weapon_a_alpha
  assert.equal(alpha.outline.enabled, false)

  const body = officialProfiles.materials.mt_chara_100101_body
  assert.equal(body.outline.enabled, true)
  assert.equal(body.outline.texBlend, 0.10000000149011612)
  assert.equal(body.outline.faceOutlineAdjust, 0.004999999888241291)

  const hair = officialProfiles.materials.mt_chara_100401_hair
  assert.equal(hair.outline.zOffset, 0.004999999888241291)

  const emissive = officialProfiles.materials.mt_chara_114401_weapon_a
  assert.deepEqual(emissive.outline.emissionColor, [
    23.968629837036133,
    0,
    2.1333391666412354,
  ])
})

test('outline controls and recovered fallback use the serialized width scale', () => {
  assert.match(gui, /'OutlineThickness', 0\.001, 10, 0\.001/g)
  assert.match(guiShader, /OutlineThickness: 5/)
  assert.doesNotMatch(guiShader, /OutlineThickness: 0\.0020/)
})

test('serialized stencil fields drive generic writer and selector passes', () => {
  const profiles = Object.values(officialProfiles.materials)
  const writers = profiles.filter(profile => profile.stencil.mode === 1)
  const selectors = profiles.filter(profile => profile.stencil.mode === 2)
  assert.ok(writers.length > 150)
  assert.ok(selectors.length > 85)
  assert.ok(writers.every(profile => Number.isFinite(profile.stencil.reference)))
  assert.ok(selectors.every(profile => Number.isFinite(profile.stencil.transparency)))

  for (const characterId of [100102, 108301, 101901]) {
    const hairOut = officialProfiles.materials[`mt_chara_${characterId}_hair_out`]
    assert.equal(hairOut.customRenderQueue, 2002)
    assert.deepEqual(hairOut.stencil, {
      mode: 2,
      comparison: 6,
      reference: 128,
      passOperation: 0,
      transparency: 0.75,
    })
  }
  assert.match(submeshGroups, /100102: \{[\s\S]*?"Face_Mesh": \[6996, 996, 192\]/)
  assert.match(submeshGroups, /108301: \{[\s\S]*?"Hair_Mesh": \[11196, 5487\]/)
  assert.match(submeshGroups, /101901: \{[\s\S]*?"Hair_Mesh": \[14001, 2400\]/)

  assert.match(loader, /installOfficialStencilWriters/)
  assert.match(loader, /installOfficialStencilSelectorRuntime/)
  assert.match(stencilRuntime, /profile\.stencil\.mode\) === 1/)
  assert.match(stencilRuntime, /profile\.stencil\.mode\) === 2/)
  assert.match(stencilRuntime, /profile\.customRenderQueue >= 0/)
  assert.match(stencilRuntime, /geometry\.setDrawRange\(group\.start, group\.count\)/)
  assert.match(stencilRuntime, /THREE\.NotEqualStencilFunc/)
  assert.match(stencilRuntime, /THREE\.EqualStencilFunc/)
  assert.match(stencilRuntime, /THREE\.ReplaceStencilOp/)
  assert.match(stencilRuntime, /THREE\.CustomBlending/)
  assert.match(stencilRuntime, /1 - profile\.stencil\.transparency/)
  assert.match(stencilRuntime, /maskMaterial\.depthWrite = true/)
  assert.match(stencilRuntime, /configureOfficialStencilForwardBlend\(material\)/)
  assert.match(stencilRuntime, /material\.stencilRef = reference/)
  assert.match(stencilRuntime, /serializedWriterBit \| characterBits/)
  assert.match(loader, /characterStencilReference/)
  assert.match(stencilRuntime, /material\.stencilFuncMask = 0xff/)
  assert.match(stencilRuntime, /material\.stencilWriteMask = 0xff/)
  assert.match(stencilRuntime, /uOfficialStencilTransparency/)
  assert.doesNotMatch(stencilRuntime, /100102|108301|101901|2400/)
  assert.doesNotMatch(loader, /mt_chara_101901_hair_out/)
})
