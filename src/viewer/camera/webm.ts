interface WebmSample {
    data: Uint8Array
    key: boolean
    timestampUs: number
}

interface RecorderOptions {
    width: number
    height: number
    bitrate: number
    frameRate: number
}

function concat(parts: readonly Uint8Array[]) {
    const length = parts.reduce((sum, part) => sum + part.length, 0)
    const result = new Uint8Array(length)
    let offset = 0
    for (const part of parts) {
        result.set(part, offset)
        offset += part.length
    }
    return result
}

function encodeVint(value: number) {
    const bigValue = BigInt(value)
    let width = 1
    while (width < 8 && bigValue >= (1n << BigInt(width * 7)) - 1n) width++
    const result = new Uint8Array(width)
    let remaining = bigValue
    for (let index = width - 1; index >= 0; index--) {
        result[index] = Number(remaining & 0xffn)
        remaining >>= 8n
    }
    result[0] |= 1 << (8 - width)
    return result
}

function unsigned(value: number, preferredWidth = 0) {
    let width = preferredWidth
    let remaining = BigInt(Math.max(0, Math.round(value)))
    if (width === 0) {
        width = 1
        while (width < 8 && remaining >= 1n << BigInt(width * 8)) width++
    }
    const result = new Uint8Array(width)
    for (let index = width - 1; index >= 0; index--) {
        result[index] = Number(remaining & 0xffn)
        remaining >>= 8n
    }
    return result
}

function float64(value: number) {
    const result = new Uint8Array(8)
    new DataView(result.buffer).setFloat64(0, value)
    return result
}

function ascii(value: string) {
    return Uint8Array.from(value, character => character.charCodeAt(0))
}

function element(id: readonly number[], payload: Uint8Array) {
    return concat([Uint8Array.from(id), encodeVint(payload.length), payload])
}

function createSimpleBlock(sample: WebmSample, clusterTimeMs: number) {
    const relativeTime = Math.round(sample.timestampUs / 1000) - clusterTimeMs
    if (relativeTime < -32768 || relativeTime > 32767) {
        throw new Error('WebM cluster timecode is out of range')
    }
    const header = new Uint8Array(4)
    header[0] = 0x81
    new DataView(header.buffer).setInt16(1, relativeTime)
    header[3] = sample.key ? 0x80 : 0
    return element([0xa3], concat([header, sample.data]))
}

function createClusters(samples: readonly WebmSample[]) {
    const clusters: Uint8Array[] = []
    let clusterSamples: WebmSample[] = []
    let clusterTimeMs = 0
    const flush = () => {
        if (clusterSamples.length === 0) return
        clusters.push(element(
            [0x1f, 0x43, 0xb6, 0x75],
            concat([
                element([0xe7], unsigned(clusterTimeMs)),
                ...clusterSamples.map(sample => createSimpleBlock(sample, clusterTimeMs)),
            ]),
        ))
        clusterSamples = []
    }

    for (const sample of samples) {
        const sampleTimeMs = Math.round(sample.timestampUs / 1000)
        if (
            clusterSamples.length > 0
            && ((sample.key && sampleTimeMs - clusterTimeMs >= 1_000) || sampleTimeMs - clusterTimeMs > 30_000)
        ) {
            flush()
            clusterTimeMs = sampleTimeMs
        }
        if (clusterSamples.length === 0) clusterTimeMs = sampleTimeMs
        clusterSamples.push(sample)
    }
    flush()
    return clusters
}

function muxVp9Webm(
    samples: readonly WebmSample[],
    width: number,
    height: number,
    frameRate: number,
    requestedDurationMs: number,
) {
    if (samples.length === 0) throw new Error('The WebM recording has no video frames')
    const durationMs = Math.max(
        1000 / frameRate,
        requestedDurationMs,
        samples.at(-1)!.timestampUs / 1000 + 1000 / frameRate,
    )
    const ebmlHeader = element(
        [0x1a, 0x45, 0xdf, 0xa3],
        concat([
            element([0x42, 0x86], unsigned(1)),
            element([0x42, 0xf7], unsigned(1)),
            element([0x42, 0xf2], unsigned(4)),
            element([0x42, 0xf3], unsigned(8)),
            element([0x42, 0x82], ascii('webm')),
            element([0x42, 0x87], unsigned(4)),
            element([0x42, 0x85], unsigned(2)),
        ]),
    )
    const info = element(
        [0x15, 0x49, 0xa9, 0x66],
        concat([
            element([0x2a, 0xd7, 0xb1], unsigned(1_000_000)),
            element([0x4d, 0x80], ascii('Magius3Dviewer')),
            element([0x57, 0x41], ascii('Magius3Dviewer')),
            element([0x44, 0x89], float64(durationMs)),
        ]),
    )
    const video = element(
        [0xe0],
        concat([
            element([0xb0], unsigned(width)),
            element([0xba], unsigned(height)),
        ]),
    )
    const trackEntry = element(
        [0xae],
        concat([
            element([0xd7], unsigned(1)),
            element([0x73, 0xc5], unsigned(1)),
            element([0x83], unsigned(1)),
            element([0x9c], unsigned(0)),
            element([0x86], ascii('V_VP9')),
            element([0x23, 0xe3, 0x83], unsigned(Math.round(1_000_000_000 / frameRate))),
            video,
        ]),
    )
    const tracks = element([0x16, 0x54, 0xae, 0x6b], trackEntry)
    const segment = concat([
        Uint8Array.from([0x18, 0x53, 0x80, 0x67]),
        Uint8Array.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
        info,
        tracks,
        ...createClusters(samples),
    ])
    return new Blob([ebmlHeader, segment], { type: 'video/webm' })
}

export class WebCodecsWebmRecorder {
    private readonly encoder: VideoEncoder
    private readonly samples: WebmSample[] = []
    private readonly options: RecorderOptions
    private encoderError?: Error
    private lastFrameSlot = -1
    private finished = false

    private constructor(encoder: VideoEncoder, options: RecorderOptions) {
        this.encoder = encoder
        this.options = options
    }

    static async create(options: RecorderOptions) {
        if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return undefined
        const config: VideoEncoderConfig = {
            codec: 'vp09.00.10.08',
            width: options.width,
            height: options.height,
            bitrate: options.bitrate,
            bitrateMode: 'constant',
            framerate: options.frameRate,
            latencyMode: 'realtime',
            hardwareAcceleration: 'prefer-hardware',
        }
        const support = await VideoEncoder.isConfigSupported(config)
        if (!support.supported) return undefined

        let recorder: WebCodecsWebmRecorder
        const encoder = new VideoEncoder({
            output: chunk => recorder.handleChunk(chunk),
            error: error => { recorder.encoderError = error },
        })
        recorder = new WebCodecsWebmRecorder(encoder, options)
        encoder.configure(support.config ?? config)
        return recorder
    }

    captureToElapsed(canvas: HTMLCanvasElement, elapsedMs: number) {
        if (this.finished) return
        if (this.encoderError) throw this.encoderError
        const targetFrameSlot = Math.max(0, Math.floor(elapsedMs * this.options.frameRate / 1000))
        if (targetFrameSlot <= this.lastFrameSlot || this.encoder.encodeQueueSize > 2) return
        const frameDuration = Math.round(1_000_000 / this.options.frameRate)
        const timestampUs = targetFrameSlot * frameDuration
        const frame = new VideoFrame(canvas, {
            timestamp: timestampUs,
            duration: frameDuration,
        })
        this.encoder.encode(frame, {
            keyFrame: targetFrameSlot % (this.options.frameRate * 2) === 0,
        })
        frame.close()
        this.lastFrameSlot = targetFrameSlot
    }

    needsFrame(elapsedMs: number) {
        if (this.finished || this.encoderError) return false
        const targetFrameSlot = Math.max(0, Math.floor(elapsedMs * this.options.frameRate / 1000))
        return targetFrameSlot > this.lastFrameSlot && this.encoder.encodeQueueSize <= 2
    }

    async finish(canvas: HTMLCanvasElement, elapsedMs: number) {
        if (this.finished) throw new Error('The WebM recorder is already stopped')
        this.captureToElapsed(canvas, elapsedMs)
        this.finished = true
        await this.encoder.flush()
        this.encoder.close()
        if (this.encoderError) throw this.encoderError
        return muxVp9Webm(
            this.samples,
            this.options.width,
            this.options.height,
            this.options.frameRate,
            elapsedMs,
        )
    }

    private handleChunk(chunk: EncodedVideoChunk) {
        const data = new Uint8Array(chunk.byteLength)
        chunk.copyTo(data)
        this.samples.push({
            data,
            key: chunk.type === 'key',
            timestampUs: chunk.timestamp,
        })
    }
}
