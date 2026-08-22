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

export function selectOfficialMatCap(
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
    set(
        'uRdOfficialAdditionalLightInfluenceByLuminance',
        value.additionalLightInfluenceByLuminance,
    );
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
        '// END diffuseColor manipulation',
        /* glsl */ `
        // JP 2022.3.62f2 ReDriveToon main_gem blob 95. The official Gem
        // normal and both half vectors are evaluated in view space. In that
        // space MatrixV * (MatrixInvV[2] * 2 + H1) is exactly (0, 0, 2) + H1.
        vec3 rdGemNormalVs = normalize(normal);
        float rdGemShadowSelector = 0.0;
        float rdGemDepthSelector = 0.0;
        float rdGemHardHighlightMask = 0.0;

        if (uMaterialIsGem > 0.5) {
            vec3 rdGemViewVs = normalize(geometryViewDir);
            // Official main_gem builds both specular half-vectors from the
            // effective character-light direction. This includes the global
            // character-light override instead of falling back to the stage's
            // physical main-light direction.
            vec3 rdGemLightVs = normalize(rdToonCharacterLightDirection);
            vec3 rdGemHalfOneVs = normalize(rdGemViewVs + rdGemLightVs);
            vec3 rdGemHalfTwoVs = normalize(
                rdGemHalfOneVs + vec3(0.0, 0.0, 2.0)
            );
            vec3 rdGemCorrectedNormalVs = normalize(vec3(
                -rdGemNormalVs.x,
                -rdGemNormalVs.y + uGemHeightCorrection,
                rdGemNormalVs.z
            ));
            float rdGemCoordinateOne = saturate(dot(
                rdGemCorrectedNormalVs,
                rdGemHalfOneVs
            ));
            float rdGemCoordinateTwo = saturate(dot(
                rdGemCorrectedNormalVs,
                rdGemHalfTwoVs
            ));
            // Official main_gem keeps _GemHeightCorrection on the shadow/base
            // band only. The two hard-highlight lobes use the original
            // normalized view-space normal for every Gem material.
            float rdGemHighlightCoordinateOne = saturate(dot(
                rdGemNormalVs,
                rdGemHalfOneVs
            ));
            float rdGemHighlightCoordinateTwo = saturate(dot(
                rdGemNormalVs,
                rdGemHalfTwoVs
            ));

            // The native depth selector only exists for transparent Gem
            // materials. The Viewer capability flag prevents its 1x1 fallback
            // depth texture from impersonating a captured CameraDepthTexture;
            // once active, the comparison below is the blob-95 expression.
            float rdGemDepthBranchEnabled =
                step(0.0000001, abs(uGemUseDepthDiff)) *
                step(0.0000001, abs(uGemTransparency)) *
                step(0.0000001, abs(uRdDepthRimExperimentEnabled));
            if (rdGemDepthBranchEnabled > 0.5) {
                float rdGemFragmentEyeDepth =
                    rdDepthRimLinearEye(gl_FragCoord.z);
                float rdGemSceneEyeDepth = rdDepthRimFetchEye(
                    ivec2(trunc(gl_FragCoord.xy))
                );
                float rdGemDepthDifference = clamp(
                    5.0 * (
                        rdGemSceneEyeDepth -
                        (rdGemFragmentEyeDepth - 0.00999999978)
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

            float rdGemFirstShadowThreshold =
                0.660000026 -
                0.340000004 * uGemFirstShadowSize;
            float rdGemSecondShadowThreshold =
                0.933000028 -
                0.0670000017 * uGemSecondShadowSize;
            float rdGemMiddleBand = max(
                step(
                    rdGemFirstShadowThreshold,
                    rdGemCoordinateOne
                ) - step(
                    rdGemSecondShadowThreshold,
                    rdGemCoordinateTwo
                ),
                0.0
            );
            float rdGemNdotV = saturate(dot(
                rdGemNormalVs,
                rdGemViewVs
            ));
            float rdGemRimShadow = step(
                uGemRimFresnel,
                1.0 - rdGemNdotV
            );
            rdGemShadowSelector = saturate(
                1.0 - rdGemMiddleBand +
                rdGemRimShadow +
                rdGemDepthSelector
            );
            diffuseColor.rgb = mix(
                rdToonBaseColor,
                rdToonShadowColor * uGlobalCharacterShadowTint,
                rdGemShadowSelector
            );

            // Blob 95 reuses this selector as the 0.2..1.0 light carrier.
            rdToonBaseWeight = rdGemShadowSelector;

            float rdGemFirstHighlightThreshold =
                0.966000021 -
                0.0350000001 * uGemFirstHighlightSize;
            float rdGemSecondHighlightThreshold =
                0.997500002 -
                0.00300000003 * uGemSecondHighlightSize;
            rdGemHardHighlightMask = min(
                step(
                    rdGemFirstHighlightThreshold,
                    rdGemHighlightCoordinateOne
                ) + step(
                    rdGemSecondHighlightThreshold,
                    rdGemHighlightCoordinateTwo
                ),
                1.0
            );

            // The official alpha path adds the same depth selector.
            diffuseColor.a = saturate(
                diffuseColor.a + rdGemDepthSelector
            );
        }

        // ReDriveToon executes MatCap after Gem Base/Shadow selection and
        // before SH + main-light multiplication. Blob 95 samples with the raw
        // interpolated vertex view-normal (vs_TEXCOORD5.xy), deliberately
        // before the fragment normal is normalized for lighting.
        vec2 rdGemMatCapUv = vNormal.xy * 0.5 + 0.5;
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

        if (uMaterialMatCapEnabled > 0.5) {
            vec3 rdMatCapBase = diffuseColor.rgb;
            vec3 rdMatCapLow =
                rdGemMatCap * rdMatCapBase * 2.0;
            vec3 rdMatCapHigh =
                vec3(1.0) -
                (vec3(1.0) - rdMatCapBase) *
                (vec3(1.0) - rdGemMatCap) * 2.0;
            vec3 rdMatCapBlend = mix(
                rdMatCapLow,
                rdMatCapHigh,
                vec3(1.0) - step(rdMatCapBase, vec3(0.5))
            );
            float rdActiveMatCapMask = mix(
                rdGemMatCapMask,
                mix(
                    1.0,
                    rdToonMetallicMask,
                    saturate(uMaterialMatCapMaskByMetallic)
                ),
                step(0.5, uMaterialIsGem)
            );
            diffuseColor.rgb +=
                uMaterialMatCapIntensity *
                rdActiveMatCapMask *
                (rdMatCapBlend - rdMatCapBase);
        }

        // END diffuseColor manipulation
        `,
    ).replace(
        /* glsl */ `
                float rdHardSpecular =
                    step(0.966000021, rdNdotH) *
                    rdToonSpecularMask *
                    (1.0 - step(0.5, uMaterialAnisotropy));
        `,
        /* glsl */ `
                float rdHardSpecular =
                    step(0.966000021, rdNdotH) *
                    rdToonSpecularMask *
                    (1.0 - step(0.5, uMaterialAnisotropy)) *
                    (1.0 - step(0.5, uMaterialIsGem));
        `,
    ).replace(
        '                #ifdef HAS_SPECULAR_GRADIENT',
        /* glsl */ `
                if (uMaterialIsGem > 0.5) {
                    vec3 rdGemLightCarrier =
                        rdToonSceneLightColor *
                        (
                            rdGemShadowSelector * 0.800000012 +
                            0.200000003
                        );
                    outgoingLight +=
                        rdGemLightCarrier *
                        rdToonMainLightColor *
                        uRdDepthRimMainColor *
                        rdGemHardHighlightMask *
                        (1.0 - step(0.5, uMaterialAnisotropy));
                }

                #ifdef HAS_SPECULAR_GRADIENT
        `,
    );
}
