import * as THREE from 'three'
import {
    evaluateMagicaCurve,
    clamp,
} from './math'
import {
    resolveCharacterPhysicsBindings,
    type ExactPhysicsBindingRegistry,
    type ResolvedCharacterPhysicsBindings,
} from './binding'
import {
    createNativeCharacterColliderRuntime,
    type NativeCharacterColliderRuntime,
} from './nativeColliders'
import {
    createMagicaWindRuntime,
    type MagicaWindRuntime,
} from './magicaWind'
import type {
    CharacterPhysicsClothProduct,
    CharacterPhysicsColliderProduct,
    CharacterPhysicsDiagnostics,
    CharacterPhysicsProfile,
    PhysicsVector3,
} from './types'

export interface CharacterPhysicsUpdateContext {
    /** Delta that is not multiplied by the application's time scale. */
    unscaledDeltaSeconds?: number
    /** Delta advanced by the current Animator/AnimationMixer. */
    animatorDeltaSeconds?: number
}

export interface NativeCharacterPhysicsOptions {
    bindingRegistry?: ExactPhysicsBindingRegistry
    active?: boolean
    blendWeight?: number
    fixedStepSeconds?: number
    maximumCatchUpSteps?: number
}

export interface NativeManualLocalPose {
    position: readonly [number, number, number]
    quaternion: readonly [number, number, number, number]
}
export type NativeManualLeaseResult<T> = { status: 'ready'; value: T } | { status: 'unavailable'; reason: string }
export interface NativeManualOutputLease {
    readonly state: 'held' | 'returning' | 'released' | 'invalid'
    readonly reason: string | undefined
    owns(object: THREE.Object3D): boolean
    /** Queue a fresh pre-manual evaluator snapshot for exactly the next native update. */
    submitEvaluatedFrame(frame: {
        frameId: number
        source: 'post-animation-pre-manual'
        localPoseByObject: ReadonlyMap<THREE.Object3D, NativeManualLocalPose>
    }): NativeManualLeaseResult<void>
    /** Capture the actual currently displayed local pose without writing a transform. */
    beginReturn(options: { transitionSeconds: number }): NativeManualLeaseResult<void>
    cancel(): void
}
interface ManualOutputLeaseRecord {
    readonly root: THREE.Object3D
    readonly generation: number
    readonly epoch: number
    readonly isCurrent: () => boolean
    readonly objects: Set<THREE.Object3D>
    state: NativeManualOutputLease['state']
    reason?: string
    queued?: { updateId: number; poses: Map<THREE.Object3D, NativeManualLocalPose> }
    lastFrameId: number
    readonly from: Map<THREE.Object3D, NativeManualLocalPose>
    readonly displayed: Map<THREE.Object3D, NativeManualLocalPose>
    duration: number
    elapsed: number
    first: boolean
    fresh: boolean
}

export type NativePhysicsWritableChannelSnapshot = {
    status: 'ready'
    runtimeStatus: 'ready' | 'disabled'
    active: boolean
    root: THREE.Object3D
    /** Potential output owners, not all bound particles or this frame's changed bones. */
    outputObjects: ReadonlySet<THREE.Object3D>
    outputs: readonly {
        object: THREE.Object3D
        ownerStableKey: string
        channels: readonly ['position', 'quaternion']
    }[]
} | {
    status: 'unavailable'
    reason: 'disposed' | 'fail-closed' | 'binding-refresh-pending'
    root: THREE.Object3D
}

export interface NativeCharacterPhysicsRuntime {
    readonly diagnostics: CharacterPhysicsDiagnostics
    readonly nativeColliders: NativeCharacterColliderRuntime
    readonly windZones: MagicaWindRuntime
    getWritableChannelSnapshot(): NativePhysicsWritableChannelSnapshot
    acquireManualOutputLease(request: {
        root: THREE.Object3D
        actorGeneration: number
        isCurrent: () => boolean
        outputs: readonly THREE.Object3D[]
    }): NativeManualLeaseResult<NativeManualOutputLease>
    updateAfterAnimation(
        deltaSeconds: number,
        context?: CharacterPhysicsUpdateContext,
    ): void
    setActive(active: boolean): void
    setBlendWeight(weight: number): void
    refreshBindings(): void
    reset(): void
    dispose(): void
}

interface ParticleRuntime {
    readonly stableKey: string
    readonly bone: THREE.Object3D
    readonly parentIndex: number
    readonly childIndices: number[]
    readonly rootIndex: number
    readonly depth: number
    normalizedDepth: number
    radius: number
    readonly position: THREE.Vector3
    readonly previousPosition: THREE.Vector3
    /** Position at the beginning of the latest fixed step (Magica oldPosArray). */
    readonly stepStartPosition: THREE.Vector3
    /** Completed fixed-step velocity used by Magica's future display prediction. */
    readonly realVelocity: THREE.Vector3
    /** Previous completed fixed-step position used only for render interpolation. */
    readonly displayPreviousPosition: THREE.Vector3
    /** Latest completed fixed-step position used only for render interpolation. */
    readonly displayCurrentPosition: THREE.Vector3
    /** Interpolated render position; never fed back into the Verlet solver. */
    readonly displayPosition: THREE.Vector3
    /** Animation position captured at the beginning of the current render frame. */
    readonly framePreviousAnimationPosition: THREE.Vector3
    /** Animation position captured at the end of the current render frame. */
    readonly frameCurrentAnimationPosition: THREE.Vector3
    readonly animationPosition: THREE.Vector3
    readonly previousAnimationPosition: THREE.Vector3
    /** Initial cloth pose expressed in the moving team's anchor space. */
    readonly initialAnchorLocalPosition: THREE.Vector3
    /** Animation-pose-ratio reference used by restoration/limit constraints. */
    readonly referencePosition: THREE.Vector3
    readonly framePreviousReferencePosition: THREE.Vector3
    readonly frameCurrentReferencePosition: THREE.Vector3
    readonly animationWorldQuaternion: THREE.Quaternion
    readonly framePreviousAnimationWorldQuaternion: THREE.Quaternion
    readonly frameCurrentAnimationWorldQuaternion: THREE.Quaternion
    /** Magica AngleConstraint per-step chain buffers (reused without frame allocations). */
    angleBufferedLength: number
    readonly angleLocalDirection: THREE.Vector3
    readonly angleLocalQuaternion: THREE.Quaternion
    readonly angleRotationBuffer: THREE.Quaternion
    readonly angleRestorationVector: THREE.Vector3
    readonly animationLocalPosition: THREE.Vector3
    readonly animationLocalQuaternion: THREE.Quaternion
    /** Authored proxy-vertex offset from the nearest simulated parent. */
    readonly initialProxyLocalPosition: THREE.Vector3
    /** Authored proxy-vertex rotation from the nearest simulated parent. */
    readonly initialProxyLocalQuaternion: THREE.Quaternion
    readonly lastWrittenLocalPosition: THREE.Vector3
    readonly lastWrittenLocalQuaternion: THREE.Quaternion
    /** Physics-only world-position offset written on the preceding output frame. */
    readonly lastWrittenResidualWorldPosition: THREE.Vector3
    /** Physics-only local rotation written on the preceding output frame. */
    readonly lastWrittenResidualQuaternion: THREE.Quaternion
    hasLastWrite: boolean
    hasPositionResidualHistory: boolean
    hasResidualHistory: boolean
}

interface ConnectionRuntime {
    readonly firstIndex: number
    readonly secondIndex: number
    readonly stiffnessScale: number
}

interface CenterFixedPointRuntime {
    readonly particleIndex: number
    /**
     * Maps the authored fixed-point rotation into the component-center frame.
     * MagicaCloth applies each proxy vertex bind-pose rotation before averaging
     * fixed-point normals/tangents; this is the equivalent stable offset for
     * the exported transform rig.
     */
    readonly bindPoseRotation: THREE.Quaternion
}

interface TeamRuntime {
    readonly cloth: CharacterPhysicsClothProduct
    readonly particles: ParticleRuntime[]
    readonly rootIndices: number[]
    readonly connections: ConnectionRuntime[]
    readonly colliders: CharacterPhysicsColliderProduct[]
    readonly colliderCorrectionSums: THREE.Vector3[]
    readonly colliderCorrectionCounts: number[]
    readonly anchor: THREE.Object3D
    readonly centerFixedPoints: CenterFixedPointRuntime[]
    /** Reused Magica proxy output buffers; never fed back into the solver. */
    readonly outputWorldPositions: THREE.Vector3[]
    readonly outputWorldQuaternions: THREE.Quaternion[]
    readonly outputOrder: number[]
    readonly lastAnchorPosition: THREE.Vector3
    readonly lastAnchorQuaternion: THREE.Quaternion
    readonly smoothedAnchorVelocity: THREE.Vector3
    /** Official moving-wind vector: retained component velocity, reversed. */
    readonly movingWindVelocity: THREE.Vector3
    readonly currentAnchorPosition: THREE.Vector3
    readonly currentAnchorQuaternion: THREE.Quaternion
    readonly framePreviousAnchorPosition: THREE.Vector3
    readonly frameCurrentAnchorPosition: THREE.Vector3
    readonly framePreviousAnchorQuaternion: THREE.Quaternion
    readonly frameCurrentAnchorQuaternion: THREE.Quaternion
    readonly lastComponentPosition: THREE.Vector3
    readonly lastComponentQuaternion: THREE.Quaternion
    readonly currentComponentPosition: THREE.Vector3
    readonly currentComponentQuaternion: THREE.Quaternion
    readonly framePreviousComponentPosition: THREE.Vector3
    readonly frameCurrentComponentPosition: THREE.Vector3
    readonly framePreviousComponentQuaternion: THREE.Quaternion
    readonly frameCurrentComponentQuaternion: THREE.Quaternion
    accumulator: number
    elapsed: number
    renderTime: number
    previousRenderTime: number
    lastFrameDelta: number
    stabilizationRemaining: number
    initialized: boolean
    failClosedReason?: string
}

interface OutputEntry {
    readonly team: TeamRuntime
    readonly particle: ParticleRuntime
    readonly index: number
    readonly hierarchyDepth: number
}

interface ColliderAabb {
    readonly minimum: THREE.Vector3
    readonly maximum: THREE.Vector3
}

interface SphereColliderGeometry {
    readonly kind: 'sphere'
    readonly previousCenter: THREE.Vector3
    readonly center: THREE.Vector3
    readonly framePreviousCenter: THREE.Vector3
    readonly frameCurrentCenter: THREE.Vector3
    framePreviousRadius: number
    frameCurrentRadius: number
    radius: number
    readonly aabb: ColliderAabb
}

interface CapsuleColliderGeometry {
    readonly kind: 'capsule'
    readonly previousStart: THREE.Vector3
    readonly previousEnd: THREE.Vector3
    readonly start: THREE.Vector3
    readonly end: THREE.Vector3
    readonly framePreviousStart: THREE.Vector3
    readonly framePreviousEnd: THREE.Vector3
    readonly frameCurrentStart: THREE.Vector3
    readonly frameCurrentEnd: THREE.Vector3
    framePreviousStartRadius: number
    framePreviousEndRadius: number
    frameCurrentStartRadius: number
    frameCurrentEndRadius: number
    startRadius: number
    endRadius: number
    readonly aabb: ColliderAabb
}

interface PlaneColliderGeometry {
    readonly kind: 'plane'
    readonly center: THREE.Vector3
    readonly normal: THREE.Vector3
    readonly framePreviousCenter: THREE.Vector3
    readonly frameCurrentCenter: THREE.Vector3
    readonly framePreviousNormal: THREE.Vector3
    readonly frameCurrentNormal: THREE.Vector3
}

type ColliderGeometry = SphereColliderGeometry | CapsuleColliderGeometry | PlaneColliderGeometry

interface EdgeProjection {
    readonly firstCorrection: THREE.Vector3
    readonly secondCorrection: THREE.Vector3
    readonly normal: THREE.Vector3
}

interface MutableDiagnostics {
    profileStableKey: string
    status: CharacterPhysicsDiagnostics['status']
    active: boolean
    clothTeams: number
    boneSpringTeams: number
    particles: number
    writableBones: number
    bodyColliders: number
    magicaColliders: number
    windZones: number
    missingBindings: string[]
    duplicateBindings: string[]
    resetCount: number
    simulationSteps: number
    colliderContacts: number
    selfContacts: number
    speedClamps: number
    angleClamps: number
    teleportResets: number
    nonFiniteCorrections: number
}

const WRITER_CLAIMS = new WeakMap<THREE.Object3D, symbol>()
const IDENTITY_QUATERNION = new THREE.Quaternion()
const X_AXIS = new THREE.Vector3(1, 0, 0)
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const Z_AXIS = new THREE.Vector3(0, 0, 1)
const EPSILON = 1e-8
const DISTANCE_VELOCITY_ATTENUATION = 0.3
const TETHER_STIFFNESS_WIDTH = 0.3
const TETHER_STRETCH_LIMIT = 0.03
const TETHER_VELOCITY_ATTENUATION = 0.7
const ANGLE_LIMIT_ITERATIONS = 3
const ANGLE_LIMIT_VELOCITY_ATTENUATION = 0.9
/** MagicaCloth SystemDefine.MaxDistanceRatioFutuerPrediction. */
const MAX_FUTURE_PREDICTION_DISTANCE_RATIO = 1.3

export class CharacterPhysicsWriterConflictError extends Error {
    constructor(profileStableKey: string) {
        super(`character-physics-writer-conflict:${profileStableKey}`)
        this.name = 'CharacterPhysicsWriterConflictError'
    }
}

function finiteDelta(value: number): number {
    return Number.isFinite(value) ? clamp(value, 0, 0.25) : 0
}

function vectorFrom(value: PhysicsVector3): THREE.Vector3 {
    return new THREE.Vector3(value.x, value.y, value.z)
}

/** Unity world products use reflected X when consumed by the Three.js FBX rig. */
function unityLocalVector(value: PhysicsVector3): THREE.Vector3 {
    return new THREE.Vector3(-value.x, value.y, value.z)
}

function settingNumber(
    settings: Readonly<Record<string, unknown>>,
    name: string,
    fallback = 0,
): number {
    const value = settings[name]
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function settingVector(
    settings: Readonly<Record<string, unknown>>,
    name: string,
): PhysicsVector3 {
    const value = settings[name]
    if (value && typeof value === 'object') {
        const candidate = value as Partial<PhysicsVector3>
        if (
            typeof candidate.x === 'number'
            && typeof candidate.y === 'number'
            && typeof candidate.z === 'number'
        ) {
            return { x: candidate.x, y: candidate.y, z: candidate.z }
        }
    }
    return { x: 0, y: 0, z: 0 }
}

function hashUnit(value: string): number {
    let hash = 2166136261
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0) / 0xffffffff
}

function quaternionAngleDegrees(
    first: THREE.Quaternion,
    second: THREE.Quaternion,
): number {
    return THREE.MathUtils.radToDeg(first.angleTo(second))
}

function closestPointSegmentRatio(
    point: THREE.Vector3,
    start: THREE.Vector3,
    end: THREE.Vector3,
): number {
    const axis = end.clone().sub(start)
    const denominator = axis.lengthSq()
    if (denominator <= EPSILON) return 0
    return clamp(point.clone().sub(start).dot(axis) / denominator, 0, 1)
}

function closestSegmentRatios(
    firstStart: THREE.Vector3,
    firstEnd: THREE.Vector3,
    secondStart: THREE.Vector3,
    secondEnd: THREE.Vector3,
): Readonly<{ first: number; second: number }> {
    const firstAxis = firstEnd.clone().sub(firstStart)
    const secondAxis = secondEnd.clone().sub(secondStart)
    const offset = firstStart.clone().sub(secondStart)
    const firstLengthSquared = firstAxis.lengthSq()
    const secondLengthSquared = secondAxis.lengthSq()
    const axisDot = firstAxis.dot(secondAxis)
    const firstOffsetDot = firstAxis.dot(offset)
    const secondOffsetDot = secondAxis.dot(offset)
    if (firstLengthSquared <= EPSILON && secondLengthSquared <= EPSILON) {
        return { first: 0, second: 0 }
    }
    if (firstLengthSquared <= EPSILON) {
        return {
            first: 0,
            second: clamp(secondOffsetDot / secondLengthSquared, 0, 1),
        }
    }
    if (secondLengthSquared <= EPSILON) {
        return {
            first: clamp(-firstOffsetDot / firstLengthSquared, 0, 1),
            second: 0,
        }
    }
    const denominator = firstLengthSquared * secondLengthSquared - axisDot * axisDot
    let first = denominator > EPSILON
        ? clamp((axisDot * secondOffsetDot - firstOffsetDot * secondLengthSquared) / denominator, 0, 1)
        : 0
    let second = (axisDot * first + secondOffsetDot) / secondLengthSquared
    if (second < 0) {
        second = 0
        first = clamp(-firstOffsetDot / firstLengthSquared, 0, 1)
    } else if (second > 1) {
        second = 1
        first = clamp((axisDot - firstOffsetDot) / firstLengthSquared, 0, 1)
    }
    return { first, second }
}

function aabbOverlaps(
    firstMinimum: THREE.Vector3,
    firstMaximum: THREE.Vector3,
    second: ColliderAabb,
): boolean {
    return firstMinimum.x <= second.maximum.x && firstMaximum.x >= second.minimum.x
        && firstMinimum.y <= second.maximum.y && firstMaximum.y >= second.minimum.y
        && firstMinimum.z <= second.maximum.z && firstMaximum.z >= second.minimum.z
}

function movePairToDistance(
    first: ParticleRuntime,
    second: ParticleRuntime,
    targetDistance: number,
    stiffness: number,
    firstPinned: boolean,
    secondPinned: boolean,
    velocityAttenuation = 0,
): void {
    const delta = second.position.clone().sub(first.position)
    const distance = delta.length()
    if (distance <= EPSILON || (!firstPinned && !secondPinned && stiffness <= 0)) return
    const correction = (distance - targetDistance) / distance * clamp(stiffness, 0, 1)
    if (firstPinned && secondPinned) return
    if (firstPinned) {
        const movement = delta.clone().multiplyScalar(-correction)
        second.position.add(movement)
        second.previousPosition.addScaledVector(movement, velocityAttenuation)
        return
    }
    if (secondPinned) {
        const movement = delta.clone().multiplyScalar(correction)
        first.position.add(movement)
        first.previousPosition.addScaledVector(movement, velocityAttenuation)
        return
    }
    const firstMovement = delta.clone().multiplyScalar(correction * 0.5)
    const secondMovement = delta.clone().multiplyScalar(-correction * 0.5)
    first.position.add(firstMovement)
    second.position.add(secondMovement)
    first.previousPosition.addScaledVector(firstMovement, velocityAttenuation)
    second.previousPosition.addScaledVector(secondMovement, velocityAttenuation)
}

function nearestAncestorIndex(
    bone: THREE.Object3D,
    byBone: ReadonlyMap<THREE.Object3D, number>,
): number {
    let current = bone.parent
    while (current) {
        const index = byBone.get(current)
        if (index !== undefined) return index
        current = current.parent
    }
    return -1
}

function depthOf(
    index: number,
    parentIndices: readonly number[],
    cache: number[],
): number {
    const cached = cache[index]
    if (cached !== undefined) return cached
    const parent = parentIndices[index] ?? -1
    const depth = parent < 0 ? 0 : depthOf(parent, parentIndices, cache) + 1
    cache[index] = depth
    return depth
}

function rootOf(index: number, parentIndices: readonly number[]): number {
    let current = index
    const seen = new Set<number>()
    while ((parentIndices[current] ?? -1) >= 0 && !seen.has(current)) {
        seen.add(current)
        current = parentIndices[current]!
    }
    return current
}

function connectionPairs(
    particles: readonly ParticleRuntime[],
    mode: number,
): ConnectionRuntime[] {
    if (mode === 0) return []
    const byDepth = new Map<number, ParticleRuntime[]>()
    for (const particle of particles) {
        const values = byDepth.get(particle.depth)
        if (values) values.push(particle)
        else byDepth.set(particle.depth, [particle])
    }
    const indexByParticle = new Map(particles.map((value, index) => [value, index]))
    const result: ConnectionRuntime[] = []
    const seen = new Set<string>()
    const add = (first: ParticleRuntime, second: ParticleRuntime, scale: number): void => {
        if (first.rootIndex === second.rootIndex) return
        const firstIndex = indexByParticle.get(first)!
        const secondIndex = indexByParticle.get(second)!
        const key = firstIndex < secondIndex
            ? `${firstIndex}:${secondIndex}`
            : `${secondIndex}:${firstIndex}`
        if (seen.has(key)) return
        seen.add(key)
        result.push({ firstIndex, secondIndex, stiffnessScale: scale })
    }
    for (const values of byDepth.values()) {
        values.sort((first, second) => first.rootIndex - second.rootIndex)
        for (let index = 0; index < values.length - 1; index += 1) {
            add(values[index]!, values[index + 1]!, 1)
        }
        if (mode >= 2 && values.length > 2) add(values[values.length - 1]!, values[0]!, 1)
    }
    if (mode >= 3) {
        for (const [depth, values] of byDepth) {
            const next = byDepth.get(depth + 1)
            if (!next) continue
            values.sort((first, second) => first.rootIndex - second.rootIndex)
            next.sort((first, second) => first.rootIndex - second.rootIndex)
            for (let index = 0; index < Math.min(values.length, next.length) - 1; index += 1) {
                add(values[index]!, next[index + 1]!, 0.65)
                add(values[index + 1]!, next[index]!, 0.65)
            }
        }
    }
    return result
}

function isFiniteVector(value: THREE.Vector3): boolean {
    return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)
}

function worldToCenterLocal(
    worldPosition: THREE.Vector3,
    centerPosition: THREE.Vector3,
    centerQuaternion: THREE.Quaternion,
): THREE.Vector3 {
    return worldPosition.clone()
        .sub(centerPosition)
        .applyQuaternion(centerQuaternion.clone().invert())
}

function centerLocalToWorld(
    localPosition: THREE.Vector3,
    centerPosition: THREE.Vector3,
    centerQuaternion: THREE.Quaternion,
): THREE.Vector3 {
    return localPosition.clone()
        .applyQuaternion(centerQuaternion)
        .add(centerPosition)
}

function setRotationFromNormalTangent(
    normal: THREE.Vector3,
    tangent: THREE.Vector3,
    fallback: THREE.Quaternion,
    target: THREE.Quaternion,
): void {
    if (normal.lengthSq() <= EPSILON || tangent.lengthSq() <= EPSILON) {
        target.copy(fallback)
        return
    }
    const y = normal.clone().normalize()
    const z = tangent.clone().addScaledVector(y, -tangent.dot(y))
    if (z.lengthSq() <= EPSILON) {
        target.copy(fallback)
        return
    }
    z.normalize()
    const x = y.clone().cross(z).normalize()
    z.copy(x).cross(y).normalize()
    target.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)).normalize()
}

function hierarchyDepth(object: THREE.Object3D): number {
    let depth = 0
    let parent = object.parent
    while (parent) {
        depth += 1
        parent = parent.parent
    }
    return depth
}

class NativeCharacterPhysics implements NativeCharacterPhysicsRuntime {
    private readonly claim = Symbol('magius-character-physics-writer')
    private bindings: ResolvedCharacterPhysicsBindings
    private readonly teams: TeamRuntime[] = []
    private readonly outputOwnerByBone = new Map<THREE.Object3D, TeamRuntime>()
    private readonly manualOutputByBone = new Map<THREE.Object3D, ManualOutputLeaseRecord>()
    private readonly manualOutputLeases = new Set<ManualOutputLeaseRecord>()
    private bindingEpoch = 0
    private manualUpdateId = 0
    private readonly outputEntries: OutputEntry[] = []
    private readonly diagnosticsState: MutableDiagnostics
    private readonly colliderByStableKey: ReadonlyMap<string, CharacterPhysicsColliderProduct>
    private readonly colliderGeometryByStableKey = new Map<string, ColliderGeometry>()
    private active: boolean
    private activeRequested: boolean
    private bindingRefreshPending = false
    private readonly bindingRegistry?: ExactPhysicsBindingRegistry
    private readonly unsubscribeBindingRegistry?: () => void
    private blendWeight: number
    private disposed = false
    private readonly fixedStepSeconds: number
    private readonly maximumCatchUpSteps: number
    private readonly root: THREE.Object3D
    private readonly profile: CharacterPhysicsProfile
    readonly nativeColliders: NativeCharacterColliderRuntime
    readonly windZones: MagicaWindRuntime

    constructor(
        root: THREE.Object3D,
        profile: CharacterPhysicsProfile,
        options: NativeCharacterPhysicsOptions,
    ) {
        if (WRITER_CLAIMS.has(root)) {
            throw new CharacterPhysicsWriterConflictError(profile.stableKey)
        }
        WRITER_CLAIMS.set(root, this.claim)
        this.root = root
        this.profile = profile
        this.bindingRegistry = options.bindingRegistry
        this.activeRequested = options.active ?? true
        this.active = this.activeRequested
        this.blendWeight = clamp(options.blendWeight ?? 1, 0, 1)
        this.fixedStepSeconds = options.fixedStepSeconds
            ?? profile.runtime.fixedStepSeconds
            ?? 1 / 90
        this.maximumCatchUpSteps = Math.max(
            1,
            Math.floor(options.maximumCatchUpSteps
                ?? profile.runtime.maximumCatchUpSteps
                ?? 3),
        )
        this.bindings = resolveCharacterPhysicsBindings(
            root,
            profile,
            options.bindingRegistry,
        )
        this.colliderByStableKey = new Map(
            profile.components.colliders.map(collider => [collider.stableKey, collider]),
        )
        this.nativeColliders = createNativeCharacterColliderRuntime(
            profile,
            this.bindings,
            options.bindingRegistry,
        )
        this.windZones = createMagicaWindRuntime(
            profile,
            this.bindings,
            options.bindingRegistry,
        )
        this.diagnosticsState = {
            profileStableKey: profile.stableKey,
            status: 'ready',
            active: this.active,
            clothTeams: 0,
            boneSpringTeams: 0,
            particles: 0,
            writableBones: 0,
            bodyColliders: profile.components.native.filter(
                collider => this.bindings.byStableKey.has(collider.stableKey),
            ).length,
            magicaColliders: profile.components.colliders.filter(
                collider => this.bindings.byStableKey.has(collider.stableKey),
            ).length,
            windZones: this.windZones.list().filter(zone => zone.runtimeReady).length,
            missingBindings: [...this.bindings.missingBindings],
            duplicateBindings: [...this.bindings.duplicateBindings],
            resetCount: 0,
            simulationSteps: 0,
            colliderContacts: 0,
            selfContacts: 0,
            speedClamps: 0,
            angleClamps: 0,
            teleportResets: 0,
            nonFiniteCorrections: 0,
        }
        this.root.updateMatrixWorld(true)
        this.createTeams()
        this.reconcileRuntimeStatus()
        this.unsubscribeBindingRegistry = options.bindingRegistry?.subscribe?.(() => {
            this.bindingRefreshPending = true
            this.bindingEpoch += 1
            this.invalidateManualOutputs('binding-refresh-pending')
        })
        if (this.active) this.reset()
    }

    getWritableChannelSnapshot(): NativePhysicsWritableChannelSnapshot {
        if (this.disposed) return { status: 'unavailable', reason: 'disposed', root: this.root }
        if (this.bindingRefreshPending) return { status: 'unavailable', reason: 'binding-refresh-pending', root: this.root }
        if (this.diagnosticsState.status === 'fail-closed') return { status: 'unavailable', reason: 'fail-closed', root: this.root }
        // applySolvedPose gates actual position/quaternion writes by this map.
        // restorePreviousAnimationPose only visits particles with hasLastWrite,
        // which is set after that same output gate. Bound terminal particles
        // without an output owner therefore never acquire an editor conflict.
        const outputs = [...this.outputOwnerByBone].map(([object, team]) => ({
            object,
            ownerStableKey: team.cloth.stableKey,
            channels: ['position', 'quaternion'] as const,
        }))
        return {
            status: 'ready',
            runtimeStatus: this.active ? 'ready' : 'disabled',
            active: this.active,
            root: this.root,
            outputObjects: new Set(this.outputOwnerByBone.keys()),
            outputs,
        }
    }

    acquireManualOutputLease(request: {
        root: THREE.Object3D; actorGeneration: number; isCurrent: () => boolean; outputs: readonly THREE.Object3D[]
    }): NativeManualLeaseResult<NativeManualOutputLease> {
        const unavailable = (reason: string): { status: 'unavailable'; reason: string } => ({ status: 'unavailable', reason })
        const snapshot = this.getWritableChannelSnapshot()
        if (snapshot.status !== 'ready') return unavailable(snapshot.reason)
        if (!this.active) return unavailable('runtime-disabled')
        if (request.root !== this.root) return unavailable('root-mismatch')
        if (!Number.isSafeInteger(request.actorGeneration) || request.actorGeneration < 0
            || typeof request.isCurrent !== 'function' || !request.isCurrent()) return unavailable('stale-actor-generation')
        if (!Array.isArray(request.outputs) || !request.outputs.length
            || new Set(request.outputs).size !== request.outputs.length) return unavailable('exact-nonempty-output-set-required')
        for (const object of request.outputs) {
            if (!this.outputOwnerByBone.has(object) || !this.manualObjectBelongsToRoot(object)) return unavailable('foreign-or-nonoutput-object')
            const owner = this.manualOutputByBone.get(object)
            if (owner && this.manualLeaseCurrent(owner) && owner.state === 'held') return unavailable('manual-output-already-held')
        }
        const record: ManualOutputLeaseRecord = {
            root: this.root, generation: request.actorGeneration, epoch: this.bindingEpoch, isCurrent: request.isCurrent,
            objects: new Set(request.outputs), state: 'held', lastFrameId: -1, from: new Map(), displayed: new Map(),
            duration: 0, elapsed: 0, first: true, fresh: false,
        }
        for (const object of record.objects) {
            const prior = this.manualOutputByBone.get(object)
            if (prior) {
                prior.objects.delete(object); prior.from.delete(object); prior.displayed.delete(object)
                if (!prior.objects.size) this.endManualOutputLease(prior, 'released', 'superseded')
            }
            this.manualOutputByBone.set(object, record)
        }
        this.clearManualOutputHistory(record.objects)
        this.manualOutputLeases.add(record)
        const runtime = this
        return { status: 'ready', value: {
            get state() { runtime.manualLeaseCurrent(record); return record.state },
            get reason() { runtime.manualLeaseCurrent(record); return record.reason },
            owns: object => this.manualLeaseCurrent(record) && this.manualOutputByBone.get(object) === record,
            submitEvaluatedFrame: frame => {
                if (!this.manualLeaseCurrent(record)) return unavailable(record.reason ?? record.state)
                if (frame.source !== 'post-animation-pre-manual' || !Number.isSafeInteger(frame.frameId)
                    || frame.frameId < 0 || frame.frameId <= record.lastFrameId) return unavailable('STALE_OR_UNKNOWN_EVALUATOR_FRAME')
                if (frame.localPoseByObject.size !== record.objects.size) return unavailable('exact-evaluator-output-set-required')
                const poses = new Map<THREE.Object3D, NativeManualLocalPose>()
                for (const object of record.objects) {
                    const pose = frame.localPoseByObject.get(object)
                    if (!pose || !this.validManualPose(pose)) return unavailable('invalid-evaluator-pose')
                    poses.set(object, { position: [...pose.position], quaternion: [...pose.quaternion] })
                }
                record.lastFrameId = frame.frameId
                record.queued = { updateId: this.manualUpdateId + 1, poses }
                return { status: 'ready', value: undefined }
            },
            beginReturn: options => {
                if (!this.manualLeaseCurrent(record)) return unavailable(record.reason ?? record.state)
                if (!Number.isFinite(options.transitionSeconds) || options.transitionSeconds < 0) return unavailable('invalid-return-duration')
                if (record.state === 'returning') return { status: 'ready', value: undefined }
                for (const object of record.objects) if (!this.validManualPose(this.readManualPose(object))) return unavailable('invalid-displayed-pose')
                for (const object of record.objects) {
                    const pose = this.readManualPose(object)
                    record.from.set(object, pose); record.displayed.set(object, pose)
                }
                this.clearManualOutputHistory(record.objects)
                record.state = 'returning'; record.duration = options.transitionSeconds; record.elapsed = 0
                record.first = true; record.fresh = false; record.queued = undefined; record.reason = 'WAIT_EVALUATED_FRAME'
                return { status: 'ready', value: undefined }
            },
            cancel: () => this.endManualOutputLease(record, 'released', 'cancelled'),
        } }
    }

    private manualObjectBelongsToRoot(object: THREE.Object3D): boolean {
        let current: THREE.Object3D | null = object
        while (current && current !== this.root) current = current.parent
        return current === this.root
    }

    private validManualPose(pose: NativeManualLocalPose): boolean {
        return Array.isArray(pose.position) && pose.position.length === 3
            && Array.isArray(pose.quaternion) && pose.quaternion.length === 4
            && [...pose.position, ...pose.quaternion].every(Number.isFinite)
            && Math.abs(pose.quaternion.reduce((sum, value) => sum + value * value, 0) - 1) < 1e-6
    }

    private readManualPose(object: THREE.Object3D): NativeManualLocalPose {
        return { position: object.position.toArray(), quaternion: object.quaternion.toArray() }
    }

    private clearManualOutputHistory(objects: ReadonlySet<THREE.Object3D>): void {
        for (const team of this.teams) for (const particle of team.particles) if (objects.has(particle.bone)) {
            particle.hasLastWrite = false; particle.hasResidualHistory = false; particle.hasPositionResidualHistory = false
        }
    }

    private endManualOutputLease(record: ManualOutputLeaseRecord, state: 'released' | 'invalid', reason: string): void {
        if (record.state === 'released' || record.state === 'invalid') return
        const owned = new Set([...record.objects].filter(object => this.manualOutputByBone.get(object) === record))
        this.clearManualOutputHistory(owned)
        for (const object of owned) this.manualOutputByBone.delete(object)
        record.state = state; record.reason = reason; record.queued = undefined; record.fresh = false
        this.manualOutputLeases.delete(record)
    }

    private invalidateManualOutputs(reason: string): void {
        for (const record of [...this.manualOutputLeases]) this.endManualOutputLease(record, 'invalid', reason)
    }

    private manualLeaseCurrent(record: ManualOutputLeaseRecord): boolean {
        if (record.state === 'released' || record.state === 'invalid') return false
        const reason = this.disposed ? 'disposed' : this.bindingRefreshPending ? 'binding-refresh-pending'
            : this.bindingEpoch !== record.epoch ? 'binding-epoch-changed' : !this.active ? 'runtime-disabled'
            : this.diagnosticsState.status === 'fail-closed' ? 'fail-closed'
            : record.root !== this.root || !record.isCurrent() ? 'stale-actor-generation'
            : [...record.objects].some(object => !this.manualObjectBelongsToRoot(object)
                || !this.outputOwnerByBone.has(object) || this.manualOutputByBone.get(object) !== record) ? 'output-identity-changed' : undefined
        if (reason) { this.endManualOutputLease(record, 'invalid', reason); return false }
        return true
    }

    private prepareManualOutputs(deltaSeconds: number): void {
        this.manualUpdateId += 1
        for (const record of [...this.manualOutputLeases]) {
            if (!this.manualLeaseCurrent(record)) continue
            if (record.state !== 'returning') { record.queued = undefined; continue }
            const queued = record.queued
            record.queued = undefined
            record.fresh = !!queued && queued.updateId === this.manualUpdateId
                && [...record.objects].every(object => {
                    const pose = queued.poses.get(object)
                    return !!pose && object.position.distanceToSquared(new THREE.Vector3(...pose.position)) < 1e-16
                        && object.quaternion.angleTo(new THREE.Quaternion(...pose.quaternion)) < 1e-7
                })
            if (!record.fresh) { record.reason = 'WAIT_EVALUATED_FRAME'; continue }
            record.reason = undefined
            if (record.first) record.first = false
            else record.elapsed += Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0)
            if (record.duration - record.elapsed < 1e-12) record.elapsed = record.duration
        }
    }

    private manualPinnedPose(object: THREE.Object3D): NativeManualLocalPose | undefined {
        const lease = this.manualOutputByBone.get(object)
        if (!lease) return undefined
        return lease.state === 'held' ? this.readManualPose(object) : !lease.fresh ? lease.displayed.get(object) : undefined
    }

    private manualProxyWorld(object: THREE.Object3D): THREE.Matrix4 {
        const pose = this.manualPinnedPose(object)
        const local = pose ? new THREE.Matrix4().compose(new THREE.Vector3(...pose.position), new THREE.Quaternion(...pose.quaternion), object.scale) : object.matrix.clone()
        return object.parent ? this.manualProxyWorld(object.parent).multiply(local) : local
    }

    get diagnostics(): CharacterPhysicsDiagnostics {
        this.diagnosticsState.bodyColliders = this.nativeColliders.list().filter(
            collider => collider.runtimeReady,
        ).length
        this.diagnosticsState.windZones = this.windZones.list().filter(
            zone => zone.runtimeReady,
        ).length
        return {
            ...this.diagnosticsState,
            missingBindings: [...this.diagnosticsState.missingBindings],
            duplicateBindings: [...this.diagnosticsState.duplicateBindings],
        }
    }

    updateAfterAnimation(
        deltaSeconds: number,
        context: CharacterPhysicsUpdateContext = {},
    ): void {
        if (this.disposed) return
        if (this.bindingRefreshPending) this.refreshBindings()
        if (!this.active || this.diagnosticsState.status === 'fail-closed') return
        this.prepareManualOutputs(deltaSeconds)
        this.restorePreviousAnimationPose()
        this.root.updateMatrixWorld(true)
        this.captureAnimationPose()
        this.captureColliderGeometry()
        for (const team of this.teams) {
            if (team.failClosedReason) continue
            const selectedDelta = this.deltaForUpdateMode(team, deltaSeconds, context)
            team.lastFrameDelta = selectedDelta
            team.previousRenderTime = team.renderTime
            const maximumAccumulatedTime = this.fixedStepSeconds * this.maximumCatchUpSteps
            const pendingTime = team.accumulator + selectedDelta
            const droppedTime = Math.max(0, pendingTime - maximumAccumulatedTime)
            team.renderTime += Math.max(0, selectedDelta - droppedTime)
            team.accumulator = Math.min(pendingTime, maximumAccumulatedTime)
            this.transportTeamForFrame(team, selectedDelta)
            let steps = 0
            while (team.accumulator + EPSILON >= this.fixedStepSeconds
                && steps < this.maximumCatchUpSteps) {
                const frameDuration = team.renderTime - team.previousRenderTime
                const previousStepRatio = frameDuration > EPSILON
                    ? clamp(
                        (team.elapsed - team.previousRenderTime) / frameDuration,
                        0,
                        1,
                    )
                    : 1
                const stepRatio = frameDuration > EPSILON
                    ? clamp(
                        (team.elapsed + this.fixedStepSeconds - team.previousRenderTime)
                            / frameDuration,
                        0,
                        1,
                    )
                    : 1
                this.prepareSimulationPose(team, stepRatio, this.fixedStepSeconds)
                this.prepareColliderGeometry(team, previousStepRatio, stepRatio)
                team.stabilizationRemaining = Math.max(
                    0,
                    team.stabilizationRemaining - this.fixedStepSeconds,
                )
                this.simulateTeam(team, this.fixedStepSeconds)
                this.commitDisplayStep(team)
                team.accumulator -= this.fixedStepSeconds
                team.elapsed += this.fixedStepSeconds
                steps += 1
                this.diagnosticsState.simulationSteps += 1
            }
            this.interpolateDisplayPose(team)
        }
        this.applySolvedPose()
        for (const record of [...this.manualOutputLeases]) {
            if (record.state === 'returning' && record.fresh && (record.duration === 0 || record.elapsed >= record.duration)) {
                // Keep the just-written restore/filter history for normal native output next frame.
                for (const object of record.objects) if (this.manualOutputByBone.get(object) === record) this.manualOutputByBone.delete(object)
                record.state = 'released'; record.reason = undefined; this.manualOutputLeases.delete(record)
            }
        }
    }

    setActive(active: boolean): void {
        if (this.disposed) return
        this.activeRequested = active
        if (this.diagnosticsState.status === 'fail-closed') return
        if (this.active === active) return
        if (!active) this.invalidateManualOutputs('runtime-disabled')
        this.restorePreviousAnimationPose()
        this.active = active
        this.diagnosticsState.active = active
        this.diagnosticsState.status = active ? 'ready' : 'disabled'
        if (active) this.reset()
    }

    setBlendWeight(weight: number): void {
        if (this.disposed) return
        this.blendWeight = clamp(Number.isFinite(weight) ? weight : 0, 0, 1)
    }

    refreshBindings(): void {
        if (this.disposed) return
        this.bindingEpoch += 1
        this.invalidateManualOutputs('binding-epoch-changed')
        this.bindingRefreshPending = false
        this.restorePreviousAnimationPose()
        this.teams.length = 0
        this.outputOwnerByBone.clear()
        this.outputEntries.length = 0
        this.colliderGeometryByStableKey.clear()
        this.bindings = resolveCharacterPhysicsBindings(
            this.root,
            this.profile,
            this.bindingRegistry,
        )
        this.diagnosticsState.missingBindings = [...this.bindings.missingBindings]
        this.diagnosticsState.duplicateBindings = [...this.bindings.duplicateBindings]
        this.diagnosticsState.magicaColliders = this.profile.components.colliders.filter(
            collider => this.bindings.byStableKey.has(collider.stableKey),
        ).length
        this.createTeams()
        this.reconcileRuntimeStatus()
        if (this.active) this.reset()
    }

    reset(): void {
        if (this.disposed) return
        this.restorePreviousAnimationPose()
        this.root.updateMatrixWorld(true)
        for (const team of this.teams) this.resetTeam(team)
        this.diagnosticsState.resetCount += 1
    }

    dispose(): void {
        if (this.disposed) return
        this.bindingEpoch += 1
        this.invalidateManualOutputs('disposed')
        this.restorePreviousAnimationPose()
        this.unsubscribeBindingRegistry?.()
        if (WRITER_CLAIMS.get(this.root) === this.claim) WRITER_CLAIMS.delete(this.root)
        this.disposed = true
        this.active = false
        this.colliderGeometryByStableKey.clear()
        this.diagnosticsState.active = false
        this.diagnosticsState.status = 'disposed'
    }

    private reconcileRuntimeStatus(): void {
        if (this.profile.runtime.status !== 'runtime-ready') {
            this.diagnosticsState.status = 'fail-closed'
            this.active = false
            this.diagnosticsState.active = false
            this.diagnosticsState.missingBindings.push(...this.profile.runtime.failClosedReasons)
            return
        }
        const expectedTeams = this.profile.components.cloth.filter(
            cloth => cloth.runtimeBinding.status === 'runtime-ready',
        ).length
        if (!this.teams.length && expectedTeams) {
            this.diagnosticsState.status = 'fail-closed'
            this.active = false
            this.diagnosticsState.active = false
            return
        }
        this.active = this.activeRequested
        this.diagnosticsState.active = this.active
        this.diagnosticsState.status = this.active ? 'ready' : 'disabled'
    }

    /**
     * MagicaCloth 2.9.1 derives the moving center from every fixed proxy point.
     * Falling back to the component Transform is only correct when a team has
     * no fixed points.  Averaging exact root bindings prevents locomotion from
     * injecting one arbitrary chain parent's phase into the whole team.
     */
    private captureTeamCenter(
        team: TeamRuntime,
        position: THREE.Vector3,
        quaternion: THREE.Quaternion,
    ): void {
        if (team.centerFixedPoints.length === 0) {
            team.anchor.updateWorldMatrix(true, false)
            team.anchor.getWorldPosition(position)
            team.anchor.getWorldQuaternion(quaternion)
            return
        }
        position.set(0, 0, 0)
        const normal = new THREE.Vector3()
        const tangent = new THREE.Vector3()
        for (const fixedPoint of team.centerFixedPoints) {
            const particle = team.particles[fixedPoint.particleIndex]!
            position.add(particle.bone.getWorldPosition(new THREE.Vector3()))
            const rotation = particle.bone.getWorldQuaternion(new THREE.Quaternion())
                .multiply(fixedPoint.bindPoseRotation)
                .normalize()
            normal.add(Y_AXIS.clone().applyQuaternion(rotation))
            tangent.add(Z_AXIS.clone().applyQuaternion(rotation))
        }
        position.multiplyScalar(1 / team.centerFixedPoints.length)
        const fallback = team.anchor.getWorldQuaternion(new THREE.Quaternion())
        setRotationFromNormalTangent(normal, tangent, fallback, quaternion)
    }

    private createTeams(): void {
        for (const cloth of this.profile.components.cloth) {
            if (cloth.runtimeBinding.status === 'inactive') continue
            if (cloth.runtimeBinding.status === 'fail-closed') {
                this.diagnosticsState.missingBindings.push(
                    `${cloth.stableKey}|fail-closed-component:`
                    + cloth.runtimeBinding.failClosedReasons.join(','),
                )
                continue
            }
            const resolved: Array<Readonly<{ stableKey: string; bone: THREE.Object3D }>> = []
            const missing: string[] = []
            for (const binding of cloth.chainBindings) {
                const object = this.bindings.byStableKey.get(binding.stableKey)
                if (!object) missing.push(binding.stableKey)
                else resolved.push({ stableKey: binding.stableKey, bone: object })
            }
            if (missing.length) {
                this.diagnosticsState.missingBindings.push(
                    `${cloth.stableKey}|fail-closed-component:${missing.join(',')}`,
                )
                continue
            }
            const anchor = this.bindings.byStableKey.get(cloth.stableKey)
            if (!anchor) {
                this.diagnosticsState.missingBindings.push(
                    `${cloth.stableKey}|fail-closed-component:center:${cloth.binding.stableKey}`,
                )
                continue
            }
            const byBone = new Map(resolved.map((value, index) => [value.bone, index]))
            const parentIndices = resolved.map(value => nearestAncestorIndex(value.bone, byBone))
            const depthCache: number[] = []
            const rootKeySet = new Set(cloth.rootBoneBindings.map(binding => binding.stableKey))
            const particles = resolved.map((value, index): ParticleRuntime => {
                const depth = depthOf(index, parentIndices, depthCache)
                const animationPosition = value.bone.getWorldPosition(new THREE.Vector3())
                const animationWorldQuaternion = value.bone.getWorldQuaternion(new THREE.Quaternion())
                return {
                    stableKey: value.stableKey,
                    bone: value.bone,
                    parentIndex: parentIndices[index] ?? -1,
                    childIndices: [],
                    rootIndex: rootOf(index, parentIndices),
                    depth,
                    normalizedDepth: 0,
                    radius: 0,
                    position: animationPosition.clone(),
                    previousPosition: animationPosition.clone(),
                    stepStartPosition: animationPosition.clone(),
                    realVelocity: new THREE.Vector3(),
                    displayPreviousPosition: animationPosition.clone(),
                    displayCurrentPosition: animationPosition.clone(),
                    displayPosition: animationPosition.clone(),
                    framePreviousAnimationPosition: animationPosition.clone(),
                    frameCurrentAnimationPosition: animationPosition.clone(),
                    animationPosition,
                    previousAnimationPosition: animationPosition.clone(),
                    initialAnchorLocalPosition: new THREE.Vector3(),
                    referencePosition: animationPosition.clone(),
                    framePreviousReferencePosition: animationPosition.clone(),
                    frameCurrentReferencePosition: animationPosition.clone(),
                    animationWorldQuaternion,
                    framePreviousAnimationWorldQuaternion: animationWorldQuaternion.clone(),
                    frameCurrentAnimationWorldQuaternion: animationWorldQuaternion.clone(),
                    angleBufferedLength: 0,
                    angleLocalDirection: new THREE.Vector3(),
                    angleLocalQuaternion: new THREE.Quaternion(),
                    angleRotationBuffer: animationWorldQuaternion.clone(),
                    angleRestorationVector: new THREE.Vector3(),
                    animationLocalPosition: value.bone.position.clone(),
                    animationLocalQuaternion: value.bone.quaternion.clone(),
                    initialProxyLocalPosition: new THREE.Vector3(),
                    initialProxyLocalQuaternion: new THREE.Quaternion(),
                    lastWrittenLocalPosition: value.bone.position.clone(),
                    lastWrittenLocalQuaternion: value.bone.quaternion.clone(),
                    lastWrittenResidualWorldPosition: new THREE.Vector3(),
                    lastWrittenResidualQuaternion: new THREE.Quaternion(),
                    hasLastWrite: false,
                    hasPositionResidualHistory: false,
                    hasResidualHistory: false,
                }
            })
            for (let index = 0; index < particles.length; index += 1) {
                const parentIndex = particles[index]!.parentIndex
                if (parentIndex >= 0) particles[parentIndex]!.childIndices.push(index)
            }
            for (const particle of particles) {
                if (particle.parentIndex < 0) {
                    particle.initialProxyLocalPosition.copy(particle.animationLocalPosition)
                    particle.initialProxyLocalQuaternion.copy(particle.animationLocalQuaternion)
                    continue
                }
                const parent = particles[particle.parentIndex]!
                const parentInverse = parent.animationWorldQuaternion.clone().invert()
                particle.initialProxyLocalPosition.copy(particle.animationPosition)
                    .sub(parent.animationPosition)
                    .applyQuaternion(parentInverse)
                particle.initialProxyLocalQuaternion.copy(parentInverse)
                    .multiply(particle.animationWorldQuaternion)
                    .normalize()
            }
            const rootIndices = particles
                .map((particle, index) => ({ particle, index }))
                .filter(value => value.particle.parentIndex < 0 || rootKeySet.has(value.particle.stableKey))
                .map(value => value.index)
            const maximumDepth = Math.max(1, ...particles.map(particle => particle.depth))
            for (const particle of particles) {
                particle.normalizedDepth = particle.depth / maximumDepth
                particle.radius = Math.max(
                    0,
                    evaluateMagicaCurve(cloth.serializeData.radius, particle.normalizedDepth),
                )
            }
            const referencedColliders = cloth.colliderReferences
                .filter(reference => reference.resolved && reference.stableKey !== null)
                .map(reference => this.colliderByStableKey.get(reference.stableKey!))
                .filter((value): value is CharacterPhysicsColliderProduct => value !== undefined)
            anchor.updateWorldMatrix(true, false)
            const componentPosition = anchor.getWorldPosition(new THREE.Vector3())
            const componentQuaternion = anchor.getWorldQuaternion(new THREE.Quaternion())
            const centerFixedPoints = rootIndices.map((particleIndex): CenterFixedPointRuntime => ({
                particleIndex,
                bindPoseRotation: particles[particleIndex]!.animationWorldQuaternion.clone()
                    .invert()
                    .multiply(componentQuaternion)
                    .normalize(),
            }))
            const centerPosition = centerFixedPoints.length > 0
                ? centerFixedPoints.reduce(
                    (sum, fixedPoint) => sum.add(
                        particles[fixedPoint.particleIndex]!.animationPosition,
                    ),
                    new THREE.Vector3(),
                ).multiplyScalar(1 / centerFixedPoints.length)
                : componentPosition
            const centerQuaternion = componentQuaternion.clone()
            for (const particle of particles) {
                particle.initialAnchorLocalPosition.copy(worldToCenterLocal(
                    particle.animationPosition,
                    centerPosition,
                    centerQuaternion,
                ))
            }
            const team: TeamRuntime = {
                cloth,
                particles,
                rootIndices,
                connections: connectionPairs(particles, cloth.serializeData.connectionMode),
                colliders: referencedColliders,
                colliderCorrectionSums: particles.map(() => new THREE.Vector3()),
                colliderCorrectionCounts: particles.map(() => 0),
                anchor,
                centerFixedPoints,
                outputWorldPositions: particles.map(
                    particle => particle.animationPosition.clone(),
                ),
                outputWorldQuaternions: particles.map(
                    particle => particle.animationWorldQuaternion.clone(),
                ),
                outputOrder: particles
                    .map((_, index) => index)
                    .sort((first, second) => (
                        particles[first]!.depth - particles[second]!.depth
                    )),
                lastAnchorPosition: centerPosition.clone(),
                lastAnchorQuaternion: centerQuaternion.clone(),
                smoothedAnchorVelocity: new THREE.Vector3(),
                movingWindVelocity: new THREE.Vector3(),
                currentAnchorPosition: centerPosition,
                currentAnchorQuaternion: centerQuaternion,
                framePreviousAnchorPosition: centerPosition.clone(),
                frameCurrentAnchorPosition: centerPosition.clone(),
                framePreviousAnchorQuaternion: centerQuaternion.clone(),
                frameCurrentAnchorQuaternion: centerQuaternion.clone(),
                lastComponentPosition: componentPosition.clone(),
                lastComponentQuaternion: componentQuaternion.clone(),
                currentComponentPosition: componentPosition.clone(),
                currentComponentQuaternion: componentQuaternion.clone(),
                framePreviousComponentPosition: componentPosition.clone(),
                frameCurrentComponentPosition: componentPosition.clone(),
                framePreviousComponentQuaternion: componentQuaternion.clone(),
                frameCurrentComponentQuaternion: componentQuaternion.clone(),
                accumulator: 0,
                elapsed: 0,
                renderTime: 0,
                previousRenderTime: 0,
                lastFrameDelta: this.fixedStepSeconds,
                stabilizationRemaining: 0,
                initialized: false,
            }
            this.teams.push(team)
            // Several official profiles intentionally nest a more-specific
            // MagicaCloth team inside a broader chain.  Keep every team for
            // its independent solver state, while the later exact component
            // is the sole post-animation output owner of a shared transform.
            for (const particle of particles) {
                if (
                    particle.childIndices.length > 0
                    || (
                        cloth.serializeData.clothType === 10
                        && rootIndices.includes(particles.indexOf(particle))
                    )
                ) this.outputOwnerByBone.set(particle.bone, team)
            }
        }
        this.diagnosticsState.clothTeams = this.teams.filter(
            team => team.cloth.serializeData.clothType !== 10,
        ).length
        this.diagnosticsState.boneSpringTeams = this.teams.filter(
            team => team.cloth.serializeData.clothType === 10,
        ).length
        this.diagnosticsState.particles = this.teams.reduce(
            (count, team) => count + team.particles.length,
            0,
        )
        this.diagnosticsState.writableBones = this.outputOwnerByBone.size
        this.outputEntries.length = 0
        for (const team of this.teams) {
            for (let index = 0; index < team.particles.length; index += 1) {
                const particle = team.particles[index]!
                this.outputEntries.push({
                    team,
                    particle,
                    index,
                    hierarchyDepth: hierarchyDepth(particle.bone),
                })
            }
        }
        this.outputEntries.sort((first, second) => (
            first.hierarchyDepth - second.hierarchyDepth
        ))
    }

    private deltaForUpdateMode(
        team: TeamRuntime,
        deltaSeconds: number,
        context: CharacterPhysicsUpdateContext,
    ): number {
        const mode = team.cloth.serializeData.updateMode
        if (mode === 2) return finiteDelta(context.unscaledDeltaSeconds ?? deltaSeconds)
        if (mode === 10) return finiteDelta(context.animatorDeltaSeconds ?? deltaSeconds)
        return finiteDelta(deltaSeconds)
    }

    private restorePreviousAnimationPose(): void {
        for (const team of this.teams) {
            for (const particle of team.particles) {
                // Both held and returning channels have explicit evaluator provenance.
                // Never restore an older native baseline over their current input.
                if (this.manualOutputByBone.has(particle.bone)) { particle.hasLastWrite = false; continue }
                if (!particle.hasLastWrite) continue
                if (particle.bone.position.distanceToSquared(particle.lastWrittenLocalPosition) < 1e-12) {
                    particle.bone.position.copy(particle.animationLocalPosition)
                }
                if (particle.bone.quaternion.angleTo(particle.lastWrittenLocalQuaternion) < 1e-6) {
                    particle.bone.quaternion.copy(particle.animationLocalQuaternion)
                }
                particle.hasLastWrite = false
            }
        }
        this.root.updateMatrixWorld(true)
    }

    private captureAnimationPose(): void {
        for (const team of this.teams) {
            team.anchor.updateWorldMatrix(true, false)
            team.framePreviousComponentPosition.copy(team.frameCurrentComponentPosition)
            team.framePreviousComponentQuaternion.copy(team.frameCurrentComponentQuaternion)
            team.anchor.getWorldPosition(team.frameCurrentComponentPosition)
            team.anchor.getWorldQuaternion(team.frameCurrentComponentQuaternion)
            team.framePreviousAnchorPosition.copy(team.frameCurrentAnchorPosition)
            team.framePreviousAnchorQuaternion.copy(team.frameCurrentAnchorQuaternion)
            this.captureTeamCenter(
                team,
                team.frameCurrentAnchorPosition,
                team.frameCurrentAnchorQuaternion,
            )
            const animationPoseRatio = clamp(team.cloth.serializeData.animationPoseRatio, 0, 1)
            for (const particle of team.particles) {
                particle.animationLocalPosition.copy(particle.bone.position)
                particle.animationLocalQuaternion.copy(particle.bone.quaternion)
                particle.framePreviousAnimationPosition.copy(
                    particle.frameCurrentAnimationPosition,
                )
                particle.framePreviousAnimationWorldQuaternion.copy(
                    particle.frameCurrentAnimationWorldQuaternion,
                )
                particle.framePreviousReferencePosition.copy(
                    particle.frameCurrentReferencePosition,
                )
                particle.bone.getWorldPosition(particle.frameCurrentAnimationPosition)
                particle.bone.getWorldQuaternion(
                    particle.frameCurrentAnimationWorldQuaternion,
                )
                particle.frameCurrentReferencePosition.copy(centerLocalToWorld(
                    particle.initialAnchorLocalPosition,
                    team.frameCurrentAnchorPosition,
                    team.frameCurrentAnchorQuaternion,
                ))
                particle.frameCurrentReferencePosition.lerp(
                    particle.frameCurrentAnimationPosition,
                    animationPoseRatio,
                )
            }
        }
    }

    private prepareSimulationPose(
        team: TeamRuntime,
        frameRatio: number,
        deltaSeconds: number,
    ): void {
        team.currentAnchorPosition.lerpVectors(
            team.framePreviousAnchorPosition,
            team.frameCurrentAnchorPosition,
            frameRatio,
        )
        team.currentAnchorQuaternion.slerpQuaternions(
            team.framePreviousAnchorQuaternion,
            team.frameCurrentAnchorQuaternion,
            frameRatio,
        ).normalize()
        team.currentComponentPosition.lerpVectors(
            team.framePreviousComponentPosition,
            team.frameCurrentComponentPosition,
            frameRatio,
        )
        team.currentComponentQuaternion.slerpQuaternions(
            team.framePreviousComponentQuaternion,
            team.frameCurrentComponentQuaternion,
            frameRatio,
        ).normalize()
        for (const particle of team.particles) {
            particle.animationPosition.lerpVectors(
                particle.framePreviousAnimationPosition,
                particle.frameCurrentAnimationPosition,
                frameRatio,
            )
            particle.animationWorldQuaternion.slerpQuaternions(
                particle.framePreviousAnimationWorldQuaternion,
                particle.frameCurrentAnimationWorldQuaternion,
                frameRatio,
            ).normalize()
            particle.referencePosition.lerpVectors(
                particle.framePreviousReferencePosition,
                particle.frameCurrentReferencePosition,
                frameRatio,
            )
        }
        this.transportTeamForStep(team, deltaSeconds)
    }

    private captureColliderGeometry(): void {
        for (const collider of this.profile.components.colliders) {
            if (settingNumber(collider.settings, 'm_Enabled', 1) === 0) continue
            const object = this.bindings.byStableKey.get(collider.stableKey)
            if (!object) continue
            // The character root was updated before this pass. External
            // action-phase bindings may live outside that root, so refresh the
            // individual collider once per render frame rather than once per
            // particle/solver iteration.
            object.updateWorldMatrix(true, false)
            const center = unityLocalVector(settingVector(collider.settings, 'center'))
                .applyMatrix4(object.matrixWorld)
            const worldScale = object.getWorldScale(new THREE.Vector3())
            const scalarScale = Math.max(
                Math.abs(worldScale.x),
                Math.abs(worldScale.y),
                Math.abs(worldScale.z),
            )
            const size = settingVector(collider.settings, 'size')
            const existing = this.colliderGeometryByStableKey.get(collider.stableKey)
            if (collider.script === 'MagicaSphereCollider') {
                const geometry: SphereColliderGeometry = existing?.kind === 'sphere'
                    ? existing
                    : {
                        kind: 'sphere',
                        previousCenter: center.clone(),
                        center: center.clone(),
                        framePreviousCenter: center.clone(),
                        frameCurrentCenter: center.clone(),
                        framePreviousRadius: Math.abs(size.x) * scalarScale,
                        frameCurrentRadius: Math.abs(size.x) * scalarScale,
                        radius: Math.abs(size.x) * scalarScale,
                        aabb: {
                            minimum: new THREE.Vector3(),
                            maximum: new THREE.Vector3(),
                        },
                    }
                geometry.framePreviousCenter.copy(geometry.frameCurrentCenter)
                geometry.frameCurrentCenter.copy(center)
                geometry.framePreviousRadius = geometry.frameCurrentRadius
                geometry.frameCurrentRadius = Math.abs(size.x) * scalarScale
                this.colliderGeometryByStableKey.set(collider.stableKey, geometry)
                continue
            }
            if (collider.script === 'MagicaPlaneCollider') {
                const normal = Y_AXIS.clone().transformDirection(object.matrixWorld)
                const geometry: PlaneColliderGeometry = existing?.kind === 'plane'
                    ? existing
                    : {
                        kind: 'plane',
                        center: center.clone(),
                        normal: normal.clone(),
                        framePreviousCenter: center.clone(),
                        frameCurrentCenter: center.clone(),
                        framePreviousNormal: normal.clone(),
                        frameCurrentNormal: normal.clone(),
                    }
                geometry.framePreviousCenter.copy(geometry.frameCurrentCenter)
                geometry.frameCurrentCenter.copy(center)
                geometry.framePreviousNormal.copy(geometry.frameCurrentNormal)
                geometry.frameCurrentNormal.copy(normal)
                this.colliderGeometryByStableKey.set(collider.stableKey, geometry)
                continue
            }
            const direction = settingNumber(collider.settings, 'direction', 1)
            // Magica capsules use the authored axis scale for all dimensions.
            // Unity +X is reflected into FBX -X, just like the local center.
            const localAxis = direction === 0 ? X_AXIS : direction === 2 ? Z_AXIS : Y_AXIS
            const worldAxis = localAxis.clone()
            if (direction === 0) worldAxis.negate()
            worldAxis.transformDirection(object.matrixWorld)
            const axisScale = Math.abs(direction === 0
                ? worldScale.x : direction === 2 ? worldScale.z : worldScale.y)
            const separated = settingNumber(collider.settings, 'radiusSeparation', 0) !== 0
            const startRadius = Math.abs(size.x) * axisScale
            const endRadius = Math.abs(separated ? size.y : size.x) * axisScale
            const length = Math.abs(size.z) * axisScale
            const centered = settingNumber(collider.settings, 'alignedOnCenter', 1) !== 0
            // Length includes both end caps. The start sphere is on +axis;
            // unequal radii have unequal offsets even when aligned on center.
            const startLength = Math.max(0, (centered ? length * 0.5 : 0) - startRadius)
            const endLength = Math.max(
                0, (centered ? length * 0.5 : length - startRadius) - endRadius,
            )
            const start = center.clone().addScaledVector(worldAxis, startLength)
            const end = center.clone().addScaledVector(worldAxis, -endLength)
            const geometry: CapsuleColliderGeometry = existing?.kind === 'capsule'
                ? existing
                : {
                    kind: 'capsule',
                    previousStart: start.clone(),
                     previousEnd: end.clone(),
                     start: start.clone(),
                     end: end.clone(),
                     framePreviousStart: start.clone(),
                     framePreviousEnd: end.clone(),
                     frameCurrentStart: start.clone(),
                     frameCurrentEnd: end.clone(),
                     framePreviousStartRadius: startRadius,
                     framePreviousEndRadius: endRadius,
                     frameCurrentStartRadius: startRadius,
                     frameCurrentEndRadius: endRadius,
                     startRadius,
                     endRadius,
                     aabb: {
                        minimum: new THREE.Vector3(),
                        maximum: new THREE.Vector3(),
                    },
                }
            geometry.framePreviousStart.copy(geometry.frameCurrentStart)
            geometry.framePreviousEnd.copy(geometry.frameCurrentEnd)
            geometry.frameCurrentStart.copy(start)
            geometry.frameCurrentEnd.copy(end)
            geometry.framePreviousStartRadius = geometry.frameCurrentStartRadius
            geometry.framePreviousEndRadius = geometry.frameCurrentEndRadius
            geometry.frameCurrentStartRadius = startRadius
            geometry.frameCurrentEndRadius = endRadius
            this.colliderGeometryByStableKey.set(collider.stableKey, geometry)
        }
    }

    private prepareColliderGeometry(
        team: TeamRuntime,
        previousFrameRatio: number,
        currentFrameRatio: number,
    ): void {
        for (const collider of team.colliders) {
            const geometry = this.colliderGeometryByStableKey.get(collider.stableKey)
            if (!geometry) continue
            if (geometry.kind === 'sphere') {
                geometry.previousCenter.lerpVectors(
                    geometry.framePreviousCenter,
                    geometry.frameCurrentCenter,
                    previousFrameRatio,
                )
                geometry.center.lerpVectors(
                    geometry.framePreviousCenter,
                    geometry.frameCurrentCenter,
                    currentFrameRatio,
                )
                const previousRadius = THREE.MathUtils.lerp(
                    geometry.framePreviousRadius,
                    geometry.frameCurrentRadius,
                    previousFrameRatio,
                )
                geometry.radius = THREE.MathUtils.lerp(
                    geometry.framePreviousRadius,
                    geometry.frameCurrentRadius,
                    currentFrameRatio,
                )
                const maximumRadius = Math.max(previousRadius, geometry.radius)
                geometry.aabb.minimum.set(
                    Math.min(geometry.previousCenter.x, geometry.center.x) - maximumRadius,
                    Math.min(geometry.previousCenter.y, geometry.center.y) - maximumRadius,
                    Math.min(geometry.previousCenter.z, geometry.center.z) - maximumRadius,
                )
                geometry.aabb.maximum.set(
                    Math.max(geometry.previousCenter.x, geometry.center.x) + maximumRadius,
                    Math.max(geometry.previousCenter.y, geometry.center.y) + maximumRadius,
                    Math.max(geometry.previousCenter.z, geometry.center.z) + maximumRadius,
                )
                continue
            }
            if (geometry.kind === 'plane') {
                geometry.center.lerpVectors(
                    geometry.framePreviousCenter,
                    geometry.frameCurrentCenter,
                    currentFrameRatio,
                )
                geometry.normal.lerpVectors(
                    geometry.framePreviousNormal,
                    geometry.frameCurrentNormal,
                    currentFrameRatio,
                ).normalize()
                continue
            }
            geometry.previousStart.lerpVectors(
                geometry.framePreviousStart,
                geometry.frameCurrentStart,
                previousFrameRatio,
            )
            geometry.previousEnd.lerpVectors(
                geometry.framePreviousEnd,
                geometry.frameCurrentEnd,
                previousFrameRatio,
            )
            geometry.start.lerpVectors(
                geometry.framePreviousStart,
                geometry.frameCurrentStart,
                currentFrameRatio,
            )
            geometry.end.lerpVectors(
                geometry.framePreviousEnd,
                geometry.frameCurrentEnd,
                currentFrameRatio,
            )
            const previousStartRadius = THREE.MathUtils.lerp(
                geometry.framePreviousStartRadius,
                geometry.frameCurrentStartRadius,
                previousFrameRatio,
            )
            const previousEndRadius = THREE.MathUtils.lerp(
                geometry.framePreviousEndRadius,
                geometry.frameCurrentEndRadius,
                previousFrameRatio,
            )
            geometry.startRadius = THREE.MathUtils.lerp(
                geometry.framePreviousStartRadius,
                geometry.frameCurrentStartRadius,
                currentFrameRatio,
            )
            geometry.endRadius = THREE.MathUtils.lerp(
                geometry.framePreviousEndRadius,
                geometry.frameCurrentEndRadius,
                currentFrameRatio,
            )
            const maximumRadius = Math.max(
                previousStartRadius,
                previousEndRadius,
                geometry.startRadius,
                geometry.endRadius,
            )
            geometry.aabb.minimum.set(
                Math.min(
                    geometry.previousStart.x,
                    geometry.previousEnd.x,
                    geometry.start.x,
                    geometry.end.x,
                ) - maximumRadius,
                Math.min(
                    geometry.previousStart.y,
                    geometry.previousEnd.y,
                    geometry.start.y,
                    geometry.end.y,
                ) - maximumRadius,
                Math.min(
                    geometry.previousStart.z,
                    geometry.previousEnd.z,
                    geometry.start.z,
                    geometry.end.z,
                ) - maximumRadius,
            )
            geometry.aabb.maximum.set(
                Math.max(
                    geometry.previousStart.x,
                    geometry.previousEnd.x,
                    geometry.start.x,
                    geometry.end.x,
                ) + maximumRadius,
                Math.max(
                    geometry.previousStart.y,
                    geometry.previousEnd.y,
                    geometry.start.y,
                    geometry.end.y,
                ) + maximumRadius,
                Math.max(
                    geometry.previousStart.z,
                    geometry.previousEnd.z,
                    geometry.start.z,
                    geometry.end.z,
                ) + maximumRadius,
            )
        }
    }

    private resetTeam(team: TeamRuntime): void {
        team.anchor.updateWorldMatrix(true, false)
        team.anchor.getWorldPosition(team.frameCurrentComponentPosition)
        team.anchor.getWorldQuaternion(team.frameCurrentComponentQuaternion)
        team.framePreviousComponentPosition.copy(team.frameCurrentComponentPosition)
        team.framePreviousComponentQuaternion.copy(team.frameCurrentComponentQuaternion)
        team.currentComponentPosition.copy(team.frameCurrentComponentPosition)
        team.currentComponentQuaternion.copy(team.frameCurrentComponentQuaternion)
        team.lastComponentPosition.copy(team.currentComponentPosition)
        team.lastComponentQuaternion.copy(team.currentComponentQuaternion)
        this.captureTeamCenter(
            team,
            team.frameCurrentAnchorPosition,
            team.frameCurrentAnchorQuaternion,
        )
        team.framePreviousAnchorPosition.copy(team.frameCurrentAnchorPosition)
        team.framePreviousAnchorQuaternion.copy(team.frameCurrentAnchorQuaternion)
        team.currentAnchorPosition.copy(team.frameCurrentAnchorPosition)
        team.currentAnchorQuaternion.copy(team.frameCurrentAnchorQuaternion)
        team.lastAnchorPosition.copy(team.currentAnchorPosition)
        team.lastAnchorQuaternion.copy(team.currentAnchorQuaternion)
        team.smoothedAnchorVelocity.set(0, 0, 0)
        team.movingWindVelocity.set(0, 0, 0)
        team.accumulator = 0
        team.elapsed = 0
        team.renderTime = 0
        team.previousRenderTime = 0
        team.lastFrameDelta = this.fixedStepSeconds
        team.stabilizationRemaining = Math.max(
            0,
            team.cloth.serializeData.stablizationTimeAfterReset,
        )
        for (const particle of team.particles) {
            particle.bone.getWorldPosition(particle.frameCurrentAnimationPosition)
            particle.bone.getWorldQuaternion(particle.frameCurrentAnimationWorldQuaternion)
            particle.framePreviousAnimationPosition.copy(
                particle.frameCurrentAnimationPosition,
            )
            particle.framePreviousAnimationWorldQuaternion.copy(
                particle.frameCurrentAnimationWorldQuaternion,
            )
            particle.animationPosition.copy(particle.frameCurrentAnimationPosition)
            particle.animationWorldQuaternion.copy(
                particle.frameCurrentAnimationWorldQuaternion,
            )
            particle.position.copy(particle.animationPosition)
            particle.previousPosition.copy(particle.animationPosition)
            particle.stepStartPosition.copy(particle.animationPosition)
            particle.realVelocity.set(0, 0, 0)
            particle.displayPreviousPosition.copy(particle.animationPosition)
            particle.displayCurrentPosition.copy(particle.animationPosition)
            particle.displayPosition.copy(particle.animationPosition)
            particle.previousAnimationPosition.copy(particle.animationPosition)
            particle.referencePosition.copy(centerLocalToWorld(
                particle.initialAnchorLocalPosition,
                team.currentAnchorPosition,
                team.currentAnchorQuaternion,
            ))
            particle.referencePosition.lerp(
                particle.animationPosition,
                clamp(team.cloth.serializeData.animationPoseRatio, 0, 1),
            )
            particle.frameCurrentReferencePosition.copy(particle.referencePosition)
            particle.framePreviousReferencePosition.copy(particle.referencePosition)
            particle.animationLocalPosition.copy(particle.bone.position)
            particle.animationLocalQuaternion.copy(particle.bone.quaternion)
            particle.lastWrittenResidualWorldPosition.set(0, 0, 0)
            particle.lastWrittenResidualQuaternion.identity()
            particle.hasLastWrite = false
            particle.hasPositionResidualHistory = false
            particle.hasResidualHistory = false
        }
        team.initialized = true
    }

    private transportTeamForFrame(team: TeamRuntime, deltaSeconds: number): void {
        if (!team.initialized) {
            this.resetTeam(team)
            return
        }
        const data = team.cloth.serializeData.inertiaConstraint
        const componentDelta = team.frameCurrentComponentPosition.clone()
            .sub(team.lastComponentPosition)
        const teleported = data.teleportMode !== 0 && (
            componentDelta.length() >= Math.max(0, data.teleportDistance)
            || quaternionAngleDegrees(
                team.frameCurrentComponentQuaternion,
                team.lastComponentQuaternion,
            ) >= Math.max(0, data.teleportRotation)
        )
        // MagicaCloth TeleportMode is None=0, Reset=1, Keep=2.  The old
        // implementation accidentally treated Reset as Keep and measured the
        // animated fixed-point center instead of the component Transform.
        if (teleported && data.teleportMode === 1) {
            this.resetTeam(team)
            this.diagnosticsState.teleportResets += 1
            return
        }

        // Official 2.9.1 world inertia is based solely on component motion.
        // Fixed-point animation is handled later as local center inertia.  Its
        // movement smoothing shifts high-frequency residual component motion
        // with the character, instead of injecting it into hair/cloth.
        const workingOldComponentPosition = team.lastComponentPosition.clone()
        const smoothing = clamp(data.movementInertiaSmoothing, 0, 1)
        if (smoothing >= 1e-6 && deltaSeconds > EPSILON) {
            const frameDeltaVelocity = componentDelta.clone().multiplyScalar(1 / deltaSeconds)
            if (data.movementSpeedLimit.use) {
                const maximum = Math.max(0, data.movementSpeedLimit.value)
                if (frameDeltaVelocity.lengthSq() > maximum * maximum) {
                    frameDeltaVelocity.setLength(maximum)
                    this.diagnosticsState.speedClamps += 1
                }
            }
            const averageRatio = clamp((1 - smoothing) ** 3 * 0.99 + 0.01, 0, 1)
            team.smoothedAnchorVelocity.lerp(frameDeltaVelocity, averageRatio)
            workingOldComponentPosition.copy(team.frameCurrentComponentPosition)
                .addScaledVector(team.smoothedAnchorVelocity, -deltaSeconds)
        } else if (deltaSeconds > EPSILON) {
            team.smoothedAnchorVelocity.copy(componentDelta).multiplyScalar(1 / deltaSeconds)
        } else {
            team.smoothedAnchorVelocity.set(0, 0, 0)
        }

        let worldMovementFollow = 1 - clamp(data.worldInertia, 0, 1)
        let worldRotationFollow = worldMovementFollow
        if (teleported && data.teleportMode === 2) {
            worldMovementFollow = 1
            worldRotationFollow = 1
        }
        workingOldComponentPosition.lerp(
            team.frameCurrentComponentPosition,
            worldMovementFollow,
        )
        const workingOldComponentQuaternion = team.lastComponentQuaternion.clone()
            .slerp(team.frameCurrentComponentQuaternion, worldRotationFollow)
            .normalize()
        if (data.movementSpeedLimit.use && deltaSeconds > EPSILON) {
            const retained = team.frameCurrentComponentPosition.clone()
                .sub(workingOldComponentPosition)
            const inertialSpeed = retained.length() / deltaSeconds
            const maximum = Math.max(0, data.movementSpeedLimit.value)
            if (inertialSpeed > maximum && inertialSpeed > EPSILON) {
                const shiftRatio = clamp((inertialSpeed - maximum) / inertialSpeed, 0, 1)
                workingOldComponentPosition.lerp(
                    team.frameCurrentComponentPosition,
                    shiftRatio,
                )
                this.diagnosticsState.speedClamps += 1
            }
        }
        if (data.rotationSpeedLimit.use && deltaSeconds > EPSILON) {
            const inertialSpeed = THREE.MathUtils.radToDeg(
                workingOldComponentQuaternion.angleTo(team.frameCurrentComponentQuaternion)
                    / deltaSeconds,
            )
            const maximum = Math.max(0, data.rotationSpeedLimit.value)
            if (inertialSpeed > maximum && inertialSpeed > EPSILON) {
                const shiftRatio = clamp((inertialSpeed - maximum) / inertialSpeed, 0, 1)
                workingOldComponentQuaternion.slerp(
                    team.frameCurrentComponentQuaternion,
                    shiftRatio,
                ).normalize()
                this.diagnosticsState.angleClamps += 1
            }
        }

        const worldShiftVector = workingOldComponentPosition.clone()
            .sub(team.lastComponentPosition)
        const worldShiftRotation = workingOldComponentQuaternion.clone()
            .multiply(team.lastComponentQuaternion.clone().invert())
            .normalize()
        const shiftPosition = (
            position: THREE.Vector3,
            origin: THREE.Vector3,
            translation: THREE.Vector3,
            rotation: THREE.Quaternion,
        ): void => {
            position.sub(origin)
                .applyQuaternion(rotation)
                .add(origin)
                .add(translation)
        }
        for (const particle of team.particles) {
            shiftPosition(
                particle.position,
                team.lastComponentPosition,
                worldShiftVector,
                worldShiftRotation,
            )
            shiftPosition(
                particle.previousPosition,
                team.lastComponentPosition,
                worldShiftVector,
                worldShiftRotation,
            )
            shiftPosition(
                particle.displayPreviousPosition,
                team.lastComponentPosition,
                worldShiftVector,
                worldShiftRotation,
            )
            shiftPosition(
                particle.displayCurrentPosition,
                team.lastComponentPosition,
                worldShiftVector,
                worldShiftRotation,
            )
            shiftPosition(
                particle.displayPosition,
                team.lastComponentPosition,
                worldShiftVector,
                worldShiftRotation,
            )
            particle.realVelocity.applyQuaternion(worldShiftRotation)
        }
        shiftPosition(
            team.lastAnchorPosition,
            team.lastComponentPosition,
            worldShiftVector,
            worldShiftRotation,
        )
        team.lastAnchorQuaternion.premultiply(worldShiftRotation).normalize()
        shiftPosition(
            team.framePreviousAnchorPosition,
            team.lastComponentPosition,
            worldShiftVector,
            worldShiftRotation,
        )
        team.framePreviousAnchorQuaternion.premultiply(worldShiftRotation).normalize()
        if (deltaSeconds > EPSILON) {
            team.movingWindVelocity.copy(team.frameCurrentComponentPosition)
                .sub(workingOldComponentPosition)
                .multiplyScalar(-1 / deltaSeconds)
        } else {
            team.movingWindVelocity.set(0, 0, 0)
        }

        // MagicaCloth's PreSimulationUpdateJob applies this component-space
        // transport once per render frame.  Keeping the previous component at
        // the captured frame boundary prevents a 90 Hz solver from applying
        // smoothing and speed clamps once on one 60 Hz frame and twice on the
        // next, which was the source of the alternating hair/cloth impulse.
        team.lastComponentPosition.copy(team.frameCurrentComponentPosition)
        team.lastComponentQuaternion.copy(team.frameCurrentComponentQuaternion)
    }

    private transportTeamForStep(team: TeamRuntime, deltaSeconds: number): void {
        // Official local center inertia is a fixed-step operation.  It shifts
        // nextPos/velocityPos only; component world inertia and display history
        // have already been handled once by transportTeamForFrame().
        for (const particle of team.particles) {
            particle.stepStartPosition.copy(particle.position)
        }
        const data = team.cloth.serializeData.inertiaConstraint

        const anchorDelta = team.currentAnchorPosition.clone()
            .sub(team.lastAnchorPosition)
        const anchorRotation = team.currentAnchorQuaternion.clone()
            .multiply(team.lastAnchorQuaternion.clone().invert())
            .normalize()
        const anchorDistance = anchorDelta.length()
        const anchorAngle = IDENTITY_QUATERNION.angleTo(anchorRotation)
        let localMovementFollow = 1 - clamp(data.localInertia, 0, 1)
        let localRotationFollow = localMovementFollow
        if (data.localMovementSpeedLimit.use && deltaSeconds > EPSILON) {
            const inertialSpeed = anchorDistance * (1 - localMovementFollow) / deltaSeconds
            if (inertialSpeed > data.localMovementSpeedLimit.value && inertialSpeed > EPSILON) {
                localMovementFollow = THREE.MathUtils.lerp(
                    1,
                    localMovementFollow,
                    data.localMovementSpeedLimit.value / inertialSpeed,
                )
                this.diagnosticsState.speedClamps += 1
            }
        }
        if (data.localRotationSpeedLimit.use && deltaSeconds > EPSILON) {
            const inertialSpeed = THREE.MathUtils.radToDeg(
                anchorAngle * (1 - localRotationFollow) / deltaSeconds,
            )
            if (inertialSpeed > data.localRotationSpeedLimit.value && inertialSpeed > EPSILON) {
                localRotationFollow = THREE.MathUtils.lerp(
                    1,
                    localRotationFollow,
                    data.localRotationSpeedLimit.value / inertialSpeed,
                )
                this.diagnosticsState.angleClamps += 1
            }
        }
        for (const particle of team.particles) {
            const depthFollow = clamp(
                data.depthInertia * (1 - particle.normalizedDepth ** 2),
                0,
                1,
            )
            const movementFollow = THREE.MathUtils.lerp(
                localMovementFollow,
                1,
                depthFollow,
            )
            const rotationFollow = THREE.MathUtils.lerp(
                localRotationFollow,
                1,
                depthFollow,
            )
            if (movementFollow > 0 || rotationFollow > 0) {
                const followedRotation = IDENTITY_QUATERNION.clone()
                    .slerp(anchorRotation, rotationFollow)
                particle.position
                    .sub(team.lastAnchorPosition)
                    .applyQuaternion(followedRotation)
                    .add(team.lastAnchorPosition)
                    .addScaledVector(anchorDelta, movementFollow)
                particle.previousPosition
                    .sub(team.lastAnchorPosition)
                    .applyQuaternion(followedRotation)
                    .add(team.lastAnchorPosition)
                    .addScaledVector(anchorDelta, movementFollow)
                // Official local inertia only offsets nextPos/velocityPos at
                // fixed-step start.  dispPosArray is shifted by component
                // world inertia once per frame, never by the animated fixed-
                // point center.  Moving the display history here made 90 Hz
                // local-center steps alternate at a 60 Hz render cadence.
            }
            particle.previousAnimationPosition.copy(particle.animationPosition)
        }
        team.lastAnchorPosition.copy(team.currentAnchorPosition)
        team.lastAnchorQuaternion.copy(team.currentAnchorQuaternion)
    }

    private simulateTeam(team: TeamRuntime, step: number): void {
        const cloth = team.cloth.serializeData
        const spring = cloth.clothType === 10 && cloth.springConstraint.useSpring !== 0
        for (const particle of team.particles) {
            const isRoot = team.rootIndices.includes(team.particles.indexOf(particle))
            if (!spring && isRoot) {
                particle.position.copy(particle.animationPosition)
                particle.previousPosition.copy(particle.animationPosition)
                particle.realVelocity.set(0, 0, 0)
                continue
            }
            const damping = clamp(
                evaluateMagicaCurve(cloth.damping, particle.normalizedDepth),
                0,
                0.99,
            )
            const velocity = particle.position.clone()
                .sub(particle.previousPosition)
                .multiplyScalar(1 - damping)
            particle.previousPosition.copy(particle.position)
            if (cloth.inertiaConstraint.particleSpeedLimit.use) {
                const maximum = cloth.inertiaConstraint.particleSpeedLimit.value * step
                if (velocity.lengthSq() > maximum * maximum) {
                    velocity.setLength(Math.max(0, maximum))
                    this.diagnosticsState.speedClamps += 1
                }
            }
            particle.position.add(velocity)
            if (!spring) {
                const gravityFalloff = clamp(
                    cloth.gravityFalloff * particle.normalizedDepth,
                    0,
                    1,
                )
                const gravity = vectorFrom(cloth.gravityDirection)
                    .normalize()
                    .multiplyScalar(cloth.gravity * (1 - gravityFalloff) * step * step)
                particle.position.add(gravity)
            }
            const wind = this.sampleWind(team, particle)
            particle.position.addScaledVector(wind, step * step)
            if (cloth.inertiaConstraint.centrifualAcceleration !== 0) {
                const radial = particle.position.clone().sub(team.currentAnchorPosition)
                particle.position.addScaledVector(
                    radial,
                    cloth.inertiaConstraint.centrifualAcceleration * step * step,
                )
            }
            if (spring && isRoot) this.solveBoneSpringRoot(team, particle, step)
        }

        // MagicaCloth 2.9.1 runs one authored constraint schedule per fixed
        // step.  Repeating the whole schedule four times multiplied distance,
        // angle and collider corrections and produced alternating hair/cloth
        // impulses at 90 Hz.  Keep only AngleConstraint's own three internal
        // passes and preserve the official ordering here.
        this.pinRoots(team, spring)
        this.solveTether(team, spring)
        this.solveDistances(team, spring)
        this.solveAngles(team, spring)
        this.solveConnections(team)
        this.solveColliders(team, spring)
        this.solveDistances(team, spring)
        this.solveMotionConstraints(team, spring)
        if (!spring && cloth.selfCollisionConstraint.selfMode === 2) {
            this.solveSelfCollision(team)
        }
        for (const particle of team.particles) {
            if (isFiniteVector(particle.position) && isFiniteVector(particle.previousPosition)) {
                particle.realVelocity.copy(particle.position)
                    .sub(particle.stepStartPosition)
                    .multiplyScalar(1 / Math.max(step, EPSILON))
            } else {
                particle.position.copy(particle.animationPosition)
                particle.previousPosition.copy(particle.animationPosition)
                particle.stepStartPosition.copy(particle.animationPosition)
                particle.realVelocity.set(0, 0, 0)
                particle.displayPreviousPosition.copy(particle.animationPosition)
                particle.displayCurrentPosition.copy(particle.animationPosition)
                particle.displayPosition.copy(particle.animationPosition)
                this.diagnosticsState.nonFiniteCorrections += 1
            }
        }
    }

    private commitDisplayStep(team: TeamRuntime): void {
        for (const particle of team.particles) {
            particle.displayPreviousPosition.copy(particle.displayCurrentPosition)
            particle.displayCurrentPosition.copy(particle.position)
        }
    }

    private interpolateDisplayPose(team: TeamRuntime): void {
        // MagicaCloth's CalcDisplayPositionJob predicts one fixed step into the
        // future from oldPos + realVelocity, then blends from the preceding
        // displayed position over the render-frame interval. Interpolating the
        // two most recent fixed states makes a two-step frame jump backwards
        // when the remainder returns to zero, which is the visible 90/60 Hz
        // hair and skirt twitch this path must avoid.
        const futureInterval = (team.elapsed + this.fixedStepSeconds)
            - team.previousRenderTime
        const displayRatio = futureInterval > EPSILON
            ? clamp(
                (team.renderTime - team.previousRenderTime) / futureInterval,
                0,
                1,
            )
            : 0
        const spring = team.cloth.serializeData.clothType === 10
            && team.cloth.serializeData.springConstraint.useSpring !== 0
        for (let index = 0; index < team.particles.length; index += 1) {
            const particle = team.particles[index]!
            if (!spring && team.rootIndices.includes(index)) {
                particle.displayPosition.copy(particle.frameCurrentAnimationPosition)
                continue
            }
            const futurePosition = particle.position.clone().addScaledVector(
                particle.realVelocity,
                this.fixedStepSeconds,
            )
            // CalcDisplayPositionJob bounds one-step prediction around the
            // animated root.  Without this official 1.3x rest-distance cap,
            // a single locomotion frame can project long hair or cloth past
            // its authored chain length and the following frame snaps it back.
            const rootAnimationPosition = team.particles[particle.rootIndex]!
                .frameCurrentAnimationPosition
            const authoredRootDistance = rootAnimationPosition.distanceTo(
                particle.frameCurrentAnimationPosition,
            )
            const maximumPredictionDistance = authoredRootDistance
                * MAX_FUTURE_PREDICTION_DISTANCE_RATIO
            const predictedRootOffset = futurePosition.clone().sub(rootAnimationPosition)
            const predictedRootDistance = predictedRootOffset.length()
            if (predictedRootDistance > maximumPredictionDistance
                && predictedRootDistance > EPSILON) {
                futurePosition
                    .copy(rootAnimationPosition)
                    .addScaledVector(
                        predictedRootOffset,
                        maximumPredictionDistance / predictedRootDistance,
                    )
            }
            particle.displayPosition.lerp(futurePosition, displayRatio)
        }
    }

    private pinRoots(team: TeamRuntime, spring: boolean): void {
        if (spring) return
        for (const index of team.rootIndices) {
            team.particles[index]!.position.copy(team.particles[index]!.animationPosition)
        }
    }

    private solveTether(team: TeamRuntime, spring: boolean): void {
        if (spring) return
        const compressionLimit = 1 - clamp(
            team.cloth.serializeData.tetherConstraint.distanceCompression,
            0,
            1,
        )
        const stretchLimit = 1 + TETHER_STRETCH_LIMIT
        for (let index = 0; index < team.particles.length; index += 1) {
            if (team.rootIndices.includes(index)) continue
            const particle = team.particles[index]!
            const root = team.particles[particle.rootIndex]!
            const restDistance = particle.animationPosition.distanceTo(root.animationPosition)
            const delta = root.position.clone().sub(particle.position)
            const distance = delta.length()
            if (restDistance <= EPSILON || distance <= EPSILON) continue
            const ratio = distance / restDistance
            let correctionDistance = 0
            let stiffness = 0
            if (ratio < compressionLimit) {
                correctionDistance = distance - compressionLimit * restDistance
                stiffness = clamp(
                    (compressionLimit - ratio) / TETHER_STIFFNESS_WIDTH,
                    0,
                    1,
                )
            } else if (ratio > stretchLimit) {
                correctionDistance = distance - stretchLimit * restDistance
                stiffness = clamp(
                    (ratio - stretchLimit) / TETHER_STIFFNESS_WIDTH,
                    0,
                    1,
                )
            } else {
                continue
            }
            const movement = delta.multiplyScalar(correctionDistance * stiffness / distance)
            particle.position.add(movement)
            particle.previousPosition.addScaledVector(
                movement,
                TETHER_VELOCITY_ATTENUATION,
            )
        }
    }

    private solveDistances(team: TeamRuntime, spring: boolean): void {
        const cloth = team.cloth.serializeData
        for (let index = 0; index < team.particles.length; index += 1) {
            const particle = team.particles[index]!
            if (particle.parentIndex < 0) continue
            const parent = team.particles[particle.parentIndex]!
            const targetDistance = particle.animationPosition.distanceTo(parent.animationPosition)
            const curveStiffness = evaluateMagicaCurve(
                cloth.distanceConstraint.stiffness,
                particle.normalizedDepth,
            )
            const stiffness = clamp(curveStiffness, 0, 1)
            movePairToDistance(
                parent,
                particle,
                targetDistance,
                stiffness,
                !spring && team.rootIndices.includes(particle.parentIndex),
                false,
                DISTANCE_VELOCITY_ATTENUATION,
            )
        }
    }

    private solveConnections(team: TeamRuntime): void {
        const baseStiffness = clamp(team.cloth.serializeData.triangleBendingConstraint.stiffness, 0, 1)
        for (const connection of team.connections) {
            const first = team.particles[connection.firstIndex]!
            const second = team.particles[connection.secondIndex]!
            const target = first.animationPosition.distanceTo(second.animationPosition)
            movePairToDistance(
                first,
                second,
                target,
                baseStiffness * connection.stiffnessScale,
                team.rootIndices.includes(connection.firstIndex),
                team.rootIndices.includes(connection.secondIndex),
            )
        }
    }

    private solveAngles(team: TeamRuntime, spring: boolean): void {
        const cloth = team.cloth.serializeData
        const orderedIndices = team.particles
            .map((particle, index) => ({ depth: particle.depth, index }))
            .sort((first, second) => first.depth - second.depth || first.index - second.index)
            .map(value => value.index)

        // MagicaCloth 2.9.1 buffers each complete baseline before its three
        // internal angle iterations. Angle-limit targets are propagated from
        // the corrected parent rotation; independent world-space targets make
        // adjacent links fight each other and visibly alternate at 90 Hz.
        for (const index of orderedIndices) {
            const particle = team.particles[index]!
            particle.angleRotationBuffer.copy(particle.animationWorldQuaternion)
            if (particle.parentIndex < 0) continue
            const parent = team.particles[particle.parentIndex]!
            particle.angleBufferedLength = particle.position.distanceTo(parent.position)
            particle.angleRestorationVector.copy(particle.animationPosition)
                .sub(parent.animationPosition)
            const inverseParentRotation = parent.animationWorldQuaternion.clone().invert()
            particle.angleLocalDirection.copy(particle.angleRestorationVector)
                .normalize()
                .applyQuaternion(inverseParentRotation)
            particle.angleLocalQuaternion.copy(inverseParentRotation)
                .multiply(particle.animationWorldQuaternion)
                .normalize()
        }

        for (let iteration = 0; iteration < ANGLE_LIMIT_ITERATIONS; iteration += 1) {
            const iterationRatio = iteration / Math.max(1, ANGLE_LIMIT_ITERATIONS - 1)
            const limitRotationCenter = 0.4
            const restorationRotationCenter = THREE.MathUtils.lerp(
                0.1,
                0.5,
                iterationRatio,
            )
            for (const index of orderedIndices) {
                const particle = team.particles[index]!
                if (particle.parentIndex < 0) continue
                const parent = team.particles[particle.parentIndex]!
                const parentPinned = !spring && team.rootIndices.includes(particle.parentIndex)

                // Coincident authored transforms have no segment direction to limit.
                // Preserve their relative orientation when propagating the baseline;
                // inventing an axis here rotates every downstream cloth segment.
                if (particle.angleRestorationVector.lengthSq() <= EPSILON) {
                    particle.angleRotationBuffer.copy(parent.angleRotationBuffer)
                        .multiply(particle.angleLocalQuaternion)
                        .normalize()
                    continue
                }

                if (!spring && cloth.angleLimitConstraint.useAngleLimit) {
                    const currentVector = particle.position.clone().sub(parent.position)
                    const distance = currentVector.length()
                    if (distance > EPSILON) {
                        const targetDirection = particle.angleLocalDirection.clone()
                            .applyQuaternion(parent.angleRotationBuffer)
                            .normalize()
                        const bufferedDistance = THREE.MathUtils.lerp(
                            distance,
                            particle.angleBufferedLength,
                            0.5,
                        )
                        const constrainedVector = currentVector.clone()
                            .normalize()
                            .multiplyScalar(bufferedDistance)
                        const direction = constrainedVector.clone().normalize()
                        const angle = targetDirection.angleTo(direction)
                        const limit = THREE.MathUtils.degToRad(Math.max(0, evaluateMagicaCurve(
                            cloth.angleLimitConstraint.limitAngle,
                            particle.normalizedDepth,
                        )))
                        let recoveredVector = constrainedVector.clone()
                        if (angle > limit && angle > EPSILON) {
                            const limitStiffness = clamp(
                                cloth.angleLimitConstraint.stiffness,
                                0,
                                1,
                            )
                            const recoveryAngle = THREE.MathUtils.lerp(
                                angle,
                                limit,
                                limitStiffness,
                            )
                            const towardTarget = new THREE.Quaternion().setFromUnitVectors(
                                direction,
                                targetDirection,
                            )
                            const recoveredDirection = direction.clone().applyQuaternion(
                                IDENTITY_QUATERNION.clone().slerp(
                                    towardTarget,
                                    (angle - recoveryAngle) / angle,
                                ),
                            ).normalize()
                            recoveredVector = recoveredDirection.multiplyScalar(bufferedDistance)
                            this.diagnosticsState.angleClamps += 1
                        }
                        const rotationCenter = parent.position.clone().addScaledVector(
                            constrainedVector,
                            limitRotationCenter,
                        )
                        const parentMovement = rotationCenter.clone().addScaledVector(
                            recoveredVector,
                            -limitRotationCenter,
                        ).sub(parent.position)
                        const childMovement = rotationCenter.clone().addScaledVector(
                            recoveredVector,
                            1 - limitRotationCenter,
                        ).sub(particle.position)
                        if (!parentPinned) {
                            parent.position.add(parentMovement)
                            parent.previousPosition.addScaledVector(
                                parentMovement,
                                ANGLE_LIMIT_VELOCITY_ATTENUATION,
                            )
                        }
                        particle.position.add(childMovement)
                        particle.previousPosition.addScaledVector(
                            childMovement,
                            ANGLE_LIMIT_VELOCITY_ATTENUATION,
                        )

                        const correctedVector = particle.position.clone().sub(parent.position)
                        if (correctedVector.lengthSq() > EPSILON) {
                            const baseWorldRotation = parent.angleRotationBuffer.clone()
                                .multiply(particle.angleLocalQuaternion)
                            const propagatedRotation = new THREE.Quaternion().setFromUnitVectors(
                                targetDirection,
                                correctedVector.clone().normalize(),
                            )
                            particle.angleRotationBuffer.copy(propagatedRotation)
                                .multiply(baseWorldRotation)
                                .normalize()
                        }
                    }
                }

                if (cloth.angleRestorationConstraint.useAngleRestoration) {
                    const currentVector = particle.position.clone().sub(parent.position)
                    const distance = currentVector.length()
                    if (distance <= EPSILON) continue
                    const direction = currentVector.clone().multiplyScalar(1 / distance)
                    if (particle.angleRestorationVector.lengthSq() <= EPSILON) continue
                    const targetDirection = particle.angleRestorationVector.clone().normalize()
                    const stiffness = clamp(
                        evaluateMagicaCurve(
                            cloth.angleRestorationConstraint.stiffness,
                            particle.normalizedDepth,
                        ),
                        0,
                        1,
                    )
                    if (stiffness <= 0) continue
                    const towardTarget = new THREE.Quaternion().setFromUnitVectors(
                        direction,
                        targetDirection,
                    )
                    const restoredVector = direction.clone().applyQuaternion(
                        IDENTITY_QUATERNION.clone().slerp(towardTarget, stiffness),
                    ).normalize().multiplyScalar(distance)
                    const rotationCenter = parent.position.clone().addScaledVector(
                        currentVector,
                        restorationRotationCenter,
                    )
                    const parentTarget = rotationCenter.clone().addScaledVector(
                        restoredVector,
                        -restorationRotationCenter,
                    )
                    const childTarget = rotationCenter.clone().addScaledVector(
                        restoredVector,
                        1 - restorationRotationCenter,
                    )
                    const parentMovement = parentTarget.sub(parent.position)
                    const childMovement = childTarget.sub(particle.position)
                    const attenuation = clamp(
                        cloth.angleRestorationConstraint.velocityAttenuation,
                        0,
                        1,
                    )
                    if (!parentPinned) {
                        parent.position.add(parentMovement)
                        parent.previousPosition.addScaledVector(parentMovement, attenuation)
                    }
                    particle.position.add(childMovement)
                    particle.previousPosition.addScaledVector(childMovement, attenuation)
                }
            }
        }
    }

    private solveMotionConstraints(team: TeamRuntime, spring: boolean): void {
        const cloth = team.cloth.serializeData
        const motion = cloth.motionConstraint
        if (spring || (!motion.useMaxDistance && !motion.useBackstop)) return
        // Magica 2.9.1 MotionConstraintJob: animation base pose and authored
        // normal axis, not the parent-child chain direction. Reflect local X
        // consistently with the imported Unity/FBX rotation convention.
        const localNormal = new THREE.Vector3(0, 1, 0)
        switch (cloth.normalAxis) {
            case 0: localNormal.set(-1, 0, 0); break
            case 2: localNormal.set(0, 0, 1); break
            case 3: localNormal.set(1, 0, 0); break
            case 4: localNormal.set(0, -1, 0); break
            case 5: localNormal.set(0, 0, -1); break
        }

        for (let index = 0; index < team.particles.length; index++) {
            if (team.rootIndices.includes(index)) continue
            const particle = team.particles[index]!
            const before = particle.position.clone()
            const depth = particle.normalizedDepth * particle.normalizedDepth
            if (motion.useMaxDistance) {
                const maximum = Math.max(0, evaluateMagicaCurve(motion.maxDistance, depth))
                const offset = particle.position.clone().sub(particle.animationPosition)
                if (offset.lengthSq() > maximum * maximum) {
                    particle.position.copy(particle.animationPosition).add(offset.setLength(maximum))
                }
            }
            const radius = Math.max(0, motion.backstopRadius)
            if (motion.useBackstop && radius > 0) {
                const normal = localNormal.clone().applyQuaternion(particle.animationWorldQuaternion)
                const distance = evaluateMagicaCurve(motion.backstopDistance, depth)
                // Radius belongs in the center offset as well as the sphere
                // projection. Omitting it pushes even the rest pose outward.
                const center = particle.animationPosition.clone()
                    .addScaledVector(normal, -(distance + radius))
                const offset = particle.position.clone().sub(center)
                const length = offset.length()
                if (length > EPSILON && length < radius) {
                    particle.position.copy(center).addScaledVector(offset, radius / length)
                }
            }
            particle.position.lerpVectors(before, particle.position, clamp(motion.stiffness, 0, 1))
            particle.previousPosition.addScaledVector(particle.position.clone().sub(before), 0.95)
        }
    }

    private solveBoneSpringRoot(
        team: TeamRuntime,
        particle: ParticleRuntime,
        step: number,
    ): void {
        const spring = team.cloth.serializeData.springConstraint
        const restoring = clamp(spring.springPower * 60 * step, 0, 1)
        particle.position.lerp(particle.animationPosition, restoring)
        if (spring.springNoise !== 0) {
            const phase = team.elapsed * 11.37 + hashUnit(particle.stableKey) * Math.PI * 2
            const noise = new THREE.Vector3(
                Math.sin(phase),
                Math.sin(phase * 1.37 + 1.7),
                Math.sin(phase * 0.73 + 3.1),
            ).multiplyScalar(spring.springNoise * spring.springPower * step * 0.03)
            particle.position.add(noise)
        }
        const offset = particle.position.clone().sub(particle.animationPosition)
        const normal = particle.animationPosition.clone()
            .sub(team.currentAnchorPosition)
        if (normal.lengthSq() <= EPSILON) normal.set(0, 0, 1)
        else normal.normalize()
        const normalDistance = offset.dot(normal)
        const normalPart = normal.clone().multiplyScalar(normalDistance)
        const tangentPart = offset.clone().sub(normalPart)
        const tangentialLimit = Math.max(0, spring.limitDistance)
        const normalLimit = tangentialLimit * clamp(spring.normalLimitRatio, 0, 1)
        if (tangentPart.length() > tangentialLimit) tangentPart.setLength(tangentialLimit)
        normalPart.copy(normal).multiplyScalar(clamp(normalDistance, -normalLimit, normalLimit))
        particle.position.copy(particle.animationPosition).add(tangentPart).add(normalPart)
    }

    private solveColliders(team: TeamRuntime, spring: boolean): void {
        const mode = team.cloth.serializeData.colliderCollisionConstraint.mode
        if (mode === 0) return
        const friction = clamp(
            team.cloth.serializeData.colliderCollisionConstraint.friction,
            0,
            1,
        )
        if (mode === 1) {
            for (let index = 0; index < team.particles.length; index += 1) {
                const particle = team.particles[index]!
                // BoneCloth roots are fixed transforms in the official job.
                if (!spring && team.rootIndices.includes(index)) continue
                for (const collider of team.colliders) {
                    const geometry = this.colliderGeometryByStableKey.get(collider.stableKey)
                    if (!geometry) continue
                    if (this.projectParticleOutsideGeometry(particle, geometry)) {
                        this.diagnosticsState.colliderContacts += 1
                        particle.previousPosition.lerp(particle.position, friction)
                    }
                }
            }
            return
        }

        // Magica's Edge mode is a separate endpoint job. It does not run the
        // point job first and it never substitutes a midpoint sphere. Every
        // contacted edge contributes weighted endpoint corrections, which are
        // averaged only after all edges have completed.
        for (let index = 0; index < team.particles.length; index += 1) {
            team.colliderCorrectionSums[index]!.set(0, 0, 0)
            team.colliderCorrectionCounts[index] = 0
        }
        for (let secondIndex = 0; secondIndex < team.particles.length; secondIndex += 1) {
            const second = team.particles[secondIndex]!
            if (second.parentIndex < 0) continue
            const firstIndex = second.parentIndex
            const first = team.particles[firstIndex]!
            const firstPinned = !spring && team.rootIndices.includes(firstIndex)
            const secondPinned = !spring && team.rootIndices.includes(secondIndex)
            if (firstPinned && secondPinned) continue
            const contactDistance = (first.radius + second.radius) * 0.5
            const edgeMinimum = new THREE.Vector3(
                Math.min(first.position.x - first.radius, second.position.x - second.radius)
                    - contactDistance,
                Math.min(first.position.y - first.radius, second.position.y - second.radius)
                    - contactDistance,
                Math.min(first.position.z - first.radius, second.position.z - second.radius)
                    - contactDistance,
            )
            const edgeMaximum = new THREE.Vector3(
                Math.max(first.position.x + first.radius, second.position.x + second.radius)
                    + contactDistance,
                Math.max(first.position.y + first.radius, second.position.y + second.radius)
                    + contactDistance,
                Math.max(first.position.z + first.radius, second.position.z + second.radius)
                    + contactDistance,
            )
            const firstCorrection = new THREE.Vector3()
            const secondCorrection = new THREE.Vector3()
            const normalSum = new THREE.Vector3()
            let contactCount = 0
            for (const collider of team.colliders) {
                const geometry = this.colliderGeometryByStableKey.get(collider.stableKey)
                if (!geometry) continue
                const projection = this.projectEdgeOutsideGeometry(
                    first,
                    second,
                    geometry,
                    edgeMinimum,
                    edgeMaximum,
                    contactDistance,
                )
                if (!projection) continue
                firstCorrection.add(projection.firstCorrection)
                secondCorrection.add(projection.secondCorrection)
                normalSum.add(projection.normal)
                contactCount += 1
                this.diagnosticsState.colliderContacts += 1
            }
            if (contactCount === 0) continue
            const normalCoherence = Math.min(
                normalSum.multiplyScalar(1 / contactCount).length(),
                1,
            )
            firstCorrection.multiplyScalar(normalCoherence / contactCount)
            secondCorrection.multiplyScalar(normalCoherence / contactCount)
            if (!firstPinned) {
                team.colliderCorrectionSums[firstIndex]!.add(firstCorrection)
                team.colliderCorrectionCounts[firstIndex]! += 1
            }
            if (!secondPinned) {
                team.colliderCorrectionSums[secondIndex]!.add(secondCorrection)
                team.colliderCorrectionCounts[secondIndex]! += 1
            }
        }
        for (let index = 0; index < team.particles.length; index += 1) {
            const count = team.colliderCorrectionCounts[index]!
            if (count === 0) continue
            const particle = team.particles[index]!
            particle.position.addScaledVector(team.colliderCorrectionSums[index]!, 1 / count)
            particle.previousPosition.lerp(particle.position, friction)
        }
    }

    private projectParticleOutsideGeometry(
        particle: ParticleRuntime,
        geometry: ColliderGeometry,
    ): boolean {
        if (geometry.kind === 'sphere') {
            return this.projectOutsideSphere(
                particle.position,
                geometry.center,
                geometry.radius + particle.radius,
            )
        }
        if (geometry.kind === 'plane') {
            const distance = particle.position.clone().sub(geometry.center).dot(geometry.normal)
            if (distance >= particle.radius) return false
            particle.position.addScaledVector(geometry.normal, particle.radius - distance)
            return true
        }
        return this.projectOutsideTaperedCapsule(
            particle.position,
            geometry.start,
            geometry.end,
            geometry.startRadius + particle.radius,
            geometry.endRadius + particle.radius,
        )
    }

    private projectEdgeOutsideGeometry(
        first: ParticleRuntime,
        second: ParticleRuntime,
        geometry: ColliderGeometry,
        edgeMinimum: THREE.Vector3,
        edgeMaximum: THREE.Vector3,
        contactDistance: number,
    ): EdgeProjection | null {
        if (geometry.kind !== 'plane' && !aabbOverlaps(edgeMinimum, edgeMaximum, geometry.aabb)) {
            return null
        }
        if (geometry.kind === 'plane') {
            const firstDistance = first.position.clone().sub(geometry.center).dot(geometry.normal)
            const secondDistance = second.position.clone().sub(geometry.center).dot(geometry.normal)
            const firstPenetration = Math.max(0, first.radius - firstDistance)
            const secondPenetration = Math.max(0, second.radius - secondDistance)
            if (firstPenetration <= 0 && secondPenetration <= 0) return null
            return {
                firstCorrection: geometry.normal.clone().multiplyScalar(firstPenetration),
                secondCorrection: geometry.normal.clone().multiplyScalar(secondPenetration),
                normal: geometry.normal.clone(),
            }
        }
        if (geometry.kind === 'sphere') {
            const firstRatio = closestPointSegmentRatio(
                geometry.previousCenter,
                first.position,
                second.position,
            )
            const edgePoint = first.position.clone().lerp(second.position, firstRatio)
            const offset = edgePoint.clone().sub(geometry.previousCenter)
            const distance = offset.length()
            if (distance <= EPSILON) return null
            const normal = offset.multiplyScalar(1 / distance)
            const colliderDelta = geometry.center.clone().sub(geometry.previousCenter)
            const sweptDistance = distance - normal.dot(colliderDelta)
            const edgeRadius = THREE.MathUtils.lerp(first.radius, second.radius, firstRatio)
            const thickness = edgeRadius + geometry.radius
            if (sweptDistance > thickness + contactDistance) return null
            const currentDistance = normal.dot(edgePoint.clone().sub(geometry.center))
            if (currentDistance > thickness) return null
            return this.weightedEdgeCorrection(
                normal,
                thickness - currentDistance,
                firstRatio,
            )
        }

        let ratios = closestSegmentRatios(
            first.position,
            second.position,
            geometry.previousStart,
            geometry.previousEnd,
        )
        let edgePoint = first.position.clone().lerp(second.position, ratios.first)
        let colliderPoint = geometry.previousStart.clone().lerp(
            geometry.previousEnd,
            ratios.second,
        )
        let offset = edgePoint.clone().sub(colliderPoint)
        let distance = offset.length()
        if (distance <= EPSILON) return null
        let normal = offset.multiplyScalar(1 / distance)
        // Magica 2.9.1's tapered-capsule extension shifts the old centerline by
        // each endpoint radius, then recomputes both closest ratios. The source
        // explicitly identifies the omitted step as a cause of large vibration.
        if (Math.abs(geometry.startRadius - geometry.endRadius) > EPSILON) {
            const shiftedStart = geometry.previousStart.clone().addScaledVector(
                normal,
                geometry.startRadius,
            )
            const shiftedEnd = geometry.previousEnd.clone().addScaledVector(
                normal,
                geometry.endRadius,
            )
            ratios = closestSegmentRatios(
                first.position,
                second.position,
                shiftedStart,
                shiftedEnd,
            )
            edgePoint = first.position.clone().lerp(second.position, ratios.first)
            colliderPoint = geometry.previousStart.clone().lerp(
                geometry.previousEnd,
                ratios.second,
            )
            offset = edgePoint.clone().sub(colliderPoint)
            distance = offset.length()
            if (distance <= EPSILON) return null
            normal = offset.multiplyScalar(1 / distance)
        }
        const colliderDelta = geometry.start.clone().sub(geometry.previousStart).lerp(
            geometry.end.clone().sub(geometry.previousEnd),
            ratios.second,
        )
        const sweptDistance = distance - normal.dot(colliderDelta)
        const edgeRadius = THREE.MathUtils.lerp(first.radius, second.radius, ratios.first)
        const colliderRadius = THREE.MathUtils.lerp(
            geometry.startRadius,
            geometry.endRadius,
            ratios.second,
        )
        const thickness = edgeRadius + colliderRadius
        if (sweptDistance > thickness + contactDistance) return null
        const currentColliderPoint = geometry.start.clone().lerp(geometry.end, ratios.second)
        const currentDistance = normal.dot(edgePoint.clone().sub(currentColliderPoint))
        if (currentDistance > thickness) return null
        return this.weightedEdgeCorrection(
            normal,
            thickness - currentDistance,
            ratios.first,
        )
    }

    private weightedEdgeCorrection(
        normal: THREE.Vector3,
        penetration: number,
        ratio: number,
    ): EdgeProjection | null {
        if (penetration <= 0) return null
        const firstWeight = 1 - ratio
        const secondWeight = ratio
        const denominator = firstWeight * firstWeight + secondWeight * secondWeight
        if (denominator <= EPSILON) return null
        const scale = penetration / denominator
        return {
            firstCorrection: normal.clone().multiplyScalar(firstWeight * scale),
            secondCorrection: normal.clone().multiplyScalar(secondWeight * scale),
            normal: normal.clone(),
        }
    }

    private projectOutsideSphere(
        point: THREE.Vector3,
        center: THREE.Vector3,
        radius: number,
    ): boolean {
        const offset = point.clone().sub(center)
        if (offset.lengthSq() >= radius * radius || radius <= 0) return false
        if (offset.lengthSq() <= EPSILON) offset.set(0, 1, 0)
        point.copy(center).add(offset.setLength(radius))
        return true
    }

    private projectOutsideTaperedCapsule(
        point: THREE.Vector3,
        start: THREE.Vector3,
        end: THREE.Vector3,
        startRadius: number,
        endRadius: number,
    ): boolean {
        const axis = end.clone().sub(start)
        const lengthSquared = axis.lengthSq()
        const ratio = lengthSquared > EPSILON
            ? clamp(point.clone().sub(start).dot(axis) / lengthSquared, 0, 1)
            : 0
        const center = start.clone().addScaledVector(axis, ratio)
        const radius = THREE.MathUtils.lerp(startRadius, endRadius, ratio)
        return this.projectOutsideSphere(point, center, radius)
    }

    private solveSelfCollision(team: TeamRuntime): void {
        const surface = team.cloth.serializeData.selfCollisionConstraint.surfaceThickness
        for (let firstIndex = 0; firstIndex < team.particles.length; firstIndex += 1) {
            const first = team.particles[firstIndex]!
            for (let secondIndex = firstIndex + 1; secondIndex < team.particles.length; secondIndex += 1) {
                const second = team.particles[secondIndex]!
                if (first.parentIndex === secondIndex || second.parentIndex === firstIndex) continue
                const minimum = first.radius + second.radius
                    + evaluateMagicaCurve(surface, (first.normalizedDepth + second.normalizedDepth) * 0.5)
                const delta = second.position.clone().sub(first.position)
                const distance = delta.length()
                if (distance >= minimum) continue
                if (distance <= EPSILON) delta.set(1, 0, 0)
                else delta.divideScalar(distance)
                const correction = minimum - distance
                const firstPinned = team.rootIndices.includes(firstIndex)
                const secondPinned = team.rootIndices.includes(secondIndex)
                if (!firstPinned) first.position.addScaledVector(delta, -correction * (secondPinned ? 1 : 0.5))
                if (!secondPinned) second.position.addScaledVector(delta, correction * (firstPinned ? 1 : 0.5))
                this.diagnosticsState.selfContacts += 1
            }
        }
    }

    private sampleWind(team: TeamRuntime, particle: ParticleRuntime): THREE.Vector3 {
        const clothWind = team.cloth.serializeData.wind
        if (clothWind.influence === 0) return new THREE.Vector3()
        const result = this.windZones.sample(particle.position, team.elapsed).vector
        if (result.lengthSq() <= EPSILON) return result
        const synchronizedPhase = hashUnit(team.cloth.stableKey)
            * clothWind.synchronization * Math.PI * 2
        const depthPhase = particle.normalizedDepth * (1 - clothWind.synchronization) * Math.PI * 2
        const phase = team.elapsed * Math.max(0, clothWind.frequency) * Math.PI * 2
            + synchronizedPhase + depthPhase
        const fluctuation = 1 + Math.sin(phase)
            * clamp(clothWind.turbulence, 0, 2) * 0.25
        result.multiplyScalar(clothWind.influence * fluctuation)
        if (clothWind.movingWind !== 0) {
            result.addScaledVector(
                team.movingWindVelocity,
                clothWind.movingWind,
            )
        }
        return result
    }

    private applySolvedPose(): void {
        // Magica's BoneCloth output is a two-stage proxy operation. First it
        // reconstructs world rotations root-to-child from the solved baseline;
        // only after every world pose is fixed does it convert moving transforms
        // back to parent-local space. Writing each local quaternion immediately
        // makes the next child observe a partly-written hierarchy and produces
        // the visible 90/60 Hz hair and skirt sign flip.
        for (const team of this.teams) {
            if (team.failClosedReason) continue
            const stabilizationDuration = Math.max(
                0,
                team.cloth.serializeData.stablizationTimeAfterReset,
            )
            const linearStabilizationWeight = stabilizationDuration > EPSILON
                ? 1 - clamp(team.stabilizationRemaining / stabilizationDuration, 0, 1)
                : 1
            const stabilizationWeight = linearStabilizationWeight
                * linearStabilizationWeight
                * (3 - 2 * linearStabilizationWeight)
            // Unity/Magica's reset stabilization is an output blend, not only
            // a positional solver hint.  Applying it to the written pose keeps
            // the first simulated frames from snapping a freshly loaded rig.
            const outputWeight = this.blendWeight * stabilizationWeight
            const spring = team.cloth.serializeData.clothType === 10
                && team.cloth.serializeData.springConstraint.useSpring !== 0
            const animationPoseRatio = clamp(
                team.cloth.serializeData.animationPoseRatio,
                0,
                1,
            )
            const positionResidualInterpolation = 1 - Math.exp(
                -Math.max(team.lastFrameDelta, 0) / (this.fixedStepSeconds * 4),
            )
            for (let index = 0; index < team.particles.length; index += 1) {
                const particle = team.particles[index]!
                if (this.manualPinnedPose(particle.bone)) {
                    const world = this.manualProxyWorld(particle.bone)
                    world.decompose(team.outputWorldPositions[index]!, team.outputWorldQuaternions[index]!, new THREE.Vector3())
                    particle.hasPositionResidualHistory = false; particle.hasResidualHistory = false
                    continue
                }
                const moving = spring || !team.rootIndices.includes(index)
                team.outputWorldPositions[index]!.copy(
                    particle.frameCurrentAnimationPosition,
                )
                if (moving) {
                    team.outputWorldPositions[index]!.lerp(
                        particle.displayPosition,
                        outputWeight,
                    )
                }
                // CalcDisplayPosition feeds Magica's proxy-rotation pass.  Keep
                // the browser-only fixed-time residual filter on that world
                // position buffer as well, so reconstructed rotations observe
                // exactly the same smooth display positions that are written.
                const targetWorldPositionResidual = team.outputWorldPositions[index]!
                    .clone()
                    .sub(particle.frameCurrentAnimationPosition)
                const outputWorldPositionResidual = particle.hasPositionResidualHistory
                    ? particle.lastWrittenResidualWorldPosition.clone().lerp(
                        targetWorldPositionResidual,
                        positionResidualInterpolation,
                    )
                    : targetWorldPositionResidual.clone()
                team.outputWorldPositions[index]!
                    .copy(particle.frameCurrentAnimationPosition)
                    .add(outputWorldPositionResidual)
                particle.lastWrittenResidualWorldPosition.copy(outputWorldPositionResidual)
                particle.hasPositionResidualHistory = true
                team.outputWorldQuaternions[index]!.copy(
                    particle.frameCurrentAnimationWorldQuaternion,
                )
            }

            // This is the transform-rig equivalent of MagicaCloth's official
            // SimulationPostProxyMeshUpdateLine baseline pass.
            for (const index of team.outputOrder) {
                const particle = team.particles[index]!
                if (this.manualPinnedPose(particle.bone)) continue
                const position = team.outputWorldPositions[index]!
                const basePosition = particle.frameCurrentAnimationPosition
                const baseRotation = particle.frameCurrentAnimationWorldQuaternion
                const baseInverseRotation = baseRotation.clone().invert()
                const rotation = team.outputWorldQuaternions[index]!
                if (particle.childIndices.length > 0) {
                    const expectedChildVector = new THREE.Vector3()
                    const solvedChildVector = new THREE.Vector3()
                    for (const childIndex of particle.childIndices) {
                        const child = team.particles[childIndex]!
                        const childBaseLocalPosition = child.frameCurrentAnimationPosition
                            .clone()
                            .sub(basePosition)
                            .applyQuaternion(baseInverseRotation)
                        const childBaseLocalRotation = baseInverseRotation.clone()
                            .multiply(child.frameCurrentAnimationWorldQuaternion)
                            .normalize()
                        const localPosition = child.initialProxyLocalPosition.clone()
                            .lerp(childBaseLocalPosition, animationPoseRatio)
                        const localRotation = child.initialProxyLocalQuaternion.clone()
                            .slerp(childBaseLocalRotation, animationPoseRatio)
                            .normalize()
                        const expected = localPosition.clone().applyQuaternion(rotation)
                        expectedChildVector.add(expected)
                        const childMoving = spring || !team.rootIndices.includes(childIndex)
                        if (!childMoving) {
                            solvedChildVector.add(expected)
                            continue
                        }
                        const solved = team.outputWorldPositions[childIndex]!
                            .clone()
                            .sub(position)
                        solvedChildVector.add(solved)
                        const childRotation = rotation.clone()
                            .multiply(localRotation)
                            .normalize()
                        if (expected.lengthSq() > EPSILON && solved.lengthSq() > EPSILON) {
                            const correction = new THREE.Quaternion().setFromUnitVectors(
                                expected.normalize(),
                                solved.normalize(),
                            )
                            childRotation.premultiply(correction).normalize()
                        }
                        if (!this.manualPinnedPose(child.bone)) team.outputWorldQuaternions[childIndex]!.copy(childRotation)
                    }
                    if (
                        expectedChildVector.lengthSq() > EPSILON
                        && solvedChildVector.lengthSq() > EPSILON
                    ) {
                        const interpolation = (!spring && team.rootIndices.includes(index))
                            ? team.cloth.serializeData.rootRotation
                            : team.cloth.serializeData.rotationalInterpolation
                        const fullCorrection = new THREE.Quaternion().setFromUnitVectors(
                            expectedChildVector.normalize(),
                            solvedChildVector.normalize(),
                        )
                        const correction = IDENTITY_QUATERNION.clone().slerp(
                            fullCorrection,
                            clamp(interpolation, 0, 1),
                        )
                        rotation.premultiply(correction).normalize()
                    }
                }
                const solvedRotation = rotation.clone()
                rotation.slerpQuaternions(baseRotation, solvedRotation, outputWeight)
                    .normalize()
            }
        }

        // Match Magica's world-transform pass followed by its local-transform
        // pass. The precomputed order avoids rebuilding and sorting the complete
        // cloth graph every render frame.
        const outputParentInverse = new THREE.Matrix4()
        const outputParentPosition = new THREE.Vector3()
        const outputParentScale = new THREE.Vector3()
        for (const { team, particle, index } of this.outputEntries) {
            if (team.failClosedReason) continue
            const spring = team.cloth.serializeData.clothType === 10
                && team.cloth.serializeData.springConstraint.useSpring !== 0
            const springRoot = spring && team.rootIndices.includes(index)
            // FBXLoader represents some terminal `_End` Transforms as Groups
            // rather than Bones.  They are exact particle endpoints used to
            // orient their parent, but are never post-animation writers.
            if (!springRoot && particle.childIndices.length === 0) continue
            if (this.outputOwnerByBone.get(particle.bone) !== team) continue
            const manual = this.manualOutputByBone.get(particle.bone)
            if (manual?.state === 'held') continue
            if (manual?.state === 'returning' && !manual.fresh) {
                const displayed = manual.displayed.get(particle.bone)!
                particle.bone.position.fromArray(displayed.position)
                particle.bone.quaternion.fromArray(displayed.quaternion)
                particle.hasLastWrite = false
                particle.bone.updateWorldMatrix(false, false)
                continue
            }
            const moving = spring || !team.rootIndices.includes(index)
            const parent = particle.bone.parent
            const targetWorldPosition = moving
                ? team.outputWorldPositions[index]!
                : particle.frameCurrentAnimationPosition
            if (parent) parent.updateWorldMatrix(true, false)
            const outputLocalPosition = targetWorldPosition.clone()
            const parentWorld = new THREE.Quaternion()
            if (parent) {
                // worldToLocal and getWorldQuaternion each refresh every
                // ancestor again. The parent matrix was just refreshed above;
                // read that same matrix without two more hierarchy traversals.
                outputLocalPosition.applyMatrix4(outputParentInverse.copy(parent.matrixWorld).invert())
                parent.matrixWorld.decompose(outputParentPosition, parentWorld, outputParentScale)
            }
            const targetLocalQuaternion = parentWorld.invert()
                .multiply(team.outputWorldQuaternions[index]!)
                .normalize()
            // rotationSpeedLimit is consumed by the moving-center inertia step
            // in transportTeam. Magica does not apply a second frame-rate
            // dependent clamp to the rendered bone residual: doing so saturated
            // an authored lace team at exactly 720deg/s on alternating frames.
            const targetResidual = particle.animationLocalQuaternion.clone()
                .invert()
                .multiply(targetLocalQuaternion)
                .normalize()
            // Magica writes its virtual-mesh result through a separate job
            // stream.  The browser runtime has one post-animation write per
            // render frame, so a 90 Hz solver sampled at 60 Hz otherwise
            // alternates between one-step and two-step residuals.  Use a fixed
            // simulation-time response (four solver ticks), rather than an FPS
            // constant or a character-specific clamp, to preserve sustained
            // authored motion while removing only the cadence flip.
            const residualInterpolation = 1 - Math.exp(
                -Math.max(team.lastFrameDelta, 0) / (this.fixedStepSeconds * 4),
            )
            const outputResidual = particle.hasResidualHistory
                ? particle.lastWrittenResidualQuaternion.clone().slerp(
                    targetResidual,
                    residualInterpolation,
                )
                : targetResidual.clone()
            const outputLocalQuaternion = particle.animationLocalQuaternion.clone().multiply(outputResidual).normalize()
            if (manual?.state === 'returning') {
                const ratio = manual.duration > 0 ? Math.min(1, manual.elapsed / manual.duration) : 1
                const alpha = ratio * ratio * (3 - 2 * ratio), from = manual.from.get(particle.bone)!
                if (alpha === 0) {
                    outputLocalPosition.fromArray(from.position); outputLocalQuaternion.fromArray(from.quaternion)
                } else if (alpha < 1) {
                    outputLocalPosition.lerpVectors(new THREE.Vector3(...from.position), outputLocalPosition, alpha)
                    outputLocalQuaternion.slerpQuaternions(new THREE.Quaternion(...from.quaternion), outputLocalQuaternion.clone(), alpha).normalize()
                }
            }
            particle.bone.position.copy(outputLocalPosition)
            particle.bone.quaternion.copy(outputLocalQuaternion)
            if (manual) manual.displayed.set(particle.bone, this.readManualPose(particle.bone))
            particle.lastWrittenResidualQuaternion.copy(outputResidual)
            particle.hasResidualHistory = true
            // Later outputs explicitly refresh their parent chain. Descendant
            // subtrees need not be recursively recomposed after every bone;
            // the final root traversal publishes every terminal/helper matrix.
            particle.bone.updateWorldMatrix(false, false)
            particle.lastWrittenLocalPosition.copy(particle.bone.position)
            particle.lastWrittenLocalQuaternion.copy(particle.bone.quaternion)
            particle.hasLastWrite = true
        }
        this.root.updateMatrixWorld(true)
    }
}

/**
 * Creates the sole post-AnimationMixer writer for a loaded character root.
 * The runtime only mutates exact chain bones published by the profile.  Body,
 * arm, locomotion and timeline ancestors remain read-only animation inputs.
 */
export function createNativeCharacterPhysics(
    root: THREE.Object3D,
    profile: CharacterPhysicsProfile,
    options: NativeCharacterPhysicsOptions = {},
): NativeCharacterPhysicsRuntime {
    return new NativeCharacterPhysics(root, profile, options)
}
