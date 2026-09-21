import type * as THREE from 'three'
import {
    resolveMouthCarrier,
    type MouthCarrierDiagnostics,
    type ResolvedMouthCarrier,
} from './mouthCarrier.ts'
import {
    DEMO_LIPSYNC_CONSTANTS,
    DemoMultiwaveLipSync,
} from './multiwave.ts'
import type {
    VoiceAudioContextLike,
    VoiceAudioElementLike,
    VoiceAudioNodeLike,
    VoiceAnalyserNodeLike,
    VoiceCharacterTarget,
} from './player.ts'

export const VOICE_UPLOAD_ACCEPT = [
    '.ogg',
    '.oga',
    '.opus',
    '.flac',
    '.wav',
    '.wave',
    '.mp3',
    '.m4a',
    '.aac',
    '.webm',
    'audio/ogg',
    'audio/opus',
    'audio/flac',
    'audio/wav',
    'audio/mpeg',
    'audio/mp4',
    'audio/aac',
    'audio/webm',
    'audio/*',
].join(',')

const VOICE_UPLOAD_EXTENSIONS = new Set([
    'ogg',
    'oga',
    'opus',
    'flac',
    'wav',
    'wave',
    'mp3',
    'm4a',
    'aac',
    'webm',
])

const NO_MOUTH_DIAGNOSTICS: MouthCarrierDiagnostics = {
    kind: 'none',
    bindings: [],
    reason: 'this track is not bound to a character mouth carrier',
}

export type VoiceUploadFile = Blob & { readonly name: string }

export type VoiceUploadTrackStatus =
    | 'empty'
    | 'loading'
    | 'ready'
    | 'playing'
    | 'paused'
    | 'ended'
    | 'error'
    | 'disposed'

export type VoiceUploadTrackKind = 'character' | 'background'

export interface VoiceUploadCharacterDescriptor {
    /** Stable per loaded model instance. Object3D.uuid is the preferred value. */
    key: string
    characterResourceId: string
    label: string
    target: VoiceCharacterTarget
}

export interface VoiceUploadTrackSnapshot {
    key: string
    kind: VoiceUploadTrackKind
    characterResourceId: string | null
    label: string
    fileName: string | null
    status: VoiceUploadTrackStatus
    positionSeconds: number
    durationSeconds: number | null
    volume: number
    loop: boolean
    lipSyncEnabled: boolean
    analysisMode: 'multiwave' | 'official-binary' | 'none'
    mouthCarrier: MouthCarrierDiagnostics
    error: string | null
}

export interface VoiceUploadWorkspaceSnapshot {
    characterTracks: readonly VoiceUploadTrackSnapshot[]
    backgroundTracks: readonly VoiceUploadTrackSnapshot[]
}

export interface VoiceUploadAudioElementLike extends VoiceAudioElementLike {
    volume: number
    loop: boolean
}

export interface VoiceUploadWorkspaceEnvironment {
    createAudioElement(): VoiceUploadAudioElementLike
    createAudioContext(): VoiceAudioContextLike | null
    createObjectUrl(file: Blob): string
    revokeObjectUrl(url: string): void
    beforeCharacterPlay(descriptor: VoiceUploadCharacterDescriptor): void | Promise<void>
}

interface VoiceGainNodeLike extends VoiceAudioNodeLike {
    gain?: { value: number }
}

interface VoiceUploadAudioGraph {
    source: VoiceAudioNodeLike
    gain: VoiceGainNodeLike | null
    analyser: VoiceAnalyserNodeLike | null
}

interface ObjectEventTarget {
    addEventListener(type: string, listener: (event: unknown) => void): void
    removeEventListener(type: string, listener: (event: unknown) => void): void
}

interface RuntimeTrack {
    key: string
    kind: VoiceUploadTrackKind
    descriptor: VoiceUploadCharacterDescriptor | null
    label: string
    targetRoot: THREE.Object3D | null
    carrier: ResolvedMouthCarrier | null
    targetDisposeCallbacks: Array<() => void> | null
    targetDisposeCallback: (() => void) | null
    targetRemovedListener: ((event: unknown) => void) | null
    audio: VoiceUploadAudioElementLike | null
    objectUrl: string | null
    graph: VoiceUploadAudioGraph | null
    pcm: Float32Array | null
    analyserUsable: boolean
    multiwave: DemoMultiwaveLipSync
    fileName: string | null
    status: VoiceUploadTrackStatus
    volume: number
    loop: boolean
    lipSyncEnabled: boolean
    error: string | null
    generation: number
    endedListener: (() => void) | null
    errorListener: (() => void) | null
    metadataListener: (() => void) | null
}

function defaultEnvironment(): VoiceUploadWorkspaceEnvironment {
    return {
        createAudioElement() {
            if (typeof Audio === 'undefined') {
                throw new Error('HTMLAudioElement is unavailable')
            }
            return new Audio() as unknown as VoiceUploadAudioElementLike
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
        createObjectUrl(file) {
            return URL.createObjectURL(file)
        },
        revokeObjectUrl(url) {
            URL.revokeObjectURL(url)
        },
        beforeCharacterPlay() {},
    }
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

function clampVolume(value: number): number {
    return Math.max(0, Math.min(2, Number.isFinite(value) ? value : 0))
}

function finiteDuration(value: number): number | null {
    return Number.isFinite(value) && value >= 0 ? value : null
}

function removeArrayValue<T>(values: T[], target: T): void {
    const index = values.indexOf(target)
    if (index >= 0) values.splice(index, 1)
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

function trackPosition(track: RuntimeTrack): number {
    const value = track.audio?.currentTime
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

function fileExtension(name: string): string {
    const match = /\.([^.]+)$/.exec(name.trim().toLowerCase())
    return match?.[1] ?? ''
}

export function isVoiceUploadFileSupported(file: Pick<VoiceUploadFile, 'name' | 'type'>): boolean {
    const mime = (file.type || '').trim().toLowerCase()
    return mime.startsWith('audio/') || VOICE_UPLOAD_EXTENSIONS.has(fileExtension(file.name))
}

export class VoiceUploadWorkspace {
    private readonly environment: VoiceUploadWorkspaceEnvironment
    private readonly listeners = new Set<(snapshot: VoiceUploadWorkspaceSnapshot) => void>()
    private readonly characterTracks = new Map<string, RuntimeTrack>()
    private readonly backgroundTracks = new Map<string, RuntimeTrack>()
    private characterOrder: string[] = []
    private backgroundCounter = 0
    private audioContext: VoiceAudioContextLike | null | undefined
    private disposed = false

    constructor(environment: Partial<VoiceUploadWorkspaceEnvironment> = {}) {
        this.environment = { ...defaultEnvironment(), ...environment }
    }

    get snapshot(): VoiceUploadWorkspaceSnapshot {
        return {
            characterTracks: this.characterOrder
                .map(key => this.characterTracks.get(key))
                .filter((track): track is RuntimeTrack => !!track)
                .map(track => this.snapshotTrack(track)),
            backgroundTracks: [...this.backgroundTracks.values()]
                .map(track => this.snapshotTrack(track)),
        }
    }

    subscribe(listener: (snapshot: VoiceUploadWorkspaceSnapshot) => void): () => void {
        this.listeners.add(listener)
        listener(this.snapshot)
        return () => this.listeners.delete(listener)
    }

    setCharacters(descriptors: readonly VoiceUploadCharacterDescriptor[]): void {
        if (this.disposed) return
        const unique = new Map<string, VoiceUploadCharacterDescriptor>()
        for (const descriptor of descriptors) {
            const key = descriptor.key.trim()
            if (!key || unique.has(key)) continue
            unique.set(key, { ...descriptor, key })
        }

        for (const [key, track] of [...this.characterTracks]) {
            const descriptor = unique.get(key)
            if (!descriptor) {
                this.disposeTrack(track)
                this.characterTracks.delete(key)
                continue
            }
            const root = unwrapTarget(descriptor.target)
            if (root !== track.targetRoot) {
                this.disposeTrack(track)
                this.characterTracks.delete(key)
                continue
            }
            track.descriptor = descriptor
            track.label = descriptor.label
        }

        for (const [key, descriptor] of unique) {
            if (this.characterTracks.has(key)) continue
            this.characterTracks.set(key, this.createCharacterTrack(descriptor))
        }
        this.characterOrder = [...unique.keys()]
        this.emit()
    }

    loadCharacterFile(key: string, file: VoiceUploadFile): boolean {
        const track = this.characterTracks.get(key)
        return !!track && this.loadFile(track, file)
    }

    removeCharacterFile(key: string): boolean {
        const track = this.characterTracks.get(key)
        if (!track) return false
        this.releaseMedia(track)
        track.status = 'empty'
        track.error = null
        this.emit()
        return true
    }

    addBackgroundFile(file: VoiceUploadFile): string | null {
        if (this.disposed) return null
        const key = `background-${++this.backgroundCounter}`
        const track = this.createBackgroundTrack(key, file.name)
        this.backgroundTracks.set(key, track)
        if (!this.loadFile(track, file)) {
            this.backgroundTracks.delete(key)
            this.disposeTrack(track)
            this.emit()
            return null
        }
        return key
    }

    replaceBackgroundFile(key: string, file: VoiceUploadFile): boolean {
        const track = this.backgroundTracks.get(key)
        return !!track && this.loadFile(track, file)
    }

    removeBackgroundTrack(key: string): boolean {
        const track = this.backgroundTracks.get(key)
        if (!track) return false
        this.backgroundTracks.delete(key)
        this.disposeTrack(track)
        this.emit()
        return true
    }

    async playCharacter(key: string): Promise<boolean> {
        const track = this.characterTracks.get(key)
        return !!track && this.playTrack(track)
    }

    async playBackground(key: string): Promise<boolean> {
        const track = this.backgroundTracks.get(key)
        return !!track && this.playTrack(track)
    }

    pauseCharacter(key: string): boolean {
        const track = this.characterTracks.get(key)
        return !!track && this.pauseTrack(track)
    }

    pauseBackground(key: string): boolean {
        const track = this.backgroundTracks.get(key)
        return !!track && this.pauseTrack(track)
    }

    stopCharacter(key: string): boolean {
        const track = this.characterTracks.get(key)
        return !!track && this.stopTrack(track)
    }

    stopBackground(key: string): boolean {
        const track = this.backgroundTracks.get(key)
        return !!track && this.stopTrack(track)
    }

    stopCharacterForTarget(target: VoiceCharacterTarget): boolean {
        const root = unwrapTarget(target)
        if (!root) return false
        let stopped = false
        for (const track of this.characterTracks.values()) {
            if (track.targetRoot === root) stopped = this.stopTrack(track) || stopped
        }
        return stopped
    }

    stopAllCharacterTracks(): void {
        for (const track of this.characterTracks.values()) this.stopTrack(track)
    }

    stopAllBackgroundTracks(): void {
        for (const track of this.backgroundTracks.values()) this.stopTrack(track)
    }

    seekCharacter(key: string, positionSeconds: number): boolean {
        const track = this.characterTracks.get(key)
        return !!track && this.seekTrack(track, positionSeconds)
    }

    seekBackground(key: string, positionSeconds: number): boolean {
        const track = this.backgroundTracks.get(key)
        return !!track && this.seekTrack(track, positionSeconds)
    }

    setCharacterVolume(key: string, volume: number): boolean {
        const track = this.characterTracks.get(key)
        return !!track && this.setTrackVolume(track, volume)
    }

    setBackgroundVolume(key: string, volume: number): boolean {
        const track = this.backgroundTracks.get(key)
        return !!track && this.setTrackVolume(track, volume)
    }

    setBackgroundLoop(key: string, loop: boolean): boolean {
        const track = this.backgroundTracks.get(key)
        if (!track) return false
        track.loop = loop
        if (track.audio) track.audio.loop = loop
        this.emit()
        return true
    }

    setCharacterLipSync(key: string, enabled: boolean): boolean {
        const track = this.characterTracks.get(key)
        if (!track) return false
        track.lipSyncEnabled = enabled
        if (!enabled) {
            this.closeTrackMouth(track)
        } else if (track.status === 'playing') {
            track.carrier?.setOfficialPlaying(true)
        }
        this.emit()
        return true
    }

    update(deltaSeconds: number): void {
        if (this.disposed) return
        const safeDelta = Math.min(0.1, Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0))
        for (const track of this.characterTracks.values()) {
            if (track.status !== 'playing' || !track.audio || !track.lipSyncEnabled) continue
            if (track.audio.ended) {
                this.handleEnded(track, track.generation)
                continue
            }
            if (!track.analyserUsable || !track.graph?.analyser || !track.pcm) {
                track.carrier?.setOfficialPlaying(true)
                continue
            }
            try {
                track.graph.analyser.getFloatTimeDomainData(track.pcm)
                const frame = track.multiwave.updateFromPcm(
                    track.pcm,
                    safeDelta,
                    track.carrier?.getBaseMouthForm() ?? 0,
                )
                track.carrier?.setDrive(frame.mouthOpen, frame.mouthForm)
            } catch {
                track.analyserUsable = false
                track.multiwave.reset(track.carrier?.getBaseMouthForm() ?? 0)
                track.carrier?.setOfficialPlaying(true)
                this.emit()
            }
        }
    }

    async dispose(): Promise<void> {
        if (this.disposed) return
        this.disposed = true
        for (const track of this.characterTracks.values()) this.disposeTrack(track)
        for (const track of this.backgroundTracks.values()) this.disposeTrack(track)
        this.characterTracks.clear()
        this.backgroundTracks.clear()
        this.characterOrder = []
        const context = this.audioContext
        this.audioContext = null
        try {
            await context?.close?.()
        } finally {
            this.listeners.clear()
        }
    }

    private snapshotTrack(track: RuntimeTrack): VoiceUploadTrackSnapshot {
        const duration = finiteDuration(track.audio?.duration ?? Number.NaN)
        return {
            key: track.key,
            kind: track.kind,
            characterResourceId: track.descriptor?.characterResourceId ?? null,
            label: track.label,
            fileName: track.fileName,
            status: track.status,
            positionSeconds: trackPosition(track),
            durationSeconds: duration,
            volume: track.volume,
            loop: track.loop,
            lipSyncEnabled: track.kind === 'character' && track.lipSyncEnabled,
            analysisMode: track.kind !== 'character' || !track.fileName || !track.lipSyncEnabled
                ? 'none'
                : track.analyserUsable
                    ? 'multiwave'
                    : 'official-binary',
            mouthCarrier: track.carrier?.diagnostics ?? NO_MOUTH_DIAGNOSTICS,
            error: track.error,
        }
    }

    private createCharacterTrack(descriptor: VoiceUploadCharacterDescriptor): RuntimeTrack {
        const root = unwrapTarget(descriptor.target)
        const track = this.createTrack(descriptor.key, 'character', descriptor.label)
        track.descriptor = descriptor
        track.targetRoot = root
        track.carrier = root ? resolveMouthCarrier(root) : null
        if (root) this.attachTargetLifecycle(track, root)
        return track
    }

    private createBackgroundTrack(key: string, label: string): RuntimeTrack {
        return this.createTrack(key, 'background', label)
    }

    private createTrack(key: string, kind: VoiceUploadTrackKind, label: string): RuntimeTrack {
        return {
            key,
            kind,
            descriptor: null,
            label,
            targetRoot: null,
            carrier: null,
            targetDisposeCallbacks: null,
            targetDisposeCallback: null,
            targetRemovedListener: null,
            audio: null,
            objectUrl: null,
            graph: null,
            pcm: null,
            analyserUsable: false,
            multiwave: new DemoMultiwaveLipSync(),
            fileName: null,
            status: 'empty',
            volume: 1,
            loop: false,
            lipSyncEnabled: kind === 'character',
            error: null,
            generation: 0,
            endedListener: null,
            errorListener: null,
            metadataListener: null,
        }
    }

    private loadFile(track: RuntimeTrack, file: VoiceUploadFile): boolean {
        if (this.disposed || track.status === 'disposed') return false
        if (!isVoiceUploadFileSupported(file)) {
            track.error = `Unsupported local audio format: ${file.name}`
            this.emit()
            return false
        }

        this.releaseMedia(track)
        track.status = 'loading'
        track.error = null
        track.fileName = file.name
        const generation = track.generation
        let objectUrl: string | null = null
        try {
            objectUrl = this.environment.createObjectUrl(file)
            const audio = this.environment.createAudioElement()
            audio.crossOrigin = null
            audio.preload = 'metadata'
            audio.currentTime = 0
            audio.volume = track.volume
            audio.loop = track.loop
            audio.src = objectUrl
            track.audio = audio
            track.objectUrl = objectUrl
            track.endedListener = () => this.handleEnded(track, generation)
            track.errorListener = () => this.handleMediaError(track, generation)
            track.metadataListener = () => {
                if (generation !== track.generation || track.audio !== audio) return
                if (track.status === 'loading') track.status = 'ready'
                this.emit()
            }
            audio.addEventListener('ended', track.endedListener)
            audio.addEventListener('error', track.errorListener)
            audio.addEventListener('loadedmetadata', track.metadataListener)
            this.installAudioGraph(track, audio)
            audio.load()
            track.status = 'ready'
            this.emit()
            return true
        } catch (cause) {
            if (objectUrl && objectUrl !== track.objectUrl) {
                try { this.environment.revokeObjectUrl(objectUrl) } catch {}
            }
            this.releaseMedia(track)
            track.status = 'error'
            track.error = `Local audio load failed: ${file.name}: ${String(cause)}`
            this.emit()
            return false
        }
    }

    private async playTrack(track: RuntimeTrack): Promise<boolean> {
        const audio = track.audio
        if (this.disposed || track.status === 'disposed' || !audio) return false
        const generation = track.generation
        try {
            if (track.kind === 'character' && track.descriptor) {
                await this.environment.beforeCharacterPlay(track.descriptor)
            }
            if (generation !== track.generation || track.audio !== audio) return false
            const context = this.getAudioContext()
            if (context?.state === 'suspended') await context.resume?.()
            await audio.play()
        } catch (cause) {
            if (generation !== track.generation || track.audio !== audio) return false
            this.closeTrackMouth(track)
            track.status = 'error'
            track.error = `Local audio playback failed: ${track.fileName ?? track.key}: ${String(cause)}`
            this.emit()
            return false
        }
        if (generation !== track.generation || track.audio !== audio) return false
        track.status = 'playing'
        track.error = null
        if (track.kind === 'character' && track.lipSyncEnabled) {
            track.carrier?.setOfficialPlaying(true)
        }
        this.emit()
        return true
    }

    private pauseTrack(track: RuntimeTrack): boolean {
        if (!track.audio || track.status !== 'playing') return false
        track.audio.pause()
        track.status = 'paused'
        this.closeTrackMouth(track)
        this.emit()
        return true
    }

    private stopTrack(track: RuntimeTrack): boolean {
        if (!track.audio) {
            this.closeTrackMouth(track)
            return false
        }
        track.audio.pause()
        try { track.audio.currentTime = 0 } catch {}
        track.status = 'ready'
        track.error = null
        this.closeTrackMouth(track)
        this.emit()
        return true
    }

    private seekTrack(track: RuntimeTrack, positionSeconds: number): boolean {
        if (!track.audio || !Number.isFinite(positionSeconds)) return false
        const duration = finiteDuration(track.audio.duration)
        const position = Math.max(0, duration === null
            ? positionSeconds
            : Math.min(duration, positionSeconds))
        try {
            track.audio.currentTime = position
        } catch {
            return false
        }
        if (track.status === 'ended') track.status = 'paused'
        if (track.kind === 'character' && track.status === 'playing' && track.lipSyncEnabled) {
            track.carrier?.setOfficialPlaying(true)
        }
        this.emit()
        return true
    }

    private setTrackVolume(track: RuntimeTrack, volume: number): boolean {
        track.volume = clampVolume(volume)
        if (track.graph?.gain?.gain) {
            track.graph.gain.gain.value = track.volume
            if (track.audio) track.audio.volume = 1
        } else if (track.audio) {
            track.audio.volume = clamp01(track.volume)
        }
        this.emit()
        return true
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

    private installAudioGraph(
        track: RuntimeTrack,
        audio: VoiceUploadAudioElementLike,
    ): void {
        track.graph = null
        track.pcm = null
        track.analyserUsable = false
        const context = this.getAudioContext()
        if (!context) return

        let source: VoiceAudioNodeLike | null = null
        let gain: VoiceGainNodeLike | null = null
        let analyser: VoiceAnalyserNodeLike | null = null
        try {
            source = context.createMediaElementSource(audio)
            gain = context.createGain() as VoiceGainNodeLike
            if (gain.gain) gain.gain.value = track.volume
            audio.volume = 1
            source.connect(gain)
            if (track.kind === 'background') {
                gain.connect(context.destination)
                track.graph = { source, gain, analyser: null }
                return
            }
            try {
                analyser = context.createAnalyser()
                analyser.fftSize = DEMO_LIPSYNC_CONSTANTS.analyserFftSize
                gain.connect(analyser)
                analyser.connect(context.destination)
                track.graph = { source, gain, analyser }
                track.pcm = new Float32Array(analyser.frequencyBinCount)
                track.analyserUsable = true
            } catch {
                try { analyser?.disconnect() } catch {}
                try { gain.disconnect() } catch {}
                gain.connect(context.destination)
                track.graph = { source, gain, analyser: null }
            }
        } catch (cause) {
            try { source?.disconnect() } catch {}
            try { gain?.disconnect() } catch {}
            try { (analyser as VoiceAudioNodeLike | null)?.disconnect() } catch {}
            track.graph = null
            track.pcm = null
            track.analyserUsable = false
            throw cause
        }
    }

    private releaseMedia(track: RuntimeTrack): void {
        track.generation++
        this.closeTrackMouth(track)
        const audio = track.audio
        if (audio) {
            if (track.endedListener) audio.removeEventListener('ended', track.endedListener)
            if (track.errorListener) audio.removeEventListener('error', track.errorListener)
            if (track.metadataListener) audio.removeEventListener('loadedmetadata', track.metadataListener)
            try { audio.pause() } catch {}
            try { audio.removeAttribute('src') } catch {}
            audio.src = ''
            try { audio.load() } catch {}
        }
        if (track.graph) {
            try { track.graph.source.disconnect() } catch {}
            try { track.graph.gain?.disconnect() } catch {}
            try { track.graph.analyser?.disconnect() } catch {}
        }
        if (track.objectUrl) {
            try { this.environment.revokeObjectUrl(track.objectUrl) } catch {}
        }
        track.audio = null
        track.objectUrl = null
        track.graph = null
        track.pcm = null
        track.analyserUsable = false
        track.fileName = null
        track.endedListener = null
        track.errorListener = null
        track.metadataListener = null
    }

    private closeTrackMouth(track: RuntimeTrack): void {
        track.carrier?.close()
        track.multiwave.reset(track.carrier?.getBaseMouthForm() ?? 0)
    }

    private handleEnded(track: RuntimeTrack, generation: number): void {
        if (generation !== track.generation || track.status === 'disposed') return
        if (track.loop) return
        track.status = 'ended'
        track.error = null
        this.closeTrackMouth(track)
        this.emit()
    }

    private handleMediaError(track: RuntimeTrack, generation: number): void {
        if (generation !== track.generation || track.status === 'disposed') return
        track.status = 'error'
        track.error = `Local audio media error: ${track.fileName ?? track.key}`
        this.closeTrackMouth(track)
        this.emit()
    }

    private attachTargetLifecycle(track: RuntimeTrack, root: THREE.Object3D): void {
        const removedListener = () => this.handleTargetDisposed(track.key, root)
        track.targetRemovedListener = removedListener
        ;(root as unknown as ObjectEventTarget).addEventListener('removed', removedListener)
        const disposeCallbacks = root.userData.disposeCallbacks
        if (Array.isArray(disposeCallbacks)) {
            const callback = () => this.handleTargetDisposed(track.key, root)
            track.targetDisposeCallbacks = disposeCallbacks as Array<() => void>
            track.targetDisposeCallback = callback
            track.targetDisposeCallbacks.push(callback)
        }
    }

    private detachTargetLifecycle(track: RuntimeTrack): void {
        if (track.targetRoot && track.targetRemovedListener) {
            ;(track.targetRoot as unknown as ObjectEventTarget)
                .removeEventListener('removed', track.targetRemovedListener)
        }
        if (track.targetDisposeCallbacks && track.targetDisposeCallback) {
            removeArrayValue(track.targetDisposeCallbacks, track.targetDisposeCallback)
        }
        track.targetDisposeCallbacks = null
        track.targetDisposeCallback = null
        track.targetRemovedListener = null
    }

    private handleTargetDisposed(key: string, root: THREE.Object3D): void {
        const track = this.characterTracks.get(key)
        if (!track || track.targetRoot !== root) return
        this.characterTracks.delete(key)
        this.characterOrder = this.characterOrder.filter(value => value !== key)
        this.disposeTrack(track)
        this.emit()
    }

    private disposeTrack(track: RuntimeTrack): void {
        if (track.status === 'disposed') return
        this.releaseMedia(track)
        this.detachTargetLifecycle(track)
        track.carrier?.close()
        track.carrier = null
        track.targetRoot = null
        track.descriptor = null
        track.status = 'disposed'
    }

    private emit(): void {
        if (this.disposed) return
        const snapshot = this.snapshot
        for (const listener of this.listeners) listener(snapshot)
    }
}
