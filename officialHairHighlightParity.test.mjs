import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = dirname(fileURLToPath(import.meta.url))
const viewerHair = readFileSync(
  join(root, 'magia-exedra-character-three', 'shaders', 'hair.ts'),
  'utf8',
)
const viewerLoader = readFileSync(
  join(root, 'magia-exedra-character-three', 'loader.ts'),
  'utf8',
)
const materialProfileSource = readFileSync(
  join(root, 'magia-exedra-character-three', 'materialProfile.ts'),
  'utf8',
)
const officialHair = readFileSync(
  join(
    root,
    'artifacts',
    'verification',
    '20260820-hair-hard-shadow-official-input',
    'official-selfshadow-variants',
    'main_hair_reference_blob-98.glsl',
  ),
  'utf8',
)
const profiles = JSON.parse(readFileSync(
  join(
    root,
    'magia-exedra-character-three',
    'official-material-profiles.json',
  ),
  'utf8',
))
const samplers = JSON.parse(readFileSync(
  join(
    root,
    'artifacts',
    'verification',
    '20260824-official-character-texture-sampling',
    'official-sampler-authority.json',
  ),
  'utf8',
))
const submeshGroups = readFileSync(
  join(
    root,
    'magia-exedra-character-three',
    'submeshGroups.generated.ts',
  ),
  'utf8',
)

test('108301 hair and hair_out use one authored AngelRing texture over two exact draw slots', () => {
  const hair = profiles.materials.mt_chara_108301_hair
  const hairOut = profiles.materials.mt_chara_108301_hair_out
  assert.deepEqual(hair.angelRing, {
    isHair: true,
    enabled: true,
    uvMode: true,
    map: 'character',
    texture: 'chara_108301_hair_highlight',
    rimLightColor: [1, 1, 1],
  })
  assert.deepEqual(hairOut.angelRing, hair.angelRing)
  assert.equal(hair.customRenderQueue, -1)
  assert.equal(hairOut.customRenderQueue, 2002)
  assert.match(
    submeshGroups,
    /108301:\s*\{[\s\S]*?"Hair_Mesh": \[11196, 5487\]/,
  )

  const texture = samplers.textures.find(
    value => value.name === 'chara_108301_hair_highlight',
  )
  assert.deepEqual(
    {
      pathId: texture?.pathId,
      width: texture?.width,
      height: texture?.height,
      mipCount: texture?.mipCount,
      colorSpace: texture?.colorSpace,
      filterMode: texture?.filterMode,
      aniso: texture?.aniso,
      wrapU: texture?.wrapU,
      wrapV: texture?.wrapV,
      wrapW: texture?.wrapW,
    },
    {
      pathId: 3532589234543928595,
      width: 1024,
      height: 1024,
      mipCount: 11,
      colorSpace: 1,
      filterMode: 1,
      aniso: 1,
      wrapU: 0,
      wrapV: 0,
      wrapW: 0,
    },
  )
})

test('protected hair slots retain their serialized projected or UV AngelRing branch', () => {
  const expected = [
    ['mt_chara_100102_hair', 'common', false, -1],
    ['mt_chara_100102_hair_out', 'common', false, 2002],
    ['mt_chara_108301_hair', 'character', true, -1],
    ['mt_chara_108301_hair_out', 'character', true, 2002],
    ['mt_chara_101901_hair', 'common', false, -1],
    ['mt_chara_101901_hair_out', 'common', false, 2002],
    ['mt_chara_100101_hair', 'common', false, -1],
    ['mt_chara_100101_hair_out', 'common', false, 2002],
  ]

  for (const [name, map, uvMode, queue] of expected) {
    const profile = profiles.materials[name]
    assert.equal(profile.angelRing.enabled, true, name)
    assert.equal(profile.angelRing.map, map, name)
    assert.equal(profile.angelRing.uvMode, uvMode, name)
    assert.equal(profile.customRenderQueue, queue, name)
  }
})

test('101002 native hair slots keep the generic source-backed AngelRing fallback', () => {
  assert.match(materialProfileSource, /101002, 102101/)
  assert.match(
    materialProfileSource,
    /\['mt_chara_101002_hair',\s*\{[\s\S]*?customRenderQueue:\s*-1[\s\S]*?additionalLightInfluenceByLuminance:\s*1,/,
  )
  assert.match(
    materialProfileSource,
    /\['mt_chara_101002_hair_out',\s*\{[\s\S]*?customRenderQueue:\s*2002[\s\S]*?additionalLightInfluenceByLuminance:\s*1,/,
  )
})

test('each actual draw records generic AngelRing slot, branch, map and uniform state', () => {
  assert.match(viewerHair, /export interface OfficialAngelRingSlotRuntime/)
  assert.match(
    viewerHair,
    /loadAngelRingOptions\(shader\)[\s\S]*?effectiveEnabled:[\s\S]*?branch:/,
  )
  assert.match(viewerLoader, /OFFICIAL_ANGEL_RING_RUNTIME_BEGIN/)
  assert.match(
    viewerLoader,
    /officialAngelRingRuntime[\s\S]*?materialIndex:[\s\S]*?groupStart:[\s\S]*?groupCount:/,
  )
  const begin = viewerLoader.indexOf('OFFICIAL_ANGEL_RING_RUNTIME_BEGIN')
  const end = viewerLoader.indexOf('OFFICIAL_ANGEL_RING_RUNTIME_END')
  assert.ok(begin >= 0 && end > begin)
  assert.doesNotMatch(
    viewerLoader.slice(begin, end),
    /100102|108301|101901|100107/,
  )
})

test('compiled and Viewer variants bind one sampler and preserve projected/UV contribution order', () => {
  assert.match(
    officialHair,
    /if\(!u_xlatb2\.y\)\{[\s\S]*?texture\(_AngelRingMap,[\s\S]*?\} else \{[\s\S]*?texture\(_AngelRingMap, vs_TEXCOORD0\.xy/,
  )
  assert.match(
    officialHair,
    /u_xlat0\.xyz = \(u_xlatb2\.y\) \? u_xlat2\.xzw : u_xlat0\.xyz/,
  )

  const uvStart = viewerHair.indexOf("if (branch === 'uv')")
  const projectedStart = viewerHair.indexOf('projectedShaders.add(shader)', uvStart)
  assert.ok(uvStart >= 0 && projectedStart > uvStart)
  const hookStart = viewerHair.indexOf('onAfterStylization(shader)')
  const hookEnd = viewerHair.indexOf('onBeforeCompile(shader)', hookStart)
  assert.ok(hookStart >= 0 && hookEnd > hookStart)
  const uvVariant = viewerHair.slice(uvStart, projectedStart)
    + viewerHair.slice(hookStart, hookEnd)
  const projectedVariant = viewerHair.slice(projectedStart)
  assert.match(uvVariant, /vAngelRingUv = uv/)
  assert.match(uvVariant, /texture2D\(\s*tAngelRingMap,\s*vAngelRingUv/)
  assert.doesNotMatch(uvVariant, /cameraPosition|vMapUv/)
  assert.match(projectedVariant, /texture2D\(\s*tAngelRingMap,\s*rdAngelMapUv/)
  assert.doesNotMatch(viewerHair, /tAngelRingCommon|tAngelRingCharacter/)
  assert.equal(
    (viewerHair.match(/outgoingLight \+=/g) ?? []).length,
    1,
  )
  assert.match(
    projectedVariant,
    /rdDepthRimMainCompositeSignal\s*=\s*clamp\([\s\S]*rdAngelMap \* rdAngelActive/,
  )
  assert.doesNotMatch(projectedVariant, /rdAngelContribution|rdAngelBaseLuminance/)
  assert.match(
    uvVariant,
    /outgoingLight \+=[\s\S]*rdAngelMap[\s\S]*rdAngelActive[\s\S]*outgoingLight \*= uGlobalCharacterTint/,
  )
  assert.doesNotMatch(uvVariant, /gl_FragColor\.rgb \+=/)
  assert.doesNotMatch(viewerHair, /rdAngelContribution \+=/)
})
