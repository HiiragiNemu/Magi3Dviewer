interface AvcSample {
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

function selectAvcCodec(width: number, height: number) {
    const macroblocksPerFrame = Math.ceil(width / 16) * Math.ceil(height / 16)
    if (macroblocksPerFrame <= 3_600) return 'avc1.42001f'
    if (macroblocksPerFrame <= 8_192) return 'avc1.42002a'
    if (macroblocksPerFrame <= 36_864) return 'avc1.420033'
    return 'avc1.42003c'
}

function bytes(...values: number[]) {
    return Uint8Array.from(values)
}

function zeros(length: number) {
    return new Uint8Array(length)
}

function uint16(value: number) {
    const result = new Uint8Array(2)
    new DataView(result.buffer).setUint16(0, value)
    return result
}

function int16(value: number) {
    const result = new Uint8Array(2)
    new DataView(result.buffer).setInt16(0, value)
    return result
}

function uint32(value: number) {
    const result = new Uint8Array(4)
    new DataView(result.buffer).setUint32(0, value)
    return result
}

function ascii(value: string) {
    return Uint8Array.from(value, character => character.charCodeAt(0))
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

function box(type: string, ...payload: Uint8Array[]) {
    const body = concat(payload)
    return concat([uint32(body.length + 8), ascii(type), body])
}

function fullBox(type: string, version: number, flags: number, ...payload: Uint8Array[]) {
    return box(
        type,
        bytes(version, (flags >>> 16) & 0xff, (flags >>> 8) & 0xff, flags & 0xff),
        ...payload,
    )
}

const identityMatrix = concat([
    uint32(0x00010000), uint32(0), uint32(0),
    uint32(0), uint32(0x00010000), uint32(0),
    uint32(0), uint32(0), uint32(0x40000000),
])

function createAvcSampleEntry(width: number, height: number, decoderConfig: Uint8Array) {
    return box(
        'avc1',
        zeros(6),
        uint16(1),
        zeros(16),
        uint16(width),
        uint16(height),
        uint32(0x00480000),
        uint32(0x00480000),
        uint32(0),
        uint16(1),
        zeros(32),
        uint16(0x0018),
        uint16(0xffff),
        box('avcC', decoderConfig),
    )
}

function createMovieBox(
    samples: readonly AvcSample[],
    decoderConfig: Uint8Array,
    width: number,
    height: number,
    frameDurations: readonly number[],
    mediaDataOffset: number,
) {
    const mediaTimescale = 1_000_000
    const mediaDuration = frameDurations.reduce((sum, duration) => sum + duration, 0)
    const movieTimescale = 1_000
    const movieDuration = Math.round(mediaDuration * movieTimescale / mediaTimescale)
    const movieHeader = fullBox(
        'mvhd',
        0,
        0,
        uint32(0),
        uint32(0),
        uint32(movieTimescale),
        uint32(movieDuration),
        uint32(0x00010000),
        uint16(0x0100),
        uint16(0),
        zeros(8),
        identityMatrix,
        zeros(24),
        uint32(2),
    )
    const trackHeader = fullBox(
        'tkhd',
        0,
        0x000007,
        uint32(0),
        uint32(0),
        uint32(1),
        uint32(0),
        uint32(movieDuration),
        zeros(8),
        int16(0),
        int16(0),
        uint16(0),
        uint16(0),
        identityMatrix,
        uint32(width << 16),
        uint32(height << 16),
    )
    const mediaHeader = fullBox(
        'mdhd',
        0,
        0,
        uint32(0),
        uint32(0),
        uint32(mediaTimescale),
        uint32(mediaDuration),
        uint16(0x55c4),
        uint16(0),
    )
    const handler = fullBox(
        'hdlr',
        0,
        0,
        uint32(0),
        ascii('vide'),
        zeros(12),
        ascii('VideoHandler\0'),
    )
    const sampleDescription = fullBox(
        'stsd',
        0,
        0,
        uint32(1),
        createAvcSampleEntry(width, height, decoderConfig),
    )
    const timingEntries: Array<{ count: number, duration: number }> = []
    for (const duration of frameDurations) {
        const previous = timingEntries.at(-1)
        if (previous?.duration === duration) previous.count++
        else timingEntries.push({ count: 1, duration })
    }
    const timeToSample = fullBox(
        'stts',
        0,
        0,
        uint32(timingEntries.length),
        ...timingEntries.flatMap(entry => [uint32(entry.count), uint32(entry.duration)]),
    )
    const sampleToChunk = fullBox(
        'stsc',
        0,
        0,
        uint32(1),
        uint32(1),
        uint32(samples.length),
        uint32(1),
    )
    const sampleSizes = fullBox(
        'stsz',
        0,
        0,
        uint32(0),
        uint32(samples.length),
        ...samples.map(sample => uint32(sample.data.length)),
    )
    const chunkOffset = fullBox('stco', 0, 0, uint32(1), uint32(mediaDataOffset))
    const keySamples = samples
        .map((sample, index) => sample.key ? index + 1 : 0)
        .filter(Boolean)
    const syncSamples = fullBox(
        'stss',
        0,
        0,
        uint32(keySamples.length),
        ...keySamples.map(uint32),
    )
    const sampleTable = box(
        'stbl',
        sampleDescription,
        timeToSample,
        sampleToChunk,
        sampleSizes,
        chunkOffset,
        syncSamples,
    )
    const videoMediaHeader = fullBox(
        'vmhd',
        0,
        1,
        uint16(0),
        uint16(0),
        uint16(0),
        uint16(0),
    )
    const dataReference = fullBox(
        'dref',
        0,
        0,
        uint32(1),
        fullBox('url ', 0, 1),
    )
    const dataInformation = box('dinf', dataReference)
    const mediaInformation = box('minf', videoMediaHeader, dataInformation, sampleTable)
    const media = box('mdia', mediaHeader, handler, mediaInformation)
    return box('moov', movieHeader, box('trak', trackHeader, media))
}

function muxAvcMp4(
    samples: readonly AvcSample[],
    decoderConfig: Uint8Array,
    width: number,
    height: number,
    frameRate: number,
    durationMs: number,
) {
    if (samples.length === 0) throw new Error('The MP4 recording has no video frames')
    const defaultFrameDuration = Math.round(1_000_000 / frameRate)
    const requestedDuration = Math.max(defaultFrameDuration, Math.round(durationMs * 1000))
    const mediaDuration = Math.max(
        requestedDuration,
        samples.at(-1)!.timestampUs + defaultFrameDuration,
    )
    const frameDurations = samples.map((sample, index) => {
        const nextTimestamp = samples[index + 1]?.timestampUs ?? mediaDuration
        return Math.max(1, Math.round(nextTimestamp - sample.timestampUs))
    })
    const fileType = box(
        'ftyp',
        ascii('isom'),
        uint32(512),
        ascii('isom'),
        ascii('iso2'),
        ascii('avc1'),
        ascii('mp41'),
    )
    const placeholderMovie = createMovieBox(
        samples,
        decoderConfig,
        width,
        height,
        frameDurations,
        0,
    )
    const mediaDataOffset = fileType.length + placeholderMovie.length + 8
    const movie = createMovieBox(
        samples,
        decoderConfig,
        width,
        height,
        frameDurations,
        mediaDataOffset,
    )
    const mediaPayloadSize = samples.reduce((sum, sample) => sum + sample.data.length, 0)
    if (mediaPayloadSize + 8 > 0xffffffff) throw new Error('The MP4 recording is too large')
    const mediaData = box('mdat', ...samples.map(sample => sample.data))
    return new Blob([fileType, movie, mediaData], { type: 'video/mp4' })
}

function copyBufferSource(source: AllowSharedBufferSource) {
    if (ArrayBuffer.isView(source)) {
        return new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice()
    }
    return new Uint8Array(source as ArrayBufferLike).slice()
}

export class WebCodecsMp4Recorder {
    private readonly encoder: VideoEncoder
    private readonly samples: AvcSample[] = []
    private readonly options: RecorderOptions
    private decoderConfig?: Uint8Array
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
            codec: selectAvcCodec(options.width, options.height),
            width: options.width,
            height: options.height,
            bitrate: options.bitrate,
            bitrateMode: 'constant',
            framerate: options.frameRate,
            latencyMode: 'realtime',
            hardwareAcceleration: 'prefer-hardware',
            avc: { format: 'avc' },
        }
        const support = await VideoEncoder.isConfigSupported(config)
        if (!support.supported) return undefined

        let recorder: WebCodecsMp4Recorder
        const encoder = new VideoEncoder({
            output: (chunk, metadata) => recorder.handleChunk(chunk, metadata),
            error: error => { recorder.encoderError = error },
        })
        recorder = new WebCodecsMp4Recorder(encoder, options)
        encoder.configure(support.config ?? config)
        return recorder
    }

    captureToElapsed(canvas: HTMLCanvasElement, elapsedMs: number) {
        if (this.finished) return
        if (this.encoderError) throw this.encoderError
        const targetFrameSlot = Math.max(0, Math.floor(elapsedMs * this.options.frameRate / 1000))
        if (targetFrameSlot <= this.lastFrameSlot || this.encoder.encodeQueueSize > 2) return
        const frameDuration = Math.round(1_000_000 / this.options.frameRate)
        const frame = new VideoFrame(canvas, {
            timestamp: targetFrameSlot * frameDuration,
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
        if (this.finished) throw new Error('The MP4 recorder is already stopped')
        this.captureToElapsed(canvas, elapsedMs)
        this.finished = true
        await this.encoder.flush()
        this.encoder.close()
        if (this.encoderError) throw this.encoderError
        if (!this.decoderConfig) throw new Error('The H.264 decoder configuration is missing')
        return muxAvcMp4(
            this.samples,
            this.decoderConfig,
            this.options.width,
            this.options.height,
            this.options.frameRate,
            elapsedMs,
        )
    }

    private handleChunk(chunk: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata) {
        const data = new Uint8Array(chunk.byteLength)
        chunk.copyTo(data)
        this.samples.push({
            data,
            key: chunk.type === 'key',
            timestampUs: chunk.timestamp,
        })
        const description = metadata?.decoderConfig?.description
        if (description) this.decoderConfig = copyBufferSource(description)
    }
}
