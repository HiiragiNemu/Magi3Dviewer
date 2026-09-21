import type { NonBattleCharacterCatalogEntry } from 'magia-exedra-character-three/nonBattleCharacterCatalog'

export type CharacterCapability = boolean | 'runtime-scoped'

export interface PrimaryCharacterCatalogEntry {
    id: string
    name: string
    aliases: readonly string[]
    stableIdentity: string
    visible: true
    kind: 'standard' | 'story-cutscene'
    capabilities: {
        battle: CharacterCapability
        tps: CharacterCapability
        dungeon: CharacterCapability
        magicalGirl: CharacterCapability
        storyCutscene: CharacterCapability
        physics: 'runtime-scoped'
        actions: 'runtime-scoped' | 'story-cutscene'
    }
    order: number
    normalizedId: string
    normalizedName: string
    normalizedAliases: string
    normalizedAll: string
}

export interface CharacterUiControlState {
    battleDisabled: boolean
    tpsDisabled: boolean
    dungeonDisabled: boolean
    actionScope: 'runtime-scoped' | 'story-cutscene'
    physicsScope: 'runtime-scoped'
}

export function normalizeCharacterSearchText(
    value: string | number | null | undefined,
): string {
    return String(value ?? '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[＿_・･／/\\\-—–()（）\[\]［］【】「」『』:：]/g, '')
}

function uniqueSearchAliases(entry: NonBattleCharacterCatalogEntry | undefined): string[] {
    if (!entry) return []
    return [...new Set([
        entry.names.ja,
        entry.names.displayName,
        entry.names.alias,
        entry.resourceName,
        entry.identityKey,
        entry.stableKey,
    ].filter(Boolean))]
}

export function createPrimaryCharacterCatalog(
    standardCharacterIds: readonly string[],
    nonBattleEntries: readonly NonBattleCharacterCatalogEntry[],
    resolveDisplayName: (id: string) => string,
): readonly PrimaryCharacterCatalogEntry[] {
    const nonBattleById = new Map(nonBattleEntries.map(entry => [
        String(entry.style3dCharacterMstId),
        entry,
    ]))
    // The typed story/cutscene catalog follows its official sortOrder (100/200/300),
    // ahead of the standard catalog (100101+). Keep one unified ordered sequence.
    const orderedIds = [
        ...nonBattleEntries.map(entry => String(entry.style3dCharacterMstId)),
        ...standardCharacterIds,
    ]
    const seen = new Set<string>()

    return orderedIds.flatMap(id => {
        if (seen.has(id)) return []
        seen.add(id)
        const nonBattle = nonBattleById.get(id)
        const name = resolveDisplayName(id) || nonBattle?.names.displayName || id
        const aliases = uniqueSearchAliases(nonBattle)
        const normalizedAliases = normalizeCharacterSearchText(aliases.join(' '))
        const order = seen.size - 1
        return [{
            id,
            name,
            aliases,
            stableIdentity: nonBattle?.identityKey ?? `character-resource-id=${id}`,
            visible: true as const,
            kind: nonBattle ? 'story-cutscene' as const : 'standard' as const,
            capabilities: nonBattle
                ? {
                        battle: nonBattle.eligibility.battle,
                        tps: nonBattle.eligibility.tps,
                        dungeon: nonBattle.eligibility.dungeon,
                        magicalGirl: nonBattle.eligibility.magicalGirl,
                        storyCutscene: nonBattle.eligibility.storyCutscene,
                        physics: 'runtime-scoped' as const,
                        actions: 'story-cutscene' as const,
                    }
                : {
                        battle: 'runtime-scoped' as const,
                        tps: 'runtime-scoped' as const,
                        dungeon: 'runtime-scoped' as const,
                        magicalGirl: 'runtime-scoped' as const,
                        storyCutscene: 'runtime-scoped' as const,
                        physics: 'runtime-scoped' as const,
                        actions: 'runtime-scoped' as const,
                    },
            order,
            normalizedId: normalizeCharacterSearchText(id),
            normalizedName: normalizeCharacterSearchText(name),
            normalizedAliases,
            normalizedAll: normalizeCharacterSearchText(`${id} ${name} ${aliases.join(' ')}`),
        }]
    })
}

function scoreCharacterSearchEntry(
    entry: PrimaryCharacterCatalogEntry,
    query: string,
): number | null {
    if (!query) return null
    if (entry.normalizedId === query) return 0
    if (entry.normalizedId.startsWith(query)) return 1
    if (entry.normalizedName === query || entry.normalizedAliases === query) return 5
    if (entry.normalizedName.includes(query) || entry.normalizedAliases.includes(query)) return 10
    if (entry.normalizedAll.includes(query)) return 20
    return null
}

export function searchPrimaryCharacterCatalog(
    entries: readonly PrimaryCharacterCatalogEntry[],
    query: string,
    limit = 40,
): PrimaryCharacterCatalogEntry[] {
    const normalizedQuery = normalizeCharacterSearchText(query)
    if (!normalizedQuery) return []
    return entries
        .map(entry => ({ entry, score: scoreCharacterSearchEntry(entry, normalizedQuery) }))
        .filter((result): result is { entry: PrimaryCharacterCatalogEntry; score: number } => (
            result.score !== null
        ))
        .sort((a, b) => (
            a.score - b.score
            || a.entry.name.length - b.entry.name.length
            || a.entry.order - b.entry.order
        ))
        .slice(0, limit)
        .map(result => result.entry)
}

export function resolvePrimaryCharacterSelection(
    entries: readonly PrimaryCharacterCatalogEntry[],
    id: string | number,
): PrimaryCharacterCatalogEntry | undefined {
    const stableId = String(id)
    return entries.find(entry => entry.id === stableId)
}

export function characterUiControlState(
    entry: PrimaryCharacterCatalogEntry,
): CharacterUiControlState {
    return {
        battleDisabled: entry.capabilities.battle === false,
        tpsDisabled: entry.capabilities.tps === false,
        dungeonDisabled: entry.capabilities.dungeon === false,
        actionScope: entry.capabilities.actions,
        physicsScope: entry.capabilities.physics,
    }
}
