import dataJson from './data/native-dungeon-fixed-transitions.json?raw'
import type { CharacterActionResourceEntry } from './types'

interface NativeFixedTransitionProfile {
    characterId: number
    controllerPathId: string
    modelKey: string
    transitions: Array<{ fromClipPathId: string; toClipPathId: string; seconds: number }>
}

const profiles = (JSON.parse(dataJson) as { profiles: NativeFixedTransitionProfile[] }).profiles

export interface NativeDungeonFixedTransitionPolicy {
    readonly controllerPathId: string
    readonly secondsByFamilyPair: ReadonlyMap<string, number>
}

/** Exact serialized fixed durations only. This is not an Animator FSM emulator. */
export function createNativeDungeonFixedTransitionPolicy(
    characterId: number,
    entries: readonly CharacterActionResourceEntry[],
    normalizeFamily: (name: string) => string,
): NativeDungeonFixedTransitionPolicy | undefined {
    const profile = profiles.find(row => row.characterId === characterId)
    if (!profile) return undefined
    const familyByPathId = new Map<string, string>()
    for (const entry of entries) {
        if (entry.characterIdentity.dungeonCharacterId !== characterId
            || entry.characterIdentity.modelKey !== profile.modelKey) continue
        familyByPathId.set(entry.clip.pathId, normalizeFamily(entry.clip.runtimeName))
    }
    const secondsByFamilyPair = new Map<string, number>()
    for (const edge of profile.transitions) {
        const from = familyByPathId.get(edge.fromClipPathId)
        const to = familyByPathId.get(edge.toClipPathId)
        if (from && to) secondsByFamilyPair.set(`${from}\0${to}`, edge.seconds)
    }
    return secondsByFamilyPair.size ? {
        controllerPathId: profile.controllerPathId,
        secondsByFamilyPair,
    } : undefined
}

export function nativeDungeonFixedTransitionSeconds(
    policy: NativeDungeonFixedTransitionPolicy,
    previousFamily: string | undefined,
    nextFamily: string,
    fallbackSeconds: number,
): number {
    return previousFamily
        ? policy.secondsByFamilyPair.get(`${previousFamily}\0${nextFamily}`) ?? fallbackSeconds
        : fallbackSeconds
}
