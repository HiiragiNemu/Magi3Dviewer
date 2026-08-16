import * as THREE from 'three';
import type { OfficialMaterialProfile } from '../materialProfile';
import { createDefaultMaterialProfile } from '../materialProfile';
import { loadTexture, MaximizeTextureQuality } from '../texture';
import DefaultGemMatCap from '../models/chara_109801_battle_unit/matcap02_invert.png';
import OfficialSoftMetallicMatCap from '../models/common/matcap_SoftMetallic.png';
import { setDepthRimMaterialProfileUniforms } from './depthRim';

export interface OfficialGemResources {
    matCaps: Map<string, THREE.Texture>;
    fallbackMatCap?: THREE.Texture;
    textures: THREE.Texture[];
}

function normalizeTextureName(value: string): string {
    return value.replace(/\\/g, '/').split('/').pop()!
        .replace(/\.png$/i, '')
        .toLowerCase();
}

export async function loadOfficialGemResources(
    profiles: OfficialMaterialProfile[] | undefined,
    texturePathUrl: Record<string, string> = {},
): Promise<OfficialGemResources> {
    if (!profiles?.some(profile => profile.matCap.enabled)) {
        return { matCaps: new Map(), textures: [] };
    }
    const urlsByName = new Map<string, string>();
    for (const [path, url] of Object.entries(texturePathUrl)) {
        urlsByName.set(normalizeTextureName(path), url);
    }
    urlsByName.set('matcap_softmetallic', OfficialSoftMetallicMatCap);

    const requested = new Set(
        profiles
            .filter(profile => profile.matCap.enabled)
            .map(profile => profile.matCap.texture?.toLowerCase())
            .filter((name): name is string => !!name),
    );
    if (profiles.some(profile => (
        profile.matCap.enabled && profile.matCap.source === 'soft-metallic'
    ))) {
        requested.add('matcap_softmetallic');
    }

    const matCaps = new Map<string, THREE.Texture>();
    const textures: THREE.Texture[] = [];
    for (const name of requested) {
        const url = urlsByName.get(name);
        if (!url) continue;
        const texture = await loadTexture(url, { colorSpace: THREE.NoColorSpace });
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        MaximizeTextureQuality(texture);
        matCaps.set(name, texture);
        textures.push(texture);
    }

    // A bounded fallback keeps older/name-inferred profiles usable. Recovered
    // profiles with an exact PPtr select their own Texture2D below.
    const fallbackUrl = [...urlsByName.entries()].find(([name]) => (
        name.includes('matcap') && name !== 'matcap_softmetallic'
    ))?.[1] ?? DefaultGemMatCap;
    const fallbackMatCap = await loadTexture(fallbackUrl, {
        colorSpace: THREE.NoColorSpace,
    });
    fallbackMatCap.wrapS = THREE.ClampToEdgeWrapping;
    fallbackMatCap.wrapT = THREE.ClampToEdgeWrapping;
    MaximizeTextureQuality(fallbackMatCap);
    textures.push(fallbackMatCap);
    return { matCaps, fallbackMatCap, textures: [...new Set(textures)] };
}

function selectOfficialMatCap(
    resources: OfficialGemResources,
    profile?: OfficialMaterialProfile,
): THREE.Texture | undefined {
    const matCap = profile?.matCap;
    const exactName = matCap?.texture?.toLowerCase();
    if (exactName && resources.matCaps.has(exactName)) {
        return resources.matCaps.get(exactName);
    }
    if (matCap?.source === 'soft-metallic') {
        return resources.matCaps.get('matcap_softmetallic')
            ?? resources.fallbackMatCap;
    }
    return resources.fallbackMatCap;
}

export function setOfficialMaterialProfileUniforms(
    shader: THREE.WebGLProgramParametersWithUniforms | undefined,
    profile: OfficialMaterialProfile | undefined,
) {
    if (!shader) return;
    const value = profile ?? createDefaultMaterialProfile();
    const gem = value.gem;
    const matCap = value.matCap;
    const set = (key: string, uniformValue: number) => {
        shader.uniforms[key] ??= { value: uniformValue };
        shader.uniforms[key].value = uniformValue;
    };
    const setColor = (
        key: string,
        rgb: readonly [number, number, number],
    ) => {
        const current = shader.uniforms[key]?.value;
        if (current instanceof THREE.Color) current.setRGB(...rgb);
        else shader.uniforms[key] = { value: new THREE.Color(...rgb) };
    };
    const aniso = value.anisotropyProfile;
    const fresnel = value.fresnel;
    set('uMaterialAnisotropy', aniso.enabled ? 1 : 0);
    set('uMaterialAnisoMaskByMetallic', aniso.maskByMetallic ? 1 : 0);
    setColor('uMaterialAnisoColor', aniso.color);
    set('uMaterialAnisoThreshold', aniso.threshold);
    set('uMaterialAnisoFeather', aniso.feather);
    // Material defaults are authoritative. FresnelAnimationAttributeReceiver
    // will eventually overwrite the same per-renderer uniforms from Timeline.
    set('uFresnelEnabled', fresnel.enabled ? 1 : 0);
    setColor('uFresnelColor', fresnel.color);
    set('uFresnelStrength', fresnel.enabled ? 1 : 0);
    set('uFresnelThreshold', fresnel.threshold);
    set('uFresnelFeather', fresnel.feather);
    set('uFresnelMaskByMetallic', fresnel.maskByMetallic ? 1 : 0);
    set('uMaterialOutlineOffset', value.outlineOffset ? 1 : 0);
    set('uMaterialSkinOutlineOffset', value.skinOutlineOffset ? 1 : 0);
    set('uRdShadowOffset', value.shadow.offset);
    set('uRdShadowFeather', value.shadow.feather);
    set('uMaterialReceiveSelfShadow', value.shadow.receiveSelfShadow ? 1 : 0);
    setColor('uMaterialEmissionColor', value.emissionColor);
    set('uMaterialIsGem', gem.enabled ? 1 : 0);
    // GeneralMaterial is shared by every recovered FBX draw group.  The
    // compile-time feature profile is deliberately an aggregate so the shader
    // variant contains the jewel branch, but the actual switch must follow the
    // material slot selected by loader.onBeforeRender.  Keeping this beside
    // uMaterialIsGem also guarantees non-gem groups reset the boost to zero.
    set('uMaterialSpecialJewel', gem.enabled ? 1 : 0);
    set('uMaterialMatCapEnabled', matCap.enabled ? 1 : 0);
    set('uMaterialMatCapUseLinearGrey',
        matCap.source === 'default-linear-grey' ? 1 : 0);
    set('uMaterialMatCapIntensity', matCap.intensity);
    set('uMaterialMatCapMaskByMetallic', matCap.maskByMetallic ? 1 : 0);
    set('uMaterialMatCapMaskBySpecular', matCap.maskBySpecular ? 1 : 0);
    set('uGemUseDepthDiff', gem.useDepthDiff ? 1 : 0);
    set('uGemTransparency', gem.transparency ? 1 : 0);
    set('uGemFirstHighlightSize', gem.firstHighlightSize);
    set('uGemFirstShadowSize', gem.firstShadowSize);
    set('uGemSecondHighlightSize', gem.secondHighlightSize);
    set('uGemSecondShadowSize', gem.secondShadowSize);
    set('uGemDepthDiffThreshold', gem.depthDiffThreshold);
    set('uGemHeightCorrection', gem.heightCorrection);
    set('uGemRimFresnel', gem.rimFresnel);
    set('uGemFresnelThreshold', gem.fresnelThreshold);
    set('uGemFresnelFeather', gem.fresnelFeather);
    set('uGemFresnelMaskByMetallic', gem.fresnelMaskByMetallic ? 1 : 0);
    setDepthRimMaterialProfileUniforms(shader, value);
}

/**
 * Inject the recovered ReDrive base MatCap and Gem feature families as a
 * per-material pass.
 * Geometry groups select their own official scalar profile in onBeforeRender, so
 * a Soul Gem sub-material no longer forces the complete Body mesh into Gem mode.
 */
export function injectOfficialGemShader(
    shader: THREE.WebGLProgramParametersWithUniforms,
    resources: OfficialGemResources,
    initialProfile?: OfficialMaterialProfile,
) {
    shader.uniforms.tGemMatCap = {
        value: selectOfficialMatCap(resources, initialProfile) ?? null,
    };
    setOfficialMaterialProfileUniforms(shader, initialProfile);

    shader.fragmentShader = /* glsl */ `
        uniform sampler2D tGemMatCap;
        uniform float uMaterialIsGem;
        uniform float uMaterialMatCapEnabled;
        uniform float uMaterialMatCapUseLinearGrey;
        uniform float uMaterialMatCapIntensity;
        uniform float uMaterialMatCapMaskByMetallic;
        uniform float uMaterialMatCapMaskBySpecular;
        uniform float uGemUseDepthDiff;
        uniform float uGemTransparency;
        uniform float uGemFirstHighlightSize;
        uniform float uGemFirstShadowSize;
        uniform float uGemSecondHighlightSize;
        uniform float uGemSecondShadowSize;
        uniform float uGemDepthDiffThreshold;
        uniform float uGemHeightCorrection;
        uniform float uGemRimFresnel;
        uniform float uGemFresnelThreshold;
        uniform float uGemFresnelFeather;
        uniform float uGemFresnelMaskByMetallic;
        ${shader.fragmentShader}
    `.replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        vec3 rdGemNormalVs = normalize(normal);
        // JP 2022.3.62f2 ReDriveToon vs_TEXCOORD5 is the world normal
        // transformed by unity_MatrixV. Three normal is already that
        // view-space normal, so the native MatCap UV is direct and does not
        // depend on the view direction.
        vec2 rdGemMatCapUv = rdGemNormalVs.xy * 0.5 + 0.5;
        vec3 rdGemMatCapTexture = texture2D(
            tGemMatCap,
            rdGemMatCapUv
        ).rgb;
        vec3 rdGemMatCap = mix(
            rdGemMatCapTexture,
            vec3(0.5),
            saturate(uMaterialMatCapUseLinearGrey)
        );
        float rdGemMatCapMask = mix(
            1.0,
            rdToonMetallicMask,
            saturate(uMaterialMatCapMaskByMetallic)
        );
        rdGemMatCapMask *= mix(
            1.0,
            rdToonSpecularMask,
            saturate(uMaterialMatCapMaskBySpecular)
        );

        if (uMaterialIsGem > 0.5) {
            vec3 rdGemView = normalize(geometryViewDir);
            float rdGemNdotV = saturate(dot(rdGemNormalVs, rdGemView));

            // Official Gem size values are signed artistic offsets rather than
            // literal widths. Map them around two stable view-normal bands.
            float rdGemHeight = saturate(
                rdGemNormalVs.y * 0.5 + 0.5 +
                (uGemHeightCorrection - 0.5) * 0.26
            );
            float rdGemFirstCenter = clamp(0.70 + uGemFirstHighlightSize * 0.18, 0.08, 0.92);
            float rdGemSecondCenter = clamp(0.33 + uGemSecondHighlightSize * 0.20, 0.08, 0.92);
            float rdGemFirstWidth = 0.09 + abs(uGemFirstHighlightSize) * 0.06;
            float rdGemSecondWidth = 0.10 + abs(uGemSecondHighlightSize) * 0.07;
            float rdGemHighlightOne = exp2(
                -pow((rdGemHeight - rdGemFirstCenter) / rdGemFirstWidth, 2.0) * 3.0
            );
            float rdGemHighlightTwo = exp2(
                -pow((rdGemHeight - rdGemSecondCenter) / rdGemSecondWidth, 2.0) * 3.0
            );
            float rdGemShadowOne = smoothstep(
                0.0,
                1.0,
                (0.5 - rdGemHeight) + uGemFirstShadowSize * 0.20
            );
            float rdGemShadowTwo = smoothstep(
                0.0,
                1.0,
                (rdGemHeight - 0.5) + uGemSecondShadowSize * 0.20
            );

            float rdGemFresnel = 1.0 - rdGemNdotV;
            float rdGemFresnelBand = smoothstep(
                clamp(uGemFresnelThreshold - uGemFresnelFeather, 0.0, 1.0),
                clamp(uGemFresnelThreshold + uGemFresnelFeather, 0.001, 1.0),
                rdGemFresnel
            );
            rdGemFresnelBand *= mix(
                1.0,
                rdToonMetallicMask,
                saturate(uGemFresnelMaskByMetallic)
            );

            // Official transparent GemDepthDiff is a selector before MatCap,
            // not a final colour tint. It is additionally bounded by the
            // global CameraDepthTexture experiment so disabled output is
            // byte-for-byte the pre-prototype path.
            // mt_chara_100101_weapon_a_sj has Transparency=0, therefore its
            // official GemDepthDiff contribution is exactly zero.
            float rdGemDepthBranchEnabled =
                step(0.0000001, abs(uGemUseDepthDiff)) *
                step(0.0000001, abs(uGemTransparency)) *
                step(0.0000001, abs(uRdDepthRimExperimentEnabled));
            float rdGemDepthSelector = 0.0;
            if (rdGemDepthBranchEnabled > 0.5) {
                float rdGemCenterZ =
                    rdDepthRimLinearEye(gl_FragCoord.z);
                float rdGemCenterTextureZ = rdDepthRimFetchEye(
                    ivec2(trunc(gl_FragCoord.xy))
                );
                float rdGemDepthDifference = clamp(
                    5.0 * (
                        rdGemCenterTextureZ -
                        (rdGemCenterZ - 0.01)
                    ),
                    0.0,
                    1.0
                );
                rdGemDepthSelector =
                    rdGemDepthDifference >=
                        1.0 - uGemDepthDiffThreshold
                    ? 0.0
                    : 1.0;
            }

            vec3 rdGemDepthSelectedBase = mix(
                diffuseColor.rgb,
                rdToonShadowColor,
                rdGemDepthSelector
            );
            vec3 rdGemBase = max(
                outgoingLight,
                rdGemDepthSelectedBase * 0.68
            );
            float rdGemInternal =
                rdGemHighlightOne * 0.58 +
                rdGemHighlightTwo * 0.42 -
                rdGemShadowOne * 0.18 -
                rdGemShadowTwo * 0.12;
            rdGemBase *= 0.84 + rdGemInternal;

            if (uMaterialMatCapEnabled > 0.5) {
                // Current-JP ReDriveToon executable MatCap blend, per channel:
                // base<=0.5 => base*matcap; base>0.5 =>
                // 1 - 2*(1-base)*(1-matcap). The serialized MatCapIntensity and
                // Control B/G masks then interpolate/extrapolate from base.
                vec3 rdGemMatCapLow = rdGemMatCap * rdGemBase;
                vec3 rdGemMatCapHigh =
                    vec3(1.0) -
                    (vec3(1.0) - rdGemBase) *
                    (vec3(1.0) - rdGemMatCap) * 2.0;
                vec3 rdGemMatCapBlend = mix(
                    rdGemMatCapLow,
                    rdGemMatCapHigh,
                    step(vec3(0.5), rdGemBase)
                );
                float rdGemMatCapFactor =
                    uMaterialMatCapIntensity * rdGemMatCapMask;
                rdGemBase +=
                    rdGemMatCapFactor *
                    (rdGemMatCapBlend - rdGemBase);
            }

            rdGemBase += vec3(1.0) *
                rdGemFresnelBand *
                max(uGemRimFresnel, 0.0) * 0.72;

            outgoingLight = max(rdGemBase, vec3(0.0));
        }

        // _UseMatCap is an independent base-shader feature. Apply it to
        // regular body/metal/weapon slots as well; Gem has already consumed
        // the same official operator inside its own authored band result.
        if (
            uMaterialMatCapEnabled > 0.5 &&
            uMaterialIsGem <= 0.5
        ) {
            vec3 rdMatCapBase = outgoingLight;
            vec3 rdMatCapLow = rdGemMatCap * rdMatCapBase;
            vec3 rdMatCapHigh =
                vec3(1.0) -
                (vec3(1.0) - rdMatCapBase) *
                (vec3(1.0) - rdGemMatCap) * 2.0;
            vec3 rdMatCapBlend = mix(
                rdMatCapLow,
                rdMatCapHigh,
                step(vec3(0.5), rdMatCapBase)
            );
            outgoingLight +=
                uMaterialMatCapIntensity *
                rdGemMatCapMask *
                (rdMatCapBlend - rdMatCapBase);
            outgoingLight = max(outgoingLight, vec3(0.0));
        }

        #include <opaque_fragment>
        `,
    );
}
