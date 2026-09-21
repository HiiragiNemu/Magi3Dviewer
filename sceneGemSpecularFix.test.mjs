import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import test from 'node:test'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import ts from 'typescript'

const catalog = JSON.parse(readFileSync('public/stages/catalog.json', 'utf8'))
const gem = readFileSync('magia-exedra-character-three/shaders/gem.ts', 'utf8')
const gemExtension = readFileSync('magia-exedra-character-three/shaders/gemExtension.ts', 'utf8')
const loader = readFileSync('magia-exedra-character-three/loader.ts', 'utf8')
const stylization = readFileSync('magia-exedra-character-three/shaders/stylization.ts', 'utf8')
const general = readFileSync('magia-exedra-character-three/shaders/general.ts', 'utf8')
const officialGem = readFileSync(
  'artifacts/research/20260813-shader-reverse/official-shaders/main_gem__blob-95__FOG_LINEAR___MAIN_LIGHT_SHADOWS___MAIN_LIGHT_SHADOWS_CASCADE___ADDITIONAL_LIGHT_SHADOWS___USE_RIM_LIGHT___ISGEM.glsl',
  'utf8',
)
const officialMaterialProfiles = JSON.parse(readFileSync(
  'magia-exedra-character-three/official-material-profiles.json',
  'utf8',
))

function loadTypeScriptCommonJs(path, requireMap = {}) {
  const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: path,
    reportDiagnostics: true,
  })
  assert.deepEqual(
    compiled.diagnostics ?? [],
    [],
    `TypeScript fixture failed to transpile: ${path}`,
  )
  const module = { exports: {} }
  const localRequire = specifier => {
    if (Object.hasOwn(requireMap, specifier)) return requireMap[specifier]
    throw new Error(`Unexpected fixture import ${specifier} from ${path}`)
  }
  Function('exports', 'require', 'module', '__filename', '__dirname', compiled.outputText)(
    module.exports,
    localRequire,
    module,
    path,
    path.replace(/[\\/][^\\/]+$/, ''),
  )
  return module.exports
}

function parseActualCharacterFbx(characterId) {
  const bytes = gunzipSync(readFileSync(
    `magia-exedra-character-three/models/chara_${characterId}_battle_unit/VisualRoot.fbx.gz`,
  ))
  const originalTextureLoad = THREE.TextureLoader.prototype.load
  THREE.TextureLoader.prototype.load = function (_url, onLoad) {
    const texture = new THREE.Texture()
    if (onLoad) queueMicrotask(() => onLoad(texture))
    return texture
  }
  try {
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    )
    return new FBXLoader(new THREE.LoadingManager()).parse(
      arrayBuffer,
      'file:///magius-fixture/',
    )
  } finally {
    THREE.TextureLoader.prototype.load = originalTextureLoad
  }
}

function findMesh(root, name) {
  let result
  root.traverse(object => {
    if (object.isMesh && object.name === name) result = object
  })
  assert.ok(result, `missing actual FBX mesh ${name}`)
  return result
}

test('600-00-00-001 no longer stacks unverified character-brightening effects', () => {
  const stage = catalog.stages.find(stage => stage.id === 'battle-600-00-00-001')
  assert.ok(stage)
  assert.equal(stage.renderProfile.source, 'manual-research')
  assert.equal(stage.renderProfile.directionalLight.intensity, 0.85)
  assert.equal(stage.renderProfile.ambientLight.intensity, 0.4)
  assert.equal(stage.renderProfile.renderer.exposure, 0.85)
  assert.equal(stage.renderProfile.bloom.enabled, false)
  assert.equal(stage.renderProfile.reDriveVolume, undefined)
  assert.equal(stage.dynamic.status, 'pending')
})

test('MatCap uses exported texture and the official view-normal coordinates', () => {
  assert.match(gem, /profile\?\.matCap/)
  assert.match(gem, /resources\.matCaps\.get\(exactName\)/)
  assert.match(gem, /matcap_softmetallic/)
  assert.match(officialGem, /vs_TEXCOORD5\.xy/)
  assert.match(gem, /rdGemMatCapUv = rdGemVertexNormalVs\.xy \* 0\.5 \+ 0\.5/)
  assert.doesNotMatch(gem, /rdGemOfficialViewNormalXY/)
  assert.doesNotMatch(gem, /rdGemMatCapUv = rdGemNormalVs\.xy/)
  assert.doesNotMatch(gem, /rdGemMatCapX/)
  assert.match(gem, /rdGemVertexNormalVs = normalize\(vNormal\)/)
  assert.match(gem, /rdGemCorrectedNormalVs = normalize\(vec3\([\s\S]*?-rdGemVertexNormalVs\.x,[\s\S]*?-rdGemVertexNormalVs\.y \+ uGemHeightCorrection,[\s\S]*?rdGemVertexNormalVs\.z/)
  assert.match(gem, /rdGemHighlightCoordinateOne = saturate\(dot\([\s\S]*?rdGemSurfaceNormalVs,[\s\S]*?rdGemHalfOneVs/)
  assert.match(gem, /rdGemHighlightCoordinateTwo = saturate\(dot\([\s\S]*?rdGemSurfaceNormalVs,[\s\S]*?rdGemHalfTwoVs/)
  assert.match(gem, /rdGemLightVs = normalize\(rdToonCharacterLightDirection\)/)
  assert.doesNotMatch(gem, /rdGemLightVs = normalize\(rdToonMainLightDirection\)/)
  assert.match(gem, /rdGemHardHighlightMask = min\([\s\S]*?rdGemHighlightCoordinateOne[\s\S]*?rdGemHighlightCoordinateTwo/)
  assert.doesNotMatch(gem, /rdGemHardHighlightMask = min\([\s\S]*?rdGemCoordinateOne[\s\S]*?rdGemCoordinateTwo/)
  assert.match(gemExtension, /official-matcap-gem-v10/)
  assert.match(loader, /extendMaterialWithOfficialGem\([\s\S]*texturePathUrl/)
})

test('actual 100107, 101901 and 108301 FBX body slots route their official Soul Gem profiles', async () => {
  const generatedGroups = loadTypeScriptCommonJs(
    'magia-exedra-character-three/submeshGroups.generated.ts',
  )
  const { restoreOfficialSubmeshGroups } = loadTypeScriptCommonJs(
    'magia-exedra-character-three/submeshGroups.ts',
    {
      three: THREE,
      './submeshGroups.generated': generatedGroups,
    },
  )
  const materialProfiles = loadTypeScriptCommonJs(
    'magia-exedra-character-three/materialProfile.ts',
    {
      './official-material-profiles.json?url': 'fixture://official-material-profiles.json',
    },
  )
  await materialProfiles.loadOfficialMaterialProfiles(officialMaterialProfiles)

  const fixtures = [
    {
      characterId: 100107,
      names: [
        'mt_chara_100101_body',
        'mt_chara_100101_body_Aniso',
        'mt_chara_100101_body_SJ',
      ],
      counts: [34164, 834, 246],
      gemIndex: 2,
      gem: {
        firstHighlightSize: 0,
        firstShadowSize: 0,
        secondHighlightSize: 0,
        secondShadowSize: 0,
        heightCorrection: 0.550000011920929,
      },
    },
    {
      characterId: 101901,
      names: [
        'mt_chara_101901_body',
        'mt_chara_101901_body_SJ',
        'mt_chara_101901_body_Socks',
        'mt_chara_101901_body_Gold',
      ],
      counts: [38058, 312, 1020, 3024],
      gemIndex: 1,
      gem: {
        firstHighlightSize: 0,
        firstShadowSize: 1.9199999570846558,
        secondHighlightSize: -1,
        secondShadowSize: 2,
        heightCorrection: -0.375,
      },
    },
    {
      characterId: 108301,
      names: [
        'mt_chara_108301_body_alpha',
        'mt_chara_108301_body_Aniso',
        'mt_chara_108301_body_SJ',
        'mt_chara_108301_body_Gold',
        'mt_chara_108301_body',
      ],
      counts: [2634, 1740, 780, 2022, 28734],
      gemIndex: 2,
      gem: {
        firstHighlightSize: -0.007000000216066837,
        firstShadowSize: 0.5899999737739563,
        secondHighlightSize: -0.039000000804662704,
        secondShadowSize: 0.23999999463558197,
        heightCorrection: -0.1599999964237213,
      },
    },
  ]

  for (const fixture of fixtures) {
    const body = findMesh(parseActualCharacterFbx(fixture.characterId), 'Body_Mesh')
    const names = (Array.isArray(body.material) ? body.material : [body.material])
      .map(material => material.name)
    assert.deepEqual(names, fixture.names)
    assert.equal(body.geometry.index, null)
    assert.equal(body.geometry.groups.length, 0)
    assert.equal(
      body.geometry.getAttribute('position').count,
      fixture.counts.reduce((sum, count) => sum + count, 0),
    )

    const restored = restoreOfficialSubmeshGroups(
      body,
      fixture.characterId,
      names.length,
    )
    assert.deepEqual(restored?.counts, fixture.counts)
    let start = 0
    assert.deepEqual(
      body.geometry.groups,
      fixture.counts.map((count, materialIndex) => {
        const group = { start, count, materialIndex }
        start += count
        return group
      }),
    )

    const profiles = materialProfiles.getOfficialMaterialProfiles(names)
    assert.deepEqual(
      profiles.flatMap((profile, index) => profile.gem.enabled ? [index] : []),
      [fixture.gemIndex],
    )
    const gemProfile = profiles[fixture.gemIndex]
    assert.equal(gemProfile.source, 'official-export')
    assert.equal(gemProfile.name, names[fixture.gemIndex].toLowerCase())
    assert.deepEqual(
      {
        firstHighlightSize: gemProfile.gem.firstHighlightSize,
        firstShadowSize: gemProfile.gem.firstShadowSize,
        secondHighlightSize: gemProfile.gem.secondHighlightSize,
        secondShadowSize: gemProfile.gem.secondShadowSize,
        heightCorrection: gemProfile.gem.heightCorrection,
      },
      fixture.gem,
    )
    assert.deepEqual(gemProfile.matCap, {
      enabled: true,
      source: 'soft-metallic',
      texture: 'matcap_SoftMetallic',
      intensity: 2,
      maskByMetallic: false,
      maskBySpecular: false,
    })
    assert.equal(
      body.geometry.groups[fixture.gemIndex].count,
      fixture.counts[fixture.gemIndex],
    )
  }
})

test('Control G drives the compiled RGB SpecularGradient Overlay', () => {
  assert.doesNotMatch(stylization, /rdToonMetalGradientPosition/)
  assert.match(general, /texture2D\([\s\S]*?tSpecularGradient[\s\S]*?\)\.rgb/)
  assert.match(general, /outgoingLight \* rdSpecularGradient \* 2\.0/)
  assert.match(general, /rdToonMetallicMask \* rdSpecularFresnelGate/)
  assert.doesNotMatch(general, /rdSpecularGradient = pow/)
  assert.doesNotMatch(general, /rdSpecular = min\(rdSpecular, 1\.5\)/)
})
