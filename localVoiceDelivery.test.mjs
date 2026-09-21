import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { magiusCompressedAssetProxyPlugin } from './viteCompressedAssetProxy.mjs'

async function fixture(t, hook = 'configureServer') {
  const root = mkdtempSync(path.join(tmpdir(), 'magius-voice-http-'))
  const cv = path.join(root, 'Cv')
  mkdirSync(path.join(cv, 'cv_100101_outgame'), { recursive: true })
  // Transport fixture, not evidence of an audible or decodable voice.
  const bytes = Buffer.from('OggS0123456789abcdefghijklmnopqrstuvwxyz')
  writeFileSync(path.join(cv, 'cv_100101_outgame', 'voice.ogg'), bytes)
  writeFileSync(path.join(cv, 'empty.ogg'), Buffer.alloc(0))
  const old = process.env.MAGIUS_LOCAL_VOICE_ROOT
  let middleware
  try {
    process.env.MAGIUS_LOCAL_VOICE_ROOT = cv
    magiusCompressedAssetProxyPlugin()[hook]({
      config: { root }, middlewares: { use(fn) { middleware = fn } },
    })
  } finally {
    if (old === undefined) delete process.env.MAGIUS_LOCAL_VOICE_ROOT
    else process.env.MAGIUS_LOCAL_VOICE_ROOT = old
  }
  const server = createServer((req, res) => middleware(req, res, () => {
    res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html>SPA fallback</html>')
  }))
  // Windows may allocate an ephemeral port rejected by Fetch's bad-port
  // policy. Rebind this private fixture only; do not change host networking.
  for (let attempt = 0; ; attempt++) {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const probe = await fetch(`http://127.0.0.1:${server.address().port}/__fixture_ready`)
      await probe.arrayBuffer()
      break
    } catch (error) {
      if (error?.cause?.message !== 'bad port' || attempt >= 31) throw error
      await new Promise(resolve => server.close(resolve))
    }
  }
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    assert.equal(path.dirname(root), path.resolve(tmpdir()))
    assert.ok(path.basename(root).startsWith('magius-voice-http-'))
    rmSync(root, { recursive: true, force: true })
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  return { root, origin, url: origin + '/voice/Cv/cv_100101_outgame/voice.ogg', bytes }
}

test('built local preview installs the same extensionless voice endpoint', async t => {
  const { origin, bytes } = await fixture(t, 'configurePreviewServer')
  const response = await fetch(origin + '/__magius_voice__/cv_100101_outgame/voice')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/vnd.magius.voice-payload')
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
})

test('project-owned exact cue supplements are served before shared legacy files', async t => {
  const { root, origin, url, bytes } = await fixture(t)
  const folder = path.join(root, 'public', 'voice', 'Cv', 'cv_100101_outgame')
  mkdirSync(folder, { recursive: true })
  const supplement = Buffer.from('OggSproject-owned-exact-cue')
  writeFileSync(path.join(folder, 'supplement.ogg'), supplement)
  const added = await fetch(origin + '/voice/Cv/cv_100101_outgame/supplement.ogg', { headers: { Range: 'bytes=0-' } })
  assert.equal(added.status, 206)
  assert.deepEqual(Buffer.from(await added.arrayBuffer()), supplement)
  assert.deepEqual(Buffer.from(await (await fetch(url)).arrayBuffer()), bytes)
  writeFileSync(path.join(folder, 'voice.ogg'), supplement)
  assert.deepEqual(Buffer.from(await (await fetch(url)).arrayBuffer()), supplement)
})

test('local voice GET and HEAD return exact inline OGG transport bytes', async t => {
  const { url, bytes } = await fixture(t)
  const res = await fetch(url)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'audio/ogg')
  assert.equal(res.headers.get('content-disposition'), 'inline')
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes)
  const head = await fetch(url, { method: 'HEAD' })
  assert.equal(head.headers.get('content-length'), String(bytes.length))
  assert.equal((await head.arrayBuffer()).byteLength, 0)
})

test('extensionless application voice route preserves bytes, ranges and cache without media MIME', async t => {
  const { origin, bytes } = await fixture(t)
  const url = origin + '/__magius_voice__/cv_100101_outgame/voice'
  const full = await fetch(url)
  assert.equal(full.status, 200)
  assert.equal(full.headers.get('content-type'), 'application/vnd.magius.voice-payload')
  assert.equal(full.headers.get('content-disposition'), 'inline')
  assert.equal(full.headers.get('x-content-type-options'), 'nosniff')
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes)
  const head = await fetch(url, { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(head.headers.get('content-length'), String(bytes.length))
  assert.equal((await head.arrayBuffer()).byteLength, 0)
  for (const [range, expected] of [['bytes=0-3', bytes.subarray(0, 4)], ['bytes=0-', bytes], ['bytes=-4', bytes.subarray(-4)]]) {
    const res = await fetch(url, { headers: { Range: range } })
    assert.equal(res.status, 206)
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), expected)
  }
  assert.equal((await fetch(url, { headers: { Range: 'bytes=999-' } })).status, 416)
  assert.equal((await fetch(url, { headers: { 'If-None-Match': head.headers.get('etag') } })).status, 304)
  const options = await fetch(url, { method: 'OPTIONS' })
  assert.equal(options.status, 204)
  assert.match(options.headers.get('access-control-allow-headers'), /Range/)
  assert.equal((await fetch(url, { method: 'POST' })).status, 405)
})

test('extensionless voice identities reject traversal, file extensions and missing cues without fallback', async t => {
  const { origin } = await fixture(t)
  for (const id of ['cv_100101_outgame/missing', 'cv_100101_outgame/voice.ogg', '..%2FCv%2Fcv_100101_outgame%2Fvoice', '%ZZ/voice', 'cv_100101_outgame/voice/extra']) {
    const res = await fetch(origin + '/__magius_voice__/' + id)
    assert.equal(res.status, 404, id)
    assert.match(res.headers.get('content-type'), /^text\/plain/)
  }
})

test('local voice seeking honors closed, open-ended and suffix Range, plus HEAD', async t => {
  const { url, bytes } = await fixture(t)
  for (const [range, start, end] of [['bytes=0-3', 0, 3], ['bytes=8-', 8, bytes.length-1], ['bytes=-4', bytes.length-4, bytes.length-1]]) {
    const res = await fetch(url, { headers: { Range: range } })
    assert.equal(res.status, 206, range)
    assert.equal(res.headers.get('content-range'), `bytes ${start}-${end}/${bytes.length}`)
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes.subarray(start, end+1))
  }
  const head = await fetch(url, { method: 'HEAD', headers: { Range: 'bytes=0-3' } })
  assert.equal(head.status, 206)
  assert.equal(head.headers.get('content-length'), '4')
  assert.equal((await head.arrayBuffer()).byteLength, 0)
})

test('local voice invalid and empty ranges return 416 rather than the full download', async t => {
  const { url, origin, bytes } = await fixture(t)
  for (const range of ['bytes=999-', 'bytes=1-2,5-6', 'bytes=-0']) {
    const res = await fetch(url, { headers: { Range: range } })
    assert.equal(res.status, 416)
    assert.equal(res.headers.get('content-range'), `bytes */${bytes.length}`)
    assert.equal((await res.arrayBuffer()).byteLength, 0)
  }
  assert.equal((await fetch(origin+'/voice/Cv/empty.ogg', { headers: { Range: 'bytes=0-' } })).status, 416)
})

test('missing or invalid local voice URLs are explicit errors, never SPA HTML 200', async t => {
  const { origin } = await fixture(t)
  for (const file of ['missing.ogg', 'not-audio.txt', '%ZZ.ogg', '..%2Fsecret.ogg']) {
    const res = await fetch(origin+'/voice/Cv/'+file)
    assert.equal(res.status, 404, file)
    assert.match(res.headers.get('content-type'), /^text\/plain/)
  }
})

test('local voice cache validators and If-Range preserve representation identity', async t => {
  const { url } = await fixture(t)
  const head = await fetch(url, { method: 'HEAD' })
  const etag = head.headers.get('etag')
  assert.ok(etag)
  const cached = await fetch(url, { headers: { 'If-None-Match': etag } })
  assert.equal(cached.status, 304)
  assert.equal((await cached.arrayBuffer()).byteLength, 0)
  const stale = await fetch(url, { headers: { Range: 'bytes=0-3', 'If-Range': '"different-version"' } })
  assert.equal(stale.status, 200)
  const current = await fetch(url, { headers: { Range: 'bytes=0-3', 'If-Range': head.headers.get('last-modified') } })
  assert.equal(current.status, 206)
})

test('local voice CORS preflight exposes Range metadata and leaves mutations disabled', async t => {
  const { url } = await fixture(t)
  const res = await fetch(url, { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:4174', 'Access-Control-Request-Headers': 'range' } })
  assert.equal(res.status, 204)
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
  assert.match(res.headers.get('access-control-allow-headers'), /Range/i)
  assert.equal((await fetch(url, { method: 'POST' })).status, 405)
  const partial = await fetch(url, { headers: { Range: 'bytes=0-3' } })
  assert.match(partial.headers.get('access-control-expose-headers'), /Content-Range/)
})
