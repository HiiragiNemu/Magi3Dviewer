export type StageSceneLocale = 'en' | 'zh-CN' | 'ja-JP'

export interface StageSceneNameValue {
    value: string | null
    available: boolean
    quality: string
    source: string
}

export interface StageSceneNameRecord {
    dioramaBackgroundMstId?: number
    backgroundResourceName: string
    viewerStageId: string
    stagePrefabName?: string
    sourceKind?: string
    names: {
        en: StageSceneNameValue
        ja: StageSceneNameValue
        zhHant: StageSceneNameValue
    }
    resourceLookup: {
        directRelativePath: string | null
        steamLogicalPath: string | null
        steamCatalogPresent: boolean
        twFullPath: string | null
        twCatalogPresent: boolean
    }
}

export interface StageSceneNameIndex {
    schemaVersion: number
    generatedAt: string
    coverage?: Record<string, unknown>
    dioramaScenes: StageSceneNameRecord[]
    authoredScenes?: StageSceneNameRecord[]
}

type FetchJson = (url: string) => Promise<unknown>

function defaultPageBaseUrl() {
    if (typeof location !== 'undefined') return location.href
    return 'https://localhost/'
}

async function defaultFetchJson(url: string): Promise<unknown> {
    const response = await fetch(url, { cache: 'no-cache' })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    return await response.json()
}

function assertNameIndex(value: unknown, url: string): StageSceneNameIndex {
    if (!value || typeof value !== 'object') {
        throw new Error(`Stage scene-name index ${url} is not an object`)
    }
    const index = value as StageSceneNameIndex
    if (
        !Number.isFinite(index.schemaVersion)
        || !Array.isArray(index.dioramaScenes)
        || (index.authoredScenes !== undefined && !Array.isArray(index.authoredScenes))
    ) {
        throw new Error(`Stage scene-name index ${url} has an invalid schema`)
    }
    const stableIds = new Set<number>()
    const viewerIds = new Set<string>()
    for (const record of index.dioramaScenes) {
        const stableId = record.dioramaBackgroundMstId
        if (typeof stableId !== 'number' || !Number.isFinite(stableId)) {
            throw new Error('Stage scene-name index contains an invalid stable ID')
        }
        if (!record.backgroundResourceName || !record.viewerStageId) {
            throw new Error('Stage scene-name index contains an incomplete resource key')
        }
        if (stableIds.has(stableId)) {
            throw new Error(`Duplicate dioramaBackgroundMstId: ${stableId}`)
        }
        if (viewerIds.has(record.viewerStageId)) {
            throw new Error(`Duplicate viewerStageId: ${record.viewerStageId}`)
        }
        stableIds.add(stableId)
        viewerIds.add(record.viewerStageId)
    }
    for (const record of index.authoredScenes ?? []) {
        if (!record.backgroundResourceName || !record.viewerStageId) {
            throw new Error('Stage scene-name index contains an incomplete resource key')
        }
        if (viewerIds.has(record.viewerStageId)) {
            throw new Error(`Duplicate viewerStageId: ${record.viewerStageId}`)
        }
        viewerIds.add(record.viewerStageId)
    }
    return index
}

export async function loadStageSceneNameIndex(
    reference = './stages/scene-name-cross-region.v1.json',
    options: { pageBaseUrl?: string; fetchJson?: FetchJson } = {},
): Promise<StageSceneNameIndex> {
    const url = new URL(
        reference,
        options.pageBaseUrl ?? defaultPageBaseUrl(),
    ).href
    const value = await (options.fetchJson ?? defaultFetchJson)(url)
    return assertNameIndex(value, url)
}

export function getStageSceneNameRecord(
    index: StageSceneNameIndex | undefined,
    viewerStageId: string,
): StageSceneNameRecord | undefined {
    return index?.dioramaScenes.find(record => record.viewerStageId === viewerStageId)
        ?? index?.authoredScenes?.find(record => record.viewerStageId === viewerStageId)
}

function officialValue(value: StageSceneNameValue | undefined) {
    return value?.available && value.value?.trim() ? value.value.trim() : undefined
}

/**
 * UI locale `zh-CN` intentionally consumes the official Traditional Chinese
 * stage name. When TW has no row, Japanese is the mandated first fallback.
 */
export function resolveStageSceneDisplayName(
    record: StageSceneNameRecord | undefined,
    locale: StageSceneLocale,
    fallback: string,
): string {
    if (!record) return fallback
    if (locale === 'zh-CN') {
        return officialValue(record.names.zhHant)
            ?? officialValue(record.names.ja)
            ?? officialValue(record.names.en)
            ?? fallback
    }
    if (locale === 'ja-JP') {
        return officialValue(record.names.ja)
            ?? officialValue(record.names.en)
            ?? officialValue(record.names.zhHant)
            ?? fallback
    }
    return officialValue(record.names.en)
        ?? officialValue(record.names.ja)
        ?? (record.sourceKind === 'authored-stage'
            ? undefined
            : officialValue(record.names.zhHant))
        ?? fallback
}
