import * as THREE from 'three'

export interface StageTransformScalarKey {
    time: number
    value: number
    storage: 'streamed' | 'streamed-initial' | 'dense' | 'constant'
    coefficients?: number[]
    initial?: boolean
}
export interface StageTransformRotationBinding {
    relativePath: string
    transformPathHash: number
    attribute: 2 | 4
    /** Attribute 4 is supported only when all other Euler channels are zero. */
    eulerAxis?: 0 | 1 | 2
    curves: StageTransformScalarKey[][]
}
export interface StageTransformClip {
    id: string
    name: string
    sourceClipPathID: string
    duration: number
    startTime: number
    loop: boolean
    speed: number
    cycleOffset: number
    bindings: StageTransformRotationBinding[]
}
export interface StageTransformCarrierGroup {
    hierarchyPath: string
    clipId: string
    expectedCarrierCount: number
    sources: Array<{
        animatorPathID: string
        gameObjectPathID: string
        controllerPathID: string
        clipId: string
        enabled: true
        activeInHierarchy: boolean
    }>
    authority: 'same-absolute-rotation-fields'
}
export interface StageTransformAnimationProfile {
    schemaVersion: 1
    sourceBundleSHA256: string
    coordinateConvention: 'unity-reflect-x'
    carrierPolicy: 'preserve-rendered-carriers-including-native-inactive'
    clips: StageTransformClip[]
    groups: StageTransformCarrierGroup[]
}
const liveRoots = new WeakSet<THREE.Object3D>()
interface TransformBatchUpdater {
    profile: StageTransformAnimationProfile
    sources: ReadonlySet<THREE.Object3D>
    update: (force?: boolean) => void
}
const batchUpdaters = new WeakMap<THREE.Object3D, TransformBatchUpdater>()
export function hasStageTransformBatchUpdater(root: THREE.Object3D): boolean {
    return batchUpdaters.has(root)
}
/** The existing batcher retains its topology and lends only its matrix updater. */
export function registerStageTransformBatchUpdater(
    root: THREE.Object3D, profile: StageTransformAnimationProfile,
    sources: ReadonlySet<THREE.Object3D>, update: (force?: boolean) => void,
) {
    requireValue(!batchUpdaters.has(root), 'duplicate instance-matrix owner')
    const record = { profile, sources, update }
    batchUpdaters.set(root, record)
    return () => { if (batchUpdaters.get(root) === record) batchUpdaters.delete(root) }
}

const originalName = (object: THREE.Object3D) => object.userData.originalName || object.name
const finite = (value: number) => typeof value === 'number' && Number.isFinite(value)
function requireValue(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(`Stage transform animation: ${message}`)
}
function descendants(root: THREE.Object3D) {
    const result: THREE.Object3D[] = []
    root.traverse(node => result.push(node))
    return result
}
function descend(starts: THREE.Object3D[], segments: string[]) {
    for (const segment of segments) {
        starts = starts.flatMap(parent => parent.children.filter(child =>
            originalName(child) === segment
            || !child.userData.originalName
                && child.name === THREE.PropertyBinding.sanitizeNodeName(segment)))
    }
    return [...new Set(starts)]
}
/** Full direct-child chains only; ambiguity is retained for certified groups. */
export function resolveStageTransformCarriers(root: THREE.Object3D, path: string) {
    const segments = path.split('/').filter(Boolean)
    requireValue(segments.length > 0, 'empty carrier path')
    const all = descendants(root)
    const starts = all.filter(node => originalName(node) === segments[0])
    if (starts.length) return descend(starts, segments.slice(1))
    if (segments.length === 1) return [root]
    return descend(all, segments.slice(1))
}
function normalizedCurve(input: StageTransformScalarKey[]) {
    requireValue(input.length > 0, 'empty scalar curve')
    const byTime = new Map<number, StageTransformScalarKey>()
    for (const key of input) {
        requireValue(finite(key.time) && key.time >= 0 && finite(key.value), 'invalid scalar key')
        requireValue(['streamed', 'streamed-initial', 'dense', 'constant'].includes(key.storage), 'unknown scalar storage')
        if (key.storage.startsWith('streamed')) {
            requireValue(key.coefficients?.length === 4 && key.coefficients.every(finite), 'invalid streamed polynomial')
            requireValue(key.coefficients[3] === key.value, 'streamed polynomial/value mismatch')
        }
        if (!key.initial || !byTime.has(key.time)) byTime.set(key.time, key)
    }
    return [...byTime.values()].sort((a, b) => a.time - b.time)
}
/** Unity StreamedClip stores cubic coefficients relative to each key time. */
export function evaluateStageTransformScalar(curve: readonly StageTransformScalarKey[], time: number) {
    let low = 0, high = curve.length
    while (low < high) {
        const middle = (low + high) >>> 1
        if (curve[middle].time <= time) low = middle + 1
        else high = middle
    }
    const index = Math.max(0, low - 1), key = curve[index], next = curve[index + 1]
    if (time <= key.time || !next || key.storage === 'constant') return key.value
    const elapsed = time - key.time
    if (key.storage.startsWith('streamed')) {
        const [a, b, c, d] = key.coefficients!
        return ((a * elapsed + b) * elapsed + c) * elapsed + d
    }
    return key.value + (next.value - key.value) * elapsed / (next.time - key.time)
}
function rotationAt(binding: StageTransformRotationBinding, time: number, result: THREE.Quaternion) {
    const values = binding.curves.map(curve => evaluateStageTransformScalar(curve, time))
    if (binding.attribute === 2) result.set(values[0], values[1], values[2], values[3])
    else {
        const axis = new THREE.Vector3().setComponent(binding.eulerAxis!, 1)
        result.setFromAxisAngle(axis, THREE.MathUtils.degToRad(values[binding.eulerAxis!]))
    }
    requireValue(result.toArray().every(finite) && result.lengthSq() > 1e-16, 'invalid evaluated quaternion')
    // S * R * S, S=diag(-1,1,1); position/scale are never rewritten.
    result.set(result.x, -result.y, -result.z, result.w).normalize()
    return result
}
class NativeRotationInterpolant extends THREE.Interpolant {
    private readonly clip: StageTransformClip
    private readonly binding: StageTransformRotationBinding
    private readonly quaternion = new THREE.Quaternion()
    constructor(clip: StageTransformClip, binding: StageTransformRotationBinding, result?: Float32Array | null) {
        super(new Float64Array([0, clip.duration / clip.speed]), new Float64Array(8), 4, result ?? undefined)
        this.clip = clip
        this.binding = binding
    }
    evaluate(time: number) {
        const clip = this.clip
        let localTime = time * clip.speed + clip.cycleOffset * clip.duration
        localTime = clip.loop
            ? ((localTime % clip.duration) + clip.duration) % clip.duration
            : THREE.MathUtils.clamp(localTime, 0, clip.duration)
        rotationAt(this.binding, clip.startTime + localTime, this.quaternion).toArray(this.resultBuffer)
        return this.resultBuffer
    }
}

/** Build a mutation-free plan. The caller owns its one existing Mixer/clock. */
export function prepareStageTransformAnimations(
    root: THREE.Object3D,
    profile: StageTransformAnimationProfile | undefined,
    otherRotationWriter = false,
) {
    if (!profile) return undefined
    requireValue(!liveRoots.has(root), 'duplicate runtime owner')
    requireValue(!otherRotationWriter, 'rotator writer conflicts with absolute rotation')
    requireValue(!descendants(root).some(node => node.animations.length > 0), 'loaded animation writer needs explicit ownership partition')
    requireValue(profile.schemaVersion === 1 && profile.coordinateConvention === 'unity-reflect-x', 'unsupported schema/coordinates')
    requireValue(/^[0-9a-f]{64}$/i.test(profile.sourceBundleSHA256), 'missing source bundle digest')
    requireValue(profile.carrierPolicy === 'preserve-rendered-carriers-including-native-inactive', 'undeclared inactive carrier policy')
    const batchUpdater = batchUpdaters.get(root)
    requireValue(!batchUpdater || batchUpdater.profile === profile, 'instance-matrix owner has a different animation certificate')
    const descriptors = new Map<string, StageTransformClip>()
    for (const raw of profile.clips) {
        requireValue(!descriptors.has(raw.id), 'duplicate clip ID')
        requireValue(finite(raw.duration) && raw.duration > 0 && finite(raw.startTime) && raw.startTime >= 0
            && finite(raw.speed) && raw.speed > 0 && finite(raw.cycleOffset), 'invalid native clip timing')
        const paths = new Set<string>()
        const bindings = raw.bindings.map(binding => {
            requireValue(!paths.has(binding.relativePath), 'multiple rotation bindings for one source target')
            paths.add(binding.relativePath)
            requireValue(binding.attribute === 2 || binding.attribute === 4, 'unsupported Transform attribute')
            requireValue(binding.curves.length === (binding.attribute === 2 ? 4 : 3), 'rotation component count')
            const curves = binding.curves.map(normalizedCurve)
            if (binding.attribute === 4) {
                requireValue([0, 1, 2].includes(binding.eulerAxis!), 'multi-axis Euler needs a separate source-order contract')
                requireValue(curves.every((curve, axis) => axis === binding.eulerAxis || curve.every(key =>
                    key.value === 0 && (!key.coefficients || key.coefficients.every(value => value === 0)))), 'nonzero undeclared Euler axis')
            }
            return { ...binding, curves }
        })
        requireValue(bindings.length > 0, 'clip without rotation targets')
        descriptors.set(raw.id, { ...raw, bindings })
    }
    const targets = new Map<THREE.Object3D, THREE.Quaternion>()
    const tracksByClip = new Map<string, THREE.QuaternionKeyframeTrack[]>()
    const sourceIDs = new Set<string>(), carrierRoots = new Set<THREE.Object3D>()
    let inactiveSources = 0
    for (const group of profile.groups) {
        requireValue(group.authority === 'same-absolute-rotation-fields', 'missing animation-field certificate')
        requireValue(Number.isInteger(group.expectedCarrierCount) && group.expectedCarrierCount > 0
            && group.sources.length === group.expectedCarrierCount, 'carrier/source denominator mismatch')
        const clip = descriptors.get(group.clipId)
        requireValue(clip, 'missing certified clip')
        for (const source of group.sources) {
            requireValue(source.enabled === true && source.clipId === group.clipId && !sourceIDs.has(source.animatorPathID), 'non-equivalent or duplicate source animator')
            sourceIDs.add(source.animatorPathID)
            if (!source.activeInHierarchy) inactiveSources++
        }
        const roots = resolveStageTransformCarriers(root, group.hierarchyPath)
        requireValue(roots.length === group.expectedCarrierCount, `carrier coverage ${roots.length}/${group.expectedCarrierCount}: ${group.hierarchyPath}`)
        const tracks = tracksByClip.get(clip.id) ?? []
        for (const carrier of roots) {
            requireValue(!carrierRoots.has(carrier), 'carrier claimed by two source groups')
            carrierRoots.add(carrier)
            for (const binding of clip.bindings) {
                const matches = binding.relativePath ? descend([carrier], binding.relativePath.split('/')) : [carrier]
                requireValue(matches.length === 1, `relative target coverage: ${binding.relativePath}`)
                const object = matches[0]
                requireValue(!targets.has(object), 'duplicate quaternion writer')
                requireValue(!descendants(object).some(node =>
                    (node.userData.stageStaticBatchSource || node.userData.stageStaticBatchOwned)
                    && !batchUpdater?.sources.has(node)), 'animated target has an unmanaged static batch')
                targets.set(object, object.quaternion.clone())
                const first = rotationAt(binding, clip.startTime, new THREE.Quaternion()).toArray()
                const last = rotationAt(binding, clip.startTime + clip.duration, new THREE.Quaternion()).toArray()
                const track = new THREE.QuaternionKeyframeTrack(`${object.uuid}.quaternion`, [0, clip.duration / clip.speed], [...first, ...last])
                // Three's mixer supplies the result buffer. No second playback loop.
                ;(track as THREE.QuaternionKeyframeTrack & {
                    createInterpolant: (result?: Float32Array | null) => THREE.Interpolant
                }).createInterpolant = result => new NativeRotationInterpolant(clip, binding, result)
                tracks.push(track)
            }
        }
        tracksByClip.set(clip.id, tracks)
    }
    requireValue(targets.size > 0 && tracksByClip.size === descriptors.size, 'unbound transform clip')
    const clips = [...tracksByClip].map(([id, tracks]) => {
        const source = descriptors.get(id)!
        return { clip: new THREE.AnimationClip(`native-transform:${id}`, source.duration / source.speed, tracks), loop: source.loop }
    })
    const debug = { sourceBundleSHA256: profile.sourceBundleSHA256, carrierPolicy: profile.carrierPolicy,
        clips: clips.length, sourceAnimators: sourceIDs.size, carrierRoots: carrierRoots.size,
        rotationTargets: targets.size, nativeInactiveSourcesAnimated: inactiveSources }
    let claimed = false, disposed = false
    return {
        clips, debug, targetObjects: [...targets.keys()],
        updateBatches() { if (claimed && !disposed) batchUpdater?.update() },
        claim() {
            requireValue(!disposed && !liveRoots.has(root), 'duplicate runtime owner')
            liveRoots.add(root)
            claimed = true
        },
        dispose() {
            if (disposed) return
            if (claimed) {
                for (const [object, quaternion] of targets) object.quaternion.copy(quaternion)
                batchUpdater?.update(true)
                liveRoots.delete(root)
            }
            disposed = true
        },
    }
}
