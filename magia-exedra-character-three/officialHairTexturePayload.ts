import payloadUrl0 from './official-textures/hair/RDToon_AngelRingMap.dds?url';
import payloadUrl1 from './official-textures/hair/chara_100101_hair_color.dds?url';
import payloadUrl2 from './official-textures/hair/chara_100101_hair_ctrl.dds?url';
import payloadUrl3 from './official-textures/hair/chara_100101_hair_shadow.dds?url';
import payloadUrl4 from './official-textures/hair/chara_100102_hair_color.dds?url';
import payloadUrl5 from './official-textures/hair/chara_100102_hair_ctrl.dds?url';
import payloadUrl6 from './official-textures/hair/chara_100102_hair_shadow.dds?url';
import payloadUrl7 from './official-textures/hair/chara_100805_hair_color.dds?url';
import payloadUrl8 from './official-textures/hair/chara_100805_hair_ctrl.dds?url';
import payloadUrl9 from './official-textures/hair/chara_100805_hair_shadow.dds?url';
import payloadUrl10 from './official-textures/hair/chara_101901_hair_color.dds?url';
import payloadUrl11 from './official-textures/hair/chara_101901_hair_ctrl.dds?url';
import payloadUrl12 from './official-textures/hair/chara_101901_hair_shadow.dds?url';
import payloadUrl13 from './official-textures/hair/chara_108301_hair_color.dds?url';
import payloadUrl14 from './official-textures/hair/chara_108301_hair_ctrl.dds?url';
import payloadUrl15 from './official-textures/hair/chara_108301_hair_highlight.dds?url';
import payloadUrl16 from './official-textures/hair/chara_108301_hair_shadow.dds?url';

export interface OfficialHairTexturePayload {
    name: string;
    url: string;
    sourceRegion: 'Steam-JP';
    unityVersion: '2022.3.62f2';
    width: number;
    height: number;
    textureFormat: 10 | 12 | 25;
    mipCount: number;
    colorSpace: 0 | 1;
    rawBytes: number;
    containerBytes: number;
    requiredExtension:
        | 'WEBGL_compressed_texture_s3tc'
        | 'EXT_texture_compression_bptc';
}

const officialHairTexturePayloads = new Map<string, OfficialHairTexturePayload>([
    ['rdtoon_angelringmap', {
        name: 'RDToon_AngelRingMap',
        url: payloadUrl0,
        sourceRegion: 'Steam-JP',
        unityVersion: '2022.3.62f2',
        width: 512,
        height: 512,
        textureFormat: 25,
        mipCount: 1,
        colorSpace: 0,
        rawBytes: 262144,
        containerBytes: 262292,
        requiredExtension: 'EXT_texture_compression_bptc',
    }],
    ['chara_100101_hair_color', {
        name: 'chara_100101_hair_color',
        url: payloadUrl1,
        sourceRegion: 'Steam-JP',
        unityVersion: '2022.3.62f2',
        width: 1024,
        height: 1024,
        textureFormat: 10,
        mipCount: 11,
        colorSpace: 1,
        rawBytes: 699064,
        containerBytes: 699192,
        requiredExtension: 'WEBGL_compressed_texture_s3tc',
    }],
    ['chara_100101_hair_ctrl', {
        name: 'chara_100101_hair_ctrl',
        url: payloadUrl2,
        sourceRegion: 'Steam-JP',
        unityVersion: '2022.3.62f2',
        width: 1024,
        height: 1024,
        textureFormat: 25,
        mipCount: 11,
        colorSpace: 0,
        rawBytes: 1398128,
        containerBytes: 1398276,
        requiredExtension: 'EXT_texture_compression_bptc',
    }],
    ['chara_100101_hair_shadow', {
        name: 'chara_100101_hair_shadow',
        url: payloadUrl3,
        sourceRegion: 'Steam-JP',
        unityVersion: '2022.3.62f2',
        width: 1024,
        height: 1024,
        textureFormat: 10,
        mipCount: 11,
        colorSpace: 1,
        rawBytes: 699064,
        containerBytes: 699192,
        requiredExtension: 'WEBGL_compressed_texture_s3tc',
    }],
    ['chara_100102_hair_color', {
        name: 'chara_100102_hair_color',
        url: payloadUrl4,
        sourceRegion: 'Steam-JP',
        unityVersion: '2022.3.62f2',
        width: 1024,
        height: 1024,
        textureFormat: 10,
        mipCount: 11,
        colorSpace: 1,
        rawBytes: 699064,
        containerBytes: 699192,
        requiredExtension: 'WEBGL_compressed_texture_s3tc',
    }],
    ['chara_100102_hair_ctrl', {
        name: 'chara_100102_hair_ctrl',
        url: payloadUrl5,
        sourceRegion: 'Steam-JP',
        unityVersion: '2022.3.62f2',
        width: 1024,
        height: 1024,
        textureFormat: 25,
        mipCount: 11,
        colorSpace: 0,
        rawBytes: 1398128,
        containerBytes: 1398276,
        requiredExtension: 'EXT_texture_compression_bptc',
    }],
    ['chara_100102_hair_shadow', {
        name: 'chara_100102_hair_shadow',
        url: payloadUrl6,
        sourceRegion: 'Steam-JP',
        unityVersion: '2022.3.62f2',
        width: 1024,
        height: 1024,
        textureFormat: 10,
        mipCount: 11,
        colorSpace: 1,
        rawBytes: 699064,
        containerBytes: 699192,
        requiredExtension: 'WEBGL_compressed_texture_s3tc',
    }],
    ['chara_100805_hair_color', {
        name: 'chara_100805_hair_color',
        url: payloadUrl7,
        sourceRegion: 'Steam-JP',
        unityVersion: '2022.3.62f2',
        width: 1024,
        height: 1024,
        textureFormat: 10,
        mipCount: 11,
        colorSpace: 1,
        rawBytes: 699064,
        containerBytes: 699192,
        requiredExtension: 'WEBGL_compressed_texture_s3tc',
    }],
    ['chara_100805_hair_ctrl', {
        name: 'chara_100805_hair_ctrl',
        url: payloadUrl8,
        sourceRegion: 'Steam-JP',
        unityVersion: '2022.3.62f2',
        width: 1024,
        height: 1024,
        textureFormat: 25,
        mipCount: 11,
        colorSpace: 0,
        rawBytes: 1398128,
        containerBytes: 1398276,
        requiredExtension: 'EXT_texture_compression_bptc',
    }],
    ['chara_100805_hair_shadow', {
        name: 'chara_100805_hair_shadow',
        url: payloadUrl9,
        sourceRegion: 'Steam-JP',
        unityVersion: '2022.3.62f2',
        width: 1024,
        height: 1024,
        textureFormat: 12,
        mipCount: 11,
        colorSpace: 1,
        rawBytes: 1398128,
        containerBytes: 1398256,
        requiredExtension: 'WEBGL_compressed_texture_s3tc',
    }],
    ['chara_101901_hair_color', {
        name: 'chara_101901_hair_color',
        url: payloadUrl10,
        sourceRegion: 'Steam-JP',
        unityVersion: '2022.3.62f2',
        width: 1024,
        height: 1024,
        textureFormat: 10,
        mipCount: 11,
        colorSpace: 1,
        rawBytes: 699064,
        containerBytes: 699192,
        requiredExtension: 'WEBGL_compressed_texture_s3tc',
    }],
    ['chara_101901_hair_ctrl', {
        name: 'chara_101901_hair_ctrl',
        url: payloadUrl11,
        sourceRegion: 'Steam-JP',
        unityVersion: '2022.3.62f2',
        width: 1024,
        height: 1024,
        textureFormat: 25,
        mipCount: 11,
        colorSpace: 0,
        rawBytes: 1398128,
        containerBytes: 1398276,
        requiredExtension: 'EXT_texture_compression_bptc',
    }],
    ['chara_101901_hair_shadow', {
        name: 'chara_101901_hair_shadow',
        url: payloadUrl12,
        sourceRegion: 'Steam-JP',
        unityVersion: '2022.3.62f2',
        width: 1024,
        height: 1024,
        textureFormat: 10,
        mipCount: 11,
        colorSpace: 1,
        rawBytes: 699064,
        containerBytes: 699192,
        requiredExtension: 'WEBGL_compressed_texture_s3tc',
    }],
    ['chara_108301_hair_color', {
        name: 'chara_108301_hair_color',
        url: payloadUrl13,
        sourceRegion: 'Steam-JP',
        unityVersion: '2022.3.62f2',
        width: 1024,
        height: 1024,
        textureFormat: 10,
        mipCount: 11,
        colorSpace: 1,
        rawBytes: 699064,
        containerBytes: 699192,
        requiredExtension: 'WEBGL_compressed_texture_s3tc',
    }],
    ['chara_108301_hair_ctrl', {
        name: 'chara_108301_hair_ctrl',
        url: payloadUrl14,
        sourceRegion: 'Steam-JP',
        unityVersion: '2022.3.62f2',
        width: 1024,
        height: 1024,
        textureFormat: 25,
        mipCount: 11,
        colorSpace: 0,
        rawBytes: 1398128,
        containerBytes: 1398276,
        requiredExtension: 'EXT_texture_compression_bptc',
    }],
    ['chara_108301_hair_highlight', {
        name: 'chara_108301_hair_highlight',
        url: payloadUrl15,
        sourceRegion: 'Steam-JP',
        unityVersion: '2022.3.62f2',
        width: 1024,
        height: 1024,
        textureFormat: 10,
        mipCount: 11,
        colorSpace: 1,
        rawBytes: 699064,
        containerBytes: 699192,
        requiredExtension: 'WEBGL_compressed_texture_s3tc',
    }],
    ['chara_108301_hair_shadow', {
        name: 'chara_108301_hair_shadow',
        url: payloadUrl16,
        sourceRegion: 'Steam-JP',
        unityVersion: '2022.3.62f2',
        width: 1024,
        height: 1024,
        textureFormat: 10,
        mipCount: 11,
        colorSpace: 1,
        rawBytes: 699064,
        containerBytes: 699192,
        requiredExtension: 'WEBGL_compressed_texture_s3tc',
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

/** Resolve by serialized Texture2D name, including Vite's emitted 8-char hash. */
export function getOfficialHairTexturePayload(
    textureNameOrUrl: string,
): OfficialHairTexturePayload | undefined {
    const normalized = normalizePayloadName(textureNameOrUrl);
    const direct = officialHairTexturePayloads.get(normalized);
    if (direct) return direct;
    const emittedAssetName = normalized.match(
        /^(.*)-[A-Za-z0-9_-]{8}$/,
    )?.[1];
    return emittedAssetName
        ? officialHairTexturePayloads.get(emittedAssetName)
        : undefined;
}

export function listOfficialHairTexturePayloads(): readonly OfficialHairTexturePayload[] {
    return [...officialHairTexturePayloads.values()];
}
