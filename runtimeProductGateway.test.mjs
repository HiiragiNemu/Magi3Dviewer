import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import gateway, {
  resetRuntimeProductGatewayForTests,
} from './workers/runtime-product-gateway.mjs'

const repository = 'HiiragiNemu/Magi3Dviewer'
const apiRoot = `https://api.github.com/repos/${repository}`
const testCredential = 'fixture-server-credential'
const healthAssetName = '0660-stage-dungeon-10000-bg-3d-intro-0001-001.zip'
const baseEnv = Object.freeze({
  GITHUB_RELEASE_TOKEN: testCredential,
  RUNTIME_PRODUCT_HEALTH_RELEASE_TAG: 'runtime-products-v1-a',
  RUNTIME_PRODUCT_HEALTH_ASSET_NAME: healthAssetName,
})
const diagnosticHeader = Object.freeze({
  phase: 'X-Runtime-Product-Gateway-Phase',
  error: 'X-Runtime-Product-Gateway-Error',
  upstreamStatus: 'X-Runtime-Product-Gateway-Upstream-Status',
})
const signedUrlFixture = 'https://release-assets.githubusercontent.com/signed-sensitive-fixture'
const invalidSignedUrlFixture = 'http://release-assets.githubusercontent.com/signed-sensitive-fixture'
const upstreamBodyFixture = 'raw-upstream-sensitive-fixture'
const exceptionFixture = 'exception-sensitive-fixture'
const invalidHeaderCredential = 'header-sensitive-fixture\r\ninvalid'

function releaseUrl(tag) {
  return `${apiRoot}/releases/tags/${tag}`
}

function assetsUrl(releaseId, page = 1) {
  return `${apiRoot}/releases/${releaseId}/assets?per_page=100&page=${page}`
}

function assetRecord(id, name, size = 4) {
  return {
    id,
    name,
    size,
    state: 'uploaded',
    url: `${apiRoot}/releases/assets/${id}`,
  }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function authorization(init) {
  return new Headers(init?.headers).get('Authorization')
}

function assertMetadataRequest(init, credential = testCredential) {
  const headers = new Headers(init?.headers)
  assert.equal(init?.method, 'GET')
  assert.equal(init?.redirect, 'manual')
  assert.equal(headers.get('Accept'), 'application/vnd.github+json')
  assert.equal(headers.get('Authorization'), `Bearer ${credential}`)
}

async function responseSurface(response) {
  const clone = response.clone()
  const headers = JSON.stringify([...clone.headers])
  const body = await clone.text()
  return `${headers}\n${body}`
}

function exposedHeaderNames(response) {
  return new Set(
    (response.headers.get('Access-Control-Expose-Headers') ?? '')
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(Boolean),
  )
}

async function assertDiagnostic(response, expected) {
  assert.equal(response.headers.get(diagnosticHeader.phase), expected.phase)
  assert.equal(response.headers.get(diagnosticHeader.error), expected.error)
  assert.equal(
    response.headers.get(diagnosticHeader.upstreamStatus),
    expected.upstreamStatus === undefined ? null : String(expected.upstreamStatus),
  )
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*')
  const exposed = exposedHeaderNames(response)
  for (const header of Object.values(diagnosticHeader)) {
    assert.equal(exposed.has(header.toLowerCase()), true, `CORS must expose ${header}`)
  }
  const surface = await responseSurface(response)
  for (const secret of [
    testCredential,
    signedUrlFixture,
    invalidSignedUrlFixture,
    upstreamBodyFixture,
    exceptionFixture,
    invalidHeaderCredential,
  ]) {
    assert.equal(surface.includes(secret), false, `response leaked ${secret}`)
  }
}

function assertNoDiagnostic(response) {
  assert.equal(response.headers.get(diagnosticHeader.phase), null)
  assert.equal(response.headers.get(diagnosticHeader.error), null)
  assert.equal(response.headers.get(diagnosticHeader.upstreamStatus), null)
}

test('private release gateway authenticates all authorized tags and streams full GET plus Range/206', async () => {
  const nativeFetch = globalThis.fetch
  const calls = []
  const assetA = assetRecord(201, 'fixture-a.zip')
  const assetB = assetRecord(202, 'fixture-b.zip')
  const signedB = signedUrlFixture
  resetRuntimeProductGatewayForTests()
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    calls.push({ url, init })
    if (url === releaseUrl('runtime-products-v1-a')) {
      assertMetadataRequest(init)
      return json({ id: 101, tag_name: 'runtime-products-v1-a' })
    }
    if (url === assetsUrl(101)) {
      assertMetadataRequest(init)
      return json([assetA])
    }
    if (url === releaseUrl('runtime-products-v1-b')) {
      assertMetadataRequest(init)
      return json({ id: 102, tag_name: 'runtime-products-v1-b' })
    }
    if (url === assetsUrl(102)) {
      assertMetadataRequest(init)
      return json([assetB])
    }
    if (url === assetA.url) {
      assert.equal(authorization(init), `Bearer ${testCredential}`)
      assert.equal(new Headers(init.headers).get('Accept'), 'application/octet-stream')
      assert.equal(init.redirect, 'manual')
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: {
          'Content-Length': '4',
          'Accept-Ranges': 'bytes',
          ETag: 'fixture-a',
        },
      })
    }
    if (url === assetB.url) {
      assert.equal(authorization(init), `Bearer ${testCredential}`)
      assert.equal(new Headers(init.headers).get('Range'), 'bytes=1-2')
      assert.equal(init.redirect, 'manual')
      return new Response(null, { status: 302, headers: { Location: signedB } })
    }
    if (url === signedB) {
      assert.equal(authorization(init), null)
      assert.equal(new Headers(init.headers).get('Range'), 'bytes=1-2')
      return new Response(new Uint8Array([8, 9]), {
        status: 206,
        headers: {
          'Content-Length': '2',
          'Content-Range': 'bytes 1-2/4',
          'Accept-Ranges': 'bytes',
          ETag: 'fixture-b',
        },
      })
    }
    throw new Error(`Unexpected upstream request: ${url}`)
  }

  try {
    const full = await gateway.fetch(new Request(
      'https://gateway.example/runtime-products-v1-a/fixture-a.zip',
    ), baseEnv)
    const fullSurface = await responseSurface(full)
    assert.equal(full.status, 200)
    assert.equal(full.headers.get('Access-Control-Allow-Origin'), '*')
    assert.equal(full.headers.get('Cache-Control'), 'public, max-age=31536000, immutable')
    assert.equal(full.headers.get('Content-Type'), 'application/zip')
    assert.equal(full.headers.get('Content-Disposition'), null)
    assertNoDiagnostic(full)
    assert.deepEqual(
      new Uint8Array(await full.arrayBuffer()),
      new Uint8Array([1, 2, 3, 4]),
    )

    const partial = await gateway.fetch(new Request(
      'https://gateway.example/runtime-products-v1-b/fixture-b.zip',
      { headers: { Range: 'bytes=1-2' } },
    ), baseEnv)
    const partialSurface = await responseSurface(partial)
    assert.equal(partial.status, 206)
    assert.equal(partial.headers.get('Content-Range'), 'bytes 1-2/4')
    assert.equal(partial.headers.get('Accept-Ranges'), 'bytes')
    assertNoDiagnostic(partial)
    assert.deepEqual(
      new Uint8Array(await partial.arrayBuffer()),
      new Uint8Array([8, 9]),
    )
    assert.doesNotMatch(fullSurface, new RegExp(testCredential))
    assert.doesNotMatch(partialSurface, new RegExp(testCredential))
    assert.equal(calls.some(call => call.url === signedB && authorization(call.init)), false)
  } finally {
    resetRuntimeProductGatewayForTests()
    globalThis.fetch = nativeFetch
  }
})

test('health readiness authenticates and probes one exact release byte', async () => {
  const nativeFetch = globalThis.fetch
  const calls = []
  const probeAsset = assetRecord(660, healthAssetName, 7927)
  resetRuntimeProductGatewayForTests()
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    calls.push({ url, init })
    if (url === releaseUrl('runtime-products-v1-a')) {
      return json({ id: 101, tag_name: 'runtime-products-v1-a' })
    }
    if (url === assetsUrl(101)) return json([probeAsset])
    if (url === probeAsset.url) {
      assert.equal(authorization(init), `Bearer ${testCredential}`)
      assert.equal(new Headers(init.headers).get('Range'), 'bytes=0-0')
      return new Response(new Uint8Array([80]), {
        status: 206,
        headers: {
          'Content-Length': '1',
          'Content-Range': 'bytes 0-0/7927',
          'Accept-Ranges': 'bytes',
        },
      })
    }
    throw new Error(`Unexpected upstream request: ${url}`)
  }

  try {
    const health = await gateway.fetch(
      new Request('https://gateway.example/healthz'),
      baseEnv,
    )
    assert.equal(health.status, 200)
    assert.equal(health.headers.get('Cache-Control'), 'no-store')
    assertNoDiagnostic(health)
    assert.deepEqual(await health.json(), {
      schema: 'magius.runtime-product-gateway.v1',
      repository,
      releaseTags: ['runtime-products-v1-a', 'runtime-products-v1-b', 'runtime-products-enemy-models-v2', 'runtime-products-voice-v1'],
      status: 'ready',
      probe: {
        releaseTag: 'runtime-products-v1-a',
        assetName: healthAssetName,
        assetBytes: 7927,
        httpStatus: 206,
      },
    })
    assert.equal(calls.filter(call => authorization(call.init)).length, 3)
  } finally {
    resetRuntimeProductGatewayForTests()
    globalThis.fetch = nativeFetch
  }
})

test('voice tag authenticates exact asset GET and Range and can serve as a real health probe', async () => {
  const nativeFetch = globalThis.fetch
  const tag = 'runtime-products-voice-v1'
  const asset = assetRecord(17001, 'fixture-voice.zip', 4)
  resetRuntimeProductGatewayForTests()
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url === releaseUrl(tag)) {
      assertMetadataRequest(init)
      return json({id: 170, tag_name: tag})
    }
    if (url === assetsUrl(170)) {
      assertMetadataRequest(init)
      return json([asset])
    }
    assert.equal(url, asset.url)
    assert.equal(authorization(init), `Bearer ${testCredential}`)
    const range = new Headers(init.headers).get('Range')
    return new Response(new Uint8Array(range ? [80] : [80, 75, 3, 4]), {
      status: range ? 206 : 200,
      headers: {'Content-Length': range ? '1' : '4', ...(range ? {'Content-Range': 'bytes 0-0/4'} : {})},
    })
  }
  try {
    for (const range of [false, true]) {
      const response = await gateway.fetch(new Request(`https://gateway.example/${tag}/${asset.name}`, {
        headers: range ? {Range: 'bytes=0-0'} : {},
      }), baseEnv)
      assert.equal(response.status, range ? 206 : 200)
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*')
      assert.equal(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable')
      assert.equal(response.headers.get('Content-Range'), range ? 'bytes 0-0/4' : null)
      assert.equal((await responseSurface(response)).includes(testCredential), false)
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array(range ? [80] : [80, 75, 3, 4]))
    }
    const health = await gateway.fetch(new Request('https://gateway.example/healthz'), {
      ...baseEnv, RUNTIME_PRODUCT_HEALTH_RELEASE_TAG: tag, RUNTIME_PRODUCT_HEALTH_ASSET_NAME: asset.name,
    })
    assert.equal(health.status, 200)
    assert.deepEqual((await health.json()).probe, {releaseTag: tag, assetName: asset.name, assetBytes: 4, httpStatus: 206})
    const missing = await gateway.fetch(new Request(`https://gateway.example/${tag}/missing.zip`), baseEnv)
    assert.equal(missing.status, 404)
    await assertDiagnostic(missing, {phase: 'asset-index', error: 'asset-not-found'})
  } finally {
    globalThis.fetch = nativeFetch
    resetRuntimeProductGatewayForTests()
  }
})

test('health stays false-ready for configuration, credential, index and exact probe failures', async t => {
  const nativeFetch = globalThis.fetch
  try {
    await t.test('missing credential', async () => {
      resetRuntimeProductGatewayForTests()
      let fetches = 0
      globalThis.fetch = async () => { fetches++; return json({}) }
      const response = await gateway.fetch(new Request('https://gateway.example/healthz'), {})
      assert.equal(response.status, 503)
      assert.equal((await response.json()).reason, 'credential-missing')
      assert.equal(fetches, 0)
    })

    await t.test('rejected credential', async () => {
      resetRuntimeProductGatewayForTests()
      globalThis.fetch = async () => new Response(null, { status: 401 })
      const response = await gateway.fetch(
        new Request('https://gateway.example/healthz'),
        baseEnv,
      )
      assert.equal(response.status, 503)
      const body = await response.json()
      assert.equal(body.status, 'not-ready')
      assert.equal(body.reason, 'credential-rejected')
      assert.doesNotMatch(JSON.stringify(body), new RegExp(testCredential))
    })

    await t.test('exact asset missing', async () => {
      resetRuntimeProductGatewayForTests()
      globalThis.fetch = async input => {
        const url = String(input)
        if (url === releaseUrl('runtime-products-v1-a')) {
          return json({ id: 101, tag_name: 'runtime-products-v1-a' })
        }
        if (url === assetsUrl(101)) return json([])
        throw new Error(`Unexpected upstream request: ${url}`)
      }
      const response = await gateway.fetch(
        new Request('https://gateway.example/healthz'),
        baseEnv,
      )
      assert.equal(response.status, 503)
      assert.equal((await response.json()).reason, 'asset-not-found')
    })

    await t.test('exact asset probe fails', async () => {
      resetRuntimeProductGatewayForTests()
      const probeAsset = assetRecord(660, healthAssetName, 7927)
      globalThis.fetch = async input => {
        const url = String(input)
        if (url === releaseUrl('runtime-products-v1-a')) {
          return json({ id: 101, tag_name: 'runtime-products-v1-a' })
        }
        if (url === assetsUrl(101)) return json([probeAsset])
        if (url === probeAsset.url) return new Response(null, { status: 500 })
        throw new Error(`Unexpected upstream request: ${url}`)
      }
      const response = await gateway.fetch(
        new Request('https://gateway.example/healthz'),
        baseEnv,
      )
      assert.equal(response.status, 503)
      const body = await response.json()
      assert.equal(body.status, 'not-ready')
      assert.equal(body.reason, 'origin-asset-failed')
    })

    await t.test('partial probe total must match the resolved asset size', async () => {
      resetRuntimeProductGatewayForTests()
      const probeAsset = assetRecord(660, healthAssetName, 7927)
      globalThis.fetch = async input => {
        const url = String(input)
        if (url === releaseUrl('runtime-products-v1-a')) {
          return json({ id: 101, tag_name: 'runtime-products-v1-a' })
        }
        if (url === assetsUrl(101)) return json([probeAsset])
        if (url === probeAsset.url) {
          return new Response(new Uint8Array([80]), {
            status: 206,
            headers: {
              'Content-Length': '1',
              'Content-Range': 'bytes 0-0/7928',
            },
          })
        }
        throw new Error(`Unexpected upstream request: ${url}`)
      }
      const response = await gateway.fetch(
        new Request('https://gateway.example/healthz'),
        baseEnv,
      )
      assert.equal(response.status, 503)
      assert.equal((await response.json()).reason, 'asset-probe-range-invalid')
    })

    await t.test('full probe explicit content length must match the resolved asset size', async () => {
      resetRuntimeProductGatewayForTests()
      const probeAsset = assetRecord(660, healthAssetName, 7927)
      globalThis.fetch = async input => {
        const url = String(input)
        if (url === releaseUrl('runtime-products-v1-a')) {
          return json({ id: 101, tag_name: 'runtime-products-v1-a' })
        }
        if (url === assetsUrl(101)) return json([probeAsset])
        if (url === probeAsset.url) {
          return new Response(new Uint8Array([80]), {
            status: 200,
            headers: { 'Content-Length': '1' },
          })
        }
        throw new Error(`Unexpected upstream request: ${url}`)
      }
      const response = await gateway.fetch(
        new Request('https://gateway.example/healthz'),
        baseEnv,
      )
      assert.equal(response.status, 503)
      assert.equal((await response.json()).reason, 'asset-probe-size-mismatch')
    })

    await t.test('ten full asset pages fail closed as a truncated index', async () => {
      resetRuntimeProductGatewayForTests()
      const listCalls = []
      globalThis.fetch = async input => {
        const url = String(input)
        if (url === releaseUrl('runtime-products-v1-a')) {
          return json({ id: 101, tag_name: 'runtime-products-v1-a' })
        }
        const match = /[?&]page=(\d+)$/.exec(url)
        if (url.startsWith(`${apiRoot}/releases/101/assets?`) && match) {
          const page = Number(match[1])
          listCalls.push(page)
          return json(Array.from({ length: 100 }, (_value, index) => (
            assetRecord(
              page * 10_000 + index,
              `bounded-page-${page}-${String(index).padStart(3, '0')}.zip`,
            )
          )))
        }
        throw new Error(`Unexpected upstream request: ${url}`)
      }
      const response = await gateway.fetch(
        new Request('https://gateway.example/healthz'),
        baseEnv,
      )
      assert.equal(response.status, 503)
      assert.equal((await response.json()).reason, 'origin-asset-list-truncated')
      assert.deepEqual(listCalls, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    })
  } finally {
    resetRuntimeProductGatewayForTests()
    globalThis.fetch = nativeFetch
  }
})

test('asset route fails closed for missing or bad credential and exact 404s', async t => {
  const nativeFetch = globalThis.fetch
  try {
    await t.test('missing credential', async () => {
      resetRuntimeProductGatewayForTests()
      let fetches = 0
      globalThis.fetch = async () => { fetches++; return json({}) }
      const response = await gateway.fetch(new Request(
        'https://gateway.example/runtime-products-v1-a/fixture.zip',
      ), {})
      assert.equal(response.status, 503)
      assert.equal(fetches, 0)
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*')
    })

    await t.test('bad credential', async () => {
      resetRuntimeProductGatewayForTests()
      globalThis.fetch = async (_input, init) => {
        assert.equal(authorization(init), `Bearer ${testCredential}`)
        return new Response(null, { status: 403 })
      }
      const response = await gateway.fetch(new Request(
        'https://gateway.example/runtime-products-v1-a/fixture.zip',
      ), baseEnv)
      assert.equal(response.status, 503)
      assert.equal(await response.text(), 'Runtime product gateway unavailable\n')
    })

    await t.test('release missing', async () => {
      resetRuntimeProductGatewayForTests()
      globalThis.fetch = async () => new Response(null, { status: 404 })
      const response = await gateway.fetch(new Request(
        'https://gateway.example/runtime-products-v1-a/fixture.zip',
      ), baseEnv)
      assert.equal(response.status, 404)
    })

    await t.test('asset missing', async () => {
      resetRuntimeProductGatewayForTests()
      globalThis.fetch = async input => {
        const url = String(input)
        if (url === releaseUrl('runtime-products-v1-a')) {
          return json({ id: 101, tag_name: 'runtime-products-v1-a' })
        }
        if (url === assetsUrl(101)) return json([])
        throw new Error(`Unexpected upstream request: ${url}`)
      }
      const response = await gateway.fetch(new Request(
        'https://gateway.example/runtime-products-v1-a/fixture.zip',
      ), baseEnv)
      assert.equal(response.status, 404)
    })
  } finally {
    resetRuntimeProductGatewayForTests()
    globalThis.fetch = nativeFetch
  }
})

test('gateway resolves paginated release assets without putting credentials in cache identity', async () => {
  const nativeFetch = globalThis.fetch
  const target = assetRecord(9999, 'page-two-target.zip')
  const firstPage = Array.from({ length: 100 }, (_value, index) => (
    assetRecord(1000 + index, `page-one-${String(index).padStart(3, '0')}.zip`)
  ))
  const listCalls = []
  resetRuntimeProductGatewayForTests()
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url === releaseUrl('runtime-products-v1-a')) {
      return json({ id: 101, tag_name: 'runtime-products-v1-a' })
    }
    if (url === assetsUrl(101, 1)) {
      listCalls.push(url)
      return json(firstPage)
    }
    if (url === assetsUrl(101, 2)) {
      listCalls.push(url)
      return json([target])
    }
    if (url === target.url) {
      assert.equal(authorization(init), 'Bearer rotated-test-credential')
      return new Response(new Uint8Array([7]), { status: 200 })
    }
    throw new Error(`Unexpected upstream request: ${url}`)
  }

  try {
    const response = await gateway.fetch(new Request(
      'https://gateway.example/runtime-products-v1-a/page-two-target.zip',
    ), {
      ...baseEnv,
      GITHUB_RELEASE_TOKEN: 'rotated-test-credential',
    })
    assert.equal(response.status, 200)
    assert.deepEqual(listCalls, [assetsUrl(101, 1), assetsUrl(101, 2)])
  } finally {
    resetRuntimeProductGatewayForTests()
    globalThis.fetch = nativeFetch
  }
})

test('enemy model v2 route resolves the exact 493-asset release across five pages', async () => {
  const nativeFetch = globalThis.fetch
  const releaseTag = 'runtime-products-enemy-models-v2'
  const releaseId = 103
  const entries = Array.from({ length: 493 }, (_value, index) => assetRecord(
    20000 + index,
    `${String(index + 1).padStart(4, '0')}-enemy-model-fixture-${String(index + 1).padStart(3, '0')}.zip`,
    index + 1,
  ))
  const target = entries.at(-1)
  const listCalls = []
  resetRuntimeProductGatewayForTests()
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url === releaseUrl(releaseTag)) {
      assertMetadataRequest(init)
      return json({ id: releaseId, tag_name: releaseTag })
    }
    for (let page = 1; page <= 5; page++) {
      if (url === assetsUrl(releaseId, page)) {
        assertMetadataRequest(init)
        listCalls.push(url)
        return json(entries.slice((page - 1) * 100, page * 100))
      }
    }
    if (url === target.url) {
      assert.equal(authorization(init), `Bearer ${testCredential}`)
      assert.equal(new Headers(init.headers).get('Range'), 'bytes=0-0')
      return new Response(new Uint8Array([90]), {
        status: 206,
        headers: {
          'Content-Length': '1',
          'Content-Range': `bytes 0-0/${target.size}`,
          'Accept-Ranges': 'bytes',
        },
      })
    }
    throw new Error(`Unexpected upstream request: ${url}`)
  }

  try {
    const response = await gateway.fetch(new Request(
      `https://gateway.example/${releaseTag}/${target.name}`,
      { headers: { Range: 'bytes=0-0' } },
    ), baseEnv)
    assert.equal(response.status, 206)
    assert.equal(response.headers.get('Content-Length'), '1')
    assert.equal(response.headers.get('Content-Range'), `bytes 0-0/${target.size}`)
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*')
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable')
    assertNoDiagnostic(response)
    assert.deepEqual(listCalls, Array.from({ length: 5 }, (_value, index) => assetsUrl(releaseId, index + 1)))
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([90]))
  } finally {
    resetRuntimeProductGatewayForTests()
    globalThis.fetch = nativeFetch
  }
})

test('gateway path, method, CORS and Wrangler secret contracts stay bounded', async () => {
  const nativeFetch = globalThis.fetch
  resetRuntimeProductGatewayForTests()
  let fetches = 0
  globalThis.fetch = async () => { fetches++; return json({}) }
  try {
    for (const path of [
      '/runtime-products-v1-c/fixture.zip',
      '/runtime-products-v1-a/../secret.zip',
      '/runtime-products-v1-a/not-a-zip.bin',
      '/https://example.com/fixture.zip',
    ]) {
      const response = await gateway.fetch(new Request(`https://gateway.example${path}`), baseEnv)
      assert.equal(response.status, 404, path)
    }
    const post = await gateway.fetch(new Request('https://gateway.example/healthz', {
      method: 'POST',
    }), baseEnv)
    assert.equal(post.status, 405)
    const options = await gateway.fetch(new Request('https://gateway.example/healthz', {
      method: 'OPTIONS',
    }), baseEnv)
    assert.equal(options.status, 204)
    assert.equal(options.headers.get('Access-Control-Allow-Headers'), 'Range, If-None-Match, If-Modified-Since')
    assert.equal(fetches, 0)

    const config = JSON.parse(readFileSync(
      new URL('./wrangler.runtime-product-gateway.jsonc', import.meta.url),
      'utf8',
    ))
    assert.deepEqual(config.secrets, { required: ['GITHUB_RELEASE_TOKEN'] })
    assert.deepEqual(config.vars, {
      RUNTIME_PRODUCT_HEALTH_RELEASE_TAG: 'runtime-products-v1-a',
      RUNTIME_PRODUCT_HEALTH_ASSET_NAME: healthAssetName,
    })
    const workerSource = readFileSync(
      new URL('./workers/runtime-product-gateway.mjs', import.meta.url),
      'utf8',
    )
    assert.match(workerSource, /async fetch\(request, env\)/)
    assert.doesNotMatch(workerSource, /https:\/\/github\.com\/[^'`]+\/releases\/download/)
    assert.match(workerSource, /function metadataRequest\(url, token, phase\)/)
    assert.match(workerSource, /'metadata-fetch-rejected'/)
    assert.match(workerSource, /'metadata-http-redirect'/)
    assert.doesNotMatch(workerSource, /redirect:\s*'error'/)
    assert.doesNotMatch(workerSource, /(?:error|cause)\.(?:message|stack|name)/)
    assert.doesNotMatch(workerSource, /console\./)
    assert.doesNotMatch(JSON.stringify(config), new RegExp(testCredential))
  } finally {
    resetRuntimeProductGatewayForTests()
    globalThis.fetch = nativeFetch
  }
})

test('fixed diagnostics classify every gateway failure branch without sensitive detail leakage', async t => {
  const nativeFetch = globalThis.fetch
  const routeAsset = assetRecord(660, 'fixture.zip', 4)
  const assetRequest = () => new Request(
    'https://gateway.example/runtime-products-v1-a/fixture.zip',
  )
  const validRelease = () => json({ id: 101, tag_name: 'runtime-products-v1-a' })
  const withAssetIndex = assetHandler => async (input, init = {}) => {
    const url = String(input)
    if (url === releaseUrl('runtime-products-v1-a')) return validRelease()
    if (url === assetsUrl(101)) return await assetHandler(input, init)
    throw new Error(exceptionFixture)
  }
  const withAssetDownload = downloadHandler => async (input, init = {}) => {
    const url = String(input)
    if (url === releaseUrl('runtime-products-v1-a')) return validRelease()
    if (url === assetsUrl(101)) return json([routeAsset])
    if (url === routeAsset.url || url === signedUrlFixture) {
      return await downloadHandler(input, init)
    }
    throw new Error(exceptionFixture)
  }

  async function runAssetFailure(name, fetchImpl, expected) {
    await t.test(name, async () => {
      resetRuntimeProductGatewayForTests()
      globalThis.fetch = fetchImpl
      const response = await gateway.fetch(assetRequest(), expected.env ?? baseEnv)
      assert.equal(response.status, expected.status)
      assert.equal(await response.clone().text(), expected.body)
      await assertDiagnostic(response, expected)
    })
  }

  try {
    let headerFailureFetches = 0
    await runAssetFailure(
      'release metadata header construction failure',
      async () => {
        headerFailureFetches++
        throw new Error(exceptionFixture)
      },
      {
        status: 503,
        body: 'Runtime product gateway unavailable\n',
        phase: 'release-metadata',
        error: 'metadata-header-construction-failed',
        env: { ...baseEnv, GITHUB_RELEASE_TOKEN: invalidHeaderCredential },
      },
    )
    assert.equal(headerFailureFetches, 0)

    await t.test('release metadata Request construction failure', async () => {
      resetRuntimeProductGatewayForTests()
      let fetches = 0
      globalThis.fetch = async () => {
        fetches++
        throw new Error(exceptionFixture)
      }
      const request = assetRequest()
      const NativeRequest = globalThis.Request
      globalThis.Request = class {
        constructor() { throw new Error(exceptionFixture) }
      }
      let response
      try {
        response = await gateway.fetch(request, baseEnv)
      } finally {
        globalThis.Request = NativeRequest
      }
      assert.equal(fetches, 0)
      assert.equal(response.status, 502)
      assert.equal(await response.clone().text(), 'Runtime product origin failed\n')
      await assertDiagnostic(response, {
        phase: 'release-metadata',
        error: 'metadata-request-construction-failed',
      })
    })

    await runAssetFailure(
      'release metadata fetch promise rejection',
      async () => { throw new Error(exceptionFixture) },
      {
        status: 502,
        body: 'Runtime product origin failed\n',
        phase: 'release-metadata',
        error: 'metadata-fetch-rejected',
      },
    )
    let releaseRedirectCalls = 0
    await runAssetFailure(
      'release metadata manual redirect fails closed with numeric status',
      async (input, init) => {
        releaseRedirectCalls++
        assert.equal(String(input), releaseUrl('runtime-products-v1-a'))
        assertMetadataRequest(init)
        return new Response(null, {
          status: 302,
          headers: { Location: signedUrlFixture },
        })
      },
      {
        status: 502,
        body: 'Runtime product origin failed\n',
        phase: 'release-metadata',
        error: 'metadata-http-redirect',
        upstreamStatus: 302,
      },
    )
    assert.equal(releaseRedirectCalls, 1)
    await runAssetFailure(
      'release metadata credential rejection',
      async () => new Response(upstreamBodyFixture, { status: 401 }),
      {
        status: 503,
        body: 'Runtime product gateway unavailable\n',
        phase: 'release-metadata',
        error: 'credential-rejected',
        upstreamStatus: 401,
      },
    )
    await runAssetFailure(
      'release metadata exact 404',
      async () => new Response(upstreamBodyFixture, { status: 404 }),
      {
        status: 404,
        body: 'Runtime product not found\n',
        phase: 'release-metadata',
        error: 'release-not-found',
        upstreamStatus: 404,
      },
    )
    await runAssetFailure(
      'release metadata upstream failure',
      async () => new Response(upstreamBodyFixture, { status: 500 }),
      {
        status: 502,
        body: 'Runtime product origin failed\n',
        phase: 'release-metadata',
        error: 'origin-metadata-failed',
        upstreamStatus: 500,
      },
    )
    await runAssetFailure(
      'release metadata invalid JSON',
      async () => new Response(upstreamBodyFixture, { status: 200 }),
      {
        status: 502,
        body: 'Runtime product origin failed\n',
        phase: 'release-metadata',
        error: 'origin-metadata-invalid',
        upstreamStatus: 200,
      },
    )
    await runAssetFailure(
      'release metadata invalid identity',
      async () => json({ id: 0, tag_name: 'runtime-products-v1-a' }),
      {
        status: 502,
        body: 'Runtime product origin failed\n',
        phase: 'release-metadata',
        error: 'origin-release-metadata-invalid',
      },
    )

    await runAssetFailure(
      'asset index fetch promise rejection',
      withAssetIndex(async () => { throw new Error(exceptionFixture) }),
      {
        status: 502,
        body: 'Runtime product origin failed\n',
        phase: 'asset-index',
        error: 'metadata-fetch-rejected',
      },
    )
    let assetIndexCalls = 0
    await runAssetFailure(
      'asset index manual redirect fails closed without following Location',
      async (input, init = {}) => {
        const url = String(input)
        assetIndexCalls++
        assertMetadataRequest(init)
        if (url === releaseUrl('runtime-products-v1-a')) return validRelease()
        if (url === assetsUrl(101)) {
          return new Response(null, {
            status: 307,
            headers: { Location: signedUrlFixture },
          })
        }
        throw new Error(exceptionFixture)
      },
      {
        status: 502,
        body: 'Runtime product origin failed\n',
        phase: 'asset-index',
        error: 'metadata-http-redirect',
        upstreamStatus: 307,
      },
    )
    assert.equal(assetIndexCalls, 2)
    await runAssetFailure(
      'asset index credential rejection',
      withAssetIndex(async () => new Response(upstreamBodyFixture, { status: 403 })),
      {
        status: 503,
        body: 'Runtime product gateway unavailable\n',
        phase: 'asset-index',
        error: 'credential-rejected',
        upstreamStatus: 403,
      },
    )
    await runAssetFailure(
      'asset index release disappearance',
      withAssetIndex(async () => new Response(upstreamBodyFixture, { status: 404 })),
      {
        status: 404,
        body: 'Runtime product not found\n',
        phase: 'asset-index',
        error: 'release-not-found',
        upstreamStatus: 404,
      },
    )
    await runAssetFailure(
      'asset index upstream failure',
      withAssetIndex(async () => new Response(upstreamBodyFixture, { status: 502 })),
      {
        status: 502,
        body: 'Runtime product origin failed\n',
        phase: 'asset-index',
        error: 'origin-metadata-failed',
        upstreamStatus: 502,
      },
    )
    await runAssetFailure(
      'asset index invalid JSON',
      withAssetIndex(async () => new Response(upstreamBodyFixture, { status: 200 })),
      {
        status: 502,
        body: 'Runtime product origin failed\n',
        phase: 'asset-index',
        error: 'origin-metadata-invalid',
        upstreamStatus: 200,
      },
    )
    await runAssetFailure(
      'asset index non-array payload',
      withAssetIndex(async () => json({ assets: [] })),
      {
        status: 502,
        body: 'Runtime product origin failed\n',
        phase: 'asset-index',
        error: 'origin-asset-list-invalid',
      },
    )
    await runAssetFailure(
      'asset index invalid asset metadata',
      withAssetIndex(async () => json([{
        ...routeAsset,
        url: signedUrlFixture,
      }])),
      {
        status: 502,
        body: 'Runtime product origin failed\n',
        phase: 'asset-index',
        error: 'origin-asset-metadata-invalid',
      },
    )
    await runAssetFailure(
      'asset index duplicate asset name',
      withAssetIndex(async () => json([
        routeAsset,
        assetRecord(661, routeAsset.name, routeAsset.size),
      ])),
      {
        status: 502,
        body: 'Runtime product origin failed\n',
        phase: 'asset-index',
        error: 'origin-asset-name-duplicate',
      },
    )
    await runAssetFailure(
      'asset index bounded pagination truncation',
      async input => {
        const url = String(input)
        if (url === releaseUrl('runtime-products-v1-a')) return validRelease()
        const match = /[?&]page=(\d+)$/.exec(url)
        if (url.startsWith(`${apiRoot}/releases/101/assets?`) && match) {
          const page = Number(match[1])
          return json(Array.from({ length: 100 }, (_value, index) => (
            assetRecord(
              page * 10_000 + index,
              `diagnostic-page-${page}-${String(index).padStart(3, '0')}.zip`,
            )
          )))
        }
        throw new Error(exceptionFixture)
      },
      {
        status: 502,
        body: 'Runtime product origin failed\n',
        phase: 'asset-index',
        error: 'origin-asset-list-truncated',
      },
    )
    await runAssetFailure(
      'asset index exact asset miss',
      withAssetIndex(async () => json([])),
      {
        status: 404,
        body: 'Runtime product not found\n',
        phase: 'asset-index',
        error: 'asset-not-found',
      },
    )

    await runAssetFailure(
      'asset download transport failure',
      withAssetDownload(async () => { throw new Error(exceptionFixture) }),
      {
        status: 502,
        body: 'Runtime product origin failed\n',
        phase: 'asset-download',
        error: 'origin-unreachable',
      },
    )
    await runAssetFailure(
      'asset download credential rejection',
      withAssetDownload(async () => new Response(upstreamBodyFixture, { status: 403 })),
      {
        status: 503,
        body: 'Runtime product gateway unavailable\n',
        phase: 'asset-download',
        error: 'credential-rejected',
        upstreamStatus: 403,
      },
    )
    await runAssetFailure(
      'asset download exact 404',
      withAssetDownload(async () => new Response(upstreamBodyFixture, { status: 404 })),
      {
        status: 404,
        body: 'Runtime product not found\n',
        phase: 'asset-download',
        error: 'asset-not-found',
        upstreamStatus: 404,
      },
    )
    await runAssetFailure(
      'asset download upstream failure',
      withAssetDownload(async () => new Response(upstreamBodyFixture, { status: 500 })),
      {
        status: 502,
        body: 'Runtime product origin failed\n',
        phase: 'asset-download',
        error: 'origin-asset-failed',
        upstreamStatus: 500,
      },
    )
    await runAssetFailure(
      'asset download invalid redirect',
      withAssetDownload(async () => new Response(null, {
        status: 302,
        headers: { Location: invalidSignedUrlFixture },
      })),
      {
        status: 502,
        body: 'Runtime product origin failed\n',
        phase: 'asset-download',
        error: 'origin-redirect-invalid',
        upstreamStatus: 302,
      },
    )
    await runAssetFailure(
      'signed asset download transport failure drops authorization and signed URL',
      withAssetDownload(async (input, init) => {
        if (String(input) === routeAsset.url) {
          return new Response(null, {
            status: 302,
            headers: { Location: signedUrlFixture },
          })
        }
        assert.equal(String(input), signedUrlFixture)
        assert.equal(authorization(init), null)
        throw new Error(exceptionFixture)
      }),
      {
        status: 502,
        body: 'Runtime product origin failed\n',
        phase: 'asset-download',
        error: 'origin-unreachable',
      },
    )
    await runAssetFailure(
      'unexpected asset response is normalized to internal failure',
      withAssetDownload(async () => ({
        get status() { throw new Error(exceptionFixture) },
      })),
      {
        status: 502,
        body: 'Runtime product origin failed\n',
        phase: 'internal',
        error: 'internal-failure',
      },
    )

    await t.test('health-only diagnostic branches stay structured and fail closed', async healthTest => {
      async function runHealthFailure(name, env, fetchImpl, expected) {
        await healthTest.test(name, async () => {
          resetRuntimeProductGatewayForTests()
          globalThis.fetch = fetchImpl
          const response = await gateway.fetch(
            new Request('https://gateway.example/healthz'),
            env,
          )
          assert.equal(response.status, 503)
          const body = await response.clone().json()
          assert.equal(body.status, 'not-ready')
          assert.equal(body.reason, expected.reason)
          await assertDiagnostic(response, expected)
        })
      }
      const healthProbeAsset = assetRecord(660, healthAssetName, 7927)
      const withHealthDownload = downloadResponse => async input => {
        const url = String(input)
        if (url === releaseUrl('runtime-products-v1-a')) return validRelease()
        if (url === assetsUrl(101)) return json([healthProbeAsset])
        if (url === healthProbeAsset.url) return downloadResponse()
        throw new Error(exceptionFixture)
      }

      await runHealthFailure(
        'missing credential',
        {},
        async () => { throw new Error(exceptionFixture) },
        {
          phase: 'credential',
          error: 'credential-missing',
          reason: 'credential-missing',
        },
      )
      await runHealthFailure(
        'invalid exact probe configuration',
        { ...baseEnv, RUNTIME_PRODUCT_HEALTH_ASSET_NAME: 'not-a-zip' },
        async () => { throw new Error(exceptionFixture) },
        {
          phase: 'probe-config',
          error: 'probe-config-invalid',
          reason: 'probe-config-invalid',
        },
      )
      await runHealthFailure(
        'probe HTTP status is neither 200 nor 206',
        baseEnv,
        withHealthDownload(() => new Response(null, { status: 304 })),
        {
          phase: 'asset-probe',
          error: 'asset-probe-failed',
          reason: 'asset-probe-failed',
          upstreamStatus: 304,
        },
      )
      await runHealthFailure(
        'probe partial total mismatches exact metadata size',
        baseEnv,
        withHealthDownload(() => new Response(new Uint8Array([80]), {
          status: 206,
          headers: { 'Content-Range': 'bytes 0-0/7928', 'Content-Length': '1' },
        })),
        {
          phase: 'asset-probe',
          error: 'asset-probe-range-invalid',
          reason: 'asset-probe-range-invalid',
          upstreamStatus: 206,
        },
      )
      await runHealthFailure(
        'probe full size mismatches exact metadata size',
        baseEnv,
        withHealthDownload(() => new Response(new Uint8Array([80]), {
          status: 200,
          headers: { 'Content-Length': '1' },
        })),
        {
          phase: 'asset-probe',
          error: 'asset-probe-size-mismatch',
          reason: 'asset-probe-size-mismatch',
          upstreamStatus: 200,
        },
      )
      await runHealthFailure(
        'unexpected health response is normalized without exception detail',
        baseEnv,
        withHealthDownload(() => ({
          get status() { throw new Error(exceptionFixture) },
        })),
        {
          phase: 'internal',
          error: 'internal-failure',
          reason: 'origin-unreachable',
        },
      )
    })

    await t.test('request routing diagnostics preserve generic route and method bodies', async () => {
      resetRuntimeProductGatewayForTests()
      let fetches = 0
      globalThis.fetch = async () => { fetches++; return json({}) }
      const route = await gateway.fetch(
        new Request('https://gateway.example/runtime-products-v1-c/fixture.zip'),
        baseEnv,
      )
      assert.equal(route.status, 404)
      assert.equal(await route.clone().text(), 'Runtime product not found\n')
      await assertDiagnostic(route, { phase: 'request', error: 'route-not-found' })

      for (const url of [
        'https://gateway.example/healthz',
        'https://gateway.example/runtime-products-v1-a/fixture.zip',
      ]) {
        const method = await gateway.fetch(new Request(url, { method: 'POST' }), baseEnv)
        assert.equal(method.status, 405)
        assert.equal(await method.clone().text(), 'Method not allowed\n')
        await assertDiagnostic(method, { phase: 'request', error: 'method-not-allowed' })
      }

      const options = await gateway.fetch(new Request('https://gateway.example/healthz', {
        method: 'OPTIONS',
      }), baseEnv)
      assert.equal(options.status, 204)
      assertNoDiagnostic(options)
      const exposed = exposedHeaderNames(options)
      for (const header of Object.values(diagnosticHeader)) {
        assert.equal(exposed.has(header.toLowerCase()), true)
      }
      assert.equal(fetches, 0)
    })
  } finally {
    resetRuntimeProductGatewayForTests()
    globalThis.fetch = nativeFetch
  }
})

test('live verifier reports only bounded diagnostics and exact Range totals', () => {
  const verifierSource = readFileSync(
    new URL('./scripts/verify-live-runtime-product-gateway.mjs', import.meta.url),
    'utf8',
  )
  for (const header of Object.values(diagnosticHeader)) {
    assert.equal(verifierSource.includes(header), true)
  }
  for (const code of [
    'metadata-header-construction-failed',
    'metadata-request-construction-failed',
    'metadata-fetch-rejected',
    'metadata-http-redirect',
  ]) {
    assert.equal(verifierSource.includes(code), true)
  }
  assert.match(verifierSource, /probe\.contentRange === probe\.expectedContentRange/)
  assert.match(verifierSource, /probe\.contentLength === '1'/)
  assert.match(verifierSource, /catch \{\s*reportBoundedFailure\(\)/)
  assert.match(verifierSource, /GATEWAY_FAILURE_PHASE=/)
  assert.match(verifierSource, /GATEWAY_FAILURE_ERROR=/)
  assert.match(verifierSource, /GATEWAY_FAILURE_UPSTREAM_HTTP=/)
  assert.match(verifierSource, /releaseTag: 'runtime-products-enemy-models-v2'/)
  assert.match(verifierSource, /ENEMY_V2_CONTENT=/)
  assert.match(verifierSource, /gatewayRequests === fixtures.length/)
  assert.match(verifierSource, /releaseTag: 'runtime-products-voice-v1'/)
  assert.match(verifierSource, /VOICE_V1_CONTENT=/)
  assert.match(verifierSource, /voiceBytes.equals\(voiceSourceBytes\)/)
  assert.match(verifierSource, /resolveCachedRuntimeAssetUrl\(enemyRuntimeUrl\)/)
  assert.doesNotMatch(verifierSource, /console\.error/)
  assert.doesNotMatch(verifierSource, /console\.log\((?:error|exception)/i)
  assert.equal(verifierSource.includes(testCredential), false)
  assert.equal(verifierSource.includes(signedUrlFixture), false)
  assert.equal(verifierSource.includes(upstreamBodyFixture), false)
  assert.equal(verifierSource.includes(exceptionFixture), false)
})
