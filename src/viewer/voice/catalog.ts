export const VOICE_CATALOG_SCHEMA = 'magius.voice-catalog.v1' as const

export const SOURCE_READY_VOICE_CATALOG_URL = new URL(
    '../../../artifacts/research/20260827-voice-catalog-source-ready/manifest.v1.json',
    import.meta.url,
).href

export interface VoiceAudioDescriptor {
    runtimeUrl: string | null
    format: string
    runtimeReady: boolean
    failClosedReasons: string[]
    sourceStableKey: string
}

export type VoiceSubtitles = Readonly<Record<string, string>>

export interface VoiceCatalogEntry {
    stableKey: string
    characterResourceId: string
    order: number
    audio: VoiceAudioDescriptor
    subtitles: VoiceSubtitles
    durationSeconds?: number
}

export interface VoiceCatalogManifest {
    schema: typeof VOICE_CATALOG_SCHEMA
    generatedAt?: string
    source?: Readonly<Record<string, unknown>>
    counts?: Readonly<Record<string, unknown>>
    entries: VoiceCatalogEntry[]
}

export type VoiceCatalogErrorCode =
    | 'MANIFEST_HTTP_ERROR'
    | 'MANIFEST_SCHEMA_ERROR'
    | 'VOICE_NOT_FOUND'
    | 'VOICE_NOT_READY'

export class VoiceCatalogError extends Error {
    readonly code: VoiceCatalogErrorCode
    readonly detail?: unknown

    constructor(code: VoiceCatalogErrorCode, message: string, detail?: unknown) {
        super(message)
        this.name = 'VoiceCatalogError'
        this.code = code
        this.detail = detail
    }
}

const OFFICIAL_STABLE_KEY = /^soundMstId=\d+\|cueSheetName=[^|]+\|cueName=[^|]+$/
const SOURCE_STABLE_KEY = /^cri-cue:cueSheetName=[^|]+\|cueName=[^|]+$/
const CHARACTER_RESOURCE_ID = /^\d{6}$/

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function schemaError(message: string, detail?: unknown): never {
    throw new VoiceCatalogError('MANIFEST_SCHEMA_ERROR', message, detail)
}

function parseSubtitles(value: unknown, stableKey: string): VoiceSubtitles {
    if (!isRecord(value)) {
        schemaError(`Voice ${stableKey} subtitles must be an object`)
    }
    const subtitles: Record<string, string> = {}
    for (const [locale, text] of Object.entries(value)) {
        if (locale.length === 0 || typeof text !== 'string' || text.length === 0) {
            schemaError(`Voice ${stableKey} has an invalid subtitle entry`, { locale, text })
        }
        subtitles[locale] = text
    }
    return subtitles
}

function parseEntry(value: unknown, index: number): VoiceCatalogEntry {
    if (!isRecord(value)) schemaError(`Voice entry ${index} must be an object`)
    const stableKey = value.stableKey
    const characterResourceId = value.characterResourceId
    const order = value.order
    const audio = value.audio
    if (typeof stableKey !== 'string' || !OFFICIAL_STABLE_KEY.test(stableKey)) {
        schemaError(`Voice entry ${index} has an invalid official stableKey`, stableKey)
    }
    if (typeof characterResourceId !== 'string' || !CHARACTER_RESOURCE_ID.test(characterResourceId)) {
        schemaError(`Voice ${stableKey} has an invalid characterResourceId`, characterResourceId)
    }
    if (!Number.isInteger(order) || (order as number) < 1) {
        schemaError(`Voice ${stableKey} has an invalid order`, order)
    }
    if (!isRecord(audio)) schemaError(`Voice ${stableKey} audio must be an object`)
    const runtimeUrl = audio.runtimeUrl
    const format = audio.format
    const runtimeReady = audio.runtimeReady
    const failClosedReasons = audio.failClosedReasons
    const sourceStableKey = audio.sourceStableKey
    if (runtimeUrl !== null && typeof runtimeUrl !== 'string') {
        schemaError(`Voice ${stableKey} has an invalid runtimeUrl`, runtimeUrl)
    }
    if (typeof format !== 'string' || format.length === 0) {
        schemaError(`Voice ${stableKey} has an invalid format`, format)
    }
    if (typeof runtimeReady !== 'boolean') {
        schemaError(`Voice ${stableKey} has an invalid runtimeReady flag`, runtimeReady)
    }
    if (!Array.isArray(failClosedReasons) || failClosedReasons.some(reason => typeof reason !== 'string')) {
        schemaError(`Voice ${stableKey} has invalid failClosedReasons`, failClosedReasons)
    }
    if (typeof sourceStableKey !== 'string' || !SOURCE_STABLE_KEY.test(sourceStableKey)) {
        schemaError(`Voice ${stableKey} has an invalid sourceStableKey`, sourceStableKey)
    }
    if (runtimeReady && (runtimeUrl === null || runtimeUrl.length === 0)) {
        schemaError(`Voice ${stableKey} is runtime-ready without a runtimeUrl`)
    }
    const durationSeconds = value.durationSeconds
    if (
        durationSeconds !== undefined
        && (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds < 0)
    ) {
        schemaError(`Voice ${stableKey} has an invalid durationSeconds`, durationSeconds)
    }
    return {
        stableKey,
        characterResourceId,
        order: order as number,
        audio: {
            runtimeUrl,
            format,
            runtimeReady,
            failClosedReasons: [...failClosedReasons] as string[],
            sourceStableKey,
        },
        subtitles: parseSubtitles(value.subtitles, stableKey),
        ...(durationSeconds === undefined ? {} : { durationSeconds }),
    }
}

export function parseVoiceCatalogManifest(value: unknown): VoiceCatalogManifest {
    if (!isRecord(value) || value.schema !== VOICE_CATALOG_SCHEMA || !Array.isArray(value.entries)) {
        schemaError(`Voice manifest schema must be ${VOICE_CATALOG_SCHEMA}`)
    }
    const entries = value.entries.map(parseEntry)
    const stableKeys = new Set<string>()
    const characterOrders = new Set<string>()
    for (const entry of entries) {
        if (stableKeys.has(entry.stableKey)) {
            schemaError(`Duplicate voice stableKey: ${entry.stableKey}`)
        }
        stableKeys.add(entry.stableKey)
        const characterOrder = `${entry.characterResourceId}:${entry.order}`
        if (characterOrders.has(characterOrder)) {
            schemaError(`Duplicate voice character order: ${characterOrder}`)
        }
        characterOrders.add(characterOrder)
    }
    return {
        schema: VOICE_CATALOG_SCHEMA,
        ...(typeof value.generatedAt === 'string' ? { generatedAt: value.generatedAt } : {}),
        ...(isRecord(value.source) ? { source: value.source } : {}),
        ...(isRecord(value.counts) ? { counts: value.counts } : {}),
        entries,
    }
}

export async function fetchVoiceCatalogManifest(
    url = SOURCE_READY_VOICE_CATALOG_URL,
    signal?: AbortSignal,
): Promise<VoiceCatalogManifest> {
    const response = await fetch(url, { signal })
    if (!response.ok) {
        throw new VoiceCatalogError(
            'MANIFEST_HTTP_ERROR',
            `Voice manifest request failed: HTTP ${response.status}`,
            { url, status: response.status },
        )
    }
    return parseVoiceCatalogManifest(await response.json() as unknown)
}

export function resolveVoiceSubtitle(
    entry: VoiceCatalogEntry,
    locale: string,
): string | null {
    if (!Object.prototype.hasOwnProperty.call(entry.subtitles, locale)) return null
    return entry.subtitles[locale] ?? null
}

export function isVoiceRuntimeReady(entry: VoiceCatalogEntry): boolean {
    return entry.audio.runtimeReady && entry.audio.runtimeUrl !== null
}

export class VoiceCatalog {
    readonly manifest: VoiceCatalogManifest
    private readonly byStableKey: ReadonlyMap<string, VoiceCatalogEntry>
    private readonly byCharacter: ReadonlyMap<string, readonly VoiceCatalogEntry[]>

    constructor(value: VoiceCatalogManifest | unknown) {
        this.manifest = parseVoiceCatalogManifest(value)
        this.byStableKey = new Map(
            this.manifest.entries.map(entry => [entry.stableKey, entry]),
        )
        const byCharacter = new Map<string, VoiceCatalogEntry[]>()
        for (const entry of this.manifest.entries) {
            const entries = byCharacter.get(entry.characterResourceId) ?? []
            entries.push(entry)
            byCharacter.set(entry.characterResourceId, entries)
        }
        for (const entries of byCharacter.values()) {
            entries.sort((left, right) => left.order - right.order)
        }
        this.byCharacter = byCharacter
    }

    get characterResourceIds(): readonly string[] {
        return [...this.byCharacter.keys()].sort()
    }

    get(stableKey: string): VoiceCatalogEntry | undefined {
        return this.byStableKey.get(stableKey)
    }

    require(stableKey: string): VoiceCatalogEntry {
        const entry = this.get(stableKey)
        if (!entry) {
            throw new VoiceCatalogError(
                'VOICE_NOT_FOUND',
                `Voice is absent from the official catalog: ${stableKey}`,
                { stableKey },
            )
        }
        return entry
    }

    listForCharacter(characterResourceId: string): readonly VoiceCatalogEntry[] {
        return this.byCharacter.get(characterResourceId) ?? []
    }

    requireReady(stableKey: string): VoiceCatalogEntry {
        const entry = this.require(stableKey)
        if (!isVoiceRuntimeReady(entry)) {
            throw new VoiceCatalogError(
                'VOICE_NOT_READY',
                `Official voice source is not runtime-ready: ${stableKey}`,
                { stableKey, reasons: entry.audio.failClosedReasons },
            )
        }
        return entry
    }
}
