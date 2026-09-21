export const OFFICIAL_RESOURCE_CATALOG_SCHEMA = 'magius.official-resource-catalog.v1' as const
export const DEFAULT_OFFICIAL_RESOURCE_CATALOG_URL = '/catalogs/official-resources.v1.json'

export interface OfficialResourceNames {
    en: string | null
    ja: string | null
    zhHant: string | null
    runes?: string | null
}

export interface OfficialSceneCatalogEntry {
    id: string
    stableKey: string
    family: string
    category: string
    displayName: string
    names: OfficialResourceNames
    type: 'fbx' | 'gltf'
    url: string
    sceneProfileUrl: string | null
    product: {
        fullyResolved: boolean
        [key: string]: unknown
    }
}

export interface OfficialEnemyModelCatalogEntry {
    modelPrefabName: string
    stableKey: string
    recordIds: number[]
    enemyUniqueIds: number[]
    displayName: string
    names: OfficialResourceNames
    modelUrl: string
    thumbnailUrl: string
    renderReady: boolean
}

export type OfficialVfxDomain = 'enemy' | 'character'

export interface OfficialVfxCatalogEntry {
    stableKey: string
    productStableKey: string
    domain: OfficialVfxDomain
    ownerKey: string
    directionKey: string
    displayName: string
    bundleKey: string
    productUrl: string
    status: 'runtime-ready' | 'fail-closed'
    runtimeReady: boolean
    failClosedReasons: string[]
}

export interface OfficialResourceCatalogDocument {
    schema: typeof OFFICIAL_RESOURCE_CATALOG_SCHEMA
    counts: {
        scenes: number
        sceneTarget: 581
        enemyRecords: number
        enemyModels: number
        enemyModelTarget: 493
        enemyVfx: number
        enemyVfxTarget: 443
        enemyVfxRuntimeReady: number
        characterVfx: number
        characterVfxTarget: 211
        characterVfxRuntimeReady: number
        vfxFailClosed: number
    }
    scenes: OfficialSceneCatalogEntry[]
    enemyModels: OfficialEnemyModelCatalogEntry[]
    vfx: OfficialVfxCatalogEntry[]
}

export class OfficialResourceCatalogError extends Error {
    readonly code: 'HTTP_ERROR' | 'SCHEMA_ERROR' | 'DUPLICATE_KEY' | 'NOT_FOUND'
    readonly detail?: unknown

    constructor(
        code: OfficialResourceCatalogError['code'],
        message: string,
        detail?: unknown,
    ) {
        super(message)
        this.name = 'OfficialResourceCatalogError'
        this.code = code
        this.detail = detail
    }
}

function isDocument(value: unknown): value is OfficialResourceCatalogDocument {
    if (!value || typeof value !== 'object') return false
    const record = value as Record<string, unknown>
    return record.schema === OFFICIAL_RESOURCE_CATALOG_SCHEMA
        && Array.isArray(record.scenes)
        && Array.isArray(record.enemyModels)
        && Array.isArray(record.vfx)
        && Boolean(record.counts && typeof record.counts === 'object')
}

export async function fetchOfficialResourceCatalog(
    url = DEFAULT_OFFICIAL_RESOURCE_CATALOG_URL,
    signal?: AbortSignal,
): Promise<OfficialResourceCatalogDocument> {
    const response = await fetch(url, { cache: 'no-cache', signal })
    if (!response.ok) {
        throw new OfficialResourceCatalogError(
            'HTTP_ERROR',
            `Official resource catalog request failed: HTTP ${response.status}`,
            { url, status: response.status },
        )
    }
    const value: unknown = await response.json()
    if (!isDocument(value)) {
        throw new OfficialResourceCatalogError(
            'SCHEMA_ERROR',
            `Official resource catalog schema must be ${OFFICIAL_RESOURCE_CATALOG_SCHEMA}`,
            { url },
        )
    }
    return value
}

function addUnique<T extends { stableKey: string }>(
    target: Map<string, T>,
    entry: T,
    kind: string,
) {
    if (target.has(entry.stableKey)) {
        throw new OfficialResourceCatalogError(
            'DUPLICATE_KEY',
            `Official ${kind} catalog contains duplicate stable key ${entry.stableKey}`,
            { entry },
        )
    }
    target.set(entry.stableKey, entry)
}

export class OfficialResourceCatalog {
    readonly document: OfficialResourceCatalogDocument
    private readonly scenesByStableKey = new Map<string, OfficialSceneCatalogEntry>()
    private readonly scenesById = new Map<string, OfficialSceneCatalogEntry>()
    private readonly enemiesByStableKey = new Map<string, OfficialEnemyModelCatalogEntry>()
    private readonly enemiesByModelName = new Map<string, OfficialEnemyModelCatalogEntry>()
    private readonly vfxByStableKey = new Map<string, OfficialVfxCatalogEntry>()

    constructor(document: OfficialResourceCatalogDocument) {
        if (document.schema !== OFFICIAL_RESOURCE_CATALOG_SCHEMA) {
            throw new OfficialResourceCatalogError(
                'SCHEMA_ERROR',
                `Official resource catalog schema must be ${OFFICIAL_RESOURCE_CATALOG_SCHEMA}`,
            )
        }
        this.document = document
        for (const entry of document.scenes) {
            addUnique(this.scenesByStableKey, entry, 'scene')
            if (this.scenesById.has(entry.id)) {
                throw new OfficialResourceCatalogError(
                    'DUPLICATE_KEY',
                    `Official scene catalog contains duplicate id ${entry.id}`,
                    { entry },
                )
            }
            this.scenesById.set(entry.id, entry)
        }
        for (const entry of document.enemyModels) {
            addUnique(this.enemiesByStableKey, entry, 'enemy model')
            if (this.enemiesByModelName.has(entry.modelPrefabName)) {
                throw new OfficialResourceCatalogError(
                    'DUPLICATE_KEY',
                    `Official enemy catalog contains duplicate model ${entry.modelPrefabName}`,
                    { entry },
                )
            }
            this.enemiesByModelName.set(entry.modelPrefabName, entry)
        }
        for (const entry of document.vfx) addUnique(this.vfxByStableKey, entry, 'VFX')

        const enemyVfx = document.vfx.filter(entry => entry.domain === 'enemy').length
        const characterVfx = document.vfx.filter(entry => entry.domain === 'character').length
        if (
            document.counts.scenes !== document.scenes.length
            || document.counts.enemyModels !== document.enemyModels.length
            || document.counts.enemyVfx !== enemyVfx
            || document.counts.characterVfx !== characterVfx
        ) {
            throw new OfficialResourceCatalogError(
                'SCHEMA_ERROR',
                'Official resource catalog counts do not match its entries',
            )
        }
    }

    listScenes(family?: string): readonly OfficialSceneCatalogEntry[] {
        return family
            ? this.document.scenes.filter(entry => entry.family === family)
            : this.document.scenes
    }

    listEnemyModels(): readonly OfficialEnemyModelCatalogEntry[] {
        return this.document.enemyModels
    }

    listVfx(domain?: OfficialVfxDomain): readonly OfficialVfxCatalogEntry[] {
        return domain
            ? this.document.vfx.filter(entry => entry.domain === domain)
            : this.document.vfx
    }

    getScene(key: string) {
        return this.scenesByStableKey.get(key) ?? this.scenesById.get(key)
    }

    getEnemyModel(key: string) {
        return this.enemiesByStableKey.get(key) ?? this.enemiesByModelName.get(key)
    }

    getVfx(stableKey: string) {
        return this.vfxByStableKey.get(stableKey)
    }

    requireScene(key: string) {
        const entry = this.getScene(key)
        if (!entry?.product.fullyResolved) {
            throw new OfficialResourceCatalogError(
                'NOT_FOUND',
                `Official scene product is absent or unresolved: ${key}`,
                { key },
            )
        }
        return entry
    }

    requireEnemyModel(key: string) {
        const entry = this.getEnemyModel(key)
        if (!entry?.renderReady) {
            throw new OfficialResourceCatalogError(
                'NOT_FOUND',
                `Official enemy model is absent or not render-ready: ${key}`,
                { key },
            )
        }
        return entry
    }

    requireVfx(stableKey: string) {
        const entry = this.getVfx(stableKey)
        if (!entry?.runtimeReady) {
            throw new OfficialResourceCatalogError(
                'NOT_FOUND',
                `Official VFX product is absent or not runtime-ready: ${stableKey}`,
                { stableKey },
            )
        }
        return entry
    }
}

export class OfficialResourceCatalogClient {
    readonly url: string
    private catalogValue?: OfficialResourceCatalog
    private catalogPromise?: Promise<OfficialResourceCatalog>

    constructor(url = DEFAULT_OFFICIAL_RESOURCE_CATALOG_URL) {
        this.url = url
    }

    async ready(signal?: AbortSignal) {
        if (this.catalogValue) return this.catalogValue
        this.catalogPromise ??= fetchOfficialResourceCatalog(this.url, signal)
            .then(document => new OfficialResourceCatalog(document))
        this.catalogValue = await this.catalogPromise
        return this.catalogValue
    }
}
