import { getLoadingTask, readLoadingResponse, yieldLoadingFrame } from './loadingProgress.ts'
import { gunzip } from 'fflate'
import * as THREE from 'three'

export type CharacterAssetLoadStage =
    | 'fbx-download'
    | 'fbx-decompress'
    | 'fbx-parse'
    | 'baked-normals'
    | 'home-runtime'
    | 'texture-download'
    | 'texture-decode'
    | 'texture-material'
    | 'physics-attach'

function errorReason(error: unknown): string {
    if (error instanceof Error && error.message) return error.message
    return String(error)
}

export class CharacterAssetLoadError extends Error {
    readonly stage: CharacterAssetLoadStage
    readonly url: string
    readonly cause: unknown

    constructor(
        stage: CharacterAssetLoadStage,
        url: string,
        cause: unknown,
    ) {
        const aborted = (
            cause instanceof DOMException && cause.name === 'AbortError'
        ) || (
            cause instanceof Error && cause.name === 'AbortError'
        )
        super(`[${stage}] ${url}: ${aborted ? 'aborted' : errorReason(cause)}`)
        this.name = aborted ? 'AbortError' : 'CharacterAssetLoadError'
        this.stage = stage
        this.url = url
        this.cause = cause
    }
}

export function characterAssetLoadError(
    stage: CharacterAssetLoadStage,
    url: string,
    error: unknown,
): CharacterAssetLoadError {
    if (
        error instanceof CharacterAssetLoadError
        || (
            error instanceof Error
            && typeof (error as Partial<CharacterAssetLoadError>).stage === 'string'
            && typeof (error as Partial<CharacterAssetLoadError>).url === 'string'
        )
    ) return error as CharacterAssetLoadError
    return new CharacterAssetLoadError(stage, url, error)
}

export function throwIfCharacterLoadAborted(
    signal: AbortSignal | undefined,
    stage: CharacterAssetLoadStage,
    url: string,
): void {
    if (!signal?.aborted) return
    const reason = signal.reason instanceof Error
        ? signal.reason
        : new DOMException('The character load was aborted', 'AbortError')
    throw characterAssetLoadError(stage, url, reason)
}

export function ObjFindByKey<T>(obj: Record<string, T>, predicate: (value: string) => boolean, lowerCase = true) {
    const key = Object.keys(obj).find(x => predicate(lowerCase ? x.toLowerCase() : x))
    if (key) return obj[key]
}

export function ObjFilterByKey<T>(obj: Record<string, T>, predicate: (value: string) => boolean, lowerCase = true) {
    return Object.keys(obj)
        .filter(x => predicate(lowerCase ? x.toLowerCase() : x))
        .reduce((newObj, key) => {
            newObj[key] = obj[key]
            return newObj
        }, {} as Record<string, T>)
}

/** Fetch the URL, decompress if it is gzip compressed. */
export async function fetchAndTryDecompressGzip(
    url: string,
    onDownload?: (e: ProgressEvent) => any,
    onDecompress?: () => any,
    signal?: AbortSignal,
): Promise<Blob> {
    signal?.throwIfAborted()
    const response = await fetch(url, { signal })
    if (!response.ok) {
        throw new Error(`Failed to download ${url}: HTTP ${response.status}`)
    }

    const arrayBuffer = await readLoadingResponse(response, {
        url, signal,
        onProgress: (loaded, total) => onDownload?.(new ProgressEvent('progress', {
            lengthComputable: total !== undefined, loaded, total: total ?? 0,
        })),
    })
    signal?.throwIfAborted()
    const byteArray = new Uint8Array(arrayBuffer)

    if (byteArray.byteLength === 0) {
        throw new Error(`Downloaded an empty payload from ${url}`)
    }

    const isGzip = byteArray[0] == 0x1F && byteArray[1] == 0x8B // gzip magic numbers
    let finalData: Uint8Array
    if (isGzip) {
        console.log('Decompressing gzip in JavaScript, the server did not set `Content-Encoding: gzip` to let it decompress by the browser.')
        getLoadingTask(signal)?.phase('decompressing', url)
        onDecompress?.()
        await yieldLoadingFrame(signal)
        finalData = await decompressGzip(byteArray, signal)
        signal?.throwIfAborted()
    } else {
        finalData = byteArray
    }

    // Keep only the exact returned view. Some decompressors use a pooled
    // backing buffer larger than the visible byte range.
    const exactBuffer = finalData.buffer.slice(
        finalData.byteOffset,
        finalData.byteOffset + finalData.byteLength,
    ) as ArrayBuffer
    return new Blob([exactBuffer], {
        type: 'application/octet-stream',
    })
}

async function readStreamWithAbort(
    stream: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
): Promise<Uint8Array> {
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []
    let byteLength = 0
    const abort = () => {
        void reader.cancel(signal?.reason).catch(() => undefined)
    }
    signal?.addEventListener('abort', abort, { once: true })
    try {
        while (true) {
            signal?.throwIfAborted()
            const result = await reader.read()
            if (result.done) break
            chunks.push(result.value)
            byteLength += result.value.byteLength
        }
    } finally {
        signal?.removeEventListener('abort', abort)
        reader.releaseLock()
    }
    const output = new Uint8Array(byteLength)
    let offset = 0
    for (const chunk of chunks) {
        output.set(chunk, offset)
        offset += chunk.byteLength
    }
    return output
}

function gunzipWithAbort(
    byteArray: Uint8Array,
    signal?: AbortSignal,
): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        let settled = false
        let terminate: (() => void) | undefined
        const abort = () => {
            if (settled) return
            settled = true
            terminate?.()
            reject(
                signal?.reason instanceof Error
                    ? signal.reason
                    : new DOMException('The gzip operation was aborted', 'AbortError'),
            )
        }
        terminate = gunzip(byteArray, (error, result) => {
            if (settled) return
            settled = true
            signal?.removeEventListener('abort', abort)
            if (error) reject(error)
            else resolve(result)
        })
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) abort()
    })
}

async function decompressGzip(
    byteArray: Uint8Array,
    signal?: AbortSignal,
): Promise<Uint8Array> {
    const exactInput = byteArray.buffer.slice(
        byteArray.byteOffset,
        byteArray.byteOffset + byteArray.byteLength,
    ) as ArrayBuffer

    // Prefer the browser's streaming gzip implementation. Besides avoiding a
    // second large temporary allocation in fflate, this path is robust when a
    // browser/legacy build transpiles typed-array subclasses differently.
    if (typeof DecompressionStream !== 'undefined') {
        try {
            const stream = new Blob([exactInput])
                .stream()
                .pipeThrough(new DecompressionStream('gzip'))
            const nativeResult = await readStreamWithAbort(stream, signal)
            if (nativeResult.byteLength > 0) {
                return nativeResult
            }
            console.warn(
                'Native gzip decompression returned an empty payload; falling back to fflate.',
                { compressedByteLength: byteArray.byteLength },
            )
        } catch (error) {
            if (signal?.aborted) throw error
            console.warn(
                'Native gzip decompression failed; falling back to fflate.',
                error,
            )
        }
    }

    const fallbackResult = await gunzipWithAbort(byteArray, signal)
    if (fallbackResult.byteLength === 0) {
        throw new Error(
            `Both native and fflate gzip decompression returned an empty payload for ${byteArray.byteLength} compressed bytes.`,
        )
    }
    return fallbackResult
}

export function humanizeBytes(b: number) {
    if (b < 1024 * 100) { // < 100 KB
        return (b / 1024).toFixed(1) + ' KB'
    } else if (b < 1024 * 1024) { // 100 KB - 1 MB
        return (b / 1024).toFixed(0) + ' KB'
    } else if (b < 1024 * 1024 * 10) { // 1 MB - 10 MB
        return (b / 1024 / 1024).toFixed(2) + ' MB'
    } else { // > 10 MB
        return (b / 1024 / 1024).toFixed(1) + ' MB'
    }
}

export function disposeObject(obj: THREE.Object3D) {
    const skeletons = new Set<THREE.Skeleton>()
    obj.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
                const skeleton = (mesh as THREE.SkinnedMesh).skeleton
                if (skeleton) skeletons.add(skeleton)
            }
            mesh.geometry.dispose();

            disposeMaterial(mesh.material);
            disposeMaterial(mesh.customDepthMaterial)
            disposeMaterial(mesh.customDistanceMaterial)
        }
    });
    for (const skeleton of skeletons) {
        // Meshes may share one skeleton. External proxies do not own its bones.
        const ownsBones = skeleton.bones.every(bone => {
            for (let current: THREE.Object3D | null = bone; current; current = current.parent) {
                if (current === obj) return true
            }
            return false
        })
        if (ownsBones) skeleton.dispose()
    }
}

function disposeMaterial(materials?: THREE.Material | THREE.Material[]) {
    if (!materials) return

    if (!Array.isArray(materials)) {
        materials = [materials]
    }

    materials.forEach(mat => {
        mat.dispose();
        // Check for textures
        Object.values(mat)
            .filter(x => x instanceof THREE.Texture)
            .forEach(x => x.dispose())
    })
}
