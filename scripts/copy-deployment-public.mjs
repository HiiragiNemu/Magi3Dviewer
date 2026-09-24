import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const scriptPath = fileURLToPath(import.meta.url)
const repoRoot = path.resolve(path.dirname(scriptPath), '..')
const sourceRoot = path.join(repoRoot, 'public')
const outputRoot = path.resolve(
  repoRoot,
  process.env.MAGIUS_DEPLOY_OUT_DIR || 'dist-deploy',
)
const cloudflareMaxFileBytes = 25 * 1024 ** 2
const cloudflareTarget = process.env.MAGIUS_DEPLOY_TARGET === 'cloudflare'
export const githubPagesOneGiBBytes = 1024 ** 3
export const githubPagesPublishedSiteLimitBytes = 1_000_000_000
export const githubPagesFileLimit = 20_000
export const enemyModelReleaseTag = 'runtime-products-enemy-models-v2'
export const bundledEnemyModelNames = ['enemy_605025_battle_unit', 'enemy_605026_battle_unit']
const derivedTextureOutputs = new Set()
const combatJumpSourceBytes = 36_855_023
const combatJumpOutputBytes = 24_728_038
const excludedRoots = [
  'stages/official/',
  'enemies/models/',
  'enemies/textures/',
  'vfx/enemy/',
  'vfx/character/',
]
export const requiredDirectoryClosures = [
  {
    source: 'public/stages/official/battle-600-00-01-001',
    output: 'stages/official/battle-600-00-01-001',
  },
  {
    source: 'public/stages/official/battle-600-00-01-002',
    output: 'stages/official/battle-600-00-01-002',
  },
  {
    source: 'public/stages/official/battle-600-00-00-001',
    output: 'stages/official/battle-600-00-00-001',
  },
  {
    source: 'public/stages/official/dungeon-intro-0001-001',
    output: 'stages/official/dungeon-intro-0001-001',
  },
  {
    source: 'public/stages/official/gallery-memory-room',
    output: 'stages/official/gallery-memory-room',
  },
  {
    source: 'public/stages/official/gallery-memory-room-story',
    output: 'stages/official/gallery-memory-room-story',
  },
  // Rose Garden Part II route closure: these catalog entries are selectable
  // and must ship with their authoritative FBX/profile/resource companions.
  {
    source: 'public/stages/official/battle-600-01-00-001',
    output: 'stages/official/battle-600-01-00-001',
  },
  {
    source: 'public/stages/official/battle-600-01-01-001',
    output: 'stages/official/battle-600-01-01-001',
  },
  // Rose Garden Part II layer 2: keep the previously loadable scene in the
  // same lightweight deployment closure so its authoritative FBX/profile and
  // UV1 companion are available to the release runtime.
  {
    source: 'public/stages/official/battle-600-01-01-002',
    output: 'stages/official/battle-600-01-01-002',
  },
  {
    source: 'public/stages/official/battle-600-01-01-003',
    output: 'stages/official/battle-600-01-01-003',
  },
  // Additional verified battle-scene closures from the official direct catalog.
  // This current source contains the native-absent UV0 normalization. Do not
  // fetch the historical archive with the older FBX after a release build.
  {
    source: 'public/stages/official/battle-621-00-00-001',
    output: 'stages/official/battle-621-00-00-001',
  },
  // Keep the restored native visibility/material profiles and their actual
  // carriers together. Old remote archives predate these serialized states.
  ...[
    'battle-601-00-01-001',
    'battle-608-00-00-001',
    'battle-616-00-01-001',
    'battle-602-00-00-001',
    'battle-601-00-01-002',
    'battle-600-00-01-003',
    'battle-603-00-00-001',
  ].map(id => ({
    source: `public/stages/official/${id}`,
    output: `stages/official/${id}`,
  })),
  // Initial native states verified on 18 more real carriers; keep release bytes current.
  ...[
    "alternative-background-alternative-bg-model-00",
    "alternative-background-alternative-bg-model-01",
    "alternative-stage-model-alternative-stage-model-01-released",
    "alternative-stage-model-alternative-stage-model-1-released",
    "alternative-stage-model-alternative-stage-model-1-unreleased",
    "battle-600-10-00-001",
    "battle-600-10-01-001",
    "battle-600-10-01-002",
    "battle-600-10-01-003",
    "battle-601-00-00-001",
    "battle-601-00-01-003",
    "battle-601-14-00-001",
    "battle-601-15-00-001"
  ].map(id => ({ source: `public/stages/official/${id}`, output: `stages/official/${id}` })),
  {
    source: 'public/enemies/models/enemy_654001_battle_unit',
    output: 'enemies/models/enemy_654001_battle_unit',
  },
]
export const requiredFileClosures = [
  {
    source: 'artifacts/research/20260827-voice-catalog-source-ready/manifest.v1.json',
    output: 'artifacts/research/20260827-voice-catalog-source-ready/manifest.v1.json',
  },
  {
    source: 'artifacts/research/20260827-voice-scenario-source-ready/manifest.v1.json',
    output: 'artifacts/research/20260827-voice-scenario-source-ready/manifest.v1.json',
  },
]
// These exact new products ship locally until a separately verified release
// archive exists. Historical 493 remote archives remain byte-identical.
for (const model of bundledEnemyModelNames) requiredDirectoryClosures.push({
  source: `public/enemies/models/${model}`,
  output: `enemies/models/${model}`,
})

export async function collectBundledEnemyTextures(root = repoRoot) {
  const registry = JSON.parse(await readFile(path.join(root, 'public/enemies/texture-runtime-products.v1.json'), 'utf8'))
  const entries = new Map(registry.entries.map(entry => [entry.stableKey, entry]))
  const resolved = new Map()
  for (const model of bundledEnemyModelNames) {
    const directory = path.join(root, 'public/enemies/models', model)
    const profile = JSON.parse(await readFile(path.join(directory, 'material-profile.v1.json'), 'utf8'))
    for (const material of profile.profiles) for (const texture of Object.values(material.textures)) {
      const entry = entries.get(texture.stableKey)
      const match = /^\/enemies\/textures\/(android-jp-20260916\/[a-z0-9_-]+\.png)$/.exec(texture.runtimeUrl ?? '')
      if (!match || !entry || entry.sourcePlatform !== 'AndroidJP' || entry.runtimeUrl !== texture.runtimeUrl)
        throw new Error(`Bundled enemy texture identity mismatch: ${model} ${texture.stableKey}`)
      const source = path.join(root, 'public/enemies/textures', match[1])
      const bytes = await readFile(source)
      if (bytes.length !== entry.bytes) throw new Error(`Bundled enemy texture size mismatch: ${source}`)
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const output = texture.runtimeUrl.slice(1), previous = resolved.get(output)
      if (previous && previous.sha256 !== sha256) throw new Error(`Bundled enemy texture byte collision: ${output}`)
      resolved.set(output, { source, output, bytes: bytes.length, sha256 })
    }
  }
  return [...resolved.values()]
}
const requiredOutputFiles = [
  'catalogs/runtime-product-delivery.v1.json',
  'catalogs/official-resources.v1.json',
  'stages/catalog.json',
  'enemies/manifest.v1.json',
  'vfx/catalog.v1.json',
  'stages/official/battle-600-01-01-002/scene-profile.json',
  'stages/official/battle-600-01-01-002/bg_3d_600_01_01_002.fbxdata',
  'stages/official/battle-600-00-01-001/scene-profile.json',
  'stages/official/battle-600-00-01-002/scene-profile.json',
  'stages/official/battle-600-00-00-001/bg_3d_600_00_00_001.fbxdata',
  'stages/official/dungeon-intro-0001-001/level_intro_0001_001.fbxdata',
  'stages/official/dungeon-intro-0001-001/scene-profile.json',
  'stages/official/gallery-memory-room/bg3d_gallery.fbxdata',
  'stages/official/gallery-memory-room-story/bg3d_gallery_story.fbxdata',
  'stages/official/gallery-memory-room-story/scene-profile.json',
  'enemies/models/enemy_654001_battle_unit/model-runtime.v1.json',
  'enemies/models/enemy_654001_battle_unit/material-profile.v1.json',
  ...requiredFileClosures.map(entry => entry.output),
  'character-actions/combat-jump/manifest.v1.json',
]
const normalize = value => value.replaceAll('\\', '/')
const isSourceMap = relative => normalize(relative).toLowerCase().endsWith('.map')
const excluded = relative => {
  const value = normalize(relative).replace(/^\/+/, '')
  return excludedRoots.some(root => value === root.slice(0, -1) || value.startsWith(root))
}

export function minifyJsonWhitespaceOutsideStrings(source) {
  const output = Buffer.allocUnsafe(source.length)
  let writeOffset = 0
  let inString = false
  let escaped = false
  for (let readOffset = 0; readOffset < source.length; readOffset++) {
    const byte = source[readOffset]
    if (inString) {
      output[writeOffset++] = byte
      if (escaped) escaped = false
      else if (byte === 0x5c) escaped = true
      else if (byte === 0x22) inString = false
    } else if (byte === 0x22) {
      inString = true
      output[writeOffset++] = byte
    } else if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
      output[writeOffset++] = byte
    }
  }
  if (inString) throw new Error('Cannot minify JSON with an unterminated string')
  return output.subarray(0, writeOffset)
}

let copiedFiles = 0
let copiedBytes = 0
let skippedSourceMapFiles = 0
let skippedSourceMapBytes = 0
let actionRuntimeAuthorityPaths = new Set()
let skippedActionRuntimeFiles = 0
let skippedActionRuntimeBytes = 0

/**
 * Action manifests retain their source authority URLs. Both action loaders
 * resolve those URLs to byte-identical neutral browser carriers before fetch.
 * Keep the source pair intact and omit only the redundant authority file in
 * deployment, after checking every manifest reference and carrier byte.
 */
export async function collectActionRuntimeCarriers(publicRoot) {
  const native = JSON.parse(await readFile(path.join(publicRoot, 'character-actions/manifest.v1.json'), 'utf8'))
  const combat = JSON.parse(await readFile(path.join(publicRoot, 'character-actions/combat-jump/manifest.v1.json'), 'utf8'))
  if (native.schema !== 'magius.character-action-resource-manifest.v1'
    || combat.schema !== 'magius.all-character-combat-jump-resource-manifest.v1'
    || !Array.isArray(native.entries) || !Array.isArray(combat.characters)
    || !Array.isArray(combat.entries)) {
    throw new Error('Action runtime carrier manifest contract changed')
  }
  const urls = new Set([
    ...native.entries.map(entry => entry.runtime?.url),
    ...combat.characters.filter(entry => entry.runtime).map(entry => entry.runtime.url),
  ])
  // A consumer entry must resolve to a runtime declared by the character table.
  for (const entry of combat.entries) {
    const url = entry.resource?.runtimeUrl
    if (typeof url === 'string' && !urls.has(url)) {
      throw new Error(`Action entry runtime lacks a declared carrier: ${url}`)
    }
  }
  const carriers = []
  for (const url of [...urls].sort()) {
    if (typeof url !== 'string'
      || !/^\/character-actions\/(?:native-dungeon\/\d+|combat-jump\/runtime\/\d+)\/runtime\.v1\.json\.gz$/.test(url)) {
      throw new Error(`Unexpected action runtime authority path: ${url}`)
    }
    const authority = url.slice(1)
    const browserCarrier = authority.replace(/runtime\.v1\.json\.gz$/, 'runtime.v1.magius-runtime')
    const [sourceBytes, carrierBytes] = await Promise.all([
      readFile(path.join(publicRoot, authority)),
      readFile(path.join(publicRoot, browserCarrier)),
    ])
    if (!sourceBytes.equals(carrierBytes) || sourceBytes[0] !== 0x1f || sourceBytes[1] !== 0x8b) {
      throw new Error(`Action runtime carrier differs from gzip authority: ${authority}`)
    }
    carriers.push({ authority, browserCarrier, bytes: sourceBytes.length })
  }
  return carriers
}

async function copyFile(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true })
  await cp(source, destination, { force: true })
  copiedFiles++
  copiedBytes += (await stat(source)).size
}
async function copyTree(directory, relative = '', honorExclusions = true) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const childRelative = normalize(path.join(relative, entry.name))
    if (honorExclusions && excluded(childRelative)) continue
    const source = path.join(directory, entry.name)
    const destination = path.join(outputRoot, childRelative)
    if (entry.isDirectory()) {
      await mkdir(destination, { recursive: true })
      await copyTree(source, childRelative, honorExclusions)
    } else if (entry.isFile()) {
      if (actionRuntimeAuthorityPaths.has(childRelative)) {
        skippedActionRuntimeFiles++
        skippedActionRuntimeBytes += (await stat(source)).size
        continue
      }
      if (isSourceMap(childRelative)) {
        skippedSourceMapFiles++
        skippedSourceMapBytes += (await stat(source)).size
        continue
      }
      await copyFile(source, destination)
    }
  }
}

async function requireFile(relative) {
  const metadata = await stat(path.join(outputRoot, relative))
  if (!metadata.isFile()) throw new Error(`Required deployment file is not a file: ${relative}`)
}

async function treePreflight(directory) {
  let files = 0
  let bytes = 0
  async function inspect(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name)
      if (entry.isDirectory()) await inspect(child)
      else if (entry.isFile()) {
        files++
        bytes += (await stat(child)).size
      }
    }
  }
  await inspect(directory)
  return { files, bytes }
}

export function assertEnemyTextureArchiveClosure(catalog) {
  const closure = catalog?.enemyTextureArchive
  const exact = {
    status: 'PASS_ARCHIVE_LOCAL_CLOSURE',
    releaseTag: enemyModelReleaseTag,
    modelProducts: 493,
    referenceRows: 22_372,
    runtimeUrlsResolvedInsideArchives: 22_372,
    globalUniqueTextureAuthorities: 1_969,
    sharedTextureAuthorityBytes: 564_810_901,
    perModelUniqueTextureCopies: 4_110,
    duplicatedTextureBytes: 1_833_602_636,
    missingInputs: 0,
    unsafePaths: 0,
    destinationCollisions: 0,
    workspaceMaterialProfilesUnchanged: true,
  }
  for (const [field, expected] of Object.entries(exact)) {
    if (closure?.[field] !== expected) {
      throw new Error(`Enemy texture archive closure mismatch: ${field}`)
    }
  }
  const enemyEntries = catalog?.entries?.filter(entry => entry?.kind === 'enemy-model')
  if (!Array.isArray(enemyEntries) || enemyEntries.length !== exact.modelProducts) {
    throw new Error('Enemy texture archive catalog model count mismatch')
  }
  if (!catalog?.releasePolicy?.tags?.includes(enemyModelReleaseTag)) {
    throw new Error('Enemy texture archive release policy tag is missing')
  }
  const stableKeys = new Set()
  for (const entry of enemyEntries) {
    if (
      entry.releaseTag !== enemyModelReleaseTag
      || entry.packUrl !== `${catalog.deliveryGateway}/${enemyModelReleaseTag}/${entry.assetName}`
      || entry.originUrl !== `https://github.com/${catalog.repository}/releases/download/${enemyModelReleaseTag}/${entry.assetName}`
      || stableKeys.has(entry.stableKey)
    ) {
      throw new Error(`Enemy texture archive catalog identity mismatch: ${entry.stableKey}`)
    }
    stableKeys.add(entry.stableKey)
  }
  const sums = enemyEntries.reduce((result, entry) => ({
    files: result.files + entry.fileCount,
    unpackedBytes: result.unpackedBytes + entry.unpackedBytes,
    packedBytes: result.packedBytes + entry.packedBytes,
  }), { files: 0, unpackedBytes: 0, packedBytes: 0 })
  if (
    sums.files !== closure.archiveFiles
    || sums.unpackedBytes !== closure.archiveUnpackedBytes
    || sums.packedBytes !== closure.archivePackedBytes
  ) {
    throw new Error('Enemy texture archive catalog byte accounting mismatch')
  }
  return { ...exact, ...sums }
}

async function removeOutputTree(relative) {
  const directory = path.join(outputRoot, relative)
  try {
    const metadata = await stat(directory)
    if (!metadata.isDirectory()) throw new Error(`Deployment exclusion is not a directory: ${relative}`)
    const removed = await treePreflight(directory)
    await rm(directory, { recursive: true, force: true })
    return removed
  } catch (error) {
    if (error?.code === 'ENOENT') return { files: 0, bytes: 0 }
    throw error
  }
}

async function removeOutputSourceMaps() {
  const matches = []
  async function inspect(directory, relative = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const childRelative = normalize(path.join(relative, entry.name))
      const child = path.join(directory, entry.name)
      if (entry.isDirectory()) await inspect(child, childRelative)
      else if (entry.isFile() && isSourceMap(childRelative)) {
        matches.push({ path: child, relative: childRelative, bytes: (await stat(child)).size })
      }
    }
  }
  await inspect(outputRoot)
  for (const match of matches) await rm(match.path, { force: true })
  return {
    files: matches.length,
    bytes: matches.reduce((sum, match) => sum + match.bytes, 0),
  }
}

function permittedExcludedEntry(relative) {
  const value = normalize(relative).replace(/^\/+|\/+$/g, '')
  return [...requiredDirectoryClosures, ...[...derivedTextureOutputs].map(output => ({ output }))].some(({ output }) => {
    const allowed = normalize(output).replace(/^\/+|\/+$/g, '')
    return value === allowed || value.startsWith(`${allowed}/`) || allowed.startsWith(`${value}/`)
  })
}

async function assertExcludedRootBoundaries() {
  async function inspect(directory, relative) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const childRelative = normalize(path.join(relative, entry.name))
      if (!permittedExcludedEntry(childRelative)) {
        throw new Error(`Excluded raw product path entered deployment: ${childRelative}`)
      }
      if (entry.isDirectory()) await inspect(path.join(directory, entry.name), childRelative)
    }
  }
  for (const root of excludedRoots) {
    const relative = root.slice(0, -1)
    const directory = path.join(outputRoot, relative)
    try {
      const metadata = await stat(directory)
      if (!metadata.isDirectory()) {
        throw new Error(`Excluded raw product root is not a directory: ${relative}`)
      }
      if (!permittedExcludedEntry(relative)) {
        throw new Error(`Excluded raw product root entered deployment: ${relative}`)
      }
      await inspect(directory, relative)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
}

async function deploymentFilePreflight() {
  let files = 0
  let bytes = 0
  let largestFile = { relative: null, bytes: 0 }
  async function inspect(directory, relative = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const childRelative = normalize(path.join(relative, entry.name))
      const child = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await inspect(child, childRelative)
      } else if (entry.isFile()) {
        const size = (await stat(child)).size
        if (size > cloudflareMaxFileBytes) {
          throw new Error(
            `Cloudflare max-file preflight failed: ${childRelative} is ${size}B ` +
            `(limit ${cloudflareMaxFileBytes}B)`,
          )
        }
        files++
        bytes += size
        if (size > largestFile.bytes) largestFile = { relative: childRelative, bytes: size }
      }
    }
  }
  await inspect(outputRoot)
  return { files, bytes, largestFile }
}

export function finalizeDeploymentSummary(
  baseResult,
  deploymentBytesBeforeSummary,
  existingSummaryBytesBeforeWrite = 0,
) {
  let deploymentSummaryBytes = 0
  let deploymentBytesIncludingSummary = deploymentBytesBeforeSummary - existingSummaryBytesBeforeWrite
  for (let attempt = 0; attempt < 16; attempt++) {
    const githubPagesBytesOverOneGiB = Math.max(
      0,
      deploymentBytesIncludingSummary - githubPagesOneGiBBytes,
    )
    const underGitHubPagesOneGiB = deploymentBytesIncludingSummary < githubPagesOneGiBBytes
    const githubPagesPublishedSiteBytesOverLimit = Math.max(
      0,
      deploymentBytesIncludingSummary - githubPagesPublishedSiteLimitBytes,
    )
    const underGitHubPagesPublishedSiteLimit = (
      deploymentBytesIncludingSummary < githubPagesPublishedSiteLimitBytes
    )
    const underGitHubPagesFileLimit = (
      Number(baseResult.deploymentFilesIncludingSummary) <= githubPagesFileLimit
    )
    const result = {
      ...baseResult,
      deploymentSummaryBytes,
      deploymentBytesIncludingSummary,
      githubPagesOneGiBLimitBytes: githubPagesOneGiBBytes,
      githubPagesBytesOverOneGiB,
      githubPagesRequiredReductionBytes: underGitHubPagesOneGiB
        ? 0
        : githubPagesBytesOverOneGiB + 1,
      underGitHubPagesOneGiB,
      githubPagesPublishedSiteLimitBytes,
      githubPagesPublishedSiteBytesOverLimit,
      githubPagesPublishedSiteRequiredReductionBytes: underGitHubPagesPublishedSiteLimit
        ? 0
        : githubPagesPublishedSiteBytesOverLimit + 1,
      underGitHubPagesPublishedSiteLimit,
      githubPagesFileLimit,
      underGitHubPagesFileLimit,
    }
    const summary = `${JSON.stringify(result, null, 2)}\n`
    const nextSummaryBytes = Buffer.byteLength(summary, 'utf8')
    const nextDeploymentBytes = (
      deploymentBytesBeforeSummary
      - existingSummaryBytesBeforeWrite
      + nextSummaryBytes
    )
    if (
      nextSummaryBytes === deploymentSummaryBytes
      && nextDeploymentBytes === deploymentBytesIncludingSummary
    ) {
      return { result, summary }
    }
    deploymentSummaryBytes = nextSummaryBytes
    deploymentBytesIncludingSummary = nextDeploymentBytes
  }
  throw new Error('Deployment summary byte count did not converge')
}

export function withBundledStageRoots(catalog, closures = requiredDirectoryClosures) {
  const bundledStageRoots = closures.map(entry => `/${normalize(entry.output).replace(/^\/+|\/+$/g, '')}/`)
    .filter(root => root.startsWith('/stages/official/'))
  for (const root of bundledStageRoots) {
    if (!/^\/stages\/official\/[A-Za-z0-9_-]+\/$/.test(root)
      || !catalog.entries.some(entry => entry.kind === 'stage' && entry.rootPath === root)) {
      throw new Error(`Bundled stage closure lacks exact archive identity: ${root}`)
    }
  }
  if (new Set(bundledStageRoots).size !== bundledStageRoots.length) throw new Error('Duplicate bundled stage closure')
  return { ...catalog, bundledStageRoots }
}

export async function runDeploymentPublicCopy() {
  copiedFiles = 0
  copiedBytes = 0
  skippedSourceMapFiles = 0
  skippedSourceMapBytes = 0
  skippedActionRuntimeFiles = 0
  skippedActionRuntimeBytes = 0
  const actionRuntimeCarriers = await collectActionRuntimeCarriers(sourceRoot)
  actionRuntimeAuthorityPaths = new Set(actionRuntimeCarriers.map(entry => entry.authority))
  await mkdir(outputRoot, { recursive: true })
  const deliveryCatalog = JSON.parse(await readFile(
    path.join(sourceRoot, 'catalogs/runtime-product-delivery.v1.json'),
    'utf8',
  ))
  const enemyTextureArchiveClosure = assertEnemyTextureArchiveClosure(deliveryCatalog)
  const bundledEnemyTextures = await collectBundledEnemyTextures()
  const bundledTextureBytes = bundledEnemyTextures.reduce((total, texture) => total + texture.bytes, 0)
  const sourceEnemyTextures = await treePreflight(path.join(sourceRoot, 'enemies/textures'))
  if (
    sourceEnemyTextures.files !== enemyTextureArchiveClosure.globalUniqueTextureAuthorities + bundledEnemyTextures.length
    || sourceEnemyTextures.bytes !== enemyTextureArchiveClosure.sharedTextureAuthorityBytes + bundledTextureBytes
  ) {
    throw new Error('Shared enemy texture source closure changed after archive generation')
  }
  const removedStaticEnemyTextures = await removeOutputTree('enemies/textures')
  // Vite or an earlier copy may already have emitted the redundant files.
  let removedActionRuntimeFiles = 0
  let removedActionRuntimeBytes = 0
  for (const { authority } of actionRuntimeCarriers) {
    const redundantFile = path.join(outputRoot, authority)
    try {
      const metadata = await stat(redundantFile)
      if (!metadata.isFile()) throw new Error(`Action authority output is not a file: ${authority}`)
      await rm(redundantFile)
      removedActionRuntimeFiles++
      removedActionRuntimeBytes += metadata.size
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  await copyTree(sourceRoot)
  for (const closure of requiredDirectoryClosures) {
    await copyTree(path.join(repoRoot, closure.source), closure.output, false)
  }
  for (const closure of requiredFileClosures) {
    await copyFile(path.join(repoRoot, closure.source), path.join(outputRoot, closure.output))
  }
  derivedTextureOutputs.clear()
  for (const texture of bundledEnemyTextures) {
    await copyFile(texture.source, path.join(outputRoot, texture.output))
    const actual = createHash('sha256').update(await readFile(path.join(outputRoot, texture.output))).digest('hex')
    if (actual !== texture.sha256) throw new Error(`Bundled texture copy changed: ${texture.output}`)
    derivedTextureOutputs.add(texture.output)
  }

  // Only advertise these routes after the complete directory copies succeeded.
  await writeFile(path.join(outputRoot, 'catalogs/runtime-product-delivery.v1.json'),
    `${JSON.stringify(withBundledStageRoots(deliveryCatalog), null, 2)}\n`, 'utf8')

  const combatJumpRelative = 'character-actions/combat-jump/manifest.v1.json'
  const combatJumpSource = path.join(sourceRoot, combatJumpRelative)
  const combatJumpOutput = path.join(outputRoot, combatJumpRelative)
  const sourceManifest = await readFile(combatJumpSource)
  if (sourceManifest.length !== combatJumpSourceBytes) {
    throw new Error(
      `Combat-jump source manifest size changed: ${sourceManifest.length}B ` +
      `(expected ${combatJumpSourceBytes}B)`,
    )
  }
  const minifiedManifest = minifyJsonWhitespaceOutsideStrings(sourceManifest)
  if (minifiedManifest.length !== combatJumpOutputBytes) {
    throw new Error(
      `Combat-jump minified manifest size changed: ${minifiedManifest.length}B ` +
      `(expected ${combatJumpOutputBytes}B)`,
    )
  }
  JSON.parse(minifiedManifest.toString('utf8'))
  await writeFile(combatJumpOutput, minifiedManifest)
  copiedBytes += minifiedManifest.length - sourceManifest.length
  if (!sourceManifest.equals(await readFile(combatJumpSource))) {
    throw new Error('Combat-jump source manifest changed during deployment copy')
  }

  const removedSourceMaps = await removeOutputSourceMaps()

  for (const relative of requiredOutputFiles) await requireFile(relative)
  for (const { authority, browserCarrier, bytes } of actionRuntimeCarriers) {
    if ((await stat(path.join(outputRoot, browserCarrier))).size !== bytes
      || !(await readFile(path.join(outputRoot, browserCarrier))).equals(await readFile(path.join(sourceRoot, authority)))) {
      throw new Error(`Deployment action runtime carrier changed: ${browserCarrier}`)
    }
  }
  await assertExcludedRootBoundaries()
  const summaryPath = path.join(outputRoot, 'deployment-public-summary.json')
  let existingSummary = { exists: false, bytes: 0 }
  try {
    const metadata = await stat(summaryPath)
    if (!metadata.isFile()) throw new Error('Deployment summary path is not a file')
    existingSummary = { exists: true, bytes: metadata.size }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const deployment = await deploymentFilePreflight()
  const baseResult = {
    schema: 'magius.deployment-public-copy.v2',
    deploymentTarget: cloudflareTarget ? 'cloudflare' : 'github-pages-compatible',
    sourceRoot,
    outputRoot,
    excludedRoots,
    requiredDirectoryClosures,
    requiredFileClosures,
    requiredOutputFiles,
    bundledEnemyTextureClosure: {
      modelNames: bundledEnemyModelNames,
      textures: bundledEnemyTextures.length,
      bytes: bundledEnemyTextures.reduce((total, texture) => total + texture.bytes, 0),
      sourceBytesUnchanged: true,
      historicalRemoteArchiveCount: enemyTextureArchiveClosure.modelProducts,
    },
    combatJumpManifest: {
      sourceBytes: sourceManifest.length,
      outputBytes: minifiedManifest.length,
      transform: 'remove-sp-tab-lf-cr-outside-json-strings',
      sourceUnchanged: true,
    },
    copiedFiles,
    copiedBytes,
    deploymentFiles: deployment.files,
    deploymentFilesIncludingSummary: deployment.files + (existingSummary.exists ? 0 : 1),
    deploymentBytesBeforeSummary: deployment.bytes,
    existingSummaryBytesBeforeWrite: existingSummary.bytes,
    largestFileBeforeSummary: deployment.largestFile,
    cloudflareMaxFileBytes,
    cloudflareMaxFilePreflight: true,
    enemyTextureArchiveClosure,
    deploymentExclusions: {
      duplicateActionRuntimeAuthorities: {
        sourceFilesSkipped: skippedActionRuntimeFiles,
        sourceBytesSkipped: skippedActionRuntimeBytes,
        outputFilesRemoved: removedActionRuntimeFiles,
        outputBytesRemoved: removedActionRuntimeBytes,
        retainedBrowserCarriers: actionRuntimeCarriers.length,
        manifestAuthorityUrlsUnchanged: true,
        transform: 'browserSafeActionRuntimeUrl;byte-identical-gzip-neutral-carrier',
      },
      staticEnemyTextures: {
        sourceFiles: sourceEnemyTextures.files,
        sourceBytes: sourceEnemyTextures.bytes,
        outputFilesRemoved: removedStaticEnemyTextures.files,
        outputBytesRemoved: removedStaticEnemyTextures.bytes,
      },
      sourceMaps: {
        sourceFilesSkipped: skippedSourceMapFiles,
        sourceBytesSkipped: skippedSourceMapBytes,
        outputFilesRemoved: removedSourceMaps.files,
        outputBytesRemoved: removedSourceMaps.bytes,
      },
    },
  }
  const { result, summary } = finalizeDeploymentSummary(
    baseResult,
    deployment.bytes,
    existingSummary.bytes,
  )
  if (result.deploymentSummaryBytes > cloudflareMaxFileBytes) {
    throw new Error(
      `Cloudflare max-file preflight failed: deployment-public-summary.json is ` +
      `${result.deploymentSummaryBytes}B (limit ${cloudflareMaxFileBytes}B)`,
    )
  }
  await writeFile(summaryPath, summary, 'utf8')
  if (!cloudflareTarget && !result.underGitHubPagesOneGiB) {
    throw new Error(
      `Final deployment payload exceeds 1 GiB: ${result.deploymentBytesIncludingSummary}B ` +
      `(limit ${githubPagesOneGiBBytes}B; ` +
      `required reduction ${result.githubPagesRequiredReductionBytes}B)`,
    )
  }
  if (!cloudflareTarget && !result.underGitHubPagesPublishedSiteLimit) {
    throw new Error(
      `Final deployment payload exceeds 1,000,000,000B: ` +
      `${result.deploymentBytesIncludingSummary}B ` +
      `(required reduction ${result.githubPagesPublishedSiteRequiredReductionBytes}B)`,
    )
  }
  if (!result.underGitHubPagesFileLimit) {
    throw new Error(
      `Final deployment payload exceeds ${githubPagesFileLimit} files: ` +
      `${result.deploymentFilesIncludingSummary}`,
    )
  }
  console.log(JSON.stringify(result))
  return result
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await runDeploymentPublicCopy()
}
