const REPOSITORY = 'HiiragiNemu/Magi3Dviewer'
const RELEASE_TAGS = Object.freeze([
  'runtime-products-v1-a',
  'runtime-products-v1-b',
  'runtime-products-enemy-models-v2',
  'runtime-products-voice-v1',
])
const RELEASE_TAG_SET = new Set(RELEASE_TAGS)
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/
const GITHUB_API_ROOT = `https://api.github.com/repos/${REPOSITORY}`
const GITHUB_API_VERSION = '2022-11-28'
const MAX_RELEASE_ASSET_PAGES = 10
const RELEASE_ASSET_PAGE_SIZE = 100
const DIAGNOSTIC_HEADERS = Object.freeze({
  phase: 'X-Runtime-Product-Gateway-Phase',
  error: 'X-Runtime-Product-Gateway-Error',
  upstreamStatus: 'X-Runtime-Product-Gateway-Upstream-Status',
})
const DIAGNOSTIC_PHASES = new Set([
  'request',
  'credential',
  'probe-config',
  'release-metadata',
  'asset-index',
  'asset-download',
  'asset-probe',
  'internal',
])
const DIAGNOSTIC_ERROR_CODES = new Set([
  'method-not-allowed',
  'route-not-found',
  'credential-missing',
  'credential-rejected',
  'probe-config-invalid',
  'release-not-found',
  'asset-not-found',
  'origin-unreachable',
  'metadata-header-construction-failed',
  'metadata-request-construction-failed',
  'metadata-fetch-rejected',
  'metadata-http-redirect',
  'origin-metadata-failed',
  'origin-metadata-invalid',
  'origin-release-metadata-invalid',
  'origin-asset-list-invalid',
  'origin-asset-metadata-invalid',
  'origin-asset-name-duplicate',
  'origin-asset-list-truncated',
  'origin-redirect-invalid',
  'origin-asset-failed',
  'asset-probe-failed',
  'asset-probe-range-invalid',
  'asset-probe-size-mismatch',
  'internal-failure',
])
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, If-None-Match, If-Modified-Since',
  'Access-Control-Expose-Headers': `Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified, ${DIAGNOSTIC_HEADERS.phase}, ${DIAGNOSTIC_HEADERS.error}, ${DIAGNOSTIC_HEADERS.upstreamStatus}`,
  'Access-Control-Max-Age': '86400',
}
const releaseAssetIndexes = new Map()

class GatewayOriginError extends Error {
  constructor(code, clientStatus, phase, upstreamStatus = undefined) {
    super(code)
    this.code = code
    this.clientStatus = clientStatus
    this.phase = phase
    this.upstreamStatus = upstreamStatus
  }
}

function diagnosticHeaders(error) {
  let phase = 'internal'
  let code = 'internal-failure'
  let upstreamStatus
  if (
    error instanceof GatewayOriginError
    && DIAGNOSTIC_PHASES.has(error.phase)
    && DIAGNOSTIC_ERROR_CODES.has(error.code)
  ) {
    phase = error.phase
    code = error.code
    if (
      Number.isInteger(error.upstreamStatus)
      && error.upstreamStatus >= 100
      && error.upstreamStatus <= 599
    ) {
      upstreamStatus = String(error.upstreamStatus)
    }
  }
  return {
    [DIAGNOSTIC_HEADERS.phase]: phase,
    [DIAGNOSTIC_HEADERS.error]: code,
    ...(upstreamStatus === undefined
      ? {}
      : { [DIAGNOSTIC_HEADERS.upstreamStatus]: upstreamStatus }),
  }
}

function cancelBody(response) {
  void response.body?.cancel()
}

function responseHeaders(upstream) {
  const headers = new Headers(CORS_HEADERS)
  for (const name of [
    'content-length',
    'content-range',
    'accept-ranges',
    'etag',
    'last-modified',
  ]) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  headers.set('Content-Type', 'application/zip')
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  headers.set('X-Content-Type-Options', 'nosniff')
  return headers
}

function plain(status, message, extraHeaders = undefined) {
  return new Response(`${message}\n`, {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  })
}

function healthJson(request, status, payload, extraHeaders = undefined) {
  return new Response(request.method === 'HEAD' ? null : `${JSON.stringify(payload)}\n`, {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  })
}

function githubHeaders(token, accept) {
  return new Headers({
    Accept: accept,
    Authorization: `Bearer ${token}`,
    'User-Agent': 'magius3dviewer-runtime-products',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  })
}

function metadataRequest(url, token, phase) {
  let headers
  try {
    headers = githubHeaders(token, 'application/vnd.github+json')
  } catch {
    throw new GatewayOriginError(
      'metadata-header-construction-failed',
      503,
      phase,
    )
  }
  try {
    return new Request(url, {
      method: 'GET',
      headers,
      redirect: 'manual',
    })
  } catch {
    throw new GatewayOriginError(
      'metadata-request-construction-failed',
      502,
      phase,
    )
  }
}

function requireCredential(env) {
  const token = env?.GITHUB_RELEASE_TOKEN
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new GatewayOriginError('credential-missing', 503, 'credential')
  }
  return token.trim()
}

function requireHealthProbe(env) {
  const releaseTag = env?.RUNTIME_PRODUCT_HEALTH_RELEASE_TAG
  const assetName = env?.RUNTIME_PRODUCT_HEALTH_ASSET_NAME
  if (
    typeof releaseTag !== 'string'
    || !RELEASE_TAG_SET.has(releaseTag)
    || typeof assetName !== 'string'
    || !ASSET_NAME.test(assetName)
  ) {
    throw new GatewayOriginError('probe-config-invalid', 503, 'probe-config')
  }
  return { releaseTag, assetName }
}

async function githubJson(url, token, notFoundCode, phase) {
  const request = metadataRequest(url, token, phase)
  let response
  try {
    response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      redirect: 'manual',
    })
  } catch {
    throw new GatewayOriginError('metadata-fetch-rejected', 502, phase)
  }
  if (response.status >= 300 && response.status <= 399) {
    cancelBody(response)
    throw new GatewayOriginError(
      'metadata-http-redirect',
      502,
      phase,
      response.status,
    )
  }
  if (response.status === 401 || response.status === 403) {
    cancelBody(response)
    throw new GatewayOriginError('credential-rejected', 503, phase, response.status)
  }
  if (response.status === 404) {
    cancelBody(response)
    throw new GatewayOriginError(notFoundCode, 404, phase, response.status)
  }
  if (!response.ok) {
    cancelBody(response)
    throw new GatewayOriginError('origin-metadata-failed', 502, phase, response.status)
  }
  try {
    return await response.json()
  } catch {
    throw new GatewayOriginError('origin-metadata-invalid', 502, phase, response.status)
  }
}

function validateAsset(asset) {
  if (
    !asset
    || !Number.isSafeInteger(asset.id)
    || asset.id <= 0
    || typeof asset.name !== 'string'
    || !ASSET_NAME.test(asset.name)
    || asset.state !== 'uploaded'
    || !Number.isSafeInteger(asset.size)
    || asset.size <= 0
    || asset.url !== `${GITHUB_API_ROOT}/releases/assets/${asset.id}`
  ) {
    throw new GatewayOriginError('origin-asset-metadata-invalid', 502, 'asset-index')
  }
}

async function buildReleaseAssetIndex(releaseTag, token) {
  const release = await githubJson(
    `${GITHUB_API_ROOT}/releases/tags/${encodeURIComponent(releaseTag)}`,
    token,
    'release-not-found',
    'release-metadata',
  )
  if (
    !release
    || !Number.isSafeInteger(release.id)
    || release.id <= 0
    || release.tag_name !== releaseTag
  ) {
    throw new GatewayOriginError('origin-release-metadata-invalid', 502, 'release-metadata')
  }

  const assets = new Map()
  for (let page = 1; page <= MAX_RELEASE_ASSET_PAGES; page++) {
    const pageAssets = await githubJson(
      `${GITHUB_API_ROOT}/releases/${release.id}/assets?per_page=${RELEASE_ASSET_PAGE_SIZE}&page=${page}`,
      token,
      'release-not-found',
      'asset-index',
    )
    if (!Array.isArray(pageAssets)) {
      throw new GatewayOriginError('origin-asset-list-invalid', 502, 'asset-index')
    }
    for (const asset of pageAssets) {
      validateAsset(asset)
      if (assets.has(asset.name)) {
        throw new GatewayOriginError('origin-asset-name-duplicate', 502, 'asset-index')
      }
      assets.set(asset.name, Object.freeze({
        id: asset.id,
        name: asset.name,
        size: asset.size,
        url: asset.url,
      }))
    }
    if (pageAssets.length < RELEASE_ASSET_PAGE_SIZE) break
    if (page === MAX_RELEASE_ASSET_PAGES) {
      throw new GatewayOriginError('origin-asset-list-truncated', 502, 'asset-index')
    }
  }
  return assets
}

async function releaseAssetIndex(releaseTag, token) {
  let promise = releaseAssetIndexes.get(releaseTag)
  if (!promise) {
    promise = buildReleaseAssetIndex(releaseTag, token)
    releaseAssetIndexes.set(releaseTag, promise)
  }
  try {
    return await promise
  } catch (error) {
    if (releaseAssetIndexes.get(releaseTag) === promise) {
      releaseAssetIndexes.delete(releaseTag)
    }
    throw error
  }
}

async function resolveReleaseAsset(releaseTag, assetName, token) {
  const assets = await releaseAssetIndex(releaseTag, token)
  const asset = assets.get(assetName)
  if (!asset) throw new GatewayOriginError('asset-not-found', 404, 'asset-index')
  return asset
}

function forwardedRequestHeaders(requestHeaders) {
  const headers = new Headers()
  for (const name of ['Range', 'If-None-Match', 'If-Modified-Since']) {
    const value = requestHeaders.get(name)
    if (value) headers.set(name, value)
  }
  return headers
}

function throwForBinaryFailure(response) {
  if (response.status === 401 || response.status === 403) {
    cancelBody(response)
    throw new GatewayOriginError('credential-rejected', 503, 'asset-download', response.status)
  }
  if (response.status === 404) {
    cancelBody(response)
    throw new GatewayOriginError('asset-not-found', 404, 'asset-download', response.status)
  }
  if (!response.ok && response.status !== 304) {
    cancelBody(response)
    throw new GatewayOriginError('origin-asset-failed', 502, 'asset-download', response.status)
  }
}

async function fetchReleaseAsset(asset, method, requestHeaders, token) {
  const forwarded = forwardedRequestHeaders(requestHeaders)
  const apiHeaders = githubHeaders(token, 'application/octet-stream')
  forwarded.forEach((value, name) => apiHeaders.set(name, value))

  let response
  try {
    response = await fetch(asset.url, {
      method,
      headers: apiHeaders,
      redirect: 'manual',
    })
  } catch {
    throw new GatewayOriginError('origin-unreachable', 502, 'asset-download')
  }

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('Location')
    cancelBody(response)
    let signedUrl
    try {
      signedUrl = new URL(location ?? '', asset.url)
    } catch {
      throw new GatewayOriginError('origin-redirect-invalid', 502, 'asset-download', response.status)
    }
    if (signedUrl.protocol !== 'https:' || signedUrl.username || signedUrl.password) {
      throw new GatewayOriginError('origin-redirect-invalid', 502, 'asset-download', response.status)
    }
    try {
      response = await fetch(signedUrl.href, {
        method,
        headers: forwarded,
        redirect: 'follow',
      })
    } catch {
      throw new GatewayOriginError('origin-unreachable', 502, 'asset-download')
    }
  }

  throwForBinaryFailure(response)
  return response
}

function failureResponse(error) {
  const headers = diagnosticHeaders(error)
  if (error instanceof GatewayOriginError) {
    if (error.clientStatus === 404) return plain(404, 'Runtime product not found', headers)
    if (error.clientStatus === 503) return plain(503, 'Runtime product gateway unavailable', headers)
  }
  return plain(502, 'Runtime product origin failed', headers)
}

async function healthResponse(request, env) {
  try {
    const token = requireCredential(env)
    const probe = requireHealthProbe(env)
    const asset = await resolveReleaseAsset(probe.releaseTag, probe.assetName, token)
    const probeHeaders = new Headers({ Range: 'bytes=0-0' })
    const upstream = await fetchReleaseAsset(asset, 'GET', probeHeaders, token)
    if (upstream.status !== 200 && upstream.status !== 206) {
      cancelBody(upstream)
      throw new GatewayOriginError('asset-probe-failed', 503, 'asset-probe', upstream.status)
    }
    const contentRange = upstream.headers.get('Content-Range')
    const contentLength = upstream.headers.get('Content-Length')
    if (upstream.status === 206 && contentRange !== `bytes 0-0/${asset.size}`) {
      cancelBody(upstream)
      throw new GatewayOriginError('asset-probe-range-invalid', 503, 'asset-probe', upstream.status)
    }
    if (
      upstream.status === 200
      && contentLength !== null
      && contentLength !== String(asset.size)
    ) {
      cancelBody(upstream)
      throw new GatewayOriginError('asset-probe-size-mismatch', 503, 'asset-probe', upstream.status)
    }
    cancelBody(upstream)
    return healthJson(request, 200, {
      schema: 'magius.runtime-product-gateway.v1',
      repository: REPOSITORY,
      releaseTags: RELEASE_TAGS,
      status: 'ready',
      probe: {
        releaseTag: probe.releaseTag,
        assetName: probe.assetName,
        assetBytes: asset.size,
        httpStatus: upstream.status,
      },
    })
  } catch (error) {
    const reason = error instanceof GatewayOriginError
      ? error.code
      : 'origin-unreachable'
    return healthJson(request, 503, {
      schema: 'magius.runtime-product-gateway.v1',
      repository: REPOSITORY,
      releaseTags: RELEASE_TAGS,
      status: 'not-ready',
      reason,
    }, diagnosticHeaders(error))
  }
}

export function resetRuntimeProductGatewayForTests() {
  releaseAssetIndexes.clear()
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }
    if (url.pathname === '/healthz') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return plain(405, 'Method not allowed', {
          Allow: 'GET, HEAD, OPTIONS',
          ...diagnosticHeaders(new GatewayOriginError('method-not-allowed', 405, 'request')),
        })
      }
      return await healthResponse(request, env)
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return plain(405, 'Method not allowed', {
        Allow: 'GET, HEAD, OPTIONS',
        ...diagnosticHeaders(new GatewayOriginError('method-not-allowed', 405, 'request')),
      })
    }

    const parts = url.pathname.split('/').filter(Boolean)
    if (
      parts.length !== 2
      || !RELEASE_TAG_SET.has(parts[0])
      || !ASSET_NAME.test(parts[1])
    ) {
      return plain(
        404,
        'Runtime product not found',
        diagnosticHeaders(new GatewayOriginError('route-not-found', 404, 'request')),
      )
    }

    try {
      const token = requireCredential(env)
      const asset = await resolveReleaseAsset(parts[0], parts[1], token)
      const upstream = await fetchReleaseAsset(
        asset,
        request.method,
        request.headers,
        token,
      )
      return new Response(request.method === 'HEAD' ? null : upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders(upstream),
      })
    } catch (error) {
      return failureResponse(error)
    }
  },
}
