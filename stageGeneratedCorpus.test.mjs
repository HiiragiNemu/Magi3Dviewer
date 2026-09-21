import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { gunzipSync } from 'node:zlib'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = dirname(fileURLToPath(import.meta.url))
const publicRoot = join(root, 'public')
const generatedPath = join(publicRoot, 'stages', 'generated-corpus.json')
const rootCatalogPath = join(publicRoot, 'stages', 'catalog.json')
const shardPath = join(publicRoot, 'stages', 'catalog', 'battle-601-00-01-002.json')
const productRoot = join(publicRoot, 'stages', 'official', 'battle-601-00-01-002')
const profilePath = join(productRoot, 'scene-profile.json')
const modelPath = join(productRoot, 'bg_3d_601_00_01_002.fbxdata')
const nameIndexPath = join(publicRoot, 'stages', 'scene-name-cross-region.v1.json')
const authoredNameProjectorPath = join(root, 'scripts', 'project-stage-scene-authored-names.py')
const stagesSourcePath = join(root, 'src', 'viewer', 'stages.ts')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function publicPath(url) {
  return join(publicRoot, url.replace(/^\.\//, ''))
}

function numericNonFinite(value, path = '$', issues = []) {
  if (typeof value === 'number' && !Number.isFinite(value)) issues.push(path)
  if (Array.isArray(value)) value.forEach((item, index) => numericNonFinite(item, `${path}[${index}]`, issues))
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) numericNonFinite(item, `${path}.${key}`, issues)
  }
  return issues
}

function runProjector(args = []) {
  return spawnSync(process.env.PYTHON ?? 'python', [authoredNameProjectorPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
}

test('root catalog consumes the generated corpus and its first no-copy shard', () => {
  const rootCatalog = readJson(rootCatalogPath)
  const generated = readJson(generatedPath)
  assert.ok(rootCatalog.catalogs.includes('./stages/generated-corpus.json'))
  assert.equal(generated.version, 1)
  assert.equal(generated.sourceRevision, 'steam-jp-2022.3.62f2-no-copy-closure-v1')
  assert.deepEqual(generated.entries, ['./stages/catalog/battle-601-00-01-002.json'])
})

test('601-00-01-002 shard uses stable official identity and no invented display frame', () => {
  const shard = readJson(shardPath)
  assert.equal(shard.id, 'battle-601-00-01-002')
  assert.equal(shard.dioramaBackgroundMstId, 110212)
  assert.equal(shard.backgroundResourceName, 'bg_3d_601_00_01_002')
  assert.equal(shard.assetBundleName, 'battle/stage/bg_3d_601_00_01_002')
  assert.equal(shard.url, './stages/official/battle-601-00-01-002/bg_3d_601_00_01_002.fbxdata')
  assert.equal(shard.sceneProfileUrl, './stages/official/battle-601-00-01-002/scene-profile.json')
  assert.equal(Object.hasOwn(shard, 'spawnPoints'), false)
  assert.equal(shard.dynamic.status, 'partial')
})

test('cross-region record provides exact 601-00-01-002 identity and names', () => {
  const index = readJson(nameIndexPath)
  const row = index.dioramaScenes.find(item => item.viewerStageId === 'battle-601-00-01-002')
  assert.ok(row)
  assert.equal(row.dioramaBackgroundMstId, 110212)
  assert.equal(row.backgroundResourceName, 'bg_3d_601_00_01_002')
  assert.equal(row.names.en.value, 'Darkness Witch - Floor 2')
  assert.equal(row.names.ja.value, '暗闇の魔女 第2階層')
  assert.equal(row.names.zhHant.value, '黑暗的魔女 第2層')
  assert.equal(row.resourceLookup.steamLogicalPath, 'AssetBundles/battle/stage/bg_3d_601_00_01_002')
})

test('authored-name projector defaults to check and restores a byte-exact corpus', () => {
  const defaultCheck = runProjector()
  assert.equal(defaultCheck.status, 0, `${defaultCheck.stdout}\n${defaultCheck.stderr}`)
  assert.match(defaultCheck.stdout, /MODE=check/)
  assert.match(defaultCheck.stdout, /BYTE_EXACT=true/)
  assert.match(defaultCheck.stdout, /MUTATION=false/)

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'magius-stage-name-projection-'))
  const temporaryTarget = join(temporaryRoot, 'scene-name-cross-region.v1.json')
  try {
    const expectedBytes = readFileSync(nameIndexPath)
    const withoutProjection = JSON.parse(expectedBytes.toString('utf8'))
    withoutProjection.authoredScenes = []
    writeFileSync(temporaryTarget, `${JSON.stringify(withoutProjection, null, 2)}\n`, 'utf8')

    const rejected = runProjector(['--check', '--target', temporaryTarget])
    assert.equal(rejected.status, 1, `${rejected.stdout}\n${rejected.stderr}`)
    assert.match(rejected.stdout, /BYTE_EXACT=false/)

    const write = runProjector(['--write', '--target', temporaryTarget])
    assert.equal(write.status, 0, `${write.stdout}\n${write.stderr}`)
    assert.match(write.stdout, /MODE=write/)
    assert.match(write.stdout, /MUTATION=true/)
    assert.deepEqual(readFileSync(temporaryTarget), expectedBytes)

    const check = runProjector(['--check', '--target', temporaryTarget])
    assert.equal(check.status, 0, `${check.stdout}\n${check.stderr}`)
    assert.match(check.stdout, /BYTE_EXACT=true/)
    assert.match(check.stdout, /MUTATION=false/)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('601-00-01-002 profile carries the official eight-light and ReDrive chain', () => {
  const profile = readJson(profilePath)
  assert.equal(profile.stageId, 'battle-601-00-01-002')
  assert.equal(profile.bundle, 'battle/stage/bg_3d_601_00_01_002')
  assert.equal(profile.renderProfile.source, 'ReDriveVolume')
  assert.equal(profile.renderProfile.lights.length, 8)
  assert.equal(profile.materialBindings.length, 9)
  const mainLight = profile.renderProfile.lights.find(light => light.name === 'MainLight')
  assert.ok(mainLight)
  assert.equal(mainLight.type, 'directional')
  assert.equal(mainLight.role, 'character-key')
  assert.equal(mainLight.intensity, 1)
  assert.equal(mainLight.castShadow, true)
  assert.equal(profile.renderProfile.reDriveVolume.characterLightingOverrideDirectionEnabled, true)
  assert.equal(profile.renderProfile.reDriveVolume.shAmbient.length, 27)
})

test('601-00-01-002 restores exact lightmap, UV1 and BC6H reflection products', () => {
  const profile = readJson(profilePath)
  assert.equal(profile.sourceRecords.lightmapAutomation.bindingRendererCount, 5)
  assert.equal(profile.sourceRecords.lightmapAutomation.generatedUv1NodeCount, 26)
  assert.equal(profile.sourceRecords.lightmapAutomation.bindingFailures.length, 0)
  assert.equal(profile.sourceRecords.lightmapAutomation.uv1Failures.length, 0)
  assert.equal(profile.sourceRecords.reflectionProbes.length, 1)
  assert.equal(profile.sourceRecords.reDriveReflectionProbe.export.wrote, true)
  assert.equal(profile.renderProfile.environmentEncoding, 'unity-bc6h-uf16')
  assert.equal(profile.renderProfile.environmentTextureUrl, './stages/official/battle-601-00-01-002/ReflectionProbe-1-bc6h.dds')
  assert.equal(readFileSync(publicPath(profile.renderProfile.lightmap.textureUrl)).subarray(0, 4).toString('ascii'), 'DDS ')
  assert.equal(readFileSync(publicPath(profile.renderProfile.environmentTextureUrl)).subarray(0, 4).toString('ascii'), 'DDS ')
})

test('601-00-01-002 publishes its observed particle runtime without inventing other dynamics', () => {
  const profile = readJson(profilePath)
  assert.equal(profile.runtime.particlePresets.length, 1)
  assert.equal(profile.runtime.particleSystems.length, 2)
  assert.equal(profile.runtime.autoplay, true)
  assert.equal(profile.runtime.loop, true)
  assert.deepEqual(
    Object.keys(profile.sourceRecords.unsupportedVolumeComponents).sort(),
    ['BattleBackground', 'GlobalVolumeController'],
  )
})

test('official Infinity camera-fade values stay diagnosed strings and never become non-finite JSON numbers', () => {
  const profile = readJson(profilePath)
  assert.deepEqual(profile.sourceRecords.nonFiniteNumbers, [
    { path: '$.sourceRecords.materials[0].colors._CameraFadeParams[1]', value: 'Infinity' },
    { path: '$.sourceRecords.materials[9].colors._CameraFadeParams[1]', value: 'Infinity' },
  ])
  assert.deepEqual(numericNonFinite(profile), [])
})

test('generated model and every profile URL reopen while runtime remains scene-generic', () => {
  const model = gunzipSync(readFileSync(modelPath))
  assert.match(model.subarray(0, 32).toString('ascii'), /^Kaydara FBX Binary/)
  const profile = readJson(profilePath)
  const urls = new Set([
    profile.renderProfile.lightmap.bindingsUrl,
    profile.renderProfile.lightmap.textureUrl,
    profile.renderProfile.lightmap.uv1CompanionUrl,
    profile.renderProfile.environmentTextureUrl,
  ])
  for (const binding of profile.materialBindings) {
    for (const [key, value] of Object.entries(binding)) {
      if (key.endsWith('MapUrl') && typeof value === 'string') urls.add(value)
    }
  }
  for (const url of urls) assert.ok(readFileSync(publicPath(url)).length > 0, url)

  const stagesSource = readFileSync(stagesSourcePath, 'utf8')
  assert.doesNotMatch(stagesSource, /battle-601-00-01-002|bg_3d_601_00_01_002/)
  assert.match(stagesSource, /loadStageCatalogTree<StageDefinition>/)
  assert.match(stagesSource, /loadStageSceneNameIndex\(\)/)
})
