import * as THREE from 'three';
import type { OfficialTextureSamplerProfile } from './materialProfile';
import {
    getOfficialFaceTexturePayload,
    type OfficialFaceTexturePayload,
} from './officialFaceTexturePayload';
import {
    getOfficialHairTexturePayload,
    type OfficialHairTexturePayload,
} from './officialHairTexturePayload';

type OfficialTextureLoadStage =
    | 'texture-download'
    | 'texture-decode'
    | 'texture-material';

type OfficialTextureLoadError = Error & {
    stage: OfficialTextureLoadStage;
    url: string;
    cause: unknown;
};

function officialTextureLoadError(
    stage: OfficialTextureLoadStage,
    url: string,
    error: unknown,
): OfficialTextureLoadError {
    if (
        error instanceof Error
        && typeof (error as Partial<OfficialTextureLoadError>).stage === 'string'
        && typeof (error as Partial<OfficialTextureLoadError>).url === 'string'
    ) return error as OfficialTextureLoadError;
    const aborted = error instanceof Error && error.name === 'AbortError';
    const result = new Error(
        `[${stage}] ${url}: ${aborted ? 'aborted' : error instanceof Error ? error.message : String(error)}`,
    ) as OfficialTextureLoadError;
    result.name = aborted ? 'AbortError' : 'CharacterAssetLoadError';
    result.stage = stage;
    result.url = url;
    result.cause = error;
    return result;
}

function throwIfOfficialTextureLoadAborted(
    signal: AbortSignal | undefined,
    stage: OfficialTextureLoadStage,
    url: string,
): void {
    if (!signal?.aborted) return;
    throw officialTextureLoadError(
        stage,
        url,
        signal.reason instanceof Error
            ? signal.reason
            : new DOMException('The official texture load was aborted', 'AbortError'),
    );
}

const DDS_MAGIC = 0x20534444;
const DDS_HEADER_BYTES = 128;
const DDS_DX10_HEADER_BYTES = 20;
const FOURCC_DXT1 = 0x31545844;
const FOURCC_DXT5 = 0x35545844;
const FOURCC_DX10 = 0x30315844;
const DXGI_FORMAT_BC6H_UF16 = 95;
const DXGI_FORMAT_BC7_UNORM = 98;
const DXGI_FORMAT_BC7_UNORM_SRGB = 99;

type OfficialCompressedTexturePayload =
    | OfficialHairTexturePayload
    | OfficialFaceTexturePayload;

export interface OfficialCompressedTextureState {
    authority: 'fresh-current-Steam-JP-serialized-Texture2D';
    name: string;
    sourceRegion: 'Steam-JP';
    unityVersion: '2022.3.62f2';
    width: number;
    height: number;
    textureFormat: 10 | 12 | 24 | 25;
    mipCount: number;
    colorSpace: 0 | 1;
    rawBytes: number;
    containerBytes: number;
    requiredExtension: OfficialCompressedTexturePayload['requiredExtension'];
    flipY: false;
}

function blockBytes(textureFormat: OfficialCompressedTexturePayload['textureFormat']) {
    if (textureFormat === 10) return 8;
    if (textureFormat === 12 || textureFormat === 24 || textureFormat === 25) return 16;
    throw new Error(`Unsupported official TextureFormat ${textureFormat}`);
}

function compressedMipBytes(
    width: number,
    height: number,
    textureFormat: OfficialCompressedTexturePayload['textureFormat'],
) {
    return Math.max(1, Math.ceil(width / 4))
        * Math.max(1, Math.ceil(height / 4))
        * blockBytes(textureFormat);
}

function assertProfileMatchesPayload(
    profile: OfficialTextureSamplerProfile | undefined,
    payload: OfficialCompressedTexturePayload,
) {
    if (!profile) return;
    const actual = [
        profile.name.toLowerCase(),
        profile.width,
        profile.height,
        profile.textureFormat,
        profile.mipCount,
        profile.colorSpace,
    ];
    const expected = [
        payload.name.toLowerCase(),
        payload.width,
        payload.height,
        payload.textureFormat,
        payload.mipCount,
        payload.colorSpace,
    ];
    if (actual.some((value, index) => value !== expected[index])) {
        throw new Error(
            `Official texture profile/container mismatch for ${payload.name}`,
        );
    }
}

function compressedFormat(
    view: DataView,
    payload: OfficialCompressedTexturePayload,
): {
    format: THREE.CompressedPixelFormat;
    dataOffset: number;
} {
    const fourCC = view.getUint32(84, true);
    if (payload.textureFormat === 10 && fourCC === FOURCC_DXT1) {
        return {
            format: THREE.RGB_S3TC_DXT1_Format,
            dataOffset: DDS_HEADER_BYTES,
        };
    }
    if (payload.textureFormat === 12 && fourCC === FOURCC_DXT5) {
        return {
            format: THREE.RGBA_S3TC_DXT5_Format,
            dataOffset: DDS_HEADER_BYTES,
        };
    }
    if (payload.textureFormat === 24 && fourCC === FOURCC_DX10) {
        const dxgiFormat = view.getUint32(DDS_HEADER_BYTES, true);
        if (dxgiFormat !== DXGI_FORMAT_BC6H_UF16) {
            throw new Error(
                `Official BC6H header mismatch for ${payload.name}`,
            );
        }
        return {
            format: THREE.RGB_BPTC_UNSIGNED_Format,
            dataOffset: DDS_HEADER_BYTES + DDS_DX10_HEADER_BYTES,
        };
    }
    if (payload.textureFormat === 25 && fourCC === FOURCC_DX10) {
        const dxgiFormat = view.getUint32(DDS_HEADER_BYTES, true);
        const expectedDxgi = payload.colorSpace === 1
            ? DXGI_FORMAT_BC7_UNORM_SRGB
            : DXGI_FORMAT_BC7_UNORM;
        if (dxgiFormat !== expectedDxgi) {
            throw new Error(
                `Official BC7 color-space header mismatch for ${payload.name}`,
            );
        }
        return {
            format: THREE.RGBA_BPTC_Format,
            dataOffset: DDS_HEADER_BYTES + DDS_DX10_HEADER_BYTES,
        };
    }
    throw new Error(
        `Official DDS format mismatch for ${payload.name}: ${fourCC}`,
    );
}

/** Parse a lossless DDS wrapper around the serialized Unity mip payload. */
export function parseOfficialCompressedTexture(
    buffer: ArrayBuffer,
    payload: OfficialCompressedTexturePayload,
    profile?: OfficialTextureSamplerProfile,
): THREE.CompressedTexture {
    assertProfileMatchesPayload(profile, payload);
    if (buffer.byteLength !== payload.containerBytes) {
        throw new Error(
            `Official DDS byte count mismatch for ${payload.name}: `
            + `${buffer.byteLength} != ${payload.containerBytes}`,
        );
    }
    const view = new DataView(buffer);
    if (
        view.getUint32(0, true) !== DDS_MAGIC
        || view.getUint32(4, true) !== 124
    ) {
        throw new Error(`Invalid official DDS header for ${payload.name}`);
    }
    const height = view.getUint32(12, true);
    const width = view.getUint32(16, true);
    const mipCount = view.getUint32(28, true);
    if (
        width !== payload.width
        || height !== payload.height
        || mipCount !== payload.mipCount
    ) {
        throw new Error(`Official DDS dimensions mismatch for ${payload.name}`);
    }

    const { format, dataOffset } = compressedFormat(view, payload);
    const mipmaps: Array<{
        data: Uint8Array;
        width: number;
        height: number;
    }> = [];
    let offset = dataOffset;
    let mipWidth = width;
    let mipHeight = height;
    for (let level = 0; level < mipCount; level++) {
        const bytes = compressedMipBytes(
            mipWidth,
            mipHeight,
            payload.textureFormat,
        );
        if (offset + bytes > buffer.byteLength) {
            throw new Error(
                `Official DDS mip ${level} is truncated for ${payload.name}`,
            );
        }
        mipmaps.push({
            data: new Uint8Array(buffer, offset, bytes),
            width: mipWidth,
            height: mipHeight,
        });
        offset += bytes;
        mipWidth = Math.max(1, mipWidth >> 1);
        mipHeight = Math.max(1, mipHeight >> 1);
    }
    if (
        offset !== buffer.byteLength
        || buffer.byteLength - dataOffset !== payload.rawBytes
    ) {
        throw new Error(`Official DDS mip span mismatch for ${payload.name}`);
    }

    const texture = new THREE.CompressedTexture(
        mipmaps,
        width,
        height,
        format,
        THREE.UnsignedByteType,
    );
    const state: OfficialCompressedTextureState = {
        authority: 'fresh-current-Steam-JP-serialized-Texture2D',
        name: payload.name,
        sourceRegion: payload.sourceRegion,
        unityVersion: payload.unityVersion,
        width,
        height,
        textureFormat: payload.textureFormat,
        mipCount,
        colorSpace: payload.colorSpace,
        rawBytes: payload.rawBytes,
        containerBytes: payload.containerBytes,
        requiredExtension: payload.requiredExtension,
        flipY: false,
    };
    texture.name = payload.name;
    texture.colorSpace = payload.colorSpace === 1
        ? THREE.SRGBColorSpace
        : THREE.NoColorSpace;
    texture.flipY = false;
    texture.generateMipmaps = false;
    texture.unpackAlignment = 1;
    texture.userData.officialCompressedPayload = state;
    texture.needsUpdate = true;
    return texture;
}

export function getOfficialCompressedTextureState(
    texture: THREE.Texture,
): OfficialCompressedTextureState | undefined {
    return texture.userData.officialCompressedPayload as
        | OfficialCompressedTextureState
        | undefined;
}

/** Return undefined only when no exact payload is registered for this name. */
export async function loadOfficialCompressedTexture(
    textureNameOrUrl: string,
    profile?: OfficialTextureSamplerProfile,
    options: {
        signal?: AbortSignal;
        stage?: OfficialTextureLoadStage;
    } = {},
): Promise<THREE.CompressedTexture | undefined> {
    const payload = getOfficialHairTexturePayload(textureNameOrUrl)
        ?? getOfficialFaceTexturePayload(textureNameOrUrl);
    if (!payload) return undefined;
    const stage = options.stage ?? 'texture-download';
    throwIfOfficialTextureLoadAborted(options.signal, stage, payload.url);
    try {
        const response = await fetch(payload.url, { signal: options.signal });
        if (!response.ok) {
            throw new Error(
                `Official DDS request failed for ${payload.name}: `
                + `${response.status} ${response.statusText}`,
            );
        }
        const buffer = await response.arrayBuffer();
        throwIfOfficialTextureLoadAborted(options.signal, stage, payload.url);
        return parseOfficialCompressedTexture(
            buffer,
            payload,
            profile,
        );
    } catch (error) {
        throw officialTextureLoadError(stage, payload.url, error);
    }
}
