import * as THREE from 'three'
import {
    addAnimationLoop,
    getClockDelta,
    removeAnimationLoop,
} from 'magia-exedra-character-three/renderer'

/**
 * Declarative voice metadata for the shared stage clock.
 *
 * This module deliberately does not fetch or decode audio. The fields below
 * are the stable hand-off contract for the later WebAudio/HCA integration, so
 * voice, character action, expression and lip-sync can all seek against the
 * same stage time instead of maintaining independent clocks.
 */
export interface StageVoiceTrackProfile {
    id: string
    characterId?: string
    url?: string
    startTime?: number
    offset?: number
    duration?: number
    volume?: number
    loop?: boolean
    actionName?: string
    expressionName?: string
    lipSyncUrl?: string
}

export interface StageRotatorProfile {
    /** Exact exported object name; ambiguous duplicate names are not guessed. */
    objectName: string
    /** Native LinearRotater.rotation value, measured in degrees per second. */
    degreesPerSecond: [number, number, number]
    space?: 'self'
}

export interface StageRuntimeProfile {
    /** Exact AnimationClip names. Prefix/family matching is intentionally not used. */
    clipNames?: string[]
    autoplay?: boolean
    loop?: boolean
    startTime?: number
    timeScale?: number
    voiceTracks?: StageVoiceTrackProfile[]
    rotators?: StageRotatorProfile[]
}

export type StageVoiceTrackPlaybackState =
    | 'pending'
    | 'playing'
    | 'paused'
    | 'ended'

export interface StageVoiceTrackState {
    id: string
    characterId?: string
    actionName?: string
    expressionName?: string
    playback: StageVoiceTrackPlaybackState
    localTime: number
    startTime: number
    duration?: number
    loop: boolean
}

export interface StageRuntimeDebugState {
    disposed: boolean
    playing: boolean
    paused: boolean
    time: number
    timeScale: number
    loop: boolean
    rootName: string
    requestedClipNames: string[]
    playingClipNames: string[]
    missingClipNames: string[]
    animationDuration: number
    timelineDuration?: number
    animationEnded: boolean
    voiceTracks: StageVoiceTrackState[]
    requestedRotatorNames: string[]
    activeRotatorNames: string[]
    missingRotatorNames: string[]
    ambiguousRotatorNames: string[]
}

interface ActiveStageRotator {
    profile: StageRotatorProfile
    object: THREE.Object3D
}

function finiteNonNegative(value: number | undefined, fallback: number) {
    return Number.isFinite(value) ? Math.max(0, value!) : fallback
}

function unique(values: string[] | undefined) {
    return [...new Set(values ?? [])]
}

/**
 * Owns the animation and future voice timeline for one loaded stage root.
 *
 * A controller is registered with the renderer only when explicitly created
 * from a runtime profile. Static stages therefore retain their existing
 * behaviour and incur no animation-loop work.
 */
export class StageRuntimeController {
    private readonly root: THREE.Object3D
    private readonly profile: StageRuntimeProfile
    private readonly mixer?: THREE.AnimationMixer
    private readonly requestedClipNames: string[]
    private readonly playingClips: THREE.AnimationClip[]
    private readonly missingClipNames: string[]
    private readonly activeRotators: ActiveStageRotator[]
    private readonly missingRotatorNames: string[]
    private readonly ambiguousRotatorNames: string[]
    private readonly animationLoop: () => void
    private readonly afterUpdate?: () => void
    private _time: number
    private _timeScale: number
    private _paused: boolean
    private _disposed = false

    constructor(
        root: THREE.Object3D,
        profile: StageRuntimeProfile,
        afterUpdate?: () => void,
    ) {
        this.root = root
        this.profile = profile
        this.afterUpdate = afterUpdate
        this.requestedClipNames = unique(profile.clipNames)

        const clipsByName = new Map(
            root.animations.map(clip => [clip.name, clip] as const),
        )
        this.playingClips = this.requestedClipNames
            .map(name => clipsByName.get(name))
            .filter((clip): clip is THREE.AnimationClip => clip != undefined)
        this.missingClipNames = this.requestedClipNames
            .filter(name => !clipsByName.has(name))
        const requestedRotators = profile.rotators ?? []
        const objectsByName = new Map<string, THREE.Object3D[]>()
        root.traverse(object => {
            if (!object.name) return
            const objects = objectsByName.get(object.name) ?? []
            objects.push(object)
            objectsByName.set(object.name, objects)
        })
        this.activeRotators = []
        this.missingRotatorNames = []
        this.ambiguousRotatorNames = []
        for (const rotator of requestedRotators) {
            const candidates = objectsByName.get(rotator.objectName) ?? []
            if (candidates.length === 0) {
                this.missingRotatorNames.push(rotator.objectName)
            } else if (candidates.length > 1) {
                this.ambiguousRotatorNames.push(rotator.objectName)
            } else {
                this.activeRotators.push({
                    profile: rotator,
                    object: candidates[0],
                })
            }
        }

        if (this.playingClips.length > 0) {
            this.mixer = new THREE.AnimationMixer(root)
            for (const clip of this.playingClips) {
                const action = this.mixer.clipAction(clip)
                if (profile.loop ?? true) {
                    action.setLoop(THREE.LoopRepeat, Infinity)
                    action.clampWhenFinished = false
                } else {
                    action.setLoop(THREE.LoopOnce, 1)
                    action.clampWhenFinished = true
                }
                action.reset().play()
            }
        }

        this._time = finiteNonNegative(profile.startTime, 0)
        this._timeScale = finiteNonNegative(profile.timeScale, 1)
        this._paused = profile.autoplay === false
        this.mixer?.setTime(this._time)
        this.applyRotatorDelta(this._time)
        this.runAfterUpdate()
        this.publishTime()

        this.animationLoop = () => this.update(getClockDelta())
        addAnimationLoop(this.animationLoop)
    }

    get time() {
        return this._time
    }

    get timeScale() {
        return this._timeScale
    }

    get paused() {
        return this._paused
    }

    get disposed() {
        return this._disposed
    }

    play() {
        if (this._disposed) return
        this._paused = false
    }

    pause() {
        if (this._disposed) return
        this._paused = true
    }

    setTimeScale(value: number) {
        if (this._disposed) return
        this._timeScale = finiteNonNegative(value, this._timeScale)
    }

    seek(time: number) {
        if (this._disposed) return
        const previousTime = this._time
        this._time = finiteNonNegative(time, this._time)
        this.mixer?.setTime(this._time)
        this.applyRotatorDelta(this._time - previousTime)
        this.runAfterUpdate()
        this.publishTime()
    }

    update(deltaSeconds: number) {
        if (
            this._disposed
            || this._paused
            || !Number.isFinite(deltaSeconds)
            || deltaSeconds <= 0
        ) {
            return
        }

        const scaledDelta = deltaSeconds * this._timeScale
        const previousTime = this._time
        const timelineDuration = this.getTimelineDuration()
        if (
            !(this.profile.loop ?? true)
            && timelineDuration != undefined
            && this._time + scaledDelta >= timelineDuration
        ) {
            this._time = timelineDuration
            this.mixer?.setTime(this._time)
            this._paused = true
        } else {
            this._time += scaledDelta
            this.mixer?.update(scaledDelta)
        }
        this.applyRotatorDelta(this._time - previousTime)
        this.runAfterUpdate()
        this.publishTime()
    }

    getVoiceTrackStates(): StageVoiceTrackState[] {
        return (this.profile.voiceTracks ?? []).map(track => {
            const startTime = finiteNonNegative(track.startTime, 0)
            const duration = track.duration == undefined
                ? undefined
                : finiteNonNegative(track.duration, 0)
            const offset = finiteNonNegative(track.offset, 0)
            const elapsed = this._time - startTime
            const loop = track.loop ?? false

            let localTime = Math.max(0, elapsed) + offset
            let playback: StageVoiceTrackPlaybackState

            if (elapsed < 0) {
                playback = 'pending'
                localTime = offset
            } else if (duration != undefined && duration <= 0) {
                playback = 'ended'
                localTime = offset
            } else if (duration != undefined && loop) {
                playback = this._paused ? 'paused' : 'playing'
                localTime %= duration
            } else if (duration != undefined && localTime >= duration) {
                playback = 'ended'
                localTime = duration
            } else {
                playback = this._paused ? 'paused' : 'playing'
            }

            return {
                id: track.id,
                characterId: track.characterId,
                actionName: track.actionName,
                expressionName: track.expressionName,
                playback,
                localTime,
                startTime,
                duration,
                loop,
            }
        })
    }

    getDebugState(): StageRuntimeDebugState {
        const animationDuration = this.playingClips.reduce(
            (duration, clip) => Math.max(duration, clip.duration),
            0,
        )
        const timelineDuration = this.getTimelineDuration()
        return {
            disposed: this._disposed,
            playing: !this._disposed && !this._paused,
            paused: this._paused,
            time: this._time,
            timeScale: this._timeScale,
            loop: this.profile.loop ?? true,
            rootName: this.root.name,
            requestedClipNames: [...this.requestedClipNames],
            playingClipNames: this.playingClips.map(clip => clip.name),
            missingClipNames: [...this.missingClipNames],
            animationDuration,
            timelineDuration,
            animationEnded:
                !(this.profile.loop ?? true)
                && animationDuration > 0
                && this._time >= animationDuration,
            voiceTracks: this.getVoiceTrackStates(),
            requestedRotatorNames:
                (this.profile.rotators ?? []).map(rotator => rotator.objectName),
            activeRotatorNames:
                this.activeRotators.map(rotator => rotator.profile.objectName),
            missingRotatorNames: [...this.missingRotatorNames],
            ambiguousRotatorNames: [...this.ambiguousRotatorNames],
        }
    }

    dispose() {
        if (this._disposed) return

        removeAnimationLoop(this.animationLoop)
        this.mixer?.stopAllAction()
        this.mixer?.uncacheRoot(this.root)
        delete this.root.userData.stageRuntimeTime
        delete this.root.userData.stageRuntime
        this._disposed = true
    }

    private publishTime() {
        this.root.userData.stageRuntimeTime = this._time
        this.root.userData.stageRuntime = this.getDebugState()
    }

    private getTimelineDuration() {
        const animationDuration = this.playingClips.reduce(
            (duration, clip) => Math.max(duration, clip.duration),
            0,
        )
        const voiceDurations = (this.profile.voiceTracks ?? [])
            .map(track => {
                if (track.duration == undefined) return undefined
                const duration = finiteNonNegative(track.duration, 0)
                const offset = finiteNonNegative(track.offset, 0)
                return finiteNonNegative(track.startTime, 0)
                    + Math.max(0, duration - offset)
            })
            .filter((value): value is number => value != undefined)
        const duration = Math.max(animationDuration, ...voiceDurations, 0)
        return duration > 0 ? duration : undefined
    }

    private runAfterUpdate() {
        try {
            this.afterUpdate?.()
        } catch (error) {
            console.warn('Stage runtime post-update hook failed:', error)
        }
    }

    private applyRotatorDelta(deltaSeconds: number) {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds === 0) return
        for (const { profile, object } of this.activeRotators) {
            const [x, y, z] = profile.degreesPerSecond
            if (![x, y, z].every(Number.isFinite)) continue
            const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(
                THREE.MathUtils.degToRad(x * deltaSeconds),
                THREE.MathUtils.degToRad(y * deltaSeconds),
                THREE.MathUtils.degToRad(z * deltaSeconds),
                'XYZ',
            ))
            // Native LinearRotater.Update performs localRotation *= delta.
            object.quaternion.multiply(delta).normalize()
        }
    }
}

/**
 * Keeps the absence of a runtime profile a true no-op for existing static
 * stages while giving the stage loader a concise integration point.
 */
export function createStageRuntimeController(
    root: THREE.Object3D,
    profile?: StageRuntimeProfile,
    afterUpdate?: () => void,
) {
    return profile == undefined
        ? undefined
        : new StageRuntimeController(root, profile, afterUpdate)
}
