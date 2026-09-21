import * as THREE from 'three'
import { resolvePageAssetUrl, resolveRuntimeAssetUrl } from './runtimeProductDelivery'

/** Transport of decoded ORIGINAL levels, never levels generated from mip zero. */
export interface NativeLightmapMips {
    schema: 'unity-native-lightmap-mips.v1'
    encoding: 'unity-rgbm-linear'
    dataFormat: 'rgba8'
    dataUrl: string
    width: number
    height: number
    mipCount: number
    byteLength: number
    mips: Array<{ level: number, width: number, height: number, offset: number, bytes: number }>
    sampler: { filterMode: number, wrapU: number, wrapV: number, anisotropy: number, mipBias: number }
    source: Record<string, unknown>
}

export function validateNativeLightmapMips(value: unknown): NativeLightmapMips {
    const m = value as NativeLightmapMips
    if (!m || m.schema !== 'unity-native-lightmap-mips.v1'
        || m.encoding !== 'unity-rgbm-linear' || m.dataFormat !== 'rgba8'
        || typeof m.dataUrl !== 'string' || !m.dataUrl
        || !Number.isInteger(m.width) || m.width < 1 || m.width > 16384
        || !Number.isInteger(m.height) || m.height < 1 || m.height > 16384
        || !Array.isArray(m.mips)
        || m.mipCount !== 1 + Math.floor(Math.log2(Math.max(m.width, m.height)))
        || m.mips.length !== m.mipCount) {
        throw new Error('Incomplete native lightmap mip manifest')
    }
    let offset = 0
    for (let level = 0; level < m.mipCount; level++) {
        const entry = m.mips[level]
        const width = Math.max(1, Math.floor(m.width / 2 ** level))
        const height = Math.max(1, Math.floor(m.height / 2 ** level))
        if (!entry || entry.level !== level || entry.width !== width || entry.height !== height
            || entry.offset !== offset || entry.bytes !== width * height * 4) {
            throw new Error(`Invalid native lightmap mip ${level}`)
        }
        offset += entry.bytes
    }
    const s = m.sampler
    if (m.byteLength !== offset || !s || ![0, 1, 2].includes(s.filterMode)
        || ![0, 1, 2].includes(s.wrapU) || ![0, 1, 2].includes(s.wrapV)
        || !Number.isInteger(s.anisotropy) || s.anisotropy < 1 || s.mipBias !== 0) {
        throw new Error('Unsupported or incomplete native lightmap sampler/payload')
    }
    return m
}

export function createNativeLightmapTexture(value: unknown, payload: ArrayBuffer) {
    const manifest = validateNativeLightmapMips(value)
    if (payload.byteLength !== manifest.byteLength) {
        throw new Error('Native lightmap payload length differs from exact mip chain')
    }
    const mips = manifest.mips.map(m => ({
        data: new Uint8Array(payload, m.offset, m.bytes), width: m.width, height: m.height,
    }))
    const texture = new THREE.DataTexture(mips[0].data, manifest.width, manifest.height,
        THREE.RGBAFormat, THREE.UnsignedByteType)
    texture.name = 'UnityNativeMipLightmap'
    texture.mipmaps = mips
    texture.generateMipmaps = false
    texture.colorSpace = THREE.NoColorSpace
    texture.channel = 1
    texture.flipY = false
    texture.premultiplyAlpha = false
    texture.unpackAlignment = 1
    const wrap = [THREE.RepeatWrapping, THREE.ClampToEdgeWrapping, THREE.MirroredRepeatWrapping] as const
    texture.wrapS = wrap[manifest.sampler.wrapU]
    texture.wrapT = wrap[manifest.sampler.wrapV]
    texture.magFilter = manifest.sampler.filterMode === 0 ? THREE.NearestFilter : THREE.LinearFilter
    const min = [THREE.NearestMipmapNearestFilter, THREE.LinearMipmapNearestFilter,
        THREE.LinearMipmapLinearFilter] as const
    texture.minFilter = manifest.mipCount > 1 ? min[manifest.sampler.filterMode] : texture.magFilter
    texture.anisotropy = manifest.sampler.anisotropy
    texture.userData.stageLightmap = {
        encoding: manifest.encoding, width: manifest.width, height: manifest.height,
        mipmapCount: manifest.mipCount, mipOrigin: 'decoded-original-native-levels',
        sampler: { ...manifest.sampler }, source: manifest.source,
    }
    texture.needsUpdate = true
    return texture
}

/** Three r182 skips anisotropy for mip-nearest filters. Set it on this texture
 * while its upload callback owns the binding; never alter another GL texture. */
export function uploadNativeLightmapTexture(texture: THREE.DataTexture, renderer: THREE.WebGLRenderer) {
    if (Math.max(texture.image.width, texture.image.height) > renderer.capabilities.maxTextureSize) {
        throw new Error('Native lightmap exceeds this GPU texture size')
    }
    const gl = renderer.getContext()
    const extension = renderer.extensions.get('EXT_texture_filter_anisotropic') as
        { TEXTURE_MAX_ANISOTROPY_EXT: number } | null
    if (texture.anisotropy > 1 && (!extension || renderer.capabilities.getMaxAnisotropy() < texture.anisotropy)) {
        throw new Error(`Native lightmap requires anisotropy ${texture.anisotropy}`)
    }
    texture.onUpdate = () => {
        const expected = (renderer.properties.get(texture) as { __webglTexture?: WebGLTexture }).__webglTexture
        if (!expected || gl.getParameter(gl.TEXTURE_BINDING_2D) !== expected) {
            throw new Error('Native lightmap upload callback has no owned texture binding')
        }
        if (extension) gl.texParameterf(gl.TEXTURE_2D, extension.TEXTURE_MAX_ANISOTROPY_EXT, texture.anisotropy)
        texture.userData.stageLightmap.uploadedSampler = {
            minFilter: gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER),
            magFilter: gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER),
            wrapS: gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S),
            wrapT: gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T),
            anisotropy: extension ? gl.getTexParameter(gl.TEXTURE_2D, extension.TEXTURE_MAX_ANISOTROPY_EXT) : 1,
        }
    }
    renderer.initTexture(texture)
}

export async function loadNativeLightmapMips(url: string, renderer: THREE.WebGLRenderer, signal: AbortSignal) {
    const response = await fetch(await resolveRuntimeAssetUrl(url, signal), { cache: 'no-cache', signal })
    if (!response.ok) throw new Error(`Could not load native lightmap manifest: ${response.status}`)
    const manifest = validateNativeLightmapMips(await response.json())
    // Resolve relative to the LOGICAL manifest, not a blob URL returned by packed delivery.
    const dataUrl = new URL(manifest.dataUrl, resolvePageAssetUrl(url)).href
    const bytes = await fetch(await resolveRuntimeAssetUrl(dataUrl, signal), { cache: 'no-cache', signal })
    if (!bytes.ok) throw new Error(`Could not load native lightmap mip bytes: ${bytes.status}`)
    const payload = await bytes.arrayBuffer()
    signal.throwIfAborted()
    const texture = createNativeLightmapTexture(manifest, payload)
    try {
        uploadNativeLightmapTexture(texture, renderer)
        signal.throwIfAborted()
        return texture
    } catch (error) {
        texture.dispose()
        throw error
    }
}
