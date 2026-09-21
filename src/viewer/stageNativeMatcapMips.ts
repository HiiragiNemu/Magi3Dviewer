import * as THREE from 'three'
import { resolvePageAssetUrl, resolveRuntimeAssetUrl } from './runtimeProductDelivery'
import type { StageTextureBinding } from './stageMaterialBindings'

/** Explicit authored-mip transport, like NativeLightmapMips, but sRGB MatCap
 * pixels are color: never use the lightmap RGBM/NoColorSpace/channel-1 path. */
export interface NativeMatcapMips {
    schema: 'unity-native-matcap-mips.v1'
    role: 'matCap'
    encoding: 'srgb-color'
    dataFormat: 'rgba8'
    dataUrl: string
    width: number
    height: number
    mipCount: number
    byteLength: number
    mips: Array<{ level: number, width: number, height: number, offset: number, bytes: number }>
    sampler: { filter: 'bilinear', wrap: { u: 'repeat', v: 'repeat' }, anisotropy: number, mipBias: number }
    source: { platform: string, bundle: string, cab: string, pathID: string, serializedColorSpace: string }
}

export function validateNativeMatcapMips(value: unknown, binding: StageTextureBinding): NativeMatcapMips {
    const m = value as NativeMatcapMips
    if (!m || m.schema !== 'unity-native-matcap-mips.v1' || m.role !== 'matCap'
        || m.encoding !== 'srgb-color' || m.dataFormat !== 'rgba8'
        || typeof m.dataUrl !== 'string' || !m.dataUrl
        || !Number.isInteger(m.width) || m.width < 1 || m.width > 16384
        || !Number.isInteger(m.height) || m.height < 1 || m.height > 16384
        || m.mipCount !== 1 + Math.floor(Math.log2(Math.max(m.width, m.height)))
        || !Array.isArray(m.mips) || m.mips.length !== m.mipCount) {
        throw new Error('Incomplete native sRGB MatCap mip manifest')
    }
    let offset = 0
    for (let level = 0; level < m.mipCount; level++) {
        const row = m.mips[level]
        const width = Math.max(1, Math.floor(m.width / 2 ** level))
        const height = Math.max(1, Math.floor(m.height / 2 ** level))
        if (!row || row.level !== level || row.width !== width || row.height !== height
            || row.offset !== offset || row.bytes !== width * height * 4) {
            throw new Error(`Invalid native MatCap mip ${level}`)
        }
        offset += row.bytes
    }
    const s = m.sampler
    const source = m.source
    if (m.byteLength !== offset || !s || s.filter !== 'bilinear'
        || s.wrap?.u !== 'repeat' || s.wrap?.v !== 'repeat' || s.anisotropy !== 1 || s.mipBias !== 0
        || !source || source.platform !== 'tw-android' || source.serializedColorSpace !== 'srgb'
        || !source.bundle || !source.cab || !source.pathID
        || binding.evidence !== 'exact-unity-texture2d' || binding.sourceProperty !== '_MatCapTex'
        || binding.coordinates.kind !== 'view-normal'
        || binding.colorSpace !== 'srgb' || binding.serializedColorSpace !== 'srgb'
        || binding.sourceTextureBundle !== source.bundle || binding.sourceTextureCab !== source.cab
        || binding.sourceTexturePathId !== source.pathID || binding.mipCount !== m.mipCount
        || binding.filter !== s.filter || binding.wrap.u !== s.wrap.u || binding.wrap.v !== s.wrap.v
        || binding.anisotropy !== s.anisotropy || binding.mipBias !== s.mipBias) {
        throw new Error('Native MatCap source identity, color role or sampler differs from binding')
    }
    return m
}

export function createNativeMatcapTexture(value: unknown, payload: ArrayBuffer, binding: StageTextureBinding) {
    const manifest = validateNativeMatcapMips(value, binding)
    if (payload.byteLength !== manifest.byteLength) throw new Error('Native MatCap mip payload length mismatch')
    const mips = manifest.mips.map(m => ({
        data: new Uint8Array(payload, m.offset, m.bytes), width: m.width, height: m.height,
    }))
    const texture = new THREE.DataTexture(mips[0].data, manifest.width, manifest.height,
        THREE.RGBAFormat, THREE.UnsignedByteType)
    texture.mipmaps = mips
    texture.generateMipmaps = false
    texture.colorSpace = THREE.SRGBColorSpace
    // Raw native rows equal PNG flip-by-export + TextureLoader upload flip.
    texture.flipY = false
    texture.premultiplyAlpha = false
    texture.unpackAlignment = 1
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.magFilter = THREE.LinearFilter
    texture.minFilter = THREE.LinearMipmapNearestFilter
    texture.anisotropy = 1
    texture.userData.stageNativeMatcap = {
        encoding: manifest.encoding, mipOrigin: 'decoded-original-native-levels',
        mipCount: manifest.mipCount, source: { ...manifest.source },
    }
    texture.needsUpdate = true
    return texture
}

export async function loadNativeMatcapMips(url: string, binding: StageTextureBinding, signal?: AbortSignal) {
    const response = await fetch(await resolveRuntimeAssetUrl(url, signal), { cache: 'no-cache', signal })
    if (!response.ok) throw new Error(`Native MatCap manifest HTTP ${response.status}`)
    const manifest = validateNativeMatcapMips(await response.json(), binding)
    // Packed delivery may use blob URLs: resolve against the logical manifest.
    const dataUrl = new URL(manifest.dataUrl, resolvePageAssetUrl(url)).href
    const responseBytes = await fetch(await resolveRuntimeAssetUrl(dataUrl, signal), { cache: 'no-cache', signal })
    if (!responseBytes.ok) throw new Error(`Native MatCap mip bytes HTTP ${responseBytes.status}`)
    const bytes = await responseBytes.arrayBuffer()
    signal?.throwIfAborted()
    return createNativeMatcapTexture(manifest, bytes, binding)
}
