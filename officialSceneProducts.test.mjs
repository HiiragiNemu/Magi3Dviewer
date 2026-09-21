import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const repository = new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1')
const publicRoot = join(repository, 'public')

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

test('official scene shards close the exact 581-key authority partition', async () => {
  const inventory = await json(join(
    repository,
    'artifacts',
    'research',
    '20260825-viewer-official-resource-gap-inventory',
    'official-resource-gap-inventory.v1.json',
  ))
  const authority = inventory.sceneAudit.officialLocalUnlisted
  assert.equal(authority.length, 581)
  const root = await json(join(publicRoot, 'stages', 'catalog.json'))
  const references = root.catalogs.filter(value => /official-.+\.v1\.json$/.test(value))
  const entries = []
  for (const reference of references) {
    const shard = await json(join(publicRoot, reference.replace(/^\.\//, '')))
    assert.equal(shard.counts.visible, shard.stages.length)
    assert.equal(shard.counts.target, authority.filter(row => row.family === shard.family).length)
    assert.equal(shard.counts.fullyResolved, shard.stages.length)
    entries.push(...shard.stages)
  }
  assert.equal(entries.length, 581)
  assert.equal(new Set(entries.map(entry => entry.id)).size, 581)
  assert.equal(new Set(entries.map(entry => entry.stableKey)).size, 581)
  assert.deepEqual(
    new Set(entries.map(entry => entry.stableKey)),
    new Set(authority.map(row => row.logicalPath)),
  )
})

test('every official scene model reopens through a browser-safe Viewer URL', async () => {
  const root = await json(join(publicRoot, 'stages', 'catalog.json'))
  const references = root.catalogs.filter(value => /official-.+\.v1\.json$/.test(value))
  let reopened = 0
  for (const reference of references) {
    const shard = await json(join(publicRoot, reference.replace(/^\.\//, '')))
    for (const entry of shard.stages) {
      assert.doesNotMatch(entry.url, /\.fbx\.gz(?:$|[?#])/)
      const model = join(publicRoot, entry.url.replace(/^\.\//, ''))
      await stat(model)
      if (entry.type === 'fbx') {
        assert.match(entry.url, /\.fbxdata$/)
        assert.deepEqual((await readFile(model)).subarray(0, 2), Buffer.from([0x1f, 0x8b]))
      } else {
        assert.equal(entry.type, 'gltf')
        assert.equal((await json(model)).asset.version, '2.0')
      }
      if (entry.sceneProfileUrl) {
        const profile = await readFile(
          join(publicRoot, entry.sceneProfileUrl.replace(/^\.\//, '')),
          'utf8',
        )
        assert.doesNotMatch(profile, /[A-Za-z]:[\\/]/)
      }
      reopened++
    }
  }
  assert.equal(reopened, 581)
  const officialDirectories = await readdir(join(publicRoot, 'stages', 'official'))
  assert.ok(officialDirectories.length >= 581)
})

test('the protected battle-616 catalog entry remains registered', async () => {
  const root = await json(join(publicRoot, 'stages', 'catalog.json'))
  assert.ok(root.entries.includes('./stages/catalog/battle-616-00-01-001.json'))
  const protectedStage = await json(join(
    publicRoot,
    'stages',
    'catalog',
    'battle-616-00-01-001.json',
  ))
  assert.equal(protectedStage.id, 'battle-616-00-01-001')
  await stat(join(publicRoot, protectedStage.url.replace(/^\.\//, '')))
})
