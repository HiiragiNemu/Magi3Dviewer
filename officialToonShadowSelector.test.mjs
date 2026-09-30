import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = dirname(fileURLToPath(import.meta.url))
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8')
const profiles = JSON.parse(read(
  'magia-exedra-character-three',
  'official-material-profiles.json',
))
const materialProfile = read(
  'magia-exedra-character-three',
  'materialProfile.ts',
)
const extractor = read('scripts', 'extract-official-material-profiles.py')
const gem = read('magia-exedra-character-three', 'shaders', 'gem.ts')
const general = read('magia-exedra-character-three', 'shaders', 'general.ts')
const loader = read('magia-exedra-character-three', 'loader.ts')
const officialHair = read(
  'artifacts',
  'research',
  '20260813-shader-reverse',
  'official-shaders',
  'main_hair__blob-98__FOG_LINEAR___MAIN_LIGHT_SHADOWS___MAIN_LIGHT_SHADOWS_CASCADE___ADDITIONAL_LIGHT_SHADOWS___IS_HAIR___USE_DEPTHTEX_RIM_SHADOW.glsl',
)

const byName = name => profiles.materials[name]

test('fresh Steam corpus preserves every serialized shadow offset-map scalar', () => {
  assert.equal(profiles.bundleCount, 98)
  const added = Object.keys(profiles.materials).filter(name => /^mt_chara_110702_/.test(name))
  assert.equal(added.length, 21, 'The published 110702 family is additive, not a missing historical material')
  assert.equal(Object.keys(profiles.materials).filter(name => !added.includes(name)).length, 1538)
  assert.equal(profiles.materialCount, 1559)
  for (const [name, profile] of Object.entries(profiles.materials)) {
    assert.equal(
      Number.isFinite(profile.shadow?.offsetMapOffset),
      true,
      `${name} shadow.offsetMapOffset`,
    )
  }

  assert.equal(
    byName('mt_chara_102101_weapon_a_trs_out').shadow.offsetMapOffset,
    1,
  )
  assert.equal(byName('mt_chara_107201_hair').shadow.offsetMapOffset, 1)
  assert.equal(
    byName('mt_chara_111701_acc_alpha').shadow.offsetMapOffset,
    0.14000000059604645,
  )
  assert.equal(
    byName('mt_chara_113501_body').shadow.offsetMapOffset,
    0.49799999594688416,
  )
  assert.equal(
    byName('mt_chara_113501_face').shadow.offsetMapOffset,
    0.5899999737739563,
  )
  const nonzero = Object.entries(profiles.materials)
    .filter(([, profile]) => Math.abs(profile.shadow.offsetMapOffset) > 1e-9)
    .map(([name]) => name)
    .sort()
  assert.deepEqual(nonzero, [
    'mt_chara_102101_weapon_a_trs_out',
    'mt_chara_107201_hair',
    'mt_chara_111701_acc_alpha',
    'mt_chara_113501_body',
    'mt_chara_113501_face',
  ])
})

test('100102, 108301, 101901 and 100107 style neighbors keep literal zero', () => {
  const protectedSlots = [
    'mt_chara_100102_face',
    'mt_chara_100102_hair',
    'mt_chara_100102_hair_out',
    'mt_chara_100102_body',
    'mt_chara_108301_face',
    'mt_chara_108301_hair',
    'mt_chara_108301_hair_out',
    'mt_chara_108301_body_sj',
    'mt_chara_101901_face',
    'mt_chara_101901_hair',
    'mt_chara_101901_hair_out',
    'mt_chara_101901_body_sj',
    // Style 100107 consumes the official 100101 material family.
    'mt_chara_100101_hair',
    'mt_chara_100101_hair_out',
    'mt_chara_100101_body_sj',
    'mt_chara_100101_weapon_a_sj',
  ]
  for (const name of protectedSlots) {
    assert.ok(byName(name), name)
    assert.equal(byName(name).shadow.offsetMapOffset, 0, name)
  }
  assert.equal(byName('mt_chara_108301_hair').customRenderQueue, -1)
  assert.equal(byName('mt_chara_108301_hair_out').customRenderQueue, 2002)
  assert.equal(byName('mt_chara_101901_hair_out').customRenderQueue, 2002)
  assert.equal(byName('mt_chara_100101_body_sj').gem.enabled, true)
  assert.equal(byName('mt_chara_100101_weapon_a_sj').gem.enabled, true)
})

test('compiled main_hair selector and Viewer use the same field position', () => {
  assert.match(
    officialHair,
    /u_xlat16_73 = u_xlat16_3\.x \+ _ShadowOffsetMapOffset;[\s\S]*?u_xlat16_73 = \(-u_xlat16_73\) \+ 1\.0;[\s\S]*?u_xlat16_73 = u_xlat66 \+ \(-u_xlat16_73\);/,
  )
  assert.match(
    general,
    /rdToonControlR \+ uRdShadowOffsetMapOffset[\s\S]*?rdToonHalfLambert - \(1\.0 - rdToonControl\)/,
  )
  assert.match(
    general,
    /uRdShadowOffset - uRdShadowFeather \* 0\.5[\s\S]*?uRdShadowOffset \+ uRdShadowFeather \* 0\.5/,
  )
})

test('serialized field reaches the actual draw uniform and runtime record', () => {
  assert.match(
    extractor,
    /"offsetMapOffset": number\("_ShadowOffsetMapOffset", 0\.0\)/,
  )
  assert.match(
    materialProfile,
    /shadow:\s*\{[\s\S]*?offsetMapOffset: number;[\s\S]*?receiveSelfShadow: boolean;/,
  )
  assert.match(
    gem,
    /set\('uRdShadowOffsetMapOffset', value\.shadow\.offsetMapOffset\)/,
  )
  assert.match(gem, /export interface OfficialToonShadowSlotRuntime/)
  assert.match(gem, /collectOfficialToonShadowRuntime/)
  assert.match(
    loader,
    /const toonShadowSlotRuntime =\s*setOfficialMaterialProfileUniforms\(shader, profile\)/,
  )
  assert.match(
    loader,
    /officialToonShadowRuntime[\s\S]*?materialIndex:[\s\S]*?groupStart:[\s\S]*?groupCount:/,
  )
})

test('generic consumer contains no protected character or scene special case', () => {
  const consumer = [extractor, gem, loader].join('\n')
  assert.doesNotMatch(consumer, /100102|108301|101901|100107/)
  assert.doesNotMatch(consumer, /0001-001|616-00-01-001|gallery-memory-room/)
})
