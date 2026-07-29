import { gunzipSync } from 'fflate'
import * as THREE from 'three'

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

/** Fetch the URL, decompress if it is gzip compressed */
export async function fetchAndTryDecompressGzip(url: string, onDownload?: (e: ProgressEvent) => any, onDecompress?: () => any): Promise<Blob> {
    const response = await fetch(url)
    if (!response.ok) {
        throw new Error(`Failed to download ${url}: HTTP ${response.status}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    const byteArray = new Uint8Array(arrayBuffer)
    const total = Number(response.headers.get('content-length')) || byteArray.byteLength
    onDownload?.(new ProgressEvent('progress', {
        lengthComputable: total > 0,
        loaded: byteArray.byteLength,
        total,
    }))

    if (byteArray.byteLength === 0) {
        throw new Error(`Downloaded an empty payload from ${url}`)
    }

    const isGzip = byteArray[0] == 0x1F && byteArray[1] == 0x8B // gzip magic numbers
    let finalData: Uint8Array
    if (isGzip) {
        console.log('Decompressing gzip in JavaScript, the server did not set `Content-Encoding: gzip` to let it decompress by the browser.')
        onDecompress?.()
        finalData = await decompressGzip(byteArray)
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

async function decompressGzip(byteArray: Uint8Array): Promise<Uint8Array> {
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
            const nativeResult = new Uint8Array(await new Response(stream).arrayBuffer())
            if (nativeResult.byteLength > 0) {
                return nativeResult
            }
            console.warn(
                'Native gzip decompression returned an empty payload; falling back to fflate.',
                { compressedByteLength: byteArray.byteLength },
            )
        } catch (error) {
            console.warn(
                'Native gzip decompression failed; falling back to fflate.',
                error,
            )
        }
    }

    const fallbackResult = gunzipSync(byteArray) as typeof byteArray
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
    obj.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.geometry.dispose();

            disposeMaterial(mesh.material);
            disposeMaterial(mesh.customDepthMaterial)
            disposeMaterial(mesh.customDistanceMaterial)
        }
    });
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
