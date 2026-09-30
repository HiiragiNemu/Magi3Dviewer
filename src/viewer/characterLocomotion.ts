import { Quaternion, Vector3 } from 'three'

/**
 * Generic viewer tuning, not values recovered from the game runtime.
 * Integrators should replace these values with measured character/scene data.
 */
export const DEFAULT_CHARACTER_LOCOMOTION_CONFIG = Object.freeze({
    fixedStepSeconds: 1 / 60,
    maxSubSteps: 8,
    walkSpeed: 1.8,
    runSpeed: 4.2,
    groundAcceleration: 16,
    groundDeceleration: 20,
    airAcceleration: 5,
    gravity: 18,
    jumpSpeed: 6.2,
    jumpTakeoffDelaySeconds: 0,
    terminalFallSpeed: 20,
    turnSpeedRadians: Math.PI * 4,
    landingDurationSeconds: 0.14,
    groundSnapDistance: 0.12,
    maximumSlopeRadians: Math.PI / 4,
    colliderRadius: 0.25,
    colliderHeight: 1.6,
    colliderCenterX: 0,
    colliderCenterY: 0.8,
    colliderCenterZ: 0,
    colliderUpAxis: 'y' as const,
    colliderSkinWidth: 0.015,
    actionBufferSeconds: 0.25,
    remainingPenetrationTolerance: 0.002,
    requireSceneCollision: false,
    requireSecondaryPhysics: false,
})

export type LocomotionState = 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'land'
export type CombatActionSemantic =
    | 'basicAttack'
    | 'skill'
    | 'ultimate'
    | 'dodge'
    | 'damage'
    | 'down'
    | 'victory'
    | 'custom'
export type AnimationSemantic = LocomotionState | CombatActionSemantic
export type RootMotionMode = 'controlled' | 'animation' | 'additive'
export type CombatActionPhase = 'startup' | 'active' | 'recovery'
export type LocomotionAnimationMap = Partial<Record<LocomotionState, string | readonly string[]>>
export type JumpLocomotionMode = 'standing' | 'walking' | 'running'
export type JumpLocomotionState = Extract<LocomotionState, 'jump' | 'fall' | 'land'>
export type JumpLocomotionAnimationMap = Partial<Record<
    JumpLocomotionMode,
    Partial<Record<JumpLocomotionState, string | readonly string[]>>
>>

export interface CharacterLocomotionConfig {
    fixedStepSeconds: number
    maxSubSteps: number
    walkSpeed: number
    runSpeed: number
    groundAcceleration: number
    groundDeceleration: number
    airAcceleration: number
    gravity: number
    jumpSpeed: number
    /** Grounded anticipation time before vertical launch. Zero preserves immediate launch. */
    jumpTakeoffDelaySeconds: number
    terminalFallSpeed: number
    turnSpeedRadians: number
    landingDurationSeconds: number
    groundSnapDistance: number
    maximumSlopeRadians: number
    colliderRadius: number
    colliderHeight: number
    colliderCenterX: number
    colliderCenterY: number
    colliderCenterZ: number
    colliderUpAxis: 'x' | 'y' | 'z'
    colliderSkinWidth: number
    actionBufferSeconds: number
    remainingPenetrationTolerance: number
    requireSceneCollision: boolean
    requireSecondaryPhysics: boolean
}

export type HumanoidGaitMode = 'walk' | 'run'

export interface HumanoidGaitLegSample {
    hipFlexionRadians: number
    kneeFlexionRadians: number
    ankleFlexionRadians: number
    /** 0 is airborne swing, 1 is a fully weighted stance sample. */
    stanceWeight: number
}

export interface HumanoidGaitCycleSample {
    phase: number
    leftLeg: HumanoidGaitLegSample
    rightLeg: HumanoidGaitLegSample
    pelvis: Readonly<{
        lateralOffsetMeters: number
        verticalOffsetMeters: number
        yawRadians: number
        rollRadians: number
    }>
    torso: Readonly<{
        forwardLeanRadians: number
        counterYawRadians: number
        counterRollRadians: number
    }>
    leftArmSwingRadians: number
    rightArmSwingRadians: number
    leftElbowFlexionRadians: number
    rightElbowFlexionRadians: number
    leftShoulderLiftRadians: number
    rightShoulderLiftRadians: number
}

/**
 * Aggregate kinematic reference recovered from all eight exact native Dungeon
 * runtimes currently shipped by the Viewer plus the bounded 100301 live
 * ObjectToWorld capture. This is a parameter corpus, not a licence to retarget
 * any donor AnimationClip onto a different rig.
 */
export const OFFICIAL_DUNGEON_GAIT_REFERENCE = Object.freeze({
    schema: 'magius.official-dungeon-gait-reference.v1' as const,
    sourceDungeonCharacterIds: Object.freeze([
        100201, 100202, 100401, 100501, 100801, 109201, 111501, 114501,
    ] as const),
    sourceManifest: '/character-actions/manifest.v1.json',
    measuredRuntimeAuthority: 'artifacts/runtime/20260824-tw-mami-100301-dungeon-6001101-character-actions/resource-static-dynamic-authority.json',
    postureReferences: Object.freeze({
        madokaSchoolUniform: Object.freeze({
            characterId: 100102,
            dungeonCharacterId: 100102,
            idleClipPathId: '-8001233860802716549',
            walkClipPathId: '-2470702348575474233',
            runClipPathId: '-2707444981814965735',
            transfer: 'cycle-and-angle-family-parameters-only' as const,
        }),
        mamiMagicalGirl: Object.freeze({
            characterId: 100301,
            dungeonCharacterId: 100301,
            idleClipPathId: '-6532624707838147585',
            walkClipPathId: '4412818012340897786',
            runClipPathId: '-2942221244478808616',
            transfer: 'measured-root-speed-and-clearance-parameters-only' as const,
        }),
    }),
    compatibility: 'kinematic-parameters-only;no-cross-character-clip-retargeting' as const,
    walk: Object.freeze({
        cycleSeconds: 1.4500000476837158,
        observedSpeedMetersPerSecond: 0.8851097606472933,
        rootTravelPerCycleMeters: 1.2834091951438975,
        hipAngularRangeDegrees: 27.35724306180784,
        upperLegAngularRangeDegrees: 53.50590477104674,
        lowerLegAngularRangeDegrees: 49.4974611056557,
        footAngularRangeDegrees: 48.96962924577363,
        armAngularRangeDegrees: 48.247591531320126,
        forearmAngularRangeDegrees: 13.818021120124913,
        hipLateralSpanMeters: 0.010806056205183268,
        hipVerticalSpanMeters: 0.04740968346595764,
        hipVerticalCenterOffsetMeters: -0.009298503398895264,
    }),
    run: Object.freeze({
        cycleSeconds: 0.8166666626930237,
        observedSpeedMetersPerSecond: 3.5058317223666537,
        rootTravelPerCycleMeters: 2.86309589266851,
        hipAngularRangeDegrees: 54.349560170476245,
        upperLegAngularRangeDegrees: 97.93116788313489,
        lowerLegAngularRangeDegrees: 104.05080420618594,
        footAngularRangeDegrees: 43.02669982648955,
        armAngularRangeDegrees: 74.0606354765278,
        forearmAngularRangeDegrees: 38.30543451431095,
        hipLateralSpanMeters: 0.03391060512512922,
        hipVerticalSpanMeters: 0.07951772212982178,
        hipVerticalCenterOffsetMeters: 0.022223934531211853,
    }),
})

interface GaitLegKey {
    phase: number
    hipDegrees: number
    kneeDegrees: number
    ankleDegrees: number
    stanceWeight: number
}

const WALK_GAIT_KEYS: readonly GaitLegKey[] = Object.freeze([
    { phase: 0, hipDegrees: 34, kneeDegrees: 6, ankleDegrees: -6, stanceWeight: 1 },
    { phase: 0.12, hipDegrees: 22, kneeDegrees: 15, ankleDegrees: 4, stanceWeight: 1 },
    { phase: 0.25, hipDegrees: 5, kneeDegrees: 8, ankleDegrees: 15, stanceWeight: 1 },
    { phase: 0.38, hipDegrees: -14, kneeDegrees: 5, ankleDegrees: 22, stanceWeight: 0.85 },
    { phase: 0.5, hipDegrees: -20, kneeDegrees: 28, ankleDegrees: 5, stanceWeight: 0.2 },
    { phase: 0.62, hipDegrees: -5, kneeDegrees: 54, ankleDegrees: -27, stanceWeight: 0 },
    { phase: 0.75, hipDegrees: 20, kneeDegrees: 39, ankleDegrees: -12, stanceWeight: 0 },
    { phase: 0.88, hipDegrees: 31, kneeDegrees: 14, ankleDegrees: -4, stanceWeight: 0.35 },
    { phase: 1, hipDegrees: 34, kneeDegrees: 6, ankleDegrees: -6, stanceWeight: 1 },
])

const RUN_GAIT_KEYS: readonly GaitLegKey[] = Object.freeze([
    { phase: 0, hipDegrees: 62, kneeDegrees: 18, ankleDegrees: -8, stanceWeight: 0.65 },
    { phase: 0.1, hipDegrees: 42, kneeDegrees: 48, ankleDegrees: 8, stanceWeight: 0.9 },
    { phase: 0.22, hipDegrees: 5, kneeDegrees: 36, ankleDegrees: 19, stanceWeight: 0.45 },
    { phase: 0.34, hipDegrees: -28, kneeDegrees: 18, ankleDegrees: 2, stanceWeight: 0 },
    { phase: 0.46, hipDegrees: -36, kneeDegrees: 65, ankleDegrees: -24, stanceWeight: 0 },
    { phase: 0.62, hipDegrees: 8, kneeDegrees: 122, ankleDegrees: -15, stanceWeight: 0 },
    { phase: 0.76, hipDegrees: 55, kneeDegrees: 78, ankleDegrees: 6, stanceWeight: 0.05 },
    { phase: 0.9, hipDegrees: 62, kneeDegrees: 35, ankleDegrees: -4, stanceWeight: 0.3 },
    { phase: 1, hipDegrees: 62, kneeDegrees: 18, ankleDegrees: -8, stanceWeight: 0.65 },
])

const wrapUnitPhase = (phase: number): number => ((phase % 1) + 1) % 1
const degreesToRadians = (degrees: number): number => degrees * Math.PI / 180

function sampleGaitLeg(keys: readonly GaitLegKey[], phase: number): HumanoidGaitLegSample {
    const wrapped = wrapUnitPhase(phase)
    let upper = 1
    while (upper < keys.length && keys[upper].phase < wrapped) upper += 1
    const before = keys[Math.max(0, upper - 1)]
    const after = keys[Math.min(keys.length - 1, upper)]
    const span = Math.max(Number.EPSILON, after.phase - before.phase)
    const linear = Math.min(1, Math.max(0, (wrapped - before.phase) / span))
    const t = linear * linear * (3 - 2 * linear)
    const interpolate = (a: number, b: number): number => a + (b - a) * t
    return {
        hipFlexionRadians: degreesToRadians(interpolate(before.hipDegrees, after.hipDegrees)),
        kneeFlexionRadians: degreesToRadians(interpolate(before.kneeDegrees, after.kneeDegrees)),
        ankleFlexionRadians: degreesToRadians(interpolate(before.ankleDegrees, after.ankleDegrees)),
        stanceWeight: interpolate(before.stanceWeight, after.stanceWeight),
    }
}

/**
 * Deterministic gait scaffold parameterized from all eight exact official
 * Dungeon motion families. It transfers measured cycle/range statistics only;
 * the generated pose remains Viewer-authored for the target rig.
 */
export function sampleHumanoidGaitCycle(
    phase: number,
    mode: HumanoidGaitMode,
): HumanoidGaitCycleSample {
    if (!Number.isFinite(phase)) throw new TypeError('gait phase must be finite')
    if (mode !== 'walk' && mode !== 'run') throw new TypeError('gait mode must be walk or run')
    const wrapped = wrapUnitPhase(phase)
    const keys = mode === 'run' ? RUN_GAIT_KEYS : WALK_GAIT_KEYS
    const leftLeg = sampleGaitLeg(keys, wrapped)
    const rightLeg = sampleGaitLeg(keys, wrapped + 0.5)
    const cycle = wrapped * Math.PI * 2
    const running = mode === 'run'
    const reference = running ? OFFICIAL_DUNGEON_GAIT_REFERENCE.run : OFFICIAL_DUNGEON_GAIT_REFERENCE.walk
    const legCenterDegrees = running ? 13 : 7
    const legHalfRangeRadians = degreesToRadians(reference.upperLegAngularRangeDegrees / 2)
    const armHalfRangeRadians = degreesToRadians(reference.armAngularRangeDegrees / 2)
    const clampSignedUnit = (value: number): number => Math.min(1, Math.max(-1, value))
    const normalizedLeg = (leg: HumanoidGaitLegSample): number => clampSignedUnit(
        (leg.hipFlexionRadians - degreesToRadians(legCenterDegrees)) / legHalfRangeRadians,
    )
    const leftArmSwingRadians = -normalizedLeg(leftLeg) * armHalfRangeRadians
    const rightArmSwingRadians = -normalizedLeg(rightLeg) * armHalfRangeRadians
    const elbowMinimumRadians = degreesToRadians(running ? 32 : 8)
    const elbowRangeRadians = degreesToRadians(reference.forearmAngularRangeDegrees)
    const elbowFlexion = (armSwing: number): number => (
        elbowMinimumRadians
        + elbowRangeRadians * Math.min(1, Math.max(0, (armSwing / armHalfRangeRadians + 1) / 2))
    )
    const verticalAmplitude = reference.hipVerticalSpanMeters / 2
    const lateralAmplitude = reference.hipLateralSpanMeters / 2
    const pelvisYaw = degreesToRadians((running ? 6 : 4) * Math.sin(cycle))
    const pelvisRoll = degreesToRadians((running ? 2.2 : 1.4) * Math.sin(cycle))
    return {
        phase: wrapped,
        leftLeg,
        rightLeg,
        pelvis: {
            lateralOffsetMeters: lateralAmplitude * Math.sin(cycle),
            verticalOffsetMeters: reference.hipVerticalCenterOffsetMeters - verticalAmplitude * Math.cos(cycle * 2),
            yawRadians: pelvisYaw,
            rollRadians: pelvisRoll,
        },
        torso: {
            forwardLeanRadians: degreesToRadians(running ? 10 : 3),
            counterYawRadians: -pelvisYaw * 0.7,
            counterRollRadians: -pelvisRoll * 0.55,
        },
        leftArmSwingRadians,
        rightArmSwingRadians,
        leftElbowFlexionRadians: elbowFlexion(leftArmSwingRadians),
        rightElbowFlexionRadians: elbowFlexion(rightArmSwingRadians),
        leftShoulderLiftRadians: degreesToRadians((running ? 2.6 : 1.2) * Math.max(0, Math.sin(cycle))),
        rightShoulderLiftRadians: degreesToRadians((running ? 2.6 : 1.2) * Math.max(0, -Math.sin(cycle))),
    }
}

export interface TargetRigHumanoidDimensions {
    legLengthMeters: number
    armLengthMeters: number
    shoulderHalfSeparationMeters: number
    originalFootHalfSeparationMeters: number
}

export interface TargetRigArmClearance {
    handHalfSeparationMeters: number
    handHeightAboveHipMeters: number
    forwardSwingScaleMeters: number
    forwardBiasMeters: number
}

export interface TargetRigGaitClearance extends TargetRigArmClearance {
    footHalfSeparationMeters: number
    toeOutRadians: number
}

export interface TargetRigLocomotionClearanceProfile {
    schema: 'magius.target-rig-locomotion-clearance.v1'
    idle: TargetRigArmClearance
    walk: TargetRigGaitClearance
    run: TargetRigGaitClearance
}

/**
 * Derives reachable hand and foot targets from the selected rig itself. The
 * profile transfers no donor transforms: it only establishes an anatomical
 * clearance envelope which the target-rig IK solver must satisfy.
 */
export function deriveTargetRigLocomotionClearance(
    dimensions: Readonly<TargetRigHumanoidDimensions>,
): TargetRigLocomotionClearanceProfile {
    for (const [name, value] of Object.entries(dimensions)) {
        if (!Number.isFinite(value) || value <= 0) {
            throw new RangeError(`${name} must be a finite positive length`)
        }
    }
    const {
        legLengthMeters,
        armLengthMeters,
        shoulderHalfSeparationMeters,
        originalFootHalfSeparationMeters,
    } = dimensions
    const walkHandHalfSeparationMeters = Math.max(
        shoulderHalfSeparationMeters + armLengthMeters * 0.7,
        legLengthMeters * 0.5,
    )
    const runHandHalfSeparationMeters = Math.max(
        walkHandHalfSeparationMeters + armLengthMeters * 0.08,
        shoulderHalfSeparationMeters + armLengthMeters * 0.8,
        legLengthMeters * 0.56,
    )
    return {
        schema: 'magius.target-rig-locomotion-clearance.v1',
        idle: {
            handHalfSeparationMeters: walkHandHalfSeparationMeters,
            handHeightAboveHipMeters: Math.max(
                legLengthMeters * 0.15,
                armLengthMeters * 0.25,
            ),
            forwardSwingScaleMeters: 0,
            forwardBiasMeters: armLengthMeters * 0.06,
        },
        walk: {
            handHalfSeparationMeters: walkHandHalfSeparationMeters,
            handHeightAboveHipMeters: Math.max(
                legLengthMeters * 0.15,
                armLengthMeters * 0.25,
            ),
            forwardSwingScaleMeters: armLengthMeters * 0.44,
            forwardBiasMeters: 0,
            footHalfSeparationMeters: Math.max(
                originalFootHalfSeparationMeters,
                legLengthMeters * 0.13,
            ),
            toeOutRadians: 7 * Math.PI / 180,
        },
        run: {
            handHalfSeparationMeters: runHandHalfSeparationMeters,
            handHeightAboveHipMeters: Math.max(
                legLengthMeters * 0.255,
                armLengthMeters * 0.44,
            ),
            forwardSwingScaleMeters: armLengthMeters * 0.46,
            forwardBiasMeters: 0,
            footHalfSeparationMeters: Math.max(
                originalFootHalfSeparationMeters,
                legLengthMeters * 0.21,
            ),
            toeOutRadians: 12 * Math.PI / 180,
        },
    }
}

export interface CharacterTransform {
    position: Vector3
    quaternion: Quaternion
}

export interface CharacterLocomotionInput {
    /** Camera- or world-relative X supplied by the caller. */
    moveX: number
    /** Camera- or world-relative Z supplied by the caller. */
    moveZ: number
    run: boolean
    /** Edge-triggered. One true value queues exactly one jump. */
    jumpPressed: boolean
    /** Optional independent facing vector, useful for strafe combat. */
    facingX?: number
    facingZ?: number
}

export interface CharacterColliderShape {
    radius: number
    height: number
    center: Vector3
    upAxis: 'x' | 'y' | 'z'
    skinWidth: number
}

export interface CharacterCollisionContact {
    point: Vector3
    normal: Vector3
    depth?: number
    objectId?: string
}

export interface CharacterMotionQuery {
    characterId: string
    startPosition: Vector3
    desiredDisplacement: Vector3
    velocity: Vector3
    collider: CharacterColliderShape
    deltaSeconds: number
    wasGrounded: boolean
}

export interface CharacterMotionResult {
    position: Vector3
    velocity?: Vector3
    grounded: boolean
    groundNormal?: Vector3
    contacts?: readonly CharacterCollisionContact[]
}

/**
 * Scene-owned broad/narrow phase. A production adapter should sweep the body
 * collider rather than correcting only after overlap.
 */
export interface CharacterCollisionWorld {
    resolveMotion(query: Readonly<CharacterMotionQuery>): CharacterMotionResult
}

export interface CharacterGroundQueryInput {
    characterId: string
    position: Vector3
    maxDistance: number
    collider: CharacterColliderShape
}

export interface CharacterGroundHit {
    point: Vector3
    normal: Vector3
    distance: number
    walkable?: boolean
    objectId?: string
}

export interface CharacterGroundQuery {
    queryGround(query: Readonly<CharacterGroundQueryInput>): CharacterGroundHit | null
}

export interface SecondaryPhysicsParticleMotionQuery {
    characterId: string
    particleId?: string
    previousPosition: Vector3
    desiredPosition: Vector3
    radius: number
    deltaSeconds: number
}

export interface SecondaryPhysicsParticleMotionResult {
    position: Vector3
    contacts: readonly CharacterCollisionContact[]
    remainingPenetration?: number
}

/** Scene-owned collision projection used by garment/hair particles. */
export interface SecondaryPhysicsSceneCollisionWorld {
    resolveParticleMotion(
        query: Readonly<SecondaryPhysicsParticleMotionQuery>,
    ): SecondaryPhysicsParticleMotionResult
}

export interface RootMotionDelta {
    translation: Vector3
    rotation?: Quaternion
    space?: 'local' | 'world'
}

/**
 * `extract` means the adapter removes the sampled displacement from the
 * animated inner root before returning it. This invariant prevents animation
 * root motion and the controlled outer root from applying the same delta twice.
 */
export interface CharacterRootMotionAdapter {
    configure(mode: 'suppress' | 'extract'): void
    consumeDelta(deltaSeconds: number): RootMotionDelta
    reset?(): void
}

export interface SecondaryPhysicsStepContext {
    characterId: string
    deltaSeconds: number
    rootStartPosition: Vector3
    rootEndPosition: Vector3
    rootTranslation: Vector3
    rootQuaternion: Quaternion
    contacts: readonly CharacterCollisionContact[]
    collisionWorld?: CharacterCollisionWorld
    sceneCollisionWorld?: SecondaryPhysicsSceneCollisionWorld
    teleported: boolean
}

export interface SecondaryPhysicsStepResult {
    correctedContacts: number
    unresolvedContacts: number
    maxRemainingPenetration: number
}

/**
 * Called after the animation pose and controlled root have been applied, but
 * before rendering. The adapter remains responsible for the existing garment,
 * hair and accessory solver and for testing its particles/colliders against the
 * scene collision source passed in the context.
 */
export interface CharacterSecondaryPhysicsAdapter {
    beginStep?(context: Readonly<SecondaryPhysicsStepContext>): void
    step(context: Readonly<SecondaryPhysicsStepContext>): SecondaryPhysicsStepResult
    setActive?(active: boolean): void
    setBlendWeight?(weight: number): void
    reset?(position: Vector3, quaternion: Quaternion): void
}

export interface SecondaryPhysicsControlState {
    active: boolean
    reset?: boolean
    blendWeight?: number
}

export interface AnimationClipDescriptor {
    name: string
    duration?: number
    trackCount?: number
}

export type AnimationCandidateTier = 'exact' | 'strong' | 'weak' | 'fallback'

export interface AnimationCandidate {
    clip: AnimationClipDescriptor
    semantic: AnimationSemantic
    tier: AnimationCandidateTier
    score: number
    loop: boolean
    reasons: readonly string[]
}

export interface AnimationResolution {
    semantic: AnimationSemantic
    status: 'matched' | 'fallback' | 'unavailable'
    selected?: AnimationCandidate
    candidates: readonly AnimationCandidate[]
}

export interface ResolveAnimationOptions {
    preferredNames?: readonly string[]
    allowFallback?: boolean
}

export interface CharacterAnimationPlayOptions {
    loop: boolean
    speed: number
    weight: number
    fadeSeconds: number
    /** Physical contact/recovery must not retain the long airborne cross-fade. */
    contactTransition?: boolean
    /** Continue a requested gait at touchdown with a pose-matched starting phase. */
    resumeGroundedGait?: boolean
}

/** Structural adapter for the current character package or another mixer. */
export interface CharacterAnimationPort {
    listClips(): readonly AnimationClipDescriptor[]
    play(name: string, options: Readonly<CharacterAnimationPlayOptions>): void
    clear?(): void
    getDuration?(name: string): number | undefined
    setTime?(timeSeconds: number): void
    setSpeed?(speed: number): void
    setWeight?(weight: number): void
}

export interface ViewerCharacterAnimationLike {
    animations: readonly string[]
    animation: {
        play(name: string, loop?: boolean): void
        clear?(): void
        current?: string
        duration?: number
        time: number
        mixer: { timeScale: number }
    }
}

export interface CombatCancelWindow {
    startSeconds: number
    endSeconds: number
    into?: readonly CombatActionSemantic[]
}

export interface CombatActiveWindow {
    startSeconds: number
    endSeconds: number
}

export interface CombatEffectCueDefinition {
    id: string
    timeSeconds: number
    /** Asset/catalog key interpreted by the scene-owned visual-effects system. */
    effectId: string
    anchor?: string
    lifetimeSeconds?: number
    payload?: unknown
}

export interface CombatAnimationSegment {
    /** Exact loaded animation family for this segment. */
    clip: string
    /** Action-local start time. The first segment must start at zero. */
    startSeconds: number
    /** Cross-fade used when entering this segment. */
    fadeSeconds?: number
}

export interface CombatActionDefinition {
    id: string
    semantic: CombatActionSemantic
    /** Exact loaded animation family for a user-configured action slot. */
    exactClip?: string
    preferredClips?: readonly string[]
    /** Ordered exact-clip sequence for Timeline actions such as face cut -> skill. */
    animationSegments?: readonly CombatAnimationSegment[]
    durationSeconds?: number
    speed?: number
    weight?: number
    fadeSeconds?: number
    movementScale?: number
    activeWindow?: CombatActiveWindow
    cancelWindows?: readonly CombatCancelWindow[]
    effectCues?: readonly CombatEffectCueDefinition[]
}

export interface CombatActionRequestOptions {
    force?: boolean
    bufferSeconds?: number
}

export interface CombatActionRequestResult {
    accepted: boolean
    actionId: string
    resolution: AnimationResolution
    reason?: string
}

export interface CombatActionSnapshot {
    id: string
    semantic: CombatActionSemantic
    clipName: string
    elapsedSeconds: number
    durationSeconds: number
    phase: CombatActionPhase
    sequence: number
}

export interface CombatEffectCue {
    characterId: string
    actionId: string
    actionSemantic: CombatActionSemantic
    actionSequence: number
    cueId: string
    effectId: string
    anchor?: string
    lifetimeSeconds?: number
    payload?: unknown
    actionTimeSeconds: number
    rootPosition: Vector3
    rootQuaternion: Quaternion
}

export type CombatActionEvent =
    | { type: 'queued'; characterId: string; actionId: string }
    | { type: 'started'; characterId: string; action: CombatActionSnapshot }
    | { type: 'phase'; characterId: string; action: CombatActionSnapshot }
    | { type: 'cancelled'; characterId: string; action: CombatActionSnapshot; byActionId: string }
    | { type: 'finished'; characterId: string; action: CombatActionSnapshot }
    | { type: 'rejected'; characterId: string; actionId: string; reason: string }

export interface CharacterLocomotionSnapshot {
    characterId: string
    elapsedSeconds: number
    state: LocomotionState
    jumpMode: JumpLocomotionMode
    grounded: boolean
    takeoffRemainingSeconds: number
    position: Vector3
    quaternion: Quaternion
    velocity: Vector3
    activeAction?: CombatActionSnapshot
    contacts: readonly CharacterCollisionContact[]
    secondaryPhysics?: SecondaryPhysicsStepResult
    secondaryPhysicsControl: Readonly<{ active: boolean; blendWeight: number }>
}

export interface CharacterLocomotionStepDiagnostics {
    advanceCalls: number
    fixedSteps: number
    collisionQueries: number
    groundQueries: number
    groundQueriesSkippedGrounded: number
}

export interface PhysicsReadinessReport {
    ready: boolean
    issues: readonly string[]
}

export interface CharacterLocomotionControllerOptions {
    characterId: string
    /** Prefer a parent/pivot outside the animated skeleton as this transform. */
    transform: CharacterTransform
    animation?: CharacterAnimationPort
    collisionWorld?: CharacterCollisionWorld
    groundQuery?: CharacterGroundQuery
    secondaryPhysics?: CharacterSecondaryPhysicsAdapter
    secondaryPhysicsSceneCollision?: SecondaryPhysicsSceneCollisionWorld
    rootMotion?: CharacterRootMotionAdapter
    rootMotionMode?: RootMotionMode
    /** Ordered exact loaded-family choices used before semantic fallback. */
    locomotionAnimations?: LocomotionAnimationMap
    /** Optional standing/walking/running jump families; each state falls back to locomotionAnimations. */
    jumpLocomotionAnimations?: JumpLocomotionAnimationMap
    config?: Partial<CharacterLocomotionConfig>
    initiallyGrounded?: boolean
    onStateChange?: (state: LocomotionState, previous: LocomotionState) => void
    onActionEvent?: (event: CombatActionEvent) => void
    onEffectCue?: (cue: CombatEffectCue) => void
    onPhysicsIssue?: (report: PhysicsReadinessReport) => void
}

export const SHARED_BATTLE_CAPTURE_FILES = [
    'capture-session.json',
    'animator-events.jsonl',
    'vfx-events.jsonl',
    'root-motion.jsonl',
    'collision-components.json',
    'secondary-physics.json',
    'summary.md',
] as const

export type SharedBattleCaptureFileName = typeof SHARED_BATTLE_CAPTURE_FILES[number]
export type SharedBattleCaptureRawFiles = Partial<Record<SharedBattleCaptureFileName, unknown>>

export interface SharedCaptureRecordContext {
    captureSessionId?: string
    eventId?: string
    captureFile?: string
    region?: string
    device?: string
    package?: string
    pid?: string | number
    timestamp?: string | number
    frame?: number
    sceneKey?: string
    characterIdentity?: unknown
}

export interface SharedAnimatorCaptureRecord extends SharedCaptureRecordContext {
    actionId?: string
    semantic?: CombatActionSemantic
    layer?: number
    stateHash?: string | number
    clip?: string
    pathID?: string | number
    bundle?: string
    address?: string
    styleMstId?: string | number
    styleFigureMstId?: string | number
    style3dCharacterMstId?: string | number
    skillUniqueId?: string | number
    skillMstId?: string | number
    directionName?: string
    role?: string
    bindings?: number
    normalizedTime?: number
    clipDuration?: number
    speed?: number
    weight?: number
    crossFadeSeconds?: number
    data: Readonly<Record<string, unknown>>
}

export interface SharedVfxCaptureRecord extends SharedCaptureRecordContext {
    actionId?: string
    cueId?: string
    vfxKey?: string
    anchor?: string
    lifetimeSeconds?: number
    actionTimeSeconds?: number
    data: Readonly<Record<string, unknown>>
}

export interface SharedRootMotionCaptureRecord extends SharedCaptureRecordContext {
    node?: string
    position?: TimelineVector3Like
    quaternion?: TimelineQuaternionLike
    data: Readonly<Record<string, unknown>>
}

export type TimelineVector3Like = readonly [number, number, number]
export type TimelineQuaternionLike = readonly [number, number, number, number]

export interface SharedComponentCaptureRecord extends SharedCaptureRecordContext {
    componentType?: string
    data: Readonly<Record<string, unknown>>
}

export interface SharedBattleCaptureDiagnostic {
    file: SharedBattleCaptureFileName
    record?: number
    line?: number
    reason: string
}

export interface SharedBattleCaptureDiagnostics {
    missingFiles: readonly SharedBattleCaptureFileName[]
    malformed: readonly SharedBattleCaptureDiagnostic[]
    incomplete: readonly SharedBattleCaptureDiagnostic[]
}

export interface SharedBattleCapture {
    session?: Readonly<Record<string, unknown>>
    animatorEvents: readonly SharedAnimatorCaptureRecord[]
    vfxEvents: readonly SharedVfxCaptureRecord[]
    rootMotion: readonly SharedRootMotionCaptureRecord[]
    collisionComponents: readonly SharedComponentCaptureRecord[]
    secondaryPhysics: readonly SharedComponentCaptureRecord[]
    collisionMetadata?: Readonly<Record<string, unknown>>
    secondaryPhysicsMetadata?: Readonly<Record<string, unknown>>
    summary?: string
    diagnostics: SharedBattleCaptureDiagnostics
}

export interface CapturedAnimationAssetEvidence {
    clip: string
    pathID?: string | number
    bundle?: string
    address?: string
    semantic?: CombatActionSemantic
    actionId?: string
    styleMstId?: string | number
    styleFigureMstId?: string | number
    style3dCharacterMstId?: string | number
    skillUniqueId?: string | number
    skillMstId?: string | number
    directionName?: string
    role?: string
    bindings?: number
}

export interface CapturedCombatActionBuildResult {
    actionId: string
    status: 'ready' | 'incomplete'
    hasCapturedEffects: boolean
    definition?: CombatActionDefinition
    asset?: CapturedAnimationAssetEvidence
    reasons: readonly string[]
}

function captureRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined
}

function captureString(record: Readonly<Record<string, unknown>>, ...keys: string[]): string | undefined {
    for (const key of keys) {
        const value = record[key]
        if (typeof value === 'string' && value.length > 0) return value
    }
    return undefined
}

function captureFiniteNumber(
    record: Readonly<Record<string, unknown>>,
    ...keys: string[]
): number | undefined {
    for (const key of keys) {
        const value = record[key]
        if (typeof value === 'number' && Number.isFinite(value)) return value
    }
    return undefined
}

function captureScalar(
    record: Readonly<Record<string, unknown>>,
    ...keys: string[]
): string | number | undefined {
    for (const key of keys) {
        const value = record[key]
        if (typeof value === 'string') return value
        if (typeof value === 'number' && Number.isFinite(value)) return value
    }
    return undefined
}

function captureTuple(
    record: Readonly<Record<string, unknown>>,
    length: 3,
    ...keys: string[]
): TimelineVector3Like | undefined
function captureTuple(
    record: Readonly<Record<string, unknown>>,
    length: 4,
    ...keys: string[]
): TimelineQuaternionLike | undefined
function captureTuple(
    record: Readonly<Record<string, unknown>>,
    length: 3 | 4,
    ...keys: string[]
): TimelineVector3Like | TimelineQuaternionLike | undefined {
    for (const key of keys) {
        const value = record[key]
        if (
            Array.isArray(value)
            && value.length === length
            && value.every(entry => typeof entry === 'number' && Number.isFinite(entry))
        ) {
            return [...value] as unknown as TimelineVector3Like | TimelineQuaternionLike
        }
    }
    return undefined
}

function captureContext(
    record: Readonly<Record<string, unknown>>,
    defaults: Readonly<SharedCaptureRecordContext> = {},
): SharedCaptureRecordContext {
    const context: SharedCaptureRecordContext = { ...defaults }
    const captureSessionId = captureString(record, 'captureSessionId', 'capture_session_id', 'sessionId')
    const eventId = captureString(record, 'eventId', 'event_id')
    const captureFile = captureString(record, 'captureFile', 'capture_file')
    const region = captureString(record, 'region')
    const device = captureString(record, 'device')
    const packageName = captureString(record, 'package', 'packageName', 'package_name')
    const pid = captureScalar(record, 'pid')
    const timestamp = captureScalar(record, 'timestamp', 'timestampMs', 'timestamp_ms')
    const frame = captureFiniteNumber(record, 'frame')
    const sceneKey = captureString(record, 'sceneKey', 'scene_key')
    const characterIdentity = record.characterIdentity ?? record.character_identity
    if (captureSessionId !== undefined) context.captureSessionId = captureSessionId
    if (eventId !== undefined) context.eventId = eventId
    if (captureFile !== undefined) context.captureFile = captureFile
    if (region !== undefined) context.region = region
    if (device !== undefined) context.device = device
    if (packageName !== undefined) context.package = packageName
    if (pid !== undefined) context.pid = pid
    if (timestamp !== undefined) context.timestamp = timestamp
    if (frame !== undefined) context.frame = frame
    if (sceneKey !== undefined) context.sceneKey = sceneKey
    if (characterIdentity !== undefined) context.characterIdentity = characterIdentity
    return context
}

function captureSessionDefaults(session?: Readonly<Record<string, unknown>>): SharedCaptureRecordContext {
    if (!session) return {}
    return captureContext(session)
}

function missingCaptureContext(record: SharedCaptureRecordContext): string[] {
    return [
        ['region', record.region],
        ['device', record.device],
        ['package', record.package],
        ['pid', record.pid],
        ['timestamp', record.timestamp],
        ['frame', record.frame],
        ['sceneKey', record.sceneKey],
        ['characterIdentity', record.characterIdentity],
    ].filter((entry): entry is [string, undefined] => entry[1] === undefined).map(entry => entry[0])
}

function parseJsonCaptureFile(
    raw: unknown,
    file: SharedBattleCaptureFileName,
    malformed: SharedBattleCaptureDiagnostic[],
): unknown {
    if (typeof raw !== 'string') return raw
    try {
        return JSON.parse(raw) as unknown
    } catch (error) {
        malformed.push({ file, reason: `invalid JSON: ${String(error)}` })
        return undefined
    }
}

function parseJsonLinesCaptureFile(
    raw: unknown,
    file: SharedBattleCaptureFileName,
    malformed: SharedBattleCaptureDiagnostic[],
): unknown[] {
    if (Array.isArray(raw)) return [...raw]
    if (typeof raw !== 'string') {
        if (raw !== undefined) malformed.push({ file, reason: 'JSONL input must be text or an array' })
        return []
    }
    const records: unknown[] = []
    for (const [index, line] of raw.split(/\r?\n/).entries()) {
        if (!line.trim()) continue
        try {
            records.push(JSON.parse(line) as unknown)
        } catch (error) {
            malformed.push({
                file,
                line: index + 1,
                reason: `invalid JSONL record: ${String(error)}`,
            })
        }
    }
    return records
}

function componentRecords(value: unknown): unknown[] {
    if (Array.isArray(value)) return value
    const record = captureRecord(value)
    if (record && Array.isArray(record.records)) return record.records
    if (record && Array.isArray(record.components)) return record.components
    return value === undefined ? [] : [value]
}

function recordIncompleteContext(
    file: SharedBattleCaptureFileName,
    recordIndex: number,
    context: SharedCaptureRecordContext,
    incomplete: SharedBattleCaptureDiagnostic[],
): void {
    const missing = missingCaptureContext(context)
    if (missing.length > 0) {
        incomplete.push({
            file,
            record: recordIndex,
            reason: `missing shared context fields: ${missing.join(', ')}`,
        })
    }
}

function captureCombatSemantic(value?: string): CombatActionSemantic | undefined {
    if (!value) return undefined
    if (COMBAT_SEMANTICS.has(value as AnimationSemantic)) return value as CombatActionSemantic
    const normalized = value.toLowerCase().replace(/[\s-]+/g, '_')
    if (normalized === 'normal_attack' || normalized === 'basic_attack') return 'basicAttack'
    if (normalized.includes('magia') || normalized.includes('doppel') || normalized.includes('ultimate')) {
        return 'ultimate'
    }
    if (normalized.includes('skill')) return 'skill'
    if (normalized.includes('dodge') || normalized.includes('evade')) return 'dodge'
    if (normalized.includes('damage') || normalized.includes('hurt')) return 'damage'
    if (normalized.includes('down') || normalized.includes('death')) return 'down'
    if (normalized.includes('victory') || normalized.includes('win')) return 'victory'
    return undefined
}

function parseAnimatorEvents(
    values: readonly unknown[],
    malformed: SharedBattleCaptureDiagnostic[],
    incomplete: SharedBattleCaptureDiagnostic[],
    defaults: Readonly<SharedCaptureRecordContext>,
): SharedAnimatorCaptureRecord[] {
    const file = 'animator-events.jsonl'
    const output: SharedAnimatorCaptureRecord[] = []
    values.forEach((value, index) => {
        const record = captureRecord(value)
        if (!record) {
            malformed.push({ file, record: index, reason: 'record must be an object' })
            return
        }
        const context = captureContext(record, defaults)
        recordIncompleteContext(file, index, context, incomplete)
        const event: SharedAnimatorCaptureRecord = { ...context, data: cloneCaptureData(record) }
        const actionId = captureString(record, 'actionId', 'action_id', 'observedAction', 'observed_action')
        const semanticValue = captureString(
            record,
            'semantic',
            'actionSemantic',
            'action_semantic',
            'observedAction',
            'observed_action',
        )
        const semantic = captureCombatSemantic(semanticValue)
        const layer = captureFiniteNumber(record, 'layer', 'animatorLayer', 'animator_layer')
        const stateHash = captureScalar(record, 'stateHash', 'state_hash', 'animatorStateHash', 'animator_state_hash')
        const clip = captureString(record, 'clip', 'clipName', 'clip_name', 'animationClipName', 'animation_clip_name')
        const pathID = captureScalar(
            record,
            'pathID',
            'pathId',
            'path_id',
            'animationClipPathId',
            'animation_clip_path_id',
        )
        const bundle = captureString(record, 'bundle', 'bundleName', 'bundle_name', 'animationBundle', 'animation_bundle')
        const address = captureString(
            record,
            'address',
            'assetAddress',
            'asset_address',
            'animationLoadAddress',
            'animation_load_address',
        )
        const styleMstId = captureScalar(record, 'styleMstId', 'style_mst_id')
        const styleFigureMstId = captureScalar(record, 'styleFigureMstId', 'style_figure_mst_id')
        const style3dCharacterMstId = captureScalar(
            record,
            'style3dCharacterMstId',
            'style3d_character_mst_id',
        )
        const skillUniqueId = captureScalar(record, 'skillUniqueId', 'skill_unique_id')
        const skillMstId = captureScalar(record, 'skillMstId', 'skill_mst_id')
        const directionName = captureString(record, 'directionName', 'direction_name')
        const role = captureString(record, 'role', 'clipRole', 'clip_role')
        const bindings = captureFiniteNumber(record, 'bindings', 'bindingCount', 'binding_count')
        const normalizedTime = captureFiniteNumber(record, 'normalizedTime', 'normalized_time')
        const clipDuration = captureFiniteNumber(record, 'clipDuration', 'clip_duration', 'durationSeconds')
        const speed = captureFiniteNumber(record, 'speed')
        const weight = captureFiniteNumber(record, 'weight')
        const crossFadeSeconds = captureFiniteNumber(
            record,
            'crossFadeSeconds',
            'cross_fade_seconds',
            'crossfade',
        )
        if (actionId !== undefined) event.actionId = actionId
        if (semantic !== undefined) event.semantic = semantic
        if (layer !== undefined) event.layer = layer
        if (stateHash !== undefined) event.stateHash = stateHash
        if (clip !== undefined) event.clip = clip
        if (pathID !== undefined) event.pathID = pathID
        if (bundle !== undefined) event.bundle = bundle
        if (address !== undefined) event.address = address
        if (styleMstId !== undefined) event.styleMstId = styleMstId
        if (styleFigureMstId !== undefined) event.styleFigureMstId = styleFigureMstId
        if (style3dCharacterMstId !== undefined) event.style3dCharacterMstId = style3dCharacterMstId
        if (skillUniqueId !== undefined) event.skillUniqueId = skillUniqueId
        if (skillMstId !== undefined) event.skillMstId = skillMstId
        if (directionName !== undefined) event.directionName = directionName
        if (role !== undefined) event.role = role
        if (bindings !== undefined) event.bindings = bindings
        if (normalizedTime !== undefined) event.normalizedTime = normalizedTime
        if (clipDuration !== undefined) event.clipDuration = clipDuration
        if (speed !== undefined) event.speed = speed
        if (weight !== undefined) event.weight = weight
        if (crossFadeSeconds !== undefined) event.crossFadeSeconds = crossFadeSeconds
        output.push(event)
    })
    return output
}

function parseVfxEvents(
    values: readonly unknown[],
    malformed: SharedBattleCaptureDiagnostic[],
    incomplete: SharedBattleCaptureDiagnostic[],
    defaults: Readonly<SharedCaptureRecordContext>,
): SharedVfxCaptureRecord[] {
    const file = 'vfx-events.jsonl'
    const output: SharedVfxCaptureRecord[] = []
    values.forEach((value, index) => {
        const record = captureRecord(value)
        if (!record) {
            malformed.push({ file, record: index, reason: 'record must be an object' })
            return
        }
        const context = captureContext(record, defaults)
        recordIncompleteContext(file, index, context, incomplete)
        const event: SharedVfxCaptureRecord = { ...context, data: cloneCaptureData(record) }
        const actionId = captureString(record, 'actionId', 'action_id', 'triggerEvent', 'trigger_event')
        const cueId = captureString(record, 'cueId', 'cue_id', 'eventId', 'event_id')
        const vfxKey = captureString(
            record,
            'vfxKey',
            'vfx_key',
            'effectId',
            'effect_id',
            'resourceKey',
            'resource_key',
            'key',
        )
        const anchor = captureString(record, 'anchor', 'parentAnchor', 'parent_anchor')
        const lifetimeSeconds = captureFiniteNumber(record, 'lifetimeSeconds', 'lifetime_seconds', 'lifetime')
        const actionTimeSeconds = captureFiniteNumber(record, 'actionTimeSeconds', 'action_time_seconds')
        if (actionId !== undefined) event.actionId = actionId
        if (cueId !== undefined) event.cueId = cueId
        if (vfxKey !== undefined) event.vfxKey = vfxKey
        if (anchor !== undefined) event.anchor = anchor
        if (lifetimeSeconds !== undefined) event.lifetimeSeconds = lifetimeSeconds
        if (actionTimeSeconds !== undefined) event.actionTimeSeconds = actionTimeSeconds
        output.push(event)
    })
    return output
}

function parseRootMotionEvents(
    values: readonly unknown[],
    malformed: SharedBattleCaptureDiagnostic[],
    incomplete: SharedBattleCaptureDiagnostic[],
    defaults: Readonly<SharedCaptureRecordContext>,
): SharedRootMotionCaptureRecord[] {
    const file = 'root-motion.jsonl'
    const output: SharedRootMotionCaptureRecord[] = []
    values.forEach((value, index) => {
        const record = captureRecord(value)
        if (!record) {
            malformed.push({ file, record: index, reason: 'record must be an object' })
            return
        }
        const context = captureContext(record, defaults)
        recordIncompleteContext(file, index, context, incomplete)
        const event: SharedRootMotionCaptureRecord = { ...context, data: cloneCaptureData(record) }
        const node = captureString(record, 'node', 'nodeName', 'node_name', 'rootNode', 'root_node')
        const position = captureTuple(record, 3, 'position', 'rootPosition', 'root_position')
        const quaternion = captureTuple(record, 4, 'quaternion', 'rootQuaternion', 'root_quaternion')
        if (node !== undefined) event.node = node
        if (position !== undefined) event.position = position
        if (quaternion !== undefined) event.quaternion = quaternion
        output.push(event)
    })
    return output
}

function parseComponentEvents(
    values: readonly unknown[],
    file: 'collision-components.json' | 'secondary-physics.json',
    malformed: SharedBattleCaptureDiagnostic[],
    incomplete: SharedBattleCaptureDiagnostic[],
    defaults: Readonly<SharedCaptureRecordContext>,
): SharedComponentCaptureRecord[] {
    const output: SharedComponentCaptureRecord[] = []
    values.forEach((value, index) => {
        const record = captureRecord(value)
        if (!record) {
            malformed.push({ file, record: index, reason: 'record must be an object' })
            return
        }
        const context = captureContext(record, defaults)
        recordIncompleteContext(file, index, context, incomplete)
        const componentType = captureString(record, 'componentType', 'component_type', 'type')
        const event: SharedComponentCaptureRecord = {
            ...context,
            data: cloneCaptureData(record),
        }
        if (componentType !== undefined) event.componentType = componentType
        output.push(event)
    })
    return output
}

function cloneCaptureData(record: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
    try {
        assertFinitePayload(record, 'capture record')
        return JSON.parse(JSON.stringify(record)) as Record<string, unknown>
    } catch {
        const finite: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(record)) {
            try {
                assertFinitePayload(value, `capture record.${key}`)
                if (value !== undefined) finite[key] = JSON.parse(JSON.stringify(value)) as unknown
            } catch {
                // Preserve the rest of a partial capture when one optional field is malformed.
            }
        }
        return finite
    }
}

/**
 * Pure consumer for the shared capture root. Callers own file I/O and pass the
 * seven file payloads here; absent files/fields are reported, not fatal.
 */
export function consumeSharedBattleCapture(rawFiles: SharedBattleCaptureRawFiles): SharedBattleCapture {
    const malformed: SharedBattleCaptureDiagnostic[] = []
    const incomplete: SharedBattleCaptureDiagnostic[] = []
    const missingFiles = SHARED_BATTLE_CAPTURE_FILES.filter(file => rawFiles[file] === undefined)
    const sessionValue = parseJsonCaptureFile(rawFiles['capture-session.json'], 'capture-session.json', malformed)
    const sessionRecord = captureRecord(sessionValue)
    if (sessionValue !== undefined && !sessionRecord) {
        malformed.push({ file: 'capture-session.json', reason: 'session must be an object' })
    }
    const contextDefaults = captureSessionDefaults(sessionRecord)
    const collisionValue = parseJsonCaptureFile(
        rawFiles['collision-components.json'],
        'collision-components.json',
        malformed,
    )
    const physicsValue = parseJsonCaptureFile(
        rawFiles['secondary-physics.json'],
        'secondary-physics.json',
        malformed,
    )
    const summaryValue = rawFiles['summary.md']
    if (summaryValue !== undefined && typeof summaryValue !== 'string') {
        malformed.push({ file: 'summary.md', reason: 'summary must be text' })
    }
    return {
        session: sessionRecord ? cloneCaptureData(sessionRecord) : undefined,
        animatorEvents: parseAnimatorEvents(
            parseJsonLinesCaptureFile(rawFiles['animator-events.jsonl'], 'animator-events.jsonl', malformed),
            malformed,
            incomplete,
            contextDefaults,
        ),
        vfxEvents: parseVfxEvents(
            parseJsonLinesCaptureFile(rawFiles['vfx-events.jsonl'], 'vfx-events.jsonl', malformed),
            malformed,
            incomplete,
            contextDefaults,
        ),
        rootMotion: parseRootMotionEvents(
            parseJsonLinesCaptureFile(rawFiles['root-motion.jsonl'], 'root-motion.jsonl', malformed),
            malformed,
            incomplete,
            contextDefaults,
        ),
        collisionComponents: parseComponentEvents(
            componentRecords(collisionValue),
            'collision-components.json',
            malformed,
            incomplete,
            contextDefaults,
        ),
        secondaryPhysics: parseComponentEvents(
            componentRecords(physicsValue),
            'secondary-physics.json',
            malformed,
            incomplete,
            contextDefaults,
        ),
        collisionMetadata: captureRecord(collisionValue)
            ? cloneCaptureData(collisionValue as Record<string, unknown>)
            : undefined,
        secondaryPhysicsMetadata: captureRecord(physicsValue)
            ? cloneCaptureData(physicsValue as Record<string, unknown>)
            : undefined,
        summary: typeof summaryValue === 'string' ? summaryValue : undefined,
        diagnostics: { missingFiles, malformed, incomplete },
    }
}

export function listCapturedAnimationAssets(
    capture: Readonly<SharedBattleCapture>,
): readonly CapturedAnimationAssetEvidence[] {
    const seen = new Set<string>()
    const assets: CapturedAnimationAssetEvidence[] = []
    for (const event of capture.animatorEvents) {
        if (!event.clip) continue
        const key = [
            event.styleMstId ?? '',
            event.styleFigureMstId ?? '',
            event.style3dCharacterMstId ?? '',
            event.skillUniqueId ?? '',
            event.skillMstId ?? '',
            event.directionName ?? '',
            event.bundle ?? '',
            event.pathID ?? '',
            event.role ?? '',
            event.clip,
            event.address ?? '',
        ].join('|')
        if (seen.has(key)) continue
        seen.add(key)
        const evidence: CapturedAnimationAssetEvidence = { clip: event.clip }
        if (event.pathID !== undefined) evidence.pathID = event.pathID
        if (event.bundle !== undefined) evidence.bundle = event.bundle
        if (event.address !== undefined) evidence.address = event.address
        if (event.semantic !== undefined) evidence.semantic = event.semantic
        if (event.actionId !== undefined) evidence.actionId = event.actionId
        if (event.styleMstId !== undefined) evidence.styleMstId = event.styleMstId
        if (event.styleFigureMstId !== undefined) evidence.styleFigureMstId = event.styleFigureMstId
        if (event.style3dCharacterMstId !== undefined) {
            evidence.style3dCharacterMstId = event.style3dCharacterMstId
        }
        if (event.skillUniqueId !== undefined) evidence.skillUniqueId = event.skillUniqueId
        if (event.skillMstId !== undefined) evidence.skillMstId = event.skillMstId
        if (event.directionName !== undefined) evidence.directionName = event.directionName
        if (event.role !== undefined) evidence.role = event.role
        if (event.bindings !== undefined) evidence.bindings = event.bindings
        assets.push(evidence)
    }
    return assets
}

export function capturedAnimationClipDescriptors(
    capture: Readonly<SharedBattleCapture>,
): readonly AnimationClipDescriptor[] {
    const descriptors = new Map<string, AnimationClipDescriptor>()
    for (const event of capture.animatorEvents) {
        if (!event.clip) continue
        const family = normalizeAnimationFamilyName(event.clip)
        const previous = descriptors.get(family)
        const currentCoverage = event.bindings ?? 0
        const previousCoverage = previous?.trackCount ?? 0
        const shouldReplace = !previous
            || currentCoverage > previousCoverage
            || (
                currentCoverage === previousCoverage
                && (event.clipDuration ?? 0) > (previous.duration ?? 0)
            )
        if (shouldReplace) {
            const descriptor: AnimationClipDescriptor = {
                name: family,
                duration: event.clipDuration,
            }
            if (event.bindings !== undefined) descriptor.trackCount = event.bindings
            descriptors.set(family, descriptor)
        }
    }
    return [...descriptors.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function capturedCombatEffectCueDefinitions(
    capture: Readonly<SharedBattleCapture>,
    actionId: string,
): readonly CombatEffectCueDefinition[] {
    if (!actionId) throw new TypeError('actionId is required')
    const seenCueIds = new Set<string>()
    return capture.vfxEvents
        .map((event, order) => ({ event, order }))
        .filter(({ event }) => (
            event.actionId === actionId
            && event.cueId !== undefined
            && event.vfxKey !== undefined
            && event.actionTimeSeconds !== undefined
            && event.actionTimeSeconds >= 0
            && (event.lifetimeSeconds === undefined || event.lifetimeSeconds >= 0)
        ))
        .sort((a, b) => (
            (a.event.actionTimeSeconds as number) - (b.event.actionTimeSeconds as number)
            || a.order - b.order
        ))
        .flatMap(({ event }) => {
            const cueId = event.cueId as string
            if (seenCueIds.has(cueId)) return []
            seenCueIds.add(cueId)
            const cue: CombatEffectCueDefinition = {
                id: cueId,
                timeSeconds: event.actionTimeSeconds as number,
                effectId: event.vfxKey as string,
            }
            if (event.anchor !== undefined) cue.anchor = event.anchor
            if (event.lifetimeSeconds !== undefined) cue.lifetimeSeconds = event.lifetimeSeconds
            return [cue]
        })
}

/**
 * Builds a registrable action only from a complete captured body clip. Body role
 * wins explicitly; binding coverage is the generic fallback for unlabelled data.
 */
export function buildCapturedCombatActionDefinition(
    capture: Readonly<SharedBattleCapture>,
    actionId: string,
): CapturedCombatActionBuildResult {
    if (!actionId) throw new TypeError('actionId is required')
    const candidates = capture.animatorEvents
        .map((event, order) => ({ event, order }))
        .filter(({ event }) => (
            event.actionId === actionId
            && event.clip !== undefined
            && event.semantic !== undefined
            && event.clipDuration !== undefined
            && event.clipDuration > 0
        ))
        .sort((a, b) => {
            const aBody = a.event.role?.toLowerCase() === 'body' ? 1 : 0
            const bBody = b.event.role?.toLowerCase() === 'body' ? 1 : 0
            return bBody - aBody
                || (b.event.bindings ?? 0) - (a.event.bindings ?? 0)
                || a.order - b.order
        })
    if (!candidates[0]) {
        return {
            actionId,
            status: 'incomplete',
            hasCapturedEffects: false,
            reasons: ['no captured clip with actionId, semantic and positive duration'],
        }
    }

    const event = candidates[0].event
    const asset = listCapturedAnimationAssets({ ...capture, animatorEvents: [event] })[0]
    if (!asset) {
        return {
            actionId,
            status: 'incomplete',
            hasCapturedEffects: false,
            reasons: ['selected captured clip has no stable asset evidence'],
        }
    }
    const capturedEffectCues = capturedCombatEffectCueDefinitions(capture, actionId)
    const effectCues = capturedEffectCues.filter(cue => cue.timeSeconds <= (event.clipDuration as number))
    const reasons: string[] = []
    if (effectCues.length < capturedEffectCues.length) {
        reasons.push('captured VFX cue after action duration was omitted')
    }
    if (effectCues.length === 0) reasons.push('no complete captured VFX cues')
    const definition: CombatActionDefinition = {
        id: actionId,
        semantic: event.semantic as CombatActionSemantic,
        preferredClips: [event.clip as string],
        durationSeconds: event.clipDuration as number,
        effectCues,
    }
    if (event.speed !== undefined && event.speed > 0) definition.speed = event.speed
    if (event.weight !== undefined && event.weight >= 0) definition.weight = event.weight
    if (event.crossFadeSeconds !== undefined && event.crossFadeSeconds >= 0) {
        definition.fadeSeconds = event.crossFadeSeconds
    }
    return {
        actionId,
        status: 'ready',
        hasCapturedEffects: effectCues.length > 0,
        definition,
        asset,
        reasons,
    }
}

interface PendingCombatAction {
    definition: CombatActionDefinition
    resolution: AnimationResolution
    segments: ResolvedCombatAnimationSegment[]
    durationSeconds: number
    force: boolean
    expiresAtSeconds: number
}

interface ActiveCombatAction {
    definition: CombatActionDefinition
    resolution: AnimationResolution
    segments: ResolvedCombatAnimationSegment[]
    segmentIndex: number
    elapsedSeconds: number
    durationSeconds: number
    phase: CombatActionPhase
    sequence: number
    emittedCueIds: Set<string>
}

interface ResolvedCombatAnimationSegment {
    startSeconds: number
    fadeSeconds: number
    resolution: AnimationResolution
}

const LOOPING_SEMANTICS = new Set<AnimationSemantic>(['idle', 'walk', 'run', 'fall'])
const COMBAT_SEMANTICS = new Set<AnimationSemantic>([
    'basicAttack', 'skill', 'ultimate', 'dodge', 'damage', 'down', 'victory', 'custom',
])

const SEMANTIC_PATTERNS: Readonly<Record<AnimationSemantic, readonly RegExp[]>> = {
    idle: [/^(?:HomeWait\d+_L|CommonWait_L|DungeonWait\w*_L|Wait_L|Standby_L|Idle\w*)$/i, /(?:wait|idle|standby)/i],
    walk: [/(?:^|_)(?:walk|move)(?:\d+)?(?:_|$)/i, /(?:dungeon|locomotion).*walk/i],
    run: [/(?:^|_)(?:run|dash|sprint)(?:\d+)?(?:_|$)/i, /(?:dungeon|locomotion).*run/i],
    jump: [/(?:jump|leap).*(?:start|takeoff|_S|_SE)?/i, /(?:^|_)jump(?:_|$)/i],
    fall: [/(?:fall|airborne|jump.*(?:loop|_L))/i],
    land: [/(?:land|landing|jump.*(?:end|_E|_SE))/i],
    basicAttack: [/(?:normal)?attack\d*/i, /(?:^|_)(?:atk|strike|slash|shot|shoot|combo)\d*(?:_|$)/i],
    skill: [/(?:^|_)(?:skill|ability|command|active)\d*(?:_|$)/i, /(?:single|whole|charge|support)skill/i],
    ultimate: [/(?:magia|doppel|ultimate|finisher|limitbreak|specialattack)/i],
    dodge: [/(?:dodge|evade|avoid|sidestep)/i],
    damage: [/(?:^|_)(?:damage|hit|hurt)(?:_|$)/i],
    down: [/(?:^|_)(?:down|dead|death|knockdown)(?:_|$)/i],
    victory: [/(?:victory|win|result)/i],
    custom: [],
}

const FALLBACK_SEMANTICS: Readonly<Partial<Record<AnimationSemantic, readonly AnimationSemantic[]>>> = {
    walk: ['idle'],
    run: ['walk', 'idle'],
    jump: ['idle'],
    fall: ['idle'],
    land: ['idle'],
}

function assertFiniteNumber(value: number, label: string): number {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`)
    return value
}

function assertNonNegative(value: number, label: string): number {
    assertFiniteNumber(value, label)
    if (value < 0) throw new RangeError(`${label} must be non-negative`)
    return value
}

function assertPositive(value: number, label: string): number {
    assertFiniteNumber(value, label)
    if (value <= 0) throw new RangeError(`${label} must be positive`)
    return value
}

function assertFiniteVector(value: Vector3, label: string): Vector3 {
    assertFiniteNumber(value.x, `${label}.x`)
    assertFiniteNumber(value.y, `${label}.y`)
    assertFiniteNumber(value.z, `${label}.z`)
    return value
}

function assertFiniteQuaternion(value: Quaternion, label: string): Quaternion {
    assertFiniteNumber(value.x, `${label}.x`)
    assertFiniteNumber(value.y, `${label}.y`)
    assertFiniteNumber(value.z, `${label}.z`)
    assertFiniteNumber(value.w, `${label}.w`)
    return value
}

function assertFinitePayload(value: unknown, label: string, seen = new Set<object>()): void {
    if (typeof value === 'number') {
        assertFiniteNumber(value, label)
        return
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return
    if (Array.isArray(value)) {
        value.forEach((entry, index) => assertFinitePayload(entry, `${label}[${index}]`, seen))
        return
    }
    if (typeof value === 'object') {
        if (seen.has(value)) throw new TypeError(`${label} must not contain cycles`)
        seen.add(value)
        for (const [key, entry] of Object.entries(value)) {
            assertFinitePayload(entry, `${label}.${key}`, seen)
        }
        seen.delete(value)
        return
    }
    if (value !== undefined) throw new TypeError(`${label} must be JSON-compatible`)
}

function moveTowardsVector(current: Vector3, target: Vector3, maximumDelta: number): void {
    const delta = target.clone().sub(current)
    const distance = delta.length()
    if (distance <= maximumDelta || distance === 0) {
        current.copy(target)
        return
    }
    current.addScaledVector(delta, maximumDelta / distance)
}

export function normalizeAnimationFamilyName(name: string): string {
    return name
        .replace(/_weapon_[a-z0-9]+(?=_|$)/gi, '')
        .replace(/_\d+$/g, '')
}

function toClipDescriptors(
    clips: readonly (string | AnimationClipDescriptor)[],
): AnimationClipDescriptor[] {
    const result = new Map<string, AnimationClipDescriptor>()
    for (const value of clips) {
        const clip = typeof value === 'string' ? { name: value } : { ...value }
        if (!clip.name || clip.trackCount === 0) continue
        if (clip.duration !== undefined) assertNonNegative(clip.duration, `clip ${clip.name} duration`)
        const family = normalizeAnimationFamilyName(clip.name)
        const previous = result.get(family)
        if (!previous || (clip.trackCount ?? 0) > (previous.trackCount ?? 0)) {
            result.set(family, { ...clip, name: family })
        }
    }
    return [...result.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function scoreSemanticCandidate(
    clip: AnimationClipDescriptor,
    semantic: AnimationSemantic,
    preferred: ReadonlySet<string>,
): AnimationCandidate | undefined {
    const family = normalizeAnimationFamilyName(clip.name)
    const preferredNames = [...preferred]
    const exactPreferred = preferred.has(family.toLowerCase())
    const preferredPrefix = preferredNames.some(name => family.toLowerCase().startsWith(name))
    const patterns = SEMANTIC_PATTERNS[semantic]
    const patternIndex = patterns.findIndex(pattern => pattern.test(family))
    if (!exactPreferred && !preferredPrefix && patternIndex < 0) return undefined

    const reasons: string[] = []
    let tier: AnimationCandidateTier
    let score: number
    if (exactPreferred) {
        tier = 'exact'
        score = 1000
        reasons.push('exact preferred family')
    } else if (preferredPrefix) {
        tier = 'strong'
        score = 850
        reasons.push('preferred family prefix')
    } else if (patternIndex === 0) {
        tier = 'strong'
        score = 700
        reasons.push('primary semantic pattern')
    } else {
        tier = 'weak'
        score = 500 - patternIndex
        reasons.push('secondary semantic pattern')
    }
    if ((clip.trackCount ?? 1) > 0) {
        score += Math.min(100, Math.log2((clip.trackCount ?? 1) + 1) * 10)
        reasons.push('non-empty loaded clip')
    }
    return {
        clip: { ...clip, name: family },
        semantic,
        tier,
        score,
        loop: LOOPING_SEMANTICS.has(semantic),
        reasons,
    }
}

export function resolveAnimationCandidates(
    clips: readonly (string | AnimationClipDescriptor)[],
    semantic: AnimationSemantic,
    options: ResolveAnimationOptions = {},
): AnimationResolution {
    const descriptors = toClipDescriptors(clips)
    const preferred = new Set(
        (options.preferredNames ?? []).map(name => normalizeAnimationFamilyName(name).toLowerCase()),
    )
    const candidates = descriptors
        .map(clip => scoreSemanticCandidate(clip, semantic, preferred))
        .filter((candidate): candidate is AnimationCandidate => candidate !== undefined)
        .sort((a, b) => b.score - a.score || a.clip.name.localeCompare(b.clip.name))
    if (candidates[0]) {
        return { semantic, status: 'matched', selected: candidates[0], candidates }
    }

    const allowFallback = options.allowFallback ?? !COMBAT_SEMANTICS.has(semantic)
    if (allowFallback) {
        for (const fallbackSemantic of FALLBACK_SEMANTICS[semantic] ?? []) {
            const fallback = resolveAnimationCandidates(descriptors, fallbackSemantic, {
                allowFallback: false,
            })
            if (fallback.selected) {
                const selected: AnimationCandidate = {
                    ...fallback.selected,
                    semantic,
                    tier: 'fallback',
                    score: fallback.selected.score - 1000,
                    reasons: [...fallback.selected.reasons, `fallback for ${semantic}`],
                }
                return { semantic, status: 'fallback', selected, candidates: [selected] }
            }
        }
    }
    return { semantic, status: 'unavailable', candidates: [] }
}

export function createViewerCharacterAnimationPort(
    character: ViewerCharacterAnimationLike,
): CharacterAnimationPort {
    return {
        listClips: () => character.animations.map(name => ({ name })),
        play: (name, options) => {
            character.animation.play(name, options.loop)
            character.animation.mixer.timeScale = options.speed
        },
        clear: () => character.animation.clear?.(),
        getDuration: name => (
            character.animation.current === normalizeAnimationFamilyName(name)
                ? character.animation.duration
                : undefined
        ),
        setTime: timeSeconds => {
            character.animation.time = timeSeconds
        },
        setSpeed: speed => {
            character.animation.mixer.timeScale = speed
        },
    }
}

/** Minimal deterministic ground used by unit tests and empty preview stages. */
export class FlatGroundCollisionWorld implements CharacterCollisionWorld, CharacterGroundQuery {
    readonly height: number

    constructor(height = 0) {
        this.height = assertFiniteNumber(height, 'height')
    }

    resolveMotion(query: Readonly<CharacterMotionQuery>): CharacterMotionResult {
        const position = query.startPosition.clone().add(query.desiredDisplacement)
        const velocity = query.velocity.clone()
        const grounded = position.y <= this.height && velocity.y <= 0
        const contacts: CharacterCollisionContact[] = []
        if (grounded) {
            position.y = this.height
            velocity.y = 0
            contacts.push({
                point: new Vector3(position.x, this.height, position.z),
                normal: new Vector3(0, 1, 0),
                objectId: 'flat-ground',
            })
        }
        return {
            position,
            velocity,
            grounded,
            groundNormal: grounded ? new Vector3(0, 1, 0) : undefined,
            contacts,
        }
    }

    queryGround(query: Readonly<CharacterGroundQueryInput>): CharacterGroundHit | null {
        const distance = query.position.y - this.height
        if (distance < -query.collider.skinWidth || distance > query.maxDistance) return null
        return {
            point: new Vector3(query.position.x, this.height, query.position.z),
            normal: new Vector3(0, 1, 0),
            distance,
            walkable: true,
            objectId: 'flat-ground',
        }
    }
}

export class CharacterLocomotionController {
    readonly characterId: string
    readonly transform: CharacterTransform
    readonly config: CharacterLocomotionConfig
    readonly velocity = new Vector3()

    private readonly animation?: CharacterAnimationPort
    private readonly collisionWorld?: CharacterCollisionWorld
    private readonly groundQuery?: CharacterGroundQuery
    private readonly secondaryPhysics?: CharacterSecondaryPhysicsAdapter
    private readonly secondaryPhysicsSceneCollision?: SecondaryPhysicsSceneCollisionWorld
    private readonly rootMotion?: CharacterRootMotionAdapter
    private readonly colliderTemplate: CharacterColliderShape
    private readonly onStateChange?: CharacterLocomotionControllerOptions['onStateChange']
    private readonly onActionEvent?: CharacterLocomotionControllerOptions['onActionEvent']
    private readonly onEffectCue?: CharacterLocomotionControllerOptions['onEffectCue']
    private readonly onPhysicsIssue?: CharacterLocomotionControllerOptions['onPhysicsIssue']
    private readonly locomotionAnimations: Readonly<Partial<Record<LocomotionState, readonly string[]>>>
    private jumpLocomotionAnimations: Readonly<Partial<Record<
        JumpLocomotionMode,
        Readonly<Partial<Record<JumpLocomotionState, readonly string[]>>>
    >>>
    private jumpLocomotionAnimationOverride?: Readonly<Partial<Record<
        JumpLocomotionMode,
        Readonly<Partial<Record<JumpLocomotionState, readonly string[]>>>
    >>>

    private input: CharacterLocomotionInput = {
        moveX: 0,
        moveZ: 0,
        run: false,
        jumpPressed: false,
    }
    private jumpQueued = false
    private jumpTakeoffRemainingSeconds = 0
    private accumulatorSeconds = 0
    private elapsedSeconds = 0
    private landingRemainingSeconds = 0
    private _state: LocomotionState = 'idle'
    private _jumpMode: JumpLocomotionMode = 'standing'
    private _grounded: boolean
    private contacts: readonly CharacterCollisionContact[] = []
    private lastPhysicsResult?: SecondaryPhysicsStepResult
    private secondaryPhysicsActive = true
    private secondaryPhysicsBlendWeight = 1
    private rootMotionMode: RootMotionMode
    private teleported = false
    private lastLocomotionAnimation?: string

    private readonly actionDefinitions = new Map<string, CombatActionDefinition>()
    private readonly actionQueue: PendingCombatAction[] = []
    private activeAction?: ActiveCombatAction
    private actionSequence = 0
    private readonly stepDiagnostics: CharacterLocomotionStepDiagnostics = {
        advanceCalls: 0,
        fixedSteps: 0,
        collisionQueries: 0,
        groundQueries: 0,
        groundQueriesSkippedGrounded: 0,
    }

    constructor(options: CharacterLocomotionControllerOptions) {
        if (!options.characterId) throw new TypeError('characterId is required')
        this.characterId = options.characterId
        this.transform = options.transform
        assertFiniteVector(this.transform.position, 'transform.position')
        assertFiniteQuaternion(this.transform.quaternion, 'transform.quaternion')
        this.animation = options.animation
        this.collisionWorld = options.collisionWorld
        this.groundQuery = options.groundQuery
        this.secondaryPhysics = options.secondaryPhysics
        this.secondaryPhysicsSceneCollision = options.secondaryPhysicsSceneCollision
        this.rootMotion = options.rootMotion
        this.onStateChange = options.onStateChange
        this.onActionEvent = options.onActionEvent
        this.onEffectCue = options.onEffectCue
        this.onPhysicsIssue = options.onPhysicsIssue
        this.locomotionAnimations = Object.freeze(Object.fromEntries(
            Object.entries(options.locomotionAnimations ?? {}).map(([state, names]) => [
                state,
                Object.freeze((typeof names === 'string' ? [names] : names).filter(Boolean)),
            ]),
        ))
        this.jumpLocomotionAnimations = Object.freeze(Object.fromEntries(
            Object.entries(options.jumpLocomotionAnimations ?? {}).map(([mode, states]) => [
                mode,
                Object.freeze(Object.fromEntries(
                    Object.entries(states ?? {}).map(([state, names]) => [
                        state,
                        Object.freeze((typeof names === 'string' ? [names] : names).filter(Boolean)),
                    ]),
                )),
            ]),
        ))
        this.config = this.createConfig(options.config)
        this.colliderTemplate = Object.freeze({
            radius: this.config.colliderRadius,
            height: this.config.colliderHeight,
            center: new Vector3(
                this.config.colliderCenterX,
                this.config.colliderCenterY,
                this.config.colliderCenterZ,
            ),
            upAxis: this.config.colliderUpAxis,
            skinWidth: this.config.colliderSkinWidth,
        })
        this._grounded = options.initiallyGrounded ?? false
        this.rootMotionMode = options.rootMotionMode ?? 'controlled'
        this.configureRootMotion()
        this.secondaryPhysics?.setBlendWeight?.(this.secondaryPhysicsBlendWeight)
        this.secondaryPhysics?.setActive?.(this.secondaryPhysicsActive)
        this.syncLocomotionAnimation()
    }

    private createConfig(overrides?: Partial<CharacterLocomotionConfig>): CharacterLocomotionConfig {
        const config = { ...DEFAULT_CHARACTER_LOCOMOTION_CONFIG, ...overrides }
        assertPositive(config.fixedStepSeconds, 'fixedStepSeconds')
        assertPositive(config.maxSubSteps, 'maxSubSteps')
        if (!Number.isInteger(config.maxSubSteps)) throw new TypeError('maxSubSteps must be an integer')
        for (const key of [
            'walkSpeed', 'runSpeed', 'groundAcceleration', 'groundDeceleration',
            'airAcceleration', 'gravity', 'jumpSpeed', 'jumpTakeoffDelaySeconds', 'terminalFallSpeed',
            'turnSpeedRadians', 'landingDurationSeconds', 'groundSnapDistance',
            'maximumSlopeRadians', 'colliderRadius', 'colliderHeight',
            'colliderSkinWidth', 'actionBufferSeconds', 'remainingPenetrationTolerance',
        ] as const) {
            assertNonNegative(config[key], key)
        }
        assertFiniteNumber(config.colliderCenterX, 'colliderCenterX')
        assertFiniteNumber(config.colliderCenterY, 'colliderCenterY')
        assertFiniteNumber(config.colliderCenterZ, 'colliderCenterZ')
        if (config.colliderUpAxis !== 'x' && config.colliderUpAxis !== 'y' && config.colliderUpAxis !== 'z') {
            throw new TypeError('colliderUpAxis must be x, y or z')
        }
        if (config.runSpeed < config.walkSpeed) {
            throw new RangeError('runSpeed must be greater than or equal to walkSpeed')
        }
        return Object.freeze(config)
    }

    get collider(): CharacterColliderShape {
        return this.colliderSnapshot()
    }

    private colliderSnapshot(): CharacterColliderShape {
        return {
            radius: this.colliderTemplate.radius,
            height: this.colliderTemplate.height,
            center: this.colliderTemplate.center.clone(),
            upAxis: this.colliderTemplate.upAxis,
            skinWidth: this.colliderTemplate.skinWidth,
        }
    }

    get state(): LocomotionState {
        return this._state
    }

    get grounded(): boolean {
        return this._grounded
    }

    get action(): CombatActionSnapshot | undefined {
        return this.activeAction ? this.snapshotAction(this.activeAction) : undefined
    }

    setInput(input: Readonly<CharacterLocomotionInput>): void {
        assertFiniteNumber(input.moveX, 'input.moveX')
        assertFiniteNumber(input.moveZ, 'input.moveZ')
        if (input.facingX !== undefined) assertFiniteNumber(input.facingX, 'input.facingX')
        if (input.facingZ !== undefined) assertFiniteNumber(input.facingZ, 'input.facingZ')
        const movementLength = Math.hypot(input.moveX, input.moveZ)
        const movementScale = movementLength > 1 ? 1 / movementLength : 1
        this.input = {
            moveX: input.moveX * movementScale,
            moveZ: input.moveZ * movementScale,
            run: input.run,
            jumpPressed: input.jumpPressed,
            facingX: input.facingX,
            facingZ: input.facingZ,
        }
        if (input.jumpPressed) this.jumpQueued = true
    }

    /**
     * Stop horizontal carry without changing the actor placement or vertical
     * jump state.  Controller-owned jump donors use this at the exact landing
     * hand-off so a released input cannot leak the pre-landing air velocity
     * into an extra post-landing slide.
     */
    stopHorizontalMotion(): void {
        this.velocity.x = 0
        this.velocity.z = 0
    }

    /** Release TPS movement without a simulation step, teleport, or pose write.
     * The Viewer hands animation ownership back to its previously selected family.
     * An authored combat action keeps its own lifecycle and is not cancelled here.
     */
    releaseMovement(): void {
        this.setInput({ moveX: 0, moveZ: 0, run: false, jumpPressed: false })
        if (this.activeAction) return
        this.velocity.set(0, 0, 0)
        this.jumpQueued = false
        this.jumpTakeoffRemainingSeconds = 0
        this.landingRemainingSeconds = 0
        this.accumulatorSeconds = 0
        this._jumpMode = 'standing'
        this.lastLocomotionAnimation = undefined
        const next = this._grounded ? 'idle' : 'fall'
        if (this._state !== next) {
            const previous = this._state
            this._state = next
            this.onStateChange?.(next, previous)
        }
    }

    /** Replace base locomotion jump poses without changing action overrides,
     * position, velocity, grounded state or the current physical jump phase. */
    setJumpLocomotionAnimations(animations: JumpLocomotionAnimationMap): void {
        this.jumpLocomotionAnimations = Object.freeze(Object.fromEntries(Object.entries(animations).map(([mode,states])=>[
            mode,Object.freeze(Object.fromEntries(Object.entries(states??{}).map(([state,names])=>[state,Object.freeze((typeof names==='string'?[names]:names).filter(Boolean))]))),
        ])))
        if(this.jumpLocomotionAnimationOverride)return
        this.lastLocomotionAnimation=undefined
        if(this._state==='jump'||this._state==='fall'||this._state==='land')this.syncLocomotionAnimation()
    }

    setJumpLocomotionAnimationOverride(animations?: JumpLocomotionAnimationMap): void {
        this.jumpLocomotionAnimationOverride = animations
            ? Object.freeze(Object.fromEntries(
                Object.entries(animations).map(([mode, states]) => [
                    mode,
                    Object.freeze(Object.fromEntries(
                        Object.entries(states ?? {}).map(([state, names]) => [
                            state,
                            Object.freeze((typeof names === 'string' ? [names] : names).filter(Boolean)),
                        ]),
                    )),
                ]),
            ))
            : undefined
        this.lastLocomotionAnimation = undefined
        if (this._state === 'jump' || this._state === 'fall' || this._state === 'land') {
            this.syncLocomotionAnimation()
        }
    }

    setRootMotionMode(mode: RootMotionMode): void {
        this.rootMotionMode = mode
        this.configureRootMotion()
    }

    setSecondaryPhysicsState(state: Readonly<SecondaryPhysicsControlState>): void {
        if (typeof state.active !== 'boolean') throw new TypeError('secondary physics active must be boolean')
        const blendWeight = state.blendWeight ?? this.secondaryPhysicsBlendWeight
        assertNonNegative(blendWeight, 'secondary physics blendWeight')
        if (blendWeight > 1) throw new RangeError('secondary physics blendWeight must not exceed 1')
        this.secondaryPhysicsBlendWeight = blendWeight
        this.secondaryPhysics?.setBlendWeight?.(blendWeight)
        if (state.reset) {
            this.secondaryPhysics?.reset?.(
                this.transform.position.clone(),
                this.transform.quaternion.clone(),
            )
        }
        this.secondaryPhysicsActive = state.active
        this.secondaryPhysics?.setActive?.(state.active)
    }

    private configureRootMotion(): void {
        this.rootMotion?.configure(this.rootMotionMode === 'controlled' ? 'suppress' : 'extract')
    }

    registerAction(definition: Readonly<CombatActionDefinition>): void {
        if (!definition.id) throw new TypeError('action id is required')
        if (definition.exactClip !== undefined && !definition.exactClip.trim()) {
            throw new TypeError(`action ${definition.id} exactClip must not be empty`)
        }
        const duration = definition.durationSeconds
        if (duration !== undefined) assertPositive(duration, `action ${definition.id} durationSeconds`)
        const speed = definition.speed ?? 1
        const weight = definition.weight ?? 1
        const fade = definition.fadeSeconds ?? 0
        const movementScale = definition.movementScale ?? 1
        assertPositive(speed, `action ${definition.id} speed`)
        assertNonNegative(weight, `action ${definition.id} weight`)
        assertNonNegative(fade, `action ${definition.id} fadeSeconds`)
        assertNonNegative(movementScale, `action ${definition.id} movementScale`)
        const animationSegments = definition.animationSegments ?? []
        let previousSegmentStart = -1
        for (const [index, segment] of animationSegments.entries()) {
            if (!segment.clip?.trim()) {
                throw new TypeError(`action ${definition.id} animationSegments[${index}].clip is required`)
            }
            assertNonNegative(
                segment.startSeconds,
                `action ${definition.id} animationSegments[${index}].startSeconds`,
            )
            if (index === 0 && segment.startSeconds !== 0) {
                throw new RangeError(`action ${definition.id} first animation segment must start at zero`)
            }
            if (segment.startSeconds <= previousSegmentStart) {
                throw new RangeError(`action ${definition.id} animation segments must have increasing start times`)
            }
            if (duration !== undefined && segment.startSeconds >= duration) {
                throw new RangeError(`action ${definition.id} animation segment ${index} starts after duration`)
            }
            assertNonNegative(
                segment.fadeSeconds ?? fade,
                `action ${definition.id} animationSegments[${index}].fadeSeconds`,
            )
            previousSegmentStart = segment.startSeconds
        }
        if (definition.activeWindow) {
            assertNonNegative(definition.activeWindow.startSeconds, `action ${definition.id} active start`)
            assertNonNegative(definition.activeWindow.endSeconds, `action ${definition.id} active end`)
            if (definition.activeWindow.endSeconds < definition.activeWindow.startSeconds) {
                throw new RangeError(`action ${definition.id} active window is reversed`)
            }
        }
        for (const [index, window] of (definition.cancelWindows ?? []).entries()) {
            assertNonNegative(window.startSeconds, `action ${definition.id} cancelWindows[${index}].startSeconds`)
            assertNonNegative(window.endSeconds, `action ${definition.id} cancelWindows[${index}].endSeconds`)
            if (window.endSeconds < window.startSeconds) {
                throw new RangeError(`action ${definition.id} cancel window ${index} is reversed`)
            }
        }
        const cueIds = new Set<string>()
        for (const [index, cue] of (definition.effectCues ?? []).entries()) {
            if (!cue.id || !cue.effectId) throw new TypeError(`action ${definition.id} cue ${index} needs id and effectId`)
            if (cueIds.has(cue.id)) throw new TypeError(`action ${definition.id} has duplicate cue id ${cue.id}`)
            cueIds.add(cue.id)
            assertNonNegative(cue.timeSeconds, `action ${definition.id} cue ${cue.id} timeSeconds`)
            if (cue.lifetimeSeconds !== undefined) {
                assertNonNegative(cue.lifetimeSeconds, `action ${definition.id} cue ${cue.id} lifetimeSeconds`)
            }
            if (duration !== undefined && cue.timeSeconds > duration) {
                throw new RangeError(`action ${definition.id} cue ${cue.id} is after the action duration`)
            }
            assertFinitePayload(cue.payload, `action ${definition.id} cue ${cue.id} payload`)
        }
        this.actionDefinitions.set(definition.id, {
            ...definition,
            preferredClips: definition.preferredClips ? [...definition.preferredClips] : undefined,
            animationSegments: definition.animationSegments?.map(segment => ({ ...segment })),
            cancelWindows: definition.cancelWindows?.map(window => ({
                ...window,
                into: window.into ? [...window.into] : undefined,
            })),
            effectCues: definition.effectCues
                ?.map(cue => ({ ...cue }))
                .sort((a, b) => a.timeSeconds - b.timeSeconds),
        })
    }

    requestAction(
        actionId: string,
        options: Readonly<CombatActionRequestOptions> = {},
    ): CombatActionRequestResult {
        const definition = this.actionDefinitions.get(actionId)
        if (!definition) {
            const resolution: AnimationResolution = {
                semantic: 'custom',
                status: 'unavailable',
                candidates: [],
            }
            this.rejectAction(actionId, 'action definition is not registered')
            return { accepted: false, actionId, resolution, reason: 'action definition is not registered' }
        }
        if (!this.animation) {
            const resolution: AnimationResolution = {
                semantic: definition.semantic,
                status: 'unavailable',
                candidates: [],
            }
            this.rejectAction(actionId, 'animation port is not bound')
            return { accepted: false, actionId, resolution, reason: 'animation port is not bound' }
        }
        const loadedClips = this.animation.listClips()
        const resolveExact = (name: string): AnimationResolution => {
            const exactClip = loadedClips.find(clip => (
                normalizeAnimationFamilyName(clip.name).toLowerCase()
                === normalizeAnimationFamilyName(name).toLowerCase()
            ))
            return exactClip
                ? {
                    semantic: definition.semantic,
                    status: 'matched',
                    selected: {
                        clip: exactClip,
                        semantic: definition.semantic,
                        tier: 'exact',
                        score: Number.MAX_SAFE_INTEGER,
                        loop: false,
                        reasons: ['exact user-configured loaded clip'],
                    },
                    candidates: [],
                }
                : { semantic: definition.semantic, status: 'unavailable', candidates: [] }
        }
        const requestedSegments = definition.animationSegments ?? []
        const segments: ResolvedCombatAnimationSegment[] = requestedSegments.length
            ? requestedSegments.map(segment => ({
                startSeconds: segment.startSeconds,
                fadeSeconds: segment.fadeSeconds ?? definition.fadeSeconds ?? 0.08,
                resolution: resolveExact(segment.clip),
            }))
            : []
        const missingSegmentIndex = segments.findIndex(segment => !segment.resolution.selected)
        if (missingSegmentIndex >= 0) {
            const clip = requestedSegments[missingSegmentIndex].clip
            const resolution = segments[missingSegmentIndex].resolution
            const reason = `action segment ${missingSegmentIndex} clip ${clip} is not loaded`
            this.rejectAction(actionId, reason)
            return { accepted: false, actionId, resolution, reason }
        }
        const resolution: AnimationResolution = segments[0]?.resolution
            ?? (definition.exactClip
                ? resolveExact(definition.exactClip)
                : resolveAnimationCandidates(
                    loadedClips,
                    definition.semantic,
                    { preferredNames: definition.preferredClips, allowFallback: false },
                ))
        const selected = resolution.selected
        if (!selected) {
            this.rejectAction(actionId, `no loaded clip matches ${definition.semantic}`)
            return {
                accepted: false,
                actionId,
                resolution,
                reason: `no loaded clip matches ${definition.semantic}`,
            }
        }
        const lastSegment = segments[segments.length - 1]
        const lastSegmentClip = lastSegment?.resolution.selected?.clip
        const durationSeconds = definition.durationSeconds
            ?? (lastSegment && lastSegmentClip
                ? lastSegment.startSeconds
                    + (lastSegmentClip.duration ?? this.animation.getDuration?.(lastSegmentClip.name) ?? 0)
                : selected.clip.duration ?? this.animation.getDuration?.(selected.clip.name))
        if (durationSeconds === undefined || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
            this.rejectAction(actionId, 'action duration is unavailable')
            return { accepted: false, actionId, resolution, reason: 'action duration is unavailable' }
        }
        const bufferSeconds = options.bufferSeconds ?? this.config.actionBufferSeconds
        assertNonNegative(bufferSeconds, 'action bufferSeconds')
        this.actionQueue.push({
            definition,
            resolution,
            segments: segments.length ? segments : [{
                startSeconds: 0,
                fadeSeconds: definition.fadeSeconds ?? 0.08,
                resolution,
            }],
            durationSeconds,
            force: options.force ?? false,
            expiresAtSeconds: this.elapsedSeconds + bufferSeconds,
        })
        this.onActionEvent?.({ type: 'queued', characterId: this.characterId, actionId })
        return { accepted: true, actionId, resolution }
    }

    private rejectAction(actionId: string, reason: string): void {
        this.onActionEvent?.({
            type: 'rejected',
            characterId: this.characterId,
            actionId,
            reason,
        })
    }

    advance(deltaSeconds: number): CharacterLocomotionSnapshot {
        assertNonNegative(deltaSeconds, 'deltaSeconds')
        this.stepDiagnostics.advanceCalls += 1
        this.accumulatorSeconds += deltaSeconds
        let steps = 0
        const stepTolerance = this.config.fixedStepSeconds * 1e-9
        while (
            this.accumulatorSeconds + stepTolerance >= this.config.fixedStepSeconds
            && steps < this.config.maxSubSteps
        ) {
            this.stepFixed()
            this.accumulatorSeconds -= this.config.fixedStepSeconds
            if (Math.abs(this.accumulatorSeconds) <= stepTolerance) this.accumulatorSeconds = 0
            steps += 1
        }
        if (steps === this.config.maxSubSteps) {
            this.accumulatorSeconds = Math.min(
                this.accumulatorSeconds,
                this.config.fixedStepSeconds,
            )
        }
        return this.snapshot()
    }

    stepFixed(): CharacterLocomotionSnapshot {
        this.stepDiagnostics.fixedSteps += 1
        const dt = this.config.fixedStepSeconds
        this.assertRequiredPhysicsBindings()
        this.processActionQueue()

        const startPosition = this.transform.position.clone()
        const wasGrounded = this._grounded
        const movementScale = this.activeAction?.definition.movementScale ?? 1
        this.updateHorizontalVelocity(dt, movementScale)

        let justJumped = false
        if (
            this.jumpQueued
            && this._grounded
            && movementScale > 0
            && this.jumpTakeoffRemainingSeconds <= 0
        ) {
            this.landingRemainingSeconds = 0
            this._jumpMode = this.classifyJumpMode()
            this.jumpTakeoffRemainingSeconds = this.config.jumpTakeoffDelaySeconds
            if (this.jumpTakeoffRemainingSeconds <= 0) {
                this.velocity.y = this.config.jumpSpeed
                this._grounded = false
                justJumped = true
            }
        }
        this.jumpQueued = false
        this.input.jumpPressed = false

        if (this.jumpTakeoffRemainingSeconds > 0) {
            this.velocity.y = 0
            this.jumpTakeoffRemainingSeconds = Math.max(
                0,
                this.jumpTakeoffRemainingSeconds - dt,
            )
            if (this.jumpTakeoffRemainingSeconds <= dt * 1e-6) {
                this.jumpTakeoffRemainingSeconds = 0
                this.velocity.y = this.config.jumpSpeed
                this._grounded = false
                justJumped = true
            }
        }

        if (this.jumpTakeoffRemainingSeconds > 0) {
            this.velocity.y = 0
        } else if (!this._grounded) {
            this.velocity.y = Math.max(
                -this.config.terminalFallSpeed,
                this.velocity.y - this.config.gravity * dt,
            )
        } else if (this.velocity.y < 0) {
            this.velocity.y = 0
        }

        const displacement = this.velocity.clone().multiplyScalar(dt)
        const rootMotionDelta = this.consumeRootMotion(dt)
        if (rootMotionDelta) {
            const translation = rootMotionDelta.translation.clone()
            if (rootMotionDelta.space !== 'world') translation.applyQuaternion(this.transform.quaternion)
            if (this.rootMotionMode === 'animation') {
                displacement.x = translation.x
                displacement.z = translation.z
            } else {
                displacement.x += translation.x
                displacement.z += translation.z
            }
            displacement.y += translation.y
        }

        let nextPosition = startPosition.clone().add(displacement)
        let grounded = false
        let contacts: readonly CharacterCollisionContact[] = []
        if (this.collisionWorld) {
            this.stepDiagnostics.collisionQueries += 1
            const result = this.collisionWorld.resolveMotion({
                characterId: this.characterId,
                startPosition: startPosition.clone(),
                desiredDisplacement: displacement.clone(),
                velocity: this.velocity.clone(),
                collider: this.colliderSnapshot(),
                deltaSeconds: dt,
                wasGrounded,
            })
            assertFiniteVector(result.position, 'collision result position')
            nextPosition = result.position.clone()
            if (result.velocity) this.velocity.copy(assertFiniteVector(result.velocity, 'collision result velocity'))
            grounded = result.grounded
            contacts = (result.contacts ?? []).map(contact => ({
                ...contact,
                point: assertFiniteVector(contact.point, 'contact point').clone(),
                normal: assertFiniteVector(contact.normal, 'contact normal').clone(),
            }))
        }

        if (!justJumped && this.groundQuery && this.velocity.y <= 0) {
            if (grounded) {
                this.stepDiagnostics.groundQueriesSkippedGrounded += 1
            } else {
                this.stepDiagnostics.groundQueries += 1
                const hit = this.groundQuery.queryGround({
                    characterId: this.characterId,
                    position: nextPosition.clone(),
                    maxDistance: this.config.groundSnapDistance,
                    collider: this.colliderSnapshot(),
                })
                if (hit) {
                    assertFiniteVector(hit.point, 'ground hit point')
                    assertFiniteVector(hit.normal, 'ground hit normal')
                    assertFiniteNumber(hit.distance, 'ground hit distance')
                    const walkable = hit.walkable !== false
                        && hit.normal.y >= Math.cos(this.config.maximumSlopeRadians)
                    if (walkable && hit.distance <= this.config.groundSnapDistance) {
                        nextPosition.y = hit.point.y
                        this.velocity.y = 0
                        grounded = true
                    }
                }
            }
        }

        this.transform.position.copy(nextPosition)
        this._grounded = grounded
        if (grounded && this.velocity.y < 0) this.velocity.y = 0
        if (grounded && !wasGrounded && !this.hasMovementIntent()
            && !this.activeAction && this.rootMotionMode === 'controlled') {
            this.stopHorizontalMotion()
        }
        this.updateFacing(dt, rootMotionDelta?.rotation)
        this.contacts = contacts
        this.updateState(wasGrounded, dt)
        this.advanceActiveAction(dt)
        this.elapsedSeconds += dt
        this.stepSecondaryPhysics(startPosition, dt)
        this.teleported = false
        return this.snapshot()
    }

    getStepDiagnostics(): Readonly<CharacterLocomotionStepDiagnostics> {
        return { ...this.stepDiagnostics }
    }

    private updateHorizontalVelocity(deltaSeconds: number, movementScale: number): void {
        // Do not translate a frozen landing pose across the floor. A new jump
        // may still interrupt recovery, and explicit actions retain root motion.
        if (this._grounded && this.landingRemainingSeconds > 0 && !this.hasMovementIntent() && !this.jumpQueued
            && !this.activeAction && this.rootMotionMode === 'controlled') {
            this.stopHorizontalMotion()
            return
        }
        const direction = new Vector3(this.input.moveX, 0, this.input.moveZ)
        const magnitude = Math.min(1, direction.length())
        if (magnitude > 0) direction.normalize()
        const requestedSpeed = (this.input.run ? this.config.runSpeed : this.config.walkSpeed)
            * magnitude
            * movementScale
        const target = direction.multiplyScalar(requestedSpeed)
        const horizontal = new Vector3(this.velocity.x, 0, this.velocity.z)
        const acceleration = this._grounded
            ? (magnitude > 0 ? this.config.groundAcceleration : this.config.groundDeceleration)
            : this.config.airAcceleration
        moveTowardsVector(horizontal, target, acceleration * deltaSeconds)
        this.velocity.x = horizontal.x
        this.velocity.z = horizontal.z
    }

    private hasMovementIntent(): boolean {
        return Math.hypot(this.input.moveX, this.input.moveZ) > 0.001
            && (this.activeAction?.definition.movementScale ?? 1) > 0
    }

    private classifyJumpMode(): JumpLocomotionMode {
        const movementIntent = Math.hypot(this.input.moveX, this.input.moveZ)
        const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z)
        if (
            (this.input.run && movementIntent > 0.05)
            || horizontalSpeed > (this.config.walkSpeed + this.config.runSpeed) * 0.5
        ) return 'running'
        if (movementIntent > 0.05 || horizontalSpeed > Math.max(0.08, this.config.walkSpeed * 0.18)) {
            return 'walking'
        }
        return 'standing'
    }

    private consumeRootMotion(deltaSeconds: number): RootMotionDelta | undefined {
        if (this.rootMotionMode === 'controlled') return undefined
        if (!this.rootMotion) return undefined
        const delta = this.rootMotion.consumeDelta(deltaSeconds)
        assertFiniteVector(delta.translation, 'root motion translation')
        if (delta.rotation) assertFiniteQuaternion(delta.rotation, 'root motion rotation')
        return {
            translation: delta.translation.clone(),
            rotation: delta.rotation?.clone().normalize(),
            space: delta.space ?? 'local',
        }
    }

    private updateFacing(deltaSeconds: number, rootMotionRotation?: Quaternion): void {
        const explicitFacing = this.input.facingX !== undefined && this.input.facingZ !== undefined
            ? new Vector3(this.input.facingX, 0, this.input.facingZ)
            : undefined
        const movementFacing = new Vector3(this.velocity.x, 0, this.velocity.z)
        const facing = explicitFacing && explicitFacing.lengthSq() > 1e-10
            ? explicitFacing
            : movementFacing
        if (this.rootMotionMode !== 'animation' && facing.lengthSq() > 1e-10) {
            facing.normalize()
            const yaw = Math.atan2(facing.x, facing.z)
            const target = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw)
            this.transform.quaternion.rotateTowards(target, this.config.turnSpeedRadians * deltaSeconds)
        }
        if (rootMotionRotation) {
            this.transform.quaternion.multiply(rootMotionRotation).normalize()
        }
        assertFiniteQuaternion(this.transform.quaternion, 'transform quaternion')
    }

    private updateState(wasGrounded: boolean, deltaSeconds: number): void {
        let next: LocomotionState
        if (this.jumpTakeoffRemainingSeconds > 0) {
            next = 'jump'
            this.landingRemainingSeconds = 0
        } else if (!this._grounded) {
            next = this.velocity.y > 0 ? 'jump' : 'fall'
            this.landingRemainingSeconds = 0
        } else {
            if (!wasGrounded) this.landingRemainingSeconds = this.config.landingDurationSeconds
            // A moving landing is the next stride, not a compulsory idle beat.
            // Keep the collision-resolved speed and blend into a matched gait.
            if (this.hasMovementIntent() && !this.jumpLocomotionAnimationOverride) this.landingRemainingSeconds = 0
            if (this.landingRemainingSeconds > 0) {
                next = 'land'
                this.landingRemainingSeconds = Math.max(0, this.landingRemainingSeconds - deltaSeconds)
            } else {
                const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z)
                if (horizontalSpeed < 1e-4) next = 'idle'
                else if (this.input.run && horizontalSpeed > this.config.walkSpeed) next = 'run'
                else next = 'walk'
            }
        }
        this.setState(next)
    }

    private setState(next: LocomotionState): void {
        if (next === this._state) return
        const previous = this._state
        this._state = next
        this.onStateChange?.(next, previous)
        this.syncLocomotionAnimation(previous)
    }

    private syncLocomotionAnimation(previous?: LocomotionState): void {
        if (!this.animation || this.activeAction) return
        const loadedClips = this.animation.listClips()
        const jumpState = this._state === 'jump' || this._state === 'fall' || this._state === 'land'
            ? this._state
            : undefined
        const modeSpecific = jumpState
            ? (this.jumpLocomotionAnimationOverride ?? this.jumpLocomotionAnimations)
                [this._jumpMode]?.[jumpState] ?? []
            : []
        const explicitNames = modeSpecific.length > 0
            ? modeSpecific
            : this.locomotionAnimations[this._state] ?? []
        const explicit = explicitNames
            .map(name => normalizeAnimationFamilyName(name).toLowerCase())
            .map(name => loadedClips.find(clip => normalizeAnimationFamilyName(clip.name).toLowerCase() === name))
            .find((clip): clip is AnimationClipDescriptor => clip !== undefined)
        const selected = explicit
            ? {
                clip: explicit,
                loop: LOOPING_SEMANTICS.has(this._state),
            }
            : resolveAnimationCandidates(loadedClips, this._state).selected
        if (!selected || selected.clip.name === this.lastLocomotionAnimation) return
        const contact = this._grounded && (this._state === 'land'
            || previous === 'land' || previous === 'fall' || previous === 'jump')
        const resumeGait = contact && (this._state === 'walk' || this._state === 'run')
        this.animation.play(selected.clip.name, {
            loop: selected.loop,
            speed: 1,
            weight: 1,
            fadeSeconds: resumeGait ? 0.16 : this._state === 'land' ? 0.06 : 0.1,
            contactTransition: contact,
            resumeGroundedGait: resumeGait,
        })
        this.lastLocomotionAnimation = selected.clip.name
    }

    private processActionQueue(): void {
        while (this.actionQueue[0] && this.actionQueue[0].expiresAtSeconds < this.elapsedSeconds) {
            const expired = this.actionQueue.shift()
            if (expired) this.rejectAction(expired.definition.id, 'buffered action expired')
        }
        const pending = this.actionQueue[0]
        if (!pending) return
        if (!this.activeAction) {
            this.actionQueue.shift()
            this.startAction(pending)
            return
        }
        if (pending.force || this.canCancelInto(this.activeAction, pending.definition.semantic)) {
            this.actionQueue.shift()
            const previous = this.snapshotAction(this.activeAction)
            this.onActionEvent?.({
                type: 'cancelled',
                characterId: this.characterId,
                action: previous,
                byActionId: pending.definition.id,
            })
            this.startAction(pending)
        }
    }

    private canCancelInto(active: ActiveCombatAction, incoming: CombatActionSemantic): boolean {
        return (active.definition.cancelWindows ?? []).some(window => (
            active.elapsedSeconds >= window.startSeconds
            && active.elapsedSeconds <= window.endSeconds
            && (!window.into || window.into.includes(incoming))
        ))
    }

    private startAction(pending: PendingCombatAction): void {
        const firstSegment = pending.segments[0]
        const selected = firstSegment?.resolution.selected
        if (!selected || !this.animation) return
        const definition = pending.definition
        const speed = definition.speed ?? 1
        const weight = definition.weight ?? 1
        const fadeSeconds = firstSegment.fadeSeconds
        this.animation.play(selected.clip.name, {
            loop: false,
            speed,
            weight,
            fadeSeconds,
        })
        this.animation.setSpeed?.(speed)
        this.animation.setWeight?.(weight)
        this.activeAction = {
            definition,
            resolution: firstSegment.resolution,
            segments: pending.segments,
            segmentIndex: 0,
            elapsedSeconds: 0,
            durationSeconds: pending.durationSeconds,
            phase: this.getActionPhase(definition, 0),
            sequence: ++this.actionSequence,
            emittedCueIds: new Set(),
        }
        this.lastLocomotionAnimation = undefined
        this.emitEffectCues(this.activeAction, 0, 0, true)
        this.onActionEvent?.({
            type: 'started',
            characterId: this.characterId,
            action: this.snapshotAction(this.activeAction),
        })
    }

    private advanceActiveAction(deltaSeconds: number): void {
        const active = this.activeAction
        if (!active) return
        const previousTime = active.elapsedSeconds
        const nextTime = Math.min(active.durationSeconds, previousTime + deltaSeconds)
        const previousPhase = active.phase
        active.elapsedSeconds = nextTime
        while (
            active.segmentIndex + 1 < active.segments.length
            && nextTime + Number.EPSILON >= active.segments[active.segmentIndex + 1].startSeconds
        ) {
            active.segmentIndex += 1
            const segment = active.segments[active.segmentIndex]
            const selected = segment.resolution.selected
            if (!selected || !this.animation) break
            const speed = active.definition.speed ?? 1
            const weight = active.definition.weight ?? 1
            this.animation.play(selected.clip.name, {
                loop: false,
                speed,
                weight,
                fadeSeconds: segment.fadeSeconds,
            })
            this.animation.setSpeed?.(speed)
            this.animation.setWeight?.(weight)
            active.resolution = segment.resolution
        }
        active.phase = this.getActionPhase(active.definition, nextTime)
        this.emitEffectCues(active, previousTime, nextTime)
        if (active.phase !== previousPhase) {
            this.onActionEvent?.({
                type: 'phase',
                characterId: this.characterId,
                action: this.snapshotAction(active),
            })
        }
        if (nextTime + Number.EPSILON >= active.durationSeconds) {
            const finished = this.snapshotAction(active)
            this.activeAction = undefined
            this.onActionEvent?.({ type: 'finished', characterId: this.characterId, action: finished })
            this.syncLocomotionAnimation()
        }
    }

    private getActionPhase(definition: CombatActionDefinition, timeSeconds: number): CombatActionPhase {
        const window = definition.activeWindow
        if (!window) return 'active'
        if (timeSeconds < window.startSeconds) return 'startup'
        if (timeSeconds <= window.endSeconds) return 'active'
        return 'recovery'
    }

    private emitEffectCues(
        active: ActiveCombatAction,
        from: number,
        to: number,
        includeInitialBoundary = false,
    ): void {
        for (const cue of active.definition.effectCues ?? []) {
            if (active.emittedCueIds.has(cue.id)) continue
            if (
                (includeInitialBoundary ? cue.timeSeconds < from : cue.timeSeconds <= from)
                || cue.timeSeconds > to + Number.EPSILON
            ) continue
            active.emittedCueIds.add(cue.id)
            this.onEffectCue?.({
                characterId: this.characterId,
                actionId: active.definition.id,
                actionSemantic: active.definition.semantic,
                actionSequence: active.sequence,
                cueId: cue.id,
                effectId: cue.effectId,
                anchor: cue.anchor,
                lifetimeSeconds: cue.lifetimeSeconds,
                payload: cue.payload,
                actionTimeSeconds: cue.timeSeconds,
                rootPosition: this.transform.position.clone(),
                rootQuaternion: this.transform.quaternion.clone(),
            })
        }
    }

    private snapshotAction(active: ActiveCombatAction): CombatActionSnapshot {
        const selected = active.resolution.selected
        if (!selected) throw new Error('active action has no selected animation')
        return {
            id: active.definition.id,
            semantic: active.definition.semantic,
            clipName: selected.clip.name,
            elapsedSeconds: active.elapsedSeconds,
            durationSeconds: active.durationSeconds,
            phase: active.phase,
            sequence: active.sequence,
        }
    }

    private stepSecondaryPhysics(rootStartPosition: Vector3, deltaSeconds: number): void {
        if (!this.secondaryPhysics) {
            this.lastPhysicsResult = undefined
            return
        }
        if (!this.secondaryPhysicsActive) {
            this.lastPhysicsResult = {
                correctedContacts: 0,
                unresolvedContacts: 0,
                maxRemainingPenetration: 0,
            }
            return
        }
        const context: SecondaryPhysicsStepContext = {
            characterId: this.characterId,
            deltaSeconds,
            rootStartPosition: rootStartPosition.clone(),
            rootEndPosition: this.transform.position.clone(),
            rootTranslation: this.transform.position.clone().sub(rootStartPosition),
            rootQuaternion: this.transform.quaternion.clone(),
            contacts: this.contacts,
            collisionWorld: this.collisionWorld,
            sceneCollisionWorld: this.secondaryPhysicsSceneCollision,
            teleported: this.teleported,
        }
        this.secondaryPhysics.beginStep?.(context)
        const result = this.secondaryPhysics.step(context)
        assertNonNegative(result.correctedContacts, 'secondary physics correctedContacts')
        assertNonNegative(result.unresolvedContacts, 'secondary physics unresolvedContacts')
        assertNonNegative(result.maxRemainingPenetration, 'secondary physics maxRemainingPenetration')
        this.lastPhysicsResult = { ...result }
        if (
            result.unresolvedContacts > 0
            || result.maxRemainingPenetration > this.config.remainingPenetrationTolerance
        ) {
            const report: PhysicsReadinessReport = {
                ready: false,
                issues: [
                    `secondary physics left ${result.unresolvedContacts} unresolved contacts`,
                    `maximum remaining penetration ${result.maxRemainingPenetration}`,
                ],
            }
            this.onPhysicsIssue?.(report)
            if (this.config.requireSecondaryPhysics) {
                throw new Error(report.issues.join('; '))
            }
        }
    }

    getPhysicsReadiness(): PhysicsReadinessReport {
        const issues: string[] = []
        if (this.config.requireSceneCollision && !this.collisionWorld) {
            issues.push('scene collision world is required but not bound')
        }
        if (this.config.requireSecondaryPhysics && !this.secondaryPhysics) {
            issues.push('secondary physics adapter is required but not bound')
        }
        if (this.config.requireSecondaryPhysics && !this.secondaryPhysicsSceneCollision) {
            issues.push('secondary physics scene collision world is required but not bound')
        }
        if (this.rootMotionMode !== 'controlled' && !this.rootMotion) {
            issues.push(`${this.rootMotionMode} root motion requires an extraction adapter`)
        }
        return { ready: issues.length === 0, issues }
    }

    private assertRequiredPhysicsBindings(): void {
        const report = this.getPhysicsReadiness()
        if (!report.ready) {
            this.onPhysicsIssue?.(report)
            throw new Error(report.issues.join('; '))
        }
    }

    teleport(position: Vector3, quaternion?: Quaternion, resetVelocity = true): void {
        this.transform.position.copy(assertFiniteVector(position, 'teleport position'))
        if (quaternion) this.transform.quaternion.copy(assertFiniteQuaternion(quaternion, 'teleport quaternion')).normalize()
        if (resetVelocity) this.velocity.set(0, 0, 0)
        this.jumpQueued = false
        this.jumpTakeoffRemainingSeconds = 0
        this._jumpMode = 'standing'
        this.rootMotion?.reset?.()
        this.secondaryPhysics?.reset?.(this.transform.position.clone(), this.transform.quaternion.clone())
        this.teleported = true
    }

    snapshot(): CharacterLocomotionSnapshot {
        return {
            characterId: this.characterId,
            elapsedSeconds: this.elapsedSeconds,
            state: this._state,
            jumpMode: this._jumpMode,
            grounded: this._grounded,
            takeoffRemainingSeconds: this.jumpTakeoffRemainingSeconds,
            position: this.transform.position.clone(),
            quaternion: this.transform.quaternion.clone(),
            velocity: this.velocity.clone(),
            activeAction: this.activeAction ? this.snapshotAction(this.activeAction) : undefined,
            contacts: this.contacts.map(contact => ({
                ...contact,
                point: contact.point.clone(),
                normal: contact.normal.clone(),
            })),
            secondaryPhysics: this.lastPhysicsResult ? { ...this.lastPhysicsResult } : undefined,
            secondaryPhysicsControl: {
                active: this.secondaryPhysicsActive,
                blendWeight: this.secondaryPhysicsBlendWeight,
            },
        }
    }
}
