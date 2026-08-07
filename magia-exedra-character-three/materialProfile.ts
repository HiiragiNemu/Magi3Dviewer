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

export interface OfficialGemProfile {
    enabled: boolean;
    useMatCap: boolean;
    matCapIntensity: number;
    maskMatcapMetallic: boolean;
    maskMatcapSpecular: boolean;
    useDepthDiff: boolean;
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
    /** Serialized `_RimLightColor`, also used by the AngelRing shader branch. */
    rimLightColor: readonly [number, number, number];
}

export interface OfficialMaterialProfile {
    name: string;
    source: 'official-export' | 'name-convention' | 'default';
    /** Legacy aggregate flag retained for existing feature-variant selection. */
    anisotropy: boolean;
    anisotropyProfile: OfficialAnisotropyProfile;
    fresnel: OfficialFresnelProfile;
    outlineOffset: boolean;
    skinOutlineOffset: boolean;
    gem: OfficialGemProfile;
    angelRing: OfficialAngelRingMaterialProfile;
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

const GEM_DISABLED: OfficialGemProfile = {
    enabled: false,
    useMatCap: false,
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
    101601, 101701, 101801, 101901, 102001, 102101, 102102, 102201, 102301,
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
        rimLightColor: ANGEL_RING_COLORS.get(normalizedName) ?? [1, 1, 1],
    };
}

const OFFICIAL_MATERIALS = new Map<string, Partial<OfficialMaterialProfile>>([
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
    }],
    ['mt_chara_100101_body_sj', {
        source: 'official-export',
        gem: {
            enabled: true,
            useMatCap: true,
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
            matCapIntensity: 2,
            maskMatcapMetallic: true,
            maskMatcapSpecular: false,
            useDepthDiff: true,
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
]);

function copyGem(profile: OfficialGemProfile): OfficialGemProfile {
    return { ...profile };
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

export function getOfficialMaterialProfile(name: string): OfficialMaterialProfile {
    const normalized = normalizeOfficialMaterialName(name);
    const inferredGem = normalized.includes('_sj') || normalized.includes('jewel') || normalized.includes('gem');
    const base: OfficialMaterialProfile = {
        name: normalized,
        source: inferredGem || normalized.includes('aniso') || normalized.includes('outlineoffset')
            ? 'name-convention'
            : 'default',
        anisotropy: normalized.includes('aniso'),
        anisotropyProfile: {
            ...(normalized.includes('aniso') ? GENERIC_ANISO : ANISO_DISABLED),
        },
        fresnel: { ...FRESNEL_DISABLED },
        outlineOffset: normalized.includes('outlineoffset'),
        skinOutlineOffset: normalized.includes('outlineoffset_skin'),
        gem: copyGem(inferredGem ? GENERIC_GEM : GEM_DISABLED),
        angelRing: getOfficialAngelRingMaterialProfile(normalized),
    };
    const official = OFFICIAL_MATERIALS.get(normalized);
    if (!official) return base;
    return {
        ...base,
        ...official,
        name: normalized,
        anisotropyProfile: official.anisotropyProfile
            ? { ...official.anisotropyProfile }
            : { ...base.anisotropyProfile },
        fresnel: official.fresnel
            ? { ...official.fresnel }
            : { ...base.fresnel },
        gem: official.gem ? copyGem(official.gem as OfficialGemProfile) : base.gem,
        angelRing: official.angelRing
            ? { ...official.angelRing }
            : base.angelRing,
    };
}

export function getOfficialMaterialProfiles(names: string[]): OfficialMaterialProfile[] {
    return names.map(getOfficialMaterialProfile);
}

export function createDefaultMaterialProfile(): OfficialMaterialProfile {
    return getOfficialMaterialProfile('default');
}
