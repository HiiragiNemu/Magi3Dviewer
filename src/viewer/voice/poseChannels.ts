import type * as THREE from 'three'

export interface VoicePoseActor {
    object: THREE.Object3D
    uuid: string
    generation: number
    isCurrent(): boolean
}

export interface VoicePoseChannelRequest {
    actor: VoicePoseActor
    bones: readonly THREE.Object3D[]
    morphs: readonly { mesh: THREE.Mesh; index: number }[]
    action: boolean
    /** Caller/editor transition; no inferred blink timing or hidden default. */
    releaseTransitionSeconds?: number
}

export type VoicePoseAvailability<T> = { status: 'ready'; value: T }
    | { status: 'unavailable'; reason: string }

export interface VoicePoseChannelLease {
    readonly active: boolean
    /** Keep ownership; allow fresh morph evaluation for the caller's sole blend. */
    beginMorphReturn(): VoicePoseAvailability<void>
    release(): void
}

export interface VoicePoseMorphReturnPreparation {
    commit(): VoicePoseAvailability<void>
    rollback(): void
}

export interface VoicePoseLowerLease {
    release(): void
    prepareMorphReturn?(): VoicePoseAvailability<VoicePoseMorphReturnPreparation>
}

export interface VoicePoseParticipant {
    check(request: VoicePoseChannelRequest): string | null
    acquire?(request: VoicePoseChannelRequest): VoicePoseAvailability<VoicePoseLowerLease>
    acquired(request: VoicePoseChannelRequest): void
    released(request: VoicePoseChannelRequest): void
}

interface ActorState {
    epoch: number
    authority?: VoicePoseActor
    leases: Set<LeaseRecord>
    participants: Set<VoicePoseParticipant>
    pending: number
    acquiring: boolean
    revisions: WeakMap<THREE.Object3D, Map<number | undefined, number>>
}

interface LeaseRecord {
    request: VoicePoseChannelRequest
    current(): boolean
    released: boolean
    lowerLeases: VoicePoseLowerLease[]
    morphReturning: boolean
    blocked: boolean
}

const actors = new WeakMap<THREE.Object3D, ActorState>()
const retainedAuthorities = new WeakMap<VoicePoseChannelRequest, () => boolean>()

/** Lower evaluators keep the exact retained authority even after player detach. */
export function voicePoseRequestCurrent(request: VoicePoseChannelRequest): boolean {
    return retainedAuthorities.get(request)?.() ?? currentActor(request.actor)
}

function stateFor(root: THREE.Object3D): ActorState {
    let state = actors.get(root)
    if (!state) {
        state = { epoch: 0, leases: new Set(), participants: new Set(), pending: 0, acquiring: false, revisions: new WeakMap() }
        actors.set(root, state)
    }
    return state
}

export function voicePoseObject(value: unknown): THREE.Object3D | null {
    return value && typeof value === 'object' && (value as THREE.Object3D).isObject3D === true
        ? value as THREE.Object3D : null
}

function belongsTo(root: THREE.Object3D, object: THREE.Object3D): boolean {
    const visited = new Set<THREE.Object3D>()
    for (let cursor: THREE.Object3D | null = object; cursor; cursor = cursor.parent) {
        if (cursor === root) return true
        if (visited.has(cursor)) return false
        visited.add(cursor)
    }
    return false
}

function currentActor(actor: VoicePoseActor): boolean {
    try { return actor.object.uuid === actor.uuid && actor.isCurrent() === true }
    catch { return false }
}

function overlap(a: VoicePoseChannelRequest, b: VoicePoseChannelRequest): boolean {
    return (a.action && b.action)
        || a.bones.some(bone => b.bones.includes(bone))
        || a.morphs.some(left => b.morphs.some(right => left.mesh === right.mesh && left.index === right.index))
}

const unavailable = (reason: string): VoicePoseAvailability<never> => ({ status: 'unavailable', reason })

function revise(state: ActorState, request: VoicePoseChannelRequest): void {
    for (const [object, index] of [
        ...request.bones.map(bone => [bone, undefined] as const),
        ...request.morphs.map(row => [row.mesh, row.index] as const),
    ]) {
        let versions = state.revisions.get(object)
        if (!versions) { versions = new Map(); state.revisions.set(object, versions) }
        versions.set(index, (versions.get(index) ?? 0) + 1)
    }
}

function prepareMorphReturns(handles: readonly VoicePoseLowerLease[]): VoicePoseAvailability<VoicePoseMorphReturnPreparation[]> {
    const prepared: VoicePoseMorphReturnPreparation[] = []
    for (const handle of handles) {
        if (!handle.prepareMorphReturn) return unavailable('voice-pose-morph-return-unavailable')
        let result: VoicePoseAvailability<VoicePoseMorphReturnPreparation>
        try { result = handle.prepareMorphReturn() }
        catch { return unavailable('voice-pose-morph-return-provider-failed') }
        if (result.status !== 'ready') return result
        if (typeof result.value?.commit !== 'function' || typeof result.value?.rollback !== 'function') {
            return unavailable('voice-pose-morph-return-unavailable')
        }
        prepared.push(result.value)
    }
    return { status: 'ready', value: prepared }
}

function commitMorphReturns(prepared: readonly VoicePoseMorphReturnPreparation[]): VoicePoseAvailability<void> {
    const attempted: VoicePoseMorphReturnPreparation[] = []
    for (const item of prepared) {
        attempted.push(item)
        let result: VoicePoseAvailability<void>
        try { result = item.commit() }
        catch { result = unavailable('voice-pose-morph-return-provider-failed') }
        if (result.status !== 'ready') {
            // Restore masks only. Never substitute ordinary release/native blend.
            for (const prior of attempted.reverse()) prior.rollback()
            return result
        }
    }
    return { status: 'ready', value: undefined }
}

function beginMorphReturn(state: ActorState, record: LeaseRecord): VoicePoseAvailability<void> {
    if (state.acquiring) return unavailable('voice-pose-reentrant')
    state.acquiring = true
    try {
        if (!record.current()) return unavailable('voice-pose-stale-retained-reference')
        if (record.morphReturning) return { status: 'ready', value: undefined }
        const handles = [...record.lowerLeases]
        const prepared = prepareMorphReturns(handles)
        if (prepared.status !== 'ready') return prepared
        if (!record.current() || handles.length !== record.lowerLeases.length) return unavailable('voice-pose-stale-retained-reference')
        const committed = commitMorphReturns(prepared.value)
        if (committed.status !== 'ready') return committed
        if (!record.current() || handles.length !== record.lowerLeases.length) {
            for (const item of prepared.value.reverse()) item.rollback()
            return unavailable('voice-pose-stale-retained-reference')
        }
        record.morphReturning = true
        // Drop old voice restore baselines for morphs only; bone/action stay held.
        revise(state, { ...record.request, bones: [] })
        return committed
    } finally { state.acquiring = false }
}

function acquire(request: VoicePoseChannelRequest): VoicePoseAvailability<VoicePoseChannelLease> {
    if (!voicePoseObject(request?.actor?.object)) return unavailable('voice-pose-stale-actor')
    const state = stateFor(request.actor.object)
    if (state.acquiring) return unavailable('voice-pose-reentrant')
    state.acquiring = true
    try { return acquireChecked(request) }
    finally { state.acquiring = false }
}

function acquireChecked(request: VoicePoseChannelRequest): VoicePoseAvailability<VoicePoseChannelLease> {
    const actor = request?.actor
    if (!actor || !voicePoseObject(actor.object) || actor.uuid !== actor.object.uuid
        || !Number.isSafeInteger(actor.generation) || actor.generation < 0 || !currentActor(actor)) {
        return unavailable('voice-pose-stale-actor')
    }
    if (!Array.isArray(request.bones) || !Array.isArray(request.morphs) || typeof request.action !== 'boolean') {
        return unavailable('voice-pose-invalid-request')
    }
    const root = actor.object
    const bones = [...request.bones]
    const morphs = request.morphs.map(row => ({ ...row }))
    if (new Set(bones).size !== bones.length || bones.some(bone => !voicePoseObject(bone) || !belongsTo(root, bone))) {
        return unavailable('voice-pose-invalid-bone-reference')
    }
    const morphRefs = morphs.map(row => row.mesh?.morphTargetInfluences)
    if (morphs.some((row, index) => !voicePoseObject(row.mesh) || !belongsTo(root, row.mesh)
        || !Number.isSafeInteger(row.index) || row.index < 0 || !Array.isArray(morphRefs[index])
        || row.index >= morphRefs[index]!.length || !Number.isFinite(morphRefs[index]![row.index])
        || !Object.values(row.mesh.morphTargetDictionary ?? {}).includes(row.index)
        || morphs.slice(0, index).some(prior => prior.mesh === row.mesh && prior.index === row.index))) {
        return unavailable('voice-pose-invalid-morph-reference')
    }
    const state = stateFor(root)
    if (state.pending && (request.action || bones.length || morphs.length)) {
        return unavailable('voice-pose-pending-opaque-side-effect')
    }
    const retained: VoicePoseChannelRequest = {
        actor: { ...actor }, bones, morphs, action: request.action,
        releaseTransitionSeconds: request.releaseTransitionSeconds,
    }
    if (state.authority && state.authority.generation !== actor.generation && state.leases.size) {
        return unavailable('voice-pose-generation-still-leased')
    }
    for (const lease of state.leases) {
        if (!lease.current()) return unavailable('voice-pose-stale-retained-reference')
        if (overlap(lease.request, retained)) return unavailable('voice-pose-channel-already-leased')
    }
    for (const participant of state.participants) {
        let reason: string | null
        try { reason = participant.check(retained) }
        catch { reason = 'voice-pose-participant-authority-unavailable' }
        if (reason) return unavailable(reason)
    }
    const epoch = state.epoch + (state.authority && state.authority.generation !== actor.generation ? 1 : 0)
    const vectors = bones.map(bone => [bone.position, bone.quaternion, bone.rotation, bone.scale])
    const referencesCurrent = () => !record.blocked && state.epoch === epoch && currentActor(retained.actor)
            && bones.every((bone, index) => belongsTo(root, bone)
                && vectors[index].every((value, field) => value === [bone.position, bone.quaternion, bone.rotation, bone.scale][field]))
            && morphs.every((row, index) => belongsTo(root, row.mesh)
                && row.mesh.morphTargetInfluences === morphRefs[index]
                && row.index < morphRefs[index]!.length)
            && !record.blocked && state.epoch === epoch && retained.actor.object.uuid === retained.actor.uuid
    const record: LeaseRecord = {
        request: retained, released: false, lowerLeases: [], morphReturning: false, blocked: false,
        current: () => !record.released && referencesCurrent(),
    }
    for (const participant of state.participants) {
        let acquired: VoicePoseAvailability<VoicePoseLowerLease> | undefined
        try { acquired = participant.acquire?.(retained) }
        catch { acquired = unavailable('voice-pose-lower-provider-failed') }
        if (acquired?.status === 'unavailable') {
            for (const lower of [...record.lowerLeases].reverse()) lower.release()
            return acquired
        }
        if (acquired?.status === 'ready') record.lowerLeases.push(acquired.value)
    }
    state.epoch = epoch
    state.authority = retained.actor
    state.leases.add(record)
    retainedAuthorities.set(retained, referencesCurrent)
    revise(state, retained)
    // These callbacks discard only voice bookkeeping; they never restore a pose.
    const notified: VoicePoseParticipant[] = []
    try {
        for (const participant of state.participants) {
            notified.push(participant)
            participant.acquired(retained)
        }
    } catch {
        state.leases.delete(record)
        record.released = true
        for (const lower of [...record.lowerLeases].reverse()) lower.release()
        for (const participant of notified) {
            try { participant.released(retained) } catch { /* Keep cleanup bounded. */ }
        }
        return unavailable('voice-pose-participant-acquire-failed')
    }
    return { status: 'ready', value: {
        get active() { return record.current() },
        beginMorphReturn() { return beginMorphReturn(state, record) },
        release() {
            if (record.released) return
            record.released = true
            state.leases.delete(record)
            revise(state, retained)
            // Native return starts from the displayed value; no synchronous pose restore.
            for (const lower of [...record.lowerLeases].reverse()) lower.release()
            for (const participant of state.participants) {
                try { participant.released(retained) } catch { /* No cleanup writes. */ }
            }
        },
    } }
}

/** A panel owns only leases it issued; disposing it cannot release another panel. */
export function createVoicePoseChannelProvider() {
    const owned = new Set<VoicePoseChannelLease>()
    let disposed = false
    return {
        acquirePoseChannels(request: VoicePoseChannelRequest): VoicePoseAvailability<VoicePoseChannelLease> {
            if (disposed) return unavailable('voice-pose-provider-disposed')
            const result = acquire(request)
            if (result.status !== 'ready') return result
            const lease = result.value
            const exposed = {
                get active() { return lease.active },
                beginMorphReturn() { return lease.beginMorphReturn() },
                release() { owned.delete(exposed); lease.release() },
            }
            owned.add(exposed)
            return { status: 'ready', value: exposed }
        },
        dispose() {
            if (disposed) return
            disposed = true
            for (const lease of [...owned]) lease.release()
        },
    }
}

/** Retain the actual actor/binding, not a name which could resolve to a replacement. */
export function createVoicePoseWriteGuard(root: THREE.Object3D, object: THREE.Object3D, index?: number) {
    const state = stateFor(root)
    const epoch = state.epoch
    const uuid = root.uuid
    const influences = index === undefined ? undefined : (object as THREE.Mesh).morphTargetInfluences
    const allowed = () => {
        if (root.uuid !== uuid || state.epoch !== epoch || !belongsTo(root, object)
            || (state.authority && !currentActor(state.authority))) return false
        if (index !== undefined && (object as THREE.Mesh).morphTargetInfluences !== influences) return false
        for (const lease of state.leases) {
            const { request } = lease
            const overlaps = index === undefined ? request.bones.includes(object)
                : request.morphs.some(row => row.mesh === object && row.index === index)
            if (overlaps && (index === undefined || !lease.morphReturning || !lease.current())) return false
        }
        return true
    }
    return { allowed, revision: () => state.revisions.get(object)?.get(index) ?? 0 }
}

export function createVoicePoseActorGuard(root: THREE.Object3D): () => boolean {
    const state = stateFor(root)
    const epoch = state.epoch
    const uuid = root.uuid
    return () => state.epoch === epoch && root.uuid === uuid
        && (!state.authority || currentActor(state.authority))
}

export function registerVoicePoseParticipant(root: THREE.Object3D, participant: VoicePoseParticipant) {
    const state = stateFor(root)
    state.participants.add(participant)
    if (state.acquiring) {
        for (const lease of state.leases) lease.blocked = true
    } else {
        state.acquiring = true
        try {
            for (const lease of state.leases) {
                if (!lease.current()) { lease.blocked = true; continue }
                const reason = participant.check(lease.request)
                const acquired = reason ? unavailable(reason) : participant.acquire?.(lease.request)
                if (acquired?.status === 'unavailable') lease.blocked = true
                else if (acquired?.status === 'ready') {
                    lease.lowerLeases.push(acquired.value)
                    if (lease.morphReturning) {
                        const prepared = prepareMorphReturns([acquired.value])
                        if (prepared.status !== 'ready' || !lease.current()
                            || commitMorphReturns(prepared.value).status !== 'ready') lease.blocked = true
                        else if (!lease.current()) {
                            for (const item of prepared.value.reverse()) item.rollback()
                            lease.blocked = true
                        }
                    }
                }
                participant.acquired(lease.request)
            }
        } finally { state.acquiring = false }
    }
    return () => { state.participants.delete(participant) }
}

export function voicePoseOperationBlock(root: THREE.Object3D, check: (request: VoicePoseChannelRequest) => string | null): string | null {
    const state = actors.get(root)
    if (!state) return null
    if (state.authority && !currentActor(state.authority)) return 'voice-pose-stale-actor'
    for (const lease of state.leases) {
        if (!lease.current()) return 'voice-pose-stale-retained-reference'
        const reason = check(lease.request)
        if (reason) return reason
    }
    return null
}

/** An opaque producer already in flight cannot be cancelled by removing its owner. */
export function retainVoicePosePending(root: THREE.Object3D | null, result: unknown, settled: (failed: boolean) => void): void {
    if (!result || (typeof result !== 'object' && typeof result !== 'function')
        || typeof (result as PromiseLike<unknown>).then !== 'function') return
    const state = root ? stateFor(root) : undefined
    if (state) state.pending++
    const finish = (failed: boolean) => {
        if (state) state.pending--
        settled(failed)
    }
    void Promise.resolve(result).then(() => finish(false), () => finish(true))
}
