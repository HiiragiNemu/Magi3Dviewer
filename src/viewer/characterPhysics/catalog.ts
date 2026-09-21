import type {
    CharacterPhysicsCatalog,
    CharacterPhysicsCatalogEntry,
    CharacterPhysicsProfile,
} from './types'

export class CharacterPhysicsCatalogError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'CharacterPhysicsCatalogError'
    }
}

type FetchLike = typeof fetch

function absoluteUrl(value: string): URL {
    const base = typeof location === 'undefined'
        ? 'http://127.0.0.1/'
        : location.href
    return new URL(value, base)
}

export class CharacterPhysicsCatalogClient {
    private readonly catalogUrl: URL
    private readonly fetcher: FetchLike
    private catalogPromise?: Promise<CharacterPhysicsCatalog>
    private readonly profilePromises = new Map<string, Promise<CharacterPhysicsProfile>>()

    constructor(
        catalogUrl = '/character-physics/manifest.v1.json',
        fetcher: FetchLike = globalThis.fetch.bind(globalThis),
    ) {
        this.catalogUrl = absoluteUrl(catalogUrl)
        this.fetcher = fetcher
    }

    async catalog(): Promise<CharacterPhysicsCatalog> {
        this.catalogPromise ??= this.fetchCatalog()
        return this.catalogPromise
    }

    async list(): Promise<readonly CharacterPhysicsCatalogEntry[]> {
        return (await this.catalog()).entries
    }

    async requireProfile(style3dCharacterMstId: number): Promise<CharacterPhysicsProfile> {
        return this.requireExactProfile('style', style3dCharacterMstId)
    }

    async requireProfileForViewerCharacter(
        viewerPrimaryCharacterId: number,
    ): Promise<CharacterPhysicsProfile> {
        const entries = (await this.catalog()).entries
        const resourceEntries = entries.filter(
            entry => entry.characterResourceId === viewerPrimaryCharacterId,
        )
        if (resourceEntries.length === 1) {
            return this.requireExactProfile('resource', viewerPrimaryCharacterId)
        }
        if (resourceEntries.length > 1) {
            throw new CharacterPhysicsCatalogError(
                `profile-identity-count:resource:${viewerPrimaryCharacterId}:${resourceEntries.length}`,
            )
        }

        const styleEntries = entries.filter(
            entry => entry.style3dCharacterMstId === viewerPrimaryCharacterId,
        )
        if (styleEntries.length !== 1) {
            throw new CharacterPhysicsCatalogError(
                `profile-identity-count:style:${viewerPrimaryCharacterId}:${styleEntries.length}`,
            )
        }
        return this.requireExactProfile('style', viewerPrimaryCharacterId)
    }

    private async requireExactProfile(
        identityKind: 'style' | 'resource',
        identity: number,
    ): Promise<CharacterPhysicsProfile> {
        const cacheKey = `${identityKind}:${identity}`
        const existing = this.profilePromises.get(cacheKey)
        if (existing) return existing
        const pending = this.fetchProfile(identityKind, identity)
        this.profilePromises.set(cacheKey, pending)
        try {
            return await pending
        } catch (error) {
            this.profilePromises.delete(cacheKey)
            throw error
        }
    }

    private async fetchCatalog(): Promise<CharacterPhysicsCatalog> {
        const response = await this.fetcher(this.catalogUrl)
        if (!response.ok) {
            throw new CharacterPhysicsCatalogError(
                `catalog-http-${response.status}:${this.catalogUrl.href}`,
            )
        }
        const value = await response.json() as CharacterPhysicsCatalog
        if (value.schema !== 'magius.character-physics-catalog.v1') {
            throw new CharacterPhysicsCatalogError(`catalog-schema:${value.schema}`)
        }
        if (value.lookupKey !== 'style3dCharacterMstId|characterResourceId') {
            throw new CharacterPhysicsCatalogError(`catalog-lookup-key:${value.lookupKey}`)
        }
        if (value.entries.length !== value.counts.characters) {
            throw new CharacterPhysicsCatalogError(
                `catalog-count:${value.entries.length}/${value.counts.characters}`,
            )
        }
        const mechanismTotals = {
            cloth: value.counts.magicaCloth,
            magicaColliders: Object.entries(value.mechanismCounts.magica)
                .filter(([name]) => name.endsWith('Collider'))
                .reduce((sum, [, count]) => sum + count, 0),
            windZones: value.mechanismCounts.magica.MagicaWindZone ?? 0,
            nativeColliders: value.counts.nativePhysicsComponents,
        }
        for (const [name, expected] of Object.entries(mechanismTotals)) {
            const counts = value.runtimeMechanismCounts[name]
            const actual = counts
                ? Object.values(counts).reduce((sum, count) => sum + count, 0)
                : -1
            if (actual !== expected) {
                throw new CharacterPhysicsCatalogError(
                    `catalog-runtime-mechanism-count:${name}:${actual}/${expected}`,
                )
            }
        }
        return value
    }

    private async fetchProfile(
        identityKind: 'style' | 'resource',
        identity: number,
    ): Promise<CharacterPhysicsProfile> {
        const catalog = await this.catalog()
        const entries = catalog.entries.filter(
            entry => identityKind === 'style'
                ? entry.style3dCharacterMstId === identity
                : entry.characterResourceId === identity,
        )
        if (entries.length !== 1) {
            throw new CharacterPhysicsCatalogError(
                `profile-identity-count:${identityKind}:${identity}:${entries.length}`,
            )
        }
        const entry = entries[0]!
        if (entry.runtimeStatus !== 'runtime-ready') {
            throw new CharacterPhysicsCatalogError(
                `profile-fail-closed:${entry.stableKey}:${entry.failClosedReasons.join('|')}`,
            )
        }
        const profileUrl = new URL(entry.productUrl, this.catalogUrl)
        const response = await this.fetcher(profileUrl)
        if (!response.ok) {
            throw new CharacterPhysicsCatalogError(
                `profile-http-${response.status}:${profileUrl.href}`,
            )
        }
        const profile = await response.json() as CharacterPhysicsProfile
        if (profile.schema !== 'magius.character-physics-profile.v1') {
            throw new CharacterPhysicsCatalogError(`profile-schema:${profile.schema}`)
        }
        if (
            profile.stableKey !== entry.stableKey
            || profile.identity.style3dCharacterMstId !== entry.style3dCharacterMstId
            || profile.identity.characterResourceId !== entry.characterResourceId
            || profile.identity.resourceName !== entry.resourceName
            || profile.source.sourceStableKey !== entry.sourceStableKey
        ) {
            throw new CharacterPhysicsCatalogError(
                `profile-identity-mismatch:${identityKind}:${identity}`,
            )
        }
        if (profile.runtime.status !== 'runtime-ready') {
            throw new CharacterPhysicsCatalogError(
                `profile-runtime-fail-closed:${profile.stableKey}`,
            )
        }
        return profile
    }
}
