import type * as THREE from 'three'

export type AnimationPoseResult<T> = { status: 'ready'; value: T } | { status: 'unavailable'; reason: string }
export interface AnimationPoseChannelRequest {
    root: THREE.Object3D
    generation: number
    bones: readonly THREE.Object3D[]
    morphs: readonly { mesh: THREE.Mesh; index: number }[]
    isCurrent(): boolean
}
export interface AnimationPoseChannelLease {
    release(): void
    prepareMorphReturn(): AnimationPoseResult<{
        commit(): AnimationPoseResult<void>
        rollback(): void
    }>
}
interface Binding {
    targetObject?: THREE.Object3D
    resolvedProperty?: unknown
    parsedPath: { propertyName: string }
    propertyIndex?: string | number
    bind(): void
    setValue(buffer: ArrayLike<number>, offset: number): void
}
interface MixerBinding { binding: Binding; buffer: ArrayLike<number>; valueSize: number }
interface MixerInternals {
    _bindings: MixerBinding[]
    _nActiveBindings: number
    _accuIndex: number
    _bindAction(action: unknown, prototype?: unknown): void
}
interface Held {
    request: AnimationPoseChannelRequest
    boneRefs: readonly (readonly unknown[])[]
    morphRefs: readonly (number[] | undefined)[]
    released: boolean
    stale: boolean
    morphReturning: boolean
}

/** Actor-local output masks. Mixer accumulation stays intact for the native evaluator. */
export function createAnimationPoseChannels(root: THREE.Object3D, mixer: THREE.AnimationMixer, actorCurrent: () => boolean) {
    const internals = mixer as unknown as MixerInternals
    const held = new Set<Held>(), wrapped = new Map<MixerBinding, Binding>(), pending = new Set<MixerBinding>()
    let installed = false
    const unavailable = (reason: string): AnimationPoseResult<never> => ({ status: 'unavailable', reason })
    const belongs = (object: THREE.Object3D) => {
        for (let node: THREE.Object3D | null = object; node; node = node.parent) if (node === root) return true
        return false
    }
    const current = (record: Held) => {
        let valid = false
        try { valid = actorCurrent() && record.request.isCurrent() && record.request.root === root
            && record.request.bones.every((bone, i) => belongs(bone) && [bone.position, bone.quaternion, bone.scale].every((v, j) => v === record.boneRefs[i][j]))
            && record.request.morphs.every((row, i) => belongs(row.mesh) && row.mesh.morphTargetInfluences === record.morphRefs[i]) } catch { /* Stale callback is a retained mask, never restoration authority. */ }
        if (!valid) record.stale = true
        return valid && !record.stale
    }
    const boneMatch = (record: Held, binding: Binding) => ['position', 'quaternion', 'rotation', 'scale'].includes(binding.parsedPath.propertyName)
        && record.request.bones.some(bone => bone === binding.targetObject)
    const morphIndices = (record: Held, binding: Binding) => binding.parsedPath.propertyName === 'morphTargetInfluences'
        ? record.request.morphs.filter(row => row.mesh === binding.targetObject).map(row => row.index) : []
    const masks = (binding: Binding) => {
        let bone = false
        const morphs = new Set<number>()
        for (const record of held) {
            current(record)
            if (record.released && !record.stale) continue
            bone ||= boneMatch(record, binding)
            if (!record.morphReturning || record.stale) for (const index of morphIndices(record, binding)) morphs.add(index)
        }
        return { bone, morphs }
    }
    const queueReturn = (record: Held, morphOnly = false) => {
        for (const entry of internals._bindings.slice(0, internals._nActiveBindings)) if ((!morphOnly && boneMatch(record, entry.binding)) || morphIndices(record, entry.binding).length) pending.add(entry)
    }
    const install = () => {
        for (const entry of internals._bindings) {
            if (wrapped.has(entry)) continue
            const binding = entry.binding
            wrapped.set(entry, binding)
            // A proxy survives PropertyBinding.bind/unbind changing its own setter.
            // All resolution fields remain the real binding fields used by evaluateInput.
            entry.binding = new Proxy(binding, { get(target, property, receiver) {
                if (property !== 'setValue') return Reflect.get(target, property, receiver)
                return (buffer: ArrayLike<number>, offset: number) => {
                    if (!target.targetObject) target.bind()
                    const mask = masks(target)
                    if (mask.bone) return
                    if (mask.morphs.size) {
                        if (target.propertyIndex !== undefined) {
                            if (mask.morphs.has(Number(target.propertyIndex))) return
                        } else {
                            const values = target.resolvedProperty
                            if (!Array.isArray(values)) return
                            for (let i = 0; i < values.length; ++i) if (!mask.morphs.has(i)) values[i] = buffer[offset + i]
                            return
                        }
                    }
                    target.setValue(buffer, offset)
                }
            } })
        }
    }
    const bindAction = internals._bindAction
    const update = mixer.update
    const deactivate = () => {
        if (!installed || held.size || pending.size) return
        for (const [entry, binding] of wrapped) entry.binding = binding
        wrapped.clear(); internals._bindAction = bindAction; mixer.update = update; installed = false
    }
    const leasedUpdate = (delta: number) => {
        const result = update.call(mixer, delta)
        // A constant clip may not call setValue after a mask is removed. Flush its
        // fresh accumulator only on the next evaluation, never on lease release.
        for (const entry of [...pending]) {
            if (!internals._bindings.slice(0, internals._nActiveBindings).includes(entry)) { pending.delete(entry); continue }
            entry.binding.setValue(entry.buffer, (internals._accuIndex + 1) * entry.valueSize)
            pending.delete(entry)
        }
        deactivate()
        return result
    }
    const activate = () => {
        if (installed) return
        installed = true
        internals._bindAction = (action, prototype) => { bindAction.call(mixer, action, prototype); install() }
        mixer.update = leasedUpdate; install()
    }
    return {
        acquire(request: AnimationPoseChannelRequest): AnimationPoseResult<AnimationPoseChannelLease> {
            if (request.root !== root || !Number.isSafeInteger(request.generation) || request.generation < 0) return unavailable('animation-pose-wrong-actor')
            const record: Held = { request, boneRefs: request.bones.map(bone => [bone.position, bone.quaternion, bone.scale]),
                morphRefs: request.morphs.map(row => row.mesh.morphTargetInfluences), released: false, stale: false, morphReturning: false }
            if (!current(record)) return unavailable('animation-pose-stale-actor')
            if (request.morphs.some((row, i) => !Number.isSafeInteger(row.index) || row.index < 0 || !record.morphRefs[i] || row.index >= record.morphRefs[i]!.length)) return unavailable('animation-pose-invalid-morph')
            held.add(record); activate()
            return { status: 'ready', value: {
                release() {
                    if (record.released) return
                    const valid = current(record); record.released = true
                    if (valid) { held.delete(record); queueReturn(record); deactivate() }
                },
                prepareMorphReturn() {
                    if (record.released || !current(record)) return unavailable('animation-pose-stale-lease')
                    let changed = false
                    return { status: 'ready', value: {
                        commit() {
                            if (record.released || !current(record)) return unavailable('animation-pose-stale-lease')
                            if (!record.morphReturning) { record.morphReturning = changed = true; queueReturn(record, true) }
                            return { status: 'ready', value: undefined }
                        },
                        rollback() { if (changed && !record.released) { record.morphReturning = false; changed = false } },
                    } }
                },
            } }
        },
    }
}
