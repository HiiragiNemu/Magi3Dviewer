import * as THREE from 'three'
import { DDSLoader } from 'three/addons/loaders/DDSLoader.js'
import { resolveRuntimeAssetUrl } from './runtimeProductDelivery'

export type StageEnvironmentEncoding =
    | 'unity-bc6h-uf16'
    | 'unity-rgba16f'
    | 'linear-image'
    | 'srgb-image'

const equirectangularCubeTargets = new WeakMap<
    THREE.Texture,
    THREE.WebGLCubeRenderTarget
>()

async function assertStageAssetResponse(url: string, signal: AbortSignal) {
    const response = await fetch(url, { method: url.startsWith('blob:') ? 'GET' : 'HEAD', cache: 'no-cache', signal })
    // Blob URLs support GET only; release the unused validation body.
    await response.body?.cancel().catch(() => undefined)
    signal.throwIfAborted()
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (!response.ok) {
        throw new Error(`STAGE_ASSET_HTTP_${response.status}: ${url}`)
    }
    if (contentType.includes('text/html')) {
        throw new Error(`STAGE_ASSET_HTML_FALLBACK: ${url}`)
    }
    return url
}

export function convertStageEnvironmentToCubemap(
    texture: THREE.Texture,
    renderer: THREE.WebGLRenderer,
) {
    if ('isCubeTexture' in texture && texture.isCubeTexture === true) {
        return texture as THREE.CubeTexture | THREE.CompressedCubeTexture
    }
    const image = texture.image as { height?: number } | undefined
    const faceSize = Math.floor(image?.height ?? 0)
    if (faceSize <= 0) {
        throw new Error('Equirectangular stage environment has no image height')
    }
    const target = new THREE.WebGLCubeRenderTarget(faceSize)
        .fromEquirectangularTexture(renderer, texture)
    target.texture.mapping = THREE.CubeReflectionMapping
    target.texture.name = `${texture.name || 'StageEnvironment'}:Cube`
    target.texture.userData.stageEnvironment = {
        ...texture.userData.stageEnvironment,
        convertedFromEquirectangular: true,
        faceSize,
        mipmapCount: Math.floor(Math.log2(faceSize)) + 1,
    }
    equirectangularCubeTargets.set(target.texture, target)
    texture.dispose()
    return target.texture
}

export function disposeStageEnvironmentTexture(texture: THREE.Texture) {
    const target = equirectangularCubeTargets.get(texture)
    if (target) {
        equirectangularCubeTargets.delete(texture)
        target.dispose()
        return
    }
    texture.dispose()
}

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

interface Rgba16fMipmap {
    data: Uint16Array
    width: number
    height: number
}

const DDS_MAGIC = 0x20534444
const DDS_FOURCC_DX10 = 0x30315844
const DXGI_FORMAT_R16G16B16A16_FLOAT = 10
const D3D10_RESOURCE_DIMENSION_TEXTURE2D = 3
const D3D11_RESOURCE_MISC_TEXTURECUBE = 0x4
const DDSCAPS2_ALL_CUBEMAP_FACES = 0xfe00
const DDS_DX10_DATA_OFFSET = 148

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

export function parseUnityRgba16fCubemap(buffer: ArrayBuffer) {
    if (buffer.byteLength < DDS_DX10_DATA_OFFSET) {
        throw new Error('Stage environment RGBAHalf DDS is truncated')
    }
    const view = new DataView(buffer)
    const headerSize = view.getUint32(4, true)
    const height = view.getUint32(12, true)
    const width = view.getUint32(16, true)
    const mipmapCount = view.getUint32(28, true)
    const pixelFormatSize = view.getUint32(76, true)
    const fourCC = view.getUint32(84, true)
    const caps2 = view.getUint32(112, true)
    const dxgiFormat = view.getUint32(128, true)
    const resourceDimension = view.getUint32(132, true)
    const miscFlag = view.getUint32(136, true)
    const arraySize = view.getUint32(140, true)
    if (
        view.getUint32(0, true) !== DDS_MAGIC
        || headerSize !== 124
        || pixelFormatSize !== 32
        || fourCC !== DDS_FOURCC_DX10
        || dxgiFormat !== DXGI_FORMAT_R16G16B16A16_FLOAT
        || resourceDimension !== D3D10_RESOURCE_DIMENSION_TEXTURE2D
        || (miscFlag & D3D11_RESOURCE_MISC_TEXTURECUBE) === 0
        || (caps2 & DDSCAPS2_ALL_CUBEMAP_FACES) !== DDSCAPS2_ALL_CUBEMAP_FACES
        || arraySize !== 1
        || width < 1
        || height < 1
        || mipmapCount < 1
    ) {
        throw new Error('Stage environment is not a complete Unity RGBAHalf cubemap')
    }

    const mipByteCounts: number[] = []
    let mipWidth = width
    let mipHeight = height
    for (let level = 0; level < mipmapCount; level += 1) {
        mipByteCounts.push(mipWidth * mipHeight * 4 * Uint16Array.BYTES_PER_ELEMENT)
        mipWidth = Math.max(1, mipWidth >> 1)
        mipHeight = Math.max(1, mipHeight >> 1)
    }
    const faceChainByteCount = mipByteCounts.reduce((sum, size) => sum + size, 0)
    if (buffer.byteLength !== DDS_DX10_DATA_OFFSET + faceChainByteCount * 6) {
        throw new Error('Stage environment RGBAHalf cubemap byte count is invalid')
    }

    const faceMipmaps: Rgba16fMipmap[][] = []
    let offset = DDS_DX10_DATA_OFFSET
    for (let face = 0; face < 6; face += 1) {
        const mipmaps: Rgba16fMipmap[] = []
        let levelWidth = width
        let levelHeight = height
        for (const byteCount of mipByteCounts) {
            const data = new Uint16Array(byteCount / Uint16Array.BYTES_PER_ELEMENT)
            for (let index = 0; index < data.length; index += 1) {
                data[index] = view.getUint16(offset + index * 2, true)
            }
            mipmaps.push({ data, width: levelWidth, height: levelHeight })
            offset += byteCount
            levelWidth = Math.max(1, levelWidth >> 1)
            levelHeight = Math.max(1, levelHeight >> 1)
        }
        faceMipmaps.push(mipmaps)
    }

    const makeFace = ({ data, width: faceWidth, height: faceHeight }: Rgba16fMipmap) => {
        const face = new THREE.DataTexture(
            data,
            faceWidth,
            faceHeight,
            THREE.RGBAFormat,
            THREE.HalfFloatType,
        )
        face.colorSpace = THREE.LinearSRGBColorSpace
        face.generateMipmaps = false
        face.flipY = false
        return face
    }
    const texture = new THREE.CubeTexture(faceMipmaps.map(face => makeFace(face[0])))
    texture.mipmaps = Array.from(
        { length: mipmapCount - 1 },
        (_, mipIndex) => new THREE.CubeTexture(
            faceMipmaps.map(face => makeFace(face[mipIndex + 1])),
        ),
    )
    texture.name = 'UnityRGBAHalfEnvironment'
    texture.format = THREE.RGBAFormat
    texture.type = THREE.HalfFloatType
    texture.colorSpace = THREE.LinearSRGBColorSpace
    texture.mapping = THREE.CubeReflectionMapping
    texture.generateMipmaps = false
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.userData.stageEnvironment = {
        encoding: 'unity-rgba16f',
        width,
        height,
        mipmapCount,
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
    if (encoding === 'unity-rgba16f') {
        const resolvedUrl = await resolveRuntimeAssetUrl(url, signal)
        await assertStageAssetResponse(resolvedUrl, signal)
        const response = await fetch(resolvedUrl, {
            cache: 'no-cache',
            signal,
        })
        if (!response.ok) {
            throw new Error(`Could not load RGBAHalf stage environment: ${response.status}`)
        }
        const texture = parseUnityRgba16fCubemap(await response.arrayBuffer())
        signal.throwIfAborted()
        return texture
    }
    if (encoding === 'unity-bc6h-uf16') {
        if (!renderer.extensions.has('EXT_texture_compression_bptc')) {
            throw new Error('This GPU does not expose EXT_texture_compression_bptc')
        }
        const resolvedUrl = await resolveRuntimeAssetUrl(url, signal)
        await assertStageAssetResponse(resolvedUrl, signal)
        const response = await fetch(resolvedUrl, {
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

    const resolvedUrl = await resolveRuntimeAssetUrl(url, signal)
    await assertStageAssetResponse(resolvedUrl, signal)
    const texture = await new THREE.TextureLoader().loadAsync(resolvedUrl)
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
