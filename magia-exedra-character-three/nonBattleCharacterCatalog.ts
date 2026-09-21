export type NonBattleCharacterSourceFamily = 'story-cutscene'

export interface NonBattleCharacterCatalogEntry {
    stableKey: string
    identityKey: string
    style3dCharacterMstId: number
    resourceName: string
    names: {
        ja: string
        displayName: string
        alias: string
    }
    sourceFamily: NonBattleCharacterSourceFamily
    profileUrl: string
    publicationStatus: 'new-candidate' | 'runtime-ready' | 'fail-closed'
    failClosedReasons: readonly string[]
    eligibility: {
        ordinaryCharacterSelector: false
        battle: false
        tps: false
        dungeon: false
        magicalGirl: false
        storyCutscene: true
    }
}

const entries = [
    {
        stableKey: 'style3d-character:style3dCharacterMstId=113401|resourceName=chara_113401_model',
        identityKey: 'style3dCharacterMstId=113401|resourceName=chara_113401_model',
        style3dCharacterMstId: 113401,
        resourceName: 'chara_113401_model',
        names: {
            ja: '\u540d\u524d\u306e\u306a\u3044\u5c11\u5973',
            displayName: '\u540d\u524d\u306e\u306a\u3044\u5c11\u5973 / NAMAE',
            alias: 'NAMAE',
        },
        sourceFamily: 'story-cutscene',
        profileUrl: '/nonbattle-characters/characters/113401/profile.v1.json',
        publicationStatus: 'new-candidate',
        failClosedReasons: [],
        eligibility: {
            ordinaryCharacterSelector: false,
            battle: false,
            tps: false,
            dungeon: false,
            magicalGirl: false,
            storyCutscene: true,
        },
    },
    {
        stableKey: 'style3d-character:style3dCharacterMstId=113501|resourceName=chara_113501_model',
        identityKey: 'style3dCharacterMstId=113501|resourceName=chara_113501_model',
        style3dCharacterMstId: 113501,
        resourceName: 'chara_113501_model',
        names: {
            ja: 'A-Q',
            displayName: 'A-Q',
            alias: 'A-Q',
        },
        sourceFamily: 'story-cutscene',
        profileUrl: '/nonbattle-characters/characters/113501/profile.v1.json',
        publicationStatus: 'new-candidate',
        failClosedReasons: [],
        eligibility: {
            ordinaryCharacterSelector: false,
            battle: false,
            tps: false,
            dungeon: false,
            magicalGirl: false,
            storyCutscene: true,
        },
    },
    {
        stableKey: 'style3d-character:style3dCharacterMstId=113601|resourceName=chara_113601_model',
        identityKey: 'style3dCharacterMstId=113601|resourceName=chara_113601_model',
        style3dCharacterMstId: 113601,
        resourceName: 'chara_113601_model',
        names: {
            ja: '\u30e8\u30c0\u30ab',
            displayName: '\u30e8\u30c0\u30ab / \u30e8\u30bf\u30ab',
            alias: 'YODAKA',
        },
        sourceFamily: 'story-cutscene',
        profileUrl: '/nonbattle-characters/characters/113601/profile.v1.json',
        publicationStatus: 'new-candidate',
        failClosedReasons: [],
        eligibility: {
            ordinaryCharacterSelector: false,
            battle: false,
            tps: false,
            dungeon: false,
            magicalGirl: false,
            storyCutscene: true,
        },
    },
] as const satisfies readonly NonBattleCharacterCatalogEntry[]

export function listNonBattleCharacterCatalogEntries(): readonly NonBattleCharacterCatalogEntry[] {
    return entries
}

export function getNonBattleCharacterEntryById(
    id: number | string,
): NonBattleCharacterCatalogEntry | undefined {
    const key = String(id)
    return entries.find(entry => String(entry.style3dCharacterMstId) === key)
}

export function getNonBattleCharacterEntryByStableKey(
    stableKey: string,
): NonBattleCharacterCatalogEntry | undefined {
    return entries.find(entry => entry.stableKey === stableKey)
}

export function requireNonBattleCharacterEntryByStableKey(
    stableKey: string,
): NonBattleCharacterCatalogEntry {
    const entry = getNonBattleCharacterEntryByStableKey(stableKey)
    if (!entry) throw new Error(`Unknown nonbattle character stable key: ${stableKey}`)
    return entry
}

export function isNonBattleCharacterId(id: number | string): boolean {
    return getNonBattleCharacterEntryById(id) !== undefined
}
