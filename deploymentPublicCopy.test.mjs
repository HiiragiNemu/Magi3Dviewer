import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test, { before } from 'node:test'

import {
  assertEnemyTextureArchiveClosure,
  enemyModelReleaseTag,
  finalizeDeploymentSummary,
  githubPagesFileLimit,
  githubPagesOneGiBBytes,
  githubPagesPublishedSiteLimitBytes,
  minifyJsonWhitespaceOutsideStrings,
  requiredDirectoryClosures,
  requiredFileClosures,
} from './scripts/copy-deployment-public.mjs'

const repoRoot = path.dirname(fileURLToPath(import.meta.url))
const artifactRoot = path.join(
  repoRoot,
  'artifacts',
  'verification',
  '20260905-s6-enemy-texture-archive-localization',
)
const outputRoot = path.resolve(
  process.env.MAGIUS_DEPLOY_TEST_OUTPUT || path.join(artifactRoot, 'isolated-output'),
)
if (!outputRoot.startsWith(`${artifactRoot}${path.sep}`)) {
  throw new Error(`Test output must remain inside ${artifactRoot}: ${outputRoot}`)
}

let scriptStdout = ''
const preExistingOutputRelative = 'assets/pre-existing-build-output.fixture'
const preExistingOutputBytes = 4096
const preExistingSourceMapRelative = 'assets/pre-existing-build-output.js.map'
const preExistingSourceMapBytes = 3072
async function runCopyScript() {
  await rm(outputRoot, { recursive: true, force: true })
  const preExistingOutput = path.join(outputRoot, preExistingOutputRelative)
  await mkdir(path.dirname(preExistingOutput), { recursive: true })
  await writeFile(preExistingOutput, Buffer.alloc(preExistingOutputBytes, 0x5a))
  await writeFile(
    path.join(outputRoot, preExistingSourceMapRelative),
    Buffer.alloc(preExistingSourceMapBytes, 0x4d),
  )
  scriptStdout = ''
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/copy-deployment-public.mjs'], {
      cwd: repoRoot,
      env: { ...process.env, MAGIUS_DEPLOY_OUT_DIR: outputRoot },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { scriptStdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('exit', code => code === 0
      ? resolve()
      : reject(new Error(`copy-deployment-public exited ${code}: ${stderr}`)))
  })
}

async function listFiles(directory, relative = '') {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const childRelative = path.join(relative, entry.name).replaceAll('\\', '/')
    const child = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(child, childRelative))
    else if (entry.isFile()) files.push(childRelative)
  }
  return files.sort()
}

async function assertFileBytesEqual(left, right) {
  assert.equal((await readFile(left)).equals(await readFile(right)), true, `${left} != ${right}`)
}

before(async () => {
  await runCopyScript()
})

test('lexical JSON minifier removes only whitespace outside strings', async () => {
  const fixture = Buffer.from('{ \n "inside": "a b\\t c", \r\n "value" : 1 }\n')
  assert.equal(
    minifyJsonWhitespaceOutsideStrings(fixture).toString('utf8'),
    '{"inside":"a b\\t c","value":1}',
  )
  const source = await readFile(path.join(
    repoRoot,
    'public/character-actions/combat-jump/manifest.v1.json',
  ))
  const minified = minifyJsonWhitespaceOutsideStrings(source)
  assert.equal(source.length, 36_855_023)
  assert.equal(minified.length, 24_728_038)
  assert.doesNotThrow(() => JSON.parse(minified.toString('utf8')))
})

test('copy script reports the exact allowlisted closure and preflight', async () => {
  const summary = JSON.parse(await readFile(
    path.join(outputRoot, 'deployment-public-summary.json'),
    'utf8',
  ))
  assert.equal(summary.schema, 'magius.deployment-public-copy.v2')
  assert.equal(summary.outputRoot, outputRoot)
  assert.deepEqual(summary.requiredDirectoryClosures, requiredDirectoryClosures)
  assert.deepEqual(summary.requiredFileClosures, requiredFileClosures)
  assert.equal(summary.combatJumpManifest.sourceBytes, 36_855_023)
  assert.equal(summary.combatJumpManifest.outputBytes, 24_728_038)
  assert.equal(summary.combatJumpManifest.sourceUnchanged, true)
  assert.equal(summary.cloudflareMaxFileBytes, 25 * 1024 ** 2)
  assert.equal(summary.cloudflareMaxFilePreflight, true)
  assert.equal(summary.githubPagesOneGiBLimitBytes, githubPagesOneGiBBytes)
  assert.equal(summary.githubPagesPublishedSiteLimitBytes, githubPagesPublishedSiteLimitBytes)
  assert.equal(summary.githubPagesFileLimit, githubPagesFileLimit)
  assert.equal(summary.existingSummaryBytesBeforeWrite, 0)
  // The catalog is rewritten with the exact bundled-stage roots after the
  // source tree copy, so copied source bytes and final output bytes can differ.
  // The authoritative invariant is the converged output accounting below.
  assert.ok(summary.deploymentBytesBeforeSummary >= preExistingOutputBytes)
  assert.equal(summary.deploymentSummaryBytes, (await stat(
    path.join(outputRoot, 'deployment-public-summary.json'),
  )).size)
  assert.equal(
    summary.deploymentBytesIncludingSummary,
    summary.deploymentBytesBeforeSummary + summary.deploymentSummaryBytes,
  )
  assert.equal(
    summary.underGitHubPagesOneGiB,
    summary.deploymentBytesIncludingSummary < githubPagesOneGiBBytes,
  )
  assert.equal(summary.githubPagesBytesOverOneGiB, 0)
  assert.equal(summary.githubPagesRequiredReductionBytes, 0)
  assert.equal(summary.githubPagesPublishedSiteBytesOverLimit, 0)
  assert.equal(summary.githubPagesPublishedSiteRequiredReductionBytes, 0)
  assert.equal(summary.underGitHubPagesPublishedSiteLimit, true)
  assert.equal(summary.underGitHubPagesFileLimit, true)
  assert.equal(summary.enemyTextureArchiveClosure.modelProducts, 493)
  assert.equal(summary.enemyTextureArchiveClosure.releaseTag, enemyModelReleaseTag)
  assert.deepEqual(summary.deploymentExclusions.staticEnemyTextures, {
    sourceFiles: 1_969,
    sourceBytes: 564_810_901,
    outputFilesRemoved: 0,
    outputBytesRemoved: 0,
  })
  assert.equal(summary.deploymentExclusions.sourceMaps.outputFilesRemoved, 1)
  assert.equal(
    summary.deploymentExclusions.sourceMaps.outputBytesRemoved,
    preExistingSourceMapBytes,
  )
  await assert.rejects(
    stat(path.join(outputRoot, preExistingSourceMapRelative)),
    error => error?.code === 'ENOENT',
  )
  assert.equal(JSON.parse(scriptStdout.trim()).schema, summary.schema)
})

test('final one-GiB gate counts pre-existing output instead of copied public bytes alone', () => {
  const copiedBytes = githubPagesOneGiBBytes - 64
  const preExistingBytes = 128
  const { result, summary } = finalizeDeploymentSummary(
    { schema: 'fixture', copiedBytes, deploymentFilesIncludingSummary: 1 },
    copiedBytes + preExistingBytes,
  )
  assert.equal(copiedBytes < githubPagesOneGiBBytes, true)
  assert.equal(result.deploymentSummaryBytes, Buffer.byteLength(summary, 'utf8'))
  assert.equal(
    result.deploymentBytesIncludingSummary,
    copiedBytes + preExistingBytes + result.deploymentSummaryBytes,
  )
  assert.equal(result.underGitHubPagesOneGiB, false)
  assert.equal(
    result.githubPagesBytesOverOneGiB,
    result.deploymentBytesIncludingSummary - githubPagesOneGiBBytes,
  )
  assert.equal(
    result.githubPagesRequiredReductionBytes,
    result.githubPagesBytesOverOneGiB + 1,
  )
})

test('enemy texture exclusion requires the exact 493-model archive closure', async () => {
  const catalog = JSON.parse(await readFile(
    path.join(repoRoot, 'public/catalogs/runtime-product-delivery.v1.json'),
    'utf8',
  ))
  assert.equal(assertEnemyTextureArchiveClosure(catalog).files, 6_817)
  const missing = structuredClone(catalog)
  delete missing.enemyTextureArchive
  assert.throws(
    () => assertEnemyTextureArchiveClosure(missing),
    /closure mismatch: status/,
  )
  const wrongTag = structuredClone(catalog)
  wrongTag.entries.find(entry => entry.kind === 'enemy-model').releaseTag = 'runtime-products-v1-a'
  assert.throws(
    () => assertEnemyTextureArchiveClosure(wrongTag),
    /catalog identity mismatch/,
  )
})

test('each released stage and enemy closure is copied byte-exact with no expansion', async () => {
  for (const closure of requiredDirectoryClosures) {
    const source = path.join(repoRoot, closure.source)
    const output = path.join(outputRoot, closure.output)
    const sourceFiles = await listFiles(source)
    assert.deepEqual(await listFiles(output), sourceFiles, closure.output)
    for (const relative of sourceFiles) {
      await assertFileBytesEqual(path.join(source, relative), path.join(output, relative))
    }
  }
})

test('the two required voice manifests are copied byte-exact', async () => {
  for (const closure of requiredFileClosures) {
    await assertFileBytesEqual(
      path.join(repoRoot, closure.source),
      path.join(outputRoot, closure.output),
    )
  }
})

test('combat-jump is transformed in output only and source remains unchanged', async () => {
  const sourcePath = path.join(repoRoot, 'public/character-actions/combat-jump/manifest.v1.json')
  const outputPath = path.join(outputRoot, 'character-actions/combat-jump/manifest.v1.json')
  const source = await readFile(sourcePath)
  const output = await readFile(outputPath)
  assert.equal(source.length, 36_855_023)
  assert.equal(output.length, 24_728_038)
  assert.equal(output.equals(minifyJsonWhitespaceOutsideStrings(source)), true)
  assert.equal((await stat(sourcePath)).size, 36_855_023)
})

test('heavy roots contain only the exact released closure', async () => {
  const expectedStageRoots = requiredDirectoryClosures
    .map(({ output }) => output)
    .filter(output => output.startsWith('stages/official/'))
    .map(output => output.split('/').at(-1))
    .sort()
  assert.deepEqual(
    (await readdir(path.join(outputRoot, 'stages/official'))).sort(),
    expectedStageRoots,
  )
  assert.deepEqual(
    await readdir(path.join(outputRoot, 'enemies/models')),
    ['enemy_654001_battle_unit'],
  )
  await assert.rejects(
    stat(path.join(outputRoot, 'enemies/textures')),
    error => error?.code === 'ENOENT',
  )
  for (const relative of ['vfx/enemy', 'vfx/character']) {
    await assert.rejects(stat(path.join(outputRoot, relative)), error => error?.code === 'ENOENT')
  }
})

test('every emitted deployment file satisfies the Cloudflare 25 MiB limit', async () => {
  let largest = { relative: '', bytes: 0 }
  for (const relative of await listFiles(outputRoot)) {
    const bytes = (await stat(path.join(outputRoot, relative))).size
    assert.ok(bytes <= 25 * 1024 ** 2, `${relative} is ${bytes}B`)
    if (bytes > largest.bytes) largest = { relative, bytes }
  }
  assert.deepEqual(largest, {
    relative: 'character-actions/combat-jump/manifest.v1.json',
    bytes: 24_728_038,
  })
  const files = await listFiles(outputRoot)
  assert.ok(files.length <= githubPagesFileLimit)
  assert.ok(files.every(relative => !relative.toLowerCase().endsWith('.map')))
})
