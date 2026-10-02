import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { gzipSync } from 'node:zlib'
import {
  compressedAssetBrowserRoutePrefix,
  compressedAssetBrowserSuffix,
  fromBrowserSafeCompressedAssetUrl,
  magiusCompressedAssetProxyPlugin,
  parseSingleByteRange,
  toBrowserSafeCompressedAssetUrl,
} from './viteCompressedAssetProxy.mjs'

test('gzip asset URLs use an extensionless deterministic same-origin route', () => {
  const safe = toBrowserSafeCompressedAssetUrl('/models/VisualRoot.fbx.gz')
  assert.ok(safe.startsWith(compressedAssetBrowserRoutePrefix))
  assert.equal(safe.includes('.fbx'), false)
  assert.equal(safe.includes('.gz'), false)
  assert.equal(safe.endsWith('/'), false)
  assert.equal(
    fromBrowserSafeCompressedAssetUrl(safe),
    '/models/VisualRoot.fbx.gz',
  )

  const companion = toBrowserSafeCompressedAssetUrl('/models/normals.bin.gz?import#fixture')
  assert.equal(companion.includes('.bin'), false)
  assert.equal(
    fromBrowserSafeCompressedAssetUrl(companion),
    '/models/normals.bin.gz?import#fixture',
  )
})

test('local stage delivery observes files added after server startup and never returns the SPA for missing assets', async () => {
  const fixturePrefix = path.join(tmpdir(), 'magius-stage-live-')
  const root = mkdtempSync(fixturePrefix)
  let middleware
  magiusCompressedAssetProxyPlugin().configureServer({
    config: { root },
    middlewares: { use(value) { middleware = value } },
  })
  const server = createServer((request, response) => {
    middleware(request, response, () => response.writeHead(200, { 'Content-Type': 'text/html' }).end('<html>SPA fallback</html>'))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const route = '/stages/official/new-stage/scene-profile.json'
  try {
    const missing = await fetch(base + route)
    assert.equal(missing.status, 404)
    assert.doesNotMatch(await missing.text(), /<html>/)
    const dir = path.join(root, 'public/stages/official/new-stage')
    mkdirSync(dir, { recursive: true })
    const bytes = Buffer.from('{"version":1,"materials":[]}\n')
    writeFileSync(path.join(dir, 'scene-profile.json'), bytes)
    const full = await fetch(base + route)
    assert.equal(full.status, 200)
    assert.match(full.headers.get('content-type'), /^application\/json/)
    assert.equal(full.headers.get('content-disposition'), 'inline')
    assert.equal(full.headers.get('cache-control'), 'no-cache')
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes)
    const head = await fetch(base + route, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(Number(head.headers.get('content-length')), bytes.length)
    assert.equal((await head.arrayBuffer()).byteLength, 0)
    const range = await fetch(base + route, { headers: { Range: 'bytes=1-4' } })
    assert.equal(range.status, 206)
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(1, 5))
    const cached = await fetch(base + route, { headers: { 'If-None-Match': full.headers.get('etag') } })
    assert.equal(cached.status, 304)
    writeFileSync(path.join(dir, 'scene-profile.json'), Buffer.from('{"version":2}\n'))
    const changed = await fetch(base + route, { headers: { 'If-None-Match': full.headers.get('etag') } })
    assert.equal(changed.status, 200)
    assert.deepEqual(await changed.json(), { version: 2 })
    const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    writeFileSync(path.join(dir, 'ground.png'), pngBytes)
    const png = await fetch(base + route.replace('scene-profile.json', 'ground.png'))
    assert.equal(png.status, 200)
    assert.equal(png.headers.get('content-type'), 'image/png')
    assert.deepEqual(Buffer.from(await png.arrayBuffer()), pngBytes)
    const escaped = await fetch(base + '/stages/%2e%2e%2foutside.json')
    assert.equal(escaped.status, 403)
    const unrelated = await fetch(base + '/viewer/authoring')
    assert.equal(unrelated.status, 200)
    assert.match(await unrelated.text(), /SPA fallback/)
  } finally {
    await new Promise(resolve => server.close(resolve))
    assert.ok(path.resolve(root).startsWith(path.resolve(fixturePrefix)))
    rmSync(root, { recursive: true, force: true })
  }
})

test('legacy source routes remain readable but are no longer emitted', () => {
  assert.equal(
    fromBrowserSafeCompressedAssetUrl(`/models/VisualRoot.fbx${compressedAssetBrowserSuffix}`),
    '/models/VisualRoot.fbx.gz',
  )
  assert.notEqual(
    toBrowserSafeCompressedAssetUrl('/models/VisualRoot.fbx.gz'),
    `/models/VisualRoot.fbx${compressedAssetBrowserSuffix}`,
  )
})

test('production asset URLs and ordinary textures remain unchanged', () => {
  assert.equal(
    toBrowserSafeCompressedAssetUrl('/assets/VisualRoot.fbx-AbCd.fbxdata'),
    '/assets/VisualRoot.fbx-AbCd.fbxdata',
  )
  assert.equal(toBrowserSafeCompressedAssetUrl('/models/hair.png'), '/models/hair.png')
})

test('post-transform rewrites only Vite gzip URL modules', () => {
  const plugin = magiusCompressedAssetProxyPlugin()
  const transformed = plugin.transform(
    'export default "/models/VisualRoot.fbx.gz"\n',
    '/models/VisualRoot.fbx.gz?url',
  )
  assert.ok(transformed?.code.startsWith(`export default "${compressedAssetBrowserRoutePrefix}`))
  assert.equal(transformed?.code.includes('.gz'), false)
  assert.equal(plugin.transform('export default "/models/hair.png"', '/models/hair.png?url'), null)
})

test('single byte ranges support normal, open-ended, and suffix requests', () => {
  assert.deepEqual(parseSingleByteRange(undefined, 10), undefined)
  assert.deepEqual(parseSingleByteRange('bytes=2-5', 10), { start: 2, end: 5 })
  assert.deepEqual(parseSingleByteRange('bytes=7-', 10), { start: 7, end: 9 })
  assert.deepEqual(parseSingleByteRange('bytes=-3', 10), { start: 7, end: 9 })
  assert.equal(parseSingleByteRange('bytes=20-30', 10), null)
  assert.equal(parseSingleByteRange('bytes=1-2,4-5', 10), null)
})

test('middleware serves exact gzip bytes inline with Range and stable identity', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'magius-compressed-route-'))
  const fixtureDirectory = path.join(root, 'models')
  mkdirSync(fixtureDirectory)
  const sourcePath = path.join(fixtureDirectory, 'VisualRoot.fbx.gz')
  const sourceBytes = gzipSync(Buffer.from('Kaydara FBX Binary fixture'))
  writeFileSync(sourcePath, sourceBytes)

  let middleware
  const plugin = magiusCompressedAssetProxyPlugin()
  plugin.configureServer({
    config: { root },
    middlewares: { use(value) { middleware = value } },
  })
  assert.equal(typeof middleware, 'function')

  const server = createServer((request, response) => {
    middleware(request, response, () => response.writeHead(404).end('not handled'))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.equal(typeof address, 'object')
  const safePath = toBrowserSafeCompressedAssetUrl('/models/VisualRoot.fbx.gz')
  const url = `http://127.0.0.1:${address.port}${safePath}`

  try {
    const full = await fetch(url)
    assert.equal(full.status, 200)
    assert.equal(full.headers.get('content-type'), 'application/x-magius-compressed-asset')
    assert.equal(full.headers.get('content-disposition'), 'inline')
    assert.equal(full.headers.get('content-encoding'), null)
    assert.equal(full.headers.get('accept-ranges'), 'bytes')
    assert.equal(
      full.headers.get('x-magius-asset-identity'),
      encodeURIComponent('/models/VisualRoot.fbx.gz'),
    )
    const fullBytes = Buffer.from(await full.arrayBuffer())
    assert.deepEqual(fullBytes, sourceBytes)
    assert.deepEqual([...fullBytes.subarray(0, 2)], [0x1f, 0x8b])

    const partial = await fetch(url, { headers: { Range: 'bytes=1-4' } })
    assert.equal(partial.status, 206)
    assert.equal(partial.headers.get('content-range'), `bytes 1-4/${sourceBytes.length}`)
    assert.deepEqual(Buffer.from(await partial.arrayBuffer()), sourceBytes.subarray(1, 5))

    const head = await fetch(url, { method: 'HEAD', headers: { Range: 'bytes=0-1' } })
    assert.equal(head.status, 206)
    assert.equal(head.headers.get('content-length'), '2')
    assert.equal((await head.arrayBuffer()).byteLength, 0)

    const invalid = await fetch(url, { headers: { Range: 'bytes=999-' } })
    assert.equal(invalid.status, 416)
    assert.equal(invalid.headers.get('content-range'), `bytes */${sourceBytes.length}`)
  } finally {
    await new Promise(resolve => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  }
})


test('uncompressed native index/channel binaries use the same byte-exact safe transport', async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'magius-raw-native-'));mkdirSync(path.join(root,'models'))
 const bytes=Buffer.from([0,0,128,63,0,0,0,64,4,3,2,1]),name='/models/native-extra-channels.bin'
 writeFileSync(path.join(root,name),bytes)
 const plugin=magiusCompressedAssetProxyPlugin(),safe=toBrowserSafeCompressedAssetUrl(name+'?v=exact')
 assert.ok(safe.startsWith(compressedAssetBrowserRoutePrefix));assert.doesNotMatch(safe,/\.bin/)
 assert.equal(fromBrowserSafeCompressedAssetUrl(safe),name+'?v=exact')
 assert.ok(plugin.transform('export default "'+name+'"',name+'?url')?.code.includes(compressedAssetBrowserRoutePrefix))
 let middleware;plugin.configureServer({config:{root},middlewares:{use(fn){middleware=fn}}})
 const server=createServer((req,res)=>middleware(req,res,()=>res.writeHead(404).end()))
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port
 try{
  const response=await fetch(base+safe);assert.equal(response.status,200);assert.equal(response.headers.get('x-magius-source-suffix'),'binary');assert.equal(response.headers.get('content-encoding'),null)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes)
  const range=await fetch(base+safe,{headers:{Range:'bytes=4-7'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(4,8))
  assert.equal(fromBrowserSafeCompressedAssetUrl(compressedAssetBrowserRoutePrefix+Buffer.from('/private.json').toString('base64url')),null)
  const escaped=toBrowserSafeCompressedAssetUrl('/../outside.bin');assert.equal((await fetch(base+escaped)).status,403)
 }finally{await new Promise(resolve=>server.close(resolve));rmSync(root,{recursive:true,force:true})}
})
