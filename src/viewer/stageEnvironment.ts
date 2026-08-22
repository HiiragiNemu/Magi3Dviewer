import * as THREE from 'three'
import { DDSLoader } from 'three/addons/loaders/DDSLoader.js'

export type StageEnvironmentEncoding =
    | 'unity-bc6h-uf16'
    | 'linear-image'
    | 'srgb-image'

interface ParsedDdsMipmap {
    data: Uint8Array
    width: number
    height: number
}

interface ParsedDds {
    width: number
    height: number
    isCubemap: boolean
    mipmapCount: number
    mipmaps: ParsedDdsMipmap[]
    format: number
}

interface CompressedCubeFace {
    width: number
    height: number
    format: number
    mipmaps: ParsedDdsMipmap[]
}

export function parseUnityBc6hCubemap(buffer: ArrayBuffer) {
    const parsed = new DDSLoader().parse(buffer, true) as ParsedDds
    if (
        !parsed.isCubemap
        || parsed.format !== THREE.RGB_BPTC_UNSIGNED_Format
        || parsed.mipmapCount < 1
        || parsed.mipmaps.length !== parsed.mipmapCount * 6
    ) {
        throw new Error('Stage environment is not a complete BC6H_UF16 cubemap')
    }

    const faces: CompressedCubeFace[] = []
    for (let face = 0; face < 6; face += 1) {
        faces.push({
            width: parsed.width,
            height: parsed.height,
            format: parsed.format,
            mipmaps: parsed.mipmaps.slice(
                face * parsed.mipmapCount,
                (face + 1) * parsed.mipmapCount,
            ),
        })
    }
    const texture = new THREE.CompressedCubeTexture(
        faces as unknown as THREE.CompressedTexture[],
        THREE.RGB_BPTC_UNSIGNED_Format,
        THREE.UnsignedByteType,
    )
    texture.name = 'UnityBC6HEnvironment'
    texture.colorSpace = THREE.LinearSRGBColorSpace
    texture.mapping = THREE.CubeReflectionMapping
    texture.generateMipmaps = false
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.userData.stageEnvironment = {
        encoding: 'unity-bc6h-uf16',
        width: parsed.width,
        height: parsed.height,
        mipmapCount: parsed.mipmapCount,
        faceOrder: ['+X', '-X', '+Y', '-Y', '+Z', '-Z'],
        viewerCoordinateMapping: 'external-cubemap-x-flip',
    }
    texture.needsUpdate = true
    return texture
}

export async function loadStageEnvironment(
    url: string,
    encoding: StageEnvironmentEncoding,
    renderer: THREE.WebGLRenderer,
    signal: AbortSignal,
): Promise<THREE.Texture> {
    if (encoding === 'unity-bc6h-uf16') {
        if (!renderer.extensions.has('EXT_texture_compression_bptc')) {
            throw new Error('This GPU does not expose EXT_texture_compression_bptc')
        }
        const response = await fetch(new URL(url, document.baseURI).href, {
            cache: 'no-cache',
            signal,
        })
        if (!response.ok) {
            throw new Error(`Could not load BC6H stage environment: ${response.status}`)
        }
        const texture = parseUnityBc6hCubemap(await response.arrayBuffer())
        signal.throwIfAborted()
        return texture
    }

    const texture = await new THREE.TextureLoader().loadAsync(
        new URL(url, document.baseURI).href,
    )
    if (signal.aborted) {
        texture.dispose()
        signal.throwIfAborted()
    }
    texture.mapping = THREE.EquirectangularReflectionMapping
    texture.colorSpace = encoding === 'linear-image'
        ? THREE.LinearSRGBColorSpace
        : THREE.SRGBColorSpace
    texture.needsUpdate = true
    return texture
}
