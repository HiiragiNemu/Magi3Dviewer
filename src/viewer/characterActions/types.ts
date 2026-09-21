import type * as THREE from 'three'

export type CharacterActionPlaybackKind = 'oneShot' | 'loop' | 'timeline'
export type NativeDungeonSemantic = 'idle' | 'walk' | 'run'

export interface CharacterActionIdentity {
    dungeonCharacterId: number
    characterMstId: number
    style3dCharacterMstId: number
    modelKey: string
    modelRootName: string
}

export interface CharacterActionAvailability {
    runtimeReady: boolean
    tpsLoadable: boolean
    regions: {
        jpMobile: boolean
        steamJP: boolean
        tw: boolean
    }
}

export interface CharacterActionClipDescriptor {
    semantic: NativeDungeonSemantic
    sourceName: string
    runtimeName: string
    pathId: string
    durationSeconds: number
    sampleRate: number
    genericBindings: number
    serializedTrackCount: number
}

export interface CharacterActionResourceEntry {
    id: string
    label: string
    group: string
    groupId: string
    playback: CharacterActionPlaybackKind
    characterIdentity: CharacterActionIdentity
    availability: CharacterActionAvailability
    clip: CharacterActionClipDescriptor
    runtime: {
        url: string
        schema: 'magius.native-dungeon-action-runtime.v1'
    }
    sourceFamily: string
    compatibility: {
        mode: 'native-only'
        exactModelKey: string
        crossCharacterFallback: false
        externalAttachmentPolicy: string
        rootPolicy: string
    }
    motionReference: Record<string, unknown>
}

export interface CharacterActionResourceManifest {
    schema: 'magius.character-action-resource-manifest.v1'
    groups: Array<{
        id: string
        label: string
        playback: CharacterActionPlaybackKind
    }>
    counts: {
        distinctCharacters: number
        dungeonCharacterResources: number
        actions: number
        runtimeReadyActions: number
        tpsLoadableActions: number
    }
    identityRule: string
    rootPolicy: string
    fallbackPolicy: string
    entries: CharacterActionResourceEntry[]
}

export interface SerializedNativeDungeonClip {
    uuid: string
    name: string
    duration: number
    tracks: Array<Record<string, unknown> & { name: string }>
    blendMode?: number
    semantic: NativeDungeonSemantic
    actionId: string
    sourceName: string
    sourceClipPathId: string
    sourceDurationSeconds: number
    sourceSampleRate: number
    sourceGenericBindings: number
    runtimeName: string
    motionReference: Record<string, unknown>
}

export interface NativeDungeonActionRuntime {
    schema: 'magius.native-dungeon-action-runtime.v1'
    dungeonCharacterId: number
    characterMstId: number
    modelKey: string
    modelRootName: string
    sourceModelBundle: string
    sourceAnimationBundle: string
    controller: {
        pathID: string
        name: string
    }
    rootPolicy: string
    attachmentPolicy: string
    compatibility: {
        mode: 'native-model-only'
        exactModelKey: string
        exactModelRootName: string
        referencedNodePathCount: number
    }
    clips: SerializedNativeDungeonClip[]
    nodePaths: Record<string, string>
    nodeBindings: Record<string, {
        sourcePath: string
        ordinalPath: Array<{
            childIndex: number
            name: string
        }>
    }>
}

export interface LoadedNativeDungeonAction {
    descriptor: CharacterActionResourceEntry
    clip: THREE.AnimationClip
}

export type CharacterActionResourceErrorCode =
    | 'MANIFEST_HTTP_ERROR'
    | 'MANIFEST_SCHEMA_ERROR'
    | 'ACTION_NOT_FOUND'
    | 'ACTION_UNAVAILABLE'
    | 'CHARACTER_NOT_FOUND'
    | 'MODEL_MISMATCH'
    | 'RUNTIME_HTTP_ERROR'
    | 'RUNTIME_SCHEMA_ERROR'
    | 'RIG_ROOT_MISSING'
    | 'RIG_ROOT_AMBIGUOUS'
    | 'RIG_PATH_MISSING'
    | 'RIG_PATH_AMBIGUOUS'
    | 'RIG_FINGERPRINT_MISMATCH'
    | 'CLIP_MISSING'
