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

export interface OfficialMaterialProfile {
    name: string;
    source: 'official-export' | 'name-convention' | 'default';
    anisotropy: boolean;
    outlineOffset: boolean;
    skinOutlineOffset: boolean;
    gem: OfficialGemProfile;
}

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

const OFFICIAL_MATERIALS = new Map<string, Partial<OfficialMaterialProfile>>([
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
        outlineOffset: normalized.includes('outlineoffset'),
        skinOutlineOffset: normalized.includes('outlineoffset_skin'),
        gem: copyGem(inferredGem ? GENERIC_GEM : GEM_DISABLED),
    };
    const official = OFFICIAL_MATERIALS.get(normalized);
    if (!official) return base;
    return {
        ...base,
        ...official,
        name: normalized,
        gem: official.gem ? copyGem(official.gem as OfficialGemProfile) : base.gem,
    };
}

export function getOfficialMaterialProfiles(names: string[]): OfficialMaterialProfile[] {
    return names.map(getOfficialMaterialProfile);
}

export function createDefaultMaterialProfile(): OfficialMaterialProfile {
    return getOfficialMaterialProfile('default');
}
