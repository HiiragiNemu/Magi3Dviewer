import { Object3D, Vector3 } from 'three'
import { PerformanceActorAdapter } from './actorAdapter.ts'
import { applyTransform, blendPose, captureTransform, clonePose, resolveJointIKChain, solveTwoLinkIK } from './pose.ts'
import { PerformanceTimeline } from './timeline.ts'
import type { ActorFrameContext, ActorLease, Availability, ChannelSelection, DragMode, EditorOptions, EvaluatorPoseFrame, PerformanceDocument,
    PerformanceTrack, PoseSnapshot, Quat, SampledPerformanceTrack, TimelineClockReason, TimelineClockSnapshot, TrackChannel, Vec3 } from './types.ts'

interface ActiveActor {
    actor: PerformanceActorAdapter
    channels: ChannelSelection
    lease: ActorLease
    from: PoseSnapshot
    elapsed: number
    pending: PoseSnapshot
    manual?: PoseSnapshot
    manualBones?: string[]
    manualRoot?: boolean
    refreshDrag?: () => void
    poseUndo?: PoseSnapshot[]
}
export class PerformanceEditorRuntime {
    readonly timeline = new PerformanceTimeline()
    readonly actors = new Map<string, PerformanceActorAdapter>()
    time = 0
    playing = false
    lastError: string | null = null
    private options: EditorOptions
    private active = new Map<string, ActiveActor>()
    private listeners = new Set<(kind: 'state' | 'actors' | 'document') => void>()
    private clockListeners = new Set<(snapshot: TimelineClockSnapshot) => void>()
    private releases: (() => void)[] = []
    private drag?: { actorKey: string; release: () => void }
    private disposed = false
    private serial = 0
    private frameId = -1
    private committed = new Set<string>()
    private attempted = new Set<string>()
    private frameSamples: SampledPerformanceTrack[] = []
    private frameCrossings: (ReturnType<PerformanceTimeline['actionCrossings']>[number] & { occurrenceId: string })[] = []
    private includeCurrentBeat = false
    private playbackEpoch = 0
    private loopIteration = 0
    private audioFrameStamp: number | undefined
    private get transition() { return this.options.transitionSeconds ?? 0.18 }

    constructor(options: EditorOptions) {
        this.options = options
        if (!Number.isFinite(this.transition) || this.transition < 0) throw new Error('Invalid transition duration')
        this.syncActors()
        this.releases.push(options.actorSource.subscribe(() => this.syncActors()),
            options.framePort.subscribeBeforePhysics((delta, context) => this.tick(delta, context)),
            options.framePort.subscribeFinalPoseBeforeCamera(() => this.applyFaces()))
    }
    subscribe(listener: (kind: 'state' | 'actors' | 'document') => void) {
        this.listeners.add(listener); return () => { this.listeners.delete(listener) }
    }
    /** Read-only shared clock for metadata consumers (for example voice/lip-sync). */
    subscribeClock(listener: (snapshot: TimelineClockSnapshot) => void) {
        this.clockListeners.add(listener)
        return () => { this.clockListeners.delete(listener) }
    }
    private emitClock(reason: TimelineClockReason, deltaSeconds = 0) {
        const snapshot: TimelineClockSnapshot = {
            frameId: this.frameId, time: this.time, duration: this.timeline.value.duration,
            deltaSeconds, playing: this.playing, loopIteration: this.loopIteration, reason,
        }
        for (const listener of this.clockListeners) {
            try { listener(snapshot) } catch { /* Clock observers never affect evaluator ownership. */ }
        }
    }
    private emit(kind: 'state' | 'actors' | 'document' = 'state') { for (const listener of this.listeners) listener(kind) }
    /** Audio-only documents use the global final-frame clock, never a guessed actor lease. */
    advanceAudioOnlyFrame(timestampMilliseconds: number): boolean {
        if (this.disposed || !Number.isFinite(timestampMilliseconds) || timestampMilliseconds < 0
            || (this.audioFrameStamp !== undefined && timestampMilliseconds <= this.audioFrameStamp)) return false
        const previous = this.audioFrameStamp
        this.audioFrameStamp = timestampMilliseconds
        const document = this.timeline.value
        if (previous === undefined || !this.playing || this.active.size || document.tracks.length || !document.audioTracks?.length) return false
        const delta = (timestampMilliseconds - previous) / 1000
        if (document.loop && delta > document.duration * 16) { this.fail(new Error('Timeline frame spans more than 16 loops')); return false }
        const next = this.time + delta
        if (document.loop) { this.loopIteration += Math.floor(next / document.duration); this.time = next % document.duration }
        else { this.time = Math.min(document.duration, next); if (this.time >= document.duration) this.playing = false }
        this.emitClock('frame', delta); this.emit()
        return true
    }
    private syncActors() {
        const descriptors = this.options.actorSource.list().filter(actor => actor.isCurrent())
        for (const [key, actor] of this.actors) {
            const next = descriptors.find(row => row.object === actor.descriptor.object && row.generation === actor.descriptor.generation)
            if (!next) { this.releaseActor(key); actor.dispose(); this.actors.delete(key) }
        }
        for (const descriptor of descriptors) {
            if (!this.actors.has(descriptor.object.uuid)) this.actors.set(descriptor.object.uuid, new PerformanceActorAdapter(descriptor))
        }
        this.emit('actors')
    }
    private releaseActor(key: string) {
        if (this.drag?.actorKey === key) this.endDrag()
        const active = this.active.get(key)
        if (!active) return
        this.active.delete(key)
        const current = active.actor.current && active.lease.active ? active.lease.captureEvaluated() : active.pending
        active.lease.releaseFromEvaluated(clonePose(current), this.transition)
    }
    private channels(actor: PerformanceActorAdapter, tracks: readonly PerformanceTrack[]): ChannelSelection {
        const action = tracks.some(track => track.channel === 'action')
        const exclusiveBones = [...new Set(tracks.filter(track => track.channel.startsWith('bone-')).map(track => track.property!))]
        return { root: tracks.some(track => track.channel.startsWith('root-')),
            bones: action ? [...actor.bones.keys()] : exclusiveBones, exclusiveBones,
            morphs: action ? [...actor.morphs.keys()] : [...new Set(tracks.filter(track => track.channel === 'morph').map(track => track.property!))], action }
    }
    private ensureActor(key: string, channels: ChannelSelection): Availability<ActiveActor> {
        const actor = this.actors.get(key)
        if (!actor?.current) return { status: 'unavailable', reason: 'Actor generation is no longer ready' }
        const current = this.active.get(key)
        if (current && current.lease.active && JSON.stringify(current.channels) === JSON.stringify(channels)) return { status: 'ready', value: current }
        const from = actor.capture(channels)
        this.releaseActor(key)
        const result = this.options.channelHost.acquire(actor.descriptor, channels)
        if (result.status === 'unavailable') return result
        if (channels.exclusiveBones.length && (!result.value.captureEvaluatorFrame || !result.value.commitManualBody)) {
            result.value.releaseFromEvaluated(clonePose(from), this.transition)
            return { status: 'unavailable', reason: 'WAIT_EVALUATED_FRAME: host evaluator/commit protocol absent' }
        }
        const active: ActiveActor = { actor, channels, lease: result.value, from, elapsed: 0, pending: clonePose(from) }
        this.active.set(key, active)
        return { status: 'ready', value: active }
    }
    private prepareTracks() {
        const tracks = this.timeline.value.tracks
        for (const track of tracks) this.requirePoseChannel(track.channel)
        for (const key of new Set(tracks.map(track => track.actorKey))) {
            const actor = this.actors.get(key)
            if (!actor?.current) throw new Error(`Timeline actor absent: ${key}`)
            const owned = tracks.filter(track => track.actorKey === actor.key)
            for (const track of owned.filter(row => row.channel === 'action')) {
                for (const key of track.keys) {
                    const value = key.value as { name: string | null }
                    if (value.name && !actor.descriptor.actions.includes(value.name)) throw new Error(`Action capability absent: ${value.name}`)
                }
            }
            const result = this.ensureActor(actor.key, this.channels(actor, owned))
            if (result.status === 'unavailable') throw new Error(result.reason)
        }
    }
    setDocument(document: PerformanceDocument) {
        this.timeline.replace(document)
        this.playing = false; this.time = Math.min(this.time, document.duration)
        this.endDrag()
        for (const key of [...this.active.keys()]) this.releaseActor(key)
        this.emitClock('document')
        this.emit('document')
    }
    /** Stable browser contract for project persistence; callers decide storage or file transport. */
    exportProject() { return this.timeline.serialize() }
    importProject(serialized: string) {
        if (typeof serialized !== 'string' || !serialized.trim()) throw new Error('Project document is empty')
        const document = JSON.parse(serialized) as PerformanceDocument
        this.setDocument(document)
        return this.timeline.value
    }
    private recapture() {
        for (const active of this.active.values()) {
            if (!active.actor.current || !active.lease.active) continue
            active.from = active.lease.captureEvaluated(); active.elapsed = 0; active.manual = undefined; active.manualBones = []; active.manualRoot = false; active.poseUndo = []
        }
    }
    play() {
        this.endDrag()
        try {
            // A completed non-loop document is a fresh replay request, not a no-op.
            // Emit the explicit reposition before the play clock so media consumers
            // reset their ended elements even when their drift is within tolerance.
            if (!this.timeline.value.loop && this.time >= this.timeline.value.duration) {
                this.time = 0
                this.loopIteration = 0
                this.frameSamples = this.timeline.sample(0)
                this.emitClock('seek')
            }
            this.prepareTracks(); this.recapture(); this.lastError = null
            this.playing = true
            this.includeCurrentBeat = true
            ++this.playbackEpoch
            this.emitClock('play')
        } catch (error) { this.fail(error) }
        this.emit()
    }
    pause() { this.playing = false; this.emitClock('pause'); this.emit() }
    seek(time: number) {
        if (!Number.isFinite(time)) throw new Error('Invalid seek time')
        this.endDrag()
        try { this.prepareTracks(); this.recapture() } catch (error) { this.fail(error); return }
        this.time = Math.max(0, Math.min(this.timeline.value.duration, time))
        this.includeCurrentBeat = false
        this.lastError = null; this.emitClock('seek'); this.emit()
    }
    stop() {
        this.playing = false; this.includeCurrentBeat = false; this.endDrag()
        for (const key of [...this.active.keys()]) this.releaseActor(key)
        // Stop is an explicit transport reset. Release uses the live displayed
        // pose above; only then rewind the editor clock while retaining the frame
        // timestamp so the next play advances from the stopped transport point.
        this.time = 0
        this.loopIteration = 0
        this.frameSamples = this.timeline.sample(0)
        this.emitClock('stop')
        this.emit()
    }
    private fail(error: unknown) {
        this.stop()
        this.lastError = error instanceof Error ? error.message : String(error)
        this.playing = false
        this.emit()
    }
    private dispatchActorCrossings(active: ActiveActor) {
        if (!active.channels.action) return
        for (const { track, key, occurrenceId } of this.frameCrossings) {
            if (track.actorKey !== active.actor.key) continue
            const value = key.value as { name: string | null; loop?: boolean }
            if (!value.name) continue
            if (!active.actor.descriptor.actions.includes(value.name)) throw new Error(`Action capability absent: ${value.name}`)
            active.from = active.lease.captureEvaluated(); active.elapsed = 0
            active.lease.playActionBeat({ keyId: key.id, occurrenceId, name: value.name, loop: value.loop ?? false,
                localTimeSeconds: Math.max(0, this.time - key.time), transitionSeconds: this.transition })
        }
    }
    private applySample(pose: PoseSnapshot, sample: SampledPerformanceTrack) {
        const { channel, property } = sample.track
        this.requirePoseChannel(channel)
        if (channel === 'morph') { if (Object.hasOwn(pose.morphs, property!)) pose.morphs[property!] = sample.value as number; return }
        if (channel === 'action') return
        const target = channel.startsWith('root-') ? pose.root : pose.bones[property!]
        if (!target) return
        if (channel.endsWith('position')) target.position = sample.value as Vec3
        else if (channel.endsWith('rotation')) target.rotation = sample.value as Quat
        else target.scale = sample.value as Vec3
    }
    private advanceFrame(delta: number, frameId: number) {
        this.frameId = frameId; this.committed.clear(); this.attempted.clear(); this.frameCrossings = []
        const queue = (rows: ReturnType<PerformanceTimeline['actionCrossings']>) => {
            this.frameCrossings.push(...rows.map(row => ({ ...row, occurrenceId: `${this.playbackEpoch}:${this.loopIteration}:${row.key.id}` })))
        }
        if (this.playing && this.active.size > 0) {
            const document = this.timeline.value
            if (this.includeCurrentBeat) {
                queue(this.timeline.actionCrossings(-1, this.time).filter(row => row.key.time === this.time))
                this.includeCurrentBeat = false
            }
            let remaining = delta
            if (document.loop && remaining > document.duration * 16) throw new Error('Timeline frame spans more than 16 loops')
            do {
                const next = Math.min(document.duration, this.time + remaining)
                queue(this.timeline.actionCrossings(this.time, next))
                remaining -= next - this.time; this.time = next
                if (this.time < document.duration) break
                if (!document.loop) { this.playing = false; break }
                this.time = 0; ++this.loopIteration; queue(this.timeline.actionCrossings(-1, 0))
            } while (remaining > 0)
        }
        this.frameSamples = this.timeline.sample(this.time)
    }
    private tick(delta: number, context: ActorFrameContext) {
        if (this.disposed) return
        if (!Number.isFinite(delta) || delta < 0) { this.fail(new Error('Invalid frame delta')); return }
        if (!context || !Number.isSafeInteger(context.frameId) || context.frameId < 0 || context.frameId < this.frameId) return
        try {
            const key = context.actorKey
            const active = this.active.get(key)
            // A stale/unknown actor must not advance the global clock or touch another instance.
            if (!active || active.actor.descriptor.generation !== context.generation) return
            if (!active.actor.current || !active.lease.active) { this.releaseActor(key); return }
            if (context.frameId !== this.frameId) {
                this.advanceFrame(delta, context.frameId)
                this.emitClock('frame', delta)
            }
            if (this.attempted.has(key)) return
            this.attempted.add(key)
            this.dispatchActorCrossings(active)
            const actorSamples = this.frameSamples.filter(sample => sample.track.actorKey === key)
            if (active.channels.action) {
                // A held pose samples the frozen official time, not displayed manual output.
                for (const sample of actorSamples.filter(row => row.track.channel === 'action')) {
                    const clip = sample.value as { name: string | null; loop?: boolean }
                    if (clip.name) active.lease.sampleActionAt(clip.name, sample.localTime, clip.loop ?? false)
                }
            }
            let issued: EvaluatorPoseFrame | undefined
            let target: PoseSnapshot
            if (active.channels.exclusiveBones.length) {
                const frame = active.lease.captureEvaluatorFrame?.(context)
                if (!frame || frame.status === 'unavailable') {
                    this.lastError = frame?.reason ?? 'WAIT_EVALUATED_FRAME: host evaluator protocol absent'
                    this.emit(); return
                }
                issued = frame.value
                if (issued.frameId !== context.frameId || issued.actorKey !== key || issued.generation !== context.generation) {
                    this.lastError = 'WAIT_EVALUATED_FRAME: mismatched actor/generation/frame'; this.emit(); return
                }
                target = clonePose(issued.pose)
                const exact = (actual: string[], expected: readonly string[]) => actual.length === expected.length && expected.every(name => actual.includes(name))
                if (!!target.root !== active.channels.root || !exact(Object.keys(target.bones), active.channels.bones)
                    || !exact(Object.keys(target.morphs), active.channels.morphs)) {
                    this.lastError = 'WAIT_EVALUATED_FRAME: incomplete or extra selected channels'; this.emit(); return
                }
            } else {
                // Ordinary action/root behavior retains its real pre-physics live destination.
                target = active.actor.capture(active.channels)
            }
            for (const sample of actorSamples) this.applySample(target, sample)
            // Overlay only explicitly held channels, never the action's entire old snapshot.
            // The producer still owns all other bones, morphs, pivots and scales.
            if (active.manual) {
                const manual = clonePose(active.manual)
                for (const name of active.manualBones ?? []) target.bones[name].rotation = manual.bones[name].rotation
                if (active.manualRoot && manual.root) target.root = manual.root
            }
            const alpha = this.transition === 0 ? 1 : Math.min(1, active.elapsed / this.transition)
            const pending = blendPose(active.from, target, alpha * alpha * (3 - 2 * alpha))
            if (issued) {
                const committed = active.lease.commitManualBody?.(issued, pending)
                if (!committed || committed.status === 'unavailable') {
                    this.lastError = committed?.reason ?? 'WAIT_EVALUATED_FRAME: host commit protocol absent'
                    this.emit(); return
                }
            } else active.actor.apply(pending, 'body')
            active.pending = pending
            this.committed.add(key)
            this.lastError = null
            if (active.pending.root) this.options.channelHost.notifyRootTransformChanged(key)
            active.refreshDrag?.()
            active.elapsed += Math.min(delta, 0.25)
            this.emit()
        } catch (error) { this.fail(error) }
    }
    private applyFaces() {
        if (this.disposed) return
        for (const [key, active] of this.active) if (active.lease.active && this.committed.has(key)) active.actor.apply(active.pending, 'face')
    }
    private requirePoseChannel(channel: TrackChannel) {
        if (channel === 'bone-position' || channel === 'bone-scale') {
            throw new Error('POSE_ROTATION_ONLY: joint translation/scale tracks are unsupported; use root placement or an IK target')
        }
    }
    captureKey(actorKey: string, channel: TrackChannel, property?: string, value?: unknown) {
        this.requirePoseChannel(channel)
        const actor = this.actors.get(actorKey)
        if (!actor?.current) throw new Error('Actor absent')
        const id = `${actorKey}:${channel}:${property || ''}`
        const current = this.timeline.value.tracks.find(row => row.id === id)
        const track: PerformanceTrack = current || { id, actorKey, channel, property, keys: [] }
        if (value === undefined) {
            const pose = actor.capture(this.channels(actor, [track]))
            if (channel === 'morph') value = pose.morphs[property!]
            else if (channel === 'action') throw new Error('Choose an exact action')
            else {
                const transform = channel.startsWith('root-') ? pose.root! : pose.bones[property!]
                value = channel.endsWith('position') ? transform.position : channel.endsWith('rotation') ? transform.rotation : transform.scale
            }
        }
        const existing = track.keys.find(key => key.time === this.time)
        const key = { id: existing?.id || `key-${++this.serial}-${Date.now()}`, time: this.time, value }
        track.keys = track.keys.filter(row => row.time !== this.time); track.keys.push(key)
        this.timeline.upsertTrack(track); this.emit('document')
        return key.id
    }
    deleteKey(trackId: string, keyId: string) { this.timeline.deleteKey(trackId, keyId); this.emit('document') }
    capturePoseKeys(actorKey: string) {
        const actor = this.actors.get(actorKey)
        if (!actor?.current) throw new Error('Actor absent')
        const bones = [...actor.bones.keys()]
        if (!bones.length) return
        // One capture is one document transaction. Per-bone captureKey would
        // compile and synchronously rebuild the whole panel for every joint.
        const pose = actor.capture({ root: false, bones, exclusiveBones: bones, morphs: [], action: false })
        const document = this.timeline.value, tracks = new Map(document.tracks.map(track => [track.id, track]))
        const time = this.time, timestamp = Date.now()
        for (const boneKey of bones) {
            const id = `${actorKey}:bone-rotation:${boneKey}`
            let track = tracks.get(id)
            if (!track) {
                track = { id, actorKey, channel: 'bone-rotation', property: boneKey, keys: [] }
                document.tracks.push(track); tracks.set(id, track)
            }
            const existing = track.keys.find(key => key.time === time)
            const key = { id: existing?.id || `key-${++this.serial}-${timestamp}`, time, value: pose.bones[boneKey].rotation }
            track.keys = track.keys.filter(row => row.time !== time); track.keys.push(key)
        }
        this.timeline.replace(document)
        this.emit('document')
    }
    beginDrag(actorKey: string, mode: DragMode, boneKey?: string): Availability<() => void> {
        if (mode !== 'root' && mode !== 'joint' && mode !== 'ik') return { status: 'unavailable', reason: 'Unknown pose drag mode' }
        this.endDrag(); this.pause()
        const actor = this.actors.get(actorKey)
        if (!actor?.current || !this.options.transformHost) return { status: 'unavailable', reason: 'Transform host or actor absent' }
        const bone = boneKey ? actor.bones.get(boneKey) : undefined
        let object = mode === 'root' ? actor.descriptor.object : bone
        let chain: Object3D[] = []
        if (mode === 'ik' && bone) {
            const result = resolveJointIKChain(bone, new Set(actor.bones.values()))
            if (result.status === 'unavailable') return result
            chain = [...result.value]
            object = new Object3D(); object.position.copy(bone.getWorldPosition(new Vector3()))
        }
        if (!object || (mode === 'ik' && chain.length !== 3)) return { status: 'unavailable', reason: 'Selected bone/IK capability absent' }
        const previous = this.active.get(actorKey)
        // ensureActor may return this same object; snapshot held ownership before replacing it.
        const previousManualBones = [...(previous?.manualBones ?? [])], previousManualRoot = previous?.manualRoot === true
        const documentChannels = this.channels(actor, this.timeline.value.tracks.filter(track => track.actorKey === actorKey))
        const requestedBones = mode === 'root' ? [] : mode === 'joint' ? [boneKey!] : [...actor.bones].filter(([, node]) => chain.includes(node)).map(([key]) => key)
        // Host exclusivity includes document constraints; only dragged joints become held overrides.
        const manualBones = [...new Set([...requestedBones, ...(previous?.manual ? previousManualBones : [])])]
        const exclusiveBones = [...new Set([...documentChannels.exclusiveBones, ...manualBones])]
        const action = documentChannels.action || (previous?.channels.action ?? false)
        const manualRoot = mode === 'root' || previousManualRoot
        const channels: ChannelSelection = { root: manualRoot || documentChannels.root, bones: action ? [...actor.bones.keys()] : exclusiveBones,
            exclusiveBones, morphs: action ? [...actor.morphs.keys()] : documentChannels.morphs, action }
        const displayed = actor.capture(channels), previousManual = previous?.manual && clonePose(previous.manual)
        const acquired = this.ensureActor(actorKey, channels)
        if (acquired.status === 'unavailable') return acquired
        const active = acquired.value
        active.manual = displayed; active.manualBones = manualBones; active.manualRoot = manualRoot; active.elapsed = this.transition
        if (previousManual) {
            for (const key of previousManualBones) active.manual.bones[key].rotation = previousManual.bones[key].rotation
            if (previousManualRoot && previousManual.root) active.manual.root = previousManual.root
        }
        active.poseUndo = previous?.poseUndo ?? []
        const beforeDrag = clonePose(active.manual)
        let changed = false, dragActive = true
        // Joint manipulation is rotation-only.  Preserve the authored local pivot
        // and scale so a generic transform gizmo can never stretch a child chain.
        const jointBaseline = mode === 'joint' && boneKey
            ? clonePose(active.manual!).bones[boneKey]
            : undefined
        // Detached ancestry preserves the exact world basis without giving the gizmo
        // or IK solver any writable live bone. Copy TRS/matrix policy, not a rig clone.
        const scratch = new Map<Object3D, Object3D>()
        const stage = (node: Object3D): Object3D => {
            const present = scratch.get(node)
            if (present) return present
            const copy = new Object3D(); scratch.set(node, copy)
            applyTransform(copy, captureTransform(node)); copy.matrixAutoUpdate = node.matrixAutoUpdate
            copy.matrix.copy(node.matrix)
            if (node.parent) stage(node.parent).add(copy)
            return copy
        }
        for (const key of manualBones) {
            const copy = stage(actor.bones.get(key)!)
            applyTransform(copy, active.manual.bones[key])
        }
        if (mode === 'joint') object = stage(bone!)
        const selected = new Set(manualBones.map(key => actor.bones.get(key)!))
        const refresh = () => {
            for (const [live, copy] of scratch) if (!selected.has(live)) {
                applyTransform(copy, captureTransform(live)); copy.matrix.copy(live.matrix)
            }
            object!.updateWorldMatrix(true, true)
        }
        active.refreshDrag = refresh
        let hostRelease: (() => void) | undefined
        const session = { actorKey, release: () => { dragActive = false; active.refreshDrag = undefined; hostRelease?.() } }
        const finish = () => { if (this.drag === session) this.endDrag() }
        this.drag = session
        const drag = this.options.transformHost.acquire({ actorKey, mode, object, onChange: target => {
            if (!dragActive) return
            if (!actor.current || !active.lease.active || this.active.get(actorKey) !== active) { finish(); return }
            refresh()
            if (mode === 'ik') {
                const stagedChain = chain.map(node => scratch.get(node)!)
                const result = solveTwoLinkIK(stagedChain[0], stagedChain[1], stagedChain[2], target || object!.getWorldPosition(new Vector3()))
                if (result.status === 'unavailable') { this.lastError = result.reason; this.emit(); return }
            }
            if (mode === 'root') {
                active.manual!.root = captureTransform(actor.descriptor.object)
                this.options.channelHost.notifyRootTransformChanged(actorKey)
            } else {
                const staged = clonePose(active.manual!)
                for (const key of manualBones) {
                    const next = captureTransform(scratch.get(actor.bones.get(key)!)!)
                    if (mode === 'joint' && jointBaseline && key === boneKey) {
                        next.position = [...jointBaseline.position] as typeof next.position
                        next.scale = [...jointBaseline.scale] as typeof next.scale
                    }
                    staged.bones[key] = next
                }
                active.manual = staged
            }
            if (!changed && mode !== 'root') {
                active.poseUndo!.push(beforeDrag)
                if (active.poseUndo!.length > 32) active.poseUndo!.shift()
                changed = true
            }
            this.lastError = null
            this.emit()
        }, onEnd: finish })
        if (drag.status === 'unavailable') { finish(); this.releaseActor(actorKey); return drag }
        hostRelease = drag.value
        if (!dragActive) hostRelease()
        return { status: 'ready', value: finish }
    }
    endDrag() { const drag = this.drag; this.drag = undefined; drag?.release() }
    /** Undo is staged and committed through the same issued evaluator frame. */
    undoPose(actorKey: string): Availability<void> {
        this.endDrag()
        const active = this.active.get(actorKey)
        if (!active?.manual || !active.actor.current || !active.lease.active) return { status: 'unavailable', reason: 'Current pose lease absent' }
        const prior = active.poseUndo?.pop()
        if (!prior) return { status: 'unavailable', reason: 'Pose undo history empty' }
        for (const [key, transform] of Object.entries(prior.bones)) if (active.manual.bones[key]) active.manual.bones[key].rotation = transform.rotation
        active.elapsed = this.transition; this.emit()
        return { status: 'ready', value: undefined }
    }
    /** Reset hands back to the current official evaluator, never a cached rest pose. */
    resetPose(actorKey: string): Availability<void> {
        this.endDrag()
        const active = this.active.get(actorKey)
        if (!active || !active.actor.current || !active.lease.active) return { status: 'unavailable', reason: 'Current pose lease absent' }
        this.releaseActor(actorKey); this.emit()
        return { status: 'ready', value: undefined }
    }
    dispose() {
        if (this.disposed) return
        this.stop(); this.disposed = true
        for (const release of this.releases.splice(0)) release()
        for (const actor of this.actors.values()) actor.dispose()
        this.actors.clear(); this.listeners.clear(); this.clockListeners.clear()
    }
}
