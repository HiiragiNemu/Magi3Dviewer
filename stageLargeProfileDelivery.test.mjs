import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import test from 'node:test'
import { compactOversizedDeploymentJson, minifyJsonWhitespaceOutsideStrings } from './scripts/copy-deployment-public.mjs'

test('oversized deployment JSON retains exact number tokens, strings and nested arrays', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-json-transport-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const source = Buffer.from('{'+ ' '.repeat(300) + '"id":9007199254740993123, "name":"Smoke ", "escaped":"a\\\" b", "values":[-0,1.234567890123456789,1e-100]}')
  const target = path.join(dir, 'profile.json'); await fs.writeFile(target, source)
  const small = Buffer.from('{ "retained" : " unchanged " }'); await fs.writeFile(path.join(dir, 'small.json'), small)
  const rows = await compactOversizedDeploymentJson(dir, 200)
  const actual = await fs.readFile(target)
  assert.equal(rows.length, 1); assert.equal(rows[0].relative, 'profile.json')
  assert.ok(actual.equals(minifyJsonWhitespaceOutsideStrings(source)))
  assert.ok(actual.toString().includes('9007199254740993123'))
  assert.ok(actual.toString().includes('-0,1.234567890123456789,1e-100'))
  assert.deepEqual(JSON.parse(actual), JSON.parse(source))
  assert.ok((await fs.readFile(path.join(dir, 'small.json'))).equals(small))
})

test('irreducible large JSON is rejected without truncation or schema changes', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-json-limit-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'large.json'), bytes = Buffer.from(JSON.stringify({ data: 'x'.repeat(1024) }))
  await fs.writeFile(file, bytes)
  await assert.rejects(compactOversizedDeploymentJson(dir, 128), /still exceeds file limit/)
  assert.ok((await fs.readFile(file)).equals(bytes))
})

for (const id of ['battle-602-00-01-001', 'battle-602-11-01-001']) test(id + ': real profile fits without deleting native data', async () => {
  const file = 'public/stages/official/' + id + '/scene-profile.json'
  const original = await fs.readFile(file), compact = minifyJsonWhitespaceOutsideStrings(original)
  assert.ok(original.length > 25 * 1024 ** 2)
  assert.ok(compact.length <= 25 * 1024 ** 2)
  assert.deepEqual(JSON.parse(compact), JSON.parse(original))
  assert.ok((await fs.readFile(file)).equals(original))
})

test('deployment copy applies lossless JSON transport before file-size preflight', async () => {
  const text = await fs.readFile('scripts/copy-deployment-public.mjs', 'utf8')
  const transport = text.indexOf('const oversizedJsonTransport = await compactOversizedDeploymentJson()')
  assert.ok(transport > 0 && transport < text.indexOf('const deployment = await deploymentFilePreflight()'))
  assert.ok(text.includes('    oversizedJsonTransport,'))
})
