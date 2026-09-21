import type * as THREE from 'three'
import type { HomeMorphChannelBinding, HomeMorphChannelLeaseRequest, HomeMorphChannelLeaseResult } from '../../../magia-exedra-character-three/homeRuntime.ts'
import type { AnimationPoseChannelRequest, AnimationPoseChannelLease, AnimationPoseResult } from '../../../magia-exedra-character-three/animationPoseChannels.ts'
import {
    createVoicePoseActorGuard, registerVoicePoseParticipant, retainVoicePosePending, voicePoseObject,
    voicePoseOperationBlock, voicePoseRequestCurrent, type VoicePoseChannelRequest, type VoicePoseAvailability,
    type VoicePoseLowerLease, type VoicePoseMorphReturnPreparation,
} from './poseChannels.ts'

export const VOICE_SCENARIO_SCHEMA = 'magius.voice-scenario.v1' as const

export const SOURCE_READY_VOICE_SCENARIO_URL = new URL(
    '../../../artifacts/research/20260827-voice-scenario-source-ready/manifest.v1.json',
    import.meta.url,
).href

export type VoiceScenarioActionType = 'Talk' | 'OnlyMotion'
export type VoiceScenarioStatus = 'idle' | 'playing' | 'paused' | 'unavailable'
export type VoiceScenarioSubtitleLocale = 'zh-Hans' | 'zh-Hant' | 'ja-Jpan' | 'en-Latn'
export type VoiceScenarioSubtitleMode = 'off' | VoiceScenarioSubtitleLocale
export type VoiceScenarioSubtitleSourceRegion = 'CN' | 'TW' | 'JP'

export const VOICE_SUBTITLE_DEFAULT_MODE = 'zh-Hans' as const
export const VOICE_SUBTITLE_UI_MODES = ['off', 'zh-Hans', 'ja-Jpan', 'en-Latn'] as const

export interface VoiceScenarioPlaybackOptions {
    useMotion: boolean
    useExpression: boolean
}

const DEFAULT_PLAYBACK_OPTIONS: VoiceScenarioPlaybackOptions = {
    useMotion: true,
    useExpression: true,
}

export interface VoiceScenarioReactionSource {
    runtimeReady: boolean
    sourceRegion: VoiceScenarioSubtitleSourceRegion
    textLocale: VoiceScenarioSubtitleLocale
    sourceFile?: string
    failClosedReasons: string[]
    rows: VoiceScenarioRow[]
}

export interface VoiceScenarioSubtitleState {
    mode: string
    status: 'off' | 'idle' | 'ready' | 'unavailable'
    text: string | null
    sourceRegion: VoiceScenarioSubtitleSourceRegion | null
    requestedLocale: VoiceScenarioSubtitleLocale | null
    resolvedLocale: VoiceScenarioSubtitleLocale | null
    fallbackApplied: boolean
    rowNumber: number | null
    reason: string | null
}

export interface VoiceScenarioRow {
    rowNumber: number
    ActionType: VoiceScenarioActionType
    Comment?: string
    Motion?: string
    FaceType?: string
    Motion2d?: string
    FaceType2d?: string
    Variable: string
    MouthAnime?: string
    SoundFile?: string
    SoundName?: string
}

export interface VoiceScenarioEntry {
    voiceStableKey: string
    sourceStableKey: string
    scenarioStableKey: string
    characterResourceId: string
    order: number
    reactionSources: Readonly<Record<VoiceScenarioSubtitleLocale, VoiceScenarioReactionSource>>
    runtimeReady: boolean
    failClosedReasons: string[]
    /** Exact JP-source rows used by the 3D action/expression consumer. */
    rows: VoiceScenarioRow[]
}

export interface VoiceScenarioManifest {
    schema: typeof VOICE_SCENARIO_SCHEMA
    generatedAt?: string
    source?: Readonly<Record<string, unknown>>
    counts?: Readonly<Record<string, unknown>>
    entries: VoiceScenarioEntry[]
}

export interface VoiceScenarioVoiceIdentity {
    stableKey: string
    characterResourceId: string
    order: number
    audio: { sourceStableKey: string }
}

export interface VoiceScenarioAnimationClipLike {
    duration: number
}

export interface VoiceScenarioAnimationPlayOptions {
    transitionSeconds?: number
    localTimeSeconds?: number
}

export interface VoiceScenarioAnimationLike {
    acquirePoseChannels?(request: AnimationPoseChannelRequest): AnimationPoseResult<AnimationPoseChannelLease>
    current?: string
    readonly duration: number
    readonly clamped?: boolean
    paused: boolean
    time: number
    play(name: string, loop?: boolean, options?: VoiceScenarioAnimationPlayOptions): unknown
    clear(): unknown
    getAnimationClipsByName?(name: string): VoiceScenarioAnimationClipLike[]
}

export interface VoiceScenarioExpressionLike {
    readonly meshes?: readonly THREE.Mesh[]
    acquireMorphChannels?(request: HomeMorphChannelLeaseRequest): HomeMorphChannelLeaseResult
    readonly expressions: readonly string[]
    readonly current: string
    readonly automaticBlinkActive?: boolean
    readonly expressionAutoBlinkActive?: boolean
    readonly runtime?: {
        aliases: Readonly<Record<string, string>>
        expressions: Readonly<Record<string, unknown>>
        blink?: { weights?: Readonly<Record<string, number>> }
        mouth?: { constantWeights?: Readonly<Record<string, number>>; curveTarget?: string | null }
    }
    set(name: string, automaticBlink?: boolean): unknown
    resetToDefault(): unknown
}

export interface VoiceScenarioHomeAnimationRuntime {
    actions?: {
        wait01?: { loopFamily: string }
        wait02?: { loopFamily: string }
        unique01?: {
            startFamily: string
            loopFamily: string
            startExitNormalizedTime?: number
            enterTransitionSeconds?: number
        }
    }
}

export interface VoiceScenarioObjectLike {
    animations?: readonly { name: string }[]
    userData?: { homeAnimationRuntime?: VoiceScenarioHomeAnimationRuntime }
}

export interface VoiceScenarioCharacterLike {
    object?: VoiceScenarioObjectLike
    userData?: { homeAnimationRuntime?: VoiceScenarioHomeAnimationRuntime }
    animations?: readonly string[]
    animation?: VoiceScenarioAnimationLike
    expression?: VoiceScenarioExpressionLike
    character?: VoiceScenarioCharacterLike
}

export interface VoiceScenarioDiagnostics {
    status: VoiceScenarioStatus
    voiceStableKey: string | null
    scenarioStableKey: string | null
    rowNumber: number | null
    motion: string | null
    motionFamily: string | null
    motionApplied: boolean
    faceType: string | null
    faceChannel: string | null
    faceApplied: boolean
    subtitleModes: VoiceScenarioSubtitleMode[]
    reason: string | null
}

interface AnimationBaseline {
    current?: string
    time: number
    paused: boolean
}

interface ExpressionBaseline {
    current: string
    automaticBlinkActive: boolean
    expressionAutoBlinkActive: boolean
}

interface MotionSpec {
    primaryFamily: string
    loopFamily: string | null
    loops: boolean
    startExitNormalizedTime: number
}

const VOICE_STABLE_KEY = /^soundMstId=\d+\|cueSheetName=[^|]+\|cueName=[^|]+$/
const SOURCE_STABLE_KEY = /^cri-cue:cueSheetName=([^|]+)\|cueName=([^|]+)$/
const SCENARIO_STABLE_KEY = /^exedra-reaction:cueSheetName=([^|]+)\|cueName=([^|]+)$/
const CHARACTER_RESOURCE_ID = /^\d{6}$/

const IDLE_DIAGNOSTICS: VoiceScenarioDiagnostics = {
    status: 'idle',
    voiceStableKey: null,
    scenarioStableKey: null,
    rowNumber: null,
    motion: null,
    motionFamily: null,
    motionApplied: false,
    faceType: null,
    faceChannel: null,
    faceApplied: false,
    subtitleModes: ['off'],
    reason: null,
}

const SUBTITLE_LOCALES = ['zh-Hans', 'zh-Hant', 'ja-Jpan', 'en-Latn'] as const

function sourceRegionForLocale(
    locale: VoiceScenarioSubtitleLocale,
): VoiceScenarioSubtitleSourceRegion {
    if (locale === 'zh-Hans') return 'CN'
    if (locale === 'zh-Hant') return 'TW'
    return 'JP'
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function manifestError(message: string, detail?: unknown): never {
    const suffix = detail === undefined ? '' : `: ${JSON.stringify(detail)}`
    throw new Error(`Voice scenario manifest error: ${message}${suffix}`)
}

function optionalNonEmptyString(
    value: unknown,
    field: string,
    detail: unknown,
): string | undefined {
    if (value === undefined) return undefined
    if (typeof value !== 'string' || value.length === 0) {
        manifestError(`${field} must be a non-empty string when present`, detail)
    }
    return value
}

function parseOfficialScenarioNumber(
    value: unknown,
    field: 'Variable' | 'MouthAnime',
    detail: unknown,
): string {
    if (typeof value !== 'string' || value.length === 0) {
        manifestError(`${field} must preserve the non-empty official string field`, detail)
    }
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric < 0) {
        manifestError(`${field} is not a finite non-negative official value`, detail)
    }
    return value
}

function scenarioVariableSeconds(row: VoiceScenarioRow): number {
    return Number(row.Variable)
}

function parseScenarioRow(value: unknown, entryKey: string, index: number): VoiceScenarioRow {
    if (!isRecord(value)) manifestError('scenario row must be an object', { entryKey, index })
    const detail = { entryKey, index }
    const rowNumber = value.rowNumber
    const ActionType = value.ActionType
    if (!Number.isInteger(rowNumber) || (rowNumber as number) < 1) {
        manifestError('scenario rowNumber must be a positive integer', { ...detail, rowNumber })
    }
    if (ActionType !== 'Talk' && ActionType !== 'OnlyMotion') {
        manifestError('scenario ActionType is unsupported', { ...detail, ActionType })
    }
    const Variable = parseOfficialScenarioNumber(value.Variable, 'Variable', detail)
    const MouthAnime = value.MouthAnime === undefined
        ? undefined
        : parseOfficialScenarioNumber(value.MouthAnime, 'MouthAnime', detail)
    if (ActionType === 'Talk' && MouthAnime === undefined) {
        manifestError('Talk row is missing official MouthAnime', detail)
    }
    const Comment = optionalNonEmptyString(value.Comment, 'Comment', detail)
    const Motion = optionalNonEmptyString(value.Motion, 'Motion', detail)
    const FaceType = optionalNonEmptyString(value.FaceType, 'FaceType', detail)
    const Motion2d = optionalNonEmptyString(value.Motion2d, 'Motion2d', detail)
    const FaceType2d = optionalNonEmptyString(value.FaceType2d, 'FaceType2d', detail)
    const SoundFile = optionalNonEmptyString(value.SoundFile, 'SoundFile', detail)
    const SoundName = optionalNonEmptyString(value.SoundName, 'SoundName', detail)
    if (ActionType === 'OnlyMotion' && Comment !== undefined) {
        manifestError('OnlyMotion row must not carry Comment text', detail)
    }
    if (ActionType === 'OnlyMotion' && !Motion && !FaceType) {
        manifestError('OnlyMotion row has no 3D action channel', detail)
    }
    return {
        rowNumber: rowNumber as number,
        ActionType,
        Variable,
        ...(Comment === undefined ? {} : { Comment }),
        ...(Motion === undefined ? {} : { Motion }),
        ...(FaceType === undefined ? {} : { FaceType }),
        ...(Motion2d === undefined ? {} : { Motion2d }),
        ...(FaceType2d === undefined ? {} : { FaceType2d }),
        ...(MouthAnime === undefined ? {} : { MouthAnime }),
        ...(SoundFile === undefined ? {} : { SoundFile }),
        ...(SoundName === undefined ? {} : { SoundName }),
    }
}

function parseReactionSource(
    value: unknown,
    locale: VoiceScenarioSubtitleLocale,
    entryKey: string,
): VoiceScenarioReactionSource {
    if (!isRecord(value)) manifestError('Reaction source must be an object', { entryKey, locale })
    const runtimeReady = value.runtimeReady
    const expectedSourceRegion = sourceRegionForLocale(locale)
    if (typeof runtimeReady !== 'boolean') {
        manifestError('Reaction runtimeReady must be boolean', { entryKey, locale })
    }
    if (value.sourceRegion !== expectedSourceRegion || value.textLocale !== locale) {
        manifestError('Reaction sourceRegion/textLocale authority differs', { entryKey, locale })
    }
    const sourceFile = optionalNonEmptyString(value.sourceFile, 'Reaction sourceFile', { entryKey, locale })
    if (sourceFile !== undefined && !sourceFile.startsWith('file:///')) {
        manifestError('Reaction sourceFile must be an absolute file URI', { entryKey, locale })
    }
    if (!Array.isArray(value.failClosedReasons) || value.failClosedReasons.some(reason => (
        typeof reason !== 'string' || reason.length === 0
    ))) {
        manifestError('invalid Reaction failClosedReasons', { entryKey, locale })
    }
    const failClosedReasons = [...value.failClosedReasons] as string[]
    if (!Array.isArray(value.rows)) manifestError('Reaction rows must be an array', { entryKey, locale })
    const rows = value.rows.map((row, rowIndex) => (
        parseScenarioRow(row, `${entryKey}:${locale}`, rowIndex)
    ))
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
        if (scenarioVariableSeconds(rows[rowIndex]) < scenarioVariableSeconds(rows[rowIndex - 1])) {
            manifestError('Reaction Variable is not monotonic', { entryKey, locale, rowIndex })
        }
    }
    if (runtimeReady && (
        !sourceFile
        || failClosedReasons.length !== 0
        || rows.length === 0
        || rows.some(row => row.ActionType === 'Talk' && !row.Comment)
    )) {
        manifestError('runtime-ready Reaction source is incomplete', { entryKey, locale })
    }
    if (!runtimeReady && (failClosedReasons.length === 0 || rows.length !== 0 || sourceFile)) {
        manifestError('unavailable Reaction source is not typed closed', { entryKey, locale })
    }
    return {
        runtimeReady,
        sourceRegion: expectedSourceRegion,
        textLocale: locale,
        ...(sourceFile === undefined ? {} : { sourceFile }),
        failClosedReasons,
        rows,
    }
}

function assertReactionIdentity(
    source: VoiceScenarioReactionSource,
    cueSheetName: string,
    cueName: string,
    entryKey: string,
): void {
    if (!source.runtimeReady) return
    const soundFiles = new Set(source.rows.flatMap(row => row.SoundFile ? [row.SoundFile] : []))
    const soundNames = new Set(source.rows.flatMap(row => row.SoundName ? [row.SoundName] : []))
    if (
        soundFiles.size !== 1
        || !soundFiles.has(cueSheetName)
        || soundNames.size !== 1
        || !soundNames.has(cueName)
    ) {
        manifestError('Reaction SoundFile/SoundName identity differs', entryKey)
    }
}

function assertRowSegments(
    reference: VoiceScenarioReactionSource,
    localized: VoiceScenarioReactionSource,
    entryKey: string,
): void {
    if (!localized.runtimeReady) return
    const referenceSegments = reference.rows.map(row => `${row.rowNumber}:${row.ActionType}`)
    const localizedSegments = localized.rows.map(row => `${row.rowNumber}:${row.ActionType}`)
    if (
        referenceSegments.length !== localizedSegments.length
        || referenceSegments.some((segment, index) => segment !== localizedSegments[index])
    ) {
        manifestError('Reaction row segments differ across locale sources', entryKey)
    }
}

function parseScenarioEntry(value: unknown, index: number): VoiceScenarioEntry {
    if (!isRecord(value)) manifestError('scenario entry must be an object', index)
    const voiceStableKey = value.voiceStableKey
    const sourceStableKey = value.sourceStableKey
    const scenarioStableKey = value.scenarioStableKey
    const characterResourceId = value.characterResourceId
    const order = value.order
    const runtimeReady = value.runtimeReady
    const failClosedReasons = value.failClosedReasons
    if (typeof voiceStableKey !== 'string' || !VOICE_STABLE_KEY.test(voiceStableKey)) {
        manifestError('invalid voiceStableKey', { index, voiceStableKey })
    }
    const sourceMatch = typeof sourceStableKey === 'string'
        ? SOURCE_STABLE_KEY.exec(sourceStableKey)
        : null
    const scenarioMatch = typeof scenarioStableKey === 'string'
        ? SCENARIO_STABLE_KEY.exec(scenarioStableKey)
        : null
    if (!sourceMatch || !scenarioMatch) {
        manifestError('invalid source/scenario stable key', { index, sourceStableKey, scenarioStableKey })
    }
    if (sourceMatch[1] !== scenarioMatch[1] || sourceMatch[2] !== scenarioMatch[2]) {
        manifestError('source/scenario stable key fields differ', { index, sourceStableKey, scenarioStableKey })
    }
    if (typeof characterResourceId !== 'string' || !CHARACTER_RESOURCE_ID.test(characterResourceId)) {
        manifestError('invalid characterResourceId', { index, characterResourceId })
    }
    if (!Number.isInteger(order) || (order as number) < 1) {
        manifestError('invalid character order', { index, order })
    }
    if (typeof runtimeReady !== 'boolean') {
        manifestError('runtimeReady must be boolean', { index, runtimeReady })
    }
    if (!Array.isArray(failClosedReasons) || failClosedReasons.some(reason => (
        typeof reason !== 'string' || reason.length === 0
    ))) {
        manifestError('invalid failClosedReasons', { index, failClosedReasons })
    }
    if (!isRecord(value.reactionSources)) {
        manifestError('reactionSources must be an object', { index, voiceStableKey })
    }
    const rawReactionSources = value.reactionSources as Record<string, unknown>
    const reactionSources = Object.fromEntries(SUBTITLE_LOCALES.map(locale => [
        locale,
        parseReactionSource(rawReactionSources[locale], locale, voiceStableKey),
    ])) as unknown as Record<VoiceScenarioSubtitleLocale, VoiceScenarioReactionSource>
    for (const source of Object.values(reactionSources)) {
        assertReactionIdentity(source, sourceMatch[1], sourceMatch[2], voiceStableKey)
    }
    const jp = reactionSources['ja-Jpan']
    assertRowSegments(jp, reactionSources['en-Latn'], `${voiceStableKey}:en-Latn`)
    assertRowSegments(jp, reactionSources['zh-Hant'], `${voiceStableKey}:zh-Hant`)
    assertRowSegments(jp, reactionSources['zh-Hans'], `${voiceStableKey}:zh-Hans`)
    const rows = jp.rows
    if (runtimeReady && (rows.length === 0 || failClosedReasons.length !== 0)) {
        manifestError('runtime-ready scenario must have rows and no failure reasons', voiceStableKey)
    }
    if (!runtimeReady && (rows.length !== 0 || failClosedReasons.length === 0)) {
        manifestError('unavailable scenario must have no rows and an exact reason', voiceStableKey)
    }
    if (runtimeReady !== jp.runtimeReady) {
        manifestError('scenario runtimeReady must equal exact ja-Jpan Reaction readiness', voiceStableKey)
    }
    return {
        voiceStableKey,
        sourceStableKey: sourceStableKey as string,
        scenarioStableKey: scenarioStableKey as string,
        characterResourceId,
        order: order as number,
        reactionSources,
        runtimeReady,
        failClosedReasons: [...failClosedReasons] as string[],
        rows,
    }
}

export function parseVoiceScenarioManifest(value: unknown): VoiceScenarioManifest {
    if (!isRecord(value) || value.schema !== VOICE_SCENARIO_SCHEMA || !Array.isArray(value.entries)) {
        manifestError(`schema must be ${VOICE_SCENARIO_SCHEMA}`)
    }
    const entries = value.entries.map(parseScenarioEntry)
    const stableKeys = new Set<string>()
    const characterOrders = new Set<string>()
    for (const entry of entries) {
        if (stableKeys.has(entry.voiceStableKey)) {
            manifestError('duplicate voiceStableKey', entry.voiceStableKey)
        }
        stableKeys.add(entry.voiceStableKey)
        const characterOrder = `${entry.characterResourceId}:${entry.order}`
        if (characterOrders.has(characterOrder)) {
            manifestError('duplicate character order', characterOrder)
        }
        characterOrders.add(characterOrder)
    }
    return {
        schema: VOICE_SCENARIO_SCHEMA,
        ...(typeof value.generatedAt === 'string' ? { generatedAt: value.generatedAt } : {}),
        ...(isRecord(value.source) ? { source: value.source } : {}),
        ...(isRecord(value.counts) ? { counts: value.counts } : {}),
        entries,
    }
}

export async function fetchVoiceScenarioManifest(
    url = SOURCE_READY_VOICE_SCENARIO_URL,
    signal?: AbortSignal,
): Promise<VoiceScenarioManifest> {
    const response = await fetch(url, { signal })
    if (!response.ok) {
        throw new Error(`Voice scenario manifest request failed: HTTP ${response.status}`)
    }
    return parseVoiceScenarioManifest(await response.json() as unknown)
}

export function isVoiceScenarioRuntimeReady(entry: VoiceScenarioEntry | undefined): boolean {
    return Boolean(entry?.runtimeReady && entry.rows.length > 0)
}

export class VoiceScenarioCatalog {
    readonly manifest: VoiceScenarioManifest
    private readonly byVoiceStableKey: ReadonlyMap<string, VoiceScenarioEntry>

    constructor(value: VoiceScenarioManifest | unknown) {
        this.manifest = parseVoiceScenarioManifest(value)
        this.byVoiceStableKey = new Map(
            this.manifest.entries.map(entry => [entry.voiceStableKey, entry]),
        )
    }

    get(voiceStableKey: string): VoiceScenarioEntry | undefined {
        return this.byVoiceStableKey.get(voiceStableKey)
    }

    getForVoice(voice: VoiceScenarioVoiceIdentity): VoiceScenarioEntry | undefined {
        const entry = this.get(voice.stableKey)
        if (
            !entry
            || entry.sourceStableKey !== voice.audio.sourceStableKey
            || entry.characterResourceId !== voice.characterResourceId
            || entry.order !== voice.order
        ) return undefined
        return entry
    }
}

function resolveTarget(value: unknown): VoiceScenarioCharacterLike | null {
    if (!isRecord(value)) return null
    if (isRecord(value.character)) return resolveTarget(value.character)
    if (isRecord(value.animation) || isRecord(value.expression)) {
        return value as unknown as VoiceScenarioCharacterLike
    }
    return null
}

function runtimeFor(target: VoiceScenarioCharacterLike): VoiceScenarioHomeAnimationRuntime | undefined {
    return target.userData?.homeAnimationRuntime ?? target.object?.userData?.homeAnimationRuntime
}

function finiteTime(value: number): number {
    return Number.isFinite(value) ? Math.max(0, value) : 0
}

function clipDuration(animation: VoiceScenarioAnimationLike, family: string): number {
    const clips = animation.getAnimationClipsByName?.(family) ?? []
    return clips.reduce((maximum, clip) => {
        const duration = clip.duration
        return typeof duration === 'number' && Number.isFinite(duration) && duration > maximum
            ? duration
            : maximum
    }, 0)
}

function targetHasAnimationFamily(target: VoiceScenarioCharacterLike, family: string): boolean {
    if (target.animations?.includes(family)) return true
    const clips = target.animation?.getAnimationClipsByName?.(family)
    if (Array.isArray(clips) && clips.length > 0) return true
    return target.object?.animations?.some(clip => clip.name === family) ?? false
}

/**
 * HomeCharacterMotionView.PlayMotion drives these Animator triggers in Exedra.
 * The official HomeCharacterAnimatorController uses fixed-duration AnyState
 * transitions and permits transitions back to the currently active state.
 */
const OFFICIAL_HOME_MOTION_TRANSITION_SECONDS: Readonly<Record<string, number>> = {
    HomeWait01: 0.4,
    HomeWait02: 0.4,
    HomeUnique01: 0.2,
}

function scenarioTransitionSeconds(motion: string | undefined): number {
    return motion ? OFFICIAL_HOME_MOTION_TRANSITION_SECONDS[motion] ?? 0 : 0
}

function latestRowIndex(
    rows: readonly VoiceScenarioRow[],
    positionSeconds: number,
    field: 'Motion' | 'FaceType',
): number {
    let latest = -1
    for (let index = 0; index < rows.length; index++) {
        const row = rows[index]
        if (scenarioVariableSeconds(row) > positionSeconds) break
        if (row[field]) latest = index
    }
    return latest
}

export function resolveVoiceScenarioExpressionChannel(
    expression: VoiceScenarioExpressionLike,
    faceType: string,
): string | null {
    if (expression.expressions.includes(faceType)) return faceType
    const runtime = expression.runtime
    if (!runtime) return null
    if (Object.prototype.hasOwnProperty.call(runtime.expressions, faceType)) return faceType
    const prefix = /^HomeFace\d+_(.+)$/
    const candidates = new Set(
        Object.entries(runtime.aliases)
            .filter(([alias, canonical]) => (
                prefix.exec(alias)?.[1] === faceType
                && Object.prototype.hasOwnProperty.call(runtime.expressions, canonical)
            ))
            .map(([, canonical]) => canonical),
    )
    return candidates.size === 1 ? [...candidates][0] : null
}

/** Home expressions write the union of all face/blink/mouth fields every frame.
 * A face name or the currently selected expression is not its side-effect set. */
function expressionPoseCoverage(expression: VoiceScenarioExpressionLike | undefined, request: VoicePoseChannelRequest): { bindings: HomeMorphChannelBinding[]; reason: string | null } {
    const none = { bindings: [], reason: null }
    if (!expression || (!request.bones.length && !request.morphs.length)) return none
    const unknown = { bindings: [], reason: 'voice-pose-expression-side-effects-unavailable' }
    const runtime = expression.runtime
    if (!Array.isArray(expression.meshes) || !runtime?.expressions || !runtime.blink?.weights || !runtime.mouth?.constantWeights) return unknown
    const names = new Set<string>([...Object.keys(runtime.blink.weights), ...Object.keys(runtime.mouth.constantWeights)])
    if (runtime.mouth.curveTarget) names.add(runtime.mouth.curveTarget)
    for (const value of Object.values(runtime.expressions)) {
        const weights = value && typeof value === 'object' ? (value as { weights?: unknown }).weights : undefined
        if (!weights || typeof weights !== 'object' || Array.isArray(weights)) return unknown
        for (const name of Object.keys(weights)) names.add(name)
    }
    const bindings: HomeMorphChannelBinding[] = []
    for (const mesh of expression.meshes) {
        if (!voicePoseObject(mesh) || !mesh.morphTargetDictionary || !Array.isArray(mesh.morphTargetInfluences)) return unknown
        for (const row of request.morphs) {
            if (row.mesh === mesh && [...names].some(name => mesh.morphTargetDictionary![name] === row.index)) {
                bindings.push({ mesh, index: row.index, influences: mesh.morphTargetInfluences })
            }
        }
    }
    if (!bindings.length) return none
    if (!expression.acquireMorphChannels) return { bindings, reason: 'voice-pose-home-expression-channel-yield-unavailable' }
    if (!Number.isFinite(request.releaseTransitionSeconds) || (request.releaseTransitionSeconds ?? 0) <= 0) {
        return { bindings, reason: 'voice-pose-home-transition-unavailable' }
    }
    return { bindings, reason: null }
}

// Multiple official players may refer to the very same Home controller. One
// physical writer lease is shared, and retained even if a player is detached.
const homeMorphLeases = new WeakMap<VoiceScenarioExpressionLike, WeakMap<VoicePoseChannelRequest, {
    users: number
    native: Extract<HomeMorphChannelLeaseResult, { status: 'ready' }>
}>>()

function acquireExpressionPose(expression: VoiceScenarioExpressionLike | undefined, request: VoicePoseChannelRequest): VoicePoseAvailability<VoicePoseLowerLease> {
    const coverage = expressionPoseCoverage(expression, request)
    if (coverage.reason) return { status: 'unavailable' as const, reason: coverage.reason }
    if (!coverage.bindings.length || !expression) return { status: 'ready', value: {
        release() {},
        prepareMorphReturn: () => ({ status: 'ready', value: {
            commit: () => ({ status: 'ready', value: undefined }), rollback() {},
        } }),
    } }
    let leases = homeMorphLeases.get(expression)
    if (!leases) { leases = new WeakMap(); homeMorphLeases.set(expression, leases) }
    let shared = leases.get(request)
    if (!shared) {
        const native = expression.acquireMorphChannels!({
            bindings: coverage.bindings,
            releaseTransitionSeconds: request.releaseTransitionSeconds!,
            isCurrent: () => voicePoseRequestCurrent(request),
        })
        if (native.status !== 'ready') return { status: 'unavailable' as const, reason: `voice-pose-home-${native.reason}` }
        shared = { users: 0, native }
        leases.set(request, shared)
    }
    shared.users++
    let released = false
    const retained = shared
    return { status: 'ready', value: {
        prepareMorphReturn() {
            if (released) return { status: 'unavailable', reason: 'voice-pose-home-lease-released' }
            const native = retained.native
            // A legacy release-only controller remains usable for ordinary
            // leases, but is never substituted for evaluator-only handoff.
            if (typeof native.releaseToEvaluator !== 'function' || typeof native.prepareReleaseToEvaluator !== 'function') {
                return { status: 'unavailable', reason: 'voice-pose-home-evaluator-return-unavailable' }
            }
            const prepared = native.prepareReleaseToEvaluator()
            if (prepared.status !== 'ready') return { status: 'unavailable', reason: `voice-pose-home-${prepared.reason}` }
            return { status: 'ready', value: {
                commit() {
                    if (released) return { status: 'unavailable', reason: 'voice-pose-home-lease-released' }
                    const result = prepared.commit()
                    return result.status === 'ready' ? { status: 'ready', value: undefined }
                        : { status: 'unavailable', reason: `voice-pose-home-${result.reason}` }
                },
                rollback: () => prepared.rollback(),
            } }
        },
        release() {
            if (released) return
            released = true
            if (--retained.users === 0) { leases!.delete(request); retained.native.release() }
        },
    } }
}

const animationPoseLeases = new WeakMap<VoiceScenarioAnimationLike, WeakMap<VoicePoseChannelRequest, {
    users: number; native: AnimationPoseChannelLease
}>>()

function animationPoseCoverage(animation: VoiceScenarioAnimationLike | undefined, request: VoicePoseChannelRequest): string | null {
    return animation && !request.action && (request.bones.length || request.morphs.length) && !animation.acquirePoseChannels
        ? 'voice-pose-animation-channel-yield-unavailable' : null
}

function animationPoseConflict(animation: VoiceScenarioAnimationLike | undefined, request: VoicePoseChannelRequest): string | null {
    if (!animation || request.action || (!request.bones.length && !request.morphs.length)) return null
    return animationPoseCoverage(animation, request)
        ?? (!animationPoseLeases.get(animation)?.has(request) ? 'voice-pose-animation-lease-not-acquired' : null)
}

function acquireScenarioPose(target: VoiceScenarioCharacterLike | null, request: VoicePoseChannelRequest): VoicePoseAvailability<VoicePoseLowerLease> {
    const animation = target?.animation
    let releaseAnimation = () => {}
    let animationLease: AnimationPoseChannelLease | undefined
    if (animation && !request.action && (request.bones.length || request.morphs.length)) {
        if (!animation.acquirePoseChannels) return { status: 'unavailable', reason: 'voice-pose-animation-channel-yield-unavailable' }
        let leases = animationPoseLeases.get(animation)
        if (!leases) { leases = new WeakMap(); animationPoseLeases.set(animation, leases) }
        let retained = leases.get(request)
        if (!retained) {
            const result = animation.acquirePoseChannels({root: request.actor.object, generation: request.actor.generation,
                bones: request.bones, morphs: request.morphs, isCurrent: () => voicePoseRequestCurrent(request)})
            if (result.status !== 'ready') return result
            retained = {users: 0, native: result.value}; leases.set(request, retained)
        }
        retained.users++; animationLease = retained.native
        const shared = retained
        releaseAnimation = () => { if (--shared.users === 0) { leases!.delete(request); shared.native.release() } }
    }
    let expression: VoicePoseAvailability<VoicePoseLowerLease>
    try { expression = acquireExpressionPose(target?.expression, request) }
    catch (error) { releaseAnimation(); throw error }
    if (expression.status !== 'ready') { releaseAnimation(); return expression }
    const handles: VoicePoseLowerLease[] = [...(animationLease ? [animationLease] : []), expression.value]
    let released = false
    return {status: 'ready', value: {
        release() { if (!released) { released = true; expression.value.release(); releaseAnimation() } },
        prepareMorphReturn() {
            if (released) return {status: 'unavailable', reason: 'voice-pose-scenario-lease-released'}
            const prepared: VoicePoseMorphReturnPreparation[] = []
            for (const handle of handles) {
                const result = handle.prepareMorphReturn?.()
                if (!result || result.status !== 'ready') return result ?? {status: 'unavailable', reason: 'voice-pose-scenario-return-unavailable'}
                prepared.push(result.value)
            }
            return {status: 'ready', value: {
                commit() {
                    if (released || !voicePoseRequestCurrent(request)) return {status: 'unavailable', reason: 'voice-pose-stale-scenario-return'}
                    const attempted = []
                    for (const handle of prepared) {
                        attempted.push(handle)
                        const result = handle.commit()
                        if (result.status !== 'ready') { for (const prior of attempted.reverse()) prior.rollback(); return result }
                    }
                    return {status: 'ready', value: undefined}
                },
                rollback() { for (const handle of [...prepared].reverse()) handle.rollback() },
            }}
        },
    }}
}

function expressionPoseConflict(expression: VoiceScenarioExpressionLike | undefined, request: VoicePoseChannelRequest): string | null {
    const coverage = expressionPoseCoverage(expression, request)
    return coverage.reason
        ?? (coverage.bindings.length && expression && !homeMorphLeases.get(expression)?.has(request)
            ? 'voice-pose-home-lease-not-acquired' : null)
}

export class VoiceScenarioRunner {
    private target: VoiceScenarioCharacterLike | null = null
    private unregisterPose: (() => void) | null = null
    private asyncGeneration = 0
    private poseCurrent: (() => boolean) | null = null

    private poseRoot(): THREE.Object3D | null {
        return voicePoseObject(this.target?.object) ?? voicePoseObject(this.target)
    }

    private motionPoseBlock(): string | null {
        if (this.poseCurrent && !this.poseCurrent()) return 'voice-pose-stale-producer'
        const root = this.poseRoot()
        return root ? voicePoseOperationBlock(root, request => (
            request.action ? 'voice-pose-action-leased'
                : animationPoseConflict(this.target?.animation, request)
        )) : null
    }

    private expressionPoseBlock(): string | null {
        if (this.poseCurrent && !this.poseCurrent()) return 'voice-pose-stale-producer'
        const root = this.poseRoot()
        return root ? voicePoseOperationBlock(root, request => expressionPoseConflict(this.target?.expression, request)) : null
    }

    private retainPending(result: unknown): void {
        const target = this.target
        const generation = this.asyncGeneration
        retainVoicePosePending(this.poseRoot(), result, failed => {
            if (failed && this.target === target && this.asyncGeneration === generation) {
                this.diagnosticsValue = { ...this.diagnosticsValue, reason: 'voice-pose-asynchronous-producer-failed' }
            }
        })
    }
    private entry: VoiceScenarioEntry | null = null
    private animationBaseline: AnimationBaseline | null = null
    private expressionBaseline: ExpressionBaseline | null = null
    private animationOwned = false
    private expressionOwned = false
    private readonly ownedAnimationFamilies = new Set<string>()
    private readonly ownedExpressions = new Set<string>()
    private motionRowIndex = -1
    private faceRowIndex = -1
    private handoffPending = false
    private playbackOptions: VoiceScenarioPlaybackOptions = { ...DEFAULT_PLAYBACK_OPTIONS }
    private diagnosticsValue: VoiceScenarioDiagnostics = { ...IDLE_DIAGNOSTICS }

    get diagnostics(): VoiceScenarioDiagnostics {
        return {
            ...this.diagnosticsValue,
            subtitleModes: [...this.diagnosticsValue.subtitleModes],
        }
    }

    subtitleState(mode: string, positionSeconds: number): VoiceScenarioSubtitleState {
        if (mode === 'off') {
            return {
                mode: 'off',
                status: 'off',
                text: null,
                sourceRegion: null,
                requestedLocale: null,
                resolvedLocale: null,
                fallbackApplied: false,
                rowNumber: null,
                reason: null,
            }
        }
        if (!SUBTITLE_LOCALES.includes(mode as VoiceScenarioSubtitleLocale)) {
            return {
                mode,
                status: 'unavailable',
                text: null,
                sourceRegion: null,
                requestedLocale: null,
                resolvedLocale: null,
                fallbackApplied: false,
                rowNumber: null,
                reason: `unsupported subtitle mode: ${mode}`,
            }
        }
        const requestedLocale = mode as VoiceScenarioSubtitleLocale
        const entry = this.entry
        if (!entry) {
            const unavailable = this.diagnosticsValue.status === 'unavailable'
            return {
                mode,
                status: unavailable ? 'unavailable' : 'idle',
                text: null,
                sourceRegion: sourceRegionForLocale(requestedLocale),
                requestedLocale,
                resolvedLocale: null,
                fallbackApplied: false,
                rowNumber: null,
                reason: unavailable ? this.diagnosticsValue.reason : null,
            }
        }
        const exact = entry.reactionSources[requestedLocale]
        const fallbackApplied = requestedLocale === 'zh-Hant' && !exact.runtimeReady
        const resolvedLocale: VoiceScenarioSubtitleLocale = fallbackApplied
            ? 'ja-Jpan'
            : requestedLocale
        const source = entry.reactionSources[resolvedLocale]
        if (!source.runtimeReady) {
            return {
                mode,
                status: 'unavailable',
                text: null,
                sourceRegion: source.sourceRegion,
                requestedLocale,
                resolvedLocale,
                fallbackApplied,
                rowNumber: null,
                reason: [
                    ...exact.failClosedReasons,
                    ...(fallbackApplied ? source.failClosedReasons : []),
                ].join('; '),
            }
        }
        const position = finiteTime(positionSeconds)
        let active: VoiceScenarioRow | undefined
        for (const row of source.rows) {
            if (scenarioVariableSeconds(row) > position) break
            if (row.ActionType === 'Talk') active = row
        }
        return {
            mode,
            status: 'ready',
            text: active?.Comment ?? null,
            sourceRegion: source.sourceRegion,
            requestedLocale,
            resolvedLocale,
            fallbackApplied,
            rowNumber: active?.rowNumber ?? null,
            reason: null,
        }
    }

    subtitle(mode: string, positionSeconds: number): string | null {
        return this.subtitleState(mode, positionSeconds).text
    }

    setTarget(value: unknown): void {
        const target = resolveTarget(value)
        if (target === this.target) return
        this.stop()
        this.unregisterPose?.()
        this.unregisterPose = null
        this.target = target
        const root = this.poseRoot()
        this.poseCurrent = root ? createVoicePoseActorGuard(root) : null
        if (root) {
            const invalidate = (request: VoicePoseChannelRequest) => {
                if (this.target !== target) return
                if (request.action) {
                    this.clearAnimationOwnership()
                    this.motionRowIndex = -1
                }
                if (expressionPoseConflict(target?.expression, request)) {
                    this.clearExpressionOwnership()
                    this.faceRowIndex = -1
                }
            }
            this.unregisterPose = registerVoicePoseParticipant(root, {
                check: request => {
                    return animationPoseCoverage(target?.animation, request)
                        ?? expressionPoseCoverage(target?.expression, request).reason
                },
                acquire: request => acquireScenarioPose(target, request),
                acquired: invalidate,
                released: invalidate,
            })
        }
    }

    /**
     * Keep the currently triggered official Animator state alive until the next
     * Reaction entry supplies its trigger. Explicit stop/target changes still
     * restore the pre-Reaction baseline.
     */
    prepareHandoff(): boolean {
        const animation = this.target?.animation
        if (
            this.animationOwned
            && (
                !animation
                || (
                    animation.current
                    && !this.ownedAnimationFamilies.has(animation.current)
                )
            )
        ) {
            this.clearAnimationOwnership()
        }
        const expression = this.target?.expression
        if (
            this.expressionOwned
            && (!expression || !this.ownedExpressions.has(expression.current))
        ) {
            this.clearExpressionOwnership()
        }
        if (!this.animationOwned && !this.expressionOwned) {
            this.stop()
            return false
        }
        this.entry = null
        this.motionRowIndex = -1
        this.faceRowIndex = -1
        this.handoffPending = true
        this.diagnosticsValue = { ...IDLE_DIAGNOSTICS }
        return true
    }

    begin(
        entry: VoiceScenarioEntry | undefined,
        positionSeconds: number,
        options: VoiceScenarioPlaybackOptions = DEFAULT_PLAYBACK_OPTIONS,
    ): void {
        const handoff = this.handoffPending
        this.handoffPending = false
        if (!handoff) {
            this.stop()
        } else {
            this.entry = null
            this.motionRowIndex = -1
            this.faceRowIndex = -1
            this.diagnosticsValue = { ...IDLE_DIAGNOSTICS }
        }
        this.playbackOptions = {
            useMotion: options.useMotion,
            useExpression: options.useExpression,
        }
        if (!entry) {
            if (handoff) this.stop()
            this.diagnosticsValue = {
                ...IDLE_DIAGNOSTICS,
                status: 'unavailable',
                reason: 'exact official scenario entry is absent',
            }
            return
        }
        if (!isVoiceScenarioRuntimeReady(entry)) {
            if (handoff) this.stop()
            this.diagnosticsValue = {
                ...IDLE_DIAGNOSTICS,
                status: 'unavailable',
                voiceStableKey: entry.voiceStableKey,
                scenarioStableKey: entry.scenarioStableKey,
                reason: entry.failClosedReasons.join('; '),
            }
            return
        }
        const animationEnabled = Boolean(
            this.target?.animation && this.playbackOptions.useMotion,
        )
        const expressionEnabled = Boolean(
            this.target?.expression && this.playbackOptions.useExpression,
        )
        if (handoff && !animationEnabled) {
            this.restoreAnimation()
            this.clearAnimationOwnership()
        }
        if (handoff && !expressionEnabled) {
            this.restoreExpression()
            this.clearExpressionOwnership()
        }
        const animationHandoff = handoff && this.animationOwned
        const expressionHandoff = handoff && this.expressionOwned
        this.entry = entry
        if (
            !this.target
            || (
                (!this.playbackOptions.useMotion || !this.target.animation)
                && (!this.playbackOptions.useExpression || !this.target.expression)
            )
        ) {
            this.diagnosticsValue = {
                ...IDLE_DIAGNOSTICS,
                status: 'playing',
                voiceStableKey: entry.voiceStableKey,
                scenarioStableKey: entry.scenarioStableKey,
                subtitleModes: [...VOICE_SUBTITLE_UI_MODES],
                reason: !this.playbackOptions.useMotion && !this.playbackOptions.useExpression
                    ? 'official scenario motion and expression following are disabled'
                    : 'selected character exposes no enabled scenario action channels',
            }
            return
        }
        const animation = this.target.animation
        if (animation && this.playbackOptions.useMotion && !this.animationBaseline) {
            this.animationBaseline = {
                current: animation.current,
                time: finiteTime(animation.time),
                paused: animation.paused,
            }
        }
        const expression = this.target.expression
        if (expression && this.playbackOptions.useExpression && !this.expressionBaseline) {
            this.expressionBaseline = {
                current: expression.current,
                automaticBlinkActive: expression.automaticBlinkActive === true,
                expressionAutoBlinkActive: expression.expressionAutoBlinkActive === true,
            }
        }
        this.diagnosticsValue = {
            ...IDLE_DIAGNOSTICS,
            status: 'playing',
            voiceStableKey: entry.voiceStableKey,
            scenarioStableKey: entry.scenarioStableKey,
            subtitleModes: [...VOICE_SUBTITLE_UI_MODES],
        }
        this.sync(positionSeconds, true, true, true)
        if (animationHandoff && !this.diagnosticsValue.motionApplied) {
            this.restoreAnimation()
            this.clearAnimationOwnership()
        }
        if (expressionHandoff && !this.diagnosticsValue.faceApplied) {
            this.restoreExpression()
            this.clearExpressionOwnership()
        }
    }

    update(positionSeconds: number): void {
        if (!this.entry) return
        this.sync(positionSeconds, true, false)
    }

    pause(): void {
        if (!this.entry) return
        const animation = this.target?.animation
        if (this.playbackOptions.useMotion && animation && this.animationOwned && !this.motionPoseBlock()) animation.paused = true
        this.diagnosticsValue = { ...this.diagnosticsValue, status: 'paused' }
    }

    resume(positionSeconds: number): void {
        if (!this.entry) return
        this.sync(positionSeconds, true, false)
        const animation = this.target?.animation
        if (this.playbackOptions.useMotion && animation && this.animationOwned && !this.motionPoseBlock()) animation.paused = false
        this.diagnosticsValue = { ...this.diagnosticsValue, status: 'playing' }
    }

    seek(positionSeconds: number, playing: boolean): void {
        if (!this.entry) return
        this.sync(positionSeconds, playing, true)
        this.diagnosticsValue = {
            ...this.diagnosticsValue,
            status: playing ? 'playing' : 'paused',
        }
    }

    setUnavailable(voiceStableKey: string, reason: string): void {
        this.stop()
        this.diagnosticsValue = {
            ...IDLE_DIAGNOSTICS,
            status: 'unavailable',
            voiceStableKey,
            reason,
        }
    }

    stop(): void {
        this.asyncGeneration++
        this.restoreAnimation()
        this.restoreExpression()
        this.entry = null
        this.clearAnimationOwnership()
        this.clearExpressionOwnership()
        this.motionRowIndex = -1
        this.faceRowIndex = -1
        this.handoffPending = false
        this.diagnosticsValue = { ...IDLE_DIAGNOSTICS }
    }

    private sync(
        positionSeconds: number,
        playing: boolean,
        force: boolean,
        transitionForcedMotion = false,
    ): void {
        const entry = this.entry
        const target = this.target
        if (!entry || !target) return
        const position = finiteTime(positionSeconds)
        const motionIndex = this.playbackOptions.useMotion
            ? latestRowIndex(entry.rows, position, 'Motion')
            : -1
        const faceIndex = this.playbackOptions.useExpression
            ? latestRowIndex(entry.rows, position, 'FaceType')
            : -1
        const animation = target.animation
        const currentMotionOwned = !animation?.current
            || this.ownedAnimationFamilies.has(animation.current)
        const motionBlock = this.motionPoseBlock()
        if (motionBlock && this.playbackOptions.useMotion) {
            this.motionRowIndex = -1
            this.diagnosticsValue = { ...this.diagnosticsValue, motionApplied: false, reason: motionBlock }
        }
        if (!motionBlock && motionIndex >= 0 && (
            force
            || motionIndex !== this.motionRowIndex
            || (this.animationOwned && !currentMotionOwned)
        )) {
            this.applyMotion(
                entry.rows[motionIndex],
                position,
                playing,
                force && !transitionForcedMotion
                    ? 0
                    : scenarioTransitionSeconds(entry.rows[motionIndex].Motion),
            )
            this.motionRowIndex = motionIndex
        }
        const expression = target.expression
        const currentExpressionOwned = !expression
            || this.ownedExpressions.has(expression.current)
        const expressionBlock = this.expressionPoseBlock()
        if (expressionBlock && this.playbackOptions.useExpression) {
            this.faceRowIndex = -1
            this.diagnosticsValue = { ...this.diagnosticsValue, faceApplied: false, reason: expressionBlock }
        }
        if (!expressionBlock && faceIndex >= 0 && (
            force
            || faceIndex !== this.faceRowIndex
            || (this.expressionOwned && !currentExpressionOwned)
        )) {
            this.applyExpression(entry.rows[faceIndex])
            this.faceRowIndex = faceIndex
        }
    }

    private motionSpec(motion: string): MotionSpec | null {
        const actions = this.target ? runtimeFor(this.target)?.actions : undefined
        if (motion === 'HomeWait01' && actions?.wait01?.loopFamily) {
            return {
                primaryFamily: actions.wait01.loopFamily,
                loopFamily: null,
                loops: true,
                startExitNormalizedTime: 1,
            }
        }
        if (motion === 'HomeWait02' && actions?.wait02?.loopFamily) {
            return {
                primaryFamily: actions.wait02.loopFamily,
                loopFamily: null,
                loops: true,
                startExitNormalizedTime: 1,
            }
        }
        if (
            motion === 'HomeUnique01'
            && actions?.unique01?.startFamily
            && actions.unique01.loopFamily
        ) {
            return {
                primaryFamily: actions.unique01.startFamily,
                loopFamily: actions.unique01.loopFamily,
                loops: false,
                startExitNormalizedTime: Number.isFinite(actions.unique01.startExitNormalizedTime)
                    ? Math.max(0, actions.unique01.startExitNormalizedTime ?? 1)
                    : 1,
            }
        }
        return null
    }

    private applyMotion(
        row: VoiceScenarioRow,
        positionSeconds: number,
        playing: boolean,
        transitionSeconds: number,
    ): void {
        const target = this.target
        const animation = target?.animation
        const motion = row.Motion
        const spec = motion ? this.motionSpec(motion) : null
        let family: string | null = null
        let applied = false
        let reason: string | null = null
        if (!animation || !target) {
            reason = 'selected character has no animation channel'
        } else if (!motion || !spec) {
            reason = `scenario motion has no exact Home runtime field: ${motion ?? ''}`
        } else if (!targetHasAnimationFamily(target, spec.primaryFamily)) {
            reason = `exact animation family is absent: ${spec.primaryFamily}`
        } else if (spec.loopFamily && !targetHasAnimationFamily(target, spec.loopFamily)) {
            reason = `exact animation family is absent: ${spec.loopFamily}`
        } else {
            const offset = Math.max(0, positionSeconds - scenarioVariableSeconds(row))
            family = spec.primaryFamily
            let loop = spec.loops
            let localTime = offset
            if (spec.loopFamily) {
                const startDuration = clipDuration(animation, spec.primaryFamily)
                const startGate = startDuration * spec.startExitNormalizedTime
                if (
                    startDuration > 0
                    && offset >= startGate
                    && targetHasAnimationFamily(target, spec.loopFamily)
                ) {
                    family = spec.loopFamily
                    loop = true
                    localTime = Math.max(0, offset - startGate)
                }
                this.ownedAnimationFamilies.add(spec.loopFamily)
            }
            try {
                const duration = clipDuration(animation, family)
                const exactLocalTime = duration > 0
                    ? (loop ? localTime % duration : Math.min(localTime, duration))
                    : localTime
                if (!this.animationBaseline) this.animationBaseline = {
                    current: animation.current, time: finiteTime(animation.time), paused: animation.paused,
                }
                this.retainPending(animation.play(family, loop, {
                    transitionSeconds,
                    localTimeSeconds: exactLocalTime,
                }))
                animation.paused = !playing
                this.ownedAnimationFamilies.add(family)
                this.animationOwned = true
                applied = true
            } catch (cause) {
                reason = `scenario animation application failed: ${String(cause)}`
            }
        }
        this.diagnosticsValue = {
            ...this.diagnosticsValue,
            rowNumber: row.rowNumber,
            motion: motion ?? null,
            motionFamily: family,
            motionApplied: applied,
            reason,
        }
    }

    private applyExpression(row: VoiceScenarioRow): void {
        const expression = this.target?.expression
        const faceType = row.FaceType
        const faceChannel = expression && faceType
            ? resolveVoiceScenarioExpressionChannel(expression, faceType)
            : null
        let applied = false
        let reason = this.diagnosticsValue.reason
        if (!expression) {
            reason = 'selected character has no expression channel'
        } else if (!faceType || !faceChannel) {
            reason = `exact expression channel is absent: ${faceType ?? ''}`
        } else {
            try {
                if (!this.expressionBaseline) this.expressionBaseline = {
                    current: expression.current, automaticBlinkActive: expression.automaticBlinkActive === true,
                    expressionAutoBlinkActive: expression.expressionAutoBlinkActive === true,
                }
                this.retainPending(expression.set(faceChannel, true))
                this.ownedExpressions.add(faceChannel)
                this.expressionOwned = true
                applied = true
                reason = null
            } catch (cause) {
                reason = `scenario expression application failed: ${String(cause)}`
            }
        }
        this.diagnosticsValue = {
            ...this.diagnosticsValue,
            rowNumber: row.rowNumber,
            faceType: faceType ?? null,
            faceChannel,
            faceApplied: applied,
            reason,
        }
    }

    private restoreAnimation(): void {
        if (this.motionPoseBlock()) return
        const animation = this.target?.animation
        const baseline = this.animationBaseline
        if (!animation || !baseline || !this.animationOwned) return
        if (animation.current && !this.ownedAnimationFamilies.has(animation.current)) return
        if (!baseline.current) {
            this.retainPending(animation.clear())
            return
        }
        this.retainPending(animation.play(baseline.current, baseline.current.endsWith('_L'), {
            transitionSeconds: 0,
            localTimeSeconds: baseline.time,
        }))
        animation.paused = baseline.paused
    }

    private restoreExpression(): void {
        if (this.expressionPoseBlock()) return
        const expression = this.target?.expression
        const baseline = this.expressionBaseline
        if (!expression || !baseline || !this.expressionOwned) return
        if (!this.ownedExpressions.has(expression.current)) return
        if (baseline.automaticBlinkActive) {
            this.retainPending(expression.resetToDefault())
            return
        }
        this.retainPending(expression.set(baseline.current, baseline.expressionAutoBlinkActive))
    }

    private clearAnimationOwnership(): void {
        this.animationBaseline = null
        this.animationOwned = false
        this.ownedAnimationFamilies.clear()
    }

    private clearExpressionOwnership(): void {
        this.expressionBaseline = null
        this.expressionOwned = false
        this.ownedExpressions.clear()
    }
}
