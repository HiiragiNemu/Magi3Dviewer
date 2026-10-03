import assert from 'node:assert/strict'
import { gunzipSync } from 'node:zlib'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import ts from 'typescript'

const root = dirname(fileURLToPath(import.meta.url))
const sourcePath = join(root, 'src', 'viewer', 'stageSceneLocalization.ts')
const runtimePath = join(root, `.stage-scene-localization-${process.pid}-${Date.now()}.mjs`)
const compiled = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
})
writeFileSync(runtimePath, compiled.outputText, 'utf8')
const api = await import(pathToFileURL(runtimePath).href)
after(() => rmSync(runtimePath, { force: true }))

const publicIndexPath = join(root, 'public', 'stages', 'scene-name-cross-region.v1.json')
const authoredNameSourcePath = join(root, 'scripts', 'data', 'stage-scene-authored-names.v1.json')
const catalogRootPath = join(root, 'public', 'stages', 'catalog.json')
const catalogEntryPath = join(root, 'public', 'stages', 'catalog', 'battle-602-00-00-001.json')
const productRoot = join(root, 'public', 'stages', 'official', 'battle-602-00-00-001')
const profilePath = join(productRoot, 'scene-profile.json')
const modelPath = join(productRoot, 'bg_3d_602_00_00_001.fbxdata')
const stagesSourcePath = join(root, 'src', 'viewer', 'stages.ts')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function name(value, available = value !== null) {
  return { value, available, quality: 'fixture', source: 'fixture' }
}

function record(overrides = {}) {
  return {
    dioramaBackgroundMstId: 1,
    backgroundResourceName: 'bg_fixture',
    viewerStageId: 'battle-fixture',
    names: {
      en: name('English'),
      ja: name('日本語'),
      zhHant: name('繁體中文'),
    },
    resourceLookup: {
      directRelativePath: 'battle/stage/bg_fixture',
      steamLogicalPath: 'AssetBundles/battle/stage/bg_fixture',
      steamCatalogPresent: true,
      twFullPath: null,
      twCatalogPresent: false,
    },
    ...overrides,
  }
}

function authoredRecord(overrides = {}) {
  return {
    backgroundResourceName: 'bg_authored',
    stagePrefabName: 'bg_authored',
    viewerStageId: 'battle-authored',
    sourceKind: 'authored-stage',
    names: {
      en: name(null, false),
      ja: name(null, false),
      zhHant: name('編寫繁體中文'),
    },
    resourceLookup: {
      directRelativePath: 'battle/stage/bg_authored',
      steamLogicalPath: 'AssetBundles/battle/stage/bg_authored',
      steamCatalogPresent: true,
      twFullPath: 'battle/stage/bg_authored',
      twCatalogPresent: true,
    },
    ...overrides,
  }
}

function index(records, authoredScenes = []) {
  return {
    schemaVersion: 1,
    generatedAt: 'fixture',
    dioramaScenes: records,
    authoredScenes,
  }
}

test('public scene-name index preserves cross-region authority and includes 143 held JP records', () => {
  const sceneIndex = readJson(publicIndexPath)
  assert.equal(sceneIndex.schemaVersion, 1)
  assert.equal(sceneIndex.dioramaScenes.length, 143)
  for (const id of [411011, 411012, 411111, 411112]) {
    const addition = sceneIndex.dioramaScenes.find(row => row.dioramaBackgroundMstId === id)
    assert.equal(addition.names.ja.available, true)
    assert.equal(addition.names.zhHant.value, null)
    assert.equal(addition.names.en.value, null)
  }
  assert.equal(sceneIndex.dioramaScenes.find(row => row.dioramaBackgroundMstId === 910301).names.ja.value, '無限の白い闇の空間')
  assert.equal(sceneIndex.authoredScenes.length, 1)
  assert.equal(sceneIndex.coverage.diorama.allThreeUsable, 120)
  assert.equal(sceneIndex.dioramaScenes.filter(row =>
    ['en', 'ja', 'zhHant'].every(locale =>
      row.names[locale].available && row.names[locale].value,
    )
  ).length, 120)

  const stage602 = sceneIndex.dioramaScenes.find(
    row => row.viewerStageId === 'battle-602-00-00-001',
  )
  assert.ok(stage602)
  assert.equal(stage602.dioramaBackgroundMstId, 110319)
  assert.equal(stage602.backgroundResourceName, 'bg_3d_602_00_00_001')
  assert.equal(stage602.names.en.value, 'Dessert Witch - Boss Floor')
  assert.equal(stage602.names.ja.value, 'お菓子の魔女 ボス階層')
  assert.equal(stage602.names.zhHant.value, '點心的魔女 首腦層')
  assert.equal(
    stage602.resourceLookup.directRelativePath,
    'battle/stage/bg_3d_602_00_00_001',
  )
  assert.equal(
    stage602.resourceLookup.steamLogicalPath,
    'AssetBundles/battle/stage/bg_3d_602_00_00_001',
  )

  const stage616 = sceneIndex.authoredScenes[0]
  assert.equal(stage616.viewerStageId, 'battle-616-00-01-001')
  assert.equal(stage616.backgroundResourceName, 'bg_3d_616_00_01_001')
  assert.equal(stage616.stagePrefabName, 'bg_3d_616_00_01_001')
  assert.equal(stage616.sourceKind, 'authored-stage')
  assert.equal(Object.hasOwn(stage616, 'dioramaBackgroundMstId'), false)
  assert.equal(stage616.names.en.quality, 'typed-blank')
  assert.equal(stage616.names.ja.quality, 'typed-blank')
  assert.equal(stage616.names.zhHant.value, '象徵魔女的魔女結界')
  assert.deepEqual(
    [...stage616.names.zhHant.value].map(value => `U+${value.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`),
    ['U+8C61', 'U+5FB5', 'U+9B54', 'U+5973', 'U+7684', 'U+9B54', 'U+5973', 'U+7D50', 'U+754C'],
  )
  assert.equal(
    Buffer.from(stage616.names.zhHant.value, 'utf8').toString('hex'),
    'e8b1a1e5beb5e9ad94e5a5b3e79a84e9ad94e5a5b3e7b590e7958c',
  )
  assert.equal(stage616.names.zhHant.quality, 'authored')
  assert.equal(stage616.resourceLookup.twCatalogPresent, true)

  const authoredSource = readJson(authoredNameSourcePath)
  const source616 = authoredSource.entries.find(entry => entry.viewerStageId === stage616.viewerStageId)
  assert.ok(source616)
  assert.equal(source616.displayNames.zhHant, '象徵魔女的魔女結界')
  assert.equal(source616.displayNames.zhCN, '象征魔女的魔女结界')
  assert.deepEqual(source616.productProjection, stage616)
})

test('display-name resolver follows English, Simplified-Chinese and Japanese official-name order', () => {
  const complete = record()
  assert.equal(api.resolveStageSceneDisplayName(complete, 'en', 'Fallback'), 'English')
  assert.equal(api.resolveStageSceneDisplayName(complete, 'zh-CN', 'Fallback'), '繁體中文')
  assert.equal(api.resolveStageSceneDisplayName(complete, 'ja-JP', 'Fallback'), '日本語')

  const withoutTw = record({
    names: {
      en: name('English'),
      ja: name('日本語'),
      zhHant: name(null, false),
    },
  })
  assert.equal(api.resolveStageSceneDisplayName(withoutTw, 'zh-CN', 'Fallback'), '日本語')
  assert.equal(api.resolveStageSceneDisplayName(withoutTw, 'ja-JP', 'Fallback'), '日本語')

  const withoutEnglish = record({
    names: {
      en: name(null, false),
      ja: name('日本語'),
      zhHant: name('繁體中文'),
    },
  })
  assert.equal(api.resolveStageSceneDisplayName(withoutEnglish, 'en', 'Fallback'), '日本語')

  const authored = authoredRecord()
  assert.equal(api.resolveStageSceneDisplayName(authored, 'zh-CN', 'Fallback'), '編寫繁體中文')
  assert.equal(api.resolveStageSceneDisplayName(authored, 'ja-JP', 'Fallback'), '編寫繁體中文')
  assert.equal(api.resolveStageSceneDisplayName(authored, 'en', 'Fallback'), 'Fallback')
  assert.equal(api.resolveStageSceneDisplayName(undefined, 'en', 'Fallback'), 'Fallback')
})

test('scene-name loader resolves its URL and rejects duplicate stable or viewer IDs', async () => {
  let requestedUrl = null
  const loaded = await api.loadStageSceneNameIndex('./names.json', {
    pageBaseUrl: 'https://viewer.example/app/',
    fetchJson: async url => {
      requestedUrl = url
      return index([record()], [authoredRecord()])
    },
  })
  assert.equal(requestedUrl, 'https://viewer.example/app/names.json')
  assert.equal(loaded.dioramaScenes.length, 1)
  assert.equal(loaded.authoredScenes.length, 1)
  assert.equal(
    api.getStageSceneNameRecord(loaded, 'battle-fixture').backgroundResourceName,
    'bg_fixture',
  )
  assert.equal(
    api.getStageSceneNameRecord(loaded, 'battle-authored').backgroundResourceName,
    'bg_authored',
  )

  await assert.rejects(
    api.loadStageSceneNameIndex('./duplicate-stable.json', {
      pageBaseUrl: 'https://viewer.example/app/',
      fetchJson: async () => index([
        record(),
        record({ viewerStageId: 'battle-other', backgroundResourceName: 'bg_other' }),
      ]),
    }),
    /Duplicate dioramaBackgroundMstId: 1/,
  )
  await assert.rejects(
    api.loadStageSceneNameIndex('./duplicate-viewer.json', {
      pageBaseUrl: 'https://viewer.example/app/',
      fetchJson: async () => index([
        record(),
        record({ dioramaBackgroundMstId: 2, backgroundResourceName: 'bg_other' }),
      ]),
    }),
    /Duplicate viewerStageId: battle-fixture/,
  )
  await assert.rejects(
    api.loadStageSceneNameIndex('./duplicate-cross-array-viewer.json', {
      pageBaseUrl: 'https://viewer.example/app/',
      fetchJson: async () => index(
        [record()],
        [authoredRecord({ viewerStageId: 'battle-fixture' })],
      ),
    }),
    /Duplicate viewerStageId: battle-fixture/,
  )
})

test('602 catalog entry uses stable official keys and does not invent a display frame', () => {
  const catalogRoot = readJson(catalogRootPath)
  const entry = readJson(catalogEntryPath)
  assert.ok(catalogRoot.entries.includes('./stages/catalog/battle-602-00-00-001.json'))
  assert.equal(entry.id, 'battle-602-00-00-001')
  assert.equal(entry.dioramaBackgroundMstId, 110319)
  assert.equal(entry.backgroundResourceName, 'bg_3d_602_00_00_001')
  assert.equal(entry.assetBundleName, 'battle/stage/bg_3d_602_00_00_001')
  assert.equal(
    entry.url,
    './stages/official/battle-602-00-00-001/bg_3d_602_00_00_001.fbxdata',
  )
  assert.equal(
    entry.sceneProfileUrl,
    './stages/official/battle-602-00-00-001/scene-profile.json',
  )
  assert.equal(Object.hasOwn(entry, 'spawnPoints'), false)
  assert.equal(entry.dynamic.status, 'partial')
})

test('602 profile carries official lighting, materials, lightmap and runtime records without a fake probe texture', () => {
  const profile = readJson(profilePath)
  assert.equal(profile.stageId, 'battle-602-00-00-001')
  assert.equal(profile.bundle, 'battle/stage/bg_3d_602_00_00_001')
  assert.equal(profile.renderProfile.source, 'ReDriveVolume')
  assert.equal(profile.renderProfile.lights.length, 2)
  assert.equal(profile.materialBindings.length, 13)

  const mainLight = profile.renderProfile.lights.find(light => light.name === 'MainLight')
  assert.ok(mainLight)
  assert.equal(mainLight.type, 'directional')
  assert.equal(mainLight.role, 'character-key')
  assert.equal(mainLight.castShadow, true)
  assert.deepEqual(mainLight.color, [
    0.766853928565979,
    0.7799999713897705,
    0.7055056095123291,
    1,
  ])
  assert.equal(profile.renderProfile.reDriveVolume.characterLightingOverrideRatio, 1)
  assert.deepEqual(
    profile.renderProfile.reDriveVolume.characterLightingOverrideDirection,
    [130, 40, 0],
  )
  assert.equal(profile.renderProfile.reDriveVolume.shAmbient.length, 27)

  assert.equal(
    profile.renderProfile.lightmap.textureUrl,
    './stages/official/battle-602-00-00-001/Lightmap-0_comp_light-bc6h.dds',
  )
  assert.equal(
    profile.renderProfile.lightmap.uv1CompanionUrl,
    './stages/official/battle-602-00-00-001/uv1-companion.json',
  )
  assert.equal(profile.runtime.serializedComponentClips.length, 5)
  assert.equal(profile.runtime.volumetricLightBeams.length, 1)
  assert.equal(profile.runtime.volumetricDustParticles.length, 1)
  assert.equal(profile.runtime.autoplay, true)
  assert.equal(profile.runtime.loop, true)

  assert.equal(profile.sourceRecords.reflectionProbes.length, 1)
  assert.equal(profile.sourceRecords.reflectionProbes[0].activeInHierarchy, false)
  assert.equal(profile.sourceRecords.reflectionProbes[0].textureUrl, null)
  assert.equal(profile.sourceRecords.reDriveReflectionProbe.environmentTextureUrl, null)
  assert.equal(profile.sourceRecords.nonFiniteNumbers.length, 0)
})

test('602 model and every generated profile asset are locally consumable', () => {
  const model = gunzipSync(readFileSync(modelPath))
  assert.match(model.subarray(0, 32).toString('ascii'), /^Kaydara FBX Binary/)

  const profile = readJson(profilePath)
  const relativeUrls = new Set([
    profile.renderProfile.lightmap.bindingsUrl,
    profile.renderProfile.lightmap.textureUrl,
    profile.renderProfile.lightmap.uv1CompanionUrl,
  ])
  for (const binding of profile.materialBindings) {
    for (const [key, value] of Object.entries(binding)) {
      if (key.endsWith('MapUrl') && typeof value === 'string') relativeUrls.add(value)
    }
  }
  for (const relativeUrl of relativeUrls) {
    const localPath = join(root, 'public', relativeUrl.replace(/^\.\//, ''))
    assert.ok(readFileSync(localPath).length > 0, relativeUrl)
  }
})

test('stages runtime consumes localized metadata without touching protected setup or locomotion chains', () => {
  const source = readFileSync(stagesSourcePath, 'utf8')
  assert.match(source, /loadStageSceneNameIndex\(\)/)
  assert.match(source, /getStageSceneNameRecord\(stageSceneNameIndex, definition\.id\)/)
  assert.match(source, /resolveStageSceneDisplayName\(/)
  assert.match(source, /getUiLocale\(\)/)
  assert.match(source, /magius:localechange/)
  assert.match(source, /dioramaBackgroundMstId/)
  assert.match(source, /typeof recordDioramaBackgroundMstId === 'number'/)
  assert.match(source, /Number\.isFinite\(recordDioramaBackgroundMstId\)/)
  assert.match(source, /typeof record\.dioramaBackgroundMstId === 'number'/)
  assert.doesNotMatch(source, /String\(record\.dioramaBackgroundMstId\)\s*\n\s*option\.dataset/)
  assert.match(source, /backgroundResourceName/)
  assert.match(source, /sceneNameIndex:/)
  assert.doesNotMatch(source, /setupViewer\(/)
  assert.doesNotMatch(source, /viewerLocomotion|characterLocomotion|characterTimeline/)
  assert.doesNotMatch(source, /toolbar-tools|side-dock|animation-progress/)
})
