import type { Object3D, Vector3 } from 'three'

export type Vec3 = readonly [number, number, number]
export type Quat = readonly [number, number, number, number]
export interface LocalTransform { position: Vec3; rotation: Quat; scale: Vec3 }
export interface PoseSnapshot {
    root?: LocalTransform
    bones: Record<string, LocalTransform>
    morphs: Record<string, number>
}
export type Availability<T> = { status: 'ready'; value: T }
    | { status: 'unavailable'; reason: string }
export interface ActorDescriptor {
    object: Object3D
    generation: number
    label: string
    actions: readonly string[]
    isCurrent(): boolean
}
export interface ActorSource {
    list(): readonly ActorDescriptor[]
    subscribe(listener: () => void): () => void
}
export interface ChannelSelection {
    root: boolean
    /** Evaluated pre-physics snapshot/commit set; action may include the rig. */
    bones: readonly string[]
    /** Exact manual FK/IK/bone-track subset that requires exclusive ownership. */
    exclusiveBones: readonly string[]
    morphs: readonly string[]
    action: boolean
}
export interface ActionBeat {
    keyId: string
    /** Distinct playback/loop occurrence of one persistent authored key. */
    occurrenceId: string
    name: string
    loop: boolean
    localTimeSeconds: number
    transitionSeconds: number
}
/** Host-issued identity, retained by the host; a caller-created copy is not a frame.
 * pose contains every selected channel from the actual evaluator BEFORE manual
 * output. Unkeyed channels need an independent authored/evaluator source too.
 */
export interface EvaluatorPoseFrame extends ActorFrameContext {
    readonly pose: PoseSnapshot
}
export interface ActorLease {
    readonly active: boolean
    /** Prior displayed interruption source only; never evaluator provenance. */
    captureEvaluated(): PoseSnapshot
    /** Optional during host migration; manual bones fail closed without BOTH methods. */
    captureEvaluatorFrame?(context: ActorFrameContext): Availability<EvaluatorPoseFrame>
    /** Validates issued identity/current actor/frame and consumes it exactly once.
     * Queues native evaluator input before the single manual body commit. During
     * native return the host submits a NEW evaluator frame, leaves native p/q at
     * that input and excludes them from its own return compositor.
     */
    commitManualBody?(frame: EvaluatorPoseFrame, output: PoseSnapshot): Availability<void>
    playActionBeat(beat: ActionBeat): void
    /** Preview/sample only: never dispatch combat/voice cues on a scrub. */
    sampleActionAt(name: string, timeSeconds: number, loop: boolean): void
    /** Host resumes its current live destination, not an old rest-pose snapshot. */
    releaseFromEvaluated(pose: PoseSnapshot, transitionSeconds: number): void
}
export interface ChannelHost {
    acquire(actor: ActorDescriptor, channels: ChannelSelection): Availability<ActorLease>
    notifyRootTransformChanged(actorKey: string): void
}
export interface FramePort {
    subscribeBeforePhysics(callback: (deltaSeconds: number, context: ActorFrameContext) => void): () => void
    subscribeFinalPoseBeforeCamera(callback: () => void): () => void
}
export interface ActorFrameContext {
    /** Monotonic renderer token, shared by all actor callbacks in one frame. */
    frameId: number
    actorKey: string
    generation: number
}
export type TrackChannel = 'root-position' | 'root-rotation' | 'root-scale'
    /** Legacy bone-position/scale are parsed for diagnostics but rejected by the pose consumer. */
    | 'bone-position' | 'bone-rotation' | 'bone-scale' | 'morph' | 'action'
export interface PerformanceKey { id: string; time: number; value: unknown }
export interface PerformanceTrack {
    id: string
    actorKey: string
    channel: TrackChannel
    property?: string
    interpolation?: 'linear' | 'step'
    keys: PerformanceKey[]
}
/** Exact per-instance audio binding. Legacy unbound tracks remain background audio. */
export interface PerformanceAudioTrack {
    id: string
    sourceStableKey: string
    /** These fields are paired; neither means background, never the selected actor. */
    actorKey?: string
    generation?: number
    startTime: number
    offsetSeconds?: number
    durationSeconds?: number
    volume?: number
    lipSync?: boolean
}
export interface PerformanceDocument {
    schema: 'performance-editor-v1'
    duration: number
    loop: boolean
    tracks: PerformanceTrack[]
    /** Optional explicit audio metadata kept separate from pose/action tracks. */
    audioTracks?: PerformanceAudioTrack[]
    /** Baked final-pose lanes share this document's clock and actor instances. */
    recordedLanes?: import('./recordings.ts').RecordedLane[]
    sceneId?: string
}
export interface SampledPerformanceTrack {
    track: PerformanceTrack
    value: unknown
    keyId: string
    localTime: number
}
export type DragMode = 'root' | 'joint' | 'ik'
export interface DragRequest {
    actorKey: string
    mode: DragMode
    object: Object3D
    /** IK handle is world-space; joint handle is detached, rotation-only.
     * Only root placement permits translation. No mesh is a joint handle.
     */
    onChange(worldTarget?: Vector3): void
    onEnd(): void
}
export interface TransformHost {
    acquire(request: DragRequest): Availability<() => void>
}
export interface EditorOptions {
    actorSource: ActorSource
    channelHost: ChannelHost
    framePort: FramePort
    transformHost?: TransformHost
    transitionSeconds?: number
    /** Optional official voice catalog used by the multi-track timeline bridge. */
    voiceCatalog?: import('../voice/catalog.ts').VoiceCatalog
    /** Media ports for the real per-track consumer; defaults are browser audio/WebAudio. */
    audioEnvironment?: Omit<import('./audioTimelineBridge.ts').AudioTimelineBridgeOptions, 'catalog'>
}

export type TimelineClockReason = 'frame' | 'play' | 'pause' | 'seek' | 'stop' | 'document'
export interface TimelineClockSnapshot {
    frameId: number
    time: number
    duration: number
    deltaSeconds: number
    playing: boolean
    loopIteration: number
    reason: TimelineClockReason
}
