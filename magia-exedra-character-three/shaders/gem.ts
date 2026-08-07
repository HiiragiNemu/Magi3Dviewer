import * as THREE from 'three';
import type { OfficialMaterialProfile } from '../materialProfile';
import { createDefaultMaterialProfile } from '../materialProfile';
import { loadTexture, MaximizeTextureQuality } from '../texture';
import DefaultGemMatCap from '../models/chara_109801_battle_unit/matcap02_invert.png';

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
    // Character bundles may ship their own Gem MatCap.  Use that exact
    // texture first; the historical 109801 texture is only a fallback for
    // bundles where no dedicated MatCap was exported.
    const matCap = await loadTexture(matCapUrl ?? DefaultGemMatCap, {
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
    set('uMaterialAnisotropy', value.anisotropy ? 1 : 0);
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

            // MatCap lives in view space.  Mapping normal.xy directly made
            // highlights stick to the model instead of the camera and erased
            // the rotating/glassy response of Soul Gems.  Build the same
            // camera-facing tangent basis used by conventional MatCap shading.
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
            float rdGemMatCapLuma = dot(rdGemMatCap, vec3(0.2126, 0.7152, 0.0722));
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
                vec3 rdGemReflection = mix(
                    rdGemTint * rdGemMatCapLuma,
                    rdGemMatCap,
                    0.64
                );
                rdGemBase += rdGemReflection *
                    uGemMatCapIntensity *
                    rdGemMatCapMask * 0.34;
            }

            // Depth-diff gems receive a stronger inner-edge response. In WebGL
            // this is a conservative local approximation until the dedicated
            // ReDrive depth texture pass is ported.
            float rdGemDepthProxy = smoothstep(
                uGemDepthDiffThreshold,
                1.0,
                1.0 - rdGemNdotV
            ) * uGemUseDepthDiff;
            rdGemBase += rdGemTint * rdGemDepthProxy * 0.32;
            rdGemBase += vec3(1.0) *
                rdGemFresnelBand *
                max(uGemRimFresnel, 0.0) * 0.72;

            outgoingLight = max(rdGemBase, vec3(0.0));
        }

        #include <opaque_fragment>
        `,
    );
}
