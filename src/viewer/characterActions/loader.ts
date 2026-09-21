import { getLoadingTask, yieldLoadingFrame } from '../../../magia-exedra-character-three/loadingProgress.ts'
import * as THREE from 'three'
import { fetchAndTryDecompressGzip } from '../../../magia-exedra-character-three/utils.ts'
import { CharacterActionResourceError } from './catalog.ts'
import { browserSafeActionRuntimeUrl } from './runtimeTransport.ts'
import type {
    CharacterActionResourceEntry,
    LoadedNativeDungeonAction,
    NativeDungeonActionRuntime,
    SerializedNativeDungeonClip,
} from './types.ts'

function absoluteUrl(value: string): string {
    const base = typeof document === 'undefined'
        ? 'http://localhost/'
        : document.baseURI
    return new URL(value.replace(/^\//, ''), base).href
}

function assertRuntime(value: unknown, dungeonCharacterId: number): asserts value is NativeDungeonActionRuntime {
    const candidate = value as Partial<NativeDungeonActionRuntime> | null
    if (!candidate
        || candidate.schema !== 'magius.native-dungeon-action-runtime.v1'
        || candidate.dungeonCharacterId !== dungeonCharacterId
        || typeof candidate.modelKey !== 'string'
        || typeof candidate.modelRootName !== 'string'
        || !Array.isArray(candidate.clips)
        || candidate.clips.length !== 3
        || !candidate.nodePaths
        || typeof candidate.nodePaths !== 'object'
        || !candidate.nodeBindings
        || typeof candidate.nodeBindings !== 'object') {
        throw new CharacterActionResourceError(
            'RUNTIME_SCHEMA_ERROR',
            `Native Dungeon runtime ${dungeonCharacterId} is invalid`,
            { dungeonCharacterId },
        )
    }
}

function findExactModelRoot(object: THREE.Object3D, rootName: string): THREE.Object3D {
    const matches: THREE.Object3D[] = []
    object.traverse(candidate => {
        if (candidate.name === rootName) matches.push(candidate)
    })
    if (matches.length === 0) {
        throw new CharacterActionResourceError(
            'RIG_ROOT_MISSING',
            `Native model root ${rootName} is missing`,
            { rootName },
        )
    }
    if (matches.length !== 1) {
        throw new CharacterActionResourceError(
            'RIG_ROOT_AMBIGUOUS',
            `Native model root ${rootName} is ambiguous`,
            { rootName, matches: matches.length },
        )
    }
    return matches[0]
}

function resolveOrdinalBinding(
    root: THREE.Object3D,
    binding: NativeDungeonActionRuntime['nodeBindings'][string],
): THREE.Object3D | undefined {
    let current = root
    for (const step of binding.ordinalPath) {
        const child = current.children[step.childIndex]
        if (!child || child.name !== step.name) return undefined
        current = child
    }
    return current
}

function retargetClip(
    serialized: SerializedNativeDungeonClip,
    runtime: NativeDungeonActionRuntime,
    root: THREE.Object3D,
): THREE.AnimationClip {
    const missing = new Set<string>()
    const tracks = serialized.tracks.flatMap(track => {
        const separator = track.name.indexOf('.')
        if (separator < 1) {
            missing.add(track.name)
            return []
        }
        const sourceNodeId = track.name.slice(0, separator)
        const binding = runtime.nodeBindings[sourceNodeId]
        if (!binding) {
            missing.add(sourceNodeId)
            return []
        }
        const property = track.name.slice(separator)
        if (binding.sourcePath.endsWith('/Root') && property === '.position') return []
        const target = resolveOrdinalBinding(root, binding)
        if (!target) {
            missing.add(binding.sourcePath)
            return []
        }
        return [{ ...track, name: `${target.uuid}${property}` }]
    })
    if (missing.size > 0) {
        throw new CharacterActionResourceError(
            'RIG_PATH_MISSING',
            `Native clip ${serialized.actionId} is missing rig paths`,
            { actionId: serialized.actionId, paths: [...missing] },
        )
    }
    const clip = THREE.AnimationClip.parse({ ...serialized, tracks } as never)
    clip.name = serialized.runtimeName
    return clip
}

export async function fetchNativeDungeonRuntime(
    entry: CharacterActionResourceEntry,
    signal?: AbortSignal,
): Promise<NativeDungeonActionRuntime> {
    const url = browserSafeActionRuntimeUrl(absoluteUrl(entry.runtime.url))
    let blob: Blob
    try {
        blob = await fetchAndTryDecompressGzip(url, undefined, undefined, signal)
    } catch (cause) {
        throw new CharacterActionResourceError(
            'RUNTIME_HTTP_ERROR',
            `Native Dungeon runtime request failed for ${entry.id}`,
            { actionId: entry.id, url, cause },
        )
    }
    let value: unknown
    try {
        getLoadingTask(signal)?.phase('decoding', url)
        await yieldLoadingFrame(signal)
        value = JSON.parse(await blob.text())
    } catch (cause) {
        throw new CharacterActionResourceError(
            'RUNTIME_SCHEMA_ERROR',
            `Native Dungeon runtime JSON is invalid for ${entry.id}`,
            { actionId: entry.id, url, cause },
        )
    }
    assertRuntime(value, entry.characterIdentity.dungeonCharacterId)
    return value
}

export class LoadedNativeDungeonActionSet {
    readonly dungeonCharacterId: number
    readonly modelKey: string
    readonly actions: readonly LoadedNativeDungeonAction[]
    private readonly byId: Map<string, LoadedNativeDungeonAction>

    constructor(
        dungeonCharacterId: number,
        modelKey: string,
        actions: readonly LoadedNativeDungeonAction[],
    ) {
        this.dungeonCharacterId = dungeonCharacterId
        this.modelKey = modelKey
        this.actions = actions
        this.byId = new Map(actions.map(action => [action.descriptor.id, action]))
    }

    get(actionId: string): LoadedNativeDungeonAction | undefined {
        return this.byId.get(actionId)
    }

    require(actionId: string): LoadedNativeDungeonAction {
        const action = this.get(actionId)
        if (!action) {
            throw new CharacterActionResourceError(
                'ACTION_NOT_FOUND',
                `Loaded native action ${actionId} was not found`,
                { actionId, dungeonCharacterId: this.dungeonCharacterId },
            )
        }
        return action
    }

    play(mixer: THREE.AnimationMixer, actionId: string, transitionSeconds = 0): THREE.AnimationAction {
        const loaded = this.require(actionId)
        const fadeSeconds = Number.isFinite(transitionSeconds) ? Math.max(0, transitionSeconds) : 0
        const access = mixer as THREE.AnimationMixer & { _actions?: THREE.AnimationAction[] }
        const outgoing = fadeSeconds > 0 ? (access._actions ?? []).filter(action => action.isRunning()) : []
        if (fadeSeconds > 0) outgoing.forEach(action => action.fadeOut(fadeSeconds))
        else mixer.stopAllAction()
        const action = mixer.clipAction(loaded.clip)
        action.setLoop(THREE.LoopRepeat, Infinity)
        action.clampWhenFinished = false
        action.reset().play()
        if (fadeSeconds > 0) action.fadeIn(fadeSeconds)
        return action
    }
}

export function attachNativeDungeonRuntime(
    object: THREE.Object3D & { animations: THREE.AnimationClip[] },
    modelKey: string,
    entries: readonly CharacterActionResourceEntry[],
    runtime: NativeDungeonActionRuntime,
): LoadedNativeDungeonActionSet {
    if (modelKey !== runtime.modelKey || entries.some(entry => (
        entry.characterIdentity.modelKey !== modelKey
        || entry.compatibility.exactModelKey !== modelKey
    ))) {
        throw new CharacterActionResourceError(
            'MODEL_MISMATCH',
            `Native Dungeon actions require exact model ${runtime.modelKey}`,
            { modelKey, expected: runtime.modelKey },
        )
    }
    const root = findExactModelRoot(object, runtime.modelRootName)
    const runtimeById = new Map(runtime.clips.map(clip => [clip.actionId, clip]))
    const loaded = entries.map(descriptor => {
        const serialized = runtimeById.get(descriptor.id)
        if (!serialized
            || serialized.sourceClipPathId !== descriptor.clip.pathId
            || serialized.runtimeName !== descriptor.clip.runtimeName) {
            throw new CharacterActionResourceError(
                'CLIP_MISSING',
                `Native runtime clip is missing for ${descriptor.id}`,
                { actionId: descriptor.id },
            )
        }
        return { descriptor, clip: retargetClip(serialized, runtime, root) }
    })
    const loadedNames = new Set(loaded.map(action => action.clip.name))
    object.animations = [
        ...object.animations.filter(clip => !loadedNames.has(clip.name)),
        ...loaded.map(action => action.clip),
    ]
    return new LoadedNativeDungeonActionSet(runtime.dungeonCharacterId, modelKey, loaded)
}
