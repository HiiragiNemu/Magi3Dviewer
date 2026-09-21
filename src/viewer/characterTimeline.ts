export const CHARACTER_TIMELINE_SCHEMA = 'character-timeline-v1' as const

export type TimelineInterpolation = 'linear' | 'step'
export type BuiltInTimelineTrackKind =
    | 'position'
    | 'rotation'
    | 'scale'
    | 'locomotion'
    | 'action'
    | 'clip'
    | 'animationTime'
    | 'animationSpeed'
    | 'animationWeight'
    | 'morph'
    | 'secondaryPhysics'
export type TimelineVector3 = readonly [number, number, number]
export type TimelineQuaternion = readonly [number, number, number, number]

export interface TimelineClipValue {
    name: string | null
    loop?: boolean
}

export interface TimelineSecondaryPhysicsValue {
    active: boolean
    reset?: boolean
    blendWeight?: number
    /** Distinguishes separate reset beats that otherwise have identical values. */
    resetToken?: string | number
}

export interface CharacterTimelineKeyframe {
    time: number
    value: unknown
}

export interface CharacterTimelineTrack {
    id: string
    /** Character, prop, light or another adapter-owned target. */
    targetId: string
    /** Built-in kind or an extension adapter id. */
    kind: string
    /** Morph name or extension-defined property. */
    property?: string
    interpolation?: TimelineInterpolation
    keyframes: readonly CharacterTimelineKeyframe[]
}

export interface CharacterTimelineEvent {
    id: string
    time: number
    type: string
    targetId?: string
    payload?: unknown
}

export interface CharacterTimelineDocument {
    schema: typeof CHARACTER_TIMELINE_SCHEMA
    duration?: number
    loop?: boolean
    tracks: readonly CharacterTimelineTrack[]
    events?: readonly CharacterTimelineEvent[]
}

export interface CharacterTimelineBinding {
    setPosition?(value: TimelineVector3): void
    setRotation?(value: TimelineQuaternion): void
    setScale?(value: TimelineVector3): void
    setLocomotionState?(state: string | null): void
    setActionState?(action: string | null): void
    setAnimationClip?(clip: TimelineClipValue): void
    setAnimationTime?(timeSeconds: number): void
    setAnimationSpeed?(speed: number): void
    setAnimationWeight?(weight: number): void
    setMorph?(name: string, value: number): void
    setSecondaryPhysicsState?(state: TimelineSecondaryPhysicsValue): void
}

export interface TimelineTrackApplyContext {
    timelineTime: number
    targetId: string
    property?: string
    track: Readonly<CharacterTimelineTrack>
}

export interface CharacterTimelineTrackAdapter {
    kind: string
    validate(value: unknown, track: Readonly<CharacterTimelineTrack>): void
    interpolate?(
        from: unknown,
        to: unknown,
        alpha: number,
        track: Readonly<CharacterTimelineTrack>,
    ): unknown
    apply(value: unknown, context: Readonly<TimelineTrackApplyContext>): void
}

export interface TimelineEventContext {
    timelineTime: number
    loopIndex: number
    event: Readonly<CharacterTimelineEvent>
}

export type CharacterTimelineEventListener = (context: Readonly<TimelineEventContext>) => void

export interface CharacterTimelineOptions {
    bindings?: ReadonlyMap<string, CharacterTimelineBinding> | Readonly<Record<string, CharacterTimelineBinding>>
    trackAdapters?: readonly CharacterTimelineTrackAdapter[]
    eventListeners?: readonly CharacterTimelineEventListener[]
}

export interface SampledTimelineTrack {
    trackId: string
    targetId: string
    kind: string
    property?: string
    value: unknown
}

export interface TimelineObjectTransform {
    position: { set(x: number, y: number, z: number): unknown }
    quaternion: { set(x: number, y: number, z: number, w: number): unknown }
    scale: { set(x: number, y: number, z: number): unknown }
    traverse?(callback: (object: TimelineMorphObject) => void): void
}

export interface TimelineMorphObject {
    morphTargetDictionary?: Record<string, number>
    morphTargetInfluences?: number[]
}

export interface TimelineAnimationBinding {
    play(name: string, loop?: boolean): void
    clear?(): void
    setTime?(timeSeconds: number): void
    setSpeed?(speed: number): void
    setWeight?(weight: number): void
}

export interface ObjectTimelineBindingOptions {
    object: TimelineObjectTransform
    animation?: TimelineAnimationBinding
    onLocomotionState?: (state: string | null) => void
    onActionState?: (action: string | null) => void
    onSecondaryPhysicsState?: (state: Readonly<TimelineSecondaryPhysicsValue>) => void
}

export const OFFICIAL_CHARACTER_ACTION_PROFILE_SCHEMA = 'official-character-action-profile-v1' as const
export const DIRECT_HOME_ACTIONS_MANIFEST_SCHEMA = 'magius.direct-home-actions.v1' as const
export const OFFICIAL_SYNCHRONIZED_CHARACTER_ACTION_SCHEMA = 'official-synchronized-character-action-v1' as const
export const OFFICIAL_CHARACTER_ACTION_CATALOG_SCHEMA = 'magius.official-character-action-catalog.v1' as const
export const OFFICIAL_DUNGEON_CHARACTER_ROSTER_SCHEMA = 'magius-official-dungeon-character-roster-v1' as const

export type OfficialCharacterControllerKind = 'direct' | 'override'
export type OfficialCharacterActionPhaseKind = 'start' | 'loop' | 'end'
export type OfficialCharacterActionPlaybackKind = 'oneShot' | 'loop' | 'timeline'
export type OfficialJumpDonorPhaseKind = 'takeoff' | 'airborne' | 'land'
export type OfficialJumpDonorGrade = 'A' | 'B' | 'C'
export type OfficialJumpDonorBodyMask = 'full-body' | 'lower-body' | 'hips-legs'
export type OfficialJumpDonorRootPolicy =
    | 'controller-all'
    | 'controller-horizontal-source-vertical'
    | 'source-all'

export interface OfficialCharacterControllerParameterValue {
    name: string
    hash?: number
    type: 'trigger' | 'bool' | 'int' | 'float'
    value?: boolean | number
}

export interface OfficialCharacterActionClip {
    /** Exact runtime animation key exposed by the loaded character. */
    name: string
    /** Unity pathID is kept as a decimal string because it can exceed Number safe integer range. */
    pathId: string
    durationSeconds: number
    sampleRate: number
}

export interface OfficialCharacterActionStateUse {
    controllerPathId: string
    layerIndex: number
    layer: string
    stateIndex: number
    name: string
    stateNameHash?: number
    fullPath: string
    fullPathHash?: number
    loop: boolean
    speed: number
}

export interface OfficialCharacterActionPhaseStateUses {
    start?: readonly OfficialCharacterActionStateUse[]
    loop?: readonly OfficialCharacterActionStateUse[]
    end?: readonly OfficialCharacterActionStateUse[]
}

export interface OfficialCharacterActionSequence {
    start?: OfficialCharacterActionClip
    loop?: OfficialCharacterActionClip
    end?: OfficialCharacterActionClip
}

export interface OfficialCharacterActionDefinition {
    id: string
    semantic: string
    presentation: 'standing' | 'sitting' | 'special'
    state: {
        layer: string
        name: string
        fullPath?: string
        stateNameHash?: number
        fullPathHash?: number
    }
    /** Exact direct-controller state uses for every phase and every participating layer. */
    phaseStates?: OfficialCharacterActionPhaseStateUses
    parameters?: readonly OfficialCharacterControllerParameterValue[]
    sequence: OfficialCharacterActionSequence
}

export interface OfficialCharacterDirectControllerProfile {
    schema: typeof OFFICIAL_CHARACTER_ACTION_PROFILE_SCHEMA
    characterId: string
    resourceName: string
    controller: {
        kind: 'direct'
        pathId: string
        name: string
        layers: readonly string[]
        parameters?: readonly OfficialCharacterControllerParameterValue[]
    }
    /** Exact controller-authoritative action. Callers must not infer this from clip names. */
    defaultActionId: string
    actions: readonly OfficialCharacterActionDefinition[]
}

export interface OfficialDirectControllerManifestAdapterResult {
    profile: OfficialCharacterDirectControllerProfile
    inventory: OfficialCharacterActionInventory
    sourceClipCount: number
    groupedActionCount: number
}

export interface OfficialCharacterActionInventory {
    characterId: string
    resourceName: string
    controller: {
        kind: OfficialCharacterControllerKind
        pathId: string
        name: string
        layers: readonly string[]
    }
    clips: readonly Pick<OfficialCharacterActionClip, 'name' | 'pathId'>[]
}

export type OfficialCharacterActionResolutionFailureReason =
    | 'invalid-profile'
    | 'invalid-inventory'
    | 'character-mismatch'
    | 'resource-mismatch'
    | 'controller-kind-mismatch'
    | 'controller-path-mismatch'
    | 'controller-name-mismatch'
    | 'action-missing'
    | 'action-ambiguous'
    | 'layer-missing'
    | 'clip-missing'
    | 'hold-duration-required'
    | 'default-loop-missing'
    | 'target-missing'
    | 'target-duplicate'
    | 'phase-mismatch'
    | 'phase-duration-mismatch'
    | 'catalog-entry-missing'
    | 'catalog-character-mismatch'
    | 'playback-unavailable'
    | 'extension-consumer-missing'
    | 'jump-donor-rejected'
    | 'segment-invalid'

export interface OfficialCharacterActionResolutionFailure {
    ok: false
    reason: OfficialCharacterActionResolutionFailureReason
    detail: string
    actionId: string
    missingClips?: readonly string[]
}

export interface OfficialCharacterActionResolutionSuccess {
    ok: true
    profile: Readonly<OfficialCharacterDirectControllerProfile>
    action: Readonly<OfficialCharacterActionDefinition>
}

export type OfficialCharacterActionResolution =
    | OfficialCharacterActionResolutionFailure
    | OfficialCharacterActionResolutionSuccess

export type OfficialCharacterBoardActionTokenResolution =
    | OfficialCharacterActionResolutionFailure
    | {
        ok: true
        behavior: 'preserve-current'
        token: null
        actionId: null
    }
    | {
        ok: true
        behavior: 'play'
        token: string
        actionId: string
        action: Readonly<OfficialCharacterActionDefinition>
    }

export interface OfficialCharacterActionPhaseSchedule {
    phase: OfficialCharacterActionPhaseKind | 'restore'
    startTime: number
    endTime: number
    actionId: string
    clip: Readonly<OfficialCharacterActionClip>
}

export interface OfficialCharacterActionTimelineOptions {
    targetId: string
    /** Required when the requested action contains a loop phase. */
    holdSeconds?: number
}

export interface OfficialCharacterActionTimelineSuccess {
    ok: true
    document: CharacterTimelineDocument
    action: Readonly<OfficialCharacterActionDefinition>
    defaultAction: Readonly<OfficialCharacterActionDefinition>
    phases: readonly OfficialCharacterActionPhaseSchedule[]
}

export type OfficialCharacterActionTimelineResult =
    | OfficialCharacterActionResolutionFailure
    | OfficialCharacterActionTimelineSuccess

export interface OfficialSynchronizedCharacterActionTarget {
    /** Stable semantic role such as body, weapon-a or weapon-b. */
    role: string
    /** Exact loaded runtime instance; sibling weapon rigs use their own target. */
    targetId: string
    resourceName: string
    sequence: OfficialCharacterActionSequence
    /** Required for every target when restoreActionId is present. */
    restoreClip?: OfficialCharacterActionClip
    /** Exact name + pathID inventory exposed by this target's loaded Animator. */
    inventory: readonly Pick<OfficialCharacterActionClip, 'name' | 'pathId'>[]
}

export interface OfficialSynchronizedCharacterActionDefinition {
    schema: typeof OFFICIAL_SYNCHRONIZED_CHARACTER_ACTION_SCHEMA
    characterId: string
    actionId: string
    semantic: string
    /** Omit for terminal states such as Down/Victory that must hold their final loop. */
    restoreActionId?: string
    targets: readonly OfficialSynchronizedCharacterActionTarget[]
}

export interface OfficialSynchronizedCharacterActionTimelineOptions {
    /** Caller-observed loaded instances. Every declared body/companion target is required. */
    availableTargetIds: readonly string[]
    /** Required when the synchronized sequence contains a loop phase. */
    holdSeconds?: number
}

export interface OfficialSynchronizedCharacterActionTargetSchedule {
    role: string
    targetId: string
    resourceName: string
    phases: readonly OfficialCharacterActionPhaseSchedule[]
}

export interface OfficialSynchronizedCharacterActionTimelineSuccess {
    ok: true
    document: CharacterTimelineDocument
    definition: Readonly<OfficialSynchronizedCharacterActionDefinition>
    targets: readonly OfficialSynchronizedCharacterActionTargetSchedule[]
}

export type OfficialSynchronizedCharacterActionTimelineResult =
    | OfficialCharacterActionResolutionFailure
    | OfficialSynchronizedCharacterActionTimelineSuccess

export interface OfficialCharacterActionIdentity {
    /** Viewer selection identity; this is never inferred from a display label. */
    characterId: string
    characterMstId?: string
    dungeonCharacterId?: string
    styleMstId?: string
    styleFigureMstId?: string
    style3dCharacterMstId?: string
    resourceName: string
    logicalBundleKey: string
    /** Exact identities retained when MasterData maps one dungeon resource to a different battle model row. */
    dungeonResourceName?: string
    style3dResourceName?: string
    styleFigureModelName?: string
}

export interface OfficialCharacterActionCatalogAvailability {
    status: 'source-available' | 'unavailable'
    reason?: string
    regionBundlePresence?: Readonly<Record<string, boolean>>
}

export interface OfficialNativeClipPlayback {
    kind: 'oneShot' | 'loop'
    targetRole: 'body'
    clip: OfficialCharacterActionClip
    controllerPathId: string
    /** Original scalar binding count is evidence, not a rig compatibility shortcut. */
    bindingCount: number
    attachmentPolicy: 'body-only-exclude-external-weapons'
}

export interface OfficialTimelinePlayback {
    kind: 'timeline'
    synchronizedAction: OfficialSynchronizedCharacterActionDefinition
    extensionEvents?: readonly OfficialCombatActionExtensionEvent[]
}

export interface OfficialJumpDonorSegment {
    phase: OfficialJumpDonorPhaseKind
    sourceClip: OfficialCharacterActionClip
    sourceStartSeconds: number
    sourceEndSeconds: number
    bodyMask: OfficialJumpDonorBodyMask
    rootPolicy: OfficialJumpDonorRootPolicy
}

export interface OfficialJumpDonorDefinition {
    /** A=complete verified three-phase donor, B=pose-only donor, C=rejected. */
    grade: OfficialJumpDonorGrade
    sourceActionId: string
    sourceCharacterId: string
    sourceRigFingerprint: string
    compatibleCharacterIds: readonly string[]
    compatibility: 'exact-rig' | 'verified-retarget' | 'incompatible'
    attachmentPolicy: 'body-only-exclude-external-weapons'
    segments: readonly OfficialJumpDonorSegment[]
    rejectionReason?: string
}

export interface OfficialJumpDonorPlayback {
    kind: 'timeline'
    jumpDonor: OfficialJumpDonorDefinition
}

export type OfficialCharacterActionCatalogPlayback =
    | OfficialNativeClipPlayback
    | OfficialTimelinePlayback
    | OfficialJumpDonorPlayback

export interface OfficialCharacterActionCatalogEntry {
    id: string
    label: string
    /** Stable non-localized grouping key. */
    groupId: string
    /** User-visible grouping label. */
    group: string
    playbackKind: OfficialCharacterActionPlaybackKind
    characterIdentity: OfficialCharacterActionIdentity
    availability: OfficialCharacterActionCatalogAvailability
    playback: OfficialCharacterActionCatalogPlayback
    sourceFamily?: {
        id: string
        compatibility: 'native-only' | 'exact-rig' | 'verified-retarget' | 'incompatible'
    }
}

export interface OfficialCharacterActionCatalog {
    schema: typeof OFFICIAL_CHARACTER_ACTION_CATALOG_SCHEMA
    entries: readonly OfficialCharacterActionCatalogEntry[]
}

export type OfficialJumpDonorSelectionPriority =
    | 'same-character-exact-rig'
    | 'same-character-verified-retarget'
    | 'verified-retarget'

export interface OfficialJumpDonorSelectionSuccess {
    status: 'selected'
    targetCharacterId: string
    priority: OfficialJumpDonorSelectionPriority
    entry: Readonly<OfficialCharacterActionCatalogEntry>
}

export interface OfficialJumpDonorSelectionUnavailable {
    status: 'unavailable'
    targetCharacterId: string
    reason: string
}

export type OfficialJumpDonorSelectionResult =
    | OfficialJumpDonorSelectionSuccess
    | OfficialJumpDonorSelectionUnavailable

export interface OfficialNativeDungeonRuntimeInventory {
    dungeonCharacterId: string
    characterId: string
    resourceName: string
    controllerPathId: string
    bodyTargetId: string
    clips: readonly Pick<OfficialCharacterActionClip, 'name' | 'pathId'>[]
    /** Must stay empty: dungeon body clips do not drive battle weapon sibling rigs. */
    externalWeaponTargetIds?: readonly string[]
}

export interface OfficialCombatActionExtensionEvent {
    id: string
    timeSeconds: number
    type: 'camera' | 'scene-root' | 'cloth-control' | 'combat-vfx-cue'
    targetId?: string
    required: boolean
    payload: unknown
}

export interface OfficialCharacterCatalogPlaybackOptions extends CharacterTimelineOptions {
    runtime?: OfficialNativeDungeonRuntimeInventory
    availableTargetIds?: readonly string[]
    availableExtensionTypes?: readonly OfficialCombatActionExtensionEvent['type'][]
    targetId?: string
    holdSeconds?: number
}

export interface OfficialCharacterCatalogPlaybackSuccess {
    ok: true
    entry: Readonly<OfficialCharacterActionCatalogEntry>
    document: CharacterTimelineDocument
    timeline: CharacterTimeline
    state: () => {
        actionId: string
        playing: boolean
        timeSeconds: number
        durationSeconds: number
        loop: boolean
    }
    play(): void
    pause(): void
    seek(timeSeconds: number): readonly SampledTimelineTrack[]
    step(deltaSeconds: number): readonly SampledTimelineTrack[]
}

export type OfficialCharacterCatalogPlaybackResult =
    | OfficialCharacterActionResolutionFailure
    | OfficialCharacterCatalogPlaybackSuccess

interface NormalizedTimelineDocument {
    schema: typeof CHARACTER_TIMELINE_SCHEMA
    duration: number
    loop: boolean
    tracks: CharacterTimelineTrack[]
    events: CharacterTimelineEvent[]
}

interface IndexedEvent {
    event: CharacterTimelineEvent
    order: number
}

interface SampleSegment {
    from: CharacterTimelineKeyframe
    to: CharacterTimelineKeyframe
    alpha: number
}

const BUILT_IN_KINDS = new Set<BuiltInTimelineTrackKind>([
    'position',
    'rotation',
    'scale',
    'locomotion',
    'action',
    'clip',
    'animationTime',
    'animationSpeed',
    'animationWeight',
    'morph',
    'secondaryPhysics',
])

const STEP_ONLY_KINDS = new Set<BuiltInTimelineTrackKind>([
    'locomotion', 'action', 'clip', 'secondaryPhysics',
])
const LOCOMOTION_STATES = new Set(['idle', 'walk', 'run', 'jump', 'fall', 'land'])
const EPSILON = 1e-10

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertFiniteNumber(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`${label} must be a finite number`)
    }
    return value
}

function assertNonNegativeNumber(value: unknown, label: string): number {
    const number = assertFiniteNumber(value, label)
    if (number < 0) throw new RangeError(`${label} must be non-negative`)
    return number
}

function assertJsonFinite(value: unknown, label: string, seen = new Set<object>()): void {
    if (typeof value === 'number') {
        assertFiniteNumber(value, label)
        return
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return
    if (Array.isArray(value)) {
        value.forEach((entry, index) => assertJsonFinite(entry, `${label}[${index}]`, seen))
        return
    }
    if (isRecord(value)) {
        if (seen.has(value)) throw new TypeError(`${label} must not contain cycles`)
        seen.add(value)
        for (const [key, entry] of Object.entries(value)) {
            if (entry === undefined) throw new TypeError(`${label}.${key} must not be undefined`)
            assertJsonFinite(entry, `${label}.${key}`, seen)
        }
        seen.delete(value)
        return
    }
    throw new TypeError(`${label} must be JSON-compatible`)
}

function cloneJsonFinite<T>(value: T, label: string): T {
    assertJsonFinite(value, label)
    return JSON.parse(JSON.stringify(value)) as T
}

function assertTuple(value: unknown, length: number, label: string): readonly number[] {
    if (!Array.isArray(value) || value.length !== length) {
        throw new TypeError(`${label} must contain ${length} numbers`)
    }
    value.forEach((entry, index) => assertFiniteNumber(entry, `${label}[${index}]`))
    return value as number[]
}

function assertClipValue(value: unknown, label: string): TimelineClipValue {
    if (typeof value === 'string') return { name: value }
    if (!isRecord(value) || (typeof value.name !== 'string' && value.name !== null)) {
        throw new TypeError(`${label} must be a clip name or { name, loop }`)
    }
    if (value.loop !== undefined && typeof value.loop !== 'boolean') {
        throw new TypeError(`${label}.loop must be boolean`)
    }
    return { name: value.name, loop: value.loop as boolean | undefined }
}

function assertSecondaryPhysicsValue(value: unknown, label: string): TimelineSecondaryPhysicsValue {
    if (!isRecord(value) || typeof value.active !== 'boolean') {
        throw new TypeError(`${label} must be { active, reset?, blendWeight?, resetToken? }`)
    }
    if (value.reset !== undefined && typeof value.reset !== 'boolean') {
        throw new TypeError(`${label}.reset must be boolean`)
    }
    const output: TimelineSecondaryPhysicsValue = { active: value.active }
    if (value.reset !== undefined) output.reset = value.reset
    if (value.blendWeight !== undefined) {
        const blendWeight = assertFiniteNumber(value.blendWeight, `${label}.blendWeight`)
        if (blendWeight < 0 || blendWeight > 1) {
            throw new RangeError(`${label}.blendWeight must be between 0 and 1`)
        }
        output.blendWeight = blendWeight
    }
    if (value.resetToken !== undefined) {
        if (
            typeof value.resetToken !== 'string'
            && !(typeof value.resetToken === 'number' && Number.isFinite(value.resetToken))
        ) {
            throw new TypeError(`${label}.resetToken must be a string or finite number`)
        }
        output.resetToken = value.resetToken
    }
    return output
}

function validateBuiltInValue(
    kind: BuiltInTimelineTrackKind,
    value: unknown,
    track: Readonly<CharacterTimelineTrack>,
    label: string,
): void {
    if (kind === 'position' || kind === 'scale') {
        assertTuple(value, 3, label)
        return
    }
    if (kind === 'rotation') {
        const tuple = assertTuple(value, 4, label)
        const magnitude = Math.hypot(...tuple)
        if (magnitude <= EPSILON) throw new RangeError(`${label} quaternion must be non-zero`)
        return
    }
    if (
        kind === 'animationTime'
        || kind === 'animationSpeed'
        || kind === 'animationWeight'
        || kind === 'morph'
    ) {
        assertFiniteNumber(value, label)
        if (kind === 'morph' && !track.property) {
            throw new TypeError(`morph track ${track.id} requires property`)
        }
        return
    }
    if (kind === 'locomotion') {
        if (value !== null && (typeof value !== 'string' || !LOCOMOTION_STATES.has(value))) {
            throw new TypeError(`${label} must be a locomotion state or null`)
        }
        return
    }
    if (kind === 'action') {
        if (value !== null && typeof value !== 'string') {
            throw new TypeError(`${label} must be an action id or null`)
        }
        return
    }
    if (kind === 'secondaryPhysics') {
        assertSecondaryPhysicsValue(value, label)
        return
    }
    assertClipValue(value, label)
}

function defaultInterpolation(kind: string): TimelineInterpolation {
    return STEP_ONLY_KINDS.has(kind as BuiltInTimelineTrackKind) ? 'step' : 'linear'
}

function normalizeBindings(
    bindings: CharacterTimelineOptions['bindings'],
): Map<string, CharacterTimelineBinding> {
    if (!bindings) return new Map()
    if (bindings instanceof Map) return new Map(bindings)
    return new Map(Object.entries(bindings))
}

function normalizeDocument(
    input: CharacterTimelineDocument,
    extensionAdapters: ReadonlyMap<string, CharacterTimelineTrackAdapter>,
): NormalizedTimelineDocument {
    if (!isRecord(input)) throw new TypeError('timeline document must be an object')
    if (input.schema !== CHARACTER_TIMELINE_SCHEMA) {
        throw new TypeError(`unsupported timeline schema: ${String(input.schema)}`)
    }
    if (!Array.isArray(input.tracks)) throw new TypeError('timeline tracks must be an array')
    if (input.events !== undefined && !Array.isArray(input.events)) {
        throw new TypeError('timeline events must be an array')
    }

    const trackIds = new Set<string>()
    let maximumTime = 0
    const tracks = input.tracks.map((sourceTrack, trackIndex): CharacterTimelineTrack => {
        if (!isRecord(sourceTrack)) throw new TypeError(`track ${trackIndex} must be an object`)
        if (typeof sourceTrack.id !== 'string' || !sourceTrack.id) {
            throw new TypeError(`track ${trackIndex} requires id`)
        }
        if (trackIds.has(sourceTrack.id)) throw new TypeError(`duplicate track id ${sourceTrack.id}`)
        trackIds.add(sourceTrack.id)
        if (typeof sourceTrack.targetId !== 'string' || !sourceTrack.targetId) {
            throw new TypeError(`track ${sourceTrack.id} requires targetId`)
        }
        if (typeof sourceTrack.kind !== 'string' || !sourceTrack.kind) {
            throw new TypeError(`track ${sourceTrack.id} requires kind`)
        }
        if (sourceTrack.property !== undefined && typeof sourceTrack.property !== 'string') {
            throw new TypeError(`track ${sourceTrack.id} property must be a string`)
        }
        if (!Array.isArray(sourceTrack.keyframes) || sourceTrack.keyframes.length === 0) {
            throw new TypeError(`track ${sourceTrack.id} requires at least one keyframe`)
        }
        const trackId = sourceTrack.id
        const targetId = sourceTrack.targetId
        const kind = sourceTrack.kind
        const property = sourceTrack.property
        const sourceKeyframes = sourceTrack.keyframes
        const interpolation = sourceTrack.interpolation ?? defaultInterpolation(sourceTrack.kind)
        if (interpolation !== 'linear' && interpolation !== 'step') {
            throw new TypeError(`track ${sourceTrack.id} has invalid interpolation`)
        }
        if (
            BUILT_IN_KINDS.has(sourceTrack.kind as BuiltInTimelineTrackKind)
            && STEP_ONLY_KINDS.has(sourceTrack.kind as BuiltInTimelineTrackKind)
            && interpolation !== 'step'
        ) {
            throw new TypeError(`track ${sourceTrack.id} kind ${sourceTrack.kind} requires step interpolation`)
        }
        const extension = extensionAdapters.get(sourceTrack.kind)
        if (!BUILT_IN_KINDS.has(sourceTrack.kind as BuiltInTimelineTrackKind) && !extension) {
            throw new TypeError(`track ${sourceTrack.id} requires adapter ${sourceTrack.kind}`)
        }
        const indexedKeyframes = sourceKeyframes.map((keyframe, keyframeIndex) => {
            if (!isRecord(keyframe)) {
                throw new TypeError(`track ${sourceTrack.id} keyframe ${keyframeIndex} must be an object`)
            }
            const time = assertNonNegativeNumber(
                keyframe.time,
                `track ${sourceTrack.id} keyframe ${keyframeIndex} time`,
            )
            maximumTime = Math.max(maximumTime, time)
            const track: CharacterTimelineTrack = {
                id: trackId,
                targetId,
                kind,
                property,
                interpolation,
                keyframes: [],
            }
            if (BUILT_IN_KINDS.has(sourceTrack.kind as BuiltInTimelineTrackKind)) {
                validateBuiltInValue(
                    sourceTrack.kind as BuiltInTimelineTrackKind,
                    keyframe.value,
                    track,
                    `track ${sourceTrack.id} keyframe ${keyframeIndex} value`,
                )
            } else {
                assertJsonFinite(keyframe.value, `track ${sourceTrack.id} keyframe ${keyframeIndex} value`)
                extension?.validate(keyframe.value, track)
            }
            return {
                order: keyframeIndex,
                keyframe: {
                    time,
                    value: cloneJsonFinite(
                        keyframe.value,
                        `track ${sourceTrack.id} keyframe ${keyframeIndex} value`,
                    ),
                },
            }
        })
        indexedKeyframes.sort((a, b) => a.keyframe.time - b.keyframe.time || a.order - b.order)
        const track: CharacterTimelineTrack = {
            id: trackId,
            targetId,
            kind,
            interpolation,
            keyframes: indexedKeyframes.map(entry => entry.keyframe),
        }
        if (property !== undefined) track.property = property
        return track
    })

    const eventIds = new Set<string>()
    const indexedEvents: IndexedEvent[] = (input.events ?? []).map((sourceEvent, eventIndex) => {
        if (!isRecord(sourceEvent)) throw new TypeError(`event ${eventIndex} must be an object`)
        if (typeof sourceEvent.id !== 'string' || !sourceEvent.id) {
            throw new TypeError(`event ${eventIndex} requires id`)
        }
        if (eventIds.has(sourceEvent.id)) throw new TypeError(`duplicate event id ${sourceEvent.id}`)
        eventIds.add(sourceEvent.id)
        if (typeof sourceEvent.type !== 'string' || !sourceEvent.type) {
            throw new TypeError(`event ${sourceEvent.id} requires type`)
        }
        if (sourceEvent.targetId !== undefined && typeof sourceEvent.targetId !== 'string') {
            throw new TypeError(`event ${sourceEvent.id} targetId must be a string`)
        }
        const time = assertNonNegativeNumber(sourceEvent.time, `event ${sourceEvent.id} time`)
        maximumTime = Math.max(maximumTime, time)
        if (sourceEvent.payload !== undefined) {
            assertJsonFinite(sourceEvent.payload, `event ${sourceEvent.id} payload`)
        }
        const event: CharacterTimelineEvent = {
            id: sourceEvent.id,
            time,
            type: sourceEvent.type,
        }
        if (sourceEvent.targetId !== undefined) event.targetId = sourceEvent.targetId
        if (sourceEvent.payload !== undefined) {
            event.payload = cloneJsonFinite(sourceEvent.payload, `event ${sourceEvent.id} payload`)
        }
        return {
            order: eventIndex,
            event,
        }
    })
    indexedEvents.sort((a, b) => a.event.time - b.event.time || a.order - b.order)

    const duration = input.duration === undefined
        ? maximumTime
        : assertNonNegativeNumber(input.duration, 'timeline duration')
    if (duration + EPSILON < maximumTime) {
        throw new RangeError(`timeline duration ${duration} is shorter than key/event time ${maximumTime}`)
    }
    for (const track of tracks) {
        if (track.keyframes.some(keyframe => keyframe.time > duration + EPSILON)) {
            throw new RangeError(`track ${track.id} has keyframes after duration`)
        }
    }

    return {
        schema: CHARACTER_TIMELINE_SCHEMA,
        duration,
        loop: input.loop ?? false,
        tracks,
        events: indexedEvents.map(entry => entry.event),
    }
}

function getSampleSegment(
    keyframes: readonly CharacterTimelineKeyframe[],
    time: number,
): SampleSegment {
    if (time < keyframes[0].time) {
        return { from: keyframes[0], to: keyframes[0], alpha: 0 }
    }
    let lowerIndex = 0
    while (
        lowerIndex + 1 < keyframes.length
        && keyframes[lowerIndex + 1].time <= time + EPSILON
    ) {
        lowerIndex += 1
    }
    const from = keyframes[lowerIndex]
    const to = keyframes[lowerIndex + 1] ?? from
    if (from === to || to.time <= from.time + EPSILON) return { from, to, alpha: 0 }
    return {
        from,
        to,
        alpha: Math.max(0, Math.min(1, (time - from.time) / (to.time - from.time))),
    }
}

function interpolateNumber(from: unknown, to: unknown, alpha: number): number {
    const a = assertFiniteNumber(from, 'number interpolation from')
    const b = assertFiniteNumber(to, 'number interpolation to')
    return a + (b - a) * alpha
}

function interpolateVector3(from: unknown, to: unknown, alpha: number): TimelineVector3 {
    const a = assertTuple(from, 3, 'vector interpolation from')
    const b = assertTuple(to, 3, 'vector interpolation to')
    return [
        a[0] + (b[0] - a[0]) * alpha,
        a[1] + (b[1] - a[1]) * alpha,
        a[2] + (b[2] - a[2]) * alpha,
    ]
}

export function slerpTimelineQuaternion(
    from: TimelineQuaternion,
    to: TimelineQuaternion,
    alpha: number,
): TimelineQuaternion {
    let ax = from[0]
    let ay = from[1]
    let az = from[2]
    let aw = from[3]
    const aLength = Math.hypot(ax, ay, az, aw)
    ax /= aLength
    ay /= aLength
    az /= aLength
    aw /= aLength

    let bx = to[0]
    let by = to[1]
    let bz = to[2]
    let bw = to[3]
    const bLength = Math.hypot(bx, by, bz, bw)
    bx /= bLength
    by /= bLength
    bz /= bLength
    bw /= bLength

    let dot = ax * bx + ay * by + az * bz + aw * bw
    if (dot < 0) {
        dot = -dot
        bx = -bx
        by = -by
        bz = -bz
        bw = -bw
    }
    let result: TimelineQuaternion
    if (dot > 0.9995) {
        result = [
            ax + (bx - ax) * alpha,
            ay + (by - ay) * alpha,
            az + (bz - az) * alpha,
            aw + (bw - aw) * alpha,
        ]
    } else {
        const theta = Math.acos(Math.max(-1, Math.min(1, dot)))
        const sinTheta = Math.sin(theta)
        const left = Math.sin((1 - alpha) * theta) / sinTheta
        const right = Math.sin(alpha * theta) / sinTheta
        result = [
            ax * left + bx * right,
            ay * left + by * right,
            az * left + bz * right,
            aw * left + bw * right,
        ]
    }
    const length = Math.hypot(...result)
    return [result[0] / length, result[1] / length, result[2] / length, result[3] / length]
}

function sampleTrackValue(
    track: Readonly<CharacterTimelineTrack>,
    time: number,
    adapter?: CharacterTimelineTrackAdapter,
): unknown {
    const segment = getSampleSegment(track.keyframes, time)
    if (
        track.interpolation === 'step'
        || segment.from === segment.to
        || segment.alpha <= EPSILON
    ) {
        return cloneJsonFinite(segment.from.value, `sample ${track.id}`)
    }
    if (!BUILT_IN_KINDS.has(track.kind as BuiltInTimelineTrackKind)) {
        if (!adapter?.interpolate) return cloneJsonFinite(segment.from.value, `sample ${track.id}`)
        const value = adapter.interpolate(segment.from.value, segment.to.value, segment.alpha, track)
        assertJsonFinite(value, `adapter ${track.kind} sampled value`)
        return cloneJsonFinite(value, `adapter ${track.kind} sampled value`)
    }
    const kind = track.kind as BuiltInTimelineTrackKind
    if (kind === 'position' || kind === 'scale') {
        return interpolateVector3(segment.from.value, segment.to.value, segment.alpha)
    }
    if (kind === 'rotation') {
        return slerpTimelineQuaternion(
            assertTuple(segment.from.value, 4, 'quaternion from') as TimelineQuaternion,
            assertTuple(segment.to.value, 4, 'quaternion to') as TimelineQuaternion,
            segment.alpha,
        )
    }
    if (
        kind === 'animationTime'
        || kind === 'animationSpeed'
        || kind === 'animationWeight'
        || kind === 'morph'
    ) {
        return interpolateNumber(segment.from.value, segment.to.value, segment.alpha)
    }
    return cloneJsonFinite(segment.from.value, `sample ${track.id}`)
}

function assertNonEmptyString(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label} must be a non-empty string`)
    }
    return value
}

function assertOfficialPathId(value: unknown, label: string): string {
    const pathId = assertNonEmptyString(value, label)
    if (!/^-?\d+$/.test(pathId)) throw new TypeError(`${label} must be a decimal pathID string`)
    return pathId
}

function assertIntegerNumber(value: unknown, label: string): number {
    const number = assertFiniteNumber(value, label)
    if (!Number.isInteger(number)) throw new TypeError(`${label} must be an integer`)
    return number
}

function assertStableIdentifier(value: unknown, label: string): string {
    if (typeof value === 'string' && value.length > 0) return value
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value)
    throw new TypeError(`${label} must be a non-empty string or non-negative safe integer`)
}

function directControllerParameterType(
    value: unknown,
    label: string,
): OfficialCharacterControllerParameterValue['type'] {
    const type = assertIntegerNumber(value, label)
    if (type === 1) return 'float'
    if (type === 3) return 'int'
    if (type === 4) return 'bool'
    if (type === 9) return 'trigger'
    throw new TypeError(`${label} has unsupported Unity Animator parameter type ${type}`)
}

function actionPhaseFromStateName(
    stateName: string,
    loop: boolean,
): { phase: OfficialCharacterActionPhaseKind; baseName: string } {
    const suffix = /^(.*)_([SLE])$/.exec(stateName)
    if (suffix) {
        const phase = suffix[2] === 'S' ? 'start' : suffix[2] === 'L' ? 'loop' : 'end'
        return { phase, baseName: suffix[1] }
    }
    return { phase: loop ? 'loop' : 'start', baseName: stateName }
}

function directActionPresentation(groupId: string): OfficialCharacterActionDefinition['presentation'] {
    if (groupId.includes('UniqueMotion/') || groupId.includes('AqRun') || groupId.includes('Yodaka')) {
        return 'special'
    }
    if (groupId.includes('_Sit/') || groupId === 'Sit' || groupId.includes('/Sit')) return 'sitting'
    return 'standing'
}

function directActionSemantic(
    groupId: string,
    defaultActionId: string,
): string {
    if (
        groupId === defaultActionId
        || groupId.startsWith('WaitMotion/')
        || groupId === 'Sit'
        || groupId === 'Sleep'
    ) return 'board-idle'
    if (groupId.endsWith('/Talk') || groupId === 'Talk') return 'board-talk'
    if (directActionPresentation(groupId) === 'special') return 'board-special'
    return 'board-emote'
}

interface MutableDirectActionGroup {
    id: string
    sequence: Partial<Record<OfficialCharacterActionPhaseKind, OfficialCharacterActionClip>>
    phaseStates: Record<OfficialCharacterActionPhaseKind, OfficialCharacterActionStateUse[]>
}

/**
 * Converts an extracted direct Home Animator manifest into the exact, generic
 * action/inventory contract consumed by the deterministic timeline. It groups
 * clips by controller state path and S/L/E state names, never by display clip
 * filename, so irregular source names remain safe.
 */
export function createOfficialDirectControllerProfileFromManifest(
    source: unknown,
): OfficialDirectControllerManifestAdapterResult {
    if (!isRecord(source)) throw new TypeError('direct Home action manifest must be an object')
    if (source.schema !== DIRECT_HOME_ACTIONS_MANIFEST_SCHEMA) {
        throw new TypeError(`unsupported direct Home action manifest schema: ${String(source.schema)}`)
    }
    const characterId = assertStableIdentifier(source.characterId, 'direct Home manifest characterId')
    const resourceName = assertNonEmptyString(source.resourceName, 'direct Home manifest resourceName')
    const defaultActionId = assertNonEmptyString(source.defaultAction, 'direct Home manifest defaultAction')
    const activeControllerPathId = assertOfficialPathId(
        source.activeControllerPathId,
        'direct Home manifest activeControllerPathId',
    )
    if (source.animatorOverrideControllerCount !== undefined) {
        const overrideCount = assertIntegerNumber(
            source.animatorOverrideControllerCount,
            'direct Home manifest animatorOverrideControllerCount',
        )
        if (overrideCount !== 0) {
            throw new TypeError('direct Home manifest must not contain an AnimatorOverrideController')
        }
    }
    if (!Array.isArray(source.controllers)) throw new TypeError('direct Home manifest controllers must be an array')
    const activeController = source.controllers.find(controller => (
        isRecord(controller)
        && controller.active === true
        && controller.pathId === activeControllerPathId
    ))
    if (!isRecord(activeController)) {
        throw new TypeError(`direct Home active controller ${activeControllerPathId} is missing`)
    }
    const controllerName = assertNonEmptyString(activeController.name, 'direct Home active controller name')
    if (!Array.isArray(activeController.layers) || activeController.layers.length === 0) {
        throw new TypeError('direct Home active controller layers must not be empty')
    }
    const indexedLayers = activeController.layers.map((layer, layerOrder) => {
        if (!isRecord(layer)) throw new TypeError(`direct Home controller layer ${layerOrder} must be an object`)
        return {
            index: assertIntegerNumber(layer.index, `direct Home controller layer ${layerOrder}.index`),
            name: assertNonEmptyString(layer.name, `direct Home controller layer ${layerOrder}.name`),
        }
    }).sort((left, right) => left.index - right.index)
    const layers = indexedLayers.map(layer => layer.name)
    if (new Set(layers).size !== layers.length) throw new TypeError('direct Home controller layer names must be unique')

    const parameters: OfficialCharacterControllerParameterValue[] = []
    if (activeController.parameters !== undefined) {
        if (!Array.isArray(activeController.parameters)) {
            throw new TypeError('direct Home active controller parameters must be an array')
        }
        for (let index = 0; index < activeController.parameters.length; index += 1) {
            const parameter = activeController.parameters[index]
            if (!isRecord(parameter)) throw new TypeError(`direct Home controller parameter ${index} must be an object`)
            parameters.push({
                name: assertNonEmptyString(parameter.name, `direct Home controller parameter ${index}.name`),
                hash: assertIntegerNumber(parameter.nameHash, `direct Home controller parameter ${index}.nameHash`),
                type: directControllerParameterType(parameter.type, `direct Home controller parameter ${index}.type`),
            })
        }
    }

    if (!Array.isArray(source.boardActions) || source.boardActions.length === 0) {
        throw new TypeError('direct Home manifest boardActions must not be empty')
    }
    const groups = new Map<string, MutableDirectActionGroup>()
    const inventoryClips: Pick<OfficialCharacterActionClip, 'name' | 'pathId'>[] = []
    const inventoryClipKeys = new Set<string>()

    for (let actionIndex = 0; actionIndex < source.boardActions.length; actionIndex += 1) {
        const boardAction = source.boardActions[actionIndex]
        const label = `direct Home manifest boardActions[${actionIndex}]`
        if (!isRecord(boardAction)) throw new TypeError(`${label} must be an object`)
        const clip: OfficialCharacterActionClip = {
            name: assertNonEmptyString(boardAction.name, `${label}.name`),
            pathId: assertOfficialPathId(boardAction.sourceClipPathId, `${label}.sourceClipPathId`),
            durationSeconds: assertFiniteNumber(boardAction.durationSeconds, `${label}.durationSeconds`),
            sampleRate: assertFiniteNumber(boardAction.sampleRate, `${label}.sampleRate`),
        }
        validateOfficialActionClip(clip, label)
        if (typeof boardAction.loopInActiveController !== 'boolean') {
            throw new TypeError(`${label}.loopInActiveController must be boolean`)
        }
        const clipKey = `${clip.name}\u0000${clip.pathId}`
        if (inventoryClipKeys.has(clipKey)) throw new TypeError(`${label} duplicates exact clip ${clip.name}#${clip.pathId}`)
        inventoryClipKeys.add(clipKey)
        inventoryClips.push({ name: clip.name, pathId: clip.pathId })
        if (!Array.isArray(boardAction.stateUses)) throw new TypeError(`${label}.stateUses must be an array`)
        const activeUses = boardAction.stateUses.filter(stateUse => (
            isRecord(stateUse) && stateUse.controllerPathId === activeControllerPathId
        ))
        if (activeUses.length === 0) {
            throw new TypeError(`${label} is not used by active controller ${activeControllerPathId}`)
        }
        for (let useIndex = 0; useIndex < activeUses.length; useIndex += 1) {
            const stateUseSource = activeUses[useIndex]
            const useLabel = `${label}.stateUses(active)[${useIndex}]`
            if (!isRecord(stateUseSource)) throw new TypeError(`${useLabel} must be an object`)
            const layer = assertNonEmptyString(stateUseSource.layerName, `${useLabel}.layerName`)
            if (!layers.includes(layer)) throw new TypeError(`${useLabel}.layerName is not in active controller layers`)
            const stateName = assertNonEmptyString(stateUseSource.stateName, `${useLabel}.stateName`)
            const fullPath = assertNonEmptyString(stateUseSource.fullPath, `${useLabel}.fullPath`)
            const layerPrefix = `${layer}.`
            if (!fullPath.startsWith(layerPrefix)) throw new TypeError(`${useLabel}.fullPath does not begin with its layer`)
            const relativePath = fullPath.slice(layerPrefix.length)
            const pathParts = relativePath.split('.')
            if (pathParts.at(-1) !== stateName) throw new TypeError(`${useLabel}.fullPath does not end in stateName`)
            if (typeof stateUseSource.loop !== 'boolean') throw new TypeError(`${useLabel}.loop must be boolean`)
            if (stateUseSource.loop !== boardAction.loopInActiveController) {
                throw new TypeError(`${useLabel}.loop disagrees with board action loop authority`)
            }
            const stateUse: OfficialCharacterActionStateUse = {
                controllerPathId: assertOfficialPathId(stateUseSource.controllerPathId, `${useLabel}.controllerPathId`),
                layerIndex: assertIntegerNumber(stateUseSource.layerIndex, `${useLabel}.layerIndex`),
                layer,
                stateIndex: assertIntegerNumber(stateUseSource.stateIndex, `${useLabel}.stateIndex`),
                name: stateName,
                stateNameHash: assertIntegerNumber(stateUseSource.stateNameHash, `${useLabel}.stateNameHash`),
                fullPath,
                fullPathHash: assertIntegerNumber(stateUseSource.fullPathHash, `${useLabel}.fullPathHash`),
                loop: stateUseSource.loop,
                speed: assertFiniteNumber(stateUseSource.speed, `${useLabel}.speed`),
            }
            const { phase, baseName } = actionPhaseFromStateName(stateName, stateUse.loop)
            const parentPath = pathParts.slice(0, -1).join('.')
            const groupId = parentPath.length > 0 ? `${parentPath}/${baseName}` : baseName
            let group = groups.get(groupId)
            if (!group) {
                group = {
                    id: groupId,
                    sequence: {},
                    phaseStates: { start: [], loop: [], end: [] },
                }
                groups.set(groupId, group)
            }
            const existingClip = group.sequence[phase]
            if (
                existingClip
                && (existingClip.name !== clip.name || existingClip.pathId !== clip.pathId)
            ) {
                throw new TypeError(`${label} conflicts with exact ${groupId}/${phase} clip`)
            }
            group.sequence[phase] = clip
            const stateKey = `${stateUse.controllerPathId}\u0000${stateUse.layerIndex}\u0000${stateUse.fullPath}`
            if (!group.phaseStates[phase].some(existing => (
                `${existing.controllerPathId}\u0000${existing.layerIndex}\u0000${existing.fullPath}` === stateKey
            ))) group.phaseStates[phase].push(stateUse)
        }
    }

    const actions = [...groups.values()].map(group => {
        const orderedPhaseStates = (['start', 'loop', 'end'] as const).flatMap(
            phase => group.phaseStates[phase],
        )
        const primaryState = orderedPhaseStates.find(state => state.layer === 'Base Layer') ?? orderedPhaseStates[0]
        if (!primaryState) throw new TypeError(`direct Home action ${group.id} has no controller state`)
        const phaseStates: OfficialCharacterActionPhaseStateUses = {}
        for (const phase of ['start', 'loop', 'end'] as const) {
            if (group.phaseStates[phase].length === 0) continue
            phaseStates[phase] = [...group.phaseStates[phase]].sort((left, right) => (
                left.layerIndex - right.layerIndex || left.fullPath.localeCompare(right.fullPath)
            ))
        }
        const definition: OfficialCharacterActionDefinition = {
            id: group.id,
            semantic: directActionSemantic(group.id, defaultActionId),
            presentation: directActionPresentation(group.id),
            state: {
                layer: primaryState.layer,
                name: primaryState.name,
                fullPath: primaryState.fullPath,
                stateNameHash: primaryState.stateNameHash,
                fullPathHash: primaryState.fullPathHash,
            },
            phaseStates,
            sequence: {
                start: group.sequence.start,
                loop: group.sequence.loop,
                end: group.sequence.end,
            },
        }
        return definition
    }).sort((left, right) => (
        left.id === defaultActionId ? -1 : right.id === defaultActionId ? 1 : left.id.localeCompare(right.id)
    ))
    if (!actions.some(action => action.id === defaultActionId && action.sequence.loop)) {
        throw new TypeError(`direct Home default action ${defaultActionId} has no exact loop state`)
    }

    const profile: OfficialCharacterDirectControllerProfile = {
        schema: OFFICIAL_CHARACTER_ACTION_PROFILE_SCHEMA,
        characterId,
        resourceName,
        controller: {
            kind: 'direct',
            pathId: activeControllerPathId,
            name: controllerName,
            layers,
            parameters,
        },
        defaultActionId,
        actions,
    }
    const inventory: OfficialCharacterActionInventory = {
        characterId,
        resourceName,
        controller: {
            kind: 'direct',
            pathId: activeControllerPathId,
            name: controllerName,
            layers,
        },
        clips: inventoryClips,
    }
    validateOfficialDirectControllerProfile(profile)
    validateOfficialActionInventory(inventory)
    return {
        profile,
        inventory,
        sourceClipCount: inventoryClips.length,
        groupedActionCount: actions.length,
    }
}

function getOfficialActionSequenceEntries(
    action: Readonly<OfficialCharacterActionDefinition>,
): readonly [OfficialCharacterActionPhaseKind, Readonly<OfficialCharacterActionClip>][] {
    const entries: [OfficialCharacterActionPhaseKind, Readonly<OfficialCharacterActionClip>][] = []
    if (action.sequence.start) entries.push(['start', action.sequence.start])
    if (action.sequence.loop) entries.push(['loop', action.sequence.loop])
    if (action.sequence.end) entries.push(['end', action.sequence.end])
    return entries
}

function getOfficialActionSequencePhaseMap(
    sequence: Readonly<OfficialCharacterActionSequence>,
): ReadonlyMap<OfficialCharacterActionPhaseKind, Readonly<OfficialCharacterActionClip>> {
    const phases = new Map<OfficialCharacterActionPhaseKind, Readonly<OfficialCharacterActionClip>>()
    if (sequence.start) phases.set('start', sequence.start)
    if (sequence.loop) phases.set('loop', sequence.loop)
    if (sequence.end) phases.set('end', sequence.end)
    return phases
}

function validateOfficialActionClip(
    clip: Readonly<OfficialCharacterActionClip>,
    label: string,
): void {
    if (!isRecord(clip)) throw new TypeError(`${label} must be an object`)
    assertNonEmptyString(clip.name, `${label}.name`)
    assertOfficialPathId(clip.pathId, `${label}.pathId`)
    if (assertFiniteNumber(clip.durationSeconds, `${label}.durationSeconds`) <= 0) {
        throw new RangeError(`${label}.durationSeconds must be positive`)
    }
    if (assertFiniteNumber(clip.sampleRate, `${label}.sampleRate`) <= 0) {
        throw new RangeError(`${label}.sampleRate must be positive`)
    }
}

function validateOfficialDirectControllerProfile(
    profile: Readonly<OfficialCharacterDirectControllerProfile>,
): void {
    if (!isRecord(profile)) throw new TypeError('official action profile must be an object')
    if (profile.schema !== OFFICIAL_CHARACTER_ACTION_PROFILE_SCHEMA) {
        throw new TypeError(`unsupported official action profile schema: ${String(profile.schema)}`)
    }
    assertNonEmptyString(profile.characterId, 'official action profile characterId')
    assertNonEmptyString(profile.resourceName, 'official action profile resourceName')
    if (!isRecord(profile.controller) || profile.controller.kind !== 'direct') {
        throw new TypeError('official action profile controller must be direct')
    }
    assertOfficialPathId(profile.controller.pathId, 'official action profile controller.pathId')
    assertNonEmptyString(profile.controller.name, 'official action profile controller.name')
    if (!Array.isArray(profile.controller.layers) || profile.controller.layers.length === 0) {
        throw new TypeError('official action profile controller.layers must not be empty')
    }
    const layerNames = new Set<string>()
    profile.controller.layers.forEach((layer, index) => {
        const name = assertNonEmptyString(layer, `official action profile controller.layers[${index}]`)
        if (layerNames.has(name)) throw new TypeError(`duplicate official controller layer ${name}`)
        layerNames.add(name)
    })
    if (profile.controller.parameters !== undefined) {
        if (!Array.isArray(profile.controller.parameters)) {
            throw new TypeError('official action profile controller.parameters must be an array')
        }
        const parameterNames = new Set<string>()
        profile.controller.parameters.forEach((parameter, parameterIndex) => {
            const label = `official action profile controller.parameters[${parameterIndex}]`
            if (!isRecord(parameter)) throw new TypeError(`${label} must be an object`)
            const name = assertNonEmptyString(parameter.name, `${label}.name`)
            if (parameterNames.has(name)) throw new TypeError(`duplicate official controller parameter ${name}`)
            parameterNames.add(name)
            if (typeof parameter.type !== 'string' || !['trigger', 'bool', 'int', 'float'].includes(parameter.type)) {
                throw new TypeError(`${label}.type is invalid`)
            }
            if (parameter.hash !== undefined) assertIntegerNumber(parameter.hash, `${label}.hash`)
        })
    }
    assertNonEmptyString(profile.defaultActionId, 'official action profile defaultActionId')
    if (!Array.isArray(profile.actions) || profile.actions.length === 0) {
        throw new TypeError('official action profile actions must not be empty')
    }
    const actionIds = new Set<string>()
    profile.actions.forEach((action, actionIndex) => {
        const label = `official action profile actions[${actionIndex}]`
        if (!isRecord(action)) throw new TypeError(`${label} must be an object`)
        const actionId = assertNonEmptyString(action.id, `${label}.id`)
        if (actionIds.has(actionId)) throw new TypeError(`duplicate official action id ${actionId}`)
        actionIds.add(actionId)
        assertNonEmptyString(action.semantic, `${label}.semantic`)
        if (
            typeof action.presentation !== 'string'
            || !['standing', 'sitting', 'special'].includes(action.presentation)
        ) {
            throw new TypeError(`${label}.presentation is invalid`)
        }
        if (!isRecord(action.state)) throw new TypeError(`${label}.state must be an object`)
        const layer = assertNonEmptyString(action.state.layer, `${label}.state.layer`)
        if (!layerNames.has(layer)) throw new TypeError(`${label}.state.layer is not in controller.layers`)
        assertNonEmptyString(action.state.name, `${label}.state.name`)
        if (action.state.fullPath !== undefined) {
            const fullPath = assertNonEmptyString(action.state.fullPath, `${label}.state.fullPath`)
            if (!fullPath.startsWith(`${layer}.`)) {
                throw new TypeError(`${label}.state.fullPath does not begin with its layer`)
            }
        }
        if (action.state.stateNameHash !== undefined) {
            assertIntegerNumber(action.state.stateNameHash, `${label}.state.stateNameHash`)
        }
        if (action.state.fullPathHash !== undefined) {
            assertIntegerNumber(action.state.fullPathHash, `${label}.state.fullPathHash`)
        }
        if (action.parameters !== undefined) {
            if (!Array.isArray(action.parameters)) throw new TypeError(`${label}.parameters must be an array`)
            action.parameters.forEach((parameter, parameterIndex) => {
                const parameterLabel = `${label}.parameters[${parameterIndex}]`
                if (!isRecord(parameter)) throw new TypeError(`${parameterLabel} must be an object`)
                assertNonEmptyString(parameter.name, `${parameterLabel}.name`)
                if (
                    typeof parameter.type !== 'string'
                    || !['trigger', 'bool', 'int', 'float'].includes(parameter.type)
                ) {
                    throw new TypeError(`${parameterLabel}.type is invalid`)
                }
                if (parameter.hash !== undefined) {
                    const hash = assertFiniteNumber(parameter.hash, `${parameterLabel}.hash`)
                    if (!Number.isInteger(hash)) throw new TypeError(`${parameterLabel}.hash must be an integer`)
                }
                if (parameter.value !== undefined) {
                    if (parameter.type === 'bool' || parameter.type === 'trigger') {
                        if (typeof parameter.value !== 'boolean') {
                            throw new TypeError(`${parameterLabel}.value must be boolean`)
                        }
                    } else {
                        const value = assertFiniteNumber(parameter.value, `${parameterLabel}.value`)
                        if (parameter.type === 'int' && !Number.isInteger(value)) {
                            throw new TypeError(`${parameterLabel}.value must be an integer`)
                        }
                    }
                }
            })
        }
        if (!isRecord(action.sequence)) throw new TypeError(`${label}.sequence must be an object`)
        const sequenceEntries = getOfficialActionSequenceEntries(
            action as unknown as OfficialCharacterActionDefinition,
        )
        if (sequenceEntries.length === 0) throw new TypeError(`${label}.sequence must contain a phase`)
        sequenceEntries.forEach(([phase, clip]) => validateOfficialActionClip(clip, `${label}.sequence.${phase}`))
        if (action.phaseStates !== undefined) {
            if (!isRecord(action.phaseStates)) throw new TypeError(`${label}.phaseStates must be an object`)
            for (const phase of ['start', 'loop', 'end'] as const) {
                const states = action.phaseStates[phase]
                if (states === undefined) continue
                if (!action.sequence[phase]) throw new TypeError(`${label}.phaseStates.${phase} has no sequence clip`)
                if (!Array.isArray(states) || states.length === 0) {
                    throw new TypeError(`${label}.phaseStates.${phase} must not be empty`)
                }
                states.forEach((stateUse, stateIndex) => {
                    const stateLabel = `${label}.phaseStates.${phase}[${stateIndex}]`
                    if (!isRecord(stateUse)) throw new TypeError(`${stateLabel} must be an object`)
                    if (assertOfficialPathId(stateUse.controllerPathId, `${stateLabel}.controllerPathId`) !== profile.controller.pathId) {
                        throw new TypeError(`${stateLabel}.controllerPathId is not the active controller`)
                    }
                    assertIntegerNumber(stateUse.layerIndex, `${stateLabel}.layerIndex`)
                    const stateLayer = assertNonEmptyString(stateUse.layer, `${stateLabel}.layer`)
                    if (!layerNames.has(stateLayer)) throw new TypeError(`${stateLabel}.layer is not in controller.layers`)
                    assertIntegerNumber(stateUse.stateIndex, `${stateLabel}.stateIndex`)
                    const stateName = assertNonEmptyString(stateUse.name, `${stateLabel}.name`)
                    if (stateUse.stateNameHash !== undefined) {
                        assertIntegerNumber(stateUse.stateNameHash, `${stateLabel}.stateNameHash`)
                    }
                    const fullPath = assertNonEmptyString(stateUse.fullPath, `${stateLabel}.fullPath`)
                    if (!fullPath.startsWith(`${stateLayer}.`) || !fullPath.endsWith(stateName)) {
                        throw new TypeError(`${stateLabel}.fullPath is inconsistent with layer/name`)
                    }
                    if (stateUse.fullPathHash !== undefined) {
                        assertIntegerNumber(stateUse.fullPathHash, `${stateLabel}.fullPathHash`)
                    }
                    if (typeof stateUse.loop !== 'boolean') throw new TypeError(`${stateLabel}.loop must be boolean`)
                    assertFiniteNumber(stateUse.speed, `${stateLabel}.speed`)
                })
            }
        }
    })
    if (!actionIds.has(profile.defaultActionId)) {
        throw new TypeError(`official default action ${profile.defaultActionId} is missing`)
    }
}

function validateOfficialActionInventory(
    inventory: Readonly<OfficialCharacterActionInventory>,
): void {
    if (!isRecord(inventory)) throw new TypeError('official action inventory must be an object')
    assertNonEmptyString(inventory.characterId, 'official action inventory characterId')
    assertNonEmptyString(inventory.resourceName, 'official action inventory resourceName')
    if (!isRecord(inventory.controller)) throw new TypeError('official action inventory controller must be an object')
    if (inventory.controller.kind !== 'direct' && inventory.controller.kind !== 'override') {
        throw new TypeError('official action inventory controller.kind is invalid')
    }
    assertOfficialPathId(inventory.controller.pathId, 'official action inventory controller.pathId')
    assertNonEmptyString(inventory.controller.name, 'official action inventory controller.name')
    if (!Array.isArray(inventory.controller.layers)) {
        throw new TypeError('official action inventory controller.layers must be an array')
    }
    inventory.controller.layers.forEach((layer, index) => {
        assertNonEmptyString(layer, `official action inventory controller.layers[${index}]`)
    })
    if (!Array.isArray(inventory.clips)) throw new TypeError('official action inventory clips must be an array')
    inventory.clips.forEach((clip, index) => {
        if (!isRecord(clip)) throw new TypeError(`official action inventory clips[${index}] must be an object`)
        assertNonEmptyString(clip.name, `official action inventory clips[${index}].name`)
        assertOfficialPathId(clip.pathId, `official action inventory clips[${index}].pathId`)
    })
}

function officialActionFailure(
    actionId: string,
    reason: OfficialCharacterActionResolutionFailureReason,
    detail: string,
    missingClips?: readonly string[],
): OfficialCharacterActionResolutionFailure {
    const failure: OfficialCharacterActionResolutionFailure = { ok: false, reason, detail, actionId }
    if (missingClips?.length) failure.missingClips = [...missingClips]
    return failure
}

export function resolveOfficialCharacterAction(
    profile: Readonly<OfficialCharacterDirectControllerProfile>,
    actionId: string,
    inventory: Readonly<OfficialCharacterActionInventory>,
): OfficialCharacterActionResolution {
    try {
        validateOfficialDirectControllerProfile(profile)
    } catch (error) {
        return officialActionFailure(actionId, 'invalid-profile', error instanceof Error ? error.message : String(error))
    }
    try {
        validateOfficialActionInventory(inventory)
    } catch (error) {
        return officialActionFailure(actionId, 'invalid-inventory', error instanceof Error ? error.message : String(error))
    }
    if (profile.characterId !== inventory.characterId) {
        return officialActionFailure(actionId, 'character-mismatch', `${inventory.characterId} != ${profile.characterId}`)
    }
    if (profile.resourceName !== inventory.resourceName) {
        return officialActionFailure(actionId, 'resource-mismatch', `${inventory.resourceName} != ${profile.resourceName}`)
    }
    if (inventory.controller.kind !== 'direct') {
        return officialActionFailure(actionId, 'controller-kind-mismatch', `${inventory.controller.kind} != direct`)
    }
    if (profile.controller.pathId !== inventory.controller.pathId) {
        return officialActionFailure(
            actionId,
            'controller-path-mismatch',
            `${inventory.controller.pathId} != ${profile.controller.pathId}`,
        )
    }
    if (profile.controller.name !== inventory.controller.name) {
        return officialActionFailure(
            actionId,
            'controller-name-mismatch',
            `${inventory.controller.name} != ${profile.controller.name}`,
        )
    }
    const action = profile.actions.find(candidate => candidate.id === actionId)
    if (!action) return officialActionFailure(actionId, 'action-missing', `official action ${actionId} is missing`)
    if (!inventory.controller.layers.includes(action.state.layer)) {
        return officialActionFailure(actionId, 'layer-missing', `controller layer ${action.state.layer} is unavailable`)
    }
    if (action.phaseStates) {
        for (const phase of ['start', 'loop', 'end'] as const) {
            for (const stateUse of action.phaseStates[phase] ?? []) {
                if (!inventory.controller.layers.includes(stateUse.layer)) {
                    return officialActionFailure(
                        actionId,
                        'layer-missing',
                        `controller layer ${stateUse.layer} is unavailable for ${phase}`,
                    )
                }
            }
        }
    }
    const availableClips = new Set(inventory.clips.map(clip => `${clip.name}\u0000${clip.pathId}`))
    const missingClips = getOfficialActionSequenceEntries(action)
        .map(([, clip]) => clip)
        .filter(clip => !availableClips.has(`${clip.name}\u0000${clip.pathId}`))
        .map(clip => `${clip.name}#${clip.pathId}`)
    if (missingClips.length > 0) {
        return officialActionFailure(actionId, 'clip-missing', 'one or more exact official clips are unavailable', missingClips)
    }
    return { ok: true, profile, action }
}

export function resolveOfficialCharacterDefaultAction(
    profile: Readonly<OfficialCharacterDirectControllerProfile>,
    inventory: Readonly<OfficialCharacterActionInventory>,
): OfficialCharacterActionResolution {
    return resolveOfficialCharacterAction(profile, profile.defaultActionId, inventory)
}

/**
 * Resolves an ADV/Home motion token through controller state families. Empty
 * script cells explicitly preserve the current state; they are not converted
 * to the default action. Presentation selects the official standing, sitting
 * or unique-motion branch and prevents an ambiguous cross-branch guess.
 */
export function resolveOfficialCharacterBoardActionToken(
    profile: Readonly<OfficialCharacterDirectControllerProfile>,
    token: string | null | undefined,
    inventory: Readonly<OfficialCharacterActionInventory>,
    presentation: OfficialCharacterActionDefinition['presentation'] = 'standing',
): OfficialCharacterBoardActionTokenResolution {
    const defaultResolution = resolveOfficialCharacterDefaultAction(profile, inventory)
    if (!defaultResolution.ok) return defaultResolution
    if (token === null || token === undefined || token === '') {
        return { ok: true, behavior: 'preserve-current', token: null, actionId: null }
    }
    if (typeof token !== 'string' || token.trim() !== token || token.length === 0) {
        return officialActionFailure(String(token), 'action-missing', 'board action token must be an exact non-empty string')
    }
    if (!['standing', 'sitting', 'special'].includes(presentation)) {
        return officialActionFailure(token, 'action-missing', `board action presentation ${String(presentation)} is invalid`)
    }
    const candidateIds = new Set<string>([token])
    if (presentation === 'standing') {
        candidateIds.add(`WaitMotion/${token}`)
        candidateIds.add(`TapMotion_Stand/${token}`)
    } else if (presentation === 'sitting') {
        candidateIds.add(`WaitMotion/${token}`)
        candidateIds.add(`TapMotion_Sit/${token}`)
    } else {
        candidateIds.add(`UniqueMotion/${token}`)
    }
    const candidates = profile.actions.filter(action => (
        candidateIds.has(action.id)
        && (
            action.id === token
            || action.presentation === presentation
            || action.semantic === 'board-idle'
        )
    ))
    if (candidates.length === 0) {
        return officialActionFailure(token, 'action-missing', `official board token ${token} has no ${presentation} state family`)
    }
    if (candidates.length > 1) {
        return officialActionFailure(
            token,
            'action-ambiguous',
            `official board token ${token} resolves to ${candidates.map(action => action.id).join(', ')}`,
        )
    }
    const resolved = resolveOfficialCharacterAction(profile, candidates[0].id, inventory)
    if (!resolved.ok) return resolved
    return {
        ok: true,
        behavior: 'play',
        token,
        actionId: resolved.action.id,
        action: resolved.action,
    }
}

export function createOfficialCharacterActionTimeline(
    profile: Readonly<OfficialCharacterDirectControllerProfile>,
    actionId: string,
    inventory: Readonly<OfficialCharacterActionInventory>,
    options: Readonly<OfficialCharacterActionTimelineOptions>,
): OfficialCharacterActionTimelineResult {
    const resolved = resolveOfficialCharacterAction(profile, actionId, inventory)
    if (!resolved.ok) return resolved
    const defaultResolved = resolveOfficialCharacterDefaultAction(profile, inventory)
    if (!defaultResolved.ok) return defaultResolved
    const defaultClip = defaultResolved.action.sequence.loop
    if (!defaultClip) {
        return officialActionFailure(
            profile.defaultActionId,
            'default-loop-missing',
            `official default action ${profile.defaultActionId} requires a loop clip`,
        )
    }
    if (typeof options.targetId !== 'string' || options.targetId.length === 0) {
        return officialActionFailure(actionId, 'invalid-inventory', 'timeline targetId must be a non-empty string')
    }
    const hasLoop = resolved.action.sequence.loop !== undefined
    if (
        hasLoop
        && (
            options.holdSeconds === undefined
            || !Number.isFinite(options.holdSeconds)
            || options.holdSeconds <= 0
        )
    ) {
        return officialActionFailure(
            actionId,
            'hold-duration-required',
            'a positive finite holdSeconds is required for an official loop phase',
        )
    }
    if (
        options.holdSeconds !== undefined
        && (!Number.isFinite(options.holdSeconds) || options.holdSeconds < 0)
    ) {
        return officialActionFailure(actionId, 'hold-duration-required', 'holdSeconds must be finite and non-negative')
    }

    const clipKeyframes: CharacterTimelineKeyframe[] = []
    const events: CharacterTimelineEvent[] = []
    const phases: OfficialCharacterActionPhaseSchedule[] = []
    let time = 0
    for (const [phase, clip] of getOfficialActionSequenceEntries(resolved.action)) {
        const duration = phase === 'loop' ? options.holdSeconds as number : clip.durationSeconds
        clipKeyframes.push({ time, value: { name: clip.name, loop: phase === 'loop' } })
        events.push({
            id: `${options.targetId}:${actionId}:${phase}`,
            time,
            type: 'official-character-action-phase',
            targetId: options.targetId,
            payload: {
                schema: OFFICIAL_CHARACTER_ACTION_PROFILE_SCHEMA,
                characterId: profile.characterId,
                resourceName: profile.resourceName,
                actionId,
                semantic: resolved.action.semantic,
                presentation: resolved.action.presentation,
                phase,
                controllerKind: profile.controller.kind,
                controllerPathId: profile.controller.pathId,
                controllerName: profile.controller.name,
                layer: resolved.action.state.layer,
                stateName: resolved.action.state.name,
                ...(resolved.action.state.fullPath === undefined
                    ? {}
                    : { stateFullPath: resolved.action.state.fullPath }),
                ...(resolved.action.state.stateNameHash === undefined
                    ? {}
                    : { stateNameHash: resolved.action.state.stateNameHash }),
                ...(resolved.action.state.fullPathHash === undefined
                    ? {}
                    : { stateFullPathHash: resolved.action.state.fullPathHash }),
                stateUses: resolved.action.phaseStates?.[phase] ?? [],
                parameters: resolved.action.parameters ?? [],
                clipName: clip.name,
                clipPathId: clip.pathId,
                clipDurationSeconds: clip.durationSeconds,
                sampleRate: clip.sampleRate,
            },
        })
        phases.push({ phase, startTime: time, endTime: time + duration, actionId, clip })
        time += duration
    }
    clipKeyframes.push({ time, value: { name: defaultClip.name, loop: true } })
    events.push({
        id: `${options.targetId}:${actionId}:restore`,
        time,
        type: 'official-character-action-restore',
        targetId: options.targetId,
        payload: {
            schema: OFFICIAL_CHARACTER_ACTION_PROFILE_SCHEMA,
            characterId: profile.characterId,
            resourceName: profile.resourceName,
            actionId: profile.defaultActionId,
            phase: 'restore',
            controllerKind: profile.controller.kind,
            controllerPathId: profile.controller.pathId,
            controllerName: profile.controller.name,
            layer: defaultResolved.action.state.layer,
            stateName: defaultResolved.action.state.name,
            ...(defaultResolved.action.state.fullPath === undefined
                ? {}
                : { stateFullPath: defaultResolved.action.state.fullPath }),
            ...(defaultResolved.action.state.stateNameHash === undefined
                ? {}
                : { stateNameHash: defaultResolved.action.state.stateNameHash }),
            ...(defaultResolved.action.state.fullPathHash === undefined
                ? {}
                : { stateFullPathHash: defaultResolved.action.state.fullPathHash }),
            stateUses: defaultResolved.action.phaseStates?.loop ?? [],
            parameters: defaultResolved.action.parameters ?? [],
            clipName: defaultClip.name,
            clipPathId: defaultClip.pathId,
            clipDurationSeconds: defaultClip.durationSeconds,
            sampleRate: defaultClip.sampleRate,
        },
    })
    phases.push({
        phase: 'restore',
        startTime: time,
        endTime: time,
        actionId: profile.defaultActionId,
        clip: defaultClip,
    })
    const document: CharacterTimelineDocument = {
        schema: CHARACTER_TIMELINE_SCHEMA,
        duration: time,
        loop: false,
        tracks: [
            {
                id: `${options.targetId}:official-action`,
                targetId: options.targetId,
                kind: 'action',
                interpolation: 'step',
                keyframes: [
                    { time: 0, value: actionId },
                    { time, value: profile.defaultActionId },
                ],
            },
            {
                id: `${options.targetId}:official-clip`,
                targetId: options.targetId,
                kind: 'clip',
                interpolation: 'step',
                keyframes: clipKeyframes,
            },
        ],
        events,
    }
    return {
        ok: true,
        document,
        action: resolved.action,
        defaultAction: defaultResolved.action,
        phases,
    }
}

/**
 * Builds one deterministic timeline for an exact body rig and all required external sibling rigs.
 * This path deliberately consumes clip identities rather than retargeting body curves onto weapons.
 */
export function createOfficialSynchronizedCharacterActionTimeline(
    definition: Readonly<OfficialSynchronizedCharacterActionDefinition>,
    options: Readonly<OfficialSynchronizedCharacterActionTimelineOptions>,
): OfficialSynchronizedCharacterActionTimelineResult {
    const actionId = definition !== null && typeof definition === 'object' && typeof definition.actionId === 'string'
        ? definition.actionId
        : '<invalid-synchronized-action>'
    try {
        if (definition === null || typeof definition !== 'object') {
            throw new TypeError('synchronized action definition must be an object')
        }
        if (definition.schema !== OFFICIAL_SYNCHRONIZED_CHARACTER_ACTION_SCHEMA) {
            throw new TypeError(`unsupported synchronized action schema: ${String(definition.schema)}`)
        }
        assertNonEmptyString(definition.characterId, 'synchronized action characterId')
        assertNonEmptyString(definition.actionId, 'synchronized action actionId')
        assertNonEmptyString(definition.semantic, 'synchronized action semantic')
        if (definition.restoreActionId !== undefined) {
            assertNonEmptyString(definition.restoreActionId, 'synchronized action restoreActionId')
        }
        if (!Array.isArray((definition as { targets?: unknown }).targets) || definition.targets.length === 0) {
            throw new TypeError('synchronized action targets must contain the body target')
        }
    } catch (error) {
        return officialActionFailure(actionId, 'invalid-profile', error instanceof Error ? error.message : String(error))
    }

    const availableTargetIds = Array.isArray(options.availableTargetIds)
        ? options.availableTargetIds
        : []
    const availableTargets = new Set<string>()
    for (const [index, targetId] of availableTargetIds.entries()) {
        if (typeof targetId !== 'string' || targetId.length === 0) {
            return officialActionFailure(actionId, 'target-missing', `availableTargetIds[${index}] must be a non-empty string`)
        }
        availableTargets.add(targetId)
    }

    const targetsByRole = new Map<string, Readonly<OfficialSynchronizedCharacterActionTarget>>()
    const seenTargetIds = new Set<string>()
    for (const [index, target] of definition.targets.entries()) {
        const label = `synchronized action targets[${index}]`
        try {
            if (target === null || typeof target !== 'object') throw new TypeError(`${label} must be an object`)
            assertNonEmptyString(target.role, `${label}.role`)
            assertNonEmptyString(target.targetId, `${label}.targetId`)
            assertNonEmptyString(target.resourceName, `${label}.resourceName`)
            if (!isRecord(target.sequence)) throw new TypeError(`${label}.sequence must be an object`)
            const phases = getOfficialActionSequencePhaseMap(target.sequence)
            if (phases.size === 0) throw new TypeError(`${label}.sequence must contain a phase`)
            for (const [phase, clip] of phases) validateOfficialActionClip(clip, `${label}.sequence.${phase}`)
            if (!Array.isArray((target as { inventory?: unknown }).inventory)) {
                throw new TypeError(`${label}.inventory must be an array`)
            }
            target.inventory.forEach((clip, clipIndex) => {
                if (!isRecord(clip)) throw new TypeError(`${label}.inventory[${clipIndex}] must be an object`)
                assertNonEmptyString(clip.name, `${label}.inventory[${clipIndex}].name`)
                assertOfficialPathId(clip.pathId, `${label}.inventory[${clipIndex}].pathId`)
            })
            if (definition.restoreActionId !== undefined) {
                if (target.restoreClip === undefined) {
                    throw new TypeError(`${label}.restoreClip is required for restore action ${definition.restoreActionId}`)
                }
                validateOfficialActionClip(target.restoreClip, `${label}.restoreClip`)
            } else if (target.restoreClip !== undefined) {
                throw new TypeError(`${label}.restoreClip requires restoreActionId`)
            }
        } catch (error) {
            return officialActionFailure(actionId, 'invalid-inventory', error instanceof Error ? error.message : String(error))
        }
        if (targetsByRole.has(target.role) || seenTargetIds.has(target.targetId)) {
            return officialActionFailure(
                actionId,
                'target-duplicate',
                `synchronized target role/id must be unique: ${target.role}/${target.targetId}`,
            )
        }
        targetsByRole.set(target.role, target)
        seenTargetIds.add(target.targetId)
        if (!availableTargets.has(target.targetId)) {
            return officialActionFailure(
                actionId,
                'target-missing',
                `required synchronized target ${target.role}:${target.targetId} is not loaded`,
            )
        }
    }

    const body = targetsByRole.get('body')
    if (!body) {
        return officialActionFailure(actionId, 'target-missing', 'synchronized action requires exactly one body role')
    }
    const bodyPhases = getOfficialActionSequencePhaseMap(body.sequence)
    const bodyPhaseNames = [...bodyPhases.keys()]
    const hasLoop = bodyPhases.has('loop')
    if (
        hasLoop
        && (
            options.holdSeconds === undefined
            || !Number.isFinite(options.holdSeconds)
            || options.holdSeconds <= 0
        )
    ) {
        return officialActionFailure(
            actionId,
            'hold-duration-required',
            'a positive finite holdSeconds is required for a synchronized loop phase',
        )
    }
    if (
        options.holdSeconds !== undefined
        && (!Number.isFinite(options.holdSeconds) || options.holdSeconds < 0)
    ) {
        return officialActionFailure(actionId, 'hold-duration-required', 'holdSeconds must be finite and non-negative')
    }

    for (const target of definition.targets) {
        const phases = getOfficialActionSequencePhaseMap(target.sequence)
        const phaseNames = [...phases.keys()]
        if (
            phaseNames.length !== bodyPhaseNames.length
            || phaseNames.some((phase, index) => phase !== bodyPhaseNames[index])
        ) {
            return officialActionFailure(
                actionId,
                'phase-mismatch',
                `${target.role} phases ${phaseNames.join(',')} do not match body phases ${bodyPhaseNames.join(',')}`,
            )
        }
        const inventoryKeys = new Set(target.inventory.map(clip => `${clip.name}\u0000${clip.pathId}`))
        const requiredClips = [...phases.values(), ...(target.restoreClip ? [target.restoreClip] : [])]
        const missingClips = requiredClips
            .filter(clip => !inventoryKeys.has(`${clip.name}\u0000${clip.pathId}`))
            .map(clip => `${target.role}:${clip.name}#${clip.pathId}`)
        if (missingClips.length > 0) {
            return officialActionFailure(
                actionId,
                'clip-missing',
                `one or more exact ${target.role} clips are unavailable`,
                missingClips,
            )
        }
        for (const phase of bodyPhaseNames) {
            const bodyClip = bodyPhases.get(phase) as Readonly<OfficialCharacterActionClip>
            const targetClip = phases.get(phase) as Readonly<OfficialCharacterActionClip>
            const halfFrameTolerance = Math.max(1 / bodyClip.sampleRate, 1 / targetClip.sampleRate) / 2
            if (Math.abs(targetClip.durationSeconds - bodyClip.durationSeconds) > halfFrameTolerance + EPSILON) {
                return officialActionFailure(
                    actionId,
                    'phase-duration-mismatch',
                    `${target.role} ${phase} duration ${targetClip.durationSeconds} does not match body ${bodyClip.durationSeconds}`,
                )
            }
        }
    }

    const bodySchedule: OfficialCharacterActionPhaseSchedule[] = []
    let duration = 0
    for (const [phase, clip] of bodyPhases) {
        const phaseDuration = phase === 'loop' ? options.holdSeconds as number : clip.durationSeconds
        bodySchedule.push({ phase, startTime: duration, endTime: duration + phaseDuration, actionId, clip })
        duration += phaseDuration
    }
    if (definition.restoreActionId !== undefined) {
        bodySchedule.push({
            phase: 'restore',
            startTime: duration,
            endTime: duration,
            actionId: definition.restoreActionId,
            clip: body.restoreClip as OfficialCharacterActionClip,
        })
    }

    const tracks: CharacterTimelineTrack[] = []
    const events: CharacterTimelineEvent[] = []
    const targetSchedules: OfficialSynchronizedCharacterActionTargetSchedule[] = []
    for (const target of definition.targets) {
        const phases = getOfficialActionSequencePhaseMap(target.sequence)
        const clipKeyframes: CharacterTimelineKeyframe[] = []
        const schedule: OfficialCharacterActionPhaseSchedule[] = []
        for (const bodyPhase of bodySchedule.filter(phase => phase.phase !== 'restore')) {
            const phase = bodyPhase.phase as OfficialCharacterActionPhaseKind
            const clip = phases.get(phase) as Readonly<OfficialCharacterActionClip>
            clipKeyframes.push({ time: bodyPhase.startTime, value: { name: clip.name, loop: phase === 'loop' } })
            schedule.push({
                phase,
                startTime: bodyPhase.startTime,
                endTime: bodyPhase.endTime,
                actionId,
                clip,
            })
            events.push({
                id: `${target.targetId}:${actionId}:${phase}`,
                time: bodyPhase.startTime,
                type: 'official-synchronized-character-action-phase',
                targetId: target.targetId,
                payload: {
                    schema: OFFICIAL_SYNCHRONIZED_CHARACTER_ACTION_SCHEMA,
                    characterId: definition.characterId,
                    resourceName: target.resourceName,
                    actionId,
                    semantic: definition.semantic,
                    role: target.role,
                    phase,
                    clipName: clip.name,
                    clipPathId: clip.pathId,
                    clipDurationSeconds: clip.durationSeconds,
                    sampleRate: clip.sampleRate,
                },
            })
        }
        const actionKeyframes: CharacterTimelineKeyframe[] = [{ time: 0, value: actionId }]
        if (definition.restoreActionId !== undefined) {
            const restoreClip = target.restoreClip as Readonly<OfficialCharacterActionClip>
            clipKeyframes.push({ time: duration, value: { name: restoreClip.name, loop: true } })
            actionKeyframes.push({ time: duration, value: definition.restoreActionId })
            schedule.push({
                phase: 'restore',
                startTime: duration,
                endTime: duration,
                actionId: definition.restoreActionId,
                clip: restoreClip,
            })
            events.push({
                id: `${target.targetId}:${actionId}:restore`,
                time: duration,
                type: 'official-synchronized-character-action-restore',
                targetId: target.targetId,
                payload: {
                    schema: OFFICIAL_SYNCHRONIZED_CHARACTER_ACTION_SCHEMA,
                    characterId: definition.characterId,
                    resourceName: target.resourceName,
                    actionId: definition.restoreActionId,
                    semantic: definition.semantic,
                    role: target.role,
                    phase: 'restore',
                    clipName: restoreClip.name,
                    clipPathId: restoreClip.pathId,
                    clipDurationSeconds: restoreClip.durationSeconds,
                    sampleRate: restoreClip.sampleRate,
                },
            })
        }
        tracks.push(
            {
                id: `${target.targetId}:official-synchronized-action`,
                targetId: target.targetId,
                kind: 'action',
                interpolation: 'step',
                keyframes: actionKeyframes,
            },
            {
                id: `${target.targetId}:official-synchronized-clip`,
                targetId: target.targetId,
                kind: 'clip',
                interpolation: 'step',
                keyframes: clipKeyframes,
            },
        )
        targetSchedules.push({
            role: target.role,
            targetId: target.targetId,
            resourceName: target.resourceName,
            phases: schedule,
        })
    }

    return {
        ok: true,
        definition,
        targets: targetSchedules,
        document: {
            schema: CHARACTER_TIMELINE_SCHEMA,
            duration,
            loop: false,
            tracks,
            events,
        },
    }
}

export function serializeCharacterTimeline(
    document: CharacterTimelineDocument,
    trackAdapters: readonly CharacterTimelineTrackAdapter[] = [],
): string {
    const adapters = new Map(trackAdapters.map(adapter => [adapter.kind, adapter]))
    const normalized = normalizeDocument(document, adapters)
    return JSON.stringify(normalized)
}

export function deserializeCharacterTimeline(
    input: string | CharacterTimelineDocument,
    trackAdapters: readonly CharacterTimelineTrackAdapter[] = [],
): CharacterTimelineDocument {
    const parsed: unknown = typeof input === 'string' ? JSON.parse(input) : input
    const adapters = new Map(trackAdapters.map(adapter => [adapter.kind, adapter]))
    return normalizeDocument(parsed as CharacterTimelineDocument, adapters)
}

export function createObjectTimelineBinding(
    options: Readonly<ObjectTimelineBindingOptions>,
): CharacterTimelineBinding {
    let lastLocomotion: string | null | undefined
    let lastAction: string | null | undefined
    let lastClipKey: string | undefined
    let lastAnimationTime: number | undefined
    let lastSpeed: number | undefined
    let lastWeight: number | undefined
    let lastSecondaryPhysicsKey: string | undefined
    return {
        setPosition: value => options.object.position.set(value[0], value[1], value[2]),
        setRotation: value => options.object.quaternion.set(value[0], value[1], value[2], value[3]),
        setScale: value => options.object.scale.set(value[0], value[1], value[2]),
        setLocomotionState: state => {
            if (state === lastLocomotion) return
            lastLocomotion = state
            options.onLocomotionState?.(state)
        },
        setActionState: action => {
            if (action === lastAction) return
            lastAction = action
            options.onActionState?.(action)
        },
        setAnimationClip: clip => {
            const key = `${clip.name ?? '<clear>'}:${clip.loop ?? false}`
            if (key === lastClipKey) return
            lastClipKey = key
            if (clip.name === null) options.animation?.clear?.()
            else options.animation?.play(clip.name, clip.loop ?? false)
        },
        setAnimationTime: timeSeconds => {
            if (timeSeconds === lastAnimationTime) return
            lastAnimationTime = timeSeconds
            options.animation?.setTime?.(timeSeconds)
        },
        setAnimationSpeed: speed => {
            if (speed === lastSpeed) return
            lastSpeed = speed
            options.animation?.setSpeed?.(speed)
        },
        setAnimationWeight: weight => {
            if (weight === lastWeight) return
            lastWeight = weight
            options.animation?.setWeight?.(weight)
        },
        setMorph: (name, value) => {
            options.object.traverse?.(object => {
                const index = object.morphTargetDictionary?.[name]
                if (index !== undefined && object.morphTargetInfluences) {
                    object.morphTargetInfluences[index] = value
                }
            })
        },
        setSecondaryPhysicsState: state => {
            const key = [
                state.active,
                state.reset ?? false,
                state.blendWeight ?? '',
                state.resetToken ?? '',
            ].join('|')
            if (key === lastSecondaryPhysicsKey) return
            lastSecondaryPhysicsKey = key
            options.onSecondaryPhysicsState?.({ ...state })
        },
    }
}

export class CharacterTimeline {
    readonly duration: number

    private readonly document: NormalizedTimelineDocument
    private readonly bindings: Map<string, CharacterTimelineBinding>
    private readonly adapters = new Map<string, CharacterTimelineTrackAdapter>()
    private readonly eventListeners = new Set<CharacterTimelineEventListener>()
    private _time = 0
    private _playing = false
    private _loop: boolean
    private completedLoops = 0

    constructor(document: CharacterTimelineDocument, options: CharacterTimelineOptions = {}) {
        for (const adapter of options.trackAdapters ?? []) {
            if (!adapter.kind || BUILT_IN_KINDS.has(adapter.kind as BuiltInTimelineTrackKind)) {
                throw new TypeError(`invalid extension track adapter kind ${adapter.kind}`)
            }
            if (this.adapters.has(adapter.kind)) throw new TypeError(`duplicate adapter ${adapter.kind}`)
            this.adapters.set(adapter.kind, adapter)
        }
        this.document = normalizeDocument(document, this.adapters)
        this.duration = this.document.duration
        this._loop = this.document.loop
        this.bindings = normalizeBindings(options.bindings)
        for (const listener of options.eventListeners ?? []) this.eventListeners.add(listener)
    }

    get time(): number {
        return this._time
    }

    get playing(): boolean {
        return this._playing
    }

    get loop(): boolean {
        return this._loop
    }

    set loop(value: boolean) {
        this._loop = value
        this.completedLoops = 0
        this._time = this.normalizeTime(this._time)
    }

    setBinding(targetId: string, binding: CharacterTimelineBinding): void {
        if (!targetId) throw new TypeError('targetId is required')
        this.bindings.set(targetId, binding)
    }

    removeBinding(targetId: string): void {
        this.bindings.delete(targetId)
    }

    onEvent(listener: CharacterTimelineEventListener): () => void {
        this.eventListeners.add(listener)
        return () => this.eventListeners.delete(listener)
    }

    play(): void {
        this._playing = true
        this.applyAt(this._time)
    }

    pause(): void {
        this._playing = false
    }

    seek(time: number, emitEventsAtTarget = false): readonly SampledTimelineTrack[] {
        assertFiniteNumber(time, 'seek time')
        this._time = this.normalizeTime(time)
        const samples = this.applyAt(this._time)
        if (emitEventsAtTarget) {
            this.emitEvents(this.document.events
                .filter(event => Math.abs(event.time - this._time) <= EPSILON)
                .map(event => ({ event, loopIndex: this.completedLoops })))
        }
        return samples
    }

    seekFrame(frame: number, framesPerSecond: number): readonly SampledTimelineTrack[] {
        if (!Number.isInteger(frame) || frame < 0) throw new TypeError('frame must be a non-negative integer')
        if (!Number.isFinite(framesPerSecond) || framesPerSecond <= 0) {
            throw new TypeError('framesPerSecond must be positive and finite')
        }
        return this.seek(frame / framesPerSecond)
    }

    update(deltaSeconds: number): readonly SampledTimelineTrack[] {
        if (!this._playing) return this.sample(this._time)
        return this.step(deltaSeconds)
    }

    /** Manual deterministic advance; it also works while paused. */
    step(deltaSeconds: number): readonly SampledTimelineTrack[] {
        assertNonNegativeNumber(deltaSeconds, 'step deltaSeconds')
        if (deltaSeconds === 0 || this.duration === 0) return this.applyAt(this._time)

        const occurrences: Array<{ event: CharacterTimelineEvent; loopIndex: number }> = []
        if (!this._loop) {
            const next = Math.min(this.duration, this._time + deltaSeconds)
            this.collectEvents(this._time, next, false, this.completedLoops, occurrences)
            this._time = next
            if (next >= this.duration - EPSILON) this._playing = false
        } else {
            let remaining = deltaSeconds
            let current = this._time
            while (remaining > EPSILON) {
                const toEnd = this.duration - current
                if (remaining < toEnd - EPSILON) {
                    const next = current + remaining
                    this.collectEvents(current, next, false, this.completedLoops, occurrences)
                    current = next
                    remaining = 0
                } else {
                    this.collectEvents(current, this.duration, false, this.completedLoops, occurrences)
                    remaining = Math.max(0, remaining - toEnd)
                    current = 0
                    this.completedLoops += 1
                    this.collectEvents(0, 0, true, this.completedLoops, occurrences)
                }
            }
            this._time = current
        }

        const samples = this.applyAt(this._time)
        this.emitEvents(occurrences)
        return samples
    }

    sample(time = this._time): readonly SampledTimelineTrack[] {
        const normalized = this.normalizeTime(time)
        return this.document.tracks.map(track => ({
            trackId: track.id,
            targetId: track.targetId,
            kind: track.kind,
            property: track.property,
            value: sampleTrackValue(track, normalized, this.adapters.get(track.kind)),
        }))
    }

    private applyAt(time: number): readonly SampledTimelineTrack[] {
        const samples = this.sample(time)
        for (let index = 0; index < samples.length; index += 1) {
            const sample = samples[index]
            const track = this.document.tracks[index]
            if (BUILT_IN_KINDS.has(track.kind as BuiltInTimelineTrackKind)) {
                this.applyBuiltIn(track, sample.value)
            } else {
                const adapter = this.adapters.get(track.kind)
                if (!adapter) throw new Error(`timeline adapter ${track.kind} is not registered`)
                adapter.apply(sample.value, {
                    timelineTime: time,
                    targetId: track.targetId,
                    property: track.property,
                    track,
                })
            }
        }
        return samples
    }

    private applyBuiltIn(track: CharacterTimelineTrack, value: unknown): void {
        const binding = this.bindings.get(track.targetId)
        if (!binding) throw new Error(`timeline target ${track.targetId} is not bound`)
        const missing = () => {
            throw new Error(`timeline target ${track.targetId} does not implement ${track.kind}`)
        }
        switch (track.kind as BuiltInTimelineTrackKind) {
            case 'position':
                return (binding.setPosition ?? missing)(assertTuple(value, 3, 'position') as TimelineVector3)
            case 'rotation':
                return (binding.setRotation ?? missing)(assertTuple(value, 4, 'rotation') as TimelineQuaternion)
            case 'scale':
                return (binding.setScale ?? missing)(assertTuple(value, 3, 'scale') as TimelineVector3)
            case 'locomotion':
                return (binding.setLocomotionState ?? missing)(value as string | null)
            case 'action':
                return (binding.setActionState ?? missing)(value as string | null)
            case 'clip':
                return (binding.setAnimationClip ?? missing)(assertClipValue(value, 'clip'))
            case 'animationTime':
                return (binding.setAnimationTime ?? missing)(assertFiniteNumber(value, 'animationTime'))
            case 'animationSpeed':
                return (binding.setAnimationSpeed ?? missing)(assertFiniteNumber(value, 'animationSpeed'))
            case 'animationWeight':
                return (binding.setAnimationWeight ?? missing)(assertFiniteNumber(value, 'animationWeight'))
            case 'morph':
                if (!track.property) throw new Error(`morph track ${track.id} has no property`)
                return (binding.setMorph ?? missing)(track.property, assertFiniteNumber(value, 'morph'))
            case 'secondaryPhysics':
                return (binding.setSecondaryPhysicsState ?? missing)(
                    assertSecondaryPhysicsValue(value, 'secondaryPhysics'),
                )
        }
    }

    private collectEvents(
        from: number,
        to: number,
        includeStart: boolean,
        loopIndex: number,
        output: Array<{ event: CharacterTimelineEvent; loopIndex: number }>,
    ): void {
        for (const event of this.document.events) {
            const afterStart = includeStart
                ? event.time >= from - EPSILON
                : event.time > from + EPSILON
            if (afterStart && event.time <= to + EPSILON) output.push({ event, loopIndex })
        }
    }

    private emitEvents(
        occurrences: readonly { event: CharacterTimelineEvent; loopIndex: number }[],
    ): void {
        for (const occurrence of occurrences) {
            for (const listener of this.eventListeners) {
                listener({
                    timelineTime: occurrence.event.time,
                    loopIndex: occurrence.loopIndex,
                    event: occurrence.event,
                })
            }
        }
    }

    private normalizeTime(time: number): number {
        assertFiniteNumber(time, 'timeline time')
        if (this.duration === 0) return 0
        if (!this._loop) return Math.max(0, Math.min(this.duration, time))
        return ((time % this.duration) + this.duration) % this.duration
    }

    toDocument(): CharacterTimelineDocument {
        return cloneJsonFinite(this.document, 'timeline document')
    }

    serialize(): string {
        return JSON.stringify(this.toDocument())
    }
}

interface OfficialCatalogDocumentSuccess {
    ok: true
    document: CharacterTimelineDocument
}

type OfficialCatalogDocumentResult =
    | OfficialCharacterActionResolutionFailure
    | OfficialCatalogDocumentSuccess

const OFFICIAL_DUNGEON_SEMANTIC_ORDER: Readonly<Record<'idle' | 'walk' | 'run', number>> = {
    idle: 0,
    walk: 1,
    run: 2,
}

const OFFICIAL_DUNGEON_SEMANTIC_LABEL: Readonly<Record<'idle' | 'walk' | 'run', string>> = {
    idle: '待机',
    walk: '行走',
    run: '奔跑',
}

function assertOfficialCatalogEntry(entry: unknown, label: string): asserts entry is OfficialCharacterActionCatalogEntry {
    if (!isRecord(entry)) throw new TypeError(`${label} must be an object`)
    assertNonEmptyString(entry.id, `${label}.id`)
    assertNonEmptyString(entry.label, `${label}.label`)
    assertNonEmptyString(entry.groupId, `${label}.groupId`)
    assertNonEmptyString(entry.group, `${label}.group`)
    if (!['oneShot', 'loop', 'timeline'].includes(String(entry.playbackKind))) {
        throw new TypeError(`${label}.playbackKind is invalid`)
    }
    if (!isRecord(entry.characterIdentity)) throw new TypeError(`${label}.characterIdentity must be an object`)
    assertNonEmptyString(entry.characterIdentity.characterId, `${label}.characterIdentity.characterId`)
    assertNonEmptyString(entry.characterIdentity.resourceName, `${label}.characterIdentity.resourceName`)
    assertNonEmptyString(entry.characterIdentity.logicalBundleKey, `${label}.characterIdentity.logicalBundleKey`)
    if (!isRecord(entry.availability)) throw new TypeError(`${label}.availability must be an object`)
    if (!['source-available', 'unavailable'].includes(String(entry.availability.status))) {
        throw new TypeError(`${label}.availability.status is invalid`)
    }
    if (!isRecord(entry.playback)) throw new TypeError(`${label}.playback must be an object`)
    if (!['oneShot', 'loop', 'timeline'].includes(String(entry.playback.kind))) {
        throw new TypeError(`${label}.playback.kind is invalid`)
    }
    assertJsonFinite(entry, label)
}

/**
 * Creates a stable, duplicate-free action catalog. Catalog construction never
 * makes a missing source executable; unavailable entries remain visible data.
 */
export function createOfficialCharacterActionCatalog(
    entries: readonly OfficialCharacterActionCatalogEntry[],
): OfficialCharacterActionCatalog {
    if (!Array.isArray(entries)) throw new TypeError('official character action catalog entries must be an array')
    const seenIds = new Set<string>()
    const normalized = entries.map((entry, index) => {
        assertOfficialCatalogEntry(entry, `official character action catalog entries[${index}]`)
        if (seenIds.has(entry.id)) throw new TypeError(`duplicate official character action id ${entry.id}`)
        seenIds.add(entry.id)
        return cloneJsonFinite(entry, `official character action catalog entries[${index}]`)
    })
    return {
        schema: OFFICIAL_CHARACTER_ACTION_CATALOG_SCHEMA,
        entries: normalized,
    }
}

export function mergeOfficialCharacterActionCatalogs(
    ...catalogs: readonly OfficialCharacterActionCatalog[]
): OfficialCharacterActionCatalog {
    const entries: OfficialCharacterActionCatalogEntry[] = []
    for (const [catalogIndex, catalog] of catalogs.entries()) {
        if (!isRecord(catalog) || catalog.schema !== OFFICIAL_CHARACTER_ACTION_CATALOG_SCHEMA) {
            throw new TypeError(`official character action catalog ${catalogIndex} has an unsupported schema`)
        }
        if (!Array.isArray(catalog.entries)) {
            throw new TypeError(`official character action catalog ${catalogIndex}.entries must be an array`)
        }
        entries.push(...catalog.entries)
    }
    return createOfficialCharacterActionCatalog(entries)
}

export function findOfficialCharacterActionCatalogEntries(
    catalog: Readonly<OfficialCharacterActionCatalog>,
    characterId: string,
    includeUnavailable = true,
): readonly OfficialCharacterActionCatalogEntry[] {
    if (!isRecord(catalog) || catalog.schema !== OFFICIAL_CHARACTER_ACTION_CATALOG_SCHEMA) {
        throw new TypeError('official character action catalog has an unsupported schema')
    }
    assertNonEmptyString(characterId, 'official character action catalog characterId')
    if (!Array.isArray(catalog.entries)) throw new TypeError('official character action catalog entries must be an array')
    return catalog.entries.filter(entry => (
        entry.characterIdentity.characterId === characterId
        && (includeUnavailable || entry.availability.status === 'source-available')
    ))
}

/**
 * Selects a verified three-phase combat-jump pose donor for one target rig.
 * The target character's own exact-rig source always wins, even when a foreign
 * verified-retarget entry has a higher evidence grade. Foreign exact-rig clips
 * are never treated as compatible, and grade-C/incompatible entries remain
 * visible catalog evidence but are not executable.
 */
export function selectPreferredOfficialJumpDonor(
    entries: readonly OfficialCharacterActionCatalogEntry[],
    targetCharacterId: string,
): OfficialJumpDonorSelectionResult {
    if (!Array.isArray(entries)) throw new TypeError('official jump donor entries must be an array')
    assertNonEmptyString(targetCharacterId, 'official jump donor targetCharacterId')

    const candidates: Array<{
        entry: Readonly<OfficialCharacterActionCatalogEntry>
        priority: OfficialJumpDonorSelectionPriority
        priorityRank: number
        gradeRank: number
    }> = []
    for (const entry of entries) {
        if (
            entry.characterIdentity.characterId !== targetCharacterId
            || entry.availability.status !== 'source-available'
            || entry.playbackKind !== 'timeline'
            || !('jumpDonor' in entry.playback)
        ) continue
        const donor = entry.playback.jumpDonor
        if (
            donor.grade === 'C'
            || donor.compatibility === 'incompatible'
            || donor.attachmentPolicy !== 'body-only-exclude-external-weapons'
            || !donor.compatibleCharacterIds.includes(targetCharacterId)
        ) continue

        const sameCharacter = donor.sourceCharacterId === targetCharacterId
        let priority: OfficialJumpDonorSelectionPriority
        let priorityRank: number
        if (sameCharacter && donor.compatibility === 'exact-rig') {
            priority = 'same-character-exact-rig'
            priorityRank = 0
        } else if (sameCharacter && donor.compatibility === 'verified-retarget') {
            priority = 'same-character-verified-retarget'
            priorityRank = 1
        } else if (!sameCharacter && donor.compatibility === 'verified-retarget') {
            priority = 'verified-retarget'
            priorityRank = 2
        } else {
            // A foreign source marked exact-rig is exact only for its own rig.
            continue
        }
        candidates.push({
            entry,
            priority,
            priorityRank,
            gradeRank: donor.grade === 'A' ? 0 : 1,
        })
    }

    candidates.sort((left, right) => (
        left.priorityRank - right.priorityRank
        || left.gradeRank - right.gradeRank
        || left.entry.id.localeCompare(right.entry.id, 'en')
    ))
    const selected = candidates[0]
    if (!selected) {
        return {
            status: 'unavailable',
            targetCharacterId,
            reason: 'no same-character exact-rig or explicitly verified-retarget three-phase combat jump is available',
        }
    }
    return {
        status: 'selected',
        targetCharacterId,
        priority: selected.priority,
        entry: selected.entry,
    }
}

function parseRegionBundlePresence(value: unknown, label: string): Readonly<Record<string, boolean>> {
    if (!isRecord(value)) throw new TypeError(`${label} must be an object`)
    const output: Record<string, boolean> = {}
    for (const [region, present] of Object.entries(value)) {
        if (typeof present !== 'boolean') throw new TypeError(`${label}.${region} must be boolean`)
        output[assertNonEmptyString(region, `${label} key`)] = present
    }
    if (Object.keys(output).length === 0) throw new TypeError(`${label} must not be empty`)
    return output
}

/**
 * Consumes the bounded resource authority without clip-name retargeting. Each
 * record contributes exactly idle/walk/run and preserves its exact controller,
 * pathID, binding count and body-only attachment policy.
 */
export function createOfficialNativeDungeonActionCatalogFromRoster(
    source: unknown,
): OfficialCharacterActionCatalog {
    if (!isRecord(source)) throw new TypeError('official dungeon character roster must be an object')
    if (source.schema !== OFFICIAL_DUNGEON_CHARACTER_ROSTER_SCHEMA) {
        throw new TypeError(`unsupported official dungeon roster schema: ${String(source.schema)}`)
    }
    if (!Array.isArray(source.records)) throw new TypeError('official dungeon roster records must be an array')
    const entries: OfficialCharacterActionCatalogEntry[] = []
    for (const [recordIndex, record] of source.records.entries()) {
        const label = `official dungeon roster records[${recordIndex}]`
        if (!isRecord(record)) throw new TypeError(`${label} must be an object`)
        const dungeonCharacterId = assertStableIdentifier(record.dungeonCharacterId, `${label}.dungeonCharacterId`)
        const characterMstId = assertStableIdentifier(record.characterMstId, `${label}.characterMstId`)
        const logicalKey = assertNonEmptyString(record.logicalKey, `${label}.logicalKey`)
        if (logicalKey !== `dungeon/character/${dungeonCharacterId}`) {
            throw new TypeError(`${label}.logicalKey does not match dungeonCharacterId`)
        }
        if (!isRecord(record.controller)) throw new TypeError(`${label}.controller must be an object`)
        const controllerPathId = assertOfficialPathId(record.controller.pathID, `${label}.controller.pathID`)
        assertNonEmptyString(record.controller.name, `${label}.controller.name`)
        if (!isRecord(record.modelMapping)) throw new TypeError(`${label}.modelMapping must be an object`)
        const style3dResourceName = assertNonEmptyString(
            record.modelMapping.style3dResourceName,
            `${label}.modelMapping.style3dResourceName`,
        )
        const styleFigureModelName = assertNonEmptyString(
            record.modelMapping.styleFigureModelName,
            `${label}.modelMapping.styleFigureModelName`,
        )
        const regionBundlePresence = parseRegionBundlePresence(
            record.regionBundlePresence,
            `${label}.regionBundlePresence`,
        )
        const sourceAvailable = Object.values(regionBundlePresence).some(Boolean)
        const idleSemanticName = assertNonEmptyString(record.idleSemantic, `${label}.idleSemantic`)
        const externalPolicy = assertNonEmptyString(
            record.externalAttachmentPolicy,
            `${label}.externalAttachmentPolicy`,
        )
        if (!externalPolicy.toLowerCase().includes('body-only')) {
            throw new TypeError(`${label}.externalAttachmentPolicy must be body-only`)
        }
        if (!Array.isArray(record.movementClips)) throw new TypeError(`${label}.movementClips must be an array`)
        const semantics = new Set<'idle' | 'walk' | 'run'>()
        for (const [clipIndex, sourceClip] of record.movementClips.entries()) {
            const clipLabel = `${label}.movementClips[${clipIndex}]`
            if (!isRecord(sourceClip)) throw new TypeError(`${clipLabel} must be an object`)
            const clip: OfficialCharacterActionClip = {
                name: assertNonEmptyString(sourceClip.name, `${clipLabel}.name`),
                pathId: assertOfficialPathId(sourceClip.pathID, `${clipLabel}.pathID`),
                durationSeconds: assertFiniteNumber(sourceClip.durationSeconds, `${clipLabel}.durationSeconds`),
                sampleRate: assertFiniteNumber(sourceClip.sampleRate, `${clipLabel}.sampleRate`),
            }
            validateOfficialActionClip(clip, clipLabel)
            const sourceSemantic = sourceClip.locomotionSemantic
            const semantic = sourceSemantic === 'idle' || sourceSemantic === 'walk' || sourceSemantic === 'run'
                ? sourceSemantic
                : clip.name === idleSemanticName ? 'idle' : null
            if (semantic === null) throw new TypeError(`${clipLabel} has no exact locomotion semantic`)
            if (semantics.has(semantic)) throw new TypeError(`${label} duplicates ${semantic} locomotion`)
            semantics.add(semantic)
            const bindingCount = assertIntegerNumber(sourceClip.genericBindings, `${clipLabel}.genericBindings`)
            if (bindingCount <= 0) throw new RangeError(`${clipLabel}.genericBindings must be positive`)
            const displayName = isRecord(record.names) && typeof record.names.zhHantStyle3d === 'string'
                ? record.names.zhHantStyle3d
                : dungeonCharacterId
            entries.push({
                id: `official-dungeon:${dungeonCharacterId}:${semantic}:${clip.pathId}`,
                label: `${displayName} / ${OFFICIAL_DUNGEON_SEMANTIC_LABEL[semantic]}`,
                groupId: 'official-dungeon-locomotion',
                group: '官方探索动作',
                playbackKind: 'loop',
                characterIdentity: {
                    characterId: dungeonCharacterId,
                    characterMstId,
                    dungeonCharacterId,
                    resourceName: dungeonCharacterId,
                    logicalBundleKey: logicalKey,
                    dungeonResourceName: dungeonCharacterId,
                    style3dResourceName,
                    styleFigureModelName,
                },
                availability: {
                    status: sourceAvailable ? 'source-available' : 'unavailable',
                    ...(!sourceAvailable ? { reason: 'no bounded regional dungeon bundle is present' } : {}),
                    regionBundlePresence,
                },
                playback: {
                    kind: 'loop',
                    targetRole: 'body',
                    clip,
                    controllerPathId,
                    bindingCount,
                    attachmentPolicy: 'body-only-exclude-external-weapons',
                },
                sourceFamily: {
                    id: `official-dungeon:${dungeonCharacterId}`,
                    compatibility: 'native-only',
                },
            })
        }
        for (const semantic of ['idle', 'walk', 'run'] as const) {
            if (!semantics.has(semantic)) throw new TypeError(`${label} is missing ${semantic} locomotion`)
        }
    }
    entries.sort((left, right) => {
        const leftId = left.characterIdentity.dungeonCharacterId as string
        const rightId = right.characterIdentity.dungeonCharacterId as string
        const identityOrder = leftId.localeCompare(rightId, 'en', { numeric: true })
        if (identityOrder !== 0) return identityOrder
        const leftSemantic = left.id.split(':')[2] as 'idle' | 'walk' | 'run'
        const rightSemantic = right.id.split(':')[2] as 'idle' | 'walk' | 'run'
        return OFFICIAL_DUNGEON_SEMANTIC_ORDER[leftSemantic] - OFFICIAL_DUNGEON_SEMANTIC_ORDER[rightSemantic]
    })
    return createOfficialCharacterActionCatalog(entries)
}

function createOfficialNativeClipDocument(
    entry: Readonly<OfficialCharacterActionCatalogEntry>,
    runtime: Readonly<OfficialNativeDungeonRuntimeInventory> | undefined,
    requestedTargetId?: string,
): OfficialCatalogDocumentResult {
    if (!('clip' in entry.playback) || (entry.playback.kind !== 'loop' && entry.playback.kind !== 'oneShot')) {
        return officialActionFailure(entry.id, 'playback-unavailable', 'catalog entry is not an exact native clip')
    }
    const playback = entry.playback
    if (entry.playbackKind !== playback.kind) {
        return officialActionFailure(entry.id, 'playback-unavailable', 'catalog playback kind disagrees with native clip')
    }
    if (!runtime) return officialActionFailure(entry.id, 'playback-unavailable', 'native runtime inventory is required')
    try {
        assertNonEmptyString(runtime.dungeonCharacterId, 'native runtime dungeonCharacterId')
        assertNonEmptyString(runtime.characterId, 'native runtime characterId')
        assertNonEmptyString(runtime.resourceName, 'native runtime resourceName')
        assertOfficialPathId(runtime.controllerPathId, 'native runtime controllerPathId')
        assertNonEmptyString(runtime.bodyTargetId, 'native runtime bodyTargetId')
        if (!Array.isArray(runtime.clips)) throw new TypeError('native runtime clips must be an array')
        runtime.clips.forEach((clip, index) => {
            if (!isRecord(clip)) throw new TypeError(`native runtime clips[${index}] must be an object`)
            assertNonEmptyString(clip.name, `native runtime clips[${index}].name`)
            assertOfficialPathId(clip.pathId, `native runtime clips[${index}].pathId`)
        })
    } catch (error) {
        return officialActionFailure(entry.id, 'invalid-inventory', error instanceof Error ? error.message : String(error))
    }
    if (
        runtime.characterId !== entry.characterIdentity.characterId
        || runtime.dungeonCharacterId !== entry.characterIdentity.dungeonCharacterId
    ) {
        return officialActionFailure(
            entry.id,
            'catalog-character-mismatch',
            `${runtime.characterId}/${runtime.dungeonCharacterId} != ${entry.characterIdentity.characterId}/${entry.characterIdentity.dungeonCharacterId}`,
        )
    }
    if (runtime.resourceName !== entry.characterIdentity.resourceName) {
        return officialActionFailure(
            entry.id,
            'resource-mismatch',
            `${runtime.resourceName} != ${entry.characterIdentity.resourceName}`,
        )
    }
    if (runtime.controllerPathId !== playback.controllerPathId) {
        return officialActionFailure(
            entry.id,
            'controller-path-mismatch',
            `${runtime.controllerPathId} != ${playback.controllerPathId}`,
        )
    }
    if ((runtime.externalWeaponTargetIds?.length ?? 0) !== 0) {
        return officialActionFailure(
            entry.id,
            'playback-unavailable',
            'native dungeon body playback must exclude external weapon targets',
        )
    }
    const targetId = requestedTargetId ?? runtime.bodyTargetId
    if (targetId !== runtime.bodyTargetId) {
        return officialActionFailure(entry.id, 'target-missing', `${targetId} is not the exact native body target`)
    }
    const exactClip = runtime.clips.some(clip => (
        clip.name === playback.clip.name && clip.pathId === playback.clip.pathId
    ))
    if (!exactClip) {
        return officialActionFailure(
            entry.id,
            'clip-missing',
            'exact native dungeon clip is not loaded',
            [`${playback.clip.name}#${playback.clip.pathId}`],
        )
    }
    return {
        ok: true,
        document: {
            schema: CHARACTER_TIMELINE_SCHEMA,
            duration: playback.clip.durationSeconds,
            loop: playback.kind === 'loop',
            tracks: [
                {
                    id: `${targetId}:${entry.id}:action`,
                    targetId,
                    kind: 'action',
                    interpolation: 'step',
                    keyframes: [{ time: 0, value: entry.id }],
                },
                {
                    id: `${targetId}:${entry.id}:clip`,
                    targetId,
                    kind: 'clip',
                    interpolation: 'step',
                    keyframes: [{ time: 0, value: { name: playback.clip.name, loop: playback.kind === 'loop' } }],
                },
            ],
            events: [{
                id: `${targetId}:${entry.id}:native`,
                time: 0,
                type: 'official-native-dungeon-action',
                targetId,
                payload: {
                    schema: OFFICIAL_CHARACTER_ACTION_CATALOG_SCHEMA,
                    actionId: entry.id,
                    characterId: entry.characterIdentity.characterId,
                    dungeonCharacterId: entry.characterIdentity.dungeonCharacterId,
                    logicalBundleKey: entry.characterIdentity.logicalBundleKey,
                    controllerPathId: playback.controllerPathId,
                    clipName: playback.clip.name,
                    clipPathId: playback.clip.pathId,
                    clipDurationSeconds: playback.clip.durationSeconds,
                    sampleRate: playback.clip.sampleRate,
                    bindingCount: playback.bindingCount,
                    attachmentPolicy: playback.attachmentPolicy,
                },
            }],
        },
    }
}

function createOfficialJumpDonorDocument(
    entry: Readonly<OfficialCharacterActionCatalogEntry>,
    playback: Readonly<OfficialJumpDonorPlayback>,
    options: Readonly<OfficialCharacterCatalogPlaybackOptions>,
): OfficialCatalogDocumentResult {
    const donor = playback.jumpDonor
    const runtime = options.runtime
    if (!runtime) return officialActionFailure(entry.id, 'playback-unavailable', 'jump donor runtime inventory is required')
    if (donor.grade === 'C' || donor.compatibility === 'incompatible') {
        return officialActionFailure(
            entry.id,
            'jump-donor-rejected',
            donor.rejectionReason ?? 'jump donor is explicitly rejected',
        )
    }
    try {
        assertNonEmptyString(donor.sourceActionId, 'jump donor sourceActionId')
        assertNonEmptyString(donor.sourceCharacterId, 'jump donor sourceCharacterId')
        assertNonEmptyString(donor.sourceRigFingerprint, 'jump donor sourceRigFingerprint')
        if (!Array.isArray(donor.compatibleCharacterIds) || donor.compatibleCharacterIds.length === 0) {
            throw new TypeError('jump donor compatibleCharacterIds must not be empty')
        }
        donor.compatibleCharacterIds.forEach((characterId, index) => {
            assertNonEmptyString(characterId, `jump donor compatibleCharacterIds[${index}]`)
        })
        if (!Array.isArray(donor.segments) || donor.segments.length !== 3) {
            throw new TypeError('jump donor must contain exactly takeoff, airborne and land segments')
        }
    } catch (error) {
        return officialActionFailure(entry.id, 'segment-invalid', error instanceof Error ? error.message : String(error))
    }
    if (runtime.characterId !== entry.characterIdentity.characterId) {
        return officialActionFailure(entry.id, 'catalog-character-mismatch', `${runtime.characterId} != ${entry.characterIdentity.characterId}`)
    }
    if (!donor.compatibleCharacterIds.includes(runtime.characterId)) {
        return officialActionFailure(entry.id, 'jump-donor-rejected', `${runtime.characterId} is not in the verified donor compatibility set`)
    }
    if (
        runtime.characterId === donor.sourceCharacterId
        ? donor.compatibility !== 'exact-rig' && donor.compatibility !== 'verified-retarget'
        : donor.compatibility !== 'verified-retarget'
    ) {
        return officialActionFailure(entry.id, 'jump-donor-rejected', 'jump donor compatibility does not authorize this target rig')
    }
    if ((runtime.externalWeaponTargetIds?.length ?? 0) !== 0) {
        return officialActionFailure(entry.id, 'jump-donor-rejected', 'jump donor playback must exclude external weapon targets')
    }
    const targetId = options.targetId ?? runtime.bodyTargetId
    if (targetId !== runtime.bodyTargetId) {
        return officialActionFailure(entry.id, 'target-missing', `${targetId} is not the exact jump body target`)
    }
    const inventory = new Set(runtime.clips.map(clip => `${clip.name}\u0000${clip.pathId}`))
    const expectedPhases: readonly OfficialJumpDonorPhaseKind[] = ['takeoff', 'airborne', 'land']
    const clipKeyframes: CharacterTimelineKeyframe[] = []
    const sourceTimeKeyframes: CharacterTimelineKeyframe[] = []
    const events: CharacterTimelineEvent[] = []
    let timelineTime = 0
    for (const [index, segment] of donor.segments.entries()) {
        const label = `jump donor segments[${index}]`
        if (segment.phase !== expectedPhases[index]) {
            return officialActionFailure(entry.id, 'segment-invalid', `${label}.phase must be ${expectedPhases[index]}`)
        }
        try {
            validateOfficialActionClip(segment.sourceClip, `${label}.sourceClip`)
            assertNonNegativeNumber(segment.sourceStartSeconds, `${label}.sourceStartSeconds`)
            assertFiniteNumber(segment.sourceEndSeconds, `${label}.sourceEndSeconds`)
        } catch (error) {
            return officialActionFailure(entry.id, 'segment-invalid', error instanceof Error ? error.message : String(error))
        }
        if (segment.sourceEndSeconds <= segment.sourceStartSeconds + EPSILON) {
            return officialActionFailure(entry.id, 'segment-invalid', `${label} must have a positive source window`)
        }
        const halfFrame = 0.5 / segment.sourceClip.sampleRate
        if (segment.sourceEndSeconds > segment.sourceClip.durationSeconds + halfFrame + EPSILON) {
            return officialActionFailure(entry.id, 'segment-invalid', `${label} extends after its exact source clip`)
        }
        if (!['full-body', 'lower-body', 'hips-legs'].includes(segment.bodyMask)) {
            return officialActionFailure(entry.id, 'segment-invalid', `${label}.bodyMask is invalid`)
        }
        if (segment.rootPolicy === 'source-all') {
            return officialActionFailure(
                entry.id,
                'jump-donor-rejected',
                `${label} would duplicate controlled character root displacement`,
            )
        }
        if (
            segment.rootPolicy !== 'controller-all'
            && segment.rootPolicy !== 'controller-horizontal-source-vertical'
        ) {
            return officialActionFailure(entry.id, 'segment-invalid', `${label}.rootPolicy is invalid`)
        }
        if (donor.grade === 'B' && segment.rootPolicy !== 'controller-all') {
            return officialActionFailure(entry.id, 'jump-donor-rejected', 'grade B pose donors cannot author root displacement')
        }
        if (!inventory.has(`${segment.sourceClip.name}\u0000${segment.sourceClip.pathId}`)) {
            return officialActionFailure(
                entry.id,
                'clip-missing',
                `exact ${segment.phase} source clip is not loaded`,
                [`${segment.sourceClip.name}#${segment.sourceClip.pathId}`],
            )
        }
        const segmentDuration = segment.sourceEndSeconds - segment.sourceStartSeconds
        clipKeyframes.push({
            time: timelineTime,
            value: { name: segment.sourceClip.name, loop: false },
        })
        sourceTimeKeyframes.push(
            { time: timelineTime, value: segment.sourceStartSeconds },
            { time: timelineTime + segmentDuration, value: segment.sourceEndSeconds },
        )
        events.push({
            id: `${targetId}:${entry.id}:${segment.phase}`,
            time: timelineTime,
            type: 'official-combat-jump-donor-phase',
            targetId,
            payload: {
                schema: OFFICIAL_CHARACTER_ACTION_CATALOG_SCHEMA,
                actionId: entry.id,
                sourceActionId: donor.sourceActionId,
                sourceCharacterId: donor.sourceCharacterId,
                sourceRigFingerprint: donor.sourceRigFingerprint,
                grade: donor.grade,
                compatibility: donor.compatibility,
                phase: segment.phase,
                clipName: segment.sourceClip.name,
                clipPathId: segment.sourceClip.pathId,
                sourceStartSeconds: segment.sourceStartSeconds,
                sourceEndSeconds: segment.sourceEndSeconds,
                bodyMask: segment.bodyMask,
                rootPolicy: segment.rootPolicy,
                attachmentPolicy: donor.attachmentPolicy,
            },
        })
        timelineTime += segmentDuration
    }
    events.push({
        id: `${targetId}:${entry.id}:complete`,
        time: timelineTime,
        type: 'official-combat-jump-donor-complete',
        targetId,
        payload: {
            schema: OFFICIAL_CHARACTER_ACTION_CATALOG_SCHEMA,
            actionId: entry.id,
            restoreOwner: 'locomotion-controller',
        },
    })
    return {
        ok: true,
        document: {
            schema: CHARACTER_TIMELINE_SCHEMA,
            duration: timelineTime,
            loop: false,
            tracks: [
                {
                    id: `${targetId}:${entry.id}:action`,
                    targetId,
                    kind: 'action',
                    interpolation: 'step',
                    keyframes: [{ time: 0, value: entry.id }],
                },
                {
                    id: `${targetId}:${entry.id}:clip`,
                    targetId,
                    kind: 'clip',
                    interpolation: 'step',
                    keyframes: clipKeyframes,
                },
                {
                    id: `${targetId}:${entry.id}:source-time`,
                    targetId,
                    kind: 'animationTime',
                    interpolation: 'linear',
                    keyframes: sourceTimeKeyframes,
                },
            ],
            events,
        },
    }
}

function createOfficialSynchronizedCatalogDocument(
    entry: Readonly<OfficialCharacterActionCatalogEntry>,
    playback: Readonly<OfficialTimelinePlayback>,
    options: Readonly<OfficialCharacterCatalogPlaybackOptions>,
): OfficialCatalogDocumentResult {
    if (playback.synchronizedAction.characterId !== entry.characterIdentity.characterId) {
        return officialActionFailure(
            entry.id,
            'catalog-character-mismatch',
            `${playback.synchronizedAction.characterId} != ${entry.characterIdentity.characterId}`,
        )
    }
    if (playback.synchronizedAction.actionId !== entry.id) {
        return officialActionFailure(entry.id, 'catalog-entry-missing', 'catalog id does not match synchronized action id')
    }
    const synchronized = createOfficialSynchronizedCharacterActionTimeline(
        playback.synchronizedAction,
        {
            availableTargetIds: options.availableTargetIds ?? [],
            holdSeconds: options.holdSeconds,
        },
    )
    if (!synchronized.ok) return synchronized
    const availableTypes = new Set(options.availableExtensionTypes ?? [])
    const availableTargets = new Set(options.availableTargetIds ?? [])
    const events = [...(synchronized.document.events ?? [])]
    const eventIds = new Set(events.map(event => event.id))
    for (const [index, extension] of (playback.extensionEvents ?? []).entries()) {
        const label = `official action extensionEvents[${index}]`
        try {
            assertNonEmptyString(extension.id, `${label}.id`)
            assertNonNegativeNumber(extension.timeSeconds, `${label}.timeSeconds`)
            if (!['camera', 'scene-root', 'cloth-control', 'combat-vfx-cue'].includes(extension.type)) {
                throw new TypeError(`${label}.type is invalid`)
            }
            if (typeof extension.required !== 'boolean') throw new TypeError(`${label}.required must be boolean`)
            if (extension.targetId !== undefined) assertNonEmptyString(extension.targetId, `${label}.targetId`)
            assertJsonFinite(extension.payload, `${label}.payload`)
        } catch (error) {
            return officialActionFailure(entry.id, 'invalid-profile', error instanceof Error ? error.message : String(error))
        }
        if (extension.timeSeconds > synchronized.document.duration! + EPSILON) {
            return officialActionFailure(entry.id, 'segment-invalid', `${label} occurs after the synchronized action`)
        }
        const consumerAvailable = availableTypes.has(extension.type)
        const targetAvailable = extension.targetId === undefined || availableTargets.has(extension.targetId)
        if (extension.required && (!consumerAvailable || !targetAvailable)) {
            return officialActionFailure(
                entry.id,
                'extension-consumer-missing',
                `required ${extension.type} extension ${extension.id} has no exact consumer/target`,
            )
        }
        if (!consumerAvailable || !targetAvailable) continue
        if (eventIds.has(extension.id)) {
            return officialActionFailure(entry.id, 'target-duplicate', `duplicate action extension event id ${extension.id}`)
        }
        eventIds.add(extension.id)
        events.push({
            id: extension.id,
            time: extension.timeSeconds,
            type: `official-combat-${extension.type}`,
            ...(extension.targetId === undefined ? {} : { targetId: extension.targetId }),
            payload: cloneJsonFinite(extension.payload, `${label}.payload`),
        })
    }
    return {
        ok: true,
        document: {
            ...synchronized.document,
            events,
        },
    }
}

function createOfficialCatalogDocument(
    entry: Readonly<OfficialCharacterActionCatalogEntry>,
    options: Readonly<OfficialCharacterCatalogPlaybackOptions>,
): OfficialCatalogDocumentResult {
    try {
        assertOfficialCatalogEntry(entry, 'official character action catalog entry')
    } catch (error) {
        return officialActionFailure(
            isRecord(entry) && typeof entry.id === 'string' ? entry.id : '<invalid-catalog-entry>',
            'catalog-entry-missing',
            error instanceof Error ? error.message : String(error),
        )
    }
    if (entry.availability.status !== 'source-available') {
        return officialActionFailure(
            entry.id,
            'playback-unavailable',
            entry.availability.reason ?? 'official action source is unavailable',
        )
    }
    if ('clip' in entry.playback) {
        return createOfficialNativeClipDocument(entry, options.runtime, options.targetId)
    }
    if ('jumpDonor' in entry.playback) {
        if (entry.playbackKind !== 'timeline') {
            return officialActionFailure(entry.id, 'playback-unavailable', 'jump donor must use timeline playback')
        }
        return createOfficialJumpDonorDocument(entry, entry.playback, options)
    }
    if ('synchronizedAction' in entry.playback) {
        if (entry.playbackKind !== 'timeline') {
            return officialActionFailure(entry.id, 'playback-unavailable', 'synchronized action must use timeline playback')
        }
        return createOfficialSynchronizedCatalogDocument(entry, entry.playback, options)
    }
    return officialActionFailure(entry.id, 'playback-unavailable', 'unsupported official catalog playback')
}

/**
 * Resolves and instantiates one catalog action with explicit playback controls.
 * No `_L` suffix, display label, character fallback or weapon-name inference is used.
 */
export function createOfficialCharacterCatalogPlayback(
    entry: Readonly<OfficialCharacterActionCatalogEntry>,
    options: Readonly<OfficialCharacterCatalogPlaybackOptions> = {},
): OfficialCharacterCatalogPlaybackResult {
    const resolved = createOfficialCatalogDocument(entry, options)
    if (!resolved.ok) return resolved
    let timeline: CharacterTimeline
    try {
        timeline = new CharacterTimeline(resolved.document, {
            bindings: options.bindings,
            trackAdapters: options.trackAdapters,
            eventListeners: options.eventListeners,
        })
    } catch (error) {
        return officialActionFailure(
            entry.id,
            'playback-unavailable',
            error instanceof Error ? error.message : String(error),
        )
    }
    return {
        ok: true,
        entry,
        document: timeline.toDocument(),
        timeline,
        state: () => ({
            actionId: entry.id,
            playing: timeline.playing,
            timeSeconds: timeline.time,
            durationSeconds: timeline.duration,
            loop: timeline.loop,
        }),
        play: () => timeline.play(),
        pause: () => timeline.pause(),
        seek: timeSeconds => timeline.seek(timeSeconds),
        step: deltaSeconds => timeline.step(deltaSeconds),
    }
}
