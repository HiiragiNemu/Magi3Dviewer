import * as THREE from 'three'

/** Exact serialized edges; native identifiers and disabled fields stay intact. */
export interface HomeNativeEdge {
    m_DestinationState: number
    m_TransitionDuration: number
    m_TransitionOffset: number
    m_ExitTime: number
    m_HasExitTime: boolean
    m_HasFixedDuration: boolean
    m_InterruptionSource: number
    m_OrderedInterruption: boolean
    m_CanTransitionToSelf: boolean
    m_ConditionConstantArray: unknown[]
    [field: string]: unknown
}

export interface HomeNativeState {
    index: number
    family: string
    primaryClipName: string
    sourceClipPathId: string
    speed: number
    loop: boolean
}

export interface HomeNativeTransitionDescriptor {
    schema: 'magius.home-native-transition.v1'
    transition: HomeNativeState
    start: HomeNativeState
    loop: HomeNativeState
    entry: HomeNativeEdge
    transitionToStart: HomeNativeEdge
    startToLoop: HomeNativeEdge
    /** The serialized graph does not establish Unity's frame-level entry arbitration. */
    activation: 'explicit-settled-state-only'
    provenance: Record<string, unknown>
}

/** Explicit transport checkpoint, NOT a guessed AnyState entry-blend policy.
 * The caller supplies the settled state clock and selected authored exit crossing.
 * Default play(Start) never silently enables this candidate scheduler.
 */
export interface SettledHomeTransitionCheckpoint {
    transitionElapsedSeconds: number
    exitCrossingNormalizedTime: number
}

type Stage = 'transition' | 'start' | 'loop'
type Family = { state: HomeNativeState; duration: number; actions: THREE.AnimationAction[] }

export class HomeNativeTransitionPlayback {
    readonly families: Record<Stage, Family>
    readonly startAt: number
    readonly startBlendEnd: number
    readonly loopAt: number
    elapsed = 0
    private disposed = false
    private mixer: THREE.AnimationMixer
    readonly descriptor: HomeNativeTransitionDescriptor
    readonly checkpoint: SettledHomeTransitionCheckpoint
    readonly repetitions?: number

    constructor(
        mixer: THREE.AnimationMixer,
        descriptor: HomeNativeTransitionDescriptor,
        checkpoint: SettledHomeTransitionCheckpoint,
        getClips: (family: string) => THREE.AnimationClip[],
        repetitions?: number,
    ) {
        this.mixer = mixer
        this.descriptor = descriptor
        this.checkpoint = checkpoint
        this.repetitions = repetitions
        const edge = descriptor.transitionToStart, loopEdge = descriptor.startToLoop
        if (descriptor.activation !== 'explicit-settled-state-only'
            || !edge.m_HasFixedDuration || !edge.m_HasExitTime
            || !loopEdge.m_HasFixedDuration || !loopEdge.m_HasExitTime
            || edge.m_InterruptionSource !== 0 || loopEdge.m_InterruptionSource !== 0
            || edge.m_ConditionConstantArray.length || loopEdge.m_ConditionConstantArray.length
            || loopEdge.m_TransitionDuration !== 0 || loopEdge.m_TransitionOffset !== 0) {
            throw new Error('Unsupported native Home transition edge contract')
        }
        const stages: Stage[] = ['transition', 'start', 'loop']
        const prepared = stages.map(stage => {
            const state = descriptor[stage], clips = getClips(state.family)
            const primary = clips.find(clip => clip.name === state.primaryClipName)
            if (!primary || !(primary.duration > 0) || !(state.speed > 0)) {
                throw new Error(`Native Home state primary clip is absent: ${state.primaryClipName}`)
            }
            return { stage, state, clips, duration: primary.duration }
        })
        const t = prepared[0], s = prepared[1]
        const crossing = checkpoint.exitCrossingNormalizedTime
        const cycles = crossing - edge.m_ExitTime
        if (!Number.isFinite(checkpoint.transitionElapsedSeconds) || checkpoint.transitionElapsedSeconds < 0
            || !Number.isFinite(crossing) || crossing < edge.m_ExitTime
            || (edge.m_ExitTime < 1 && descriptor.transition.loop
                ? Math.abs(cycles - Math.round(cycles)) > 1e-9 : cycles !== 0)) {
            throw new Error('Checkpoint must select an authored native exit crossing')
        }
        this.startAt = crossing * t.duration / t.state.speed - checkpoint.transitionElapsedSeconds
        this.startBlendEnd = this.startAt + edge.m_TransitionDuration
        this.loopAt = this.startAt + (loopEdge.m_ExitTime - edge.m_TransitionOffset) * s.duration / s.state.speed
        if (this.startAt < 0 || !Number.isFinite(this.loopAt) || this.loopAt < this.startBlendEnd
            || edge.m_TransitionDuration < 0 || edge.m_TransitionOffset < 0) {
            throw new Error('Checkpoint or overlapping native edges require unresolved arbitration')
        }
        // Independent actions per state keep a shared helper's weight additive,
        // without one state's time/weight overwriting another state's action.
        this.families = Object.fromEntries(prepared.map(({stage, state, clips, duration}) => [stage, {
            state, duration, actions: clips.map(clip => {
                const action = mixer.clipAction(clip.clone())
                action.setLoop(THREE.LoopOnce, 1)
                action.clampWhenFinished = true
                action.paused = true
                return action
            }),
        }])) as Record<Stage, Family>
    }

    get stage(): Stage { return this.elapsed < this.startAt ? 'transition' : this.elapsed < this.loopAt ? 'start' : 'loop' }
    get current(): string { return this.families[this.stage].state.family }
    get duration(): number { return this.families[this.stage].duration }
    get completed(): boolean {
        return this.repetitions !== undefined && this.repetitions > 0
            && this.elapsed >= this.loopAt + this.repetitions * this.families.loop.duration / this.descriptor.loop.speed
    }
    private normalized(stage: Stage): number {
        const family = this.families[stage]
        if (stage === 'transition') return (this.checkpoint.transitionElapsedSeconds + this.elapsed) * family.state.speed / family.duration
        if (stage === 'start') return this.descriptor.transitionToStart.m_TransitionOffset + (this.elapsed - this.startAt) * family.state.speed / family.duration
        return (this.elapsed - this.loopAt) * family.state.speed / family.duration
    }
    get time(): number {
        if (this.completed) return this.duration
        const n = this.normalized(this.stage)
        return (this.stage === 'start' ? Math.min(n, 1) : n - Math.floor(n)) * this.duration
    }
    get snapshot() {
        const blend = this.descriptor.transitionToStart.m_TransitionDuration
        return { stage: this.stage, elapsed: this.elapsed, current: this.current,
            normalizedTime: this.normalized(this.stage), startAt: this.startAt,
            startBlendEnd: this.startBlendEnd, loopAt: this.loopAt,
            startWeight: this.elapsed < this.startAt ? 0 : blend > 0 ? Math.min(1, (this.elapsed - this.startAt) / blend) : 1,
            completed: this.completed, entryArbitration: 'caller-supplied-settled-checkpoint' as const }
    }

    advance(seconds: number): void {
        if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Native Home delta must be finite and non-negative')
        this.seekElapsed(this.elapsed + seconds)
    }

    /** Absolute elapsed sequence time: deterministic across dt subdivision and seeks. */
    seekElapsed(seconds: number): void {
        if (this.disposed) throw new Error('Native Home playback is disposed')
        if (!Number.isFinite(seconds)) throw new RangeError('Native Home time must be finite')
        const end = this.repetitions !== undefined && this.repetitions > 0
            ? this.loopAt + this.repetitions * this.families.loop.duration / this.descriptor.loop.speed : Infinity
        this.elapsed = Math.min(end, Math.max(0, seconds))
        const stage = this.stage, startWeight = this.snapshot.startWeight
        const weights = { transition: stage === 'transition' ? 1 : stage === 'start' ? 1 - startWeight : 0,
            start: stage === 'start' ? startWeight : 0, loop: stage === 'loop' ? 1 : 0 }
        for (const key of ['transition', 'start', 'loop'] as Stage[]) {
            const family = this.families[key]
            const normalized = Math.max(0, this.normalized(key))
            const phase = key === 'start' ? Math.min(normalized, 1)
                : key === 'loop' && this.completed ? 1 : normalized - Math.floor(normalized)
            for (const action of family.actions) {
                action.enabled = true
                action.paused = true
                action.setEffectiveWeight(weights[key])
                action.time = phase * action.getClip().duration
                action.play()
            }
        }
        // One evaluation on the body's existing mixer, outside finished callbacks.
        this.mixer.update(0)
    }

    seekLocal(seconds: number): void {
        if (!Number.isFinite(seconds)) return
        const family = this.families[this.stage]
        const local = THREE.MathUtils.clamp(seconds, 0, family.duration)
        if (this.stage === 'transition') {
            const cycle = Math.floor(this.normalized('transition'))
            this.seekElapsed((cycle * family.duration + local) / family.state.speed - this.checkpoint.transitionElapsedSeconds)
        } else if (this.stage === 'start') {
            this.seekElapsed(Math.max(this.startAt, this.startAt +
                (local - this.descriptor.transitionToStart.m_TransitionOffset * family.duration) / family.state.speed))
        } else {
            const cycle = this.completed ? Math.max(0, (this.repetitions ?? 1) - 1) : Math.floor(this.normalized('loop'))
            this.seekElapsed(this.loopAt + (cycle * family.duration + local) / family.state.speed)
        }
    }

    dispose(): void {
        if (this.disposed) return
        for (const family of Object.values(this.families)) for (const action of family.actions) {
            action.stop()
            this.mixer.uncacheAction(action.getClip())
        }
        this.disposed = true
    }
}
