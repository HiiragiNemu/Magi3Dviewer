import type {
    EnemyLocale,
    EnemyManifestEntry,
    EnemyResourceErrorCode,
    EnemyResourceManifest,
} from './types.ts'

export const ENEMY_MANIFEST_SCHEMA = 'magius.enemy-resource-manifest.v1' as const
export const DEFAULT_ENEMY_MANIFEST_URL = '/enemies/manifest.v1.json'

export class EnemyResourceError extends Error {
    readonly code: EnemyResourceErrorCode
    readonly detail?: unknown

    constructor(
        code: EnemyResourceErrorCode,
        message: string,
        detail?: unknown,
    ) {
        super(message)
        this.name = 'EnemyResourceError'
        this.code = code
        this.detail = detail
    }
}

function isManifest(value: unknown): value is EnemyResourceManifest {
    if (typeof value !== 'object' || value === null) return false
    const record = value as Record<string, unknown>
    return (
        record.schema === ENEMY_MANIFEST_SCHEMA
        && Array.isArray(record.entries)
        && typeof record.counts === 'object'
        && record.counts !== null
    )
}

export async function fetchEnemyManifest(
    url = DEFAULT_ENEMY_MANIFEST_URL,
    signal?: AbortSignal,
): Promise<EnemyResourceManifest> {
    const response = await fetch(url, { signal })
    if (!response.ok) {
        throw new EnemyResourceError(
            'MANIFEST_HTTP_ERROR',
            `Enemy manifest request failed: HTTP ${response.status}`,
            { url, status: response.status },
        )
    }
    const value: unknown = await response.json()
    if (!isManifest(value)) {
        throw new EnemyResourceError(
            'MANIFEST_SCHEMA_ERROR',
            `Enemy manifest schema must be ${ENEMY_MANIFEST_SCHEMA}`,
            { url },
        )
    }
    return value
}

export function resolveEnemyDisplayName(
    entry: EnemyManifestEntry,
    locale: EnemyLocale = 'en',
): string {
    const normalized = locale.toLowerCase()
    const requested = normalized.startsWith('zh')
        ? entry.names.zhHant
        : normalized.startsWith('ja')
            ? entry.names.ja
            : entry.names.en
    return requested
        ?? entry.names.en
        ?? entry.names.ja
        ?? entry.names.zhHant
        ?? entry.names.runes
        ?? `Enemy ${entry.enemyMstId}`
}

export class EnemyCatalog {
    readonly manifest: EnemyResourceManifest
    private readonly byId: ReadonlyMap<number, EnemyManifestEntry>

    constructor(manifest: EnemyResourceManifest) {
        if (manifest.schema !== ENEMY_MANIFEST_SCHEMA) {
            throw new EnemyResourceError(
                'MANIFEST_SCHEMA_ERROR',
                `Enemy manifest schema must be ${ENEMY_MANIFEST_SCHEMA}`,
            )
        }
        this.manifest = manifest
        this.byId = new Map(
            manifest.entries.map(entry => [entry.enemyMstId, entry]),
        )
        if (this.byId.size !== manifest.entries.length) {
            throw new EnemyResourceError(
                'MANIFEST_SCHEMA_ERROR',
                'enemyMstId values must be unique',
            )
        }
    }

    list(): readonly EnemyManifestEntry[] {
        return this.manifest.entries
    }

    get(enemyMstId: number): EnemyManifestEntry | undefined {
        return this.byId.get(enemyMstId)
    }

    require(enemyMstId: number): EnemyManifestEntry {
        const entry = this.get(enemyMstId)
        if (!entry) {
            throw new EnemyResourceError(
                'ENEMY_NOT_FOUND',
                `Enemy ${enemyMstId} is absent from the resource manifest`,
                { enemyMstId },
            )
        }
        return entry
    }
}
