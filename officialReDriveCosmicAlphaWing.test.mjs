import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const profiles = JSON.parse(fs.readFileSync(
  'magia-exedra-character-three/official-material-profiles.json',
  'utf8',
))
const materialProfileSource = fs.readFileSync(
  'magia-exedra-character-three/materialProfile.ts',
  'utf8',
)
const generalSource = fs.readFileSync(
  'magia-exedra-character-three/shaders/general.ts',
  'utf8',
)
const gemSource = fs.readFileSync(
  'magia-exedra-character-three/shaders/gem.ts',
  'utf8',
)
const cosmicSource = fs.readFileSync(
  'magia-exedra-character-three/shaders/namae.ts',
  'utf8',
)
const loaderSource = fs.readFileSync(
  'magia-exedra-character-three/loader.ts',
  'utf8',
)
const renderProfileSource = fs.readFileSync(
  'magia-exedra-character-three/renderProfile.ts',
  'utf8',
)
const extractorSource = fs.readFileSync(
  'scripts/extract-official-material-profiles.py',
  'utf8',
)
const submeshSource = fs.readFileSync(
  'magia-exedra-character-three/submeshGroups.generated.ts',
  'utf8',
)

function material(name) {
  const value = profiles.materials[name]
  assert.ok(value, `missing official material ${name}`)
  return value
}

test('113701 Body slot 2 keeps the serialized transparent wing state', () => {
  assert.match(
    submeshSource,
    /113701:[\s\S]*?"Body_Mesh": \[27816, 2517, 3288, 1002, 4062, 12393\]/,
  )
  const transparent = material('mt_chara_113701_body_transparent')
  assert.equal(transparent.customRenderQueue, 3000)
  assert.deepEqual(transparent.surface, {
    transparency: true,
    zWrite: false,
    srcBlend: 5,
    dstBlend: 10,
  })
  assert.equal(transparent.isAlphaAdditive, true)
  assert.deepEqual(transparent.fresnel, {
    enabled: true,
    maskByMetallic: false,
    color: [0.75, 0.75, 0.75],
    threshold: 0.49000000953674316,
    feather: 0.5410000085830688,
  })
  assert.equal(transparent.outline.enabled, false)
  assert.equal(transparent.shadow.castSelfShadow, false)
  assert.equal(transparent.shadow.receiveSelfShadow, false)
})

test('main_base alpha additive consumes the four compiled feature contributions', () => {
  assert.match(extractorSource, /"isAlphaAdditive": flag\("_IsAlphaAdditive"\)/)
  assert.match(materialProfileSource, /isAlphaAdditive: boolean/)
  assert.match(gemSource, /set\('uMaterialIsAlphaAdditive', value\.isAlphaAdditive \? 1 : 0\)/)
  assert.match(
    gemSource,
    /0\.298911989, 0\.586610973, 0\.114478[\s\S]*?rdMatCapBlend/,
  )
  assert.match(
    generalSource,
    /rdAnisoContribution[\s\S]*?uMaterialIsAlphaAdditive/,
  )
  assert.match(
    generalSource,
    /rdSpecularOverlay[\s\S]*?uMaterialIsAlphaAdditive/,
  )
  assert.match(
    generalSource,
    /rdToonFresnelContribution[\s\S]*?uMaterialIsAlphaAdditive/,
  )
  assert.match(generalSource, /diffuseColor\.a = saturate\(diffuseColor\.a\)/)
  assert.equal(
    Object.values(profiles.materials).filter(value => value.isAlphaAdditive).length,
    6,
  )
})

test('113701 slot 5 and 113801 neighbor retain distinct serialized Cosmic profiles', () => {
  const wing = material('mt_chara_113701_body_space').cosmic
  assert.deepEqual(wing, {
    enabled: true,
    alphaClipping: true,
    baseColor: [1, 0.014150917530059814, 0.014150917530059814, 1],
    isScreenBaseMap: true,
    baseTexture: 'chara_113701_body_space_color',
    shadowTexture: 'chara_113701_body_shadow',
    controlTexture: 'chara_113701_body_ctrl',
    baseMapTiling: 0.3700000047683716,
    baseMapScroll: [0.11999999731779099, 0.11999999731779099],
    texture: 'chara_113701_star_color',
    noiseTexture: 'cloud_noise_tex',
    tiling: 0.5,
    scroll: [0.10000000149011612, 0.10000000149011612],
    maskByControlAlpha: false,
    noiseInfluence: 1,
    noiseTiling: 0.05000000074505806,
    noiseSpeed: 0.07999999821186066,
    getShadowTexture: false,
    getShadowTint: false,
    applyAmbientLighting: false,
    overlay: false,
    shadowTintColor: [1, 1, 1],
  })
  const neighbor = material('mt_chara_113801_body_space').cosmic
  assert.equal(neighbor.isScreenBaseMap, false)
  assert.equal(neighbor.texture, 'chara_113801_body_inside_color')
  assert.equal(neighbor.tiling, 0.75)
  assert.equal(neighbor.noiseInfluence, 0.699999988079071)
  assert.equal(neighbor.noiseTiling, 0.10000000149011612)
  assert.equal(neighbor.noiseSpeed, 0.20000000298023224)
  assert.equal(
    Object.values(profiles.materials).filter(value => value.cosmic?.enabled).length,
    15,
  )
})

test('standard Cosmic is selected by serialized fields and binds exact slot textures', () => {
  assert.match(loaderSource, /createOfficialReDriveCosmicShaderProfile\(profile\)/)
  assert.match(loaderSource, /isOfficialStandardReDriveCosmicShader\(customProfile\)/)
  assert.match(loaderSource, /cosmic\.baseTexture/)
  assert.match(loaderSource, /cosmic\.shadowTexture/)
  assert.match(loaderSource, /cosmic\.controlTexture/)
  assert.match(loaderSource, /dedicatedBaseMaterial: standardReDriveCosmic/)
  assert.match(loaderSource, /materialProfile: slotProfile/)
  assert.doesNotMatch(loaderSource, /createBodyInsideMaterial/)
  assert.doesNotMatch(
    loaderSource,
    /characterId\s*==\s*11370[18][\s\S]{0,100}?name\.includes\(['"]body/,
  )
  assert.doesNotMatch(cosmicSource, /characterId/)
})

test('projected Cosmic uses the serialized character reference without requiring AngelRing', () => {
  const cosmic109801 = Object.entries(profiles.materials)
    .filter(([name, value]) => name.startsWith('mt_chara_109801_') && value.cosmic?.enabled)
  assert.ok(cosmic109801.length > 0)
  assert.ok(cosmic109801.every(([, value]) => value.angelRing.enabled === false))
  assert.match(
    renderProfileSource,
    /\[109801, \{[^\n]*headOffset: 0\.204,[^\n]*angelRingEnabled: false/,
  )

  const perspectiveReference = renderProfileSource.match(
    /export interface CharacterPerspectiveReference[\s\S]*?^}/m,
  )?.[0]
  const createPerspectiveReference = renderProfileSource.match(
    /export function createCharacterPerspectiveReference[\s\S]*?^}/m,
  )?.[0]
  assert.ok(perspectiveReference)
  assert.ok(createPerspectiveReference)
  assert.match(perspectiveReference, /localForward: THREE\.Vector3/)
  assert.match(
    createPerspectiveReference,
    /localForward = unityDirectionToThreeFbx\(profile\.faceForwardAxis\)/,
  )
  assert.match(createPerspectiveReference, /localForward,/)
  assert.doesNotMatch(createPerspectiveReference, /angelRingEnabled/)

  assert.match(
    loaderSource,
    /const requiresProjectedCosmicReference =\s*customShaderSlots\.some\(slot => slot\.profile\.isCosmic\)/,
  )
  assert.match(
    loaderSource,
    /const cosmicReference = requiresProjectedCosmicReference\s*\? characterPerspectiveReference\s*: undefined/,
  )
  assert.match(
    loaderSource,
    /if \(requiresProjectedCosmicReference && !cosmicReference\)/,
  )
  assert.match(loaderSource, /cosmicReference,\s*\}\)/)
  assert.doesNotMatch(loaderSource, /cosmicReference:\s*angelRingReference/)
  assert.doesNotMatch(loaderSource, /109801/)
})

test('projected Cosmic follows main_base additive/overlay/shadow/ambient order', () => {
  const marker = generalSource.indexOf('// RD_OFFICIAL_COSMIC_COMPOSITE')
  assert.ok(marker > generalSource.indexOf('rdToonFresnelContribution'))
  assert.ok(marker < generalSource.indexOf('// RD_DEPTH_RIM_COMPOSITE_BEGIN'))
  assert.match(cosmicSource, /officialCosmicOriginal = outgoingLight/)
  assert.match(cosmicSource, /uOfficialCosmicBaseMapTiling/)
  assert.match(cosmicSource, /uOfficialCosmicIsScreenBaseMap/)
  assert.match(cosmicSource, /officialCosmicAddColor =\s*officialCosmicBase \+ officialCosmicMap/)
  assert.match(cosmicSource, /uOfficialCosmicOverlay/)
  assert.match(cosmicSource, /uOfficialCosmicGetShadowTexture/)
  assert.match(cosmicSource, /uOfficialCosmicGetShadowTint/)
  assert.match(cosmicSource, /uOfficialCosmicApplyAmbientLighting/)
  assert.match(cosmicSource, /uOfficialCosmicMaskByControlAlpha/)
  assert.match(cosmicSource, /2\.0 \* officialCosmicNoise \* officialCosmicNoise - 1\.0/)
  assert.match(cosmicSource, /outgoingLight = mix\(/)
})

test('100805 Doppel and ordinary protected neighbors remain isolated', () => {
  const doppel = material('mt_chara_100805_hair_alpha')
  assert.equal(
    doppel.customShader.name,
    'Creative/Character/ReDriveToon-DoppelIroha',
  )
  assert.equal(doppel.cosmic.enabled, true)
  assert.equal(doppel.cosmic.texture, 'chara_100805_hair_cosmic')
  for (const name of [
    'mt_chara_100102_face',
    'mt_chara_108301_face',
    'mt_chara_101901_body_sj',
    'mt_chara_100101_body_sj',
  ]) {
    const neighbor = material(name)
    assert.equal(neighbor.cosmic.enabled, false, name)
    assert.equal(neighbor.isAlphaAdditive, false, name)
  }
})
