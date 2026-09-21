import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import test from 'node:test'
import ts from 'typescript'

const loadingProgressSource = await readFile(new URL('./magia-exedra-character-three/loadingProgress.ts', import.meta.url), 'utf8')
const loadingProgressCode = ts.transpileModule(loadingProgressSource, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
const loadingProgressUrl = `data:text/javascript;base64,${Buffer.from(loadingProgressCode).toString('base64')}`
const rawRuntimeSource = await readFile(
  new URL('./src/viewer/runtimeProductDelivery.ts', import.meta.url),
  'utf8',
)
const runtimeSource = rawRuntimeSource.replace("'../../magia-exedra-character-three/loadingProgress.ts'", JSON.stringify(loadingProgressUrl))
const compiledRuntime = ts.transpileModule(runtimeSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText

async function loadRuntimeModule() {
  return import(
    `data:text/javascript;base64,${Buffer.from(compiledRuntime).toString('base64')}`
    + `#${Date.now()}-${Math.random()}`
  )
}

function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit++) {
      value = (value >>> 1) ^ (0xedb88320 & -(value & 1))
    }
  }
  return (value ^ 0xffffffff) >>> 0
}

async function localVoiceRuntimeFixture(t, dev = true) {
  const source = runtimeSource.replace('import.meta.env?.DEV', String(dev))
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
  const runtime = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}#${Math.random()}`)
  const nativeFetch = globalThis.fetch
  const descriptors = Object.fromEntries(['document', 'location'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { baseURI: 'http://127.0.0.1:6595/' } })
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL('http://127.0.0.1:6595/?runtimeDelivery=local') })
  const manifest = { schema: 'magius.runtime-product-delivery.v1', repository: 'fixture/repo', deliveryGateway: 'https://fixture.invalid',
    activation: { hosts: [], queryOverride: 'runtimeDelivery=release', localMode: 'prefer-workspace-files' },
    counts: { products: 0, releaseAssets: 0, voiceProducts: 0 }, entries: [] }
  const fixture = { runtime, nativeFetch, requests: [], response: () => new Response('OggSfixture', { headers: { 'content-type': 'application/vnd.magius.voice-payload' } }) }
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/catalogs/runtime-product-delivery.v1.json')) return new Response(JSON.stringify(manifest))
    fixture.requests.push({ url: String(url), options })
    return fixture.response(url, options)
  }
  t.after(() => {
    runtime.resetRuntimeProductDeliveryForTests()
    globalThis.fetch = nativeFetch
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  return fixture
}

test('local voice resolver shares exact extensionless byte fetch and returns only audio Blobs', async t => {
  const { runtime, requests, nativeFetch } = await localVoiceRuntimeFixture(t)
  const voice = '/voice/Cv/cv_100202_outgame/cv_100202_other_evo_fee_01.ogg'
  const [a, b] = await Promise.all([runtime.resolveRuntimeAssetUrl(voice), runtime.resolveRuntimeAssetUrl(voice)])
  assert.match(a, /^blob:/)
  assert.equal(a, b)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'http://127.0.0.1:6595/__magius_voice__/cv_100202_outgame/cv_100202_other_evo_fee_01')
  const res = await nativeFetch(a)
  assert.equal(res.headers.get('content-type'), 'audio/ogg')
  assert.equal(await res.text(), 'OggSfixture')
  assert.equal(runtime.resolveCachedRuntimeAssetUrl(voice), a)
  runtime.resetRuntimeProductDeliveryForTests()
  await assert.rejects(nativeFetch(a))
})

test('local voice transport errors never fall back to a raw media request and failed requests may retry', async t => {
  const f = await localVoiceRuntimeFixture(t)
  const voice = '/voice/Cv/cv_100202_outgame/cv_100202_other_evo_fee_01.ogg'
  for (const response of [new Response('', { status: 404 }), new Response(null, { status: 204 }),
    new Response('<html>SPA</html>', { headers: { 'content-type': 'text/html' } }),
    new Response('BAD!', { headers: { 'content-type': 'application/vnd.magius.voice-payload' } })]) {
    f.response = () => response
    await assert.rejects(f.runtime.resolveRuntimeAssetUrl(voice), /Local voice/)
  }
  assert.equal(f.requests.length, 4)
  assert.ok(f.requests.every(row => row.url.includes('/__magius_voice__/') && !row.url.includes('.ogg')))
  f.response = () => new Response('OggSretry', { headers: { 'content-type': 'application/vnd.magius.voice-payload' } })
  assert.match(await f.runtime.resolveRuntimeAssetUrl(voice), /^blob:/)
})

test('local voice aborted and reset loads do not publish stale Blob URLs', async t => {
  const f = await localVoiceRuntimeFixture(t)
  const voice = '/voice/Cv/cv_100202_outgame/cv_100202_other_evo_fee_01.ogg'
  let finish
  f.response = () => new Promise(resolve => { finish = resolve })
  const pending = f.runtime.resolveRuntimeAssetUrl(voice)
  await new Promise(resolve => setImmediate(resolve))
  f.runtime.resetRuntimeProductDeliveryForTests()
  finish(new Response('OggSstale', { headers: { 'content-type': 'application/vnd.magius.voice-payload' } }))
  await assert.rejects(pending, /reset during voice load/)
  assert.doesNotMatch(f.runtime.resolveCachedRuntimeAssetUrl(voice), /^blob:/)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(f.runtime.resolveRuntimeAssetUrl(voice, controller.signal), { name: 'AbortError' })
})

test('production local voice also uses byte delivery while external audio remains external', async t => {
  const f = await localVoiceRuntimeFixture(t, false)
  assert.match(await f.runtime.resolveRuntimeAssetUrl('/voice/Cv/cv_100202_outgame/cue.ogg'), /^blob:/)
  assert.equal(await f.runtime.resolveRuntimeAssetUrl('https://audio.example/voice/Cv/set/cue.ogg'), 'https://audio.example/voice/Cv/set/cue.ogg')
  assert.equal(f.requests.length, 1)
  assert.ok(f.requests[0].url.endsWith('/__magius_voice__/cv_100202_outgame/cue'))
})

test('catalog voice identity, not file metadata, drives default and same-origin override playback', async t => {
  const f = await localVoiceRuntimeFixture(t, false)
  const entry = { audio: { runtimeReady: true, runtimeUrl: 'file:///D:/private/source.ogg',
    sourceStableKey: 'cri-cue:cueSheetName=cv_100101_outgame|cueName=cv_100101_other_story_07' } }
  const normal = await f.runtime.resolveRuntimeVoiceUrl(entry)
  const override = await f.runtime.resolveRuntimeVoiceUrl(entry, { audioBaseUrl: 'http://127.0.0.1:6595/voice/Cv/' })
  assert.match(normal, /^blob:/); assert.equal(override, normal)
  assert.deepEqual(f.requests.map(r => r.url), ['http://127.0.0.1:6595/__magius_voice__/cv_100101_outgame/cv_100101_other_story_07'])
  const external = await f.runtime.resolveRuntimeVoiceUrl(entry, { audioBaseUrl: 'https://audio.example/custom/' })
  assert.equal(external, 'https://audio.example/custom/cv_100101_outgame/cv_100101_other_story_07.ogg')
  assert.equal(f.requests.length, 1)
})

test('unready or malformed voice identities never use raw or file fallback', async t => {
  const f = await localVoiceRuntimeFixture(t)
  for (const audio of [
    { runtimeReady: false, runtimeUrl: 'file:///D:/source.ogg', sourceStableKey: 'bad' },
    { runtimeReady: true, runtimeUrl: null, sourceStableKey: 'bad' },
    { runtimeReady: true, runtimeUrl: 'file:///D:/source.ogg', sourceStableKey: 'cri-cue:cueSheetName=../x|cueName=bad' },
  ]) assert.equal(await f.runtime.resolveRuntimeVoiceUrl({ audio }), null)
  const entry = { audio: { runtimeReady: true, runtimeUrl: 'file:///D:/source.ogg', sourceStableKey: 'cri-cue:cueSheetName=sheet|cueName=cue' } }
  await assert.rejects(f.runtime.resolveRuntimeVoiceUrl(entry, { audioBaseUrl: '/different-local/' }), /Local voice base/)
  await assert.rejects(f.runtime.resolveRuntimeVoiceUrl(entry, { audioBaseUrl: 'file:///D:/source/' }), /Voice base protocol/)
  assert.equal(f.requests.length, 0)
})

function storedZip(files) {
  const encoder = new TextEncoder()
  const chunks = []
  const centralEntries = []
  let offset = 0

  const append = bytes => {
    chunks.push(bytes)
    offset += bytes.byteLength
  }
  const header = (length, write) => {
    const bytes = new Uint8Array(length)
    write(new DataView(bytes.buffer))
    return bytes
  }

  for (const [name, body] of Object.entries(files)) {
    const nameBytes = encoder.encode(name)
    const data = typeof body === 'string' ? encoder.encode(body) : body
    const localOffset = offset
    append(header(30, view => {
      view.setUint32(0, 0x04034b50, true)
      view.setUint16(4, 20, true)
      view.setUint16(6, 0x0800, true)
      view.setUint16(8, 0, true)
      view.setUint32(14, crc32(data), true)
      view.setUint32(18, data.byteLength, true)
      view.setUint32(22, data.byteLength, true)
      view.setUint16(26, nameBytes.byteLength, true)
    }))
    append(nameBytes)
    append(data)
    centralEntries.push({ nameBytes, data, localOffset })
  }

  const centralOffset = offset
  for (const entry of centralEntries) {
    append(header(46, view => {
      view.setUint32(0, 0x02014b50, true)
      view.setUint16(4, 20, true)
      view.setUint16(6, 20, true)
      view.setUint16(8, 0x0800, true)
      view.setUint16(10, 0, true)
      view.setUint32(16, crc32(entry.data), true)
      view.setUint32(20, entry.data.byteLength, true)
      view.setUint32(24, entry.data.byteLength, true)
      view.setUint16(28, entry.nameBytes.byteLength, true)
      view.setUint32(42, entry.localOffset, true)
    }))
    append(entry.nameBytes)
  }
  const centralBytes = offset - centralOffset
  append(header(22, view => {
    view.setUint32(0, 0x06054b50, true)
    view.setUint16(8, centralEntries.length, true)
    view.setUint16(10, centralEntries.length, true)
    view.setUint32(12, centralBytes, true)
    view.setUint32(16, centralOffset, true)
  }))

  const output = new Uint8Array(offset)
  let cursor = 0
  for (const chunk of chunks) {
    output.set(chunk, cursor)
    cursor += chunk.byteLength
  }
  return output
}

function storedZipMemberNames(bytes) {
  let eocdOffset = -1
  for (let offset = bytes.byteLength - 22; offset >= Math.max(0, bytes.byteLength - 65_557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset
      break
    }
  }
  assert.notEqual(eocdOffset, -1)
  const fileCount = bytes.readUInt16LE(eocdOffset + 10)
  let cursor = bytes.readUInt32LE(eocdOffset + 16)
  const names = []
  for (let index = 0; index < fileCount; index++) {
    assert.equal(bytes.readUInt32LE(cursor), 0x02014b50)
    assert.equal(bytes.readUInt16LE(cursor + 10), 0)
    const nameLength = bytes.readUInt16LE(cursor + 28)
    const extraLength = bytes.readUInt16LE(cursor + 30)
    const commentLength = bytes.readUInt16LE(cursor + 32)
    names.push(bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'))
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return names
}

async function retryArchiveFixture(t) {
  const runtime = await loadRuntimeModule(), nativeFetch = globalThis.fetch
  const descriptors = Object.fromEntries(['document', 'location'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis,k)]))
  const base='https://magius3dviewer.pages.dev/', root='/stages/official/retry-fixture/'
  const packUrl='https://pack.test/v1/retry.zip', zip=storedZip({'body.bin':new Uint8Array([1,2,3])})
  const manifest={schema:'magius.runtime-product-delivery.v1',repository:'fixture/repo',deliveryGateway:'https://pack.test',
    activation:{hosts:['magius3dviewer.pages.dev'],queryOverride:'runtimeDelivery=release',localMode:'prefer-workspace-files'},
    counts:{products:1,releaseAssets:1},entries:[{stableKey:'stage|retry-fixture',kind:'stage',rootPath:root,
      releaseTag:'v1',assetName:'retry.zip',packUrl,originUrl:'https://github.com/fixture/repo/releases/download/v1/retry.zip',fileCount:1,unpackedBytes:3,packedBytes:zip.byteLength}]}
  for(const [key,value] of Object.entries({document:{baseURI:base},location:new URL(base)}))Object.defineProperty(globalThis,key,{configurable:true,value})
  const f={runtime,nativeFetch,url:root+'body.bin',requests:[],response:()=>new Response(zip),zip}
  globalThis.fetch=async (url,options)=>{
    if(String(url)===base+'catalogs/runtime-product-delivery.v1.json')return new Response(JSON.stringify(manifest))
    assert.equal(String(url),packUrl);f.requests.push(options);return f.response(options)
  }
  t.after(()=>{runtime.resetRuntimeProductDeliveryForTests();globalThis.fetch=nativeFetch;for(const [k,d] of Object.entries(descriptors)){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k]}})
  return f
}

test('transient archive 502 retries the same GET with cache reload and preserves shared success',async t=>{
  const f=await retryArchiveFixture(t);f.response=()=>f.requests.length===1?new Response('upstream',{status:502}):new Response(f.zip)
  const [a,b]=await Promise.all([f.runtime.resolveRuntimeAssetUrl(f.url),f.runtime.resolveRuntimeAssetUrl(f.url)])
  assert.equal(a,b);assert.match(a,/^blob:/);assert.deepEqual(new Uint8Array(await (await f.nativeFetch(a)).arrayBuffer()),new Uint8Array([1,2,3]))
  assert.equal(f.requests.length,2);assert.deepEqual(f.requests.map(x=>x.cache),['force-cache','reload'])
})
test('persistent temporary archive failure stops after three requests and later explicit load may recover',async t=>{
  const f=await retryArchiveFixture(t);f.response=()=>new Response('upstream',{status:503})
  await assert.rejects(f.runtime.resolveRuntimeAssetUrl(f.url),/HTTP 503/);assert.equal(f.requests.length,3)
  f.response=()=>new Response(f.zip);assert.match(await f.runtime.resolveRuntimeAssetUrl(f.url),/^blob:/);assert.equal(f.requests.length,4)
})
test('archive cancellation during retry delay sends no later request',async t=>{
  const f=await retryArchiveFixture(t),controller=new AbortController();f.response=()=>{setTimeout(()=>controller.abort(),10);return new Response('gateway',{status:504})}
  await assert.rejects(f.runtime.resolveRuntimeAssetUrl(f.url,controller.signal),e=>e.name==='AbortError')
  await new Promise(r=>setTimeout(r,400));assert.equal(f.requests.length,1)
})
test('archive reset cancels stale retry and preserves a newer cached load',async t=>{
  const f=await retryArchiveFixture(t);f.response=()=>new Response('gateway',{status:502})
  const old=f.runtime.resolveRuntimeAssetUrl(f.url);const failed=assert.rejects(old,/reset during archive load/)
  while(f.requests.length===0)await new Promise(r=>setTimeout(r,1))
  f.runtime.resetRuntimeProductDeliveryForTests();f.response=()=>new Response(f.zip)
  const fresh=await f.runtime.resolveRuntimeAssetUrl(f.url);await failed
  assert.equal(await f.runtime.resolveRuntimeAssetUrl(f.url),fresh);assert.equal(f.requests.length,2)
})
for(const status of [400,401,403,404,429,500])test(`archive HTTP ${status} is not disguised by retry`,async t=>{
  const f=await retryArchiveFixture(t);f.response=()=>new Response('fixed failure',{status})
  await assert.rejects(f.runtime.resolveRuntimeAssetUrl(f.url),new RegExp('HTTP '+status));assert.equal(f.requests.length,1)
})
test('invalid successful archive is rejected once without retry or cached blob',async t=>{
  const f=await retryArchiveFixture(t);f.response=()=>new Response('not a ZIP')
  await assert.rejects(f.runtime.resolveRuntimeAssetUrl(f.url),/ZIP directory/);assert.equal(f.requests.length,1)
  assert.doesNotMatch(f.runtime.resolveCachedRuntimeAssetUrl(f.url),/^blob:/)
})

function storedZipMembers(bytes) {
  let eocdOffset = -1
  for (let offset = bytes.byteLength - 22; offset >= Math.max(0, bytes.byteLength - 65_557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset
      break
    }
  }
  assert.notEqual(eocdOffset, -1)
  const fileCount = bytes.readUInt16LE(eocdOffset + 10)
  let cursor = bytes.readUInt32LE(eocdOffset + 16)
  const members = new Map()
  for (let index = 0; index < fileCount; index++) {
    assert.equal(bytes.readUInt32LE(cursor), 0x02014b50)
    assert.equal(bytes.readUInt16LE(cursor + 10), 0)
    const size = bytes.readUInt32LE(cursor + 24)
    const nameLength = bytes.readUInt16LE(cursor + 28)
    const extraLength = bytes.readUInt16LE(cursor + 30)
    const commentLength = bytes.readUInt16LE(cursor + 32)
    const localOffset = bytes.readUInt32LE(cursor + 42)
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    assert.equal(bytes.readUInt32LE(localOffset), 0x04034b50)
    const localNameLength = bytes.readUInt16LE(localOffset + 26)
    const localExtraLength = bytes.readUInt16LE(localOffset + 28)
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength
    members.set(name, bytes.subarray(dataOffset, dataOffset + size))
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return members
}

function expectedStoredZipBytes(files) {
  return files.reduce(
    (total, file) => total + file.bytes + 76 + 2 * Buffer.byteLength(file.path),
    22,
  )
}

test('release delivery resolves one stable product ZIP and fails closed', async () => {
  const runtime = await loadRuntimeModule()
  const nativeFetch = globalThis.fetch
  const previousDocument = globalThis.document
  const previousLocation = globalThis.location
  const base = 'https://magius3dviewer.pages.dev/'
  const gateway = 'https://magius3dviewer-runtime-products.crynetsystemscell.workers.dev'
  const packUrl = `${gateway}/runtime-products-v1-a/fixture.zip`
  const originUrl = 'https://github.com/HiiragiNemu/Magi3Dviewer/releases/download/runtime-products-v1-a/fixture.zip'
  const zip = storedZip({
    'scene-profile.json': '{"stableKey":"stage|fixture"}',
    'texture.bin': new Uint8Array([1, 3, 3, 7]),
  })
  const manifest = {
    schema: 'magius.runtime-product-delivery.v1',
    repository: 'HiiragiNemu/Magi3Dviewer',
    deliveryGateway: gateway,
    activation: {
      hosts: ['hiiraginemu.github.io', 'magius3dviewer.pages.dev'],
      queryOverride: 'runtimeDelivery=release',
      localMode: 'prefer-workspace-files',
    },
    counts: {
      products: 1,
      stageProducts: 1,
      enemyModels: 0,
      enemyVfxProducts: 0,
      characterVfxProducts: 0,
      releaseAssets: 1,
      unpackedBytes: 41,
      packedBytes: zip.byteLength,
    },
    entries: [{
      stableKey: 'stage|fixture',
      kind: 'stage',
      rootPath: '/stages/official/fixture/',
      releaseTag: 'runtime-products-v1-a',
      assetName: 'fixture.zip',
      packUrl,
      originUrl,
      fileCount: 2,
      unpackedBytes: 41,
      packedBytes: zip.byteLength,
    }],
  }
  let packRequests = 0

  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { baseURI: base },
  })
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL(base),
  })
  globalThis.fetch = async input => {
    const url = String(input)
    if (url === `${base}catalogs/runtime-product-delivery.v1.json`) {
      return new Response(JSON.stringify(manifest), {
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url === packUrl) {
      packRequests++
      return new Response(zip)
    }
    return nativeFetch(input)
  }

  try {
    const profileUrl = await runtime.resolveRuntimeAssetUrl(
      '/stages/official/fixture/scene-profile.json',
    )
    assert.match(profileUrl, /^blob:/)
    assert.equal(
      await (await nativeFetch(profileUrl)).text(),
      '{"stableKey":"stage|fixture"}',
    )

    const textureUrl = runtime.resolveCachedRuntimeAssetUrl(
      '/stages/official/fixture/texture.bin',
    )
    assert.match(textureUrl, /^blob:/)
    assert.deepEqual(
      new Uint8Array(await (await nativeFetch(textureUrl)).arrayBuffer()),
      new Uint8Array([1, 3, 3, 7]),
    )
    assert.equal(packRequests, 1)
    await assert.rejects(
      runtime.resolveRuntimeAssetUrl('/stages/official/fixture/missing.bin'),
      /does not contain/,
    )
  } finally {
    runtime.resetRuntimeProductDeliveryForTests()
    globalThis.fetch = nativeFetch
    if (previousDocument === undefined) delete globalThis.document
    else Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: previousDocument,
    })
    if (previousLocation === undefined) delete globalThis.location
    else Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: previousLocation,
    })
  }
})

test('release delivery resolves exact voice cue-sheet OGG bytes as an audio Blob URL', async () => {
  const runtime = await loadRuntimeModule()
  const nativeFetch = globalThis.fetch
  const previousDocument = globalThis.document
  const previousLocation = globalThis.location
  const base = 'https://magius3dviewer.pages.dev/'
  const gateway = 'https://magius3dviewer-runtime-products.crynetsystemscell.workers.dev'
  const tag = 'runtime-products-voice-v1'
  const assetName = '0001-voice-cv_fixture_outgame.zip'
  const packUrl = `${gateway}/${tag}/${assetName}`
  const originUrl = `https://github.com/HiiragiNemu/Magi3Dviewer/releases/download/${tag}/${assetName}`
  const ogg = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 1, 2, 3, 4])
  const zip = storedZip({ 'cv_fixture_other_story_01.ogg': ogg })
  const manifest = {
    schema: 'magius.runtime-product-delivery.v1',
    repository: 'HiiragiNemu/Magi3Dviewer',
    deliveryGateway: gateway,
    activation: {
      hosts: ['hiiraginemu.github.io', 'magius3dviewer.pages.dev'],
      queryOverride: 'runtimeDelivery=release',
      localMode: 'prefer-workspace-files',
    },
    counts: {
      products: 1,
      stageProducts: 0,
      enemyModels: 0,
      enemyVfxProducts: 0,
      characterVfxProducts: 0,
      voiceProducts: 1,
      releaseAssets: 1,
      unpackedBytes: ogg.byteLength,
      packedBytes: zip.byteLength,
    },
    entries: [{
      stableKey: 'voice|cv_fixture_outgame',
      kind: 'voice',
      rootPath: '/voice/Cv/cv_fixture_outgame/',
      releaseTag: tag,
      assetName,
      packUrl,
      originUrl,
      fileCount: 1,
      unpackedBytes: ogg.byteLength,
      packedBytes: zip.byteLength,
    }],
  }
  let packRequests = 0
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { baseURI: base },
  })
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL(`${base}?runtimeDelivery=release`),
  })
  globalThis.fetch = async input => {
    const url = String(input)
    if (url === `${base}catalogs/runtime-product-delivery.v1.json`) {
      return new Response(JSON.stringify(manifest))
    }
    if (url === packUrl) {
      packRequests++
      return new Response(zip)
    }
    return nativeFetch(input)
  }
  try {
    const resolved = await runtime.resolveRuntimeAssetUrl(
      '/voice/Cv/cv_fixture_outgame/cv_fixture_other_story_01.ogg',
    )
    assert.match(resolved, /^blob:/)
    const response = await nativeFetch(resolved)
    assert.equal(response.headers.get('content-type'), 'audio/ogg')
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), ogg)
    assert.equal(packRequests, 1)
    assert.equal(
      runtime.resolveCachedRuntimeAssetUrl(
        '/voice/Cv/cv_fixture_outgame/cv_fixture_other_story_01.ogg',
      ),
      resolved,
    )
  } finally {
    runtime.resetRuntimeProductDeliveryForTests()
    globalThis.fetch = nativeFetch
    if (previousDocument === undefined) delete globalThis.document
    else Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: previousDocument,
    })
    if (previousLocation === undefined) delete globalThis.location
    else Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: previousLocation,
    })
  }
})

test('deployment build emits the independent preview with one compressed-asset proxy', async () => {
  const viteConfig = await readFile(new URL('./vite.config.ts', import.meta.url), 'utf8')
  assert.match(viteConfig, /main:\s*'index\.html'/)
  assert.match(viteConfig, /resourcePreview:\s*'resource-preview\.html'/)
  assert.equal([...viteConfig.matchAll(/magiusCompressedAssetProxyPlugin\(\)/g)].length, 1)
})

test('voice-only generator emits deterministic cue-sheet ZIPs and fails closed on missing audio', async () => {
  const fixtureRoot = fileURLToPath(new URL(
    './artifacts/verification/20260905-s6-voice-wiki-93-cuesheet-refresh/focused-fixture/',
    import.meta.url,
  ))
  const fixtureRepo = path.join(fixtureRoot, 'repo')
  const sourceRoot = path.join(fixtureRoot, 'source', 'Cv')
  const manifestRoot = path.join(
    fixtureRepo,
    'artifacts/research/20260827-voice-catalog-source-ready',
  )
  const scenarioRoot = path.join(
    fixtureRepo,
    'artifacts/research/20260827-voice-scenario-source-ready',
  )
  const generator = fileURLToPath(new URL(
    './scripts/build-runtime-product-release-packs.py',
    import.meta.url,
  ))
  await rm(fixtureRoot, { recursive: true, force: true })
  await mkdir(manifestRoot, { recursive: true })
  await mkdir(scenarioRoot, { recursive: true })

  const sources = [
    {
      characterResourceId: '100101',
      cueSheet: 'cv_fixture_a_outgame',
      cueName: 'cv_fixture_a_other_story_01',
      soundMstId: 1,
      bytes: Buffer.from([0x4f, 0x67, 0x67, 0x53, 1, 2, 3]),
    },
    {
      characterResourceId: '100202',
      cueSheet: 'cv_fixture_b_outgame',
      cueName: 'cv_fixture_b_other_story_01',
      soundMstId: 2,
      bytes: Buffer.from([0x4f, 0x67, 0x67, 0x53, 4, 5, 6, 7]),
    },
  ]
  for (const source of sources) {
    source.path = path.join(sourceRoot, source.cueSheet, `${source.cueName}.ogg`)
    source.stableKey = `soundMstId=${source.soundMstId}|cueSheetName=${source.cueSheet}|cueName=${source.cueName}`
    source.sourceStableKey = `cri-cue:cueSheetName=${source.cueSheet}|cueName=${source.cueName}`
  }
  await mkdir(path.dirname(sources[0].path), { recursive: true })
  await writeFile(sources[0].path, sources[0].bytes)

  const voiceManifest = {
    schema: 'magius.voice-catalog.v1',
    counts: {
      voiceEntries: sources.length,
      audioRuntimeReady: sources.length,
    },
    entries: sources.map((source, index) => ({
      stableKey: source.stableKey,
      characterResourceId: source.characterResourceId,
      order: index + 1,
      audio: {
        runtimeUrl: pathToFileURL(source.path).href,
        format: 'ogg',
        runtimeReady: true,
        failClosedReasons: [],
        sourceStableKey: source.sourceStableKey,
      },
      subtitles: {},
    })),
  }
  const scenarioManifest = {
    schema: 'magius.voice-scenario.v1',
    counts: {
      voiceEntries: sources.length,
      scenarioReady: sources.length,
    },
    entries: sources.map(source => ({ voiceStableKey: source.stableKey })),
  }
  const voiceManifestBytes = `${JSON.stringify(voiceManifest, null, 2)}\n`
  const scenarioManifestBytes = `${JSON.stringify(scenarioManifest, null, 2)}\n`
  await writeFile(path.join(manifestRoot, 'manifest.v1.json'), voiceManifestBytes)
  await writeFile(path.join(scenarioRoot, 'manifest.v1.json'), scenarioManifestBytes)

  const gateway = 'https://magius3dviewer-runtime-products.crynetsystemscell.workers.dev'
  const stageEntry = {
    stableKey: 'stage|fixture',
    kind: 'stage',
    rootPath: '/stages/official/fixture/',
    releaseTag: 'runtime-products-v1-a',
    assetName: '0001-stage-fixture.zip',
    packUrl: `${gateway}/runtime-products-v1-a/0001-stage-fixture.zip`,
    originUrl: 'https://github.com/HiiragiNemu/Magi3Dviewer/releases/download/runtime-products-v1-a/0001-stage-fixture.zip',
    fileCount: 1,
    unpackedBytes: 1,
    packedBytes: 99,
  }
  const baseline = {
    schema: 'magius.runtime-product-delivery.v1',
    repository: 'HiiragiNemu/Magi3Dviewer',
    deliveryGateway: gateway,
    activation: {
      hosts: ['hiiraginemu.github.io', 'magius3dviewer.pages.dev'],
      queryOverride: 'runtimeDelivery=release',
      localMode: 'prefer-workspace-files',
    },
    releasePolicy: {
      tags: ['runtime-products-v1-a', 'runtime-products-v1-b', 'runtime-products-enemy-models-v2'],
      maxAssetsPerRelease: 1000,
      maxAssetBytesExclusive: 2 * 1024 ** 3,
      compression: 'zip-stored-stream-pass-through',
    },
    counts: {
      products: 1,
      stageProducts: 1,
      enemyModels: 0,
      enemyVfxProducts: 0,
      characterVfxProducts: 0,
      voiceProducts: 0,
      releaseAssets: 1,
      unpackedBytes: 1,
      packedBytes: 99,
    },
    entries: [stageEntry],
  }
  const baselineBytes = `${JSON.stringify(baseline, null, 2)}\n`
  const run = (catalogPath, artifactRoot) => spawnSync('python', [
    generator,
    '--repo-root', fixtureRepo,
    '--artifact-root', artifactRoot,
    '--catalog-output', catalogPath,
    '--voice-only',
  ], { encoding: 'utf8' })

  const missingCatalog = path.join(fixtureRoot, 'catalog-missing.json')
  await writeFile(missingCatalog, baselineBytes)
  const missing = run(missingCatalog, path.join(fixtureRoot, 'release-missing'))
  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr, /Voice source file is missing/)
  assert.equal(await readFile(missingCatalog, 'utf8'), baselineBytes)

  await mkdir(path.dirname(sources[1].path), { recursive: true })
  await writeFile(sources[1].path, sources[1].bytes)
  const catalogA = path.join(fixtureRoot, 'catalog-a.json')
  const catalogB = path.join(fixtureRoot, 'catalog-b.json')
  const releaseA = path.join(fixtureRoot, 'release-a')
  const releaseB = path.join(fixtureRoot, 'release-b')
  await writeFile(catalogA, baselineBytes)
  await writeFile(catalogB, baselineBytes)
  const first = run(catalogA, releaseA)
  const second = run(catalogB, releaseB)
  assert.equal(first.status, 0, first.stderr)
  assert.equal(second.status, 0, second.stderr)
  assert.deepEqual(await readFile(catalogB), await readFile(catalogA))

  const catalog = JSON.parse(await readFile(catalogA, 'utf8'))
  assert.deepEqual(catalog.entries[0], stageEntry)
  assert.equal(catalog.counts.products, 3)
  assert.equal(catalog.counts.voiceProducts, 2)
  assert.equal(catalog.counts.releaseAssets, 3)
  assert.deepEqual(catalog.releasePolicy.tags, [
    'runtime-products-v1-a',
    'runtime-products-v1-b',
    'runtime-products-enemy-models-v2',
    'runtime-products-voice-v1',
  ])
  assert.deepEqual(catalog.entries.slice(1).map(entry => entry.rootPath), [
    '/voice/Cv/cv_fixture_a_outgame/',
    '/voice/Cv/cv_fixture_b_outgame/',
  ])
  assert.deepEqual(catalog.voiceArchive, {
    releaseTag: 'runtime-products-voice-v1',
    cueSheets: 2,
    voiceEntries: 2,
    scenarioEntriesJoined: 2,
    sourceBytes: sources.reduce((sum, source) => sum + source.bytes.byteLength, 0),
    packedBytes: catalog.entries.slice(1).reduce((sum, entry) => sum + entry.packedBytes, 0),
    maxAssetBytes: Math.max(...catalog.entries.slice(1).map(entry => entry.packedBytes)),
    compression: 'ZIP_STORED',
    missing: 0,
    duplicateStableKeys: 0,
    sourceStableKeysPreserved: true,
  })
  const assetsA = await readdir(path.join(releaseA, 'assets', 'runtime-products-voice-v1'))
  const assetsB = await readdir(path.join(releaseB, 'assets', 'runtime-products-voice-v1'))
  assert.deepEqual(assetsA, assetsB)
  for (const [index, assetName] of assetsA.entries()) {
    const archiveA = await readFile(path.join(releaseA, 'assets', 'runtime-products-voice-v1', assetName))
    const archiveB = await readFile(path.join(releaseB, 'assets', 'runtime-products-voice-v1', assetName))
    assert.deepEqual(archiveB, archiveA)
    const members = storedZipMembers(archiveA)
    assert.deepEqual([...members.keys()], [`${sources[index].cueName}.ogg`])
    assert.deepEqual(members.get(`${sources[index].cueName}.ogg`), sources[index].bytes)
    assert.equal(archiveA.byteLength, expectedStoredZipBytes([{
      path: `${sources[index].cueName}.ogg`,
      bytes: sources[index].bytes.byteLength,
    }]))
  }
  const releaseManifest = JSON.parse(await readFile(
    path.join(releaseA, 'release-assets-manifest.v1.json'),
    'utf8',
  ))
  assert.equal(releaseManifest.products.length, 2)
  assert.deepEqual(
    releaseManifest.products.flatMap(product => product.files.map(file => file.voiceStableKey)),
    sources.map(source => source.stableKey),
  )
  assert.equal(await readFile(path.join(manifestRoot, 'manifest.v1.json'), 'utf8'), voiceManifestBytes)
  assert.equal(await readFile(path.join(scenarioRoot, 'manifest.v1.json'), 'utf8'), scenarioManifestBytes)

  // A source addition that sorts before old cue sheets must not rename old releases.
  const addedSheet = 'cv_fixture_0_outgame'
  const addedCue = 'cv_fixture_0_other_story_01'
  const addedPath = path.join(sourceRoot, addedSheet, `${addedCue}.ogg`)
  await mkdir(path.dirname(addedPath), {recursive: true})
  await writeFile(addedPath, Buffer.from('OggS-new-exact-cue'))
  const addedKey = `soundMstId=3|cueSheetName=${addedSheet}|cueName=${addedCue}`
  voiceManifest.entries.unshift({stableKey: addedKey, characterResourceId: '100303', order: 1,
    audio: {runtimeUrl: pathToFileURL(addedPath).href, format: 'ogg', runtimeReady: true,
      failClosedReasons: [], sourceStableKey: `cri-cue:cueSheetName=${addedSheet}|cueName=${addedCue}`}, subtitles: {}})
  voiceManifest.counts.voiceEntries = voiceManifest.counts.audioRuntimeReady = 3
  scenarioManifest.entries.unshift({voiceStableKey: addedKey})
  scenarioManifest.counts.voiceEntries = scenarioManifest.counts.scenarioReady = 3
  await writeFile(path.join(manifestRoot, 'manifest.v1.json'), JSON.stringify(voiceManifest))
  await writeFile(path.join(scenarioRoot, 'manifest.v1.json'), JSON.stringify(scenarioManifest))
  const extended = run(catalogA, releaseA)
  assert.equal(extended.status, 0, extended.stderr)
  const extendedCatalog = JSON.parse(await readFile(catalogA, 'utf8'))
  assert.deepEqual(extendedCatalog.entries.slice(0, 3), catalog.entries)
  assert.equal(extendedCatalog.entries[3].assetName, '0004-voice-cv_fixture_0_outgame.zip')
  for (const name of assetsA) {
    assert.deepEqual(await readFile(path.join(releaseA, 'assets', 'runtime-products-voice-v1', name)),
      await readFile(path.join(releaseB, 'assets', 'runtime-products-voice-v1', name)))
  }
  const extendedBytes = await readFile(catalogA)
  const rebuilt = run(catalogA, releaseA)
  assert.equal(rebuilt.status, 0, rebuilt.stderr)
  assert.deepEqual(await readFile(catalogA), extendedBytes)
  // Removing an old exact identity is a failure, not an implicit catalog deletion.
  voiceManifest.entries.pop()
  scenarioManifest.entries.pop()
  voiceManifest.counts.voiceEntries = voiceManifest.counts.audioRuntimeReady = 2
  scenarioManifest.counts.voiceEntries = scenarioManifest.counts.scenarioReady = 2
  await writeFile(path.join(manifestRoot, 'manifest.v1.json'), JSON.stringify(voiceManifest))
  await writeFile(path.join(scenarioRoot, 'manifest.v1.json'), JSON.stringify(scenarioManifest))
  const removed = run(catalogA, releaseA)
  assert.notEqual(removed.status, 0)
  assert.match(removed.stderr, /Existing voice delivery identity is absent from source/)
  assert.deepEqual(await readFile(catalogA), extendedBytes)
})

test('release catalog closes all runtime product roots within GitHub limits', async () => {
  const catalog = JSON.parse(await readFile(
    new URL('./public/catalogs/runtime-product-delivery.v1.json', import.meta.url),
    'utf8',
  ))
  assert.equal(catalog.schema, 'magius.runtime-product-delivery.v1')
  assert.deepEqual(catalog.activation.hosts, [
    'hiiraginemu.github.io',
    'magius3dviewer.pages.dev',
  ])
  assert.equal(catalog.activation.queryOverride, 'runtimeDelivery=release')
  assert.deepEqual({
    products: catalog.counts.products,
    stages: catalog.counts.stageProducts,
    enemies: catalog.counts.enemyModels,
    enemyVfx: catalog.counts.enemyVfxProducts,
    characterVfx: catalog.counts.characterVfxProducts,
    voice: catalog.counts.voiceProducts,
    releaseAssets: catalog.counts.releaseAssets,
  }, {
    products: 1834,
    stages: 594,
    enemies: 493,
    enemyVfx: 443,
    characterVfx: 211,
    voice: 93,
    releaseAssets: 1834,
  })
  assert.equal(catalog.entries.length, 1834)
  assert.equal(new Set(catalog.entries.map(entry => entry.rootPath)).size, 1834)
  assert.equal(new Set(catalog.entries.map(entry => `${entry.releaseTag}/${entry.assetName}`)).size, 1834)
  assert.deepEqual(catalog.releasePolicy.tags, [
    'runtime-products-v1-a',
    'runtime-products-v1-b',
    'runtime-products-enemy-models-v2',
    'runtime-products-voice-v1',
  ])
  assert.equal(
    catalog.entries.reduce((sum, entry) => sum + entry.packedBytes, 0),
    catalog.counts.packedBytes,
  )
  assert.ok(catalog.entries.every(entry => (
    Number.isInteger(entry.fileCount)
    && entry.fileCount > 0
    && Number.isInteger(entry.packedBytes)
    && entry.packedBytes > 0
    && entry.packedBytes < 2 * 1024 ** 3
    && entry.packUrl === `${catalog.deliveryGateway}/${entry.releaseTag}/${entry.assetName}`
    && entry.originUrl === `https://github.com/HiiragiNemu/Magi3Dviewer/releases/download/${entry.releaseTag}/${entry.assetName}`
  )))
  const releaseCounts = Object.groupBy(
    catalog.entries,
    entry => entry.releaseTag,
  )
  assert.equal(releaseCounts['runtime-products-v1-a'].length, 407)
  assert.equal(releaseCounts['runtime-products-v1-b'].length, 841)
  assert.equal(releaseCounts['runtime-products-enemy-models-v2'].length, 493)
  assert.equal(releaseCounts['runtime-products-voice-v1'].length, 93)
  assert.deepEqual(catalog.voiceArchive, {
    releaseTag: 'runtime-products-voice-v1',
    cueSheets: 93,
    voiceEntries: 1_302,
    scenarioEntriesJoined: 1_302,
    sourceBytes: 202_804_057,
    packedBytes: catalog.entries
      .filter(entry => entry.kind === 'voice')
      .reduce((sum, entry) => sum + entry.packedBytes, 0),
    maxAssetBytes: Math.max(...catalog.entries
      .filter(entry => entry.kind === 'voice')
      .map(entry => entry.packedBytes)),
    compression: 'ZIP_STORED',
    missing: 0,
    duplicateStableKeys: 0,
    sourceStableKeysPreserved: true,
  })
  assert.deepEqual(catalog.enemyTextureArchive, {
    status: 'PASS_ARCHIVE_LOCAL_CLOSURE',
    releaseTag: 'runtime-products-enemy-models-v2',
    modelProducts: 493,
    referenceRows: 22_372,
    runtimeUrlsResolvedInsideArchives: 22_372,
    globalUniqueTextureAuthorities: 1_969,
    sharedTextureAuthorityBytes: 564_810_901,
    perModelUniqueTextureCopies: 4_110,
    duplicatedTextureBytes: 1_833_602_636,
    workspaceMaterialProfileBytes: 72_164_705,
    archiveLocalMaterialProfileBytes: 70_811_498,
    archiveFiles: 6_817,
    archiveUnpackedBytes: 3_201_246_032,
    archivePackedBytes: 3_202_610_710,
    maxAsset: {
      stableKey: 'enemy-model|enemy_639007_battle_unit',
      assetName: '0390-enemy-model-enemy_639007_battle_unit.zip',
      bytes: 35_562_051,
    },
    missingInputs: 0,
    unsafePaths: 0,
    destinationCollisions: 0,
    workspaceMaterialProfilesUnchanged: true,
  })
  const enemy654001 = catalog.entries.find(
    entry => entry.stableKey === 'enemy-model|enemy_654001_battle_unit',
  )
  assert.deepEqual({
    releaseTag: enemy654001.releaseTag,
    assetName: enemy654001.assetName,
    fileCount: enemy654001.fileCount,
    unpackedBytes: enemy654001.unpackedBytes,
    packedBytes: enemy654001.packedBytes,
  }, {
    releaseTag: 'runtime-products-enemy-models-v2',
    assetName: '0472-enemy-model-enemy_654001_battle_unit.zip',
    fileCount: 18,
    unpackedBytes: 2_811_406,
    packedBytes: 2_815_264,
  })
  assert.doesNotMatch(runtimeSource, /600001|600002|600003/)
})

test('targeted enemy pack refresh fails closed without material profile and emits one exact deterministic closure', async () => {
  const fixtureRoot = fileURLToPath(new URL(
    './artifacts/verification/20260905-s6-runtime-product-enemy654001-pack-refresh/focused-fixture/',
    import.meta.url,
  ))
  const fixtureRepo = path.join(fixtureRoot, 'repo')
  const productRoot = path.join(fixtureRepo, 'public/enemies/models/enemy_fixture')
  const artifactRoot = path.join(fixtureRoot, 'release')
  const catalogPath = path.join(fixtureRoot, 'runtime-product-delivery.v1.json')
  const scriptPath = fileURLToPath(new URL(
    './scripts/build-runtime-product-release-packs.py',
    import.meta.url,
  ))
  const stableKey = 'enemy-model|enemy_fixture'
  const releaseTag = 'runtime-products-enemy-models-v2'
  const assetName = '0001-enemy-model-enemy_fixture.zip'
  const packUrl = `https://magius3dviewer-runtime-products.crynetsystemscell.workers.dev/${releaseTag}/${assetName}`
  const originUrl = `https://github.com/HiiragiNemu/Magi3Dviewer/releases/download/${releaseTag}/${assetName}`
  await rm(fixtureRoot, { recursive: true, force: true })
  await mkdir(productRoot, { recursive: true })
  const initialFiles = {
    'VisualRoot.fbxdata': Buffer.from([1, 2, 3, 4]),
    'enemy_fixture_color.png': Buffer.from([5, 6, 7]),
    'matcap_fixture.png': Buffer.from([8, 9]),
    'model-runtime.v1.json': Buffer.from(JSON.stringify({
      schema: 'magius.enemy-model-runtime.v1',
      runtime: { textureFiles: ['enemy_fixture_color.png', 'matcap_fixture.png'] },
    })),
  }
  for (const [name, bytes] of Object.entries(initialFiles)) {
    await writeFile(path.join(productRoot, name), bytes)
  }
  const initialUnpackedBytes = Object.values(initialFiles)
    .reduce((sum, bytes) => sum + bytes.byteLength, 0)
  const baselineCatalog = {
    schema: 'magius.runtime-product-delivery.v1',
    repository: 'HiiragiNemu/Magi3Dviewer',
    deliveryGateway: 'https://magius3dviewer-runtime-products.crynetsystemscell.workers.dev',
    activation: {
      hosts: ['hiiraginemu.github.io', 'magius3dviewer.pages.dev'],
      queryOverride: 'runtimeDelivery=release',
      localMode: 'prefer-workspace-files',
    },
    counts: {
      products: 1,
      stageProducts: 0,
      enemyModels: 1,
      enemyVfxProducts: 0,
      characterVfxProducts: 0,
      releaseAssets: 1,
      unpackedBytes: initialUnpackedBytes,
      packedBytes: 777,
    },
    entries: [{
      stableKey,
      kind: 'enemy-model',
      rootPath: '/enemies/models/enemy_fixture/',
      releaseTag,
      assetName,
      packUrl,
      originUrl,
      fileCount: 4,
      unpackedBytes: initialUnpackedBytes,
      packedBytes: 777,
    }],
  }
  const baselineBytes = `${JSON.stringify(baselineCatalog, null, 2)}\n`
  await writeFile(catalogPath, baselineBytes)
  const args = [
    scriptPath,
    '--repo-root', fixtureRepo,
    '--artifact-root', artifactRoot,
    '--catalog-output', catalogPath,
    '--only-stable-key', stableKey,
  ]
  const missingProfile = spawnSync('python', args, { encoding: 'utf8' })
  assert.notEqual(missingProfile.status, 0)
  assert.match(missingProfile.stderr, /missing required files: material-profile\.v1\.json/)
  assert.equal(await readFile(catalogPath, 'utf8'), baselineBytes)

  const materialProfile = `${JSON.stringify({
    schema: 'magius.enemy-material-profile.v1',
    profiles: [{
      textures: {
        fixture: {
          stableKey: 'texture-fixture',
          runtimeReady: true,
          runtimeUrl: '/enemies/textures/cab-fixture.png',
        },
      },
    }],
  })}\n`
  const sharedTexture = Buffer.from([10, 11, 12, 13])
  await mkdir(path.join(fixtureRepo, 'public/enemies/textures'), { recursive: true })
  await writeFile(
    path.join(fixtureRepo, 'public/enemies/textures/cab-fixture.png'),
    sharedTexture,
  )
  await writeFile(path.join(productRoot, 'material-profile.v1.json'), materialProfile)
  const firstRun = spawnSync('python', args, { encoding: 'utf8' })
  assert.equal(firstRun.status, 0, firstRun.stderr)
  const outputArchive = path.join(artifactRoot, 'assets', releaseTag, assetName)
  const firstArchiveBytes = await readFile(outputArchive)
  const firstCatalogBytes = await readFile(catalogPath)
  const refreshedCatalog = JSON.parse(firstCatalogBytes.toString('utf8'))
  const refreshed = refreshedCatalog.entries[0]
  const expectedMembers = [
    'VisualRoot.fbxdata',
    'enemy_fixture_color.png',
    'matcap_fixture.png',
    'material-profile.v1.json',
    'model-runtime.v1.json',
    'runtime-textures/cab-fixture.png',
  ]
  assert.deepEqual(
    [...storedZipMemberNames(firstArchiveBytes)].sort(),
    [...expectedMembers].sort(),
  )
  const releaseManifest = JSON.parse(await readFile(
    path.join(artifactRoot, 'release-assets-manifest.v1.json'),
    'utf8',
  ))
  assert.equal(refreshed.fileCount, expectedMembers.length)
  assert.equal(
    refreshed.unpackedBytes,
    initialUnpackedBytes
      + releaseManifest.target.files.find(file => file.path === 'material-profile.v1.json').bytes
      + sharedTexture.byteLength,
  )
  assert.equal(refreshed.packedBytes, firstArchiveBytes.byteLength)
  assert.equal(refreshedCatalog.counts.unpackedBytes, refreshed.unpackedBytes)
  assert.equal(refreshedCatalog.counts.packedBytes, refreshed.packedBytes)
  assert.deepEqual(await readdir(path.dirname(outputArchive)), [assetName])
  assert.deepEqual(
    releaseManifest.target.files.map(file => file.path),
    storedZipMemberNames(firstArchiveBytes),
  )
  assert.equal(releaseManifest.catalogDelta.previous.fileCount, 4)
  assert.equal(releaseManifest.catalogDelta.modified.fileCount, 6)

  const secondRun = spawnSync('python', args, { encoding: 'utf8' })
  assert.equal(secondRun.status, 0, secondRun.stderr)
  assert.deepEqual(await readFile(outputArchive), firstArchiveBytes)
  assert.deepEqual(await readFile(catalogPath), firstCatalogBytes)
})

test('reviewed 616 PNG references resolve to exact WebP payloads, never guessed neighbors', async t => {
  const runtime = await loadRuntimeModule(), nativeFetch = globalThis.fetch
  const descriptors = Object.fromEntries(['document', 'location'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const base = 'https://app.test/viewer/', root = '/stages/official/battle-616-00-01-001/'
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { baseURI: base } })
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL(base+'?runtimeDelivery=release') })
  t.after(() => {
    runtime.resetRuntimeProductDeliveryForTests(); globalThis.fetch = nativeFetch
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]
    }
  })
  for (const kind of ['col','nml']) {
    const name = `bg3d616_01_01_ground_${kind}`
    assert.equal(runtime.resolveCachedRuntimeAssetUrl(root+name+'.png'), base+root.slice(1)+name+'.webp')
    assert.equal(runtime.resolveCachedRuntimeAssetUrl(root+name+'.webp'), base+root.slice(1)+name+'.webp')
    assert.equal(runtime.resolveCachedRuntimeAssetUrl('https://external.test'+root+name+'.png'), 'https://external.test'+root+name+'.png')
  }
  const unknown=root+'unreviewed.png'
  assert.equal(runtime.resolveCachedRuntimeAssetUrl(unknown),base+unknown.slice(1))
  const other='/stages/official/neighbor/bg3d616_01_01_ground_col.png'
  assert.equal(runtime.resolveCachedRuntimeAssetUrl(other),base+other.slice(1))
  const bytes = new Uint8Array([82,73,70,70,0,0,0,0,87,69,66,80])
  const zip=storedZip({'bg3d616_01_01_ground_col.webp':bytes,'bg3d616_01_01_ground_nml.webp':bytes})
  const packUrl='https://pack.test/v1/616.zip'
  const manifest={schema:'magius.runtime-product-delivery.v1',repository:'fixture/repo',deliveryGateway:'https://pack.test',
    activation:{hosts:['app.test'],queryOverride:'runtimeDelivery=release',localMode:'prefer-workspace-files'},
    counts:{products:1,releaseAssets:1},entries:[{stableKey:'stage|battle-616-00-01-001',kind:'stage',rootPath:root,
      releaseTag:'v1',assetName:'616.zip',packUrl,originUrl:'https://github.com/fixture/repo/releases/download/v1/616.zip',fileCount:2,unpackedBytes:24,packedBytes:zip.byteLength}]}
  let packRequests=0
  globalThis.fetch=async input=>{
    if(String(input)===base+'catalogs/runtime-product-delivery.v1.json')return new Response(JSON.stringify(manifest))
    assert.equal(String(input),packUrl);packRequests++;return new Response(zip)
  }
  for (const kind of ['col','nml']) {
    const name=`bg3d616_01_01_ground_${kind}`
    const resolved=await runtime.resolveRuntimeAssetUrl(root+name+'.webp')
    assert.match(resolved,/^blob:/)
    assert.equal(runtime.resolveCachedRuntimeAssetUrl(root+name+'.png'),resolved)
    const response=await nativeFetch(resolved)
    assert.equal(response.headers.get('content-type'),'image/webp')
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes)
  }
  assert.equal(packRequests,1)
})

