import { setupFloatingPanelResize } from './floatingPanelInteraction'
import { createVoicePoseChannelProvider, type VoicePoseChannelRequest, type VoicePoseAvailability, type VoicePoseChannelLease } from './voice/poseChannels.ts'
import {
    VoicePlayer,
    VOICE_UPLOAD_ACCEPT,
    VOICE_SUBTITLE_DEFAULT_MODE,
    fetchVoiceCatalogManifest,
    fetchVoiceScenarioManifest,
    isVoiceRuntimeReady,
    type VoiceCatalogEntry,
    type VoiceCharacterTarget,
    type VoicePlayerSnapshot,
    type VoiceScenarioEntry,
} from './voice/index'
import { getCharacterTrilingualName } from './localization/characterNames'
import { getUiLocale, translateUiText } from './localization/zhCN'
import { resolveRuntimeVoiceUrl } from './runtimeProductDelivery'

export const VOICE_AUDIO_BASE_QUERY = 'voiceAudioBaseUrl' as const
export const VOICE_LANGUAGE_STORAGE_KEY = 'magius-voice-subtitle-locale' as const
export const VOICE_PANEL_VIEWPORT_GAP = 8 as const
export const VOICE_PANEL_VISIBLE_GRIP = 48 as const
export const VOICE_MULTITRACK_AUDIO_ACCEPT = VOICE_UPLOAD_ACCEPT

export interface VoicePanelWorkspaceCharacter {
    actorKey: string
    characterResourceId: string
    target: VoiceCharacterTarget
    label?: string
}

export type VoicePanelWorkspaceTrackKind = 'character' | 'background'
export type VoicePanelWorkspaceTrackStatus = 'empty' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error'

export interface VoicePanelWorkspaceTrackSnapshot {
    trackId: string
    kind: VoicePanelWorkspaceTrackKind
    actorKey?: string
    fileName: string
    status: VoicePanelWorkspaceTrackStatus
    positionSeconds: number
    durationSeconds: number
    volume: number
    loop: boolean
    lipSync: boolean
    reason?: string
}

export type VoicePanelWorkspaceCommand =
    | { type: 'play' | 'pause' | 'stop' | 'remove'; trackId: string }
    | { type: 'seek'; trackId: string; seconds: number }
    | { type: 'volume'; trackId: string; value: number }
    | { type: 'loop'; trackId: string; enabled: boolean }
    | { type: 'lip-sync'; trackId: string; enabled: boolean }

export interface VoicePanelWorkspaceRuntime {
    snapshot(): readonly VoicePanelWorkspaceTrackSnapshot[]
    subscribe(listener: (tracks: readonly VoicePanelWorkspaceTrackSnapshot[]) => void): () => void
    setCharacters?(characters: readonly VoicePanelWorkspaceCharacter[]): void | Promise<void>
    uploadCharacterTrack(character: VoicePanelWorkspaceCharacter, file: File): void | Promise<void>
    uploadBackgroundTrack(file: File): void | Promise<void>
    dispatch(command: VoicePanelWorkspaceCommand): void | Promise<void>
    setBeforeCharacterPlay?(handler: ((character: VoicePanelWorkspaceCharacter) => void | Promise<void>) | null): void
    stopCharacterForTarget?(target: VoiceCharacterTarget): void | Promise<void>
    update?(deltaSeconds: number): void
    dispose?(): void | Promise<void>
}

export interface VoicePanelOptions {
    workspaceRuntime?: VoicePanelWorkspaceRuntime
}

const VOICE_SUBTITLE_LANGUAGES = ['zh-Hans', 'ja-Jpan', 'en-Latn'] as const
type VoiceSubtitleLanguage = (typeof VOICE_SUBTITLE_LANGUAGES)[number]

const AUDIO_BASE_OVERRIDE = new URLSearchParams(location.search)
    .get(VOICE_AUDIO_BASE_QUERY)?.trim() ?? ''
const AUDIO_BASE_URL = AUDIO_BASE_OVERRIDE || new URL('/voice/Cv/', location.origin).href

interface VoicePanelElements {
    toggle: HTMLButtonElement
    panel: HTMLElement
    title: HTMLElement
    header: HTMLElement
    close: HTMLButtonElement
    footer: HTMLElement
    resizeHandle: HTMLElement
    subtitleModeLabel: HTMLLabelElement
    subtitleMode: HTMLSelectElement
    subtitleToggle: HTMLInputElement
    subtitleToggleLabel: HTMLElement
    motionToggle: HTMLInputElement
    motionToggleLabel: HTMLElement
    expressionToggle: HTMLInputElement
    expressionToggleLabel: HTMLElement
    multitrackSection: HTMLDetailsElement
    multitrackSummary: HTMLElement
    workspaceBody: HTMLElement
    characterTracksTitle: HTMLElement
    characterTracks: HTMLDivElement
    backgroundTracksTitle: HTMLElement
    backgroundTrackAdd: HTMLButtonElement
    backgroundTrackFile: HTMLInputElement
    backgroundTracks: HTMLDivElement
    backgroundLipSyncNote: HTMLElement
    workspaceStatus: HTMLOutputElement
    subtitleStatus: HTMLOutputElement
    list: HTMLDivElement
    catalogStatus: HTMLOutputElement
    transport: HTMLElement
    previous: HTMLButtonElement
    play: HTMLButtonElement
    queue: HTMLButtonElement
    pause: HTMLButtonElement
    resume: HTMLButtonElement
    stop: HTMLButtonElement
    next: HTMLButtonElement
    progress: HTMLInputElement
    progressValue: HTMLOutputElement
    runtimeStatus: HTMLOutputElement
    operationStatus: HTMLOutputElement
    subtitle: HTMLOutputElement
}

export interface VoicePanelController {
    acquirePoseChannels(request: VoicePoseChannelRequest): VoicePoseAvailability<VoicePoseChannelLease>
    setCharacter(characterResourceId: string | null, target: VoiceCharacterTarget): void
    setWorkspaceCharacters(characters: readonly VoicePanelWorkspaceCharacter[]): void
    update(nowMilliseconds?: number): void
    dispose(): Promise<void>
}

export interface VoicePanelRect {
    left: number
    top: number
    width: number
    height: number
}

export interface VoiceListPreview {
    text: string
    requestedLocale: VoiceSubtitleLanguage
    resolvedLocale: VoiceSubtitleLanguage | null
    fallbackApplied: boolean
    reason: string | null
}

let activeController: VoicePanelController | undefined
let highestVoicePanelZIndex = 11001

function requireElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id)
    if (!element) throw new Error(`Missing voice UI element: #${id}`)
    return element as T
}

function collectElements(): VoicePanelElements {
    return {
        toggle: requireElement<HTMLButtonElement>('voice-panel-toggle'),
        panel: requireElement<HTMLElement>('voice-panel'),
        title: requireElement<HTMLElement>('voice-panel-title'),
        header: requireElement<HTMLElement>('voice-panel').querySelector<HTMLElement>('.voice-panel-header')!,
        close: requireElement<HTMLButtonElement>('voice-panel-close'),
        footer: requireElement<HTMLElement>('voice-panel').querySelector<HTMLElement>('.voice-panel-footer')!,
        resizeHandle: requireElement<HTMLElement>('voice-panel').querySelector<HTMLElement>('.voice-panel-resize-handle')!,
        subtitleModeLabel: requireElement<HTMLLabelElement>('voice-subtitle-mode-label'),
        subtitleMode: requireElement<HTMLSelectElement>('voice-subtitle-mode'),
        subtitleToggle: requireElement<HTMLInputElement>('voice-subtitle-toggle'),
        subtitleToggleLabel: requireElement<HTMLElement>('voice-subtitle-toggle-label'),
        motionToggle: requireElement<HTMLInputElement>('voice-motion-toggle'),
        motionToggleLabel: requireElement<HTMLElement>('voice-motion-toggle-label'),
        expressionToggle: requireElement<HTMLInputElement>('voice-expression-toggle'),
        expressionToggleLabel: requireElement<HTMLElement>('voice-expression-toggle-label'),
        multitrackSection: requireElement<HTMLDetailsElement>('voice-multitrack-section'),
        multitrackSummary: requireElement<HTMLElement>('voice-multitrack-summary'),
        workspaceBody: requireElement<HTMLElement>('voice-workspace-body'),
        characterTracksTitle: requireElement<HTMLElement>('voice-character-tracks-title'),
        characterTracks: requireElement<HTMLDivElement>('voice-character-tracks'),
        backgroundTracksTitle: requireElement<HTMLElement>('voice-background-tracks-title'),
        backgroundTrackAdd: requireElement<HTMLButtonElement>('voice-background-track-add'),
        backgroundTrackFile: requireElement<HTMLInputElement>('voice-background-track-file'),
        backgroundTracks: requireElement<HTMLDivElement>('voice-background-tracks'),
        backgroundLipSyncNote: requireElement<HTMLElement>('voice-background-lipsync-note'),
        workspaceStatus: requireElement<HTMLOutputElement>('voice-workspace-status'),
        subtitleStatus: requireElement<HTMLOutputElement>('voice-subtitle-status'),
        list: requireElement<HTMLDivElement>('voice-list'),
        catalogStatus: requireElement<HTMLOutputElement>('voice-catalog-status'),
        transport: requireElement<HTMLElement>('voice-transport'),
        previous: requireElement<HTMLButtonElement>('voice-previous'),
        play: requireElement<HTMLButtonElement>('voice-play'),
        queue: requireElement<HTMLButtonElement>('voice-play-queue'),
        pause: requireElement<HTMLButtonElement>('voice-pause'),
        resume: requireElement<HTMLButtonElement>('voice-resume'),
        stop: requireElement<HTMLButtonElement>('voice-stop'),
        next: requireElement<HTMLButtonElement>('voice-next'),
        progress: requireElement<HTMLInputElement>('voice-progress'),
        progressValue: requireElement<HTMLOutputElement>('voice-progress-value'),
        runtimeStatus: requireElement<HTMLOutputElement>('voice-runtime-status'),
        operationStatus: requireElement<HTMLOutputElement>('voice-operation-status'),
        subtitle: requireElement<HTMLOutputElement>('voice-subtitle-overlay'),
    }
}

function isVoiceSubtitleLanguage(value: string): value is VoiceSubtitleLanguage {
    return (VOICE_SUBTITLE_LANGUAGES as readonly string[]).includes(value)
}

function voiceSubtitleLanguageLabel(mode: VoiceSubtitleLanguage): string {
    switch (mode) {
        case 'zh-Hans': return '中文'
        case 'ja-Jpan': return '日本語'
        case 'en-Latn': return 'English'
    }
}

function localeHtmlLanguage(locale: string): string {
    switch (locale) {
        case 'zh-Hans': return 'zh-Hans'
        case 'zh-Hant': return 'zh-Hant'
        case 'ja-Jpan': return 'ja-JP'
        case 'en-Latn': return 'en'
        default: return 'en'
    }
}

function formatTime(seconds: number): string {
    const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
    const minutes = Math.floor(safe / 60)
    const remainder = Math.floor(safe % 60)
    return `${minutes}:${String(remainder).padStart(2, '0')}`
}

function normalizePreviewComment(comment: string): string {
    return comment.trim().replace(/\s*\n+\s*/g, ' ').replace(/[\t ]+/g, ' ')
}

function voiceCharacterDisplayName(characterResourceId: string): string {
    const names = getCharacterTrilingualName(characterResourceId, characterResourceId)
    const uiLocale = getUiLocale()
    const officialName = uiLocale === 'ja-JP' ? names.ja : uiLocale === 'en' ? names.romaji : names.zh
    return officialName.replace(/\s*[（(].*$/, '').trim() || officialName
}

function formatVoiceDuration(entry: VoiceCatalogEntry): string {
    const duration = entry.durationSeconds
    return typeof duration === 'number' && Number.isFinite(duration) && duration > 0
        ? `${duration.toFixed(1)}s`
        : ''
}

export function resolveVoiceListPreview(
    entry: VoiceScenarioEntry | undefined,
    requestedLocale: VoiceSubtitleLanguage,
): VoiceListPreview {
    if (!entry) {
        return {
            text: '',
            requestedLocale,
            resolvedLocale: null,
            fallbackApplied: false,
            reason: 'official scenario entry missing',
        }
    }
    const source = entry.reactionSources[requestedLocale]
    if (!source.runtimeReady) {
        return {
            text: '',
            requestedLocale,
            resolvedLocale: null,
            fallbackApplied: false,
            reason: source.failClosedReasons.join('; ') || 'official subtitle source unavailable',
        }
    }
    const text = source.rows
        .filter(row => row.ActionType === 'Talk' && typeof row.Comment === 'string')
        .map(row => normalizePreviewComment(row.Comment!))
        .filter(Boolean)
        .join(' ')
    return {
        text,
        requestedLocale,
        resolvedLocale: requestedLocale,
        fallbackApplied: false,
        reason: null,
    }
}

export function clampVoicePanelRect(
    rect: VoicePanelRect,
    viewportWidth: number,
    viewportHeight: number,
    gap = VOICE_PANEL_VIEWPORT_GAP,
): VoicePanelRect {
    const availableWidth = Math.max(1, viewportWidth - gap * 2)
    const availableHeight = Math.max(1, viewportHeight - gap * 2)
    const width = Math.min(Math.max(1, rect.width), availableWidth)
    const height = Math.min(Math.max(1, rect.height), availableHeight)
    const maxLeft = Math.max(gap, viewportWidth - width - gap)
    const maxTop = Math.max(gap, viewportHeight - height - gap)
    return {
        left: Math.min(Math.max(rect.left, gap), maxLeft),
        top: Math.min(Math.max(rect.top, gap), maxTop),
        width,
        height,
    }
}

export function clampVoicePanelDragRect(
    rect: VoicePanelRect,
    _viewportWidth: number,
    _viewportHeight: number,
    _visibleGrip = VOICE_PANEL_VISIBLE_GRIP,
): VoicePanelRect {
    // User positioning is intentionally unbounded, including complete offscreen placement.
    return { left: rect.left, top: rect.top, width: Math.max(1, rect.width), height: Math.max(1, rect.height) }
}

function readPanelRect(panel: HTMLElement): VoicePanelRect {
    const rect = panel.getBoundingClientRect()
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

function writePanelRect(panel: HTMLElement, rect: VoicePanelRect, includeSize = false): void {
    panel.style.left = `${Math.round(rect.left)}px`
    panel.style.top = `${Math.round(rect.top)}px`
    panel.style.right = 'auto'
    panel.style.bottom = 'auto'
    panel.style.transform = 'none'
    panel.style.margin = '0'
    if (includeSize) {
        panel.style.width = `${Math.round(rect.width)}px`
        panel.style.height = `${Math.round(rect.height)}px`
    }
}

function anchorVoicePanel(panel: HTMLElement): VoicePanelRect {
    const rect = readPanelRect(panel)
    writePanelRect(panel, rect)
    panel.dataset.voicePanelAnchored = 'true'
    return readPanelRect(panel)
}

function ensureVoicePanelInViewport(panel: HTMLElement): void {
    if (!panel.classList.contains('is-open')) return
    const current = panel.dataset.voicePanelAnchored === 'true'
        ? readPanelRect(panel)
        : anchorVoicePanel(panel)
    const userPositioned = panel.dataset.panelUserPositioned === 'true'
    const bounded = userPositioned
        ? clampVoicePanelDragRect(current, window.innerWidth, window.innerHeight)
        : clampVoicePanelRect(current, window.innerWidth, window.innerHeight)
    const sizeChanged = !userPositioned && (
        Math.abs(current.width - bounded.width) > 0.5
        || Math.abs(current.height - bounded.height) > 0.5
    )
    writePanelRect(panel, bounded, sizeChanged)
}

function setupVoicePanelInteraction(elements: VoicePanelElements): () => void {
    const abort = new AbortController()
    const signal = abort.signal
    const panel = elements.panel
    const disposeTopLeftResize = setupFloatingPanelResize(panel, 'nw')

    interface Interaction {
        pointerId: number
        startX: number
        startY: number
        left: number
        top: number
        width: number
        height: number
    }

    let drag: Interaction | null = null
    let resize: Interaction | null = null

    const bringToFront = () => {
        highestVoicePanelZIndex += 1
        panel.style.zIndex = String(highestVoicePanelZIndex)
    }
    const begin = (event: PointerEvent): Interaction | null => {
        if (!event.isPrimary || event.button !== 0) return null
        bringToFront()
        const rect = anchorVoicePanel(panel)
        panel.dataset.panelUserPositioned = 'true'
        writePanelRect(panel, rect, true)
        document.documentElement.classList.add('floating-panel-interacting')
        return {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
        }
    }
    const end = (target: HTMLElement, pointerId: number) => {
        if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
        drag = null
        resize = null
        document.documentElement.classList.remove('floating-panel-interacting')
    }
    const attachDragHandle = (handle: HTMLElement, ignoreControls: boolean) => {
        handle.addEventListener('pointerdown', event => {
            if (ignoreControls && event.target instanceof Element
                && event.target.closest('button, input, select, textarea, a, label')) return
            drag = begin(event)
            if (!drag) return
            handle.setPointerCapture(event.pointerId)
            event.preventDefault()
        }, { signal })
        handle.addEventListener('pointermove', event => {
            if (!drag || drag.pointerId !== event.pointerId) return
            const next = clampVoicePanelDragRect({
                left: drag.left + event.clientX - drag.startX,
                top: drag.top + event.clientY - drag.startY,
                width: drag.width,
                height: drag.height,
            }, window.innerWidth, window.innerHeight)
            writePanelRect(panel, next)
            event.preventDefault()
        }, { signal })
        const finish = (event: PointerEvent) => {
            if (drag?.pointerId === event.pointerId) end(handle, event.pointerId)
        }
        handle.addEventListener('pointerup', finish, { signal })
        handle.addEventListener('pointercancel', finish, { signal })
    }

    attachDragHandle(elements.header, true)
    attachDragHandle(elements.footer, false)

    elements.resizeHandle.addEventListener('pointerdown', event => {
        resize = begin(event)
        if (!resize) return
        elements.resizeHandle.setPointerCapture(event.pointerId)
        event.stopPropagation()
        event.preventDefault()
    }, { signal })
    elements.resizeHandle.addEventListener('pointermove', event => {
        if (!resize || resize.pointerId !== event.pointerId) return
        const minimumWidth = 320
        const minimumHeight = 250
        writePanelRect(panel, {
            left: resize.left,
            top: resize.top,
            width: Math.max(resize.width + event.clientX - resize.startX, minimumWidth),
            height: Math.max(resize.height + event.clientY - resize.startY, minimumHeight),
        }, true)
        event.preventDefault()
    }, { signal })
    const finishResize = (event: PointerEvent) => {
        if (resize?.pointerId === event.pointerId) end(elements.resizeHandle, event.pointerId)
    }
    elements.resizeHandle.addEventListener('pointerup', finishResize, { signal })
    elements.resizeHandle.addEventListener('pointercancel', finishResize, { signal })
    panel.addEventListener('pointerdown', bringToFront, { capture: true, signal })
    window.addEventListener('resize', () => ensureVoicePanelInViewport(panel), { passive: true, signal })

    return () => {
        abort.abort()
        disposeTopLeftResize()
        document.documentElement.classList.remove('floating-panel-interacting')
    }
}

function loadSavedSubtitleLanguage(): VoiceSubtitleLanguage {
    try {
        const saved = localStorage.getItem(VOICE_LANGUAGE_STORAGE_KEY) ?? ''
        if (isVoiceSubtitleLanguage(saved)) return saved
    } catch {
        // Storage is optional; the official default remains zh-Hans.
    }
    return VOICE_SUBTITLE_DEFAULT_MODE
}

function saveSubtitleLanguage(locale: VoiceSubtitleLanguage): void {
    try {
        localStorage.setItem(VOICE_LANGUAGE_STORAGE_KEY, locale)
    } catch {
        // Storage is optional; the live selection still applies.
    }
}

export function setupVoicePanel(options: VoicePanelOptions = {}): VoicePanelController {
    void activeController?.dispose()

    const elements = collectElements()
    const stopInteraction = setupVoicePanelInteraction(elements)
    const fetchAbort = new AbortController()
    let voice: VoicePlayer | null = null
    let snapshot: VoicePlayerSnapshot | null = null
    let scenarioEntries = new Map<string, VoiceScenarioEntry>()
    let scenarioLoadError: string | null = null
    let pendingCharacterId: string | null = null
    let pendingTarget: VoiceCharacterTarget = null
    let selectedStableKey = ''
    let unsubscribe: (() => void) | undefined
    let disposed = false
    const poseChannels = createVoicePoseChannelProvider()
    let operationPending = false
    let operationGeneration = 0
    let operationStatusKey: string | null = null
    let operationStatusDetail: string | null = null
    let operationStatusRaw: string | null = null
    let lastUpdateMilliseconds = performance.now()
    let lastWorkspaceRefreshMilliseconds = 0
    let lastRenderedCurrentStableKey: string | null = null
    let subtitleLanguage: VoiceSubtitleLanguage = loadSavedSubtitleLanguage()
    let workspaceCharacters: readonly VoicePanelWorkspaceCharacter[] = []
    let workspaceTracks: readonly VoicePanelWorkspaceTrackSnapshot[] = options.workspaceRuntime?.snapshot() ?? []
    let workspaceUnsubscribe: (() => void) | undefined
    let workspacePending = new Set<string>()
    let workspaceStatusKey: string | null = options.workspaceRuntime ? null : 'Multitrack runtime is not connected'
    let workspaceStatusDetail: string | null = null

    const selectedEntry = (): VoiceCatalogEntry | undefined => (
        voice?.entries.find(entry => entry.stableKey === selectedStableKey)
    )
    const activeSubtitleMode = () => elements.subtitleToggle.checked ? subtitleLanguage : 'off'
    const applyScenarioOptions = () => {
        const options = {
            useMotion: elements.motionToggle.checked,
            useExpression: elements.expressionToggle.checked,
        }
        voice?.setScenarioOptions(options)
        elements.panel.dataset.useMotion = String(options.useMotion)
        elements.panel.dataset.useExpression = String(options.useExpression)
    }

    const renderOperationStatus = () => {
        if (operationStatusRaw !== null) {
            elements.operationStatus.textContent = operationStatusRaw
            return
        }
        if (operationStatusKey === null) {
            elements.operationStatus.textContent = ''
            return
        }
        const translated = translateUiText(operationStatusKey)
        elements.operationStatus.textContent = operationStatusDetail === null
            ? translated
            : `${translated}: ${operationStatusDetail}`
    }
    const setOperationStatus = (key: string, detail: string | null = null) => {
        operationStatusKey = key
        operationStatusDetail = detail
        operationStatusRaw = null
        renderOperationStatus()
    }
    const setRawOperationStatus = (value: string) => {
        operationStatusKey = null
        operationStatusDetail = null
        operationStatusRaw = value
        renderOperationStatus()
    }

    const renderWorkspaceStatus = () => {
        elements.workspaceStatus.textContent = workspaceStatusKey === null
            ? ''
            : `${translateUiText(workspaceStatusKey)}${workspaceStatusDetail === null ? '' : `: ${workspaceStatusDetail}`}`
    }
    const setWorkspaceStatus = (key: string | null, detail: string | null = null) => {
        workspaceStatusKey = key
        workspaceStatusDetail = detail
        renderWorkspaceStatus()
    }
    const workspaceTrackForCharacter = (actorKey: string) => workspaceTracks.find(track => (
        track.kind === 'character' && track.actorKey === actorKey
    ))
    const workspaceTrackLabel = (track: VoicePanelWorkspaceTrackSnapshot | undefined) => {
        if (!track) return translateUiText('No audio loaded')
        const status = translateUiText(track.status)
        return track.fileName ? `${track.fileName} · ${status}` : status
    }
    const workspaceButton = (
        label: string,
        className: string,
        disabled: boolean,
        onclick: () => void,
    ) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = className
        button.textContent = translateUiText(label)
        button.disabled = disabled
        button.onclick = onclick
        return button
    }
    const refreshWorkspaceFromRuntime = () => {
        workspaceTracks = options.workspaceRuntime?.snapshot() ?? []
    }
    const runWorkspaceCommand = async (command: VoicePanelWorkspaceCommand) => {
        const runtime = options.workspaceRuntime
        if (!runtime) {
            setWorkspaceStatus('Multitrack runtime is not connected')
            return
        }
        if (workspacePending.has(command.trackId)) return
        workspacePending.add(command.trackId)
        renderWorkspace()
        try {
            await runtime.dispatch(command)
            refreshWorkspaceFromRuntime()
            setWorkspaceStatus(null)
        } catch (error) {
            setWorkspaceStatus('Audio workspace operation failed', error instanceof Error ? error.message : String(error))
        } finally {
            workspacePending.delete(command.trackId)
            renderWorkspace()
        }
    }
    const uploadCharacterAudio = async (character: VoicePanelWorkspaceCharacter, file: File) => {
        const runtime = options.workspaceRuntime
        if (!runtime) {
            setWorkspaceStatus('Multitrack runtime is not connected')
            return
        }
        const pendingKey = `character:${character.actorKey}`
        if (workspacePending.has(pendingKey)) return
        workspacePending.add(pendingKey)
        renderWorkspace()
        try {
            await runtime.uploadCharacterTrack(character, file)
            refreshWorkspaceFromRuntime()
            setWorkspaceStatus(null)
        } catch (error) {
            setWorkspaceStatus('Audio workspace operation failed', error instanceof Error ? error.message : String(error))
        } finally {
            workspacePending.delete(pendingKey)
            renderWorkspace()
        }
    }
    const uploadBackgroundAudio = async (file: File) => {
        const runtime = options.workspaceRuntime
        if (!runtime) {
            setWorkspaceStatus('Multitrack runtime is not connected')
            return
        }
        const pendingKey = 'background-upload'
        if (workspacePending.has(pendingKey)) return
        workspacePending.add(pendingKey)
        renderWorkspace()
        try {
            await runtime.uploadBackgroundTrack(file)
            refreshWorkspaceFromRuntime()
            setWorkspaceStatus(null)
        } catch (error) {
            setWorkspaceStatus('Audio workspace operation failed', error instanceof Error ? error.message : String(error))
        } finally {
            workspacePending.delete(pendingKey)
            renderWorkspace()
        }
    }
    const appendWorkspaceTrackBody = (
        details: HTMLDetailsElement,
        track: VoicePanelWorkspaceTrackSnapshot | undefined,
        character?: VoicePanelWorkspaceCharacter,
    ) => {
        const body = document.createElement('div')
        body.className = 'voice-workspace-track-body'
        const uploadLabel = document.createElement('label')
        uploadLabel.className = 'voice-workspace-upload'
        uploadLabel.textContent = translateUiText('Upload audio')
        const upload = document.createElement('input')
        upload.type = 'file'
        upload.accept = VOICE_MULTITRACK_AUDIO_ACCEPT
        upload.disabled = workspacePending.has(character ? `character:${character.actorKey}` : 'background-upload')
        upload.onchange = () => {
            const file = upload.files?.[0]
            upload.value = ''
            if (!file) return
            if (character) void uploadCharacterAudio(character, file)
            else void uploadBackgroundAudio(file)
        }
        uploadLabel.append(upload)

        const actionRow = document.createElement('div')
        actionRow.className = 'voice-workspace-actions'
        const trackPending = Boolean(track && workspacePending.has(track.trackId))
        const canPlay = Boolean(track && !trackPending && ['ready', 'paused', 'ended'].includes(track.status))
        const canPause = Boolean(track && !trackPending && track.status === 'playing')
        const canStop = Boolean(track && !trackPending && ['loading', 'playing', 'paused'].includes(track.status))
        actionRow.append(
            workspaceButton('Play', 'voice-workspace-play', !canPlay, () => track && void runWorkspaceCommand({ type: 'play', trackId: track.trackId })),
            workspaceButton('Pause', 'voice-workspace-pause', !canPause, () => track && void runWorkspaceCommand({ type: 'pause', trackId: track.trackId })),
            workspaceButton('Stop', 'voice-workspace-stop', !canStop, () => track && void runWorkspaceCommand({ type: 'stop', trackId: track.trackId })),
            workspaceButton(
                character ? 'Clear track' : 'Delete track',
                'voice-workspace-remove',
                !track || trackPending,
                () => track && void runWorkspaceCommand({ type: 'remove', trackId: track.trackId }),
            ),
        )

        const seekRow = document.createElement('div')
        seekRow.className = 'voice-workspace-seek'
        const seek = document.createElement('input')
        seek.type = 'range'
        seek.min = '0'
        seek.max = String(track?.durationSeconds && track.durationSeconds > 0 ? track.durationSeconds : 1)
        seek.step = '0.01'
        seek.value = String(Math.min(track?.positionSeconds ?? 0, track?.durationSeconds || 0))
        seek.disabled = !track || trackPending || track.durationSeconds <= 0 || track.status === 'loading'
        seek.dataset.workspaceRole = 'seek'
        const time = document.createElement('output')
        time.dataset.workspaceRole = 'time'
        time.textContent = `${formatTime(track?.positionSeconds ?? 0)} / ${track && track.durationSeconds > 0 ? formatTime(track.durationSeconds) : '—'}`
        seek.oninput = () => {
            time.textContent = `${formatTime(Number(seek.value))} / ${track && track.durationSeconds > 0 ? formatTime(track.durationSeconds) : '—'}`
        }
        seek.onchange = () => track && void runWorkspaceCommand({ type: 'seek', trackId: track.trackId, seconds: Number(seek.value) })
        seekRow.append(seek, time)

        const settingsRow = document.createElement('div')
        settingsRow.className = 'voice-workspace-settings'
        const volumeLabel = document.createElement('label')
        volumeLabel.className = 'voice-workspace-volume'
        const volumeText = document.createElement('span')
        volumeText.textContent = translateUiText('Volume')
        const volume = document.createElement('input')
        volume.type = 'range'
        volume.min = '0'
        volume.max = '2'
        volume.step = '0.01'
        volume.value = String(track?.volume ?? 1)
        volume.disabled = !track || trackPending
        volume.dataset.workspaceRole = 'volume'
        const volumeValue = document.createElement('output')
        volumeValue.dataset.workspaceRole = 'volume-value'
        volumeValue.textContent = `${Math.round((track?.volume ?? 1) * 100)}%`
        volume.oninput = () => { volumeValue.textContent = `${Math.round(Number(volume.value) * 100)}%` }
        volume.onchange = () => track && void runWorkspaceCommand({ type: 'volume', trackId: track.trackId, value: Number(volume.value) })
        volumeLabel.append(volumeText, volume, volumeValue)
        settingsRow.append(volumeLabel)

        const toggleLabel = document.createElement('label')
        toggleLabel.className = 'voice-workspace-toggle'
        const toggle = document.createElement('input')
        toggle.type = 'checkbox'
        toggle.disabled = !track || trackPending
        if (character) {
            toggle.checked = track?.lipSync ?? true
            toggle.onchange = () => track && void runWorkspaceCommand({ type: 'lip-sync', trackId: track.trackId, enabled: toggle.checked })
            toggleLabel.append(toggle, document.createTextNode(translateUiText('Lip sync')))
        } else {
            toggle.checked = track?.loop ?? true
            toggle.onchange = () => track && void runWorkspaceCommand({ type: 'loop', trackId: track.trackId, enabled: toggle.checked })
            toggleLabel.append(toggle, document.createTextNode(translateUiText('Loop')))
        }
        settingsRow.append(toggleLabel)

        const status = document.createElement('small')
        status.className = 'voice-workspace-track-status'
        status.dataset.workspaceRole = 'status'
        status.textContent = workspaceTrackLabel(track)
        status.title = track?.reason ?? ''
        if (character) body.append(uploadLabel)
        body.append(actionRow, seekRow, settingsRow, status)
        details.append(body)
    }

    function renderWorkspace() {
        const openKeys = new Set(
            [...elements.characterTracks.querySelectorAll<HTMLDetailsElement>('details[open]'), ...elements.backgroundTracks.querySelectorAll<HTMLDetailsElement>('details[open]')]
                .map(details => details.dataset.workspaceKey ?? ''),
        )
        const characterFragment = document.createDocumentFragment()
        const characterTotals = new Map<string, number>()
        for (const character of workspaceCharacters) {
            characterTotals.set(character.characterResourceId, (characterTotals.get(character.characterResourceId) ?? 0) + 1)
        }
        const characterOccurrences = new Map<string, number>()
        for (const character of workspaceCharacters) {
            const occurrence = (characterOccurrences.get(character.characterResourceId) ?? 0) + 1
            characterOccurrences.set(character.characterResourceId, occurrence)
            const track = workspaceTrackForCharacter(character.actorKey)
            const details = document.createElement('details')
            details.className = 'voice-workspace-track voice-workspace-character-track'
            details.dataset.workspaceKey = `character:${character.actorKey}`
            details.dataset.actorKey = character.actorKey
            details.dataset.trackId = track?.trackId ?? ''
            details.dataset.status = track?.status ?? 'empty'
            details.open = openKeys.has(details.dataset.workspaceKey) || pendingTarget === character.target
            const summary = document.createElement('summary')
            const name = document.createElement('span')
            name.className = 'voice-workspace-track-name'
            const duplicateSuffix = (characterTotals.get(character.characterResourceId) ?? 0) > 1 ? ` #${occurrence}` : ''
            name.textContent = character.label?.trim() || `${voiceCharacterDisplayName(character.characterResourceId)}${duplicateSuffix}`
            const state = document.createElement('span')
            state.className = 'voice-workspace-track-summary-status'
            state.textContent = workspaceTrackLabel(track)
            summary.append(name, state)
            details.append(summary)
            appendWorkspaceTrackBody(details, track, character)
            characterFragment.append(details)
        }
        if (workspaceCharacters.length === 0) {
            const empty = document.createElement('p')
            empty.className = 'voice-workspace-empty'
            empty.textContent = translateUiText('No loaded characters')
            characterFragment.append(empty)
        }
        elements.characterTracks.replaceChildren(characterFragment)

        const backgroundTracks = workspaceTracks.filter(track => track.kind === 'background')
        const backgroundFragment = document.createDocumentFragment()
        for (const [index, track] of backgroundTracks.entries()) {
            const details = document.createElement('details')
            details.className = 'voice-workspace-track voice-workspace-background-track'
            details.dataset.workspaceKey = `track:${track.trackId}`
            details.dataset.trackId = track.trackId
            details.dataset.status = track.status
            details.open = openKeys.has(details.dataset.workspaceKey) || track.status === 'playing'
            const summary = document.createElement('summary')
            const name = document.createElement('span')
            name.className = 'voice-workspace-track-name'
            name.textContent = `${translateUiText('Background track')} ${index + 1}`
            const state = document.createElement('span')
            state.className = 'voice-workspace-track-summary-status'
            state.textContent = workspaceTrackLabel(track)
            summary.append(name, state)
            details.append(summary)
            appendWorkspaceTrackBody(details, track)
            backgroundFragment.append(details)
        }
        if (backgroundTracks.length === 0) {
            const empty = document.createElement('p')
            empty.className = 'voice-workspace-empty'
            empty.textContent = translateUiText('No background tracks')
            backgroundFragment.append(empty)
        }
        elements.backgroundTracks.replaceChildren(backgroundFragment)
        elements.backgroundTrackAdd.disabled = workspacePending.has('background-upload')
        elements.panel.dataset.workspaceCharacterCount = String(workspaceCharacters.length)
        elements.panel.dataset.workspaceBackgroundCount = String(backgroundTracks.length)
        elements.panel.dataset.workspaceRuntimeReady = String(Boolean(options.workspaceRuntime))
        renderWorkspaceStatus()
    }

    const refreshWorkspaceProgress = () => {
        for (const track of workspaceTracks) {
            const details = [...elements.panel.querySelectorAll<HTMLDetailsElement>('.voice-workspace-track')]
                .find(candidate => candidate.dataset.trackId === track.trackId)
            if (!details) continue
            const seek = details.querySelector<HTMLInputElement>('[data-workspace-role="seek"]')
            const time = details.querySelector<HTMLOutputElement>('[data-workspace-role="time"]')
            if (seek && document.activeElement !== seek) {
                if (seek.max !== (String(track.durationSeconds > 0 ? track.durationSeconds : 1))) seek.max = String(track.durationSeconds > 0 ? track.durationSeconds : 1)
                if (seek.value !== (String(Math.min(track.positionSeconds, track.durationSeconds || 0)))) seek.value = String(Math.min(track.positionSeconds, track.durationSeconds || 0))
            }
            if (time && document.activeElement !== seek) {
                if (time.textContent !== (`${formatTime(track.positionSeconds)} / ${track.durationSeconds > 0 ? formatTime(track.durationSeconds) : '—'}`)) time.textContent = `${formatTime(track.positionSeconds)} / ${track.durationSeconds > 0 ? formatTime(track.durationSeconds) : '—'}`
            }
        }
    }

    const renderUiLabels = () => {
        const subtitleLanguageLabel = translateUiText('Subtitle language')
        const showSubtitlesLabel = translateUiText('Show subtitles')
        const followMotionLabel = translateUiText('Follow original motion')
        const followExpressionLabel = translateUiText('Follow original expression')
        elements.subtitleModeLabel.textContent = `${subtitleLanguageLabel}:`
        elements.subtitleMode.setAttribute('aria-label', subtitleLanguageLabel)
        elements.subtitleToggleLabel.textContent = showSubtitlesLabel
        elements.motionToggleLabel.textContent = followMotionLabel
        elements.expressionToggleLabel.textContent = followExpressionLabel
        elements.subtitleToggle.setAttribute('aria-label', showSubtitlesLabel)
        elements.motionToggle.setAttribute('aria-label', followMotionLabel)
        elements.expressionToggle.setAttribute('aria-label', followExpressionLabel)
        elements.stop.textContent = translateUiText('Stop')
        elements.queue.textContent = translateUiText('Play sequence')
        elements.previous.textContent = translateUiText('Previous')
        elements.play.textContent = translateUiText('Play')
        elements.pause.textContent = translateUiText('Pause')
        elements.resume.textContent = translateUiText('Resume')
        elements.next.textContent = translateUiText('Next')
        elements.multitrackSummary.textContent = translateUiText('Multitrack audio')
        elements.workspaceBody.setAttribute('aria-label', translateUiText('Multitrack audio'))
        elements.characterTracksTitle.textContent = translateUiText('Character tracks')
        elements.backgroundTracksTitle.textContent = translateUiText('Background tracks')
        elements.backgroundTrackAdd.textContent = translateUiText('Add background track')
        elements.backgroundLipSyncNote.textContent = translateUiText('Background tracks do not drive lip sync')
        elements.list.setAttribute('aria-label', translateUiText('Voice list'))
        elements.transport.setAttribute('aria-label', translateUiText('Voice playback controls'))
        elements.progress.setAttribute('aria-label', translateUiText('Voice timeline'))
    }

    const setOpen = (open: boolean) => {
        elements.panel.classList.toggle('is-open', open)
        elements.panel.setAttribute('aria-hidden', String(!open))
        elements.toggle.setAttribute('aria-expanded', String(open))
        elements.title.textContent = translateUiText('Home voice')
        elements.toggle.textContent = translateUiText('Home voice')
        const label = translateUiText(open ? 'Hide voice and subtitles' : 'Show voice and subtitles')
        elements.toggle.title = label
        elements.toggle.setAttribute('aria-label', label)
        if (open) {
            // Hidden transport DOM is refreshed on demand, before the first visible frame.
            refreshWorkspaceFromRuntime()
            refreshWorkspaceProgress()
            renderProgress()
            requestAnimationFrame(() => ensureVoicePanelInViewport(elements.panel))
        }
    }

    const renderSubtitle = () => {
        const mode = activeSubtitleMode()
        const state = voice?.subtitleState(mode) ?? null
        const subtitle = mode === 'off' ? null : state?.text ?? null
        const hasCurrentVoice = Boolean(snapshot?.currentStableKey)
        const currentScenario = snapshot?.currentStableKey
            ? scenarioEntries.get(snapshot.currentStableKey)
            : undefined
        const selectedSource = mode === 'off' ? undefined : currentScenario?.reactionSources[subtitleLanguage]
        const selectedSourceMissing = hasCurrentVoice && selectedSource?.runtimeReady === false
        if (elements.subtitleMode.value !== (subtitleLanguage)) elements.subtitleMode.value = subtitleLanguage
        if (elements.subtitle.textContent !== (subtitle ?? '')) elements.subtitle.textContent = subtitle ?? ''
        if (elements.subtitle.hidden !== (mode === 'off' || subtitle === null)) elements.subtitle.hidden = mode === 'off' || subtitle === null
        if (elements.subtitle.lang !== (state?.resolvedLocale
            ? localeHtmlLanguage(state.resolvedLocale)
            : localeHtmlLanguage(subtitleLanguage))) elements.subtitle.lang = state?.resolvedLocale
            ? localeHtmlLanguage(state.resolvedLocale)
            : localeHtmlLanguage(subtitleLanguage)
        if (elements.subtitle.dataset.voiceSubtitleSourceRegion !== (state?.sourceRegion ?? '')) elements.subtitle.dataset.voiceSubtitleSourceRegion = state?.sourceRegion ?? ''
        if (elements.panel.lang !== (getUiLocale())) elements.panel.lang = getUiLocale()
        if (elements.panel.dataset.selectedLocale !== (subtitleLanguage)) elements.panel.dataset.selectedLocale = subtitleLanguage
        if (elements.panel.dataset.subtitleMode !== (mode)) elements.panel.dataset.subtitleMode = mode
        if (elements.panel.dataset.showSubtitles !== (String(elements.subtitleToggle.checked))) elements.panel.dataset.showSubtitles = String(elements.subtitleToggle.checked)
        if (elements.panel.dataset.subtitleStatus !== (state?.status ?? (mode === 'off' ? 'off' : 'idle'))) elements.panel.dataset.subtitleStatus = state?.status ?? (mode === 'off' ? 'off' : 'idle')
        if (elements.panel.dataset.requestedLocale !== (state?.requestedLocale ?? subtitleLanguage)) elements.panel.dataset.requestedLocale = state?.requestedLocale ?? subtitleLanguage
        if (elements.panel.dataset.resolvedLocale !== (state?.resolvedLocale ?? '')) elements.panel.dataset.resolvedLocale = state?.resolvedLocale ?? ''
        if (elements.panel.dataset.fallbackApplied !== (String(state?.fallbackApplied ?? false))) elements.panel.dataset.fallbackApplied = String(state?.fallbackApplied ?? false)
        if (elements.subtitleMode.title !== (translateUiText('Official subtitle language'))) elements.subtitleMode.title = translateUiText('Official subtitle language')
        const showResolution = mode !== 'off' && selectedSourceMissing
        if (elements.subtitleStatus.hidden !== (!showResolution)) elements.subtitleStatus.hidden = !showResolution
        if (elements.subtitleStatus.textContent !== (showResolution
            ? `${voiceSubtitleLanguageLabel(subtitleLanguage)} · ${translateUiText('Unavailable')}`
            : '')) elements.subtitleStatus.textContent = showResolution
            ? `${voiceSubtitleLanguageLabel(subtitleLanguage)} · ${translateUiText('Unavailable')}`
            : ''
        if (elements.subtitleStatus.title !== (showResolution
            ? selectedSource?.failClosedReasons.join('; ') ?? ''
            : '')) elements.subtitleStatus.title = showResolution
            ? selectedSource?.failClosedReasons.join('; ') ?? ''
            : ''
    }

    const renderProgress = () => {
        const position = voice?.positionSeconds ?? 0
        const duration = voice?.durationSeconds ?? null
        if (elements.progress.min !== ('0')) elements.progress.min = '0'
        if (elements.progress.max !== (String(duration && duration > 0 ? duration : 1))) elements.progress.max = String(duration && duration > 0 ? duration : 1)
        if (elements.progress.value !== (String(Math.min(position, duration ?? position)))) elements.progress.value = String(Math.min(position, duration ?? position))
        if (elements.progress.disabled !== (duration === null || duration <= 0)) elements.progress.disabled = duration === null || duration <= 0
        if (elements.progressValue.textContent !== (`${formatTime(position)} / ${duration === null ? '—' : formatTime(duration)}`)) elements.progressValue.textContent = `${formatTime(position)} / ${duration === null ? '—' : formatTime(duration)}`
    }

    const renderControls = () => {
        const entry = selectedEntry()
        const ready = Boolean(entry && isVoiceRuntimeReady(entry))
        const status = snapshot?.status ?? 'idle'
        elements.play.disabled = operationPending || !ready || !voice
        elements.queue.disabled = operationPending || !ready || !voice
        elements.pause.disabled = operationPending || status !== 'playing'
        elements.resume.disabled = operationPending || status !== 'paused'
        elements.stop.disabled = !voice || !['loading', 'playing', 'paused', 'error'].includes(status)
        elements.previous.disabled = operationPending || !voice || (snapshot?.currentIndex ?? -1) <= 0
        elements.next.disabled = operationPending
            || !voice
            || (snapshot?.currentIndex ?? -1) < 0
            || (snapshot?.currentIndex ?? -1) + 1 >= (snapshot?.trackCount ?? 0)
        elements.queue.classList.toggle('is-active', snapshot?.autoSequence ?? false)
        elements.queue.setAttribute('aria-pressed', String(snapshot?.autoSequence ?? false))
    }

    const playEntry = (entry: VoiceCatalogEntry) => {
        if (!voice || !isVoiceRuntimeReady(entry)) return
        selectedStableKey = entry.stableKey
        voice.setAutoSequence(false)
        applyScenarioOptions()
        void runOperation('Loading selected voice...', 'Voice playback started', () => voice!.playStableKey(entry.stableKey))
    }

    const renderList = () => {
        const entries = voice?.entries ?? []
        const currentStableKey = snapshot?.currentStableKey ?? null
        if (currentStableKey && currentStableKey !== lastRenderedCurrentStableKey) {
            selectedStableKey = currentStableKey
        }
        if (!entries.some(entry => entry.stableKey === selectedStableKey)) {
            selectedStableKey = entries[0]?.stableKey ?? ''
        }
        lastRenderedCurrentStableKey = currentStableKey

        const fragment = document.createDocumentFragment()
        for (const entry of entries) {
            const ready = isVoiceRuntimeReady(entry)
            const preview = resolveVoiceListPreview(scenarioEntries.get(entry.stableKey), subtitleLanguage)
            const item = document.createElement('button')
            item.type = 'button'
            item.className = 'voice-item'
            item.disabled = !ready
            item.dataset.stableKey = entry.stableKey
            item.dataset.runtimeReady = String(ready)
            item.dataset.requestedLocale = preview.requestedLocale
            item.dataset.resolvedLocale = preview.resolvedLocale ?? ''
            item.dataset.fallbackApplied = String(preview.fallbackApplied)
            item.classList.toggle('selected', entry.stableKey === selectedStableKey)
            item.classList.toggle('playing', entry.stableKey === currentStableKey
                && Boolean(snapshot && ['loading', 'playing', 'paused'].includes(snapshot.status)))
            item.setAttribute('aria-pressed', String(entry.stableKey === selectedStableKey))
            item.title = !ready
                ? entry.audio.failClosedReasons.join('; ')
                : preview.reason ?? entry.stableKey

            const index = document.createElement('span')
            index.className = 'voice-item-index'
            index.textContent = String(entry.order).padStart(2, '0')

            const text = document.createElement('span')
            text.className = 'voice-item-text'
            text.lang = localeHtmlLanguage(preview.resolvedLocale ?? subtitleLanguage)
            text.dataset.resolvedLocale = preview.resolvedLocale ?? ''
            text.textContent = preview.text
            text.classList.toggle('is-empty', preview.text.length === 0)

            const duration = document.createElement('span')
            duration.className = 'voice-item-dur'
            duration.textContent = formatVoiceDuration(entry)
            duration.setAttribute('aria-hidden', 'true')

            item.append(index, text, duration)
            item.addEventListener('click', () => playEntry(entry))
            fragment.append(item)
        }
        elements.list.replaceChildren(fragment)
        elements.list.setAttribute('aria-busy', String(!voice))

        const readyCount = entries.filter(isVoiceRuntimeReady).length
        elements.catalogStatus.textContent = !voice
            ? translateUiText('Loading voice catalog...')
            : !pendingCharacterId
                ? translateUiText('Select a magical girl to view voices')
                : `${voiceCharacterDisplayName(pendingCharacterId)} · ${entries.length} ${translateUiText('Voices')}${readyCount === entries.length ? '' : ` · ${entries.length - readyCount} ${translateUiText('Unavailable')}`}`
        elements.panel.dataset.trackCount = String(entries.length)
        elements.panel.dataset.playableCount = String(readyCount)
        elements.panel.dataset.failClosedCount = String(entries.length - readyCount)
        elements.panel.dataset.scenarioPreviewReady = String(scenarioEntries.size > 0)
        elements.panel.dataset.scenarioPreviewError = scenarioLoadError ?? ''
        renderControls()
    }

    const renderRuntime = () => {
        const state = snapshot
        elements.panel.dataset.status = state?.status ?? (voice ? 'idle' : 'loading')
        elements.panel.dataset.characterId = state?.characterResourceId ?? ''
        elements.panel.dataset.currentStableKey = state?.currentStableKey ?? ''
        elements.panel.dataset.autoSequence = String(state?.autoSequence ?? false)
        elements.panel.dataset.analysisMode = state?.analysisMode ?? ''
        elements.panel.dataset.mouthCarrier = state?.mouthCarrier.kind ?? ''
        elements.panel.dataset.scenarioStatus = state?.scenario.status ?? ''
        elements.panel.dataset.scenarioMotion = state?.scenario.motion ?? ''
        elements.panel.dataset.scenarioExpression = state?.scenario.faceType ?? ''
        elements.panel.dataset.scenarioMotionApplied = String(state?.scenario.motionApplied ?? false)
        elements.panel.dataset.scenarioExpressionApplied = String(state?.scenario.faceApplied ?? false)
        elements.runtimeStatus.textContent = state
            ? `${translateUiText(state.status)} · ${translateUiText(state.analysisMode)}`
            : ''
        if (state?.error) setRawOperationStatus(state.error)
        renderProgress()
        renderSubtitle()
        renderControls()
    }

    const renderAll = () => {
        renderUiLabels()
        setOpen(elements.panel.classList.contains('is-open'))
        renderWorkspace()
        renderList()
        renderRuntime()
        renderOperationStatus()
    }

    const runOperation = async (
        loadingText: string,
        completedText: string,
        operation: () => Promise<boolean>,
    ) => {
        if (disposed || !voice || operationPending) return
        const operationVoice = voice
        const generation = ++operationGeneration
        operationPending = true
        renderControls()
        setOperationStatus(loadingText)
        try {
            const completed = await operation()
            if (disposed || voice !== operationVoice || generation !== operationGeneration) return
            snapshot = operationVoice.snapshot
            setOperationStatus(completed ? completedText : 'Voice operation was not started')
        } catch (error) {
            if (disposed || voice !== operationVoice || generation !== operationGeneration) return
            snapshot = operationVoice.snapshot
            setOperationStatus('Voice operation failed', error instanceof Error ? error.message : String(error))
        } finally {
            if (generation === operationGeneration) {
                operationPending = false
                if (!disposed && voice === operationVoice) renderAll()
            }
        }
    }

    const closePanel = () => {
        setOpen(false)
        renderAll()
    }
    elements.toggle.onclick = () => {
        if (elements.panel.classList.contains('is-open')) closePanel()
        else setOpen(true)
    }
    elements.close.onclick = event => {
        event.stopPropagation()
        closePanel()
    }
    elements.subtitleMode.onchange = () => {
        const nextMode = elements.subtitleMode.value
        if (!isVoiceSubtitleLanguage(nextMode)) {
            elements.subtitleMode.value = subtitleLanguage
            return
        }
        subtitleLanguage = nextMode
        saveSubtitleLanguage(subtitleLanguage)
        voice?.setAutoSequence(false)
        voice?.stop()
        snapshot = voice?.snapshot ?? null
        renderAll()
    }
    elements.subtitleToggle.onchange = renderSubtitle
    const scenarioOptionsChanged = () => {
        applyScenarioOptions()
        renderRuntime()
    }
    elements.motionToggle.onchange = scenarioOptionsChanged
    elements.expressionToggle.onchange = scenarioOptionsChanged
    elements.play.onclick = () => {
        const entry = selectedEntry()
        if (entry) playEntry(entry)
    }
    elements.queue.onclick = () => {
        const index = voice?.entries.findIndex(entry => entry.stableKey === selectedStableKey) ?? -1
        if (index < 0) return
        applyScenarioOptions()
        void runOperation('Loading voice sequence...', 'Voice sequence started', () => voice!.playQueue(index))
    }
    elements.previous.onclick = () => {
        applyScenarioOptions()
        void runOperation('Loading previous voice...', 'Previous voice started', () => voice!.previous())
    }
    elements.next.onclick = () => {
        applyScenarioOptions()
        void runOperation('Loading next voice...', 'Next voice started', () => voice!.next())
    }
    elements.pause.onclick = () => {
        const paused = voice?.pause() ?? false
        snapshot = voice?.snapshot ?? null
        setOperationStatus(paused ? 'Voice playback paused' : 'Voice operation was not started')
        renderRuntime()
    }
    elements.resume.onclick = () => {
        void runOperation('Resuming voice...', 'Voice playback resumed', () => voice!.resume())
    }
    elements.stop.onclick = () => {
        operationGeneration++
        operationPending = false
        voice?.setAutoSequence(false)
        voice?.stop()
        snapshot = voice?.snapshot ?? null
        setOperationStatus('Voice playback stopped')
        renderAll()
    }
    elements.progress.oninput = () => {
        if (!voice) return
        voice.seek(Number(elements.progress.value))
        snapshot = voice.snapshot
        renderProgress()
        renderSubtitle()
    }
    elements.backgroundTrackAdd.onclick = () => elements.backgroundTrackFile.click()
    elements.backgroundTrackFile.accept = VOICE_MULTITRACK_AUDIO_ACCEPT
    elements.backgroundTrackFile.onchange = () => {
        const file = elements.backgroundTrackFile.files?.[0]
        elements.backgroundTrackFile.value = ''
        if (file) void uploadBackgroundAudio(file)
    }

    options.workspaceRuntime?.setBeforeCharacterPlay?.(() => {
        voice?.setAutoSequence(false)
        voice?.stop()
        snapshot = voice?.snapshot ?? null
        setOperationStatus('Voice playback stopped')
    })

    workspaceUnsubscribe = options.workspaceRuntime?.subscribe(tracks => {
        workspaceTracks = [...tracks]
        renderWorkspace()
    })

    const localeListener = () => renderAll()
    document.addEventListener('magius:localechange', localeListener)

    const controller: VoicePanelController = {
        acquirePoseChannels(request) { return poseChannels.acquirePoseChannels(request) },
        setCharacter(characterResourceId, target) {
            pendingCharacterId = characterResourceId
            pendingTarget = target
            selectedStableKey = ''
            voice?.setAutoSequence(false)
            voice?.setCharacter(characterResourceId, target)
            applyScenarioOptions()
            snapshot = voice?.snapshot ?? null
            renderAll()
        },
        setWorkspaceCharacters(characters) {
            workspaceCharacters = [...characters]
            try {
                const result = options.workspaceRuntime?.setCharacters?.(workspaceCharacters)
                if (result) {
                    void Promise.resolve(result).catch(error => {
                        setWorkspaceStatus('Audio workspace operation failed', error instanceof Error ? error.message : String(error))
                    })
                }
            } catch (error) {
                setWorkspaceStatus('Audio workspace operation failed', error instanceof Error ? error.message : String(error))
            }
            renderWorkspace()
        },
        update(nowMilliseconds = performance.now()) {
            const deltaSeconds = Math.min(0.1, Math.max(0, (nowMilliseconds - lastUpdateMilliseconds) / 1000))
            lastUpdateMilliseconds = nowMilliseconds
            voice?.update(deltaSeconds)
            options.workspaceRuntime?.update?.(deltaSeconds)
            const panelOpen = elements.panel.classList.contains('is-open')
            if (options.workspaceRuntime && nowMilliseconds - lastWorkspaceRefreshMilliseconds >= 100) {
                lastWorkspaceRefreshMilliseconds = nowMilliseconds
                refreshWorkspaceFromRuntime()
                if (panelOpen) refreshWorkspaceProgress()
            }
            if (panelOpen) renderProgress()
            // The subtitle overlay remains live even while the voice panel is closed.
            renderSubtitle()
        },
        async dispose() {
            if (disposed) return
            disposed = true
            fetchAbort.abort()
            stopInteraction()
            document.removeEventListener('magius:localechange', localeListener)
            unsubscribe?.()
            unsubscribe = undefined
            workspaceUnsubscribe?.()
            workspaceUnsubscribe = undefined
            options.workspaceRuntime?.setBeforeCharacterPlay?.(null)
            elements.subtitle.hidden = true
            elements.subtitle.textContent = ''
            const current = voice
            voice = null
            snapshot = null
            try {
                await current?.dispose()
            } finally {
                try {
                    await options.workspaceRuntime?.dispose?.()
                } finally {
                    poseChannels.dispose()
                }
            }
            if (activeController === controller) activeController = undefined
        },
    }

    activeController = controller
    elements.subtitleMode.replaceChildren(...VOICE_SUBTITLE_LANGUAGES.map(mode => {
        const option = document.createElement('option')
        option.value = mode
        option.textContent = voiceSubtitleLanguageLabel(mode)
        option.selected = mode === subtitleLanguage
        return option
    }))
    elements.panel.dataset.audioBaseUrl = AUDIO_BASE_URL
    applyScenarioOptions()
    renderAll()

    void (async () => {
        try {
            const [manifest, scenarioResult] = await Promise.all([
                fetchVoiceCatalogManifest(undefined, fetchAbort.signal),
                fetchVoiceScenarioManifest(undefined, fetchAbort.signal)
                    .then(value => ({ value, error: null as string | null }))
                    .catch(error => ({ value: null, error: error instanceof Error ? error.message : String(error) })),
            ])
            if (disposed) return
            scenarioEntries = new Map(scenarioResult.value?.entries.map(entry => [entry.voiceStableKey, entry]) ?? [])
            scenarioLoadError = scenarioResult.error
            voice = new VoicePlayer(manifest, {
                resolveRuntimeUrl: entry => resolveRuntimeVoiceUrl(entry, {
                    audioBaseUrl: AUDIO_BASE_OVERRIDE,
                    signal: fetchAbort.signal,
                }),
                loadScenarioCatalog: async () => scenarioResult.value,
                beforePlayback: async (_entry, target) => {
                    await options.workspaceRuntime?.stopCharacterForTarget?.(target)
                },
            })
            applyScenarioOptions()
            unsubscribe = voice.subscribe(next => {
                snapshot = next
                if (
                    next.autoSequence
                    && next.status === 'idle'
                    && next.currentIndex >= 0
                    && next.currentIndex + 1 < next.trackCount
                ) {
                    applyScenarioOptions()
                }
                renderAll()
            })
            voice.setCharacter(pendingCharacterId, pendingTarget)
            snapshot = voice.snapshot
            setOperationStatus('Voice catalog ready')
            renderAll()
        } catch (error) {
            if (disposed || fetchAbort.signal.aborted) return
            elements.panel.dataset.status = 'error'
            elements.catalogStatus.textContent = translateUiText('Voice catalog could not be loaded')
            setOperationStatus('Voice catalog could not be loaded', error instanceof Error ? error.message : String(error))
            renderControls()
        }
    })()

    return controller
}
