import assert from 'node:assert/strict'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import ts from 'typescript'
import { gzipSync } from 'node:zlib'

const repo = path.dirname(fileURLToPath(import.meta.url))
const read = relative => readFileSync(path.join(repo, relative), 'utf8')

function ordered(source, markers) {
  let cursor = -1
  for (const marker of markers) {
    const next = source.indexOf(marker, cursor + 1)
    assert.notEqual(next, -1, `missing lifecycle marker: ${marker}`)
    assert.ok(next > cursor, `out-of-order lifecycle marker: ${marker}`)
    cursor = next
  }
}

test('character loader resolves only after every material and loadFinish stage', () => {
  const loader = read('magia-exedra-character-three/loader.ts')
  assert.doesNotMatch(loader, /return new Promise\(async \(resolve, reject\)/)
  assert.doesNotMatch(loader, /resolve\(character\)/)
  assert.match(loader, /Promise\.allSettled\(meshes\.map\(async mesh =>/)
  assert.match(loader, /textureFailures\.length > 0/)
  ordered(loader, [
    'modelLoadedCallback(character)',
    'const textureResults = await Promise.allSettled',
    'throwIfCharacterLoadAborted(signal, \'texture-material\', fbxUrl)',
    'loadFinishCallback(character)',
    'completed = true',
    'return character',
  ])
  assert.match(loader, /finally \{[\s\S]*releaseTextureContext\(\)[\s\S]*loadProgressCallback\(''\)/)
  assert.match(loader, /transactionTextures\.forEach\(texture => texture\.dispose\(\)\)/)
})

test('all character asset stages carry AbortSignal and exact stage plus URL errors', () => {
  const loader = read('magia-exedra-character-three/loader.ts')
  const texture = read('magia-exedra-character-three/texture.ts')
  const official = read('magia-exedra-character-three/officialTextureContainer.ts')
  const utils = read('magia-exedra-character-three/utils.ts')
  const viewerCharacter = read('src/viewer/character.ts')

  assert.match(loader, /fetchAndTryDecompressGzip\([\s\S]*fbxUrl[\s\S]*signal,/)
  assert.match(loader, /bindCharacterTextureLoadContext\(url, \{[\s\S]*signal,/)
  assert.match(loader, /fetchJsonRuntime<HomeAnimationRuntime>\(homeAnimationUrl, signal\)/)
  assert.match(loader, /fetchJsonRuntime<HomeExpressionRuntime>\(homeExpressionUrl, signal\)/)
  assert.match(texture, /fetch\(url, \{ signal \}\)/)
  assert.match(texture, /bindCharacterTextureLoadContext/)
  assert.match(official, /fetch\(payload\.url, \{ signal: options\.signal \}\)/)
  assert.match(official, /officialTextureLoadError\(stage, payload\.url, error\)/)
  assert.match(utils, /class CharacterAssetLoadError/)
  assert.match(utils, /\[\$\{stage\}\] \$\{url\}/)
  assert.match(utils, /const terminate =|terminate = gunzip/)
  assert.doesNotMatch(utils, /gunzipSync/)
  assert.match(viewerCharacter, /await super\.loadCharacterById\(id, callbacks\)[\s\S]*attachViewerCharacterPhysics/)
  assert.match(viewerCharacter, /throwIfCharacterLoadAborted\(signal, 'physics-attach'[\s\S]*await attachViewerCharacterPhysics\(character\)[\s\S]*throwIfCharacterLoadAborted\(signal, 'physics-attach'/)
  assert.match(viewerCharacter, /character\.dispose\(\)[\s\S]*characterAssetLoadError\('physics-attach'/)
})

function compileSceneTransactionHarness() {
  const source = read('magia-exedra-character-three/scene/index.ts')
  const start = source.indexOf('    switchCharacter(')
  const end = source.indexOf('\n}\n\nexport function deg2pos', start)
  assert.ok(start >= 0 && end > start)
  const members = source.slice(start, end)
  const output = ts.transpileModule(
    `${read('magia-exedra-character-three/loadingProgress.ts')}\nexport class SceneTransactionHarness {\n${members}\n}`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    },
  ).outputText
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function fakeCharacter(id) {
  return {
    object: { id: `root-${id}` },
    userData: { characterId: Number(id) },
    disposed: false,
    disposeCount: 0,
    dispose() {
      this.disposed = true
      this.disposeCount += 1
    },
  }
}

function fakeManager() {
  const calls = []
  const gates = []
  return {
    calls,
    gates,
    loadCharacterById(id, callbacks) {
      const gate = deferred()
      const record = { id: String(id), callbacks, gate }
      calls.push(record)
      gates.push(record)
      callbacks?.loadProgressCallback?.('fixture-loading')
      const signal = callbacks?.signal
      const abort = () => gate.reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException('aborted', 'AbortError'),
      )
      signal?.addEventListener('abort', abort, { once: true })
      return gate.promise.then(character => {
        signal?.removeEventListener('abort', abort)
        callbacks?.modelLoadedCallback?.(character)
        callbacks?.loadFinishCallback?.(character)
        return character
      })
    },
  }
}

function fakeScene(Harness, manager) {
  const sceneOps = []
  const shadowOps = []
  const value = Object.create(Harness.prototype)
  value.characterManager = manager
  value.characters = []
  value.characterSelected = undefined
  value.scene = {
    add(object) { sceneOps.push(['add', object.id]) },
    remove(object) { sceneOps.push(['remove', object.id]) },
  }
  value.stageCharacterShadows = {
    add(object) { shadowOps.push(['add', object.id]) },
    remove(object) { shadowOps.push(['remove', object.id]) },
  }
  value.sceneOps = sceneOps
  value.shadowOps = shadowOps
  return value
}

test('scene transaction is idempotent and only the latest generation can bind', async () => {
  const { SceneTransactionHarness } = await compileSceneTransactionHarness()
  const manager = fakeManager()
  const scene = fakeScene(SceneTransactionHarness, manager)
  const old = fakeCharacter(100107)
  const slot = {
    character: old,
    loading: false,
    removed: false,
    loadGeneration: 0,
  }
  scene.characters.push(slot)

  const first = scene.switchCharacter(slot, 101901)
  const same = scene.switchCharacter(slot, '101901')
  assert.equal(manager.calls.length, 1)

  const replacement = scene.switchCharacter(slot, 100301)
  assert.equal(manager.calls.length, 2)
  assert.equal(manager.calls[0].callbacks.signal.aborted, true)
  await assert.rejects(first, error => error.name === 'AbortError')
  await assert.rejects(same, error => error.name === 'AbortError')

  const newest = fakeCharacter(100301)
  manager.calls[1].gate.resolve(newest)
  assert.equal(await replacement, slot)
  assert.equal(slot.character, newest)
  assert.equal(old.disposeCount, 1)
  assert.equal(slot.loading, false)
  assert.deepEqual(
    scene.sceneOps.filter(([operation]) => operation === 'add'),
    [['add', 'root-100301']],
  )
})

test('failed replacement restores the retained character and clears progress', async () => {
  const { SceneTransactionHarness } = await compileSceneTransactionHarness()
  const manager = fakeManager()
  const scene = fakeScene(SceneTransactionHarness, manager)
  const old = fakeCharacter(100107)
  const progress = []
  const slot = {
    character: old,
    loading: false,
    removed: false,
    loadGeneration: 0,
  }
  scene.characters.push(slot)

  const replacement = scene.switchCharacter(slot, 101901, {
    loadProgressCallback(value) { progress.push(value) },
  })
  manager.calls[0].gate.reject(new Error('injected texture failure'))
  await assert.rejects(replacement, /injected texture failure/)
  assert.equal(slot.character, old)
  assert.equal(old.disposed, false)
  assert.equal(slot.loading, false)
  assert.equal(slot.loadPromise, undefined)
  assert.deepEqual(scene.sceneOps.at(-1), ['add', 'root-100107'])
})

test('remove aborts the current generation, disposes retained state, and clears overlay', async () => {
  const { SceneTransactionHarness } = await compileSceneTransactionHarness()
  const manager = fakeManager()
  const scene = fakeScene(SceneTransactionHarness, manager)
  const old = fakeCharacter(100107)
  const progress = []
  const slot = {
    character: old,
    loading: false,
    removed: false,
    loadGeneration: 0,
  }
  scene.characters.push(slot)
  const pending = scene.switchCharacter(slot, 101901, {
    loadProgressCallback(value) { progress.push(value) },
  })
  scene.removeCharacter(slot)
  await assert.rejects(pending, error => error.name === 'AbortError')
  assert.equal(old.disposeCount, 1)
  assert.equal(slot.removed, true)
  assert.equal(slot.loading, false)
  assert.equal(scene.characters.includes(slot), false)
  assert.equal(progress.at(-1), '')
})

test('gzip transport is abortable and preserves gzip-magic decoding', async () => {
  const progressCode = ts.transpileModule(read('magia-exedra-character-three/loadingProgress.ts'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText
  const progressUrl = `data:text/javascript;base64,${Buffer.from(progressCode).toString('base64')}`
  const source = read('magia-exedra-character-three/utils.ts').replace("'./loadingProgress.ts'", JSON.stringify(progressUrl))
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText
  const temporary = mkdtempSync(path.join(repo, '.character-load-utils-'))
  const modulePath = path.join(temporary, 'utils.mjs')
  writeFileSync(modulePath, output)
  const originalFetch = globalThis.fetch
  try {
    const runtime = await import(`${pathToFileURL(modulePath).href}?${Date.now()}`)
    const payload = Buffer.from('Kaydara FBX Binary lifecycle fixture')
    const compressed = gzipSync(payload)
    globalThis.fetch = async () => new Response(compressed, {
      status: 200,
      headers: { 'content-length': String(compressed.length) },
    })
    const blob = await runtime.fetchAndTryDecompressGzip('https://fixture/model')
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), payload)

    const controller = new AbortController()
    globalThis.fetch = async () => new Response(compressed, { status: 200 })
    await assert.rejects(
      runtime.fetchAndTryDecompressGzip(
        'https://fixture/abort',
        undefined,
        () => controller.abort(new DOMException('test abort', 'AbortError')),
        controller.signal,
      ),
      error => error.name === 'AbortError',
    )

    const exact = new runtime.CharacterAssetLoadError(
      'texture-download',
      'https://fixture/hair.dds',
      new Error('HTTP 503'),
    )
    assert.equal(exact.stage, 'texture-download')
    assert.equal(exact.url, 'https://fixture/hair.dds')
    assert.match(exact.message, /\[texture-download\] https:\/\/fixture\/hair\.dds: HTTP 503/)
  } finally {
    globalThis.fetch = originalFetch
    rmSync(temporary, { recursive: true, force: true })
  }
})
