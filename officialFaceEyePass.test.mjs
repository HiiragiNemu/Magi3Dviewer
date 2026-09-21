import { assertReleaseMaterialCorpus } from './releaseCorpusTestSupport.mjs'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test, after } from 'node:test'
import ts from 'typescript'

const root = dirname(fileURLToPath(import.meta.url))
const materialProfilePath = join(
  root,
  'magia-exedra-character-three',
  'materialProfile.ts',
)
const materialProfileRuntimePath = join(
  root,
  `.official-face-material-profile-${process.pid}-${Date.now()}.mjs`,
)
const depthRimRuntimePath = join(
  root,
  `.official-eye-depth-rim-${process.pid}-${Date.now()}.mjs`,
)

const faceShader = readFileSync(
  new URL('./magia-exedra-character-three/shaders/face.ts', import.meta.url),
  'utf8',
)
const textureSource = readFileSync(
  new URL('./magia-exedra-character-three/texture.ts', import.meta.url),
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
const compiledGradientFace = readFileSync(
  new URL(
    './artifacts/verification/20260824-108301-hair-cheek-shadow-visual-fail/iteration-02-official-ab/evidence/tw-face-gradient/compiled/Creative-Character-ReDriveToon-pass3-blob106.glsl',
    import.meta.url,
  ),
  'utf8',
)
const compiledEye = readFileSync(
  new URL(
    './artifacts/research/20260813-shader-reverse/official-shaders/main_eye__blob-102__FOG_LINEAR___ISFACE___MAIN_LIGHT_SHADOWS___MAIN_LIGHT_SHADOWS_CASCADE___ADDITIONAL_LIGHT_SHADOWS___ISEYE___USE_DEPTHTEX_RIM_SHADOW.glsl',
    import.meta.url,
  ),
  'utf8',
)
const compiledDepthRim = readFileSync(
  new URL(
    './artifacts/research/20260813-shader-reverse/official-shaders/main_depth_rim__blob-96__FOG_LINEAR___MAIN_LIGHT_SHADOWS___MAIN_LIGHT_SHADOWS_CASCADE___ADDITIONAL_LIGHT_SHADOWS___USE_DEPTHTEX_RIM_SHADOW.glsl',
    import.meta.url,
  ),
  'utf8',
)
const depthRimShader = readFileSync(
  new URL(
    './magia-exedra-character-three/shaders/depthRim.ts',
    import.meta.url,
  ),
  'utf8',
)
const controllerEvidence = JSON.parse(readFileSync(
  new URL(
    './artifacts/verification/20260824-108301-hair-cheek-shadow-visual-fail/iteration-14-official-face-gradient-mouth-nose/official-evidence/steam/four-character-controller-dither-face-gradient.literal.json',
    import.meta.url,
  ),
  'utf8',
))
const compiledDepthGateEvidence = JSON.parse(readFileSync(
  new URL(
    './artifacts/verification/20260824-108301-hair-cheek-shadow-visual-fail/iteration-14-official-face-gradient-mouth-nose/official-evidence/steam/compiled-face-gradient-depth-gate.literal.json',
    import.meta.url,
  ),
  'utf8',
))
const currentSteamEyeDepthAuthority = JSON.parse(readFileSync(
  new URL(
    './artifacts/verification/20260829-official-eye-camera-depth-variant/official-evidence/current-steam-eye-depth-bytecode-authority.json',
    import.meta.url,
  ),
  'utf8',
))
const currentSteamDepthRimDump = readFileSync(
  new URL(
    './artifacts/verification/20260829-official-eye-camera-depth-variant/official-evidence/current-steam-depth-rim.dump.txt',
    import.meta.url,
  ),
  'utf8',
)
const currentSteamEyeDump = readFileSync(
  new URL(
    './artifacts/verification/20260829-official-eye-camera-depth-variant/official-evidence/current-steam-eye.dump.txt',
    import.meta.url,
  ),
  'utf8',
)
const profiles = JSON.parse(readFileSync(
  new URL(
    './magia-exedra-character-three/official-material-profiles.json',
    import.meta.url,
  ),
  'utf8',
))
const materialProfileSource = readFileSync(materialProfilePath, 'utf8')
  .replace(
    /import officialMaterialProfileUrl from '\.\/official-material-profiles\.json\?url';?/,
    `const officialMaterialProfileUrl = 'memory://official-material-profiles';\n` +
      `const officialMaterialProfileData = ${JSON.stringify(profiles)}`,
  )
  .concat('\nawait loadOfficialMaterialProfiles(officialMaterialProfileData);\n')
const materialProfileCompiled = ts.transpileModule(materialProfileSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: materialProfilePath,
})
writeFileSync(materialProfileRuntimePath, materialProfileCompiled.outputText, 'utf8')
const materialProfiles = await import(pathToFileURL(materialProfileRuntimePath).href)

const depthRimCompiled = ts.transpileModule(depthRimShader, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: join(root, 'magia-exedra-character-three', 'shaders', 'depthRim.ts'),
})
writeFileSync(depthRimRuntimePath, depthRimCompiled.outputText, 'utf8')
const depthRimRuntime = await import(pathToFileURL(depthRimRuntimePath).href)

after(() => {
  rmSync(materialProfileRuntimePath, { force: true })
  rmSync(depthRimRuntimePath, { force: true })
})

test('all official materials carry the serialized face-family branch fields', () => {
  const { historical, added } = assertReleaseMaterialCorpus(profiles)
  assert.ok(Object.values(profiles.materials).every(profile => profile.face))
  for (const token of [
    '"isFace": flag("_IsFace")',
    '"isEye": flag("_IsEye")',
    '"useGradientMap": flag("_UseFaceGradientMap")',
    '"shouldApplyAdditional": flag("_ShouldApplyFaceAdditional")',
    '"additionalTexture": texture_name("_FaceAdditionalMap")',
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

test('A-Q 113501 uses the serialized eye highlight control map', () => {
  const eye = profiles.materials.mt_chara_113501_eye_mask.face
  assert.equal(eye.isFace, false)
  assert.equal(eye.isEye, true)
  assert.equal(eye.useGradientMap, false)
  assert.equal(eye.shouldApplyAdditional, true)
  assert.equal(eye.additionalTexture, 'chara_113501_eyehighlight_ctrl')
  assert.equal(eye.highlightThreshold, 0.5)
  assert.equal(eye.highlightRotation, 0)
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

  const officialEyeSample = compiledEye.indexOf(
    'texture(_FaceAdditionalMap, u_xlat44.xy',
  )
  const officialEyeOutput = compiledEye.indexOf(
    'u_xlat0.xyz = u_xlat0.xyz * u_xlat16_10.xyz + u_xlat16_15.xyz',
  )
  const officialEyeOptionalGate = compiledEye.indexOf(
    'vec4(_ShouldApplyFaceAdditional, _IsAlphaAdditive',
  )
  assert.ok(officialEyeSample >= 0)
  assert.ok(officialEyeOutput > officialEyeSample)
  assert.ok(officialEyeOptionalGate > officialEyeOutput)
  assert.doesNotMatch(
    compiledEye.slice(officialEyeSample, officialEyeOptionalGate),
    /_CheekValue|_CheekColor/,
  )
})

test('official _ISEYE specialization removes the CameraDepth fragment path', () => {
  assert.match(compiledDepthRim, /uniform highp sampler2D _CameraDepthTexture/)
  assert.equal(compiledDepthRim.match(/texelFetch\(_CameraDepthTexture/g)?.length, 2)
  assert.match(compiledDepthRim, /float\s+_UseDepthTex/)
  assert.doesNotMatch(compiledDepthRim, /Xhlslcc_UnusedX_UseDepthTex/)

  assert.doesNotMatch(compiledEye, /_CameraDepthTexture/)
  assert.doesNotMatch(compiledEye, /texelFetch/)
  assert.match(compiledEye, /Xhlslcc_UnusedX_UseDepthTex/)
  assert.match(compiledEye, /Xhlslcc_UnusedX_DepthTexWidth/)

  assert.equal(currentSteamEyeDepthAuthority.unityVersion, '2022.3.62f2')
  assert.deepEqual(
    currentSteamEyeDepthAuthority.records.map(record => [
      record.label,
      record.blobIndex,
      record.keywords,
    ]),
    [
      ['depth-rim', 29, '_USE_DEPTHTEX_RIM_SHADOW'],
      ['eye', 31, '_ISEYE + _USE_DEPTHTEX_RIM_SHADOW'],
    ],
  )
  assert.equal(currentSteamDepthRimDump.match(/^dcl_resource_texture2d/gm)?.length, 15)
  assert.equal(currentSteamEyeDump.match(/^dcl_resource_texture2d/gm)?.length, 14)
})

test('viewer specializes CameraDepth from serialized isEye without ID routing', () => {
  const effectiveUseDepthTex = profile => {
    const shader = { uniforms: {} }
    depthRimRuntime.setDepthRimMaterialProfileUniforms(shader, profile)
    return shader.uniforms.uRdDepthUseDepthTex.value
  }

  const eyeProfiles = Object.values(profiles.materials).filter(
    profile => profile.face.isEye,
  )
  assert.ok(eyeProfiles.length > 0)
  assert.ok(eyeProfiles.every(profile => profile.depthRim.useDepthTex))
  assert.ok(eyeProfiles.every(profile => effectiveUseDepthTex(profile) === 0))

  for (const characterId of [100102, 108301, 101901, 100101, 100805]) {
    const eye = profiles.materials[`mt_chara_${characterId}_eye_mask`]
    assert.equal(eye.face.isEye, true)
    assert.equal(eye.depthRim.useDepthTex, true)
    assert.equal(effectiveUseDepthTex(eye), 0)

    for (const slot of ['face', 'eyebrow_mask', 'hair', 'hair_out']) {
      const neighbor = profiles.materials[`mt_chara_${characterId}_${slot}`]
      assert.equal(neighbor.face.isEye, false)
      assert.equal(neighbor.depthRim.useDepthTex, true)
      assert.equal(effectiveUseDepthTex(neighbor), 1)
    }
  }

  assert.match(depthRimShader, /depthRim\?\.useDepthTex && !profile\?\.face\.isEye/)
  assert.doesNotMatch(
    depthRimShader,
    /(?:characterId|profile\.name)\s*(?:===|==)|case\s+(?:100102|108301|101901|100107|100805)/,
  )
})

test('five protected eye passes bind serialized control maps and bypass the face-gradient carrier', () => {
  for (const characterId of [100102, 108301, 101901, 100101, 100805]) {
    const face = profiles.materials[`mt_chara_${characterId}_face`].face
    const eyebrow = profiles.materials[
      `mt_chara_${characterId}_eyebrow_mask`
    ].face
    const eye = profiles.materials[`mt_chara_${characterId}_eye_mask`].face
    assert.equal(face.isEye, false)
    assert.equal(eyebrow.isEye, false)
    assert.equal(eye.isEye, true)
    assert.equal(eye.shouldApplyAdditional, false)
    assert.equal(
      eye.additionalTexture,
      `chara_${characterId}_eyehighlight_ctrl`,
    )
  }
  assert.match(
    faceShader,
    /float rdBaseCheekBlend =\s*rdFaceAdditional \* uCheekValue \*\s*\(1\.0 - saturate\(uOfficialFaceIsEye\)\) \*\s*saturate\(uUseFaceGradient\);/,
  )
  assert.doesNotMatch(
    faceShader,
    /(?:characterId|faceProfile\.characterId)\s*(?:===|==)\s*(?:100102|108301|101901|100107|100805)|case\s+(?:100102|108301|101901|100107|100805)/,
  )
})

test('108301 keeps its optional gate off while only the gradient variant keeps the pre-gate carrier', () => {
  const ayame = materialProfiles.getOfficialMaterialProfile('mt_chara_108301_face')
  const ayameEyebrow = materialProfiles.getOfficialMaterialProfile(
    'mt_chara_108301_eyebrow_mask',
  )
  assert.equal(ayame.face.shouldApplyAdditional, false)
  assert.equal(ayame.face.useGradientMap, true)
  assert.equal(ayameEyebrow.face.useGradientMap, false)
  assert.equal(
    materialProfiles.resolveOfficialFaceAdditionalActive(ayame),
    false,
  )
  assert.equal(
    materialProfiles.resolveOfficialFaceAdditionalActive(
      materialProfiles.getOfficialMaterialProfile('mt_chara_101901_face'),
    ),
    false,
  )
  assert.match(
    faceShader,
    /resolveOfficialFaceAdditionalActive\(profile\) \? 1 : 0/,
  )
  assert.match(faceShader, /texture2D\(\s*tEyehighlight,\s*vFaceUv2\s*\)/)
  assert.match(
    faceShader,
    /float rdBaseCheekBlend =[\s\S]*1\.0 - saturate\(uOfficialFaceIsEye\)[\s\S]*saturate\(uUseFaceGradient\)[\s\S]*if \(uOfficialFaceShouldApplyAdditional != 0\.0\)/,
  )
  assert.match(faceShader, /float rdCheekMask = step\(0\.5, vFaceUv2\.y\)/)
  assert.match(
    faceShader,
    /outgoingLight = mix\([\s\S]*outgoingLight \* uOfficialFaceCheekColor,[\s\S]*rdBaseCheekBlend/,
  )
  assert.match(faceShader, /color\.setRGB\(\.\.\.face\.cheekColor, THREE\.SRGBColorSpace\)/)
  assert.doesNotMatch(
    faceShader,
    /color\.setRGB\(\.\.\.face\.cheekColor, THREE\.LinearSRGBColorSpace\)/,
  )
  const officialUnconditionalSample = compiledGradientFace.indexOf(
    'u_xlat16_54 = texture(_FaceAdditionalMap, vs_TEXCOORD4.xy',
  )
  const officialGate = compiledGradientFace.indexOf(
    'notEqual(vec4(0.0, 0.0, 0.0, 0.0), vec4(_ShouldApplyFaceAdditional',
  )
  assert.ok(officialUnconditionalSample >= 0)
  assert.ok(officialGate > officialUnconditionalSample)
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

test('four protected controllers consume the official camera-depth face gate', () => {
  assert.deepEqual(
    controllerEvidence.characters.map(character => character.characterId),
    [100102, 108301, 101901, 100107],
  )
  for (const character of controllerEvidence.characters) {
    assert.ok(character.controllerCount > 0)
    assert.equal(character.controllers.length, character.controllerCount)
    for (const controller of character.controllers) {
      assert.equal(controller.ditherFade, 0)
      assert.equal(controller.faceForwardDirection, 3)
      assert.equal(controller.faceUpDirection, 1)
      assert.equal(controller.faceRightDirection, 2)
    }
  }

  const officialLines = compiledDepthGateEvidence.lines
    .map(line => line.text)
    .join('\n')
  const sampleIndex = officialLines.indexOf(
    'texelFetch(_CameraDepthTexture',
  )
  const referenceIndex = officialLines.indexOf(
    'u_xlat2.x = u_xlat59 + -0.00999999978;',
  )
  const ditherIndex = officialLines.indexOf(
    'u_xlat16_13.xyz = (u_xlatb2.x) ? vec3(1.0, 0.0, 0.0) : u_xlat12.xyz;',
  )
  const gateIndex = officialLines.indexOf(
    'u_xlatb38.x = u_xlat16_13.x>=0.899999976;',
  )
  assert.ok(sampleIndex >= 0)
  assert.ok(referenceIndex > sampleIndex)
  assert.ok(ditherIndex > referenceIndex)
  assert.ok(gateIndex > ditherIndex)
})

test('viewer gates only FaceGradient with the exact official depth signal', () => {
  assert.match(faceShader, /injectReDriveDepthRimShader\(shader\)/)
  assert.match(
    faceShader,
    /vec3 rdToonMainLightDirection = rdFacePhysicalLightVS;/,
  )
  assert.match(faceShader, /\/\/ RD_FACE_GRADIENT_DEPTH_SAMPLE_BEGIN/)
  assert.match(
    faceShader,
    /rdGradientFaceLight \*= step\(0\.899999976, rdFaceGradientDepthSignal\);/,
  )
  assert.match(
    depthRimShader,
    /float rdFaceGradientDepthSignal = 1\.0;/,
  )
  assert.match(
    depthRimShader,
    /50\.0 \* \(\s*rdDepthMainZ -\s*\(rdDepthCenterZ - 0\.00999999978\)\s*\)/,
  )
  const depthGateIndex = faceShader.indexOf(
    'rdGradientFaceLight *= step(0.899999976, rdFaceGradientDepthSignal);',
  )
  const uvIslandIndex = faceShader.indexOf(
    'rdGradientFaceLight *= 1.0 - step(1.4, length(vFaceUv2));',
  )
  assert.ok(depthGateIndex > 0 && depthGateIndex < uvIslandIndex)
  assert.match(faceShader, /gradientDepthGate:/)
  assert.doesNotMatch(
    `${faceShader}\n${depthRimShader}`,
    /(?:characterId|faceProfile\.characterId)\s*(?:===|==)\s*(?:100102|108301|101901|100107)|case\s+(?:100102|108301|101901|100107)/,
  )
})

test('FaceGradient U hemisphere uses the compiled FaceRight sign without mirroring', () => {
  const officialPositiveMatch = compiledGradientFace.match(
    /u_xlati(\d+) = int\(\(0\.0<u_xlat2\.x\) \? 0xFFFFFFFFu : uint\(0\)\);/,
  )
  assert.ok(officialPositiveMatch)
  const officialPositive = officialPositiveMatch.index ?? -1
  const officialNegative = compiledGradientFace.indexOf(
    'u_xlati2 = int((u_xlat2.x<0.0) ? 0xFFFFFFFFu : uint(0));',
  )
  const officialSign = compiledGradientFace.indexOf(
    `u_xlati2 = (-u_xlati${officialPositiveMatch[1]}) + u_xlati2;`,
  )
  assert.ok(officialPositive >= 0)
  assert.ok(officialNegative > officialPositive)
  assert.ok(officialSign > officialNegative)
  assert.match(
    faceShader,
    /float rdFaceGradientSign = rdFaceDirection\.x > 0\.0\s*\? 1\.0\s*:\s*\(rdFaceDirection\.x < 0\.0 \? -1\.0 : 0\.0\);/,
  )
  assert.doesNotMatch(
    faceShader,
    /rdFaceDirection\.x > 0\.0\s*\? -1\.0/,
  )
})

test('face gradient follows compiled coordinates and the shared serialized sampler', () => {
  assert.match(
    faceShader,
    /ApplyOfficialFaceGradientSampling\(\s*ctrlTex/,
  )
  assert.match(
    faceShader,
    /ApplyOfficialFaceGradientSampling\(\s*noseGradientTex/,
  )
  assert.match(textureSource, /payload\.textureFormat !== 24/)
  assert.match(textureSource, /tex\.wrapS = THREE\.RepeatWrapping/)
  assert.match(textureSource, /tex\.wrapT = THREE\.RepeatWrapping/)
  assert.match(textureSource, /tex\.generateMipmaps = false/)
  assert.match(textureSource, /tex\.anisotropy = 1/)
  assert.match(
    faceShader,
    /float rdFaceGradientSign = rdFaceDirection\.x > 0\.0[\s\S]*\? 1\.0[\s\S]*rdFaceDirection\.x < 0\.0 \? -1\.0 : 0\.0/,
  )
  assert.match(
    faceShader,
    /float rdFaceGradientU = vFaceUv\.x \* rdFaceGradientSign \+ 1\.0/,
  )
  assert.match(
    faceShader,
    /float rdNoseGradientU = vFaceUv\.x \* rdFaceGradientSign/,
  )
  assert.match(
    faceShader,
    /vFaceUv\.y \+ uFaceGradientYOffset/,
  )
  assert.match(
    faceShader,
    /vFaceUv\.y \+ uNoseGradientYOffset/,
  )
  assert.match(
    faceShader,
    /1\.0 - step\(1\.4, length\(vFaceUv2\)\)/,
  )
  assert.match(
    compiledGradientFace,
    /vs_TEXCOORD0\.yy \* vec2\(u_xlat56\) \+ vec2\(_FaceShadowGradientMapYOffset, _NoseShadowGradientMapYOffset\)/,
  )
  assert.match(compiledGradientFace, /u_xlat56 = 1\.0;/)
  assert.doesNotMatch(faceShader, /rdFaceMirroredU/)
})
