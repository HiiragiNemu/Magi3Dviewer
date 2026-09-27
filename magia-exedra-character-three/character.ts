import * as THREE from 'three';
import { HomeNativeTransitionPlayback, type SettledHomeTransitionCheckpoint } from './homeNativeTransition';
import { disposeObject } from './utils';
import { addAnimationLoop, getClockDelta, removeAnimationLoop } from './renderer';
import { createAnimationPoseChannels, type AnimationPoseChannelRequest } from './animationPoseChannels';
import {
    CharacterExpressionController,
    type HomeAnimationRuntime,
    type HomeExpressionRuntime,
} from './homeRuntime';

export interface ObjectUserData {
    characterId: number
    /** Original meshes of the object. Does not include outline meshes */
    meshes: THREE.Mesh[]
    textures: THREE.Texture[]
    outlineMeshes: THREE.SkinnedMesh[]
    animationLoops: Function[]
    disposeCallbacks: Array<() => void>
    homeAnimationRuntime?: HomeAnimationRuntime
    homeExpressionRuntime?: HomeExpressionRuntime
}

/**
 * Exedra exports one logical animation as a full-body clip plus optional weapon
 * or masked companion clips. Normalize only documented suffixes. The previous
 * startsWith() grouping could activate unrelated animations that happened to
 * share a prefix, which is especially destructive when clips key the same bones.
 */
export function getAnimationFamilyName(name: string): string {
    return name
        .replace(/_weapon_[a-z0-9]+(?=_|$)/gi, '')
        .replace(/_\d+$/g, '')
}

function isCompanionAnimationName(name: string): boolean {
    return /_weapon_[a-z0-9]+(?=_|$)/i.test(name) || /_\d+$/.test(name)
}

function isHomeAnimationHelper(name: string): boolean {
    return (
        /^HomeWeapon[A-Z0-9_]*Hide(?:_|$)/.test(name)
        || /^HomeTransition/.test(name)
        || /_weapon_[a-z0-9]+/i.test(name)
        || /_Hide(?:_|$)/.test(name)
    )
}

function getHomeLoopAfterStart(
    name: string,
    runtime?: HomeAnimationRuntime,
): string | undefined {
    const family = getAnimationFamilyName(name)
    const official = runtime?.actions?.unique01
    if (official && family === getAnimationFamilyName(official.startFamily)) {
        return getAnimationFamilyName(official.loopFamily)
    }
    const match = name.match(/^(Home(?:Wait|Unique)\d+?)_(?:S|SE)\d?$/)
    return match ? `${match[1]}_L` : undefined
}

export interface ChatacterAnimationPlayOptions {
    /** undefined: authored behavior; 0: forever; positive integer: total plays. */
    repetitions?: number
    transitionSeconds?: number
    localTimeSeconds?: number
    /** Explicit settled native state 16; AnyState entry arbitration is not inferred. */
    nativeHomeTransition?: SettledHomeTransitionCheckpoint
}

export default class MagiaExedraCharacter3D {
    /** 
     * Can be added to three.js scene.
     * 
     * The scene must use a renderer created by `MagiaExedraCharacterThree.createRenderer()` to render correctly.
     */
    object: THREE.Group
    userData: ObjectUserData
    animation: ChatacterAnimation
    expression?: CharacterExpressionController
    meshes: CharacterMeshController[]

    constructor(object: THREE.Group) {
        this.object = object
        this.userData = object.userData as ObjectUserData

        this.animation = new ChatacterAnimation(this)
        this.meshes = this.userData.meshes.map(x => new CharacterMeshController(x))
        this.expression = this.userData.homeExpressionRuntime
            ? new CharacterExpressionController(
                this.userData.meshes,
                this.userData.homeExpressionRuntime,
            )
            : undefined

        addAnimationLoop(this.animationLoop)
    }

    animationLoop = () => {
        this.animation.animationLoop()
        this.expression?.update(getClockDelta())
        this.userData.animationLoops.forEach(x => x())
    }

    get animations(): string[] {
        return [...new Set(
            this.object.animations
                .filter(x => x.tracks.length > 0)
                .filter(x => !isHomeAnimationHelper(x.name))
                .map(x => getAnimationFamilyName(x.name))
        )].sort()
    }

    private _disposed = false

    get disposed() {
        return this._disposed
    }

    dispose() {
        this.userData.disposeCallbacks.forEach(callback => callback())
        this.userData.disposeCallbacks.length = 0
        removeAnimationLoop(this.animationLoop)
        this.animation.mixer.stopAllAction()
        this.animation.mixer.uncacheRoot(this.object)
        disposeObject(this.object)
        this.userData.textures.forEach(x => x.dispose())

        this._disposed = true
    }
}

export class ChatacterAnimation {
    private _character: MagiaExedraCharacter3D
    private _nativeHomeTransition?: HomeNativeTransitionPlayback
    mixer: THREE.AnimationMixer
    private poseChannels: ReturnType<typeof createAnimationPoseChannels>
    private _default?: string | null = null
    private _current?: string
    private _clamped = false
    private _queuedHomeLoop?: string
    private _pendingHomeLoop?: { name: string; repetitions?: number }
    private _queuedHomeGateAction?: THREE.AnimationAction
    private _activeActions: THREE.AnimationAction[] = []
    private _preparedFamilies = new Map<string, THREE.AnimationClip[]>()
    private _repeatCompleted = 0
    private _repeatLocalTime = 0
    private _repetitions?: number
    private _finishGateAction?: THREE.AnimationAction
    private _queuedRepetitions?: number
    paused = false

    constructor(character: MagiaExedraCharacter3D) {
        this._character = character
        this.mixer = new THREE.AnimationMixer(this._character.object)
        this.poseChannels = createAnimationPoseChannels(this._character.object, this.mixer, () => !this._character.disposed)

        this.mixer.addEventListener('finished', this.onFinishHandler)
    }

    acquirePoseChannels(request: AnimationPoseChannelRequest) { return this.poseChannels.acquire(request) }

    play(name: string, loop = false, options: ChatacterAnimationPlayOptions = {}) {
        /*
        Character, weapon and partially masked body motion can be exported as
        separate AnimationClips. The numbered clip is not consistently the
        weapon clip: Ashley 110701 has families where `_1` is the full-body clip
        and other families where the unnumbered clip is full-body. The family is
        therefore ordered by binding coverage, not by suffix.
        */
        const repetitions = options.repetitions
        if (repetitions !== undefined && (!Number.isSafeInteger(repetitions) || repetitions < 0)) {
            throw new RangeError('Animation repetitions must be a non-negative safe integer')
        }
        if (options.nativeHomeTransition) {
            const unique = this._character.userData.homeAnimationRuntime?.actions?.unique01
            const descriptor = unique?.nativeTransition
            if (!descriptor || getAnimationFamilyName(name) !== getAnimationFamilyName(unique!.startFamily)) {
                throw new Error('Native Home transition checkpoint requires its declared Start action')
            }
            const playback = new HomeNativeTransitionPlayback(this.mixer, descriptor,
                options.nativeHomeTransition, family => this.getPreparedAnimationClipsByName(family), repetitions)
            this._nativeHomeTransition?.dispose()
            this.mixer.stopAllAction()
            this._nativeHomeTransition = playback
            this._pendingHomeLoop = undefined
            this._queuedHomeLoop = undefined
            this._queuedHomeGateAction = undefined
            this._queuedRepetitions = undefined
            this._finishGateAction = undefined
            this._activeActions = []
            this._repetitions = repetitions
            this.paused = false
            this._clamped = false
            playback.seekElapsed(0)
            return
        }
        this._nativeHomeTransition?.dispose()
        this._nativeHomeTransition = undefined
        this._pendingHomeLoop = undefined
        const queuedHomeLoop = getHomeLoopAfterStart(
            name,
            this._character.userData.homeAnimationRuntime,
        )
        if (
            queuedHomeLoop
            && this._character.object.animations.some(
                clip => getAnimationFamilyName(clip.name) === queuedHomeLoop,
            )
        ) {
            loop = false
            this._queuedHomeLoop = queuedHomeLoop
            this._queuedRepetitions = repetitions
        } else {
            this._queuedHomeLoop = undefined
            this._queuedHomeGateAction = undefined
            this._queuedRepetitions = undefined
        }

        const animations = this.getPreparedAnimationClipsByName(name)
        if (animations.length == 0) {
            console.warn(`Animation "${name}" not found in "${this._character.object.name}"`)
            return
        }

        const uniqueAction = this._character.userData.homeAnimationRuntime
            ?.actions?.unique01
        const requestedTransitionSeconds = options.transitionSeconds
        const enterTransitionSeconds = (
            typeof requestedTransitionSeconds === 'number'
            && Number.isFinite(requestedTransitionSeconds)
        )
            ? Math.max(0, requestedTransitionSeconds)
            : queuedHomeLoop
                ? uniqueAction?.enterTransitionSeconds ?? 0
                : 0
        const requestedLocalTimeSeconds = options.localTimeSeconds
        const localTimeSeconds = (
            typeof requestedLocalTimeSeconds === 'number'
            && Number.isFinite(requestedLocalTimeSeconds)
        )
            ? Math.max(0, requestedLocalTimeSeconds)
            : 0
        if (enterTransitionSeconds > 0 && this._activeActions.length > 0) {
            for (const action of this._activeActions) {
                action.fadeOut(enterTransitionSeconds)
            }
        } else {
            this.mixer.stopAllAction()
        }

        this._repetitions = repetitions
        this._repeatCompleted = 0
        this._repeatLocalTime = 0
        const totalPlays = queuedHomeLoop ? 1 : repetitions === undefined ? (loop ? Infinity : 1) : repetitions === 0 ? Infinity : repetitions
        const repeat = totalPlays > 1
        const nextActions: THREE.AnimationAction[] = []
        for (const [index, animation] of animations.entries()) {
            const action = this.mixer.clipAction(animation);

            action.setLoop(repetitions === undefined && repeat ? THREE.LoopRepeat : THREE.LoopOnce, totalPlays)
            action.clampWhenFinished = repetitions !== undefined || Number.isFinite(totalPlays)

            action.reset()
            action.time = animation.duration > 0
                ? repeat
                    ? localTimeSeconds % animation.duration
                    : Math.min(localTimeSeconds, animation.duration)
                : 0
            action.play()
            if (enterTransitionSeconds > 0) {
                action.fadeIn(enterTransitionSeconds)
            }
            nextActions.push(action)
            if (queuedHomeLoop && index === 0) {
                this._queuedHomeGateAction = action
            }
        }
        this._activeActions = nextActions
        this._finishGateAction = repetitions === undefined ? undefined : nextActions.reduce((longest, action) => (
            action.getClip().duration > longest.getClip().duration ? action : longest
        ))

        this.paused = false
        this._current = getAnimationFamilyName(name)
        this._clamped = false
        // Evaluate the requested local action time immediately without calling
        // mixer.setTime(), which would rewind and invalidate scheduled fades.
        this.updateMixer(0)

        console.log('Playing animation family:', this._current, animations.map(x => x.name))
    }

    get repetitions(): number | undefined { return this._repetitions }

    /** Other transport owners may reuse the mixer without a legacy repeat request. */
    clearRepetitionLimit() {
        this._repetitions = undefined
        this._finishGateAction = undefined
        this._queuedRepetitions = undefined
    }

    clear() {
        this._nativeHomeTransition?.dispose()
        this._nativeHomeTransition = undefined
        this.clearRepetitionLimit()
        this._pendingHomeLoop = undefined
        this.mixer.stopAllAction()
        this._activeActions = []
        this._current = undefined
        this._queuedHomeLoop = undefined
        this._queuedHomeGateAction = undefined
    }

    getAnimationClipsByName(name: string): THREE.AnimationClip[] {
        const family = getAnimationFamilyName(name)
        const clips = this._character.object.animations
            .filter(clip => getAnimationFamilyName(clip.name) === family)
            .sort((a, b) => {
                // The clip with the broadest binding coverage is the base pose.
                // This is required for Ashley: e.g. Wait_L has ~69 target
                // channels while Wait_L_1 has ~603, but CommonWait_L uses the
                // opposite suffix arrangement.
                const coverage = b.tracks.length - a.tracks.length
                if (coverage !== 0) return coverage

                const exactA = a.name === name || a.name === family ? 0 : 1
                const exactB = b.name === name || b.name === family ? 0 : 1
                if (exactA !== exactB) return exactA - exactB

                const companionA = isCompanionAnimationName(a.name) ? 1 : 0
                const companionB = isCompanionAnimationName(b.name) ? 1 : 0
                if (companionA !== companionB) return companionA - companionB

                return a.name.localeCompare(b.name)
            })
        if (family.startsWith('Home') && !isHomeAnimationHelper(family)) {
            const configuredHelpers = new Set(
                (this._character.userData.homeAnimationRuntime?.helpers ?? [])
                    .map(getAnimationFamilyName),
            )
            const weaponHelpers = this._character.object.animations.filter(clip => (
                /^HomeWeapon.*Hide$/.test(getAnimationFamilyName(clip.name))
                && (
                    configuredHelpers.size === 0
                    || configuredHelpers.has(getAnimationFamilyName(clip.name))
                )
            ))
            // A Home companion is the action for its prop, not an extra layer
            // underneath that prop's Hide action. A helper can hide an ancestor
            // joint while the companion keys descendants (e.g. cup and saucer),
            // so exact track-name deduplication alone does not protect the prop.
            const authoredBranches = new Set<THREE.Object3D>()
            const root = this._character.object
            const trackTarget = (track: THREE.KeyframeTrack) => {
                const binding = THREE.PropertyBinding.parseTrackName(track.name)
                return THREE.PropertyBinding.findNode(root, binding.nodeName) as THREE.Object3D | null
            }
            for (const clip of clips) for (const track of clip.tracks) {
                for (let node = trackTarget(track); node && node !== root; node = node.parent) authoredBranches.add(node)
            }
            for (const helper of weaponHelpers) {
                if (clips.includes(helper)) continue
                const tracks = helper.tracks.filter(track => {
                    const target = trackTarget(track)
                    return !target || !authoredBranches.has(target)
                })
                if (tracks.length === 0) continue
                if (tracks.length === helper.tracks.length) clips.push(helper)
                else {
                    const scopedHelper = helper.clone()
                    scopedHelper.tracks = tracks
                    clips.push(scopedHelper)
                }
            }
        }
        return clips
    }

    /**
     * Exported companion clips can contain duplicate body channels in addition
     * to weapon channels. Playing them at equal weight blends conflicting
     * transforms onto the same bone and produces a broken pose. The full-body
     * clip (largest track set) owns each binding; smaller companions retain only
     * previously unclaimed channels.
     */
    private getPreparedAnimationClipsByName(name: string): THREE.AnimationClip[] {
        const family = getAnimationFamilyName(name)
        const cached = this._preparedFamilies.get(family)
        if (cached) return cached

        const sourceClips = this.getAnimationClipsByName(name)
        const claimedTracks = new Map<string, string>()
        const prepared: THREE.AnimationClip[] = []

        for (const source of sourceClips) {
            const duplicateTracks: string[] = []
            const uniqueTracks = source.tracks.filter(track => {
                const owner = claimedTracks.get(track.name)
                if (owner) {
                    duplicateTracks.push(`${track.name} (already owned by ${owner})`)
                    return false
                }
                claimedTracks.set(track.name, source.name)
                return true
            })

            if (duplicateTracks.length > 0) {
                console.warn(
                    `Removed duplicate animation bindings from "${source.name}" in family "${family}":`,
                    duplicateTracks,
                )
            }

            if (uniqueTracks.length == 0) {
                console.warn(`Skipped animation companion "${source.name}" because every track duplicates an earlier clip`)
                continue
            }

            if (uniqueTracks.length === source.tracks.length) {
                prepared.push(source)
                continue
            }

            const clone = source.clone()
            clone.name = source.name
            clone.tracks = uniqueTracks
            clone.duration = source.duration
            prepared.push(clone)
        }

        this._preparedFamilies.set(family, prepared)
        return prepared
    }

    private flushPendingHomeLoop(): void {
        const pending = this._pendingHomeLoop
        if (!pending) return
        this._pendingHomeLoop = undefined
        this.play(pending.name, true, { repetitions: pending.repetitions })
    }

    private updateMixer(delta: number): void {
        this.mixer.update(delta)
        this.flushPendingHomeLoop()
    }

    animationLoop = () => {
        if (this.paused) return
        const delta = getClockDelta()
        if (this._nativeHomeTransition) {
            this._nativeHomeTransition.advance(Math.max(0, delta * this.mixer.timeScale))
            if (this._nativeHomeTransition.completed) this.paused = true
            return
        }
        if (this._repetitions === undefined || this._queuedHomeLoop || !(this.duration > 0)) {
            this.updateMixer(delta)
            return
        }
        // A family repeats together, even when a weapon/helper clip is shorter.
        // Split only at family boundaries, preserving the rest of this frame.
        let remaining = delta * this.mixer.timeScale
        if (!(remaining > 0)) return
        const duration = this.duration
        while (remaining > 0) {
            const step = Math.min(remaining, Math.max(0, duration - this._repeatLocalTime))
            this.updateMixer(step / this.mixer.timeScale)
            this._repeatLocalTime += step
            remaining = Math.max(0, remaining - step)
            if (this._repeatLocalTime < duration - 1e-9) break
            this._repeatCompleted++
            if (this._repetitions !== 0 && this._repeatCompleted >= this._repetitions) {
                this._repeatLocalTime = duration
                this._clamped = true
                this.paused = true
                break
            }
            this._repeatLocalTime = 0
            this._clamped = false
            for (const action of this._activeActions) action.reset().setLoop(THREE.LoopOnce, 1).play()
        }
    }

    onFinishHandler = (event: { action: THREE.AnimationAction }) => {
        if (this._nativeHomeTransition) return
        if (
            this._queuedHomeLoop
            && event.action === this._queuedHomeGateAction
        ) {
            const loop = this._queuedHomeLoop
            this._queuedHomeLoop = undefined
            this._queuedHomeGateAction = undefined
            const repetitions = this._queuedRepetitions
            this._queuedRepetitions = undefined
            // AnimationMixer is still iterating the finishing actions. Starting
            // another family here re-enters update(0), corrupting constant prop
            // scale accumulators. Commit the handoff after that update returns.
            this._pendingHomeLoop = { name: loop, repetitions }
            return
        }
        if (this._finishGateAction && event.action !== this._finishGateAction) return
        if (event.action === this._queuedHomeGateAction || !this._queuedHomeGateAction) {
            this._clamped = true
        }
    }

    get default(): string | undefined {
        if (this._default === null) {
            this._default = this._character.animations.find(x => x === 'HomeWait01_L')
                ?? this._character.animations.find(x => x.startsWith('CommonWait') || x.startsWith('DungeonWait'))
                ?? this._character.animations.find(x => x === 'Wait')
            if (!this._default) {
                console.warn(`Default animation not found in "${this._character.object.name}"`)
            }
        }
        return this._default
    }

    get nativeHomeTransitionState() { return this._nativeHomeTransition?.snapshot }

    /** Explicit whole-sequence seek, including the partial Start and blend. */
    seekNativeHomeTransitionElapsed(seconds: number): void {
        if (!this._nativeHomeTransition) throw new Error('Native Home transition is not active')
        this._nativeHomeTransition.seekElapsed(seconds)
        if (this._nativeHomeTransition.completed) this.paused = true
    }

    get current(): string | undefined {
        if (this._nativeHomeTransition) return this._nativeHomeTransition.current
        return this._current
    }

    get clamped(): boolean {
        if (this._nativeHomeTransition) return this._nativeHomeTransition.completed
        return this._clamped
    }

    get duration(): number {
        if (this._nativeHomeTransition) return this._nativeHomeTransition.duration
        if (this.current) {
            const clips = this.getPreparedAnimationClipsByName(this.current)
            return clips.length > 0 ? Math.max(...clips.map(x => x.duration)) : 0
        } else {
            return 0
        }
    }

    get time(): number {
        if (this._nativeHomeTransition) return this._nativeHomeTransition.time
        if (this.current) {
            if (this.clamped) {
                return this.duration
            } else {
                const duration = this.duration
                const localTime = this._repetitions !== undefined ? this._repeatLocalTime : this._activeActions[0]?.time ?? 0
                return duration > 0 ? localTime % duration : 0
            }
        } else {
            return 0
        }
    }
    set time(value) {
        if (this._nativeHomeTransition) {
            this._nativeHomeTransition.seekLocal(value)
            return
        }
        if (this._repetitions === undefined) {
            this.mixer.setTime(value)
            this.flushPendingHomeLoop()
            return
        }
        if (!Number.isFinite(value)) return
        if (this._clamped && this._repetitions > 0) this._repeatCompleted = Math.min(this._repeatCompleted, this._repetitions - 1)
        this._repeatLocalTime = THREE.MathUtils.clamp(value, 0, this.duration)
        for (const action of this._activeActions) {
            if (this._clamped) action.reset().setLoop(THREE.LoopOnce, 1).play()
            action.time = THREE.MathUtils.clamp(value, 0, action.getClip().duration)
            action.clampWhenFinished = this._repetitions !== 0
        }
        this._clamped = false
        this.updateMixer(0)
    }
}

export class CharacterMeshController {
    mesh: THREE.Mesh
    static OutlineAlwaysVisible = false
    private _outlineAlwaysVisible = CharacterMeshController.OutlineAlwaysVisible

    constructor(mesh: THREE.Mesh) {
        this.mesh = mesh
    }

    get name() {
        return this.mesh.name
    }

    get material(): THREE.Material | undefined {
        if (Array.isArray(this.mesh.material)) {
            if (this.mesh.material.length > 0) {
                return this.mesh.material[0]
            } else {
                return undefined
            }
        } else {
            return this.mesh.material
        }
    }

    get materials(): THREE.Material[] {
        return Array.isArray(this.mesh.material) ? this.mesh.material : [this.mesh.material]
    }

    get defaultVisibility(): boolean {
        const name = this.mesh.name.toLowerCase()

        // hide `eye_nohighlight` by default
        if (name.includes('eye_nohighlight')) {
            return false
        }

        // hide `face_a` for momoe nagisa
        if (name.includes('face') && name.includes('_a')) {
            return false
        }

        return true
    }

    get visible(): boolean {
        return this.mesh.visible && this.materials.every(x => x.visible)
    }

    set visible(value) {
        this.mesh.visible = value

        if (this.outlineAlwaysVisible && this.defaultVisibility == true) {
            this.mesh.visible = true
        }

        this.materials.forEach(x => x.visible = value)
    }

    get outlineAlwaysVisible() {
        return this._outlineAlwaysVisible
    }

    set outlineAlwaysVisible(value) {
        this._outlineAlwaysVisible = value

        this.visible = this.visible
    }

    restoreDefaultVisibility() {
        this.visible = this.defaultVisibility
    }
}
