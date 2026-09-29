import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const immutableCloudflareBase = /^https:\/\/[a-f0-9]{8}\.magius3dviewer\.pages\.dev\/$/
const immutableSourceBase = /^https:\/\/raw\.githubusercontent\.com\/HiiragiNemu\/Magi3Dviewer\/[a-f0-9]{40}\/public\/$/
const stageRootPattern = /^\/stages\/official\/[A-Za-z0-9_-]+\/$/

/** Remove JSON whitespace outside strings without normalizing any token.
 * JSON.parse/stringify is NOT equivalent: it rewrites float literals, negative
 * zero, large integers, escapes and duplicate/integer-key object properties. */
export function compactJsonTokens(source) {
  const output = Buffer.allocUnsafe(source.length)
  let offset = 0, inString = false, escaped = false
  for (const byte of source) {
    if (inString) {
      output[offset++] = byte
      if (escaped) escaped = false
      else if (byte === 0x5c) escaped = true
      else if (byte === 0x22) inString = false
    } else if (byte === 0x22) {
      inString = true
      output[offset++] = byte
    } else if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
      output[offset++] = byte
    }
  }
  if (inString) throw new Error('Unterminated JSON string')
  return output.subarray(0, offset)
}

export function assertSourceJsonTransport(source, staged, name) {
  // Parse only to validate syntax, never to produce the comparison bytes.
  JSON.parse(source.toString('utf8'))
  JSON.parse(staged.toString('utf8'))
  const originalTokens = compactJsonTokens(source)
  const stagedTokens = compactJsonTokens(staged)
  if (!originalTokens.equals(stagedTokens)) {
    const hash = bytes => createHash('sha256').update(bytes).digest('hex')
    throw new Error(`Source JSON tokens differ from current carrier: ${name}; source=${hash(originalTokens)} staged=${hash(stagedTokens)}`)
  }
}

async function inventory(directory, prefix = '') {
  const files = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name
    if (entry.isDirectory()) files.push(...await inventory(path.join(directory, entry.name), relative + '/'))
    else {
      assert.ok(entry.isFile(), 'Deployment must not contain symlinks or special files: ' + relative)
      files.push({ path: relative, bytes: (await fs.stat(path.join(directory, entry.name))).size })
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

async function digest(stream) {
  const hash = createHash('sha256'); let bytes = 0
  for await (const chunk of stream) { bytes += chunk.length; hash.update(chunk) }
  return { bytes, sha256: hash.digest('hex') }
}

export async function prepareGitHubPages({ output, base, expectedRevision, evidenceDirectory, fetchResource = fetch }) {
  output = path.resolve(output)
  assert.match(path.basename(output), /^dist-/, 'Only a disposable dist-* build artifact may be repackaged')
  const sourceRoute = typeof base === 'string' && immutableSourceBase.test(base)
  assert.ok(typeof base === 'string' && (immutableCloudflareBase.test(base) || sourceRoute), 'An immutable deployment or source-commit URL is required; branch aliases are not safe')
  assert.match(expectedRevision, /^[a-f0-9]{40}$/, 'Expected source revision must be explicit')
  const localVersion = JSON.parse(await fs.readFile(path.join(output, 'site-version.json'), 'utf8'))
  assert.equal(localVersion.revision, expectedRevision, 'The full artifact belongs to another source revision')
  const catalogPath = path.join(output, 'catalogs/runtime-product-delivery.v1.json')
  const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'))
  assert.equal(catalog.bundledStageBaseUrl, undefined, 'Input must be the original, complete tested artifact')
  assert.ok(Array.isArray(catalog.bundledStageRoots) && catalog.bundledStageRoots.length > 0)
  for (const root of catalog.bundledStageRoots) {
    assert.match(root, stageRootPattern)
    assert.ok(catalog.entries.some(entry => entry.kind === 'stage' && entry.rootPath === root), 'Stage identity absent: ' + root)
  }
  if (sourceRoute) {
    assert.equal(base, `https://raw.githubusercontent.com/HiiragiNemu/Magi3Dviewer/${expectedRevision}/public/`, 'Refusing a stale or mismatched source commit')
  } else {
    const versionResponse = await fetchResource(new URL('site-version.json', base).href, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(90000) })
    assert.equal(versionResponse.status, 200, 'Immutable deployment must be publicly accessible')
    assert.equal((await versionResponse.json()).revision, expectedRevision, 'Refusing a stale or mismatched scene deployment')
  }

  const before = await inventory(output)
  const delegated = before.filter(file => file.path.startsWith('stages/official/'))
  assert.ok(delegated.length > 0, 'Current stage carriers must exist before repackaging')
  for (const file of delegated) assert.ok(catalog.bundledStageRoots.some(root => ('/' + file.path).startsWith(root)), 'Unadvertised stage file would be removed: ' + file.path)
  const delegatedBytes = delegated.reduce((sum, file) => sum + file.bytes, 0)
  const fullBytes = before.reduce((sum, file) => sum + file.bytes, 0)
  assert.ok(fullBytes - delegatedBytes < 995000000, 'Remaining client still exceeds the Pages budget')
  const verified = []
  let next = 0
  const verify = async file => {
    const expected = await digest(createReadStream(path.join(output, file.path)))
    const url = new URL(file.path.split('/').map(encodeURIComponent).join('/'), base).href
    let response
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetchResource(url, { redirect: 'error', signal: AbortSignal.timeout(90000) })
      if (![429, 502, 503, 504].includes(response.status) || attempt === 2) break
      await response.body?.cancel()
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
    }
    assert.equal(response.status, 200, 'Scene resource not accessible: ' + file.path)
    assert.ok(['*', 'https://hiiraginemu.github.io'].includes(response.headers.get('access-control-allow-origin')), 'Scene resource is not CORS-enabled: ' + file.path)
    let actual, equivalence = 'exact-bytes'
    if (sourceRoute && file.path.endsWith('.json')) {
      const data = Buffer.from(await response.arrayBuffer())
      actual = { bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }
      if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) {
        // copy-deployment-public.mjs compacts oversized JSON for Cloudflare's
        // 25 MiB per-file limit. Public source delivery can retain the original
        // whitespace. Permit only that exact existing transform, not altered
        // values, ordering, textures, meshes or a historical scene substitute.
        const staged = await fs.readFile(path.join(output, file.path))
        assertSourceJsonTransport(data, staged, file.path)
        equivalence = 'existing-whitespace-only-json-compaction'
      }
    } else {
      actual = await digest(response.body)
      assert.deepEqual(actual, expected, 'Scene resource differs from the tested current artifact: ' + file.path)
    }
    verified.push({ ...file, sha256: expected.sha256, sourceBytes: actual.bytes, sourceSha256: actual.sha256, equivalence })
    if (verified.length % 40 === 0 || verified.length === delegated.length) console.log(`Verified current scene bytes: ${verified.length}/${delegated.length}`)
  }
  const writeEvidence = async result => {
    if (!evidenceDirectory) return
    await fs.mkdir(evidenceDirectory, { recursive: true })
    await fs.writeFile(path.join(evidenceDirectory, 'github-pages-scene-delivery.json'), JSON.stringify({ revision: expectedRevision, base, ...result, verified }, null, 2) + '\n')
  }
  try {
    let failure
    await Promise.all(Array.from({ length: Math.min(8, delegated.length) }, async () => {
      while (!failure && next < delegated.length) {
        const file = delegated[next++]
        try { await verify(file) } catch (error) { failure ??= error }
      }
    }))
    // Drain in-flight reads before writing evidence or allowing fixture cleanup.
    if (failure) throw failure
  } catch (error) {
    await writeEvidence({ passed: false, error: String(error), localStageFilesRemoved: false })
    throw error
  }
  verified.sort((a, b) => a.path.localeCompare(b.path))
  // Only verified copies in the disposable website artifact are removed.
  // Repository source, geometry, texture resolution, AA and shaders stay intact.
  await fs.writeFile(catalogPath, JSON.stringify({ ...catalog, bundledStageBaseUrl: base }, null, 2) + '\n')
  await fs.rm(path.join(output, 'stages/official'), { recursive: true })
  const summaryPath = path.join(output, 'deployment-public-summary.json')
  await fs.rm(summaryPath, { force: true })
  const remaining = await inventory(output)
  const remainingBytes = remaining.reduce((sum, file) => sum + file.bytes, 0)
  const summary = {
    schema: 'magius.github-pages-delivery.v1', deploymentTarget: 'github-pages', revision: expectedRevision,
    fullArtifactBytes: fullBytes, fullArtifactFiles: before.length,
    delegatedStageDelivery: { baseUrl: base, source: sourceRoute ? 'exact-public-repository-commit' : 'immutable-cloudflare-deployment',
      stageRoots: catalog.bundledStageRoots, files: verified.length, bytes: delegatedBytes,
      verification: 'Every file fetched with CORS; exact size/SHA-256, or the already-used oversized-JSON whitespace compaction only',
      inventorySha256: createHash('sha256').update(JSON.stringify(verified)).digest('hex') },
    deploymentFilesIncludingSummary: remaining.length + 1, deploymentBytesIncludingSummary: remainingBytes,
    githubPagesPublishedSiteLimitBytes: 1000000000, githubPagesFileLimit: 20000,
  }
  let text = ''
  for (let i = 0; i < 16; i++) {
    text = JSON.stringify(summary, null, 2) + '\n'
    const total = remainingBytes + Buffer.byteLength(text)
    if (total === summary.deploymentBytesIncludingSummary) break
    summary.deploymentBytesIncludingSummary = total
  }
  assert.equal(remainingBytes + Buffer.byteLength(text), summary.deploymentBytesIncludingSummary)
  assert.ok(summary.deploymentBytesIncludingSummary < 1000000000, 'Final Pages payload exceeds 1 GB')
  assert.ok(summary.deploymentFilesIncludingSummary <= 20000, 'Final Pages payload exceeds file limit')
  await fs.writeFile(summaryPath, text)
  await writeEvidence({ passed: true, summary })
  console.log(JSON.stringify(summary, null, 2))
  return summary
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareGitHubPages({ output: process.env.MAGIUS_DEPLOY_OUT_DIR || 'dist-deploy',
    base: process.env.MAGIUS_STAGE_DEPLOYMENT_URL, expectedRevision: process.env.GITHUB_SHA,
    evidenceDirectory: process.env.MAGIUS_EVIDENCE_DIR || '/tmp/site-evidence' })
}
