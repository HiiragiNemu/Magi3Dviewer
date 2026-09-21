import type { CombatJumpActionResourceEntry } from './characterActions/combatTypes'
import type { CombatActionSemantic, CombatEffectCueDefinition } from './characterLocomotion'

function nativeId(value: unknown): string | undefined {
    if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined
    return typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) ? value : undefined
}

/** Identity only: the existing consumer lazily loads and admits the exact native
 * product/alias tuple. No product fetch, animation registration or slot lookup. */
export function nativeCombatActionCue(
    entry: CombatJumpActionResourceEntry,
    actorId: string,
): { semantic: CombatActionSemantic; cue: CombatEffectCueDefinition } | undefined {
    if (entry.groupId !== 'official-combat-complete-actions'
        || entry.availability.status !== 'source-available'
        || entry.sourceStatus === 'unavailable'
        || !entry.resource.runtimeUrl) return
    const identity = entry.characterIdentity
    const skill = entry.skill
    const characterId = nativeId(identity.characterId)
    const styleMstId = nativeId(identity.styleMstId)
    const skillUniqueId = nativeId(skill.skillUniqueId)
    const skillMstId = nativeId(skill.skillMstId)
    if (characterId === undefined || characterId !== actorId || styleMstId === undefined
        || skillUniqueId === undefined || skillMstId === undefined
        || !identity.resourceName || !identity.logicalBundleKey
        || !skill.directionName || !skill.bundleLogicalKey) return
    if (entry.id !== `official-combat:${characterId}:${styleMstId}:${skillUniqueId}:${skillMstId}:${skill.directionName}`) return
    const slot: { key: string; semantic: CombatActionSemantic } | undefined = skill.semantic === 'normalAttack'
        ? { key: 'Q', semantic: 'basicAttack' }
        : skill.semantic === 'skill' ? { key: 'E', semantic: 'skill' }
            : skill.semantic === 'special' ? { key: 'R', semantic: 'ultimate' } : undefined
    if (!slot) return
    return {
        semantic: slot.semantic,
        cue: {
            id: `${entry.id}:vfx-start`,
            timeSeconds: 0,
            effectId: skill.directionName,
            anchor: slot.semantic === 'ultimate' ? 'character-root' : 'weapon-or-hand',
            payload: {
                schema: 'magius-viewer-combat-vfx-slot-v1',
                sourceActionId: entry.id,
                characterIdentity: { ...identity },
                key: slot.key,
                semantic: slot.semantic,
                directionName: skill.directionName,
                bundleKey: skill.bundleLogicalKey,
                skillUniqueId: skill.skillUniqueId,
                skillMstId: skill.skillMstId,
                requiredFields: ['vfxKey', 'anchor', 'lifetimeSeconds'],
            },
        },
    }
}
