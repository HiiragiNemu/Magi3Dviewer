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
    return new Promise(async (resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('GET', url)
        xhr.responseType = 'arraybuffer'
        xhr.send()
        onDownload && (xhr.onprogress = onDownload);
        xhr.onload = () => {
            try {
                const arrayBuffer = xhr.response as unknown
                if (!(arrayBuffer instanceof ArrayBuffer)) {
                    reject('Response is not `ArrayBuffer`')
                    return
                }

                const byteArray = new Uint8Array(arrayBuffer)
                const isGzip = byteArray[0] == 0x1F && byteArray[1] == 0x8B // gzip magic numbers

                let finalData
                if (isGzip) {
                    console.log('Decompressing gzip in JavaScript, the server did not set `Content-Encoding: gzip` to let it decompress by the browser.')
                    onDecompress && onDecompress()
                    finalData = gunzipSync(byteArray) as typeof byteArray
                } else {
                    finalData = byteArray
                }
                resolve(new Blob([finalData]))
            } catch (e) {
                reject(e)
            }
        }
        xhr.onerror = reject
    })
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

            // Disposing materials and textures
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach(m => disposeMaterial(m));
            } else {
                disposeMaterial(mesh.material);
            }
        }
    });
}

function disposeMaterial(mat: THREE.Material) {
    mat.dispose();
    // Check for textures
    for (const key of Object.keys(mat)) {
        const value = (mat as any)[key];
        if (value && value.isTexture) {
            value.dispose();
        }
    }
}
