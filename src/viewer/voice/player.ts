import type * as THREE from 'three'
import {
    isVoiceRuntimeReady,
    VoiceCatalog,
    VoiceCatalogError,
    type VoiceCatalogEntry,
} from './catalog.ts'
import {
    resolveMouthCarrier,
    type MouthCarrierDiagnostics,
    type ResolvedMouthCarrier,
} from './mouthCarrier.ts'
import {
    DEMO_LIPSYNC_CONSTANTS,
    DemoMultiwaveLipSync,
} from './multiwave.ts'
import { installVoicePresentation } from './presentation.ts'
import {
    fetchVoiceScenarioManifest,
    VoiceScenarioCatalog,
    VoiceScenarioRunner,
    type VoiceScenarioCharacterLike,
    type VoiceScenarioDiagnostics,
    type VoiceScenarioManifest,
    type VoiceScenarioPlaybackOptions,
    type VoiceScenarioSubtitleState,
} from './scenario.ts'

export type VoicePlaybackStatus =
    | 'idle'
    | 'loading'
    | 'playing'
    | 'paused'
    | 'error'
    | 'disposed'

export type VoiceAnalysisMode = 'multiwave' | 'official-binary'

export interface VoicePlayerSnapshot {
    status: VoicePlaybackStatus
    characterResourceId: string | null
    trackCount: number
    currentIndex: number
    currentStableKey: string | null
    positionSeconds: number
    durationSeconds: number | null
    autoSequence: boolean
    analysisMode: VoiceAnalysisMode
    mouthCarrier: MouthCarrierDiagnostics
    scenario: VoiceScenarioDiagnostics
    error: string | null
}

export interface VoiceAudioNodeLike {
    connect(destination: unknown): unknown
    disconnect(): void
}

export interface VoiceAnalyserNodeLike extends VoiceAudioNodeLike {
    fftSize: number
    readonly frequencyBinCount: number
    getFloatTimeDomainData(array: Float32Array): void
}

export interface VoiceAudioContextLike {
    readonly destination: unknown
    readonly state?: string
    createMediaElementSource(element: VoiceAudioElementLike): VoiceAudioNodeLike
    createGain(): VoiceAudioNodeLike
    createAnalyser(): VoiceAnalyserNodeLike
    resume?(): Promise<void>
    close?(): Promise<void>
}

export interface VoiceAudioElementLike {
    src: string
    crossOrigin: string | null
    preload: string
    currentTime: number
    readonly duration: number
    readonly paused: boolean
    readonly ended: boolean
    play(): Promise<void>
    pause(): void
    load(): void
    removeAttribute(name: string): void
    addEventListener(type: string, listener: () => void): void
    removeEventListener(type: string, listener: () => void): void
}

export interface VoicePlayerEnvironment {
    createAudioElement(): VoiceAudioElementLike
    createAudioContext(): VoiceAudioContextLike | null
    resolveRuntimeUrl(entry: VoiceCatalogEntry): string | null | Promise<string | null>
    beforePlayback(entry: VoiceCatalogEntry, target: VoiceCharacterTarget): void | Promise<void>
    setTimeout(callback: () => void, milliseconds: number): unknown
    clearTimeout(handle: unknown): void
    autoSequenceGapMilliseconds: number
    loadScenarioCatalog(): Promise<VoiceScenarioCatalog | VoiceScenarioManifest | null>
}

export type VoiceCharacterTarget =
    | THREE.Object3D
    | VoiceScenarioCharacterLike
    | null

interface VoiceAudioGraph {
    source: VoiceAudioNodeLike
    gain: VoiceAudioNodeLike
    analyser: VoiceAnalyserNodeLike
}

interface ObjectEventTarget {
    addEventListener(type: string, listener: (event: unknown) => void): void
    removeEventListener(type: string, listener: (event: unknown) => void): void
}

type DisposeCallback = () => void

const NO_MOUTH_DIAGNOSTICS: MouthCarrierDiagnostics = {
    kind: 'none',
    bindings: [],
    reason: 'no character target is selected',
}

function defaultEnvironment(): VoicePlayerEnvironment {
    return {
        createAudioElement() {
            if (typeof Audio === 'undefined') {
                throw new Error('HTMLAudioElement is unavailable')
            }
            return new Audio() as unknown as VoiceAudioElementLike
        },
        createAudioContext() {
            if (typeof window === 'undefined') return null
            const AudioContextConstructor = window.AudioContext
                ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext })
                    .webkitAudioContext
            return AudioContextConstructor
                ? new AudioContextConstructor() as unknown as VoiceAudioContextLike
                : null
        },
        resolveRuntimeUrl(entry) {
            return entry.audio.runtimeUrl
        },
        beforePlayback() {},
        setTimeout(callback, milliseconds) {
            return globalThis.setTimeout(callback, milliseconds)
        },
        clearTimeout(handle) {
            globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)
        },
        autoSequenceGapMilliseconds: 1000,
        loadScenarioCatalog() {
            return fetchVoiceScenarioManifest()
        },
    }
}

function isObject3D(value: unknown): value is THREE.Object3D {
    return typeof value === 'object'
        && value !== null
        && (value as { isObject3D?: unknown }).isObject3D === true
}

function unwrapTarget(value: VoiceCharacterTarget): THREE.Object3D | null {
    if (isObject3D(value)) return value
    if (typeof value !== 'object' || value === null) return null
    if (isObject3D(value.object)) return value.object
    if (isObject3D(value.character?.object)) return value.character.object
    return null
}

function removeArrayValue<T>(values: T[], target: T): void {
    const index = values.indexOf(target)
    if (index >= 0) values.splice(index, 1)
}

function finiteDuration(value: number): number | null {
    return Number.isFinite(value) && value >= 0 ? value : null
}

export function createCriVoiceUrlResolver(
    baseUrl: string,
    resolveAssetUrl: (reference: string) => string | Promise<string> = reference => reference,
): (entry: VoiceCatalogEntry) => string | null | Promise<string | null> {
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
    return entry => {
        if (!isVoiceRuntimeReady(entry)) return null
        const match = /^cri-cue:cueSheetName=([^|]+)\|cueName=(.+)$/
            .exec(entry.audio.sourceStableKey)
        if (!match?.[1] || !match[2]) return null
        const sourceUrl = new URL(
            `${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}.ogg`,
            normalizedBase,
        ).href
        return resolveAssetUrl(sourceUrl)
    }
}

export class VoicePlayer {
    readonly catalog: VoiceCatalog
    private readonly environment: VoicePlayerEnvironment
    private readonly multiwave = new DemoMultiwaveLipSync()
    private readonly listeners = new Set<(snapshot: VoicePlayerSnapshot) => void>()

    private status: VoicePlaybackStatus = 'idle'
    private characterResourceId: string | null = null
    private tracks: readonly VoiceCatalogEntry[] = []
    private currentIndex = -1
    private error: string | null = null
    private autoSequence = false
    private generation = 0
    private autoTimer: unknown = null

    private audio: VoiceAudioElementLike | null = null
    private audioEndedListener: (() => void) | null = null
    private audioErrorListener: (() => void) | null = null
    private audioContext: VoiceAudioContextLike | null | undefined
    private graph: VoiceAudioGraph | null = null
    private pcm: Float32Array | null = null
    private analyserUsable = false

    private scenarioCatalog: VoiceScenarioCatalog | null = null
    private scenarioCatalogLoaded = false
    private scenarioCatalogPromise: Promise<VoiceScenarioCatalog | null> | null = null
    private scenarioCatalogError: string | null = null
    private readonly scenario = new VoiceScenarioRunner()
    private scenarioOptions: VoiceScenarioPlaybackOptions = {
        useMotion: true,
        useExpression: true,
    }

    private targetRoot: THREE.Object3D | null = null
    private targetValue: VoiceCharacterTarget = null
    private carrier: ResolvedMouthCarrier | null = null
    private targetDisposeCallbacks: DisposeCallback[] | null = null
    private targetDisposeCallback: DisposeCallback | null = null
    private readonly targetRemovedListener = () => this.handleTargetDisposed()

    constructor(
        catalog: VoiceCatalog | ConstructorParameters<typeof VoiceCatalog>[0],
        environment: Partial<VoicePlayerEnvironment> = {},
    ) {
        this.catalog = catalog instanceof VoiceCatalog ? catalog : new VoiceCatalog(catalog)
        this.environment = { ...defaultEnvironment(), ...environment }
        installVoicePresentation()
    }

    get snapshot(): VoicePlayerSnapshot {
        const current = this.currentEntry
        return {
            status: this.status,
            characterResourceId: this.characterResourceId,
            trackCount: this.tracks.length,
            currentIndex: this.currentIndex,
            currentStableKey: current?.stableKey ?? null,
            positionSeconds: this.positionSeconds,
            durationSeconds: this.durationSeconds,
            autoSequence: this.autoSequence,
            analysisMode: this.analyserUsable ? 'multiwave' : 'official-binary',
            mouthCarrier: this.carrier?.diagnostics ?? NO_MOUTH_DIAGNOSTICS,
            scenario: this.scenario.diagnostics,
            error: this.error,
        }
    }

    get currentEntry(): VoiceCatalogEntry | null {
        return this.tracks[this.currentIndex] ?? null
    }

    get entries(): readonly VoiceCatalogEntry[] {
        return this.tracks
    }

    get positionSeconds(): number {
        return this.audio && Number.isFinite(this.audio.currentTime)
            ? Math.max(0, this.audio.currentTime)
            : 0
    }

    get durationSeconds(): number | null {
        const audioDuration = this.audio ? finiteDuration(this.audio.duration) : null
        return audioDuration ?? this.currentEntry?.durationSeconds ?? null
    }

    subscribe(listener: (snapshot: VoicePlayerSnapshot) => void): () => void {
        this.listeners.add(listener)
        listener(this.snapshot)
        return () => this.listeners.delete(listener)
    }

    subtitleState(mode: string): VoiceScenarioSubtitleState {
        return this.scenario.subtitleState(mode, this.positionSeconds)
    }

    subtitle(mode: string): string | null {
        return this.subtitleState(mode).text
    }

    setCharacter(characterResourceId: string | null, target: VoiceCharacterTarget): void {
        const root = unwrapTarget(target)
        if (
            this.characterResourceId === characterResourceId
            && this.targetRoot === root
            && this.targetValue === target
        ) return
        this.stop()
        this.detachTarget()
        this.characterResourceId = characterResourceId
        this.tracks = characterResourceId
            ? this.catalog.listForCharacter(characterResourceId)
            : []
        this.currentIndex = -1
        this.attachTarget(target, root)
        this.emit()
    }

    setAutoSequence(enabled: boolean): void {
        this.autoSequence = enabled
        if (!enabled) {
            const cancelledPendingAdvance = this.autoTimer !== null
            this.clearAutoTimer()
            if (cancelledPendingAdvance) this.scenario.stop()
        }
        this.emit()
    }

    setScenarioOptions(options: VoiceScenarioPlaybackOptions): void {
        this.scenarioOptions = {
            useMotion: options.useMotion,
            useExpression: options.useExpression,
        }
    }

    async playQueue(startIndex = 0): Promise<boolean> {
        this.setAutoSequence(true)
        return this.playAt(startIndex)
    }

    async playStableKey(stableKey: string): Promise<boolean> {
        const index = this.tracks.findIndex(entry => entry.stableKey === stableKey)
        if (index < 0) {
            throw new VoiceCatalogError(
                'VOICE_NOT_FOUND',
                `Voice is absent from the selected character: ${stableKey}`,
                { stableKey, characterResourceId: this.characterResourceId },
            )
        }
        return this.playAt(index)
    }

    async playAt(index: number): Promise<boolean> {
        if (this.status === 'disposed') return false
        const entry = this.tracks[index]
        if (!entry) return false
        const generation = ++this.generation
        this.clearAutoTimer()
        this.scenario.prepareHandoff()
        this.releaseAudio()
        this.carrier?.close()
        this.multiwave.reset(this.carrier?.getBaseMouthForm() ?? 0)
        this.currentIndex = index
        this.status = 'loading'
        this.error = null
        this.emit()

        const scenarioCatalog = await this.ensureScenarioCatalog()
        if (generation !== this.generation) return false

        if (!isVoiceRuntimeReady(entry)) {
            return this.failPlayback(
                generation,
                `Official voice source is not runtime-ready: ${entry.stableKey}`,
            )
        }
        let runtimeUrl: string | null
        try {
            runtimeUrl = await this.environment.resolveRuntimeUrl(entry)
        } catch (cause) {
            return this.failPlayback(
                generation,
                `Voice runtime asset resolution failed: ${entry.stableKey}: ${String(cause)}`,
            )
        }
        if (generation !== this.generation) return false
        if (!runtimeUrl) {
            return this.failPlayback(
                generation,
                `Voice runtime URL resolver returned no URL: ${entry.stableKey}`,
            )
        }

        try {
            await this.environment.beforePlayback(entry, this.targetValue)
        } catch (cause) {
            return this.failPlayback(
                generation,
                `Voice playback handoff failed: ${entry.stableKey}: ${String(cause)}`,
            )
        }
        if (generation !== this.generation) return false

        let audio: VoiceAudioElementLike
        try {
            audio = this.environment.createAudioElement()
            audio.crossOrigin = 'anonymous'
            audio.preload = 'auto'
            audio.src = runtimeUrl
            this.audio = audio
            this.audioEndedListener = () => this.handleEnded(generation)
            this.audioErrorListener = () => {
                void this.failPlayback(generation, `Voice media error: ${entry.stableKey}`)
            }
            audio.addEventListener('ended', this.audioEndedListener)
            audio.addEventListener('error', this.audioErrorListener)
            this.installAudioGraph(audio)
            audio.load()
            if (this.audioContext?.state === 'suspended') {
                await this.audioContext.resume?.()
            }
            await audio.play()
        } catch (cause) {
            return this.failPlayback(
                generation,
                `Voice playback failed: ${entry.stableKey}: ${String(cause)}`,
            )
        }

        if (generation !== this.generation || this.audio !== audio) return false
        this.status = 'playing'
        this.carrier?.setOfficialPlaying(true)
        const scenarioEntry = scenarioCatalog?.getForVoice(entry)
        if (scenarioEntry) {
            this.scenario.begin(scenarioEntry, this.positionSeconds, this.scenarioOptions)
        } else {
            this.scenario.setUnavailable(
                entry.stableKey,
                this.scenarioCatalogError ?? 'exact official scenario identity is absent',
            )
        }
        this.emit()
        return true
    }

    pause(): boolean {
        if (this.status !== 'playing' || !this.audio) return false
        this.audio.pause()
        this.status = 'paused'
        this.carrier?.close()
        this.multiwave.reset(this.carrier?.getBaseMouthForm() ?? 0)
        this.scenario.pause()
        this.emit()
        return true
    }

    async resume(): Promise<boolean> {
        if (this.status !== 'paused' || !this.audio) return false
        const generation = this.generation
        try {
            if (this.audioContext?.state === 'suspended') {
                await this.audioContext.resume?.()
            }
            await this.audio.play()
        } catch (cause) {
            return this.failPlayback(generation, `Voice resume failed: ${String(cause)}`)
        }
        if (generation !== this.generation || !this.audio) return false
        this.status = 'playing'
        this.carrier?.setOfficialPlaying(true)
        this.scenario.resume(this.positionSeconds)
        this.emit()
        return true
    }

    seek(positionSeconds: number): boolean {
        if (!this.audio || !Number.isFinite(positionSeconds)) return false
        const duration = this.durationSeconds
        this.audio.currentTime = Math.max(
            0,
            duration === null ? positionSeconds : Math.min(duration, positionSeconds),
        )
        this.scenario.seek(this.audio.currentTime, this.status === 'playing')
        this.emit()
        return true
    }

    async previous(): Promise<boolean> {
        if (this.currentIndex <= 0) return false
        return this.playAt(this.currentIndex - 1)
    }

    async next(): Promise<boolean> {
        if (this.currentIndex < 0 || this.currentIndex + 1 >= this.tracks.length) return false
        return this.playAt(this.currentIndex + 1)
    }

    stop(): void {
        if (this.status === 'disposed') return
        this.generation++
        this.clearAutoTimer()
        this.scenario.stop()
        this.releaseAudio()
        this.carrier?.close()
        this.multiwave.reset(this.carrier?.getBaseMouthForm() ?? 0)
        this.status = 'idle'
        this.error = null
        this.emit()
    }

    update(deltaSeconds: number): void {
        if (this.status !== 'playing') return
        this.scenario.update(this.positionSeconds)
        if (!this.analyserUsable || !this.graph || !this.pcm) {
            this.carrier?.setOfficialPlaying(true)
            return
        }
        try {
            this.graph.analyser.getFloatTimeDomainData(this.pcm)
            const frame = this.multiwave.updateFromPcm(
                this.pcm,
                deltaSeconds,
                this.carrier?.getBaseMouthForm() ?? 0,
            )
            this.carrier?.setDrive(frame.mouthOpen, frame.mouthForm)
        } catch {
            this.analyserUsable = false
            this.multiwave.reset(this.carrier?.getBaseMouthForm() ?? 0)
            this.carrier?.setOfficialPlaying(true)
            this.emit()
        }
    }

    async dispose(): Promise<void> {
        if (this.status === 'disposed') return
        this.stop()
        this.detachTarget()
        this.status = 'disposed'
        const context = this.audioContext
        this.audioContext = null
        try {
            await context?.close?.()
        } finally {
            this.listeners.clear()
        }
    }

    private emit(): void {
        const snapshot = this.snapshot
        for (const listener of this.listeners) listener(snapshot)
    }

    private async ensureScenarioCatalog(): Promise<VoiceScenarioCatalog | null> {
        if (this.scenarioCatalogLoaded) return this.scenarioCatalog
        if (this.scenarioCatalogPromise) return this.scenarioCatalogPromise
        this.scenarioCatalogPromise = (async () => {
            try {
                const value = await this.environment.loadScenarioCatalog()
                this.scenarioCatalog = value === null
                    ? null
                    : value instanceof VoiceScenarioCatalog
                        ? value
                        : new VoiceScenarioCatalog(value)
                this.scenarioCatalogError = this.scenarioCatalog
                    ? null
                    : 'official scenario catalog loader returned no catalog'
                return this.scenarioCatalog
            } catch (cause) {
                this.scenarioCatalog = null
                this.scenarioCatalogError = `official scenario catalog load failed: ${String(cause)}`
                return null
            } finally {
                this.scenarioCatalogLoaded = true
                this.scenarioCatalogPromise = null
            }
        })()
        return this.scenarioCatalogPromise
    }

    private getAudioContext(): VoiceAudioContextLike | null {
        if (this.audioContext !== undefined) return this.audioContext
        try {
            this.audioContext = this.environment.createAudioContext()
        } catch {
            this.audioContext = null
        }
        return this.audioContext
    }

    private installAudioGraph(audio: VoiceAudioElementLike): void {
        this.graph = null
        this.pcm = null
        this.analyserUsable = false
        const context = this.getAudioContext()
        if (!context) return
        let source: VoiceAudioNodeLike | null = null
        let gain: VoiceAudioNodeLike | null = null
        let analyser: VoiceAnalyserNodeLike | null = null
        try {
            source = context.createMediaElementSource(audio)
            gain = context.createGain()
            analyser = context.createAnalyser()
            analyser.fftSize = DEMO_LIPSYNC_CONSTANTS.analyserFftSize
            source.connect(gain)
            gain.connect(analyser)
            analyser.connect(context.destination)
            this.graph = { source, gain, analyser }
            this.pcm = new Float32Array(analyser.frequencyBinCount)
            this.analyserUsable = true
        } catch (cause) {
            try { source?.disconnect() } catch {}
            try { gain?.disconnect() } catch {}
            try { analyser?.disconnect() } catch {}
            this.graph = null
            this.pcm = null
            this.analyserUsable = false
            throw cause
        }
    }

    private releaseAudio(): void {
        const audio = this.audio
        if (audio) {
            if (this.audioEndedListener) {
                audio.removeEventListener('ended', this.audioEndedListener)
            }
            if (this.audioErrorListener) {
                audio.removeEventListener('error', this.audioErrorListener)
            }
            audio.pause()
            audio.removeAttribute('src')
            audio.src = ''
            audio.load()
        }
        this.audio = null
        this.audioEndedListener = null
        this.audioErrorListener = null
        if (this.graph) {
            try { this.graph.source.disconnect() } catch {}
            try { this.graph.gain.disconnect() } catch {}
            try { this.graph.analyser.disconnect() } catch {}
        }
        this.graph = null
        this.pcm = null
        this.analyserUsable = false
    }

    private failPlayback(generation: number, message: string): false {
        if (generation !== this.generation) return false
        this.scenario.stop()
        this.releaseAudio()
        this.carrier?.close()
        this.multiwave.reset(this.carrier?.getBaseMouthForm() ?? 0)
        this.status = 'error'
        this.error = message
        this.emit()
        return false
    }

    private handleEnded(generation: number): void {
        if (generation !== this.generation) return
        const nextIndex = this.currentIndex + 1
        const willAutoAdvance = this.autoSequence && nextIndex < this.tracks.length
        if (willAutoAdvance) {
            this.scenario.prepareHandoff()
        } else {
            this.scenario.stop()
        }
        this.releaseAudio()
        this.carrier?.close()
        this.multiwave.reset(this.carrier?.getBaseMouthForm() ?? 0)
        this.status = 'idle'
        this.error = null
        this.emit()
        if (!willAutoAdvance) return
        this.autoTimer = this.environment.setTimeout(() => {
            this.autoTimer = null
            if (generation !== this.generation || !this.autoSequence) return
            void this.playAt(nextIndex)
        }, this.environment.autoSequenceGapMilliseconds)
    }

    private clearAutoTimer(): void {
        if (this.autoTimer === null) return
        this.environment.clearTimeout(this.autoTimer)
        this.autoTimer = null
    }

    private attachTarget(target: VoiceCharacterTarget, root: THREE.Object3D | null): void {
        this.targetValue = target
        this.targetRoot = root
        this.scenario.setTarget(target)
        if (!root) return
        this.carrier = resolveMouthCarrier(root)
        const eventTarget = root as unknown as ObjectEventTarget
        eventTarget.addEventListener('removed', this.targetRemovedListener)

        const disposeCallbacks = root.userData.disposeCallbacks
        if (Array.isArray(disposeCallbacks)) {
            this.targetDisposeCallbacks = disposeCallbacks as DisposeCallback[]
            this.targetDisposeCallback = () => this.handleTargetDisposed()
            this.targetDisposeCallbacks.push(this.targetDisposeCallback)
        }
    }

    private detachTarget(): void {
        this.scenario.setTarget(null)
        this.carrier?.close()
        if (this.targetRoot) {
            const eventTarget = this.targetRoot as unknown as ObjectEventTarget
            eventTarget.removeEventListener('removed', this.targetRemovedListener)
        }
        if (this.targetDisposeCallbacks && this.targetDisposeCallback) {
            removeArrayValue(this.targetDisposeCallbacks, this.targetDisposeCallback)
        }
        this.targetRoot = null
        this.targetValue = null
        this.carrier = null
        this.targetDisposeCallbacks = null
        this.targetDisposeCallback = null
    }

    private handleTargetDisposed(): void {
        this.stop()
        this.detachTarget()
        this.emit()
    }

}
