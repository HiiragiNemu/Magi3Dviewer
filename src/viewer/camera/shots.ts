import * as THREE from 'three'
import { scene } from '../scene'
import { bgImageEl, isBackgroundImageVisible } from '../controllers'
import { translateUiText } from '../localization/zhCN'
import { cameraVideo, getCameraVideoResolution, isCameraEnabled } from './camera'
import { WebCodecsMp4Recorder } from './mp4'
import { WebCodecsWebmRecorder } from './webm'

const captureCharacterBtn = document.getElementById('capture-character') as HTMLButtonElement
const captureWithBackgroundBtn = document.getElementById('capture-with-background') as HTMLButtonElement
const recordCharacterBtn = document.getElementById('record-character') as HTMLButtonElement
const recordWithBackgroundBtn = document.getElementById('record-with-background') as HTMLButtonElement
const recordMp4WithBackgroundBtn = document.getElementById('record-mp4-with-background') as HTMLButtonElement
const vrToggleBtn = document.getElementById('viewer-vr-toggle') as HTMLButtonElement
const recordingResolutionSelect = document.getElementById('recording-resolution') as HTMLSelectElement
const recordingAspectSelect = document.getElementById('recording-aspect') as HTMLSelectElement
const recordingOrientationSelect = document.getElementById('recording-orientation') as HTMLSelectElement
const recordingSizeOutput = document.getElementById('recording-size-output') as HTMLOutputElement
const recordingQualityLabel = document.getElementById('recording-quality-label') as HTMLSpanElement
const recordingAspectLabel = document.getElementById('recording-aspect-label') as HTMLSpanElement
const recordingOrientationLabel = document.getElementById('recording-orientation-label') as HTMLSpanElement
const stillCaptureLongEdge = 3840
const recordingFrameIntervalMs = 1000 / 30
const recordingPresetStorageKey = 'magius-recording-spec-v3'
const recordingFrameBounds = {
    '1k': { width: 1280, height: 720 },
    '2k': { width: 1920, height: 1080 },
    '4k': { width: 3840, height: 2160 },
} as const
const recordingAspectRatios = {
    '16:9': 16 / 9,
    '21:9': 21 / 9,
    '4:3': 4 / 3,
    '1:1': 1,
} as const

type RecordingMode = 'character' | 'background'
type RecordingResolution = 'current' | keyof typeof recordingFrameBounds
type RecordingAspect = keyof typeof recordingAspectRatios
type RecordingOrientation = 'landscape' | 'portrait'

interface RecordingSize {
    width: number
    height: number
    resolution: RecordingResolution
    aspect: RecordingAspect
    orientation: RecordingOrientation
}

interface RecordingBase {
    button: HTMLButtonElement
    animationFrame: number
    extension: 'mp4' | 'webm'
    mode: RecordingMode
    width: number
    height: number
    restoreResolution: () => void
    startedAt: number
    durationMs?: number
}

interface MediaRecording extends RecordingBase {
    kind: 'media-recorder'
    recorder: MediaRecorder
    stream: MediaStream
    chunks: Blob[]
}

interface WebCodecsRecording extends RecordingBase {
    kind: 'webcodecs'
    recorder: WebCodecsMp4Recorder | WebCodecsWebmRecorder
    canvas: HTMLCanvasElement
    includeBackground: boolean
    useRendererCanvas: boolean
    foregroundPrepared: boolean
    stopping: boolean
}

type ActiveRecording = MediaRecording | WebCodecsRecording

interface XrSessionLike {
    addEventListener(type: 'end', listener: () => void, options?: AddEventListenerOptions): void
    end(): Promise<void>
}

interface XrSystemLike {
    isSessionSupported(mode: 'immersive-vr'): Promise<boolean>
    requestSession(mode: 'immersive-vr', options?: Record<string, unknown>): Promise<XrSessionLike>
}

let activeRecording: ActiveRecording | undefined
let activeVrSession: XrSessionLike | undefined
let vrUnavailableLabel = 'VR is not available in this browser'
let controlsInstalled = false
let captureBusy = false

function findBytes(bytes: Uint8Array, needle: readonly number[], end = bytes.length) {
    outer: for (let offset = 0; offset <= end - needle.length; offset++) {
        for (let index = 0; index < needle.length; index++) {
            if (bytes[offset + index] !== needle[index]) continue outer
        }
        return offset
    }
    return -1
}

function getEbmlIdWidth(firstByte: number) {
    let marker = 0x80
    for (let width = 1; width <= 4; width++, marker >>= 1) {
        if ((firstByte & marker) !== 0) return width
    }
    throw new Error('Invalid EBML element ID')
}

function readEbmlVint(bytes: Uint8Array, offset: number) {
    const firstByte = bytes[offset]
    let marker = 0x80
    let width = 1
    while (width <= 8 && (firstByte & marker) === 0) {
        marker >>= 1
        width++
    }
    if (width > 8 || offset + width > bytes.length) throw new Error('Invalid EBML variable integer')

    let value = BigInt(firstByte & (marker - 1))
    for (let index = 1; index < width; index++) {
        value = (value << 8n) | BigInt(bytes[offset + index])
    }
    const unknownValue = (1n << BigInt(width * 7)) - 1n
    return {
        width,
        value: Number(value),
        unknown: value === unknownValue,
    }
}

function encodeEbmlVint(value: number, preferredWidth: number) {
    const bigValue = BigInt(value)
    let width = preferredWidth
    while (width <= 8 && bigValue >= (1n << BigInt(width * 7)) - 1n) width++
    if (width > 8) throw new Error('EBML element is too large')

    const encoded = new Uint8Array(width)
    let remaining = bigValue
    for (let index = width - 1; index >= 0; index--) {
        encoded[index] = Number(remaining & 0xffn)
        remaining >>= 8n
    }
    encoded[0] |= 1 << (8 - width)
    return encoded
}

function readUnsignedInteger(bytes: Uint8Array, start: number, length: number) {
    let value = 0
    for (let index = 0; index < length; index++) value = value * 256 + bytes[start + index]
    return value
}

function createDurationPayload(durationTicks: number, byteLength: 4 | 8) {
    const payload = new Uint8Array(byteLength)
    const view = new DataView(payload.buffer)
    if (byteLength === 4) view.setFloat32(0, durationTicks, false)
    else view.setFloat64(0, durationTicks, false)
    return payload
}

/** Adds the Segment Info/Duration field omitted by Chromium's WebM recorder. */
export async function fixWebmDuration(blob: Blob, durationMs: number) {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const infoId = [0x15, 0x49, 0xa9, 0x66] as const
    const durationId = [0x44, 0x89] as const
    const timecodeScaleId = [0x2a, 0xd7, 0xb1] as const
    const infoOffset = findBytes(bytes, infoId, Math.min(bytes.length, 4096))
    if (infoOffset < 0) throw new Error('WebM Segment Info element is missing')

    const infoSizeOffset = infoOffset + infoId.length
    const infoSize = readEbmlVint(bytes, infoSizeOffset)
    if (infoSize.unknown) throw new Error('WebM Segment Info has an unknown size')
    const infoPayloadStart = infoSizeOffset + infoSize.width
    const infoPayloadEnd = infoPayloadStart + infoSize.value
    if (infoPayloadEnd > bytes.length) throw new Error('WebM Segment Info is truncated')

    let timecodeScale = 1_000_000
    let durationElement: { payloadStart: number, payloadLength: 4 | 8 } | undefined
    for (let cursor = infoPayloadStart; cursor < infoPayloadEnd;) {
        const idWidth = getEbmlIdWidth(bytes[cursor])
        const sizeOffset = cursor + idWidth
        const size = readEbmlVint(bytes, sizeOffset)
        if (size.unknown) throw new Error('WebM Segment Info child has an unknown size')
        const payloadStart = sizeOffset + size.width
        const payloadEnd = payloadStart + size.value
        if (payloadEnd > infoPayloadEnd) throw new Error('WebM Segment Info child is truncated')

        const id = bytes.subarray(cursor, cursor + idWidth)
        if (idWidth === timecodeScaleId.length && timecodeScaleId.every((byte, index) => id[index] === byte)) {
            timecodeScale = readUnsignedInteger(bytes, payloadStart, size.value)
        } else if (
            idWidth === durationId.length
            && durationId.every((byte, index) => id[index] === byte)
            && (size.value === 4 || size.value === 8)
        ) {
            durationElement = { payloadStart, payloadLength: size.value as 4 | 8 }
        }
        cursor = payloadEnd
    }

    const durationTicks = Math.max(1, durationMs) * 1_000_000 / timecodeScale
    if (durationElement) {
        const output = bytes.slice()
        output.set(
            createDurationPayload(durationTicks, durationElement.payloadLength),
            durationElement.payloadStart,
        )
        return new Blob([output], { type: blob.type || 'video/webm' })
    }

    const durationPayload = createDurationPayload(durationTicks, 8)
    const durationSize = encodeEbmlVint(durationPayload.length, 1)
    const durationBytes = new Uint8Array(durationId.length + durationSize.length + durationPayload.length)
    durationBytes.set(durationId, 0)
    durationBytes.set(durationSize, durationId.length)
    durationBytes.set(durationPayload, durationId.length + durationSize.length)
    const newInfoSize = encodeEbmlVint(infoSize.value + durationBytes.length, infoSize.width)

    return new Blob([
        bytes.subarray(0, infoSizeOffset),
        newInfoSize,
        bytes.subarray(infoPayloadStart, infoPayloadEnd),
        durationBytes,
        bytes.subarray(infoPayloadEnd),
    ], { type: blob.type || 'video/webm' })
}

function getCaptureSize() {
    const size = new THREE.Vector2()
    scene.renderer.getDrawingBufferSize(size)
    return {
        width: Math.max(1, Math.round(size.x)),
        height: Math.max(1, Math.round(size.y)),
    }
}

function ensureCaptureSize(canvas: HTMLCanvasElement) {
    const { width, height } = getCaptureSize()
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
}

function isRecordingResolution(value: string): value is RecordingResolution {
    return value === 'current' || value in recordingFrameBounds
}

function isRecordingAspect(value: string): value is RecordingAspect {
    return value in recordingAspectRatios
}

function isRecordingOrientation(value: string): value is RecordingOrientation {
    return value === 'landscape' || value === 'portrait'
}

function makeEven(value: number) {
    return Math.max(2, Math.round(value / 2) * 2)
}

function getRecordingSize(): RecordingSize {
    const resolution = isRecordingResolution(recordingResolutionSelect.value)
        ? recordingResolutionSelect.value
        : 'current'
    const aspect = isRecordingAspect(recordingAspectSelect.value)
        ? recordingAspectSelect.value
        : '16:9'
    const orientation = isRecordingOrientation(recordingOrientationSelect.value)
        ? recordingOrientationSelect.value
        : 'landscape'
    if (resolution === 'current') {
        const current = getCaptureSize()
        return {
            width: makeEven(current.width),
            height: makeEven(current.height),
            resolution,
            aspect,
            orientation,
        }
    }
    const bounds = recordingFrameBounds[resolution]
    const aspectRatio = recordingAspectRatios[aspect]
    const boundsAspect = bounds.width / bounds.height
    const landscapeWidth = aspectRatio >= boundsAspect
        ? bounds.width
        : makeEven(bounds.height * aspectRatio)
    const landscapeHeight = aspectRatio >= boundsAspect
        ? makeEven(bounds.width / aspectRatio)
        : bounds.height
    return orientation === 'portrait'
        ? { width: landscapeHeight, height: landscapeWidth, resolution, aspect, orientation }
        : { width: landscapeWidth, height: landscapeHeight, resolution, aspect, orientation }
}

function getRecordingBitrate(width: number, height: number, preferMp4: boolean) {
    const bitsPerPixel = preferMp4 ? 8 : 9
    const minimum = preferMp4 ? 12_000_000 : 16_000_000
    const maximum = preferMp4 ? 80_000_000 : 90_000_000
    return Math.min(maximum, Math.max(minimum, Math.round(width * height * bitsPerPixel)))
}

function rendererCanvasCanBeRecordedDirectly(includeBackground: boolean) {
    if (!includeBackground || isCameraEnabled() || isBackgroundImageVisible()) return false
    const filter = scene.getColorFilterCSS().replace(/\s+/g, ' ').trim()
    return filter === '' || filter === 'none' || filter === 'brightness(1) contrast(1) saturate(1)'
}

function setRecordingCanvasSize(canvas: HTMLCanvasElement, size: RecordingSize) {
    canvas.width = size.width
    canvas.height = size.height
}

function updateRecordingSizeOutput() {
    const size = getRecordingSize()
    recordingSizeOutput.value = `${size.width} × ${size.height}`
    recordingSizeOutput.textContent = recordingSizeOutput.value
    const usesCurrentView = size.resolution === 'current'
    recordingAspectSelect.disabled = usesCurrentView
    recordingOrientationSelect.disabled = usesCurrentView
}

function persistRecordingSpec() {
    const size = getRecordingSize()
    try {
        localStorage.setItem(recordingPresetStorageKey, JSON.stringify({
            resolution: size.resolution,
            aspect: size.aspect,
            orientation: size.orientation,
        }))
    } catch (error) {
        console.warn('Recording format could not be saved', error)
    }
    updateRecordingSizeOutput()
}

function initializeRecordingSpecControls() {
    try {
        const saved = JSON.parse(localStorage.getItem(recordingPresetStorageKey) ?? '{}') as Record<string, unknown>
        if (typeof saved.resolution === 'string' && isRecordingResolution(saved.resolution)) {
            recordingResolutionSelect.value = saved.resolution
        }
        if (typeof saved.aspect === 'string' && isRecordingAspect(saved.aspect)) {
            recordingAspectSelect.value = saved.aspect
        }
        if (typeof saved.orientation === 'string' && isRecordingOrientation(saved.orientation)) {
            recordingOrientationSelect.value = saved.orientation
        }
    } catch (error) {
        console.warn('Recording format could not be restored', error)
    }
    for (const select of [recordingResolutionSelect, recordingAspectSelect, recordingOrientationSelect]) {
        select.addEventListener('change', persistRecordingSpec)
    }
    updateRecordingSizeOutput()
}

function drawCover(
    context: CanvasRenderingContext2D,
    source: CanvasImageSource,
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number,
) {
    if (sourceWidth <= 0 || sourceHeight <= 0) return
    const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
    const width = sourceWidth * scale
    const height = sourceHeight * scale
    context.drawImage(source, (targetWidth - width) / 2, (targetHeight - height) / 2, width, height)
}

function drawExternalBackground(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    if (isCameraEnabled()) {
        const { width, height } = getCameraVideoResolution()
        drawCover(context, cameraVideo, width, height, canvas.width, canvas.height)
        return
    }

    if (isBackgroundImageVisible()) {
        drawCover(
            context,
            bgImageEl,
            bgImageEl.naturalWidth,
            bgImageEl.naturalHeight,
            canvas.width,
            canvas.height,
        )
    }
}

function drawRenderer(
    context: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    source: HTMLCanvasElement,
) {
    context.save()
    context.filter = scene.getColorFilterCSS() || 'none'
    drawCover(context, source, source.width, source.height, canvas.width, canvas.height)
    context.restore()
}

function drawPreparedForeground(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d', { alpha: true })
    if (!context) throw new Error('2D capture context is unavailable')
    context.clearRect(0, 0, canvas.width, canvas.height)
    drawRenderer(context, canvas, scene.renderer.domElement)
}

export function renderCaptureFrame(
    canvas: HTMLCanvasElement,
    includeBackground: boolean,
    preserveCanvasSize = false,
) {
    if (!preserveCanvasSize) ensureCaptureSize(canvas)
    const context = canvas.getContext('2d', { alpha: true })
    if (!context) throw new Error('2D capture context is unavailable')

    context.clearRect(0, 0, canvas.width, canvas.height)
    if (includeBackground) {
        drawExternalBackground(context, canvas)
        drawRenderer(context, canvas, scene.renderer.domElement)
    } else {
        scene.captureForegroundFrame(source => drawRenderer(context, canvas, source))
    }
    return canvas
}

export function createCaptureCanvas(includeBackground: boolean) {
    return renderCaptureFrame(document.createElement('canvas'), includeBackground)
}

function createTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-')
}

function downloadBlob(blob: Blob, label: string, extension: string) {
    const url = URL.createObjectURL(blob)
    document.getElementById('magius-last-download')?.remove()
    const anchor = document.createElement('a')
    anchor.id = 'magius-last-download'
    anchor.hidden = true
    anchor.href = url
    anchor.download = `Magius3Dviewer-${label}-${createTimestamp()}.${extension}`
    document.body.append(anchor)
    document.body.dataset.magiusLastDownload = JSON.stringify({
        filename: anchor.download,
        bytes: blob.size,
        type: blob.type,
    })
    anchor.click()
    // Keep large recordings readable until the browser has finished copying the Blob.
    window.setTimeout(() => {
        URL.revokeObjectURL(url)
        if (anchor.href === url) anchor.remove()
    }, 60_000)
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string) {
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob) resolve(blob)
            else reject(new Error('Canvas encoding returned no data'))
        }, type)
    })
}

async function captureStill(includeBackground: boolean) {
    if (captureBusy) return
    captureBusy = true
    captureCharacterBtn.disabled = true
    captureWithBackgroundBtn.disabled = true
    try {
        const resolution = scene.beginCaptureResolution(stillCaptureLongEdge)
        let canvas: HTMLCanvasElement
        try {
            canvas = createCaptureCanvas(includeBackground)
        } finally {
            resolution.restore()
        }
        const blob = await canvasToBlob(canvas, 'image/png')
        const label = `${includeBackground ? 'background' : 'character'}-${canvas.width}x${canvas.height}`
        downloadBlob(blob, label, 'png')
    } catch (error) {
        console.error(error)
        window.alert(translateUiText('Photo capture failed'))
    } finally {
        captureBusy = false
        captureCharacterBtn.disabled = false
        captureWithBackgroundBtn.disabled = false
    }
}

function findSupportedMimeType(preferMp4: boolean) {
    const mp4Types = [
        'video/mp4;codecs=avc1.42E01E',
        'video/mp4;codecs=h264',
        'video/mp4',
    ]
    const webmTypes = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
    ]
    const candidates = preferMp4 ? [...mp4Types, ...webmTypes] : webmTypes
    return candidates.find(type => MediaRecorder.isTypeSupported(type)) ?? ''
}

function setRecordingButtonsDisabled(disabled: boolean) {
    for (const button of [recordCharacterBtn, recordWithBackgroundBtn, recordMp4WithBackgroundBtn]) {
        button.disabled = disabled && button !== activeRecording?.button
    }
    for (const select of [recordingResolutionSelect, recordingAspectSelect, recordingOrientationSelect]) {
        select.disabled = disabled
    }
}

function updateControlLabels() {
    captureCharacterBtn.textContent = translateUiText('Char Only')
    captureWithBackgroundBtn.textContent = translateUiText('With BG')
    recordCharacterBtn.textContent = translateUiText('Rec Char')
    recordWithBackgroundBtn.textContent = translateUiText('Rec/BG')
    recordMp4WithBackgroundBtn.textContent = translateUiText('MP4/BG')
    recordingQualityLabel.textContent = translateUiText('Quality')
    recordingAspectLabel.textContent = translateUiText('Aspect ratio')
    recordingOrientationLabel.textContent = translateUiText('Orientation')
    recordingOrientationSelect.options[0].textContent = translateUiText('Landscape')
    recordingOrientationSelect.options[1].textContent = translateUiText('Portrait')
    updateRecordingSizeOutput()

    if (activeRecording) {
        activeRecording.button.textContent = translateUiText('Stop')
        activeRecording.button.title = translateUiText('Stop recording')
    }

    vrToggleBtn.textContent = activeVrSession ? translateUiText('Exit VR') : 'VR'
    vrToggleBtn.title = translateUiText(
        activeVrSession ? 'Exit VR' : vrToggleBtn.disabled ? vrUnavailableLabel : 'Enter VR',
    )
}

function finishRecording(state: ActiveRecording) {
    window.cancelAnimationFrame(state.animationFrame)
    if (state.kind === 'media-recorder') state.stream.getTracks().forEach(track => track.stop())
    state.restoreResolution()
    state.button.disabled = false
    state.button.classList.remove('recording')
    state.button.setAttribute('aria-pressed', 'false')
    if (activeRecording === state) activeRecording = undefined
    setRecordingButtonsDisabled(false)
    updateControlLabels()
}

function createRecordingLabel(state: ActiveRecording) {
    return `${state.mode === 'character' ? 'character-recording' : 'background-recording'}-${state.width}x${state.height}`
}

function stopActiveRecording() {
    const state = activeRecording
    if (!state) return
    state.durationMs = performance.now() - state.startedAt
    if (state.kind === 'webcodecs') {
        if (state.stopping) return
        state.stopping = true
        window.cancelAnimationFrame(state.animationFrame)
        state.button.disabled = true
        void (async () => {
            try {
                if (!state.useRendererCanvas) {
                    if (state.foregroundPrepared) drawPreparedForeground(state.canvas)
                    else renderCaptureFrame(state.canvas, state.includeBackground, true)
                }
                const blob = await state.recorder.finish(state.canvas, state.durationMs ?? 1)
                finishRecording(state)
                downloadBlob(blob, createRecordingLabel(state), state.extension)
            } catch (error) {
                finishRecording(state)
                console.error(error)
                window.alert(translateUiText('Video recording could not be completed'))
            }
        })()
        return
    }
    if (state.recorder.state !== 'inactive') {
        state.recorder.requestData()
        state.recorder.stop()
    }
}

async function startRecording(mode: RecordingMode, preferMp4: boolean, button: HTMLButtonElement) {
    if (activeRecording) {
        stopActiveRecording()
        return
    }
    const recordingSize = getRecordingSize()
    const includeBackground = mode === 'background'
    const resolution = scene.beginCaptureFrameSize(recordingSize.width, recordingSize.height, 30, includeBackground)
    const foreground = includeBackground ? undefined : scene.beginForegroundCapture()
    const restoreCaptureState = () => {
        foreground?.restore()
        resolution.restore()
    }
    const useRendererCanvas = rendererCanvasCanBeRecordedDirectly(includeBackground)
    const canvas = useRendererCanvas ? scene.renderer.domElement : document.createElement('canvas')
    if (!useRendererCanvas) {
        setRecordingCanvasSize(canvas, {
            ...recordingSize,
            width: resolution.width,
            height: resolution.height,
        })
    }
    try {
        if (!useRendererCanvas) {
            if (foreground) drawPreparedForeground(canvas)
            else renderCaptureFrame(canvas, includeBackground, true)
        }
    } catch (error) {
        restoreCaptureState()
        console.error(error)
        window.alert(translateUiText('Video recording could not be started'))
        return
    }
    const nativeMimeType = typeof MediaRecorder === 'undefined' ? '' : findSupportedMimeType(preferMp4)
    const nativeContainerAvailable = preferMp4
        ? nativeMimeType.startsWith('video/mp4')
        : nativeMimeType.startsWith('video/webm')
    if (!nativeContainerAvailable) {
        button.disabled = true
        try {
        const webCodecsRecorder = preferMp4
            ? await WebCodecsMp4Recorder.create({
                width: canvas.width,
                height: canvas.height,
                bitrate: getRecordingBitrate(canvas.width, canvas.height, true),
                frameRate: 30,
            })
            : await WebCodecsWebmRecorder.create({
                width: canvas.width,
                height: canvas.height,
                bitrate: getRecordingBitrate(canvas.width, canvas.height, false),
                frameRate: 30,
            })
        if (webCodecsRecorder) {
            const state: WebCodecsRecording = {
                kind: 'webcodecs',
                recorder: webCodecsRecorder,
                canvas,
                includeBackground,
                useRendererCanvas,
                foregroundPrepared: Boolean(foreground),
                stopping: false,
                button,
                animationFrame: 0,
                extension: preferMp4 ? 'mp4' : 'webm',
                mode,
                width: canvas.width,
                height: canvas.height,
                restoreResolution: restoreCaptureState,
                startedAt: performance.now(),
            }
            activeRecording = state
            button.disabled = false
            button.classList.add('recording')
            button.setAttribute('aria-pressed', 'true')
            setRecordingButtonsDisabled(true)
            updateControlLabels()

            let lastDrawTime = state.startedAt
            const drawNextFrame = (now: number) => {
                if (activeRecording !== state || state.stopping) return
                if (now - lastDrawTime >= recordingFrameIntervalMs) {
                    try {
                        const elapsedMs = now - state.startedAt
                        if (webCodecsRecorder.needsFrame(elapsedMs)) {
                            if (!useRendererCanvas) {
                                if (foreground) drawPreparedForeground(canvas)
                                else renderCaptureFrame(canvas, includeBackground, true)
                            }
                            webCodecsRecorder.captureToElapsed(canvas, elapsedMs)
                        }
                    } catch (error) {
                        console.error(error)
                        stopActiveRecording()
                        return
                    }
                    lastDrawTime = now
                }
                state.animationFrame = window.requestAnimationFrame(drawNextFrame)
            }
            try {
                webCodecsRecorder.captureToElapsed(canvas, 0)
            } catch (error) {
                finishRecording(state)
                console.error(error)
                window.alert(translateUiText('Video recording could not be started'))
                return
            }
            state.animationFrame = window.requestAnimationFrame(drawNextFrame)
            return
        }
        } catch (error) {
            console.warn('WebCodecs recording is unavailable; using MediaRecorder', error)
        } finally {
            button.disabled = false
        }
    }

    if (typeof MediaRecorder === 'undefined') {
        restoreCaptureState()
        window.alert(translateUiText('Video recording is not supported by this browser'))
        return
    }

    const stream = canvas.captureStream(30)
    const videoTrack = stream.getVideoTracks()[0]
    if (videoTrack && 'contentHint' in videoTrack) videoTrack.contentHint = 'detail'
    const mimeType = nativeMimeType || findSupportedMimeType(preferMp4)
    const options: MediaRecorderOptions = {
        videoBitsPerSecond: getRecordingBitrate(canvas.width, canvas.height, preferMp4),
    }
    if (mimeType) options.mimeType = mimeType

    let recorder: MediaRecorder
    try {
        recorder = new MediaRecorder(stream, options)
    } catch (error) {
        stream.getTracks().forEach(track => track.stop())
        restoreCaptureState()
        console.error(error)
        window.alert(translateUiText('Video recording is not supported by this browser'))
        return
    }

    const state: MediaRecording = {
        kind: 'media-recorder',
        recorder,
        stream,
        button,
        animationFrame: 0,
        chunks: [],
        extension: recorder.mimeType.startsWith('video/mp4') ? 'mp4' : 'webm',
        mode,
        width: canvas.width,
        height: canvas.height,
        restoreResolution: restoreCaptureState,
        startedAt: performance.now(),
    }
    activeRecording = state
    button.classList.add('recording')
    button.setAttribute('aria-pressed', 'true')
    setRecordingButtonsDisabled(true)
    updateControlLabels()

    let lastDrawTime = performance.now()
    const drawNextFrame = (now: number) => {
        if (activeRecording !== state || recorder.state === 'inactive') return
        if (now - lastDrawTime >= recordingFrameIntervalMs) {
            if (!useRendererCanvas) {
                if (foreground) drawPreparedForeground(canvas)
                else renderCaptureFrame(canvas, includeBackground, true)
            }
            lastDrawTime = now
        }
        state.animationFrame = window.requestAnimationFrame(drawNextFrame)
    }

    recorder.ondataavailable = event => {
        if (event.data.size > 0) state.chunks.push(event.data)
    }
    recorder.onerror = event => console.error('MediaRecorder error', event)
    recorder.onstop = async () => {
        let blob = new Blob(state.chunks, { type: recorder.mimeType || mimeType || 'video/webm' })
        finishRecording(state)
        if (blob.size > 0) {
            if (state.extension === 'webm') {
                try {
                    blob = await fixWebmDuration(
                        blob,
                        state.durationMs ?? performance.now() - state.startedAt,
                    )
                } catch (error) {
                    console.error('WebM duration metadata could not be written', error)
                    window.alert(translateUiText('WebM duration metadata could not be written'))
                }
            }
            downloadBlob(blob, createRecordingLabel(state), state.extension)
        }
    }

    recorder.start(1000)
    state.animationFrame = window.requestAnimationFrame(drawNextFrame)
}

async function updateVrAvailability() {
    const xr = (navigator as Navigator & { xr?: XrSystemLike }).xr
    if (!xr) {
        vrUnavailableLabel = 'VR is not available in this browser'
        vrToggleBtn.disabled = true
        updateControlLabels()
        return
    }

    try {
        const supported = await xr.isSessionSupported('immersive-vr')
        vrUnavailableLabel = supported ? 'Enter VR' : 'No immersive VR device is available'
        vrToggleBtn.disabled = !supported
        updateControlLabels()
    } catch (error) {
        console.error(error)
        vrUnavailableLabel = 'VR is not available in this browser'
        vrToggleBtn.disabled = true
        updateControlLabels()
    }
}

async function toggleVrSession() {
    if (activeVrSession) {
        await activeVrSession.end()
        return
    }

    const xr = (navigator as Navigator & { xr?: XrSystemLike }).xr
    if (!xr) return
    try {
        const session = await xr.requestSession('immersive-vr', {
            optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
        })
        activeVrSession = session
        session.addEventListener('end', () => {
            activeVrSession = undefined
            vrToggleBtn.setAttribute('aria-pressed', 'false')
            updateControlLabels()
        }, { once: true })
        await scene.renderer.xr.setSession(session as any)
        vrToggleBtn.setAttribute('aria-pressed', 'true')
        updateControlLabels()
    } catch (error) {
        activeVrSession = undefined
        vrToggleBtn.setAttribute('aria-pressed', 'false')
        console.error(error)
        window.alert(translateUiText('VR session could not be started'))
        updateControlLabels()
    }
}

export function savePhoto() {
    return captureStill(true)
}

export function setupCaptureRecordingControls() {
    if (controlsInstalled) return
    controlsInstalled = true
    initializeRecordingSpecControls()
    const viewer = document.getElementById('viewer')
    if (viewer && typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => {
            if (!activeRecording && recordingResolutionSelect.value === 'current') updateRecordingSizeOutput()
        }).observe(viewer)
    }
    captureCharacterBtn.onclick = () => void captureStill(false)
    captureWithBackgroundBtn.onclick = () => void captureStill(true)
    recordCharacterBtn.onclick = () => startRecording('character', false, recordCharacterBtn)
    recordWithBackgroundBtn.onclick = () => startRecording('background', false, recordWithBackgroundBtn)
    recordMp4WithBackgroundBtn.onclick = () => startRecording('background', true, recordMp4WithBackgroundBtn)
    vrToggleBtn.onclick = () => void toggleVrSession()
    document.addEventListener('magius:localechange', updateControlLabels)
    updateControlLabels()
    void updateVrAvailability()
}

Object.assign(window, {
    savePhoto,
    createCaptureCanvas,
    stopMagiusRecording: stopActiveRecording,
})
