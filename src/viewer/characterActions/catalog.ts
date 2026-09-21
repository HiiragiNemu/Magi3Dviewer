import { getLoadingTask, readLoadingResponse, yieldLoadingFrame } from '../../../magia-exedra-character-three/loadingProgress.ts'
import type {
    CharacterActionResourceEntry,
    CharacterActionResourceErrorCode,
    CharacterActionResourceManifest,
    NativeDungeonSemantic,
} from './types.ts'

export class CharacterActionResourceError extends Error {
    readonly code: CharacterActionResourceErrorCode
    readonly detail: Record<string, unknown>

    constructor(
        code: CharacterActionResourceErrorCode,
        message: string,
        detail: Record<string, unknown> = {},
    ) {
        super(message)
        this.name = 'CharacterActionResourceError'
        this.code = code
        this.detail = detail
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSemantic(value: unknown): value is NativeDungeonSemantic {
    return value === 'idle' || value === 'walk' || value === 'run'
}

export function assertCharacterActionManifest(
    value: unknown,
): asserts value is CharacterActionResourceManifest {
    if (!isRecord(value) || value.schema !== 'magius.character-action-resource-manifest.v1') {
        throw new CharacterActionResourceError(
            'MANIFEST_SCHEMA_ERROR',
            'Character action manifest schema mismatch',
        )
    }
    if (!Array.isArray(value.entries) || value.entries.length === 0) {
        throw new CharacterActionResourceError(
            'MANIFEST_SCHEMA_ERROR',
            'Character action manifest has no entries',
        )
    }
    const ids = new Set<string>()
    for (const candidate of value.entries) {
        if (!isRecord(candidate)
            || typeof candidate.id !== 'string'
            || typeof candidate.label !== 'string'
            || candidate.group !== '官方探索动作'
            || candidate.groupId !== 'official-dungeon-locomotion'
            || candidate.playback !== 'loop'
            || !isRecord(candidate.characterIdentity)
            || !Number.isInteger(candidate.characterIdentity.dungeonCharacterId)
            || !isRecord(candidate.clip)
            || !isSemantic(candidate.clip.semantic)
            || typeof candidate.clip.pathId !== 'string'
            || !isRecord(candidate.runtime)
            || typeof candidate.runtime.url !== 'string'
            || !isRecord(candidate.compatibility)
            || candidate.compatibility.mode !== 'native-only'
            || candidate.compatibility.crossCharacterFallback !== false) {
            throw new CharacterActionResourceError(
                'MANIFEST_SCHEMA_ERROR',
                'Character action manifest entry is invalid',
                { candidate },
            )
        }
        const expectedId = `official-dungeon:${candidate.characterIdentity.dungeonCharacterId}:${candidate.clip.semantic}:${candidate.clip.pathId}`
        if (candidate.id !== expectedId || ids.has(candidate.id)) {
            throw new CharacterActionResourceError(
                'MANIFEST_SCHEMA_ERROR',
                'Character action identity is invalid or duplicated',
                { id: candidate.id, expectedId },
            )
        }
        ids.add(candidate.id)
    }
}

export async function fetchCharacterActionManifest(
    url = '/character-actions/manifest.v1.json',
    signal?: AbortSignal,
): Promise<CharacterActionResourceManifest> {
    let response: Response
    try {
        response = await fetch(url, { signal })
    } catch (cause) {
        throw new CharacterActionResourceError(
            'MANIFEST_HTTP_ERROR',
            'Character action manifest request failed',
            { url, cause },
        )
    }
    if (!response.ok) {
        throw new CharacterActionResourceError(
            'MANIFEST_HTTP_ERROR',
            `Character action manifest returned HTTP ${response.status}`,
            { url, status: response.status },
        )
    }
    const bytes = await readLoadingResponse(response, { url, signal })
    getLoadingTask(signal)?.phase('decoding', url)
    await yieldLoadingFrame(signal)
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
    assertCharacterActionManifest(value)
    return value
}

export class CharacterActionCatalog {
    readonly manifest: CharacterActionResourceManifest
    private readonly byId = new Map<string, CharacterActionResourceEntry>()
    private readonly byCharacter = new Map<number, CharacterActionResourceEntry[]>()

    constructor(manifest: CharacterActionResourceManifest) {
        assertCharacterActionManifest(manifest)
        this.manifest = manifest
        for (const entry of manifest.entries) {
            this.byId.set(entry.id, entry)
            const id = entry.characterIdentity.dungeonCharacterId
            const actions = this.byCharacter.get(id) ?? []
            actions.push(entry)
            this.byCharacter.set(id, actions)
        }
        for (const actions of this.byCharacter.values()) {
            actions.sort((left, right) => (
                ['idle', 'walk', 'run'].indexOf(left.clip.semantic)
                - ['idle', 'walk', 'run'].indexOf(right.clip.semantic)
            ))
        }
    }

    list(): readonly CharacterActionResourceEntry[] {
        return [...this.manifest.entries]
    }

    listForCharacter(dungeonCharacterId: number): readonly CharacterActionResourceEntry[] {
        return [...(this.byCharacter.get(dungeonCharacterId) ?? [])]
    }

    get(actionId: string): CharacterActionResourceEntry | undefined {
        return this.byId.get(actionId)
    }

    require(actionId: string): CharacterActionResourceEntry {
        const entry = this.get(actionId)
        if (!entry) {
            throw new CharacterActionResourceError(
                'ACTION_NOT_FOUND',
                `Character action ${actionId} was not found`,
                { actionId },
            )
        }
        return entry
    }

    requireCharacter(dungeonCharacterId: number): readonly CharacterActionResourceEntry[] {
        const actions = this.listForCharacter(dungeonCharacterId)
        if (actions.length === 0) {
            throw new CharacterActionResourceError(
                'CHARACTER_NOT_FOUND',
                `Dungeon character ${dungeonCharacterId} has no native actions`,
                { dungeonCharacterId },
            )
        }
        return actions
    }
}

