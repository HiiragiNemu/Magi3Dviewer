import { assertReleaseMaterialCorpus } from './releaseCorpusTestSupport.mjs'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import ts from 'typescript'

const root = dirname(fileURLToPath(import.meta.url))
const materialProfilePath = join(
  root,
  'magia-exedra-character-three',
  'materialProfile.ts',
)
const renderProfilePath = join(
  root,
  'magia-exedra-character-three',
  'renderProfile.ts',
)
const runtimeMaterialPath = join(
  root,
  `.character-surface-material-${process.pid}-${Date.now()}.mjs`,
)
const runtimeRenderPath = join(
  root,
  `.character-surface-render-${process.pid}-${Date.now()}.mjs`,
)

function transpile(sourcePath, runtimePath) {
  let source = readFileSync(sourcePath, 'utf8')
  if (sourcePath === materialProfilePath) {
    const data = readFileSync(join(
      root,
      'magia-exedra-character-three',
      'official-material-profiles.json',
    ), 'utf8')
    source = source.replace(
      /^import officialMaterialProfileUrl from '.\/official-material-profiles\.json\?url';\r?\n/,
      `const officialMaterialProfileUrl = 'memory://official-material-profiles';\n` +
        `const officialMaterialProfileData = ${data.trim()};\n`,
    )
    source += '\nawait loadOfficialMaterialProfiles(officialMaterialProfileData);\n'
  }
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
  })
  writeFileSync(runtimePath, compiled.outputText, 'utf8')
}

transpile(materialProfilePath, runtimeMaterialPath)
const generatedCharacterProfiles = readFileSync(join(
  root,
  'magia-exedra-character-three',
  'official-character-controller-profiles.generated.json',
), 'utf8')
const renderSource = readFileSync(renderProfilePath, 'utf8').replace(
  /^import generatedCharacterProfiles from '.\/official-character-controller-profiles\.generated\.json';\r?\n/m,
  `const generatedCharacterProfiles = ${generatedCharacterProfiles.trim()};\n`,
)
const renderCompiled = ts.transpileModule(renderSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: renderProfilePath,
})
const renderRuntime = renderCompiled.outputText.replace(
  "from './materialProfile'",
  `from ${JSON.stringify(pathToFileURL(runtimeMaterialPath).href)}`,
)
writeFileSync(runtimeRenderPath, renderRuntime, 'utf8')

const materialProfiles = await import(pathToFileURL(runtimeMaterialPath).href)
const renderProfiles = await import(pathToFileURL(runtimeRenderPath).href)
after(() => {
  rmSync(runtimeMaterialPath, { force: true })
  rmSync(runtimeRenderPath, { force: true })
})

const gemShader = readFileSync(
  join(root, 'magia-exedra-character-three', 'shaders', 'gem.ts'),
  'utf8',
)
const loader = readFileSync(
  join(root, 'magia-exedra-character-three', 'loader.ts'),
  'utf8',
)
const gemExtension = readFileSync(
  join(root, 'magia-exedra-character-three', 'shaders', 'gemExtension.ts'),
  'utf8',
)
const generalShader = readFileSync(
  join(root, 'magia-exedra-character-three', 'shaders', 'general.ts'),
  'utf8',
)
const faceShader = readFileSync(
  join(root, 'magia-exedra-character-three', 'shaders', 'face.ts'),
  'utf8',
)
const generatedProfiles = JSON.parse(readFileSync(
  join(root, 'magia-exedra-character-three', 'official-material-profiles.json'),
  'utf8',
))

const profile = materialProfiles.getOfficialMaterialProfile

test('official material table is external and awaited before model material resolution', () => {
  const source = readFileSync(materialProfilePath, 'utf8')
  assert.match(
    source,
    /import officialMaterialProfileUrl from '.\/official-material-profiles\.json\?url'/,
  )
  assert.match(source, /fetch\(officialMaterialProfileUrl\)/)
  assert.match(loader, /await loadOfficialMaterialProfiles\(\)/)
})

test('101901 Body slots resolve exact JP f2 material profiles', () => {
  const body = profile('mt_chara_101901_body')
  const gem = profile('mt_chara_101901_body_SJ')
  const socks = profile('mt_chara_101901_body_Socks')
  const gold = profile('mt_chara_101901_body_Gold')

  assert.equal(body.source, 'official-export')
  assert.equal(body.gem.enabled, false)
  assert.equal(body.anisotropyProfile.enabled, false)

  assert.equal(gem.source, 'official-export')
  assert.equal(gem.gem.enabled, true)
  assert.equal(gem.gem.heightCorrection, -0.375)
  assert.equal(gem.gem.firstShadowSize, 1.9199999570846558)
  assert.equal(gem.gem.secondHighlightSize, -1)
  assert.equal(gem.gem.secondShadowSize, 2)
  assert.equal(gem.gem.rimFresnel, 0.5389999747276306)
  assert.deepEqual(gem.matCap, {
    enabled: true,
    source: 'soft-metallic',
    texture: 'matcap_SoftMetallic',
    intensity: 2,
    maskByMetallic: false,
    maskBySpecular: false,
  })

  assert.equal(socks.source, 'official-export')
  assert.equal(socks.anisotropyProfile.enabled, true)
  assert.equal(socks.anisotropyProfile.maskByMetallic, true)
  assert.deepEqual(socks.anisotropyProfile.color, [
    0.46666669845581055,
    0.4549019932746887,
    0.40392160415649414,
  ])
  assert.equal(socks.anisotropyProfile.threshold, 1)
  assert.equal(socks.anisotropyProfile.feather, 0.2919999957084656)
  assert.equal(socks.fresnel.enabled, true)
  assert.equal(socks.fresnel.threshold, 0.4560000002384186)
  assert.equal(socks.fresnel.feather, 0.36500000953674316)

  assert.equal(gold.source, 'official-export')
  assert.equal(gold.anisotropyProfile.enabled, true)
  assert.equal(gold.anisotropyProfile.threshold, 0.9660000205039978)
  assert.equal(gold.anisotropyProfile.feather, 0.00800000037997961)
  assert.equal(gold.fresnel.enabled, true)
  assert.deepEqual(gold.fresnel.color, [
    1,
    0.9004032611846924,
    0.5235849022865295,
  ])
  assert.deepEqual(gold.matCap, {
    enabled: true,
    source: 'default-linear-grey',
    texture: null,
    intensity: 1,
    maskByMetallic: false,
    maskBySpecular: false,
  })
})

test('101901 weapon restores Aniso Fresnel SoftMetallic and outline width', () => {
  const weapon = profile('mt_chara_101901_weapon_a')
  assert.equal(weapon.source, 'official-export')
  assert.equal(weapon.gem.enabled, false)
  assert.equal(weapon.anisotropyProfile.enabled, true)
  assert.equal(weapon.anisotropyProfile.maskByMetallic, true)
  assert.deepEqual(weapon.anisotropyProfile.color, [
    0.4745098352432251,
    0.43137258291244507,
    0.43137258291244507,
  ])
  assert.equal(weapon.anisotropyProfile.threshold, 0.9890000224113464)
  assert.equal(weapon.anisotropyProfile.feather, 0.019999999552965164)
  assert.equal(weapon.fresnel.enabled, true)
  assert.equal(weapon.fresnel.threshold, 0.2980000078678131)
  assert.equal(weapon.fresnel.feather, 0.15000000596046448)
  assert.equal(weapon.outlineWidth, 6.179999828338623)
  assert.deepEqual(weapon.matCap, {
    enabled: true,
    source: 'soft-metallic',
    texture: 'matcap_SoftMetallic',
    intensity: 1,
    maskByMetallic: true,
    maskBySpecular: false,
  })
})

test('100107 regular body and Aniso slots restore non-Gem MatCap', () => {
  const body = profile('mt_chara_100101_body')
  const aniso = profile('mt_chara_100101_body_Aniso')
  for (const value of [body, aniso]) {
    assert.equal(value.source, 'official-export')
    assert.equal(value.gem.enabled, false)
    assert.equal(value.matCap.enabled, true)
    assert.equal(value.matCap.source, 'soft-metallic')
    assert.equal(value.matCap.intensity, 2)
  }
  assert.equal(body.matCap.maskByMetallic, true)
  assert.equal(aniso.matCap.maskByMetallic, false)
  assert.equal(aniso.matCap.texture, 'matcap_SoftMetallic')
  assert.equal(aniso.anisotropyProfile.enabled, true)
})

test('official Gem slots remain opaque while neighboring draw groups stay non-Gem', () => {
  const fixtures = [
    ['mt_chara_100101_body_SJ', false, 0.550000011920929, 0.5],
    ['mt_chara_108301_body_SJ', true, -0.1599999964237213, 0.722000002861023],
    ['mt_chara_101901_body_SJ', false, -0.375, 0.5389999747276306],
  ]
  for (const [name, useDepthDiff, heightCorrection, rimFresnel] of fixtures) {
    const value = profile(name)
    assert.equal(value.source, 'official-export')
    assert.equal(value.gem.enabled, true)
    assert.equal(value.gem.transparency, false)
    assert.equal(value.gem.useDepthDiff, useDepthDiff)
    assert.equal(value.gem.useDepthDiff && value.gem.transparency, false)
    assert.deepEqual(value.surface, {
      transparency: false,
      zWrite: true,
      srcBlend: 1,
      dstBlend: 0,
    })
    assert.equal(value.gem.heightCorrection, heightCorrection)
    assert.equal(value.gem.rimFresnel, rimFresnel)
    assert.equal(value.matCap.enabled, true)
  }

  for (const name of [
    'mt_chara_100101_body',
    'mt_chara_100101_body_Aniso',
    'mt_chara_100102_body',
    'mt_chara_108301_body',
    'mt_chara_101901_body',
  ]) {
    const value = profile(name)
    assert.equal(value.source, 'official-export')
    assert.equal(value.gem.enabled, false)
  }
  assert.match(gemShader, /export function createOfficialGemSlotRuntime\(/)
  assert.match(gemShader, /opaque: !transparency/)
  assert.match(
    loader,
    /officialGemRuntime[\s\S]*?depthWrite: renderMaterial\.depthWrite[\s\S]*?transparent: renderMaterial\.transparent/,
  )
})

test('108301 mixed Body slots no longer inherit transparency from body_alpha', () => {
  for (const name of [
    'mt_chara_108301_body_alpha',
    'mt_chara_108301_body_Aniso',
    'mt_chara_108301_body_SJ',
    'mt_chara_108301_body_Gold',
    'mt_chara_108301_body',
  ]) {
    assert.deepEqual(profile(name).surface, {
      transparency: false,
      zWrite: true,
      srcBlend: 1,
      dstBlend: 0,
    })
  }
  assert.match(loader, /applyOfficialSurfaceRenderState\(slotMaterial, slotProfile\)/)
  assert.match(loader, /material\.transparent = surface\.transparency \|\| usesBlending/)
})

test('resolved profile aggregation replaces material-name feature guesses', () => {
  assert.deepEqual(
    renderProfiles.inferMaterialFeatures([
      'mt_chara_101901_body',
      'mt_chara_101901_body_Socks',
      'mt_chara_101901_body_Gold',
    ]),
    {
      anisotropy: true,
      outlineOffset: false,
      skinOutlineOffset: false,
      specialJewel: false,
    },
  )
  assert.deepEqual(
    renderProfiles.inferMaterialFeatures(['mt_chara_101901_weapon_a']),
    {
      anisotropy: true,
      outlineOffset: false,
      skinOutlineOffset: false,
      specialJewel: false,
    },
  )
})

test('100107 and 101901 official hair remains non-Aniso', () => {
  for (const name of [
    'mt_chara_100101_hair',
    'mt_chara_100101_hair_out',
    'mt_chara_101901_hair',
    'mt_chara_101901_hair_out',
  ]) {
    const value = profile(name)
    assert.equal(value.angelRing.isHair, true)
    assert.equal(value.anisotropyProfile.enabled, false)
  }
})

test('base MatCap executes before scene light for regular and Gem materials', () => {
  assert.match(gemShader, /rdGemMatCapUv = rdGemVertexNormalVs\.xy \* 0\.5 \+ 0\.5/)
  assert.doesNotMatch(gemShader, /rdGemOfficialViewNormalXY/)
  assert.doesNotMatch(gemShader, /gl_FrontFacing/)
  assert.match(gemShader, /viewerBackfaceCompensation: false/)
  assert.match(gemShader, /if \(uMaterialMatCapEnabled > 0\.5\)/)
  assert.doesNotMatch(
    gemShader,
    /uMaterialMatCapEnabled > 0\.5 &&[\s\S]*?uMaterialIsGem <= 0\.5/,
  )
  assert.match(gemShader, /rdGemMatCap \* rdMatCapBase \* 2\.0/)
  assert.match(gemShader, /rdMatCapBase = diffuseColor\.rgb/)
  assert.match(gemShader, /rdActiveMatCapMask/)
  assert.doesNotMatch(gemShader, /rdMatCapBase = outgoingLight/)
  assert.ok(
    generalShader.indexOf('// END diffuseColor manipulation') <
      generalShader.indexOf('outgoingLight = diffuseColor.rgb * rdToonSceneLightColor'),
    'the MatCap insertion point must precede the official SH/main-light carrier',
  )
  assert.match(gemShader, /uMaterialMatCapUseLinearGrey/)
  assert.doesNotMatch(gemShader, /rdGemMatCapX/)
  assert.doesNotMatch(gemShader, /dot\(rdGemMatCapX, rdGemNormalVs\)/)
  assert.match(loader, /profile => profile\.gem\.enabled \|\| profile\.matCap\.enabled/)
  assert.match(loader, /addOfficialOutlineGroupsToMesh\(/)
  assert.match(loader, /thickness: profile\.outlineWidth/)
  assert.match(gemExtension, /official-matcap-gem-v10/)
})

test('each recovered material slot retains its exact MatCap Texture2D binding', () => {
  assert.equal(
    profile('mt_chara_106201_body_Jewel').matCap.texture,
    'chara_106201_bodyGem_matcap',
  )
  assert.equal(
    profile('mt_chara_106201_acc_SJ').matCap.texture,
    'chara_106201_acc_matcap',
  )
  assert.equal(
    profile('mt_chara_114501_body_Fresnel').matCap.texture,
    'chara_114501_weapon_a_matcap',
  )
  assert.equal(
    profile('mt_chara_114501_body_Jewel').matCap.texture,
    'chara_114501_body_matcap_jewel',
  )
  assert.equal(
    profile('mt_chara_114501_body_SJ').matCap.texture,
    'chara_114501_body_matcap',
  )
  assert.equal(
    profile('mt_chara_100207_body_Gem').matCap.texture,
    'chara_100207_gem_matcap',
  )
  assert.match(gemShader, /selectOfficialMatCap\(resources, initialProfile\)/)
  assert.match(loader, /materialProfiles,\s*\n\s*texturePathUrl,/)
})

test('all local JP material bundles drive sharp shadow, self-shadow and HDR emission uniforms', () => {
  assert.equal(generatedProfiles.schema, 4)
  assert.equal(generatedProfiles.unityVersion, '2022.3.62f2')
  const { historical, added } = assertReleaseMaterialCorpus(generatedProfiles)

  const socks = profile('mt_chara_101901_body_Socks')
  const weapon = profile('mt_chara_101901_weapon_a')
  assert.equal(socks.shadow.offset, 0.30000001192092896)
  assert.equal(socks.shadow.feather, 0)
  assert.equal(socks.shadow.offsetMapOffset, 0)
  assert.equal(socks.shadow.receiveSelfShadow, true)
  assert.equal(weapon.shadow.castSelfShadow, false)
  assert.equal(weapon.shadow.receiveSelfShadow, false)
  assert.equal(
    profile('mt_chara_102101_weapon_a_trs_out').shadow.offsetMapOffset,
    1,
  )
  assert.equal(profile('mt_chara_107201_hair').shadow.offsetMapOffset, 1)
  assert.equal(
    profile('mt_chara_111701_acc_alpha').shadow.offsetMapOffset,
    0.14000000059604645,
  )

  const officialHair = Object.entries(generatedProfiles.materials)
    .filter(([, value]) => value.angelRing?.isHair)
  assert.equal(historical.filter(value => value.angelRing?.isHair).length, 169)
    assert.equal(added.filter(value => value.angelRing?.isHair).length, 2)
    assert.equal(officialHair.length, 171)
  for (const [name, value] of officialHair) {
    assert.equal(
      value.shadow?.feather,
      0,
      `${name} must preserve serialized zero-feather toon shadow`,
    )
  }

  assert.match(gemShader, /set\('uRdShadowOffset', value\.shadow\.offset\)/)
  assert.match(gemShader, /set\('uRdShadowFeather', value\.shadow\.feather\)/)
  assert.match(
    gemShader,
    /set\('uRdShadowOffsetMapOffset', value\.shadow\.offsetMapOffset\)/,
  )
  assert.match(gemShader, /collectOfficialToonShadowRuntime/)
  assert.match(
    loader,
    /officialToonShadowRuntime[\s\S]*?materialIndex:[\s\S]*?groupStart:[\s\S]*?groupCount:/,
  )
  assert.match(
    gemShader,
    /uRdOfficialAdditionalLightInfluenceByLuminance[\s\S]*?value\.additionalLightInfluenceByLuminance/,
  )
  assert.match(gemShader, /setColor\('uMaterialEmissionColor', value\.emissionColor\)/)
  assert.match(generalShader, /step\(rdToonRampLow, rdToonRamp\)/)
  assert.match(
    generalShader,
    /getAmbientLightIrradiance\(ambientLightColor\)/,
  )
  assert.match(
    generalShader,
    /getLightProbeIrradiance\(\s*lightProbe,\s*normal\s*\)/,
  )
  assert.doesNotMatch(generalShader, /rdToonAmbientColor = irradiance/)
  assert.match(generalShader, /uMaterialReceiveSelfShadow/)
  assert.match(generalShader, /rdToonBaseColor \* uMaterialEmissionColor/)
})

test('custom toon lighting consumes Unity radiance and automatic scene lights', () => {
  assert.match(
    generalShader,
    /directionalLights\[0\]\.color \* RECIPROCAL_PI/,
    'custom toon carrier must undo the PI used only for Three Lambert',
  )
  assert.match(generalShader, /#if NUM_DIR_LIGHTS > 1/)
  assert.match(generalShader, /#if NUM_POINT_LIGHTS > 0/)
  assert.match(generalShader, /#if NUM_SPOT_LIGHTS > 0/)
  assert.match(generalShader, /getPointLightInfo\(/)
  assert.match(generalShader, /getDistanceAttenuation\(/)
  assert.match(generalShader, /rdSpotAttenuation \*= rdSpotAttenuation/)
  assert.match(
    generalShader,
    /rdOfficialAdditionalLight \*[\s\S]*?0\.200000003 \*[\s\S]*?rdOfficialAdditionalLuminanceFactor/,
  )
  assert.equal(profile('mt_chara_101901_hair').additionalLightInfluenceByLuminance, 1)
  assert.match(
    faceShader,
    /rdFaceMainLightColor\s*=\s*directionalLights\[0\]\.color \* RECIPROCAL_PI/,
    'face scene carrier must consume the same Unity main-light radiance as body/hair',
  )
})
