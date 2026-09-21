import officialMaterialProfileUrl from './official-material-profiles.json?url';

export interface OfficialAnisotropyProfile {
    /** Serialized `_IsAniso`. */
    enabled: boolean;
    /** Serialized `_AnisoMaskByMetallic`. */
    maskByMetallic: boolean;
    /** Serialized `_AnisoColor` RGB. */
    color: readonly [number, number, number];
    /** Serialized `_AnisoThreshold`. */
    threshold: number;
    /** Serialized `_AnisoFeather`. */
    feather: number;
}

export interface OfficialFresnelProfile {
    /** Serialized `_UseFresnel`; Timeline may override this per renderer later. */
    enabled: boolean;
    /** Serialized `_FresnelMaskByMetallic`. */
    maskByMetallic: boolean;
    /** Serialized `_FresnelColor` RGB. */
    color: readonly [number, number, number];
    threshold: number;
    feather: number;
}

export interface OfficialOutlineProfile {
    /** Serialized `_UseOutline`; false slots emit no outline draw. */
    enabled: boolean;
    /** Serialized linear `_OutlineColor` RGB. */
    color: readonly [number, number, number];
    /** Serialized HDR `_OutlineEmissionColor` RGB. */
    emissionColor: readonly [number, number, number];
    /** Serialized `_OutlineTexBlend`. */
    texBlend: number;
    /** Serialized `_OutlineZOffset`. */
    zOffset: number;
    /** Serialized `_FaceOutlineAdjust`. */
    faceOutlineAdjust: number;
}

export type OfficialMatCapSource =
    | 'default-linear-grey'
    | 'character-or-fallback'
    | 'soft-metallic';

/** Backwards-compatible alias for the earlier Gem-only schema. */
export type OfficialGemMatCapSource = OfficialMatCapSource;

export interface OfficialMatCapProfile {
    /** Serialized `_UseMatCap`; independent of `_IsGem`. */
    enabled: boolean;
    /** Exact texture binding or the Shader's built-in linearGrey default. */
    source: OfficialMatCapSource;
    /** Exact serialized Texture2D name resolved from `_MatCapTex`. */
    texture?: string | null;
    /** Serialized `_MatCapIntensity`. */
    intensity: number;
    /** Serialized `_MaskMatcapMetallic`. */
    maskByMetallic: boolean;
    /** Serialized `_MaskMatcapSpecular`. */
    maskBySpecular: boolean;
}

export interface OfficialGemProfile {
    enabled: boolean;
    useMatCap: boolean;
    /** Exact serialized MatCap dependency when recovered; omitted means existing character/fallback path. */
    matCapSource?: OfficialGemMatCapSource;
    matCapIntensity: number;
    maskMatcapMetallic: boolean;
    maskMatcapSpecular: boolean;
    useDepthDiff: boolean;
    /** Serialized `_Transparency`; compiled GemDepthDiff also requires this to be non-zero. */
    transparency?: boolean;
    firstHighlightSize: number;
    firstShadowSize: number;
    secondHighlightSize: number;
    secondShadowSize: number;
    depthDiffThreshold: number;
    heightCorrection: number;
    rimFresnel: number;
    fresnelThreshold: number;
    fresnelFeather: number;
    fresnelMaskByMetallic: boolean;
}

export type OfficialAngelRingMap = 'none' | 'common' | 'character';

export interface OfficialAngelRingMaterialProfile {
    /** Serialized `_IsHair`; a name containing "hair" is not sufficient. */
    isHair: boolean;
    /** `_IsHair` plus a non-null serialized `_AngelRingMap`. */
    enabled: boolean;
    /** Serialized `_YuugenHighlight` / `IsHairUVAngelRing`. */
    uvMode: boolean;
    /** Which exported `_AngelRingMap` the material binds. */
    map: OfficialAngelRingMap;
    /** Stable serialized Texture2D identity; null when no map was resolved. */
    texture: string | null;
    /** Serialized `_RimLightColor`, also used by the AngelRing shader branch. */
    rimLightColor: readonly [number, number, number];
}

export interface OfficialDepthRimProfile {
    /** Serialized `_UseDepthTex`; gates depth-shadow and depth-rim sampling. */
    useDepthTex: boolean;
    /** Serialized `_UseRimLight`; independently gates the rim contribution. */
    useRimLight: boolean;
    /** Serialized `_DitherFade`; values over 0.5 neutralize depth masks. */
    ditherFade: number;
    /** Serialized `_DepthTexWidth`, multiplied by vertex-colour G. */
    width: number;
    /** Serialized `_DepthTexYOffset`. */
    yOffset: number;
    /** Serialized `_DepthRimLightDiffThreshold`. */
    rimDiffThreshold: number;
    /** Serialized `_DepthShadowDiffThreshold`. */
    shadowDiffThreshold: number;
}

export interface OfficialFaceMaterialProfile {
    /** Serialized `_IsFace`; identifies the ReDrive face-family pass. */
    isFace: boolean;
    /** Serialized `_IsEye`; selects the dedicated eye highlight geometry pass. */
    isEye: boolean;
    /** Serialized `_UseFaceGradientMap`; false for eye/eyebrow mask groups. */
    useGradientMap: boolean;
    /** Serialized `_ShouldApplyFaceAdditional`; exceptional main-face overlay. */
    shouldApplyAdditional: boolean;
    /** Exact serialized Texture2D identity from this slot's `_FaceAdditionalMap` PPtr. */
    additionalTexture: string | null;
    /** DepthOnly `_FaceAreaCameraDepthTextureZWriteOffset`, in eye-space units. */
    cameraDepthTextureZWriteOffset: number;
    /** Serialized `_HighlightThreshold`; official transition width is 0.05. */
    highlightThreshold: number;
    /** Serialized `_HighlightRotation`, in turns. */
    highlightRotation: number;
    /** Serialized `_CheekValue`. */
    cheekValue: number;
    /** Serialized `_CheekColor`, kept in shader units. */
    cheekColor: readonly [number, number, number];
}

export interface OfficialStencilProfile {
    /** Serialized ReDriveToon `_StencilMode`; mode 1 writes, mode 2 selects. */
    mode: number;
    /** Serialized Unity `CompareFunction` value from `_StencilComp`. */
    comparison: number;
    /** Serialized `_StencilNum`. The character face/hair contract uses bit 128. */
    reference: number;
    /** Serialized Unity `StencilOp` value from `_StencilPassOp`. */
    passOperation: number;
    /** Serialized `_StencilTransparency` used by RdToonStencilMaskPass. */
    transparency: number;
}

/**
 * Serialized parameters for a compiled character shader outside the ordinary
 * ReDriveToon family. The shader name and every scalar come from Material
 * serialization; consumers select this branch by shader identity rather than
 * by character or mesh name.
 */
export interface OfficialAkumaWeaponProfile {
    source: { CAB: string; materialPathID: string; shaderPathID: string };
    floats: Readonly<Record<string, number>>;
    colors: Readonly<Record<string, readonly number[]>>;
    textures: Readonly<Record<string, {
        name: string; fileId: number; pathId: string;
        sampler: OfficialTextureSamplerProfile;
    }>>;
}

export interface OfficialCustomCharacterShaderProfile {
    /** Exact serialized UniqueWeapon payload; never inferred from a mesh ID. */
    akumaWeapon?: OfficialAkumaWeaponProfile;
    name: string;
    baseColor: readonly [number, number, number, number];
    emissionColor: readonly [number, number, number, number];
    /** Exact Texture2D identities used by custom ReDrive-family variants. */
    baseTexture?: string | null;
    shadowTexture?: string | null;
    controlTexture?: string | null;
    noiseTexture: string | null;
    noiseTiling: number;
    noiseIntensity: number;
    noiseThreshold: number;
    ditherFade: number;
    useVertexColorG: boolean;
    vertexColorThreshold: number;
    /** Literal forward-pass alpha-test threshold from the compiled program. */
    forwardCutoff: number;
    /** Literal outline-pass inverse alpha-test threshold. */
    outlineCutoff: number;
    /** Serialized custom-variant switches; absent on NamaeShader. */
    isCosmic?: boolean;
    alphaClipping?: boolean;
    fillColor?: readonly [number, number, number, number];
    cosmicTexture?: string | null;
    cosmicNoiseTexture?: string | null;
    cosmicTiling?: number;
    cosmicScroll?: readonly [number, number];
    cosmicMaskByControlAlpha?: boolean;
    cosmicNoiseInfluence?: number;
    cosmicNoiseTiling?: number;
    cosmicNoiseSpeed?: number;
}

/**
 * Serialized `main_base` Cosmic branch.  Ordinary ReDriveToon materials can
 * enable this feature; it is not limited to the Doppel-Iroha shader identity.
 */
export interface OfficialNullCosmicBaseMap {
    materialName: string; materialCab: string; materialPathId: string;
    shaderName: string; shaderCab: string; shaderPathId: string;
    property: '_BaseMap'; fileId: 0; pathId: '0'; status: 'NULL';
    shaderDefault: 'white';
    shadow: { property: '_ShadowTex'; fileId: 0; pathId: '0'; status: 'NULL';
        shaderDefault: 'white'; colorProperty: '_ShadowColor';
        color: readonly [number, number, number, number] };
}

/** Only an explicit serialized NULL with the recovered shader default is
 * untextured. Missing/unresolved names and unsupported null variants still fail. */
export function hasOfficialNullCosmicBaseMap(profile: OfficialMaterialProfile): boolean {
    const cosmic = profile.cosmic, binding = cosmic.nullBaseMap;
    return cosmic.enabled && cosmic.baseTexture === null && cosmic.shadowTexture === null &&
        !cosmic.isScreenBaseMap && !cosmic.alphaClipping &&
        !profile.surface.transparency && Boolean(binding &&
            binding.materialName === profile.name &&
            /^CAB-[0-9a-f]{32}$/.test(binding.materialCab) &&
            /^-?[1-9][0-9]*$/.test(binding.materialPathId) &&
            binding.shaderName === 'Creative/Character/ReDriveToon' &&
            /^CAB-[0-9a-f]{32}$/.test(binding.shaderCab) &&
            /^-?[1-9][0-9]*$/.test(binding.shaderPathId) &&
            binding.property === '_BaseMap' && binding.fileId === 0 &&
            binding.pathId === '0' && binding.status === 'NULL' &&
            binding.shaderDefault === 'white' && binding.shadow &&
            binding.shadow.property === '_ShadowTex' && binding.shadow.fileId === 0 &&
            binding.shadow.pathId === '0' && binding.shadow.status === 'NULL' &&
            binding.shadow.shaderDefault === 'white' && binding.shadow.colorProperty === '_ShadowColor' &&
            binding.shadow.color.length === 4 && binding.shadow.color.every(Number.isFinite));
}

export interface OfficialCosmicProfile {
    /** Exact material/PPtr/shader-default provenance, not a missing-texture fallback. */
    nullBaseMap?: OfficialNullCosmicBaseMap;
    enabled: boolean;
    alphaClipping: boolean;
    baseColor: readonly [number, number, number, number];
    isScreenBaseMap: boolean;
    baseTexture: string | null;
    shadowTexture: string | null;
    controlTexture: string | null;
    baseMapTiling: number;
    baseMapScroll: readonly [number, number];
    texture: string | null;
    noiseTexture: string | null;
    tiling: number;
    scroll: readonly [number, number];
    maskByControlAlpha: boolean;
    noiseInfluence: number;
    noiseTiling: number;
    noiseSpeed: number;
    getShadowTexture: boolean;
    getShadowTint: boolean;
    applyAmbientLighting: boolean;
    overlay: boolean;
    shadowTintColor: readonly [number, number, number];
}

export interface OfficialMaterialProfile {
    name: string;
    source: 'official-export' | 'name-convention' | 'default';
    /** Serialized Unity `Material.m_CustomRenderQueue`; -1 uses shader default. */
    customRenderQueue: number;
    /** Exact forward-pass blend/depth state serialized on this material slot. */
    surface: {
        /** Serialized `_Transparency`; independent from mesh-level alpha maps. */
        transparency: boolean;
        /** Serialized `_ZWrite`. */
        zWrite: boolean;
        /** Serialized UnityEngine.Rendering.BlendMode `_SrcBlend`. */
        srcBlend: number;
        /** Serialized UnityEngine.Rendering.BlendMode `_DstBlend`. */
        dstBlend: number;
    };
    /** Serialized `_IsAlphaAdditive`; adds authored feature luminance to alpha. */
    isAlphaAdditive: boolean;
    /** Legacy aggregate flag retained for existing feature-variant selection. */
    anisotropy: boolean;
    anisotropyProfile: OfficialAnisotropyProfile;
    fresnel: OfficialFresnelProfile;
    outlineOffset: boolean;
    skinOutlineOffset: boolean;
    /** Serialized ReDriveToon `_OutlineWidth`. */
    outlineWidth: number;
    outline: OfficialOutlineProfile;
    face: OfficialFaceMaterialProfile;
    /** Exact per-material stencil routing; never infer it from queue or name. */
    stencil: OfficialStencilProfile;
    /** Base ReDriveToon MatCap branch; it is not owned by Gem. */
    matCap: OfficialMatCapProfile;
    gem: OfficialGemProfile;
    angelRing: OfficialAngelRingMaterialProfile;
    shadow: {
        offset: number;
        feather: number;
        /** Serialized `_ShadowOffsetMapOffset` added to ControlMap R. */
        offsetMapOffset: number;
        castSelfShadow: boolean;
        receiveSelfShadow: boolean;
    };
    depthRim: OfficialDepthRimProfile;
    /** Serialized `_AdditionalLightInfluenceByLuminance`. */
    additionalLightInfluenceByLuminance: number;
    /** Serialized HDR `_EmissionColor`, kept in linear shader units. */
    emissionColor: readonly [number, number, number];
    /** Standard ReDriveToon `main_base` Cosmic feature family. */
    cosmic: OfficialCosmicProfile;
    /** Present only when the serialized shader is not ordinary ReDriveToon. */
    customShader?: OfficialCustomCharacterShaderProfile;
}

export type OfficialSurfaceTextureSlot =
    | '_BaseMap'
    | '_ShadowTex'
    | '_ControlMap'
    | '_FaceAdditionalMap'
    | '_AngelRingMap'
    | '_CosmicTex'
    | '_CosmicNoiseTex';

/** Exact Unity Texture2D importer state serialized by the official bundle. */
export interface OfficialTextureSamplerProfile {
    name: string;
    slots: readonly OfficialSurfaceTextureSlot[];
    width: number;
    height: number;
    textureFormat: number;
    mipCount: number;
    /** Unity TextureColorSpace: 0=Linear, 1=sRGB. */
    colorSpace: number;
    /** Unity FilterMode: 0=Point, 1=Bilinear, 2=Trilinear. */
    filterMode: number;
    aniso: number;
    mipBias: number;
    /** Unity TextureWrapMode values. */
    wrapU: number;
    wrapV: number;
    wrapW: number;
}

interface OfficialMaterialProfileFile {
    schema: 4;
    unityVersion: string;
    textureSamplers: Record<string, OfficialTextureSamplerProfile>;
    materials: Record<string, Partial<OfficialMaterialProfile>>;
}

let generatedOfficialMaterials = new Map<string, Partial<OfficialMaterialProfile>>();
let generatedOfficialTextureSamplers = new Map<
    string,
    OfficialTextureSamplerProfile
>();
let officialMaterialProfilesPromise: Promise<void> | undefined;

export function normalizeOfficialTextureName(value: string): string {
    return (value
        .replace(/\\/g, '/')
        .split('/')
        .pop() ?? '')
        .split(/[?#]/, 1)[0]
        .replace(/\.(png|jpe?g|webp)$/i, '')
        .trim()
        .toLowerCase();
}

function installOfficialMaterialProfiles(data: unknown): void {
    const profileFile = data as OfficialMaterialProfileFile;
    if (
        profileFile?.schema !== 4
        || profileFile.unityVersion !== '2022.3.62f2'
        || !profileFile.textureSamplers
    ) {
        throw new Error(
            'Official JP material profiles require schema 4 and Unity 2022.3.62f2',
        );
    }
    generatedOfficialMaterials = new Map(Object.entries(profileFile.materials));
    generatedOfficialTextureSamplers = new Map(
        Object.entries(profileFile.textureSamplers),
    );
}

/**
 * Keep the 1.7 MB serialized material table as a cacheable data asset rather
 * than compiling it into the character JavaScript chunk. The loader awaits
 * this once before resolving any model material, so no approximate profile is
 * shown while the exact JP f2 values are still in flight.
 *
 * Tests may pass the parsed repository artifact directly; production always
 * fetches the Vite-emitted URL.
 */
export async function loadOfficialMaterialProfiles(data?: unknown): Promise<void> {
    if (data !== undefined) {
        installOfficialMaterialProfiles(data);
        return;
    }
    if (generatedOfficialMaterials.size > 0) return;
    officialMaterialProfilesPromise ??= fetch(officialMaterialProfileUrl).then(async response => {
        if (!response.ok) {
            throw new Error(
                `Official material profile request failed: ${response.status} ${response.statusText}`,
            );
        }
        installOfficialMaterialProfiles(await response.json());
    });
    await officialMaterialProfilesPromise;
}

export function getOfficialTextureSamplerProfile(
    textureNameOrUrl: string,
): OfficialTextureSamplerProfile | undefined {
    const normalized = normalizeOfficialTextureName(textureNameOrUrl);
    const direct = generatedOfficialTextureSamplers.get(normalized);
    if (direct) return direct;

    // Vite emits production assets as `<Texture2D name>-<8-char hash>.png`.
    // The hash belongs to the web container, not the serialized Unity name.
    // Resolve it only after an exact lookup misses so legitimate authored names
    // remain untouched and every material slot still binds by Texture2D name.
    const emittedAssetName = normalized.match(
        /^(.*)-[A-Za-z0-9_-]{8}$/,
    )?.[1];
    return emittedAssetName
        ? generatedOfficialTextureSamplers.get(emittedAssetName)
        : undefined;
}

const ANISO_DISABLED: OfficialAnisotropyProfile = {
    enabled: false,
    maskByMetallic: false,
    color: [1, 1, 1],
    threshold: 0.9,
    feather: 0,
};

const GENERIC_ANISO: OfficialAnisotropyProfile = {
    enabled: true,
    maskByMetallic: false,
    color: [1, 1, 1],
    threshold: 0.9,
    feather: 0,
};

const FRESNEL_DISABLED: OfficialFresnelProfile = {
    enabled: false,
    maskByMetallic: false,
    color: [1, 1, 1],
    threshold: 0.5,
    feather: 0.25,
};

const MATCAP_DISABLED: OfficialMatCapProfile = {
    enabled: false,
    source: 'default-linear-grey',
    intensity: 1,
    maskByMetallic: false,
    maskBySpecular: false,
};

const OFFICIAL_DEPTH_RIM_DEFAULT: OfficialDepthRimProfile = {
    useDepthTex: true,
    useRimLight: true,
    ditherFade: 0,
    width: 1,
    yOffset: 0,
    rimDiffThreshold: 0.02,
    shadowDiffThreshold: 0.03,
};

const OFFICIAL_OUTLINE_DEFAULT: OfficialOutlineProfile = {
    enabled: true,
    color: [0, 0, 0],
    emissionColor: [0, 0, 0],
    texBlend: 0.2,
    zOffset: 0,
    faceOutlineAdjust: 0,
};

const OFFICIAL_FACE_MATERIAL_DEFAULT: OfficialFaceMaterialProfile = {
    isFace: false,
    isEye: false,
    useGradientMap: false,
    shouldApplyAdditional: false,
    additionalTexture: null,
    cameraDepthTextureZWriteOffset: 0.05,
    highlightThreshold: 0.5,
    highlightRotation: 0,
    cheekValue: 1,
    cheekColor: [1, 0.7, 0.7],
};

const OFFICIAL_STENCIL_DEFAULT: OfficialStencilProfile = {
    mode: 0,
    comparison: 0,
    reference: 0,
    passOperation: 0,
    transparency: 0.75,
};

const GEM_DISABLED: OfficialGemProfile = {
    enabled: false,
    useMatCap: false,
    matCapSource: 'character-or-fallback',
    matCapIntensity: 0,
    maskMatcapMetallic: false,
    maskMatcapSpecular: false,
    useDepthDiff: false,
    firstHighlightSize: 0,
    firstShadowSize: 0,
    secondHighlightSize: 0,
    secondShadowSize: 0,
    depthDiffThreshold: 0.5,
    heightCorrection: 0,
    rimFresnel: 0.5,
    fresnelThreshold: 0.5,
    fresnelFeather: 0.25,
    fresnelMaskByMetallic: false,
};

const GENERIC_GEM: OfficialGemProfile = {
    enabled: true,
    useMatCap: true,
    matCapSource: 'character-or-fallback',
    matCapIntensity: 2,
    maskMatcapMetallic: false,
    maskMatcapSpecular: false,
    useDepthDiff: false,
    firstHighlightSize: 0,
    firstShadowSize: 0,
    secondHighlightSize: 0.35,
    secondShadowSize: 0.35,
    depthDiffThreshold: 0.5,
    heightCorrection: 0.5,
    rimFresnel: 0.5,
    fresnelThreshold: 0.5,
    fresnelFeather: 0.25,
    fresnelMaskByMetallic: false,
};

/*
 * Exact JP 3.11 material evidence (92 character bundles, 192 material names
 * containing "hair", 179 with `_IsHair = 1`). All material names are unique
 * with respect to the fields below. Keeping the compact exception tables here
 * avoids a character-global switch while preserving the complete observed
 * material-slot behaviour.
 */
const OFFICIAL_HAIR_CHARACTER_IDS = new Set([
    100101, 100102, 100103, 100106, 100107, 100201, 100202, 100203, 100205,
    100207, 100301, 100302, 100303, 100304, 100305, 100401, 100402, 100403,
    100501, 100502, 100503, 100504, 100601, 100701, 100702, 100801, 100804,
    100805, 100901, 100903, 101001, 101101, 101201, 101301, 101401, 101501,
    101601, 101701, 101801, 101901, 102001, 101002, 102101, 102102, 102201, 102301,
    102401, 102501, 102601, 105801, 105901, 106101, 106201, 106701, 106801,
    106901, 107001, 107101, 107201, 107401, 107601, 108001, 108002, 108101,
    108201, 108301, 108401, 108601, 108602, 109001, 109201, 110401, 110701,
    111401, 111501, 111601, 111701, 112001, 112401, 112501, 112601, 113301,
    113701, 113801, 113901, 114401, 114501, 114601, 114901, 115001, 115101,
    115201,
]);

const NOT_OFFICIAL_HAIR_MATERIALS = new Set([
    'mt_chara_100504_hair_out',
    'mt_chara_100805_hair_alpha',
    'mt_chara_101401_hair',
    'mt_chara_107101_hair',
    'mt_chara_109801_hair',
    'mt_chara_109801_hair_alpha',
    'mt_chara_109801_hair_out',
    'mt_chara_109801_hair_out_alpha',
    'mt_chara_109801_hair_space',
    'mt_chara_113701_hair_outline',
    'mt_chara_114401_hair_metal',
    'mt_chara_114501_hair',
    'mt_chara_115001_hair',
]);

const HAIR_WITHOUT_ANGEL_RING_MAP = new Set([
    'mt_chara_101101_hair',
    'mt_chara_109201_hair',
    'mt_chara_112601_hair',
]);

const CHARACTER_ANGEL_RING_MAPS = new Set([
    'mt_chara_108101_hair',
    'mt_chara_108101_hair_out',
    'mt_chara_108201_hair',
    'mt_chara_108201_hair_out',
    'mt_chara_108301_hair',
    'mt_chara_108301_hair_out',
    'mt_chara_115201_hair',
    'mt_chara_115201_hair_out',
]);

const HAIR_UV_ANGEL_RING = new Set([
    'mt_chara_108101_hair',
    'mt_chara_108101_hair_out',
    'mt_chara_108201_hair',
    'mt_chara_108201_hair_out',
    'mt_chara_108301_hair',
    'mt_chara_108301_hair_out',
]);

const ANGEL_RING_COLORS = new Map<string, readonly [number, number, number]>([
    ['mt_chara_105901_hair', [0.9294118, 0.9686275, 0.8235295]],
    ['mt_chara_105901_hair_out', [0.9312, 0.97, 0.8245]],
    ['mt_chara_107201_hair', [0.93333334, 0.7411765, 0.5254902]],
    ['mt_chara_107201_hair_out', [0.93333334, 0.73817027, 0.5254902]],
    ['mt_chara_108101_hair', [0.6862745, 0.6431373, 0.7607843]],
    ['mt_chara_108101_hair_out', [0.6862745, 0.6431373, 0.7607843]],
    ['mt_chara_114601_hair', [1, 0.7184184, 0.5707547]],
    ['mt_chara_114601_hair_out', [1, 0.7184184, 0.5707547]],
    ['mt_chara_115001_hair_out', [1, 0.844918, 0.78]],
    ['mt_chara_115201_hair', [1, 0.85098046, 0.7607844]],
    ['mt_chara_115201_hair_out', [1, 0.91764706, 0.7019608]],
]);

function getOfficialAngelRingMaterialProfile(
    normalizedName: string,
): OfficialAngelRingMaterialProfile {
    const characterId = Number(normalizedName.match(/^mt_chara_(\d+)_/)?.[1]);
    const isHair =
        OFFICIAL_HAIR_CHARACTER_IDS.has(characterId) &&
        normalizedName.includes('hair') &&
        !NOT_OFFICIAL_HAIR_MATERIALS.has(normalizedName);
    const map: OfficialAngelRingMap = !isHair ||
        HAIR_WITHOUT_ANGEL_RING_MAP.has(normalizedName)
        ? 'none'
        : CHARACTER_ANGEL_RING_MAPS.has(normalizedName)
            ? 'character'
            : 'common';
    return {
        isHair,
        enabled: isHair && map !== 'none',
        uvMode: isHair && HAIR_UV_ANGEL_RING.has(normalizedName),
        map,
        texture: map === 'common' ? 'RDToon_AngelRingMap' : null,
        rimLightColor: ANGEL_RING_COLORS.get(normalizedName) ?? [1, 1, 1],
    };
}

const OFFICIAL_MATERIALS = new Map<string, Partial<OfficialMaterialProfile>>([
    ['mt_chara_100101_body', {
        source: 'official-export',
        matCap: {
            enabled: true,
            source: 'soft-metallic',
            intensity: 2,
            maskByMetallic: true,
            maskBySpecular: false,
        },
    }],
    ['mt_chara_100101_body_aniso', {
        source: 'official-export',
        anisotropy: true,
        anisotropyProfile: {
            enabled: true,
            maskByMetallic: false,
            color: [
                0.7519999742507935,
                0.2753385901451111,
                0.4024481475353241,
            ],
            threshold: 0.9139999747276306,
            feather: 0,
        },
        matCap: {
            enabled: true,
            source: 'soft-metallic',
            intensity: 2,
            maskByMetallic: false,
            maskBySpecular: false,
        },
    }],
    ['mt_chara_100101_body_sj', {
        source: 'official-export',
        gem: {
            enabled: true,
            useMatCap: true,
            matCapSource: 'soft-metallic',
            matCapIntensity: 2,
            maskMatcapMetallic: false,
            maskMatcapSpecular: false,
            useDepthDiff: false,
            firstHighlightSize: 0,
            firstShadowSize: 0,
            secondHighlightSize: 0,
            secondShadowSize: 0,
            depthDiffThreshold: 0.5,
            heightCorrection: 0.55,
            rimFresnel: 0.5,
            fresnelThreshold: 0.5,
            fresnelFeather: 0.25,
            fresnelMaskByMetallic: false,
        },
        matCap: {
            enabled: true,
            source: 'soft-metallic',
            intensity: 2,
            maskByMetallic: false,
            maskBySpecular: false,
        },
    }],
    ['mt_chara_100101_weapon_a_sj', {
        source: 'official-export',
        fresnel: {
            enabled: true,
            maskByMetallic: true,
            color: [
                1,
                0.5047169923782349,
                0.9053794741630554,
            ],
            threshold: 0.6000000238418579,
            feather: 0.20000000298023224,
        },
        gem: {
            enabled: true,
            useMatCap: true,
            matCapSource: 'soft-metallic',
            matCapIntensity: 2,
            maskMatcapMetallic: true,
            maskMatcapSpecular: false,
            useDepthDiff: true,
            // Exact current-JP saved property. The compiled Shader gates
            // GemDepthDiff on `_UseGemDepthDiff && _Transparency`, so
            // this material does not execute the depth-difference branch.
            transparency: false,
            firstHighlightSize: 0,
            firstShadowSize: 0,
            secondHighlightSize: 0.59,
            secondShadowSize: 0.5,
            depthDiffThreshold: 0.5,
            heightCorrection: 0,
            rimFresnel: 0.5,
            fresnelThreshold: 0.6,
            fresnelFeather: 0.2,
            fresnelMaskByMetallic: true,
        },
        matCap: {
            enabled: true,
            source: 'soft-metallic',
            intensity: 2,
            maskByMetallic: true,
            maskBySpecular: false,
        },
    }],
    ['mt_chara_101901_body_sj', {
        source: 'official-export',
        gem: {
            enabled: true,
            useMatCap: true,
            matCapSource: 'soft-metallic',
            matCapIntensity: 2,
            maskMatcapMetallic: false,
            maskMatcapSpecular: false,
            useDepthDiff: false,
            transparency: false,
            firstHighlightSize: 0,
            firstShadowSize: 1.9199999570846558,
            secondHighlightSize: -1,
            secondShadowSize: 2,
            depthDiffThreshold: 0.5,
            heightCorrection: -0.375,
            rimFresnel: 0.5389999747276306,
            fresnelThreshold: 0.5,
            fresnelFeather: 0.25,
            fresnelMaskByMetallic: false,
        },
        matCap: {
            enabled: true,
            source: 'soft-metallic',
            intensity: 2,
            maskByMetallic: false,
            maskBySpecular: false,
        },
    }],
    ['mt_chara_101901_body_socks', {
        source: 'official-export',
        anisotropy: true,
        anisotropyProfile: {
            enabled: true,
            maskByMetallic: true,
            color: [
                0.46666669845581055,
                0.4549019932746887,
                0.40392160415649414,
            ],
            threshold: 1,
            feather: 0.2919999957084656,
        },
        fresnel: {
            enabled: true,
            maskByMetallic: true,
            color: [
                0.46666669845581055,
                0.4549019932746887,
                0.40392160415649414,
            ],
            threshold: 0.4560000002384186,
            feather: 0.36500000953674316,
        },
    }],
    ['mt_chara_101901_body_gold', {
        source: 'official-export',
        anisotropy: true,
        anisotropyProfile: {
            enabled: true,
            maskByMetallic: true,
            color: [1, 0.714678168296814, 0.5707547068595886],
            threshold: 0.9660000205039978,
            feather: 0.00800000037997961,
        },
        fresnel: {
            enabled: true,
            maskByMetallic: true,
            color: [1, 0.9004032611846924, 0.5235849022865295],
            threshold: 0.2800000011920929,
            feather: 0.5699999928474426,
        },
        // The serialized PPtr is null. ReDriveToon therefore samples the
        // Shader's linearGrey default rather than borrowing a Jewel texture.
        matCap: {
            enabled: true,
            source: 'default-linear-grey',
            intensity: 1,
            maskByMetallic: false,
            maskBySpecular: false,
        },
    }],
    ['mt_chara_101901_weapon_a', {
        source: 'official-export',
        anisotropy: true,
        anisotropyProfile: {
            enabled: true,
            maskByMetallic: true,
            color: [
                0.4745098352432251,
                0.43137258291244507,
                0.43137258291244507,
            ],
            threshold: 0.9890000224113464,
            feather: 0.019999999552965164,
        },
        fresnel: {
            enabled: true,
            maskByMetallic: true,
            color: [
                0.4745098352432251,
                0.43137258291244507,
                0.43137258291244507,
            ],
            threshold: 0.2980000078678131,
            feather: 0.15000000596046448,
        },
        outlineWidth: 6.179999828338623,
        matCap: {
            enabled: true,
            source: 'soft-metallic',
            intensity: 1,
            maskByMetallic: true,
            maskBySpecular: false,
        },
    }],
    ['mt_chara_110701_body_sj', {
        source: 'official-export',
        gem: {
            enabled: true,
            useMatCap: true,
            matCapIntensity: 2,
            maskMatcapMetallic: false,
            maskMatcapSpecular: false,
            useDepthDiff: false,
            firstHighlightSize: -0.55,
            firstShadowSize: 0.35,
            secondHighlightSize: -0.15,
            secondShadowSize: -0.5,
            depthDiffThreshold: 0.5,
            heightCorrection: 0.5,
            rimFresnel: 0.222,
            fresnelThreshold: 0.5,
            fresnelFeather: 0.25,
            fresnelMaskByMetallic: false,
        },
    }],
    // 101002 is present in the native runtime-material-channel export but was
    // absent from the generated material table. Keep its two hair slots
    // source-backed in generic FBX loads as well as native-resource loads.
    ['mt_chara_101002_hair', {
        source: 'official-export',
        customRenderQueue: -1,
        surface: { transparency: false, zWrite: true, srcBlend: 1, dstBlend: 0 },
        outline: {
            enabled: true,
            color: [0, 0, 0],
            emissionColor: [0, 0, 0],
            texBlend: 0.2,
            zOffset: 0,
            faceOutlineAdjust: 3.299999952316284,
        },
        stencil: { mode: 2, comparison: 6, reference: 128, passOperation: 0, transparency: 0.75 },
        shadow: { offset: 0.30000001192092896, feather: 0, offsetMapOffset: 0, castSelfShadow: true, receiveSelfShadow: true },
        depthRim: { useDepthTex: true, useRimLight: true, ditherFade: 0, width: 1, yOffset: 0, rimDiffThreshold: 0.019999999552965164, shadowDiffThreshold: 0.029999999329447746 },
        additionalLightInfluenceByLuminance: 1,
    }],
    ['mt_chara_101002_hair_out', {
        source: 'official-export',
        customRenderQueue: 2002,
        surface: { transparency: false, zWrite: true, srcBlend: 1, dstBlend: 0 },
        outline: {
            enabled: true,
            color: [0, 0, 0],
            emissionColor: [0, 0, 0],
            texBlend: 0.2,
            zOffset: 0,
            faceOutlineAdjust: 3.299999952316284,
        },
        stencil: { mode: 2, comparison: 6, reference: 128, passOperation: 0, transparency: 0.75 },
        shadow: { offset: 0.30000001192092896, feather: 0, offsetMapOffset: 0, castSelfShadow: true, receiveSelfShadow: true },
        depthRim: { useDepthTex: true, useRimLight: true, ditherFade: 0, width: 1, yOffset: 0, rimDiffThreshold: 0.019999999552965164, shadowDiffThreshold: 0.029999999329447746 },
        additionalLightInfluenceByLuminance: 1,
    }],
]);

function copyGem(profile: OfficialGemProfile): OfficialGemProfile {
    return { ...profile };
}

function copyMatCap(profile: OfficialMatCapProfile): OfficialMatCapProfile {
    return { ...profile };
}

function copyDepthRim(profile: OfficialDepthRimProfile): OfficialDepthRimProfile {
    return { ...profile };
}

function copyOutline(profile: OfficialOutlineProfile): OfficialOutlineProfile {
    return {
        ...profile,
        color: [...profile.color] as [number, number, number],
        emissionColor: [...profile.emissionColor] as [number, number, number],
    };
}

function copyFaceMaterial(
    profile: OfficialFaceMaterialProfile,
): OfficialFaceMaterialProfile {
    return {
        ...profile,
        cheekColor: [...profile.cheekColor] as [number, number, number],
    };
}

function copyStencil(profile: OfficialStencilProfile): OfficialStencilProfile {
    return { ...profile };
}

function copyCustomCharacterShader(
    profile: OfficialCustomCharacterShaderProfile,
): OfficialCustomCharacterShaderProfile {
    return {
        ...profile,
        baseColor: [...profile.baseColor] as [number, number, number, number],
        emissionColor: [
            ...profile.emissionColor,
        ] as [number, number, number, number],
        fillColor: profile.fillColor
            ? [...profile.fillColor] as [number, number, number, number]
            : undefined,
        cosmicScroll: profile.cosmicScroll
            ? [...profile.cosmicScroll] as [number, number]
            : undefined,
    };
}

function copyCosmic(profile: OfficialCosmicProfile): OfficialCosmicProfile {
    return {
        ...profile,
        baseColor: [...profile.baseColor] as [number, number, number, number],
        baseMapScroll: [...profile.baseMapScroll] as [number, number],
        scroll: [...profile.scroll] as [number, number],
        shadowTintColor: [...profile.shadowTintColor] as [number, number, number],
    };
}

/** AssetStudio/FBXLoader may append `::Material` or a numeric duplicate suffix. */
export function normalizeOfficialMaterialName(name: string): string {
    return name
        .trim()
        .replace(/\u0000\u0001/g, '::')
        .replace(/::material$/i, '')
        .replace(/\.\d+$/g, '')
        .toLowerCase();
}

/**
 * True when the optional compiled face-additional branch is active. The
 * gradient-enabled main-face variant has its own pre-gate carrier; mask slots
 * remain independent and consume their serialized PPtr without name guesses.
 */
export function resolveOfficialFaceAdditionalActive(
    profile: OfficialMaterialProfile,
): boolean {
    return profile.face.shouldApplyAdditional;
}

export function getOfficialMaterialProfile(name: string): OfficialMaterialProfile {
    const normalized = normalizeOfficialMaterialName(name);
    const inferredGem = normalized.includes('_sj') || normalized.includes('jewel') || normalized.includes('gem');
    const base: OfficialMaterialProfile = {
        name: normalized,
        source: inferredGem || normalized.includes('aniso') || normalized.includes('outlineoffset')
            ? 'name-convention'
            : 'default',
        customRenderQueue: -1,
        surface: {
            transparency: false,
            zWrite: true,
            srcBlend: 1,
            dstBlend: 0,
        },
        isAlphaAdditive: false,
        anisotropy: normalized.includes('aniso'),
        anisotropyProfile: {
            ...(normalized.includes('aniso') ? GENERIC_ANISO : ANISO_DISABLED),
        },
        fresnel: { ...FRESNEL_DISABLED },
        outlineOffset: normalized.includes('outlineoffset'),
        skinOutlineOffset: normalized.includes('outlineoffset_skin'),
        outlineWidth: 5,
        outline: copyOutline(OFFICIAL_OUTLINE_DEFAULT),
        face: {
            ...copyFaceMaterial(OFFICIAL_FACE_MATERIAL_DEFAULT),
            isFace: normalized.includes('_face')
                || normalized.includes('_eye_mask')
                || normalized.includes('_eyebrow_mask'),
            isEye: normalized.includes('_eye_mask'),
        },
        stencil: copyStencil(OFFICIAL_STENCIL_DEFAULT),
        matCap: copyMatCap(
            inferredGem
                ? {
                    enabled: GENERIC_GEM.useMatCap,
                    source: GENERIC_GEM.matCapSource ?? 'character-or-fallback',
                    intensity: GENERIC_GEM.matCapIntensity,
                    maskByMetallic: GENERIC_GEM.maskMatcapMetallic,
                    maskBySpecular: GENERIC_GEM.maskMatcapSpecular,
                }
                : MATCAP_DISABLED,
        ),
        gem: copyGem(inferredGem ? GENERIC_GEM : GEM_DISABLED),
        angelRing: getOfficialAngelRingMaterialProfile(normalized),
        shadow: {
            offset: 0.3,
            feather: 0,
            offsetMapOffset: 0,
            castSelfShadow: true,
            receiveSelfShadow: true,
        },
        depthRim: copyDepthRim(OFFICIAL_DEPTH_RIM_DEFAULT),
        additionalLightInfluenceByLuminance: 0,
        emissionColor: [0, 0, 0],
        cosmic: {
            enabled: false,
            alphaClipping: false,
            baseColor: [1, 1, 1, 1],
            isScreenBaseMap: false,
            baseTexture: null,
            shadowTexture: null,
            controlTexture: null,
            baseMapTiling: 1,
            baseMapScroll: [0, 0],
            texture: null,
            noiseTexture: null,
            tiling: 1,
            scroll: [0, 0],
            maskByControlAlpha: false,
            noiseInfluence: 1,
            noiseTiling: 1,
            noiseSpeed: 1,
            getShadowTexture: false,
            getShadowTint: false,
            applyAmbientLighting: false,
            overlay: false,
            shadowTintColor: [1, 1, 1],
        },
        customShader: undefined,
    };
    const generated = generatedOfficialMaterials.get(normalized);
    const manual = OFFICIAL_MATERIALS.get(normalized);
    const official = generated || manual
        // Generated AssetBundle truth is authoritative. Manual entries may
        // supply a field absent from an older export, but must never replace a
        // serialized value that the current official profile already owns.
        ? { ...manual, ...generated }
        : undefined;
    if (!official) return base;
    return {
        ...base,
        ...official,
        name: normalized,
        surface: official.surface
            ? { ...official.surface }
            : { ...base.surface },
        anisotropyProfile: official.anisotropyProfile
            ? { ...official.anisotropyProfile }
            : { ...base.anisotropyProfile },
        fresnel: official.fresnel
            ? { ...official.fresnel }
            : { ...base.fresnel },
        outline: official.outline
            ? copyOutline(official.outline as OfficialOutlineProfile)
            : copyOutline(base.outline),
        face: official.face
            ? copyFaceMaterial(official.face as OfficialFaceMaterialProfile)
            : copyFaceMaterial(base.face),
        stencil: official.stencil
            ? copyStencil(official.stencil as OfficialStencilProfile)
            : copyStencil(base.stencil),
        matCap: official.matCap
            ? copyMatCap(official.matCap as OfficialMatCapProfile)
            : copyMatCap(base.matCap),
        gem: official.gem ? copyGem(official.gem as OfficialGemProfile) : base.gem,
        angelRing: official.angelRing
            ? { ...official.angelRing }
            : base.angelRing,
        shadow: official.shadow
            ? { ...base.shadow, ...official.shadow }
            : { ...base.shadow },
        depthRim: official.depthRim
            ? copyDepthRim(official.depthRim as OfficialDepthRimProfile)
            : copyDepthRim(base.depthRim),
        emissionColor: official.emissionColor
            ? [...official.emissionColor] as [number, number, number]
            : [...base.emissionColor] as [number, number, number],
        cosmic: official.cosmic
            ? copyCosmic(official.cosmic as OfficialCosmicProfile)
            : copyCosmic(base.cosmic),
        customShader: official.customShader
            ? copyCustomCharacterShader(
                official.customShader as OfficialCustomCharacterShaderProfile,
            )
            : undefined,
    };
}

export function getOfficialMaterialProfiles(names: string[]): OfficialMaterialProfile[] {
    return names.map(getOfficialMaterialProfile);
}

export function createDefaultMaterialProfile(): OfficialMaterialProfile {
    return getOfficialMaterialProfile('default');
}
