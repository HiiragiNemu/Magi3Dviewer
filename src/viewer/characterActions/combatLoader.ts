import { getLoadingTask, yieldLoadingFrame } from '../../../magia-exedra-character-three/loadingProgress.ts'
import * as THREE from 'three'
import { fetchAndTryDecompressGzip } from '../../../magia-exedra-character-three/utils.ts'
import { CharacterActionResourceError } from './catalog.ts'
import { browserSafeActionRuntimeUrl } from './runtimeTransport.ts'
import type {
    CombatJumpActionResourceEntry,
    CombatJumpActionRuntime,
    CombatJumpTargetBinding,
    LoadedCombatJumpActionSetLike,
    LoadedCombatJumpClip,
    SerializedCombatJumpClip,
} from './combatTypes.ts'

function absoluteUrl(value: string): string {
    const base = typeof document === 'undefined'
        ? 'http://localhost/'
        : document.baseURI
    return new URL(value.replace(/^\//, ''), base).href
}

function assertRuntime(value: unknown, expectedCharacterId: string): asserts value is CombatJumpActionRuntime {
    const candidate = value as Partial<CombatJumpActionRuntime> | null
    if (!candidate
        || candidate.schema !== 'magius.combat-jump-action-runtime.v1'
        || candidate.characterId !== expectedCharacterId
        || typeof candidate.modelKey !== 'string'
        || typeof candidate.modelRootName !== 'string'
        || typeof candidate.rigFingerprint !== 'string'
        || candidate.compatibility?.mode !== 'exact-model-only'
        || candidate.compatibility.exactModelKey !== candidate.modelKey
        || candidate.compatibility.exactModelRootName !== candidate.modelRootName
        || candidate.compatibility.rigFingerprint !== candidate.rigFingerprint
        || !Array.isArray(candidate.clips)
        || candidate.clips.length === 0
        || !Array.isArray(candidate.components)
        || candidate.components.length !== candidate.clips.length
        || !candidate.nodeBindings
        || typeof candidate.nodeBindings !== 'object') {
        throw new CharacterActionResourceError(
            'RUNTIME_SCHEMA_ERROR',
            `Combat/jump runtime ${expectedCharacterId} is invalid`,
            { expectedCharacterId },
        )
    }
}

function findExactModelRoot(object: THREE.Object3D, rootName: string): THREE.Object3D {
    const matches: THREE.Object3D[] = []
    object.traverse(candidate => {
        if (candidate.name === rootName) matches.push(candidate)
    })
    if (matches.length === 0) {
        throw new CharacterActionResourceError('RIG_ROOT_MISSING', `Combat model root ${rootName} is missing`, { rootName })
    }
    if (matches.length !== 1) {
        throw new CharacterActionResourceError(
            'RIG_ROOT_AMBIGUOUS',
            `Combat model root ${rootName} is ambiguous`,
            { rootName, matches: matches.length },
        )
    }
    return matches[0]
}

function resolveOrdinalBinding(
    root: THREE.Object3D,
    binding: CombatJumpActionRuntime['nodeBindings'][string],
): THREE.Object3D | undefined {
    let current = root
    for (const step of binding.ordinalPath) {
        const child = current.children[step.childIndex]
        if (!child || child.name !== step.name) return undefined
        current = child
    }
    return current
}

function isDiscreteVisibilityScaleTrack(track: Record<string, unknown>): boolean {
    const values = track.values
    if (!Array.isArray(values) || values.length < 6 || values.length % 3 !== 0) return false
    let hidden = false
    let visible = false
    for (let offset = 0; offset < values.length; offset += 3) {
        const sample = values.slice(offset, offset + 3).map(Number)
        if (!sample.every(Number.isFinite)) return false
        if (Math.max(...sample) - Math.min(...sample) > 1e-4) return false
        const uniformScale = (sample[0] + sample[1] + sample[2]) / 3
        if (uniformScale <= 0.01) hidden = true
        else if (Math.abs(uniformScale - 1) <= 0.01) visible = true
        else return false
    }
    return hidden && visible
}

function retargetClip(
    serialized: SerializedCombatJumpClip,
    runtime: CombatJumpActionRuntime,
    root: THREE.Object3D,
): THREE.AnimationClip {
    const missing = new Set<string>()
    const discreteVisibilityScaleTracks = new Set<string>()
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
        // Preserve exact authored Eye_L/Eye_R transforms.  Combat/timeline
        // playback owns the head/eye chain while it is active, so the Viewer
        // camera-relative gaze layer yields instead of deleting official motion.
        if (serialized.role === 'body' && binding.sourcePath.endsWith('/Root') && property === '.position') return []
        const target = resolveOrdinalBinding(root, binding)
        if (!target) {
            missing.add(binding.sourcePath)
            return []
        }
        const targetTrackName = `${target.uuid}${property}`
        // Grip_A/Grip_B are alternate official weapon variants. Their uniform
        // 0/0.001/1 scale keys are visibility switches, not authored bow squash.
        // Linear interpolation visibly shrinks and regrows the bow. Keep the
        // companion String translation intact (its large local values are
        // compensated while the parent variant is hidden), and switch variants
        // discretely at the official key time.
        if (
            serialized.role !== 'body'
            && property === '.scale'
            && isDiscreteVisibilityScaleTrack(track)
        ) discreteVisibilityScaleTracks.add(targetTrackName)
        return [{ ...track, name: targetTrackName }]
    })
    if (missing.size > 0) {
        throw new CharacterActionResourceError(
            'RIG_PATH_MISSING',
            `Combat clip ${serialized.actionId}/${serialized.role}/${serialized.sequencePhase} is missing rig paths`,
            { actionId: serialized.actionId, role: serialized.role, paths: [...missing] },
        )
    }
    const clip = THREE.AnimationClip.parse({ ...serialized, tracks } as never)
    for (const track of clip.tracks) {
        if (discreteVisibilityScaleTracks.has(track.name)) {
            track.setInterpolation(THREE.InterpolateDiscrete)
        }
    }
    clip.name = serialized.runtimeName
    return clip
}

function assertEntryRuntimeIdentity(
    entry: CombatJumpActionResourceEntry,
    runtime: CombatJumpActionRuntime,
): void {
    if (entry.characterIdentity.characterId !== runtime.characterId
        || entry.resource.modelKey !== runtime.modelKey
        || entry.resource.modelRootName !== runtime.modelRootName
        || entry.resource.rigFingerprint !== runtime.rigFingerprint) {
        throw new CharacterActionResourceError(
            'RIG_FINGERPRINT_MISMATCH',
            `Combat/jump entry ${entry.id} does not match runtime ${runtime.characterId}`,
            { actionId: entry.id, expectedRig: entry.resource.rigFingerprint, actualRig: runtime.rigFingerprint },
        )
    }
}

export async function fetchCombatJumpRuntime(
    entry: CombatJumpActionResourceEntry,
    signal?: AbortSignal,
): Promise<CombatJumpActionRuntime> {
    if (entry.availability.status !== 'source-available' || !entry.resource.runtimeUrl) {
        throw new CharacterActionResourceError(
            'ACTION_UNAVAILABLE',
            `Combat/jump action ${entry.id} is unavailable`,
            { actionId: entry.id, reason: entry.availability.reason },
        )
    }
    const url = browserSafeActionRuntimeUrl(absoluteUrl(entry.resource.runtimeUrl))
    let blob: Blob
    try {
        blob = await fetchAndTryDecompressGzip(url, undefined, undefined, signal)
    } catch (cause) {
        throw new CharacterActionResourceError(
            'RUNTIME_HTTP_ERROR',
            `Combat/jump runtime request failed for ${entry.id}`,
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
            `Combat/jump runtime JSON is invalid for ${entry.id}`,
            { actionId: entry.id, url, cause },
        )
    }
    assertRuntime(value, entry.characterIdentity.characterId)
    assertEntryRuntimeIdentity(entry, value)
    return value
}

function assertManifestClipsLoaded(
    entries: readonly CombatJumpActionResourceEntry[],
    runtime: CombatJumpActionRuntime,
): void {
    const clipKeys = new Set(runtime.clips.map(clip => `${clip.runtimeName}\u0000${clip.sourceClipPathId}`))
    for (const entry of entries) {
        if (entry.availability.status !== 'source-available') continue
        assertEntryRuntimeIdentity(entry, runtime)
        const descriptors = entry.groupId === 'official-combat-complete-actions'
            && 'synchronizedAction' in entry.playback
            ? entry.playback.synchronizedAction.targets.flatMap(target => Object.values(target.sequence))
            : entry.groupId === 'official-combat-jump-donors'
                && 'jumpDonor' in entry.playback
                ? entry.playback.jumpDonor.segments.map(segment => segment.sourceClip)
                : []
        for (const descriptor of descriptors) {
            if (!descriptor || !clipKeys.has(`${descriptor.name}\u0000${descriptor.pathId}`)) {
                throw new CharacterActionResourceError(
                    'CLIP_MISSING',
                    `Combat/jump runtime clip is missing for ${entry.id}`,
                    { actionId: entry.id, descriptor },
                )
            }
        }
    }
}

export class LoadedCombatJumpActionSet implements LoadedCombatJumpActionSetLike {
    readonly characterId: string
    readonly modelKey: string
    readonly rigFingerprint: string
    readonly entries: readonly CombatJumpActionResourceEntry[]
    readonly clips: readonly LoadedCombatJumpClip[]
    readonly availableTargetIds: readonly string[]
    readonly requiredExtensionTypes: readonly ('camera' | 'scene-root' | 'cloth-control' | 'combat-vfx-cue')[]
    readonly targetBindings: readonly CombatJumpTargetBinding[]
    readonly runtimeInventory
    private readonly clipByKey: Map<string, LoadedCombatJumpClip>

    constructor(
        runtime: CombatJumpActionRuntime,
        root: THREE.Object3D,
        entries: readonly CombatJumpActionResourceEntry[],
        clips: readonly LoadedCombatJumpClip[],
    ) {
        this.characterId = runtime.characterId
        this.modelKey = runtime.modelKey
        this.rigFingerprint = runtime.rigFingerprint
        this.entries = entries
        this.clips = clips
        this.clipByKey = new Map(clips.map(clip => [
            `${clip.actionId}\u0000${clip.role}\u0000${clip.sequencePhase}`,
            clip,
        ]))
        const targetRoles = new Map<string, string>()
        const extensionTypes = new Set<'camera' | 'scene-root' | 'cloth-control' | 'combat-vfx-cue'>()
        for (const entry of entries) {
            if (entry.availability.status !== 'source-available') continue
            for (const extensionType of entry.requiredExtensionTypes ?? []) extensionTypes.add(extensionType)
            if (entry.groupId === 'official-combat-complete-actions' && 'synchronizedAction' in entry.playback) {
                for (const target of entry.playback.synchronizedAction.targets) targetRoles.set(target.targetId, target.role)
            } else if (entry.groupId === 'official-combat-jump-donors') {
                targetRoles.set(`combat:${runtime.characterId}:body`, 'body')
            }
        }
        for (const clip of clips) {
            if (clip.role === 'body' || clip.role === 'weapon-a') {
                targetRoles.set(`combat:${runtime.characterId}:${clip.role}`, clip.role)
            }
        }
        this.availableTargetIds = [...targetRoles.keys()].sort()
        this.requiredExtensionTypes = [...extensionTypes].sort()
        this.targetBindings = [...targetRoles].map(([targetId, role]) => ({ targetId, role, object: root }))
        const bodyInventory = new Map<string, { name: string; pathId: string }>()
        for (const loaded of clips) {
            const clip = runtime.clips.find(candidate => candidate.runtimeName === loaded.clip.name)
            if (!clip) continue
            if (clip.role !== 'body') continue
            bodyInventory.set(`${clip.runtimeName}\u0000${clip.sourceClipPathId}`, {
                name: clip.runtimeName,
                pathId: clip.sourceClipPathId,
            })
        }
        this.runtimeInventory = {
            dungeonCharacterId: 'typed BLANK: combat Timeline has no Dungeon controller',
            characterId: runtime.characterId,
            resourceName: runtime.modelRootName,
            controllerPathId: 'typed BLANK: combat Timeline has no AnimatorController pathID',
            bodyTargetId: `combat:${runtime.characterId}:body`,
            clips: [...bodyInventory.values()],
            externalWeaponTargetIds: [],
        }
    }

    getClip(actionId: string, role: string, sequencePhase: string): LoadedCombatJumpClip | undefined {
        return this.clipByKey.get(`${actionId}\u0000${role}\u0000${sequencePhase}`)
    }

    requireClip(actionId: string, role: string, sequencePhase: string): LoadedCombatJumpClip {
        const clip = this.getClip(actionId, role, sequencePhase)
        if (!clip) {
            throw new CharacterActionResourceError(
                'CLIP_MISSING',
                `Loaded combat clip ${actionId}/${role}/${sequencePhase} was not found`,
                { actionId, role, sequencePhase },
            )
        }
        return clip
    }
}

export function attachCombatJumpRuntime(
    object: THREE.Object3D & { animations: THREE.AnimationClip[] },
    modelKey: string,
    entries: readonly CombatJumpActionResourceEntry[],
    runtime: CombatJumpActionRuntime,
): LoadedCombatJumpActionSet {
    if (modelKey !== runtime.modelKey || entries.some(entry => entry.characterIdentity.characterId !== runtime.characterId)) {
        throw new CharacterActionResourceError(
            'MODEL_MISMATCH',
            `Combat/jump actions require exact model ${runtime.modelKey}`,
            { modelKey, expected: runtime.modelKey, characterId: runtime.characterId },
        )
    }
    assertManifestClipsLoaded(entries, runtime)
    const root = findExactModelRoot(object, runtime.modelRootName)
    const requiredClipKeys = new Set<string>()
    const manifestCombatActionIds = new Set(entries.filter(entry => (
        entry.groupId === 'official-combat-complete-actions'
    )).map(entry => entry.id))
    for (const entry of entries) {
        if (entry.availability.status !== 'source-available') continue
        const descriptors = entry.groupId === 'official-combat-complete-actions'
            && 'synchronizedAction' in entry.playback
            ? entry.playback.synchronizedAction.targets.flatMap(target => Object.values(target.sequence))
            : entry.groupId === 'official-combat-jump-donors'
                && 'jumpDonor' in entry.playback
                ? entry.playback.jumpDonor.segments.map(segment => segment.sourceClip)
                : []
        for (const descriptor of descriptors) {
            if (descriptor) requiredClipKeys.add(`${descriptor.name}\u0000${descriptor.pathId}`)
        }
    }
    const loaded = runtime.clips.filter(serialized => (
        requiredClipKeys.has(`${serialized.runtimeName}\u0000${serialized.sourceClipPathId}`)
        || (
            manifestCombatActionIds.has(serialized.actionId)
            && (serialized.role === 'body' || serialized.role === 'weapon-a')
        )
    )).map(serialized => ({
        actionId: serialized.actionId,
        role: serialized.role,
        sequencePhase: serialized.sequencePhase,
        pathId: serialized.sourceClipPathId,
        clip: retargetClip(serialized, runtime, root),
    })).filter(loadedClip => loadedClip.clip.tracks.length > 0)
    const loadedNames = new Set(loaded.map(item => item.clip.name))
    object.animations = [
        ...object.animations.filter(clip => !loadedNames.has(clip.name)),
        ...loaded.map(item => item.clip),
    ]
    return new LoadedCombatJumpActionSet(runtime, root, entries, loaded)
}
