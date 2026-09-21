import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repoRoot = path.dirname(fileURLToPath(import.meta.url))
const fixtureBase = path.join(
  repoRoot,
  'artifacts',
  'verification',
  '20260905-s6-enemy-texture-archive-localization',
  'focused-fixtures',
)
const generator = path.join(repoRoot, 'scripts', 'build-runtime-product-release-packs.py')
const enemyTag = 'runtime-products-enemy-models-v2'
const gateway = 'https://magius3dviewer-runtime-products.crynetsystemscell.workers.dev'
const origin = 'https://github.com/HiiragiNemu/Magi3Dviewer/releases/download'

function storedZipEntries(bytes) {
  const entries = new Map()
  let offset = 0
  while (offset + 4 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const compressedBytes = bytes.readUInt32LE(offset + 18)
    const uncompressedBytes = bytes.readUInt32LE(offset + 22)
    const nameBytes = bytes.readUInt16LE(offset + 26)
    const extraBytes = bytes.readUInt16LE(offset + 28)
    assert.equal(compressedBytes, uncompressedBytes)
    const nameStart = offset + 30
    const dataStart = nameStart + nameBytes + extraBytes
    const name = bytes.subarray(nameStart, nameStart + nameBytes).toString('utf8')
    entries.set(name, bytes.subarray(dataStart, dataStart + uncompressedBytes))
    offset = dataStart + compressedBytes
  }
  return entries
}

function runtimeProfile(urls) {
  return {
    schema: 'magius.enemy-material-profile.v1',
    profiles: [{
      textures: Object.fromEntries(urls.map((runtimeUrl, index) => [
        `texture_${index}`,
        { stableKey: `texture-${index}`, runtimeReady: true, runtimeUrl },
      ])),
    }],
  }
}

async function writeFixture(name, {
  urls = [
    '/enemies/textures/common/shared.png',
    '/enemies/textures/effects/shared.png',
    '/enemies/textures/common/shared.png',
  ],
  sharedFiles = {
    'common/shared.png': Buffer.from([11, 12, 13]),
    'effects/shared.png': Buffer.from([21, 22]),
  },
  includeProfile = true,
  includeModelRuntime = true,
  existingArchiveMember = false,
} = {}) {
  const root = path.join(fixtureBase, name)
  const fixtureRepo = path.join(root, 'repo')
  const modelRoot = path.join(fixtureRepo, 'public', 'enemies', 'models', 'enemy_fixture')
  const textureRoot = path.join(fixtureRepo, 'public', 'enemies', 'textures')
  const artifactRoot = path.join(root, 'release')
  const catalogPath = path.join(root, 'runtime-product-delivery.v1.json')
  await rm(root, { recursive: true, force: true })
  await mkdir(modelRoot, { recursive: true })
  await mkdir(textureRoot, { recursive: true })
  await writeFile(path.join(modelRoot, 'VisualRoot.fbxdata'), Buffer.from([1, 2, 3, 4]))
  await writeFile(path.join(modelRoot, 'local.png'), Buffer.from([5, 6]))
  if (includeModelRuntime) {
    await writeFile(path.join(modelRoot, 'model-runtime.v1.json'), JSON.stringify({
      schema: 'magius.enemy-model-runtime.v1',
      runtime: { textureFiles: ['local.png'] },
    }))
  }
  let sourceProfileBytes = null
  if (includeProfile) {
    sourceProfileBytes = Buffer.from(`${JSON.stringify(runtimeProfile(urls), null, 2)}\n`)
    await writeFile(path.join(modelRoot, 'material-profile.v1.json'), sourceProfileBytes)
  }
  if (existingArchiveMember) {
    await mkdir(path.join(modelRoot, 'runtime-textures', 'common'), { recursive: true })
    await writeFile(
      path.join(modelRoot, 'runtime-textures', 'common', 'shared.png'),
      Buffer.from([99]),
    )
  }
  for (const [relative, bytes] of Object.entries(sharedFiles)) {
    const destination = path.join(textureRoot, ...relative.split('/'))
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, bytes)
  }

  const assetName = '0001-enemy-model-enemy_fixture.zip'
  const enemyEntry = {
    stableKey: 'enemy-model|enemy_fixture',
    kind: 'enemy-model',
    rootPath: '/enemies/models/enemy_fixture/',
    releaseTag: 'runtime-products-v1-a',
    assetName,
    packUrl: `${gateway}/runtime-products-v1-a/${assetName}`,
    originUrl: `${origin}/runtime-products-v1-a/${assetName}`,
    fileCount: 2 + Number(includeProfile) + Number(includeModelRuntime),
    unpackedBytes: 101,
    packedBytes: 151,
  }
  const stageEntry = {
    stableKey: 'stage|fixture',
    kind: 'stage',
    rootPath: '/stages/official/fixture/',
    releaseTag: 'runtime-products-v1-b',
    assetName: '0002-stage-fixture.zip',
    packUrl: `${gateway}/runtime-products-v1-b/0002-stage-fixture.zip`,
    originUrl: `${origin}/runtime-products-v1-b/0002-stage-fixture.zip`,
    fileCount: 1,
    unpackedBytes: 5,
    packedBytes: 7,
  }
  const catalog = {
    schema: 'magius.runtime-product-delivery.v1',
    repository: 'HiiragiNemu/Magi3Dviewer',
    deliveryGateway: gateway,
    activation: {
      hosts: ['hiiraginemu.github.io', 'magius3dviewer.pages.dev'],
      queryOverride: 'runtimeDelivery=release',
      localMode: 'prefer-workspace-files',
    },
    releasePolicy: {
      tags: ['runtime-products-v1-a', 'runtime-products-v1-b'],
      maxAssetsPerRelease: 1000,
      maxAssetBytesExclusive: 2 * 1024 ** 3,
      compression: 'zip-stored-stream-pass-through',
    },
    counts: {
      products: 2,
      stageProducts: 1,
      enemyModels: 1,
      enemyVfxProducts: 0,
      characterVfxProducts: 0,
      releaseAssets: 2,
      unpackedBytes: enemyEntry.unpackedBytes + stageEntry.unpackedBytes,
      packedBytes: enemyEntry.packedBytes + stageEntry.packedBytes,
    },
    entries: [enemyEntry, stageEntry],
  }
  const catalogBytes = Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`)
  await writeFile(catalogPath, catalogBytes)
  return {
    root,
    fixtureRepo,
    modelRoot,
    artifactRoot,
    catalogPath,
    catalog,
    catalogBytes,
    sourceProfileBytes,
    assetName,
  }
}

function runGenerator(fixture) {
  return spawnSync('python', [
    generator,
    '--repo-root', fixture.fixtureRepo,
    '--artifact-root', fixture.artifactRoot,
    '--catalog-output', fixture.catalogPath,
    '--enemy-models-only',
  ], { encoding: 'utf8' })
}

test('enemy-only generation localizes texture URLs, preserves workspace bytes, and is deterministic', async () => {
  const fixture = await writeFixture('success')
  const first = runGenerator(fixture)
  assert.equal(first.status, 0, first.stderr)
  const archivePath = path.join(
    fixture.artifactRoot,
    'assets',
    enemyTag,
    fixture.assetName,
  )
  const firstArchive = await readFile(archivePath)
  const firstCatalog = await readFile(fixture.catalogPath)
  const entries = storedZipEntries(firstArchive)
  assert.deepEqual([...entries.keys()], [
    'local.png',
    'material-profile.v1.json',
    'model-runtime.v1.json',
    'runtime-textures/common/shared.png',
    'runtime-textures/effects/shared.png',
    'VisualRoot.fbxdata',
  ])
  assert.deepEqual(entries.get('runtime-textures/common/shared.png'), Buffer.from([11, 12, 13]))
  assert.deepEqual(entries.get('runtime-textures/effects/shared.png'), Buffer.from([21, 22]))
  const localized = JSON.parse(entries.get('material-profile.v1.json').toString('utf8'))
  assert.deepEqual(
    Object.values(localized.profiles[0].textures).map(texture => texture.runtimeUrl),
    [
      '/enemies/models/enemy_fixture/runtime-textures/common/shared.png',
      '/enemies/models/enemy_fixture/runtime-textures/effects/shared.png',
      '/enemies/models/enemy_fixture/runtime-textures/common/shared.png',
    ],
  )
  assert.deepEqual(await readFile(
    path.join(fixture.modelRoot, 'material-profile.v1.json'),
  ), fixture.sourceProfileBytes)

  const catalog = JSON.parse(firstCatalog.toString('utf8'))
  assert.deepEqual(catalog.entries[1], fixture.catalog.entries[1])
  assert.deepEqual(catalog.releasePolicy.tags, [
    'runtime-products-v1-a',
    'runtime-products-v1-b',
    enemyTag,
  ])
  assert.equal(catalog.entries[0].releaseTag, enemyTag)
  assert.equal(catalog.entries[0].assetName, fixture.assetName)
  assert.equal(catalog.enemyTextureArchive.modelProducts, 1)
  assert.equal(catalog.enemyTextureArchive.referenceRows, 3)
  assert.equal(catalog.enemyTextureArchive.globalUniqueTextureAuthorities, 2)
  assert.equal(catalog.enemyTextureArchive.perModelUniqueTextureCopies, 2)
  assert.equal(catalog.enemyTextureArchive.missingInputs, 0)
  assert.equal(catalog.enemyTextureArchive.unsafePaths, 0)
  assert.equal(catalog.enemyTextureArchive.destinationCollisions, 0)
  assert.equal(catalog.enemyTextureArchive.workspaceMaterialProfilesUnchanged, true)

  const second = runGenerator(fixture)
  assert.equal(second.status, 0, second.stderr)
  assert.deepEqual(await readFile(archivePath), firstArchive)
  assert.deepEqual(await readFile(fixture.catalogPath), firstCatalog)
})

test('enemy-only generation fails closed on missing shared texture input', async () => {
  const fixture = await writeFixture('missing-texture', {
    urls: ['/enemies/textures/missing.png'],
    sharedFiles: {},
  })
  const result = runGenerator(fixture)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /runtime texture input is missing: missing\.png/)
  assert.deepEqual(await readFile(fixture.catalogPath), fixture.catalogBytes)
})

test('enemy-only generation fails closed on traversal', async () => {
  const fixture = await writeFixture('traversal', {
    urls: ['/enemies/textures/../secret.png'],
    sharedFiles: {},
  })
  const result = runGenerator(fixture)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Unsafe enemy texture source path/)
  assert.deepEqual(await readFile(fixture.catalogPath), fixture.catalogBytes)
})

test('enemy-only generation fails closed on case-folded destination collision', async () => {
  const fixture = await writeFixture('case-collision', {
    urls: [
      '/enemies/textures/Case/Texture.png',
      '/enemies/textures/case/texture.png',
    ],
    sharedFiles: { 'Case/Texture.png': Buffer.from([1]) },
  })
  const result = runGenerator(fixture)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /archive destination collision/)
  assert.deepEqual(await readFile(fixture.catalogPath), fixture.catalogBytes)
})

test('enemy-only generation fails closed when a source member occupies the localized destination', async () => {
  const fixture = await writeFixture('existing-destination', { existingArchiveMember: true })
  const result = runGenerator(fixture)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Archive destination collision/)
  assert.deepEqual(await readFile(fixture.catalogPath), fixture.catalogBytes)
})

test('enemy-only generation fails closed without a material profile', async () => {
  const fixture = await writeFixture('missing-profile', { includeProfile: false })
  const result = runGenerator(fixture)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /missing required files: material-profile\.v1\.json/)
  assert.deepEqual(await readFile(fixture.catalogPath), fixture.catalogBytes)
})

test('enemy-only generation fails closed without model runtime metadata', async () => {
  const fixture = await writeFixture('missing-model-runtime', { includeModelRuntime: false })
  const result = runGenerator(fixture)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /missing required files: model-runtime\.v1\.json/)
  assert.deepEqual(await readFile(fixture.catalogPath), fixture.catalogBytes)
})
