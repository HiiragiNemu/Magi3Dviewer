import { getLoadingTask, readLoadingResponse, yieldLoadingFrame } from '../../../magia-exedra-character-three/loadingProgress.ts'
import { CharacterActionResourceError } from './catalog.ts'
import type {
    CombatJumpActionResourceEntry,
    CombatJumpResourceManifest,
} from './combatTypes.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertEntry(candidate: unknown, ids: Set<string>): asserts candidate is CombatJumpActionResourceEntry {
    if (!isRecord(candidate)
        || typeof candidate.id !== 'string'
        || typeof candidate.label !== 'string'
        || !['official-combat-complete-actions', 'official-combat-jump-donors'].includes(String(candidate.groupId))
        || candidate.playbackKind !== 'timeline'
        || !isRecord(candidate.characterIdentity)
        || typeof candidate.characterIdentity.characterId !== 'string'
        || typeof candidate.characterIdentity.logicalBundleKey !== 'string'
        || !isRecord(candidate.availability)
        || !['source-available', 'unavailable'].includes(String(candidate.availability.status))
        || !isRecord(candidate.playback)
        || candidate.playback.kind !== 'timeline'
        || !isRecord(candidate.resource)
        || typeof candidate.resource.modelKey !== 'string'
        || typeof candidate.resource.modelRootName !== 'string'
        || typeof candidate.resource.rigFingerprint !== 'string'
        || !isRecord(candidate.skill)
        || typeof candidate.skill.skillUniqueId !== 'string'
        || typeof candidate.skill.skillMstId !== 'string'
        || typeof candidate.skill.directionName !== 'string'
        || typeof candidate.skill.bundleLogicalKey !== 'string') {
        throw new CharacterActionResourceError(
            'MANIFEST_SCHEMA_ERROR',
            'Combat/jump action manifest entry is invalid',
            { candidate },
        )
    }
    const entry = candidate as unknown as CombatJumpActionResourceEntry
    if (ids.has(entry.id)) {
        throw new CharacterActionResourceError(
            'MANIFEST_SCHEMA_ERROR',
            'Combat/jump action ID is duplicated',
            { actionId: entry.id },
        )
    }
    if (entry.groupId === 'official-combat-complete-actions') {
        if (!entry.id.startsWith('official-combat:') || !('synchronizedAction' in entry.playback)) {
            throw new CharacterActionResourceError(
                'MANIFEST_SCHEMA_ERROR',
                'Complete combat action identity/playback is invalid',
                { actionId: entry.id },
            )
        }
        const targets = entry.playback.synchronizedAction.targets
        if (entry.availability.status === 'source-available' && targets.length === 0) {
            throw new CharacterActionResourceError(
                'MANIFEST_SCHEMA_ERROR',
                'Available complete combat action has no synchronized targets',
                { actionId: entry.id },
            )
        }
        if (entry.availability.status === 'unavailable' && targets.length !== 0) {
            throw new CharacterActionResourceError(
                'MANIFEST_SCHEMA_ERROR',
                'Unavailable complete combat action exposes executable targets',
                { actionId: entry.id },
            )
        }
    } else {
        if (!entry.id.startsWith('official-combat-jump:') || !('jumpDonor' in entry.playback)) {
            throw new CharacterActionResourceError(
                'MANIFEST_SCHEMA_ERROR',
                'Combat jump donor identity/playback is invalid',
                { actionId: entry.id },
            )
        }
        const donor = entry.playback.jumpDonor
        if (entry.availability.status === 'source-available' && (
            !['A', 'B'].includes(donor.grade)
            || donor.compatibility !== 'exact-rig'
            || donor.segments.length !== 3
            || donor.compatibleCharacterIds.length !== 1
            || donor.compatibleCharacterIds[0] !== entry.characterIdentity.characterId
        )) {
            throw new CharacterActionResourceError(
                'MANIFEST_SCHEMA_ERROR',
                'Available jump donor is not an exact-rig three-phase donor',
                { actionId: entry.id },
            )
        }
    }
    if (entry.availability.status === 'source-available' && (
        entry.resource.runtimeSchema !== 'magius.combat-jump-action-runtime.v1'
        || typeof entry.resource.runtimeUrl !== 'string'
    )) {
        throw new CharacterActionResourceError(
            'MANIFEST_SCHEMA_ERROR',
            'Available combat/jump action has no exact runtime pointer',
            { actionId: entry.id },
        )
    }
    ids.add(entry.id)
}

export function assertCombatJumpManifest(value: unknown): asserts value is CombatJumpResourceManifest {
    if (!isRecord(value)
        || value.schema !== 'magius.all-character-combat-jump-resource-manifest.v1'
        || value.catalogSchema !== 'magius.official-character-action-catalog.v1'
        || !isRecord(value.counts)
        || value.counts.viewerModels !== 91
        || value.counts.mappedBattleModels !== 89
        || value.counts.canonicalStyleVariants !== 106
        || value.counts.combatEntries !== 296
        || value.counts.sourceAvailableActions !== 238
        || value.counts.unavailableActions !== 58
        || value.counts.jumpCandidateEntries !== 527
        || value.counts.sourceAvailableJumpDonors !== 177
        || !Array.isArray(value.characters)
        || value.characters.length !== 91
        || !Array.isArray(value.entries)
        || value.entries.length !== 823) {
        throw new CharacterActionResourceError(
            'MANIFEST_SCHEMA_ERROR',
            'Combat/jump action manifest schema or authority counts mismatch',
        )
    }
    const ids = new Set<string>()
    for (const candidate of value.entries) assertEntry(candidate, ids)
}

export async function fetchCombatJumpManifest(
    url = '/character-actions/combat-jump/manifest.v1.json',
    signal?: AbortSignal,
): Promise<CombatJumpResourceManifest> {
    let response: Response
    try {
        response = await fetch(url, { signal })
    } catch (cause) {
        throw new CharacterActionResourceError(
            'MANIFEST_HTTP_ERROR',
            'Combat/jump action manifest request failed',
            { url, cause },
        )
    }
    if (!response.ok) {
        throw new CharacterActionResourceError(
            'MANIFEST_HTTP_ERROR',
            `Combat/jump action manifest returned HTTP ${response.status}`,
            { url, status: response.status },
        )
    }
    const bytes = await readLoadingResponse(response, { url, signal })
    getLoadingTask(signal)?.phase('decoding', url)
    await yieldLoadingFrame(signal)
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
    assertCombatJumpManifest(value)
    return value
}

export class CombatJumpActionCatalog {
    readonly manifest: CombatJumpResourceManifest
    private readonly byId = new Map<string, CombatJumpActionResourceEntry>()
    private readonly byCharacter = new Map<string, CombatJumpActionResourceEntry[]>()

    constructor(manifest: CombatJumpResourceManifest) {
        assertCombatJumpManifest(manifest)
        this.manifest = manifest
        for (const entry of manifest.entries) {
            this.byId.set(entry.id, entry)
            const entries = this.byCharacter.get(entry.characterIdentity.characterId) ?? []
            entries.push(entry)
            this.byCharacter.set(entry.characterIdentity.characterId, entries)
        }
    }

    list(): readonly CombatJumpActionResourceEntry[] {
        return [...this.manifest.entries]
    }

    listForCharacter(characterId: string): readonly CombatJumpActionResourceEntry[] {
        return [...(this.byCharacter.get(characterId) ?? [])]
    }

    listAvailableForCharacter(characterId: string): readonly CombatJumpActionResourceEntry[] {
        return this.listForCharacter(characterId).filter(entry => entry.availability.status === 'source-available')
    }

    get(actionId: string): CombatJumpActionResourceEntry | undefined {
        return this.byId.get(actionId)
    }

    require(actionId: string): CombatJumpActionResourceEntry {
        const entry = this.get(actionId)
        if (!entry) {
            throw new CharacterActionResourceError('ACTION_NOT_FOUND', `Combat/jump action ${actionId} was not found`, { actionId })
        }
        return entry
    }

    requireCharacter(characterId: string): readonly CombatJumpActionResourceEntry[] {
        const entries = this.listForCharacter(characterId)
        if (entries.length === 0) {
            throw new CharacterActionResourceError('CHARACTER_NOT_FOUND', `Character ${characterId} has no combat/jump actions`, { characterId })
        }
        return entries
    }
}
