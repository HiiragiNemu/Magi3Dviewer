import * as THREE from 'three';
import type { OfficialMaterialProfile } from '../materialProfile';
import { createDefaultMaterialProfile } from '../materialProfile';
import { loadTexture, MaximizeTextureQuality } from '../texture';
import DefaultGemMatCap from '../models/chara_109801_battle_unit/matcap02_invert.png';
import OfficialSoftMetallicMatCap from '../models/common/matcap_SoftMetallic.png';

export interface OfficialGemResources {
    matCap?: THREE.Texture;
    textures: THREE.Texture[];
}

export async function loadOfficialGemResources(
    profiles: OfficialMaterialProfile[] | undefined,
    matCapUrl?: string,
): Promise<OfficialGemResources> {
    if (!profiles?.some(profile => profile.gem.enabled && profile.gem.useMatCap)) {
        return { textures: [] };
    }
    // Exact current-JP evidence for 100101/100107 body_SJ and
    // weapon_a_sj resolves `_MatCapTex` to the common 256x256
    // `matcap_SoftMetallic` texture. Do not substitute a character-package
    // guess or the historical 109801 fallback for those material slots.
    const requiresSoftMetallic = profiles.some(
        profile =>
            profile.gem.enabled &&
            profile.gem.useMatCap &&
            profile.gem.matCapSource === 'soft-metallic',
    );
    const resolvedMatCapUrl = requiresSoftMetallic
        ? OfficialSoftMetallicMatCap
        : (matCapUrl ?? DefaultGemMatCap);
    const matCap = await loadTexture(resolvedMatCapUrl, {
        colorSpace: THREE.NoColorSpace,
    });
    matCap.wrapS = THREE.ClampToEdgeWrapping;
    matCap.wrapT = THREE.ClampToEdgeWrapping;
    MaximizeTextureQuality(matCap);
    return { matCap, textures: [matCap] };
}

export function setOfficialMaterialProfileUniforms(
    shader: THREE.WebGLProgramParametersWithUniforms | undefined,
    profile: OfficialMaterialProfile | undefined,
) {
    if (!shader) return;
    const value = profile ?? createDefaultMaterialProfile();
    const gem = value.gem;
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
    set('uMaterialIsGem', gem.enabled ? 1 : 0);
    // GeneralMaterial is shared by every recovered FBX draw group.  The
    // compile-time feature profile is deliberately an aggregate so the shader
    // variant contains the jewel branch, but the actual switch must follow the
    // material slot selected by loader.onBeforeRender.  Keeping this beside
    // uMaterialIsGem also guarantees non-gem groups reset the boost to zero.
    set('uMaterialSpecialJewel', gem.enabled ? 1 : 0);
    set('uGemUseMatCap', gem.useMatCap ? 1 : 0);
    set('uGemMatCapIntensity', gem.matCapIntensity);
    set('uGemMaskMatcapMetallic', gem.maskMatcapMetallic ? 1 : 0);
    set('uGemMaskMatcapSpecular', gem.maskMatcapSpecular ? 1 : 0);
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
}

/**
 * Inject the recovered ReDrive Gem/MatCap feature family as a per-material pass.
 * Geometry groups select their own official scalar profile in onBeforeRender, so
 * a Soul Gem sub-material no longer forces the complete Body mesh into Gem mode.
 */
export function injectOfficialGemShader(
    shader: THREE.WebGLProgramParametersWithUniforms,
    resources: OfficialGemResources,
    initialProfile?: OfficialMaterialProfile,
) {
    shader.uniforms.tGemMatCap = { value: resources.matCap ?? null };
    setOfficialMaterialProfileUniforms(shader, initialProfile);

    shader.fragmentShader = /* glsl */ `
        uniform sampler2D tGemMatCap;
        uniform float uMaterialIsGem;
        uniform float uGemUseMatCap;
        uniform float uGemMatCapIntensity;
        uniform float uGemMaskMatcapMetallic;
        uniform float uGemMaskMatcapSpecular;
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
        if (uMaterialIsGem > 0.5) {
            vec3 rdGemNormalVs = normalize(normal);
            vec3 rdGemView = normalize(geometryViewDir);
            float rdGemNdotV = saturate(dot(rdGemNormalVs, rdGemView));

            // MatCap lives in view space. The current Web coordinate reconstruction
            // remains approximate until the varying feeding native vs_TEXCOORD5 is
            // completely mapped; the blend below is now the exact current-JP
            // ReDriveToon executable formula.
            vec3 rdGemViewAxis = normalize(rdGemView);
            vec3 rdGemMatCapX = vec3(rdGemViewAxis.z, 0.0, -rdGemViewAxis.x);
            if (dot(rdGemMatCapX, rdGemMatCapX) < 0.0001) {
                rdGemMatCapX = vec3(1.0, 0.0, 0.0);
            } else {
                rdGemMatCapX = normalize(rdGemMatCapX);
            }
            vec3 rdGemMatCapY = normalize(cross(rdGemViewAxis, rdGemMatCapX));
            vec2 rdGemMatCapUv = clamp(
                vec2(
                    dot(rdGemMatCapX, rdGemNormalVs),
                    dot(rdGemMatCapY, rdGemNormalVs)
                ) * 0.495 + 0.5,
                vec2(0.002),
                vec2(0.998)
            );
            vec3 rdGemMatCap = texture2D(tGemMatCap, rdGemMatCapUv).rgb;
            float rdGemMatCapMask = mix(
                1.0,
                rdToonMetallicMask,
                saturate(uGemMaskMatcapMetallic)
            );
            rdGemMatCapMask *= mix(
                1.0,
                rdToonSpecularMask,
                saturate(uGemMaskMatcapSpecular)
            );

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

            vec3 rdGemBase = max(outgoingLight, diffuseColor.rgb * 0.68);
            vec3 rdGemTint = max(diffuseColor.rgb, vec3(0.025));
            float rdGemInternal =
                rdGemHighlightOne * 0.58 +
                rdGemHighlightTwo * 0.42 -
                rdGemShadowOne * 0.18 -
                rdGemShadowTwo * 0.12;
            rdGemBase *= 0.84 + rdGemInternal;

            if (uGemUseMatCap > 0.5) {
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
                    uGemMatCapIntensity * rdGemMatCapMask;
                rdGemBase +=
                    rdGemMatCapFactor *
                    (rdGemMatCapBlend - rdGemBase);
            }

            // Exact current-JP compiled predicate:
            //   (_UseGemDepthDiff != 0) && (_Transparency != 0)
            // mt_chara_100101_weapon_a_sj has _UseGemDepthDiff=1 but
            // _Transparency=0, so its official GemDepthDiff contribution is
            // exactly zero. Do not substitute the previous NdotV proxy.
            // The active transparent CameraDepthTexture formula is recovered,
            // but remains deferred until a proven material actually enters it
            // and the scene camera-depth input is wired without approximation.
            float rdGemDepthBranchEnabled =
                uGemUseDepthDiff * uGemTransparency;
            float rdGemDepthSelector = 0.0;
            if (rdGemDepthBranchEnabled > 0.5) {
                rdGemDepthSelector = 0.0; // deferred exact CameraDepthTexture branch
            }
            rdGemBase += rdGemTint * rdGemDepthSelector * 0.32;
            rdGemBase += vec3(1.0) *
                rdGemFresnelBand *
                max(uGemRimFresnel, 0.0) * 0.72;

            outgoingLight = max(rdGemBase, vec3(0.0));
        }

        #include <opaque_fragment>
        `,
    );
}