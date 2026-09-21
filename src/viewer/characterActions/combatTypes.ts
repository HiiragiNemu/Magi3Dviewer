import type * as THREE from 'three'
import type {
    OfficialCharacterActionCatalogEntry,
    OfficialNativeDungeonRuntimeInventory,
} from '../characterTimeline.ts'

export type CombatJumpGroupId =
    | 'official-combat-complete-actions'
    | 'official-combat-jump-donors'

export interface CombatJumpResourcePointer {
    runtimeUrl: string | null
    runtimeSchema: 'magius.combat-jump-action-runtime.v1' | null
    modelKey: string
    modelRootName: string
    rigFingerprint: string
}

export interface CombatJumpSkillIdentity {
    semantic: string
    skillUniqueId: string
    skillMstId: string
    directionName: string
    bundleLogicalKey: string
    timelineDurationSeconds?: number
}

export type CombatJumpActionResourceEntry = OfficialCharacterActionCatalogEntry & {
    groupId: CombatJumpGroupId
    resource: CombatJumpResourcePointer
    skill: CombatJumpSkillIdentity
    names?: Readonly<Record<string, string>>
    requiredComponents?: readonly Readonly<Record<string, unknown>>[]
    requiredExtensionTypes?: readonly ('camera' | 'scene-root' | 'cloth-control' | 'combat-vfx-cue')[]
    unavailableReasons?: readonly string[]
    sourceSequencePhase?: string
    evidence?: Readonly<Record<string, unknown>>
    extensionAuthority?: readonly Readonly<Record<string, unknown>>[]
    synchronizedDurationSeconds?: number
    latestRequiredExtensionSeconds?: number
    sourceStatus?: 'source-available' | 'unavailable'
    playbackOptions?: {
        holdSeconds: number | null
    }
}

export interface CombatJumpCharacterCoverage {
    characterId: string
    characterMstId: string
    modelKey: string
    modelRootName: string
    rigFingerprint: string
    battleAvailability: {
        status: 'source-available' | 'unavailable'
        reason?: string | null
    }
    runtime: {
        url: string
        schema: 'magius.combat-jump-action-runtime.v1'
    } | null
    entryIds: string[]
    unavailableSlots: Array<Record<string, unknown>>
}

export interface CombatJumpResourceManifest {
    schema: 'magius.all-character-combat-jump-resource-manifest.v1'
    catalogSchema: 'magius.official-character-action-catalog.v1'
    groups: Array<{
        id: CombatJumpGroupId
        label: string
        playback: 'timeline'
    }>
    identityRule: string
    fallbackPolicy: string
    rootPolicy: string
    counts: {
        viewerModels: number
        mappedBattleModels: number
        canonicalStyleVariants: number
        actionBundles: number
        sourceAvailableActions: number
        unavailableActions: number
        zeroSkillSlots: number
        scanErrors: number
        characterRuntimes: number
        runtimeComponents: number
        runtimeClips: number
        combatEntries: number
        playbackReadyCombatActions: number
        consumerUnavailableCombatActions: number
        jumpCandidateEntries: number
        sourceAvailableJumpDonors: number
        jumpDonorGrades: Record<'A' | 'B' | 'C', number>
        catalogEntries: number
    }
    characters: CombatJumpCharacterCoverage[]
    entries: CombatJumpActionResourceEntry[]
    unavailableSlots: Array<Record<string, unknown>>
    sources: Record<string, string>
}

export interface SerializedCombatJumpClip {
    uuid: string
    name: string
    duration: number
    tracks: Array<Record<string, unknown> & { name: string }>
    blendMode?: number
    actionId: string
    role: string
    sequencePhase: string
    sourceBundleLogicalKey: string
    sourceClipPathId: string
    sourceName: string
    sourceDurationSeconds: number
    sourceSampleRate: number
    sourceGenericBindings: number
    runtimeName: string
}

export interface CombatJumpRuntimeComponent {
    actionId: string
    role: string
    sequencePhase: string
    sourceClipPathId: string
    runtimeName: string
    serializedTrackCount: number
}

export interface CombatJumpActionRuntime {
    schema: 'magius.combat-jump-action-runtime.v1'
    characterId: string
    characterMstId: string
    modelKey: string
    modelRootName: string
    sourceModelBundle: string
    rigFingerprint: string
    rootPolicy: string
    compatibility: {
        mode: 'exact-model-only'
        exactModelKey: string
        exactModelRootName: string
        rigFingerprint: string
        referencedNodePathCount: number
    }
    clips: SerializedCombatJumpClip[]
    components: CombatJumpRuntimeComponent[]
    jumpCandidates: Array<Record<string, unknown>>
    nodePaths: Record<string, string>
    nodeBindings: Record<string, {
        sourcePath: string
        ordinalPath: Array<{
            childIndex: number
            name: string
        }>
    }>
}

export interface LoadedCombatJumpClip {
    actionId: string
    role: string
    sequencePhase: string
    pathId: string
    clip: THREE.AnimationClip
}

export interface CombatJumpTargetBinding {
    targetId: string
    role: string
    object: THREE.Object3D
}

export interface LoadedCombatJumpActionSetLike {
    readonly characterId: string
    readonly modelKey: string
    readonly rigFingerprint: string
    readonly entries: readonly CombatJumpActionResourceEntry[]
    readonly clips: readonly LoadedCombatJumpClip[]
    readonly availableTargetIds: readonly string[]
    readonly requiredExtensionTypes: readonly ('camera' | 'scene-root' | 'cloth-control' | 'combat-vfx-cue')[]
    readonly targetBindings: readonly CombatJumpTargetBinding[]
    readonly runtimeInventory: OfficialNativeDungeonRuntimeInventory
}
