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

async function compileSceneTransactionHarness(attach = async () => {}) {
  const source = read('magia-exedra-character-three/scene/index.ts')
  const parsed = ts.createSourceFile('scene.ts', source, ts.ScriptTarget.Latest, true)
  const sceneClass = parsed.statements.find(node => ts.isClassDeclaration(node)
    && node.members.some(member => member.name?.getText(parsed) === 'switchCharacter'))
  assert.ok(sceneClass, 'Production scene class containing the transaction is required')
  const start = sceneClass.members.findIndex(member => member.name?.getText(parsed) === 'switchCharacter')
  const members = sceneClass.members.slice(start).map(member => member.getText(parsed)).join('\n')
  const output = ts.transpileModule(
    `${read('magia-exedra-character-three/loadingProgress.ts')}\nexport const attachment = {run: async () => {}};\nconst attachCharacterAngelRing = (...args) => attachment.run(...args);\nexport class SceneTransactionHarness {\n${members}\n}`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    },
  ).outputText
  const runtime = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
  runtime.attachment.run = attach
  return runtime
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

function slotWithOld(scene) {
  const old = fakeCharacter(100107)
  const slot = {character:old,loading:false,removed:false,loadGeneration:0}
  scene.characters.push(slot)
  return {old,slot}
}

for (const remove of [false,true]) test(`attachment rejection after ${remove?'removal':'supersession'} disposes the stale candidate exactly once`, async () => {
  const entered = deferred(), attachmentGate = deferred()
  const {SceneTransactionHarness} = await compileSceneTransactionHarness(async () => {entered.resolve();await attachmentGate.promise})
  const manager=fakeManager(), scene=fakeScene(SceneTransactionHarness,manager)
  const {old,slot}=slotWithOld(scene), candidate=fakeCharacter(101901)
  const first=scene.switchCharacter(slot,101901)
  const rejected=assert.rejects(first,/attachment failed/)
  manager.calls[0].gate.resolve(candidate);await entered.promise
  let replacement
  if(remove)scene.removeCharacter(slot)
  else replacement=scene.switchCharacter(slot,100301)
  attachmentGate.reject(new Error('attachment failed'))
  await rejected
  assert.equal(candidate.disposeCount,1,'An uncommitted model leaked because a newer generation owned the slot')
  if(!remove){
    manager.calls[1].gate.reject(new Error('replacement failed'))
    await assert.rejects(replacement,/replacement failed/)
    assert.equal(slot.character,old);assert.equal(old.disposed,false)
  }else assert.equal(old.disposeCount,1)
})

test('failed scene registration restores the old model and removes the candidate',async()=>{
  const {SceneTransactionHarness}=await compileSceneTransactionHarness()
  const manager=fakeManager(),scene=fakeScene(SceneTransactionHarness,manager)
  const {old,slot}=slotWithOld(scene),candidate=fakeCharacter(101901)
  scene.stageCharacterShadows.add=object=>{if(object===candidate.object)throw Error('shadow registration failed');scene.shadowOps.push(['add',object.id])}
  const pending=scene.switchCharacter(slot,101901)
  manager.calls[0].gate.resolve(candidate)
  await assert.rejects(pending,/shadow registration failed/)
  assert.equal(old.disposed,false,'The old model must not be destroyed before registration succeeds')
  assert.equal(slot.character,old);assert.equal(candidate.disposeCount,1)
  assert.ok(scene.sceneOps.some(([op,id])=>op==='remove'&&id===candidate.object.id))
  assert.deepEqual(scene.sceneOps.at(-1),['add',old.object.id])
})

test('progress observer throwing on cleanup cannot strand a retained model',async()=>{
  const {SceneTransactionHarness}=await compileSceneTransactionHarness()
  const manager=fakeManager(),scene=fakeScene(SceneTransactionHarness,manager),{old,slot}=slotWithOld(scene)
  const pending=scene.switchCharacter(slot,101901,{loadProgressCallback:p=>{if(p==='')throw Error('observer cleanup failed')}})
  manager.calls[0].gate.reject(new Error('original load failure'))
  await assert.rejects(pending,/original load failure/)
  assert.equal(slot.character,old);assert.equal(old.disposed,false);assert.equal(slot.loading,false)
})

test('throwing progress observer cannot interrupt remove and leak a retained model',async()=>{
  const {SceneTransactionHarness}=await compileSceneTransactionHarness()
  const manager=fakeManager(),scene=fakeScene(SceneTransactionHarness,manager),{old,slot}=slotWithOld(scene)
  const pending=scene.switchCharacter(slot,101901,{loadProgressCallback:p=>{if(p==='')throw Error('observer cleanup failed')}})
  const rejected=assert.rejects(pending,error=>error.name==='AbortError')
  assert.doesNotThrow(()=>scene.removeCharacter(slot))
  await rejected
  assert.equal(old.disposeCount,1);assert.equal(scene.characters.includes(slot),false);assert.equal(slot.loading,false)
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
