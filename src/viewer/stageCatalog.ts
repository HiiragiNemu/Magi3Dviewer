export interface ModularStageCatalog<TStage> {
    version: number
    generatedAt?: string
    sourceRevision?: string
    /** Individual stage-definition JSON files. */
    entries?: string[]
    /** Nested catalog JSON files, used for generated JP/TW corpus shards. */
    catalogs?: string[]
    stages?: TStage[]
}

export interface StageCatalogLoadError {
    url: string
    kind: 'catalog' | 'entry'
    message: string
}

export interface StageCatalogLoadResult<TStage> {
    root: ModularStageCatalog<TStage>
    stages: TStage[]
    catalogCount: number
    entryCount: number
    errors: StageCatalogLoadError[]
}

type FetchJson = (url: string) => Promise<unknown>

function messageOf(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}

function defaultPageBaseUrl() {
    if (typeof location !== 'undefined') return location.href
    return 'https://localhost/'
}

function resolvePageRelative(reference: string, pageBaseUrl: string) {
    return new URL(reference, pageBaseUrl).href
}

async function defaultFetchJson(url: string): Promise<unknown> {
    const response = await fetch(url, { cache: 'no-cache' })
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`)
    }
    return await response.json()
}

function assertCatalog<TStage>(value: unknown, url: string): ModularStageCatalog<TStage> {
    if (!value || typeof value !== 'object') {
        throw new Error(`Stage catalog ${url} is not an object`)
    }
    const catalog = value as ModularStageCatalog<TStage>
    if (!Number.isFinite(catalog.version)) {
        throw new Error(`Stage catalog ${url} has no numeric version`)
    }
    if (catalog.entries != undefined && !Array.isArray(catalog.entries)) {
        throw new Error(`Stage catalog ${url} entries is not an array`)
    }
    if (catalog.catalogs != undefined && !Array.isArray(catalog.catalogs)) {
        throw new Error(`Stage catalog ${url} catalogs is not an array`)
    }
    if (catalog.stages != undefined && !Array.isArray(catalog.stages)) {
        throw new Error(`Stage catalog ${url} stages is not an array`)
    }
    return catalog
}

/**
 * Load a root catalog plus arbitrarily many generated catalog shards.
 *
 * References intentionally resolve against the page URL rather than the parent
 * catalog URL. Existing Magius catalogs already use page-relative paths such as
 * `./stages/catalog/foo.json`; preserving that rule keeps old catalogs valid and
 * lets generated JP/TW corpus indexes be copied into `public/stages/` without
 * rewriting every nested path.
 *
 * The root catalog is required. Nested catalogs and individual entries are
 * fail-soft: errors are returned for diagnostics while the rest of the corpus
 * remains inspectable. A URL is loaded at most once, which also breaks cycles.
 */
export async function loadStageCatalogTree<TStage>(
    rootReference: string,
    options: {
        pageBaseUrl?: string
        fetchJson?: FetchJson
    } = {},
): Promise<StageCatalogLoadResult<TStage>> {
    const pageBaseUrl = options.pageBaseUrl ?? defaultPageBaseUrl()
    const fetchJson = options.fetchJson ?? defaultFetchJson
    const rootUrl = resolvePageRelative(rootReference, pageBaseUrl)
    const visitedCatalogs = new Set<string>()
    const visitedEntries = new Set<string>()
    const errors: StageCatalogLoadError[] = []
    const stages: TStage[] = []
    let entryCount = 0

    const root = assertCatalog<TStage>(await fetchJson(rootUrl), rootUrl)

    async function visitCatalog(
        catalog: ModularStageCatalog<TStage>,
        catalogUrl: string,
    ): Promise<void> {
        if (visitedCatalogs.has(catalogUrl)) return
        visitedCatalogs.add(catalogUrl)
        stages.push(...(catalog.stages ?? []))

        for (const entryReference of catalog.entries ?? []) {
            const entryUrl = resolvePageRelative(entryReference, pageBaseUrl)
            if (visitedEntries.has(entryUrl)) continue
            visitedEntries.add(entryUrl)
            try {
                stages.push(await fetchJson(entryUrl) as TStage)
                entryCount++
            } catch (error) {
                errors.push({
                    url: entryUrl,
                    kind: 'entry',
                    message: messageOf(error),
                })
            }
        }

        for (const nestedReference of catalog.catalogs ?? []) {
            const nestedUrl = resolvePageRelative(nestedReference, pageBaseUrl)
            if (visitedCatalogs.has(nestedUrl)) continue
            try {
                const nested = assertCatalog<TStage>(
                    await fetchJson(nestedUrl),
                    nestedUrl,
                )
                await visitCatalog(nested, nestedUrl)
            } catch (error) {
                errors.push({
                    url: nestedUrl,
                    kind: 'catalog',
                    message: messageOf(error),
                })
            }
        }
    }

    await visitCatalog(root, rootUrl)
    return {
        root,
        stages,
        catalogCount: visitedCatalogs.size,
        entryCount,
        errors,
    }
}
