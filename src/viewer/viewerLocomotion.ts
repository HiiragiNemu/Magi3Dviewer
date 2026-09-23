import { translateUiText } from './localization/zhCN'
import * as THREE from 'three'
import { specialWeaponDefinitions, loadSpecialWeapon, type LoadedSpecialWeapon } from './specialWeapons'
import { createNativeDungeonFixedTransitionPolicy, nativeDungeonFixedTransitionSeconds, type NativeDungeonFixedTransitionPolicy } from './characterActions/nativeDungeonFixedTransitions'
import { nativeCombatActionCue } from './combatNativeActionCue'
import { readParsedBoneLocal } from '../../magia-exedra-character-three/authoredBoneLocals'
import type { SceneCharacter } from 'magia-exedra-character-three/scene'
import { addAnimationLoop, getClockDelta } from 'magia-exedra-character-three/renderer'
import {
    getCharacterReDriveProfile,
    unityDirectionToThreeFbx,
} from 'magia-exedra-character-three/renderProfile'
import officialDungeonLocomotionJson from './characterActions/data/official-dungeon-locomotion-runtime.json?raw'
import officialCombat101901Json from './characterActions/data/official-combat-101901-runtime.json?raw'
import officialDungeonCharacterCorpusJson from './characterActions/data/official-dungeon-character-corpus.tw.json?raw'
import officialHome113401Json from './characterActions/data/direct-home/113401.direct-home-actions.active-controller.v1.json?raw'
import officialHome113501Json from './characterActions/data/direct-home/113501.direct-home-actions.active-controller.v1.json?raw'
import officialHomeActionDeclarationsJson from './characterActions/data/direct-home/action-declarations.v1.json?raw'
import style3dCharacterMstListJson from '../../magia-exedra-character-three/getStyle3dCharacterMstList.json?raw'
import normalizedHumanoidMotionReferenceJson from './normalizedHumanoidMotionReference.generated.json?raw'
import nativeUpperBodyMotionReferenceJson from './nativeUpperBodyMotionReference.generated.json?raw'
import { scene } from './scene'
import { characters } from './character'
import { createPrimaryCharacterCatalog, type PrimaryCharacterCatalogEntry } from './uiCharacterCatalog'
import {
    CharacterActionResourceError,
    CharacterActionResourceManager,
    type CombatJumpActionResourceEntry,
    type CharacterActionResourceEntry,
    type LoadedCombatJumpActionSet,
    type LoadedCombatJumpClip,
    type LoadedNativeDungeonActionSet,
    type NativeDungeonSemantic,
} from './characterActions'
import {
    CHARACTER_TIMELINE_SCHEMA,
    CharacterTimeline,
    createObjectTimelineBinding,
    createOfficialCharacterActionTimeline,
    createOfficialDirectControllerProfileFromManifest,
    type CharacterTimelineBinding,
    type CharacterTimelineDocument,
    type OfficialCharacterActionCatalogAvailability,
    type OfficialCharacterActionDefinition,
    type OfficialCharacterActionIdentity,
    type OfficialCharacterActionPhaseSchedule,
    type OfficialDirectControllerManifestAdapterResult,
    type TimelineClipValue,
} from './characterTimeline'
import {
    CharacterLocomotionController,
    FlatGroundCollisionWorld,
    OFFICIAL_DUNGEON_GAIT_REFERENCE,
    normalizeAnimationFamilyName,
    type AnimationClipDescriptor,
    type CharacterCollisionContact,
    type CharacterCollisionWorld,
    type CharacterGroundHit,
    type CharacterGroundQuery,
    type CharacterGroundQueryInput,
    type CharacterAnimationPort,
    type CharacterLocomotionSnapshot,
    type CharacterMotionQuery,
    type CharacterMotionResult,
    type CombatEffectCue,
    type CombatEffectCueDefinition,
    type CombatActionSemantic,
    type JumpLocomotionAnimationMap,
    type JumpLocomotionMode,
    type LocomotionAnimationMap,
    type LocomotionState,
    type SecondaryPhysicsParticleMotionQuery,
    type SecondaryPhysicsParticleMotionResult,
    type SecondaryPhysicsSceneCollisionWorld,
} from './characterLocomotion'
import {
    CharacterPhysicsActionOptionsClient,
    getViewerCharacterPhysicsAttachment,
    registerCharacterPhysicsActionPhaseBindings,
    type CharacterPhysicsActionPhaseOption,
} from './characterPhysics'

type ViewerCharacter = NonNullable<SceneCharacter['character']>
type ActionSlotCode = 'KeyQ' | 'KeyR' | 'KeyE' | 'KeyF' | 'KeyT' | 'KeyX'

interface ActionSlotDefinition {
    code: ActionSlotCode
    key: string
    select: HTMLSelectElement
    semantic: CombatActionSemantic
    patterns: readonly RegExp[]
}

interface SerializedOfficialDungeonClip {
    name: string
    duration: number
    sourceClipPathId: string
    tracks: Array<{ name: string } & Record<string, unknown>>
    [key: string]: unknown
}

interface OfficialDungeonLocomotionRuntime {
    schema: 1
    sourceCharacterId: number
    sourceAnimationBundle: string
    rootMotionRule: string
    nodePaths: Record<string, string>
    clips: SerializedOfficialDungeonClip[]
}

interface OfficialDungeonCharacterCorpusClip {
    pathID: string
    name: string
    durationSeconds: number
    sampleRate: number
    genericBindings: number
    locomotionSemantic: NativeDungeonSemantic | null
}

interface OfficialDungeonCharacterCorpusRecord {
    sourceCharacterId: number
    logicalKey: string
    controllers: Array<{ pathID: string; name: string }>
    clips: OfficialDungeonCharacterCorpusClip[]
    externalWeaponPolicy: string
}

interface OfficialDungeonCharacterCorpus {
    schema: 'magius-official-dungeon-character-corpus-v1'
    records: OfficialDungeonCharacterCorpusRecord[]
}

type NormalizedMotionSemantic = 'idle' | 'walk' | 'run'
const semanticOrderForReference: readonly NormalizedMotionSemantic[] = ['idle', 'walk', 'run']

interface NormalizedHumanoidMotionFrame {
    phase: number
    hip: {
        position: [number, number, number]
        rotationDeltaYXZ: [number, number, number]
    }
    joints: Record<string, [number, number, number]>
    directions: Record<string, [number, number, number]>
}

interface NormalizedHumanoidMotionClip {
    sourceName: string
    sourceClipPathId: string
    durationSeconds: number
    sampleRate: number
    frameCount: number
    normalizedFootForwardSpan: number
    normalizedHandLateralSpan: number
    frames: NormalizedHumanoidMotionFrame[]
}

interface NormalizedHumanoidMotionDonor {
    characterId: number
    modelKey: string
    sourceModelBundle: string
    sourceAnimationBundle: string
    dimensions: {
        legLengthMeters: number
        armLengthMeters: number
        shoulderWidthMeters: number
        hipWidthMeters: number
    }
    neutralIdlePathId: string
    clips: Record<NormalizedMotionSemantic, NormalizedHumanoidMotionClip>
}

interface NormalizedHumanoidMotionReference {
    schema: 'magius.normalized-humanoid-motion-reference.v1'
    sampleRate: 60
    coordinateConvention: string
    transferPolicy: string
    blendWeights: Record<string, number>
    blendProfiles?: Record<string, {
        id: string
        label: string
        weights: Record<string, number>
        compatibility?: string
        idlePolicy?: string
    }>
    dynamicEvidence: Record<string, string>
    morphologyDiagnostics?: {
        targetCharacterId: string
        target: Record<string, unknown>
        featureWeights: Record<string, number>
        donors: Record<string, {
            morphologyDistance: number
            weight: number
            features: Record<string, unknown>
        }>
    }
    gaitDiagnostics?: Record<string, Record<NormalizedMotionSemantic, {
        rootSpeedMetersPerSecond: number
        rootTravelPerCycleMeters: number
        stanceFootSlipRmsMetersPerSecond: number
        wristToSkirtSweepMinMarginMeters: number
        wristToHairSweepMinMarginMeters: number
    }>>
    authority?: Record<string, unknown>
    donors: NormalizedHumanoidMotionDonor[]
}

interface NativeUpperBodyMotionFrame {
    phase: number
    localRotationDeltas: Record<string, [number, number, number, number]>
}

interface NativeUpperBodyMotionClip {
    sourceName: string
    sourceClipPathId: string
    durationSeconds: number
    sampleRate: 60
    frameCount: number
    frames: NativeUpperBodyMotionFrame[]
    diagnostics: {
        handRotationPaths: number
        fingerRotationPaths: number
        dynamicFingerRotationPaths: number
        maximumFingerRestRelativeRotationDegrees: number
        maximumFingerTemporalRotationDegrees: number
    }
}

interface NativeUpperBodyMotionDonor {
    characterId: number
    status: 'attached' | 'source-unavailable'
    modelKey?: string
    reason?: string
    clips?: Record<'walk' | 'run', NativeUpperBodyMotionClip>
}

interface NativeUpperBodyMotionReference {
    schema: 'magius.native-upper-body-motion-reference.v1'
    sampleRate: 60
    coordinateConvention: string
    transferPolicy: string
    profiles: Record<string, {
        label: string
        weights: Record<string, number>
        lowerBodyPolicy: string
        clearancePolicy: string
    }>
    donors: NativeUpperBodyMotionDonor[]
}

interface OfficialDungeonAttachResult {
    status: 'attached' | 'incompatible' | 'disabled-unverified'
    sourceCharacterId: number
    sourceAnimationBundle: string
    rootMotionRule: string
    rigRoot?: string
    clips: Array<{
        name: string
        sourceClipPathId: string
        attachedTracks: number
        droppedTracks: number
        suppressedRootMotionTracks: number
    }>
    missingRequiredRigPaths: string[]
    reason?: string
}

interface OfficialCombatActionMetadata {
    semantic: CombatActionSemantic
    key: string
    sequenceId: string
    runtimeClipName: string
    durationSeconds: number
    styleMstId: number
    styleFigureMstId: number
    style3dCharacterMstId: number
    skillUniqueId: number
    skillMstId: number
    directionName: string
    bundleKey: string
    segments: OfficialCombatAnimationSegment[]
}

interface OfficialCombatAnimationComponent {
    role: 'body' | 'weapon'
    runtimeClipName: string
    sourceClipName: string
    sourceClipPathId: string
    durationSeconds: number
    sampleRate: number
    genericBindings: number
    importedTrackCount: number
}

interface OfficialCombatAnimationSegment {
    startSeconds: number
    runtimeClipName: string
    durationSeconds: number
    components: OfficialCombatAnimationComponent[]
}

interface OfficialCombatRejectedAction {
    key: string
    semantic: CombatActionSemantic
    skillUniqueId: number
    skillMstId: number
    directionName: string
    reason: string
}

interface OfficialCombatRuntime {
    schema: 2
    viewerCharacterId: number
    modelKey: string
    rootMotionRule: string
    actions: OfficialCombatActionMetadata[]
    rejectedActions: OfficialCombatRejectedAction[]
    nodePaths: Record<string, string>
    clips: SerializedOfficialDungeonClip[]
}

interface OfficialCombatAttachResult {
    status: 'attached' | 'not-configured' | 'incompatible'
    viewerCharacterId: number
    modelKey?: string
    rootMotionRule?: string
    actions: Array<OfficialCombatActionMetadata & {
        attachedTracks: number
        droppedTracks: number
        suppressedRootMotionTracks: number
        attachedClips: Array<{
            name: string
            sourceClipPathId: string
            attachedTracks: number
            droppedTracks: number
            suppressedRootMotionTracks: number
        }>
    }>
    rejectedActions?: OfficialCombatRejectedAction[]
    missingRequiredRigPaths: string[]
    reason?: string
}

interface CharacterSpecificMotionProfile {
    status: 'attached' | 'not-configured' | 'incompatible'
    characterId: number
    provenance: 'custom-character-profile'
    profileId?: string
    profileLabel?: string
    baselineClip?: string
    playbackMode?: 'full-pose' | 'layered-additive'
    generatedClips: Array<{ state: keyof LocomotionAnimationMap; name: string; duration: number }>
    idleAuthority?: {
        bodyClipPathId: '-744234983873425308'
        weaponClipPathId: '2664253911874192042'
        durationSeconds: 1.983333
        bodyBindings: 633
        weaponBindings: 87
        tpsPolicy: 'body-only-hide-external-weapon-sibling'
    }
    gaitCalibration?: {
        source: string
        sourceDungeonCharacterIds: readonly number[]
        referenceCharacterIds: readonly number[]
        compatibility: string
        sampleRate: 60
        legLengthMeters: number
        armLengthMeters: number
        referenceLegLengthMeters: number
        walkCycleSeconds: number
        runCycleSeconds: number
        walkSpeedMetersPerSecond: number
        runSpeedMetersPerSecond: number
        walkRootTravelPerCycleMeters: number
        runRootTravelPerCycleMeters: number
        walkStepLengthMeters: number
        runStepLengthMeters: number
        trajectoryFrameCounts: Record<NormalizedMotionSemantic, number>
        donorBlendWeights: Record<string, number>
        upperBodyProfileId?: string
        upperBodyDonorBlendWeights?: Record<string, number>
        upperBodyTrajectoryDonorBlendWeights?: Record<'walk' | 'run', Record<string, number>>
        nativeHandFingerRigPathCount?: number
        nativeFingerRigPathCount?: number
        nativeUpperBodyExcludedSecondaryPathCount?: number
        nativeHandFingerPoseFrameCount?: number
        donorMorphologyDistances?: Record<string, number>
        targetMorphologyFeatures?: Record<string, number>
        morphologyFeatureWeights?: Record<string, number>
        poseSolve: string
        rootPolicy: string
        handPolicy: string
        footPolicy: string
        dressClearance: {
            proxyBoneCount: number
            proxyRadiusMeters: number
            verticalBandMeters: number
            skinnedSurfaceStatus: 'attached' | 'unavailable'
            skinnedSurfaceMethod: string
            skinnedSurfaceMeshCount: number
            skinnedSurfaceMeshPaths: string[]
            skinnedSurfaceTriangleCount: number
            skinnedSurfaceWeightedVertexCount: number
            skinnedSurfaceInsideHits: number
            skinnedSurfaceIntersectionHits: number
            minimumSignedSurfaceDistanceMeters: number | null
            minimumFinalSurfaceClearanceMarginMeters: number | null
            enhancedSemantic: 'walk' | 'none'
            walkProxyPointCountPerSide: number
            walkFingerProxyBoneCountPerSide: number
            walkSafetyMarginMeters: number
            postIkMaximumPasses: number
            constraintProjectionSweeps: number
            postIkConvergenceGuardMeters: number
            postIkRemeasurePasses: number
            maximumPostIkResidualMeters: number
            sampledFrameSides: number
            correctedFrameSides: number
            correctedFrameSidesBySemantic: Record<'walk' | 'run', number>
            maximumCorrectionMeters: number
            maximumCorrectionMetersBySemantic: Record<'walk' | 'run', number>
        }
        flatSoleContact: {
            normalizedToeContactStart: number
            normalizedToeContactEnd: number
            correctedFrameSides: number
        }
    }
    jumpCalibration?: {
        source: string
        donorPriority: readonly [
            'same-character-exact-rig',
            'verified-retarget',
            'corpus-parameterized',
        ]
        rootPolicy: 'controller-all-horizontal-and-vertical'
        attachmentPolicy: 'body-only-exclude-external-weapons'
        sampleRate: 60
    }
    /** Generated standing/walking/running jump channels, when attached. */
    jumpAnimations?: JumpLocomotionAnimationMap
    missingRequiredRigPaths: string[]
    reason?: string
}

interface CharacterSpecificMotionVariant {
    id: string
    label: string
    profile: CharacterSpecificMotionProfile
    animations: LocomotionAnimationMap
    jumpAnimations?: JumpLocomotionAnimationMap
    postAnimationWalkClearance?: CharacterSpecificMotionPostAnimationClearance
}

interface SetAWalkDressClearanceProbeRecord {
    side: 'L' | 'R'
    label: string
    radiusMeters: number
    requiredDistanceMeters: number
    initialSignedDistanceMeters: number
    initialMarginMeters: number
    initialInside: boolean
    initialIntersection: boolean
    finalSignedDistanceMeters: number
    finalMarginMeters: number
    finalInside: boolean
    finalIntersection: boolean
}

interface SetAWalkDressClearanceFrameRecord {
    frameIndex: number
    phase: number | null
    clipName: string | null
    meshPaths: string[]
    triangleCount: number
    weightedVertexCount: number
    probes: SetAWalkDressClearanceProbeRecord[]
    minimumInitialMarginMeters: number | null
    minimumFinalMarginMeters: number | null
    initialInsideHits: number
    initialIntersectionHits: number
    finalInsideHits: number
    finalIntersectionHits: number
    finalResidualMeters: number
    correctionMetersBySide: Record<'L' | 'R', number>
}

interface ViewerCharacterSourceFamilyAuthority {
    characterId: number
    sourceFamily: 'magical-girl' | 'story-cutscene-nonbattle' | 'unresolved'
    officialType: 1 | 3 | null
    identityStatus: 'resolved' | 'missing' | 'ambiguous' | 'unsupported'
    matchedBy: 'resourceName' | 'style3dCharacterMstId' | null
    style3dCharacterMstId: number | null
    resourceName: string | null
    reason: string
}

interface SerializedStyle3dCharacterRecord {
    style3dCharacterMstId?: number | string
    resourceName?: string
    type?: number | string
}

interface SerializedStyle3dCharacterMstList {
    payload?: {
        mstList?: SerializedStyle3dCharacterRecord[]
    }
}

interface SetAWalkDressClearanceCycleRecord {
    schema: 'magius.101901-set-a-real-skinned-walk-clearance-cycle.v1'
    characterId: number
    profileId: 'set-a'
    sampleCount: number
    meshPaths: string[]
    triangleCount: number
    weightedVertexCount: number
    frames: SetAWalkDressClearanceFrameRecord[]
    summary: {
        minimumFinalMarginMeters: number | null
        finalInsideHits: number
        finalIntersectionHits: number
        maximumFinalResidualMeters: number
        phaseMinimum: number | null
        phaseMaximum: number | null
    }
}

interface CharacterSpecificMotionPostAnimationClearance {
    readonly update: () => void
    readonly diagnostics: {
        active: boolean
        appliedFrames: number
        skippedFrames: number
        skinnedSurfaceStatus: 'attached' | 'unavailable'
        meshPaths: string[]
        triangleCount: number
        weightedVertexCount: number
        lastFrame: SetAWalkDressClearanceFrameRecord | null
        capturePending: boolean
        captureFrames: number
    }
    setStateProvider(provider: () => CharacterLocomotionSnapshot): void
    setVariantProvider(provider: () => string | undefined): void
    setActive(active: boolean): void
    captureWalkCycle(sampleCount?: number): Promise<SetAWalkDressClearanceCycleRecord>
    reset(): void
}

interface ViewerLocomotionBinding {
    sceneCharacter: SceneCharacter
    character: ViewerCharacter
    controller: CharacterLocomotionController
    locomotionAnimations: LocomotionAnimationMap
    actionClips: Map<ActionSlotCode, string>
    catalogActionIds: Map<ActionSlotCode, string>
    catalogEffectCueSequence: number
    pendingAction: boolean
    animationPlaybackRate: number
    characterActionPlaybackRate: number
    characterActionAuthoredSpeed: number
    snapshot: CharacterLocomotionSnapshot
    collision: ViewerSceneCollisionWorld
    officialDungeonLocomotion: OfficialDungeonAttachResult
    officialCombatActions: OfficialCombatAttachResult
    characterSpecificMotion: CharacterSpecificMotionProfile
    characterSpecificMotionVariants?: ReadonlyMap<string, CharacterSpecificMotionVariant>
    activeCharacterSpecificMotionVariant?: string
    safety: ViewerRigSafety
    controlAuthority: ReturnType<typeof getViewerCharacterControlAuthority>
    animationPort: CharacterAnimationPort
    nativeDungeonActions: NativeDungeonActionBinding
    combatJumpActions: CombatJumpActionBinding
    directHomeActions: DirectHomeActionBinding
    characterActionPlayback: ViewerCharacterActionPlaybackState
    characterActionPhysicsPhase: ViewerCharacterActionPhysicsPhaseBinding
    attachmentRestState: ReturnType<typeof attachmentDiagnostics>
    tpsPoseTransition?: ViewerTpsPoseTransition
    restoreAnimationHandoff?: () => void
    tpsBaselineAnimation?: string
    proceduralLocomotion?: ViewerProceduralLocomotion
    cameraHeadTracking?: ViewerCameraHeadTracking
    postAnimationWalkClearance?: CharacterSpecificMotionPostAnimationClearance
    secondaryPhysics?: ViewerSecondaryBonePhysics
}

interface DirectHomeActionDeclaration {
    id: string
    label: string
    groupId: 'official-home-direct-controller'
    group: string
    playbackKind: 'oneShot' | 'loop' | 'timeline'
    characterIdentity: OfficialCharacterActionIdentity
    availability: OfficialCharacterActionCatalogAvailability
    playback: {
        kind: 'direct-controller-profile'
        profileActionId: string
        controllerPathId: string
    }
    sourceFamily: {
        id: string
        compatibility: 'native-only'
    }
    attachmentPolicy: 'embedded-rig-only-no-external-companion'
}

interface DirectHomeActionDeclarationsProduct {
    schema: 'magius.direct-home-action-declarations.v1'
    counts: {
        characters: number
        entries: number
    }
    entries: readonly DirectHomeActionDeclaration[]
}

interface ActiveDirectHomePlayback {
    catalogActionId: string
    profileActionId: string
    playbackKind: DirectHomeActionDeclaration['playbackKind']
    runtimeName: string
    durationSeconds: number
    timeline?: CharacterTimeline
    phases: readonly OfficialCharacterActionPhaseSchedule[]
}

interface DirectHomeActionBinding {
    product?: OfficialDirectControllerManifestAdapterResult
    entries: readonly DirectHomeActionDeclaration[]
    status: 'attached' | 'unavailable'
    reason?: string
    active?: ActiveDirectHomePlayback
}

type NativeDungeonActionLoadStatus =
    | 'not-requested'
    | 'loading'
    | 'attached'
    | 'unavailable'
    | 'error'
    | 'disposed'

interface NativeDungeonExternalAttachmentState {
    object: THREE.Object3D
    visible: boolean
    restPosition: THREE.Vector3
    restQuaternion: THREE.Quaternion
    restScale: THREE.Vector3
}

interface NativeDungeonActionBinding {
    status: NativeDungeonActionLoadStatus
    dungeonCharacterId: number
    modelKey?: string
    entries: readonly CharacterActionResourceEntry[]
    loaded?: LoadedNativeDungeonActionSet
    source?: 'resource-runtime' | 'embedded-exact'
    embeddedEntries: ReadonlyMap<string, CharacterActionResourceEntry>
    ready?: Promise<void>
    abortController?: AbortController
    loadAttempts: number
    errorCode?: string
    reason?: string
    active: boolean
    controllerReady: boolean
    baselineAnimation?: string
    externalAttachments: NativeDungeonExternalAttachmentState[]
}

interface ExactCombatJumpLocomotionClips {
    donorEntryId: string
    takeoff: string
    airborne: string
    land: string
    preview: string
    takeoffSeconds: number
    airborneSeconds: number
    landSeconds: number
    trackPolicy: 'same-character-hip-leg-quaternion-only+own-idle-upper-body+0.25s-flat-sole-recovery'
    sourceWindowsSeconds: readonly [
        readonly [number, number],
        readonly [number, number],
        readonly [number, number],
    ]
    donorPropertyPolicy: 'quaternion-only-no-bone-translation-or-scale'
    upperBodyReference: string
    upperBodyPoseSampleSeconds: number
    upperBodyTrackCounts: readonly [number, number, number]
    groundedSoleRecoverySeconds: 0.25
    donorTrackCounts: readonly [number, number, number]
    targetRigTrackCounts: readonly [number, number, number]
    excludedCombatTrackCounts: readonly [number, number, number]
}

interface CombatJumpActionBinding {
    status: NativeDungeonActionLoadStatus
    characterId: string
    entries: readonly CombatJumpActionResourceEntry[]
    loaded?: LoadedCombatJumpActionSet
    specialWeapons?: Map<string, LoadedSpecialWeapon>
    specialWeaponLoads?: Map<string, Promise<LoadedSpecialWeapon>>
    ready?: Promise<void>
    abortController?: AbortController
    loadAttempts: number
    errorCode?: string
    reason?: string
    jumpReason?: string
    previewClips: ReadonlyMap<string, string>
    previewJumpSequences: ReadonlyMap<string, CombatJumpPreviewSequence>
    exactLocomotion?: ExactCombatJumpLocomotionClips
    activeSkeletonPlayback?: ActiveCombatSkeletonPlayback
    activeJumpDonorPlayback?: ActiveCombatJumpDonorPlayback
}

interface CombatJumpPreviewSequence {
    jump: string
    fall: string
    land: string
    durationSeconds: number
}

interface ActiveCombatJumpDonorPlayback {
    actionId: string
    sequence: CombatJumpPreviewSequence
    elapsedSeconds: number
    jumpStateObserved: boolean
}

interface CombatSkeletonPhase {
    phase: string
    clipName: string
    startSeconds: number
    endSeconds: number
    sourceDurationSeconds: number
}

interface ExactCombatSkeletonTemplateRole {
    role: 'body' | 'weapon-a'
    targetId: string
    clips: readonly LoadedCombatJumpClip[]
}

interface ExactCombatSkeletonTemplate {
    entry: CombatJumpActionResourceEntry
    bodyPhases: readonly LoadedCombatJumpClip[]
    roles: readonly ExactCombatSkeletonTemplateRole[]
}

interface CombatSkeletonPlaybackController {
    state(): {
        actionId: string
        playing: boolean
        timeSeconds: number
        durationSeconds: number
        loop: boolean
    }
    play(): void
    pause(): void
    seek(timeSeconds: number): void
    step(deltaSeconds: number): void
}

interface CombatSkeletonRolePlayback {
    targetId: string
    role: string
    phases: readonly CombatSkeletonPhase[]
    clipByName: ReadonlyMap<string, THREE.AnimationClip>
    currentAction?: THREE.AnimationAction
    currentPhase?: CombatSkeletonPhase
    previousAction?: THREE.AnimationAction
    previousPhase?: CombatSkeletonPhase
    transitionStartSeconds?: number
    lastAppliedTimeSeconds?: number
    holdFinalPose?: boolean
    binding: CharacterTimelineBinding
}

interface CombatSkeletonAttachmentPlayback {
    object: THREE.Object3D
    restPosition: THREE.Vector3
    restQuaternion: THREE.Quaternion
    restScale: THREE.Vector3
    policy: 'authored-model-space-root'
}

interface ActiveCombatSkeletonPlayback {
    catalogActionId: string
    sourceEntryId: string
    playback: CombatSkeletonPlaybackController
    roles: readonly CombatSkeletonRolePlayback[]
    attachments: readonly CombatSkeletonAttachmentPlayback[]
    specialWeapon?: LoadedSpecialWeapon
}

const combatSkeletonPreviewPrefix = 'viewer-combat-skeleton:'
const combatSkeletonPhaseCrossfadeSeconds = 0.10
const incompleteSpecialCombatPreviewReason = '完整大招需要 exact camera / scene-root / attachment / VFX 同步；body/weapon 单独预览会产生官方位移与附件错位'

type ViewerCharacterActionPlaybackStatus =
    | 'idle'
    | 'playing'
    | 'paused'
    | 'interrupted'
    | 'unavailable'

type ViewerCharacterActionPhysicsPhaseStatus =
    | 'idle'
    | 'registering'
    | 'registered'
    | 'fail-closed'

interface ViewerCharacterActionPhysicsPhaseState {
    status: ViewerCharacterActionPhysicsPhaseStatus
    stableKey?: string
    actionId?: string
    characterResourceId?: number
    phaseRootName?: string
    phaseRootParentName?: string
    phaseRootSource?: 'action-owned' | 'external-loader'
    reason?: string
}

interface ViewerCharacterActionPhysicsPhaseLease {
    readonly stableKey: string
    dispose(): void
}

interface ActiveViewerCharacterActionPhysicsPhase {
    token: number
    stableKey: string
    actionId: string
    phaseRoot: THREE.Object3D
    disposePhase: () => void
}

interface ViewerCharacterActionPhysicsPhaseRootHandle {
    readonly phaseRoot: THREE.Object3D
    readonly source: 'action-owned' | 'external-loader'
    disposeRoot(): void
}

type ViewerCharacterActionPhysicsPhaseRootProvider = (
    phase: CharacterPhysicsActionPhaseOption,
    binding: ViewerLocomotionBinding,
) => ViewerCharacterActionPhysicsPhaseRootHandle

interface ViewerCharacterActionPhysicsPhaseBinding {
    requestToken: number
    state: ViewerCharacterActionPhysicsPhaseState
    active?: ActiveViewerCharacterActionPhysicsPhase
}

interface ViewerCharacterActionPlaybackState {
    repetitions?: number
    completedRepetitions?: number
    status: ViewerCharacterActionPlaybackStatus
    actionId?: string
    characterId?: number
    runtimeName?: string
    timeSeconds: number
    durationSeconds: number
    loop: boolean
    playbackRate?: number
    reason?: string
    physicsPhase?: ViewerCharacterActionPhysicsPhaseState
}

interface ViewerCharacterActionPlaybackSnapshot extends ViewerCharacterActionPlaybackState {
    playbackRate: number
    physicsPhase: ViewerCharacterActionPhysicsPhaseState
}

interface ViewerCharacterActionCatalogEntry {
    id: string
    label: string
    groupId: string
    group: string
    playback: 'oneShot' | 'loop' | 'timeline'
    playbackKind?: 'oneShot' | 'loop' | 'timeline'
    characterIdentity: CharacterActionResourceEntry['characterIdentity'] | CombatJumpActionResourceEntry['characterIdentity'] | OfficialCharacterActionIdentity
    availability?: CharacterActionResourceEntry['availability'] | CombatJumpActionResourceEntry['availability'] | OfficialCharacterActionCatalogAvailability
    sourceKind: 'native-dungeon' | 'combat-jump' | 'combat-skeleton-preview' | 'locomotion-profile' | 'direct-home'
    consumerAvailability: {
        currentCharacter: boolean
        status: NativeDungeonActionLoadStatus | 'not-selected'
        playable: boolean
        reason?: string
    }
}

interface ViewerCharacterActionCatalogSnapshot {
    schema: 'magius.viewer-character-action-catalog.v1'
    loadStatus: 'not-requested' | 'loading' | 'ready' | 'error'
    selectedCharacterId: number | null
    entries: readonly ViewerCharacterActionCatalogEntry[]
    error?: string
}

interface ViewerRigSafety {
    characterId: number
    status: 'verified' | 'unverified'
    movementPolicy: 'rig-locomotion' | 'controller-root-own-pose'
    allowMovement: boolean
    allowJumpSequence: boolean
    allowCrossCharacterDungeon: boolean
    allowCombatActions: boolean
    allowProceduralBones: boolean
    allowSecondaryFallback: boolean
    allowCharacterSpecificMotion: boolean
    allowCharacterSpecificSecondaryPhysics: boolean
    reason: string
}

/**
 * Fail-closed compatibility gate. Entries are added only after body-rig and
 * attachment fingerprints (full paths/topology/rest TRS/inverse binds) match
 * an official source bundle. A common set of bone names is not sufficient.
 */
const verifiedRigSafetyByCharacter = new Map<number, Omit<ViewerRigSafety, 'characterId'>>([
    [101901, {
        status: 'verified',
        movementPolicy: 'rig-locomotion',
        allowMovement: true,
        allowJumpSequence: true,
        allowCrossCharacterDungeon: false,
        allowCombatActions: true,
        allowProceduralBones: false,
        allowSecondaryFallback: false,
        allowCharacterSpecificMotion: true,
        allowCharacterSpecificSecondaryPhysics: true,
        reason: '101901 exact rig/attachment fingerprint; full-pose locomotion and scoped hair/skirt solver use swept split-arm capsules on stage 600-00-01-001',
    }],
])

function getViewerRigSafety(character: ViewerCharacter): ViewerRigSafety {
    const characterId = Number(character.userData.characterId)
    const controlAuthority = getViewerCharacterControlAuthority(character)
    if (!controlAuthority.tps) {
        return {
            characterId,
            status: 'unverified',
            movementPolicy: 'controller-root-own-pose',
            allowMovement: false,
            allowJumpSequence: false,
            allowCrossCharacterDungeon: false,
            allowCombatActions: false,
            allowProceduralBones: false,
            allowSecondaryFallback: false,
            allowCharacterSpecificMotion: false,
            allowCharacterSpecificSecondaryPhysics: false,
            reason: `${controlAuthority.reason}; TPS, Dungeon, combat and humanoid retarget consumers fail closed`,
        }
    }
    const verified = verifiedRigSafetyByCharacter.get(characterId)
    if (verified) return { characterId, ...verified }
    return {
        characterId,
        status: 'unverified',
        movementPolicy: 'controller-root-own-pose',
        // Root-only translation and jumping never consume a rig path, donor
        // bone, weapon, camera, scene-root or VFX track. Keep the selected
        // model's own pose and let the TPS controller own the root trajectory.
        allowMovement: true,
        allowJumpSequence: true,
        allowCrossCharacterDungeon: false,
        allowCombatActions: false,
        allowProceduralBones: false,
        allowSecondaryFallback: false,
        allowCharacterSpecificMotion: false,
        allowCharacterSpecificSecondaryPhysics: false,
        reason: 'controller-root-only movement enabled with the selected model own pose; bone retargeting, procedural bones, physics fallback, combat and cross-rig clips locked; controller-root own-pose jump available',
    }
}

interface VirtualInput {
    moveX: number
    moveZ: number
    run: boolean
    jumpPressed: boolean
}

const modeToggle = document.getElementById('locomotion-mode-toggle') as HTMLButtonElement
const hud = document.getElementById('locomotion-hud') as HTMLElement
const hudToggle = document.getElementById('locomotion-hud-toggle') as HTMLButtonElement
const stateOutput = document.getElementById('locomotion-state-output') as HTMLOutputElement
const clipOutput = document.getElementById('locomotion-clip-output') as HTMLOutputElement
const feedbackOutput = document.getElementById('locomotion-action-feedback') as HTMLOutputElement

const actionSlots: readonly ActionSlotDefinition[] = [
    {
        code: 'KeyQ', key: 'Q', semantic: 'basicAttack',
        select: document.getElementById('locomotion-action-q') as HTMLSelectElement,
        patterns: [/(?:normal)?attack|strike|slash|shot|combo/i],
    },
    {
        code: 'KeyR', key: 'R', semantic: 'ultimate',
        select: document.getElementById('locomotion-action-r') as HTMLSelectElement,
        patterns: [/magia|doppel|ultimate|special.*skill|finisher/i],
    },
    {
        code: 'KeyE', key: 'E', semantic: 'skill',
        select: document.getElementById('locomotion-action-e') as HTMLSelectElement,
        patterns: [/(?:single|whole)?skill|ability|command/i],
    },
    {
        code: 'KeyF', key: 'F', semantic: 'dodge',
        select: document.getElementById('locomotion-action-f') as HTMLSelectElement,
        patterns: [/dodge|evade|avoid|sidestep|standbytransition/i],
    },
    {
        code: 'KeyT', key: 'T', semantic: 'custom',
        select: document.getElementById('locomotion-action-t') as HTMLSelectElement,
        patterns: [/unique|victory|abnormality/i],
    },
    {
        code: 'KeyX', key: 'X', semantic: 'damage',
        select: document.getElementById('locomotion-action-x') as HTMLSelectElement,
        patterns: [/damage|down|hurt|hit/i],
    },
]

const movementCodes = new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD',
    'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight',
    'ShiftLeft', 'ShiftRight', 'Space',
])
const actionSlotByCode = new Map(actionSlots.map(slot => [slot.code, slot]))
const pressed = new Set<string>()
const bindingByObject = new WeakMap<THREE.Object3D, ViewerLocomotionBinding>()
const bindings = new Set<ViewerLocomotionBinding>()
const characterActionResourceManager = new CharacterActionResourceManager()
const characterPhysicsActionOptionsClient = new CharacterPhysicsActionOptionsClient()
const characterActionCatalogSubscribers = new Set<(
    snapshot: ViewerCharacterActionCatalogSnapshot,
) => void>()
const characterActionStateSubscribers = new Set<(
    state: ViewerCharacterActionPlaybackSnapshot,
) => void>()
let characterActionCatalogLoadStatus: ViewerCharacterActionCatalogSnapshot['loadStatus'] = 'not-requested'
let characterActionCatalogEntries: readonly CharacterActionResourceEntry[] = []
let combatJumpCatalogEntries: readonly CombatJumpActionResourceEntry[] = []
let characterActionCatalogError: string | undefined
let characterActionCatalogPromise: Promise<readonly CharacterActionResourceEntry[]> | undefined
let measuredFps = 0
let measuredFrameCount = 0
let measuredFrameWindowStartMs = performance.now()
let nextHudUpdateMs = 0

const officialDungeonLocomotion = JSON.parse(
    officialDungeonLocomotionJson,
) as OfficialDungeonLocomotionRuntime
if (
    officialDungeonLocomotion.schema !== 1
    || officialDungeonLocomotion.sourceCharacterId !== 100101
    || !Array.isArray(officialDungeonLocomotion.clips)
) {
    throw new Error('Official Dungeon locomotion runtime identity mismatch')
}
const officialDungeonCharacterCorpus = JSON.parse(
    officialDungeonCharacterCorpusJson,
) as OfficialDungeonCharacterCorpus
if (
    officialDungeonCharacterCorpus.schema !== 'magius-official-dungeon-character-corpus-v1'
    || !Array.isArray(officialDungeonCharacterCorpus.records)
) {
    throw new Error('Official Dungeon character corpus identity mismatch')
}
const style3dCharacterMstList = JSON.parse(
    style3dCharacterMstListJson,
) as SerializedStyle3dCharacterMstList
const viewerControlCatalog = createPrimaryCharacterCatalog(
    characters.getCharacterIdList(),
    characters.getNonBattleCharacterCatalog(),
    id => characters.getCharacterNameById(id),
)

function resolveViewerCharacterSourceFamilyAuthority(
    records: readonly SerializedStyle3dCharacterRecord[],
    primaryId: number,
): ViewerCharacterSourceFamilyAuthority {
    const unresolved: ViewerCharacterSourceFamilyAuthority = {
        characterId: primaryId,
        sourceFamily: 'unresolved',
        officialType: null,
        identityStatus: 'missing',
        matchedBy: null,
        style3dCharacterMstId: null,
        resourceName: null,
        reason: 'primary identity missing from exact master join',
    }
    if (!Number.isSafeInteger(primaryId) || primaryId <= 0) return unresolved
    // Viewer primary IDs are resource IDs first. Only zero resource matches
    // permit the explicit style ID join; names and partial ID matches never do.
    const resources = records.filter(record => (
        record.resourceName === `chara_${primaryId}_battle_unit`
        || record.resourceName === `chara_${primaryId}_model`
    ))
    const matchedBy = resources.length > 0 ? 'resourceName' : 'style3dCharacterMstId'
    const matches = resources.length > 0 ? resources : records.filter(record => (
        Number(record.style3dCharacterMstId) === primaryId
    ))
    if (matches.length !== 1) return {
        ...unresolved,
        matchedBy,
        identityStatus: matches.length > 1 ? 'ambiguous' : 'missing',
        reason: `exact master identity count:${matchedBy}:${primaryId}:${matches.length}`,
    }
    const record = matches[0]
    const styleId = Number(record.style3dCharacterMstId)
    const officialType = Number(record.type)
    if (
        !Number.isSafeInteger(styleId) || styleId <= 0
        || !/^chara_[1-9]\d*_(?:battle_unit|model)$/.test(record.resourceName ?? '')
        || (officialType !== 1 && officialType !== 3)
    ) return { ...unresolved, matchedBy, identityStatus: 'unsupported', reason: 'exact master row has unsupported identity/type' }
    return {
        characterId: primaryId,
        sourceFamily: officialType === 3 ? 'story-cutscene-nonbattle' : 'magical-girl',
        officialType,
        identityStatus: 'resolved',
        matchedBy,
        style3dCharacterMstId: styleId,
        resourceName: record.resourceName!,
        reason: `exact master ${matchedBy} join`,
    }
}

function resolveViewerCharacterControlAuthority(
    identity: ViewerCharacterSourceFamilyAuthority,
    catalog: readonly PrimaryCharacterCatalogEntry[],
) {
    const entries = catalog.filter(entry => entry.id === String(identity.characterId))
    const entry = entries.length === 1 ? entries[0] : undefined
    const declaredTps = entry?.capabilities.tps
    const tps = identity.identityStatus === 'resolved'
        && (declaredTps === true || declaredTps === 'runtime-scoped')
    return {
        identity,
        catalogIdentity: entry?.stableIdentity ?? null,
        declaredTps: declaredTps ?? null,
        tps,
        // This only grants the camera-control channel. The tracker separately
        // requires the exact rig chain and valid face axes before any bone write.
        cameraGaze: tps,
        reason: identity.identityStatus !== 'resolved' ? identity.reason
            : entries.length !== 1 ? `primary control catalog count:${entries.length}`
            : !tps ? 'primary catalog explicitly withholds TPS control' : 'primary control declared; rig eligibility is independent',
    }
}

function getViewerCharacterSourceFamilyAuthority(
    character: ViewerCharacter,
): ViewerCharacterSourceFamilyAuthority {
    return resolveViewerCharacterSourceFamilyAuthority(
        style3dCharacterMstList.payload?.mstList ?? [], Number(character.userData.characterId),
    )
}

function getViewerCharacterControlAuthority(character: ViewerCharacter) {
    return resolveViewerCharacterControlAuthority(getViewerCharacterSourceFamilyAuthority(character), viewerControlCatalog)
}
const officialDirectHomeProducts = new Map<string, OfficialDirectControllerManifestAdapterResult>([
    ['113401', createOfficialDirectControllerProfileFromManifest(JSON.parse(officialHome113401Json) as unknown)],
    ['113501', createOfficialDirectControllerProfileFromManifest(JSON.parse(officialHome113501Json) as unknown)],
])
const officialDirectHomeDeclarations = JSON.parse(
    officialHomeActionDeclarationsJson,
) as DirectHomeActionDeclarationsProduct
if (
    officialDirectHomeDeclarations.schema !== 'magius.direct-home-action-declarations.v1'
    || officialDirectHomeDeclarations.counts.characters !== 2
    || officialDirectHomeDeclarations.counts.entries !== 70
    || officialDirectHomeDeclarations.entries.length !== 70
) {
    throw new Error('Official direct Home action declarations identity mismatch')
}
for (const [characterId, expected] of [
    ['113401', { controllerPathId: '8103184246897463375', groupedActionCount: 38 }],
    ['113501', { controllerPathId: '-4278097510018638778', groupedActionCount: 32 }],
] as const) {
    const product = officialDirectHomeProducts.get(characterId)
    const declarations = officialDirectHomeDeclarations.entries.filter(entry => (
        entry.characterIdentity.characterId === characterId
    ))
    if (
        !product
        || product.profile.characterId !== characterId
        || product.profile.controller.pathId !== expected.controllerPathId
        || product.groupedActionCount !== expected.groupedActionCount
        || declarations.length !== expected.groupedActionCount
        || declarations.some(entry => (
            entry.playback.controllerPathId !== expected.controllerPathId
            || entry.attachmentPolicy !== 'embedded-rig-only-no-external-companion'
        ))
    ) {
        throw new Error(`Official direct Home action product identity mismatch for ${characterId}`)
    }
}
const normalizedHumanoidMotionReference = JSON.parse(
    normalizedHumanoidMotionReferenceJson,
) as NormalizedHumanoidMotionReference
const normalizedHumanoidMotionDonorIds = normalizedHumanoidMotionReference.donors
    .map(donor => donor.characterId)
const requiredNormalizedHumanoidMotionDonorIds = [
    100102, 100201, 100202, 100301, 100401,
    100501, 100801, 109201, 111501, 114501,
] as const
const normalizedHumanoidSetA = normalizedHumanoidMotionReference.blendProfiles?.['set-a']
const normalizedHumanoidSetB = normalizedHumanoidMotionReference
    .blendProfiles?.['101901-dress-clearance-multidonor']
const profileWeightSum = (weights: Record<string, number> | undefined): number => (
    Object.values(weights ?? {}).reduce((sum, weight) => sum + weight, 0)
)
if (
    normalizedHumanoidMotionReference.schema !== 'magius.normalized-humanoid-motion-reference.v1'
    || normalizedHumanoidMotionReference.sampleRate !== 60
    || normalizedHumanoidMotionDonorIds.length !== requiredNormalizedHumanoidMotionDonorIds.length
    || requiredNormalizedHumanoidMotionDonorIds.some(id => !normalizedHumanoidMotionDonorIds.includes(id))
    || !normalizedHumanoidSetA
    || !normalizedHumanoidSetB
    || Math.abs(profileWeightSum(normalizedHumanoidSetA.weights) - 1) > 1e-6
    || Math.abs(profileWeightSum(normalizedHumanoidSetB.weights) - 1) > 1e-6
    || requiredNormalizedHumanoidMotionDonorIds.some(id => (
        typeof normalizedHumanoidSetA.weights[String(id)] !== 'number'
        || typeof normalizedHumanoidSetB.weights[String(id)] !== 'number'
    ))
    || normalizedHumanoidMotionReference.donors.some(donor => (
        donor.dimensions.legLengthMeters <= 0
        || donor.dimensions.armLengthMeters <= 0
        || semanticOrderForReference.some(semantic => (
            donor.clips[semantic]?.frames.length !== donor.clips[semantic]?.frameCount
            || donor.clips[semantic]?.sampleRate !== 60
        ))
    ))
) {
    throw new Error('Normalized ten-donor Set A / Set B motion reference identity mismatch')
}
const normalizedHumanoidSetAProfile = normalizedHumanoidSetA!
const normalizedHumanoidSetBProfile = normalizedHumanoidSetB!
const normalizedHumanoidMotionReferenceSetA: NormalizedHumanoidMotionReference = {
    ...normalizedHumanoidMotionReference,
    blendWeights: normalizedHumanoidSetAProfile.weights,
}
const normalizedHumanoidMotionReferenceSetB: NormalizedHumanoidMotionReference = {
    ...normalizedHumanoidMotionReference,
    blendWeights: normalizedHumanoidSetBProfile.weights,
}
const nativeUpperBodyMotionReference = JSON.parse(
    nativeUpperBodyMotionReferenceJson,
) as NativeUpperBodyMotionReference
type NaturalUpperBodyProfileId = 'set-a' | '101901-dress-clearance-multidonor'
const targetRigMorphologyProfileId = 'target-rig-morphology-multidonor' as const
const targetRigMorphologyCharacterIds = new Set([102001, 102101])
function isMagicalGirlSourceCharacter(character: ViewerCharacter): boolean {
    return getViewerCharacterSourceFamilyAuthority(character).sourceFamily === 'magical-girl'
}
const naturalArmFingerDonorIds = [
    100201, 100202, 100301, 100401, 100501, 100801, 109201, 111501, 114501,
] as const
const naturalUpperBodyTrajectoryWeights: Record<
    NaturalUpperBodyProfileId,
    Record<'walk' | 'run', Record<string, number>>
> = {
    // Set A is the low-abduction cluster. 100501 supplies the compact fore/aft
    // run silhouette, 111501 supports its walking elbow path, and 100301 keeps
    // long-dress clearance without letting 100801's open horizontal run dominate.
    'set-a': {
        walk: {
            100201: 0.04, 100202: 0.04, 100301: 0.18, 100401: 0.06, 100501: 0.34,
            100801: 0.04, 109201: 0.04, 111501: 0.22, 114501: 0.04,
        },
        run: {
            100201: 0.12, 100202: 0.04, 100301: 0.20, 100401: 0.06, 100501: 0.36,
            100801: 0.04, 109201: 0.04, 111501: 0.10, 114501: 0.04,
        },
    },
    // Set B is the dress-clearance cluster. 100301 is the principal official
    // long-dress authority and 100501 supplies the compact fore/aft arm cycle.
    '101901-dress-clearance-multidonor': {
        walk: {
            100201: 0.03, 100202: 0.03, 100301: 0.38, 100401: 0.06, 100501: 0.24,
            100801: 0.04, 109201: 0.04, 111501: 0.14, 114501: 0.04,
        },
        run: {
            100201: 0.08, 100202: 0.03, 100301: 0.36, 100401: 0.06, 100501: 0.28,
            100801: 0.04, 109201: 0.04, 111501: 0.07, 114501: 0.04,
        },
    },
}
const humanoidMorphologyFeatureNames = [
    'characterHeightMeters',
    'hipWidthMeters',
    'legToArmRatio',
    'skirtRadialEnvelopeMeters',
    'sleeveCuffRadiusMeters',
    'hairLengthMeters',
    'restWristToSkirtDistanceMeters',
] as const
type HumanoidMorphologyFeatureName = typeof humanoidMorphologyFeatureNames[number]
type HumanoidMorphologyFeatures = Record<HumanoidMorphologyFeatureName, number>

function numericMorphologyFeature(
    features: Record<string, unknown>,
    name: HumanoidMorphologyFeatureName,
): number | undefined {
    const value = features[name]
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function deriveMorphologyNearestBlendWeights(
    target: HumanoidMorphologyFeatures,
    reference: NormalizedHumanoidMotionReference,
): { weights: Record<string, number>; distances: Record<string, number> } {
    const diagnostics = reference.morphologyDiagnostics
    if (!diagnostics) throw new Error('normalized motion morphology diagnostics are absent')
    const donorEntries = reference.donors.map(donor => {
        const record = diagnostics.donors[String(donor.characterId)]
        if (!record) throw new Error(`morphology donor ${donor.characterId} is absent`)
        return [String(donor.characterId), record.features] as const
    })
    const ranges = Object.fromEntries(humanoidMorphologyFeatureNames.map(name => {
        const values = donorEntries
            .map(([, features]) => numericMorphologyFeature(features, name))
            .filter((value): value is number => value !== undefined)
        return [name, Math.max(...values) - Math.min(...values)]
    })) as Record<HumanoidMorphologyFeatureName, number>
    const distances: Record<string, number> = {}
    const rawWeights: Record<string, number> = {}
    for (const [characterId, features] of donorEntries) {
        let weightedSquareDistance = 0
        let activeFeatureWeight = 0
        for (const name of humanoidMorphologyFeatureNames) {
            const donorValue = numericMorphologyFeature(features, name)
            const featureWeight = diagnostics.featureWeights[name] ?? 0
            if (donorValue === undefined || featureWeight <= 0) continue
            const normalizedDelta = (target[name] - donorValue) / Math.max(ranges[name], 1e-6)
            weightedSquareDistance += featureWeight * normalizedDelta * normalizedDelta
            activeFeatureWeight += featureWeight
        }
        const distance = Math.sqrt(weightedSquareDistance / Math.max(activeFeatureWeight, 1e-6))
        distances[characterId] = distance
        // A smooth nearest-neighbour kernel keeps all official cycles represented
        // while strongly preferring the target's own height/limb/clothing cluster.
        rawWeights[characterId] = Math.exp(-8 * distance * distance)
    }
    const total = profileWeightSum(rawWeights)
    if (total <= 0) throw new Error('morphology-nearest donor kernel has no positive weight')
    return {
        distances,
        weights: Object.fromEntries(Object.entries(rawWeights).map(([id, weight]) => (
            [id, weight / total]
        ))),
    }
}

function normalizedDonorWeightSubset(
    weights: Record<string, number>,
    donorIds: readonly number[],
): Record<string, number> {
    const selected = Object.fromEntries(donorIds.map(characterId => (
        [String(characterId), Math.max(0, weights[String(characterId)] ?? 0)]
    )))
    const total = profileWeightSum(selected)
    if (total <= 0) throw new Error('normalized donor subset has no positive weight')
    return Object.fromEntries(Object.entries(selected).map(([id, weight]) => [id, weight / total]))
}
if (
    nativeUpperBodyMotionReference.schema !== 'magius.native-upper-body-motion-reference.v1'
    || nativeUpperBodyMotionReference.sampleRate !== 60
    || Object.values(naturalUpperBodyTrajectoryWeights).some(weights => (
        Math.abs(profileWeightSum(weights.walk) - 1) > 1e-6
        || Math.abs(profileWeightSum(weights.run) - 1) > 1e-6
    ))
    || naturalArmFingerDonorIds.some(characterId => {
        const donor = nativeUpperBodyMotionReference.donors.find(candidate => (
            candidate.characterId === characterId
        ))
        return !donor
            || donor.status !== 'attached'
            || !donor.clips
            || donor.clips.walk.frames.length !== donor.clips.walk.frameCount
            || donor.clips.run.frames.length !== donor.clips.run.frameCount
            || donor.clips.walk.sampleRate !== 60
            || donor.clips.run.sampleRate !== 60
    })
) {
    throw new Error('Native nine-family upper-body and finger reference identity mismatch')
}
const officialCombat101901 = JSON.parse(officialCombat101901Json) as OfficialCombatRuntime
if (
    officialCombat101901.schema !== 2
    || officialCombat101901.viewerCharacterId !== 101901
    || !Array.isArray(officialCombat101901.actions)
    || !Array.isArray(officialCombat101901.clips)
) {
    throw new Error('Official 101901 combat runtime identity mismatch')
}
const officialCombatRuntimes: OfficialCombatRuntime[] = [officialCombat101901]
const officialCombatLoadStatus = 'ready-101901-only' as const
const officialCombatLoadError: string | undefined = undefined

const debugState = document.createElement('script')
debugState.id = 'magius-locomotion-debug-state'
debugState.type = 'application/json'
debugState.hidden = true
document.body.appendChild(debugState)

let installed = false
let enabled = false
let jumpQueued = false
let virtualInput: VirtualInput | undefined
let cameraYawUnwrapped = 0
let cameraPitch = THREE.MathUtils.degToRad(18)
let cameraYawTargetUnwrapped = cameraYawUnwrapped
let cameraPitchTarget = cameraPitch
let cameraDistance = 7.5
let cameraDistanceTarget = cameraDistance
const cameraTarget = new THREE.Vector3()
interface ViewerOrbitControlsLease {
    controlsEnabled: boolean
}
let orbitControlsLease: ViewerOrbitControlsLease | undefined
let orbitCameraSessionActive = false
let orbitControlsCanvasRebindCount = 0
interface TpsCameraInputTrace {
    source: 'pointer-lock' | 'drag-fallback' | 'free-look-fallback'
    dxCssPixels: number
    dyCssPixels: number
    yawBefore: number
    yawAfter: number
    pitchBefore: number
    pitchAfter: number
    preCollisionAzimuth: number
    postCollisionAzimuth: number
}
const cameraInputTrace: TpsCameraInputTrace[] = []
interface TpsCameraWheelTrace {
    accepted: boolean
    reason: 'pointer-lock' | 'viewer-surface' | 'outside-viewer' | 'interactive-control'
    targetTag: string
    targetId: string
    deltaY: number
    distanceBefore: number
    distanceAfter: number
}
const cameraWheelTrace: TpsCameraWheelTrace[] = []
let cameraDragPointerId: number | undefined
let cameraDragLastX = 0
let cameraDragLastY = 0
let cameraDragTravelCssPixels = 0
let cameraFreeLookFallbackActive = false
const TPS_CAMERA_POINTER = Object.freeze({
    yawRadiansPerCssPixel: 0.0018,
    pitchRadiansPerCssPixel: 0.0015,
    maxCssPixelsPerEvent: 42,
    minPitchRadians: THREE.MathUtils.degToRad(-18),
    maxPitchRadians: THREE.MathUtils.degToRad(55),
    wheelMetersPerDelta: 0.0035,
    maxWheelDeltaPerEvent: 120,
    maxDistanceMeters: 10,
    clickCaptureMaxTravelCssPixels: 6,
})

function boundedTpsPointerDelta(rawCssPixels: number): number {
    // PointerEvent.movementX/Y are already expressed in CSS pixels. Dividing
    // them by devicePixelRatio made a DPR=3 display require three times as much
    // physical mouse travel, which is why the corrected non-spinning camera
    // still felt almost immovable.
    return THREE.MathUtils.clamp(
        rawCssPixels,
        -TPS_CAMERA_POINTER.maxCssPixelsPerEvent,
        TPS_CAMERA_POINTER.maxCssPixelsPerEvent,
    )
}

function applyTpsCameraPointerDelta(
    rawDx: number,
    rawDy: number,
    source: TpsCameraInputTrace['source'],
): void {
    const dx = boundedTpsPointerDelta(rawDx)
    const dy = boundedTpsPointerDelta(rawDy)
    const yawBefore = cameraYawTargetUnwrapped
    const pitchBefore = cameraPitchTarget
    const requestedYaw = cameraYawTargetUnwrapped - dx * TPS_CAMERA_POINTER.yawRadiansPerCssPixel
    cameraYawTargetUnwrapped = requestedYaw
    cameraPitchTarget = THREE.MathUtils.clamp(
        cameraPitchTarget + dy * TPS_CAMERA_POINTER.pitchRadiansPerCssPixel,
        TPS_CAMERA_POINTER.minPitchRadians,
        TPS_CAMERA_POINTER.maxPitchRadians,
    )
    cameraInputTrace.push({
        source,
        dxCssPixels: dx,
        dyCssPixels: dy,
        yawBefore,
        yawAfter: cameraYawTargetUnwrapped,
        pitchBefore,
        pitchAfter: cameraPitchTarget,
        preCollisionAzimuth: cameraYawTargetUnwrapped,
        postCollisionAzimuth: cameraYawTargetUnwrapped,
    })
    if (cameraInputTrace.length > 60) {
        cameraInputTrace.splice(0, cameraInputTrace.length - 60)
    }
}

function objectIsWorldVisible(object: THREE.Object3D): boolean {
    for (let current: THREE.Object3D | null = object; current; current = current.parent) {
        if (!current.visible) return false
    }
    return true
}

function collisionObjectId(object: THREE.Object3D): string {
    const names: string[] = []
    for (let current: THREE.Object3D | null = object; current; current = current.parent) {
        if (current.name) names.unshift(current.name)
        if (current.name === 'Magius3DviewerStageRoot') break
    }
    return names.join('/') || object.uuid
}

const firstInteractionStageId = 'battle-600-00-01-001'
const firstInteractionSourceGroundPath =
    'bg_3d_600_00_01_001/bg3d600A_01_01/ground_grp/ground_geo'
// FBXLoader root is renamed to Stage:<id>; collision paths are relative to that renamed root.
const firstInteractionGroundPath = 'bg3d600A_01_01/ground_grp/ground_geo'
const firstInteractionBlockerPrefixes = [
    'bg3d600A_01_01/mid_grp/rock_grp/',
] as const

function pathFromRoot(root: THREE.Object3D, object: THREE.Object3D): string {
    const parts: string[] = []
    for (let current: THREE.Object3D | null = object; current; current = current.parent) {
        if (current === root) break
        parts.unshift(current.name || '<unnamed>')
    }
    return parts.join('/')
}

/** 101901 × 600-00-01-001 custom collision profile over existing render geometry. */
class ViewerSceneCollisionWorld implements
    CharacterCollisionWorld,
    CharacterGroundQuery,
    SecondaryPhysicsSceneCollisionWorld {
    private readonly fallback: FlatGroundCollisionWorld
    private lastConfirmedGroundY: number
    private groundState: 'ground-hit' | 'spawn-plane' | 'no-ground' = 'spawn-plane'
    private readonly raycaster = new THREE.Raycaster()
    private readonly normalMatrix = new THREE.Matrix3()
    private stageObject?: THREE.Object3D
    private currentStageId = 'none'
    private meshes: THREE.Mesh[] = []
    private collisionProxies: THREE.Mesh[] = []
    private groundCollisionProxies: THREE.Mesh[] = []
    private blockerCollisionProxies: THREE.Mesh[] = []
    private readonly sourceByCollisionProxy = new WeakMap<THREE.Mesh, THREE.Mesh>()
    private readonly collisionProxyMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    private groundMesh?: THREE.Mesh
    private groundMeshFound = false

    constructor(fallbackHeight: number) {
        this.lastConfirmedGroundY = fallbackHeight
        this.fallback = new FlatGroundCollisionWorld(fallbackHeight)
    }

    get groundStatus(): 'ground-hit' | 'spawn-plane' | 'no-ground' {
        return this.groundState
    }

    get confirmedGroundY(): number {
        return this.lastConfirmedGroundY
    }

    get mode(): 'stage-600-custom-triangle-profile' | 'profile-inactive' {
        this.refreshStageMeshes()
        return this.interactionReady
            ? 'stage-600-custom-triangle-profile'
            : 'profile-inactive'
    }

    get stageId(): string {
        this.refreshStageMeshes()
        return this.currentStageId
    }

    get interactionReady(): boolean {
        return this.currentStageId === firstInteractionStageId
            && this.groundMeshFound
            && this.meshes.length > 0
    }

    get meshCount(): number {
        this.refreshStageMeshes()
        return this.meshes.length
    }

    get profileProbe() {
        this.refreshStageMeshes()
        if (!this.groundMesh) return null
        const bounds = new THREE.Box3().setFromObject(this.groundMesh)
        const spawnHit = this.raycast(
            new THREE.Vector3(0, Math.max(2, bounds.max.y + 1), 0),
            new THREE.Vector3(0, -1, 0),
            0,
            Math.max(4, bounds.max.y - bounds.min.y + 3),
            this.groundCollisionProxies,
        )
        return {
            groundBounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
            spawnHit: spawnHit
                ? { point: spawnHit.point.toArray(), objectId: collisionObjectId(spawnHit.object) }
                : null,
        }
    }

    private refreshStageMeshes(): void {
        const root = scene.backgroundScene.getObjectByName('Magius3DviewerStageRoot')
        const active = root?.children.find(child => child.visible)
        const stageId = String(root?.userData.stageDefinition?.id ?? 'none')
        if (active === this.stageObject && stageId === this.currentStageId) return
        this.stageObject = active
        this.currentStageId = stageId
        this.meshes = []
        this.collisionProxies = []
        this.groundCollisionProxies = []
        this.blockerCollisionProxies = []
        this.groundMesh = undefined
        this.groundMeshFound = false
        if (stageId !== firstInteractionStageId || !active) return
        active.updateWorldMatrix(true, true)
        active?.traverse(object => {
            const mesh = object as THREE.Mesh
            if (!mesh.isMesh || !mesh.geometry || !objectIsWorldVisible(mesh)) return
            const position = mesh.geometry.getAttribute('position')
            if (!position?.count) return
            const path = pathFromRoot(active, mesh)
            const isGround = path === firstInteractionGroundPath
            const isBlocker = firstInteractionBlockerPrefixes.some(prefix => path.startsWith(prefix))
            if (!isGround && !isBlocker) return
            if (isGround) {
                this.groundMeshFound = true
                this.groundMesh = mesh
            }
            this.meshes.push(mesh)
            const proxy = new THREE.Mesh(mesh.geometry, this.collisionProxyMaterial)
            proxy.name = `CollisionProxy:${path}`
            proxy.matrixAutoUpdate = false
            proxy.matrixWorld.copy(mesh.matrixWorld)
            this.sourceByCollisionProxy.set(proxy, mesh)
            this.collisionProxies.push(proxy)
            if (isGround) this.groundCollisionProxies.push(proxy)
            else this.blockerCollisionProxies.push(proxy)
        })
    }

    private raycast(
        origin: THREE.Vector3,
        direction: THREE.Vector3,
        near: number,
        far: number,
        targets: THREE.Mesh[] = this.collisionProxies,
    ): THREE.Intersection | undefined {
        this.refreshStageMeshes()
        if (!targets.length || far <= near) return undefined
        this.raycaster.set(origin, direction)
        this.raycaster.near = Math.max(0, near)
        this.raycaster.far = far
        const hit = this.raycaster.intersectObjects(targets, false)
            .find(candidate => {
                const source = this.sourceByCollisionProxy.get(candidate.object as THREE.Mesh)
                return !!source && objectIsWorldVisible(source)
            })
        if (!hit) return undefined
        return {
            ...hit,
            object: this.sourceByCollisionProxy.get(hit.object as THREE.Mesh)!,
        }
    }

    private hitNormal(hit: THREE.Intersection): THREE.Vector3 {
        if (!hit.face) return new THREE.Vector3(0, 1, 0)
        this.normalMatrix.getNormalMatrix(hit.object.matrixWorld)
        return hit.face.normal.clone().applyNormalMatrix(this.normalMatrix).normalize()
    }

    private groundFrom(
        position: THREE.Vector3,
        maxDistance: number,
        skinWidth: number,
    ): CharacterGroundHit | null {
        this.refreshStageMeshes()
        if (!this.meshes.length) return null
        const lift = Math.max(0.08, skinWidth * 2)
        const origin = position.clone().add(new THREE.Vector3(0, lift, 0))
        const hit = this.raycast(
            origin,
            new THREE.Vector3(0, -1, 0),
            0,
            maxDistance + lift,
            this.groundCollisionProxies,
        )
        if (!hit) return null
        const distance = position.y - hit.point.y
        if (distance < -skinWidth || distance > maxDistance) return null
        const normal = this.hitNormal(hit)
        return {
            point: hit.point.clone(),
            normal,
            distance,
            walkable: normal.y > 0,
            objectId: collisionObjectId(hit.object),
        }
    }

    queryGround(query: Readonly<CharacterGroundQueryInput>): CharacterGroundHit | null {
        const hit = this.groundFrom(query.position, query.maxDistance, query.collider.skinWidth)
        if (hit) {
            this.lastConfirmedGroundY = hit.point.y
            this.groundState = 'ground-hit'
            return hit
        }
        if (!this.interactionReady) {
            this.groundState = 'spawn-plane'
            return this.fallback.queryGround(query)
        }

        // A decorative mesh must never turn a ground miss into unbounded fall.
        // Keep the last confirmed/spawn height while exposing the miss in HUD.
        this.groundState = 'no-ground'
        return {
            point: new THREE.Vector3(query.position.x, this.lastConfirmedGroundY, query.position.z),
            normal: new THREE.Vector3(0, 1, 0),
            distance: query.position.y - this.lastConfirmedGroundY,
            walkable: true,
            objectId: 'viewer:last-confirmed-ground-lock',
        }
    }

    resolveMotion(query: Readonly<CharacterMotionQuery>): CharacterMotionResult {
        this.refreshStageMeshes()
        if (!this.interactionReady) {
            this.groundState = 'spawn-plane'
            return this.fallback.resolveMotion(query)
        }

        const position = query.startPosition.clone()
        const velocity = query.velocity.clone()
        const contacts: CharacterCollisionContact[] = []
        const horizontal = new THREE.Vector3(
            query.desiredDisplacement.x,
            0,
            query.desiredDisplacement.z,
        )
        const horizontalDistance = horizontal.length()
        if (horizontalDistance > 1e-8) {
            const direction = horizontal.clone().multiplyScalar(1 / horizontalDistance)
            const radius = query.collider.radius + query.collider.skinWidth
            const centerY = query.collider.center.y
            const halfSegment = Math.max(0, query.collider.height * 0.5 - query.collider.radius)
            const sampleYs = [centerY - halfSegment, centerY, centerY + halfSegment]
            let nearest: THREE.Intersection | undefined
            for (const sampleY of sampleYs) {
                const origin = query.startPosition.clone().add(new THREE.Vector3(0, sampleY, 0))
                const hit = this.raycast(
                    origin,
                    direction,
                    0,
                    horizontalDistance + radius,
                    this.blockerCollisionProxies,
                )
                if (hit && (!nearest || hit.distance < nearest.distance)) nearest = hit
            }
            if (nearest && nearest.distance < horizontalDistance + radius) {
                const normal = this.hitNormal(nearest)
                const allowed = Math.max(0, nearest.distance - radius)
                const primary = direction.clone().multiplyScalar(Math.min(horizontalDistance, allowed))
                const remaining = horizontal.clone().sub(primary)
                remaining.addScaledVector(normal, -remaining.dot(normal))
                position.add(primary).add(remaining)
                if (velocity.dot(normal) < 0) velocity.addScaledVector(normal, -velocity.dot(normal))
                contacts.push({
                    point: nearest.point.clone(),
                    normal,
                    objectId: collisionObjectId(nearest.object),
                })
            } else {
                position.add(horizontal)
            }
        }

        position.y += query.desiredDisplacement.y
        let grounded = false
        if (query.desiredDisplacement.y <= 0) {
            const lift = Math.max(0.08, query.collider.skinWidth * 2)
            const origin = query.startPosition.clone().add(new THREE.Vector3(0, lift, 0))
            const stageHit = this.raycast(
                origin,
                new THREE.Vector3(0, -1, 0),
                0,
                -query.desiredDisplacement.y + lift + query.collider.skinWidth,
                this.groundCollisionProxies,
            )
            const normal = stageHit ? this.hitNormal(stageHit) : undefined
            if (
                stageHit
                && normal
                && normal.y > 0
                && position.y <= stageHit.point.y + query.collider.skinWidth
            ) {
                position.y = stageHit.point.y
                velocity.y = 0
                grounded = true
                this.lastConfirmedGroundY = stageHit.point.y
                this.groundState = 'ground-hit'
                contacts.push({
                    point: stageHit.point.clone(),
                    normal,
                    objectId: collisionObjectId(stageHit.object),
                })
            }
        }
        if (!grounded && query.wasGrounded && query.desiredDisplacement.y <= 0) {
            const snap = this.groundFrom(position, 0.12, query.collider.skinWidth)
            if (snap && snap.normal.y > 0) {
                position.y = snap.point.y
                velocity.y = 0
                grounded = true
                this.lastConfirmedGroundY = snap.point.y
                this.groundState = 'ground-hit'
            }
        }
        if (!grounded && query.desiredDisplacement.y <= 0) {
            // A short contact sweep must not collapse the airborne/fall phase.
            // Keep integrating gravity while a verified walkable triangle still
            // exists below the capsule; apply the last-ground lock only after
            // the character has actually left this stage's collision coverage.
            const lift = Math.max(0.08, query.collider.skinWidth * 2)
            const support = this.raycast(
                position.clone().add(new THREE.Vector3(0, lift, 0)),
                new THREE.Vector3(0, -1, 0),
                0,
                Math.max(8, query.collider.height * 4),
                this.groundCollisionProxies,
            )
            const supportNormal = support ? this.hitNormal(support) : undefined
            if (support && supportNormal && supportNormal.y > 0) {
                this.lastConfirmedGroundY = support.point.y
                this.groundState = 'ground-hit'
            } else {
                position.y = this.lastConfirmedGroundY
                velocity.y = 0
                grounded = true
                this.groundState = 'no-ground'
            }
        }
        return {
            position,
            velocity,
            grounded,
            groundNormal: grounded
                ? contacts[contacts.length - 1]?.normal.clone() ?? new THREE.Vector3(0, 1, 0)
                : undefined,
            contacts,
        }
    }

    resolveParticleMotion(
        query: Readonly<SecondaryPhysicsParticleMotionQuery>,
    ): SecondaryPhysicsParticleMotionResult {
        this.refreshStageMeshes()
        if (!this.interactionReady) {
            const position = query.desiredPosition.clone()
            if (position.y < this.fallback.height + query.radius) {
                position.y = this.fallback.height + query.radius
                return {
                    position,
                    contacts: [{
                        point: new THREE.Vector3(position.x, this.fallback.height, position.z),
                        normal: new THREE.Vector3(0, 1, 0),
                        objectId: 'spawn-plane-fallback',
                    }],
                    remainingPenetration: 0,
                }
            }
            return { position, contacts: [], remainingPenetration: 0 }
        }
        const displacement = query.desiredPosition.clone().sub(query.previousPosition)
        const distance = displacement.length()
        if (distance <= 1e-8) {
            return { position: query.desiredPosition.clone(), contacts: [], remainingPenetration: 0 }
        }
        const direction = displacement.clone().multiplyScalar(1 / distance)
        const hit = this.raycast(query.previousPosition, direction, 0, distance + query.radius)
        if (!hit || hit.distance >= distance + query.radius) {
            return { position: query.desiredPosition.clone(), contacts: [], remainingPenetration: 0 }
        }
        const normal = this.hitNormal(hit)
        return {
            position: hit.point.clone().addScaledVector(normal, query.radius),
            contacts: [{ point: hit.point.clone(), normal, objectId: collisionObjectId(hit.object) }],
            remainingPenetration: 0,
        }
    }
}

export interface ViewerPerformanceTransform {
    position: readonly [number, number, number]
    rotation: readonly [number, number, number, number]
    scale: readonly [number, number, number]
}
export interface ViewerPerformancePose {
    root?: ViewerPerformanceTransform
    bones: Record<string, ViewerPerformanceTransform>
    morphs: Record<string, number>
}
export interface ViewerPerformanceActor {
    object: THREE.Object3D
    generation: number
    label: string
    actions: readonly string[]
    isCurrent(): boolean
}
export interface ViewerPerformanceChannels {
    root: boolean
    /** Pre-physics evaluated capture/commit set, including ordinary action bones. */
    bones: readonly string[]
    /** Exact manual/FK/IK subset; only this set excludes other bone writers. */
    exclusiveBones: readonly string[]
    morphs: readonly string[]
    action: boolean
}
export interface ViewerPerformanceBeat {
    keyId: string
    occurrenceId: string
    name: string
    loop: boolean
    localTimeSeconds: number
    transitionSeconds: number
}
type ViewerPerformanceAvailability<T> = { status: 'ready'; value: T } | { status: 'unavailable'; reason: string }
export interface ViewerPerformanceHostOptions {
    /** Exact UI manual/gizmo/voice ownership lease. Missing authority is not consent. */
    acquireExternalChannels?: (actor: ViewerPerformanceActor, channels: ViewerPerformanceChannels) => ViewerPerformanceAvailability<{
        readonly active: boolean
        /** Evaluator-only morph handoff; retains body/lease authority, no lower blend. */
        beginMorphReturn?(): ViewerPerformanceAvailability<void>
        release(): void
    }>
    /** Exact native resolved writable-bone intersection; no name-based inference. */
    nativePhysicsConflicts?: (actor: ViewerPerformanceActor, bones: readonly THREE.Object3D[]) => ViewerPerformanceAvailability<readonly string[]>
}
interface ViewerPerformanceFrameContext { frameId: number; actorKey: string; generation: number }
interface ViewerPerformanceEvaluatorFrame extends ViewerPerformanceFrameContext { readonly pose: ViewerPerformancePose }
// These are the retained THREE evaluator buffers, not scene/display transforms.
// AnimationMixer.update applies buffer[(accuIndex + 1) * valueSize] after weighting
// all active actions. Read the resolved target identity, never a track-name guess.
interface ViewerPerformanceMixerBuffer {
    valueSize: number
    buffer: ArrayLike<number>
    binding: { targetObject?: THREE.Object3D; resolvedProperty?: unknown; propertyIndex?: string | number;
        parsedPath: { propertyName: string } }
}
type ViewerPerformanceMixer = {
    getRoot(): THREE.Object3D
    _bindings: ViewerPerformanceMixerBuffer[]; _nActiveBindings: number; _accuIndex: number
    _actions: THREE.AnimationAction[]; _nActiveActions: number
}
interface ViewerPerformanceTimelineState {
    producer: object; kind: 'direct-home' | 'combat-skeleton' | 'jump-donor'; cursor: string; paused: boolean
}
interface ViewerPerformanceMixerEpoch { revision: number; frameId: number }
const viewerPerformanceMixerEpochs = new WeakMap<THREE.AnimationMixer, ViewerPerformanceMixerEpoch>()
const viewerPerformanceTimelineWitnesses = new WeakMap<THREE.Object3D, {
    binding: ViewerLocomotionBinding; generation: number; state: ViewerPerformanceTimelineState;
    mixer: THREE.AnimationMixer; minimumRevision: number; frameId: number; actions: ReadonlySet<THREE.AnimationAction>
}>()
function viewerPerformanceTimelineState(binding: ViewerLocomotionBinding): ViewerPerformanceTimelineState | undefined {
    const home = binding.directHomeActions?.active, skeleton = binding.combatJumpActions?.activeSkeletonPlayback, jump = binding.combatJumpActions?.activeJumpDonorPlayback
    if ([home, skeleton, jump].filter(Boolean).length !== 1) return undefined
    if (home) {
        if (!Array.isArray(home.phases) || !home.phases.length) return undefined
        const time = home.timeline?.time ?? 0
        if (!Number.isFinite(time)) return undefined
        const phase = home.phases.find(value => time >= value.startTime - 1e-6 && time < value.endTime - 1e-6)
            ?? home.phases.find(value => value.phase === 'restore' && time >= value.startTime - 1e-6)
        if (!phase) return undefined
        return {producer: home, kind: 'direct-home', cursor: JSON.stringify([home.catalogActionId, phase.phase, phase.clip.name, home.timeline ? time : 'loop']),
            paused: binding.character.animation.paused || (!!home.timeline && !home.timeline.playing)}
    }
    if (skeleton) {
        if (!skeleton.playback?.state || !Array.isArray(skeleton.roles)) return undefined
        const state = skeleton.playback.state()
        if (!Number.isFinite(state.timeSeconds) || !skeleton.roles.some(role => role.role === 'body' && role.currentAction)) return undefined
        return {producer: skeleton, kind: 'combat-skeleton', cursor: JSON.stringify([state.timeSeconds, skeleton.roles.map(role => [role.targetId, role.currentPhase?.clipName])]), paused: !state.playing}
    }
    if (jump) {
        const phase = binding.snapshot.state
        if (!['jump', 'fall', 'land'].includes(phase) || !Number.isFinite(jump.elapsedSeconds)) return undefined
        return {producer: jump, kind: 'jump-donor', cursor: JSON.stringify([jump.actionId, jump.elapsedSeconds, phase, jump.sequence[phase as 'jump' | 'fall' | 'land']]),
            paused: binding.characterActionPlayback.status === 'paused'}
    }
}
/** Observe the real mixer invocation, with the same receiver/result and no extra
 * evaluation. Source callsites establish the producer; this counter proves that
 * a deferred AnimationPort play has actually reached AnimationMixer.update.
 */
function observeViewerPerformanceTimelineMixer(binding: ViewerLocomotionBinding): ViewerPerformanceMixerEpoch {
    const mixer = binding.character.animation.mixer, prior = viewerPerformanceMixerEpochs.get(mixer)
    if (prior) return prior
    const epoch = {revision: 0, frameId: -1}, original = mixer.update
    function update(this: THREE.AnimationMixer, delta: number) {
        const result = original.call(this, delta)
        if (this === mixer) { epoch.revision++; epoch.frameId = viewerPerformanceFrameId }
        return result
    }
    mixer.update = update; viewerPerformanceMixerEpochs.set(mixer, epoch)
    const cleanup = () => {
        if (mixer.update === update) mixer.update = original
        if (viewerPerformanceMixerEpochs.get(mixer) === epoch) viewerPerformanceMixerEpochs.delete(mixer)
        if (viewerPerformanceTimelineWitnesses.get(binding.character.object)?.binding === binding) viewerPerformanceTimelineWitnesses.delete(binding.character.object)
    }
    binding.character.userData.disposeCallbacks.push(cleanup)
    return epoch
}
/** Called only at the existing actual producer routes, never by a frame caller. */
function publishViewerPerformanceTimelineProducer(binding: ViewerLocomotionBinding, producer: object, minimumRevision: number): void {
    const state = viewerPerformanceTimelineState(binding), object = binding.character.object
    const mixer = binding.character.animation.mixer, access = mixer as unknown as ViewerPerformanceMixer
    if (!state || state.producer !== producer || bindingByObject.get(object) !== binding || binding.sceneCharacter.character !== binding.character
        || !Array.isArray(access._actions) || !Number.isSafeInteger(access._nActiveActions)) return
    const actions = access._actions.slice(0, access._nActiveActions)
    if (!actions.length || actions.some(action => action.getMixer() !== mixer)) return
    viewerPerformanceTimelineWitnesses.set(object, {binding, generation: binding.sceneCharacter.loadGeneration ?? 0, state, mixer,
        minimumRevision, frameId: viewerPerformanceFrameId, actions: new Set(actions)})
}
let viewerPerformanceFrameId = 0
const viewerPerformanceClaims = new WeakMap<THREE.Object3D, { channels: ViewerPerformanceChannels; leasedBones: ReadonlySet<THREE.Object3D>; dispose(): void }>()

/** Actor-scoped evaluated-pose host; independent from editor/UI module ownership. */
export function createViewerPerformanceHost(options: ViewerPerformanceHostOptions = {}) {
    const beforePhysics = new Set<(delta: number, context: ViewerPerformanceFrameContext) => void>()
    const finalPose = new Set<() => void>()
    const entries = new Map<string, { current(): boolean; release(pose: ViewerPerformancePose, seconds: number): void; capture(): ViewerPerformancePose; cleanup(): void; final(): void; active(): boolean }>()
    let disposed = false
    let finalFrame = -1
    const unavailable = (reason: string): { status: 'unavailable'; reason: string } => ({ status: 'unavailable', reason })
    const transform = (object: THREE.Object3D): ViewerPerformanceTransform => ({
        position: object.position.toArray(), rotation: object.quaternion.toArray(), scale: object.scale.toArray(),
    })
    const validTransform = (value: ViewerPerformanceTransform) => (
        value.position.length === 3 && value.rotation.length === 4 && value.scale.length === 3
        && [...value.position, ...value.rotation, ...value.scale].every(Number.isFinite)
        && value.scale.every(number => number !== 0)
        && value.rotation.reduce((sum, number) => sum + number * number, 0) > 1e-12
    )
    const clone = (pose: ViewerPerformancePose): ViewerPerformancePose => JSON.parse(JSON.stringify(pose))
    const channelHost = {
        acquire(actor: ViewerPerformanceActor, requested: ViewerPerformanceChannels) {
            const actorObject = actor.object, actorGeneration = actor.generation, actorKey = actorObject.uuid
            const binding = bindingByObject.get(actorObject)
            const character = binding?.character
            const sceneCharacter = binding?.sceneCharacter
            const identityCurrent = () => !!binding && !!character && !disposed && !character.disposed
                && bindingByObject.get(actorObject) === binding && binding.character === character
                && sceneCharacter?.character === character && !sceneCharacter.loading && !sceneCharacter.removed
                && character.object === actorObject && actor.object === actorObject && actorObject.uuid === actorKey
                && (sceneCharacter.loadGeneration ?? 0) === actorGeneration && actor.generation === actorGeneration && actor.isCurrent()
            if (!identityCurrent() || !binding || !character) return unavailable('stale UUID/generation/character reference')
            if (!Number.isSafeInteger(actorGeneration) || actorGeneration < 0) return unavailable('invalid actor generation')
            const existing = entries.get(actorKey)
            if (existing?.active()) return unavailable('actor channels already leased')
            if (viewerPerformanceClaims.has(actorObject) && !existing) return unavailable('actor leased by another host')
            if (!Array.isArray(requested.bones) || !Array.isArray(requested.exclusiveBones) || !Array.isArray(requested.morphs)
                || typeof requested.action !== 'boolean' || typeof requested.root !== 'boolean') return unavailable('explicit channel selection required')
            const channels: ViewerPerformanceChannels = { ...requested, bones: [...new Set(requested.bones)],
                exclusiveBones: [...new Set(requested.exclusiveBones)], morphs: [...new Set(requested.morphs)] }
            if (channels.exclusiveBones.some(key => !channels.bones.includes(key))) return unavailable('exclusive bones must be a subset of evaluated bones')
            if (!channels.action && channels.bones.some(key => !channels.exclusiveBones.includes(key))) return unavailable('action=false requires every bone to be exclusive')
            const boneIndex = new Map<string, THREE.Object3D>()
            const morphIndex = new Map<string, { values: number[]; index: number }>()
            const visit = (object: THREE.Object3D, key: string) => {
                if ((object as THREE.Bone).isBone) boneIndex.set(key, object)
                const mesh = object as THREE.Mesh
                if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
                    for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
                        if (Number.isInteger(index) && index >= 0 && index < mesh.morphTargetInfluences.length) {
                            morphIndex.set(`${key}#${encodeURIComponent(name)}`, { values: mesh.morphTargetInfluences, index })
                        }
                    }
                }
                object.children.forEach((child, index) => visit(child, `${key}/${index}:${child.name}`))
            }
            visit(actorObject, '.')
            if (channels.bones.some(key => !boneIndex.has(key)) || channels.morphs.some(key => !morphIndex.has(key))) return unavailable('exact bone/morph channel absent')
            const exclusiveObjects = channels.exclusiveBones.map(key => boneIndex.get(key)!)
            // Skeleton inverse binds are immutable authored input. Never initialize an
            // unkeyed channel from the displayed pose when a manual lease begins.
            const bindWorld = new Map<THREE.Object3D, THREE.Matrix4>()
            const ambiguousBind = new Set<THREE.Object3D>()
            const invalidBind = new Set<THREE.Object3D>()
            actorObject.traverse(object => {
                const mesh = object as THREE.SkinnedMesh
                if (!mesh.isSkinnedMesh || !mesh.skeleton) return
                mesh.skeleton.bones.forEach((bone, index) => {
                    const inverse = mesh.skeleton.boneInverses[index]
                    if (!inverse || !inverse.elements.every(Number.isFinite) || Math.abs(inverse.determinant()) < 1e-12) {
                        invalidBind.add(bone)
                        return
                    }
                    const world = inverse.clone().invert(), prior = bindWorld.get(bone)
                    if (prior && prior.elements.some((value, i) => Math.abs(value - world.elements[i]) > 1e-7)) ambiguousBind.add(bone)
                    else bindWorld.set(bone, world)
                })
            })
            const authored = new Map<THREE.Object3D, ViewerPerformanceTransform>()
            for (const object of boneIndex.values()) {
                const world = bindWorld.get(object), parent = object.parent
                if (ambiguousBind.has(object) || ((parent as THREE.Bone | null)?.isBone && ambiguousBind.has(parent!))) continue
                if (!world || ((parent as THREE.Bone | null)?.isBone && !bindWorld.has(parent!))) {
                    // A damaged existing bind is not absent static-ancestor evidence.
                    if (invalidBind.has(object) || ((parent as THREE.Bone | null)?.isBone && invalidBind.has(parent!))) continue
                    // Registered skin ancestors may have no inverse bind or keyed channel.
                    // Their loader-time local TRS is independent producer input, not the
                    // displayed full-pose document or a guessed identity transform.
                    const parsedLocal = readParsedBoneLocal(actorObject, object)
                    if (parsedLocal && validTransform(parsedLocal)) authored.set(object, parsedLocal)
                    continue
                }
                const local = (parent as THREE.Bone | null)?.isBone ? bindWorld.get(parent!)!.clone().invert().multiply(world) : world
                const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3()
                local.decompose(position, rotation, scale)
                const value: ViewerPerformanceTransform = {position: position.toArray(), rotation: rotation.toArray(), scale: scale.toArray()}
                const recomposed = new THREE.Matrix4().compose(position, rotation, scale)
                if (validTransform(value) && recomposed.elements.every((number, i) => Math.abs(number - local.elements[i]) < 1e-7)) authored.set(object, value)
            }
            const evaluateInput = (): ViewerPerformanceAvailability<ViewerPerformancePose> => {
                const wait = (reason: string) => unavailable('WAIT_EVALUATED_FRAME: ' + reason)
                if (binding.directHomeActions?.active || binding.combatJumpActions?.activeSkeletonPlayback || binding.combatJumpActions?.activeJumpDonorPlayback) {
                    const state = viewerPerformanceTimelineState(binding), witness = viewerPerformanceTimelineWitnesses.get(actorObject)
                    const epoch = viewerPerformanceMixerEpochs.get(character.animation?.mixer)
                    const access = character.animation?.mixer as unknown as ViewerPerformanceMixer | undefined
                    if (!state || !witness || !epoch || witness.binding !== binding || witness.generation !== actorGeneration
                        || witness.state.producer !== state.producer || witness.state.kind !== state.kind || witness.state.cursor !== state.cursor
                        || witness.mixer !== character.animation.mixer || epoch.revision < witness.minimumRevision
                        || (!state.paused && (witness.frameId !== viewerPerformanceFrameId || epoch.frameId !== viewerPerformanceFrameId))) return wait('independent timeline producer/frame/phase not evaluated')
                    const actions = access?._actions?.slice(0, access._nActiveActions)
                    if (!actions?.length || actions.some(action => !witness.actions.has(action) || action.getMixer() !== witness.mixer)) return wait('independent timeline action ownership changed')
                }
                const mixer = character.animation?.mixer as unknown as ViewerPerformanceMixer | undefined
                if (!mixer || mixer.getRoot() !== actorObject || !Array.isArray(mixer._bindings)
                    || !Number.isSafeInteger(mixer._nActiveBindings) || ![0, 1].includes(mixer._accuIndex)) return wait('exact retained AnimationMixer absent')
                const buffers = mixer._bindings.slice(0, mixer._nActiveBindings)
                const field = (object: THREE.Object3D, property: 'position' | 'quaternion' | 'scale', size: number, base?: readonly number[]) => {
                    const values = base ? [...base] : Array<number>(size).fill(NaN), written = new Set<number>()
                    for (const entry of buffers) {
                        const target = entry.binding
                        if (target.targetObject !== object || target.parsedPath.propertyName !== property || target.resolvedProperty !== object[property]) continue
                        const offset = (mixer._accuIndex + 1) * entry.valueSize
                        const component = target.propertyIndex === undefined ? undefined : ['x', 'y', 'z', 'w'].indexOf(String(target.propertyIndex))
                        const indices = component === undefined && entry.valueSize === size ? [...Array(size).keys()] : component !== undefined && component >= 0 && component < size && entry.valueSize === 1 ? [component] : []
                        if (!indices.length) return undefined
                        for (const [i, index] of indices.entries()) {
                            if (written.has(index)) return undefined
                            written.add(index); values[index] = entry.buffer[offset + i]
                        }
                    }
                    return values.every(Number.isFinite) ? values : undefined
                }
                const pose: ViewerPerformancePose = {bones: {}, morphs: {}}
                // Root placement remains the controller/editor placement; it is not
                // used as bone evaluator provenance or a native simulation input.
                if (channels.root) pose.root = transform(actorObject)
                for (const key of channels.bones) {
                    const object = boneIndex.get(key)!, base = authored.get(object)
                    const position = field(object, 'position', 3, base?.position), rotation = field(object, 'quaternion', 4, base?.rotation), scale = field(object, 'scale', 3, base?.scale)
                    if (!position || !rotation || !scale) return wait('authored/unkeyed or evaluated bone channel absent:' + key)
                    pose.bones[key] = {position: position as [number, number, number], rotation: rotation as [number, number, number, number], scale: scale as [number, number, number]}
                    if (!validTransform(pose.bones[key])) return wait('invalid evaluated transform:' + key)
                }
                for (const key of channels.morphs) {
                    const morph = morphIndex.get(key)!
                    const matches = buffers.filter(entry => entry.binding.parsedPath.propertyName === 'morphTargetInfluences'
                        && entry.binding.resolvedProperty === morph.values && (entry.binding.propertyIndex === undefined || Number(entry.binding.propertyIndex) === morph.index))
                    if (matches.length !== 1) return wait('independent morph evaluator absent:' + key)
                    const entry = matches[0], index = entry.binding.propertyIndex === undefined ? morph.index : 0
                    const value = entry.buffer[(mixer._accuIndex + 1) * entry.valueSize + index]
                    if (index >= entry.valueSize || !Number.isFinite(value)) return wait('invalid evaluated morph:' + key)
                    pose.morphs[key] = value
                }
                return {status: 'ready', value: pose}
            }
            let nativeLease: import('./characterPhysics/runtime').NativeManualOutputLease | undefined
            let nativeRuntime: import('./characterPhysics/runtime').NativeCharacterPhysicsRuntime | undefined
            let nativeTargets: THREE.Object3D[] = []
            let sawNativeAttachment = false
            const nativeUnavailable = (acquiring = false): string | undefined => {
                const attachment = getViewerCharacterPhysicsAttachment(actorObject)
                if (!attachment) return sawNativeAttachment || channels.action || channels.bones.length ? 'native attachment absent' : undefined
                sawNativeAttachment = true
                if (attachment.root !== actorObject) return 'native attachment root mismatch'
                if (attachment.status !== 'ready') return `native attachment ${attachment.status}`
                if (!attachment.runtime?.getWritableChannelSnapshot) return 'native writable-channel authority unknown'
                const snapshot = attachment.runtime.getWritableChannelSnapshot()
                if (snapshot.root !== actorObject) return 'native writable snapshot root mismatch'
                if (snapshot.status !== 'ready') return `native writable channels:${snapshot.reason}`
                if (!channels.bones.length && !channels.action) return undefined
                const authority = options.nativePhysicsConflicts?.(actor, exclusiveObjects)
                if (!authority) return 'native writable-channel authority unknown'
                if (authority.status !== 'ready') return authority.reason
                const overlap = exclusiveObjects.filter(object => snapshot.outputObjects.has(object))
                if (authority.value.length && !overlap.length) return `native writable-channel conflict:${authority.value.join(',')}`
                if (acquiring && overlap.length) {
                    if (!attachment.runtime.acquireManualOutputLease) return 'native writable-channel conflict: manual lease primitive absent'
                    const evaluated = evaluateInput()
                    if (evaluated.status !== 'ready') return 'native writable-channel conflict: ' + evaluated.reason
                    nativeRuntime = attachment.runtime; nativeTargets = overlap
                } else if (overlap.length) {
                    if (!nativeLease || attachment.runtime !== nativeRuntime || overlap.length !== nativeTargets.length
                        || overlap.some(object => !nativeTargets.includes(object))) return 'native writable-channel conflict: exact manual lease absent'
                    if (nativeLease.state === 'released' && !releasing) return 'native manual lease released before return'
                    if (nativeLease.state === 'invalid' || (nativeLease.state !== 'released' && overlap.some(object => !nativeLease!.owns(object)))) return 'native manual lease invalidated'
                } else if (nativeTargets.length) return 'native output membership changed'
                return undefined
            }
            const nativeReason = nativeUnavailable(true)
            if (nativeReason) return unavailable(nativeReason)
            if (!options.acquireExternalChannels) return unavailable('external manual/voice/root channel authority unknown')
            // Finish the previous return overlay before requesting the new lease;
            // its currently evaluated output is intentionally left untouched.
            existing?.cleanup()
            const external = options.acquireExternalChannels(actor, channels)
            if (external.status !== 'ready') return external
            if (external.value.active !== true) {
                external.value.release()
                return unavailable('external channel lease is not active')
            }
            let live = true
            let cleaned = false
            if (nativeRuntime && nativeTargets.length) {
                const acquired = nativeRuntime.acquireManualOutputLease({root: actorObject, actorGeneration,
                    isCurrent: () => !cleaned && identityCurrent() && external.value.active === true, outputs: nativeTargets})
                if (acquired.status !== 'ready') { external.value.release(); return acquired }
                nativeLease = acquired.value
            }
            let issued: {token: ViewerPerformanceEvaluatorFrame; pose: ViewerPerformancePose} | undefined
            let committedFrame = -1
            const current = () => !cleaned && identityCurrent() && external.value.active === true && nativeUnavailable() === undefined
            let externalReleased = false
            let inActorPhase = false
            let lastFrame = -1
            let currentAction: string | undefined
            const emittedOccurrences = new Set<string>()
            let releasing: { from: ViewerPerformancePose; elapsed: number; duration: number; first: boolean } | undefined
            let morphReturn: {from: Record<string, number>; elapsed: number; phase: 'waiting' | 'returning' | 'complete' | 'cancelled'; readyFrame?: number; reason?: string} | undefined
            let evaluatedBase: ViewerPerformancePose | undefined
            let lastOutput: ViewerPerformancePose | undefined
            const capture = (): ViewerPerformancePose => {
                if (!current()) throw new Error('stale performance capture')
                const pose: ViewerPerformancePose = { bones: {}, morphs: {} }
                if (channels.root) pose.root = transform(actorObject)
                for (const key of channels.bones) pose.bones[key] = transform(boneIndex.get(key)!)
                for (const key of channels.morphs) { const morph = morphIndex.get(key)!; pose.morphs[key] = morph.values[morph.index] }
                validate(pose)
                return pose
            }
            const validate = (pose: ViewerPerformancePose) => {
                if (!!pose.root !== channels.root || (pose.root && !validTransform(pose.root))
                    || Object.keys(pose.bones).length !== channels.bones.length || Object.keys(pose.morphs).length !== channels.morphs.length
                    || channels.bones.some(key => !pose.bones[key] || !validTransform(pose.bones[key]))
                    || channels.morphs.some(key => !Number.isFinite(pose.morphs[key]))) throw new Error('invalid or unleased evaluated pose channel')
            }
            const scratchPosition = new THREE.Vector3(), scratchRotation = new THREE.Quaternion(), scratchScale = new THREE.Vector3()
            const applyTransform = (object: THREE.Object3D, from: ViewerPerformanceTransform, alpha: number) => {
                scratchPosition.copy(object.position); scratchRotation.copy(object.quaternion); scratchScale.copy(object.scale)
                object.position.fromArray(from.position).lerp(scratchPosition, alpha)
                object.quaternion.fromArray(from.rotation).normalize().slerp(scratchRotation, alpha).normalize()
                object.scale.fromArray(from.scale).lerp(scratchScale, alpha)
            }
            const restoreUnkeyed = () => {
                if (!evaluatedBase || !lastOutput) return
                for (const key of channels.bones) {
                    const object = boneIndex.get(key)!
                    if (nativeTargets.includes(object)) continue
                    const last = lastOutput.bones[key]
                    if (object.position.toArray().every((value, index) => value === last.position[index])
                        && object.quaternion.toArray().every((value, index) => value === last.rotation[index])
                        && object.scale.toArray().every((value, index) => value === last.scale[index])) applyTransform(object, evaluatedBase.bones[key], 0)
                }
            }
            const externalRelease = () => { if (!externalReleased) { externalReleased = true; external.value.release() } }
            const cleanup = () => {
                if (cleaned) return
                // Invalid native readiness still cancels this actor's own action;
                // a replacement generation must never be interrupted.
                if (live && identityCurrent() && channels.action) interruptViewerCharacterAction(binding, 'performance host disposed')
                cleaned = true; live = false; releasing = undefined; issued = undefined
                nativeLease?.cancel()
                if (morphReturn && morphReturn.phase !== 'complete') morphReturn.phase = 'cancelled'
                externalRelease()
                character.userData.animationLoops = character.userData.animationLoops.filter(callback => callback !== actorPhase)
                character.userData.disposeCallbacks = character.userData.disposeCallbacks.filter(callback => callback !== cleanup)
                if (viewerPerformanceClaims.get(actorObject) === claim) viewerPerformanceClaims.delete(actorObject)
                if (entries.get(actorKey) === entry) entries.delete(actorKey)
            }
            const beginMorphReturn = () => {
                if (!morphReturn || morphReturn.phase !== 'waiting') return
                if (!current()) { cleanup(); return }
                try {
                    const result = external.value.beginMorphReturn?.()
                    if (!current()) { cleanup(); return }
                    if (!result || result.status !== 'ready') {
                        morphReturn.reason = result?.reason ?? 'WAIT_MORPH_EVALUATOR: beginMorphReturn capability absent'
                        return
                    }
                    morphReturn.phase = 'returning'; morphReturn.reason = undefined
                    morphReturn.readyFrame = viewerPerformanceFrameId
                } catch (error) {
                    morphReturn.reason = 'WAIT_MORPH_EVALUATOR: ' + (error instanceof Error ? error.message : String(error))
                }
            }
            const release = (pose: ViewerPerformancePose, seconds: number) => {
                if (!current()) { cleanup(); return }
                if (!live) return
                validate(pose)
                if (!Number.isFinite(seconds) || seconds < 0) throw new Error('invalid release duration')
                if (nativeLease) {
                    const result = nativeLease.beginReturn({transitionSeconds: seconds})
                    if (result.status !== 'ready') { cleanup(); return }
                }
                live = false; issued = undefined
                releasing = { from: clone(pose), elapsed: 0, duration: seconds, first: true }
                if (channels.morphs.length) {
                    // Capture the displayed source once, before the lower producer
                    // is unmasked. The handoff itself performs no morph write.
                    const from: Record<string, number> = {}
                    for (const key of channels.morphs) { const morph = morphIndex.get(key)!; from[key] = morph.values[morph.index] }
                    morphReturn = {from, elapsed: 0, phase: 'waiting'}
                    beginMorphReturn()
                }
                if (!current()) { cleanup(); return }
                // The return overlay is still a writer. Keep the real external
                // lease until final cleanup, and stop immediately if it is revoked.
                if (channels.action) interruptViewerCharacterAction(binding, 'performance action lease released')
                if (channels.root) channelHost.notifyRootTransformChanged(actorKey)
            }
            const actorPhase = () => {
                if (!current()) { cleanup(); return }
                if (lastFrame === viewerPerformanceFrameId) return
                lastFrame = viewerPerformanceFrameId; issued = undefined
                if (morphReturn?.phase === 'waiting') beginMorphReturn()
                if (!current()) { cleanup(); return }
                restoreUnkeyed()
                evaluatedBase = capture()
                if (live) {
                    inActorPhase = true
                    try { for (const callback of beforePhysics) {
                        if (!current()) { cleanup(); return }
                        callback(getClockDelta(), { frameId: lastFrame, actorKey, generation: actorGeneration })
                    } }
                    finally { inActorPhase = false }
                } else if (releasing) {
                    if (nativeLease) {
                        const evaluated = evaluateInput()
                        // Missing producer input holds the native compositor at its
                        // displayed pose. No fabricated frame and no return-clock advance.
                        if (evaluated.status !== 'ready') return
                        evaluatedBase = evaluated.value
                        const result = submitNative(evaluated.value)
                        if (result.status !== 'ready') { cleanup(); return }
                        for (const key of channels.bones) {
                            const object = boneIndex.get(key)!, value = evaluated.value.bones[key]
                            object.position.fromArray(value.position); object.quaternion.fromArray(value.rotation); object.scale.fromArray(value.scale)
                        }
                    }
                    if (releasing.first) releasing.first = false
                    else releasing.elapsed += Math.max(0, getClockDelta())
                    const ratio = releasing.duration > 0 ? Math.min(1, releasing.elapsed / releasing.duration) : 1
                    const alpha = ratio * ratio * (3 - 2 * ratio)
                    for (const key of channels.bones) {
                        const object = boneIndex.get(key)!
                        if (nativeTargets.includes(object)) {
                            // p/q are left at this frame's evaluator input. The one
                            // native final writer owns their entire return blend.
                            object.scale.fromArray(releasing.from.bones[key].scale).lerp(scratchScale.fromArray(evaluatedBase!.bones[key].scale), alpha)
                        } else applyTransform(object, releasing.from.bones[key], alpha)
                    }
                    // Root placement remains where the editor left it; never
                    // restore a historical world position or teleport a pose.
                }
                if (!current()) { cleanup(); return }
                lastOutput = capture()
            }
            const final = () => {
                if (!current()) { cleanup(); return }
                if (lastFrame !== viewerPerformanceFrameId) return
                if (releasing) {
                    if (morphReturn?.phase === 'returning' && lastFrame > morphReturn.readyFrame!) {
                        // Home/voice now evaluates unmasked destinations before this
                        // final phase. Never restore a cached manual/default value here.
                        const target = channels.morphs.map(key => { const morph = morphIndex.get(key)!; return morph.values[morph.index] })
                        if (target.every(Number.isFinite)) {
                            morphReturn.elapsed += Math.max(0, getClockDelta())
                            const ratio = releasing.duration > 0 ? Math.min(1, morphReturn.elapsed / releasing.duration) : 1
                            const alpha = ratio * ratio * (3 - 2 * ratio)
                            channels.morphs.forEach((key, index) => { const morph = morphIndex.get(key)!; morph.values[morph.index] = morphReturn!.from[key] * (1 - alpha) + target[index] * alpha })
                            morphReturn.reason = undefined
                            if (ratio >= 1) morphReturn.phase = 'complete'
                        } else { morphReturn.reason = 'WAIT_MORPH_EVALUATOR: nonfinite producer target'; return }
                    }
                    const bodyDone = channels.bones.length === 0 || releasing.duration === 0 || releasing.elapsed >= releasing.duration
                    if (bodyDone && (!nativeLease || nativeLease.state === 'released') && (!morphReturn || morphReturn.phase === 'complete')) cleanup()
                }
                if (!cleaned) lastOutput = capture()
            }
            const submitNative = (pose: ViewerPerformancePose): ViewerPerformanceAvailability<void> => {
                if (!nativeLease || nativeLease.state === 'released') return {status: 'ready', value: undefined}
                const localPoseByObject = new Map<THREE.Object3D, {position: readonly [number, number, number]; quaternion: readonly [number, number, number, number]}>()
                for (const key of channels.exclusiveBones) {
                    const object = boneIndex.get(key)!, value = pose.bones[key]
                    if (nativeTargets.includes(object)) localPoseByObject.set(object, {position: value.position, quaternion: value.rotation})
                }
                return nativeLease.submitEvaluatedFrame({frameId: lastFrame, source: 'post-animation-pre-manual', localPoseByObject})
            }
            const captureEvaluatorFrame = (context: ViewerPerformanceFrameContext): ViewerPerformanceAvailability<ViewerPerformanceEvaluatorFrame> => {
                if (!current() || !live || !inActorPhase || context?.frameId !== lastFrame || lastFrame !== viewerPerformanceFrameId
                    || context.actorKey !== actorKey || context.generation !== actorGeneration || committedFrame === lastFrame) return unavailable('WAIT_EVALUATED_FRAME: stale or consumed actor/frame')
                if (issued) return {status: 'ready', value: issued.token}
                const evaluated = evaluateInput()
                if (evaluated.status !== 'ready') return evaluated
                const token = {frameId: lastFrame, actorKey, generation: actorGeneration, pose: clone(evaluated.value)}
                issued = {token, pose: clone(evaluated.value)}
                return {status: 'ready', value: token}
            }
            const commitManualBody = (frame: ViewerPerformanceEvaluatorFrame, output: ViewerPerformancePose): ViewerPerformanceAvailability<void> => {
                if (!current() || !live || !inActorPhase || !issued || frame !== issued.token || frame.frameId !== lastFrame
                    || lastFrame !== viewerPerformanceFrameId || frame.actorKey !== actorKey || frame.generation !== actorGeneration
                    || committedFrame === lastFrame || JSON.stringify(frame.pose) !== JSON.stringify(issued.pose)) return unavailable('WAIT_EVALUATED_FRAME: unissued, mutated or consumed frame')
                try { validate(output) } catch (error) { return unavailable(error instanceof Error ? error.message : String(error)) }
                const evaluated = issued.pose
                // A retained object is single-use even if native ownership is revoked.
                committedFrame = lastFrame; issued = undefined
                const submitted = submitNative(evaluated)
                if (submitted.status !== 'ready') { cleanup(); return submitted }
                if (!current()) { cleanup(); return unavailable('native/manual authority changed before commit') }
                if (output.root) { actorObject.position.fromArray(output.root.position); actorObject.quaternion.fromArray(output.root.rotation); actorObject.scale.fromArray(output.root.scale) }
                for (const key of channels.bones) {
                    const object = boneIndex.get(key)!, value = output.bones[key]
                    object.position.fromArray(value.position); object.quaternion.fromArray(value.rotation); object.scale.fromArray(value.scale)
                }
                evaluatedBase = clone(evaluated)
                return {status: 'ready', value: undefined}
            }
            const active = () => { if (!current()) cleanup(); return live && !cleaned }
            const entry = { current, release, capture, cleanup, final, active }
            const claim = { channels, leasedBones: new Set(exclusiveObjects), dispose: cleanup }
            const action = (beat: ViewerPerformanceBeat, emit: boolean) => {
                if (!active() || !inActorPhase || !channels.action) throw new Error('action write requires the exact active actor phase/lease')
                issued = undefined
                if (!Number.isFinite(beat.localTimeSeconds) || beat.localTimeSeconds < 0 || !Number.isFinite(beat.transitionSeconds) || beat.transitionSeconds < 0) throw new Error('invalid action sample time')
                if (emit && (!beat.occurrenceId || !beat.keyId)) throw new Error('action occurrence identity is required')
                if (emit && emittedOccurrences.has(beat.occurrenceId)) return
                if (emit || currentAction !== beat.name) {
                    playViewerPerformanceAction(binding, beat, emit)
                    currentAction = beat.name
                    if (emit) emittedOccurrences.add(beat.occurrenceId)
                }
                if (!active()) throw new Error('action authority changed before sampling')
                sampleViewerPerformanceAction(binding, beat.name, beat.localTimeSeconds, beat.loop)
            }
            try { capture() } catch (error) { nativeLease?.cancel(); externalRelease(); return unavailable(error instanceof Error ? error.message : String(error)) }
            viewerPerformanceClaims.set(actorObject, claim)
            entries.set(actorKey, entry)
            character.userData.animationLoops.push(actorPhase)
            character.userData.disposeCallbacks.push(cleanup)
            return { status: 'ready' as const, value: {
                get active() { return active() },
                captureEvaluated: () => {
                    if (!current()) throw new Error('stale performance capture')
                    // The mixer has already evaluated this frame's destination.
                    // An action crossing needs the last displayed output, not
                    // that newly evaluated base or an unkeyed-overlay restore.
                    return live && inActorPhase && lastOutput ? clone(lastOutput) : capture()
                },
                playActionBeat: (beat: ViewerPerformanceBeat) => action(beat, true),
                sampleActionAt: (name: string, localTimeSeconds: number, loop: boolean) => action({ name, localTimeSeconds, loop, keyId: '', occurrenceId: '', transitionSeconds: 0.2 }, false),
                captureEvaluatorFrame, commitManualBody,
                get morphReturnState() { return morphReturn ? {phase: morphReturn.phase, elapsed: morphReturn.elapsed, reason: morphReturn.reason} : undefined },
                releaseFromEvaluated: release,
            } }
        },
        notifyRootTransformChanged(actorKey: string) {
            const entry = entries.get(actorKey)
            if (!entry?.current()) { entry?.cleanup(); return }
            const binding = [...bindings].find(candidate => candidate.character.object.uuid === actorKey)
            if (!binding || !viewerPerformanceClaims.get(binding.character.object)?.channels.root) return
            // Controller-root synchronization only; the public teleport helper
            // resets gaze/secondary poses and is deliberately not used here.
            binding.controller.teleport(binding.character.object.position, binding.character.object.quaternion, true)
            binding.snapshot = binding.controller.snapshot()
        },
    }
    return {
        channelHost,
        framePort: {
            subscribeBeforePhysics(callback: (delta: number, context: ViewerPerformanceFrameContext) => void) { beforePhysics.add(callback); return () => { beforePhysics.delete(callback) } },
            subscribeFinalPoseBeforeCamera(callback: () => void) { finalPose.add(callback); return () => { finalPose.delete(callback) } },
        },
        flushFinalPoseBeforeCamera() {
            if (finalFrame === viewerPerformanceFrameId) return
            finalFrame = viewerPerformanceFrameId
            for (const callback of finalPose) {
                for (const entry of [...entries.values()]) if (!entry.current()) entry.cleanup()
                callback()
            }
            for (const entry of entries.values()) entry.final()
        },
        dispose() { for (const entry of [...entries.values()]) entry.cleanup(); disposed = true; beforePhysics.clear(); finalPose.clear() },
    }
}

interface SecondaryBoneState {
    bone: THREE.Bone
    childOffset: THREE.Vector3
    baseQuaternion: THREE.Quaternion
    finalQuaternion: THREE.Quaternion
    position: THREE.Vector3
    previousPosition: THREE.Vector3
    lastBaseTip: THREE.Vector3
    motionClass: 'authored-idle' | 'dynamic'
    initialized: boolean
    depth: number
}

type ProceduralBoneRole =
    | 'hip'
    | 'spine'
    | 'chest'
    | 'upperLegL'
    | 'upperLegR'
    | 'lowerLegL'
    | 'lowerLegR'
    | 'footL'
    | 'footR'
    | 'upperArmL'
    | 'upperArmR'
    | 'forearmL'
    | 'forearmR'

interface ProceduralBoneState {
    role: ProceduralBoneRole
    bone: THREE.Bone
    baseQuaternion: THREE.Quaternion
    finalQuaternion: THREE.Quaternion
}

const proceduralBoneNames: Readonly<Record<ProceduralBoneRole, readonly string[]>> = {
    hip: ['Hip', 'Hips'],
    spine: ['Spine'],
    chest: ['Chest'],
    upperLegL: ['UpLeg_L', 'UpperLeg_L', 'LeftUpLeg'],
    upperLegR: ['UpLeg_R', 'UpperLeg_R', 'RightUpLeg'],
    lowerLegL: ['Leg_L', 'LowerLeg_L', 'LeftLeg'],
    lowerLegR: ['Leg_R', 'LowerLeg_R', 'RightLeg'],
    footL: ['Foot_L', 'LeftFoot'],
    footR: ['Foot_R', 'RightFoot'],
    upperArmL: ['Arm_L', 'UpperArm_L', 'LeftArm'],
    upperArmR: ['Arm_R', 'UpperArm_R', 'RightArm'],
    forearmL: ['Forearm_L', 'LowerArm_L', 'LeftForeArm'],
    forearmR: ['Forearm_R', 'LowerArm_R', 'RightForeArm'],
}

interface ViewerTpsPoseTransitionNode {
    bone: THREE.Bone
    position: THREE.Vector3
    quaternion: THREE.Quaternion
    scale: THREE.Vector3
}

interface ViewerQuaternionTransitionOwner {
    ownsQuaternion(bone: THREE.Object3D): boolean
    beginQuaternionTransition(durationSeconds: number): void
}

const tpsPoseTransitionExcludedBonePattern = /(?:hair|skirt|cloth|ribbon|ribon|lace|tail|weapon|collider|attachment|accessor|outline|effect|vfx)/i

/**
 * Bridges the last pose that was actually rendered by the model mixer into the
 * first TPS pose.  It deliberately captures live local TRS only: no rest pose,
 * bind pose or inverse-bind data participates in the transition.
 */
class ViewerTpsPoseTransition {
    readonly update: () => void
    private readonly character: ViewerCharacter
    private nodes: ViewerTpsPoseTransitionNode[] = []
    private active = false
    private firstFrame = false
    private elapsedSeconds = 0
    private durationSeconds = 0.2
    private readonly candidates: THREE.Bone[] = []
    private readonly quaternionOwner?: ViewerQuaternionTransitionOwner

    constructor(character: ViewerCharacter, quaternionOwner?: ViewerQuaternionTransitionOwner) {
        this.character = character
        this.quaternionOwner = quaternionOwner
        character.object.traverse(object => {
            const bone = object as THREE.Bone
            if (bone.isBone && !tpsPoseTransitionExcludedBonePattern.test(bone.name)) this.candidates.push(bone)
        })
        this.update = () => this.step(Math.min(getClockDelta(), 1 / 30))
    }

    begin(durationSeconds = 0.2): void {
        // Several stop/play calls can occur in one synchronous replacement.
        // Keep the first evaluated source, not an intermediate cleared pose.
        if (this.active && this.firstFrame) return
        this.durationSeconds = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0.2
        const captured = this.candidates.map(bone => ({
                bone,
                position: bone.position.clone(),
                quaternion: bone.quaternion.clone(),
                scale: bone.scale.clone(),
        }))
        this.nodes = captured
        this.elapsedSeconds = 0
        this.firstFrame = true
        this.active = captured.length > 0
        // One quaternion compositor owns the exact shared chain, including
        // ordinary Home/action handoffs while TPS is off. Keep our p/s blend.
        this.quaternionOwner?.beginQuaternionTransition(this.durationSeconds)
    }

    reset(): void {
        this.nodes = []
        this.active = false
        this.firstFrame = false
        this.elapsedSeconds = 0
    }

    get diagnostics() {
        return {
            active: this.active,
            capturedBoneCount: this.nodes.length,
            elapsedSeconds: this.elapsedSeconds,
            durationSeconds: this.durationSeconds,
            source: 'last-rendered-mixer-local-trs',
            timingProvenance: 'configurable-viewer-policy-not-native-timing',
        }
    }

    private step(deltaSeconds: number): void {
        if (!this.active) return
        if (this.firstFrame) {
            this.firstFrame = false
        } else {
            this.elapsedSeconds = Math.min(
                this.durationSeconds,
                this.elapsedSeconds + Math.max(0, deltaSeconds),
            )
        }
        const ratio = this.durationSeconds > 0
            ? THREE.MathUtils.clamp(this.elapsedSeconds / this.durationSeconds, 0, 1)
            : 1
        const blend = ratio * ratio * (3 - 2 * ratio)
        // Physics is the sole post-animation owner of its exact p/q channels.
        // Refresh the mask during a handoff: attachments may arrive or dispose
        // asynchronously, and a disabled runtime must yield authored channels.
        const attachment = getViewerCharacterPhysicsAttachment(this.character.object)
        const snapshot = attachment?.status === 'ready'
            && attachment.root === this.character.object
            ? attachment.runtime?.getWritableChannelSnapshot()
            : undefined
        const nativeChannels = new Map(snapshot?.status === 'ready'
            && snapshot.active && snapshot.runtimeStatus === 'ready'
            && snapshot.root === this.character.object
            ? snapshot.outputs.map(output => [output.object, output.channels] as const)
            : [])
        for (const node of this.nodes) {
            if (viewerPerformanceClaims.get(this.character.object)?.leasedBones.has(node.bone)) continue
            const targetPosition = node.bone.position.clone()
            const targetQuaternion = node.bone.quaternion.clone()
            const targetScale = node.bone.scale.clone()
            const channels = nativeChannels.get(node.bone)
            if (!channels?.includes('position')) {
                node.bone.position.lerpVectors(node.position, targetPosition, blend)
            }
            if (!channels?.includes('quaternion') && !this.quaternionOwner?.ownsQuaternion(node.bone)) {
                node.bone.quaternion.copy(node.quaternion).slerp(targetQuaternion, blend).normalize()
            }
            node.bone.scale.lerpVectors(node.scale, targetScale, blend)
        }
        if (ratio >= 1) this.reset()
    }
}

function installViewerEvaluatedAnimationHandoff(character: ViewerCharacter, transition: ViewerTpsPoseTransition): () => void {
    const animation = character.animation
    const originalPlay = animation.play
    const originalClear = animation.clear
    const play: typeof animation.play = function (name, loop, options) {
        transition.begin(options?.transitionSeconds)
        return originalPlay.call(animation, name, loop, options)
    }
    const clear: typeof animation.clear = function () {
        transition.begin()
        return originalClear.call(animation)
    }
    animation.play = play
    animation.clear = clear
    return () => {
        // Another runtime may have installed a later owner. Restore only our
        // exact functions, never overwrite a successor's per-instance wrapper.
        if (animation.play === play) animation.play = originalPlay
        if (animation.clear === clear) animation.clear = originalClear
    }
}

class ViewerProceduralLocomotion {
    readonly update: () => void
    private readonly locomotionAnimations: LocomotionAnimationMap
    private readonly bones = new Map<ProceduralBoneRole, ProceduralBoneState>()
    private readonly hipBasePosition = new THREE.Vector3()
    private hipFinalPosition = new THREE.Vector3()
    private phase = 0
    private active = false
    private applied = false
    private stateProvider: () => CharacterLocomotionSnapshot | undefined = () => undefined
    private appliedState: string = 'idle'

    constructor(
        privateCharacter: ViewerCharacter,
        locomotionAnimations: LocomotionAnimationMap,
    ) {
        this.locomotionAnimations = locomotionAnimations
        const byName = new Map<string, THREE.Bone>()
        privateCharacter.object.traverse(object => {
            const bone = object as THREE.Bone
            if (bone.isBone && !byName.has(bone.name)) byName.set(bone.name, bone)
        })
        for (const [role, names] of Object.entries(proceduralBoneNames) as Array<[
            ProceduralBoneRole,
            readonly string[],
        ]>) {
            const bone = names.map(name => byName.get(name)).find(Boolean)
            if (!bone) continue
            this.bones.set(role, {
                role,
                bone,
                baseQuaternion: bone.quaternion.clone(),
                finalQuaternion: bone.quaternion.clone(),
            })
        }
        const hip = this.bones.get('hip')?.bone
        if (hip) {
            this.hipBasePosition.copy(hip.position)
            this.hipFinalPosition.copy(hip.position)
        }
        this.update = () => this.step(Math.min(getClockDelta(), 0.05), privateCharacter)
    }

    setStateProvider(provider: () => CharacterLocomotionSnapshot | undefined): void {
        this.stateProvider = provider
    }

    setActive(value: boolean): void {
        if (this.active === value) return
        this.active = value
        this.reset()
    }

    get diagnostics() {
        const required: ProceduralBoneRole[] = [
            'hip', 'upperLegL', 'upperLegR', 'lowerLegL', 'lowerLegR',
        ]
        return {
            active: this.active,
            applied: this.applied,
            appliedState: this.appliedState,
            boneCount: this.bones.size,
            missingRequiredBones: required.filter(role => !this.bones.has(role)),
        }
    }

    reset(): void {
        for (const state of this.bones.values()) {
            state.bone.quaternion.copy(state.baseQuaternion)
            state.finalQuaternion.copy(state.baseQuaternion)
        }
        const hip = this.bones.get('hip')?.bone
        if (hip) {
            hip.position.copy(this.hipBasePosition)
            this.hipFinalPosition.copy(this.hipBasePosition)
        }
        this.appliedState = 'idle'
        this.applied = false
    }

    private captureMixerPose(): void {
        for (const state of this.bones.values()) {
            if (state.bone.quaternion.angleTo(state.finalQuaternion) < 1e-5) {
                state.bone.quaternion.copy(state.baseQuaternion)
            } else {
                state.baseQuaternion.copy(state.bone.quaternion)
            }
        }
        const hip = this.bones.get('hip')?.bone
        if (hip) {
            if (hip.position.distanceToSquared(this.hipFinalPosition) < 1e-10) {
                hip.position.copy(this.hipBasePosition)
            } else {
                this.hipBasePosition.copy(hip.position)
            }
        }
    }

    private requiresProcedural(state: CharacterLocomotionSnapshot['state']): boolean {
        if (state === 'idle') return false
        const idle = this.locomotionAnimations.idle
        const selected = this.locomotionAnimations[state]
        const first = (value: string | readonly string[] | undefined) => (
            Array.isArray(value) ? value[0] : value
        )
        const idleName = first(idle)
        const selectedName = first(selected)
        return !selectedName || !idleName || familyEquals(selectedName, idleName)
    }

    private applyWorldRotation(
        role: ProceduralBoneRole,
        axis: THREE.Vector3,
        angle: number,
    ): void {
        const state = this.bones.get(role)
        if (!state || Math.abs(angle) < 1e-7) return
        const parentWorld = state.bone.parent?.getWorldQuaternion(new THREE.Quaternion())
            ?? new THREE.Quaternion()
        const worldDelta = new THREE.Quaternion().setFromAxisAngle(axis, angle)
        const localDelta = parentWorld.clone().invert().multiply(worldDelta).multiply(parentWorld)
        state.bone.quaternion.copy(localDelta.multiply(state.baseQuaternion)).normalize()
        state.finalQuaternion.copy(state.bone.quaternion)
        state.bone.updateMatrix()
        state.bone.updateWorldMatrix(false, false)
    }

    private step(deltaSeconds: number, character: ViewerCharacter): void {
        this.captureMixerPose()
        const snapshot = this.stateProvider()
        if (
            !this.active
            || !snapshot
            || snapshot.activeAction
            || !this.requiresProcedural(snapshot.state)
        ) {
            this.applied = false
            this.appliedState = snapshot?.activeAction ? 'combat-action' : snapshot?.state ?? 'idle'
            return
        }
        const rootWorld = character.object.getWorldQuaternion(new THREE.Quaternion())
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(rootWorld).normalize()
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rootWorld).normalize()
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(rootWorld).normalize()
        this.appliedState = snapshot.state
        this.applied = true

        let upperLegL = 0
        let upperLegR = 0
        let lowerLegL = 0
        let lowerLegR = 0
        let armL = 0
        let armR = 0
        let forearmL = 0
        let forearmR = 0
        let torsoTwist = 0
        let hipBob = 0
        if (snapshot.state === 'walk' || snapshot.state === 'run') {
            const running = snapshot.state === 'run'
            this.phase += deltaSeconds * Math.PI * 2 * (running ? 2.45 : 1.55)
            const stride = Math.sin(this.phase)
            const opposite = Math.sin(this.phase + Math.PI)
            const amplitude = THREE.MathUtils.degToRad(running ? 39 : 24)
            upperLegL = stride * amplitude
            upperLegR = opposite * amplitude
            lowerLegL = Math.max(0, -stride) * THREE.MathUtils.degToRad(running ? 52 : 31)
            lowerLegR = Math.max(0, -opposite) * THREE.MathUtils.degToRad(running ? 52 : 31)
            armL = opposite * THREE.MathUtils.degToRad(running ? 31 : 17)
            armR = stride * THREE.MathUtils.degToRad(running ? 31 : 17)
            forearmL = Math.max(0, -opposite) * THREE.MathUtils.degToRad(running ? 22 : 10)
            forearmR = Math.max(0, -stride) * THREE.MathUtils.degToRad(running ? 22 : 10)
            torsoTwist = stride * THREE.MathUtils.degToRad(running ? 6 : 3)
            hipBob = Math.abs(Math.sin(this.phase * 2)) * (running ? 0.035 : 0.018)
        } else if (snapshot.state === 'jump') {
            upperLegL = THREE.MathUtils.degToRad(-16)
            upperLegR = THREE.MathUtils.degToRad(-11)
            lowerLegL = THREE.MathUtils.degToRad(29)
            lowerLegR = THREE.MathUtils.degToRad(23)
            armL = THREE.MathUtils.degToRad(-25)
            armR = THREE.MathUtils.degToRad(-25)
            hipBob = -0.025
        } else if (snapshot.state === 'fall') {
            upperLegL = THREE.MathUtils.degToRad(-8)
            upperLegR = THREE.MathUtils.degToRad(8)
            lowerLegL = THREE.MathUtils.degToRad(18)
            lowerLegR = THREE.MathUtils.degToRad(18)
            armL = THREE.MathUtils.degToRad(-18)
            armR = THREE.MathUtils.degToRad(-18)
            this.applyWorldRotation('upperArmL', forward, THREE.MathUtils.degToRad(18))
            this.applyWorldRotation('upperArmR', forward, THREE.MathUtils.degToRad(-18))
        } else if (snapshot.state === 'land') {
            upperLegL = THREE.MathUtils.degToRad(-20)
            upperLegR = THREE.MathUtils.degToRad(-20)
            lowerLegL = THREE.MathUtils.degToRad(38)
            lowerLegR = THREE.MathUtils.degToRad(38)
            armL = THREE.MathUtils.degToRad(13)
            armR = THREE.MathUtils.degToRad(13)
            hipBob = -0.05
        }

        this.applyWorldRotation('upperLegL', right, upperLegL)
        this.applyWorldRotation('upperLegR', right, upperLegR)
        this.applyWorldRotation('lowerLegL', right, lowerLegL)
        this.applyWorldRotation('lowerLegR', right, lowerLegR)
        this.applyWorldRotation('footL', right, -lowerLegL * 0.25)
        this.applyWorldRotation('footR', right, -lowerLegR * 0.25)
        this.applyWorldRotation('upperArmL', right, armL)
        this.applyWorldRotation('upperArmR', right, armR)
        this.applyWorldRotation('forearmL', right, forearmL)
        this.applyWorldRotation('forearmR', right, forearmR)
        this.applyWorldRotation('spine', up, torsoTwist)
        this.applyWorldRotation('chest', up, torsoTwist * 0.45)
        const hip = this.bones.get('hip')?.bone
        if (hip) {
            hip.position.copy(this.hipBasePosition)
            hip.position.y += hipBob
            this.hipFinalPosition.copy(hip.position)
        }
    }
}

type CameraHeadTrackingRole = 'chest' | 'neck' | 'head'

interface CameraHeadTrackingBoneState {
    role: CameraHeadTrackingRole
    bone: THREE.Object3D
    baseQuaternion: THREE.Quaternion
    finalQuaternion: THREE.Quaternion
}

// S6 restores the authored Set-A arm path. The rejected clearance layer both
// displaced the arm from its native/generated gait and synchronously indexed
// and remeasured the deformed skirt mesh on the interactive path.
const enableInteractiveSetAWalkDressClearance = false
const cameraHeadTrackingPaths: Readonly<Record<CameraHeadTrackingRole, string>> = {
    chest: 'Root/Hip/Spine/Waist/Chest',
    neck: 'Root/Hip/Spine/Waist/Chest/Neck',
    head: 'Root/Hip/Spine/Waist/Chest/Neck/Head',
}
const authoredEyePaths = [
    'Root/Hip/Spine/Waist/Chest/Neck/Head/Eye_L',
    'Root/Hip/Spine/Waist/Chest/Neck/Head/Eye_R',
] as const
const cameraHeadTrackingWeights: Readonly<Record<CameraHeadTrackingRole, number>> = {
    chest: 0.12,
    neck: 0.26,
    head: 0.44,
}
const authoredHeadClipPattern = /(?:(?:Face|Fece)(?:Up|Down)|FaceCut|Face_Cut|FacialCut)/i

/**
 * Capability-bound camera look layer for the selected body rig. The mixer keeps
 * ownership of the locomotion base pose; this callback runs afterwards and
 * before cloth/secondary physics, then distributes a bounded world-space gaze
 * delta through each target rig's own chest/neck/head chain. Eye transforms
 * remain owned by authored animation and expression. The Eye_L/R name alone
 * is not an eye-aim contract: rotating the flat iris geometry independently
 * intersects the authored sclera on 100101/100102/100107. In particular, do not
 * freeze those channels or replace their current animation with a rest pose.
 */
class ViewerCameraHeadTracking {
    readonly update: () => void
    private readonly character: ViewerCharacter
    private readonly characterId: number
    private readonly states = new Map<CameraHeadTrackingRole, CameraHeadTrackingBoneState>()
    private readonly quaternionBones = new Set<THREE.Object3D>()
    private readonly authoredEyeBones: THREE.Object3D[]
    private readonly localFaceForward: THREE.Vector3
    private readonly localFaceUp: THREE.Vector3
    private readonly localFaceRight: THREE.Vector3
    private stateProvider: () => ViewerLocomotionBinding | undefined = () => undefined
    private active = false
    private applied = false
    private authoredOccupied = false
    private blendWeight = 0
    private yawRadians = 0
    private pitchRadians = 0
    private targetYawRadians = 0
    private targetPitchRadians = 0
    private cameraReferenceValid = false
    private referenceCameraYawRelative = 0
    private referenceCameraPitch = 0
    private cameraYawRelative = 0
    private bodyYaw = 0
    private gazeSemantic: 'look-at-camera' | 'look-with-camera' | 'side-transition' = 'look-with-camera'
    private cameraFrontness = -1
    private trackingLastFrame = false
    private readonly transitionFrom = new Map<CameraHeadTrackingRole, THREE.Quaternion>()
    private readonly transitionTarget = new THREE.Quaternion()
    private transitionElapsedSeconds = 0
    private transitionFirstFrame = false
    private readonly transitionPolicySeconds: number
    private transitionDurationSeconds: number

    constructor(character: ViewerCharacter, policy = { transitionSeconds: 0.2 }) {
        // Configurable Viewer blend policy, not a recovered native duration.
        this.transitionPolicySeconds = Number.isFinite(policy.transitionSeconds) && policy.transitionSeconds > 0
            ? policy.transitionSeconds : 0.2
        this.transitionDurationSeconds = this.transitionPolicySeconds
        this.character = character
        this.characterId = Number(character.userData.characterId)
        const profile = getCharacterReDriveProfile(this.characterId)
        this.localFaceForward = unityDirectionToThreeFbx(profile.faceForwardAxis).normalize()
        this.localFaceUp = unityDirectionToThreeFbx(profile.faceUpAxis).normalize()
        this.localFaceRight = unityDirectionToThreeFbx(profile.faceRightAxis).normalize()
        const rigRoot = findBodyRigRoot(character)
        const rig = rigRoot ? indexRigObjects(rigRoot) : new Map<string, THREE.Object3D>()
        this.authoredEyeBones = authoredEyePaths.flatMap(path => {
            const bone = rig.get(path)
            return bone ? [bone] : []
        })
        for (const role of Object.keys(cameraHeadTrackingPaths) as CameraHeadTrackingRole[]) {
            const bone = rig.get(cameraHeadTrackingPaths[role])
            if (!bone) continue
            this.states.set(role, {
                role,
                bone,
                baseQuaternion: bone.quaternion.clone(),
                finalQuaternion: bone.quaternion.clone(),
            })
        }
        if (this.eligible) for (const state of this.states.values()) this.quaternionBones.add(state.bone)
        this.update = () => this.step(Math.min(getClockDelta(), 0.05))
    }

    ownsQuaternion(bone: THREE.Object3D): boolean {
        return this.quaternionBones.has(bone)
    }

    beginQuaternionTransition(durationSeconds: number): void {
        this.beginPoseTransition(false, durationSeconds)
    }

    setStateProvider(provider: () => ViewerLocomotionBinding | undefined): void {
        this.stateProvider = provider
    }

    setActive(value: boolean): void {
        const next = value && this.eligible
        if (next !== this.active) this.cameraReferenceValid = false
        if (this.active && !next) {
            // Capture before a caller stops or replaces the authored animation.
            // Input ownership releases now; the evaluated pose returns in step.
            this.beginPoseTransition(false)
            this.trackingLastFrame = false
            this.clearGazeTarget()
        }
        this.active = next
    }

    get eligible(): boolean {
        return this.states.has('chest') && this.states.has('neck') && this.states.has('head')
            && [this.localFaceForward, this.localFaceUp, this.localFaceRight].every(axis => (
                axis.toArray().every(Number.isFinite) && axis.lengthSq() > 0.99
            ))
    }

    get diagnostics() {
        const required: CameraHeadTrackingRole[] = ['chest', 'neck', 'head']
        return {
            mode: 'camera-relative-rest-axis-chain',
            characterId: this.characterId,
            eligible: this.eligible,
            capability: !this.eligible ? 'missing-required-chain' : 'head-only',
            eyePoseAuthority: 'authored-animation-and-expression',
            proceduralEyeRotation: false,
            active: this.active,
            applied: this.applied,
            authoredOccupied: this.authoredOccupied,
            blendWeight: this.blendWeight,
            yawRadians: this.yawRadians,
            pitchRadians: this.pitchRadians,
            targetYawRadians: this.targetYawRadians,
            targetPitchRadians: this.targetPitchRadians,
            cameraReferenceValid: this.cameraReferenceValid,
            referenceCameraYawRelative: this.referenceCameraYawRelative,
            referenceCameraPitch: this.referenceCameraPitch,
            cameraYawRelative: this.cameraYawRelative,
            bodyYaw: this.bodyYaw,
            gazeSemantic: this.gazeSemantic,
            cameraFrontness: this.cameraFrontness,
            poseTransition: {
                active: this.transitionFrom.size > 0,
                elapsedSeconds: this.transitionElapsedSeconds,
                durationSeconds: this.transitionDurationSeconds,
                source: 'current-evaluated-local-quaternion',
                timingProvenance: 'configurable-viewer-policy-not-native-timing',
            },
            bonePaths: Object.fromEntries(
                [...this.states].map(([role, state]) => [role, objectHierarchyPath(state.bone)]),
            ),
            missingRequiredBones: required.filter(role => !this.states.has(role)),
            eyeBoneCount: this.authoredEyeBones.length,
            authoredEyeBonePaths: this.authoredEyeBones.map(objectHierarchyPath),
            restAxes: {
                forward: this.localFaceForward.toArray(),
                up: this.localFaceUp.toArray(),
                right: this.localFaceRight.toArray(),
            },
            limitsDegrees: {
                yaw: 50,
                pitchDown: 24,
                pitchUp: 28,
                deadZone: 2,
                angularSpeedPerSecond: 120,
            },
        }
    }

    reset(): void {
        for (const state of this.states.values()) {
            state.bone.quaternion.copy(state.baseQuaternion)
            state.finalQuaternion.copy(state.baseQuaternion)
        }
        this.blendWeight = 0
        this.yawRadians = 0
        this.pitchRadians = 0
        this.targetYawRadians = 0
        this.targetPitchRadians = 0
        this.cameraReferenceValid = false
        this.referenceCameraYawRelative = 0
        this.referenceCameraPitch = 0
        this.cameraYawRelative = 0
        this.bodyYaw = 0
        this.gazeSemantic = 'look-with-camera'
        this.cameraFrontness = -1
        this.authoredOccupied = false
        this.applied = false
        this.trackingLastFrame = false
        this.transitionFrom.clear()
        this.transitionElapsedSeconds = 0
        this.transitionFirstFrame = false
        this.character.object.updateMatrixWorld(true)
    }

    private clearGazeTarget(): void {
        this.blendWeight = 0
        this.yawRadians = 0
        this.pitchRadians = 0
        this.targetYawRadians = 0
        this.targetPitchRadians = 0
        this.cameraReferenceValid = false
    }

    private beginPoseTransition(fromLastEvaluation: boolean, durationSeconds = this.transitionPolicySeconds): void {
        // stop/clear/play and the tracking state change can share one call stack.
        // Preserve the first actual outgoing pose, not an intermediate reset.
        if (this.transitionFrom.size > 0 && this.transitionFirstFrame) return
        this.transitionFrom.clear()
        if (!this.eligible) return
        this.transitionDurationSeconds = Number.isFinite(durationSeconds) && durationSeconds > 0
            ? durationSeconds : this.transitionPolicySeconds
        for (const [role, state] of this.states) {
            this.transitionFrom.set(role, (
                fromLastEvaluation ? state.finalQuaternion : state.bone.quaternion
            ).clone())
        }
        this.transitionElapsedSeconds = 0
        this.transitionFirstFrame = true
    }

    private applyPoseTransition(deltaSeconds: number): void {
        if (this.transitionFrom.size > 0) {
            if (this.transitionFirstFrame) this.transitionFirstFrame = false
            else this.transitionElapsedSeconds = Math.min(
                this.transitionDurationSeconds,
                this.transitionElapsedSeconds + Math.max(0, deltaSeconds),
            )
            const ratio = this.transitionElapsedSeconds / this.transitionDurationSeconds
            const blend = ratio * ratio * (3 - 2 * ratio)
            for (const [role, from] of this.transitionFrom) {
                const state = this.states.get(role)!
                if (viewerPerformanceClaims.get(this.character.object)?.leasedBones.has(state.bone)) continue
                // The target is this frame's evaluated authored/gaze pose, not
                // a cached baseline. An interrupt captures the blended result.
                this.transitionTarget.copy(state.bone.quaternion)
                state.bone.quaternion.slerpQuaternions(from, this.transitionTarget, blend).normalize()
            }
            if (ratio >= 1) this.transitionFrom.clear()
            else this.applied = true
            this.character.object.updateMatrixWorld(true)
        }
        for (const state of this.states.values()) state.finalQuaternion.copy(state.bone.quaternion)
    }

    private captureMixerPose(): void {
        for (const state of this.states.values()) {
            if (viewerPerformanceClaims.get(this.character.object)?.leasedBones.has(state.bone)) continue
            if (state.bone.quaternion.angleTo(state.finalQuaternion) < 1e-5) {
                state.bone.quaternion.copy(state.baseQuaternion)
            } else {
                // The TPS bridge skips quaternions owned by this tracker.
                // A changed quaternion here is the newly evaluated authored pose.
                // Capture it for every character before applying procedural gaze.
                state.baseQuaternion.copy(state.bone.quaternion)
            }
        }
        this.character.object.updateMatrixWorld(true)
    }

    private authoredLayerOwnsHead(binding: ViewerLocomotionBinding): boolean {
        return !!binding.snapshot.activeAction
            || characterActionPlaybackBlocksLocomotion(binding)
            || authoredHeadClipPattern.test(binding.character.animation.current ?? '')
    }

    private rateLimitedDamp(
        current: number,
        target: number,
        deltaSeconds: number,
    ): number {
        const damped = THREE.MathUtils.damp(current, target, 11, Math.max(0, deltaSeconds))
        const maximumStep = THREE.MathUtils.degToRad(120) * Math.max(0, deltaSeconds)
        return current + THREE.MathUtils.clamp(damped - current, -maximumStep, maximumStep)
    }

    private signedAngle(value: number): number {
        return Math.atan2(Math.sin(value), Math.cos(value))
    }

    private applyWorldDelta(
        state: CameraHeadTrackingBoneState,
        fullDelta: THREE.Quaternion,
        weight: number,
    ): void {
        if (viewerPerformanceClaims.get(this.character.object)?.leasedBones.has(state.bone)) return
        if (weight <= 1e-6) {
            state.finalQuaternion.copy(state.bone.quaternion)
            return
        }
        const partialDelta = new THREE.Quaternion().slerp(fullDelta, weight)
        const parentWorld = state.bone.parent?.getWorldQuaternion(new THREE.Quaternion())
            ?? new THREE.Quaternion()
        const currentWorld = state.bone.getWorldQuaternion(new THREE.Quaternion())
        const desiredWorld = partialDelta.multiply(currentWorld)
        state.bone.quaternion.copy(parentWorld.invert().multiply(desiredWorld)).normalize()
        state.finalQuaternion.copy(state.bone.quaternion)
        this.character.object.updateMatrixWorld(true)
    }

    private step(deltaSeconds: number): void {
        const binding = this.stateProvider()
        this.authoredOccupied = !!binding && this.authoredLayerOwnsHead(binding)
        const selected = !!binding && scene.characterSelected === binding.sceneCharacter
        const shouldTrack = this.active && selected && this.eligible && !this.authoredOccupied
        if (shouldTrack !== this.trackingLastFrame) this.beginPoseTransition(true)
        this.trackingLastFrame = shouldTrack
        this.captureMixerPose()
        if (!shouldTrack) {
            // Authored actions and TPS exit take ownership immediately, but
            // their visual pose is reached from the last evaluated output.
            this.clearGazeTarget()
            this.applied = false
            this.applyPoseTransition(deltaSeconds)
            return
        }
        const targetWeight = shouldTrack ? 1 : 0
        this.blendWeight = THREE.MathUtils.damp(
            this.blendWeight,
            targetWeight,
            targetWeight > this.blendWeight ? 8 : 12,
            Math.max(0, deltaSeconds),
        )

        const head = this.states.get('head')?.bone
        if (head && shouldTrack) {
            const rootWorld = this.character.object.getWorldQuaternion(new THREE.Quaternion())
            const bodyForward = new THREE.Vector3(0, 0, 1).applyQuaternion(rootWorld)
            bodyForward.y = 0
            bodyForward.normalize()
            const bodyRight = new THREE.Vector3(1, 0, 0).applyQuaternion(rootWorld)
            bodyRight.y = 0
            bodyRight.normalize()
            this.bodyYaw = Math.atan2(bodyForward.x, bodyForward.z)
            this.cameraYawRelative = this.signedAngle(cameraYawUnwrapped - this.bodyYaw)
            if (!this.cameraReferenceValid) {
                this.referenceCameraYawRelative = this.cameraYawRelative
                this.referenceCameraPitch = cameraPitch
                this.cameraReferenceValid = true
            }
            const headPosition = head.getWorldPosition(new THREE.Vector3())
            const headToCamera = scene.camera.position.clone().sub(headPosition).normalize()
            const cameraForward = scene.camera.getWorldDirection(new THREE.Vector3()).normalize()
            const horizontalHeadToCamera = headToCamera.clone().setY(0)
            const horizontalCameraForward = cameraForward.clone().setY(0)
            if (horizontalHeadToCamera.lengthSq() > 1e-8) horizontalHeadToCamera.normalize()
            else horizontalHeadToCamera.copy(bodyForward)
            if (horizontalCameraForward.lengthSq() > 1e-8) horizontalCameraForward.normalize()
            else horizontalCameraForward.copy(bodyForward)
            this.cameraFrontness = THREE.MathUtils.clamp(
                horizontalHeadToCamera.dot(bodyForward),
                -1,
                1,
            )
            const transitionRatio = THREE.MathUtils.clamp(
                (this.cameraFrontness + 0.18) / 0.36,
                0,
                1,
            )
            const lookAtCameraWeight = transitionRatio * transitionRatio * (3 - 2 * transitionRatio)
            this.gazeSemantic = lookAtCameraWeight >= 0.999
                ? 'look-at-camera'
                : lookAtCameraWeight <= 0.001
                    ? 'look-with-camera'
                    : 'side-transition'
            const frontYaw = Math.atan2(
                horizontalHeadToCamera.dot(bodyRight),
                horizontalHeadToCamera.dot(bodyForward),
            )
            const rearYaw = Math.atan2(
                horizontalCameraForward.dot(bodyRight),
                horizontalCameraForward.dot(bodyForward),
            )
            const desiredBodyYaw = THREE.MathUtils.lerp(rearYaw, frontYaw, lookAtCameraWeight)
            const frontPitch = Math.asin(THREE.MathUtils.clamp(headToCamera.y, -1, 1))
            const rearPitch = Math.asin(THREE.MathUtils.clamp(cameraForward.y, -1, 1))
            const desiredBodyPitch = THREE.MathUtils.lerp(rearPitch, frontPitch, lookAtCameraWeight)
            const desiredDirection = bodyForward.clone()
                .multiplyScalar(Math.cos(desiredBodyYaw) * Math.cos(desiredBodyPitch))
                .addScaledVector(bodyRight, Math.sin(desiredBodyYaw) * Math.cos(desiredBodyPitch))
                .addScaledVector(new THREE.Vector3(0, 1, 0), Math.sin(desiredBodyPitch))
                .normalize()
            const headWorld = head.getWorldQuaternion(new THREE.Quaternion())
            const authoredFaceForward = this.localFaceForward.clone().applyQuaternion(headWorld).normalize()
            const authoredFaceUp = this.localFaceUp.clone().applyQuaternion(headWorld).normalize()
            const authoredFaceRight = this.localFaceRight.clone().applyQuaternion(headWorld).normalize()
            const rawYaw = Math.atan2(
                desiredDirection.dot(authoredFaceRight),
                desiredDirection.dot(authoredFaceForward),
            )
            const rawPitch = Math.atan2(
                desiredDirection.dot(authoredFaceUp),
                Math.hypot(
                    desiredDirection.dot(authoredFaceForward),
                    desiredDirection.dot(authoredFaceRight),
                ),
            )
            const removeDeadZone = (value: number): number => {
                const deadZone = THREE.MathUtils.degToRad(2)
                return Math.abs(value) <= deadZone
                    ? 0
                    : Math.sign(value) * (Math.abs(value) - deadZone)
            }
            this.targetYawRadians = THREE.MathUtils.clamp(
                removeDeadZone(rawYaw),
                THREE.MathUtils.degToRad(-50),
                THREE.MathUtils.degToRad(50),
            )
            this.targetPitchRadians = THREE.MathUtils.clamp(
                removeDeadZone(rawPitch),
                THREE.MathUtils.degToRad(-24),
                THREE.MathUtils.degToRad(28),
            )
        } else {
            this.targetYawRadians = 0
            this.targetPitchRadians = 0
        }
        this.yawRadians = this.rateLimitedDamp(
            this.yawRadians,
            this.targetYawRadians,
            deltaSeconds,
        )
        this.pitchRadians = this.rateLimitedDamp(
            this.pitchRadians,
            this.targetPitchRadians,
            deltaSeconds,
        )

        if (!head || this.blendWeight < 1e-4) {
            this.applied = false
            this.applyPoseTransition(deltaSeconds)
            return
        }
        const headWorld = head.getWorldQuaternion(new THREE.Quaternion())
        const faceForward = this.localFaceForward.clone().applyQuaternion(headWorld).normalize()
        const faceUp = this.localFaceUp.clone().applyQuaternion(headWorld).normalize()
        const faceRight = this.localFaceRight.clone().applyQuaternion(headWorld).normalize()
        const cosPitch = Math.cos(this.pitchRadians)
        const desiredDirection = faceForward.clone()
            .multiplyScalar(Math.cos(this.yawRadians) * cosPitch)
            .addScaledVector(faceRight, Math.sin(this.yawRadians) * cosPitch)
            .addScaledVector(faceUp, Math.sin(this.pitchRadians))
            .normalize()
        const fullDelta = new THREE.Quaternion().setFromUnitVectors(faceForward, desiredDirection)
        for (const role of ['chest', 'neck', 'head'] as const) {
            const state = this.states.get(role)
            if (state) this.applyWorldDelta(state, fullDelta, cameraHeadTrackingWeights[role] * this.blendWeight)
        }
        this.applied = true
        this.applyPoseTransition(deltaSeconds)
    }
}

interface SecondaryPhysicsDiagnostics {
    mode: 'viewer-spring-fallback' | 'custom-101901-magica-profile' | 'no-secondary-bones'
    active: boolean
    boneCount: number
    profileRootCount: number
    missingProfileRoots: string[]
    excludedProfileRoots: string[]
    sceneProbeBudgetPerStep: number
    sceneContacts: number
    bodyContacts: number
    idleAuthoredFollowBoneCount: number
    idleAuthoredFollowFrames: number
    resetCount: number
    nonFiniteCorrections: number
}

const secondaryBoneName = /(?:Hair|Skirt|Ribbon|Cape|Cloth|Tail|Sode|Suso).*_Sp$/i

const secondaryRoots101901 = [
    'Root/Hip/OuterSkirt_root/OuterSkirt_B_C1_01_Sp',
    'Root/Hip/OuterSkirt_root/OuterSkirt_B_L1_01_Sp',
    'Root/Hip/OuterSkirt_root/OuterSkirt_B_R1_01_Sp',
    'Root/Hip/OuterSkirt_root/OuterSkirt_F_C1_01_Sp',
    'Root/Hip/OuterSkirt_root/OuterSkirt_F_L1_01_Sp',
    'Root/Hip/OuterSkirt_root/OuterSkirt_F_R1_01_Sp',
    'Root/Hip/OuterSkirt_root/OuterSkirt_S_L1_01_Sp',
    'Root/Hip/OuterSkirt_root/OuterSkirt_S_R1_01_Sp',
    'Root/Hip/Spine/SkirtRibbon_B_L1_01_Sp',
    'Root/Hip/Spine/SkirtRibbon_B_L2_01_Sp',
    'Root/Hip/Spine/SkirtRibbon_B_R1_01_Sp',
    'Root/Hip/Spine/SkirtRibbon_B_R2_01_Sp',
    'Root/Hip/Spine/Waist/Chest/Neck/Head/Hair_B_C1_01_Sp',
    'Root/Hip/Spine/Waist/Chest/Neck/Head/Hair_B_L1_01_Sp',
    'Root/Hip/Spine/Waist/Chest/Neck/Head/Hair_B_R1_01_Sp',
    'Root/Hip/Spine/Waist/Chest/Neck/Head/Hair_F_C1_01_Sp',
    'Root/Hip/Spine/Waist/Chest/Neck/Head/Hair_F_L1_01_Sp',
    'Root/Hip/Spine/Waist/Chest/Neck/Head/Hair_F_L2_01_Sp',
    'Root/Hip/Spine/Waist/Chest/Neck/Head/Hair_F_R1_01_Sp',
    'Root/Hip/Spine/Waist/Chest/Neck/Head/Hair_F_R2_01_Sp',
    'Root/Hip/Spine/Waist/Chest/Neck/Head/HairRibbon_F_C1_01_Sp',
    'Root/Hip/Spine/Waist/Chest/Neck/Head/HairRibbon_F_L1_01_Sp',
    'Root/Hip/Spine/Waist/Chest/Neck/Head/HairRibbon_F_R1_01_Sp',
    'Root/Hip/Spine/Waist/Chest/Neck/Head/Pony_S_L1_01_Sp',
    'Root/Hip/Spine/Waist/Chest/NeckRibbon_F_L1_01_Sp',
    'Root/Hip/Spine/Waist/Chest/NeckRibbon_F_R1_01_Sp',
    'Root/Hip/Spine/Waist/Chest/Shoulder_L/Arm_L/Forearm_L/Sleeve_Root_L/Sleeve_S_L1_01_Sp',
    'Root/Hip/Spine/Waist/Chest/Shoulder_L/Arm_L/Forearm_L/Sleeve_Root_L/Sleeve_S_L2_01_Sp',
    'Root/Hip/Spine/Waist/Chest/Shoulder_L/Arm_L/Forearm_L/Sleeve_Root_L/Sleeve_S_L3_01_Sp',
    'Root/Hip/Spine/Waist/Chest/Shoulder_L/Arm_L/Forearm_L/Sleeve_Root_L/Sleeve_S_L4_01_Sp',
    'Root/Hip/Spine/Waist/Chest/Shoulder_R/Arm_R/Forearm_R/Sleeve_Root_R/Sleeve_S_R1_01_Sp',
    'Root/Hip/Spine/Waist/Chest/Shoulder_R/Arm_R/Forearm_R/Sleeve_Root_R/Sleeve_S_R2_01_Sp',
    'Root/Hip/Spine/Waist/Chest/Shoulder_R/Arm_R/Forearm_R/Sleeve_Root_R/Sleeve_S_R3_01_Sp',
    'Root/Hip/Spine/Waist/Chest/Shoulder_R/Arm_R/Forearm_R/Sleeve_Root_R/Sleeve_S_R4_01_Sp',
    'Root/Hip/Spine/Waist/Lace_F_C1_01_Sp',
] as const

// The two serialized 101901 sleeve cloths require their exact Magica capsule
// lists.  The bounded web solver does not yet reproduce those per-sleeve
// colliders, so leave the sleeve chains on the authoritative mixer/rest pose
// instead of folding them through the coarse arm capsules.
const secondaryRootExcluded101901 = /\/Sleeve_Root_[LR]\//

interface SecondaryPhysicsExactProfile {
    mode: 'custom-101901-magica-profile'
    rootPaths: readonly string[]
}

interface BodyColliderPair {
    start: THREE.Object3D
    end: THREE.Object3D
    radius: number
    previousStart: THREE.Vector3
    previousEnd: THREE.Vector3
    initialized: boolean
}

function objectDepth(object: THREE.Object3D): number {
    let depth = 0
    for (let current = object.parent; current; current = current.parent) depth += 1
    return depth
}

/**
 * Per-loaded-character fallback for assets whose MagicaClothV2 profile and
 * executable solver are not present in the web model package. It runs after
 * AnimationMixer through character.userData.animationLoops, preserves the
 * loaded rig, resets on teleports/special actions and projects endpoints out
 * of the body capsule and current stage geometry.
 */
class ViewerSecondaryBonePhysics {
    readonly update: () => void
    private readonly character: ViewerCharacter
    private readonly collision: ViewerSceneCollisionWorld
    private readonly states: SecondaryBoneState[]
    private readonly bodyColliderPairs: BodyColliderPair[]
    private rootPosition = new THREE.Vector3()
    private rootQuaternion = new THREE.Quaternion()
    private initialized = false
    private active = false
    private accumulatorSeconds = 0
    private sceneProbeCursor = 0
    private stateProvider?: () => CharacterLocomotionSnapshot | undefined
    private readonly transportAnimatedBasesDuringLocomotionTransitions: boolean
    private lastLocomotionTransitionKey?: string
    private lastLocomotionTransitionState?: LocomotionState
    private transitionBaseTransportDurationSeconds = 0
    private transitionBaseTransportRemainingSeconds = 0
    private transitionTargetState?: LocomotionState
    private diagnosticsState: SecondaryPhysicsDiagnostics

    constructor(
        character: ViewerCharacter,
        collision: ViewerSceneCollisionWorld,
        exactProfile?: SecondaryPhysicsExactProfile,
    ) {
        this.character = character
        this.collision = collision
        this.transportAnimatedBasesDuringLocomotionTransitions = exactProfile?.mode === 'custom-101901-magica-profile'
        const states: SecondaryBoneState[] = []
        const rigRoot = findBodyRigRoot(character)
        const objectsByPath = rigRoot ? indexRigObjects(rigRoot) : new Map<string, THREE.Object3D>()
        const missingProfileRoots: string[] = []
        const excludedProfileRoots: string[] = []
        const selected = new Set<THREE.Object3D>()
        if (exactProfile) {
            for (const rootPath of exactProfile.rootPaths) {
                if (secondaryRootExcluded101901.test(rootPath)) {
                    excludedProfileRoots.push(rootPath)
                    continue
                }
                const root = objectsByPath.get(rootPath)
                if (!root) {
                    missingProfileRoots.push(rootPath)
                    continue
                }
                root.traverse(object => selected.add(object))
            }
        }
        character.object.traverse(object => {
            const bone = object as THREE.Bone
            const selectedByProfile = exactProfile ? selected.has(object) : secondaryBoneName.test(bone.name)
            if (!bone.isBone || !selectedByProfile || !bone.children.length) return
            const child = bone.children.find(candidate => candidate.position.lengthSq() > 1e-10)
            if (!child) return
            states.push({
                bone,
                childOffset: child.position.clone(),
                baseQuaternion: bone.quaternion.clone(),
                finalQuaternion: bone.quaternion.clone(),
                position: new THREE.Vector3(),
                previousPosition: new THREE.Vector3(),
                lastBaseTip: new THREE.Vector3(),
                motionClass: exactProfile?.mode === 'custom-101901-magica-profile'
                    ? 'authored-idle'
                    : 'dynamic',
                initialized: false,
                depth: objectDepth(bone),
            })
        })
        this.states = states.sort((left, right) => left.depth - right.depth)
        const colliderPathPairs = [
            ['Root/Hip', 'Root/Hip/Spine/Waist/Chest', 0.235],
            ['Root/Hip/Spine/Waist/Chest/Neck', 'Root/Hip/Spine/Waist/Chest/Neck/Head', 0.17],
            ['Root/Hip/UpLeg_L', 'Root/Hip/UpLeg_L/Leg_L/Foot_L', 0.105],
            ['Root/Hip/UpLeg_R', 'Root/Hip/UpLeg_R/Leg_R/Foot_R', 0.105],
            ['Root/Hip/Spine/Waist/Chest/Shoulder_L/Arm_L', 'Root/Hip/Spine/Waist/Chest/Shoulder_L/Arm_L/Forearm_L', 0.078],
            ['Root/Hip/Spine/Waist/Chest/Shoulder_L/Arm_L/Forearm_L', 'Root/Hip/Spine/Waist/Chest/Shoulder_L/Arm_L/Forearm_L/Hand_L', 0.068],
            ['Root/Hip/Spine/Waist/Chest/Shoulder_R/Arm_R', 'Root/Hip/Spine/Waist/Chest/Shoulder_R/Arm_R/Forearm_R', 0.078],
            ['Root/Hip/Spine/Waist/Chest/Shoulder_R/Arm_R/Forearm_R', 'Root/Hip/Spine/Waist/Chest/Shoulder_R/Arm_R/Forearm_R/Hand_R', 0.068],
        ] as const
        this.bodyColliderPairs = colliderPathPairs.flatMap(([startPath, endPath, radius]) => {
            const start = objectsByPath.get(startPath)
            const end = objectsByPath.get(endPath)
            return start && end ? [{
                start,
                end,
                radius,
                previousStart: new THREE.Vector3(),
                previousEnd: new THREE.Vector3(),
                initialized: false,
            }] : []
        })
        this.diagnosticsState = {
            mode: states.length ? exactProfile?.mode ?? 'viewer-spring-fallback' : 'no-secondary-bones',
            active: false,
            boneCount: states.length,
            profileRootCount: exactProfile?.rootPaths.length ?? 0,
            missingProfileRoots,
            excludedProfileRoots,
            sceneProbeBudgetPerStep: Math.min(2, states.length),
            sceneContacts: 0,
            bodyContacts: 0,
            idleAuthoredFollowBoneCount: states.filter(state => state.motionClass === 'authored-idle').length,
            idleAuthoredFollowFrames: 0,
            resetCount: 0,
            nonFiniteCorrections: 0,
        }
        this.update = () => {
            if (!this.active) return
            this.accumulatorSeconds += Math.min(getClockDelta(), 1 / 30)
            if (this.accumulatorSeconds < 1 / 60) return
            const deltaSeconds = Math.min(this.accumulatorSeconds, 1 / 30)
            this.accumulatorSeconds = 0
            this.step(deltaSeconds)
        }
    }

    get diagnostics(): SecondaryPhysicsDiagnostics {
        return { ...this.diagnosticsState, active: this.active }
    }

    setStateProvider(provider: () => CharacterLocomotionSnapshot | undefined): void {
        this.stateProvider = provider
    }

    setActive(value: boolean): void {
        if (this.active === value) return
        this.active = value
        this.accumulatorSeconds = 0
        this.diagnosticsState.active = value
        this.reset()
    }

    reset(): void {
        for (const state of this.states) {
            state.bone.quaternion.copy(state.baseQuaternion)
            state.finalQuaternion.copy(state.baseQuaternion)
            state.initialized = false
        }
        this.character.object.updateMatrixWorld(true)
        this.character.object.getWorldPosition(this.rootPosition)
        this.character.object.getWorldQuaternion(this.rootQuaternion)
        for (const pair of this.bodyColliderPairs) {
            pair.start.getWorldPosition(pair.previousStart)
            pair.end.getWorldPosition(pair.previousEnd)
            pair.initialized = true
        }
        this.lastLocomotionTransitionKey = undefined
        this.lastLocomotionTransitionState = undefined
        this.transitionBaseTransportDurationSeconds = 0
        this.transitionBaseTransportRemainingSeconds = 0
        this.transitionTargetState = undefined
        this.initialized = true
        this.diagnosticsState.resetCount += 1
    }

    private captureAnimatedBases(): void {
        for (const state of this.states) {
            // Most Magica secondary bones have no AnimationClip binding.  In
            // that case Mixer leaves our previous solver quaternion untouched;
            // treating it as a new animated base integrates the same offset on
            // every frame and quickly folds sleeves/hair into the body.  Only
            // accept a new base when another owner actually changed the bone
            // since our last write; otherwise restore the last authored base.
            if (state.bone.quaternion.angleTo(state.finalQuaternion) > 1e-5) {
                state.baseQuaternion.copy(state.bone.quaternion).normalize()
            } else {
                state.bone.quaternion.copy(state.baseQuaternion)
                state.bone.updateMatrix()
            }
        }
        this.character.object.updateMatrixWorld(true)
    }

    private bodyProject(
        position: THREE.Vector3,
        previousPosition: THREE.Vector3,
        colliders: readonly {
            start: THREE.Vector3
            end: THREE.Vector3
            previousStart: THREE.Vector3
            previousEnd: THREE.Vector3
            radius: number
        }[],
    ): boolean {
        let projected = false
        for (const collider of colliders) {
            const segment = collider.end.clone().sub(collider.start)
            const segmentLengthSq = segment.lengthSq()
            const currentRatio = segmentLengthSq > 1e-10
                ? THREE.MathUtils.clamp(
                    position.clone().sub(collider.start).dot(segment) / segmentLengthSq,
                    0,
                    1,
                )
                : 0
            const previousSegment = collider.previousEnd.clone().sub(collider.previousStart)
            const previousSegmentLengthSq = previousSegment.lengthSq()
            const previousRatio = previousSegmentLengthSq > 1e-10
                ? THREE.MathUtils.clamp(
                    previousPosition.clone().sub(collider.previousStart).dot(previousSegment)
                        / previousSegmentLengthSq,
                    0,
                    1,
                )
                : 0
            const currentNearest = collider.start.clone().addScaledVector(segment, currentRatio)
            const previousNearest = collider.previousStart.clone().addScaledVector(previousSegment, previousRatio)
            const currentOffset = position.clone().sub(currentNearest)
            const previousOffset = previousPosition.clone().sub(previousNearest)
            const currentDistance = currentOffset.length()
            const previousDistance = previousOffset.length()
            // Serialized cloth roots/tips may intentionally begin inside a
            // coarse body volume. Only prevent an outside-to-inside crossing;
            // projecting every authored internal point caused alternating
            // directions and violent hair/skirt jitter.
            if (currentDistance >= collider.radius || previousDistance < collider.radius * 0.98) continue
            const direction = currentDistance > 1e-7
                ? currentOffset.multiplyScalar(1 / currentDistance)
                : previousOffset.lengthSq() > 1e-12
                    ? previousOffset.normalize()
                    : undefined
            if (!direction) continue
            position.copy(currentNearest).addScaledVector(direction, collider.radius)
            projected = true
        }
        return projected
    }

    private step(deltaSeconds: number): void {
        if (!this.states.length || this.character.disposed || deltaSeconds <= 0) return
        this.captureAnimatedBases()
        const root = this.character.object.getWorldPosition(new THREE.Vector3())
        const rootRotation = this.character.object.getWorldQuaternion(new THREE.Quaternion())
        if (
            !this.initialized
            || root.distanceTo(this.rootPosition) > 0.5
            || rootRotation.angleTo(this.rootQuaternion) > THREE.MathUtils.degToRad(90)
        ) {
            this.reset()
        }
        this.rootPosition.copy(root)
        this.rootQuaternion.copy(rootRotation)
        this.diagnosticsState.sceneContacts = 0
        this.diagnosticsState.bodyContacts = 0
        const bodyColliders = this.bodyColliderPairs.map(pair => {
            const start = pair.start.getWorldPosition(new THREE.Vector3())
            const end = pair.end.getWorldPosition(new THREE.Vector3())
            const collider = {
                start,
                end,
                previousStart: pair.initialized ? pair.previousStart.clone() : start.clone(),
                previousEnd: pair.initialized ? pair.previousEnd.clone() : end.clone(),
                radius: pair.radius + 0.018,
            }
            pair.previousStart.copy(start)
            pair.previousEnd.copy(end)
            pair.initialized = true
            return collider
        })

        const damping = Math.exp(-11 * deltaSeconds)
        const stiffness = 58
        const gravity = 0.82
        const motion = this.stateProvider?.()
        const locomotionTransitionKey = motion ? `${motion.state}:${motion.jumpMode}` : undefined
        if (
            this.transportAnimatedBasesDuringLocomotionTransitions
            && motion
            && locomotionTransitionKey !== this.lastLocomotionTransitionKey
        ) {
            if (this.lastLocomotionTransitionKey !== undefined) {
                const transitionSeconds = targetRigMinimumLocomotionTransitionSeconds(
                    this.lastLocomotionTransitionState,
                    motion.state,
                )
                this.transitionBaseTransportDurationSeconds = transitionSeconds
                this.transitionBaseTransportRemainingSeconds = transitionSeconds
                this.transitionTargetState = motion.state
            }
            this.lastLocomotionTransitionKey = locomotionTransitionKey
            this.lastLocomotionTransitionState = motion.state
        }
        const secondaryTransitionActive = this.transitionBaseTransportRemainingSeconds > 1e-6
        const secondaryTransitionProgress = secondaryTransitionActive
            ? THREE.MathUtils.clamp(
                1 - this.transitionBaseTransportRemainingSeconds
                    / Math.max(1e-6, this.transitionBaseTransportDurationSeconds),
                0,
                1,
            )
            : 1
        const authoredIdleRecoveryWeight = secondaryTransitionActive && this.transitionTargetState === 'idle'
            ? secondaryTransitionProgress * secondaryTransitionProgress * (3 - 2 * secondaryTransitionProgress)
            : 0
        const idleHairStability = motion?.state === 'idle'
            && motion.grounded
            && Math.hypot(motion.velocity.x, motion.velocity.z) < 0.08
        const probeBudget = Math.min(2, this.states.length)
        for (let stateIndex = 0; stateIndex < this.states.length; stateIndex += 1) {
            const state = this.states[stateIndex]
            const bone = state.bone
            const origin = bone.getWorldPosition(new THREE.Vector3())
            const baseTip = state.childOffset.clone().applyMatrix4(bone.matrixWorld)
            const length = Math.max(1e-5, origin.distanceTo(baseTip))
            const followAuthoredIdleSecondary = idleHairStability
                && state.motionClass === 'authored-idle'
                && !secondaryTransitionActive
            if (followAuthoredIdleSecondary) {
                // HomeWait01_L already contains authored local rotations for the
                // three Hair_B chains and seven OuterSkirt endpoints. Re-running a
                // world-space spring/collision solve on the same bones makes the
                // long hair alternate across the rigid bow and makes the skirt
                // alternate around its coarse hip capsule as the body pose moves.
                // At idle, preserve the exact mixer result. A second damped blend
                // trails the authored HomeWait curve and repeatedly pushes hair
                // through the rigid rear bow and the skirt through its coarse hip
                // capsule. Leaving idle still starts the dynamic solver from this
                // visible authored pose, so movement inertia begins continuously.
                state.finalQuaternion.copy(state.baseQuaternion)
                bone.quaternion.copy(state.finalQuaternion)
                bone.updateMatrix()
                bone.updateWorldMatrix(false, false)
                const authoredTip = state.childOffset.clone().applyMatrix4(bone.matrixWorld)
                state.position.copy(authoredTip)
                state.previousPosition.copy(authoredTip)
                state.lastBaseTip.copy(authoredTip)
                state.initialized = true
                this.diagnosticsState.idleAuthoredFollowFrames += 1
                continue
            }
            if (!state.initialized) {
                state.position.copy(baseTip)
                state.previousPosition.copy(baseTip)
                state.lastBaseTip.copy(baseTip)
                state.initialized = true
            } else {
                if (secondaryTransitionActive) {
                    // AnimationMixer moves the authored hair/skirt base every
                    // frame during a locomotion crossfade. Carry the existing
                    // particle state by that exact base displacement so the
                    // secondary solver retains inertia without being left in
                    // the previous clip's world-space pose. This is active only
                    // for the same bounded interval as the TPS mixer fade.
                    const baseTransport = baseTip.clone().sub(state.lastBaseTip)
                    if ([baseTransport.x, baseTransport.y, baseTransport.z].every(Number.isFinite)) {
                        state.position.add(baseTransport)
                        state.previousPosition.add(baseTransport)
                    }
                }
                if (state.position.distanceTo(baseTip) > Math.max(0.2, length * 2.2)) {
                    state.position.copy(baseTip)
                    state.previousPosition.copy(baseTip)
                }
                const velocity = state.position.clone().sub(state.previousPosition).multiplyScalar(damping)
                velocity.clampLength(0, Math.max(0.008, length * 0.24))
                state.previousPosition.copy(state.position)
                state.position.add(velocity)
                state.position.y -= gravity * deltaSeconds * deltaSeconds
                state.position.addScaledVector(
                    baseTip.clone().sub(state.position),
                    Math.min(1, stiffness * deltaSeconds * deltaSeconds),
                )
                if (authoredIdleRecoveryWeight > 0) {
                    // Walk/run -> idle must converge to the exact authored
                    // HomeWait secondary pose across the recovery fade, not
                    // switch to it in one frame when locomotion state changes.
                    state.position.lerp(baseTip, authoredIdleRecoveryWeight)
                    state.previousPosition.lerp(baseTip, authoredIdleRecoveryWeight)
                }
            }

            const direction = state.position.clone().sub(origin)
            if (direction.lengthSq() < 1e-10) direction.copy(baseTip).sub(origin)
            state.position.copy(origin).add(direction.normalize().multiplyScalar(length))
            if (this.bodyProject(state.position, state.previousPosition, bodyColliders)) {
                this.diagnosticsState.bodyContacts += 1
            }
            const probeOffset = (stateIndex - this.sceneProbeCursor + this.states.length) % this.states.length
            if (probeOffset < probeBudget) {
                const projected = this.collision.resolveParticleMotion({
                    characterId: String(this.character.userData.characterId),
                    particleId: bone.uuid,
                    previousPosition: state.previousPosition,
                    desiredPosition: state.position,
                    radius: 0.018,
                    deltaSeconds,
                })
                if (projected.contacts.length) this.diagnosticsState.sceneContacts += projected.contacts.length
                state.position.copy(projected.position)
            }

            if (![state.position.x, state.position.y, state.position.z].every(Number.isFinite)) {
                state.position.copy(baseTip)
                state.previousPosition.copy(baseTip)
                this.diagnosticsState.nonFiniteCorrections += 1
            }
            const baseDirection = baseTip.clone().sub(origin).normalize()
            const targetDirection = state.position.clone().sub(origin).normalize()
            const worldDelta = new THREE.Quaternion().setFromUnitVectors(baseDirection, targetDirection)
            const identity = new THREE.Quaternion()
            worldDelta.rotateTowards(
                identity,
                Math.max(0, worldDelta.angleTo(identity) - THREE.MathUtils.degToRad(8)),
            )
            const parentWorld = bone.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion()
            const localDelta = parentWorld.clone().invert().multiply(worldDelta).multiply(parentWorld)
            const targetQuaternion = localDelta.multiply(state.baseQuaternion).normalize()
            state.finalQuaternion.slerp(targetQuaternion, 1 - Math.exp(-12 * deltaSeconds)).normalize()
            bone.quaternion.copy(state.finalQuaternion)
            bone.updateMatrix()
            bone.updateWorldMatrix(false, false)
            state.lastBaseTip.copy(baseTip)
        }
        this.transitionBaseTransportRemainingSeconds = Math.max(
            0,
            this.transitionBaseTransportRemainingSeconds - deltaSeconds,
        )
        if (this.transitionBaseTransportRemainingSeconds <= 1e-6) {
            this.transitionTargetState = undefined
        }
        if (this.states.length) this.sceneProbeCursor = (this.sceneProbeCursor + probeBudget) % this.states.length
    }
}

function isTextInputTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLInputElement
        || target instanceof HTMLSelectElement
        || target instanceof HTMLTextAreaElement
        || (target instanceof HTMLElement && target.isContentEditable)
}

function familyEquals(left: string, right: string): boolean {
    return normalizeAnimationFamilyName(left).toLowerCase()
        === normalizeAnimationFamilyName(right).toLowerCase()
}

function getRigPath(path: string): string | undefined {
    const parts = path.split('/')
    const rootIndex = parts.indexOf('Root')
    return rootIndex < 0 ? undefined : parts.slice(rootIndex).join('/')
}

const requiredHumanoidRigPaths = [
    'Root/Hip',
    'Root/Hip/Spine',
    'Root/Hip/UpLeg_L/Leg_L/Foot_L',
    'Root/Hip/UpLeg_R/Leg_R/Foot_R',
    'Root/Hip/Spine/Waist/Chest/Shoulder_L/Arm_L/Forearm_L/Hand_L',
    'Root/Hip/Spine/Waist/Chest/Shoulder_R/Arm_R/Forearm_R/Hand_R',
] as const

function indexRigObjects(rigRoot: THREE.Object3D): Map<string, THREE.Object3D> {
    const objectsByRigPath = new Map<string, THREE.Object3D>()
    const walkRig = (object: THREE.Object3D, parentPath = ''): void => {
        const path = parentPath ? `${parentPath}/${object.name}` : object.name
        objectsByRigPath.set(path, object)
        for (const child of object.children) walkRig(child, path)
    }
    walkRig(rigRoot)
    return objectsByRigPath
}

function findBodyRigRoot(character: ViewerCharacter): THREE.Object3D | undefined {
    const rigRoots: THREE.Object3D[] = []
    character.object.traverse(object => {
        if (object.name === 'Root' && object.children.some(child => child.name === 'Hip')) {
            rigRoots.push(object)
        }
    })
    return rigRoots.length === 1 ? rigRoots[0] : undefined
}

function indexExactObjectPaths(root: THREE.Object3D): {
    objects: Map<string, THREE.Object3D>
    ambiguous: Set<string>
} {
    const objects = new Map<string, THREE.Object3D>()
    const ambiguous = new Set<string>()
    const walk = (object: THREE.Object3D, parentPath = ''): void => {
        const path = parentPath ? `${parentPath}/${object.name}` : object.name
        if (objects.has(path)) {
            objects.delete(path)
            ambiguous.add(path)
        } else if (!ambiguous.has(path)) {
            objects.set(path, object)
        }
        for (const child of object.children) walk(child, path)
    }
    walk(root)
    return { objects, ambiguous }
}

function findExactModelRoot(character: ViewerCharacter, runtime: OfficialCombatRuntime): THREE.Object3D | undefined {
    const expectedName = runtime.modelKey.split('/').at(-1)
    if (!expectedName) return undefined
    const candidates: THREE.Object3D[] = []
    character.object.traverse(object => {
        if (object.name === expectedName) candidates.push(object)
    })
    return candidates.length === 1 ? candidates[0] : undefined
}

function attachOfficialDungeonLocomotion(
    character: ViewerCharacter,
    safety = getViewerRigSafety(character),
): OfficialDungeonAttachResult {
    const result: OfficialDungeonAttachResult = {
        status: 'incompatible',
        sourceCharacterId: officialDungeonLocomotion.sourceCharacterId,
        sourceAnimationBundle: officialDungeonLocomotion.sourceAnimationBundle,
        rootMotionRule: officialDungeonLocomotion.rootMotionRule,
        clips: [],
        missingRequiredRigPaths: [],
    }
    if (!safety.allowCrossCharacterDungeon) {
        result.status = 'disabled-unverified'
        result.reason = safety.reason
        return result
    }
    const rigRoot = findBodyRigRoot(character)
    if (!rigRoot) {
        result.reason = 'expected exactly one body Root/Hip hierarchy'
        return result
    }
    result.rigRoot = rigRoot.parent?.name
        ? `${rigRoot.parent.name}/${rigRoot.name}`
        : rigRoot.name
    const objectsByRigPath = indexRigObjects(rigRoot)
    result.missingRequiredRigPaths = requiredHumanoidRigPaths.filter(
        path => !objectsByRigPath.has(path),
    )
    if (result.missingRequiredRigPaths.length > 0) {
        result.reason = 'required common humanoid rig paths are absent'
        return result
    }

    const clips: THREE.AnimationClip[] = []
    for (const serialized of officialDungeonLocomotion.clips) {
        let droppedTracks = 0
        let suppressedRootMotionTracks = 0
        const tracks = serialized.tracks.flatMap(track => {
            const separator = track.name.indexOf('.')
            if (separator < 1) {
                droppedTracks++
                return []
            }
            const sourceNodeId = track.name.slice(0, separator)
            const sourcePath = officialDungeonLocomotion.nodePaths[sourceNodeId]
            const rigPath = sourcePath ? getRigPath(sourcePath) : undefined
            if (!rigPath) {
                droppedTracks++
                return []
            }
            if (rigPath === 'Root' && track.name.slice(separator) === '.position') {
                suppressedRootMotionTracks++
                return []
            }
            const target = objectsByRigPath.get(rigPath)
            if (!target) {
                droppedTracks++
                return []
            }
            return [{
                ...track,
                name: `${target.uuid}${track.name.slice(separator)}`,
            }]
        })
        const clip = THREE.AnimationClip.parse({ ...serialized, tracks } as any)
        clips.push(clip)
        result.clips.push({
            name: clip.name,
            sourceClipPathId: serialized.sourceClipPathId,
            attachedTracks: tracks.length,
            droppedTracks,
            suppressedRootMotionTracks,
        })
    }

    const attachedNames = new Set(clips.map(clip => clip.name))
    character.object.animations = [
        ...character.object.animations.filter(clip => !attachedNames.has(clip.name)),
        ...clips,
    ]
    result.status = 'attached'
    return result
}

function attachOfficialCombatActions(
    character: ViewerCharacter,
    safety = getViewerRigSafety(character),
): OfficialCombatAttachResult {
    const viewerCharacterId = Number(character.userData.characterId)
    if (!safety.allowCombatActions) {
        return {
            status: 'not-configured',
            viewerCharacterId,
            actions: [],
            missingRequiredRigPaths: [],
            reason: safety.reason,
        }
    }
    const runtime = officialCombatRuntimes.find(
        candidate => candidate.viewerCharacterId === viewerCharacterId,
    )
    if (!runtime) {
        return {
            status: 'not-configured',
            viewerCharacterId,
            actions: [],
            missingRequiredRigPaths: [],
            reason: `combat runtime ${officialCombatLoadStatus}: ${officialCombatLoadError}`,
        }
    }
    const result: OfficialCombatAttachResult = {
        status: 'incompatible',
        viewerCharacterId,
        modelKey: runtime.modelKey,
        rootMotionRule: runtime.rootMotionRule,
        actions: [],
        missingRequiredRigPaths: [],
    }
    result.rejectedActions = runtime.rejectedActions.map(action => ({ ...action }))
    const modelRoot = findExactModelRoot(character, runtime)
    if (!modelRoot) {
        result.reason = `expected exactly one ${runtime.modelKey.split('/').at(-1)} model root`
        return result
    }
    const { objects: objectsByExactPath, ambiguous: ambiguousExactPaths } = indexExactObjectPaths(modelRoot)
    const serializedByName = new Map(runtime.clips.map(clip => [clip.name, clip]))
    const parsedByName = new Map<string, {
        clip: THREE.AnimationClip
        sourceClipPathId: string
        attachedTracks: number
        droppedTracks: number
        suppressedRootMotionTracks: number
    }>()
    const missingPaths = new Set<string>()
    const bodyRootPath = `${modelRoot.name}/VisualRoot/chara_101901_model/chara_101901/Root`

    const parseComponentClip = (component: OfficialCombatAnimationComponent) => {
        const cached = parsedByName.get(component.runtimeClipName)
        if (cached) return cached
        const serialized = serializedByName.get(component.runtimeClipName)
        if (!serialized || serialized.sourceClipPathId !== component.sourceClipPathId) return undefined
        let droppedTracks = 0
        let suppressedRootMotionTracks = 0
        const tracks = serialized.tracks.flatMap(track => {
            const separator = track.name.indexOf('.')
            if (separator < 1) {
                droppedTracks++
                return []
            }
            const sourceNodeId = track.name.slice(0, separator)
            const sourcePath = runtime.nodePaths[sourceNodeId]
            const exactPath = sourcePath?.replace(/^<root>\//, '')
            if (!exactPath) {
                droppedTracks++
                return []
            }
            if (exactPath === bodyRootPath && track.name.slice(separator) === '.position') {
                suppressedRootMotionTracks++
                return []
            }
            const target = objectsByExactPath.get(exactPath)
            if (!target) {
                droppedTracks++
                missingPaths.add(ambiguousExactPaths.has(exactPath)
                    ? `${exactPath} (ambiguous)`
                    : exactPath)
                return []
            }
            return [{
                ...track,
                name: `${target.uuid}${track.name.slice(separator)}`,
            }]
        })
        const clip = THREE.AnimationClip.parse({ ...serialized, tracks } as any)
        const parsed = {
            clip,
            sourceClipPathId: serialized.sourceClipPathId,
            attachedTracks: tracks.length,
            droppedTracks,
            suppressedRootMotionTracks,
        }
        parsedByName.set(component.runtimeClipName, parsed)
        return parsed
    }

    const clips = new Map<string, THREE.AnimationClip>()
    for (const metadata of runtime.actions) {
        const attachedClips: NonNullable<OfficialCombatAttachResult['actions'][number]['attachedClips']> = []
        let actionCompatible = true
        for (const segment of metadata.segments) {
            for (const component of segment.components) {
                const parsed = parseComponentClip(component)
                if (!parsed || parsed.droppedTracks > 0) {
                    actionCompatible = false
                    continue
                }
                clips.set(parsed.clip.name, parsed.clip)
                attachedClips.push({
                    name: parsed.clip.name,
                    sourceClipPathId: parsed.sourceClipPathId,
                    attachedTracks: parsed.attachedTracks,
                    droppedTracks: parsed.droppedTracks,
                    suppressedRootMotionTracks: parsed.suppressedRootMotionTracks,
                })
            }
        }
        if (!actionCompatible || attachedClips.length === 0) continue
        result.actions.push({
            ...metadata,
            attachedTracks: attachedClips.reduce((sum, clip) => sum + clip.attachedTracks, 0),
            droppedTracks: attachedClips.reduce((sum, clip) => sum + clip.droppedTracks, 0),
            suppressedRootMotionTracks: attachedClips.reduce(
                (sum, clip) => sum + clip.suppressedRootMotionTracks,
                0,
            ),
            attachedClips,
        })
    }
    result.missingRequiredRigPaths = [...missingPaths].sort()
    const attachedNames = new Set(clips.keys())
    character.object.animations = [
        ...character.object.animations.filter(clip => !attachedNames.has(clip.name)),
        ...clips.values(),
    ]
    result.status = result.actions.length === runtime.actions.length
        ? 'attached'
        : 'incompatible'
    if (result.status !== 'attached') {
        result.reason = `attached ${result.actions.length}/${runtime.actions.length} official combat actions`
    }
    return result
}

function prepareAnimationFamilyClips(character: ViewerCharacter, name: string): THREE.AnimationClip[] {
    const claimedTracks = new Set<string>()
    return character.animation.getAnimationClipsByName(name).flatMap(clip => {
        const tracks = clip.tracks.filter(track => {
            if (claimedTracks.has(track.name)) return false
            claimedTracks.add(track.name)
            return true
        })
        if (tracks.length === 0) return []
        if (tracks.length === clip.tracks.length) return [clip]
        const prepared = clip.clone()
        prepared.name = clip.name
        prepared.tracks = tracks
        prepared.duration = clip.duration
        return [prepared]
    })
}

function attachParameterizedHumanoidMotionProfile(
    character: ViewerCharacter,
    baselineClip: string | undefined,
    motionReference: NormalizedHumanoidMotionReference = normalizedHumanoidMotionReferenceSetA,
    profileId = 'set-a',
    profileLabel = 'Set A / 轻量小体型（保留当前走跑）',
): {
    profile: CharacterSpecificMotionProfile
    animations?: LocomotionAnimationMap
    jumpAnimations?: JumpLocomotionAnimationMap
    postAnimationWalkClearance?: CharacterSpecificMotionPostAnimationClearance
} {
    const characterId = Number(character.userData.characterId)
    const profile: CharacterSpecificMotionProfile = {
        status: 'not-configured',
        characterId,
        provenance: 'custom-character-profile',
        profileId,
        profileLabel,
        baselineClip,
        generatedClips: [],
        missingRequiredRigPaths: [],
    }
    const targetRigMorphologyProfile = profileId === targetRigMorphologyProfileId
    const supportedTargetRigProfile = characterId === 101901
        || (targetRigMorphologyProfile && (
            targetRigMorphologyCharacterIds.has(characterId)
            || isMagicalGirlSourceCharacter(character)
        ))
    if (!supportedTargetRigProfile) {
        profile.reason = `parameterized target-rig locomotion has no approved morphology profile for character ${characterId}`
        return { profile }
    }
    if (!baselineClip) {
        profile.status = 'incompatible'
        profile.reason = `character ${characterId} loaded idle family is absent`
        return { profile }
    }
    const rigRoot = findBodyRigRoot(character)
    if (!rigRoot) {
        profile.status = 'incompatible'
        profile.reason = `expected exactly one character ${characterId} body Root/Hip hierarchy`
        return { profile }
    }
    const rig = indexRigObjects(rigRoot)
    const motionPaths = {
        hip: 'Root/Hip',
        spine: 'Root/Hip/Spine',
        waist: 'Root/Hip/Spine/Waist',
        chest: 'Root/Hip/Spine/Waist/Chest',
        neck: 'Root/Hip/Spine/Waist/Chest/Neck',
        head: 'Root/Hip/Spine/Waist/Chest/Neck/Head',
        shoulderL: 'Root/Hip/Spine/Waist/Chest/Shoulder_L',
        upperArmL: 'Root/Hip/Spine/Waist/Chest/Shoulder_L/Arm_L',
        forearmL: 'Root/Hip/Spine/Waist/Chest/Shoulder_L/Arm_L/Forearm_L',
        handL: 'Root/Hip/Spine/Waist/Chest/Shoulder_L/Arm_L/Forearm_L/Hand_L',
        shoulderR: 'Root/Hip/Spine/Waist/Chest/Shoulder_R',
        upperArmR: 'Root/Hip/Spine/Waist/Chest/Shoulder_R/Arm_R',
        forearmR: 'Root/Hip/Spine/Waist/Chest/Shoulder_R/Arm_R/Forearm_R',
        handR: 'Root/Hip/Spine/Waist/Chest/Shoulder_R/Arm_R/Forearm_R/Hand_R',
        upperLegL: 'Root/Hip/UpLeg_L',
        lowerLegL: 'Root/Hip/UpLeg_L/Leg_L',
        footL: 'Root/Hip/UpLeg_L/Leg_L/Foot_L',
        toeL: 'Root/Hip/UpLeg_L/Leg_L/Foot_L/Toe_L',
        upperLegR: 'Root/Hip/UpLeg_R',
        lowerLegR: 'Root/Hip/UpLeg_R/Leg_R',
        footR: 'Root/Hip/UpLeg_R/Leg_R/Foot_R',
        toeR: 'Root/Hip/UpLeg_R/Leg_R/Foot_R/Toe_R',
    } as const
    type MotionRole = keyof typeof motionPaths
    profile.missingRequiredRigPaths = Object.values(motionPaths).filter(path => !rig.has(path))
    if (profile.missingRequiredRigPaths.length > 0) {
        profile.status = 'incompatible'
        profile.reason = `character ${characterId} exact full-body locomotion paths are incomplete`
        return { profile }
    }

    const baselineFamilyClips = prepareAnimationFamilyClips(character, baselineClip)
    const baselineTrackCount = baselineFamilyClips.reduce((sum, clip) => sum + clip.tracks.length, 0)
    if (baselineTrackCount === 0) {
        profile.status = 'incompatible'
        profile.reason = `character ${characterId} baseline family ${baselineClip} has no tracks`
        return { profile }
    }

    // The loaded HomeWait is a valid idle, but its hands are clasped in front of
    // the body. It therefore cannot remain as a live base layer under walking:
    // an additive swing preserves that clasp and produces the rejected corridor
    // pose. Sample one deterministic frame, freeze every body/helper binding,
    // then author complete normal-blend locomotion clips from that snapshot.
    // Idle remains the untouched official HomeWait family.
    const savedBaselineTransforms = new Map<THREE.Object3D, {
        position: THREE.Vector3
        quaternion: THREE.Quaternion
        scale: THREE.Vector3
    }>()
    const baselineSampleTimeSeconds = 0.1
    for (const clip of baselineFamilyClips) {
        const sampleTime = Math.min(baselineSampleTimeSeconds, Math.max(0, clip.duration))
        for (const track of clip.tracks) {
            const separator = track.name.lastIndexOf('.')
            if (separator < 1) continue
            const targetId = track.name.slice(0, separator)
            const property = track.name.slice(separator + 1)
            if (property !== 'position' && property !== 'quaternion' && property !== 'scale') continue
            const target = character.object.getObjectByProperty('uuid', targetId)
            if (!target) continue
            if (!savedBaselineTransforms.has(target)) {
                savedBaselineTransforms.set(target, {
                    position: target.position.clone(),
                    quaternion: target.quaternion.clone(),
                    scale: target.scale.clone(),
                })
            }
            const value = (track as THREE.KeyframeTrack & {
                createInterpolant(): { evaluate(time: number): ArrayLike<number> }
            }).createInterpolant().evaluate(sampleTime)
            if (property === 'position') target.position.fromArray(value)
            else if (property === 'scale') target.scale.fromArray(value)
            else target.quaternion.fromArray(value).normalize()
        }
    }
    const sampledBaselineTransforms = new Map<THREE.Object3D, {
        position: THREE.Vector3
        quaternion: THREE.Quaternion
        scale: THREE.Vector3
    }>()
    for (const target of savedBaselineTransforms.keys()) {
        sampledBaselineTransforms.set(target, {
            position: target.position.clone(),
            quaternion: target.quaternion.clone(),
            scale: target.scale.clone(),
        })
    }
    const resetToSampledBaseline = (): void => {
        for (const [target, transform] of sampledBaselineTransforms) {
            target.position.copy(transform.position)
            target.quaternion.copy(transform.quaternion)
            target.scale.copy(transform.scale)
        }
        character.object.updateMatrixWorld(true)
    }
    const restorePreSamplePose = (): void => {
        for (const [target, transform] of savedBaselineTransforms) {
            target.position.copy(transform.position)
            target.quaternion.copy(transform.quaternion)
            target.scale.copy(transform.scale)
        }
        character.object.updateMatrixWorld(true)
    }

    character.object.updateMatrixWorld(true)
    const modelWorld = character.object.getWorldQuaternion(new THREE.Quaternion())
    const worldUp = new THREE.Vector3(0, 1, 0).applyQuaternion(modelWorld).normalize()
    const skeletonRestWorld = new Map<THREE.Object3D, THREE.Matrix4>()
    character.object.traverse(target => {
        const mesh = target as THREE.SkinnedMesh
        if (!mesh.isSkinnedMesh || !mesh.skeleton) return
        mesh.skeleton.bones.forEach((bone, index) => {
            if (!skeletonRestWorld.has(bone)) {
                skeletonRestWorld.set(bone, mesh.skeleton.boneInverses[index].clone().invert())
            }
        })
    })
    const skeletonRestLocal = new Map<THREE.Object3D, {
        position: THREE.Vector3
        quaternion: THREE.Quaternion
        scale: THREE.Vector3
    }>()
    for (const [bone, restWorld] of skeletonRestWorld) {
        const parentRestWorld = bone.parent ? skeletonRestWorld.get(bone.parent) : undefined
        const restLocal = parentRestWorld
            ? parentRestWorld.clone().invert().multiply(restWorld)
            : restWorld.clone()
        const position = new THREE.Vector3()
        const quaternion = new THREE.Quaternion()
        const scale = new THREE.Vector3()
        restLocal.decompose(position, quaternion, scale)
        skeletonRestLocal.set(bone, { position, quaternion, scale })
    }
    const requiredTargetRestHandBones = [
        rig.get(motionPaths.handL)!,
        rig.get(motionPaths.handR)!,
    ]
    if (requiredTargetRestHandBones.some(bone => !skeletonRestLocal.has(bone))) {
        restorePreSamplePose()
        profile.status = 'incompatible'
        profile.reason = `character ${characterId} inverse-bind rest hand pose is incomplete`
        return { profile }
    }
    const segmentLength = (fromPath: string, toPath: string): number => {
        const from = rig.get(fromPath)!.getWorldPosition(new THREE.Vector3())
        const to = rig.get(toPath)!.getWorldPosition(new THREE.Vector3())
        return from.distanceTo(to)
    }
    const upperLegLengthMeters = (
        segmentLength(motionPaths.upperLegL, motionPaths.lowerLegL)
        + segmentLength(motionPaths.upperLegR, motionPaths.lowerLegR)
    ) / 2
    const lowerLegLengthMeters = (
        segmentLength(motionPaths.lowerLegL, motionPaths.footL)
        + segmentLength(motionPaths.lowerLegR, motionPaths.footR)
    ) / 2
    const legLengthMeters = upperLegLengthMeters + lowerLegLengthMeters
    const armSegmentLengths = {
        L: {
            upper: segmentLength(motionPaths.upperArmL, motionPaths.forearmL),
            lower: segmentLength(motionPaths.forearmL, motionPaths.handL),
        },
        R: {
            upper: segmentLength(motionPaths.upperArmR, motionPaths.forearmR),
            lower: segmentLength(motionPaths.forearmR, motionPaths.handR),
        },
    } as const
    const armLengthMeters = (
        armSegmentLengths.L.upper
        + armSegmentLengths.L.lower
        + armSegmentLengths.R.upper
        + armSegmentLengths.R.lower
    ) / 2
    const targetRigWorldPosition = (target: THREE.Object3D): THREE.Vector3 => (
        target.getWorldPosition(new THREE.Vector3())
    )
    // Morphology is a rig property, not a property of whichever HomeWait frame
    // happened to be sampled while the profile was attached.  In particular,
    // measuring wrist-to-skirt clearance from the sampled idle pose can collapse
    // the distance when that pose puts a hand near the dress and consequently
    // make one unrelated donor dominate the nearest-neighbour kernel.  Use the
    // inverse-bind rest matrices for every morphology feature; fall back only for
    // non-skeleton helper transforms that have no formal bind matrix.
    const targetRigRestPosition = (target: THREE.Object3D): THREE.Vector3 => {
        const restWorld = skeletonRestWorld.get(target)
        return restWorld
            ? new THREE.Vector3().setFromMatrixPosition(restWorld)
            : targetRigWorldPosition(target)
    }
    const targetRigSkirtProxyBones = [...rig.entries()]
        .filter(([path]) => /\/(?:Outer)?Skirt_/i.test(path) && !/_End(?:\/|$)/i.test(path))
        .map(([, target]) => target)
    const targetRigHairProxyBones = [...rig.entries()]
        .filter(([path]) => /\/(?:Hair|BackHair|SideHair|Pony|Twin)/i.test(path) && !/_End(?:\/|$)/i.test(path))
        .map(([, target]) => target)
    const targetRigSleeveProxyBones = [...rig.entries()]
        .filter(([path]) => /\/(?:Armfrill|Sleeve|Cuff)/i.test(path) && !/_End(?:\/|$)/i.test(path))
        .map(([, target]) => target)
    const donorFeatureMedian = (name: HumanoidMorphologyFeatureName): number => {
        const values = Object.values(motionReference.morphologyDiagnostics?.donors ?? {})
            .map(record => numericMorphologyFeature(record.features, name))
            .filter((value): value is number => value !== undefined)
            .sort((a, b) => a - b)
        if (values.length === 0) throw new Error(`morphology donor feature ${name} is absent`)
        const middle = Math.floor(values.length / 2)
        return values.length % 2 === 1 ? values[middle] : (values[middle - 1] + values[middle]) / 2
    }
    const targetRigMorphologyFeatures: HumanoidMorphologyFeatures | undefined = targetRigMorphologyProfile
        ? (() => {
            const restUp = new THREE.Vector3(0, 1, 0)
            const hipPosition = targetRigRestPosition(rig.get(motionPaths.hip)!)
            const headPosition = targetRigRestPosition(rig.get(motionPaths.head)!)
            const toePositions = [
                targetRigRestPosition(rig.get(motionPaths.toeL)!),
                targetRigRestPosition(rig.get(motionPaths.toeR)!),
            ]
            const handPositions = [
                targetRigRestPosition(rig.get(motionPaths.handL)!),
                targetRigRestPosition(rig.get(motionPaths.handR)!),
            ]
            const horizontalRadiusFromHip = (target: THREE.Object3D): number => {
                const offset = targetRigRestPosition(target).sub(hipPosition)
                return offset.addScaledVector(restUp, -offset.dot(restUp)).length()
            }
            const sleeveDistances = targetRigSleeveProxyBones.map(target => {
                const position = targetRigRestPosition(target)
                return Math.min(...handPositions.map(hand => hand.distanceTo(position)))
            })
            const wristToSkirtDistances = targetRigSkirtProxyBones.flatMap(target => {
                const position = targetRigRestPosition(target)
                return handPositions.map(hand => hand.distanceTo(position))
            })
            const headToToeHeight = headPosition.dot(restUp)
                - Math.min(...toePositions.map(position => position.dot(restUp)))
            return {
                characterHeightMeters: headToToeHeight + legLengthMeters * 0.40,
                hipWidthMeters: segmentLength(motionPaths.upperLegL, motionPaths.upperLegR),
                legToArmRatio: legLengthMeters / Math.max(armLengthMeters, 1e-6),
                skirtRadialEnvelopeMeters: targetRigSkirtProxyBones.length > 0
                    ? Math.max(...targetRigSkirtProxyBones.map(horizontalRadiusFromHip)) + legLengthMeters * 0.10
                    : donorFeatureMedian('skirtRadialEnvelopeMeters'),
                sleeveCuffRadiusMeters: sleeveDistances.length > 0
                    ? Math.max(...sleeveDistances)
                    : donorFeatureMedian('sleeveCuffRadiusMeters'),
                hairLengthMeters: targetRigHairProxyBones.length > 0
                    ? Math.max(...targetRigHairProxyBones.map(target => (
                        targetRigRestPosition(target).distanceTo(headPosition)
                    ))) + legLengthMeters * 0.12
                    : donorFeatureMedian('hairLengthMeters'),
                restWristToSkirtDistanceMeters: wristToSkirtDistances.length > 0
                    ? Math.min(...wristToSkirtDistances)
                    : donorFeatureMedian('restWristToSkirtDistanceMeters'),
            }
        })()
        : undefined
    const targetRigMorphologyBlend = targetRigMorphologyFeatures
        ? deriveMorphologyNearestBlendWeights(targetRigMorphologyFeatures, motionReference)
        : undefined
    const effectiveBlendWeights = targetRigMorphologyBlend?.weights ?? motionReference.blendWeights
    const referenceDonors = motionReference.donors.filter(donor => (
        (effectiveBlendWeights[String(donor.characterId)] ?? 0) > 0
    ))
    const donorWeight = (donor: NormalizedHumanoidMotionDonor): number => (
        effectiveBlendWeights[String(donor.characterId)] ?? 0
    )
    const totalDonorWeight = referenceDonors.reduce((sum, donor) => sum + donorWeight(donor), 0)
    if (totalDonorWeight <= 0) {
        restorePreSamplePose()
        profile.status = 'incompatible'
        profile.reason = `normalized motion profile ${profileId} has no positive donor weights`
        return { profile }
    }
    const weightedReferenceValue = (
        valueFor: (donor: NormalizedHumanoidMotionDonor) => number,
    ): number => referenceDonors.reduce(
        (sum, donor) => sum + valueFor(donor) * donorWeight(donor),
        0,
    ) / totalDonorWeight
    const referenceLegLengthMeters = weightedReferenceValue(
        donor => donor.dimensions.legLengthMeters,
    )
    const referenceCycleSeconds = (semantic: NormalizedMotionSemantic): number => (
        weightedReferenceValue(donor => donor.clips[semantic].durationSeconds)
    )
    const walkDuration = referenceCycleSeconds('walk')
    const runDuration = referenceCycleSeconds('run')
    const wrapReferencePhase = (phase: number): number => ((phase % 1) + 1) % 1
    const sampleDonorVector = (
        donor: NormalizedHumanoidMotionDonor,
        semantic: NormalizedMotionSemantic,
        phase: number,
        valueFor: (frame: NormalizedHumanoidMotionFrame) => readonly number[],
    ): THREE.Vector3 => {
        const frames = donor.clips[semantic].frames
        const framePosition = wrapReferencePhase(phase) * frames.length
        const beforeIndex = Math.floor(framePosition) % frames.length
        const afterIndex = (beforeIndex + 1) % frames.length
        const mix = framePosition - Math.floor(framePosition)
        return new THREE.Vector3().fromArray(valueFor(frames[beforeIndex]))
            .lerp(new THREE.Vector3().fromArray(valueFor(frames[afterIndex])), mix)
    }
    const blendDonorVector = (
        semantic: NormalizedMotionSemantic,
        phase: number,
        valueFor: (frame: NormalizedHumanoidMotionFrame) => readonly number[],
        normalize = false,
    ): THREE.Vector3 => {
        const blended = new THREE.Vector3()
        for (const donor of referenceDonors) {
            blended.addScaledVector(
                sampleDonorVector(donor, semantic, phase, valueFor),
                donorWeight(donor) / totalDonorWeight,
            )
        }
        if (normalize && blended.lengthSq() > 1e-12) blended.normalize()
        return blended
    }
    const naturalUpperBodyProfileId: NaturalUpperBodyProfileId = profileId === '101901-dress-clearance-multidonor'
        ? '101901-dress-clearance-multidonor'
        : 'set-a'
    const morphologyUpperBodyWeights = targetRigMorphologyBlend
        ? normalizedDonorWeightSubset(targetRigMorphologyBlend.weights, naturalArmFingerDonorIds)
        : undefined
    const naturalUpperBodyWeights = naturalUpperBodyTrajectoryWeights[naturalUpperBodyProfileId]
    const effectiveNaturalUpperBodyWeights = morphologyUpperBodyWeights
        ? { walk: morphologyUpperBodyWeights, run: morphologyUpperBodyWeights }
        : naturalUpperBodyWeights
    const naturalHandFingerDonors = naturalArmFingerDonorIds.map(characterId => {
        const trajectory = normalizedHumanoidMotionReference.donors.find(donor => (
            donor.characterId === characterId
        ))
        const localRotations = nativeUpperBodyMotionReference.donors.find(donor => (
            donor.characterId === characterId && donor.status === 'attached'
        ))
        if (!trajectory || !localRotations?.clips) {
            throw new Error(`native upper-body donor ${characterId} is incomplete for ${profileId}`)
        }
        return { trajectory, localRotations }
    })
    const naturalUpperBodyTrajectoryDonors = Object.fromEntries(
        (['walk', 'run'] as const).map(semantic => {
            const donors = Object.entries(effectiveNaturalUpperBodyWeights[semantic]).map(
                ([characterId, weight]) => {
                    const trajectory = normalizedHumanoidMotionReference.donors.find(donor => (
                        donor.characterId === Number(characterId)
                    ))
                    if (!trajectory || weight <= 0) {
                        throw new Error(`upper-body trajectory donor ${characterId} is incomplete for ${semantic}`)
                    }
                    return { trajectory, weight }
                },
            )
            const totalWeight = donors.reduce((sum, donor) => sum + donor.weight, 0)
            return [semantic, { donors, totalWeight }]
        }),
    ) as Record<'walk' | 'run', {
        donors: Array<{ trajectory: NormalizedHumanoidMotionDonor; weight: number }>
        totalWeight: number
    }>
    const blendNaturalUpperBodyVector = (
        semantic: 'walk' | 'run',
        phase: number,
        valueFor: (frame: NormalizedHumanoidMotionFrame) => readonly number[],
        normalize = false,
    ): THREE.Vector3 => {
        const blended = new THREE.Vector3()
        const trajectoryProfile = naturalUpperBodyTrajectoryDonors[semantic]
        for (const donor of trajectoryProfile.donors) {
            blended.addScaledVector(
                sampleDonorVector(donor.trajectory, semantic, phase, valueFor),
                donor.weight / trajectoryProfile.totalWeight,
            )
        }
        if (normalize && blended.lengthSq() > 1e-12) blended.normalize()
        return blended
    }
    const officialNativeWalkArmDonorIds = [
        100201, 100202, 100401, 100501, 100801, 109201, 111501, 114501,
    ] as const
    const officialNativeWalkArmDonors = officialNativeWalkArmDonorIds.map(characterId => {
        const donor = normalizedHumanoidMotionReference.donors.find(candidate => (
            candidate.characterId === characterId
        ))
        if (!donor) {
            throw new Error(`official native walk arm donor ${characterId} is absent`)
        }
        return donor
    })
    const walkForearmTimelineOffsets = [-2, -1, 0, 1, 2] as const
    const walkForearmTimelineWeights = [1, 4, 6, 4, 1] as const
    const walkForearmTimelineWeightSum = walkForearmTimelineWeights.reduce(
        (sum, weight) => sum + weight,
        0,
    )
    const percentile = (values: readonly number[], ratio: number): number => {
        const ordered = [...values].sort((left, right) => left - right)
        const position = (ordered.length - 1) * THREE.MathUtils.clamp(ratio, 0, 1)
        const beforeIndex = Math.floor(position)
        const afterIndex = Math.min(beforeIndex + 1, ordered.length - 1)
        return THREE.MathUtils.lerp(
            ordered[beforeIndex],
            ordered[afterIndex],
            position - beforeIndex,
        )
    }
    const sampleFilteredDonorWalkElbowBend = (
        donor: NormalizedHumanoidMotionDonor,
        side: 'L' | 'R',
        phase: number,
    ): number => {
        const phaseStep = 1 / donor.clips.walk.frames.length
        let filteredBend = 0
        for (let index = 0; index < walkForearmTimelineOffsets.length; index += 1) {
            const samplePhase = phase + walkForearmTimelineOffsets[index] * phaseStep
            const upperDirection = sampleDonorVector(
                donor,
                'walk',
                samplePhase,
                frame => frame.directions[`upperArm${side}`],
            ).normalize()
            const forearmDirection = sampleDonorVector(
                donor,
                'walk',
                samplePhase,
                frame => frame.directions[`forearm${side}`],
            ).normalize()
            filteredBend += Math.acos(THREE.MathUtils.clamp(
                upperDirection.dot(forearmDirection),
                -1,
                1,
            )) * walkForearmTimelineWeights[index] / walkForearmTimelineWeightSum
        }
        return filteredBend
    }
    const walkForearmDonorStatistics = new Map<
        NormalizedHumanoidMotionDonor,
        Record<'L' | 'R', { filteredBends: number[]; strongBendThreshold: number }>
    >()
    for (const donor of officialNativeWalkArmDonors) {
        const statistics = Object.fromEntries((['L', 'R'] as const).map(side => {
            const samples = donor.clips.walk.frames.map((_, index) => (
                sampleFilteredDonorWalkElbowBend(
                    donor,
                    side,
                    index / donor.clips.walk.frames.length,
                )
            ))
            return [side, {
                filteredBends: samples,
                strongBendThreshold: percentile(samples, 0.75),
            }]
        })) as Record<'L' | 'R', { filteredBends: number[]; strongBendThreshold: number }>
        walkForearmDonorStatistics.set(donor, statistics)
    }
    const walkForearmFixedPrebendProfiles = Object.fromEntries((['L', 'R'] as const).map(side => {
        const pooledBendSamples = officialNativeWalkArmDonors.flatMap(donor => (
            walkForearmDonorStatistics.get(donor)![side].filteredBends
        ))
        // Native Dungeon walks carry an already-flexed elbow throughout the
        // shoulder swing. Use the shared strongly-bent region instead of the
        // temporal median: the latter left 101901 visually straight. Keeping
        // this value constant removes the rejected straighten/re-fold cycle.
        const fixedBendRadians = percentile(pooledBendSamples, 0.90)
        const fixedBendDirectionReference = new THREE.Vector3()
        let bendDirectionAnchor: THREE.Vector3 | undefined
        for (const donor of officialNativeWalkArmDonors) {
            const frames = donor.clips.walk.frames
            const statistics = walkForearmDonorStatistics.get(donor)![side]
            const strongFrameCount = statistics.filteredBends.filter(bend => (
                bend >= statistics.strongBendThreshold - 1e-9
            )).length
            for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
                if (statistics.filteredBends[frameIndex] < statistics.strongBendThreshold - 1e-9) {
                    continue
                }
                const phase = frameIndex / frames.length
                const upperDirection = sampleDonorVector(
                    donor,
                    'walk',
                    phase,
                    frame => frame.directions[`upperArm${side}`],
                ).normalize()
                const forearmDirection = sampleDonorVector(
                    donor,
                    'walk',
                    phase,
                    frame => frame.directions[`forearm${side}`],
                ).normalize()
                // Preserve the donor's actual elbow-facing half-plane, not a
                // world-space rotation axis.  Mapping an averaged axis into a
                // different rest rig can rotate around the wrong side of the
                // upper arm and make a measured 30 degree bend look almost
                // straight.  The perpendicular forearm component directly
                // describes where the already-flexed forearm points relative
                // to the authored upper-arm swing.
                const bendDirection = forearmDirection.clone().addScaledVector(
                    upperDirection,
                    -forearmDirection.dot(upperDirection),
                )
                if (bendDirection.lengthSq() <= 1e-10) continue
                bendDirection.normalize()
                bendDirectionAnchor ??= bendDirection.clone()
                if (bendDirection.dot(bendDirectionAnchor) < 0) bendDirection.negate()
                fixedBendDirectionReference.addScaledVector(
                    bendDirection,
                    1 / officialNativeWalkArmDonors.length / strongFrameCount,
                )
            }
        }
        return [side, {
            fixedBendRadians,
            fixedBendDirectionReference: fixedBendDirectionReference.normalize(),
        }]
    })) as Record<'L' | 'R', {
        fixedBendRadians: number
        fixedBendDirectionReference: THREE.Vector3
    }>
    if (Object.values(walkForearmFixedPrebendProfiles).some(profile => (
        profile.fixedBendRadians < THREE.MathUtils.degToRad(28)
        || profile.fixedBendRadians > THREE.MathUtils.degToRad(33)
        || profile.fixedBendDirectionReference.lengthSq() <= 1e-10
    ))) {
        restorePreSamplePose()
        profile.status = 'incompatible'
        profile.reason = `normalized motion profile ${profileId} has no fixed pre-bent walk-arm authority`
        return { profile }
    }
    const sampleNativeUpperBodyDelta = (
        donor: NativeUpperBodyMotionDonor,
        semantic: 'walk' | 'run',
        phase: number,
        rigPath: string,
    ): THREE.Quaternion | undefined => {
        const frames = donor.clips?.[semantic].frames
        if (!frames || frames.length === 0) return undefined
        const framePosition = wrapReferencePhase(phase) * frames.length
        const beforeIndex = Math.floor(framePosition) % frames.length
        const afterIndex = (beforeIndex + 1) % frames.length
        const mix = framePosition - Math.floor(framePosition)
        const before = frames[beforeIndex].localRotationDeltas[rigPath]
        const after = frames[afterIndex].localRotationDeltas[rigPath]
        if (!before || !after) return undefined
        return new THREE.Quaternion().fromArray(before)
            .slerp(new THREE.Quaternion().fromArray(after), mix)
            .normalize()
    }
    const blendNativeUpperBodyDelta = (
        semantic: 'walk' | 'run',
        phase: number,
        rigPath: string,
    ): THREE.Quaternion => {
        const accumulated = new THREE.Vector4()
        let hemisphere: THREE.Quaternion | undefined
        let accumulatedWeight = 0
        for (const donor of naturalHandFingerDonors) {
            const sampled = sampleNativeUpperBodyDelta(
                donor.localRotations,
                semantic,
                phase,
                rigPath,
            )
            if (!sampled) continue
            const donorWeight = effectiveNaturalUpperBodyWeights[semantic][String(
                donor.localRotations.characterId,
            )] ?? 0
            if (donorWeight <= 0) continue
            if (!hemisphere) hemisphere = sampled.clone()
            if (sampled.dot(hemisphere) < 0) sampled.set(-sampled.x, -sampled.y, -sampled.z, -sampled.w)
            accumulated.x += sampled.x * donorWeight
            accumulated.y += sampled.y * donorWeight
            accumulated.z += sampled.z * donorWeight
            accumulated.w += sampled.w * donorWeight
            accumulatedWeight += donorWeight
        }
        if (accumulatedWeight <= 0 || accumulated.lengthSq() < 1e-12) return new THREE.Quaternion()
        return new THREE.Quaternion(
            accumulated.x / accumulatedWeight,
            accumulated.y / accumulatedWeight,
            accumulated.z / accumulatedWeight,
            accumulated.w / accumulatedWeight,
        ).normalize()
    }
    const isNativeHandFingerRigPath = (rigPath: string): boolean => (
        /\/Hand_[LR]$/.test(rigPath)
        || /\/(?:Meta(?:Index|Middle|Pinky|Ring)finger|(?:Index|Middle|Pinky|Ring)finger\d+|Thumb\d+)_[LR]$/i.test(rigPath)
    )
    const nativeUpperBodyAuthorityPaths = [...new Set(naturalHandFingerDonors.flatMap(donor => (
        Object.keys(donor.localRotations.clips!.walk.frames[0]?.localRotationDeltas ?? {})
    )))]
    // HandFrill_* paths are character secondary/cloth chains, not fingers. Their
    // donor deltas remain excluded so the target character's official secondary
    // solver keeps sole ownership and does not receive a second conflicting pose.
    const nativeUpperBodySecondaryPaths = nativeUpperBodyAuthorityPaths.filter(
        rigPath => !isNativeHandFingerRigPath(rigPath),
    )
    const nativeUpperBodyAuthorityRigPaths = nativeUpperBodyAuthorityPaths.filter(
        isNativeHandFingerRigPath,
    )
    const missingNativeUpperBodyTargetRestPaths = nativeUpperBodyAuthorityRigPaths.filter(rigPath => {
        const target = rig.get(rigPath)
        return !target || !skeletonRestLocal.has(target)
    })
    if (missingNativeUpperBodyTargetRestPaths.length > 0) {
        restorePreSamplePose()
        profile.status = 'incompatible'
        profile.reason = `character ${characterId} inverse-bind upper-body rest paths are incomplete: ${missingNativeUpperBodyTargetRestPaths.join(', ')}`
        return { profile }
    }
    const nativeUpperBodyRigPaths = nativeUpperBodyAuthorityRigPaths
    const nativeUpperBodyHandPaths = nativeUpperBodyRigPaths.filter(
        rigPath => /\/Hand_[LR]$/.test(rigPath),
    )
    const nativeUpperBodyFingerPaths = nativeUpperBodyRigPaths.filter(
        rigPath => /\/(?:Meta(?:Index|Middle|Pinky|Ring)finger|(?:Index|Middle|Pinky|Ring)finger\d+|Thumb\d+)_[LR]$/i.test(rigPath),
    )
    const restoreNaturalUpperBodyTargetRest = (): void => {
        const roles: readonly MotionRole[] = [
            'shoulderL', 'upperArmL', 'forearmL', 'handL',
            'shoulderR', 'upperArmR', 'forearmR', 'handR',
        ]
        for (const role of roles) {
            const target = rig.get(motionPaths[role])!
            const targetRest = skeletonRestLocal.get(target)
            if (!targetRest) continue
            target.position.copy(targetRest.position)
            target.quaternion.copy(targetRest.quaternion)
            target.scale.copy(targetRest.scale)
        }
        character.object.updateMatrixWorld(true)
    }
    let nativeHandFingerPoseFrameCount = 0
    const applyNativeHandFingerPose = (
        semantic: 'walk' | 'run',
        leftPhase: number,
        rightPhase = leftPhase,
        strength = 1,
    ): void => {
        const blendStrength = THREE.MathUtils.clamp(strength, 0, 1)
        // The generated authority stores each official local rotation as a
        // delta from that donor's inverse-bind rest. Apply the blended delta to
        // 101901's own inverse-bind rest quaternion, never to HomeWait. Layering
        // locomotion over the asymmetric lookboard pose fixed one hand in front
        // and inverted the other palm throughout the cycle.
        const handStrength = blendStrength * (semantic === 'run' ? 0.82 : 0.72)
        for (const rigPath of nativeUpperBodyHandPaths) {
            const target = rig.get(rigPath)!
            const targetRest = skeletonRestLocal.get(target)!
            const phase = /_L(?:\/|$)/.test(rigPath) ? leftPhase : rightPhase
            const delta = blendNativeUpperBodyDelta(semantic, phase, rigPath)
            // `delta.slerpQuaternions(identity, delta, strength)` aliases its
            // output with the second input in Three.js and collapses to identity.
            // Interpolate on a separate quaternion so the eight authored wrist
            // trajectories actually reach the target rig.
            const weightedDelta = handStrength < 1
                ? new THREE.Quaternion().slerp(delta, handStrength)
                : delta
            target.position.copy(targetRest.position)
            target.quaternion.copy(targetRest.quaternion).multiply(weightedDelta).normalize()
            target.scale.copy(targetRest.scale)
        }
        // Finger descendants keep the eight-family authored poses and motion.
        for (const rigPath of nativeUpperBodyFingerPaths) {
            const target = rig.get(rigPath)!
            const targetRest = skeletonRestLocal.get(target)!
            const phase = /_L(?:\/|$)/.test(rigPath) ? leftPhase : rightPhase
            const delta = blendNativeUpperBodyDelta(semantic, phase, rigPath)
            const weightedDelta = blendStrength < 1
                ? new THREE.Quaternion().slerp(delta, blendStrength)
                : delta
            target.position.copy(targetRest.position)
            target.quaternion.copy(targetRest.quaternion).multiply(weightedDelta).normalize()
            target.scale.copy(targetRest.scale)
        }
        character.object.updateMatrixWorld(true)
        nativeHandFingerPoseFrameCount += 1
    }
    // The official clips are in-place while the TPS controller advances the
    // outer root. Set A keeps the previously accepted two-donor travel. Set B
    // consumes each donor's complete-cycle stance estimate, normalizes it by
    // that donor's leg length, and scales it to the 101901 rig.
    const targetToReferenceLegScale = legLengthMeters / referenceLegLengthMeters
    const weightedRootTravelFor = (semantic: 'walk' | 'run'): number => weightedReferenceValue(
        donor => {
            const measured = motionReference.gaitDiagnostics?.[String(donor.characterId)]
                ?.[semantic]?.rootTravelPerCycleMeters
            const fallback = OFFICIAL_DUNGEON_GAIT_REFERENCE[semantic].rootTravelPerCycleMeters
                * donor.dimensions.legLengthMeters / referenceLegLengthMeters
            return (measured ?? fallback) / donor.dimensions.legLengthMeters
        },
    ) * legLengthMeters
    const walkRootTravelPerCycleMeters = profileId === 'set-a'
        ? OFFICIAL_DUNGEON_GAIT_REFERENCE.walk.rootTravelPerCycleMeters * targetToReferenceLegScale
        : weightedRootTravelFor('walk')
    const runRootTravelPerCycleMeters = profileId === 'set-a'
        ? OFFICIAL_DUNGEON_GAIT_REFERENCE.run.rootTravelPerCycleMeters * targetToReferenceLegScale
        : weightedRootTravelFor('run')
    const originalFootPositions = {
        L: rig.get(motionPaths.footL)!.getWorldPosition(new THREE.Vector3()),
        R: rig.get(motionPaths.footR)!.getWorldPosition(new THREE.Vector3()),
    }
    const originalUpperLegPositions = {
        L: rig.get(motionPaths.upperLegL)!.getWorldPosition(new THREE.Vector3()),
        R: rig.get(motionPaths.upperLegR)!.getWorldPosition(new THREE.Vector3()),
    }
    const originalUpperArmPositions = {
        L: rig.get(motionPaths.upperArmL)!.getWorldPosition(new THREE.Vector3()),
        R: rig.get(motionPaths.upperArmR)!.getWorldPosition(new THREE.Vector3()),
    }
    // 101901's authored rest frame faces +X and uses +Z as its lateral axis.
    // Model-root XYZ therefore cannot be assumed to mean right/up/forward.
    // Derive the spatial IK frame from the target rig itself while preserving
    // the already accepted donor-vector mapping for the walk/run leg curves.
    const targetRigLeftAxis = originalUpperArmPositions.L.clone()
        .sub(originalUpperArmPositions.R)
        .addScaledVector(worldUp, -originalUpperArmPositions.L.clone()
            .sub(originalUpperArmPositions.R).dot(worldUp))
    if (targetRigLeftAxis.lengthSq() < 1e-8) {
        targetRigLeftAxis.copy(originalUpperLegPositions.L).sub(originalUpperLegPositions.R)
            .addScaledVector(worldUp, -originalUpperLegPositions.L.clone()
                .sub(originalUpperLegPositions.R).dot(worldUp))
    }
    targetRigLeftAxis.normalize()
    const targetRigForward = rig.get(motionPaths.toeL)!.getWorldPosition(new THREE.Vector3())
        .sub(originalFootPositions.L)
        .add(rig.get(motionPaths.toeR)!.getWorldPosition(new THREE.Vector3())
            .sub(originalFootPositions.R))
    targetRigForward.addScaledVector(worldUp, -targetRigForward.dot(worldUp))
    targetRigForward.addScaledVector(
        targetRigLeftAxis,
        -targetRigForward.dot(targetRigLeftAxis),
    )
    if (targetRigForward.lengthSq() < 1e-8) {
        targetRigForward.copy(worldUp).cross(targetRigLeftAxis)
    }
    targetRigForward.normalize()
    const targetRigOutwardFor = (side: 'L' | 'R'): THREE.Vector3 => (
        targetRigLeftAxis.clone().multiplyScalar(side === 'L' ? 1 : -1)
    )
    const originalFootHalfSeparation = Math.abs(
        originalFootPositions.L.clone().sub(originalFootPositions.R).dot(targetRigLeftAxis),
    ) / 2
    const outerSkirtCollisionBones = [...rig.entries()]
        .filter(([path]) => /\/OuterSkirt_/i.test(path) && !/_End(?:\/|$)/i.test(path))
        .map(([, target]) => target)
    const skirtCollisionBones = targetRigMorphologyProfile
        ? targetRigSkirtProxyBones
        : outerSkirtCollisionBones
    const dressClearanceProxyRadiusMeters = THREE.MathUtils.clamp(
        armLengthMeters * 0.10,
        0.038,
        0.055,
    )
    const dressClearanceCuffProxyRadiusMeters = THREE.MathUtils.clamp(
        dressClearanceProxyRadiusMeters * 0.58,
        0.022,
        0.032,
    )
    const dressClearanceFingerProxyRadiusMeters = THREE.MathUtils.clamp(
        dressClearanceProxyRadiusMeters * 0.30,
        0.011,
        0.016,
    )
    const dressClearanceWalkSafetyMarginMeters = THREE.MathUtils.clamp(
        armLengthMeters * 0.016,
        0.005,
        0.008,
    )
    const dressClearanceFingerBonesBySide = {
        L: nativeUpperBodyFingerPaths
            .filter(rigPath => /_L(?:\/|$)/.test(rigPath))
            .map(rigPath => rig.get(rigPath)!),
        R: nativeUpperBodyFingerPaths
            .filter(rigPath => /_R(?:\/|$)/.test(rigPath))
            .map(rigPath => rig.get(rigPath)!),
    }
    interface SetAWalkOuterSkirtSurface {
        mesh: THREE.SkinnedMesh
        meshPath: string
        triangleVertexIndices: Array<readonly [number, number, number]>
        weightedVertexCount: number
    }
    const outerSkirtCollisionBoneSet = new Set(outerSkirtCollisionBones)
    const isOfficialOutlineClone = (target: THREE.Object3D): boolean => {
        let current: THREE.Object3D | null = target
        while (current) {
            const geometryName = (current as THREE.Mesh).geometry?.name ?? ''
            if (
                current.name.includes(':official-outline:')
                || geometryName.includes(':official-outline-group')
            ) return true
            if (current === character.object) break
            current = current.parent
        }
        return false
    }
    const bufferAttributeComponent = (
        attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
        vertexIndex: number,
        componentIndex: number,
    ): number => {
        if (componentIndex === 0) return attribute.getX(vertexIndex)
        if (componentIndex === 1) return attribute.getY(vertexIndex)
        if (componentIndex === 2) return attribute.getZ(vertexIndex)
        return attribute.getW(vertexIndex)
    }
    const setAWalkOuterSkirtSurfaces: SetAWalkOuterSkirtSurface[] = []
    if (
        enableInteractiveSetAWalkDressClearance
        && profileId === 'set-a'
        && outerSkirtCollisionBoneSet.size > 0
    ) {
        character.object.traverse(target => {
            if (isOfficialOutlineClone(target)) return
            const mesh = target as THREE.SkinnedMesh
            if (!mesh.isSkinnedMesh || !mesh.skeleton) return
            const position = mesh.geometry.getAttribute('position')
            const skinIndex = mesh.geometry.getAttribute('skinIndex')
            const skinWeight = mesh.geometry.getAttribute('skinWeight')
            if (!position || !skinIndex || !skinWeight) return
            const outerSkirtSkeletonIndices = new Set<number>()
            mesh.skeleton.bones.forEach((bone, boneIndex) => {
                if (outerSkirtCollisionBoneSet.has(bone)) {
                    outerSkirtSkeletonIndices.add(boneIndex)
                }
            })
            if (outerSkirtSkeletonIndices.size === 0) return
            const outerSkirtWeightByVertex = new Float32Array(position.count)
            let weightedVertexCount = 0
            for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
                let outerSkirtWeight = 0
                for (let componentIndex = 0; componentIndex < 4; componentIndex += 1) {
                    const boneIndex = Math.round(bufferAttributeComponent(
                        skinIndex,
                        vertexIndex,
                        componentIndex,
                    ))
                    if (!outerSkirtSkeletonIndices.has(boneIndex)) continue
                    outerSkirtWeight += bufferAttributeComponent(
                        skinWeight,
                        vertexIndex,
                        componentIndex,
                    )
                }
                outerSkirtWeightByVertex[vertexIndex] = outerSkirtWeight
                if (outerSkirtWeight > 0.001) weightedVertexCount += 1
            }
            const geometryIndex = mesh.geometry.getIndex()
            const triangleCount = Math.floor((geometryIndex?.count ?? position.count) / 3)
            const triangleVertexIndices: Array<readonly [number, number, number]> = []
            for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
                const indices = [0, 1, 2].map(componentIndex => (
                    geometryIndex
                        ? Math.round(geometryIndex.getX(triangleIndex * 3 + componentIndex))
                        : triangleIndex * 3 + componentIndex
                )) as [number, number, number]
                const weights = indices.map(vertexIndex => outerSkirtWeightByVertex[vertexIndex])
                const stronglyWeightedVertices = weights.filter(weight => weight >= 0.20).length
                if (
                    stronglyWeightedVertices < 2
                    || Math.max(...weights) < 0.45
                    || weights[0] + weights[1] + weights[2] < 1.05
                ) continue
                triangleVertexIndices.push(indices)
            }
            if (triangleVertexIndices.length === 0) return
            setAWalkOuterSkirtSurfaces.push({
                mesh,
                meshPath: pathFromRoot(character.object, mesh),
                triangleVertexIndices,
                weightedVertexCount,
            })
        })
    }
    const dressClearanceWalkProxyPointCountPerSide = 3 + Math.max(
        dressClearanceFingerBonesBySide.L.length,
        dressClearanceFingerBonesBySide.R.length,
    )
    const dressClearanceVerticalBandMeters = THREE.MathUtils.clamp(
        armLengthMeters * 0.24,
        0.09,
        0.13,
    )
    const walkSpeedMetersPerSecond = walkRootTravelPerCycleMeters / walkDuration
    const runSpeedMetersPerSecond = runRootTravelPerCycleMeters / runDuration
    const baselineFootPositions = {
        L: rig.get(motionPaths.footL)!.getWorldPosition(new THREE.Vector3()),
        R: rig.get(motionPaths.footR)!.getWorldPosition(new THREE.Vector3()),
    }
    // Bind matrices describe the target rig, unlike the sampled HomeWait whose
    // toes may deliberately point inward. Convert the bind-space shoe axis into
    // the current scene frame; character placement must not change the gait.
    const baselineToeDirections = {
        L: targetRigRestPosition(rig.get(motionPaths.toeL)!)
            .sub(targetRigRestPosition(rig.get(motionPaths.footL)!))
            .transformDirection(character.object.matrixWorld),
        R: targetRigRestPosition(rig.get(motionPaths.toeR)!)
            .sub(targetRigRestPosition(rig.get(motionPaths.footR)!))
            .transformDirection(character.object.matrixWorld),
    }
    // A toe direction is only one axis. Keep the target's full bind foot frame
    // so shortest-swing alignment does not inherit roll from the posed hip and
    // knee chain and rotate the skinned sole sideways while the toe axis agrees.
    const baselineFootWorldRotations = {} as Record<'L' | 'R', THREE.Quaternion>
    for (const side of ['L', 'R'] as const) {
        const foot = rig.get(side === 'L' ? motionPaths.footL : motionPaths.footR)!
        const rest = skeletonRestWorld.get(foot)!
        const quaternion = new THREE.Quaternion()
        rest.decompose(new THREE.Vector3(), quaternion, new THREE.Vector3())
        baselineFootWorldRotations[side] = modelWorld.clone().multiply(quaternion).normalize()
    }
    // Keep the authored donor foot direction through swing, then blend back to
    // the target shoe's rest sole over a deliberately broad contact window.
    // The previous 0.025-0.11m window made the ankle appear to snap into its
    // tilted swing pose as soon as the toe left the floor.
    const normalizedToeContactStart = 0.015
    const normalizedToeContactEnd = 0.24
    let dressClearanceCorrectedFrameSides = 0
    let dressClearanceSampledFrameSides = 0
    let maximumDressClearanceCorrectionMeters = 0
    const dressClearanceCorrectedFrameSidesBySemantic = { walk: 0, run: 0 }
    const maximumDressClearanceCorrectionMetersBySemantic = { walk: 0, run: 0 }
    const dressClearancePostIkMaximumPasses = 5
    const dressClearanceTerminalPalmMaximumPasses = 4
    const dressClearanceConstraintProjectionSweeps = 4
    const dressClearancePostIkConvergenceGuardMeters = 0.0015
    let dressClearancePostIkRemeasurePasses = 0
    let maximumDressClearancePostIkResidualMeters = 0
    let dressClearanceSkinnedSurfaceInsideHits = 0
    let dressClearanceSkinnedSurfaceIntersectionHits = 0
    let minimumDressClearanceSignedSurfaceDistanceMeters = Number.POSITIVE_INFINITY
    let minimumDressClearanceFinalSurfaceMarginMeters = Number.POSITIVE_INFINITY
    let flatSoleCorrectedFrameSides = 0
    const footCenterForward = (
        baselineFootPositions.L.dot(targetRigForward)
        + baselineFootPositions.R.dot(targetRigForward)
    ) / 2
    for (const side of ['L', 'R'] as const) {
        baselineFootPositions[side].addScaledVector(
            targetRigForward,
            footCenterForward - baselineFootPositions[side].dot(targetRigForward),
        )
    }
    const applyWorldRotations = (
        bone: THREE.Object3D,
        rotations: readonly { axis: THREE.Vector3; angle: number }[],
    ): void => {
        const parentWorld = bone.parent?.getWorldQuaternion(new THREE.Quaternion())
            ?? new THREE.Quaternion()
        const currentWorld = bone.getWorldQuaternion(new THREE.Quaternion())
        const worldDelta = new THREE.Quaternion()
        for (const rotation of rotations) {
            if (Math.abs(rotation.angle) < 1e-9) continue
            worldDelta.multiply(new THREE.Quaternion().setFromAxisAngle(rotation.axis, rotation.angle))
        }
        const desiredWorld = worldDelta.multiply(currentWorld)
        bone.quaternion.copy(parentWorld.invert().multiply(desiredWorld)).normalize()
        character.object.updateMatrixWorld(true)
    }
    const alignSegmentDirection = (
        bone: THREE.Object3D,
        child: THREE.Object3D,
        desiredDirection: THREE.Vector3,
    ): void => {
        const currentDirection = child.getWorldPosition(new THREE.Vector3())
            .sub(bone.getWorldPosition(new THREE.Vector3()))
            .normalize()
        const normalizedDesiredDirection = desiredDirection.clone()
        if (normalizedDesiredDirection.lengthSq() < 1e-12) return
        normalizedDesiredDirection.normalize()
        const worldDelta = new THREE.Quaternion().setFromUnitVectors(
            currentDirection,
            normalizedDesiredDirection,
        )
        const parentWorld = bone.parent?.getWorldQuaternion(new THREE.Quaternion())
            ?? new THREE.Quaternion()
        const currentWorld = bone.getWorldQuaternion(new THREE.Quaternion())
        const desiredWorld = worldDelta.multiply(currentWorld)
        bone.quaternion.copy(parentWorld.invert().multiply(desiredWorld)).normalize()
        character.object.updateMatrixWorld(true)
    }
    const setObjectWorldQuaternion = (
        object: THREE.Object3D,
        desiredWorldQuaternion: THREE.Quaternion,
    ): void => {
        const parentWorld = object.parent?.getWorldQuaternion(new THREE.Quaternion())
            ?? new THREE.Quaternion()
        object.quaternion.copy(
            parentWorld.invert().multiply(desiredWorldQuaternion),
        ).normalize()
        character.object.updateMatrixWorld(true)
    }
    // Normalized Dungeon trajectories use +X for the left/right body axis and
    // +Z for the authored facing axis. 101901's model root instead faces +X and
    // uses +Z laterally, so mapping through character.object XYZ swaps the
    // official fore/aft and lateral motion. That was the source of the sideways
    // "swimming" arms and apparently reversed wrists. Retarget every donor
    // vector through axes measured from 101901's own rest rig.
    const referenceVectorToTargetWorld = (reference: THREE.Vector3): THREE.Vector3 => (
        targetRigLeftAxis.clone().multiplyScalar(reference.x)
            .addScaledVector(worldUp, reference.y)
            .addScaledVector(targetRigForward, reference.z)
    )
    const referenceSegments: readonly {
        directionRole: string
        boneRole: MotionRole
        childRole: MotionRole
    }[] = [
        { directionRole: 'spine', boneRole: 'spine', childRole: 'waist' },
        { directionRole: 'waist', boneRole: 'waist', childRole: 'chest' },
        { directionRole: 'chest', boneRole: 'chest', childRole: 'neck' },
        { directionRole: 'neck', boneRole: 'neck', childRole: 'head' },
        { directionRole: 'shoulderL', boneRole: 'shoulderL', childRole: 'upperArmL' },
        { directionRole: 'upperArmL', boneRole: 'upperArmL', childRole: 'forearmL' },
        { directionRole: 'forearmL', boneRole: 'forearmL', childRole: 'handL' },
        { directionRole: 'shoulderR', boneRole: 'shoulderR', childRole: 'upperArmR' },
        { directionRole: 'upperArmR', boneRole: 'upperArmR', childRole: 'forearmR' },
        { directionRole: 'forearmR', boneRole: 'forearmR', childRole: 'handR' },
        { directionRole: 'upperLegL', boneRole: 'upperLegL', childRole: 'lowerLegL' },
        { directionRole: 'lowerLegL', boneRole: 'lowerLegL', childRole: 'footL' },
        { directionRole: 'footL', boneRole: 'footL', childRole: 'toeL' },
        { directionRole: 'upperLegR', boneRole: 'upperLegR', childRole: 'lowerLegR' },
        { directionRole: 'lowerLegR', boneRole: 'lowerLegR', childRole: 'footR' },
        { directionRole: 'footR', boneRole: 'footR', childRole: 'toeR' },
    ]
    const applyNormalizedReferencePose = (
        phase: number,
        semantic: 'walk' | 'run',
    ): void => {
        restoreNaturalUpperBodyTargetRest()
        // A segment direction fixes swing, not axial twist. Starting the leg
        // chain from HomeWait retained its idle hip/knee/ankle twist in the
        // skinned shoes even after Foot->Toe looked corrected. Solve from this
        // target's inverse-bind rotations, as for the upper limbs; keep the
        // authored donor trajectories and the target's bone lengths unchanged.
        for (const role of [
            'upperLegL', 'lowerLegL', 'footL', 'toeL',
            'upperLegR', 'lowerLegR', 'footR', 'toeR',
        ] as const) {
            const bone = rig.get(motionPaths[role])!
            const rest = skeletonRestLocal.get(bone)
            if (rest) bone.quaternion.copy(rest.quaternion)
        }
        character.object.updateMatrixWorld(true)
        const hipRotation = blendDonorVector(
            semantic,
            phase,
            frame => frame.hip.rotationDeltaYXZ,
        )
        applyWorldRotations(rig.get(motionPaths.hip)!, [
            { axis: worldUp, angle: hipRotation.y },
            { axis: targetRigLeftAxis, angle: hipRotation.x },
            { axis: targetRigForward, angle: hipRotation.z },
        ])
        for (const segment of referenceSegments) {
            const naturalUpperBodyDirection = /^(?:shoulder|upperArm|forearm)[LR]$/.test(
                segment.directionRole,
            )
            const donorDirection = naturalUpperBodyDirection
                ? blendNaturalUpperBodyVector(
                    semantic === 'run' ? 'run' : 'walk',
                    phase,
                    frame => frame.directions[segment.directionRole],
                    true,
                )
                : blendDonorVector(
                    semantic,
                    phase,
                    frame => frame.directions[segment.directionRole],
                    true,
                )
            let desiredDirection = referenceVectorToTargetWorld(donorDirection)
            const bone = rig.get(motionPaths[segment.boneRole])!
            const child = rig.get(motionPaths[segment.childRole])!
            if (/^shoulder[LR]$/.test(segment.directionRole)) {
                // Keep 101901's clavicle/rest-shoulder axes dominant. Directly
                // replacing this short segment with a donor direction lifts both
                // elbows sideways and produces the visible "swimming" silhouette.
                const currentDirection = child.getWorldPosition(new THREE.Vector3())
                    .sub(bone.getWorldPosition(new THREE.Vector3()))
                    .normalize()
                desiredDirection = currentDirection.lerp(desiredDirection.normalize(), 0.32).normalize()
            } else if (semantic === 'walk' && /^forearm[LR]$/.test(segment.directionRole)) {
                // Native exploration walks swing an already-bent arm; they do
                // not straighten and re-fold the elbow every step. Preserve the
                // complete authored upper-arm swing, then carry one fixed
                // official eight-donor pre-bend around their strong-bend elbow
                // plane. The elbow angle has no gait-phase residual.
                const side = segment.directionRole.endsWith('L') ? 'L' : 'R'
                const upperArm = rig.get(side === 'L' ? motionPaths.upperArmL : motionPaths.upperArmR)!
                const currentTargetUpperDirection = bone.getWorldPosition(new THREE.Vector3())
                    .sub(upperArm.getWorldPosition(new THREE.Vector3()))
                    .normalize()
                const targetBendDirection = referenceVectorToTargetWorld(
                    walkForearmFixedPrebendProfiles[side].fixedBendDirectionReference,
                ).normalize()
                targetBendDirection.addScaledVector(
                    currentTargetUpperDirection,
                    -targetBendDirection.dot(currentTargetUpperDirection),
                )
                if (targetBendDirection.lengthSq() > 1e-10) {
                    targetBendDirection.normalize()
                    const fixedBendRadians = walkForearmFixedPrebendProfiles[side].fixedBendRadians
                    desiredDirection = currentTargetUpperDirection.clone()
                        .multiplyScalar(Math.cos(fixedBendRadians))
                        .addScaledVector(targetBendDirection, Math.sin(fixedBendRadians))
                        .normalize()
                }
            }
            alignSegmentDirection(bone, child, desiredDirection)
        }
        // Preserve the target shoe's own flat rest axis throughout stance.
        // The donor Foot->Toe direction remains authoritative during swing,
        // while a low toe height smoothly restores the 101901 sole plane. This
        // prevents a donor ankle axis from becoming permanent tiptoe contact.
        for (const side of ['L', 'R'] as const) {
            const toeRole = `toe${side}`
            const footRole = `foot${side}`
            const phaseStep = semantic === 'run' ? 1 / 49 : 1 / 87
            const blendedToe = new THREE.Vector3()
                .addScaledVector(blendDonorVector(
                    semantic,
                    wrapReferencePhase(phase - phaseStep),
                    frame => frame.joints[toeRole],
                ), 0.25)
                .addScaledVector(blendDonorVector(
                    semantic,
                    phase,
                    frame => frame.joints[toeRole],
                ), 0.5)
                .addScaledVector(blendDonorVector(
                    semantic,
                    wrapReferencePhase(phase + phaseStep),
                    frame => frame.joints[toeRole],
                ), 0.25)
            const groundHeight = weightedReferenceValue(donor => Math.min(
                ...donor.clips[semantic].frames.map(frame => frame.joints[toeRole][1]),
            ))
            const toeClearance = Math.max(0, blendedToe.y - groundHeight)
            const stanceWeight = 1 - THREE.MathUtils.smoothstep(
                toeClearance,
                normalizedToeContactStart,
                normalizedToeContactEnd,
            )
            const smoothedFootDirection = new THREE.Vector3()
                .addScaledVector(blendDonorVector(
                    semantic,
                    wrapReferencePhase(phase - phaseStep),
                    frame => frame.directions[footRole],
                    true,
                ), 0.25)
                .addScaledVector(blendDonorVector(
                    semantic,
                    phase,
                    frame => frame.directions[footRole],
                    true,
                ), 0.5)
                .addScaledVector(blendDonorVector(
                    semantic,
                    wrapReferencePhase(phase + phaseStep),
                    frame => frame.directions[footRole],
                    true,
                ), 0.25)
                .normalize()
            const donorFootDirection = referenceVectorToTargetWorld(smoothedFootDirection).normalize()
            const flatDirection = donorFootDirection
                .lerp(baselineToeDirections[side], stanceWeight * 0.94)
                .normalize()
            // Transport the target bind frame to the same authored direction;
            // do not append another swing to the chain's already-rolled frame.
            const footWorldRotation = new THREE.Quaternion().setFromUnitVectors(
                baselineToeDirections[side], flatDirection,
            ).multiply(baselineFootWorldRotations[side])
            setObjectWorldQuaternion(
                rig.get(side === 'L' ? motionPaths.footL : motionPaths.footR)!,
                footWorldRotation,
            )
            if (stanceWeight > 1e-4) flatSoleCorrectedFrameSides += 1
        }

        // Preserve the complete nine-family donor shoulder/elbow/wrist path.
        // IK is a collision correction only. The accepted run keeps the exact
        // wrist-only solve. Set A walk additionally checks the near-wrist cuff
        // and every authored finger joint because a clear wrist can still leave
        // the palm or fingertips inside the official OuterSkirt volume.
        // Set A walk is intentionally deferred until after the authored hand and
        // finger pose has been applied. Measuring it here used the rest fingers,
        // then the final donor pose could rotate them back through the skirt.
        if (semantic === 'walk' && profileId === 'set-a') return
        const hipPosition = rig.get(motionPaths.hip)!.getWorldPosition(new THREE.Vector3())
        for (const side of ['L', 'R'] as const) {
            const hand = rig.get(side === 'L' ? motionPaths.handL : motionPaths.handR)!
            const handPosition = hand.getWorldPosition(new THREE.Vector3())
            const radialDirection = handPosition.clone().sub(hipPosition)
                .addScaledVector(worldUp, -handPosition.clone().sub(hipPosition).dot(worldUp))
            if (radialDirection.lengthSq() < 1e-10) {
                radialDirection.copy(targetRigOutwardFor(side))
            } else {
                radialDirection.normalize()
            }
            const skirtEnvelopeRadiusAt = (probePosition: THREE.Vector3): number => {
                let envelopeRadius = Number.NEGATIVE_INFINITY
                for (const skirtBone of skirtCollisionBones) {
                    const skirtPosition = skirtBone.getWorldPosition(new THREE.Vector3())
                    if (
                        Math.abs(skirtPosition.clone().sub(probePosition).dot(worldUp))
                        > dressClearanceVerticalBandMeters
                    ) continue
                    const skirtOffset = skirtPosition.clone().sub(hipPosition)
                    const horizontalOffset = skirtOffset.clone()
                        .addScaledVector(worldUp, -skirtOffset.dot(worldUp))
                    const horizontalLength = horizontalOffset.length()
                    if (horizontalLength < 1e-5) continue
                    if (horizontalOffset.dot(radialDirection) / horizontalLength < 0.52) continue
                    envelopeRadius = Math.max(
                        envelopeRadius,
                        horizontalOffset.dot(radialDirection),
                    )
                }
                return envelopeRadius
            }
            const handRadialDistance = handPosition.clone().sub(hipPosition).dot(radialDirection)
            const skirtEnvelopeRadius = skirtEnvelopeRadiusAt(handPosition)
            const correctionLimitMeters = armLengthMeters * 0.14
            dressClearanceSampledFrameSides += 1
            const wristCorrection = Number.isFinite(skirtEnvelopeRadius)
                ? THREE.MathUtils.clamp(
                    skirtEnvelopeRadius + dressClearanceProxyRadiusMeters - handRadialDistance,
                    0,
                    correctionLimitMeters,
                )
                : 0
            // Set A walk returned above and is solved after its final authored
            // finger pose. Set B and the accepted run retain their existing
            // wrist-only trajectories byte-for-byte through wristCorrection.
            const correction = wristCorrection
            if (correction > 1e-4) {
                solveTwoBoneArm(
                    side,
                    handPosition.clone().addScaledVector(radialDirection, correction),
                    semantic === 'walk'
                        ? walkForearmFixedPrebendProfiles[side].fixedBendRadians
                        : 0,
                )
                dressClearanceCorrectedFrameSides += 1
                dressClearanceCorrectedFrameSidesBySemantic[semantic] += 1
                maximumDressClearanceCorrectionMeters = Math.max(
                    maximumDressClearanceCorrectionMeters,
                    correction,
                )
                maximumDressClearanceCorrectionMetersBySemantic[semantic] = Math.max(
                    maximumDressClearanceCorrectionMetersBySemantic[semantic],
                    correction,
                )
            }
        }
    }
    const normalizedReferenceHipOffset = (
        phase: number,
        semantic: NormalizedMotionSemantic,
    ): THREE.Vector3 => referenceVectorToTargetWorld(
        blendDonorVector(semantic, phase, frame => frame.hip.position),
    ).multiplyScalar(legLengthMeters)
    const worldDeltaToParentLocal = (
        target: THREE.Object3D,
        worldDelta: THREE.Vector3,
    ): THREE.Vector3 => {
        if (!target.parent) return worldDelta.clone()
        const inverseParentLinear = new THREE.Matrix3()
            .setFromMatrix4(target.parent.matrixWorld)
            .invert()
        return worldDelta.clone().applyMatrix3(inverseParentLinear)
    }
    const restoreTargetRigRestHandPose = (side: 'L' | 'R'): void => {
        const hand = rig.get(side === 'L' ? motionPaths.handL : motionPaths.handR)!
        hand.traverse(target => {
            if (target !== hand && !/(?:Meta|finger|Thumb)/i.test(target.name)) return
            const targetRest = skeletonRestLocal.get(target)
            if (!targetRest) return
            target.position.copy(targetRest.position)
            target.quaternion.copy(targetRest.quaternion)
            target.scale.copy(targetRest.scale)
        })
        character.object.updateMatrixWorld(true)
    }
    const solveTwoBoneLeg = (
        side: 'L' | 'R',
        target: THREE.Vector3,
        footDirection: THREE.Vector3,
    ): void => {
        const left = side === 'L'
        const upperLeg = rig.get(left ? motionPaths.upperLegL : motionPaths.upperLegR)!
        const lowerLeg = rig.get(left ? motionPaths.lowerLegL : motionPaths.lowerLegR)!
        const foot = rig.get(left ? motionPaths.footL : motionPaths.footR)!
        const toe = rig.get(left ? motionPaths.toeL : motionPaths.toeR)!
        const hip = upperLeg.getWorldPosition(new THREE.Vector3())
        const toTarget = target.clone().sub(hip)
        const distance = THREE.MathUtils.clamp(
            toTarget.length(),
            Math.abs(upperLegLengthMeters - lowerLegLengthMeters) + 1e-5,
            upperLegLengthMeters + lowerLegLengthMeters - 1e-5,
        )
        const direction = toTarget.normalize()
        const along = (
            upperLegLengthMeters ** 2
            - lowerLegLengthMeters ** 2
            + distance ** 2
        ) / (2 * distance)
        const bendHeight = Math.sqrt(Math.max(0, upperLegLengthMeters ** 2 - along ** 2))
        const bend = targetRigForward.clone()
            .addScaledVector(targetRigOutwardFor(side), 0.08)
        bend.addScaledVector(direction, -bend.dot(direction))
        if (bend.lengthSq() < 1e-8) {
            bend.copy(worldUp).addScaledVector(direction, -worldUp.dot(direction))
        }
        bend.normalize()
        const knee = hip.clone()
            .addScaledVector(direction, along)
            .addScaledVector(bend, bendHeight)
        const reachableTarget = hip.clone().addScaledVector(direction, distance)
        alignSegmentDirection(upperLeg, lowerLeg, knee.sub(hip))
        alignSegmentDirection(
            lowerLeg,
            foot,
            reachableTarget.clone().sub(lowerLeg.getWorldPosition(new THREE.Vector3())),
        )
        alignSegmentDirection(foot, toe, footDirection)
    }
    const applyLowerBodyGaitDirectionPose = (
        semantic: 'walk' | 'run',
        phase: number,
    ): void => {
        for (const segment of referenceSegments) {
            if (!/^(?:upperLeg|lowerLeg|foot)[LR]$/.test(segment.directionRole)) continue
            alignSegmentDirection(
                rig.get(motionPaths[segment.boneRole])!,
                rig.get(motionPaths[segment.childRole])!,
                referenceVectorToTargetWorld(blendDonorVector(
                    semantic,
                    phase,
                    frame => frame.directions[segment.directionRole],
                    true,
                )),
            )
        }
    }
    const jumpLaunchGaitPhase: Record<Exclude<JumpLocomotionMode, 'standing'>, number> = {
        walking: 0.12,
        running: 0.06,
    }
    const applyJumpLegPose = (
        ratio: number,
        phase: 'takeoff' | 'airborne' | 'land',
        mode: JumpLocomotionMode,
    ): void => {
        // The controller owns all root translation.  Walking/running jumps begin
        // from a real accepted gait phase, retain a lead/trail leg split in air,
        // and recover to two separated flat soles. Standing jump keeps a smaller
        // lead/trail split than moving jumps, but is deliberately not mirrored:
        // perfect symmetry was the source of the V21 feet-together silhouette.
        const takeoffTuck = phase === 'takeoff'
            ? smooth01((ratio - 0.46) / 0.38)
            : 0
        const airborneRecovery = phase === 'airborne'
            ? 1 - 0.75 * smooth01((ratio - 0.18) / 0.70)
            : 0
        const tuckWeight = phase === 'takeoff'
            ? takeoffTuck
            : phase === 'airborne'
                ? airborneRecovery
                : 0
        const airborneArc = phase === 'airborne' ? Math.sin(ratio * Math.PI) : 0
        const stanceBlend = phase === 'land'
            ? 1 - smooth01((ratio - 0.18) / 0.72)
            : tuckWeight
        const movingMode = mode === 'standing' ? undefined : mode
        const locomotionSemantic = movingMode === 'running'
            ? 'run'
            : movingMode === 'walking'
                ? 'walk'
                : undefined
        if (locomotionSemantic && movingMode) {
            const launchPhase = jumpLaunchGaitPhase[movingMode]
            const phaseAdvance = phase === 'takeoff'
                ? ratio * 0.06
                : phase === 'airborne'
                    ? 0.06 + ratio * 0.12
                    : 0.18 + ratio * 0.04
            applyLowerBodyGaitDirectionPose(
                locomotionSemantic,
                wrapReferencePhase(launchPhase + phaseAdvance),
            )
        }
        const sampledFootPositions = {
            L: rig.get(motionPaths.footL)!.getWorldPosition(new THREE.Vector3()),
            R: rig.get(motionPaths.footR)!.getWorldPosition(new THREE.Vector3()),
        }
        const sampledToeDirections = {
            L: rig.get(motionPaths.toeL)!.getWorldPosition(new THREE.Vector3())
                .sub(sampledFootPositions.L).normalize(),
            R: rig.get(motionPaths.toeR)!.getWorldPosition(new THREE.Vector3())
                .sub(sampledFootPositions.R).normalize(),
        }
        const gaitBlend = locomotionSemantic
            ? (phase === 'land' ? 1 - smooth01((ratio - 0.05) / 0.78) : 1)
            : 0
        const targets = {
            L: baselineFootPositions.L.clone().lerp(sampledFootPositions.L, gaitBlend),
            R: baselineFootPositions.R.clone().lerp(sampledFootPositions.R, gaitBlend),
        }
        const targetCenter = targets.L.clone().add(targets.R).multiplyScalar(0.5)
        const movingLeftLeadSign = Math.sign(
            sampledFootPositions.L.clone().sub(sampledFootPositions.R).dot(targetRigForward),
        ) || 1
        const separationWeight = phase === 'land'
            ? 0.62 + 0.38 * (1 - smooth01((ratio - 0.08) / 0.82))
            : Math.max(0.72, stanceBlend)
        const additionalHalfWidth = mode === 'running'
            ? legLengthMeters * 0.145
            : mode === 'walking'
                ? legLengthMeters * 0.125
                : legLengthMeters * 0.115
        const minimumHalfSeparation = originalFootHalfSeparation
            + additionalHalfWidth * separationWeight
        const splitWeight = phase === 'takeoff'
            ? smooth01((ratio - 0.12) / 0.58)
            : phase === 'airborne'
                ? 1 - 0.18 * smooth01((ratio - 0.62) / 0.38)
                : 0.82 * (1 - smooth01((ratio - 0.05) / 0.78))
        const minimumForwardHalfSplit = mode === 'running'
            ? legLengthMeters * 0.19 * splitWeight
            : mode === 'walking'
                ? legLengthMeters * 0.11 * splitWeight
                : legLengthMeters * 0.055 * splitWeight
        for (const side of ['L', 'R'] as const) {
            const outward = targetRigOutwardFor(side)
            const signedLateral = targets[side].clone().sub(targetCenter).dot(outward)
            if (signedLateral < minimumHalfSeparation) {
                targets[side].addScaledVector(
                    outward,
                    minimumHalfSeparation - signedLateral,
                )
            }
            if (minimumForwardHalfSplit > 0) {
                const leadSign = (
                    movingMode ? movingLeftLeadSign : 1
                ) * (side === 'L' ? 1 : -1)
                const signedForward = targets[side].clone().sub(targetCenter).dot(targetRigForward) * leadSign
                if (signedForward < minimumForwardHalfSplit) {
                    targets[side].addScaledVector(
                        targetRigForward,
                        leadSign * (minimumForwardHalfSplit - signedForward),
                    )
                }
            }
            const lift = legLengthMeters * (
                tuckWeight * (0.22 + airborneArc * 0.09)
                * (mode === 'running' && side === 'R' ? 1.08 : 1)
            )
            const target = targets[side]
                .addScaledVector(
                    targetRigForward,
                    mode === 'standing'
                        ? legLengthMeters * tuckWeight * (-0.10 - 0.04 * airborneArc)
                        : 0,
                )
                .addScaledVector(worldUp, lift)
            const pitch = THREE.MathUtils.degToRad(
                (-3 * tuckWeight) - (airborneArc * 3),
            )
            const direction = baselineToeDirections[side].clone()
                .lerp(sampledToeDirections[side], gaitBlend * 0.7)
                .applyAxisAngle(targetRigLeftAxis, pitch)
                .normalize()
            solveTwoBoneLeg(side, target, direction)
        }
    }
    const makeFrameTimes = (duration: number): number[] => {
        const frameCount = Math.max(1, Math.ceil(duration * 60 - 1e-9))
        const times = Array.from(
            { length: frameCount + 1 },
            (_, index) => Math.min(duration, index / 60),
        )
        times[times.length - 1] = duration
        return times
    }
    interface ArmPoseSample {
        leftSwingRadians: number
        rightSwingRadians: number
        handHalfSeparationMeters: number
        handHeightAboveHipMeters: number
        forwardSwingScaleMeters: number
        forwardBiasMeters: number
        diagnosticMode: 'idle' | 'walk' | 'run' | 'jump'
    }
    const solveTwoBoneArm = (
        side: 'L' | 'R',
        target: THREE.Vector3,
        minimumElbowFlexionRadians = 0,
        elbowPoleWorldHint?: THREE.Vector3,
    ): void => {
        const left = side === 'L'
        const upperArm = rig.get(left ? motionPaths.upperArmL : motionPaths.upperArmR)!
        const forearm = rig.get(left ? motionPaths.forearmL : motionPaths.forearmR)!
        const hand = rig.get(left ? motionPaths.handL : motionPaths.handR)!
        const upperLength = armSegmentLengths[side].upper
        const lowerLength = armSegmentLengths[side].lower
        const shoulder = upperArm.getWorldPosition(new THREE.Vector3())
        const authoredElbow = forearm.getWorldPosition(new THREE.Vector3())
        const toTarget = target.clone().sub(shoulder)
        const rawDistance = Math.max(toTarget.length(), 1e-6)
        const maximumReach = Math.sqrt(Math.max(
            1e-10,
            upperLength ** 2
            + lowerLength ** 2
            + 2 * upperLength * lowerLength * Math.cos(minimumElbowFlexionRadians),
        ))
        const distance = THREE.MathUtils.clamp(
            rawDistance,
            Math.abs(upperLength - lowerLength) + 1e-5,
            Math.min(upperLength + lowerLength - 1e-5, maximumReach),
        )
        const direction = toTarget.multiplyScalar(1 / rawDistance)
        const along = (
            upperLength ** 2
            - lowerLength ** 2
            + distance ** 2
        ) / (2 * distance)
        const bendHeight = Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2))
        // Preserve the donor's current elbow plane while moving the wrist only
        // far enough to clear the dress. A fixed world-space pole can cross the
        // arm through the shoulder plane and is the source of the reversed arm.
        const authoredShoulderToElbow = authoredElbow.clone().sub(shoulder)
        const authoredElbowPole = authoredShoulderToElbow.clone()
            .addScaledVector(direction, -authoredShoulderToElbow.dot(direction))
        const elbowPole = elbowPoleWorldHint?.clone()
            .addScaledVector(direction, -elbowPoleWorldHint.dot(direction))
            ?? authoredElbowPole.clone()
        if (
            elbowPoleWorldHint
            && elbowPole.lengthSq() >= 1e-8
            && authoredElbowPole.lengthSq() >= 1e-8
            && elbowPole.dot(authoredElbowPole) < 0
        ) {
            // A clearance candidate may move the elbow plane, but it must stay in
            // the authored hemisphere. Crossing that plane produces the reversed
            // elbow/forearm pose rejected in the earlier locomotion versions.
            elbowPole.negate()
        }
        if (elbowPole.lengthSq() < 1e-8) {
            elbowPole.copy(authoredElbowPole)
        }
        if (elbowPole.lengthSq() < 1e-8) {
            elbowPole.copy(targetRigOutwardFor(side))
                .addScaledVector(direction, -targetRigOutwardFor(side).dot(direction))
        }
        if (elbowPole.lengthSq() < 1e-8) {
            elbowPole.copy(worldUp).addScaledVector(direction, -worldUp.dot(direction))
        }
        elbowPole.normalize()
        const elbow = shoulder.clone()
            .addScaledVector(direction, along)
            .addScaledVector(elbowPole, bendHeight)
        const reachableTarget = shoulder.clone().addScaledVector(direction, distance)
        alignSegmentDirection(upperArm, forearm, elbow.clone().sub(shoulder))
        alignSegmentDirection(
            forearm,
            hand,
            reachableTarget.clone().sub(forearm.getWorldPosition(new THREE.Vector3())),
        )
    }
    interface SetAWalkDressClearanceProbe {
        side: 'L' | 'R'
        label: string
        position: THREE.Vector3
        radiusMeters: number
    }
    interface SetAWalkDressClearanceConstraint {
        probe: SetAWalkDressClearanceProbe
        surfaceNormal: THREE.Vector3
        signedDistanceMeters: number
        requiredDistanceMeters: number
        penetrationMeters: number
    }
    interface SetAWalkArmPoseSnapshot {
        upperArmQuaternion: THREE.Quaternion
        forearmQuaternion: THREE.Quaternion
        handQuaternion: THREE.Quaternion
    }
    interface SetAWalkConstraintObjective {
        penetrationCount: number
        maximumPenetrationMeters: number
        totalPenetrationMeters: number
    }
    interface SetAWalkSampledOuterSkirtTriangle {
        triangle: THREE.Triangle
        outwardNormal: THREE.Vector3
        bounds: THREE.Box3
        centroidRadialDirection: THREE.Vector3
        centroidHeightMeters: number
        minimumHeightMeters: number
        maximumHeightMeters: number
    }
    interface SetAWalkOuterSkirtSurfaceAcceleration {
        surface: SetAWalkOuterSkirtSurface
        position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute
        referencedVertexIndices: number[]
        worldVertexByIndex: Map<number, THREE.Vector3>
        triangles: SetAWalkSampledOuterSkirtTriangle[]
    }
    // The real skirt topology is immutable for the lifetime of this character binding.
    // Build it once, then refit the same world-space vertices/triangles after each Mixer
    // pose. This keeps V50 on the exact SkinnedMesh while avoiding per-frame topology
    // allocation and the former 4699-triangle scan for every probe/candidate.
    const setAWalkOuterSkirtAccelerations: SetAWalkOuterSkirtSurfaceAcceleration[] = (
        setAWalkOuterSkirtSurfaces.map(surface => {
            const position = surface.mesh.geometry.getAttribute('position')!
            const referencedVertexIndices = [...new Set(
                surface.triangleVertexIndices.flatMap(indices => [...indices]),
            )]
            const worldVertexByIndex = new Map(
                referencedVertexIndices.map(vertexIndex => [vertexIndex, new THREE.Vector3()]),
            )
            const triangles = surface.triangleVertexIndices.map(([aIndex, bIndex, cIndex]) => ({
                triangle: new THREE.Triangle(
                    worldVertexByIndex.get(aIndex)!,
                    worldVertexByIndex.get(bIndex)!,
                    worldVertexByIndex.get(cIndex)!,
                ),
                outwardNormal: new THREE.Vector3(),
                bounds: new THREE.Box3(),
                centroidRadialDirection: new THREE.Vector3(),
                centroidHeightMeters: 0,
                minimumHeightMeters: 0,
                maximumHeightMeters: 0,
            }))
            return { surface, position, referencedVertexIndices, worldVertexByIndex, triangles }
        })
    )
    const sampledOuterSkirtTriangles = setAWalkOuterSkirtAccelerations.flatMap(
        acceleration => acceleration.triangles,
    )
    const setAWalkOuterSkirtVerticalBinSizeMeters = Math.max(
        dressClearanceVerticalBandMeters * 0.5,
        0.005,
    )
    const setAWalkOuterSkirtRayBins = new Map<number, SetAWalkSampledOuterSkirtTriangle[]>()
    const setAWalkOuterSkirtCentroidBins = new Map<number, SetAWalkSampledOuterSkirtTriangle[]>()
    const setAWalkAccelerationCentroid = new THREE.Vector3()
    const setAWalkOuterSkirtBinIndex = (heightMeters: number): number => Math.floor(
        heightMeters / setAWalkOuterSkirtVerticalBinSizeMeters,
    )
    const clearSetAWalkOuterSkirtBins = (): void => {
        for (const bin of setAWalkOuterSkirtRayBins.values()) bin.length = 0
        for (const bin of setAWalkOuterSkirtCentroidBins.values()) bin.length = 0
    }
    const appendSetAWalkOuterSkirtBin = (
        bins: Map<number, SetAWalkSampledOuterSkirtTriangle[]>,
        binIndex: number,
        triangle: SetAWalkSampledOuterSkirtTriangle,
    ): void => {
        let bin = bins.get(binIndex)
        if (!bin) {
            bin = []
            bins.set(binIndex, bin)
        }
        bin.push(triangle)
    }
    const invalidateSetAWalkOuterSkirtAcceleration = (): void => {
        clearSetAWalkOuterSkirtBins()
    }
    const refitSetAWalkOuterSkirtAcceleration = (hipPosition: THREE.Vector3): void => {
        character.object.updateMatrixWorld(true)
        clearSetAWalkOuterSkirtBins()
        for (const acceleration of setAWalkOuterSkirtAccelerations) {
            const { surface, position, referencedVertexIndices, worldVertexByIndex } = acceleration
            surface.mesh.skeleton.update()
            surface.mesh.updateMatrixWorld(true)
            for (const vertexIndex of referencedVertexIndices) {
                const worldVertex = worldVertexByIndex.get(vertexIndex)!
                worldVertex.set(
                    position.getX(vertexIndex),
                    position.getY(vertexIndex),
                    position.getZ(vertexIndex),
                )
                surface.mesh.applyBoneTransform(vertexIndex, worldVertex)
                worldVertex.applyMatrix4(surface.mesh.matrixWorld)
            }
            for (const sampledTriangle of acceleration.triangles) {
                const { triangle, outwardNormal } = sampledTriangle
                triangle.getNormal(outwardNormal)
                if (outwardNormal.lengthSq() < 1e-10) continue
                triangle.getMidpoint(setAWalkAccelerationCentroid)
                const centroidOffsetX = setAWalkAccelerationCentroid.x - hipPosition.x
                const centroidOffsetY = setAWalkAccelerationCentroid.y - hipPosition.y
                const centroidOffsetZ = setAWalkAccelerationCentroid.z - hipPosition.z
                const centroidHeightMeters = (
                    centroidOffsetX * worldUp.x
                    + centroidOffsetY * worldUp.y
                    + centroidOffsetZ * worldUp.z
                )
                const centroidRadial = sampledTriangle.centroidRadialDirection.copy(
                    setAWalkAccelerationCentroid,
                ).sub(hipPosition).addScaledVector(worldUp, -centroidHeightMeters)
                if (centroidRadial.lengthSq() > 1e-10 && outwardNormal.dot(centroidRadial) < 0) {
                    outwardNormal.negate()
                }
                if (centroidRadial.lengthSq() > 1e-10) centroidRadial.normalize()
                const projectHeight = (point: THREE.Vector3): number => (
                    (point.x - hipPosition.x) * worldUp.x
                    + (point.y - hipPosition.y) * worldUp.y
                    + (point.z - hipPosition.z) * worldUp.z
                )
                const heightA = projectHeight(triangle.a)
                const heightB = projectHeight(triangle.b)
                const heightC = projectHeight(triangle.c)
                sampledTriangle.centroidHeightMeters = centroidHeightMeters
                sampledTriangle.minimumHeightMeters = Math.min(heightA, heightB, heightC)
                sampledTriangle.maximumHeightMeters = Math.max(heightA, heightB, heightC)
                sampledTriangle.bounds.setFromPoints([triangle.a, triangle.b, triangle.c])
                const firstRayBin = setAWalkOuterSkirtBinIndex(
                    sampledTriangle.minimumHeightMeters - 1e-7,
                )
                const lastRayBin = setAWalkOuterSkirtBinIndex(
                    sampledTriangle.maximumHeightMeters + 1e-7,
                )
                for (let binIndex = firstRayBin; binIndex <= lastRayBin; binIndex += 1) {
                    appendSetAWalkOuterSkirtBin(
                        setAWalkOuterSkirtRayBins,
                        binIndex,
                        sampledTriangle,
                    )
                }
                appendSetAWalkOuterSkirtBin(
                    setAWalkOuterSkirtCentroidBins,
                    setAWalkOuterSkirtBinIndex(centroidHeightMeters),
                    sampledTriangle,
                )
            }
        }
    }
    const setAWalkOuterSkirtFallbackCandidates = (
        probeHeightMeters: number,
    ): SetAWalkSampledOuterSkirtTriangle[] => {
        const candidates: SetAWalkSampledOuterSkirtTriangle[] = []
        const firstBin = setAWalkOuterSkirtBinIndex(
            probeHeightMeters - dressClearanceVerticalBandMeters,
        )
        const lastBin = setAWalkOuterSkirtBinIndex(
            probeHeightMeters + dressClearanceVerticalBandMeters,
        )
        for (let binIndex = firstBin; binIndex <= lastBin; binIndex += 1) {
            const bin = setAWalkOuterSkirtCentroidBins.get(binIndex)
            if (bin) candidates.push(...bin)
        }
        return candidates
    }
    const applySetAWalkDressClearance = (
        frameIndex = 0,
        phase: number | null = null,
        clipName: string | null = null,
    ): SetAWalkDressClearanceFrameRecord => {
        const hipPosition = rig.get(motionPaths.hip)!.getWorldPosition(new THREE.Vector3())
        const baselineCorrectionLimitMeters = armLengthMeters * 0.14
        refitSetAWalkOuterSkirtAcceleration(hipPosition)
        const collectProbes = (side: 'L' | 'R'): SetAWalkDressClearanceProbe[] => {
            const forearm = rig.get(side === 'L' ? motionPaths.forearmL : motionPaths.forearmR)!
            const hand = rig.get(side === 'L' ? motionPaths.handL : motionPaths.handR)!
            const forearmPosition = forearm.getWorldPosition(new THREE.Vector3())
            const handPosition = hand.getWorldPosition(new THREE.Vector3())
            return [
                {
                    side,
                    label: 'forearm-cuff-64',
                    position: forearmPosition.clone().lerp(handPosition, 0.64),
                    radiusMeters: dressClearanceCuffProxyRadiusMeters,
                },
                {
                    side,
                    label: 'wrist-cuff-82',
                    position: forearmPosition.clone().lerp(handPosition, 0.82),
                    radiusMeters: dressClearanceCuffProxyRadiusMeters,
                },
                {
                    side,
                    label: 'palm',
                    position: handPosition,
                    radiusMeters: dressClearanceProxyRadiusMeters,
                },
                ...dressClearanceFingerBonesBySide[side].map(fingerBone => ({
                    side,
                    label: `finger:${pathFromRoot(rigRoot, fingerBone)}`,
                    position: fingerBone.getWorldPosition(new THREE.Vector3()),
                    radiusMeters: dressClearanceFingerProxyRadiusMeters,
                })),
            ]
        }
        const collectConstraints = (
            side: 'L' | 'R',
            recordInitialHits: boolean,
        ): SetAWalkDressClearanceConstraint[] => collectProbes(side).flatMap(probe => {
            const probeOffset = probe.position.clone().sub(hipPosition)
            const probeHeightMeters = probeOffset.dot(worldUp)
            const probeRadialDirection = probeOffset.clone()
                .addScaledVector(worldUp, -probeHeightMeters)
            if (probeRadialDirection.lengthSq() < 1e-10) {
                probeRadialDirection.copy(targetRigOutwardFor(side))
            } else {
                probeRadialDirection.normalize()
            }
            const radialRayOrigin = hipPosition.clone().addScaledVector(
                worldUp,
                probeHeightMeters,
            )
            const radialRay = new THREE.Ray(radialRayOrigin, probeRadialDirection)
            let supportTriangle: SetAWalkSampledOuterSkirtTriangle | undefined
            let supportPoint: THREE.Vector3 | undefined
            let supportRadiusMeters = Number.NEGATIVE_INFINITY
            // A folded, layered skirt can put an unrelated inner fold closer to a
            // fingertip than the visible outer sheet. The old unrestricted nearest
            // triangle query therefore gave adjacent finger joints opposite inside
            // signs. Intersect the actual deformed triangles along the probe's hip
            // radial half-ray and retain the farthest hit: this is the real outermost
            // skinned sheet in that direction, not a generated cylindrical proxy.
            const radialCandidates = setAWalkOuterSkirtRayBins.get(
                setAWalkOuterSkirtBinIndex(probeHeightMeters),
            ) ?? []
            for (const sampledTriangle of radialCandidates) {
                const candidatePoint = radialRay.intersectTriangle(
                    sampledTriangle.triangle.a,
                    sampledTriangle.triangle.b,
                    sampledTriangle.triangle.c,
                    false,
                    new THREE.Vector3(),
                )
                if (!candidatePoint) continue
                const candidateRadiusMeters = candidatePoint.clone()
                    .sub(radialRayOrigin)
                    .dot(probeRadialDirection)
                if (candidateRadiusMeters < 0 || candidateRadiusMeters <= supportRadiusMeters) continue
                supportRadiusMeters = candidateRadiusMeters
                supportTriangle = sampledTriangle
                supportPoint = candidatePoint
            }
            if (!supportTriangle || !supportPoint) {
                // Open hems can leave the exact horizontal ray between triangles.
                // Fall back only to actual triangles in the same outward sector and
                // vertical band, selecting the largest radial support. This retains
                // the real skinned surface while excluding closer inner/opposite folds.
                for (const sampledTriangle of setAWalkOuterSkirtFallbackCandidates(
                    probeHeightMeters,
                )) {
                    if (
                        sampledTriangle.centroidRadialDirection.lengthSq() > 1e-10
                        && sampledTriangle.centroidRadialDirection.dot(probeRadialDirection) < 0.72
                    ) continue
                    if (
                        Math.abs(sampledTriangle.centroidHeightMeters - probeHeightMeters)
                        > dressClearanceVerticalBandMeters
                    ) continue
                    const candidatePoint = sampledTriangle.triangle.closestPointToPoint(
                        probe.position,
                        new THREE.Vector3(),
                    )
                    const candidateRadiusMeters = candidatePoint.clone()
                        .sub(radialRayOrigin)
                        .dot(probeRadialDirection)
                    if (candidateRadiusMeters < 0 || candidateRadiusMeters <= supportRadiusMeters) continue
                    supportRadiusMeters = candidateRadiusMeters
                    supportTriangle = sampledTriangle
                    supportPoint = candidatePoint
                }
            }
            if (!supportTriangle || !supportPoint) return []
            const nearestPoint = supportTriangle.triangle.closestPointToPoint(
                probe.position,
                new THREE.Vector3(),
            )
            const probeRadiusMeters = probe.position.clone()
                .sub(radialRayOrigin)
                .dot(probeRadialDirection)
            const radialGapMeters = probeRadiusMeters - supportRadiusMeters
            const signedDistanceMeters = probe.position.distanceTo(nearestPoint)
                * (radialGapMeters < 0 ? -1 : 1)
            const requiredDistanceMeters = probe.radiusMeters
                + dressClearanceWalkSafetyMarginMeters
            const penetrationMeters = requiredDistanceMeters - signedDistanceMeters
            if (recordInitialHits) {
                minimumDressClearanceSignedSurfaceDistanceMeters = Math.min(
                    minimumDressClearanceSignedSurfaceDistanceMeters,
                    signedDistanceMeters,
                )
                if (signedDistanceMeters < 0) dressClearanceSkinnedSurfaceInsideHits += 1
                if (penetrationMeters > 0) dressClearanceSkinnedSurfaceIntersectionHits += 1
            }
            return [{
                probe,
                surfaceNormal: probeRadialDirection,
                signedDistanceMeters,
                requiredDistanceMeters,
                penetrationMeters,
            }]
        })
        const probeRecords: SetAWalkDressClearanceProbeRecord[] = []
        const correctionMetersBySide: Record<'L' | 'R', number> = { L: 0, R: 0 }
        for (const side of ['L', 'R'] as const) {
            const upperArm = rig.get(side === 'L' ? motionPaths.upperArmL : motionPaths.upperArmR)!
            const forearm = rig.get(side === 'L' ? motionPaths.forearmL : motionPaths.forearmR)!
            const hand = rig.get(side === 'L' ? motionPaths.handL : motionPaths.handR)!
            const initialHandPosition = hand.getWorldPosition(new THREE.Vector3())
            const captureArmPose = (): SetAWalkArmPoseSnapshot => ({
                upperArmQuaternion: upperArm.quaternion.clone(),
                forearmQuaternion: forearm.quaternion.clone(),
                handQuaternion: hand.quaternion.clone(),
            })
            const restoreArmPose = (snapshot: SetAWalkArmPoseSnapshot): void => {
                upperArm.quaternion.copy(snapshot.upperArmQuaternion)
                forearm.quaternion.copy(snapshot.forearmQuaternion)
                hand.quaternion.copy(snapshot.handQuaternion)
                character.object.updateMatrixWorld(true)
            }
            const objectiveFor = (
                candidateConstraints: readonly SetAWalkDressClearanceConstraint[],
            ): SetAWalkConstraintObjective => {
                const penetrations = candidateConstraints
                    .map(constraint => Math.max(0, constraint.penetrationMeters))
                    .filter(value => value > 0)
                return {
                    penetrationCount: penetrations.length,
                    maximumPenetrationMeters: penetrations.length > 0
                        ? Math.max(...penetrations)
                        : 0,
                    totalPenetrationMeters: penetrations.reduce((sum, value) => sum + value, 0),
                }
            }
            const objectiveImproves = (
                candidate: SetAWalkConstraintObjective,
                baseline: SetAWalkConstraintObjective,
            ): boolean => (
                candidate.penetrationCount < baseline.penetrationCount
                || (
                    candidate.penetrationCount === baseline.penetrationCount
                    && candidate.maximumPenetrationMeters < baseline.maximumPenetrationMeters - 1e-7
                )
                || (
                    candidate.penetrationCount === baseline.penetrationCount
                    && Math.abs(
                        candidate.maximumPenetrationMeters - baseline.maximumPenetrationMeters,
                    ) <= 1e-7
                    && candidate.totalPenetrationMeters < baseline.totalPenetrationMeters - 1e-7
                )
            )
            let corrected = false
            let passes = 0
            dressClearanceSampledFrameSides += 1
            const initialConstraints = collectConstraints(side, true)
            const initialConstraintByLabel = new Map(
                initialConstraints.map(constraint => [constraint.probe.label, constraint]),
            )
            let constraints = initialConstraints
            // The original 14% wrist budget is retained for shallow contacts, but a
            // real skinned-surface penetration can be deeper than that budget. Grow
            // only the affected side from its measured deficit instead of raising a
            // symmetric/global limit. The hard ceiling remains well inside the arm's
            // reach and every accepted step is checked probe-by-probe below.
            const correctionLimitMeters = THREE.MathUtils.clamp(
                Math.max(
                    baselineCorrectionLimitMeters,
                    objectiveFor(initialConstraints).maximumPenetrationMeters
                        + dressClearancePostIkConvergenceGuardMeters * 2,
                ),
                baselineCorrectionLimitMeters,
                armLengthMeters * 0.36,
            )
            while (passes < dressClearancePostIkMaximumPasses) {
                if (!constraints.some(constraint => constraint.penetrationMeters > 0)) break
                const usedCorrectionMeters = hand.getWorldPosition(new THREE.Vector3())
                    .distanceTo(initialHandPosition)
                const remainingCorrectionMeters = Math.max(
                    0,
                    correctionLimitMeters - usedCorrectionMeters,
                )
                if (remainingCorrectionMeters <= 1e-5) break
                const correctionVector = new THREE.Vector3()
                for (let sweep = 0; sweep < dressClearanceConstraintProjectionSweeps; sweep += 1) {
                    for (const constraint of constraints) {
                        const deficitMeters = constraint.penetrationMeters
                            + dressClearancePostIkConvergenceGuardMeters
                            - correctionVector.dot(constraint.surfaceNormal)
                        if (deficitMeters <= 0) continue
                        correctionVector.addScaledVector(
                            constraint.surfaceNormal,
                            deficitMeters,
                        )
                        if (correctionVector.length() > remainingCorrectionMeters) {
                            correctionVector.setLength(remainingCorrectionMeters)
                        }
                    }
                }
                const prePassPose = captureArmPose()
                const prePassHandPosition = hand.getWorldPosition(new THREE.Vector3())
                const prePassObjective = objectiveFor(constraints)
                const prePassConstraintByLabel = new Map(
                    constraints.map(constraint => [constraint.probe.label, constraint]),
                )
                const maximumPenetrationMeters = prePassObjective.maximumPenetrationMeters
                const outward = targetRigOutwardFor(side)
                const hipRadial = prePassHandPosition.clone().sub(hipPosition)
                    .addScaledVector(
                        worldUp,
                        -prePassHandPosition.clone().sub(hipPosition).dot(worldUp),
                    )
                if (hipRadial.lengthSq() < 1e-10 || hipRadial.dot(outward) <= 0) {
                    hipRadial.copy(outward)
                } else {
                    hipRadial.normalize()
                }
                const weightedSurfaceNormal = constraints.reduce(
                    (sum, constraint) => constraint.penetrationMeters > 0
                        ? sum.addScaledVector(
                            constraint.surfaceNormal,
                            constraint.penetrationMeters
                                + dressClearancePostIkConvergenceGuardMeters,
                        )
                        : sum,
                    new THREE.Vector3(),
                )
                const worstConstraint = constraints.reduce((worst, constraint) => (
                    constraint.penetrationMeters > worst.penetrationMeters
                        ? constraint
                        : worst
                ), constraints[0])
                const translationVectors: THREE.Vector3[] = []
                const appendTranslationVector = (
                    directionOrVector: THREE.Vector3,
                    requestedMeters = remainingCorrectionMeters,
                ): void => {
                    if (directionOrVector.lengthSq() <= 1e-10) return
                    const vector = directionOrVector.clone()
                    if (Math.abs(vector.length() - requestedMeters) > 1e-8) {
                        vector.setLength(Math.min(requestedMeters, remainingCorrectionMeters))
                    }
                    if (vector.length() > remainingCorrectionMeters) {
                        vector.setLength(remainingCorrectionMeters)
                    }
                    if (translationVectors.some(existing => (
                        existing.clone().normalize().dot(vector.clone().normalize()) > 0.9995
                        && Math.abs(existing.length() - vector.length()) < 1e-4
                    ))) return
                    translationVectors.push(vector)
                }
                appendTranslationVector(correctionVector)
                appendTranslationVector(
                    weightedSurfaceNormal,
                    Math.min(
                        remainingCorrectionMeters,
                        maximumPenetrationMeters
                            + dressClearancePostIkConvergenceGuardMeters * 2,
                    ),
                )
                appendTranslationVector(
                    worstConstraint.surfaceNormal,
                    Math.min(
                        remainingCorrectionMeters,
                        maximumPenetrationMeters
                            + dressClearancePostIkConvergenceGuardMeters * 2,
                    ),
                )
                appendTranslationVector(
                    hipRadial,
                    Math.min(
                        remainingCorrectionMeters,
                        maximumPenetrationMeters
                            + dressClearancePostIkConvergenceGuardMeters * 2,
                    ),
                )
                appendTranslationVector(
                    outward,
                    Math.min(
                        remainingCorrectionMeters,
                        maximumPenetrationMeters
                            + dressClearancePostIkConvergenceGuardMeters * 2,
                    ),
                )
                appendTranslationVector(
                    correctionVector.clone().normalize().add(hipRadial).normalize(),
                    Math.min(
                        remainingCorrectionMeters,
                        maximumPenetrationMeters
                            + dressClearancePostIkConvergenceGuardMeters * 2,
                    ),
                )
                if (translationVectors.length === 0) break
                const authoredElbowPoleDirection = forearm.getWorldPosition(new THREE.Vector3())
                    .sub(upperArm.getWorldPosition(new THREE.Vector3()))
                    .normalize()
                const elbowPoleWorldHints: THREE.Vector3[] = []
                const appendBoundedElbowPoleHint = (
                    requestedDirection: THREE.Vector3,
                    maximumDeviationRadians: number,
                ): void => {
                    if (
                        authoredElbowPoleDirection.lengthSq() <= 1e-10
                        || requestedDirection.lengthSq() <= 1e-10
                    ) return
                    const requested = requestedDirection.clone().normalize()
                    if (requested.dot(authoredElbowPoleDirection) < 0) requested.negate()
                    const angle = Math.acos(THREE.MathUtils.clamp(
                        authoredElbowPoleDirection.dot(requested),
                        -1,
                        1,
                    ))
                    const blend = angle <= 1e-8
                        ? 1
                        : Math.min(1, maximumDeviationRadians / angle)
                    const bounded = authoredElbowPoleDirection.clone()
                        .lerp(requested, blend)
                        .normalize()
                    if (elbowPoleWorldHints.some(existing => existing.dot(bounded) > 0.9995)) return
                    elbowPoleWorldHints.push(bounded)
                }
                // The accepted walk keeps the donor elbow bend, but the real left
                // palm/cuff/finger residual cannot always be cleared by a wrist
                // target alone. Explore a small authored-hemisphere elbow-plane
                // neighbourhood. Every result still goes through the all-probe
                // monotonic check below, so an upstream pose is accepted only when
                // it improves penetration without pushing any probe farther in.
                appendBoundedElbowPoleHint(outward, THREE.MathUtils.degToRad(20))
                appendBoundedElbowPoleHint(outward, THREE.MathUtils.degToRad(36))
                appendBoundedElbowPoleHint(
                    outward.clone().addScaledVector(worldUp, 0.4),
                    THREE.MathUtils.degToRad(32),
                )
                appendBoundedElbowPoleHint(
                    outward.clone().addScaledVector(targetRigForward, 0.4),
                    THREE.MathUtils.degToRad(32),
                )
                appendBoundedElbowPoleHint(
                    outward.clone().addScaledVector(targetRigForward, -0.4),
                    THREE.MathUtils.degToRad(32),
                )
                const armSolveCandidates: Array<{
                    translationVector: THREE.Vector3
                    translationStepScale: number
                    elbowPoleWorldHint?: THREE.Vector3
                }> = []
                const translationStepScales = [1, 0.8, 0.6, 0.4, 0.2] as const
                for (const translationVector of translationVectors) {
                    for (const translationStepScale of translationStepScales) {
                        armSolveCandidates.push({ translationVector, translationStepScale })
                    }
                }
                const upstreamTranslationVectors = translationVectors.slice(0, 4)
                for (const elbowPoleWorldHint of elbowPoleWorldHints) {
                    for (const translationVector of upstreamTranslationVectors) {
                        for (const translationStepScale of [1, 0.6] as const) {
                            armSolveCandidates.push({
                                translationVector,
                                translationStepScale,
                                elbowPoleWorldHint,
                            })
                        }
                    }
                }
                let acceptedPose: SetAWalkArmPoseSnapshot | undefined
                let acceptedConstraints: SetAWalkDressClearanceConstraint[] | undefined
                let acceptedObjective: SetAWalkConstraintObjective | undefined
                let acceptedCorrectionMeters = Number.POSITIVE_INFINITY
                for (const {
                    translationVector,
                    translationStepScale,
                    elbowPoleWorldHint,
                } of armSolveCandidates) {
                    restoreArmPose(prePassPose)
                    solveTwoBoneArm(
                        side,
                        prePassHandPosition.clone().addScaledVector(
                            translationVector,
                            translationStepScale,
                        ),
                        walkForearmFixedPrebendProfiles[side].fixedBendRadians,
                        elbowPoleWorldHint,
                    )
                    character.object.updateMatrixWorld(true)
                    const afterIkPose = captureArmPose()
                    const afterIkHandWorldQuaternion = hand.getWorldQuaternion(
                        new THREE.Quaternion(),
                    )
                    const afterIkConstraints = collectConstraints(side, false)
                    const handPivot = hand.getWorldPosition(new THREE.Vector3())
                    const rotationVector = new THREE.Vector3()
                    const maximumHandRotationRadians = THREE.MathUtils.degToRad(18)
                    for (let sweep = 0; sweep < 8; sweep += 1) {
                        for (const constraint of afterIkConstraints) {
                            if (
                                constraint.probe.label !== 'palm'
                                && !constraint.probe.label.startsWith('finger:')
                            ) continue
                            const lever = constraint.probe.position.clone().sub(handPivot)
                            const rotationGradient = lever.cross(constraint.surfaceNormal)
                            const gradientLengthSquared = rotationGradient.lengthSq()
                            if (gradientLengthSquared <= 1e-10) continue
                            const predictedClearanceMeters = rotationVector.dot(rotationGradient)
                            const deficitMeters = constraint.penetrationMeters
                                + dressClearancePostIkConvergenceGuardMeters
                                - predictedClearanceMeters
                            if (deficitMeters <= 0) continue
                            rotationVector.addScaledVector(
                                rotationGradient,
                                deficitMeters / gradientLengthSquared,
                            )
                            if (rotationVector.length() > maximumHandRotationRadians) {
                                rotationVector.setLength(maximumHandRotationRadians)
                            }
                        }
                    }
                    const rotationStepScales = rotationVector.lengthSq() > 1e-10
                        ? elbowPoleWorldHint
                            ? [0, 0.5, 1] as const
                            : [0, 0.25, 0.5, 0.75, 1] as const
                        : [0] as const
                    for (const rotationStepScale of rotationStepScales) {
                        restoreArmPose(afterIkPose)
                        if (rotationStepScale > 0) {
                            const rotationAngle = rotationVector.length() * rotationStepScale
                            const worldRotationDelta = new THREE.Quaternion().setFromAxisAngle(
                                rotationVector.clone().normalize(),
                                rotationAngle,
                            )
                            setObjectWorldQuaternion(
                                hand,
                                worldRotationDelta.multiply(afterIkHandWorldQuaternion.clone()),
                            )
                        }
                        const candidateConstraints = collectConstraints(side, false)
                        const candidateByLabel = new Map(
                            candidateConstraints.map(constraint => [constraint.probe.label, constraint]),
                        )
                        const worsensAnyProbe = [...prePassConstraintByLabel].some(([label, baseline]) => (
                            (candidateByLabel.get(label)?.penetrationMeters
                                ?? Number.POSITIVE_INFINITY) > baseline.penetrationMeters + 1e-7
                        ))
                        if (worsensAnyProbe) continue
                        const improvesPenetratingProbe = [...prePassConstraintByLabel].some(
                            ([label, baseline]) => baseline.penetrationMeters > 0
                                && (candidateByLabel.get(label)?.penetrationMeters
                                    ?? Number.POSITIVE_INFINITY) < baseline.penetrationMeters - 1e-7,
                        )
                        if (!improvesPenetratingProbe) continue
                        const candidateObjective = objectiveFor(candidateConstraints)
                        if (!objectiveImproves(candidateObjective, prePassObjective)) continue
                        const candidateCorrectionMeters = hand.getWorldPosition(new THREE.Vector3())
                            .distanceTo(initialHandPosition)
                        if (
                            acceptedObjective
                            && !objectiveImproves(candidateObjective, acceptedObjective)
                            && !(
                                candidateObjective.penetrationCount === acceptedObjective.penetrationCount
                                && Math.abs(
                                    candidateObjective.maximumPenetrationMeters
                                        - acceptedObjective.maximumPenetrationMeters,
                                ) <= 1e-7
                                && Math.abs(
                                    candidateObjective.totalPenetrationMeters
                                        - acceptedObjective.totalPenetrationMeters,
                                ) <= 1e-7
                                && candidateCorrectionMeters < acceptedCorrectionMeters
                            )
                        ) continue
                        acceptedPose = captureArmPose()
                        acceptedConstraints = candidateConstraints
                        acceptedObjective = candidateObjective
                        acceptedCorrectionMeters = candidateCorrectionMeters
                    }
                }
                if (!acceptedPose || !acceptedConstraints) {
                    restoreArmPose(prePassPose)
                    break
                }
                restoreArmPose(acceptedPose)
                corrected = true
                passes += 1
                dressClearancePostIkRemeasurePasses += 1
                constraints = acceptedConstraints
            }
            // A shallow palm-only residual can survive the broad five-pass search when
            // its fixed translation scales undershoot the local IK/surface response.
            // Finish that active constraint along its measured surface normal. The broad
            // solver keeps its original per-frame correction budget; only a surviving
            // palm residual on the active side may use the same existing 36%-of-arm
            // hard ceiling. Try the largest bounded step first and accept the first
            // result that neither worsens an active penetration nor creates a new one.
            // Every trial still
            // remeasures the actual 4,699 deformed skirt triangles, but this terminal
            // path is capped at three trials per pass so playback remains responsive.
            let terminalPasses = 0
            let observedPalmSignedDistanceGainPerTargetMeter = 1
            const terminalCorrectionLimitMeters = armLengthMeters * 0.36
            while (terminalPasses < dressClearanceTerminalPalmMaximumPasses) {
                const terminalPalmConstraint = constraints.find(constraint => (
                    constraint.probe.label === 'palm'
                    && constraint.penetrationMeters > 0
                ))
                if (!terminalPalmConstraint) break
                const usedCorrectionMeters = hand.getWorldPosition(new THREE.Vector3())
                    .distanceTo(initialHandPosition)
                const remainingCorrectionMeters = Math.max(
                    0,
                    terminalCorrectionLimitMeters - usedCorrectionMeters,
                )
                if (remainingCorrectionMeters <= 1e-5) break
                const preTerminalPose = captureArmPose()
                const preTerminalHandPosition = hand.getWorldPosition(new THREE.Vector3())
                const preTerminalObjective = objectiveFor(constraints)
                const preTerminalConstraintByLabel = new Map(
                    constraints.map(constraint => [constraint.probe.label, constraint]),
                )
                const requestedTargetTranslationMeters = Math.min(
                    remainingCorrectionMeters,
                    (
                        terminalPalmConstraint.penetrationMeters
                        + dressClearancePostIkConvergenceGuardMeters
                    ) / Math.max(0.1, observedPalmSignedDistanceGainPerTargetMeter),
                )
                const terminalDirection = terminalPalmConstraint.surfaceNormal.clone()
                if (terminalDirection.lengthSq() <= 1e-10) break
                terminalDirection.normalize()
                const terminalElbowPoleDirection = forearm.getWorldPosition(new THREE.Vector3())
                    .sub(upperArm.getWorldPosition(new THREE.Vector3()))
                const terminalElbowPoleWorldHint = terminalElbowPoleDirection.lengthSq() > 1e-10
                    ? terminalElbowPoleDirection.normalize()
                    : undefined
                let acceptedTerminalPose: SetAWalkArmPoseSnapshot | undefined
                let acceptedTerminalConstraints: SetAWalkDressClearanceConstraint[] | undefined
                let acceptedPalmSignedDistanceGainPerTargetMeter = 0
                for (const terminalStepScale of [1, 0.5, 0.25] as const) {
                    restoreArmPose(preTerminalPose)
                    const targetTranslationMeters = requestedTargetTranslationMeters
                        * terminalStepScale
                    solveTwoBoneArm(
                        side,
                        preTerminalHandPosition.clone().addScaledVector(
                            terminalDirection,
                            targetTranslationMeters,
                        ),
                        walkForearmFixedPrebendProfiles[side].fixedBendRadians,
                        terminalElbowPoleWorldHint,
                    )
                    character.object.updateMatrixWorld(true)
                    const candidateConstraints = collectConstraints(side, false)
                    const candidateByLabel = new Map(
                        candidateConstraints.map(constraint => [constraint.probe.label, constraint]),
                    )
                    const candidatePalmConstraint = candidateByLabel.get('palm')
                    if (!candidatePalmConstraint) continue
                    const worsensAnyTerminalProbe = [...preTerminalConstraintByLabel].some(
                        ([label, baseline]) => {
                            const candidatePenetration = candidateByLabel.get(label)?.penetrationMeters
                                ?? Number.POSITIVE_INFINITY
                            return baseline.penetrationMeters > 0
                                ? candidatePenetration > baseline.penetrationMeters + 1e-7
                                : candidatePenetration > 1e-7
                        },
                    )
                    if (worsensAnyTerminalProbe) continue
                    const palmSignedDistanceGainMeters = candidatePalmConstraint.signedDistanceMeters
                        - terminalPalmConstraint.signedDistanceMeters
                    if (palmSignedDistanceGainMeters <= 1e-7) continue
                    const candidateObjective = objectiveFor(candidateConstraints)
                    if (!objectiveImproves(candidateObjective, preTerminalObjective)) continue
                    const candidateCorrectionMeters = hand.getWorldPosition(new THREE.Vector3())
                        .distanceTo(initialHandPosition)
                    if (
                        candidateCorrectionMeters > terminalCorrectionLimitMeters + 1e-7
                    ) continue
                    acceptedTerminalPose = captureArmPose()
                    acceptedTerminalConstraints = candidateConstraints
                    acceptedPalmSignedDistanceGainPerTargetMeter = palmSignedDistanceGainMeters
                        / Math.max(targetTranslationMeters, 1e-6)
                    break
                }
                if (!acceptedTerminalPose || !acceptedTerminalConstraints) {
                    restoreArmPose(preTerminalPose)
                    break
                }
                restoreArmPose(acceptedTerminalPose)
                constraints = acceptedTerminalConstraints
                observedPalmSignedDistanceGainPerTargetMeter = THREE.MathUtils.clamp(
                    acceptedPalmSignedDistanceGainPerTargetMeter,
                    0.1,
                    4,
                )
                corrected = true
                terminalPasses += 1
                dressClearancePostIkRemeasurePasses += 1
            }
            const finalConstraints = constraints
            const residualMeters = Math.max(
                0,
                ...finalConstraints.map(constraint => constraint.penetrationMeters),
            )
            minimumDressClearanceFinalSurfaceMarginMeters = Math.min(
                minimumDressClearanceFinalSurfaceMarginMeters,
                ...finalConstraints.map(constraint => -constraint.penetrationMeters),
            )
            maximumDressClearancePostIkResidualMeters = Math.max(
                maximumDressClearancePostIkResidualMeters,
                residualMeters,
            )
            const correctionMeters = hand.getWorldPosition(new THREE.Vector3())
                .distanceTo(initialHandPosition)
            correctionMetersBySide[side] = correctionMeters
            for (const finalConstraint of finalConstraints) {
                const initialConstraint = initialConstraintByLabel.get(finalConstraint.probe.label)
                    ?? finalConstraint
                probeRecords.push({
                    side,
                    label: finalConstraint.probe.label,
                    radiusMeters: finalConstraint.probe.radiusMeters,
                    requiredDistanceMeters: finalConstraint.requiredDistanceMeters,
                    initialSignedDistanceMeters: initialConstraint.signedDistanceMeters,
                    initialMarginMeters: -initialConstraint.penetrationMeters,
                    initialInside: initialConstraint.signedDistanceMeters < 0,
                    initialIntersection: initialConstraint.penetrationMeters > 0,
                    finalSignedDistanceMeters: finalConstraint.signedDistanceMeters,
                    finalMarginMeters: -finalConstraint.penetrationMeters,
                    finalInside: finalConstraint.signedDistanceMeters < 0,
                    finalIntersection: finalConstraint.penetrationMeters > 0,
                })
            }
            if (!corrected) continue
            dressClearanceCorrectedFrameSides += 1
            dressClearanceCorrectedFrameSidesBySemantic.walk += 1
            maximumDressClearanceCorrectionMeters = Math.max(
                maximumDressClearanceCorrectionMeters,
                correctionMeters,
            )
            maximumDressClearanceCorrectionMetersBySemantic.walk = Math.max(
                maximumDressClearanceCorrectionMetersBySemantic.walk,
                correctionMeters,
            )
        }
        const minimumInitialMarginMeters = probeRecords.length > 0
            ? Math.min(...probeRecords.map(probe => probe.initialMarginMeters))
            : null
        const minimumFinalMarginMeters = probeRecords.length > 0
            ? Math.min(...probeRecords.map(probe => probe.finalMarginMeters))
            : null
        const finalResidualMeters = probeRecords.length > 0
            ? Math.max(0, ...probeRecords.map(probe => -probe.finalMarginMeters))
            : 0
        return {
            frameIndex,
            phase,
            clipName,
            meshPaths: setAWalkOuterSkirtSurfaces.map(surface => surface.meshPath),
            triangleCount: sampledOuterSkirtTriangles.length,
            weightedVertexCount: setAWalkOuterSkirtSurfaces.reduce(
                (sum, surface) => sum + surface.weightedVertexCount,
                0,
            ),
            probes: probeRecords,
            minimumInitialMarginMeters,
            minimumFinalMarginMeters,
            initialInsideHits: probeRecords.filter(probe => probe.initialInside).length,
            initialIntersectionHits: probeRecords.filter(probe => probe.initialIntersection).length,
            finalInsideHits: probeRecords.filter(probe => probe.finalInside).length,
            finalIntersectionHits: probeRecords.filter(probe => probe.finalIntersection).length,
            finalResidualMeters,
            correctionMetersBySide,
        }
    }
    const applyArmPose = (
        side: 'L' | 'R',
        pose: Readonly<ArmPoseSample>,
    ): void => {
        const outward = targetRigOutwardFor(side)
        const swingRadians = side === 'L' ? pose.leftSwingRadians : pose.rightSwingRadians
        const hipPosition = rig.get(motionPaths.hip)!.getWorldPosition(new THREE.Vector3())
        const shoulderCenter = rig.get(motionPaths.upperArmL)!
            .getWorldPosition(new THREE.Vector3())
            .add(rig.get(motionPaths.upperArmR)!.getWorldPosition(new THREE.Vector3()))
            .multiplyScalar(0.5)
        const targetHeight = hipPosition.dot(worldUp) + pose.handHeightAboveHipMeters
        const target = shoulderCenter.clone()
            .addScaledVector(outward, pose.handHalfSeparationMeters)
            .addScaledVector(worldUp, targetHeight - shoulderCenter.dot(worldUp))
            .addScaledVector(
                targetRigForward,
                pose.forwardBiasMeters
                + Math.sin(swingRadians) * pose.forwardSwingScaleMeters,
            )
        solveTwoBoneArm(side, target)
    }
    const isInsideBodyRig = (target: THREE.Object3D): boolean => {
        let current: THREE.Object3D | null = target
        while (current) {
            if (current === rigRoot) return true
            current = current.parent
        }
        return false
    }
    const baselineBindings = new Map<string, {
        target: THREE.Object3D
        property: 'position' | 'quaternion' | 'scale'
    }>()
    for (const clip of baselineFamilyClips) {
        for (const track of clip.tracks) {
            const separator = track.name.lastIndexOf('.')
            if (separator < 1) continue
            const property = track.name.slice(separator + 1)
            if (property !== 'position' && property !== 'quaternion' && property !== 'scale') continue
            const target = character.object.getObjectByProperty('uuid', track.name.slice(0, separator))
            // Full-pose TPS clips are body-only. Never bake an external sibling
            // weapon/attachment Animator from the idle family into the body clip.
            if (!target || !isInsideBodyRig(target) || baselineBindings.has(track.name)) continue
            baselineBindings.set(track.name, { target, property })
        }
    }
    for (const path of Object.values(motionPaths)) {
        const target = rig.get(path)!
        for (const property of ['position', 'quaternion', 'scale'] as const) {
            const trackName = `${target.uuid}.${property}`
            if (!baselineBindings.has(trackName)) {
                baselineBindings.set(trackName, { target, property })
            }
        }
    }
    type GaitQuaternionLimitSemantic = 'walk' | 'run'
    const cyclicQuaternionStepLimitsDegrees: Record<
        GaitQuaternionLimitSemantic,
        Readonly<Record<string, number>>
    > = {
        walk: {
            Arm_L: 6,
            Arm_R: 6,
            // Forearms retain the fixed pre-bent native walk profile above. Do not
            // redistribute it with the iterative whole-ring limiter.
            Hand_L: 4,
            Hand_R: 4,
            Foot_L: 2.5,
            Foot_R: 2.5,
            Toe_L: 2.5,
            Toe_R: 2.5,
        },
        run: {
            Arm_L: 8,
            Arm_R: 8,
            Forearm_L: 7,
            Forearm_R: 7,
            Hand_L: 5,
            Hand_R: 5,
            Foot_L: 3.5,
            Foot_R: 3.5,
            Toe_L: 3.5,
            Toe_R: 3.5,
        },
    }
    const negateQuaternion = (quaternion: THREE.Quaternion): THREE.Quaternion => {
        quaternion.set(-quaternion.x, -quaternion.y, -quaternion.z, -quaternion.w)
        return quaternion
    }
    const limitCyclicQuaternionSteps = (
        values: number[],
        times: readonly number[],
        duration: number,
        maximumStepDegrees: number,
    ): void => {
        const closesAtDuration = times.length > 2
            && Math.abs((times.at(-1) ?? 0) - duration) <= 1e-6
            && Math.abs(times[0] ?? 0) <= 1e-6
        const uniqueFrameCount = closesAtDuration ? times.length - 1 : times.length
        if (uniqueFrameCount < 3 || values.length < times.length * 4) return
        const quaternions = Array.from({ length: uniqueFrameCount }, (_, index) => (
            new THREE.Quaternion(
                values[index * 4],
                values[index * 4 + 1],
                values[index * 4 + 2],
                values[index * 4 + 3],
            ).normalize()
        ))
        for (let index = 1; index < quaternions.length; index += 1) {
            if (quaternions[index - 1].dot(quaternions[index]) < 0) {
                negateQuaternion(quaternions[index])
            }
        }
        const maximumStepRadians = THREE.MathUtils.degToRad(maximumStepDegrees)
        // Project only over neighbouring frames on the closed animation ring.
        // This spreads an isolated solver discontinuity into its authored donor
        // neighbourhood instead of replacing the trajectory with a fixed pose.
        for (let pass = 0; pass < 96; pass += 1) {
            let largestStepRadians = 0
            const reverse = pass % 2 === 1
            for (let edge = 0; edge < uniqueFrameCount; edge += 1) {
                const index = reverse
                    ? (uniqueFrameCount - 1 - edge)
                    : edge
                const nextIndex = (index + 1) % uniqueFrameCount
                const from = quaternions[index].clone()
                const to = quaternions[nextIndex].clone()
                if (from.dot(to) < 0) negateQuaternion(to)
                const stepRadians = from.angleTo(to)
                largestStepRadians = Math.max(largestStepRadians, stepRadians)
                if (stepRadians <= maximumStepRadians + 1e-7) continue
                const midpoint = from.clone().slerp(to, 0.5).normalize()
                const retainedHalfArc = maximumStepRadians / stepRadians
                quaternions[index].copy(midpoint).slerp(from, retainedHalfArc).normalize()
                quaternions[nextIndex].copy(midpoint).slerp(to, retainedHalfArc).normalize()
            }
            if (largestStepRadians <= maximumStepRadians + 1e-7) break
        }
        for (let index = 1; index < quaternions.length; index += 1) {
            if (quaternions[index - 1].dot(quaternions[index]) < 0) {
                negateQuaternion(quaternions[index])
            }
        }
        quaternions.forEach((quaternion, index) => {
            quaternion.toArray(values, index * 4)
        })
        if (closesAtDuration) {
            quaternions[0].toArray(values, uniqueFrameCount * 4)
        }
    }
    const makeClip = (
        name: string,
        duration: number,
        times: readonly number[],
        rotationsAt: (
            role: MotionRole,
            ratio: number,
        ) => readonly { axis: THREE.Vector3; angle: number }[],
        hipOffsetAt: (ratio: number) => THREE.Vector3,
        armPoseAt?: (ratio: number) => ArmPoseSample,
        legPoseAt?: (ratio: number) => void,
        fullBodyPoseAt?: (ratio: number) => void,
        handFingerPoseAt?: (ratio: number) => void,
        gaitQuaternionLimitSemantic?: GaitQuaternionLimitSemantic,
    ): THREE.AnimationClip => {
        const valuesByTrack = new Map<string, number[]>(
            [...baselineBindings.keys()].map(trackName => [trackName, []]),
        )
        for (const time of times) {
            resetToSampledBaseline()
            const ratio = duration > 0 ? time / duration : 0
            const hip = rig.get(motionPaths.hip)!
            hip.position.add(worldDeltaToParentLocal(hip, hipOffsetAt(ratio)))
            character.object.updateMatrixWorld(true)
            if (fullBodyPoseAt) {
                fullBodyPoseAt(ratio)
            } else {
                for (const [role, path] of Object.entries(motionPaths) as Array<[
                    MotionRole,
                    string,
                ]>) {
                    if (
                        role === 'upperArmL'
                        || role === 'forearmL'
                        || role === 'handL'
                        || role === 'upperArmR'
                        || role === 'forearmR'
                        || role === 'handR'
                    ) continue
                    if (
                        legPoseAt
                        && (
                            role === 'upperLegL'
                            || role === 'lowerLegL'
                            || role === 'footL'
                            || role === 'toeL'
                            || role === 'upperLegR'
                            || role === 'lowerLegR'
                            || role === 'footR'
                            || role === 'toeR'
                        )
                    ) continue
                    applyWorldRotations(rig.get(path)!, rotationsAt(role, ratio))
                }
                legPoseAt?.(ratio)
                const arms = armPoseAt?.(ratio)
                if (arms) {
                    applyArmPose('L', arms)
                    applyArmPose('R', arms)
                }
            }
            restoreTargetRigRestHandPose('L')
            restoreTargetRigRestHandPose('R')
            handFingerPoseAt?.(ratio)

            for (const [trackName, binding] of baselineBindings) {
                const values = valuesByTrack.get(trackName)!
                if (binding.property === 'position') values.push(...binding.target.position.toArray())
                else if (binding.property === 'scale') values.push(...binding.target.scale.toArray())
                else values.push(...binding.target.quaternion.toArray())
            }
        }
        const tracks = [...baselineBindings].map(([trackName, binding]) => {
            const values = valuesByTrack.get(trackName)!
            if (binding.property === 'quaternion' && gaitQuaternionLimitSemantic) {
                const maximumStepDegrees = cyclicQuaternionStepLimitsDegrees[
                    gaitQuaternionLimitSemantic
                ][binding.target.name]
                if (maximumStepDegrees !== undefined) {
                    limitCyclicQuaternionSteps(values, times, duration, maximumStepDegrees)
                }
            }
            return binding.property === 'quaternion'
                ? new THREE.QuaternionKeyframeTrack(trackName, [...times], values)
                : new THREE.VectorKeyframeTrack(trackName, [...times], values)
        })
        const clip = new THREE.AnimationClip(name, duration, tracks)
        clip.blendMode = THREE.NormalAnimationBlendMode
        return clip
    }

    const smooth01 = (value: number): number => {
        const clamped = THREE.MathUtils.clamp(value, 0, 1)
        return clamped * clamped * (3 - 2 * clamped)
    }
    const jumpRotations = (
        role: MotionRole,
        ratio: number,
        phase: 'takeoff' | 'airborne' | 'land',
    ): readonly { axis: THREE.Vector3; angle: number }[] => {
        const side = role.endsWith('L') ? 1 : -1
        const anticipation = phase === 'takeoff' ? smooth01(ratio / 0.28) : 0
        const release = phase === 'takeoff' ? smooth01((ratio - 0.28) / 0.47) : 0
        const crouch = phase === 'takeoff'
            ? anticipation * (1 - release)
            : phase === 'land'
                ? 1 - smooth01(ratio)
                : 0
        const airborneDrift = phase === 'airborne' ? Math.sin(ratio * Math.PI * 2) * side : 0
        const degrees = (value: number): number => THREE.MathUtils.degToRad(value)
        if (role === 'hip') return [{ axis: targetRigLeftAxis, angle: degrees(-8 * crouch + 2 * release) }]
        if (role === 'spine') return [{ axis: targetRigLeftAxis, angle: degrees(6 * crouch + 3.2 * release + (phase === 'airborne' ? 3.2 : 0)) }]
        if (role === 'waist') return [{ axis: targetRigLeftAxis, angle: degrees(3.5 * crouch + 1.8 * release + (phase === 'airborne' ? 1.8 : 0)) }]
        if (role === 'chest') return [{ axis: targetRigLeftAxis, angle: degrees(2.5 * crouch + 1.4 * release + (phase === 'airborne' ? 1.4 : 0)) }]
        if (role === 'neck') return [{ axis: targetRigLeftAxis, angle: degrees(-1.8 * crouch - (phase === 'airborne' ? 1.2 : 0)) }]
        if (role === 'head') return []
        if (role === 'shoulderL' || role === 'shoulderR') {
            const lift = 4 * release + (phase === 'airborne' ? 3 : 0) + 3 * crouch
            return [{ axis: targetRigForward, angle: degrees(lift * side) }]
        }
        if (
            role === 'upperArmL'
            || role === 'forearmL'
            || role === 'handL'
            || role === 'upperArmR'
            || role === 'forearmR'
            || role === 'handR'
        ) return []
        const upperLeg = role.startsWith('upperLeg')
        const lowerLeg = role.startsWith('lowerLeg')
        if (phase === 'airborne') {
            const angle = upperLeg
                ? -11 + airborneDrift * 4
                : lowerLeg
                    ? 30 - airborneDrift * 5
                    : -7 + airborneDrift * 2
            return [{ axis: targetRigLeftAxis, angle: degrees(angle) }]
        }
        const angle = upperLeg
            ? -28 * crouch + 9 * release
            : lowerLeg
                ? 56 * crouch + 8 * release
                : -15 * crouch + 7 * release
        return [{ axis: targetRigLeftAxis, angle: degrees(angle) }]
    }
    const jumpHipOffset = (
        ratio: number,
        phase: 'takeoff' | 'airborne' | 'land',
    ): THREE.Vector3 => {
        if (phase === 'airborne') {
            // Vertical and horizontal root travel belong exclusively to the
            // locomotion controller. The pose clip only tucks the body/legs.
            return new THREE.Vector3()
        }
        if (phase === 'land') {
            const recovery = 1 - smooth01(ratio)
            return worldUp.clone().multiplyScalar(-legLengthMeters * 0.24 * recovery)
                .addScaledVector(targetRigForward, legLengthMeters * 0.02 * recovery)
        }
        const anticipation = smooth01(ratio / 0.28)
        const release = smooth01((ratio - 0.28) / 0.47)
        const crouch = anticipation * (1 - release)
        return worldUp.clone().multiplyScalar(-legLengthMeters * 0.18 * crouch)
            .addScaledVector(targetRigForward, legLengthMeters * 0.025 * crouch)
    }
    const applyJumpNaturalUpperBodyPose = (
        ratio: number,
        phase: 'takeoff' | 'airborne' | 'land',
        mode: JumpLocomotionMode,
    ): void => {
        restoreNaturalUpperBodyTargetRest()
        const synchronousDrift = phase === 'airborne'
            ? Math.sin(ratio * Math.PI * 2) * 0.010
            : 0
        // Use the same verified nine-family shoulder/elbow/wrist curves as
        // locomotion. Jump no longer synthesizes a symmetric IK target on top of
        // those curves; that overwrite produced the reversed billboard arms.
        const sidePhases = {
            L: wrapReferencePhase(0.735 + synchronousDrift),
            R: wrapReferencePhase(0.245 + synchronousDrift),
        }
        // Every generated sample keeps a human arm direction. Fading this value
        // to zero after restoring the inverse-bind rest bakes a literal T-pose at
        // takeoff/landing endpoints; the animation mixer already owns the
        // locomotion-to-jump crossfade, so a second pose-space fade is incorrect.
        const modeStrength = mode === 'running' ? 1 : mode === 'walking' ? 0.98 : 0.96
        for (const segment of referenceSegments.filter(candidate => (
            /^(?:shoulder|upperArm|forearm)[LR]$/.test(candidate.directionRole)
        ))) {
            const side = segment.directionRole.endsWith('L') ? 'L' : 'R'
            const donorDirection = referenceVectorToTargetWorld(blendNaturalUpperBodyVector(
                'run',
                sidePhases[side],
                frame => frame.directions[segment.directionRole],
                true,
            )).normalize()
            const bone = rig.get(motionPaths[segment.boneRole])!
            const child = rig.get(motionPaths[segment.childRole])!
            const currentDirection = child.getWorldPosition(new THREE.Vector3())
                .sub(bone.getWorldPosition(new THREE.Vector3()))
                .normalize()
            alignSegmentDirection(
                bone,
                child,
                currentDirection.lerp(donorDirection, modeStrength).normalize(),
            )
        }
        applyNativeHandFingerPose('run', sidePhases.L, sidePhases.R, modeStrength)
    }

    // 101901 has no native Dungeon locomotion bundle. Set A retains the accepted
    // light two-donor walk/run. Set B consumes all ten official full-body cycles
    // with morphology-nearest weights, then solves each segment on 101901's own
    // hierarchy. Neither profile directly binds a heterogeneous donor track.
    // Idle is not synthesized: both profiles use 101901's own paired HomeWait
    // body authority, with its external weapon sibling hidden in weapon-free TPS.
    const setB = profileId === '101901-dress-clearance-multidonor'
    const names = targetRigMorphologyProfile ? {
        walk: `Magius${characterId}TargetRigMorphologyWalkV45_L`,
        run: `Magius${characterId}TargetRigMorphologyRunV45_L`,
    } : setB ? {
        walk: `Magius${characterId}DressClearanceMultiDonorWalkV37_L`,
        run: `Magius${characterId}DressClearanceMultiDonorRunV37_L`,
    } : {
        walk: `Magius${characterId}NaturalArmFingerWalkV37_L`,
        run: `Magius${characterId}NaturalArmFingerRunV37_L`,
    }
    const postAnimationWalkClearance: CharacterSpecificMotionPostAnimationClearance | undefined = (
        enableInteractiveSetAWalkDressClearance
        && characterId === 101901
        && profileId === 'set-a'
    ) ? (() => {
            let stateProvider: (() => CharacterLocomotionSnapshot) | undefined
            let variantProvider: (() => string | undefined) | undefined
            let active = false
            let frameIndex = 0
            let capture: {
                targetFrames: number
                frames: SetAWalkDressClearanceFrameRecord[]
                resolve: (record: SetAWalkDressClearanceCycleRecord) => void
                reject: (reason?: unknown) => void
            } | undefined
            const diagnostics: CharacterSpecificMotionPostAnimationClearance['diagnostics'] = {
                active: false,
                appliedFrames: 0,
                skippedFrames: 0,
                skinnedSurfaceStatus: setAWalkOuterSkirtSurfaces.length > 0
                    ? 'attached'
                    : 'unavailable',
                meshPaths: setAWalkOuterSkirtSurfaces.map(surface => surface.meshPath),
                triangleCount: setAWalkOuterSkirtSurfaces.reduce(
                    (sum, surface) => sum + surface.triangleVertexIndices.length,
                    0,
                ),
                weightedVertexCount: setAWalkOuterSkirtSurfaces.reduce(
                    (sum, surface) => sum + surface.weightedVertexCount,
                    0,
                ),
                lastFrame: null,
                capturePending: false,
                captureFrames: 0,
            }
            const makeCycleRecord = (
                frames: SetAWalkDressClearanceFrameRecord[],
            ): SetAWalkDressClearanceCycleRecord => {
                const finalMargins = frames
                    .map(frame => frame.minimumFinalMarginMeters)
                    .filter((margin): margin is number => margin !== null)
                const phases = frames
                    .map(frame => frame.phase)
                    .filter((phase): phase is number => phase !== null)
                return {
                    schema: 'magius.101901-set-a-real-skinned-walk-clearance-cycle.v1',
                    characterId,
                    profileId: 'set-a',
                    sampleCount: frames.length,
                    meshPaths: [...diagnostics.meshPaths],
                    triangleCount: diagnostics.triangleCount,
                    weightedVertexCount: diagnostics.weightedVertexCount,
                    frames,
                    summary: {
                        minimumFinalMarginMeters: finalMargins.length > 0
                            ? Math.min(...finalMargins)
                            : null,
                        finalInsideHits: frames.reduce(
                            (sum, frame) => sum + frame.finalInsideHits,
                            0,
                        ),
                        finalIntersectionHits: frames.reduce(
                            (sum, frame) => sum + frame.finalIntersectionHits,
                            0,
                        ),
                        maximumFinalResidualMeters: frames.reduce(
                            (maximum, frame) => Math.max(maximum, frame.finalResidualMeters),
                            0,
                        ),
                        phaseMinimum: phases.length > 0 ? Math.min(...phases) : null,
                        phaseMaximum: phases.length > 0 ? Math.max(...phases) : null,
                    },
                }
            }
            const rejectCapture = (reason: string): void => {
                if (!capture) return
                const pending = capture
                capture = undefined
                diagnostics.capturePending = false
                diagnostics.captureFrames = 0
                pending.reject(new Error(reason))
            }
            const update = (): void => {
                const snapshot = stateProvider?.()
                const clipName = character.animation.current ?? null
                if (
                    !active
                    || variantProvider?.() !== 'set-a'
                    || snapshot?.state !== 'walk'
                    || !clipName
                    || !familyEquals(clipName, names.walk)
                ) {
                    diagnostics.skippedFrames += 1
                    return
                }
                const duration = character.animation.duration
                const localTime = character.animation.time
                const phase = duration > 0
                    ? ((localTime % duration) + duration) % duration / duration
                    : null
                const frame = applySetAWalkDressClearance(frameIndex, phase, clipName)
                frameIndex += 1
                diagnostics.appliedFrames += 1
                diagnostics.lastFrame = frame
                if (!capture) return
                capture.frames.push(frame)
                diagnostics.captureFrames = capture.frames.length
                if (capture.frames.length < capture.targetFrames) return
                const completed = capture
                capture = undefined
                diagnostics.capturePending = false
                diagnostics.captureFrames = completed.frames.length
                completed.resolve(makeCycleRecord(completed.frames))
            }
            return {
                update,
                diagnostics,
                setStateProvider(provider) { stateProvider = provider },
                setVariantProvider(provider) { variantProvider = provider },
                setActive(value) {
                    active = value
                    diagnostics.active = value
                    if (!value) rejectCapture('Set A walk clearance capture interrupted')
                },
                captureWalkCycle(sampleCount = 240) {
                    if (diagnostics.skinnedSurfaceStatus !== 'attached') {
                        return Promise.reject(new Error(
                            '101901 Set A outer-skirt SkinnedMesh surface is unavailable',
                        ))
                    }
                    if (capture) {
                        return Promise.reject(new Error('Set A walk clearance capture is already pending'))
                    }
                    const targetFrames = THREE.MathUtils.clamp(
                        Math.floor(sampleCount),
                        1,
                        2400,
                    )
                    return new Promise<SetAWalkDressClearanceCycleRecord>((resolve, reject) => {
                        capture = { targetFrames, frames: [], resolve, reject }
                        diagnostics.capturePending = true
                        diagnostics.captureFrames = 0
                    })
                },
                reset() {
                    rejectCapture('Set A walk clearance runtime reset')
                    invalidateSetAWalkOuterSkirtAcceleration()
                    frameIndex = 0
                    diagnostics.appliedFrames = 0
                    diagnostics.skippedFrames = 0
                    diagnostics.lastFrame = null
                },
            }
        })()
        : undefined
    const jumpProfileTag = setB ? 'MultiDonor' : 'SetA'
    const jumpNames: Record<JumpLocomotionMode, Record<'jump' | 'fall' | 'land', string>> = targetRigMorphologyProfile ? {
        standing: {
            jump: `Magius${characterId}StandingJumpTakeoffV45TargetRigMorphology_SE`,
            fall: `Magius${characterId}StandingJumpAirborneV45TargetRigMorphology_L`,
            land: `Magius${characterId}StandingJumpLandV45TargetRigMorphology_SE`,
        },
        walking: {
            jump: `Magius${characterId}WalkJumpTakeoffV45TargetRigMorphology_SE`,
            fall: `Magius${characterId}WalkJumpAirborneV45TargetRigMorphology_L`,
            land: `Magius${characterId}WalkJumpLandV45TargetRigMorphology_SE`,
        },
        running: {
            jump: `Magius${characterId}RunJumpTakeoffV45TargetRigMorphology_SE`,
            fall: `Magius${characterId}RunJumpAirborneV45TargetRigMorphology_L`,
            land: `Magius${characterId}RunJumpLandV45TargetRigMorphology_SE`,
        },
    } : {
        standing: {
            jump: `Magius${characterId}StandingJumpTakeoffV37${jumpProfileTag}_SE`,
            fall: `Magius${characterId}StandingJumpAirborneV37${jumpProfileTag}_L`,
            land: `Magius${characterId}StandingJumpLandV37${jumpProfileTag}_SE`,
        },
        walking: {
            jump: `Magius${characterId}WalkJumpTakeoffV37${jumpProfileTag}_SE`,
            fall: `Magius${characterId}WalkJumpAirborneV37${jumpProfileTag}_L`,
            land: `Magius${characterId}WalkJumpLandV37${jumpProfileTag}_SE`,
        },
        running: {
            jump: `Magius${characterId}RunJumpTakeoffV37${jumpProfileTag}_SE`,
            fall: `Magius${characterId}RunJumpAirborneV37${jumpProfileTag}_L`,
            land: `Magius${characterId}RunJumpLandV37${jumpProfileTag}_SE`,
        },
    }
    const jumpClipSpecifications = [
        { state: 'jump', phase: 'takeoff', duration: 0.44 },
        { state: 'fall', phase: 'airborne', duration: 0.64 },
        { state: 'land', phase: 'land', duration: 0.42 },
    ] as const
    let generated: Array<{ state: LocomotionState; clip: THREE.AnimationClip }>
    try {
        generated = [
            { state: 'walk', clip: makeClip(
                names.walk,
                walkDuration,
                makeFrameTimes(walkDuration),
                () => [],
                ratio => normalizedReferenceHipOffset(ratio, 'walk'),
                undefined,
                undefined,
                ratio => applyNormalizedReferencePose(ratio, 'walk'),
                ratio => applyNativeHandFingerPose('walk', ratio),
                'walk',
            ) },
            { state: 'run', clip: makeClip(
                names.run,
                runDuration,
                makeFrameTimes(runDuration),
                () => [],
                ratio => normalizedReferenceHipOffset(ratio, 'run'),
                undefined,
                undefined,
                ratio => applyNormalizedReferencePose(ratio, 'run'),
                ratio => applyNativeHandFingerPose('run', ratio),
                'run',
            ) },
            ...(['standing', 'walking', 'running'] as const).flatMap(mode => (
                jumpClipSpecifications.map(specification => ({
                    state: specification.state,
                    clip: makeClip(
                        jumpNames[mode][specification.state],
                        specification.duration,
                        makeFrameTimes(specification.duration),
                        (role, ratio) => jumpRotations(role, ratio, specification.phase),
                        ratio => jumpHipOffset(ratio, specification.phase),
                        undefined,
                        ratio => applyJumpLegPose(ratio, specification.phase, mode),
                        undefined,
                        ratio => applyJumpNaturalUpperBodyPose(ratio, specification.phase, mode),
                    ),
                }))
            )),
        ]
    } finally {
        restorePreSamplePose()
    }
    const generatedNames = new Set(generated.map(item => item.clip.name))
    character.object.animations = [
        ...character.object.animations.filter(clip => !generatedNames.has(clip.name)),
        ...generated.map(item => item.clip),
    ]
    profile.status = 'attached'
    profile.playbackMode = 'full-pose'
    if (characterId === 101901) {
        profile.idleAuthority = {
            bodyClipPathId: '-744234983873425308',
            weaponClipPathId: '2664253911874192042',
            durationSeconds: 1.983333,
            bodyBindings: 633,
            weaponBindings: 87,
            tpsPolicy: 'body-only-hide-external-weapon-sibling',
        }
    }
    profile.generatedClips = generated.map(item => ({
        state: item.state,
        name: item.clip.name,
        duration: item.clip.duration,
    }))
    const activeDonorIds = referenceDonors.map(donor => donor.characterId)
    profile.gaitCalibration = {
        source: targetRigMorphologyProfile
            ? 'official-ten-donor-morphology-nearest-lower-body+nine-native-upper-body-and-fingers-v45'
            : setB
                ? 'official-ten-donor-lower-body+nine-native-dress-clearance-upper-body-and-fingers-v37'
                : 'accepted-100102-100301-lower-body+nine-native-low-abduction-upper-body-and-fingers-v37',
        sourceDungeonCharacterIds: activeDonorIds,
        referenceCharacterIds: activeDonorIds,
        compatibility: targetRigMorphologyProfile || setB
            ? 'morphology-nearest-normalized-trajectory-only;target-rig-segment-direction-solve;no-donor-track-binding'
            : 'normalized-trajectory-only;target-rig-segment-direction-solve;no-donor-track-binding',
        sampleRate: 60,
        legLengthMeters,
        armLengthMeters,
        referenceLegLengthMeters,
        walkCycleSeconds: walkDuration,
        runCycleSeconds: runDuration,
        walkSpeedMetersPerSecond,
        runSpeedMetersPerSecond,
        walkRootTravelPerCycleMeters,
        runRootTravelPerCycleMeters,
        walkStepLengthMeters: walkRootTravelPerCycleMeters / 2,
        runStepLengthMeters: runRootTravelPerCycleMeters / 2,
        trajectoryFrameCounts: Object.fromEntries(
            semanticOrderForReference.map(semantic => [
                semantic,
                Math.max(...referenceDonors.map(donor => donor.clips[semantic].frameCount)),
            ]),
        ) as Record<NormalizedMotionSemantic, number>,
        donorBlendWeights: { ...effectiveBlendWeights },
        upperBodyProfileId: targetRigMorphologyProfile
            ? 'target-rig-morphology-nine-native-arms-fingers-v45'
            : setB
                ? '101901-mami-dress-clearance-nine-native-arms-fingers-v37'
                : '101901-low-abduction-nine-native-arms-fingers-v37',
        upperBodyDonorBlendWeights: { ...effectiveNaturalUpperBodyWeights.walk },
        upperBodyTrajectoryDonorBlendWeights: {
            walk: { ...effectiveNaturalUpperBodyWeights.walk },
            run: { ...effectiveNaturalUpperBodyWeights.run },
        },
        nativeHandFingerRigPathCount: nativeUpperBodyRigPaths.length,
        nativeFingerRigPathCount: nativeUpperBodyFingerPaths.length,
        nativeUpperBodyExcludedSecondaryPathCount: nativeUpperBodySecondaryPaths.length,
        nativeHandFingerPoseFrameCount,
        donorMorphologyDistances: Object.fromEntries(activeDonorIds.map(id => [
            String(id),
            targetRigMorphologyBlend?.distances[String(id)]
                ?? normalizedHumanoidMotionReference.morphologyDiagnostics
                    ?.donors[String(id)]?.morphologyDistance
                ?? 0,
        ])),
        targetMorphologyFeatures: targetRigMorphologyFeatures,
        morphologyFeatureWeights: targetRigMorphologyProfile
            ? { ...normalizedHumanoidMotionReference.morphologyDiagnostics?.featureWeights }
            : undefined,
        poseSolve: 'target-rig-rest-axis-mapped-segment-directions+inverse-bind-rest-local-rotation-deltas',
        rootPolicy: targetRigMorphologyProfile || setB
            ? 'controller-root-from-weighted-donor-stance-speed-scaled-by-target-leg-length'
            : 'controller-root-scaled-by-target-to-reference-leg-length',
        ...(targetRigMorphologyProfile ? {
            handPolicy: 'nine-native-profile-clustered-shoulder-elbow-wrist-finger-curves-authoritative;target-inverse-bind-rest-local-delta-retarget;never-layer-over-HomeWait;closed-ring-arm-hand-angular-step-limit+walk-forearm-eight-official-donor-fixed-prebend-with-zero-bend-phase-residual-and-target-upper-arm-relative-elbow-plane;target-Skirt-envelope-minimal-wrist-clearance-only-with-donor-elbow-plane',
        } : setB ? {
            handPolicy: 'nine-native-profile-clustered-shoulder-elbow-wrist-finger-curves-authoritative;target-inverse-bind-rest-local-delta-retarget;never-layer-over-HomeWait;closed-ring-arm-hand-angular-step-limit+walk-forearm-eight-official-donor-fixed-prebend-with-zero-bend-phase-residual-and-target-upper-arm-relative-elbow-plane;target-OuterSkirt-minimal-wrist-clearance-only-with-donor-elbow-plane',
        } : {
            handPolicy: 'nine-native-profile-clustered-shoulder-elbow-wrist-finger-curves-authoritative;target-inverse-bind-rest-local-delta-retarget;never-layer-over-HomeWait;closed-ring-arm-hand-angular-step-limit+walk-forearm-eight-official-donor-fixed-prebend-with-zero-bend-phase-residual-and-target-upper-arm-relative-elbow-plane;target-OuterSkirt-walk-only-joint-wrist-translation+bounded-authored-hemisphere-elbow-plane-candidates+bounded-hand-orientation-against-deformed-skinned-outermost-radial-support-triangle-surface-with-signed-inside-intersection-clearance+adaptive-per-side-depth-budget+all-probe-monotonic-candidate-selection-and-post-IK-remeasure;run-preserves-approved-wrist-only-trajectory',
        }),
        footPolicy: 'official-swing-direction-with-three-frame-temporal-filter-and-closed-ring-foot-toe-angular-step-limit-and-continuous-target-rig-flat-sole-contact-blend;controller-root',
        dressClearance: {
            proxyBoneCount: skirtCollisionBones.length,
            proxyRadiusMeters: dressClearanceProxyRadiusMeters,
            verticalBandMeters: dressClearanceVerticalBandMeters,
            skinnedSurfaceStatus: setAWalkOuterSkirtSurfaces.length > 0
                ? 'attached'
                : 'unavailable',
            skinnedSurfaceMethod: 'outer-skirt-bone-weight-selected-triangles+applyBoneTransform+nearest-face-oriented-signed-distance',
            skinnedSurfaceMeshCount: setAWalkOuterSkirtSurfaces.length,
            skinnedSurfaceMeshPaths: setAWalkOuterSkirtSurfaces.map(surface => surface.meshPath),
            skinnedSurfaceTriangleCount: setAWalkOuterSkirtSurfaces.reduce(
                (sum, surface) => sum + surface.triangleVertexIndices.length,
                0,
            ),
            skinnedSurfaceWeightedVertexCount: setAWalkOuterSkirtSurfaces.reduce(
                (sum, surface) => sum + surface.weightedVertexCount,
                0,
            ),
            skinnedSurfaceInsideHits: dressClearanceSkinnedSurfaceInsideHits,
            skinnedSurfaceIntersectionHits: dressClearanceSkinnedSurfaceIntersectionHits,
            minimumSignedSurfaceDistanceMeters: Number.isFinite(
                minimumDressClearanceSignedSurfaceDistanceMeters,
            ) ? minimumDressClearanceSignedSurfaceDistanceMeters : null,
            minimumFinalSurfaceClearanceMarginMeters: Number.isFinite(
                minimumDressClearanceFinalSurfaceMarginMeters,
            ) ? minimumDressClearanceFinalSurfaceMarginMeters : null,
            enhancedSemantic: profileId === 'set-a' ? 'walk' : 'none',
            walkProxyPointCountPerSide: profileId === 'set-a'
                ? dressClearanceWalkProxyPointCountPerSide
                : 1,
            walkFingerProxyBoneCountPerSide: profileId === 'set-a'
                ? Math.max(
                    dressClearanceFingerBonesBySide.L.length,
                    dressClearanceFingerBonesBySide.R.length,
                )
                : 0,
            walkSafetyMarginMeters: profileId === 'set-a'
                ? dressClearanceWalkSafetyMarginMeters
                : 0,
            postIkMaximumPasses: profileId === 'set-a'
                ? dressClearancePostIkMaximumPasses
                : 0,
            constraintProjectionSweeps: profileId === 'set-a'
                ? dressClearanceConstraintProjectionSweeps
                : 0,
            postIkConvergenceGuardMeters: profileId === 'set-a'
                ? dressClearancePostIkConvergenceGuardMeters
                : 0,
            postIkRemeasurePasses: dressClearancePostIkRemeasurePasses,
            maximumPostIkResidualMeters: maximumDressClearancePostIkResidualMeters,
            sampledFrameSides: dressClearanceSampledFrameSides,
            correctedFrameSides: dressClearanceCorrectedFrameSides,
            correctedFrameSidesBySemantic: { ...dressClearanceCorrectedFrameSidesBySemantic },
            maximumCorrectionMeters: maximumDressClearanceCorrectionMeters,
            maximumCorrectionMetersBySemantic: {
                ...maximumDressClearanceCorrectionMetersBySemantic,
            },
        },
        flatSoleContact: {
            normalizedToeContactStart,
            normalizedToeContactEnd,
            correctedFrameSides: flatSoleCorrectedFrameSides,
        },
    }
    profile.jumpCalibration = {
        source: targetRigMorphologyProfile
            ? 'morphology-nearest-nine-native-target-inverse-bind-rest-upper-body+continuous-flat-sole-transition+standing-walking-running-human-jumps-v45;cinematic-combat-leaps-gated'
            : 'nine-native-profile-clustered-target-inverse-bind-rest-shoulder-elbow-wrist-finger-curves+continuous-flat-sole-transition+standing-walking-running-human-jumps-v37;grade-b-special-leaps-gated',
        donorPriority: [
            'same-character-exact-rig',
            'verified-retarget',
            'corpus-parameterized',
        ],
        rootPolicy: 'controller-all-horizontal-and-vertical',
        attachmentPolicy: 'body-only-exclude-external-weapons',
        sampleRate: 60,
    }
    // Keep the generated jump channel map on the profile object itself. Native
    // Dungeon promotion stores only `profile`; without this field the async
    // activation path cannot recover the generated standing/walking/running
    // jump clips.
    profile.jumpAnimations = jumpNames
    return {
        profile,
        animations: {
            idle: baselineClip,
            walk: names.walk,
            run: names.run,
            jump: jumpNames.standing.jump,
            fall: jumpNames.standing.fall,
            land: jumpNames.standing.land,
        },
        jumpAnimations: jumpNames,
        postAnimationWalkClearance,
    }
}

function findFamily(names: readonly string[], patterns: readonly RegExp[]): string | undefined {
    for (const pattern of patterns) {
        const match = names.find(name => pattern.test(name))
        if (match) return match
    }
    return undefined
}

function inferLocomotionAnimations(character: ViewerCharacter): LocomotionAnimationMap {
    const names = character.animations
    const neutralCharacterIdle = Number(character.userData.characterId) === 100102
        ? findFamily(names, [/^HomeWait01_L$/i])
        : undefined
    const idle = neutralCharacterIdle ?? findFamily(names, [
        /^DungeonWait_L$/i,
        /^HomeWait01_L$/i,
        /^HomeWait.*_L$/i,
        /^CommonWait_L$/i,
        /^Wait_L$/i,
        /wait|idle/i,
    ]) ?? character.animation.default ?? names[0]
    const walk = findFamily(names, [
        /^DungeonWalk_L$/i,
        /(?:^|_)Walk(?:_|$)|locomotion.*walk/i,
    ]) ?? idle
    const run = findFamily(names, [
        /^DungeonRun_L$/i,
        /(?:^|_)(?:Run|Dash|Sprint)(?:_|$)|locomotion.*run/i,
    ]) ?? idle
    const jump = findFamily(names, [
        /Jump.*(?:_S|Start|Takeoff)|(?:^|_)Jump(?:_|$)|Leap/i,
    ]) ?? idle
    const fall = findFamily(names, [/Jump.*_L|Fall|Airborne/i]) ?? idle
    const land = findFamily(names, [
        /Land|Landing|Jump.*(?:_E|End)/i,
    ]) ?? idle
    return { idle, walk, run, jump, fall, land }
}

function controllerRootOwnPoseLocomotionAnimations(
    character: ViewerCharacter,
    inferred: LocomotionAnimationMap,
): LocomotionAnimationMap {
    const ownPose = primaryLocomotionAnimation(inferred.idle)
        ?? character.animation.default
        ?? character.animation.current
        ?? character.animations[0]
    if (!ownPose) {
        throw new Error(`Character ${character.userData.characterId} has no own-pose animation for controller-root movement`)
    }
    // Every controller state resolves to the same selected-model animation.
    // CharacterLocomotionController still owns root velocity, turn and jump,
    // while its last-family guard prevents gait transitions from restarting or
    // writing any unverified skeleton/secondary/attachment track.
    return {
        idle: ownPose,
        walk: ownPose,
        run: ownPose,
        jump: ownPose,
        fall: ownPose,
        land: ownPose,
    }
}

function primaryLocomotionAnimation(
    value: string | readonly string[] | undefined,
): string | undefined {
    return typeof value === 'string' ? value : value?.[0]
}

interface LayeredMotionPlayback {
    baselineClip: string
    overlayClips: readonly string[]
}

type TargetRigLocomotionTransitionState = 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'land'

interface TargetRigLocomotionTransitionPolicy {
    stateByFamily: ReadonlyMap<string, TargetRigLocomotionTransitionState>
}

const targetRigLocomotionTransitionSeconds = {
    groundedGait: 0.28,
    takeoff: 0.20,
    airborne: 0.16,
    landing: 0.22,
    recovery: 0.30,
} as const

function targetRigMinimumLocomotionTransitionSeconds(
    previousState: TargetRigLocomotionTransitionState | undefined,
    nextState: TargetRigLocomotionTransitionState,
): number {
    if (nextState === 'jump') return targetRigLocomotionTransitionSeconds.takeoff
    if (nextState === 'fall') return targetRigLocomotionTransitionSeconds.airborne
    if (nextState === 'land') return targetRigLocomotionTransitionSeconds.landing
    if (
        previousState
        && (previousState === 'idle' || previousState === 'walk' || previousState === 'run')
        && (nextState === 'idle' || nextState === 'walk' || nextState === 'run')
    ) return targetRigLocomotionTransitionSeconds.groundedGait
    return targetRigLocomotionTransitionSeconds.recovery
}

function createTargetRigLocomotionTransitionPolicy(
    locomotionAnimations: LocomotionAnimationMap,
    jumpAnimations?: JumpLocomotionAnimationMap,
): TargetRigLocomotionTransitionPolicy {
    const stateByFamily = new Map<string, TargetRigLocomotionTransitionState>()
    const register = (
        state: TargetRigLocomotionTransitionState,
        value: string | readonly string[] | undefined,
    ): void => {
        const names = typeof value === 'string' ? [value] : value ?? []
        for (const name of names) stateByFamily.set(normalizeAnimationFamilyName(name), state)
    }
    for (const state of ['idle', 'walk', 'run', 'jump', 'fall', 'land'] as const) {
        register(state, locomotionAnimations[state])
    }
    for (const family of Object.values(jumpAnimations ?? {})) {
        register('jump', family.jump)
        register('fall', family.fall)
        register('land', family.land)
    }
    return { stateByFamily }
}

function targetRigLocomotionFadeSeconds(
    policy: TargetRigLocomotionTransitionPolicy,
    previousFamily: string | undefined,
    nextFamily: string,
    requestedFadeSeconds: number,
): number {
    const nextState = policy.stateByFamily.get(normalizeAnimationFamilyName(nextFamily))
    if (!nextState) return requestedFadeSeconds
    const previousState = previousFamily
        ? policy.stateByFamily.get(normalizeAnimationFamilyName(previousFamily))
        : undefined
    const minimumFadeSeconds = targetRigMinimumLocomotionTransitionSeconds(previousState, nextState)
    return Math.max(requestedFadeSeconds, minimumFadeSeconds)
}

function createAnimationPort(
    character: ViewerCharacter,
    layeredMotion?: LayeredMotionPlayback,
    targetRigLocomotionTransitions?: TargetRigLocomotionTransitionPolicy,
    nativeDungeonTransitions?: NativeDungeonFixedTransitionPolicy,
): CharacterAnimationPort {
    type AnimationRuntimeAccess = {
        _activeActions: THREE.AnimationAction[]
        _current?: string
        _clamped: boolean
        _queuedHomeLoop?: string
        _queuedHomeGateAction?: THREE.AnimationAction
        _preparedFamilies: Map<string, THREE.AnimationClip[]>
        _magiusLayeredBaseActions?: THREE.AnimationAction[]
        _magiusLayeredOverlayActions?: THREE.AnimationAction[]
    }
    const runtime = character.animation as unknown as AnimationRuntimeAccess
    const baselineFamily = layeredMotion
        ? normalizeAnimationFamilyName(layeredMotion.baselineClip)
        : undefined
    const overlayFamilies = new Set(
        layeredMotion?.overlayClips.map(normalizeAnimationFamilyName) ?? [],
    )
    const fadeOrStop = (actions: readonly THREE.AnimationAction[], fadeSeconds: number): void => {
        if (fadeSeconds > 0) {
            for (const action of actions) action.fadeOut(fadeSeconds)
        } else {
            for (const action of actions) action.stop()
        }
    }
    const stopAfterFade = (
        actions: readonly THREE.AnimationAction[],
        fadeSeconds: number,
    ): void => {
        if (fadeSeconds <= 0 || actions.length === 0) return
        window.setTimeout(() => {
            for (const action of actions) {
                if (!runtime._activeActions.includes(action)) action.stop()
            }
        }, Math.ceil(fadeSeconds * 1000) + 34)
    }
    const startActions = (
        clips: readonly THREE.AnimationClip[],
        options: { loop: boolean; weight: number },
        fadeSeconds: number,
    ): THREE.AnimationAction[] => clips.map(clip => {
        const action = character.animation.mixer.clipAction(clip)
        action.reset()
        action.enabled = true
        action.setEffectiveWeight(options.weight)
        action.setEffectiveTimeScale(1)
        if (options.loop) {
            action.setLoop(THREE.LoopRepeat, Infinity)
            action.clampWhenFinished = false
        } else {
            action.setLoop(THREE.LoopOnce, 1)
            action.clampWhenFinished = true
        }
        action.play()
        if (fadeSeconds > 0) action.fadeIn(fadeSeconds)
        return action
    })
    const descriptors = (): AnimationClipDescriptor[] => character.animations.map(name => {
        const clips = character.animation.getAnimationClipsByName(name)
        return {
            name,
            duration: clips.length ? Math.max(...clips.map(clip => clip.duration)) : undefined,
            trackCount: clips.reduce((sum, clip) => sum + clip.tracks.length, 0),
        }
    })
    return {
        listClips: descriptors,
        play: (name, options) => {
            const clips = prepareAnimationFamilyClips(character, name)
            if (!clips.length) return
            const family = normalizeAnimationFamilyName(name)
            const requestedFadeSeconds = nativeDungeonTransitions
                ? nativeDungeonFixedTransitionSeconds(
                    nativeDungeonTransitions,
                    runtime._current ? normalizeAnimationFamilyName(runtime._current) : undefined,
                    family,
                    Math.max(0, options.fadeSeconds),
                )
                : Math.max(0, options.fadeSeconds)
            const fadeSeconds = targetRigLocomotionTransitions
                ? targetRigLocomotionFadeSeconds(
                    targetRigLocomotionTransitions,
                    runtime._current,
                    family,
                    requestedFadeSeconds,
                )
                : requestedFadeSeconds
            const previous = [...(runtime._activeActions ?? [])]
            bindingByObject.get(character.object)?.tpsPoseTransition?.begin(fadeSeconds)

            if (baselineFamily && family === baselineFamily) {
                let baseActions = runtime._magiusLayeredBaseActions ?? []
                if (
                    baseActions.length === 0
                    && runtime._current
                    && familyEquals(runtime._current, baselineFamily)
                ) {
                    const overlays = new Set(runtime._magiusLayeredOverlayActions ?? [])
                    baseActions = previous.filter(action => !overlays.has(action))
                    runtime._magiusLayeredBaseActions = baseActions
                }
                if (baseActions.length > 0) {
                    const oldOverlays = runtime._magiusLayeredOverlayActions ?? []
                    fadeOrStop(oldOverlays, fadeSeconds)
                    runtime._magiusLayeredOverlayActions = []
                    runtime._activeActions = [...baseActions]
                    runtime._current = baselineFamily
                    runtime._clamped = false
                    runtime._queuedHomeLoop = undefined
                    runtime._queuedHomeGateAction = undefined
                    character.animation.paused = false
                    character.animation.mixer.timeScale = options.speed
                    stopAfterFade(oldOverlays, fadeSeconds)
                    return
                }
            }

            if (baselineFamily && overlayFamilies.has(family)) {
                let baseActions = runtime._magiusLayeredBaseActions ?? []
                if (baseActions.length === 0) {
                    const oldOverlays = new Set(runtime._magiusLayeredOverlayActions ?? [])
                    if (
                        runtime._current
                        && familyEquals(runtime._current, baselineFamily)
                    ) {
                        baseActions = previous.filter(action => !oldOverlays.has(action))
                    }
                    if (baseActions.length === 0) {
                        const baselineClips = prepareAnimationFamilyClips(
                            character,
                            layeredMotion!.baselineClip,
                        )
                        fadeOrStop(previous, fadeSeconds)
                        stopAfterFade(previous, fadeSeconds)
                        baseActions = startActions(
                            baselineClips,
                            { loop: true, weight: 1 },
                            fadeSeconds,
                        )
                    }
                    runtime._magiusLayeredBaseActions = baseActions
                }
                const oldOverlays = runtime._magiusLayeredOverlayActions ?? []
                fadeOrStop(oldOverlays, fadeSeconds)
                const nextOverlays = startActions(
                    clips,
                    { loop: options.loop, weight: options.weight },
                    fadeSeconds,
                )
                runtime._magiusLayeredOverlayActions = nextOverlays
                runtime._activeActions = [...baseActions, ...nextOverlays]
                runtime._current = family
                runtime._clamped = false
                runtime._queuedHomeLoop = undefined
                runtime._queuedHomeGateAction = undefined
                character.animation.paused = false
                character.animation.mixer.timeScale = options.speed
                stopAfterFade(oldOverlays, fadeSeconds)
                return
            }

            fadeOrStop(previous, fadeSeconds)
            const nextActions = startActions(
                clips,
                { loop: options.loop, weight: options.weight },
                fadeSeconds,
            )
            stopAfterFade(previous, fadeSeconds)
            runtime._activeActions = nextActions
            runtime._current = family
            runtime._clamped = false
            runtime._queuedHomeLoop = undefined
            runtime._queuedHomeGateAction = undefined
            runtime._magiusLayeredBaseActions = family === baselineFamily ? nextActions : []
            runtime._magiusLayeredOverlayActions = []
            character.animation.paused = false
            // AnimationAction.reset() already restarts every member at local time zero.
            // Rewinding the global mixer clock here invalidates the fade schedules that
            // were created above, leaving the returning family at zero weight until the
            // old clock value is reached again (visible as a persistent bind pose).
            character.animation.mixer.timeScale = options.speed
        },
        clear: () => {
            runtime._magiusLayeredBaseActions = []
            runtime._magiusLayeredOverlayActions = []
            character.animation.clear()
        },
        getDuration: name => descriptors().find(clip => familyEquals(clip.name, name))?.duration,
        setTime: timeSeconds => { character.animation.time = timeSeconds },
        setSpeed: speed => { character.animation.mixer.timeScale = speed },
        setWeight: weight => {
            for (const action of runtime._activeActions ?? []) action.setEffectiveWeight(weight)
        },
    }
}

function registeredCombatEffectCue(
    slot: ActionSlotDefinition,
    official: OfficialCombatActionMetadata,
): CombatEffectCueDefinition {
    return {
        id: `key:${slot.key}:vfx-slot`,
        timeSeconds: 0,
        effectId: official.directionName,
        anchor: slot.semantic === 'ultimate' ? 'character-root' : 'weapon-or-hand',
        payload: {
            schema: 'magius-viewer-combat-vfx-slot-v1',
            key: slot.key,
            semantic: slot.semantic,
            loadedClip: official.runtimeClipName,
            sequenceId: official.sequenceId,
            animationSegments: official.segments.map(segment => ({
                startSeconds: segment.startSeconds,
                runtimeClipName: segment.runtimeClipName,
                components: segment.components.map(component => ({
                    role: component.role,
                    runtimeClipName: component.runtimeClipName,
                    sourceClipName: component.sourceClipName,
                    sourceClipPathId: component.sourceClipPathId,
                })),
            })),
            directionName: official.directionName,
            bundleKey: official.bundleKey,
            skillUniqueId: official.skillUniqueId,
            skillMstId: official.skillMstId,
            requiredFields: ['vfxKey', 'anchor', 'lifetimeSeconds'],
        },
    }
}

function registerAction(binding: ViewerLocomotionBinding, slot: ActionSlotDefinition, clip: string): void {
    const official = binding.officialCombatActions.actions.find(
        action => action.runtimeClipName === clip && action.semantic === slot.semantic,
    )
    if (!binding.safety.allowCombatActions || !official) {
        binding.actionClips.delete(slot.code)
        return
    }
    binding.actionClips.set(slot.code, clip)
    binding.controller.registerAction({
        id: `key:${slot.key}`,
        semantic: slot.semantic,
        exactClip: clip,
        durationSeconds: official.durationSeconds,
        fadeSeconds: 0.12,
        animationSegments: official.segments.map(segment => ({
            clip: segment.runtimeClipName,
            startSeconds: segment.startSeconds,
            fadeSeconds: 0.12,
        })),
        movementScale: slot.semantic === 'dodge' ? 0.8 : 0.18,
        cancelWindows: [{ startSeconds: 0.08, endSeconds: Number.MAX_SAFE_INTEGER }],
        effectCues: [registeredCombatEffectCue(slot, official)],
    })
}

function chooseDefaultActionClip(binding: ViewerLocomotionBinding, slot: ActionSlotDefinition): string {
    if (!binding.safety.allowCombatActions) return ''
    const official = binding.officialCombatActions.actions.find(
        action => action.semantic === slot.semantic && action.key === slot.key,
    )
    return official?.runtimeClipName ?? ''
}

function combatSkeletonEntriesForSlot(
    binding: ViewerLocomotionBinding,
    slot: ActionSlotDefinition,
): readonly CombatJumpActionResourceEntry[] {
    const semanticPriority: Partial<Record<CombatActionSemantic, readonly string[]>> = {
        basicAttack: ['normalAttack'],
        skill: ['skill'],
        ultimate: ['special'],
    }
    const accepted = semanticPriority[slot.semantic]
    if (!accepted) return []
    return binding.combatJumpActions.entries.filter(entry => (
        entry.groupId === 'official-combat-complete-actions'
        && accepted.includes(entry.skill.semantic)
        && combatSkeletonConsumerAvailability(binding, entry, true).playable
    )).sort((left, right) => (
        accepted.indexOf(left.skill.semantic) - accepted.indexOf(right.skill.semantic)
        || left.id.localeCompare(right.id, 'en')
    ))
}

function configureActionSelectors(binding: ViewerLocomotionBinding): void {
    for (const slot of actionSlots) {
        slot.select.replaceChildren()
        const empty = document.createElement('option')
        empty.value = ''
        const rejected = binding.officialCombatActions.rejectedActions?.find(
            action => action.semantic === slot.semantic && action.key === slot.key,
        )
        empty.textContent = rejected
            ? `— disabled: ${rejected.reason} —`
            : binding.safety.status === 'verified'
                ? '— unbound —'
                : '— 未绑定（rig 未验证）—'
        slot.select.appendChild(empty)
        const allowedClips = binding.officialCombatActions.actions
            .filter(action => action.semantic === slot.semantic)
            .map(action => action.runtimeClipName)
        for (const name of allowedClips) {
            const option = document.createElement('option')
            option.value = name
            option.textContent = name
            slot.select.appendChild(option)
        }
        const catalogEntries = combatSkeletonEntriesForSlot(binding, slot)
        for (const entry of catalogEntries) {
            const template = exactCombatSkeletonPreviewEntry(binding, entry)
            const option = document.createElement('option')
            option.value = combatSkeletonCatalogActionId(entry.id)
            option.textContent = `${entry.label} · ${template?.roles.some(role => role.role === 'weapon-a') ? 'body/主武器' : 'body-only'}`
            slot.select.appendChild(option)
        }
        const previousCatalog = binding.catalogActionIds.get(slot.code)
        const retainedCatalog = previousCatalog && catalogEntries.some(entry => (
            combatSkeletonCatalogActionId(entry.id) === previousCatalog
        )) ? previousCatalog : ''
        const previous = binding.actionClips.get(slot.code)
        const legacySelected = previous && binding.character.animations.some(name => familyEquals(name, previous))
            ? previous
            : chooseDefaultActionClip(binding, slot)
        const selected = retainedCatalog
            || legacySelected
            || (catalogEntries[0] ? combatSkeletonCatalogActionId(catalogEntries[0].id) : '')
        slot.select.value = selected
        if (selected.startsWith(combatSkeletonPreviewPrefix)) {
            binding.catalogActionIds.set(slot.code, selected)
            binding.actionClips.delete(slot.code)
        } else if (selected) {
            binding.catalogActionIds.delete(slot.code)
            registerAction(binding, slot, selected)
        } else {
            binding.catalogActionIds.delete(slot.code)
            binding.actionClips.delete(slot.code)
        }
    }
}

function emitViewerEvent(name: string, detail: unknown): void {
    document.dispatchEvent(new CustomEvent(name, { detail }))
}

function emitViewerCombatEffectCue(cue: CombatEffectCue): void {
    emitViewerEvent('magius:combat-effect-cue', cue)
}

// One request token per selected-actor play; pending cancellation never starts a stale action.
interface ViewerCharacterActionPlayOptions {
    /** undefined: authored default; 0: infinite; positive integer: complete runs. */
    repetitions?: number
}
interface ViewerCharacterActionRepetition {
    actionId: string
    requested: number
    completed: number
    pendingFinish: boolean
    finished?: boolean
    localTime: number
    lastMixerTime: number
    seeking: boolean
    clipActions?: readonly THREE.AnimationAction[]
    gate?: THREE.AnimationAction
    dispose?: () => void
}
const viewerCharacterActionRepetitions = new WeakMap<ViewerLocomotionBinding, ViewerCharacterActionRepetition>()

function clearViewerCharacterActionRepetition(binding: ViewerLocomotionBinding): void {
    viewerCharacterActionRepetitions.get(binding)?.dispose?.()
    viewerCharacterActionRepetitions.delete(binding)
    delete binding.characterActionPlayback.repetitions
    delete binding.characterActionPlayback.completedRepetitions
}

function viewerCharacterActionRepeatability(actionId: string): { supported: boolean; reason?: string } {
    const entry = viewerCharacterActionCatalogSnapshot().entries.find(item => item.id === actionId)
    if (!entry?.consumerAvailability.playable) return {
        supported: false, reason: entry?.consumerAvailability.reason ?? 'action is unknown or unavailable for the selected actor',
    }
    if (entry.sourceKind === 'combat-jump') return {
        supported: false, reason: 'controller-owned three-phase jump supports one launch only; landing and travel are not a repeatable clip timeline',
    }
    if (entry.sourceKind === 'locomotion-profile') return {
        supported: false, reason: 'locomotion profile selection is not a finite action',
    }
    return { supported: true }
}

function configureViewerCharacterActionRepetition(binding: ViewerLocomotionBinding, requested: number | undefined): void {
    clearViewerCharacterActionRepetition(binding)
    if (requested === undefined || binding.combatJumpActions.activeJumpDonorPlayback) return
    const state = binding.characterActionPlayback
    if (state.status !== 'playing' || !state.actionId || !(state.durationSeconds > 0)) return
    const repeat: ViewerCharacterActionRepetition = {
        actionId: state.actionId, requested, completed: 0, pendingFinish: false, seeking: false,
        localTime: state.timeSeconds, lastMixerTime: binding.character.animation.mixer.time,
    }
    viewerCharacterActionRepetitions.set(binding, repeat)
    state.loop = requested === 0
    state.repetitions = requested
    state.completedRepetitions = 0
    if (binding.directHomeActions.active?.timeline || binding.combatJumpActions.activeSkeletonPlayback) return
    // One family run is gated by its longest actual member, never by a shorter
    // helper's finish event. Reuse these loaded actions for subsequent runs.
    const runtime = binding.character.animation as unknown as { _activeActions: THREE.AnimationAction[]; _clamped: boolean }
    const actions = runtime._activeActions
    if (!actions?.length) throw new Error('repeatable action has no active mixer family')
    repeat.clipActions = [...actions]
    repeat.gate = actions.reduce((a, b) => a.getClip().duration >= b.getClip().duration ? a : b)
    for (const action of actions) {
        action.setLoop(THREE.LoopOnce, 1)
        action.clampWhenFinished = true
    }
    const finished = (event: { action: THREE.AnimationAction }) => {
        if (viewerCharacterActionRepetitions.get(binding) !== repeat || repeat.seeking) return
        if (event.action === repeat.gate) repeat.pendingFinish = true
    }
    binding.character.animation.mixer.addEventListener('finished', finished)
    repeat.dispose = () => binding.character.animation.mixer.removeEventListener('finished', finished)
}

/** Returns true only when an existing loaded flow was restarted. */
function repeatCompletedViewerCharacterAction(binding: ViewerLocomotionBinding): boolean {
    const repeat = viewerCharacterActionRepetitions.get(binding)
    if (!repeat || repeat.actionId !== binding.characterActionPlayback.actionId) return false
    if (repeat.finished) return false
    repeat.completed += 1
    binding.characterActionPlayback.completedRepetitions = repeat.completed
    if (repeat.requested !== 0 && repeat.completed >= repeat.requested) {
        repeat.dispose?.()
        repeat.finished = true
        return false
    }
    repeat.pendingFinish = false
    repeat.localTime = 0
    repeat.lastMixerTime = binding.character.animation.mixer.time
    const direct = binding.directHomeActions.active
    const skeleton = binding.combatJumpActions.activeSkeletonPlayback
    if (direct?.timeline) {
        seekActiveDirectHomePlayback(binding, direct, 0)
        direct.timeline.play()
    } else if (skeleton) {
        skeleton.playback.seek(0)
        skeleton.playback.play()
        applyCombatSkeletonPose(binding, skeleton)
    } else {
        const runtime = binding.character.animation as unknown as { _clamped: boolean }
        runtime._clamped = false
        for (const action of repeat.clipActions ?? []) action.reset().setLoop(THREE.LoopOnce, 1).play()
        binding.character.animation.paused = false
    }
    binding.characterActionPlayback.timeSeconds = 0
    emitStartedViewerCharacterActionCue(binding, repeat.actionId)
    emitCharacterActionPlaybackState(binding)
    return true
}

/** A UI seek moves within this run. It never advances the repeat counter. */
function seekViewerCharacterActionMixer(binding: ViewerLocomotionBinding, time: number): void {
    const repeat = viewerCharacterActionRepetitions.get(binding)
    if (!repeat?.clipActions) { binding.character.animation.time = time; return }
    repeat.seeking = true
    repeat.pendingFinish = false
    repeat.localTime = time
    repeat.lastMixerTime = binding.character.animation.mixer.time
    const runtime = binding.character.animation as unknown as { _clamped: boolean }
    try {
        runtime._clamped = false
        for (const action of repeat.clipActions) {
            action.time = Math.min(time, action.getClip().duration)
            action.paused = false
        }
        binding.character.animation.mixer.update(0)
    } finally { repeat.seeking = false }
}

/** Consume complete timeline runs without discarding a frame's boundary remainder. */
function advanceViewerCharacterActionTimelineRepetition(binding: ViewerLocomotionBinding, delta: number): boolean {
    const repeat = viewerCharacterActionRepetitions.get(binding)
    const direct = binding.directHomeActions.active
    const skeleton = binding.combatJumpActions.activeSkeletonPlayback
    if (!repeat || (!direct?.timeline && !skeleton) || delta <= 0) return false
    let remaining = delta
    const duration = binding.characterActionPlayback.durationSeconds
    while (remaining > 0) {
        const current = direct?.timeline?.time ?? skeleton!.playback.state().timeSeconds
        const step = Math.min(remaining, Math.max(0, duration - current))
        if (direct?.timeline) direct.timeline.update(step)
        else skeleton!.playback.step(step)
        remaining = Math.max(0, remaining - step)
        const time = direct?.timeline?.time ?? skeleton!.playback.state().timeSeconds
        if (time < duration - 1e-9) break
        if (!repeatCompletedViewerCharacterAction(binding)) break
    }
    return true
}

function synchronizeViewerCharacterActionClipRepetition(binding: ViewerLocomotionBinding, deltaSeconds: number): boolean {
    const repeat = viewerCharacterActionRepetitions.get(binding)
    if (!repeat?.gate || !repeat.clipActions) return false
    const animation = binding.character.animation
    const runtime = animation as unknown as { _clamped: boolean }
    if (binding.characterActionPlayback.status !== 'playing' || animation.paused) return true
    // The mixer has already advanced this frame. Its clock includes mixer speed;
    // action.timeScale supplies the remaining authored per-action speed.
    const elapsed = Math.max(0, animation.mixer.time - repeat.lastMixerTime) * repeat.gate.timeScale
    repeat.lastMixerTime = animation.mixer.time
    let time = repeat.localTime + elapsed
    const duration = binding.characterActionPlayback.durationSeconds
    runtime._clamped = false
    let restarted = false
    if (deltaSeconds > 0) while (time >= duration - 1e-9) {
        time = Math.max(0, time - duration)
        if (!repeatCompletedViewerCharacterAction(binding)) {
            animation.paused = true
            runtime._clamped = true
            binding.characterActionPlayback = {
                ...binding.characterActionPlayback, status: 'idle', timeSeconds: duration,
                reason: 'requested complete action runs finished',
            }
            releaseViewerCharacterActionPhysicsPhase(binding, 'requested action repetitions completed')
            emitCharacterActionPlaybackState(binding)
            return true
        }
        restarted = true
    }
    repeat.localTime = time
    if (restarted) seekViewerCharacterActionMixer(binding, time)
    binding.characterActionPlayback.timeSeconds = time
    return true
}

const viewerCharacterActionPlayRequests = new WeakMap<ViewerLocomotionBinding, { loading: boolean }>()

function emitStartedViewerCharacterActionCue(binding: ViewerLocomotionBinding, actionId: string): void {
    if (binding.characterActionPlayback.status !== 'playing'
        || binding.characterActionPlayback.actionId !== actionId
        || binding.character.disposed
        || binding.sceneCharacter.character !== binding.character) return
    // Manual starts have the selected-actor request/generation guard; performance
    // starts have the exact actor-phase lease. Neither depends on a Q/E/R binding.
    const sourceId = combatSkeletonSourceActionId(actionId) ?? actionId
    const entries = binding.combatJumpActions.entries.filter(entry => entry.id === sourceId)
    if (entries.length !== 1) return
    const native = nativeCombatActionCue(entries[0], String(binding.character.userData.characterId))
    if (!native) return
    binding.catalogEffectCueSequence += 1
    emitViewerCombatEffectCue({
        characterId: String(binding.character.userData.characterId),
        actionId,
        actionSemantic: native.semantic,
        actionSequence: 1_000_000_000 + binding.catalogEffectCueSequence,
        cueId: native.cue.id,
        effectId: native.cue.effectId,
        anchor: native.cue.anchor,
        payload: native.cue.payload,
        actionTimeSeconds: native.cue.timeSeconds,
        rootPosition: binding.character.object.position.clone(),
        rootQuaternion: binding.character.object.quaternion.clone(),
    })
}

function clampViewerCharacterActionPlaybackRate(playbackRate: number): number {
    if (!Number.isFinite(playbackRate)) {
        throw new TypeError('character action playback rate must be finite')
    }
    return THREE.MathUtils.clamp(playbackRate, 0, 2)
}

function cloneCharacterActionPlaybackState(
    state: Readonly<ViewerCharacterActionPlaybackState>,
    physicsPhase: Readonly<ViewerCharacterActionPhysicsPhaseState> = (
        state.physicsPhase ?? emptyCharacterActionPhysicsPhaseState()
    ),
    playbackRate = state.playbackRate ?? 1,
): ViewerCharacterActionPlaybackSnapshot {
    return {
        ...state,
        playbackRate: clampViewerCharacterActionPlaybackRate(playbackRate),
        physicsPhase: { ...physicsPhase },
    }
}

function emptyCharacterActionPhysicsPhaseState(): ViewerCharacterActionPhysicsPhaseState {
    return { status: 'idle' }
}

function emptyCharacterActionPlaybackState(playbackRate = 1): ViewerCharacterActionPlaybackSnapshot {
    return {
        status: 'idle',
        timeSeconds: 0,
        durationSeconds: 0,
        loop: false,
        playbackRate: clampViewerCharacterActionPlaybackRate(playbackRate),
        physicsPhase: emptyCharacterActionPhysicsPhaseState(),
    }
}

function effectiveViewerCharacterActionMixerRate(binding: ViewerLocomotionBinding): number {
    return binding.characterActionAuthoredSpeed * binding.characterActionPlaybackRate
}

function applyViewerCharacterActionMixerRate(binding: ViewerLocomotionBinding): void {
    const playbackRate = effectiveViewerCharacterActionMixerRate(binding)
    binding.animationPlaybackRate = playbackRate
    binding.character.animation.mixer.timeScale = playbackRate
}

function setViewerCharacterActionPhysicsPhaseState(
    binding: ViewerLocomotionBinding,
    state: ViewerCharacterActionPhysicsPhaseState,
): void {
    binding.characterActionPhysicsPhase.state = { ...state }
    binding.characterActionPlayback.physicsPhase = { ...state }
}

function releaseViewerCharacterActionPhysicsPhase(
    binding: ViewerLocomotionBinding,
    reason?: string,
    emit = false,
): ViewerCharacterActionPhysicsPhaseState {
    binding.characterActionPhysicsPhase.requestToken += 1
    binding.characterActionPhysicsPhase.active?.disposePhase()
    binding.characterActionPhysicsPhase.active = undefined
    const state: ViewerCharacterActionPhysicsPhaseState = {
        status: 'idle',
        reason,
    }
    setViewerCharacterActionPhysicsPhaseState(binding, state)
    if (emit) emitCharacterActionPlaybackState(binding)
    return { ...state }
}

function applyOfficialPhaseLocalTrs(
    object: THREE.Object3D,
    binding: CharacterPhysicsActionPhaseOption['phaseRoot']['binding'],
): void {
    const trs = binding.localTRS
    if (!trs) {
        throw new Error(`character-physics-phase:missing-local-trs:${binding.stableKey}`)
    }
    // Unity -> Three FBX reflection is shared with the exact native-physics binder.
    object.position.set(-trs.localPosition.x, trs.localPosition.y, trs.localPosition.z)
    object.quaternion.set(
        trs.localRotation.x,
        -trs.localRotation.y,
        -trs.localRotation.z,
        trs.localRotation.w,
    ).normalize()
    object.scale.set(trs.localScale.x, trs.localScale.y, trs.localScale.z)
    object.updateMatrix()
}

function createOfficialCharacterActionPhysicsPhaseRoot(
    phase: CharacterPhysicsActionPhaseOption,
    binding: ViewerLocomotionBinding,
): ViewerCharacterActionPhysicsPhaseRootHandle {
    const rootName = phase.phaseRoot.officialGameObjectName
    const rootBinding = phase.phaseRoot.binding
    if (
        rootBinding.hierarchyPath !== rootName
        || rootBinding.modelRelativePath !== null
        || rootBinding.visualRootRelativePath !== null
    ) {
        throw new Error(`character-physics-phase:unsupported-root-parent:${phase.stableKey}`)
    }

    const phaseRoot = new THREE.Group()
    phaseRoot.name = rootName
    phaseRoot.userData.characterPhysicsPhaseStableKey = phase.stableKey
    phaseRoot.userData.characterPhysicsBindingStableKey = rootBinding.stableKey
    phaseRoot.userData.characterPhysicsPhaseOwnership = 'action-owned'
    applyOfficialPhaseLocalTrs(phaseRoot, rootBinding)

    for (const requirement of phase.registrationBindings) {
        const segments = requirement.exactRelativePath.split('/').filter(Boolean)
        // The published schema currently provides exact TRS only for the registered leaf.
        // Unknown intermediate parents are therefore rejected rather than identity-filled.
        if (segments.length !== 1) {
            throw new Error(
                `character-physics-phase:missing-intermediate-trs:`
                + `${phase.stableKey}:${requirement.exactRelativePath}`,
            )
        }
        const childName = segments[0]!
        if (
            requirement.binding.hierarchyPath !== `${rootName}/${requirement.exactRelativePath}`
            || phaseRoot.children.some(child => child.name === childName)
        ) {
            throw new Error(
                `character-physics-phase:binding-path-mismatch:`
                + `${phase.stableKey}:${requirement.exactRelativePath}`,
            )
        }
        const child = new THREE.Group()
        child.name = childName
        child.visible = requirement.activation.gameObjectActive
            && requirement.activation.activeInHierarchy
        child.userData.characterPhysicsBindingStableKey = requirement.bindingStableKey
        child.userData.characterPhysicsComponentStableKey = requirement.componentStableKey
        child.userData.characterPhysicsComponentEnabled = requirement.activation.componentEnabled
        applyOfficialPhaseLocalTrs(child, requirement.binding)
        phaseRoot.add(child)
    }

    // The selected character object is the Viewer action-local root: TPS movement and
    // authored scene-root motion both move this parent, while published local TRS stays exact.
    binding.character.object.add(phaseRoot)
    let disposed = false
    return {
        phaseRoot,
        source: 'action-owned',
        disposeRoot() {
            if (disposed) return
            disposed = true
            phaseRoot.removeFromParent()
            phaseRoot.clear()
        },
    }
}

async function registerViewerCharacterActionPhysicsPhase(
    stableKey: string,
    rootProvider: ViewerCharacterActionPhysicsPhaseRootProvider,
    replacementReason: string,
): Promise<ViewerCharacterActionPhysicsPhaseLease> {
    const binding = selectedBinding()
    const normalizedStableKey = stableKey.trim()
    if (!binding) throw new Error('character-physics-phase:no-selected-character')
    if (!normalizedStableKey) throw new TypeError('character physics phase stableKey must be non-empty')
    const actionId = binding.characterActionPlayback.actionId
    if (
        !actionId
        || (
            binding.characterActionPlayback.status !== 'playing'
            && binding.characterActionPlayback.status !== 'paused'
        )
    ) {
        throw new Error('character-physics-phase:no-active-character-action')
    }

    releaseViewerCharacterActionPhysicsPhase(binding, replacementReason)
    const token = ++binding.characterActionPhysicsPhase.requestToken
    const characterResourceId = Number(binding.character.userData.characterId)
    setViewerCharacterActionPhysicsPhaseState(binding, {
        status: 'registering',
        stableKey: normalizedStableKey,
        actionId,
        characterResourceId,
    })
    emitCharacterActionPlaybackState(binding)

    const requestIsCurrent = (): boolean => (
        binding.characterActionPhysicsPhase.requestToken === token
        && bindingByObject.get(binding.character.object) === binding
        && scene.characterSelected?.character === binding.character
        && binding.characterActionPlayback.actionId === actionId
        && (
            binding.characterActionPlayback.status === 'playing'
            || binding.characterActionPlayback.status === 'paused'
        )
    )

    let rootHandle: ViewerCharacterActionPhysicsPhaseRootHandle | undefined
    let disposeBindings: (() => void) | undefined
    let phaseDisposed = false
    const disposePhase = (): void => {
        if (phaseDisposed) return
        phaseDisposed = true
        disposeBindings?.()
        rootHandle?.disposeRoot()
    }

    try {
        const phase = await characterPhysicsActionOptionsClient.requirePhase(normalizedStableKey)
        if (!requestIsCurrent()) throw new Error('character-physics-phase:stale-request')
        if (phase.character.characterResourceId !== characterResourceId) {
            throw new Error(
                `character-physics-phase:character-mismatch:${characterResourceId}:`
                + `${phase.character.characterResourceId}`,
            )
        }
        const attachment = getViewerCharacterPhysicsAttachment(binding.character.object)
        if (!attachment || attachment.status !== 'ready') {
            throw new Error(
                `character-physics-phase:native-physics-${attachment?.status ?? 'missing'}`,
            )
        }
        if (attachment.characterResourceId !== characterResourceId) {
            throw new Error(
                `character-physics-phase:attachment-character-mismatch:${characterResourceId}:`
                + `${attachment.characterResourceId}`,
            )
        }
        rootHandle = rootProvider(phase, binding)
        if (!(rootHandle.phaseRoot instanceof THREE.Object3D)) {
            throw new TypeError('character physics phase root must be a THREE.Object3D')
        }
        disposeBindings = registerCharacterPhysicsActionPhaseBindings(
            phase,
            rootHandle.phaseRoot,
            attachment.bindingRegistry,
        )
        if (!requestIsCurrent()) {
            throw new Error('character-physics-phase:stale-request')
        }
        binding.characterActionPhysicsPhase.active = {
            token,
            stableKey: normalizedStableKey,
            actionId,
            phaseRoot: rootHandle.phaseRoot,
            disposePhase,
        }
        setViewerCharacterActionPhysicsPhaseState(binding, {
            status: 'registered',
            stableKey: normalizedStableKey,
            actionId,
            characterResourceId,
            phaseRootName: rootHandle.phaseRoot.name,
            phaseRootParentName: rootHandle.phaseRoot.parent?.name,
            phaseRootSource: rootHandle.source,
        })
        emitCharacterActionPlaybackState(binding)
        let disposed = false
        return {
            stableKey: normalizedStableKey,
            dispose() {
                if (disposed) return
                disposed = true
                if (binding.characterActionPhysicsPhase.active?.token !== token) return
                releaseViewerCharacterActionPhysicsPhase(
                    binding,
                    'explicit action phase lease disposed',
                    true,
                )
            },
        }
    } catch (error) {
        disposePhase()
        if (requestIsCurrent()) {
            setViewerCharacterActionPhysicsPhaseState(binding, {
                status: 'fail-closed',
                stableKey: normalizedStableKey,
                actionId,
                characterResourceId,
                phaseRootName: rootHandle?.phaseRoot.name,
                phaseRootParentName: rootHandle?.phaseRoot.parent?.name,
                phaseRootSource: rootHandle?.source,
                reason: error instanceof Error ? error.message : String(error),
            })
            emitCharacterActionPlaybackState(binding)
        }
        throw error
    }
}

export async function activateViewerCharacterActionPhysicsPhase(
    stableKey: string,
): Promise<ViewerCharacterActionPhysicsPhaseLease> {
    return registerViewerCharacterActionPhysicsPhase(
        stableKey,
        (phase, binding) => createOfficialCharacterActionPhysicsPhaseRoot(phase, binding),
        'replaced by action-owned official phase root',
    )
}

export async function registerViewerCharacterActionPhysicsPhaseRoot(
    stableKey: string,
    phaseRoot: THREE.Object3D,
): Promise<ViewerCharacterActionPhysicsPhaseLease> {
    if (!(phaseRoot instanceof THREE.Object3D)) {
        throw new TypeError('character physics phase root must be a THREE.Object3D')
    }
    return registerViewerCharacterActionPhysicsPhase(
        stableKey,
        () => ({
            phaseRoot,
            source: 'external-loader',
            disposeRoot() {},
        }),
        'replaced by explicit external phase root',
    )
}

function selectedCharacterId(): number | null {
    const value = Number(scene.characterSelected?.character?.userData.characterId)
    return Number.isFinite(value) ? value : null
}

function directHomeDeclarationsForCharacter(characterId: string): DirectHomeActionDeclaration[] {
    return officialDirectHomeDeclarations.entries.filter(entry => (
        entry.characterIdentity.characterId === characterId
    )) as DirectHomeActionDeclaration[]
}

function createDirectHomeActionBinding(character: ViewerCharacter): DirectHomeActionBinding {
    const characterId = String(character.userData.characterId)
    const product = officialDirectHomeProducts.get(characterId)
    const entries = directHomeDeclarationsForCharacter(characterId)
    if (!product || entries.length === 0) {
        return {
            entries: [],
            status: 'unavailable',
            reason: 'selected character has no exact direct Home controller product',
        }
    }
    const runtime = character.userData.homeAnimationRuntime
    if (!runtime || runtime.schema !== 2 || String(runtime.characterId) !== characterId) {
        return {
            product,
            entries,
            status: 'unavailable',
            reason: `exact Home runtime schema 2 is not attached for ${characterId}`,
        }
    }
    const identities = new Map((runtime.clipIdentities ?? []).map(identity => [
        identity.sourceClipPathId,
        identity,
    ]))
    const missing = product.inventory.clips.filter(clip => {
        const identity = identities.get(clip.pathId)
        if (!identity || (identity.sourceName !== clip.name && identity.importedName !== clip.name)) return true
        return character.animation.getAnimationClipsByName(clip.name).length === 0
    })
    if (missing.length > 0) {
        return {
            product,
            entries,
            status: 'unavailable',
            reason: `exact Home runtime is missing ${missing.length} pathID-bound clips`,
        }
    }
    return {
        product,
        entries,
        status: 'attached',
        reason: `${entries.length} active-controller actions attached by exact state path/hash and clip pathID`,
    }
}

function directHomeActionDefinition(
    binding: ViewerLocomotionBinding,
    declaration: DirectHomeActionDeclaration,
): OfficialCharacterActionDefinition | undefined {
    return binding.directHomeActions.product?.profile.actions.find(action => (
        action.id === declaration.playback.profileActionId
    ))
}

function bindingForCharacterId(characterId: number | null): ViewerLocomotionBinding | undefined {
    if (characterId === null) return undefined
    return [...bindings].find(binding => Number(binding.character.userData.characterId) === characterId)
}

const embeddedNativeDungeonActionDefinitions: ReadonlyArray<{
    sourceName: string
    idSemantic: string
    semantic: NativeDungeonSemantic
    label: string
    tpsDefault: boolean
}> = [
    { sourceName: 'DungeonWait_L', idSemantic: 'idle', semantic: 'idle', label: 'Dungeon 待机', tpsDefault: true },
    { sourceName: 'DungeonWalk_L', idSemantic: 'walk', semantic: 'walk', label: 'Dungeon 行走', tpsDefault: true },
    { sourceName: 'DungeonRun_L', idSemantic: 'run', semantic: 'run', label: 'Dungeon 奔跑', tpsDefault: true },
    { sourceName: 'DungeonWalkFeceUp_L', idSemantic: 'walk-face-up', semantic: 'walk', label: 'Dungeon 行走 Face 向上', tpsDefault: false },
    { sourceName: 'DungeonWalkFeceDown_L', idSemantic: 'walk-face-down', semantic: 'walk', label: 'Dungeon 行走 Face 向下', tpsDefault: false },
    { sourceName: 'DungeonRunFeceUp_L', idSemantic: 'run-face-up', semantic: 'run', label: 'Dungeon 奔跑 Face 向上', tpsDefault: false },
    { sourceName: 'DungeonRunFeceDown_L', idSemantic: 'run-face-down', semantic: 'run', label: 'Dungeon 奔跑 Face 向下', tpsDefault: false },
]

function embeddedNativeDungeonActionEntries(
    character: ViewerCharacter,
    characterId: number,
): CharacterActionResourceEntry[] {
    const authority = officialDungeonCharacterCorpus.records.find(record => (
        record.sourceCharacterId === characterId
    ))
    if (!authority) return []
    const animationNames = new Set(character.animations)
    const objectAnimations = character.object.animations ?? []
    const entries = embeddedNativeDungeonActionDefinitions.flatMap(definition => {
        if (!animationNames.has(definition.sourceName)) return []
        const clip = authority.clips.find(candidate => candidate.name === definition.sourceName)
        const runtimeClip = objectAnimations.find(candidate => candidate.name === definition.sourceName)
        if (!clip || !runtimeClip || runtimeClip.tracks.length === 0) return []
        const modelKey = authority.logicalKey
        const entry: CharacterActionResourceEntry = {
            id: `official-dungeon:${characterId}:${definition.idSemantic}:${clip.pathID}`,
            label: definition.label,
            group: '官方探索动作',
            groupId: 'official-dungeon-locomotion',
            playback: 'loop',
            characterIdentity: {
                dungeonCharacterId: characterId,
                characterMstId: Math.trunc(characterId / 100),
                style3dCharacterMstId: characterId,
                modelKey,
                modelRootName: character.object.name || `chara_${characterId}`,
            },
            availability: {
                runtimeReady: true,
                tpsLoadable: true,
                regions: { jpMobile: false, steamJP: false, tw: true },
            },
            clip: {
                semantic: definition.semantic,
                sourceName: definition.sourceName,
                runtimeName: definition.sourceName,
                pathId: clip.pathID,
                durationSeconds: clip.durationSeconds,
                sampleRate: clip.sampleRate,
                genericBindings: clip.genericBindings,
                serializedTrackCount: runtimeClip.tracks.length,
            },
            runtime: {
                url: `embedded://dungeon/character/${characterId}/${definition.sourceName}`,
                schema: 'magius.native-dungeon-action-runtime.v1',
            },
            sourceFamily: `native-dungeon-embedded:${characterId}`,
            compatibility: {
                mode: 'native-only',
                exactModelKey: modelKey,
                crossCharacterFallback: false,
                externalAttachmentPolicy: 'body-only;external-sibling-weapon-excluded',
                rootPolicy: 'outer-controller-translation;source-applyRootMotion=false',
            },
            motionReference: {
                cycleSeconds: clip.durationSeconds,
                cadenceHz: clip.durationSeconds > 0 ? 1 / clip.durationSeconds : 0,
                authorityControllerPathId: authority.controllers[0]?.pathID ?? null,
                exactEmbeddedClip: true,
                tpsDefault: definition.tpsDefault,
                externalWeaponPolicy: authority.externalWeaponPolicy,
            },
        }
        return [entry]
    })
    const required = new Set(entries.filter(entry => (
        entry.motionReference.tpsDefault === true
    )).map(entry => entry.clip.semantic))
    return required.size === 3 ? entries : []
}

function allViewerCharacterActionEntries(): CharacterActionResourceEntry[] {
    const entries = [...characterActionCatalogEntries]
    const known = new Set(entries.map(entry => entry.id))
    for (const binding of bindings) {
        for (const entry of binding.nativeDungeonActions.embeddedEntries.values()) {
            if (known.has(entry.id)) continue
            known.add(entry.id)
            entries.push(entry)
        }
    }
    return entries
}

function controllerFreeJumpDonorRejectionReason(
    entry: CombatJumpActionResourceEntry,
): string | undefined {
    if (entry.groupId !== 'official-combat-jump-donors' || !('jumpDonor' in entry.playback)) {
        return 'TPS controller free-jump requires an official three-phase jump donor'
    }
    const donor = entry.playback.jumpDonor
    if (donor.grade !== 'A') {
        return `Grade ${donor.grade} is pose-only evidence and is not executable as a TPS free jump`
    }
    if (entry.skill.semantic === 'special') {
        return 'special/ultimate leap remains a gated combat action; TPS free jump excludes authored cinematic travel'
    }
    if (
        donor.compatibility !== 'exact-rig'
        || donor.sourceCharacterId !== entry.characterIdentity.characterId
    ) {
        return 'TPS free jump requires a same-character exact-rig donor'
    }
    if (
        donor.attachmentPolicy !== 'body-only-exclude-external-weapons'
        || donor.segments.length !== 3
        || donor.segments.some(segment => segment.rootPolicy !== 'controller-all')
    ) {
        return 'TPS free jump requires body-only takeoff/airborne/land with controller-owned root'
    }
    return undefined
}

function combatJumpConsumerAvailability(
    binding: ViewerLocomotionBinding | undefined,
    entry: CombatJumpActionResourceEntry,
    currentCharacter: boolean,
): ViewerCharacterActionCatalogEntry['consumerAvailability'] {
    if (!currentCharacter) {
        return {
            currentCharacter: false,
            status: 'not-selected',
            playable: false,
            reason: 'action belongs to another character',
        }
    }
    if (entry.availability.status !== 'source-available') {
        return {
            currentCharacter: true,
            status: 'unavailable',
            playable: false,
            reason: entry.availability.reason ?? 'official combat source is unavailable',
        }
    }
    const combat = binding?.combatJumpActions
    if (!combat || combat.status !== 'attached') {
        return {
            currentCharacter: true,
            status: combat?.status ?? 'not-requested',
            playable: false,
            reason: combat?.reason,
        }
    }
    if (entry.groupId === 'official-combat-complete-actions') {
        const required = entry.requiredExtensionTypes?.join(' / ') ?? 'camera / scene-root / VFX / cloth'
        return {
            currentCharacter: true,
            status: 'unavailable',
            playable: false,
            reason: entry.skill.semantic === 'special'
                ? incompleteSpecialCombatPreviewReason
                : `完整动作仍需 ${required} 精确消费者；同条目的 exact-model body/weapon 已在“官方战斗骨骼动作”组独立开放`,
        }
    }
    const controllerRejection = controllerFreeJumpDonorRejectionReason(entry)
    if (controllerRejection) {
        return {
            currentCharacter: true,
            status: 'unavailable',
            playable: false,
            reason: controllerRejection,
        }
    }
    const preview = combat.previewJumpSequences.get(entry.id)
    return {
        currentCharacter: true,
        status: preview ? 'attached' : 'unavailable',
        playable: !!preview,
        reason: preview ? undefined : combat.reason ?? 'exact three-phase body donor preview is unavailable',
    }
}

function combatSkeletonCatalogActionId(sourceEntryId: string): string {
    return `${combatSkeletonPreviewPrefix}${sourceEntryId}`
}

function combatSkeletonSourceActionId(catalogActionId: string): string | undefined {
    return catalogActionId.startsWith(combatSkeletonPreviewPrefix)
        ? catalogActionId.slice(combatSkeletonPreviewPrefix.length)
        : undefined
}

function combatSkeletonPhaseOrder(phase: string): number {
    if (phase === 'start') return 0
    if (phase === 'loop') return 1
    if (phase === 'end') return 2
    const segment = /^segment-(\d+)$/i.exec(phase)
    return segment ? 100 + Number(segment[1]) : 1000
}

function sortCombatSkeletonClips(
    clips: readonly LoadedCombatJumpClip[],
): readonly LoadedCombatJumpClip[] {
    return [...clips].sort((left, right) => (
        combatSkeletonPhaseOrder(left.sequencePhase) - combatSkeletonPhaseOrder(right.sequencePhase)
        || left.sequencePhase.localeCompare(right.sequencePhase, 'en')
        || left.pathId.localeCompare(right.pathId, 'en')
    ))
}

function exactCombatSkeletonPreviewEntry(
    binding: ViewerLocomotionBinding | undefined,
    entry: CombatJumpActionResourceEntry,
): ExactCombatSkeletonTemplate | undefined {
    if (entry.groupId !== 'official-combat-complete-actions') return undefined
    const loaded = binding?.combatJumpActions.loaded
    if (!loaded) return undefined
    const exact = sortCombatSkeletonClips(loaded.clips.filter(clip => (
        clip.actionId === entry.id
        && (clip.role === 'body' || clip.role === 'weapon-a')
    )))
    const bodyPhases = exact.filter(clip => clip.role === 'body')
    if (bodyPhases.length === 0) return undefined
    const bodyPhaseNames = new Set(bodyPhases.map(clip => clip.sequencePhase))
    const primaryWeapon = exact.filter(clip => clip.role === 'weapon-a')
    const primaryWeaponByPhase = new Map(primaryWeapon.map(clip => [clip.sequencePhase, clip]))
    const roles: ExactCombatSkeletonTemplateRole[] = [{
        role: 'body',
        targetId: `combat:${entry.characterIdentity.characterId}:body`,
        clips: bodyPhases,
    }]
    if ([...bodyPhaseNames].every(phase => primaryWeaponByPhase.has(phase))) {
        roles.push({
            role: 'weapon-a',
            targetId: `combat:${entry.characterIdentity.characterId}:weapon-a`,
            clips: sortCombatSkeletonClips([...bodyPhaseNames].map(phase => primaryWeaponByPhase.get(phase)!)),
        })
    }
    return {
        entry,
        bodyPhases,
        roles,
    }
}

function combatSkeletonConsumerAvailability(
    binding: ViewerLocomotionBinding | undefined,
    entry: CombatJumpActionResourceEntry,
    currentCharacter: boolean,
): ViewerCharacterActionCatalogEntry['consumerAvailability'] {
    if (!currentCharacter) {
        return {
            currentCharacter: false,
            status: 'not-selected',
            playable: false,
            reason: 'action belongs to another character',
        }
    }
    if (entry.groupId !== 'official-combat-complete-actions') {
        return {
            currentCharacter: true,
            status: 'unavailable',
            playable: false,
            reason: entry.availability.reason ?? 'official synchronized body/weapon source is unavailable',
        }
    }
    const combat = binding?.combatJumpActions
    if (!combat || combat.status !== 'attached' || !combat.loaded) {
        return {
            currentCharacter: true,
            status: combat?.status ?? 'not-requested',
            playable: false,
            reason: combat?.reason,
        }
    }
    const previewEntry = exactCombatSkeletonPreviewEntry(binding, entry)
    if (!previewEntry) {
        return {
            currentCharacter: true,
            status: 'unavailable',
            playable: false,
            reason: entry.availability.reason ?? 'exact synchronized body/weapon source is unavailable',
        }
    }
    const includesPrimaryWeapon = previewEntry.roles.some(target => target.role === 'weapon-a')
    return {
        currentCharacter: true,
        status: 'attached',
        playable: true,
        reason: `同角色 exact-model ${includesPrimaryWeapon ? 'body/主武器' : 'body-only'} 可播放模板已从 runtime 恢复；${previewEntry.bodyPhases.length} 个原始 phase 由统一时间轴连续调度；镜头、场景位移、复制附件、cloth 与 VFX 保留在完整演出门禁中`,
    }
}

function nativeDungeonActionDescriptor(
    native: NativeDungeonActionBinding,
    actionId: string,
): CharacterActionResourceEntry | undefined {
    return native.loaded?.get(actionId)?.descriptor ?? native.embeddedEntries.get(actionId)
}

function locomotionProfileCatalogEntries(
    binding: ViewerLocomotionBinding | undefined,
    characterId: number | null,
): ViewerCharacterActionCatalogEntry[] {
    if (!binding || characterId !== 101901 || !binding.characterSpecificMotionVariants) return []
    return [...binding.characterSpecificMotionVariants.values()].map(variant => ({
        id: `viewer-locomotion-profile:101901:${variant.id}`,
        label: variant.label,
        groupId: 'viewer-locomotion-profile-ab',
        group: 'TPS 移动姿态 A/B',
        playback: 'oneShot',
        playbackKind: 'oneShot',
        characterIdentity: {
            dungeonCharacterId: 101901,
            characterMstId: 1019,
            style3dCharacterMstId: 101901,
            modelKey: 'battle/character/chara_101901_battle_unit',
            modelRootName: 'chara_101901_battle_unit',
        },
        sourceKind: 'locomotion-profile',
        consumerAvailability: {
            currentCharacter: true,
            status: 'attached',
            playable: true,
            reason: binding.activeCharacterSpecificMotionVariant === variant.id
                ? '当前配置'
                : undefined,
        },
    }))
}

function directHomeActionCatalogEntries(
    binding: ViewerLocomotionBinding | undefined,
    characterId: number | null,
    includeAll: boolean,
): ViewerCharacterActionCatalogEntry[] {
    const entries = includeAll
        ? officialDirectHomeDeclarations.entries
        : officialDirectHomeDeclarations.entries.filter(entry => (
            Number(entry.characterIdentity.characterId) === characterId
        ))
    return entries.map(entry => {
        const currentCharacter = Number(entry.characterIdentity.characterId) === characterId
        const exactBinding = currentCharacter ? binding?.directHomeActions : undefined
        const action = currentCharacter && binding
            ? directHomeActionDefinition(binding, entry)
            : undefined
        const playable = exactBinding?.status === 'attached'
            && !!action
            && action.id === entry.playback.profileActionId
            && exactBinding.product?.profile.controller.pathId === entry.playback.controllerPathId
        return {
            id: entry.id,
            label: entry.label,
            groupId: entry.groupId,
            group: entry.group,
            playback: entry.playbackKind,
            playbackKind: entry.playbackKind,
            characterIdentity: entry.characterIdentity,
            availability: entry.availability,
            sourceKind: 'direct-home',
            consumerAvailability: {
                currentCharacter,
                status: currentCharacter
                    ? exactBinding?.status ?? 'unavailable'
                    : 'not-selected',
                playable,
                reason: currentCharacter
                    ? playable
                        ? `${entry.playback.controllerPathId} exact active-controller / embedded-rig`
                        : exactBinding?.reason ?? 'exact direct Home binding is unavailable'
                    : undefined,
            },
        }
    })
}

function viewerCharacterActionCatalogSnapshot(
    characterId: number | null = selectedCharacterId(),
    includeAll = false,
): ViewerCharacterActionCatalogSnapshot {
    const binding = bindingForCharacterId(characterId)
    const locomotionProfileEntries = locomotionProfileCatalogEntries(binding, characterId)
    const directHomeEntries = directHomeActionCatalogEntries(binding, characterId, includeAll)
    const allEntries = allViewerCharacterActionEntries()
    const nativeEntries = (includeAll
        ? allEntries
        : allEntries.filter(entry => (
            entry.characterIdentity.dungeonCharacterId === characterId
        ))
    ).map<ViewerCharacterActionCatalogEntry>(entry => {
        const currentCharacter = entry.characterIdentity.dungeonCharacterId === characterId
        const native = currentCharacter ? binding?.nativeDungeonActions : undefined
        const playable = !!native
            && native.status === 'attached'
            && !!nativeDungeonActionDescriptor(native, entry.id)
        return {
            ...entry,
            sourceKind: 'native-dungeon',
            consumerAvailability: {
                currentCharacter,
                status: currentCharacter
                    ? native?.status ?? 'not-requested'
                    : 'not-selected',
                playable,
                reason: currentCharacter ? native?.reason : undefined,
            },
        }
    })
    // Raw complete-action and jump-donor entries are authority/evidence.  Keep
    // them in catalogAll(), but do not duplicate executable templates as gray
    // rows in the standard user selector.
    const combatEvidenceEntries = (includeAll ? combatJumpCatalogEntries : [])
        .map<ViewerCharacterActionCatalogEntry>(entry => {
        const currentCharacter = Number(entry.characterIdentity.characterId) === characterId
        return {
            id: entry.id,
            label: entry.label,
            groupId: entry.groupId,
            group: entry.group,
            playback: entry.playbackKind,
            playbackKind: entry.playbackKind,
            characterIdentity: entry.characterIdentity,
            availability: entry.availability,
            sourceKind: 'combat-jump',
            consumerAvailability: combatJumpConsumerAvailability(binding, entry, currentCharacter),
        }
    })
    const combatSkeletonEntries = (includeAll
        ? combatJumpCatalogEntries
        : combatJumpCatalogEntries.filter(entry => (
            Number(entry.characterIdentity.characterId) === characterId
        ))
    ).filter(entry => (
        entry.groupId === 'official-combat-complete-actions'
        && (
            ('synchronizedAction' in entry.playback
                && entry.playback.synchronizedAction.targets.length > 0)
            || entry.requiredComponents?.some(component => component.role === 'body')
        )
    )).map<ViewerCharacterActionCatalogEntry>(entry => {
        const currentCharacter = Number(entry.characterIdentity.characterId) === characterId
        const previewEntry = currentCharacter
            ? exactCombatSkeletonPreviewEntry(binding, entry)
            : undefined
        const includesPrimaryWeapon = previewEntry
            ? previewEntry.roles.some(target => target.role === 'weapon-a')
            : entry.requiredComponents?.some(component => component.role === 'weapon-a') ?? false
        const templateRoleLabel = includesPrimaryWeapon ? 'body/主武器' : 'body-only'
        return {
            id: combatSkeletonCatalogActionId(entry.id),
            label: `${entry.label} · ${templateRoleLabel}（可播放模板）`,
            groupId: 'official-combat-body-weapon-actions',
            group: '官方战斗模板动作（主体 / 主武器）',
            playback: 'timeline',
            playbackKind: 'timeline',
            characterIdentity: entry.characterIdentity,
            availability: entry.availability,
            sourceKind: 'combat-skeleton-preview',
            consumerAvailability: combatSkeletonConsumerAvailability(binding, entry, currentCharacter),
        }
    })
    return {
        schema: 'magius.viewer-character-action-catalog.v1',
        loadStatus: characterActionCatalogLoadStatus,
        selectedCharacterId: characterId,
        entries: [
            ...locomotionProfileEntries,
            ...nativeEntries,
            ...directHomeEntries,
            ...combatSkeletonEntries,
            ...combatEvidenceEntries,
        ],
        error: characterActionCatalogError,
    }
}

function emitCharacterActionCatalogChange(): void {
    const snapshot = viewerCharacterActionCatalogSnapshot()
    emitViewerEvent('magius:character-action-catalog-change', snapshot)
    for (const listener of characterActionCatalogSubscribers) listener(snapshot)
}

function emitCharacterActionPlaybackState(binding: ViewerLocomotionBinding): void {
    binding.characterActionPlayback.playbackRate = binding.characterActionPlaybackRate
    const state = cloneCharacterActionPlaybackState(
        binding.characterActionPlayback,
        binding.characterActionPhysicsPhase.state,
        binding.characterActionPlaybackRate,
    )
    binding.characterActionPlayback.physicsPhase = { ...state.physicsPhase }
    emitViewerEvent('magius:character-action-playback-state', state)
    for (const listener of characterActionStateSubscribers) listener(state)
}

async function ensureCharacterActionCatalog(): Promise<readonly CharacterActionResourceEntry[]> {
    if (characterActionCatalogLoadStatus === 'ready') return characterActionCatalogEntries
    if (characterActionCatalogPromise) return characterActionCatalogPromise
    characterActionCatalogLoadStatus = 'loading'
    characterActionCatalogError = undefined
    emitCharacterActionCatalogChange()
    characterActionCatalogPromise = Promise.all([
        characterActionResourceManager.listActions(),
        characterActionResourceManager.listCombatJumpActions(),
    ])
        .then(([entries, combatEntries]) => {
            characterActionCatalogEntries = entries
            combatJumpCatalogEntries = combatEntries
            characterActionCatalogLoadStatus = 'ready'
            emitCharacterActionCatalogChange()
            return entries
        })
        .catch(error => {
            characterActionCatalogLoadStatus = 'error'
            characterActionCatalogError = error instanceof Error ? error.message : String(error)
            emitCharacterActionCatalogChange()
            throw error
        })
    return characterActionCatalogPromise
}

function collectNativeDungeonExternalAttachments(
    character: ViewerCharacter,
): NativeDungeonExternalAttachmentState[] {
    const attachments: NativeDungeonExternalAttachmentState[] = []
    character.object.traverse(object => {
        if (!/^chara_\d+_weapon_[a-z0-9_]*model$/i.test(object.name)) return
        attachments.push({
            object,
            visible: object.visible,
            restPosition: object.position.clone(),
            restQuaternion: object.quaternion.clone(),
            restScale: object.scale.clone(),
        })
    })
    return attachments
}

function restoreExternalAttachmentModelRoot(
    attachment: Pick<
        NativeDungeonExternalAttachmentState,
        'object' | 'restPosition' | 'restQuaternion' | 'restScale'
    >,
): void {
    attachment.object.position.copy(attachment.restPosition)
    attachment.object.quaternion.copy(attachment.restQuaternion)
    attachment.object.scale.copy(attachment.restScale)
    attachment.object.updateMatrix()
    attachment.object.updateWorldMatrix(false, true)
}

function setNativeDungeonExternalAttachmentsHidden(
    binding: ViewerLocomotionBinding,
    hidden: boolean,
): void {
    for (const attachment of binding.nativeDungeonActions.externalAttachments) {
        restoreExternalAttachmentModelRoot(attachment)
        attachment.object.visible = hidden ? false : attachment.visible
    }
}

function combatSkeletonAttachments(
    binding: ViewerLocomotionBinding,
    roles: readonly CombatSkeletonRolePlayback[],
): CombatSkeletonAttachmentPlayback[] {
    if (binding.nativeDungeonActions.externalAttachments.length === 0) {
        binding.nativeDungeonActions.externalAttachments = collectNativeDungeonExternalAttachments(
            binding.character,
        )
    }
    const result: CombatSkeletonAttachmentPlayback[] = []
    for (const role of roles) {
        const match = /^weapon-([a-z0-9_]+)$/i.exec(role.role)
        if (!match) continue
        const modelSuffix = `_weapon_${match[1].replace(/-/g, '_')}_model`
        const attachment = binding.nativeDungeonActions.externalAttachments.find(candidate => (
            candidate.object.name.toLowerCase().endsWith(modelSuffix.toLowerCase())
        ))
        if (!attachment) continue
        // Official weapon clips animate their sibling weapon rig in the same
        // model/VisualRoot coordinate system as the body.  Re-parenting or
        // snapping the sibling model root to Weapon_L/Weapon_R applies the hand
        // transform a second time and is the shared cause of floating weapons.
        result.push({
            object: attachment.object,
            restPosition: attachment.restPosition,
            restQuaternion: attachment.restQuaternion,
            restScale: attachment.restScale,
            policy: 'authored-model-space-root',
        })
    }
    return result
}

function applyCombatSkeletonAttachmentPose(
    attachment: CombatSkeletonAttachmentPlayback,
    rootOffsetWorld?: THREE.Vector3,
): void {
    restoreExternalAttachmentModelRoot(attachment)
    if (rootOffsetWorld) {
        const offset = rootOffsetWorld.clone()
        if (attachment.object.parent) {
            attachment.object.parent.updateWorldMatrix(true, false)
            const inverseParent = attachment.object.parent.matrixWorld.clone().invert()
            offset.applyMatrix3(new THREE.Matrix3().setFromMatrix4(inverseParent))
        }
        attachment.object.position.add(offset)
        attachment.object.updateMatrix()
        attachment.object.updateWorldMatrix(false, true)
    }
    attachment.object.visible = true
}

function nativeDungeonActionForSemantic(
    native: NativeDungeonActionBinding,
    semantic: NativeDungeonSemantic,
): CharacterActionResourceEntry | undefined {
    const neutralSourceName = semantic === 'idle'
        ? 'DungeonWait_L'
        : semantic === 'walk'
            ? 'DungeonWalk_L'
            : 'DungeonRun_L'
    return native.entries.find(entry => (
        entry.clip.semantic === semantic
        && entry.clip.sourceName === neutralSourceName
    )) ?? native.entries.find(entry => entry.clip.semantic === semantic)
}

function nativeDungeonLocomotionAnimations(
    binding: ViewerLocomotionBinding,
): LocomotionAnimationMap {
    const native = binding.nativeDungeonActions
    const authoredIdle = nativeDungeonActionForSemantic(native, 'idle')?.clip.runtimeName
    // 100102's exact DungeonWait is an authored upward-looking pose (about
    // +32 degrees at the head).  Keep it in the manual official catalog, while
    // TPS locomotion starts from the character's own neutral HomeWait01 base.
    const neutralCharacterIdle = native.dungeonCharacterId === 100102
        ? findFamily(binding.character.animations, [/^HomeWait01_L$/i])
        : undefined
    const idle = neutralCharacterIdle ?? authoredIdle
    const walk = nativeDungeonActionForSemantic(native, 'walk')?.clip.runtimeName
    const run = nativeDungeonActionForSemantic(native, 'run')?.clip.runtimeName
    if (!idle || !walk || !run) {
        throw new Error(`Native Dungeon ${native.dungeonCharacterId} requires exact idle/walk/run actions`)
    }
    // The official Dungeon corpus has no jump/fall/land clips. Those states are
    // mapped to exact native idle as a fail-closed fallback; activateNative...
    // overlays verified target-rig jump channels when the jump profile attached.
    return { idle, walk, run, jump: idle, fall: idle, land: idle }
}

function isNativeDungeonAnimation(
    binding: ViewerLocomotionBinding,
    name: string | undefined,
): boolean {
    return !!name && binding.nativeDungeonActions.entries.some(entry => (
        familyEquals(name, entry.clip.runtimeName)
    ))
}

function createViewerLocomotionController(
    binding: () => ViewerLocomotionBinding,
    character: ViewerCharacter,
    collision: ViewerSceneCollisionWorld,
    animation: CharacterAnimationPort,
    locomotionAnimations: LocomotionAnimationMap,
    gaitCalibration?: CharacterSpecificMotionProfile['gaitCalibration'],
    jumpTiming?: Pick<ExactCombatJumpLocomotionClips, 'takeoffSeconds' | 'landSeconds'>,
    jumpLocomotionAnimations?: JumpLocomotionAnimationMap,
): CharacterLocomotionController {
    return new CharacterLocomotionController({
        characterId: String(character.userData.characterId),
        transform: character.object,
        animation,
        collisionWorld: collision,
        groundQuery: collision,
        rootMotionMode: 'controlled',
        locomotionAnimations,
        jumpLocomotionAnimations,
        config: {
            fixedStepSeconds: 1 / 60,
            maxSubSteps: 3,
            walkSpeed: gaitCalibration?.walkSpeedMetersPerSecond ?? 1.55,
            runSpeed: gaitCalibration?.runSpeedMetersPerSecond ?? 3.65,
            groundAcceleration: gaitCalibration ? 4.2 : 12,
            groundDeceleration: gaitCalibration ? 6.5 : 16,
            airAcceleration: gaitCalibration ? 2.4 : 4.5,
            gravity: gaitCalibration ? 10.8 : 15,
            jumpSpeed: gaitCalibration ? 4.4 : 5.4,
            jumpTakeoffDelaySeconds: jumpTiming?.takeoffSeconds
                ?? (gaitCalibration ? 0.22 : 0.14),
            terminalFallSpeed: 16,
            turnSpeedRadians: Math.PI * 4.5,
            landingDurationSeconds: jumpTiming?.landSeconds
                ?? (gaitCalibration ? 0.36 : 0.28),
            groundSnapDistance: 0.16,
            maximumSlopeRadians: THREE.MathUtils.degToRad(46),
            colliderRadius: 0.25,
            colliderHeight: 1.7000000476837158,
            colliderCenterX: 0,
            colliderCenterY: 0.8500000238418579,
            colliderCenterZ: 0,
            colliderUpAxis: 'y',
            colliderSkinWidth: 0.015,
            requireSceneCollision: true,
        },
        initiallyGrounded: true,
        onStateChange: (state, previous) => {
            emitViewerEvent('magius:locomotion-state', {
                characterId: character.userData.characterId,
                state,
                previous,
            })
        },
        onActionEvent: event => {
            const current = binding()
            if (event.type === 'started' || event.type === 'rejected') current.pendingAction = false
            if (event.type === 'started' && event.action.semantic === 'ultimate') {
                current.secondaryPhysics?.reset()
            }
            feedbackOutput.value = event.type === 'rejected'
                ? `${event.actionId}: ${event.reason}`
                : `${event.type}: ${'action' in event ? event.action.clipName : event.actionId}`
            feedbackOutput.textContent = feedbackOutput.value
            emitViewerEvent('magius:combat-action', event)
        },
        onEffectCue: emitViewerCombatEffectCue,
    })
}

function activateCharacterSpecificMotionVariant(
    binding: ViewerLocomotionBinding,
    variantId: string,
): CharacterSpecificMotionVariant | undefined {
    const variant = binding.characterSpecificMotionVariants?.get(variantId)
    if (!variant || variant.profile.status !== 'attached') return undefined
    // Capture the last rendered mixer pose before replacing the TPS family.
    // The bridge's first frame has zero blend, so activation never writes a
    // bind/rest pose between the authored family and the new idle family.
    if (enabled) binding.tpsPoseTransition?.begin()
    if (
        characterActionPlaybackBlocksLocomotion(binding)
        || binding.combatJumpActions.activeJumpDonorPlayback
    ) {
        interruptViewerCharacterAction(binding, `locomotion profile switched to ${variantId}`)
    }
    const exactJump = binding.combatJumpActions.exactLocomotion
    const locomotionAnimations: LocomotionAnimationMap = exactJump ? {
        ...variant.animations,
        jump: exactJump.takeoff,
        fall: exactJump.airborne,
        land: exactJump.land,
    } : { ...variant.animations }
    const animationPort = createAnimationPort(
        binding.character,
        undefined,
        createTargetRigLocomotionTransitionPolicy(locomotionAnimations, variant.jumpAnimations),
    )
    binding.controller.setInput({ moveX: 0, moveZ: 0, run: false, jumpPressed: false })
    binding.animationPort = animationPort
    binding.locomotionAnimations = locomotionAnimations
    binding.characterSpecificMotion = variant.profile
    binding.activeCharacterSpecificMotionVariant = variantId
    binding.postAnimationWalkClearance?.setActive(enabled && variantId === 'set-a')
    binding.controller = createViewerLocomotionController(
        () => binding,
        binding.character,
        binding.collision,
        animationPort,
        locomotionAnimations,
        variant.profile.gaitCalibration,
        exactJump,
        variant.jumpAnimations,
    )
    binding.snapshot = binding.controller.snapshot()
    binding.animationPlaybackRate = 1
    setNativeDungeonExternalAttachmentsHidden(binding, true)
    binding.secondaryPhysics?.reset()
    if (enabled && scene.characterSelected?.character === binding.character) {
        animationPort.play(primaryLocomotionAnimation(locomotionAnimations.idle)!, {
            loop: true,
            speed: 1,
            weight: 1,
            fadeSeconds: 0.12,
        })
    }
    configureActionSelectors(binding)
    emitCharacterActionCatalogChange()
    updateHud(binding)
    return variant
}

function activateNativeDungeonController(binding: ViewerLocomotionBinding): void {
    const native = binding.nativeDungeonActions
    if (native.status !== 'attached') return
    const current = binding.character.animation.current
    if (current && !isNativeDungeonAnimation(binding, current)) native.baselineAnimation = current
    const nativeLocomotionAnimations = nativeDungeonLocomotionAnimations(binding)
    const exactJump = binding.combatJumpActions.exactLocomotion
    const jumpAnimations = binding.characterSpecificMotion.jumpAnimations
    const locomotionAnimations: LocomotionAnimationMap = exactJump ? {
        ...nativeLocomotionAnimations,
        jump: exactJump.takeoff,
        fall: exactJump.airborne,
        land: exactJump.land,
    } : jumpAnimations?.standing ? {
        ...nativeLocomotionAnimations,
        jump: jumpAnimations.standing.jump,
        fall: jumpAnimations.standing.fall,
        land: jumpAnimations.standing.land,
    } : nativeLocomotionAnimations
    const animationPort = createAnimationPort(
        binding.character,
        undefined,
        undefined,
        createNativeDungeonFixedTransitionPolicy(
            native.dungeonCharacterId,
            native.entries,
            normalizeAnimationFamilyName,
        ),
    )
    binding.animationPort = animationPort
    binding.locomotionAnimations = locomotionAnimations
    binding.controller = createViewerLocomotionController(
        () => binding,
        binding.character,
        binding.collision,
        animationPort,
        locomotionAnimations,
        undefined,
        exactJump,
        jumpAnimations,
    )
    binding.snapshot = binding.controller.snapshot()
    binding.animationPlaybackRate = 1
    native.active = true
    native.controllerReady = true
    setNativeDungeonExternalAttachmentsHidden(binding, true)
}

function deactivateNativeDungeonPresentation(
    binding: ViewerLocomotionBinding,
    restoreBaseline: boolean,
): void {
    const native = binding.nativeDungeonActions
    native.active = false
    native.controllerReady = false
    setNativeDungeonExternalAttachmentsHidden(binding, false)
    binding.character.animation.paused = false
    binding.character.animation.mixer.timeScale = 1
    if (!restoreBaseline || !isNativeDungeonAnimation(binding, binding.character.animation.current)) return
    const baseline = native.baselineAnimation ?? binding.character.animation.default
    if (baseline && !isNativeDungeonAnimation(binding, baseline)) {
        binding.character.animation.play(baseline, true)
    }
}

function nativeDungeonSafety(characterId: number, modelKey: string): ViewerRigSafety {
    return {
        characterId,
        status: 'verified',
        movementPolicy: 'rig-locomotion',
        allowMovement: true,
        allowJumpSequence: false,
        allowCrossCharacterDungeon: false,
        allowCombatActions: false,
        allowProceduralBones: false,
        allowSecondaryFallback: false,
        allowCharacterSpecificMotion: false,
        allowCharacterSpecificSecondaryPhysics: false,
        reason: `exact native Dungeon model/rig/clip attachment verified for ${modelKey}; body-only; external sibling weapon excluded; jump remains unavailable`,
    }
}

function embeddedDungeonSafety(characterId: number): ViewerRigSafety {
    return {
        characterId,
        status: 'verified',
        movementPolicy: 'rig-locomotion',
        allowMovement: true,
        allowJumpSequence: false,
        allowCrossCharacterDungeon: false,
        allowCombatActions: false,
        allowProceduralBones: false,
        allowSecondaryFallback: false,
        allowCharacterSpecificMotion: false,
        allowCharacterSpecificSecondaryPhysics: false,
        reason: 'selected model already carries its own exact Dungeon idle/walk/run families; no cross-character clip or external sibling weapon is used',
    }
}

/** Native Dungeon keeps its exact idle/walk/run families, but may add only the
 * parameterized target-rig standing/walking/running jump channels.  This is
 * deliberately independent of the combat-action download. */
function nativeDungeonJumpSafety(characterId: number): ViewerRigSafety {
    return {
        ...embeddedDungeonSafety(characterId),
        allowJumpSequence: true,
        reason: 'exact native Dungeon idle/walk/run retained; parameterized target-rig standing/walking/running jump channels attached; combat leaps excluded',
    }
}

function parameterizedTargetRigSafety(characterId: number, genericMagicalGirl = false): ViewerRigSafety {
    return {
        characterId,
        status: 'verified',
        movementPolicy: 'rig-locomotion',
        allowMovement: true,
        // Target-rig profiles carry an ordinary standing/walking/running jump
        // authored from the normalized corpus. Cinematic combat leaps stay in
        // the explicit action catalog and never replace Space.
        allowJumpSequence: characterId === 101901 || targetRigMorphologyCharacterIds.has(characterId) || genericMagicalGirl,
        allowCrossCharacterDungeon: false,
        allowCombatActions: characterId === 101901,
        allowProceduralBones: false,
        allowSecondaryFallback: false,
        allowCharacterSpecificMotion: true,
        allowCharacterSpecificSecondaryPhysics: characterId === 101901,
        reason: characterId === 101901
            ? 'target-rig locomotion plus scoped 101901 hair/skirt solver with swept split-arm capsules; body-only and external sibling weapons excluded'
            : 'target-rig morphology-nearest full-path/inverse-bind locomotion plus ordinary controller-root Space jump attached; corpus transfers parameters only; cinematic combat leaps and external sibling weapons excluded',
    }
}

function promoteAttachedCombatJumpSafety(binding: ViewerLocomotionBinding): void {
    const combat = binding.combatJumpActions
    if (combat.status !== 'attached') return
    const baseReason = binding.safety.reason.replace(/; jump=[^;]+$/, '')
    binding.safety = {
        ...binding.safety,
        status: 'verified',
        allowJumpSequence: true,
        reason: `${baseReason}; jump=${combat.exactLocomotion
            ? `same-character exact-rig three-phase lower body ${combat.exactLocomotion.donorEntryId}`
            : binding.characterSpecificMotion.jumpCalibration
                ? 'target-rig human takeoff/air/land with controller-owned root; combat leaps excluded from Space'
                : 'controller-root three-phase own-pose fallback; combat leaps excluded from Space'}`,
    }
}

function nativeDungeonErrorDetail(error: unknown): { errorCode: string; reason: string } {
    if (error instanceof CharacterActionResourceError) {
        return { errorCode: error.code, reason: error.message }
    }
    return {
        errorCode: 'ACTION_CONSUMER_ERROR',
        reason: error instanceof Error ? error.message : String(error),
    }
}

function exactCombatJumpSubclip(
    source: THREE.AnimationClip,
    name: string,
    startSeconds: number,
    endSeconds: number,
    sampleRate: number,
): THREE.AnimationClip {
    const firstFrame = Math.round(startSeconds * sampleRate)
    const lastFrame = Math.round(endSeconds * sampleRate)
    if (lastFrame <= firstFrame) {
        throw new Error(`combat jump segment ${name} has no positive sampled window`)
    }
    const clip = THREE.AnimationUtils.subclip(source, name, firstFrame, lastFrame, sampleRate)
    clip.name = name
    clip.duration = (lastFrame - firstFrame) / sampleRate
    return clip
}

function retimeCombatJumpPhase(
    clip: THREE.AnimationClip,
    durationSeconds: number,
): THREE.AnimationClip {
    const scale = durationSeconds / Math.max(clip.duration, 1e-6)
    for (const track of clip.tracks) {
        for (let index = 0; index < track.times.length; index += 1) {
            track.times[index] *= scale
        }
    }
    clip.duration = durationSeconds
    clip.resetDuration()
    return clip
}

function loadedCombatBodyClip(
    loaded: LoadedCombatJumpActionSet,
    pathId: string,
    runtimeName: string,
): THREE.AnimationClip | undefined {
    return loaded.clips.find(candidate => (
        candidate.role === 'body'
        && candidate.pathId === pathId
        && candidate.clip.name === runtimeName
    ))?.clip
}

function attachCombatJumpPreviewClips(
    binding: ViewerLocomotionBinding,
    loaded: LoadedCombatJumpActionSet,
    entries: readonly CombatJumpActionResourceEntry[],
): {
    previews: Map<string, string>
    sequences: Map<string, CombatJumpPreviewSequence>
} {
    const previews = new Map<string, string>()
    const sequences = new Map<string, CombatJumpPreviewSequence>()
    const generated: THREE.AnimationClip[] = []
    for (const entry of entries) {
        if (
            entry.groupId !== 'official-combat-jump-donors'
            || entry.availability.status !== 'source-available'
            || !('jumpDonor' in entry.playback)
            || controllerFreeJumpDonorRejectionReason(entry)
        ) continue
        const segments = entry.playback.jumpDonor.segments
        if (segments.length !== 3) continue
        const sourceNames = new Set(segments.map(segment => segment.sourceClip.name))
        const sourcePathIds = new Set(segments.map(segment => segment.sourceClip.pathId))
        if (sourceNames.size !== 1 || sourcePathIds.size !== 1) continue
        const first = segments[0]
        const source = loadedCombatBodyClip(
            loaded,
            first.sourceClip.pathId,
            first.sourceClip.name,
        )
        if (!source) continue
        const phaseNames = {
            jump: `MagiusCombatJumpTakeoffV29_${entry.characterIdentity.characterId}_${first.sourceClip.pathId}_SE`,
            fall: `MagiusCombatJumpAirborneV29_${entry.characterIdentity.characterId}_${first.sourceClip.pathId}_L`,
            land: `MagiusCombatJumpLandV29_${entry.characterIdentity.characterId}_${first.sourceClip.pathId}_SE`,
        }
        const targetDurations = { jump: 0.26, fall: 0.80, land: 0.34 } as const
        const phaseKeys = ['jump', 'fall', 'land'] as const
        for (const [index, phaseKey] of phaseKeys.entries()) {
            const segment = segments[index]
            generated.push(retimeCombatJumpPhase(exactCombatJumpSubclip(
                source,
                phaseNames[phaseKey],
                segment.sourceStartSeconds,
                segment.sourceEndSeconds,
                segment.sourceClip.sampleRate,
            ), targetDurations[phaseKey]))
        }
        previews.set(entry.id, phaseNames.jump)
        sequences.set(entry.id, {
            ...phaseNames,
            durationSeconds: targetDurations.jump + targetDurations.fall + targetDurations.land,
        })
    }
    const generatedNames = new Set(generated.map(clip => clip.name))
    binding.character.object.animations = [
        ...binding.character.object.animations.filter(clip => !generatedNames.has(clip.name)),
        ...generated,
    ]
    return { previews, sequences }
}

async function ensureCombatSpecialWeapon(binding: ViewerLocomotionBinding, sourceId: string): Promise<void> {
    const definition = specialWeaponDefinitions.find(value => value.actionId === sourceId
        && value.characterId === binding.combatJumpActions.characterId)
    if (!definition) return
    const combat = binding.combatJumpActions
    combat.specialWeapons ??= new Map()
    combat.specialWeaponLoads ??= new Map()
    if (combat.specialWeapons.has(sourceId)) return
    let loading = combat.specialWeaponLoads.get(sourceId)
    if (!loading) {
        loading = loadSpecialWeapon(definition, combat.abortController?.signal).then(weapon => {
            if (combat.status === 'disposed' || binding.character.disposed) {
                weapon.dispose(); throw new Error('Character detached during special weapon load')
            }
            weapon.reset()
            combat.specialWeapons!.set(sourceId, weapon)
            return weapon
        })
        combat.specialWeaponLoads.set(sourceId, loading)
    }
    try { await loading }
    finally { if (combat.specialWeaponLoads.get(sourceId) === loading) combat.specialWeaponLoads.delete(sourceId) }
}

function ensureCombatJumpActions(binding: ViewerLocomotionBinding): Promise<void> {
    const combat = binding.combatJumpActions
    if (combat.ready) return combat.ready
    combat.loadAttempts += 1
    combat.status = 'loading'
    const abortController = new AbortController()
    combat.abortController = abortController
    emitCharacterActionCatalogChange()
    combat.ready = (async () => {
        try {
            await ensureCharacterActionCatalog()
            const entries = combatJumpCatalogEntries.filter(entry => (
                entry.characterIdentity.characterId === combat.characterId
            ))
            combat.entries = entries
            if (entries.length === 0) {
                combat.status = 'unavailable'
                combat.reason = `no official combat/jump catalog for character ${combat.characterId}`
                return
            }
            const runtimeEntry = entries.find(entry => (
                entry.availability.status === 'source-available'
                && typeof entry.resource.runtimeUrl === 'string'
            ))
            if (!runtimeEntry) {
                combat.status = 'unavailable'
                combat.reason = `no source-available combat/jump runtime for character ${combat.characterId}`
                return
            }
            const loaded = await characterActionResourceManager.attachCombatJumpActions(
                combat.characterId,
                runtimeEntry.resource.modelKey,
                binding.character.object as THREE.Object3D & { animations: THREE.AnimationClip[] },
                abortController.signal,
            )
            if (combat.status === 'disposed' || binding.character.disposed) return
            combat.loaded = loaded
            const jumpPreviews = attachCombatJumpPreviewClips(binding, loaded, entries)
            combat.previewClips = jumpPreviews.previews
            combat.previewJumpSequences = jumpPreviews.sequences
            // A bounded combat leap is evidence for an explicit combat action,
            // not authority for the ordinary Space jump. Keep every exact donor
            // in the action catalog/preview, while locomotion retains the
            // selected character's target-rig human takeoff/air/land clips.
            combat.exactLocomotion = undefined
            combat.jumpReason = 'Space uses target-rig human takeoff/air/land; complex combat leaps remain explicit action entries'
            combat.status = 'attached'
            combat.errorCode = undefined
            combat.reason = `exact-model combat body/weapon runtime attached; ${combat.jumpReason}`
            promoteAttachedCombatJumpSafety(binding)
            if (scene.characterSelected?.character === binding.character) configureActionSelectors(binding)
        } catch (error) {
            if (combat.abortController?.signal.aborted || binding.character.disposed) {
                combat.status = 'disposed'
                combat.reason = 'character detached while combat/jump runtime was loading'
                return
            }
            const detail = nativeDungeonErrorDetail(error)
            combat.errorCode = detail.errorCode
            if (combat.loadAttempts < 2) {
                combat.status = 'loading'
                combat.reason = `retrying combat/jump runtime once after ${detail.errorCode}: ${detail.reason}`
                combat.ready = undefined
                combat.abortController = undefined
                window.setTimeout(() => {
                    if (!binding.character.disposed && combat.status === 'loading') {
                        void ensureCombatJumpActions(binding)
                    }
                }, 120)
            } else {
                combat.status = 'error'
                combat.reason = detail.reason
            }
        } finally {
            emitCharacterActionCatalogChange()
            if (scene.characterSelected?.character === binding.character) updateHud(binding)
        }
    })()
    return combat.ready
}

function validateNativeDungeonEntries(
    characterId: number,
    entries: readonly CharacterActionResourceEntry[],
): string {
    const semantics = new Set(entries.map(entry => entry.clip.semantic))
    if (
        entries.length !== 3
        || semantics.size !== 3
        || !semantics.has('idle')
        || !semantics.has('walk')
        || !semantics.has('run')
    ) throw new Error(`Native Dungeon ${characterId} catalog must contain exact idle/walk/run entries`)
    const modelKeys = new Set(entries.map(entry => entry.characterIdentity.modelKey))
    if (
        modelKeys.size !== 1
        || entries.some(entry => (
            entry.characterIdentity.dungeonCharacterId !== characterId
            || entry.playback !== 'loop'
            || entry.groupId !== 'official-dungeon-locomotion'
            || !entry.availability.runtimeReady
            || !entry.availability.tpsLoadable
            || entry.compatibility.mode !== 'native-only'
            || entry.compatibility.crossCharacterFallback !== false
            || entry.compatibility.exactModelKey !== entry.characterIdentity.modelKey
            || !entry.compatibility.externalAttachmentPolicy.includes('external-sibling-weapon-excluded')
        ))
    ) throw new Error(`Native Dungeon ${characterId} catalog compatibility contract mismatch`)
    return entries[0].characterIdentity.modelKey
}

function ensureNativeDungeonActions(binding: ViewerLocomotionBinding): Promise<void> {
    const native = binding.nativeDungeonActions
    if (native.ready) return native.ready
    native.loadAttempts += 1
    native.status = 'loading'
    const abortController = new AbortController()
    native.abortController = abortController
    emitCharacterActionCatalogChange()
    native.ready = (async () => {
        try {
            const embeddedEntries = embeddedNativeDungeonActionEntries(
                binding.character,
                native.dungeonCharacterId,
            )
            if (embeddedEntries.length > 0) {
                const modelKey = embeddedEntries[0].characterIdentity.modelKey
                native.source = 'embedded-exact'
                native.entries = embeddedEntries
                native.embeddedEntries = new Map(embeddedEntries.map(entry => [entry.id, entry]))
                native.modelKey = modelKey
                native.loaded = undefined
                native.externalAttachments = collectNativeDungeonExternalAttachments(binding.character)
                native.baselineAnimation = binding.character.animation.current
                    ?? binding.character.animation.default
                native.status = 'attached'
                native.reason = 'exact embedded native Dungeon clips attached; neutral Wait/Walk/Run drive TPS; Face variants remain explicit catalog actions; external sibling weapons excluded'
                binding.safety = binding.characterSpecificMotion.status === 'attached'
                    ? nativeDungeonJumpSafety(native.dungeonCharacterId)
                    : embeddedDungeonSafety(native.dungeonCharacterId)
                if (enabled) activateNativeDungeonController(binding)
                void ensureCharacterActionCatalog().catch(() => undefined)
                return
            }
            await ensureCharacterActionCatalog()
            const entries = await characterActionResourceManager.listCharacterActions(
                native.dungeonCharacterId,
            )
            if (entries.length === 0) {
                native.status = 'unavailable'
                native.reason = `no native Dungeon action resource for character ${native.dungeonCharacterId}`
                return
            }
            const modelKey = validateNativeDungeonEntries(native.dungeonCharacterId, entries)
            native.source = 'resource-runtime'
            native.entries = entries
            native.embeddedEntries = new Map()
            native.modelKey = modelKey
            const loaded = await characterActionResourceManager.attachCharacterActions(
                native.dungeonCharacterId,
                modelKey,
                binding.character.object as THREE.Object3D & { animations: THREE.AnimationClip[] },
                abortController.signal,
            )
            if (native.status === 'disposed' || binding.character.disposed) return
            native.loaded = loaded
            native.externalAttachments = collectNativeDungeonExternalAttachments(binding.character)
            native.baselineAnimation = binding.character.animation.current
                ?? binding.character.animation.default
            native.status = 'attached'
            native.errorCode = undefined
            native.reason = 'exact native Dungeon runtime attached; Root.position suppressed; external sibling weapons excluded'
            binding.safety = binding.characterSpecificMotion.status === 'attached'
                ? nativeDungeonJumpSafety(native.dungeonCharacterId)
                : nativeDungeonSafety(native.dungeonCharacterId, modelKey)
            if (enabled) {
                binding.tpsPoseTransition?.begin()
                activateNativeDungeonController(binding)
            }
        } catch (error) {
            if (native.abortController?.signal.aborted || binding.character.disposed) {
                native.status = 'disposed'
                native.reason = 'character detached while native Dungeon runtime was loading'
                return
            }
            const detail = nativeDungeonErrorDetail(error)
            native.errorCode = detail.errorCode
            if (native.loadAttempts < 2) {
                native.status = 'loading'
                native.reason = `retrying native Dungeon runtime once after ${detail.errorCode}: ${detail.reason}`
                native.ready = undefined
                native.abortController = undefined
                window.setTimeout(() => {
                    if (!binding.character.disposed && native.status === 'loading') {
                        void ensureNativeDungeonActions(binding)
                    }
                }, 120)
            } else {
                native.status = 'error'
                native.reason = detail.reason
            }
        } finally {
            emitCharacterActionCatalogChange()
            updateHud(selectedBinding())
        }
    })()
    return native.ready
}

export function attachViewerLocomotion(sceneCharacter: SceneCharacter): ViewerLocomotionBinding | undefined {
    const character = sceneCharacter.character
    if (!character) return undefined
    const existing = bindingByObject.get(character.object)
    if (existing) return existing
    const controlAuthority = getViewerCharacterControlAuthority(character)
    let safety = getViewerRigSafety(character)
    const collision = new ViewerSceneCollisionWorld(character.object.position.y)
    const inferredLocomotionAnimations = inferLocomotionAnimations(character)
    const inferredIdle = primaryLocomotionAnimation(inferredLocomotionAnimations.idle)
    const inferredWalk = primaryLocomotionAnimation(inferredLocomotionAnimations.walk)
    const inferredRun = primaryLocomotionAnimation(inferredLocomotionAnimations.run)
    const targetRigProfileCharacter = Number(character.userData.characterId) === 101901
        || targetRigMorphologyCharacterIds.has(Number(character.userData.characterId))
        || isMagicalGirlSourceCharacter(character)
    const characterSpecificBaseline = targetRigProfileCharacter
        ? findFamily(character.animations, [/^HomeWait01_L$/i, /^HomeWait02_L$/i])
            ?? inferredIdle
        : inferredIdle
    const hasEmbeddedNativeDungeonLocomotion = (
        controlAuthority.tps
        && /^DungeonWalk_L$/i.test(inferredWalk ?? '')
        && /^DungeonRun_L$/i.test(inferredRun ?? '')
        && !!inferredIdle
        && !familyEquals(inferredWalk ?? '', inferredIdle)
        && !familyEquals(inferredRun ?? '', inferredIdle)
    )
    let characterSpecificMotionVariants: ReadonlyMap<string, CharacterSpecificMotionVariant> | undefined
    let characterSpecificMotion: {
        profile: CharacterSpecificMotionProfile
        animations?: LocomotionAnimationMap
        jumpAnimations?: JumpLocomotionAnimationMap
        postAnimationWalkClearance?: CharacterSpecificMotionPostAnimationClearance
    }
    if (!controlAuthority.tps) {
        characterSpecificMotion = {
            profile: {
                status: 'not-configured' as const,
                characterId: Number(character.userData.characterId),
                provenance: 'custom-character-profile' as const,
                generatedClips: [],
                missingRequiredRigPaths: [],
                reason: `${controlAuthority.reason}; preserves own presentation and rejects TPS, Dungeon, combat and humanoid retarget consumers`,
            },
            animations: controllerRootOwnPoseLocomotionAnimations(
                character,
                inferredLocomotionAnimations,
            ),
        }
    } else if (hasEmbeddedNativeDungeonLocomotion) {
        // Generate the jump channels from the existing target-rig machinery,
        // then restore the model-owned native gait clips.  The generated walk
        // and run clips are intentionally discarded; only jump/fall/land are
        // added to the native idle/walk/run family.
        const nativeAnimations = [...character.object.animations]
        const jumpProfile = attachParameterizedHumanoidMotionProfile(
            character,
            characterSpecificBaseline as string | undefined,
            normalizedHumanoidMotionReference,
            targetRigMorphologyProfileId,
            'native-dungeon-jump-overlay',
        )
        const jumpNames = jumpProfile.jumpAnimations
            ? new Set(Object.values(jumpProfile.jumpAnimations).flatMap(mode => Object.values(mode)))
            : new Set<string>()
        const generatedJumpClips = character.object.animations.filter(clip => jumpNames.has(clip.name))
        character.object.animations = [...nativeAnimations, ...generatedJumpClips]
        characterSpecificMotion = {
            profile: {
                ...jumpProfile.profile,
                jumpAnimations: jumpProfile.jumpAnimations,
                generatedClips: jumpProfile.profile.generatedClips.filter(clip => jumpNames.has(clip.name)),
                reason: jumpProfile.profile.status === 'attached'
                    ? 'native Dungeon idle/walk/run retained; parameterized target-rig jump overlay attached'
                    : jumpProfile.profile.reason,
            },
            animations: jumpProfile.animations
                ? {
                    ...inferredLocomotionAnimations,
                    jump: jumpProfile.animations.jump,
                    fall: jumpProfile.animations.fall,
                    land: jumpProfile.animations.land,
                }
                : inferredLocomotionAnimations,
            jumpAnimations: jumpProfile.jumpAnimations,
        }
    } else if (Number(character.userData.characterId) === 101901) {
        const setA = attachParameterizedHumanoidMotionProfile(
            character,
            characterSpecificBaseline as string | undefined,
            normalizedHumanoidMotionReferenceSetA,
            'set-a',
            normalizedHumanoidSetAProfile.label,
        )
        const setB = attachParameterizedHumanoidMotionProfile(
            character,
            characterSpecificBaseline as string | undefined,
            normalizedHumanoidMotionReferenceSetB,
            '101901-dress-clearance-multidonor',
            normalizedHumanoidSetBProfile.label,
        )
        const variants = new Map<string, CharacterSpecificMotionVariant>()
        if (setA.animations) variants.set('set-a', {
            id: 'set-a',
            label: normalizedHumanoidSetAProfile.label,
            profile: setA.profile,
            animations: setA.animations,
            jumpAnimations: setA.jumpAnimations,
            postAnimationWalkClearance: setA.postAnimationWalkClearance,
        })
        if (setB.animations) variants.set('101901-dress-clearance-multidonor', {
            id: '101901-dress-clearance-multidonor',
            label: normalizedHumanoidSetBProfile.label,
            profile: setB.profile,
            animations: setB.animations,
            jumpAnimations: setB.jumpAnimations,
        })
        characterSpecificMotionVariants = variants
        characterSpecificMotion = setA
    } else if (isMagicalGirlSourceCharacter(character)) {
        characterSpecificMotion = attachParameterizedHumanoidMotionProfile(
            character,
            characterSpecificBaseline as string | undefined,
            normalizedHumanoidMotionReference,
            targetRigMorphologyProfileId,
            '目标骨架多供体 / 形态近邻',
        )
    } else {
        const rootOnlyAnimations = controllerRootOwnPoseLocomotionAnimations(
            character,
            inferredLocomotionAnimations,
        )
        characterSpecificMotion = {
            profile: {
                status: 'not-configured' as const,
                characterId: Number(character.userData.characterId),
                provenance: 'custom-character-profile' as const,
                generatedClips: [],
                missingRequiredRigPaths: [],
                reason: 'controller-root-only movement preserves one selected-model own-pose family; no unverified skeleton or secondary track is generated',
            },
            animations: rootOnlyAnimations,
        }
    }
    if (hasEmbeddedNativeDungeonLocomotion) {
        safety = characterSpecificMotion.profile.status === 'attached'
            ? nativeDungeonJumpSafety(Number(character.userData.characterId))
            : embeddedDungeonSafety(Number(character.userData.characterId))
    } else if (characterSpecificMotion.profile.status === 'attached' && safety.status === 'unverified') {
        safety = parameterizedTargetRigSafety(
            Number(character.userData.characterId),
            isMagicalGirlSourceCharacter(character),
        )
    }
    const officialDungeonAttach = attachOfficialDungeonLocomotion(character, safety)
    const officialCombatAttach = attachOfficialCombatActions(character, safety)
    const locomotionAnimations = characterSpecificMotion.animations ?? inferredLocomotionAnimations
    const proceduralLocomotion = safety.allowProceduralBones
        ? new ViewerProceduralLocomotion(character, locomotionAnimations)
        : undefined
    const cameraHeadTracking = controlAuthority.cameraGaze
        ? new ViewerCameraHeadTracking(character)
        : undefined
    const nativePhysicsAttachment = getViewerCharacterPhysicsAttachment(character.object)
    const secondaryPhysics = nativePhysicsAttachment?.status === 'ready'
        ? undefined
        : safety.allowCharacterSpecificSecondaryPhysics
            && Number(character.userData.characterId) === 101901
            ? new ViewerSecondaryBonePhysics(character, collision, {
                mode: 'custom-101901-magica-profile',
                rootPaths: secondaryRoots101901,
            })
            : safety.allowSecondaryFallback
                ? new ViewerSecondaryBonePhysics(character, collision)
                : undefined
    const attachmentRestState = attachmentDiagnostics(character)
    const layeredMotionPlayback: LayeredMotionPlayback | undefined = (
        characterSpecificMotion.profile.status === 'attached'
        && characterSpecificMotion.profile.playbackMode === 'layered-additive'
        && characterSpecificMotion.profile.baselineClip
    ) ? {
            baselineClip: characterSpecificMotion.profile.baselineClip,
            overlayClips: characterSpecificMotion.profile.generatedClips.map(clip => clip.name),
        }
        : undefined
    let binding: ViewerLocomotionBinding
    const gaitCalibration = characterSpecificMotion.profile.gaitCalibration
    const targetRigLocomotionTransitions = characterSpecificMotion.profile.status === 'attached'
        ? createTargetRigLocomotionTransitionPolicy(
            locomotionAnimations,
            characterSpecificMotion.jumpAnimations,
        )
        : undefined
    const animationPort = createAnimationPort(
        character,
        layeredMotionPlayback,
        targetRigLocomotionTransitions,
    )
    // Presentation-only actors need natural Home/action transitions as well.
    const tpsPoseTransition = new ViewerTpsPoseTransition(character, cameraHeadTracking)
    const restoreAnimationHandoff = installViewerEvaluatedAnimationHandoff(character, tpsPoseTransition)
    if (enabled) tpsPoseTransition?.begin()
    const controller = createViewerLocomotionController(
        () => binding,
        character,
        collision,
        animationPort,
        locomotionAnimations,
        gaitCalibration,
        undefined,
        characterSpecificMotion.jumpAnimations,
    )
    const characterId = Number(character.userData.characterId)
    const directHomeActions = createDirectHomeActionBinding(character)
    binding = {
        sceneCharacter,
        character,
        controller,
        locomotionAnimations,
        actionClips: new Map(),
        catalogActionIds: new Map(),
        catalogEffectCueSequence: 0,
        pendingAction: false,
        animationPlaybackRate: 1,
        characterActionPlaybackRate: 1,
        characterActionAuthoredSpeed: 1,
        snapshot: controller.snapshot(),
        collision,
        officialDungeonLocomotion: officialDungeonAttach,
        officialCombatActions: officialCombatAttach,
        characterSpecificMotion: characterSpecificMotion.profile,
        characterSpecificMotionVariants,
        activeCharacterSpecificMotionVariant: characterSpecificMotionVariants?.has('set-a')
            ? 'set-a'
            : undefined,
        safety,
        controlAuthority,
        animationPort,
        nativeDungeonActions: {
            status: 'not-requested',
            dungeonCharacterId: characterId,
            entries: [],
            embeddedEntries: new Map(),
            loadAttempts: 0,
            active: false,
            controllerReady: false,
            externalAttachments: collectNativeDungeonExternalAttachments(character),
        },
        combatJumpActions: {
            status: 'not-requested',
            characterId: String(characterId),
            entries: [],
            loadAttempts: 0,
            previewClips: new Map(),
            previewJumpSequences: new Map(),
        },
        directHomeActions,
        characterActionPlayback: emptyCharacterActionPlaybackState(1),
        characterActionPhysicsPhase: {
            requestToken: 0,
            state: emptyCharacterActionPhysicsPhaseState(),
        },
        attachmentRestState,
        tpsPoseTransition,
        restoreAnimationHandoff,
        proceduralLocomotion,
        cameraHeadTracking,
        postAnimationWalkClearance: characterSpecificMotion.postAnimationWalkClearance,
        secondaryPhysics,
    }
    proceduralLocomotion?.setStateProvider(() => binding.snapshot)
    cameraHeadTracking?.setStateProvider(() => binding)
    binding.postAnimationWalkClearance?.setStateProvider(() => binding.snapshot)
    binding.postAnimationWalkClearance?.setVariantProvider(
        () => binding.activeCharacterSpecificMotionVariant,
    )
    secondaryPhysics?.setStateProvider(() => binding.snapshot)
    bindingByObject.set(character.object, binding)
    bindings.add(binding)
    if (tpsPoseTransition) character.userData.animationLoops.push(tpsPoseTransition.update)
    if (proceduralLocomotion) character.userData.animationLoops.push(proceduralLocomotion.update)
    if (cameraHeadTracking) character.userData.animationLoops.push(cameraHeadTracking.update)
    if (binding.postAnimationWalkClearance) {
        character.userData.animationLoops.push(binding.postAnimationWalkClearance.update)
    }
    if (secondaryPhysics) character.userData.animationLoops.push(secondaryPhysics.update)
    proceduralLocomotion?.setActive(enabled && safety.allowProceduralBones)
    cameraHeadTracking?.setActive(enabled)
    binding.postAnimationWalkClearance?.setActive(
        enabled && binding.activeCharacterSpecificMotionVariant === 'set-a',
    )
    secondaryPhysics?.setActive(enabled && (
        safety.allowCharacterSpecificSecondaryPhysics || safety.allowSecondaryFallback
    ))
    secondaryPhysics?.reset()
    if (characterSpecificMotion.profile.status === 'attached') {
        setNativeDungeonExternalAttachmentsHidden(binding, true)
    }
    if (scene.characterSelected === sceneCharacter) configureActionSelectors(binding)
    if (controlAuthority.tps) {
        void ensureNativeDungeonActions(binding)
        // Native Dungeon jump overlays are generated synchronously above; do
        // not make their availability depend on the asynchronous combat fetch.
        if (!hasEmbeddedNativeDungeonLocomotion) void ensureCombatJumpActions(binding)
    }
    return binding
}

export function detachViewerLocomotion(sceneCharacter?: SceneCharacter): void {
    const object = sceneCharacter?.character?.object
    if (!object) return
    const binding = bindingByObject.get(object)
    if (!binding) return
    viewerPerformanceClaims.get(object)?.dispose()
    viewerCharacterActionPlayRequests.delete(binding)
    clearViewerCharacterActionRepetition(binding)
    binding.nativeDungeonActions.status = 'disposed'
    binding.nativeDungeonActions.abortController?.abort()
    binding.combatJumpActions.status = 'disposed'
    binding.combatJumpActions.abortController?.abort()
    releaseViewerCharacterActionPhysicsPhase(binding, 'character detached')
    stopActiveCombatJumpDonorPlayback(binding)
    stopActiveCombatSkeletonPlayback(binding)
    for (const weapon of binding.combatJumpActions.specialWeapons?.values() ?? []) weapon.dispose()
    binding.combatJumpActions.specialWeapons?.clear()
    stopActiveDirectHomePlayback(binding)
    setNativeDungeonExternalAttachmentsHidden(binding, false)
    deactivateNativeDungeonPresentation(binding, false)
    binding.characterActionPlayback = {
        ...binding.characterActionPlayback,
        status: 'interrupted',
        reason: 'character detached',
    }
    emitCharacterActionPlaybackState(binding)
    binding.controller.setInput({ moveX: 0, moveZ: 0, run: false, jumpPressed: false })
    binding.character.userData.animationLoops = binding.character.userData.animationLoops
        .filter(callback => (
            callback !== binding.proceduralLocomotion?.update
            && callback !== binding.tpsPoseTransition?.update
            && callback !== binding.cameraHeadTracking?.update
            && callback !== binding.postAnimationWalkClearance?.update
            && callback !== binding.secondaryPhysics?.update
        ))
    binding.proceduralLocomotion?.reset()
    binding.tpsPoseTransition?.reset()
    binding.restoreAnimationHandoff?.()
    binding.cameraHeadTracking?.reset()
    binding.postAnimationWalkClearance?.reset()
    binding.secondaryPhysics?.reset()
    bindings.delete(binding)
    bindingByObject.delete(object)
}

export function selectViewerLocomotion(sceneCharacter?: SceneCharacter): void {
    const binding = sceneCharacter ? attachViewerLocomotion(sceneCharacter) : undefined
    if (binding) configureActionSelectors(binding)
    emitCharacterActionCatalogChange()
    updateHud(binding)
}

export function teleportViewerCharacter(
    object: THREE.Object3D,
    position: THREE.Vector3,
    quaternion?: THREE.Quaternion,
): boolean {
    const binding = bindingByObject.get(object)
    if (!binding) return false
    binding.controller.teleport(position, quaternion, true)
    binding.proceduralLocomotion?.reset()
    binding.cameraHeadTracking?.reset()
    binding.secondaryPhysics?.reset()
    binding.snapshot = binding.controller.snapshot()
    return true
}

function combatSkeletonBodySchedule(
    template: ExactCombatSkeletonTemplate,
): readonly Omit<CombatSkeletonPhase, 'clipName'>[] {
    const phases: Omit<CombatSkeletonPhase, 'clipName'>[] = []
    let startSeconds = 0
    for (const clip of template.bodyPhases) {
        const sourceDurationSeconds = Math.max(0, clip.clip.duration)
        const durationSeconds = clip.sequencePhase === 'loop'
            ? template.entry.playbackOptions?.holdSeconds ?? Math.max(sourceDurationSeconds, 1 / 60)
            : Math.max(sourceDurationSeconds, 1 / 60)
        phases.push({
            phase: clip.sequencePhase,
            startSeconds,
            endSeconds: startSeconds + durationSeconds,
            sourceDurationSeconds,
        })
        startSeconds += durationSeconds
    }
    return phases
}

function stopCombatSkeletonRole(role: CombatSkeletonRolePlayback): void {
    const actions = new Set([
        role.currentAction,
        role.previousAction,
    ].filter((action): action is THREE.AnimationAction => !!action))
    for (const action of actions) action.stop()
    role.currentAction = undefined
    role.currentPhase = undefined
    role.previousAction = undefined
    role.previousPhase = undefined
    role.transitionStartSeconds = undefined
    role.lastAppliedTimeSeconds = undefined
    role.holdFinalPose = false
}

function applyCombatSkeletonPose(
    binding: ViewerLocomotionBinding,
    active: ActiveCombatSkeletonPlayback,
): void {
    const epoch = observeViewerPerformanceTimelineMixer(binding), minimumRevision = epoch.revision + 1
    const timeSeconds = active.playback.state().timeSeconds
    for (const role of active.roles) {
        const phase = role.currentPhase
            ?? role.phases.find(candidate => (
                timeSeconds >= candidate.startSeconds - 1e-6
                && timeSeconds <= candidate.endSeconds + 1e-6
            ))
        const action = role.currentAction
        if (!phase || !action) continue
        const elapsed = Math.max(0, timeSeconds - phase.startSeconds)
        action.time = phase.phase === 'loop' && phase.sourceDurationSeconds > 0
            ? elapsed % phase.sourceDurationSeconds
            : Math.min(elapsed, phase.sourceDurationSeconds)
        const previousAction = role.previousAction
        const previousPhase = role.previousPhase
        if (previousAction && previousPhase && previousAction !== action) {
            previousAction.time = previousPhase.sourceDurationSeconds
            const directSeek = role.lastAppliedTimeSeconds !== undefined
                && Math.abs(timeSeconds - role.lastAppliedTimeSeconds) > 0.25
            const transitionRatio = directSeek
                ? 1
                : THREE.MathUtils.clamp(
                    (timeSeconds - (role.transitionStartSeconds ?? phase.startSeconds))
                    / combatSkeletonPhaseCrossfadeSeconds,
                    0,
                    1,
                )
            const blend = transitionRatio * transitionRatio * (3 - 2 * transitionRatio)
            previousAction.enabled = true
            previousAction.setEffectiveWeight(1 - blend)
            action.setEffectiveWeight(blend)
            if (blend >= 1 - 1e-6) {
                previousAction.stop()
                role.previousAction = undefined
                role.previousPhase = undefined
                role.transitionStartSeconds = undefined
                action.setEffectiveWeight(1)
            }
        } else {
            action.setEffectiveWeight(1)
        }
        role.lastAppliedTimeSeconds = timeSeconds
    }
    binding.character.animation.mixer.update(0)
    publishViewerPerformanceTimelineProducer(binding, active, minimumRevision)
    // The body mixer suppresses cinematic Root.position. Apply that same
    // origin removal to every active sibling weapon, including phase blends.
    // This is template-only: Dungeon/TPS/jump donors keep their own policies.
    const body = active.roles.find(role => role.role === 'body')
    const rootOffsetWorld = new THREE.Vector3()
    const sampledOffset = new THREE.Vector3()
    let hasRootOffset = false
    for (const sample of [
        { action: body?.previousAction, phase: body?.previousPhase },
        { action: body?.currentAction, phase: body?.currentPhase },
    ]) {
        if (!sample.action || !sample.phase) continue
        if (binding.combatJumpActions.loaded?.sampleSuppressedBodyRootWorldOffset(
            active.sourceEntryId, sample.phase.phase, sample.action.time, sampledOffset,
        )) {
            rootOffsetWorld.addScaledVector(sampledOffset, sample.action.getEffectiveWeight())
            hasRootOffset = true
        }
    }
    active.specialWeapon?.sample(timeSeconds)
    for (const attachment of active.attachments) {
        applyCombatSkeletonAttachmentPose(attachment, hasRootOffset ? rootOffsetWorld : undefined)
    }
}

function stopActiveCombatSkeletonPlayback(binding: ViewerLocomotionBinding): void {
    const active = binding.combatJumpActions.activeSkeletonPlayback
    if (!active) return
    binding.tpsPoseTransition?.begin()
    for (const role of active.roles) stopCombatSkeletonRole(role)
    active.playback.pause()
    active.specialWeapon?.reset()
    binding.combatJumpActions.activeSkeletonPlayback = undefined
    binding.character.animation.clear()
    binding.character.animation.paused = false
    setNativeDungeonExternalAttachmentsHidden(binding, true)
}

function stopActiveCombatJumpDonorPlayback(binding: ViewerLocomotionBinding): void {
    if (!binding.combatJumpActions.activeJumpDonorPlayback) return
    binding.controller.setJumpLocomotionAnimationOverride(undefined)
    binding.combatJumpActions.activeJumpDonorPlayback = undefined
}

function startCombatJumpDonorPlayback(
    binding: ViewerLocomotionBinding,
    entry: CombatJumpActionResourceEntry,
): ViewerCharacterActionPlaybackState {
    const controllerRejection = controllerFreeJumpDonorRejectionReason(entry)
    if (controllerRejection) {
        return {
            status: 'unavailable',
            actionId: entry.id,
            characterId: Number(binding.character.userData.characterId),
            timeSeconds: 0,
            durationSeconds: 0,
            loop: false,
            reason: controllerRejection,
        }
    }
    const sequence = binding.combatJumpActions.previewJumpSequences.get(entry.id)
    if (!sequence) {
        return {
            status: 'unavailable',
            actionId: entry.id,
            characterId: Number(binding.character.userData.characterId),
            timeSeconds: 0,
            durationSeconds: 0,
            loop: false,
            reason: 'exact three-phase combat jump sequence is not attached',
        }
    }
    if (characterActionPlaybackBlocksLocomotion(binding)) {
        interruptViewerCharacterAction(binding, 'replaced by exact three-phase TPS jump')
    }
    stopActiveCombatSkeletonPlayback(binding)
    stopActiveCombatJumpDonorPlayback(binding)
    stopActiveDirectHomePlayback(binding)
    binding.characterActionAuthoredSpeed = 1
    binding.controller.setJumpLocomotionAnimationOverride(Object.fromEntries(
        (['standing', 'walking', 'running'] as const).map(mode => [mode, {
            jump: sequence.jump,
            fall: sequence.fall,
            land: sequence.land,
        }]),
    ))
    const raw = enabled
        ? movementAxes()
        : { moveX: 0, moveZ: 0, run: false, jumpPressed: false }
    binding.controller.setInput({
        ...cameraRelativeInput(binding, raw),
        jumpPressed: true,
    })
    binding.combatJumpActions.activeJumpDonorPlayback = {
        actionId: entry.id,
        sequence,
        elapsedSeconds: 0,
        jumpStateObserved: false,
    }
    setNativeDungeonExternalAttachmentsHidden(binding, true)
    return {
        status: 'playing',
        actionId: entry.id,
        characterId: Number(binding.character.userData.characterId),
        runtimeName: `controller-root-three-phase:${sequence.jump}`,
        timeSeconds: 0,
        durationSeconds: sequence.durationSeconds,
        loop: false,
        reason: '三段 body 姿态已接入 TPS controller；水平与垂直位移由 controller 实际推进',
    }
}

function startCombatSkeletonPlayback(
    binding: ViewerLocomotionBinding,
    template: ExactCombatSkeletonTemplate,
    catalogActionId: string,
): ViewerCharacterActionPlaybackState {
    const loaded = binding.combatJumpActions.loaded
    const entry = template.entry
    if (!loaded) {
        return {
            status: 'unavailable',
            actionId: catalogActionId,
            characterId: Number(binding.character.userData.characterId),
            timeSeconds: 0,
            durationSeconds: 0,
            loop: false,
            reason: 'exact synchronized body/weapon runtime is not attached',
        }
    }
    const bodySchedule = combatSkeletonBodySchedule(template)
    if (bodySchedule.length === 0) {
        return {
            status: 'unavailable',
            actionId: catalogActionId,
            characterId: Number(binding.character.userData.characterId),
            timeSeconds: 0,
            durationSeconds: 0,
            loop: false,
            reason: 'official synchronized body phase schedule is empty',
        }
    }
    const roles: CombatSkeletonRolePlayback[] = []
    const timelineBindings: Record<string, CharacterTimelineBinding> = {}
    for (const target of template.roles) {
        const exactByPhase = new Map(target.clips.map(clip => [clip.sequencePhase, clip]))
        const phases = bodySchedule.map(schedule => {
            const exact = exactByPhase.get(schedule.phase)
            if (!exact) {
                throw new Error(`missing exact ${target.role}:${schedule.phase} clip for ${entry.id}`)
            }
            return {
                ...schedule,
                clipName: `${exact.clip.name}@@${exact.pathId}@@${schedule.phase}`,
                sourceDurationSeconds: exact.clip.duration,
            }
        })
        const clipByName = new Map(phases.map(phase => {
            const exact = exactByPhase.get(phase.phase)
            return [phase.clipName, exact!.clip] as const
        }))
        let role: CombatSkeletonRolePlayback
        const timelineBinding: CharacterTimelineBinding = {
            setActionState: () => undefined,
            setAnimationClip: (value: TimelineClipValue) => {
                if (value.name === null) {
                    // A null clip at a phase gap or timeline end means hold the
                    // last exact authored frame. Clearing here drops body and
                    // weapon back to rest/T-pose and leaves attachments on the floor.
                    role.holdFinalPose = true
                    return
                }
                const clip = clipByName.get(value.name)
                const phase = phases.find(candidate => candidate.clipName === value.name)
                if (!clip || !phase) throw new Error(`timeline clip ${value.name} is not bound to ${target.role}`)
                if (
                    role.currentPhase?.clipName === value.name
                    && role.currentAction
                ) {
                    role.holdFinalPose = false
                    return
                }
                role.previousAction?.stop()
                role.previousAction = undefined
                role.previousPhase = undefined
                const outgoingAction = role.currentAction
                binding.tpsPoseTransition?.begin(combatSkeletonPhaseCrossfadeSeconds)
                const outgoingPhase = role.currentPhase
                const action = binding.character.animation.mixer.clipAction(clip)
                action.enabled = true
                action.setLoop(value.loop ? THREE.LoopRepeat : THREE.LoopOnce, value.loop ? Infinity : 1)
                action.clampWhenFinished = !value.loop
                action.reset().play()
                if (outgoingAction && outgoingPhase && outgoingAction !== action) {
                    outgoingAction.enabled = true
                    outgoingAction.setEffectiveWeight(1)
                    action.setEffectiveWeight(0)
                    role.previousAction = outgoingAction
                    role.previousPhase = outgoingPhase
                    role.transitionStartSeconds = phase.startSeconds
                } else {
                    action.setEffectiveWeight(1)
                    role.transitionStartSeconds = undefined
                }
                role.currentAction = action
                role.currentPhase = phase
                role.holdFinalPose = false
            },
        }
        role = {
            targetId: target.targetId,
            role: target.role,
            phases,
            clipByName,
            binding: timelineBinding,
        }
        roles.push(role)
        timelineBindings[target.targetId] = timelineBinding
    }
    const durationSeconds = bodySchedule.at(-1)?.endSeconds ?? 0
    const timelineDocument: CharacterTimelineDocument = {
        schema: CHARACTER_TIMELINE_SCHEMA,
        duration: durationSeconds,
        loop: false,
        tracks: roles.map(role => ({
            id: `${role.targetId}:${entry.id}:reusable-template`,
            targetId: role.targetId,
            kind: 'clip',
            interpolation: 'step',
            keyframes: role.phases.map(phase => ({
                time: phase.startSeconds,
                value: {
                    name: phase.clipName,
                    loop: phase.phase === 'loop',
                },
            })),
        })),
        events: [],
    }
    const timeline = new CharacterTimeline(timelineDocument, { bindings: timelineBindings })
    const playback: CombatSkeletonPlaybackController = {
        state: () => ({
            actionId: entry.id,
            playing: timeline.playing,
            timeSeconds: timeline.time,
            durationSeconds: timeline.duration,
            loop: timeline.loop,
        }),
        play: () => timeline.play(),
        pause: () => timeline.pause(),
        seek: timeSeconds => { timeline.seek(timeSeconds) },
        step: deltaSeconds => { timeline.step(deltaSeconds) },
    }
    if (characterActionPlaybackBlocksLocomotion(binding)) {
        interruptViewerCharacterAction(binding, 'replaced by another explicit character action')
    }
    stopActiveCombatJumpDonorPlayback(binding)
    stopActiveCombatSkeletonPlayback(binding)
    binding.characterActionAuthoredSpeed = 1
    binding.character.animation.clear()
    binding.character.animation.paused = true
    setNativeDungeonExternalAttachmentsHidden(binding, true)
    const attachments = combatSkeletonAttachments(binding, roles)
    const specialWeapon = binding.combatJumpActions.specialWeapons?.get(entry.id)
    if (specialWeapon) {
        // The SP rig is a PlayerSlot sibling in the native cinematic, not a
        // child of either hand. Its own scale track owns appearance/disappearance.
        const parent = attachments[0]?.object.parent ?? binding.character.object
        parent.add(specialWeapon.object)
        specialWeapon.object.position.set(0, 0, 0)
        specialWeapon.object.quaternion.identity()
        specialWeapon.object.scale.set(1, 1, 1)
        specialWeapon.wrapper.visible = true
        attachments.push({ object: specialWeapon.object, restPosition: new THREE.Vector3(),
            restQuaternion: new THREE.Quaternion(), restScale: new THREE.Vector3(1, 1, 1),
            policy: 'authored-model-space-root' })
    }
    for (const attachment of attachments) attachment.object.visible = true
    const active: ActiveCombatSkeletonPlayback = {
        catalogActionId,
        sourceEntryId: entry.id,
        playback,
        roles,
        attachments,
        specialWeapon,
    }
    binding.combatJumpActions.activeSkeletonPlayback = active
    playback.play()
    applyCombatSkeletonPose(binding, active)
    return {
        status: 'playing',
        actionId: catalogActionId,
        characterId: Number(binding.character.userData.characterId),
        runtimeName: `body+weapon:${entry.skill.directionName}`,
        timeSeconds: 0,
        durationSeconds: playback.state().durationSeconds,
        loop: false,
        reason: `exact-model ${roles.some(role => role.role === 'weapon-a') ? 'body/primary-weapon' : 'body-only'} reusable template; ${bodySchedule.length} authored phases run on the unified timeline; full camera/scene/copy-attachment/VFX/cloth presentation remains independently gated`,
    }
}

function selectedBinding(): ViewerLocomotionBinding | undefined {
    const selected = scene.characterSelected
    return selected ? attachViewerLocomotion(selected) : undefined
}

function characterActionPlaybackBlocksLocomotion(binding: ViewerLocomotionBinding): boolean {
    // A three-phase jump donor is an animation override for the locomotion
    // controller, not an explicit timeline that owns movement.  Keeping it out
    // of this gate lets WASD continue to drive a walking/running jump while the
    // controller owns the real horizontal and vertical displacement.
    if (binding.combatJumpActions.activeJumpDonorPlayback) return false
    return binding.characterActionPlayback.status === 'playing'
        || binding.characterActionPlayback.status === 'paused'
}

function resumeViewerLocomotionIdle(binding: ViewerLocomotionBinding): void {
    const native = binding.nativeDungeonActions
    if (native.status === 'attached' && !native.controllerReady) activateNativeDungeonController(binding)
    const idle = primaryLocomotionAnimation(binding.locomotionAnimations.idle)
    if (!idle) return
    setNativeDungeonExternalAttachmentsHidden(binding, true)
    binding.animationPort.play(idle, {
        loop: true,
        speed: 1,
        weight: 1,
        fadeSeconds: 0.12,
    })
}

function stopActiveDirectHomePlayback(binding: ViewerLocomotionBinding): void {
    const active = binding.directHomeActions.active
    if (!active) return
    binding.tpsPoseTransition?.begin()
    active.timeline?.pause()
    binding.directHomeActions.active = undefined
}

function directHomePhaseAtTime(
    active: ActiveDirectHomePlayback,
    timeSeconds: number,
): OfficialCharacterActionPhaseSchedule | undefined {
    return active.phases.find(phase => (
        phase.phase !== 'restore'
        && timeSeconds >= phase.startTime - 1e-6
        && timeSeconds < phase.endTime - 1e-6
    )) ?? active.phases.find(phase => phase.phase === 'restore' && timeSeconds >= phase.startTime - 1e-6)
}

function seekActiveDirectHomePlayback(
    binding: ViewerLocomotionBinding,
    active: ActiveDirectHomePlayback,
    timeSeconds: number,
): void {
    const epoch = observeViewerPerformanceTimelineMixer(binding), minimumRevision = epoch.revision + 1
    active.timeline?.seek(timeSeconds)
    const phase = directHomePhaseAtTime(active, timeSeconds)
    if (!phase) return
    const localTime = phase.phase === 'restore'
        ? 0
        : THREE.MathUtils.clamp(timeSeconds - phase.startTime, 0, phase.clip.durationSeconds)
    seekViewerCharacterActionMixer(binding, localTime)
    publishViewerPerformanceTimelineProducer(binding, active, minimumRevision)
}

function startDirectHomePlayback(
    binding: ViewerLocomotionBinding,
    declaration: DirectHomeActionDeclaration,
): ViewerCharacterActionPlaybackState {
    const direct = binding.directHomeActions
    const product = direct.product
    const action = directHomeActionDefinition(binding, declaration)
    if (
        direct.status !== 'attached'
        || !product
        || !action
        || product.profile.controller.pathId !== declaration.playback.controllerPathId
    ) {
        throw new Error(direct.reason ?? `direct Home action ${declaration.id} is unavailable`)
    }
    binding.tpsPoseTransition?.begin()
    stopActiveDirectHomePlayback(binding)
    stopActiveCombatJumpDonorPlayback(binding)
    stopActiveCombatSkeletonPlayback(binding)
    binding.characterActionAuthoredSpeed = 1
    const firstClip = action.sequence.start ?? action.sequence.loop ?? action.sequence.end
    if (!firstClip) throw new Error(`direct Home action ${action.id} has no exact clip sequence`)

    const evaluatorEpoch = observeViewerPerformanceTimelineMixer(binding)
    const firstEvaluationRevision = evaluatorEpoch.revision + 1
    if (declaration.playbackKind === 'loop') {
        const loopClip = action.sequence.loop
        if (!loopClip) throw new Error(`direct Home loop ${action.id} has no loop phase`)
        binding.animationPort.play(loopClip.name, {
            loop: true,
            speed: effectiveViewerCharacterActionMixerRate(binding),
            weight: 1,
            fadeSeconds: 0.12,
        })
        direct.active = {
            catalogActionId: declaration.id,
            profileActionId: action.id,
            playbackKind: declaration.playbackKind,
            runtimeName: loopClip.name,
            durationSeconds: loopClip.durationSeconds,
            phases: [{
                phase: 'loop',
                startTime: 0,
                endTime: loopClip.durationSeconds,
                actionId: action.id,
                clip: loopClip,
            }],
        }
        publishViewerPerformanceTimelineProducer(binding, direct.active, firstEvaluationRevision)
        return {
            status: 'playing',
            actionId: declaration.id,
            characterId: Number(product.profile.characterId),
            runtimeName: loopClip.name,
            timeSeconds: 0,
            durationSeconds: loopClip.durationSeconds,
            loop: true,
            reason: `exact Home active-controller loop ${action.id}; embedded rig only`,
        }
    }

    const targetId = `home:${product.profile.characterId}:body`
    const timelineResult = createOfficialCharacterActionTimeline(
        product.profile,
        action.id,
        product.inventory,
        {
            targetId,
            ...(action.sequence.loop
                ? { holdSeconds: action.sequence.loop.durationSeconds }
                : {}),
        },
    )
    if (!timelineResult.ok) throw new Error(timelineResult.detail)
    const timelineBinding = createObjectTimelineBinding({
        object: {
            position: binding.character.object.position,
            quaternion: binding.character.object.quaternion,
            scale: binding.character.object.scale,
        },
        animation: {
            play: (name, loop = false) => binding.animationPort.play(name, {
                loop,
                speed: effectiveViewerCharacterActionMixerRate(binding),
                weight: 1,
                fadeSeconds: 0.10,
            }),
            clear: () => { binding.animationPort.clear?.() },
            setTime: timeSeconds => { binding.character.animation.time = timeSeconds },
            setSpeed: speed => {
                binding.characterActionAuthoredSpeed = Number.isFinite(speed) ? speed : 1
                binding.animationPort.setSpeed?.(effectiveViewerCharacterActionMixerRate(binding))
            },
            setWeight: weight => { binding.animationPort.setWeight?.(weight) },
        },
    })
    const timeline = new CharacterTimeline(timelineResult.document, {
        bindings: { [targetId]: timelineBinding },
    })
    const active: ActiveDirectHomePlayback = {
        catalogActionId: declaration.id,
        profileActionId: action.id,
        playbackKind: declaration.playbackKind,
        runtimeName: firstClip.name,
        durationSeconds: timeline.duration,
        timeline,
        phases: timelineResult.phases,
    }
    direct.active = active
    timeline.play()
    publishViewerPerformanceTimelineProducer(binding, active, firstEvaluationRevision)
    return {
        status: 'playing',
        actionId: declaration.id,
        characterId: Number(product.profile.characterId),
        runtimeName: firstClip.name,
        timeSeconds: 0,
        durationSeconds: timeline.duration,
        loop: false,
        reason: `exact Home active-controller ${declaration.playbackKind} ${action.id}; start/loop/end and Wait restore are pathID-bound`,
    }
}

function interruptViewerCharacterAction(
    binding: ViewerLocomotionBinding,
    reason: string,
): ViewerCharacterActionPlaybackSnapshot {
    const finiteCompleted = viewerCharacterActionRepetitions.get(binding)?.finished
    clearViewerCharacterActionRepetition(binding)
    if (viewerCharacterActionPlayRequests.get(binding)?.loading) viewerCharacterActionPlayRequests.delete(binding)
    const activeJumpDonor = binding.combatJumpActions.activeJumpDonorPlayback
    const hasPhysicsPhase = binding.characterActionPhysicsPhase.state.status !== 'idle'
    if (!characterActionPlaybackBlocksLocomotion(binding) && !activeJumpDonor && !hasPhysicsPhase && !finiteCompleted) {
        return cloneCharacterActionPlaybackState(binding.characterActionPlayback)
    }
    binding.tpsPoseTransition?.begin()
    const activeSkeleton = binding.combatJumpActions.activeSkeletonPlayback
    const timeSeconds = activeSkeleton?.playback.state().timeSeconds
        ?? binding.directHomeActions.active?.timeline?.time
        ?? activeJumpDonor?.elapsedSeconds
        ?? binding.character.animation.time
    releaseViewerCharacterActionPhysicsPhase(binding, reason)
    stopActiveCombatJumpDonorPlayback(binding)
    stopActiveCombatSkeletonPlayback(binding)
    stopActiveDirectHomePlayback(binding)
    binding.characterActionAuthoredSpeed = 1
    binding.character.animation.paused = false
    binding.characterActionPlayback = {
        ...binding.characterActionPlayback,
        status: 'interrupted',
        timeSeconds,
        reason,
    }
    if (enabled) resumeViewerLocomotionIdle(binding)
    else deactivateNativeDungeonPresentation(binding, true)
    emitCharacterActionPlaybackState(binding)
    return cloneCharacterActionPlaybackState(binding.characterActionPlayback)
}

async function playViewerCharacterAction(actionId: string, options?: ViewerCharacterActionPlayOptions): Promise<ViewerCharacterActionPlaybackSnapshot> {
    const repetitions = options?.repetitions
    if (repetitions !== undefined && (!Number.isSafeInteger(repetitions) || repetitions < 0)) {
        throw new TypeError('repetitions must be 0 or a positive safe integer')
    }
    const binding = selectedBinding()
    if (!binding) {
        return {
            status: 'unavailable',
            actionId,
            timeSeconds: 0,
            durationSeconds: 0,
            loop: false,
            playbackRate: 1,
            reason: 'no selected character',
            physicsPhase: emptyCharacterActionPhysicsPhaseState(),
        }
    }
    // Icons omit options: never re-create a flow or spend a repetition on resume.
    if (options === undefined && binding.characterActionPlayback.actionId === actionId
        && (binding.characterActionPlayback.status === 'playing' || binding.characterActionPlayback.status === 'paused')) {
        if (binding.characterActionPlayback.status === 'paused') {
            binding.directHomeActions.active?.timeline?.play()
            binding.combatJumpActions.activeSkeletonPlayback?.playback.play()
            binding.character.animation.paused = !!binding.combatJumpActions.activeSkeletonPlayback
            applyViewerCharacterActionMixerRate(binding)
            binding.characterActionPlayback = { ...binding.characterActionPlayback, status: 'playing', reason: undefined }
            emitCharacterActionPlaybackState(binding)
        }
        return cloneCharacterActionPlaybackState(binding.characterActionPlayback)
    }
    // New explicit text play is a restart, even for the current ID/default count.
    if (options !== undefined) interruptViewerCharacterAction(binding, 'explicit action replay')
    clearViewerCharacterActionRepetition(binding)
    binding.character.animation.clearRepetitionLimit()
    const request = { loading: false }
    const generation = binding.sceneCharacter.loadGeneration
    viewerCharacterActionPlayRequests.set(binding, request)
    const currentRequest = () => viewerCharacterActionPlayRequests.get(binding) === request
        && !binding.character.disposed
        && scene.characterSelected?.character === binding.character
        && binding.sceneCharacter.character === binding.character
        && binding.sceneCharacter.loadGeneration === generation
    const staleRequest = () => cloneCharacterActionPlaybackState({
        ...emptyCharacterActionPlaybackState(binding.characterActionPlaybackRate),
        status: 'unavailable', actionId,
        characterId: Number(binding.character.userData.characterId),
        reason: 'character action request cancelled, superseded or selected character changed',
    })
    let startCueEmitted = false
    const started = () => {
        if (!currentRequest() || startCueEmitted) return
        startCueEmitted = true
        configureViewerCharacterActionRepetition(binding, repetitions)
        emitStartedViewerCharacterActionCue(binding, actionId)
    }
    const locomotionProfilePrefix = 'viewer-locomotion-profile:101901:'
    if (actionId.startsWith(locomotionProfilePrefix)) {
        if (repetitions !== undefined) throw new TypeError('locomotion profile selection is not a repeatable action')
        const variantId = actionId.slice(locomotionProfilePrefix.length)
        const variant = activateCharacterSpecificMotionVariant(binding, variantId)
        binding.characterActionPlayback = variant ? {
            status: 'idle',
            actionId,
            characterId: Number(binding.character.userData.characterId),
            runtimeName: primaryLocomotionAnimation(variant.animations.idle),
            timeSeconds: 0,
            durationSeconds: 0,
            loop: false,
            reason: `${variant.label} 已启用`,
        } : {
            status: 'unavailable',
            actionId,
            characterId: Number(binding.character.userData.characterId),
            timeSeconds: 0,
            durationSeconds: 0,
            loop: false,
            reason: `locomotion profile ${variantId} is unavailable`,
        }
        feedbackOutput.value = binding.characterActionPlayback.reason ?? variantId
        feedbackOutput.textContent = feedbackOutput.value
        emitCharacterActionPlaybackState(binding)
        return cloneCharacterActionPlaybackState(binding.characterActionPlayback)
    }
    const directHomeDeclaration = binding.directHomeActions.entries.find(entry => entry.id === actionId)
    if (directHomeDeclaration) {
        const active = binding.directHomeActions.active
        if (
            active?.catalogActionId === actionId
            && binding.characterActionPlayback.status === 'paused'
        ) {
            active.timeline?.play()
            binding.character.animation.paused = false
            applyViewerCharacterActionMixerRate(binding)
            binding.characterActionPlayback = {
                ...binding.characterActionPlayback,
                status: 'playing',
                reason: undefined,
            }
        } else if (active?.catalogActionId !== actionId || binding.characterActionPlayback.status !== 'playing') {
            if (
                characterActionPlaybackBlocksLocomotion(binding)
                || binding.combatJumpActions.activeJumpDonorPlayback
            ) {
                interruptViewerCharacterAction(binding, 'replaced by another exact direct Home action')
            }
            try {
                binding.characterActionPlayback = startDirectHomePlayback(binding, directHomeDeclaration)
                started()
            } catch (error) {
                binding.characterActionPlayback = {
                    status: 'unavailable',
                    actionId,
                    characterId: Number(binding.character.userData.characterId),
                    timeSeconds: 0,
                    durationSeconds: 0,
                    loop: false,
                    reason: error instanceof Error ? error.message : String(error),
                }
            }
        }
        emitCharacterActionPlaybackState(binding)
        return cloneCharacterActionPlaybackState(binding.characterActionPlayback)
    }
    request.loading = true
    await Promise.all([
        ensureNativeDungeonActions(binding),
        ensureCombatJumpActions(binding),
    ])
    if (!currentRequest()) return staleRequest()
    request.loading = false
    const skeletonSourceId = combatSkeletonSourceActionId(actionId)
    if (skeletonSourceId) {
        const activeSkeleton = binding.combatJumpActions.activeSkeletonPlayback
        if (activeSkeleton?.catalogActionId === actionId && binding.characterActionPlayback.status === 'paused') {
            activeSkeleton.playback.play()
            binding.characterActionPlayback = { ...binding.characterActionPlayback, status: 'playing', reason: undefined }
            emitCharacterActionPlaybackState(binding)
            return cloneCharacterActionPlaybackState(binding.characterActionPlayback)
        }
        const skeletonEntry = binding.combatJumpActions.entries.find(entry => (
            entry.id === skeletonSourceId
        ))
        const previewEntry = skeletonEntry
            ? exactCombatSkeletonPreviewEntry(binding, skeletonEntry)
            : undefined
        const availability = skeletonEntry
            ? combatSkeletonConsumerAvailability(binding, skeletonEntry, true)
            : undefined
        if (!skeletonEntry || !previewEntry || !availability?.playable) {
            binding.characterActionPlayback = {
                status: 'unavailable',
                actionId,
                characterId: Number(binding.character.userData.characterId),
                timeSeconds: 0,
                durationSeconds: 0,
                loop: false,
                reason: availability?.reason ?? `combat skeleton source ${skeletonSourceId} is unavailable`,
            }
        } else {
            try {
                request.loading = true
                await ensureCombatSpecialWeapon(binding, skeletonSourceId)
                if (!currentRequest()) return staleRequest()
                request.loading = false
                binding.characterActionPlayback = startCombatSkeletonPlayback(
                    binding,
                    previewEntry,
                    actionId,
                )
                started()
            } catch (error) {
                request.loading = false
                binding.characterActionPlayback = {
                    status: 'unavailable',
                    actionId,
                    characterId: Number(binding.character.userData.characterId),
                    timeSeconds: 0,
                    durationSeconds: 0,
                    loop: false,
                    reason: error instanceof Error ? error.message : String(error),
                }
            }
        }
        emitCharacterActionPlaybackState(binding)
        return cloneCharacterActionPlaybackState(binding.characterActionPlayback)
    }
    const combatEntry = binding.combatJumpActions.entries.find(entry => entry.id === actionId)
    if (combatEntry) {
        if (repetitions !== undefined && repetitions !== 1) {
            binding.characterActionPlayback = { ...emptyCharacterActionPlaybackState(binding.characterActionPlaybackRate),
                status: 'unavailable', actionId, characterId: Number(binding.character.userData.characterId),
                reason: 'controller-owned three-phase jump supports one launch only; repetitions 0 or greater than 1 are unavailable' }
            emitCharacterActionPlaybackState(binding)
            return cloneCharacterActionPlaybackState(binding.characterActionPlayback)
        }
        if (
            binding.combatJumpActions.activeJumpDonorPlayback?.actionId === actionId
            && binding.characterActionPlayback.status === 'paused'
        ) {
            binding.character.animation.paused = false
            applyViewerCharacterActionMixerRate(binding)
            binding.characterActionPlayback = {
                ...binding.characterActionPlayback,
                status: 'playing',
                reason: undefined,
            }
            emitCharacterActionPlaybackState(binding)
            return cloneCharacterActionPlaybackState(binding.characterActionPlayback)
        }
        const availability = combatJumpConsumerAvailability(binding, combatEntry, true)
        const jumpSequence = binding.combatJumpActions.previewJumpSequences.get(actionId)
        if (!availability.playable || !jumpSequence) {
            binding.characterActionPlayback = {
                status: 'unavailable',
                actionId,
                characterId: Number(binding.character.userData.characterId),
                timeSeconds: 0,
                durationSeconds: 0,
                loop: false,
                reason: availability.reason ?? `combat/jump action ${actionId} is unavailable`,
            }
            emitCharacterActionPlaybackState(binding)
            return cloneCharacterActionPlaybackState(binding.characterActionPlayback)
        }
        binding.characterActionPlayback = startCombatJumpDonorPlayback(binding, combatEntry)
        started()
        emitCharacterActionPlaybackState(binding)
        return cloneCharacterActionPlaybackState(binding.characterActionPlayback)
    }
    const native = binding.nativeDungeonActions
    const descriptor = nativeDungeonActionDescriptor(native, actionId)
    if (
        scene.characterSelected?.character !== binding.character
        || native.status !== 'attached'
        || !descriptor
    ) {
        binding.characterActionPlayback = {
            status: 'unavailable',
            actionId,
            characterId: Number(binding.character.userData.characterId),
            timeSeconds: 0,
            durationSeconds: 0,
            loop: false,
            reason: scene.characterSelected?.character !== binding.character
                ? 'selected character changed while action was loading'
                : native.reason ?? `action ${actionId} is unavailable for the selected character`,
        }
        emitCharacterActionPlaybackState(binding)
        return cloneCharacterActionPlaybackState(binding.characterActionPlayback)
    }
    if (
        binding.characterActionPlayback.actionId === actionId
        && binding.characterActionPlayback.runtimeName === descriptor.clip.runtimeName
        && familyEquals(
            binding.characterActionPlayback.runtimeName,
            binding.character.animation.current ?? '',
        )
    ) {
        if (binding.characterActionPlayback.status === 'paused') {
            binding.character.animation.paused = false
            applyViewerCharacterActionMixerRate(binding)
            binding.characterActionPlayback = {
                ...binding.characterActionPlayback,
                status: 'playing',
                timeSeconds: binding.character.animation.time,
                reason: undefined,
            }
            emitCharacterActionPlaybackState(binding)
        }
        if (binding.characterActionPlayback.status === 'playing') {
            return cloneCharacterActionPlaybackState(binding.characterActionPlayback)
        }
    }
    if (
        characterActionPlaybackBlocksLocomotion(binding)
        || binding.combatJumpActions.activeJumpDonorPlayback
    ) {
        interruptViewerCharacterAction(binding, 'replaced by another explicit character action')
    }
    const current = binding.character.animation.current
    if (current && !isNativeDungeonAnimation(binding, current)) native.baselineAnimation = current
    native.active = true
    setNativeDungeonExternalAttachmentsHidden(binding, true)
    binding.characterActionAuthoredSpeed = 1
    binding.animationPort.play(descriptor.clip.runtimeName, {
        loop: descriptor.playback === 'loop',
        speed: effectiveViewerCharacterActionMixerRate(binding),
        weight: 1,
        fadeSeconds: 0.12,
    })
    binding.characterActionPlayback = {
        status: 'playing',
        actionId: descriptor.id,
        characterId: native.dungeonCharacterId,
        runtimeName: descriptor.clip.runtimeName,
        timeSeconds: 0,
        durationSeconds: descriptor.clip.durationSeconds,
        loop: descriptor.playback === 'loop',
    }
    started()
    emitCharacterActionPlaybackState(binding)
    return cloneCharacterActionPlaybackState(binding.characterActionPlayback)
}

function setViewerCharacterActionPlaybackRate(
    playbackRate: number,
): ViewerCharacterActionPlaybackSnapshot {
    const normalizedRate = clampViewerCharacterActionPlaybackRate(playbackRate)
    const binding = selectedBinding()
    if (!binding) return emptyCharacterActionPlaybackState(normalizedRate)
    binding.characterActionPlaybackRate = normalizedRate
    binding.characterActionPlayback.playbackRate = normalizedRate
    if (
        characterActionPlaybackBlocksLocomotion(binding)
        || binding.combatJumpActions.activeJumpDonorPlayback
    ) {
        applyViewerCharacterActionMixerRate(binding)
    }
    emitCharacterActionPlaybackState(binding)
    return cloneCharacterActionPlaybackState(
        binding.characterActionPlayback,
        binding.characterActionPhysicsPhase.state,
        normalizedRate,
    )
}

function playViewerPerformanceAction(binding: ViewerLocomotionBinding, beat: ViewerPerformanceBeat, emit: boolean): void {
    const name = beat.name
    const direct = binding.directHomeActions.entries.find(entry => entry.id === name)
    const skeletonSource = combatSkeletonSourceActionId(name)
    const skeletonEntry = skeletonSource ? binding.combatJumpActions.entries.find(entry => entry.id === skeletonSource) : undefined
    const skeleton = skeletonEntry ? exactCombatSkeletonPreviewEntry(binding, skeletonEntry) : undefined
    const native = nativeDungeonActionDescriptor(binding.nativeDungeonActions, name)
    const family = binding.character.animations.includes(name) ? name : undefined
    if (!direct && !skeleton && !native && !family) throw new Error(`exact actor action unavailable or not pose-sampleable:${name}`)
    // Capture once before any stop/reset, including a different occurrence of
    // the same authored key. All routes keep the actor's existing mixer/rig.
    binding.tpsPoseTransition?.begin(beat.transitionSeconds)
    interruptViewerCharacterAction(binding, 'performance action occurrence replaced prior action')
    if (direct) binding.characterActionPlayback = startDirectHomePlayback(binding, direct)
    else if (skeleton) binding.characterActionPlayback = startCombatSkeletonPlayback(binding, skeleton, name)
    else {
        stopActiveCombatSkeletonPlayback(binding)
        stopActiveDirectHomePlayback(binding)
        const runtimeName = native?.clip.runtimeName ?? family!
        binding.character.animation.play(runtimeName, beat.loop, { transitionSeconds: beat.transitionSeconds, localTimeSeconds: beat.localTimeSeconds })
        binding.characterActionPlayback = {
            status: 'playing', actionId: name, characterId: Number(binding.character.userData.characterId), runtimeName,
            timeSeconds: beat.localTimeSeconds, durationSeconds: native?.clip.durationSeconds ?? binding.character.animation.duration,
            loop: beat.loop,
        }
    }
    if (binding.characterActionPlayback.status !== 'playing') throw new Error(binding.characterActionPlayback.reason ?? 'performance action failed to start')
    // Only a new leased occurrence emits; pose sampling and resume never do.
    if (emit) emitStartedViewerCharacterActionCue(binding, name)
    pauseViewerCharacterAction(binding)
}

function sampleViewerPerformanceAction(binding: ViewerLocomotionBinding, name: string, time: number, loop: boolean): void {
    if (binding.characterActionPlayback.actionId !== name) throw new Error('performance sample does not own the current action')
    binding.characterActionPlayback.loop = loop
    // Timeline seeking evaluates body/weapon phases but never invokes the
    // registered controller request or the cue/voice event transport.
    seekViewerCharacterAction(time, binding)
    binding.character.animation.paused = true
}

function pauseViewerCharacterAction(actorBinding?: ViewerLocomotionBinding): ViewerCharacterActionPlaybackSnapshot {
    const binding = actorBinding ?? selectedBinding()
    if (!binding || binding.characterActionPlayback.status !== 'playing') {
        return binding
            ? cloneCharacterActionPlaybackState(binding.characterActionPlayback)
            : emptyCharacterActionPlaybackState()
    }
    const activeSkeleton = binding.combatJumpActions.activeSkeletonPlayback
    const activeDirectHome = binding.directHomeActions.active
    activeSkeleton?.playback.pause()
    activeDirectHome?.timeline?.pause()
    binding.character.animation.paused = true
    binding.characterActionPlayback = {
        ...binding.characterActionPlayback,
        status: 'paused',
        timeSeconds: activeSkeleton?.playback.state().timeSeconds
            ?? activeDirectHome?.timeline?.time
            ?? binding.character.animation.time,
    }
    emitCharacterActionPlaybackState(binding)
    return cloneCharacterActionPlaybackState(binding.characterActionPlayback)
}

function seekViewerCharacterAction(timeSeconds: number, actorBinding?: ViewerLocomotionBinding): ViewerCharacterActionPlaybackSnapshot {
    if (!Number.isFinite(timeSeconds)) throw new TypeError('character action seek time must be finite')
    const binding = actorBinding ?? selectedBinding()
    if (binding && viewerCharacterActionRepetitions.get(binding)?.finished) {
        binding.characterActionPlayback.status = 'paused'
        binding.character.animation.paused = true
    }
    if (!binding || !characterActionPlaybackBlocksLocomotion(binding)) {
        return binding
            ? cloneCharacterActionPlaybackState(binding.characterActionPlayback)
            : emptyCharacterActionPlaybackState()
    }
    const duration = binding.characterActionPlayback.durationSeconds
    const time = binding.characterActionPlayback.loop && duration > 0
        ? ((timeSeconds % duration) + duration) % duration
        : THREE.MathUtils.clamp(timeSeconds, 0, duration)
    const activeSkeleton = binding.combatJumpActions.activeSkeletonPlayback
    if (activeSkeleton) {
        activeSkeleton.playback.seek(time)
        applyCombatSkeletonPose(binding, activeSkeleton)
    } else if (binding.directHomeActions.active) {
        seekActiveDirectHomePlayback(binding, binding.directHomeActions.active, time)
    } else {
        seekViewerCharacterActionMixer(binding, time)
    }
    binding.characterActionPlayback = {
        ...binding.characterActionPlayback,
        timeSeconds: time,
    }
    emitCharacterActionPlaybackState(binding)
    return cloneCharacterActionPlaybackState(binding.characterActionPlayback)
}

function stepViewerCharacterAction(deltaSeconds: number): ViewerCharacterActionPlaybackSnapshot {
    if (!Number.isFinite(deltaSeconds)) throw new TypeError('character action step delta must be finite')
    const binding = selectedBinding()
    if (!binding || !characterActionPlaybackBlocksLocomotion(binding)) {
        return binding
            ? cloneCharacterActionPlaybackState(binding.characterActionPlayback)
            : emptyCharacterActionPlaybackState()
    }
    const currentTime = binding.directHomeActions.active?.timeline?.time
        ?? binding.character.animation.time
    return seekViewerCharacterAction(currentTime + deltaSeconds)
}

function disposeViewerCharacterAction(): ViewerCharacterActionPlaybackSnapshot {
    const binding = selectedBinding()
    if (!binding) return emptyCharacterActionPlaybackState()
    viewerCharacterActionPlayRequests.delete(binding)
    clearViewerCharacterActionRepetition(binding)
    releaseViewerCharacterActionPhysicsPhase(binding, 'character action disposed')
    stopActiveCombatJumpDonorPlayback(binding)
    stopActiveCombatSkeletonPlayback(binding)
    stopActiveDirectHomePlayback(binding)
    binding.character.animation.paused = false
    binding.characterActionAuthoredSpeed = 1
    binding.characterActionPlayback = emptyCharacterActionPlaybackState(
        binding.characterActionPlaybackRate,
    )
    if (enabled) resumeViewerLocomotionIdle(binding)
    else deactivateNativeDungeonPresentation(binding, true)
    emitCharacterActionPlaybackState(binding)
    return cloneCharacterActionPlaybackState(binding.characterActionPlayback)
}

function synchronizeViewerCharacterActionState(
    binding: ViewerLocomotionBinding,
    deltaSeconds: number,
): void {
    if (!characterActionPlaybackBlocksLocomotion(binding)) return
    const activeDirectHome = binding.directHomeActions.active
    if (activeDirectHome) {
        if (activeDirectHome.timeline) {
            if (binding.characterActionPlayback.status === 'playing') {
                const epoch = observeViewerPerformanceTimelineMixer(binding), minimumRevision = epoch.revision + 1
                if (!advanceViewerCharacterActionTimelineRepetition(binding, deltaSeconds)) activeDirectHome.timeline.update(deltaSeconds)
                publishViewerPerformanceTimelineProducer(binding, activeDirectHome, minimumRevision)
            }
            binding.characterActionPlayback.timeSeconds = activeDirectHome.timeline.time
            if (
                binding.characterActionPlayback.status === 'playing'
                && !activeDirectHome.timeline.playing
                && activeDirectHome.timeline.time >= activeDirectHome.timeline.duration - 1e-6
            ) {
                if (deltaSeconds <= 0) return
                releaseViewerCharacterActionPhysicsPhase(binding, 'direct Home action completed')
                const finiteCompleted = viewerCharacterActionRepetitions.get(binding)?.finished
                if (!finiteCompleted) binding.directHomeActions.active = undefined
                binding.character.animation.paused = !!finiteCompleted
                binding.characterActionPlayback = {
                    ...binding.characterActionPlayback,
                    status: 'idle',
                    timeSeconds: activeDirectHome.timeline.duration,
                    reason: `official Home ${activeDirectHome.profileActionId} completed; exact Wait restored`,
                }
                emitCharacterActionPlaybackState(binding)
            }
            return
        }
        const current = binding.character.animation.current
        if (!familyEquals(activeDirectHome.runtimeName, current ?? '')) {
            interruptViewerCharacterAction(binding, 'direct Home animation mixer was changed by another control')
            return
        }
        if (synchronizeViewerCharacterActionClipRepetition(binding, deltaSeconds)) return
        binding.characterActionPlayback.timeSeconds = binding.character.animation.time
        binding.characterActionPlayback.status = binding.character.animation.paused ? 'paused' : 'playing'
        if (!binding.character.animation.paused) {
            const epoch = observeViewerPerformanceTimelineMixer(binding)
            publishViewerPerformanceTimelineProducer(binding, activeDirectHome, epoch.revision + 1)
        }
        return
    }
    const activeSkeleton = binding.combatJumpActions.activeSkeletonPlayback
    if (activeSkeleton) {
        if (binding.characterActionPlayback.status === 'playing') {
            if (!advanceViewerCharacterActionTimelineRepetition(binding, deltaSeconds)) activeSkeleton.playback.step(deltaSeconds)
            applyCombatSkeletonPose(binding, activeSkeleton)
        }
        const state = activeSkeleton.playback.state()
        binding.characterActionPlayback.timeSeconds = state.timeSeconds
        if (
            binding.characterActionPlayback.status === 'playing'
            && !state.playing
            && state.timeSeconds >= state.durationSeconds - 1e-6
        ) {
            if (deltaSeconds <= 0) return
            releaseViewerCharacterActionPhysicsPhase(binding, 'combat skeleton action completed')
            const finiteCompleted = viewerCharacterActionRepetitions.get(binding)?.finished
            if (finiteCompleted) activeSkeleton.playback.pause()
            else stopActiveCombatSkeletonPlayback(binding)
            binding.characterActionPlayback = {
                ...binding.characterActionPlayback,
                status: 'idle',
                timeSeconds: state.durationSeconds,
                reason: 'body/weapon preview completed; locomotion restored',
            }
            if (!finiteCompleted) {
                if (enabled) resumeViewerLocomotionIdle(binding)
                else deactivateNativeDungeonPresentation(binding, true)
            }
            emitCharacterActionPlaybackState(binding)
        }
        return
    }
    const expected = binding.characterActionPlayback.runtimeName
    const current = binding.character.animation.current
    if (!expected || !familyEquals(expected, current ?? '')) {
        interruptViewerCharacterAction(binding, 'animation mixer was changed by another control')
        return
    }
    if (synchronizeViewerCharacterActionClipRepetition(binding, deltaSeconds)) return
    binding.characterActionPlayback.timeSeconds = binding.character.animation.time
    binding.characterActionPlayback.status = binding.character.animation.paused ? 'paused' : 'playing'
}

function synchronizeActiveCombatJumpDonorPlayback(
    binding: ViewerLocomotionBinding,
    deltaSeconds: number,
): void {
    const active = binding.combatJumpActions.activeJumpDonorPlayback
    if (!active) return
    active.elapsedSeconds += deltaSeconds
    binding.characterActionPlayback.timeSeconds = Math.min(
        active.elapsedSeconds,
        active.sequence.durationSeconds,
    )
    const jumpState = binding.snapshot.state === 'jump'
        || binding.snapshot.state === 'fall'
        || binding.snapshot.state === 'land'
        || !binding.snapshot.grounded
    if (jumpState) active.jumpStateObserved = true
    const groundedLocomotionRestored = active.jumpStateObserved
        && binding.snapshot.grounded
        && (
            binding.snapshot.state === 'idle'
            || binding.snapshot.state === 'walk'
            || binding.snapshot.state === 'run'
        )
    const timedOut = active.elapsedSeconds > Math.max(active.sequence.durationSeconds + 2, 4)
    if (!groundedLocomotionRestored && !timedOut) {
        if (binding.characterActionPlayback.status !== 'paused') {
            const epoch = observeViewerPerformanceTimelineMixer(binding)
            publishViewerPerformanceTimelineProducer(binding, active, epoch.revision + 1)
        }
        return
    }
    // The donor only supplies the three jump poses; the controller owns all
    // travel.  At the grounded hand-off, clear any residual air velocity so
    // releasing WASD during the jump never turns into a post-landing slide.
    // A held direction is sampled again on the next frame and accelerates
    // normally from rest.
    if (groundedLocomotionRestored) binding.controller.stopHorizontalMotion()
    releaseViewerCharacterActionPhysicsPhase(
        binding,
        groundedLocomotionRestored
            ? 'combat jump donor landed'
            : 'combat jump donor timed out',
    )
    stopActiveCombatJumpDonorPlayback(binding)
    binding.characterActionPlayback = {
        ...binding.characterActionPlayback,
        status: groundedLocomotionRestored ? 'idle' : 'interrupted',
        timeSeconds: active.elapsedSeconds,
        reason: groundedLocomotionRestored
            ? '三段跳已落地；TPS 横向/垂直位移及 locomotion 已恢复'
            : '三段跳超过 controller 落地窗口，已恢复 locomotion',
    }
    emitCharacterActionPlaybackState(binding)
}

function triggerAction(slot: ActionSlotDefinition): boolean {
    const binding = selectedBinding()
    if (binding && viewerPerformanceClaims.get(binding.character.object)?.channels.action) return false
    const catalogActionId = binding?.catalogActionIds.get(slot.code)
    if (binding && catalogActionId) {
        feedbackOutput.value = `${slot.key}: queued ${catalogActionId}`
        feedbackOutput.textContent = feedbackOutput.value
        void playViewerCharacterAction(catalogActionId).then(state => {
            feedbackOutput.value = state.reason
                ? `${slot.key}: ${state.status} — ${state.reason}`
                : `${slot.key}: ${state.status}`
            feedbackOutput.textContent = feedbackOutput.value
        })
        return true
    }
    const clip = binding?.actionClips.get(slot.code)
    if (!binding || !binding.safety.allowCombatActions || !clip) {
        feedbackOutput.value = `${slot.key}: 未绑定（需要该角色官方动作与附件 rig 验证）`
        feedbackOutput.textContent = feedbackOutput.value
        return false
    }
    const result = binding.controller.requestAction(`key:${slot.key}`)
    if (result.accepted) binding.pendingAction = true
    feedbackOutput.value = result.accepted
        ? `${slot.key}: queued ${clip}`
        : `${slot.key}: ${result.reason ?? 'rejected'}`
    feedbackOutput.textContent = feedbackOutput.value
    return result.accepted
}

function movementAxes(): { moveX: number; moveZ: number; run: boolean; jumpPressed: boolean } {
    if (virtualInput) {
        const value = { ...virtualInput }
        virtualInput.jumpPressed = false
        return value
    }
    const moveX = Number(pressed.has('KeyD') || pressed.has('ArrowRight'))
        - Number(pressed.has('KeyA') || pressed.has('ArrowLeft'))
    const moveZ = Number(pressed.has('KeyW') || pressed.has('ArrowUp'))
        - Number(pressed.has('KeyS') || pressed.has('ArrowDown'))
    const value = {
        moveX,
        moveZ,
        run: pressed.has('ShiftLeft') || pressed.has('ShiftRight'),
        jumpPressed: jumpQueued,
    }
    jumpQueued = false
    return value
}

function cameraRelativeInput(binding: ViewerLocomotionBinding, input: ReturnType<typeof movementAxes>) {
    // Movement is reconstructed from the independent yaw accumulator. Never
    // project the camera forward vector near the pitch clamp: that projection
    // becomes ill-conditioned and previously caused a sudden sideways turn.
    const forward = new THREE.Vector3(
        -Math.sin(cameraYawUnwrapped),
        0,
        -Math.cos(cameraYawUnwrapped),
    )
    const right = new THREE.Vector3(
        Math.cos(cameraYawUnwrapped),
        0,
        -Math.sin(cameraYawUnwrapped),
    )
    const direction = new THREE.Vector3()
        .addScaledVector(right, input.moveX)
        .addScaledVector(forward, input.moveZ)
    if (direction.lengthSq() > 1) direction.normalize()
    const parent = binding.character.object.parent
    if (parent) {
        direction.applyQuaternion(parent.getWorldQuaternion(new THREE.Quaternion()).invert())
    }
    return {
        moveX: direction.x,
        moveZ: direction.z,
        run: input.run,
        jumpPressed: input.jumpPressed,
    }
}

function updateTpsCamera(binding: ViewerLocomotionBinding, _deltaSeconds: number): void {
    // OrbitControls has its own camera writer. Keep it suspended for the whole
    // TPS frame even when another editor releases its controls lease mid-frame.
    scene.controls.enabled = false
    // Pointer deltas already define a linear angular displacement. Consume
    // them once, without queuing angular or positional catch-up after release.
    cameraYawUnwrapped = cameraYawTargetUnwrapped
    cameraPitch = THREE.MathUtils.clamp(
        cameraPitchTarget,
        TPS_CAMERA_POINTER.minPitchRadians,
        TPS_CAMERA_POINTER.maxPitchRadians,
    )
    cameraDistance = cameraDistanceTarget
    binding.character.object.getWorldPosition(cameraTarget)
    cameraTarget.y += 1.05
    const horizontal = Math.cos(cameraPitch) * cameraDistance
    const desired = new THREE.Vector3(
        cameraTarget.x + Math.sin(cameraYawUnwrapped) * horizontal,
        cameraTarget.y + Math.sin(cameraPitch) * cameraDistance,
        cameraTarget.z + Math.cos(cameraYawUnwrapped) * horizontal,
    )
    scene.camera.position.copy(desired)
    scene.camera.up.set(0, 1, 0)
    // Orientation is owned by yaw/pitch, not by the camera-to-target length.
    // At zero dolly distance lookAt(cameraTarget) loses its direction and snaps
    // to an unrelated heading. The same angular frame remains valid at zero.
    scene.camera.quaternion.setFromEuler(new THREE.Euler(-cameraPitch, cameraYawUnwrapped, 0, 'YXZ'))
    scene.controls.target.copy(cameraTarget)
}

function objectHierarchyPath(object: THREE.Object3D): string {
    const parts: string[] = []
    for (let current: THREE.Object3D | null = object; current; current = current.parent) {
        parts.unshift(current.name || '<unnamed>')
    }
    return parts.join('/')
}

function attachmentDiagnostics(character: ViewerCharacter) {
    const anchors: Array<Record<string, unknown>> = []
    const anchorName = /^(?:Weapon_[LR]|Weapon_Attach|weapon_[a-z0-9_]*joint_gp|Grip_[A-Z0-9_]+)$/i
    character.object.updateMatrixWorld(true)
    character.object.traverse(object => {
        if (!anchorName.test(object.name) && !/^chara_\d+_weapon_[a-z0-9_]*model$/i.test(object.name)) return
        anchors.push({
            name: object.name,
            path: objectHierarchyPath(object),
            parentPath: object.parent ? objectHierarchyPath(object.parent) : null,
            localPosition: object.position.toArray(),
            localQuaternion: object.quaternion.toArray(),
            localScale: object.scale.toArray(),
            worldPosition: object.getWorldPosition(new THREE.Vector3()).toArray(),
            worldQuaternion: object.getWorldQuaternion(new THREE.Quaternion()).toArray(),
        })
    })
    return anchors.sort((left, right) => String(left.path).localeCompare(String(right.path)))
}

function writeDebugState(binding?: ViewerLocomotionBinding): void {
    if (!binding) {
        debugState.textContent = JSON.stringify({ enabled, selected: null })
        return
    }
    const snapshot = binding.snapshot
    debugState.textContent = JSON.stringify({
        enabled,
        fps: measuredFps,
        pointerLocked: document.pointerLockElement === scene.renderer.domElement,
        physicalPressedCodes: [...pressed].sort(),
        jumpQueued,
        camera: {
            yawUnwrapped: cameraYawUnwrapped,
            yawTargetUnwrapped: cameraYawTargetUnwrapped,
            pitch: cameraPitch,
            pitchTarget: cameraPitchTarget,
            distance: cameraDistance,
            distanceTarget: cameraDistanceTarget,
            rollPolicy: 'world-up-lookAt-zero-roll',
            collisionAzimuthPolicy: 'preserve-unwrapped-yaw',
            dragPointerId: cameraDragPointerId ?? null,
            freeLookFallbackActive: cameraFreeLookFallbackActive,
            inputTrace: cameraInputTrace,
            wheelTrace: cameraWheelTrace,
            orbit: {
                controlsEnabled: scene.controls.enabled,
                currentCanvas: scene.controls.domElement === scene.renderer.domElement,
                sessionActive: orbitCameraSessionActive,
                cameraPosition: scene.camera.position.toArray(),
                cameraUp: scene.camera.up.toArray(),
                cameraZoom: scene.camera.zoom,
                target: scene.controls.target.toArray(),
                handoffPolicy: 'preserve-final-tps-view',
                leaseControlsEnabled: orbitControlsLease?.controlsEnabled ?? null,
                canvasRebindCount: orbitControlsCanvasRebindCount,
            },
        },
        characterId: binding.character.userData.characterId,
        state: snapshot.state,
        grounded: snapshot.grounded,
        position: snapshot.position.toArray(),
        quaternion: snapshot.quaternion.toArray(),
        velocity: snapshot.velocity.toArray(),
        animationPlaybackRate: binding.animationPlaybackRate,
        currentClip: binding.character.animation.current ?? null,
        action: snapshot.activeAction ?? null,
        locomotionAnimations: binding.locomotionAnimations,
        actionClips: Object.fromEntries(binding.actionClips),
        catalogActionIds: Object.fromEntries(binding.catalogActionIds),
        locomotionStepDiagnostics: binding.controller.getStepDiagnostics(),
        collision: {
            mode: binding.collision.mode,
            targetStageId: firstInteractionStageId,
            actualStageId: binding.collision.stageId,
            interactionReady: binding.collision.interactionReady,
            exactGroundPath: firstInteractionGroundPath,
            sourceAssetGroundPath: firstInteractionSourceGroundPath,
            stageMeshCount: binding.collision.meshCount,
            profileProbe: binding.collision.profileProbe,
            status: binding.collision.groundStatus,
            lastConfirmedGroundY: binding.collision.confirmedGroundY,
        },
        rigSafety: binding.safety,
        controlAuthority: binding.controlAuthority,
        nativeDungeonActions: {
            status: binding.nativeDungeonActions.status,
            source: binding.nativeDungeonActions.source ?? null,
            dungeonCharacterId: binding.nativeDungeonActions.dungeonCharacterId,
            modelKey: binding.nativeDungeonActions.modelKey ?? null,
            active: binding.nativeDungeonActions.active,
            controllerReady: binding.nativeDungeonActions.controllerReady,
            loadAttempts: binding.nativeDungeonActions.loadAttempts,
            errorCode: binding.nativeDungeonActions.errorCode ?? null,
            reason: binding.nativeDungeonActions.reason ?? null,
            actions: binding.nativeDungeonActions.entries.map(entry => ({
                id: entry.id,
                semantic: entry.clip.semantic,
                runtimeName: entry.clip.runtimeName,
                sourceClipPathId: entry.clip.pathId,
                durationSeconds: entry.clip.durationSeconds,
                playback: entry.playback,
                sourceFamily: entry.sourceFamily,
                compatibility: entry.compatibility,
            })),
            externalAttachments: binding.nativeDungeonActions.externalAttachments.map(attachment => ({
                path: objectHierarchyPath(attachment.object),
                originalVisible: attachment.visible,
                currentVisible: attachment.object.visible,
            })),
        },
        combatJumpActions: {
            status: binding.combatJumpActions.status,
            characterId: binding.combatJumpActions.characterId,
            loadAttempts: binding.combatJumpActions.loadAttempts,
            errorCode: binding.combatJumpActions.errorCode ?? null,
            reason: binding.combatJumpActions.reason ?? null,
            entryCount: binding.combatJumpActions.entries.length,
            loadedClipCount: binding.combatJumpActions.loaded?.clips.length ?? 0,
            previewEntryIds: [...binding.combatJumpActions.previewClips.keys()],
            exactLocomotion: binding.combatJumpActions.exactLocomotion ?? null,
            rootPolicy: binding.combatJumpActions.exactLocomotion ? 'controller-all' : null,
            attachmentPolicy: binding.combatJumpActions.exactLocomotion
                ? 'body-only-exclude-external-weapons'
                : null,
        },
        characterActionPlayback: cloneCharacterActionPlaybackState(binding.characterActionPlayback),
        attachments: binding.attachmentRestState,
        officialDungeonLocomotion: binding.officialDungeonLocomotion,
        officialCombatActions: binding.officialCombatActions,
        characterSpecificMotion: binding.characterSpecificMotion,
        characterSpecificMotionProfiles: {
            active: binding.activeCharacterSpecificMotionVariant ?? null,
            entries: [...(binding.characterSpecificMotionVariants?.values() ?? [])].map(variant => ({
                id: variant.id,
                label: variant.label,
                active: binding.activeCharacterSpecificMotionVariant === variant.id,
                animations: variant.animations,
                source: variant.profile.gaitCalibration?.source ?? null,
                donorBlendWeights: variant.profile.gaitCalibration?.donorBlendWeights ?? {},
                donorMorphologyDistances: variant.profile.gaitCalibration
                    ?.donorMorphologyDistances ?? {},
                idleAuthority: variant.profile.idleAuthority ?? null,
            })),
        },
        officialCombatRuntimeLoad: {
            status: officialCombatLoadStatus,
            error: officialCombatLoadError ?? null,
        },
        proceduralLocomotion: binding.proceduralLocomotion?.diagnostics ?? {
            active: false,
            applied: false,
            appliedState: 'disabled-unverified-rig',
            boneCount: 0,
            missingRequiredBones: [],
        },
        cameraHeadTracking: binding.cameraHeadTracking?.diagnostics ?? {
            mode: 'not-configured',
            characterId: Number(binding.character.userData.characterId),
            eligible: false,
            capability: 'control-not-declared',
            reason: binding.controlAuthority.reason,
            active: false,
            applied: false,
            missingRequiredBones: [],
            eyeBoneCount: 0,
        },
        postAnimationWalkClearance: binding.postAnimationWalkClearance?.diagnostics ?? {
            active: false,
            appliedFrames: 0,
            skippedFrames: 0,
            skinnedSurfaceStatus: 'unavailable',
            meshPaths: [],
            triangleCount: 0,
            weightedVertexCount: 0,
            lastFrame: null,
            capturePending: false,
            captureFrames: 0,
        },
        secondaryPhysics: {
            ...(binding.secondaryPhysics?.diagnostics ?? {
                mode: 'disabled-unverified-rig',
                active: false,
                boneCount: 0,
                profileRootCount: 0,
                missingProfileRoots: [],
                sceneProbeBudgetPerStep: 0,
                sceneContacts: 0,
                bodyContacts: 0,
                resetCount: 0,
                nonFiniteCorrections: 0,
            }),
            provenance: binding.safety.allowCharacterSpecificSecondaryPhysics
                ? '101901 exact cloth-root list + custom constrained solver'
                : 'disabled pending character profile',
            updateMode: 'AnimatorLinkage',
            sceneCollisionAdapter: binding.collision.mode,
        },
        missingOfficialSlots: Object.entries(binding.locomotionAnimations)
            .filter(([state, clip]) => (
                (state === 'walk' && !/walk/i.test(String(clip)))
                || (state === 'run' && !/run|dash|sprint/i.test(String(clip)))
                || (state === 'jump' && !/jump|leap/i.test(String(clip)))
                || (state === 'fall' && !/fall|airborne|jump/i.test(String(clip)))
                || (state === 'land' && !/land|jump.*(?:end|_E)/i.test(String(clip)))
            ))
            .map(([state, clip]) => ({
                state,
                fallbackLoadedClip: clip,
                fallbackSystem: 'disabled-until-full-rig-compatible-clip',
                requiredAsset: `OFFICIAL_${state.toUpperCase()}_CLIP`,
            })),
        missingOfficialActionSlots: actionSlots
            .filter(slot => {
                const clip = binding.actionClips.get(slot.code)
                return !clip || !slot.patterns.some(pattern => pattern.test(clip))
            })
            .map(slot => ({
                key: slot.key,
                semantic: slot.semantic,
                fallbackLoadedClip: binding.actionClips.get(slot.code) ?? null,
                requiredAsset: slot.semantic === 'basicAttack'
                    ? 'BATTLE_SKILL_DIRECTION_NORMAL_ATTACK'
                    : slot.semantic === 'skill'
                        ? 'BATTLE_SKILL_DIRECTION_SKILL'
                        : slot.semantic === 'ultimate'
                            ? 'BATTLE_SKILL_DIRECTION_SPECIAL'
                            : `OFFICIAL_${slot.semantic.toUpperCase()}_CLIP`,
                requiredVfxKey: 'VFX_KEY_REQUIRED',
            })),
    })
}

function updateHud(binding?: ViewerLocomotionBinding): void {
    if (!binding) {
        stateOutput.value = 'no target'
        stateOutput.textContent = stateOutput.value
        clipOutput.value = 'clip: —'
        clipOutput.textContent = clipOutput.value
        writeDebugState()
        return
    }
    stateOutput.value = !binding.safety.allowMovement
        ? binding.safety.allowJumpSequence
            ? 'horizontal movement locked / Space jump ready'
            : 'rig unverified / movement locked'
        : binding.snapshot.state
    stateOutput.textContent = stateOutput.value
    clipOutput.value = `clip: ${binding.character.animation.current ?? '—'}`
    clipOutput.textContent = clipOutput.value
    writeDebugState(binding)
}

function synchronizeTargetRigGaitPlayback(
    binding: ViewerLocomotionBinding,
    hasDirectionalInput: boolean,
): void {
    const calibration = binding.characterSpecificMotion.gaitCalibration
    let playbackRate = 1
    if (
        characterActionPlaybackBlocksLocomotion(binding)
        || binding.combatJumpActions.activeJumpDonorPlayback
    ) {
        playbackRate = effectiveViewerCharacterActionMixerRate(binding)
    } else if (
        enabled
        && calibration
        && !binding.snapshot.activeAction
        && (binding.snapshot.state === 'walk' || binding.snapshot.state === 'run')
    ) {
        const nominalSpeed = binding.snapshot.state === 'run'
            ? calibration.runSpeedMetersPerSecond
            : calibration.walkSpeedMetersPerSecond
        const horizontalSpeed = Math.hypot(
            binding.snapshot.velocity.x,
            binding.snapshot.velocity.z,
        )
        const speedRatio = horizontalSpeed / Math.max(nominalSpeed, 1e-6)
        // A direction reversal temporarily cancels the old and new velocity
        // vectors.  That must not slow the authored gait while movement input
        // remains held; only a genuine release may decelerate the mixer.
        playbackRate = hasDirectionalInput
            ? THREE.MathUtils.clamp(speedRatio, 1, 1.1)
            : THREE.MathUtils.clamp(speedRatio, 0.35, 1.1)
    }
    binding.animationPlaybackRate = playbackRate
    binding.character.animation.mixer.timeScale = playbackRate
}

function updateFrame(): void {
    viewerPerformanceFrameId += 1
    measuredFrameCount += 1
    const frameNowMs = performance.now()
    const frameWindowMs = frameNowMs - measuredFrameWindowStartMs
    if (frameWindowMs >= 1000) {
        measuredFps = measuredFrameCount * 1000 / frameWindowMs
        measuredFrameCount = 0
        measuredFrameWindowStartMs = frameNowMs
    }
    const deltaSeconds = Math.min(getClockDelta(), 0.1)
    const selected = selectedBinding()
    const rawInput = enabled ? movementAxes() : { moveX: 0, moveZ: 0, run: false, jumpPressed: false }
    for (const binding of [...bindings]) {
        if (binding.character.disposed || binding.sceneCharacter.character !== binding.character) {
            detachViewerLocomotion(binding.sceneCharacter)
            continue
        }
        const performanceClaim = viewerPerformanceClaims.get(binding.character.object)
        if (performanceClaim?.channels.root || performanceClaim?.channels.action) {
            binding.controller.setInput({ moveX: 0, moveZ: 0, run: false, jumpPressed: false })
            binding.snapshot = binding.controller.snapshot()
            continue
        }
        const characterActionDeltaSeconds = binding.characterActionPlayback.status === 'playing'
            ? deltaSeconds * binding.characterActionPlaybackRate
            : 0
        synchronizeViewerCharacterActionState(binding, characterActionDeltaSeconds)
        const hasMovementIntent = binding === selected && (
            rawInput.jumpPressed
            || Math.hypot(rawInput.moveX, rawInput.moveZ) > 1e-4
        )
        if (hasMovementIntent && (characterActionPlaybackBlocksLocomotion(binding) || viewerCharacterActionRepetitions.get(binding)?.finished)) {
            interruptViewerCharacterAction(binding, 'movement input resumed TPS locomotion')
        }
        const playbackBlocksLocomotion = characterActionPlaybackBlocksLocomotion(binding)
        const input = binding === selected && !playbackBlocksLocomotion
            ? binding.safety.allowMovement
                ? {
                    ...cameraRelativeInput(binding, rawInput),
                    jumpPressed: rawInput.jumpPressed && binding.safety.allowJumpSequence,
                }
                : {
                    moveX: 0,
                    moveZ: 0,
                    run: false,
                    jumpPressed: rawInput.jumpPressed && binding.safety.allowJumpSequence,
                }
            : { moveX: 0, moveZ: 0, run: false, jumpPressed: false }
        binding.controller.setInput(input)
        const horizontalSpeed = Math.hypot(binding.snapshot.velocity.x, binding.snapshot.velocity.z)
        const locomotionNeedsStep = (
            input.jumpPressed
            || Math.hypot(input.moveX, input.moveZ) > 1e-4
            || horizontalSpeed > 1e-4
            || !binding.snapshot.grounded
            || binding.snapshot.state !== 'idle'
            || !!binding.combatJumpActions.activeJumpDonorPlayback
        )
        const shouldAdvance = !playbackBlocksLocomotion && (binding.pendingAction
            || !!binding.snapshot.activeAction
            || !!binding.combatJumpActions.activeJumpDonorPlayback
            || (
                binding === selected
                && enabled
                && (binding.safety.allowMovement || binding.safety.allowJumpSequence)
                && locomotionNeedsStep
            )
        )
        if (shouldAdvance) {
            binding.snapshot = binding.controller.advance(
                binding.combatJumpActions.activeJumpDonorPlayback
                    ? characterActionDeltaSeconds
                    : deltaSeconds,
            )
        } else {
            binding.snapshot = binding.controller.snapshot()
        }
        synchronizeActiveCombatJumpDonorPlayback(binding, characterActionDeltaSeconds)
        synchronizeTargetRigGaitPlayback(binding, Math.hypot(input.moveX, input.moveZ) > 1e-4)
    }
    if (enabled) {
        ensureOrbitControlsCurrentCanvas()
        scene.controls.enabled = false
        if (selected) updateTpsCamera(selected, deltaSeconds)
    } else {
        ensureOrbitControlsCurrentCanvas()
    }
    if (frameNowMs >= nextHudUpdateMs) {
        nextHudUpdateMs = frameNowMs + 100
        updateHud(selected)
    }
}

function syncCameraRigFromCurrentView(): void {
    const binding = selectedBinding()
    if (!binding) return
    binding.character.object.getWorldPosition(cameraTarget)
    cameraTarget.y += 1.05
    const offset = scene.camera.position.clone().sub(cameraTarget)
    // TPS has no authored near-distance gate.  Zero is the geometric limit;
    // near-plane/culling policy remains independent from wheel navigation.
    cameraDistance = Math.min(offset.length(), TPS_CAMERA_POINTER.maxDistanceMeters)
    const coincident = offset.length() <= Number.EPSILON * Math.max(1, cameraTarget.length()) * 16
    if (coincident) {
        // A coincident pivot has no positional heading. Recover the visible
        // camera frame rather than deriving asin(0/0) or inventing pitch zero.
        const forward = scene.camera.getWorldDirection(new THREE.Vector3())
        cameraPitch = THREE.MathUtils.clamp(
            Math.asin(THREE.MathUtils.clamp(-forward.y, -1, 1)),
            TPS_CAMERA_POINTER.minPitchRadians,
            TPS_CAMERA_POINTER.maxPitchRadians,
        )
        if (Math.hypot(forward.x, forward.z) > 1e-4) {
            cameraYawUnwrapped = Math.atan2(-forward.x, -forward.z)
        }
    } else {
        cameraPitch = THREE.MathUtils.clamp(
            Math.asin(THREE.MathUtils.clamp(offset.y / cameraDistance, -1, 1)),
            TPS_CAMERA_POINTER.minPitchRadians,
            TPS_CAMERA_POINTER.maxPitchRadians,
        )
        // Preserve the current azimuth at a nearly vertical activation view.
        if (Math.hypot(offset.x, offset.z) > 1e-4) {
            cameraYawUnwrapped = Math.atan2(offset.x, offset.z)
        }
    }
    cameraYawTargetUnwrapped = cameraYawUnwrapped
    cameraPitchTarget = cameraPitch
    cameraDistanceTarget = cameraDistance
}

function ensureOrbitControlsCurrentCanvas(): void {
    const canvas = scene.renderer.domElement
    if (scene.controls.domElement === canvas) return
    scene.controls.connect(canvas)
    orbitControlsCanvasRebindCount += 1
}

function captureOrbitControlsLease(): void {
    if (orbitCameraSessionActive) return
    ensureOrbitControlsCurrentCanvas()
    orbitControlsLease = {
        controlsEnabled: scene.controls.enabled,
    }
    orbitCameraSessionActive = true
}

function handoffFinalTpsCameraToOrbitControls(): void {
    ensureOrbitControlsCurrentCanvas()
    const lease = orbitControlsLease
    if (!lease) {
        orbitCameraSessionActive = false
        return
    }

    const finalPosition = scene.camera.position.clone()
    const finalQuaternion = scene.camera.quaternion.clone()
    const finalUp = scene.camera.up.clone()
    const finalZoom = scene.camera.zoom
    // Orbit also calls lookAt(target). At zero TPS dolly distance, retain the
    // visible direction by placing its focus on the near plane, without moving
    // the camera or limiting subsequent zoom input.
    const finalTargetDistance = Math.max(scene.camera.position.distanceTo(scene.controls.target), scene.camera.near)
    const finalTarget = new THREE.Vector3(0, 0, -1)
        .applyQuaternion(finalQuaternion)
        .multiplyScalar(finalTargetDistance)
        .add(finalPosition)
    const dampingEnabled = scene.controls.enableDamping

    // OrbitControls keeps private gesture, pan, dolly, and damping deltas. Run
    // one undamped update to consume them, then restore the exact final TPS
    // view and run a second clean update so its spherical state starts there.
    // This is a handoff, not a return to the camera that existed before TPS.
    scene.controls.enableDamping = false
    scene.controls.update()
    scene.camera.position.copy(finalPosition)
    scene.camera.quaternion.copy(finalQuaternion)
    scene.camera.up.copy(finalUp)
    scene.camera.zoom = finalZoom
    scene.camera.updateProjectionMatrix()
    scene.controls.target.copy(finalTarget)
    scene.controls.update()
    scene.camera.position.copy(finalPosition)
    scene.camera.quaternion.copy(finalQuaternion)
    scene.camera.up.copy(finalUp)
    scene.camera.zoom = finalZoom
    scene.camera.updateProjectionMatrix()
    scene.controls.target.copy(finalTarget)
    scene.controls.enableDamping = dampingEnabled
    scene.controls.saveState()
    scene.controls.enabled = lease.controlsEnabled
    orbitControlsLease = undefined
    orbitCameraSessionActive = false
}

function isViewerTpsLocomotionFamily(binding: ViewerLocomotionBinding, name: string | undefined): boolean {
    if (!name) return false
    if (isNativeDungeonAnimation(binding, name)) return true
    if (binding.characterSpecificMotion.generatedClips.some(clip => familyEquals(name, clip.name))) return true
    // Target-rig idle can intentionally reuse the authored Home family. It is
    // a valid return destination, not an outgoing generated locomotion clip.
    if ([binding.characterSpecificMotion.baselineClip, binding.character.animation.default]
        .some(baseline => baseline && familyEquals(name, baseline))) return false
    const policy = createTargetRigLocomotionTransitionPolicy(
        binding.locomotionAnimations,
        binding.characterSpecificMotion.jumpAnimations,
    )
    return policy.stateByFamily.has(normalizeAnimationFamilyName(name))
}

function releaseViewerTpsMovement(binding: ViewerLocomotionBinding): void {
    const claim = viewerPerformanceClaims.get(binding.character.object)
    // Explicit timelines and performance claims retain their animation/root lease.
    if (claim?.channels.action || claim?.channels.root || characterActionPlaybackBlocksLocomotion(binding)) return
    binding.controller.releaseMovement()
    binding.snapshot = binding.controller.snapshot()
    if (binding.snapshot.activeAction) return
    binding.animationPlaybackRate = 1
    const animation = binding.character.animation
    animation.mixer.timeScale = 1
    if (!isViewerTpsLocomotionFamily(binding, animation.current)) return
    const baseline = [
        binding.tpsBaselineAnimation,
        binding.nativeDungeonActions.baselineAnimation,
        binding.characterSpecificMotion.baselineClip,
        animation.default,
    ].find(name => name && !isViewerTpsLocomotionFamily(binding, name)
        && animation.getAnimationClipsByName(name).length > 0)
    if (baseline) {
        animation.paused = false
        animation.play(baseline, true, { transitionSeconds: targetRigLocomotionTransitionSeconds.recovery })
    }
}

export function setViewerLocomotionEnabled(value: boolean): void {
    const selected = selectedBinding()
    if (
        value
        && selected
        && !getViewerCharacterControlAuthority(selected.character).tps
    ) {
        pressed.clear()
        jumpQueued = false
        virtualInput = undefined
        feedbackOutput.value = `TPS is unavailable: ${getViewerCharacterControlAuthority(selected.character).reason}`
        feedbackOutput.textContent = feedbackOutput.value
        updateHud(selected)
        return
    }
    const wasEnabled = enabled
    if (!wasEnabled && value) captureOrbitControlsLease()
    enabled = value
    pressed.clear()
    jumpQueued = false
    virtualInput = undefined
    cameraDragPointerId = undefined
    document.body.classList.toggle('locomotion-mode-enabled', enabled)
    for (const binding of bindings) {
        if (!wasEnabled && value && !isViewerTpsLocomotionFamily(binding, binding.character.animation.current)) {
            binding.tpsBaselineAnimation = binding.character.animation.current
        }
        // Release gaze ownership and capture its evaluated pose before the
        // native baseline animation can replace the outgoing mixer output.
        binding.cameraHeadTracking?.setActive(enabled)
        if (!wasEnabled && value) binding.tpsPoseTransition?.begin()
        if (wasEnabled && !value) {
            binding.tpsPoseTransition?.begin()
            releaseViewerTpsMovement(binding)
        }
        if (binding.nativeDungeonActions.status === 'attached') {
            if (enabled) {
                if (!characterActionPlaybackBlocksLocomotion(binding)) {
                    activateNativeDungeonController(binding)
                } else {
                    binding.nativeDungeonActions.active = true
                    setNativeDungeonExternalAttachmentsHidden(binding, true)
                }
            } else if (!characterActionPlaybackBlocksLocomotion(binding)) {
                deactivateNativeDungeonPresentation(binding, true)
            }
        } else if (binding.characterSpecificMotion.status === 'attached') {
            // Parameterized target-rig locomotion is body-only. Its source idle
            // family may also contain an identity sibling weapon Animator, so
            // keep the unrelated sibling hidden both before and during TPS.
            // It is restored only when this binding is detached; a verified
            // combat timeline owns its own body+weapon presentation.
            setNativeDungeonExternalAttachmentsHidden(binding, true)
        }
        binding.proceduralLocomotion?.setActive(enabled && binding.safety.allowProceduralBones)
        binding.postAnimationWalkClearance?.setActive(
            enabled && binding.activeCharacterSpecificMotionVariant === 'set-a',
        )
        binding.secondaryPhysics?.setActive(enabled && (
            binding.safety.allowCharacterSpecificSecondaryPhysics
            || binding.safety.allowSecondaryFallback
        ))
    }
    modeToggle.setAttribute('aria-pressed', String(enabled))
    updateLocomotionModeLabel()
    hud.setAttribute('aria-hidden', String(!enabled))
    if (enabled) {
        ensureOrbitControlsCurrentCanvas()
        scene.controls.enabled = false
        if (!wasEnabled) syncCameraRigFromCurrentView()
        feedbackOutput.value = 'Click the Viewer to capture the mouse.'
    } else {
        cameraDragPointerId = undefined
        cameraFreeLookFallbackActive = false
        document.body.classList.remove('locomotion-free-look-fallback')
        if (document.pointerLockElement === scene.renderer.domElement) document.exitPointerLock()
        if (wasEnabled) handoffFinalTpsCameraToOrbitControls()
        else ensureOrbitControlsCurrentCanvas()
    }
    feedbackOutput.textContent = feedbackOutput.value
    updateHud(selectedBinding())
}

function updateLocomotionModeLabel(): void {
    modeToggle.textContent = translateUiText(enabled ? 'TPS Move: On' : 'TPS Move: Off')
    const label = translateUiText(enabled ? 'Disable TPS character control' : 'Enable TPS character control')
    modeToggle.title = label
    modeToggle.setAttribute('aria-label', label)
}

function installInputHandlers(): void {
    // Locale changes update presentation only, never re-enter camera/input setup.
    document.addEventListener('magius:localechange', updateLocomotionModeLabel)
    updateLocomotionModeLabel()
    hudToggle.addEventListener('click', event => {
        event.stopPropagation()
        const expanded = hud.classList.toggle('is-collapsed') === false
        hudToggle.setAttribute('aria-expanded', String(expanded))
        hudToggle.textContent = expanded ? '−' : '＋'
        hudToggle.title = expanded ? 'Hide TPS actions' : 'Show TPS actions'
    })
    modeToggle.addEventListener('click', () => setViewerLocomotionEnabled(!enabled))
    const releasePhysicalTpsInput = (): void => {
        pressed.clear()
        jumpQueued = false
    }
    const setFreeLookFallbackActive = (active: boolean): void => {
        cameraFreeLookFallbackActive = active
        document.body.classList.toggle('locomotion-free-look-fallback', active)
        if (!enabled) return
        feedbackOutput.value = active
            ? 'Mouse look active (browser fallback) · Esc releases pointer'
            : 'Click the Viewer to capture the mouse.'
        feedbackOutput.textContent = feedbackOutput.value
    }
    const releaseAllPhysicalTpsInput = (): void => {
        releasePhysicalTpsInput()
        cameraDragPointerId = undefined
        setFreeLookFallbackActive(false)
    }
    const requestTpsPointerLock = (canvas: HTMLCanvasElement): void => {
        if (!enabled || document.pointerLockElement === canvas) return
        if (!canvas.isConnected || canvas.ownerDocument !== document) return
        const reportUnavailable = () => {
            feedbackOutput.value = 'Mouse capture is unavailable; drag the Viewer to look around.'
            feedbackOutput.textContent = feedbackOutput.value
        }
        try {
            const request = canvas.requestPointerLock() as Promise<void> | void
            if (request && typeof request.catch === 'function') void request.catch(reportUnavailable)
        } catch {
            reportUnavailable()
        }
    }
    const isInteractiveTpsControlTarget = (target: EventTarget | null): boolean => (
        target instanceof Element
        && !!target.closest([
            'button',
            'input',
            'select',
            'textarea',
            '[contenteditable="true"]',
            '[role="button"]',
            '[role="combobox"]',
            '[role="listbox"]',
            '[role="slider"]',
        ].join(','))
    )
    const isInsideCurrentViewer = (
        clientX: number,
        clientY: number,
        canvas: HTMLCanvasElement,
    ): boolean => {
        const rect = canvas.getBoundingClientRect()
        return clientX >= rect.left
            && clientX <= rect.right
            && clientY >= rect.top
            && clientY <= rect.bottom
    }
    let tpsPointerLockOwned = false
    document.addEventListener('pointerlockchange', () => {
        const wasTpsPointerLocked = tpsPointerLockOwned
        const locked = document.pointerLockElement === scene.renderer.domElement
        tpsPointerLockOwned = locked
        if (locked) {
            cameraDragPointerId = undefined
            setFreeLookFallbackActive(false)
        } else {
            releasePhysicalTpsInput()
            setFreeLookFallbackActive(false)
        }
        document.body.classList.toggle('locomotion-pointer-locked', locked)
        if (enabled) {
            feedbackOutput.value = locked
                ? 'Mouse look active · Esc releases pointer'
                : 'Click the Viewer to capture the mouse.'
            feedbackOutput.textContent = feedbackOutput.value
        }
        if (wasTpsPointerLocked && !locked && enabled) {
            setViewerLocomotionEnabled(false)
        }
    })
    // The Viewer replaces its renderer canvas during model/stage initialization.
    // Delegate against the current canvas on every event so TPS look survives
    // that replacement and HUD overlays do not swallow the visible viewport.
    document.addEventListener('pointerdown', event => {
        const canvas = scene.renderer.domElement
        const interactiveTarget = isInteractiveTpsControlTarget(event.target)
        const insideViewer = isInsideCurrentViewer(event.clientX, event.clientY, canvas)
        if (enabled && (interactiveTarget || !insideViewer)) {
            setFreeLookFallbackActive(false)
            return
        }
        if (
            !enabled
            || document.pointerLockElement === canvas
            || event.button !== 0
        ) return
        setFreeLookFallbackActive(false)
        cameraDragPointerId = event.pointerId
        cameraDragLastX = event.clientX
        cameraDragLastY = event.clientY
        cameraDragTravelCssPixels = 0
        // Request on pointerdown while the browser still considers this a direct
        // user activation. preventDefault below intentionally keeps the drag
        // fallback stable, but may suppress the compatibility click event.
        requestTpsPointerLock(canvas)
        event.preventDefault()
    }, { capture: true })
    document.addEventListener('pointermove', event => {
        if (!enabled || document.pointerLockElement === scene.renderer.domElement) return
        const dx = event.clientX - cameraDragLastX
        const dy = event.clientY - cameraDragLastY
        if (cameraDragPointerId === event.pointerId) {
            cameraDragTravelCssPixels += Math.hypot(dx, dy)
            applyTpsCameraPointerDelta(dx, dy, 'drag-fallback')
        } else if (cameraFreeLookFallbackActive) {
            const canvas = scene.renderer.domElement
            if (
                isInteractiveTpsControlTarget(event.target)
                || !isInsideCurrentViewer(event.clientX, event.clientY, canvas)
            ) {
                cameraDragLastX = event.clientX
                cameraDragLastY = event.clientY
                return
            }
            applyTpsCameraPointerDelta(dx, dy, 'free-look-fallback')
        } else {
            return
        }
        cameraDragLastX = event.clientX
        cameraDragLastY = event.clientY
        event.preventDefault()
    }, { capture: true })
    const endCameraDrag = (event: PointerEvent, armClickFallback: boolean) => {
        if (cameraDragPointerId !== event.pointerId) return
        cameraDragPointerId = undefined
        if (
            armClickFallback
            && enabled
            && document.pointerLockElement !== scene.renderer.domElement
            && cameraDragTravelCssPixels <= TPS_CAMERA_POINTER.clickCaptureMaxTravelCssPixels
            && !isInteractiveTpsControlTarget(event.target)
            && isInsideCurrentViewer(event.clientX, event.clientY, scene.renderer.domElement)
        ) {
            cameraDragLastX = event.clientX
            cameraDragLastY = event.clientY
            setFreeLookFallbackActive(true)
        }
    }
    document.addEventListener('pointerup', event => endCameraDrag(event, true), { capture: true })
    document.addEventListener('pointercancel', event => endCameraDrag(event, false), { capture: true })
    document.addEventListener('mousemove', event => {
        if (!enabled || document.pointerLockElement !== scene.renderer.domElement) return
        applyTpsCameraPointerDelta(event.movementX, event.movementY, 'pointer-lock')
    })
    const applyTpsCameraWheelDelta = (event: WheelEvent): void => {
        if (!enabled) return
        event.preventDefault()
        const deltaModeScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? 16
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
                ? Math.max(1, scene.renderer.domElement.clientHeight)
                : 1
        const wheelDelta = THREE.MathUtils.clamp(
            event.deltaY * deltaModeScale,
            -TPS_CAMERA_POINTER.maxWheelDeltaPerEvent,
            TPS_CAMERA_POINTER.maxWheelDeltaPerEvent,
        )
        cameraDistanceTarget = Math.min(
            Math.max(0, cameraDistanceTarget + wheelDelta * TPS_CAMERA_POINTER.wheelMetersPerDelta),
            TPS_CAMERA_POINTER.maxDistanceMeters,
        )
    }
    const pushCameraWheelTrace = (trace: TpsCameraWheelTrace): void => {
        cameraWheelTrace.push(trace)
        if (cameraWheelTrace.length > 12) cameraWheelTrace.shift()
    }
    // The Viewer may replace its renderer canvas after this module is installed.
    // Delegate against the current canvas rectangle rather than requiring the
    // canvas itself to be event.target. FPS/HUD/transparent overlays sit above
    // the renderer in the real Viewer and previously swallowed ordinary wheel
    // input even though the pointer was visibly over the 3D viewport.
    document.addEventListener('wheel', event => {
        if (!enabled) return
        const canvas = scene.renderer.domElement
        const pointerLocked = document.pointerLockElement === canvas
        const target = event.target instanceof Element ? event.target : undefined
        const targetTag = target?.tagName ?? String(event.target?.constructor?.name ?? 'unknown')
        const targetId = target?.id ?? ''
        const distanceBefore = cameraDistanceTarget
        if (!pointerLocked && isInteractiveTpsControlTarget(event.target)) {
            pushCameraWheelTrace({
                accepted: false,
                reason: 'interactive-control',
                targetTag,
                targetId,
                deltaY: event.deltaY,
                distanceBefore,
                distanceAfter: distanceBefore,
            })
            return
        }
        const rect = canvas.getBoundingClientRect()
        const insideViewer = event.clientX >= rect.left
            && event.clientX <= rect.right
            && event.clientY >= rect.top
            && event.clientY <= rect.bottom
        if (!pointerLocked && !insideViewer) {
            pushCameraWheelTrace({
                accepted: false,
                reason: 'outside-viewer',
                targetTag,
                targetId,
                deltaY: event.deltaY,
                distanceBefore,
                distanceAfter: distanceBefore,
            })
            return
        }
        applyTpsCameraWheelDelta(event)
        pushCameraWheelTrace({
            accepted: true,
            reason: pointerLocked ? 'pointer-lock' : 'viewer-surface',
            targetTag,
            targetId,
            deltaY: event.deltaY,
            distanceBefore,
            distanceAfter: cameraDistanceTarget,
        })
    }, { passive: false, capture: true })
    document.addEventListener('keydown', event => {
        if (enabled && event.code === 'Escape' && !event.repeat) {
            event.preventDefault()
            releasePhysicalTpsInput()
            setFreeLookFallbackActive(false)
            setViewerLocomotionEnabled(false)
            return
        }
        if (!enabled || (isTextInputTarget(event.target) && document.pointerLockElement !== scene.renderer.domElement)) return
        if (movementCodes.has(event.code)) {
            event.preventDefault()
            pressed.add(event.code)
            if (event.code === 'Space' && !event.repeat) jumpQueued = true
            return
        }
        const slot = actionSlotByCode.get(event.code as ActionSlotCode)
        if (slot && !event.repeat) {
            event.preventDefault()
            triggerAction(slot)
        }
    }, { capture: true })
    document.addEventListener('keyup', event => pressed.delete(event.code), { capture: true })
    window.addEventListener('blur', releaseAllPhysicalTpsInput)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) releaseAllPhysicalTpsInput()
    })
    for (const slot of actionSlots) {
        slot.select.addEventListener('change', () => {
            const binding = selectedBinding()
            if (!binding) return
            if (slot.select.value.startsWith(combatSkeletonPreviewPrefix)) {
                binding.catalogActionIds.set(slot.code, slot.select.value)
                binding.actionClips.delete(slot.code)
            } else if (slot.select.value) {
                binding.catalogActionIds.delete(slot.code)
                registerAction(binding, slot, slot.select.value)
            } else {
                binding.catalogActionIds.delete(slot.code)
                binding.actionClips.delete(slot.code)
            }
        })
    }
}

export function setupViewerLocomotion(): void {
    if (installed) return
    installed = true
    installInputHandlers()
    addAnimationLoop(updateFrame)
    void ensureCharacterActionCatalog().catch(() => undefined)
    setViewerLocomotionEnabled(false)
}

const publicApi = {
    setEnabled: setViewerLocomotionEnabled,
    get enabled() { return enabled },
    setVirtualInput(input: Partial<VirtualInput>) {
        virtualInput = {
            moveX: input.moveX ?? 0,
            moveZ: input.moveZ ?? 0,
            run: input.run ?? false,
            jumpPressed: input.jumpPressed ?? false,
        }
    },
    clearVirtualInput() { virtualInput = undefined },
    captureSetAWalkDressClearanceCycle(sampleCount = 240) {
        const binding = selectedBinding()
        if (!binding?.postAnimationWalkClearance) {
            return Promise.reject(new Error(
                'selected character has no Set A post-animation walk clearance runtime',
            ))
        }
        return binding.postAnimationWalkClearance.captureWalkCycle(sampleCount)
    },
    triggerAction(key: string) {
        const slot = actionSlots.find(candidate => candidate.key.toLowerCase() === key.toLowerCase())
        return slot ? triggerAction(slot) : false
    },
    snapshot() {
        const binding = selectedBinding()
        return binding ? JSON.parse(debugState.textContent || '{}') : { enabled, selected: null }
    },
    capabilityManifest() {
        return [...bindings].map(binding => {
            writeDebugState(binding)
            return JSON.parse(debugState.textContent || '{}')
        })
    },
    characterActions: {
        async ready() {
            const binding = selectedBinding()
            if (binding) {
                await Promise.all([
                    ensureNativeDungeonActions(binding),
                    ensureCombatJumpActions(binding),
                ])
            }
            try {
                await ensureCharacterActionCatalog()
            } catch (error) {
                if (binding?.nativeDungeonActions.status !== 'attached') throw error
            }
            return viewerCharacterActionCatalogSnapshot()
        },
        catalog(characterId?: number) {
            const resolved = Number.isFinite(characterId)
                ? Number(characterId)
                : selectedCharacterId()
            return viewerCharacterActionCatalogSnapshot(resolved)
        },
        catalogAll() {
            return viewerCharacterActionCatalogSnapshot(selectedCharacterId(), true)
        },
        play(actionId: string, options?: ViewerCharacterActionPlayOptions) {
            return playViewerCharacterAction(actionId, options)
        },
        repeatability(actionId: string) {
            return viewerCharacterActionRepeatability(actionId)
        },
        pause() {
            return pauseViewerCharacterAction()
        },
        seek(timeSeconds: number) {
            return seekViewerCharacterAction(timeSeconds)
        },
        step(deltaSeconds: number) {
            return stepViewerCharacterAction(deltaSeconds)
        },
        setPlaybackRate(playbackRate: number) {
            return setViewerCharacterActionPlaybackRate(playbackRate)
        },
        activatePhysicsPhase(stableKey: string) {
            return activateViewerCharacterActionPhysicsPhase(stableKey)
        },
        registerPhysicsPhaseRoot(stableKey: string, phaseRoot: THREE.Object3D) {
            return registerViewerCharacterActionPhysicsPhaseRoot(stableKey, phaseRoot)
        },
        physicsPhaseState() {
            const binding = selectedBinding()
            return binding
                ? { ...binding.characterActionPhysicsPhase.state }
                : emptyCharacterActionPhysicsPhaseState()
        },
        state() {
            const binding = selectedBinding()
            return binding
                ? cloneCharacterActionPlaybackState(
                    binding.characterActionPlayback,
                    binding.characterActionPhysicsPhase.state,
                    binding.characterActionPlaybackRate,
                )
                : emptyCharacterActionPlaybackState()
        },
        dispose() {
            return disposeViewerCharacterAction()
        },
        subscribeCatalog(listener: (snapshot: ViewerCharacterActionCatalogSnapshot) => void) {
            characterActionCatalogSubscribers.add(listener)
            listener(viewerCharacterActionCatalogSnapshot())
            return () => {
                characterActionCatalogSubscribers.delete(listener)
            }
        },
        subscribeState(listener: (state: ViewerCharacterActionPlaybackSnapshot) => void) {
            characterActionStateSubscribers.add(listener)
            const binding = selectedBinding()
            listener(binding
                ? cloneCharacterActionPlaybackState(
                    binding.characterActionPlayback,
                    binding.characterActionPhysicsPhase.state,
                    binding.characterActionPlaybackRate,
                )
                : emptyCharacterActionPlaybackState())
            return () => {
                characterActionStateSubscribers.delete(listener)
            }
        },
    },
}

Object.assign(window, { magiusViewerLocomotion: publicApi })

declare global {
    interface Window {
        magiusViewerLocomotion: typeof publicApi
    }
}
