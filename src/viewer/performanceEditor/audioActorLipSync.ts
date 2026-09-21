import { resolveMouthCarrier, type ResolvedMouthCarrier } from '../voice/mouthCarrier.ts'
import { DEMO_LIPSYNC_CONSTANTS, DemoMultiwaveLipSync } from '../voice/multiwave.ts'
import type { VoiceAudioContextLike, VoiceAudioNodeLike, VoiceAnalyserNodeLike, VoiceAudioElementLike } from '../voice/player.ts'
import type { ActorDescriptor } from './types.ts'
import type { TimelineAudioElement } from './audioTimelineBridge.ts'

export const createTimelineAudioContext = (): VoiceAudioContextLike | null => {
    if (typeof window === 'undefined') return null
    const Constructor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    return Constructor ? new Constructor() as unknown as VoiceAudioContextLike : null
}
interface ActorMouth {
    actor: ActorDescriptor
    current(): boolean
    carrier: ResolvedMouthCarrier
    tracks: Set<string>
    dirty: boolean
    frame?: { open: number; form: number }
}
interface Analysis {
    actor: ActorMouth
    source: VoiceAudioNodeLike
    analyser: VoiceAnalyserNodeLike
    pcm: Float32Array
    filter: DemoMultiwaveLipSync
    error: string | null
}
export interface AudioLipSyncSample { rawRms: number; mouthOpen: number; error: string | null }

/** Per-track PCM, one compositor per exact actor. Never calls the voice-panel player. */
export class AudioActorLipSync {
    private context: VoiceAudioContextLike | null | undefined
    private readonly analyses = new Map<string, Analysis>()
    private readonly mouths = new Map<ActorDescriptor['object'], ActorMouth>()
    private readonly fallbacks = new Map<string, VoiceAudioNodeLike>()
    private pendingFrame = false
    private readonly createContext: () => VoiceAudioContextLike | null
    constructor(createContext: () => VoiceAudioContextLike | null = createTimelineAudioContext) { this.createContext = createContext }

    attach(id: string, element: TimelineAudioElement, actor: ActorDescriptor, current: () => boolean): string | null {
        this.remove(id)
        if (!current()) return 'AUDIO_ACTOR_STALE'
        let mouth = this.mouths.get(actor.object)
        if (mouth && (mouth.actor.generation !== actor.generation || !mouth.current())) return 'AUDIO_ACTOR_GENERATION_CONFLICT'
        if (!mouth) {
            const carrier = resolveMouthCarrier(actor.object)
            if (carrier.kind === 'none') return carrier.diagnostics.reason ?? 'AUDIO_MOUTH_CARRIER_ABSENT'
            mouth = { actor, current, carrier, tracks: new Set(), dirty: false }
            this.mouths.set(actor.object, mouth)
        }
        let source: VoiceAudioNodeLike | undefined, analyser: VoiceAnalyserNodeLike | undefined
        try {
            if (this.context === undefined) this.context = this.createContext()
            if (!this.context) throw new Error('AUDIO_ANALYSER_UNAVAILABLE')
            source = this.context.createMediaElementSource(element as unknown as VoiceAudioElementLike)
            analyser = this.context.createAnalyser()
            analyser.fftSize = DEMO_LIPSYNC_CONSTANTS.analyserFftSize
            source.connect(analyser); analyser.connect(this.context.destination)
            const filter = new DemoMultiwaveLipSync(); filter.reset(mouth.carrier.getBaseMouthForm())
            this.analyses.set(id, { actor: mouth, source, analyser, pcm: new Float32Array(analyser.frequencyBinCount), filter, error: null })
            mouth.tracks.add(id)
            return null
        } catch (error) {
            // If WebAudio has taken this media element, retain an audible direct path.
            try { source?.disconnect(); analyser?.disconnect(); source?.connect(this.context!.destination); if (source) this.fallbacks.set(id, source) } catch {}
            if (!mouth.tracks.size) this.mouths.delete(actor.object)
            return error instanceof Error ? error.message : String(error)
        }
    }

    resume(): Promise<void> { return this.context?.state === 'suspended' ? this.context.resume?.() ?? Promise.resolve() : Promise.resolve() }
    beginFrame() { this.pendingFrame = true; for (const mouth of this.mouths.values()) mouth.frame = undefined }
    sample(id: string, delta: number): AudioLipSyncSample {
        const row = this.analyses.get(id)
        if (!row || !row.actor.current()) return { rawRms: 0, mouthOpen: 0, error: 'AUDIO_ACTOR_OR_ANALYSIS_ABSENT' }
        try {
            row.analyser.getFloatTimeDomainData(row.pcm)
            if (!row.pcm.every(Number.isFinite)) throw new Error('AUDIO_PCM_NONFINITE')
            const frame = row.filter.updateFromPcm(row.pcm, delta, row.actor.carrier.getBaseMouthForm())
            // Same-actor overlaps use one maximum-open output, never stacked carrier writes.
            if (!row.actor.frame || frame.mouthOpen > row.actor.frame.open) row.actor.frame = { open: frame.mouthOpen, form: frame.mouthForm }
            row.error = null
            return { rawRms: frame.rawRms, mouthOpen: frame.mouthOpen, error: null }
        } catch (error) {
            row.error = error instanceof Error ? error.message : String(error)
            row.filter.reset(row.actor.carrier.getBaseMouthForm())
            return { rawRms: 0, mouthOpen: 0, error: row.error }
        }
    }
    reset(id: string) { const row = this.analyses.get(id); if (row) row.filter.reset(row.actor.carrier.getBaseMouthForm()) }
    flush() {
        if (!this.pendingFrame) return
        this.pendingFrame = false
        for (const mouth of this.mouths.values()) {
            // An old generation must not close/write a replacement's channels either.
            if (!mouth.current()) { mouth.frame = undefined; mouth.dirty = false; continue }
            if (mouth.frame) { mouth.carrier.setDrive(mouth.frame.open, mouth.frame.form); mouth.dirty = true }
            else if (mouth.dirty) { mouth.carrier.close(); mouth.dirty = false }
        }
    }
    remove(id: string) {
        const fallback = this.fallbacks.get(id)
        if (fallback) { try { fallback.disconnect() } catch {} this.fallbacks.delete(id) }
        const row = this.analyses.get(id); if (!row) return
        this.analyses.delete(id)
        try { row.source.disconnect() } catch {}
        try { row.analyser.disconnect() } catch {}
        row.actor.tracks.delete(id)
        if (!row.actor.tracks.size) {
            if (row.actor.dirty && row.actor.current()) row.actor.carrier.close()
            this.mouths.delete(row.actor.actor.object)
        }
    }
    dispose() {
        for (const id of new Set([...this.analyses.keys(), ...this.fallbacks.keys()])) this.remove(id)
        const context = this.context; this.context = null
        try { void context?.close?.().catch(() => {}) } catch {}
    }
}
