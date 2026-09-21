import { getLoadingTask, readLoadingResponse, yieldLoadingFrame } from './loadingProgress.ts'
import * as THREE from 'three';
import {
    getOfficialTextureSamplerProfile,
    type OfficialTextureSamplerProfile,
} from './materialProfile';
import {
    getOfficialCompressedTextureState,
    loadOfficialCompressedTexture,
} from './officialTextureContainer';
import faceCtrlBaseFallbackUrl from './shaders/face_ctrl_base.png?url';
import faceCtrlNoseFallbackUrl from './shaders/face_ctrl_nose.png?url';
import chara100202FaceCtrlFallbackUrl from './models/chara_100202_battle_unit/chara_100202_face_ctrl.png?url';
import { renderer } from './renderer'

type CharacterTextureLoadStage =
    | 'texture-download'
    | 'texture-decode'
    | 'texture-material'

type CharacterTextureLoadError = Error & {
    stage: CharacterTextureLoadStage
    url: string
    cause: unknown
}

function textureLoadError(
    stage: CharacterTextureLoadStage,
    url: string,
    error: unknown,
): CharacterTextureLoadError {
    if (
        error instanceof Error
        && typeof (error as Partial<CharacterTextureLoadError>).stage === 'string'
        && typeof (error as Partial<CharacterTextureLoadError>).url === 'string'
    ) return error as CharacterTextureLoadError
    const aborted = error instanceof Error && error.name === 'AbortError'
    const result = new Error(
        `[${stage}] ${url}: ${aborted ? 'aborted' : error instanceof Error ? error.message : String(error)}`,
    ) as CharacterTextureLoadError
    result.name = aborted ? 'AbortError' : 'CharacterAssetLoadError'
    result.stage = stage
    result.url = url
    result.cause = error
    return result
}

function throwIfTextureLoadAborted(
    signal: AbortSignal | undefined,
    stage: CharacterTextureLoadStage,
    url: string,
): void {
    if (!signal?.aborted) return
    throw textureLoadError(
        stage,
        url,
        signal.reason instanceof Error
            ? signal.reason
            : new DOMException('The texture load was aborted', 'AbortError'),
    )
}

const CHARACTER_TEXTURE_CONTEXT = Symbol('magius-character-texture-context')
const activeCharacterTextureContexts = new Set<CharacterTextureLoadContext>()

export interface CharacterTextureLoadContext {
    signal?: AbortSignal
    stage?: CharacterTextureLoadStage
    sourcePath?: string
    registerTexture?: (texture: THREE.Texture) => void
}

type BoundTextureUrl = String & {
    [CHARACTER_TEXTURE_CONTEXT]?: CharacterTextureLoadContext
}

const OFFICIAL_FACE_GRADIENT_FALLBACK_URLS = new Map<string, string>([
    ['face_ctrl_base', faceCtrlBaseFallbackUrl],
    ['face_ctrl_nose', faceCtrlNoseFallbackUrl],
    ['chara_100202_face_ctrl', chara100202FaceCtrlFallbackUrl],
])

function normalizeTextureName(value: string): string {
    return value
        .replace(/\\/g, '/')
        .split('/')
        .pop()!
        .split(/[?#]/, 1)[0]
        .replace(/\.(dds|png|jpe?g|webp)$/i, '')
        .replace(/-[A-Za-z0-9_-]{8}$/, '')
        .toLowerCase()
}

/**
 * Keep Vite's emitted URL byte-for-byte when it is fetched while carrying the
 * owning character transaction through shader helpers that still accept a
 * plain string.  String() at the network boundary restores the primitive URL.
 */
export function bindCharacterTextureLoadContext(
    url: string,
    context: CharacterTextureLoadContext,
): string {
    const bound = new String(url) as BoundTextureUrl
    bound[CHARACTER_TEXTURE_CONTEXT] = context
    return bound as unknown as string
}

export function registerCharacterTextureLoadContext(
    context: CharacterTextureLoadContext,
): () => void {
    activeCharacterTextureContexts.add(context)
    return () => activeCharacterTextureContexts.delete(context)
}

function textureLoadContext(url: string): CharacterTextureLoadContext {
    if (typeof url === 'object' && url !== null) {
        return (url as unknown as BoundTextureUrl)[CHARACTER_TEXTURE_CONTEXT] ?? {}
    }
    if (activeCharacterTextureContexts.size === 1) {
        return activeCharacterTextureContexts.values().next().value ?? {}
    }
    return {}
}

async function decodeFetchedTexture(
    url: string,
    signal?: AbortSignal,
): Promise<THREE.Texture> {
    let response: Response
    try {
        response = await fetch(url, { signal })
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`.trim())
        }
    } catch (error) {
        throw textureLoadError('texture-download', url, error)
    }

    let blob: Blob
    try {
        blob = new Blob([await readLoadingResponse(response, { url, signal })], {
            type: response.headers.get('content-type') ?? '',
        })
        getLoadingTask(signal)?.phase('decoding', url)
        await yieldLoadingFrame(signal)
        throwIfTextureLoadAborted(signal, 'texture-download', url)
    } catch (error) {
        throw textureLoadError('texture-download', url, error)
    }

    if (
        typeof Image === 'undefined'
        || typeof URL === 'undefined'
        || typeof URL.createObjectURL !== 'function'
    ) {
        throw textureLoadError(
            'texture-decode',
            url,
            new Error('Browser image decoder is unavailable'),
        )
    }

    const objectUrl = URL.createObjectURL(blob)
    const image = new Image()
    image.decoding = 'async'
    try {
        await new Promise<void>((resolve, reject) => {
            const abort = () => {
                cleanup()
                image.src = ''
                reject(
                    signal?.reason instanceof Error
                        ? signal.reason
                        : new DOMException('The texture decode was aborted', 'AbortError'),
                )
            }
            const cleanup = () => {
                image.onload = null
                image.onerror = null
                signal?.removeEventListener('abort', abort)
            }
            image.onload = () => {
                cleanup()
                resolve()
            }
            image.onerror = () => {
                cleanup()
                reject(new Error('Image decode failed'))
            }
            signal?.addEventListener('abort', abort, { once: true })
            if (signal?.aborted) {
                abort()
                return
            }
            image.src = objectUrl
        })
        throwIfTextureLoadAborted(signal, 'texture-decode', url)
        const texture = new THREE.Texture(image)
        texture.name = url
        texture.needsUpdate = true
        return texture
    } catch (error) {
        throw textureLoadError('texture-decode', url, error)
    } finally {
        URL.revokeObjectURL(objectUrl)
    }
}

export async function loadTexture(
    url: string,
    textureProps: Partial<THREE.Texture> = {},
) {
    const context = textureLoadContext(url)
    const sourceUrl = String(url)
    const stage = context.stage ?? 'texture-download'
    throwIfTextureLoadAborted(context.signal, stage, sourceUrl)
    const profile = getOfficialTextureSamplerProfile(sourceUrl)
    let tex: THREE.Texture | undefined
    try {
        tex = await loadOfficialCompressedTexture(sourceUrl, profile, {
            signal: context.signal,
            stage,
        }) ?? await decodeFetchedTexture(sourceUrl, context.signal)
        throwIfTextureLoadAborted(context.signal, stage, sourceUrl)
    } catch (error) {
        tex?.dispose()
        throw textureLoadError(stage, sourceUrl, error)
    }
    const exactPayload = getOfficialCompressedTextureState(tex)
    if (
        exactPayload
        && renderer
        && !renderer.extensions.has(exactPayload.requiredExtension)
    ) {
        const fallbackUrl = OFFICIAL_FACE_GRADIENT_FALLBACK_URLS.get(
            normalizeTextureName(sourceUrl),
        )
        if (fallbackUrl) {
            tex.dispose()
            try {
                const fallback = await decodeFetchedTexture(
                    fallbackUrl,
                    context.signal,
                )
                const normalizedName = normalizeTextureName(sourceUrl)
                fallback.name = normalizedName
                fallback.userData.officialFaceGradientFallback = {
                    authority: 'viewer-bc6h-compatibility-fallback',
                    name: normalizedName as OfficialFaceGradientSamplingState['name'],
                    textureFormat: 24,
                    dxgiFormat: 95,
                    colorSpace: THREE.NoColorSpace,
                    flipY: false,
                    generateMipmaps: false,
                    magFilter: THREE.LinearFilter,
                    minFilter: THREE.LinearFilter,
                    anisotropy: 1,
                    wrapS: THREE.RepeatWrapping,
                    wrapT: THREE.RepeatWrapping,
                    rawBytes: 0,
                    requiredExtension: 'EXT_texture_compression_bptc',
                }
                Object.assign(fallback, textureProps)
                fallback.userData.magiusStableAssetUrl = sourceUrl
                context.registerTexture?.(fallback)
                return fallback
            } catch (error) {
                throw textureLoadError('texture-material', sourceUrl, error)
            }
        }
        tex.dispose()
        throw textureLoadError(
            'texture-material',
            sourceUrl,
            new Error(
                `Official texture ${exactPayload.name} requires `
                + exactPayload.requiredExtension,
            ),
        )
    }
    Object.assign(tex, textureProps)
    tex.userData.magiusStableAssetUrl = sourceUrl
    context.registerTexture?.(tex)
    return tex;
}

/**
 * Match the serialized JP `RDToon_metallic_gradient_map` sampler.
 *
 * Unity 2022.3 stores this 256x2 Texture2D as TextureColorSpace.Linear with a
 * single mip level, FilterMode.Bilinear, Aniso=1 and Clamp U/V. Generating a
 * browser mip chain changes the RGB Overlay sampled by N.H and visibly shifts
 * the authored hard-reflection angle.
 */
export function ApplyOfficialSpecularGradientSampling(tex: THREE.Texture) {
    tex.colorSpace = THREE.NoColorSpace
    tex.generateMipmaps = false
    tex.magFilter = THREE.LinearFilter
    tex.minFilter = THREE.LinearFilter
    tex.anisotropy = 1
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    tex.needsUpdate = true
}

function normalizeOfficialTextureName(value: string): string {
    return value
        .replace(/\\/g, '/')
        .split('/')
        .pop()!
        .split(/[?#]/, 1)[0]
        .replace(/\.(png|jpe?g|webp)$/i, '')
        .toLowerCase()
}

function applyOfficialBilinearSampling(
    tex: THREE.Texture,
    colorSpace: THREE.ColorSpace,
    generateMipmaps: boolean,
    wrapS: THREE.Wrapping,
    wrapT: THREE.Wrapping,
) {
    tex.colorSpace = colorSpace
    tex.generateMipmaps = generateMipmaps
    tex.magFilter = THREE.LinearFilter
    // Unity FilterMode.Bilinear uses GL_LINEAR_MIPMAP_NEAREST (9985) when
    // serialized mips exist, not Three's trilinear 9987 quality override.
    tex.minFilter = generateMipmaps
        ? THREE.LinearMipmapNearestFilter
        : THREE.LinearFilter
    tex.anisotropy = 1
    tex.wrapS = wrapS
    tex.wrapT = wrapT
    tex.needsUpdate = true
}

export interface OfficialFaceAdditionalSamplingState {
    colorSpace: string
    flipY: boolean
    generateMipmaps: boolean
    magFilter: THREE.MagnificationTextureFilter
    minFilter: THREE.MinificationTextureFilter
    anisotropy: number
    wrapS: THREE.Wrapping
    wrapT: THREE.Wrapping
    pngFileRow: '1-v'
}

/**
 * Match the serialized `_FaceAdditionalMap` sampler used by ReDriveToon.
 *
 * The official 512x512 control textures are Linear, Bilinear with ten mips,
 * Aniso=1 and Repeat U/V. TextureLoader's vertical upload flip is deliberate:
 * Unity UV1 is bottom-origin while the exported PNG file is top-origin.
 */
export function ApplyOfficialFaceAdditionalSampling(
    tex: THREE.Texture,
): OfficialFaceAdditionalSamplingState {
    applyOfficialBilinearSampling(
        tex,
        THREE.NoColorSpace,
        true,
        THREE.RepeatWrapping,
        THREE.RepeatWrapping,
    )
    tex.flipY = true
    tex.needsUpdate = true
    return {
        colorSpace: tex.colorSpace,
        flipY: tex.flipY,
        generateMipmaps: tex.generateMipmaps,
        magFilter: tex.magFilter,
        minFilter: tex.minFilter,
        anisotropy: tex.anisotropy,
        wrapS: tex.wrapS,
        wrapT: tex.wrapT,
        pngFileRow: '1-v',
    }
}


export interface OfficialFaceGradientSamplingState {
    authority: 'fresh-current-Steam-JP-serialized-Texture2D' | 'viewer-bc6h-compatibility-fallback'
    name: 'face_ctrl_base' | 'face_ctrl_nose' | 'chara_100202_face_ctrl'
    textureFormat: 24
    dxgiFormat: 95
    colorSpace: string
    flipY: false
    generateMipmaps: false
    magFilter: THREE.MagnificationTextureFilter
    minFilter: THREE.MinificationTextureFilter
    anisotropy: 1
    wrapS: THREE.Wrapping
    wrapT: THREE.Wrapping
    rawBytes: number
    requiredExtension: 'EXT_texture_compression_bptc'
}

const OFFICIAL_FACE_GRADIENT_TEXTURES = new Set([
    'face_ctrl_base',
    'face_ctrl_nose',
    'chara_100202_face_ctrl',
])

/** Restore the exact Steam ReDriveToon FaceGradient BC6H sampler. */
export function ApplyOfficialFaceGradientSampling(
    tex: THREE.Texture,
    sourceName: string,
): OfficialFaceGradientSamplingState {
    const payload = getOfficialCompressedTextureState(tex)
    const fallback = tex.userData.officialFaceGradientFallback as
        | OfficialFaceGradientSamplingState
        | undefined
    if (fallback) {
        tex.colorSpace = THREE.NoColorSpace
        tex.flipY = false
        tex.generateMipmaps = false
        tex.magFilter = THREE.LinearFilter
        tex.minFilter = THREE.LinearFilter
        tex.anisotropy = 1
        tex.wrapS = THREE.RepeatWrapping
        tex.wrapT = THREE.RepeatWrapping
        tex.needsUpdate = true
        return fallback
    }
    if (
        !payload
        || !OFFICIAL_FACE_GRADIENT_TEXTURES.has(payload.name.toLowerCase())
        || payload.textureFormat !== 24
        || payload.mipCount !== 1
        || payload.colorSpace !== 0
        || payload.requiredExtension !== 'EXT_texture_compression_bptc'
    ) {
        throw new Error(
            `Official FaceGradient BC6H payload missing for ${sourceName}`,
        )
    }
    tex.colorSpace = THREE.NoColorSpace
    tex.flipY = false
    tex.generateMipmaps = false
    tex.magFilter = THREE.LinearFilter
    tex.minFilter = THREE.LinearFilter
    tex.anisotropy = 1
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.needsUpdate = true
    return {
        authority: payload.authority,
        name: payload.name as OfficialFaceGradientSamplingState['name'],
        textureFormat: 24,
        dxgiFormat: 95,
        colorSpace: tex.colorSpace,
        flipY: false,
        generateMipmaps: false,
        magFilter: tex.magFilter,
        minFilter: tex.minFilter,
        anisotropy: 1,
        wrapS: tex.wrapS,
        wrapT: tex.wrapT,
        rawBytes: payload.rawBytes,
        requiredExtension: 'EXT_texture_compression_bptc',
    }
}


/** Match shader/redrive_toon Texture2D `RDToon_AngelRingMap`. */
export function ApplyOfficialCommonAngelRingSampling(tex: THREE.Texture) {
    applyOfficialBilinearSampling(
        tex,
        THREE.NoColorSpace,
        false,
        THREE.ClampToEdgeWrapping,
        THREE.ClampToEdgeWrapping,
    )
}

/**
 * Apply the serialized sampler for any character-authored `_AngelRingMap`.
 * Unknown textures or textures observed only in another slot remain
 * fail-closed at the caller instead of inheriting a name-based approximation.
 */
export function ApplyOfficialCharacterAngelRingSampling(
    tex: THREE.Texture,
    sourceName: string | undefined,
): OfficialCharacterSurfaceSamplingState | undefined {
    if (!sourceName) return undefined
    const profile = getOfficialTextureSamplerProfile(sourceName)
    if (!profile?.slots.includes('_AngelRingMap')) return undefined
    return ApplyOfficialCharacterSurfaceSampling(tex, sourceName, profile)
}

const OFFICIAL_MATCAP_NAMES = new Set([
    'matcap_softmetallic',
    'matcap02_invert',
    'chara_100207_gem_matcap',
    'chara_100304_matcap_metallic',
    'chara_100403_matcap',
    'chara_100403_matcap_iron',
    'chara_100403_matcap_mercury',
    'chara_100903_body_pearl_matcap',
    'chara_100903_weapon_a_sp_matcap',
    'chara_102301_body_matcap',
    'chara_105901_weapon_a_matcap',
    'chara_106201_acc_matcap',
    'chara_106201_bodygem_matcap',
    'chara_114501_body_matcap',
    'chara_114501_body_matcap_jewel',
    'chara_114501_weapon_a_matcap',
    'chara_114601_body_matcap',
])
const OFFICIAL_LINEAR_MATCAP_NAMES = new Set([
    'matcap_softmetallic',
    'chara_100304_matcap_metallic',
    'chara_100903_body_pearl_matcap',
])
const OFFICIAL_SINGLE_MIP_MATCAP_NAMES = new Set([
    'matcap_softmetallic',
    'chara_100903_weapon_a_sp_matcap',
])

/**
 * Apply exact serialized MatCap color-space/mip/filter/wrap metadata by the
 * stable Texture2D name recovered from the material PPtr.
 */
export function ApplyOfficialMatCapSampling(
    tex: THREE.Texture,
    sourceName: string,
): boolean {
    const name = normalizeOfficialTextureName(sourceName)
    if (!OFFICIAL_MATCAP_NAMES.has(name)) return false
    applyOfficialBilinearSampling(
        tex,
        OFFICIAL_LINEAR_MATCAP_NAMES.has(name)
            ? THREE.NoColorSpace
            : THREE.SRGBColorSpace,
        !OFFICIAL_SINGLE_MIP_MATCAP_NAMES.has(name),
        THREE.RepeatWrapping,
        THREE.RepeatWrapping,
    )
    return true
}

export interface OfficialCharacterSurfaceSamplingState {
    authority: 'official-serialized' | 'viewer-fallback'
    sourceName: string
    profileName: string | null
    slots: readonly string[]
    colorSpace: string
    generateMipmaps: boolean
    magFilter: THREE.MagnificationTextureFilter
    minFilter: THREE.MinificationTextureFilter
    anisotropy: number
    wrapS: THREE.Wrapping
    wrapT: THREE.Wrapping
    serializedWidth: number | null
    serializedHeight: number | null
    serializedTextureFormat: number | null
    serializedMipCount: number | null
    serializedMipBias: number | null
    serializedWrapW: number | null
    mipSource: 'official-container' | 'browser-generated' | 'none'
    officialPayloadBytes: number | null
    requiredExtension: string | null
}

function officialTextureColorSpace(value: number): THREE.ColorSpace {
    if (value === 0) return THREE.NoColorSpace
    if (value === 1) return THREE.SRGBColorSpace
    throw new Error(`Unsupported official TextureColorSpace ${value}`)
}

function officialTextureWrapping(value: number): THREE.Wrapping {
    if (value === 0) return THREE.RepeatWrapping
    if (value === 1) return THREE.ClampToEdgeWrapping
    if (value === 2) return THREE.MirroredRepeatWrapping
    throw new Error(`Unsupported official TextureWrapMode ${value}`)
}

function officialTextureFilters(
    filterMode: number,
    hasMipmaps: boolean,
): {
    magFilter: THREE.MagnificationTextureFilter
    minFilter: THREE.MinificationTextureFilter
} {
    if (filterMode === 0) {
        return {
            magFilter: THREE.NearestFilter,
            minFilter: hasMipmaps
                ? THREE.NearestMipmapNearestFilter
                : THREE.NearestFilter,
        }
    }
    if (filterMode === 1) {
        return {
            magFilter: THREE.LinearFilter,
            // Unity Bilinear chooses one mip level and filters within it.
            minFilter: hasMipmaps
                ? THREE.LinearMipmapNearestFilter
                : THREE.LinearFilter,
        }
    }
    if (filterMode === 2) {
        return {
            magFilter: THREE.LinearFilter,
            minFilter: hasMipmaps
                ? THREE.LinearMipmapLinearFilter
                : THREE.LinearFilter,
        }
    }
    throw new Error(`Unsupported official FilterMode ${filterMode}`)
}

function characterSurfaceSamplingState(
    tex: THREE.Texture,
    sourceName: string,
    profile?: OfficialTextureSamplerProfile,
): OfficialCharacterSurfaceSamplingState {
    const exactPayload = getOfficialCompressedTextureState(tex)
    return {
        authority: profile ? 'official-serialized' : 'viewer-fallback',
        sourceName: normalizeOfficialTextureName(sourceName),
        profileName: profile?.name ?? null,
        slots: profile?.slots ?? [],
        colorSpace: tex.colorSpace,
        generateMipmaps: tex.generateMipmaps,
        magFilter: tex.magFilter,
        minFilter: tex.minFilter,
        anisotropy: tex.anisotropy,
        wrapS: tex.wrapS,
        wrapT: tex.wrapT,
        serializedWidth: profile?.width ?? null,
        serializedHeight: profile?.height ?? null,
        serializedTextureFormat: profile?.textureFormat ?? null,
        serializedMipCount: profile?.mipCount ?? null,
        serializedMipBias: profile?.mipBias ?? null,
        serializedWrapW: profile?.wrapW ?? null,
        mipSource: exactPayload
            ? 'official-container'
            : profile?.mipCount && profile.mipCount > 1
                ? 'browser-generated'
                : 'none',
        officialPayloadBytes: exactPayload?.rawBytes ?? null,
        requiredExtension: exactPayload?.requiredExtension ?? null,
    }
}

/**
 * Restore the exact serialized sampler for a character Texture2D.
 * Unknown Texture2D names retain the inherited quality path and are marked as
 * fallback so the runtime can expose the unresolved authority explicitly.
 */
export function ApplyOfficialCharacterSurfaceSampling(
    tex: THREE.Texture,
    sourceName: string,
    profile?: OfficialTextureSamplerProfile,
): OfficialCharacterSurfaceSamplingState {
    if (!profile) {
        MaximizeTextureQuality(tex)
        return characterSurfaceSamplingState(tex, sourceName)
    }
    if (profile.mipBias !== 0) {
        throw new Error(
            `Texture ${profile.name} requires unsupported mip bias ${profile.mipBias}`,
        )
    }
    const hasSerializedMipmaps = profile.mipCount > 1
    const exactPayload = getOfficialCompressedTextureState(tex)
    const filters = officialTextureFilters(
        profile.filterMode,
        hasSerializedMipmaps,
    )
    tex.colorSpace = officialTextureColorSpace(profile.colorSpace)
    // CompressedTexture already carries the exact serialized mip chain. Asking
    // WebGL to regenerate it would replace official authored/compressed levels.
    tex.generateMipmaps = hasSerializedMipmaps && !exactPayload
    tex.magFilter = filters.magFilter
    tex.minFilter = filters.minFilter
    tex.anisotropy = profile.aniso
    tex.wrapS = officialTextureWrapping(profile.wrapU)
    tex.wrapT = officialTextureWrapping(profile.wrapV)
    // Texture2D has no W sampler coordinate, but reject a future unsupported
    // serialized mode instead of silently presenting it as consumed.
    officialTextureWrapping(profile.wrapW)
    tex.needsUpdate = true
    return characterSurfaceSamplingState(tex, sourceName, profile)
}

export function MaximizeTextureQuality(...textures: Array<THREE.Texture | null | undefined>) {
    for (const tex of textures) {
        if (tex) {
            tex.magFilter = THREE.LinearFilter
            tex.minFilter = THREE.LinearMipMapLinearFilter
            tex.anisotropy = renderer?.capabilities.getMaxAnisotropy() || THREE.Texture.DEFAULT_ANISOTROPY
        }
    }
}
