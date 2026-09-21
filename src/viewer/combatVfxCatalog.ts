export const COMBAT_VFX_CATALOG_SCHEMA = 'magius.combat-vfx-catalog.v1' as const
export const DEFAULT_COMBAT_VFX_CATALOG_URL = '/vfx/catalog.v1.json'

export type CombatVfxDomain = 'enemy' | 'character'

export interface CombatVfxCatalogEntry {
    stableKey: string
    productStableKey: string
    domain: CombatVfxDomain
    subjectKind: CombatVfxDomain
    ownerKey: string
    directionKey: string
    directionName: string
    bundleKey: string
    effectId: string
    skillUniqueId: number | null
    skillMstId: number | null
    productUrl: string
    schemaVersion: 2
    status: 'runtime-ready' | 'fail-closed'
    runtimeReady: boolean
    publicationScope: 'target' | 'legacy'
    failClosedReasons: string[]
    lifetimeSeconds: number | null
    particleSystemCount: number
    textureCount: number
}

export interface CombatVfxCatalogDocument {
    schema: typeof COMBAT_VFX_CATALOG_SCHEMA
    lookupContract: {
        primary: 'subjectKind + directionName'
        direction: 'subjectKind + directionName'
        productIdentity: 'productStableKey'
        bundle: string
        missing: 'fail-closed'
    }
    counts: {
        products: number
        enemyProducts: number
        characterProducts: number
        runtimeReady: number
        failClosed: number
        targetProducts: number
        targetEnemyProducts: number
        targetCharacterProducts: number
        targetRuntimeReady: number
        targetFailClosed: number
        legacyProducts: number
    }
    entries: CombatVfxCatalogEntry[]
}

export class CombatVfxCatalogError extends Error {
    readonly code: 'HTTP_ERROR' | 'SCHEMA_ERROR' | 'DUPLICATE_KEY' | 'NOT_FOUND'
    readonly detail?: unknown

    constructor(
        code: CombatVfxCatalogError['code'],
        message: string,
        detail?: unknown,
    ) {
        super(message)
        this.name = 'CombatVfxCatalogError'
        this.code = code
        this.detail = detail
    }
}

export function normalizeCombatVfxBundleKey(value: string) {
    return value.replaceAll('\\', '/').replace(/^AssetBundles\//, '')
}

function isDocument(value: unknown): value is CombatVfxCatalogDocument {
    if (!value || typeof value !== 'object') return false
    const record = value as Record<string, unknown>
    return record.schema === COMBAT_VFX_CATALOG_SCHEMA
        && Array.isArray(record.entries)
        && Boolean(record.counts && typeof record.counts === 'object')
}

export async function fetchCombatVfxCatalog(
    url = DEFAULT_COMBAT_VFX_CATALOG_URL,
    signal?: AbortSignal,
): Promise<CombatVfxCatalogDocument> {
    const response = await fetch(url, { cache: 'no-cache', signal })
    if (!response.ok) {
        throw new CombatVfxCatalogError(
            'HTTP_ERROR',
            `Combat VFX catalog request failed: HTTP ${response.status}`,
            { url, status: response.status },
        )
    }
    const value: unknown = await response.json()
    if (!isDocument(value)) {
        throw new CombatVfxCatalogError(
            'SCHEMA_ERROR',
            `Combat VFX catalog schema must be ${COMBAT_VFX_CATALOG_SCHEMA}`,
            { url },
        )
    }
    return value
}

function directionLookupKey(
    domain: CombatVfxDomain,
    directionKey: string,
) {
    return `${domain}\u0000${directionKey}`
}

export class CombatVfxCatalog {
    readonly document: CombatVfxCatalogDocument
    private readonly byStableKey = new Map<string, CombatVfxCatalogEntry>()
    private readonly byProductStableKey = new Map<string, CombatVfxCatalogEntry>()
    private readonly byBundleKey = new Map<string, CombatVfxCatalogEntry>()
    private readonly byDirection = new Map<string, CombatVfxCatalogEntry>()

    constructor(document: CombatVfxCatalogDocument) {
        if (document.schema !== COMBAT_VFX_CATALOG_SCHEMA) {
            throw new CombatVfxCatalogError(
                'SCHEMA_ERROR',
                `Combat VFX catalog schema must be ${COMBAT_VFX_CATALOG_SCHEMA}`,
            )
        }
        this.document = document
        for (const entry of document.entries) {
            const bundleKey = normalizeCombatVfxBundleKey(entry.bundleKey)
            const directionKey = directionLookupKey(
                entry.domain,
                entry.directionKey,
            )
            if (
                this.byStableKey.has(entry.stableKey)
                || this.byProductStableKey.has(entry.productStableKey)
                || this.byBundleKey.has(bundleKey)
                || this.byDirection.has(directionKey)
            ) {
                throw new CombatVfxCatalogError(
                    'DUPLICATE_KEY',
                    `Combat VFX catalog contains a duplicate key for ${entry.stableKey}`,
                    { entry },
                )
            }
            this.byStableKey.set(entry.stableKey, entry)
            this.byProductStableKey.set(entry.productStableKey, entry)
            this.byBundleKey.set(bundleKey, entry)
            this.byDirection.set(directionKey, entry)
        }
        if (
            this.byStableKey.size !== document.entries.length
            || document.counts.products !== document.entries.length
        ) {
            throw new CombatVfxCatalogError(
                'SCHEMA_ERROR',
                'Combat VFX catalog counts do not match its entries',
            )
        }
    }

    list(domain?: CombatVfxDomain): readonly CombatVfxCatalogEntry[] {
        return domain
            ? this.document.entries.filter(entry => entry.domain === domain)
            : this.document.entries
    }

    getByStableKey(stableKey: string) {
        return this.byStableKey.get(stableKey)
            ?? this.byProductStableKey.get(stableKey)
    }

    getByBundleKey(bundleKey: string) {
        return this.byBundleKey.get(normalizeCombatVfxBundleKey(bundleKey))
    }

    getByDirection(
        domain: CombatVfxDomain,
        directionKey: string,
    ) {
        return this.byDirection.get(directionLookupKey(domain, directionKey))
    }

    requireByBundleKey(bundleKey: string): CombatVfxCatalogEntry {
        const entry = this.getByBundleKey(bundleKey)
        if (!entry?.runtimeReady) {
            throw new CombatVfxCatalogError(
                'NOT_FOUND',
                `Combat VFX product is absent or not runtime-ready: ${bundleKey}`,
                { bundleKey },
            )
        }
        return entry
    }
}

export class CombatVfxCatalogClient {
    readonly url: string
    private catalogValue?: CombatVfxCatalog
    private catalogPromise?: Promise<CombatVfxCatalog>

    constructor(url = DEFAULT_COMBAT_VFX_CATALOG_URL) {
        this.url = url
    }

    async ready(signal?: AbortSignal) {
        if (this.catalogValue) return this.catalogValue
        this.catalogPromise ??= fetchCombatVfxCatalog(this.url, signal)
            .then(document => new CombatVfxCatalog(document))
        this.catalogValue = await this.catalogPromise
        return this.catalogValue
    }

    async requireByBundleKey(bundleKey: string, signal?: AbortSignal) {
        return (await this.ready(signal)).requireByBundleKey(bundleKey)
    }
}
