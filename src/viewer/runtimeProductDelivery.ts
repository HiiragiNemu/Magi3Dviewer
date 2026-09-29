import { getLoadingTask, readLoadingResponse, yieldLoadingFrame, registerLoadingResourceName } from '../../magia-exedra-character-three/loadingProgress.ts'
import type { VoiceCatalogEntry } from './voice/catalog.ts'

export const RUNTIME_PRODUCT_DELIVERY_SCHEMA = 'magius.runtime-product-delivery.v1' as const
export const DEFAULT_RUNTIME_PRODUCT_DELIVERY_URL = './catalogs/runtime-product-delivery.v1.json'

export interface RuntimeProductDeliveryEntry {
    stableKey: string
    kind: 'stage' | 'enemy-model' | 'enemy-vfx' | 'character-vfx' | 'voice'
    rootPath: string
    releaseTag: string
    assetName: string
    packUrl: string
    originUrl: string
    fileCount: number
    unpackedBytes: number
    packedBytes: number
}

export interface RuntimeProductDeliveryDocument {
    schema: typeof RUNTIME_PRODUCT_DELIVERY_SCHEMA
    repository: string
    deliveryGateway: string
    activation: {
        hosts: string[]
        queryOverride: 'runtimeDelivery=release'
        localMode: 'prefer-workspace-files'
    }
    counts: {
        products: number
        stageProducts: number
        enemyModels: number
        enemyVfxProducts: number
        characterVfxProducts: number
        voiceProducts?: number
        releaseAssets: number
        unpackedBytes: number
        packedBytes: number
    }
    /** Complete current stage closures; never substitute historical ZIPs. */
    bundledStageRoots?: string[]
    /** GitHub Pages may use the byte-verified, immutable full Cloudflare build. */
    bundledStageBaseUrl?: string
    entries: RuntimeProductDeliveryEntry[]
}

interface LoadedRuntimeProductArchive {
    entry: RuntimeProductDeliveryEntry
    urls: Map<string, string>
}

let documentPromise: Promise<RuntimeProductDeliveryDocument> | undefined
let documentValue: RuntimeProductDeliveryDocument | undefined
let entryByRoot = new Map<string, RuntimeProductDeliveryEntry>()
const archivePromises = new Map<string, Promise<LoadedRuntimeProductArchive>>()
const blobUrlByRuntimePath = new Map<string, string>()
const localVoicePromises = new Map<string, Promise<string>>()
let deliveryGeneration = 0

function pageBaseUrl() {
    return typeof document === 'undefined'
        ? 'http://localhost/'
        : document.baseURI
}

function decodePathname(pathname: string) {
    return pathname.split('/').map(segment => {
        try {
            return decodeURIComponent(segment)
        } catch {
            return segment
        }
    }).join('/')
}

function normalizedRootPath(value: string) {
    const path = `/${value.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')}/`
    if (path.includes('/../') || path.includes('/./')) {
        throw new Error(`Runtime product root is not normalized: ${value}`)
    }
    return path
}

export function resolvePageAssetUrl(reference: string) {
    const base = pageBaseUrl()
    return new URL(reference.replace(/^\//, ''), base).href
}

export function runtimeAssetPath(reference: string) {
    const url = new URL(resolvePageAssetUrl(reference))
    const pageDirectory = decodePathname(new URL('.', pageBaseUrl()).pathname)
    let pathname = decodePathname(url.pathname).replaceAll('\\', '/')
    if (pageDirectory !== '/' && pathname.startsWith(pageDirectory)) {
        pathname = `/${pathname.slice(pageDirectory.length)}`
    }
    return `/${pathname.replace(/^\/+/, '')}`
}

function rootForRuntimePath(path: string) {
    const parts = path.split('/').filter(Boolean)
    if (parts[0] === 'stages' && parts[1] === 'official' && parts[2]) {
        return `/stages/official/${parts[2]}/`
    }
    if (parts[0] === 'enemies' && parts[1] === 'models' && parts[2]) {
        return `/enemies/models/${parts[2]}/`
    }
    if (
        parts[0] === 'vfx'
        && (parts[1] === 'enemy' || parts[1] === 'character')
        && parts[2]
    ) {
        return `/vfx/${parts[1]}/${parts[2]}/`
    }
    if (parts[0] === 'voice' && parts[1] === 'Cv' && parts[2]) {
        return `/voice/Cv/${parts[2]}/`
    }
    return undefined
}

function isDeliveryActive(documentValue: RuntimeProductDeliveryDocument) {
    if (typeof location === 'undefined') return false
    const forced = new URL(location.href).searchParams.get('runtimeDelivery') === 'release'
    return forced || documentValue.activation.hosts.includes(location.hostname)
}

/** Restrict this route to a fixed deployment, not a mutable production/branch alias. */
function bundledStageAssetUrl(catalog: RuntimeProductDeliveryDocument, path: string) {
    if (!catalog.bundledStageBaseUrl) return undefined
    const root = rootForRuntimePath(path)
    if (!root || !catalog.bundledStageRoots?.includes(root)) return undefined
    const relative = path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')
    return new URL(relative, catalog.bundledStageBaseUrl).href
}

function assertDocument(value: unknown): RuntimeProductDeliveryDocument {
    if (!value || typeof value !== 'object') {
        throw new Error('Runtime product delivery catalog is not an object')
    }
    const documentValue = value as RuntimeProductDeliveryDocument
    if (
        documentValue.schema !== RUNTIME_PRODUCT_DELIVERY_SCHEMA
        || !Array.isArray(documentValue.entries)
        || !Array.isArray(documentValue.activation?.hosts)
    ) {
        throw new Error(
            `Runtime product delivery catalog must use ${RUNTIME_PRODUCT_DELIVERY_SCHEMA}`,
        )
    }
    if (documentValue.bundledStageRoots != undefined && !Array.isArray(documentValue.bundledStageRoots)) {
        throw new Error('Bundled stage roots must be an array')
    }
    if (documentValue.bundledStageBaseUrl !== undefined
        && (typeof documentValue.bundledStageBaseUrl !== 'string'
            || !/^https:\/\/[a-f0-9]{8}\.magius3dviewer\.pages\.dev\/$/.test(documentValue.bundledStageBaseUrl)
            || !documentValue.bundledStageRoots?.length)) {
        throw new Error('Bundled stage base must name an immutable Magius Pages deployment with explicit stage roots')
    }
    const roots = new Set<string>()
    for (const entry of documentValue.entries) {
        entry.rootPath = normalizedRootPath(entry.rootPath)
        if (roots.has(entry.rootPath)) {
            throw new Error(`Duplicate runtime product root: ${entry.rootPath}`)
        }
        const expectedPackUrl = `${documentValue.deliveryGateway}/${entry.releaseTag}/${entry.assetName}`
        const expectedOriginUrl = `https://github.com/${documentValue.repository}/releases/download/${entry.releaseTag}/${entry.assetName}`
        if (entry.packUrl !== expectedPackUrl || entry.originUrl !== expectedOriginUrl) {
            throw new Error(`Runtime product delivery URLs do not match ${entry.stableKey}`)
        }
        roots.add(entry.rootPath)
    }
    if (
        documentValue.counts.products !== documentValue.entries.length
        || documentValue.counts.releaseAssets !== documentValue.entries.length
        || (documentValue.counts.voiceProducts ?? 0)
            !== documentValue.entries.filter(entry => entry.kind === 'voice').length
    ) {
        throw new Error('Runtime product delivery counts do not match entries')
    }
    const bundled = new Set<string>()
    for (const root of documentValue.bundledStageRoots ?? []) {
        if (typeof root !== 'string' || !/^\/stages\/official\/[A-Za-z0-9_-]+\/$/.test(root)
            || bundled.has(root) || !documentValue.entries.some(entry => entry.kind === 'stage' && entry.rootPath === root)) {
            throw new Error(`Invalid bundled stage root: ${root}`)
        }
        bundled.add(root)
    }
    return documentValue
}

export async function loadRuntimeProductDelivery(
    signal?: AbortSignal,
): Promise<RuntimeProductDeliveryDocument> {
    if (documentValue) return documentValue
    documentPromise ??= fetch(resolvePageAssetUrl(DEFAULT_RUNTIME_PRODUCT_DELIVERY_URL), {
        cache: 'no-cache',
        signal,
    }).then(async response => {
        if (!response.ok) {
            throw new Error(`Runtime product delivery request failed: HTTP ${response.status}`)
        }
        const document = assertDocument(await response.json())
        entryByRoot = new Map(document.entries.map(entry => [entry.rootPath, entry]))
        documentValue = document
        return document
    }).catch(error => {
        documentPromise = undefined
        throw error
    })
    return await documentPromise
}

function mimeType(path: string) {
    const lower = path.toLowerCase()
    if (lower.endsWith('.json')) return 'application/json'
    if (lower.endsWith('.gltf')) return 'model/gltf+json'
    if (lower.endsWith('.png')) return 'image/png'
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
    if (lower.endsWith('.webp')) return 'image/webp'
    if (lower.endsWith('.ogg')) return 'audio/ogg'
    if (lower.endsWith('.hdr')) return 'image/vnd.radiance'
    return 'application/octet-stream'
}

function safeArchiveRelativePath(value: string) {
    const normalized = value.replaceAll('\\', '/').replace(/^\/+/, '')
    if (!normalized || normalized.split('/').some(part => part === '..' || part === '.')) {
        throw new Error(`Runtime product archive has an unsafe path: ${value}`)
    }
    return normalized
}

function uint32(view: DataView, offset: number) {
    return view.getUint32(offset, true)
}

async function parseStoredZip(
    buffer: ArrayBuffer,
    entry: RuntimeProductDeliveryEntry,
    signal?: AbortSignal,
    generation = deliveryGeneration,
): Promise<LoadedRuntimeProductArchive> {
    const bytes = new Uint8Array(buffer)
    const view = new DataView(buffer)
    const minimumEocdOffset = Math.max(0, bytes.length - 65_557)
    let eocdOffset = -1
    for (let offset = bytes.length - 22; offset >= minimumEocdOffset; offset--) {
        if (uint32(view, offset) === 0x06054b50) {
            eocdOffset = offset
            break
        }
    }
    if (eocdOffset < 0) {
        throw new Error(`Runtime product pack has no ZIP directory: ${entry.stableKey}`)
    }
    const fileCount = view.getUint16(eocdOffset + 10, true)
    const centralDirectoryOffset = uint32(view, eocdOffset + 16)
    const decoder = new TextDecoder('utf-8', { fatal: true })
    const urls = new Map<string, string>()
    let cursor = centralDirectoryOffset
    try {
    for (let index = 0; index < fileCount; index++) {
        signal?.throwIfAborted()
        if (generation !== deliveryGeneration) throw new Error('Runtime delivery was reset during archive load')
        if (uint32(view, cursor) !== 0x02014b50) {
            throw new Error(`Runtime product ZIP directory is malformed: ${entry.stableKey}`)
        }
        const flags = view.getUint16(cursor + 8, true)
        const compression = view.getUint16(cursor + 10, true)
        const packedBytes = uint32(view, cursor + 20)
        const unpackedBytes = uint32(view, cursor + 24)
        const nameLength = view.getUint16(cursor + 28, true)
        const extraLength = view.getUint16(cursor + 30, true)
        const commentLength = view.getUint16(cursor + 32, true)
        const localHeaderOffset = uint32(view, cursor + 42)
        if ((flags & 0x1) !== 0 || compression !== 0 || packedBytes !== unpackedBytes) {
            throw new Error(`Runtime product ZIP must contain stored, unencrypted files: ${entry.stableKey}`)
        }
        const nameStart = cursor + 46
        const relativePath = safeArchiveRelativePath(
            decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)),
        )
        if (uint32(view, localHeaderOffset) !== 0x04034b50) {
            throw new Error(`Runtime product ZIP local header is malformed: ${entry.stableKey}`)
        }
        const localNameLength = view.getUint16(localHeaderOffset + 26, true)
        const localExtraLength = view.getUint16(localHeaderOffset + 28, true)
        const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength
        if (dataOffset + packedBytes > bytes.length) {
            throw new Error(`Runtime product ZIP entry exceeds its payload: ${relativePath}`)
        }
        const runtimePath = `${entry.rootPath}${relativePath}`
        const blobUrl = URL.createObjectURL(new Blob([
            bytes.subarray(dataOffset, dataOffset + packedBytes),
        ], { type: mimeType(relativePath) }))
        registerLoadingResourceName(blobUrl, runtimePath)
        urls.set(runtimePath, blobUrl)
        blobUrlByRuntimePath.set(runtimePath, blobUrl)
        getLoadingTask(signal)?.unpack(relativePath, index + 1, fileCount)
        if (index % 32 === 31) await yieldLoadingFrame(signal)
        cursor = nameStart + nameLength + extraLength + commentLength
    }
    if (urls.size !== entry.fileCount) {
        urls.forEach(url => URL.revokeObjectURL(url))
        urls.forEach((_url, path) => blobUrlByRuntimePath.delete(path))
        throw new Error(
            `Runtime product pack file count mismatch for ${entry.stableKey}: `
            + `${urls.size}/${entry.fileCount}`,
        )
    }
    signal?.throwIfAborted()
    if (generation !== deliveryGeneration) throw new Error('Runtime delivery was reset during archive load')
    return { entry, urls }
    } catch (error) {
        // An aborted paint yield during unpacking owns only this partial archive.
        urls.forEach((url, path) => {
            URL.revokeObjectURL(url)
            if (blobUrlByRuntimePath.get(path) === url) blobUrlByRuntimePath.delete(path)
        })
        throw error
    }
}

function waitForArchiveRetry(milliseconds: number, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    return new Promise((resolve, reject) => {
        const aborted = () => {
            clearTimeout(timer)
            signal?.removeEventListener('abort', aborted)
            reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', aborted)
            resolve()
        }, milliseconds)
        signal?.addEventListener('abort', aborted, { once: true })
    })
}

async function loadArchive(
    entry: RuntimeProductDeliveryEntry,
    signal?: AbortSignal,
): Promise<LoadedRuntimeProductArchive> {
    const generation = deliveryGeneration
    let response: Response
    for (let attempt = 0; ; attempt++) {
        signal?.throwIfAborted()
        if (generation !== deliveryGeneration) throw new Error('Runtime delivery was reset during archive load')
        response = await fetch(entry.packUrl, { cache: attempt === 0 ? 'force-cache' : 'reload', signal })
        // Retry only temporary upstream responses, never missing/forbidden or
        // invalid payloads. Keep one request in flight and the same identity.
        if (attempt >= 2 || ![502, 503, 504].includes(response.status)) break
        await response.body?.cancel()
        await waitForArchiveRetry(350 * (attempt + 1), signal)
    }
    if (!response.ok) {
        throw new Error(
            `Runtime product pack request failed: HTTP ${response.status} (${entry.stableKey})`,
        )
    }
    signal?.throwIfAborted()
    if (generation !== deliveryGeneration) throw new Error('Runtime delivery was reset during archive load')
    const buffer = await readLoadingResponse(response, { url: entry.packUrl, signal, expectedBytes: entry.packedBytes })
    signal?.throwIfAborted()
    getLoadingTask(signal)?.unpack(entry.assetName, 0, entry.fileCount)
    await yieldLoadingFrame(signal)
    return parseStoredZip(buffer, entry, signal, generation)
}

async function requireArchiveForPath(
    path: string,
    signal?: AbortSignal,
): Promise<LoadedRuntimeProductArchive | undefined> {
    const root = rootForRuntimePath(path)
    if (!root) return undefined
    const entry = entryByRoot.get(root)
    if (!entry) return undefined
    let promise = archivePromises.get(root)
    if (!promise) {
        promise = loadArchive(entry, signal).catch(error => {
            if (archivePromises.get(root) === promise) archivePromises.delete(root)
            throw error
        })
        archivePromises.set(root, promise)
    }
    return await promise
}

export async function resolveRuntimeAssetUrl(
    reference: string,
    signal?: AbortSignal,
) {
    const localUrl = resolvePageAssetUrl(reference)
    if (new URL(localUrl).origin !== new URL(pageBaseUrl()).origin) return localUrl
    const document = await loadRuntimeProductDelivery(signal)
    if (!isDeliveryActive(document)) {
        // Local source and built previews both own this byte route. Release
        // mode still uses its archives; neither local mode returns raw media.
        const voice = /^\/voice\/Cv\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\.ogg$/.exec(runtimeAssetPath(localUrl))
        if (voice) return resolveLocalVoiceBlob(localUrl, voice[1], voice[2], signal)
        return localUrl
    }
    const path = runtimeAssetPath(localUrl)
    signal?.throwIfAborted()
    const root = rootForRuntimePath(path)
    if (root && document.bundledStageRoots?.includes(root)) {
        return bundledStageAssetUrl(document, path) ?? localUrl
    }
    const archive = await requireArchiveForPath(path, signal)
    if (!archive) {
        if (path.startsWith('/voice/Cv/')) throw new Error(`Voice release archive missing: ${path}`)
        return localUrl
    }
    const blobUrl = archive.urls.get(path)
    if (!blobUrl) {
        throw new Error(
            `Runtime product ${archive.entry.stableKey} does not contain ${path}`,
        )
    }
    return blobUrl
}

/** Catalog runtimeUrl is provenance (often file:), not a browser playback URL. */
export async function resolveRuntimeVoiceUrl(
    entry: Pick<VoiceCatalogEntry, 'audio'>,
    options: { audioBaseUrl?: string; signal?: AbortSignal } = {},
) {
    if (!entry.audio.runtimeReady || !entry.audio.runtimeUrl) return null
    const identity = /^cri-cue:cueSheetName=([A-Za-z0-9_-]+)\|cueName=([A-Za-z0-9_-]+)$/.exec(entry.audio.sourceStableKey)
    if (!identity) return null
    const base = new URL(options.audioBaseUrl?.trim() || './voice/Cv/', pageBaseUrl())
    if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Voice base protocol must be HTTP or HTTPS')
    if (!base.pathname.endsWith('/')) base.pathname += '/'
    const canonicalBase = new URL('./voice/Cv/', pageBaseUrl())
    if (base.origin === canonicalBase.origin && base.pathname !== canonicalBase.pathname) {
        throw new Error('Local voice base must use the canonical voice/Cv route')
    }
    const url = new URL(`${identity[1]}/${identity[2]}.ogg`, base)
    return resolveRuntimeAssetUrl(url.href, options.signal)
}

async function resolveLocalVoiceBlob(localUrl: string, sheet: string, cue: string, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const path = runtimeAssetPath(localUrl)
    const cached = blobUrlByRuntimePath.get(path)
    if (cached) return cached
    let pending = localVoicePromises.get(path)
    if (!pending) {
        const generation = deliveryGeneration
        pending = (async () => {
            const url = new URL(`/__magius_voice__/${sheet}/${cue}`, localUrl)
            const response = await fetch(url.href, { signal, cache: 'no-cache' })
            if (response.status !== 200
                || response.headers.get('content-type')?.split(';')[0] !== 'application/vnd.magius.voice-payload') {
                throw new Error(`Local voice byte delivery failed: HTTP ${response.status} (${path})`)
            }
            const bytes = await response.arrayBuffer()
            signal?.throwIfAborted()
            const magic = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 4))
            if (String.fromCharCode(...magic) !== 'OggS') throw new Error(`Local voice OGG signature missing: ${path}`)
            if (generation !== deliveryGeneration) throw new Error('Runtime delivery was reset during voice load')
            const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/ogg' }))
            blobUrlByRuntimePath.set(path, blobUrl)
            return blobUrl
        })()
        localVoicePromises.set(path, pending)
        // Do not let an old failed request erase a newer request after reset.
        void pending.catch(() => {
            if (localVoicePromises.get(path) === pending) localVoicePromises.delete(path)
        })
    }
    const result = await pending
    signal?.throwIfAborted()
    return result
}

// Reviewed payload migration: 0592-stage-battle-616-00-01-001.zip and the
// current source contain these exact WebP assets; its FBX still names the PNGs.
// Do not guess extensions for other resources or substitute another texture.
const reviewedRuntimeTextureAliases = new Map([
    ['/stages/official/battle-616-00-01-001/bg3d616_01_01_ground_col.png',
        '/stages/official/battle-616-00-01-001/bg3d616_01_01_ground_col.webp'],
    ['/stages/official/battle-616-00-01-001/bg3d616_01_01_ground_nml.png',
        '/stages/official/battle-616-00-01-001/bg3d616_01_01_ground_nml.webp'],
])

export function resolveCachedRuntimeAssetUrl(reference: string) {
    const localUrl = resolvePageAssetUrl(reference)
    const catalog = documentValue
    const origin = new URL(localUrl).origin
    const sameOrigin = origin === new URL(pageBaseUrl()).origin
    const pinnedOrigin = !!catalog?.bundledStageBaseUrl
        && origin === new URL(catalog.bundledStageBaseUrl).origin
    if (!sameOrigin && !pinnedOrigin) return localUrl
    const path = runtimeAssetPath(localUrl)
    const alias = reviewedRuntimeTextureAliases.get(path)
    // FBX parsing resolves texture URLs synchronously. Use the same immutable
    // source as its profile/carrier, including the two reviewed PNG aliases.
    if (catalog && (isDeliveryActive(catalog) || pinnedOrigin)) {
        const pinned = bundledStageAssetUrl(catalog, alias ?? path)
        if (pinned) return pinned
    }
    if (alias) return blobUrlByRuntimePath.get(alias) ?? resolvePageAssetUrl(alias)
    return blobUrlByRuntimePath.get(path) ?? localUrl
}

export function resetRuntimeProductDeliveryForTests() {
    deliveryGeneration++
    localVoicePromises.clear()
    blobUrlByRuntimePath.forEach(url => URL.revokeObjectURL(url))
    blobUrlByRuntimePath.clear()
    archivePromises.clear()
    entryByRoot.clear()
    documentPromise = undefined
    documentValue = undefined
}
