import faceCtrlBaseUrl from './official-textures/face/face_ctrl_base.dds?url';
import faceCtrlNoseUrl from './official-textures/face/face_ctrl_nose.dds?url';
import chara100202FaceCtrlUrl from './official-textures/face/chara_100202_face_ctrl.dds?url';

export interface OfficialFaceTexturePayload {
    name: 'face_ctrl_base' | 'face_ctrl_nose' | 'chara_100202_face_ctrl';
    url: string;
    sourceRegion: 'Steam-JP';
    unityVersion: '2022.3.62f2';
    width: 1024 | 256;
    height: 1024 | 256;
    textureFormat: 24;
    mipCount: 1;
    colorSpace: 0;
    rawBytes: 1048576 | 65536;
    containerBytes: 1048724 | 65684;
    requiredExtension: 'EXT_texture_compression_bptc';
}

const officialFaceTexturePayloads = new Map<string, OfficialFaceTexturePayload>([
    ['face_ctrl_base', {
        name: 'face_ctrl_base',
        url: faceCtrlBaseUrl,
        sourceRegion: 'Steam-JP',
        unityVersion: '2022.3.62f2',
        width: 1024,
        height: 1024,
        textureFormat: 24,
        mipCount: 1,
        colorSpace: 0,
        rawBytes: 1048576,
        containerBytes: 1048724,
        requiredExtension: 'EXT_texture_compression_bptc',
    }],
    ['face_ctrl_nose', {
        name: 'face_ctrl_nose',
        url: faceCtrlNoseUrl,
        sourceRegion: 'Steam-JP',
        unityVersion: '2022.3.62f2',
        width: 256,
        height: 256,
        textureFormat: 24,
        mipCount: 1,
        colorSpace: 0,
        rawBytes: 65536,
        containerBytes: 65684,
        requiredExtension: 'EXT_texture_compression_bptc',
    }],
    ['chara_100202_face_ctrl', {
        name: 'chara_100202_face_ctrl',
        url: chara100202FaceCtrlUrl,
        sourceRegion: 'Steam-JP',
        unityVersion: '2022.3.62f2',
        width: 1024,
        height: 1024,
        textureFormat: 24,
        mipCount: 1,
        colorSpace: 0,
        rawBytes: 1048576,
        containerBytes: 1048724,
        requiredExtension: 'EXT_texture_compression_bptc',
    }],
]);

function normalizePayloadName(value: string): string {
    return (value
        .replace(/\\/g, '/')
        .split('/')
        .pop() ?? '')
        .split(/[?#]/, 1)[0]
        .replace(/\.(dds|png|jpe?g|webp)$/i, '')
        .trim()
        .toLowerCase();
}

/** Resolve the shared ReDriveToon face controls by serialized Texture2D name. */
export function getOfficialFaceTexturePayload(
    textureNameOrUrl: string,
): OfficialFaceTexturePayload | undefined {
    const normalized = normalizePayloadName(textureNameOrUrl);
    const direct = officialFaceTexturePayloads.get(normalized);
    if (direct) return direct;
    const emittedAssetName = normalized.match(
        /^(.*)-[A-Za-z0-9_-]{8}$/,
    )?.[1];
    return emittedAssetName
        ? officialFaceTexturePayloads.get(emittedAssetName)
        : undefined;
}

export function listOfficialFaceTexturePayloads(): readonly OfficialFaceTexturePayload[] {
    return [...officialFaceTexturePayloads.values()];
}
