import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import test, { before } from 'node:test'
import { collectActionRuntimeCarriers, minifyJsonWhitespaceOutsideStrings } from './scripts/copy-deployment-public.mjs'
import { browserSafeActionRuntimeUrl } from './src/viewer/characterActions/runtimeTransport.ts'

const root = path.dirname(fileURLToPath(import.meta.url))
const output = path.resolve(process.env.MAGIUS_ACTION_DEPLOY_TEST_ROOT || path.join(root, '.action-carrier-deployment-test', 'output'))
const source = path.join(root, 'public')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const readJson = async file => JSON.parse(await readFile(file, 'utf8'))

before(async () => {
  if (process.env.MAGIUS_ACTION_DEPLOY_TEST_ROOT) return
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/copy-deployment-public.mjs')], {
    cwd: root,
    env: { ...process.env, MAGIUS_DEPLOY_OUT_DIR: output },
    encoding: 'utf8',
    windowsHide: true,
  })
  assert.equal(result.status, 0, `isolated deployment copy failed: ${result.stderr}`)
})

async function fixture() {
  const base = path.join(root, 'evidence', 'carrier-fixtures')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(path.join(base, 'case-'))
  const url = '/character-actions/native-dungeon/100201/runtime.v1.json.gz'
  const native = { schema: 'magius.character-action-resource-manifest.v1', entries: [{ runtime: { url } }] }
  const combat = { schema: 'magius.all-character-combat-jump-resource-manifest.v1', characters: [], entries: [] }
  const files = new Map([
    ['character-actions/manifest.v1.json', JSON.stringify(native)],
    ['character-actions/combat-jump/manifest.v1.json', JSON.stringify(combat)],
    [url.slice(1), gzipSync('{"schema":"fixture"}')],
    [browserSafeActionRuntimeUrl(url).slice(1), gzipSync('{"schema":"fixture"}')],
  ])
  for (const [relative, bytes] of files) {
    await mkdir(path.dirname(path.join(directory, relative)), { recursive: true })
    await writeFile(path.join(directory, relative), bytes)
  }
  return { directory, url, native, combat }
}

test('only byte-identical manifest-declared gzip authorities are eligible for deployment dedup', async () => {
  const item = await fixture()
  const rows = await collectActionRuntimeCarriers(item.directory)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].browserCarrier, browserSafeActionRuntimeUrl(item.url).slice(1))
  await writeFile(path.join(item.directory, rows[0].browserCarrier), gzipSync('{"different":true}'))
  await assert.rejects(collectActionRuntimeCarriers(item.directory), /differs from gzip authority/)
  assert.ok((await stat(path.join(item.directory, rows[0].authority))).size > 0)
})

test('dedup rejects missing carriers and undeclared consumer runtime URLs before mutation', async () => {
  const item = await fixture()
  item.native.entries.push({ runtime: { url: '/character-actions/native-dungeon/999999/runtime.v1.json.gz' } })
  await writeFile(path.join(item.directory, 'character-actions/manifest.v1.json'), JSON.stringify(item.native))
  await assert.rejects(collectActionRuntimeCarriers(item.directory), error => error.code === 'ENOENT')
  item.native.entries.pop()
  item.combat.entries.push({ resource: { runtimeUrl: '/character-actions/combat-jump/runtime/999999/runtime.v1.json.gz' } })
  await writeFile(path.join(item.directory, 'character-actions/manifest.v1.json'), JSON.stringify(item.native))
  await writeFile(path.join(item.directory, 'character-actions/combat-jump/manifest.v1.json'), JSON.stringify(item.combat))
  await assert.rejects(collectActionRuntimeCarriers(item.directory), /lacks a declared carrier/)
})

test('dedup rejects changed manifest schemas and non-action paths', async () => {
  const item = await fixture()
  item.native.schema = 'different'
  await writeFile(path.join(item.directory, 'character-actions/manifest.v1.json'), JSON.stringify(item.native))
  await assert.rejects(collectActionRuntimeCarriers(item.directory), /manifest contract changed/)
  item.native.schema = 'magius.character-action-resource-manifest.v1'
  item.native.entries[0].runtime.url = '/character-actions/../other/runtime.v1.json.gz'
  await writeFile(path.join(item.directory, 'character-actions/manifest.v1.json'), JSON.stringify(item.native))
  await assert.rejects(collectActionRuntimeCarriers(item.directory), /Unexpected action runtime authority path/)
})

test('all 98 deployed carriers retain source bytes and manifest authority semantics without duplicate gzip files', async () => {
  const rows = await collectActionRuntimeCarriers(source)
  assert.equal(rows.length, 98)
  assert.equal(rows.reduce((sum, row) => sum + row.bytes, 0), 99_365_185)
  for (const row of rows) {
    const before = await readFile(path.join(source, row.authority))
    assert.equal((await readFile(path.join(output, row.browserCarrier))).equals(before), true, row.browserCarrier)
    await assert.rejects(stat(path.join(output, row.authority)), error => error.code === 'ENOENT')
    assert.equal((await readFile(path.join(source, row.authority))).equals(before), true)
  }
  const native = 'character-actions/manifest.v1.json'
  const combat = 'character-actions/combat-jump/manifest.v1.json'
  assert.equal((await readFile(path.join(source, native))).equals(await readFile(path.join(output, native))), true)
  assert.equal(minifyJsonWhitespaceOutsideStrings(await readFile(path.join(source, combat)))
    .equals(await readFile(path.join(output, combat))), true)
})

test('production native and combat loaders parse every deployed runtime through neutral carrier URLs', async () => {
  const native = await readJson(path.join(output, 'character-actions/manifest.v1.json'))
  const combat = await readJson(path.join(output, 'character-actions/combat-jump/manifest.v1.json'))
  const nativeEntries = [...new Map(native.entries.map(entry => [entry.runtime.url, entry])).values()]
  const combatEntries = [...new Map(combat.entries.filter(entry => entry.availability.status === 'source-available'
    && typeof entry.resource.runtimeUrl === 'string').map(entry => [entry.resource.runtimeUrl, entry])).values()]
  assert.equal(nativeEntries.length, 9)
  assert.equal(combatEntries.length, 89)
  const previousFetch = globalThis.fetch
  const previousDocument = globalThis.document
  const requests = []
  const parsed = []
  globalThis.document = { baseURI: 'http://action-deployment.local/' }
  globalThis.fetch = async input => {
    const url = new URL(typeof input === 'string' ? input : input.url, globalThis.document.baseURI)
    assert.match(url.pathname, /\/runtime\.v1\.magius-runtime$/)
    requests.push(url.pathname)
    const bytes = await readFile(path.join(output, url.pathname.slice(1)))
    return new Response(bytes, { headers: { 'content-length': String(bytes.length), 'content-type': 'application/octet-stream' } })
  }
  try {
    const { fetchNativeDungeonRuntime } = await import('./src/viewer/characterActions/loader.ts')
    const { fetchCombatJumpRuntime } = await import('./src/viewer/characterActions/combatLoader.ts')
    for (const entry of nativeEntries) {
      const runtime = await fetchNativeDungeonRuntime(entry)
      parsed.push({ authority: entry.runtime.url, family: 'native', id: runtime.dungeonCharacterId, clips: runtime.clips.length })
    }
    for (const entry of combatEntries) {
      const runtime = await fetchCombatJumpRuntime(entry)
      parsed.push({ authority: entry.resource.runtimeUrl, family: 'combat', id: runtime.characterId, clips: runtime.clips.length })
    }
    assert.equal(new Set(requests).size, 98)
    assert.equal(parsed.length, 98)
    assert.ok(parsed.every(row => row.clips > 0))
  } finally {
    globalThis.fetch = previousFetch
    globalThis.document = previousDocument
  }
  const evidence = {
    schema: 's6.action-carrier-deployment-parse.v1',
    outputRoot: output,
    passed: parsed.length,
    native: nativeEntries.length,
    combat: combatEntries.length,
    sourceManifestSha256: {
      native: digest(await readFile(path.join(source, 'character-actions/manifest.v1.json'))),
      combat: digest(await readFile(path.join(source, 'character-actions/combat-jump/manifest.v1.json'))),
    },
    requests,
    parsed,
  }
  await writeFile(path.join(root, 'evidence', 'all-runtime-parse.v1.json'), `${JSON.stringify(evidence, null, 2)}\n`)
})
