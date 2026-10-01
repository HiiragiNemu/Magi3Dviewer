import type { VoiceCatalog, VoiceCatalogEntry } from '../voice/catalog.ts'
import { isVoiceRuntimeReady } from '../voice/catalog.ts'
import { resolveRuntimeVoiceUrl } from '../runtimeProductDelivery.ts'
import type { VoiceAudioContextLike } from '../voice/player.ts'
import { AudioActorLipSync } from './audioActorLipSync.ts'
import type { PerformanceEditorRuntime } from './runtime.ts'
import type { ActorDescriptor, PerformanceAudioTrack, TimelineClockSnapshot } from './types.ts'

export interface TimelineAudioElement {
    src: string
    currentTime: number
    volume: number
    paused: boolean
    ended: boolean
    duration?: number
    crossOrigin?: string | null
    preload?: string
    play(): void | Promise<void>
    pause(): void
    load?(): void
    addEventListener?(type: string, listener: () => void): void
    removeEventListener?(type: string, listener: () => void): void
}
export interface AudioTimelineBridgeOptions {
    catalog?: VoiceCatalog
    createAudio?: () => TimelineAudioElement
    createAudioContext?: () => VoiceAudioContextLike | null
    resolveRuntimeUrl?: (entry: VoiceCatalogEntry) => string | null | Promise<string | null>
    /** Telemetry only. Real actor mouth output does not depend on this observer. */
    onLipSync?: (trackId: string, amplitude: number) => void
    driftToleranceSeconds?: number
}
export interface AudioTimelineTrackState {
    id: string
    sourceStableKey: string
    status: 'pending' | 'ready' | 'playing' | 'paused' | 'error'
    error: string | null
    currentTime: number
    actorKey: string | null
    generation: number | null
    lipSyncStatus: 'background' | 'disabled' | 'pending' | 'ready' | 'unavailable' | 'stale'
    lipSyncError: string | null
    rawRms: number
    mouthOpen: number
}
interface Session {
    track: PerformanceAudioTrack
    signature: string
    state: AudioTimelineTrackState
    target?: ActorDescriptor
    element?: TimelineAudioElement
    entry?: VoiceCatalogEntry
    desired: boolean
    inside: boolean
    ended: boolean
    playPending: boolean
    playEpoch: number
    lastLoop?: number
    seekPending: boolean
    cleanups: (() => void)[]
    disposed: boolean
}
const defaultAudioFactory = (): TimelineAudioElement => {
    if (typeof Audio === 'undefined') throw new Error('Audio element unavailable')
    return new Audio()
}
const identity = (track: PerformanceAudioTrack) => JSON.stringify([track.sourceStableKey, track.actorKey, track.generation, track.lipSync === true])

/** Per-track media transport plus exact actor PCM consumer, independent of VoicePlayer. */
export class AudioTimelineBridge {
    private catalog?: VoiceCatalog
    private readonly createAudio: () => TimelineAudioElement
    private readonly resolveUrl: NonNullable<AudioTimelineBridgeOptions['resolveRuntimeUrl']>
    private readonly lips: AudioActorLipSync
    private readonly tolerance: number
    private readonly sessions = new Map<string, Session>()
    private readonly listeners = new Set<(state: readonly AudioTimelineTrackState[]) => void>()
    private readonly catalogListeners = new Set<(entries: readonly VoiceCatalogEntry[] | undefined) => void>()
    private readonly releases: (() => void)[]
    private readonly runtime: PerformanceEditorRuntime
    private readonly options: AudioTimelineBridgeOptions
    private clock?: TimelineClockSnapshot
    private disposed = false
    constructor(runtime: PerformanceEditorRuntime, options: AudioTimelineBridgeOptions = {}) {
        this.runtime = runtime; this.options = options
        this.catalog = options.catalog
        this.createAudio = options.createAudio ?? defaultAudioFactory
        this.resolveUrl = options.resolveRuntimeUrl ?? resolveRuntimeVoiceUrl
        this.tolerance = options.driftToleranceSeconds ?? 0.15
        if (!Number.isFinite(this.tolerance) || this.tolerance <= 0) throw new Error('Invalid audio drift tolerance')
        this.lips = new AudioActorLipSync(options.createAudioContext)
        this.releases = [runtime.subscribeClock(snapshot => this.onClock(snapshot)), runtime.subscribe(kind => {
            if (kind === 'actors') { this.invalidateActors(); this.sync(this.runtimeSnapshot()) }
        })]
        this.prepare(runtime.timeline.audioTracks ?? [])
    }
    get snapshot(): readonly AudioTimelineTrackState[] { return [...this.sessions.values()].map(row => ({ ...row.state })) }
    subscribe(listener: (state: readonly AudioTimelineTrackState[]) => void) {
        this.listeners.add(listener); listener(this.snapshot); return () => { this.listeners.delete(listener) }
    }
    /** Detached authoring candidates; reading/subscribing never starts transport. */
    get catalogEntries(): readonly VoiceCatalogEntry[] | undefined {
        return this.catalog ? structuredClone(this.catalog.manifest.entries) : undefined
    }
    subscribeCatalog(listener: (entries: readonly VoiceCatalogEntry[] | undefined) => void) {
        this.catalogListeners.add(listener); listener(this.catalogEntries)
        return () => { this.catalogListeners.delete(listener) }
    }
    setCatalog(catalog: VoiceCatalog) {
        const changed = this.catalog !== catalog
        if (this.catalog !== catalog) { for (const id of [...this.sessions.keys()]) this.remove(id); this.catalog = catalog }
        this.prepare(this.runtime.timeline.audioTracks ?? [])
        if (changed) for (const listener of this.catalogListeners) listener(this.catalogEntries)
    }
    private emit() { const snapshot = this.snapshot; for (const listener of this.listeners) listener(snapshot) }
    private actorCurrent(target: ActorDescriptor): boolean {
        const actor = this.runtime.actors.get(target.object.uuid)
        return !!actor?.current && actor.descriptor === target && actor.descriptor.generation === target.generation && target.isCurrent()
    }
    private current(row: Session): boolean {
        return !this.disposed && !row.disposed && this.sessions.get(row.track.id) === row
            && (!row.target || (row.target.object.uuid === row.track.actorKey && row.target.generation === row.track.generation && this.actorCurrent(row.target)))
    }
    private prepare(tracks: readonly PerformanceAudioTrack[]) {
        const wanted = new Set(tracks.map(track => track.id))
        // Includes pending resolutions, not only already-created audio elements.
        for (const id of [...this.sessions.keys()]) if (!wanted.has(id)) this.remove(id)
        for (const track of tracks) {
            const signature = identity(track), old = this.sessions.get(track.id)
            if (old && old.signature === signature && !old.disposed) { old.track = { ...track }; continue }
            if (old) this.remove(track.id)
            const bound = track.actorKey !== undefined
            const target = bound ? this.runtime.actors.get(track.actorKey!)?.descriptor : undefined
            const row: Session = { track: { ...track }, signature, desired: false, inside: false, ended: false, playPending: false, playEpoch: 0,
                seekPending: true, cleanups: [], disposed: false, target,
                state: { id: track.id, sourceStableKey: track.sourceStableKey, status: 'pending', error: null, currentTime: 0,
                    actorKey: track.actorKey ?? null, generation: track.generation ?? null,
                    lipSyncStatus: !bound ? 'background' : track.lipSync ? 'pending' : 'disabled', lipSyncError: null, rawRms: 0, mouthOpen: 0 } }
            this.sessions.set(track.id, row)
            if (bound && (!target || target.object.uuid !== track.actorKey || target.generation !== track.generation || !this.actorCurrent(target))) {
                this.fail(row, 'AUDIO_ACTOR_STALE', true); continue
            }
            if (target) {
                const removed = () => { if (this.sessions.get(track.id) === row && !row.disposed) { this.fail(row, 'AUDIO_ACTOR_REMOVED', true); this.emit() } }
                target.object.addEventListener('removed', removed)
                row.cleanups.push(() => target.object.removeEventListener('removed', removed))
                const callbacks = target.object.userData.disposeCallbacks
                if (Array.isArray(callbacks)) { callbacks.push(removed); row.cleanups.push(() => { const i = callbacks.indexOf(removed); if (i >= 0) callbacks.splice(i, 1) }) }
            }
            void this.ensure(row)
        }
        this.emit()
    }
    private async ensure(row: Session) {
        try {
            const entry = this.catalog?.get(row.track.sourceStableKey)
            if (!entry) throw new Error(`VOICE_NOT_FOUND: ${row.track.sourceStableKey}`)
            if (!isVoiceRuntimeReady(entry)) throw new Error(`VOICE_NOT_READY: ${row.track.sourceStableKey}`)
            row.entry = entry
            const url = await this.resolveUrl(entry)
            if (!this.current(row) || row.state.status === 'error') return
            if (!url) throw new Error(`VOICE_RUNTIME_URL_ABSENT: ${row.track.sourceStableKey}`)
            const element = this.createAudio(); row.element = element
            element.crossOrigin = 'anonymous'; element.preload = 'auto'; element.src = url
            element.volume = row.track.volume ?? 1
            if (row.target && row.track.lipSync) {
                const target = row.target, actorKey = row.track.actorKey, generation = row.track.generation
                const error = this.lips.attach(row.track.id, element, target,
                    () => target.object.uuid === actorKey && target.generation === generation && this.actorCurrent(target))
                row.state.lipSyncStatus = error ? 'unavailable' : 'ready'; row.state.lipSyncError = error
            }
            const ended = () => { if (this.current(row)) { row.ended = true; this.pause(row); row.state.status = 'paused'; this.sync(this.runtimeSnapshot()); this.flushMouthOutput(); this.emit() } }
            const error = () => { if (this.current(row)) { this.fail(row, 'AUDIO_MEDIA_ERROR'); this.emit() } }
            element.addEventListener?.('ended', ended); element.addEventListener?.('error', error)
            row.cleanups.push(() => { element.removeEventListener?.('ended', ended); element.removeEventListener?.('error', error) })
            element.load?.(); row.state.status = 'ready'; row.state.error = null
            this.sync(this.runtimeSnapshot()); this.emit()
        } catch (error) {
            if (this.current(row)) { this.fail(row, error instanceof Error ? error.message : String(error)); this.emit() }
        }
    }
    private runtimeSnapshot(): TimelineClockSnapshot {
        return { frameId: -1, time: this.runtime.time, duration: this.runtime.timeline.duration, deltaSeconds: 0,
            playing: this.runtime.playing, loopIteration: this.clock?.loopIteration ?? 0, reason: 'frame' }
    }
    private invalidateActors() {
        for (const row of this.sessions.values()) if (row.target && !this.current(row) && row.state.status !== 'error') this.fail(row, 'AUDIO_ACTOR_STALE', true)
    }
    private onClock(snapshot: TimelineClockSnapshot) {
        if (this.disposed) return
        this.clock = snapshot
        if (snapshot.reason === 'document') this.prepare(this.runtime.timeline.audioTracks ?? [])
        if (snapshot.reason === 'play') void this.lips.resume().catch(() => {})
        this.invalidateActors(); this.sync(snapshot); this.emit()
    }
    private sync(snapshot: TimelineClockSnapshot) {
        this.lips.beginFrame()
        for (const row of this.sessions.values()) this.syncTrack(row, snapshot)
        if (snapshot.reason !== 'frame') this.flushMouthOutput()
    }
    /** Actual final-render consumer, after native/pose evaluation. */
    flushMouthOutput() { if (!this.disposed) { this.invalidateActors(); this.lips.flush() } }
    private syncTrack(row: Session, snapshot: TimelineClockSnapshot) {
        const element = row.element
        if (!element || !this.current(row) || row.state.status === 'error') return
        const track = row.track, offset = track.offsetSeconds ?? 0
        const sourceDuration = Number.isFinite(element.duration) && element.duration! > 0 ? element.duration! : row.entry?.durationSeconds
        const available = sourceDuration === undefined ? Infinity : Math.max(0, sourceDuration - offset)
        const duration = Math.min(track.durationSeconds ?? available, available)
        const local = snapshot.time - track.startTime, inside = local >= 0 && local < duration
        const target = offset + Math.max(0, Math.min(local, duration))
        const jump = ['seek', 'stop', 'document'].includes(snapshot.reason) || (!row.inside && inside)
            || (row.lastLoop !== undefined && row.lastLoop !== snapshot.loopIteration)
        if (jump) row.ended = false
        const desired = inside && snapshot.playing && !row.ended
        const drift = !Number.isFinite(element.currentTime) || Math.abs(element.currentTime - target) > this.tolerance
        if (jump || row.seekPending || drift) {
            try { element.currentTime = target; row.seekPending = false; this.lips.reset(track.id) }
            catch { row.seekPending = true }
        }
        element.volume = track.volume ?? 1
        row.inside = inside; row.lastLoop = snapshot.loopIteration; row.desired = desired
        row.state.currentTime = Number.isFinite(element.currentTime) ? element.currentTime : 0
        if (desired) {
            if (element.paused && !row.playPending && !row.seekPending) this.start(row)
            if (!element.paused && !element.ended) {
                row.state.status = 'playing'
                if (row.state.lipSyncStatus === 'ready') {
                    const sample = this.lips.sample(track.id, snapshot.reason === 'frame' ? snapshot.deltaSeconds : 0)
                    row.state.rawRms = sample.rawRms; row.state.mouthOpen = sample.mouthOpen
                    if (sample.error) { row.state.lipSyncStatus = 'unavailable'; row.state.lipSyncError = sample.error }
                    this.options.onLipSync?.(track.id, sample.mouthOpen)
                }
            }
        } else {
            this.pause(row)
            row.state.status = snapshot.playing && local < 0 ? 'ready' : 'paused'
        }
    }
    private start(row: Session) {
        const element = row.element!, epoch = ++row.playEpoch
        row.playPending = true
        // Invoke play synchronously at the timeline/user transition, not after an unrelated await.
        try {
            void this.lips.resume().catch(() => {})
            const result = element.play()
            void Promise.resolve(result).then(() => {
                if (!this.current(row)) { element.pause(); return }
                if (row.playEpoch !== epoch) { if (!row.desired) element.pause(); return }
                if (!row.desired) { element.pause(); return }
                row.playPending = false; row.state.status = 'playing'; this.emit()
            }, error => {
                if (this.current(row) && row.playEpoch === epoch && row.desired) { this.fail(row, error instanceof Error ? error.message : String(error)); this.emit() }
            })
        } catch (error) { if (this.current(row)) this.fail(row, error instanceof Error ? error.message : String(error)) }
    }
    private pause(row: Session) {
        row.desired = false; row.playPending = false; ++row.playEpoch
        if (row.element && !row.element.paused) row.element.pause()
        this.lips.reset(row.track.id); row.state.rawRms = 0; row.state.mouthOpen = 0
        this.options.onLipSync?.(row.track.id, 0)
    }
    private fail(row: Session, reason: string, stale = false) {
        this.pause(row); this.lips.remove(row.track.id)
        row.state.status = 'error'; row.state.error = reason
        if (stale) row.state.lipSyncStatus = 'stale'
    }
    private remove(id: string) {
        const row = this.sessions.get(id); if (!row) return
        this.pause(row); this.lips.remove(id); row.disposed = true; this.sessions.delete(id)
        for (const release of row.cleanups.splice(0)) release()
        if (row.element) { row.element.pause(); row.element.src = ''; row.element.load?.() }
    }
    dispose() {
        if (this.disposed) return
        for (const id of [...this.sessions.keys()]) this.remove(id)
        this.disposed = true; for (const release of this.releases) release(); this.lips.dispose(); this.listeners.clear(); this.catalogListeners.clear()
    }
}
