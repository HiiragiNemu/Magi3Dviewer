import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { prepareGitHubPages, compactJsonTokens, assertSourceJsonTransport } from './scripts/prepare-github-pages.mjs'

const revision = 'a'.repeat(40)
const base = 'https://1234abcd.magius3dviewer.pages.dev/'
async function fixture(t, changeResponse = response => response) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'magius-pages-'))
  t.after(() => fs.rm(temp, { recursive: true, force: true }))
  const output = path.join(temp, 'dist-deploy')
  const root = '/stages/official/test-stage/'
  const content = new Map([
    ['site-version.json', JSON.stringify({ revision })],
    ['index.html', '<h1>Current viewer</h1>'],
    ['assets/client.js', 'export const current=true;'],
    ['stages/official/test-stage/profile.json', '{"current":true}'],
    ['stages/official/test-stage/texture.png', 'current-unmodified-texture-bytes'],
    ['deployment-public-summary.json', '{"full":true}'],
    ['catalogs/runtime-product-delivery.v1.json', JSON.stringify({ schema: 'magius.runtime-product-delivery.v1', bundledStageRoots: [root],
      entries: [{ kind: 'stage', rootPath: root, releaseTag: 'historical-pack-not-used' }] })],
  ])
  for (const [relative, text] of content) {
    await fs.mkdir(path.dirname(path.join(output, relative)), { recursive: true })
    await fs.writeFile(path.join(output, relative), text)
  }
  const requests = []
  const fetchResource = async url => {
    assert.ok(url.startsWith(base)); requests.push(url)
    const relative = decodeURIComponent(url.slice(base.length))
    const text = content.get(relative)
    return changeResponse(new Response(text ?? '', { status: text === undefined ? 404 : 200,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/octet-stream' } }), relative)
  }
  return { output, content, requests,
    run: overrides => prepareGitHubPages({ output, base, expectedRevision: revision, fetchResource,
      evidenceDirectory: path.join(temp, 'evidence'), ...overrides }),
    read: relative => fs.readFile(path.join(output, relative), 'utf8'),
    exists: async relative => !!(await fs.stat(path.join(output, relative)).catch(() => null)),
  }
}

test('delegates only byte-verified current scenes; preserves the viewer and historical catalog identities', async t => {
  const f = await fixture(t)
  const summary = await f.run()
  assert.equal(await f.exists('stages/official'), false)
  assert.equal(await f.read('assets/client.js'), f.content.get('assets/client.js'))
  assert.equal(await f.read('index.html'), f.content.get('index.html'))
  const catalog = JSON.parse(await f.read('catalogs/runtime-product-delivery.v1.json'))
  assert.equal(catalog.bundledStageBaseUrl, base)
  assert.equal(catalog.entries[0].releaseTag, 'historical-pack-not-used')
  assert.equal(summary.delegatedStageDelivery.files, 2)
  assert.equal(f.requests.length, 3, 'version and every scene file were requested')
  let total = 0
  async function walk(dir) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) await walk(p); else total += (await fs.stat(p)).size
    }
  }
  await walk(f.output)
  assert.equal(summary.deploymentBytesIncludingSummary, total, 'summary includes its own exact UTF-8 size')
})

test('stale source revision cannot remove any local stage files', async t => {
  const f = await fixture(t, (response, relative) => relative === 'site-version.json'
    ? new Response(JSON.stringify({ revision: 'b'.repeat(40) })) : response)
  await assert.rejects(f.run(), /stale or mismatched/)
  assert.equal(await f.exists('stages/official/test-stage/texture.png'), true)
  assert.equal(await f.read('catalogs/runtime-product-delivery.v1.json'), f.content.get('catalogs/runtime-product-delivery.v1.json'))
})

for (const fault of ['missing', 'changed', 'cors']) test('invalid remote ' + fault + ' resource never removes current stages', async t => {
  const f = await fixture(t, (response, relative) => {
    if (!relative.endsWith('texture.png')) return response
    if (fault === 'missing') return new Response('', { status: 404 })
    if (fault === 'changed') return new Response('different bytes', { headers: { 'access-control-allow-origin': '*' } })
    return new Response('current-unmodified-texture-bytes')
  })
  await assert.rejects(f.run())
  assert.equal(await f.exists('stages/official/test-stage/texture.png'), true)
  assert.equal(await f.read('catalogs/runtime-product-delivery.v1.json'), f.content.get('catalogs/runtime-product-delivery.v1.json'))
})

test('mutable aliases and source directory names are rejected before remote access', async t => {
  const f = await fixture(t)
  await assert.rejects(f.run({ base: 'https://magius3dviewer.pages.dev/' }), /immutable/)
  await assert.rejects(f.run({ output: path.join(path.dirname(f.output), 'public') }), /disposable/)
  assert.equal(f.requests.length, 0)
})

const tokenSource = String.raw`{
  "float": 0.0, "negativeZero": -0.0, "exponent": 1e-05,
  "integer": 9007199254740993, "escaped": "\u0061",
  "10": 10, "2": 2, "duplicate": 1, "duplicate": 2,
  "text": "with spaces and \"quotes\" and \\slashes"
}`
const tokenCompact = String.raw`{"float":0.0,"negativeZero":-0.0,"exponent":1e-05,"integer":9007199254740993,"escaped":"\u0061","10":10,"2":2,"duplicate":1,"duplicate":2,"text":"with spaces and \"quotes\" and \\slashes"}`
test('byte transport preserves numeric tokens, escapes, key order and duplicate keys', () => {
  assert.equal(compactJsonTokens(Buffer.from(tokenSource)).toString(), tokenCompact)
  assert.notEqual(JSON.stringify(JSON.parse(tokenSource)), tokenCompact, 'reproduces the previous false rejection')
  assert.doesNotThrow(() => assertSourceJsonTransport(Buffer.from(tokenSource), Buffer.from(tokenCompact), 'fixture'))
})
for (const [label, changed] of [
  ['float', tokenCompact.replace('0.0', '0.1')],
  ['negative zero', tokenCompact.replace('-0.0', '0.0')],
  ['large integer', tokenCompact.replace('9007199254740993', '9007199254740992')],
  ['string space', tokenCompact.replace('with spaces', 'withspaces')],
  ['escape', tokenCompact.replace('\\u0061', 'a')],
  ['duplicate key', tokenCompact.replace('"duplicate":1,', '')],
  ['reordered keys', tokenCompact.replace('"10":10,"2":2', '"2":2,"10":10')],
]) test('rejects token changes: ' + label, () => {
  assert.throws(() => assertSourceJsonTransport(Buffer.from(tokenSource), Buffer.from(changed), 'fixture'), /tokens differ/)
})
test('invalid JSON remains rejected', () => {
  assert.throws(() => assertSourceJsonTransport(Buffer.from('{"bad":NaN}'), Buffer.from('{"bad":NaN}'), 'fixture'))
})
