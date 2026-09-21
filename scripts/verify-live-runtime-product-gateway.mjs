import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const root = new URL('../', import.meta.url)
const pageBase = 'https://magius3dviewer.pages.dev/'
const nativeFetch = globalThis.fetch
const diagnosticHeaders = Object.freeze({
  phase: 'X-Runtime-Product-Gateway-Phase',
  error: 'X-Runtime-Product-Gateway-Error',
  upstreamStatus: 'X-Runtime-Product-Gateway-Upstream-Status',
})
const diagnosticPhases = new Set([
  'request',
  'credential',
  'probe-config',
  'release-metadata',
  'asset-index',
  'asset-download',
  'asset-probe',
  'internal',
])
const diagnosticErrors = new Set([
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
let runtime
let deliveryGateway
let gatewayRequests = 0
let lastGatewayFailure

function boundedEnum(value, allowed) {
  if (value === null) return 'none'
  return allowed.has(value) ? value : 'invalid'
}

function boundedUpstreamStatus(value) {
  if (value === null) return 'none'
  return /^(?:[1-5][0-9]{2})$/.test(value) ? value : 'invalid'
}

function observeGatewayResponse(response) {
  const diagnostic = Object.freeze({
    httpStatus: String(response.status),
    phase: boundedEnum(response.headers.get(diagnosticHeaders.phase), diagnosticPhases),
    error: boundedEnum(response.headers.get(diagnosticHeaders.error), diagnosticErrors),
    upstreamStatus: boundedUpstreamStatus(response.headers.get(diagnosticHeaders.upstreamStatus)),
  })
  if (
    response.status >= 400
    || diagnostic.phase !== 'none'
    || diagnostic.error !== 'none'
    || diagnostic.upstreamStatus !== 'none'
  ) {
    lastGatewayFailure = diagnostic
  }
  return response
}

async function observedGatewayFetch(input, init = undefined) {
  try {
    return observeGatewayResponse(await nativeFetch(input, init))
  } catch {
    lastGatewayFailure = Object.freeze({
      httpStatus: 'no-response',
      phase: 'none',
      error: 'none',
      upstreamStatus: 'none',
    })
    throw new Error('gateway-request-failed')
  }
}

function reportBoundedFailure() {
  const diagnostic = lastGatewayFailure ?? {
    httpStatus: 'none',
    phase: 'none',
    error: 'none',
    upstreamStatus: 'none',
  }
  console.log(`GATEWAY_FAILURE_HTTP=${diagnostic.httpStatus}`)
  console.log(`GATEWAY_FAILURE_PHASE=${diagnostic.phase}`)
  console.log(`GATEWAY_FAILURE_ERROR=${diagnostic.error}`)
  console.log(`GATEWAY_FAILURE_UPSTREAM_HTTP=${diagnostic.upstreamStatus}`)
}

async function verify() {
  const runtimeSource = await readFile(
    new URL('./src/viewer/runtimeProductDelivery.ts', root),
    'utf8',
  )
  runtime = await import(
    `data:text/javascript;base64,${Buffer.from(ts.transpileModule(runtimeSource, {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText).toString('base64')}`
  )
  const manifest = JSON.parse(await readFile(
    new URL('./public/catalogs/runtime-product-delivery.v1.json', root),
    'utf8',
  ))
  deliveryGateway = manifest.deliveryGateway
  const fixtures = [
    {
      label: 'V1_A',
      releaseTag: 'runtime-products-v1-a',
      rootPath: '/stages/official/dungeon-10000-bg-3d-intro-0001-001/',
      primaryPath: 'scene-product.json',
      secondaryPath: 'scene.gltf',
    },
    {
      label: 'V1_B',
      releaseTag: 'runtime-products-v1-b',
      rootPath: '/vfx/enemy/enemy_609001_countdown_start_skill/',
      primaryPath: 'product.vfxdata',
    },
    {
      label: 'ENEMY_V2',
      releaseTag: 'runtime-products-enemy-models-v2',
      rootPath: '/enemies/models/enemy_600001_battle_unit/',
      primaryPath: 'material-profile.v1.json',
    },
    {
      label: 'VOICE_V1',
      releaseTag: 'runtime-products-voice-v1',
      rootPath: '/voice/Cv/cv_100101_outgame/',
      primaryPath: 'cv_100101_other_evo_fee_01.ogg',
    },
  ]
  for (const fixture of fixtures) {
    fixture.entry = manifest.entries.find(entry => entry.rootPath === fixture.rootPath)
    if (!fixture.entry) throw new Error('release-entry-missing')
    if (fixture.entry.releaseTag !== fixture.releaseTag) {
      throw new Error('release-tag-mismatch')
    }
  }

  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { baseURI: pageBase },
  })
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL(pageBase),
  })
  globalThis.fetch = async (input, init = undefined) => {
    const url = String(input)
    if (url.endsWith('/catalogs/runtime-product-delivery.v1.json')) {
      return new Response(JSON.stringify(manifest), {
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.startsWith(`${deliveryGateway}/`)) {
      gatewayRequests++
      return await observedGatewayFetch(input, init)
    }
    return await nativeFetch(input, init)
  }

  async function rangeProbe(entry) {
    const response = await observedGatewayFetch(entry.packUrl, {
      headers: { Range: 'bytes=0-0' },
      cache: 'no-store',
    })
    const result = {
      status: response.status,
      contentLength: response.headers.get('Content-Length'),
      contentRange: response.headers.get('Content-Range'),
      expectedContentRange: `bytes 0-0/${entry.packedBytes}`,
      cors: response.headers.get('Access-Control-Allow-Origin'),
      cacheControl: response.headers.get('Cache-Control'),
    }
    await response.body?.cancel()
    return result
  }

  const healthResponse = await observedGatewayFetch(`${deliveryGateway}/healthz`, {
    cache: 'no-store',
  })
  const health = await healthResponse.json()
  const ranges = Object.fromEntries(await Promise.all(fixtures.map(async fixture => [
    fixture.label,
    await rangeProbe(fixture.entry),
  ])))

  const stageFixture = fixtures[0]
  const stageProductUrl = await runtime.resolveRuntimeAssetUrl(
    `${stageFixture.rootPath}${stageFixture.primaryPath}`,
  )
  const stageSceneUrl = runtime.resolveCachedRuntimeAssetUrl(
    `${stageFixture.rootPath}${stageFixture.secondaryPath}`,
  )
  const stageProduct = JSON.parse(await (await nativeFetch(stageProductUrl)).text())
  const stageScene = JSON.parse(await (await nativeFetch(stageSceneUrl)).text())
  const stagePass = (
    stageProduct?.schema === 'magius.official-scene-product.v1'
    && stageProduct?.stageId === stageFixture.entry.stableKey.replace(/^stage\|/, '')
    && stageScene?.asset?.version === '2.0'
  )

  const vfxFixture = fixtures[1]
  const vfxUrl = await runtime.resolveRuntimeAssetUrl(
    `${vfxFixture.rootPath}${vfxFixture.primaryPath}`,
  )
  const vfxBytes = new Uint8Array(await (await nativeFetch(vfxUrl)).arrayBuffer())
  const vfxPass = vfxBytes.length > 2 && vfxBytes[0] === 0x1f && vfxBytes[1] === 0x8b

  const enemyFixture = fixtures[2]
  const enemyProfileUrl = await runtime.resolveRuntimeAssetUrl(
    `${enemyFixture.rootPath}${enemyFixture.primaryPath}`,
  )
  const enemyProfile = JSON.parse(await (await nativeFetch(enemyProfileUrl)).text())
  const collectRuntimeUrls = value => {
    if (Array.isArray(value)) return value.flatMap(collectRuntimeUrls)
    if (!value || typeof value !== 'object') return []
    return Object.entries(value).flatMap(([key, nested]) => (
      key === 'runtimeUrl' && typeof nested === 'string'
        ? [nested]
        : collectRuntimeUrls(nested)
    ))
  }
  const enemyRuntimeUrls = collectRuntimeUrls(enemyProfile)
  const expectedEnemyTexturePrefix = `${enemyFixture.rootPath}runtime-textures/`
  const enemyRuntimeUrl = enemyRuntimeUrls[0]
  const enemyTextureUrl = enemyRuntimeUrl
    ? runtime.resolveCachedRuntimeAssetUrl(enemyRuntimeUrl)
    : ''
  const enemyTextureBytes = enemyTextureUrl
    ? new Uint8Array(await (await nativeFetch(enemyTextureUrl)).arrayBuffer())
    : new Uint8Array()
  const enemyPass = (
    enemyProfile?.schema === 'magius.enemy-material-profile.v1'
    && enemyProfile?.modelPrefabName === 'enemy_600001_battle_unit'
    && enemyProfile?.status === 'runtime-ready'
    && enemyProfile?.runtimeReady === true
    && enemyProfile?.textureStatus === 'runtime-ready'
    && enemyProfile?.textureRuntimeReady === true
    && enemyRuntimeUrls.length > 0
    && enemyRuntimeUrls.every(url => url.startsWith(expectedEnemyTexturePrefix))
    && enemyTextureUrl.startsWith('blob:')
    && enemyTextureBytes.length > 8
    && enemyTextureBytes[0] === 0x89
    && enemyTextureBytes[1] === 0x50
    && enemyTextureBytes[2] === 0x4e
    && enemyTextureBytes[3] === 0x47
  )
  const rangePass = fixtures.every(fixture => {
    const probe = ranges[fixture.label]
    return (
      probe.status === 206
      && probe.contentLength === '1'
      && probe.contentRange === probe.expectedContentRange
      && probe.cors === '*'
      && probe.cacheControl === 'public, max-age=31536000, immutable'
    )
  })
  const voiceFixture = fixtures[3]
  const voiceCatalog = JSON.parse(await readFile(new URL(
    './artifacts/research/20260827-voice-catalog-source-ready/manifest.v1.json', root,
  ), 'utf8'))
  const voiceSourceKey = 'cri-cue:cueSheetName=cv_100101_outgame|cueName=cv_100101_other_evo_fee_01'
  const voiceEntry = voiceCatalog.entries.find(entry => entry.audio?.sourceStableKey === voiceSourceKey)
  if (!voiceEntry) throw new Error('voice-source-identity-missing')
  const voiceUrl = await runtime.resolveRuntimeAssetUrl(`${voiceFixture.rootPath}${voiceFixture.primaryPath}`)
  const voiceResponse = await nativeFetch(voiceUrl)
  const voiceBytes = Buffer.from(await voiceResponse.arrayBuffer())
  const voiceSourceBytes = await readFile(new URL(voiceEntry.audio.runtimeUrl))
  const voicePass = voiceUrl.startsWith('blob:')
    && voiceResponse.headers.get('content-type') === 'audio/ogg'
    && voiceBytes.subarray(0, 4).toString('ascii') === 'OggS'
    && voiceBytes.equals(voiceSourceBytes)
  const healthPass = (
    healthResponse.status === 200
    && health?.status === 'ready'
    && health?.probe?.releaseTag === 'runtime-products-v1-a'
    && health?.probe?.assetName === '0660-stage-dungeon-10000-bg-3d-intro-0001-001.zip'
    && health?.probe?.assetBytes === 7927
    && fixtures.every(fixture => health?.releaseTags?.includes(fixture.releaseTag))
  )
  const activationPass = manifest.activation.hosts.includes('magius3dviewer.pages.dev')
  const pass = (
    healthPass
    && activationPass
    && rangePass
    && gatewayRequests === fixtures.length
    && stagePass
    && vfxPass
    && enemyPass
    && voicePass
  )

  console.log(`GATEWAY=${deliveryGateway}`)
  console.log(`ACTIVATION_HOST=${new URL(pageBase).hostname}`)
  console.log(`ACTIVATION_HOST_PASS=${activationPass ? 'PASS' : 'FAIL'}`)
  console.log(`HEALTH_HTTP=${healthResponse.status}`)
  console.log(`HEALTH_STATUS=${health?.status ?? 'missing'}`)
  console.log(`HEALTH_PROBE_TAG=${health?.probe?.releaseTag ?? 'missing'}`)
  console.log(`HEALTH_PROBE_ASSET=${health?.probe?.assetName ?? 'missing'}`)
  console.log(`HEALTH_PROBE_BYTES=${health?.probe?.assetBytes ?? 'missing'}`)
  for (const fixture of fixtures) {
    const probe = ranges[fixture.label]
    console.log(`${fixture.label}_TAG=${fixture.entry.releaseTag}`)
    console.log(`${fixture.label}_ASSET=${fixture.entry.assetName}`)
    console.log(`${fixture.label}_GET=PASS`)
    console.log(`${fixture.label}_RANGE_HTTP=${probe.status}`)
    console.log(`${fixture.label}_CONTENT_LENGTH=${probe.contentLength ?? 'missing'}`)
    console.log(`${fixture.label}_CONTENT_RANGE=${probe.contentRange ?? 'missing'}`)
    console.log(`${fixture.label}_EXPECTED_CONTENT_RANGE=${probe.expectedContentRange}`)
    console.log(`${fixture.label}_CORS=${probe.cors ?? 'missing'}`)
    console.log(`${fixture.label}_CACHE=${probe.cacheControl ?? 'missing'}`)
  }
  console.log(`GATEWAY_FULL_GET_REQUESTS=${gatewayRequests}`)
  console.log(`V1_A_CONTENT=${stagePass ? 'PASS' : 'FAIL'}`)
  console.log(`V1_B_CONTENT=${vfxPass ? 'PASS' : 'FAIL'}`)
  console.log(`ENEMY_V2_CONTENT=${enemyPass ? 'PASS' : 'FAIL'}`)
  console.log(`VOICE_V1_CONTENT=${voicePass ? 'PASS' : 'FAIL'}`)
  console.log(`VOICE_V1_OGG_BYTES=${voiceBytes.length}`)
  console.log(`ENEMY_V2_RUNTIME_TEXTURES=${enemyRuntimeUrls.length}`)
  reportBoundedFailure()
  console.log(`EXIT_STATUS=${pass ? 0 : 1}`)
  if (!pass) process.exitCode = 1
}

try {
  await verify()
} catch {
  reportBoundedFailure()
  console.log('EXIT_STATUS=1')
  process.exitCode = 1
} finally {
  runtime?.resetRuntimeProductDeliveryForTests()
  globalThis.fetch = nativeFetch
}
