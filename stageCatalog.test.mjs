import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import ts from 'typescript'

const root = dirname(fileURLToPath(import.meta.url))
const sourcePath = join(root, 'src', 'viewer', 'stageCatalog.ts')
const runtimePath = join(root, `.stage-catalog-${process.pid}-${Date.now()}.mjs`)
const compiled = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
})
writeFileSync(runtimePath, compiled.outputText, 'utf8')
const api = await import(pathToFileURL(runtimePath).href)
after(() => rmSync(runtimePath, { force: true }))

const pageBaseUrl = 'https://viewer.example/app/'

function fixtureFetch(fixtures) {
  return async url => {
    if (!(url in fixtures)) throw new Error(`404 ${url}`)
    return structuredClone(fixtures[url])
  }
}

test('loads nested generated catalogs and individual stage entries', async () => {
  const fixtures = {
    'https://viewer.example/app/stages/catalog.json': {
      version: 5,
      catalogs: ['./stages/generated-jp.json', './stages/generated-tw.json'],
      entries: ['./stages/catalog/manual.json'],
      stages: [{ id: 'inline' }],
    },
    'https://viewer.example/app/stages/generated-jp.json': {
      version: 1,
      catalogs: ['./stages/generated-shared.json'],
      entries: ['./stages/catalog/generated/jp-a.json'],
      stages: [],
    },
    'https://viewer.example/app/stages/generated-tw.json': {
      version: 1,
      catalogs: ['./stages/generated-shared.json'],
      entries: ['./stages/catalog/generated/tw-a.json'],
      stages: [],
    },
    'https://viewer.example/app/stages/generated-shared.json': {
      version: 1,
      catalogs: ['./stages/generated-jp.json'], // cycle back to an already visited catalog
      entries: ['./stages/catalog/generated/shared.json'],
      stages: [],
    },
    'https://viewer.example/app/stages/catalog/manual.json': { id: 'manual' },
    'https://viewer.example/app/stages/catalog/generated/jp-a.json': { id: 'jp-a' },
    'https://viewer.example/app/stages/catalog/generated/tw-a.json': { id: 'tw-a' },
    'https://viewer.example/app/stages/catalog/generated/shared.json': { id: 'shared' },
  }
  const result = await api.loadStageCatalogTree('./stages/catalog.json', {
    pageBaseUrl,
    fetchJson: fixtureFetch(fixtures),
  })
  assert.deepEqual(result.stages.map(stage => stage.id), [
    'inline', 'manual', 'jp-a', 'shared', 'tw-a',
  ])
  assert.equal(result.catalogCount, 4)
  assert.equal(result.entryCount, 4)
  assert.deepEqual(result.errors, [])
})

test('nested failures are diagnostic and do not hide other scene shards', async () => {
  const fixtures = {
    'https://viewer.example/app/stages/catalog.json': {
      version: 1,
      catalogs: ['./stages/missing.json', './stages/good.json'],
      entries: ['./stages/catalog/missing-stage.json'],
      stages: [],
    },
    'https://viewer.example/app/stages/good.json': {
      version: 1,
      stages: [{ id: 'still-visible' }],
    },
  }
  const result = await api.loadStageCatalogTree('./stages/catalog.json', {
    pageBaseUrl,
    fetchJson: fixtureFetch(fixtures),
  })
  assert.deepEqual(result.stages, [{ id: 'still-visible' }])
  assert.equal(result.errors.length, 2)
  assert.deepEqual(new Set(result.errors.map(error => error.kind)), new Set(['entry', 'catalog']))
})

test('root catalog remains fail-closed', async () => {
  await assert.rejects(
    api.loadStageCatalogTree('./stages/catalog.json', {
      pageBaseUrl,
      fetchJson: fixtureFetch({}),
    }),
    /404/,
  )
})
