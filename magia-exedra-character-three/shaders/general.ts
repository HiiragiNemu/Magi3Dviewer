import * as THREE from 'three';
import { MaterialUserData, type MaterialCreationOptions, type MaterialCreationResult } from '.';
import {
    ApplyOfficialCharacterSurfaceSampling,
    ApplyOfficialSpecularGradientSampling,
    loadTexture,
} from '../texture';
import { getOfficialTextureSamplerProfile, hasOfficialNullCosmicBaseMap } from '../materialProfile';
import { injectToonStylization, ToonStylizationUniforms } from './stylization';
import { setOfficialMaterialProfileUniforms } from './gem';
import { injectCharacterPerspectiveCancellation } from './perspective';
import { injectReDriveDepthRimShader } from './depthRim';
import { applyNativeSlotShaderBindings } from '../nativeMaterialScope';

export const ShadowTexOptions = {
    preMix: 0.82,
    test: 0.50,
    threshold: 0.18,
    transition: 0.22,
    amount: 0.28,
    controlOffsetStrength: 0.32,
    /** Serialized ReDriveToon material defaults. */
    shadowOffset: 0.3,
    shadowFeather: 0.0,
    shadowOffsetMapOffset: 0.0,
}

export const officialShadowPreset = {
    ...ShadowTexOptions,
}

/**
 * Bounded research switch for the official `_ADDITIONAL_LIGHTS` path.
 *
 * Current JP/TW compiled programs prove the generic directional selector,
 * fixed scale, luminance influence and final additive order. Point/Spot,
 * realtime additional shadows and FaceGradient remain separate phases.
 * Keep this explicit directional fixture disabled in normal rendering.
 */
export const AdditionalDirectionalLightExperiment = {
    enabled: false,
    directionWorld: new THREE.Vector3(-4.5, 1.55, -4.0).normalize(),
    radiance: new THREE.Color('#91b4ff').multiplyScalar(0.42),
    influenceByLuminance: 1.0,
}

export function resetOfficialShadowPreset() {
    Object.assign(ShadowTexOptions, officialShadowPreset)
}

export class GeneralMatrialUniforms extends ToonStylizationUniforms {
    constructor(shader: THREE.WebGLProgramParametersWithUniforms) {
        super(shader)
    }

    get uShadowMix(): number | undefined { return this.getValue('uShadowMix') }
    set uShadowMix(value) { this.setValue('uShadowMix', value) }

    get uShadowPreMix(): number | undefined { return this.getValue('uShadowPreMix') }
    set uShadowPreMix(value) { this.setValue('uShadowPreMix', value) }

    get uShadowTest(): number | undefined { return this.getValue('uShadowTest') }
    set uShadowTest(value) { this.setValue('uShadowTest', value) }

    get uShadowThreshold(): number | undefined { return this.getValue('uShadowThreshold') }
    set uShadowThreshold(value) { this.setValue('uShadowThreshold', value) }

    get uShadowTransition(): number | undefined { return this.getValue('uShadowTransition') }
    set uShadowTransition(value) { this.setValue('uShadowTransition', value) }

    get uShadowAmount(): number | undefined { return this.getValue('uShadowAmount') }
    set uShadowAmount(value) { this.setValue('uShadowAmount', value) }

    get uControlOffsetStrength(): number | undefined { return this.getValue('uControlOffsetStrength') }
    set uControlOffsetStrength(value) { this.setValue('uControlOffsetStrength', value) }

    get uRdShadowOffset(): number | undefined { return this.getValue('uRdShadowOffset') }
    set uRdShadowOffset(value) { this.setValue('uRdShadowOffset', value) }

    get uRdShadowFeather(): number | undefined { return this.getValue('uRdShadowFeather') }
    set uRdShadowFeather(value) { this.setValue('uRdShadowFeather', value) }

    get uRdShadowOffsetMapOffset(): number | undefined {
        return this.getValue('uRdShadowOffsetMapOffset')
    }
    set uRdShadowOffsetMapOffset(value) {
        this.setValue('uRdShadowOffsetMapOffset', value)
    }

    get uRdAdditionalDirectionalLightEnabled(): number | undefined {
        return this.getValue('uRdAdditionalDirectionalLightEnabled')
    }
    set uRdAdditionalDirectionalLightEnabled(value) {
        this.setValue('uRdAdditionalDirectionalLightEnabled', value)
    }

    get uRdAdditionalDirectionalLightDirectionWorld(): THREE.Vector3 | undefined {
        return this.getValue('uRdAdditionalDirectionalLightDirectionWorld')
    }
    set uRdAdditionalDirectionalLightDirectionWorld(value) {
        if (!value) return
        const current = this.getValue('uRdAdditionalDirectionalLightDirectionWorld')
        if (current instanceof THREE.Vector3) current.copy(value)
        else this.setValue(
            'uRdAdditionalDirectionalLightDirectionWorld',
            value.clone(),
        )
    }

    get uRdAdditionalDirectionalLightColor(): THREE.Color | undefined {
        return this.getValue('uRdAdditionalDirectionalLightColor')
    }
    set uRdAdditionalDirectionalLightColor(value) {
        if (!value) return
        const current = this.getValue('uRdAdditionalDirectionalLightColor')
        if (current instanceof THREE.Color) current.copy(value)
        else this.setValue('uRdAdditionalDirectionalLightColor', value.clone())
    }

    get uRdAdditionalLightInfluenceByLuminance(): number | undefined {
        return this.getValue('uRdAdditionalLightInfluenceByLuminance')
    }
    set uRdAdditionalLightInfluenceByLuminance(value) {
        this.setValue('uRdAdditionalLightInfluenceByLuminance', value)
    }

    loadGlobalOptions() {
        super.loadGlobalOptions()
        this.uShadowMix = 0.72
        this.uShadowPreMix = ShadowTexOptions.preMix
        this.uShadowTest = ShadowTexOptions.test
        this.uShadowThreshold = ShadowTexOptions.threshold
        this.uShadowTransition = ShadowTexOptions.transition
        this.uShadowAmount = ShadowTexOptions.amount
        this.uControlOffsetStrength = ShadowTexOptions.controlOffsetStrength
        this.uRdShadowOffset = ShadowTexOptions.shadowOffset
        this.uRdShadowFeather = ShadowTexOptions.shadowFeather
        this.uRdShadowOffsetMapOffset =
            ShadowTexOptions.shadowOffsetMapOffset
        this.uRdAdditionalDirectionalLightEnabled =
            AdditionalDirectionalLightExperiment.enabled ? 1 : 0
        this.uRdAdditionalDirectionalLightDirectionWorld =
            AdditionalDirectionalLightExperiment.directionWorld.clone()
        this.uRdAdditionalDirectionalLightColor =
            AdditionalDirectionalLightExperiment.radiance.clone()
        this.uRdAdditionalLightInfluenceByLuminance =
            AdditionalDirectionalLightExperiment.influenceByLuminance
    }
}

export const diffuseColorManipulationEndFlag = '// END diffuseColor manipulation'

interface GeneralMaterialCreationOptions extends MaterialCreationOptions {
    onBeforeCompile?: (
        this: THREE.Material,
        shader: THREE.WebGLProgramParametersWithUniforms,
    ) => any;
    /** Fragment extensions that consume the character-tint stage it creates. */
    onAfterStylization?: (
        this: THREE.Material,
        shader: THREE.WebGLProgramParametersWithUniforms,
    ) => void;
}

/**
 * ReDriveToon control texture:
 * R = per-pixel shadow threshold offset
 * G = metallic/specular tint mask
 * B = authored specular response mask
 * A = alpha
 *
 * Control B is not treated only as inverse roughness. The official schema also
 * provides `_SpecularGradientMap`; this port samples the exported gradient from
 * N.H and applies it after Three's PBR accumulation. Anisotropic materials add
 * the separate ReDriveToon view-normal XZ band recovered from the JP GLES3
 * subprogram; it does not use a mesh tangent or reshape the ordinary specular.
 */
export async function createGeneralMaterial(options: GeneralMaterialCreationOptions): Promise<MaterialCreationResult> {
    if (options.alphaSrc == 'shadow' && !options.shadowMap) options.alphaSrc = undefined;
    if (options.alphaSrc == 'ctrl' && !options.ctrlMap) options.alphaSrc = undefined;

    const native = options.nativeResources;
    const nullBase = options.officialNullBaseMap;
    if (nullBase && (native || options.colorMap || !hasOfficialNullCosmicBaseMap(nullBase))) {
        throw new Error('Invalid serialized NULL Cosmic BaseMap contract');
    }
    const [colorTex, shadowTex, ctrlTex, specularGradientTex] = native ? [
        native.textures._BaseMap ?? null,
        native.textures._ShadowTex ?? undefined,
        native.textures._ControlMap ?? undefined,
        native.textures._SpecularGradientMap ?? undefined,
    ] : await Promise.all([
        nullBase ? Promise.resolve(null) : loadTexture(options.colorMap, { colorSpace: THREE.SRGBColorSpace }),
        options.shadowMap ? loadTexture(options.shadowMap, { colorSpace: THREE.SRGBColorSpace }) : Promise.resolve(undefined),
        options.ctrlMap ? loadTexture(options.ctrlMap) : Promise.resolve(undefined),
        options.specularGradientMap ? loadTexture(options.specularGradientMap) : Promise.resolve(undefined),
    ]);

    const officialTextureSampling = native ? undefined : {
        baseMap: colorTex ? ApplyOfficialCharacterSurfaceSampling(
            colorTex,
            options.colorMap,
            getOfficialTextureSamplerProfile(options.colorMap),
        ) : undefined,
        shadowTex: shadowTex && options.shadowMap
            ? ApplyOfficialCharacterSurfaceSampling(
                shadowTex,
                options.shadowMap,
                getOfficialTextureSamplerProfile(options.shadowMap),
            )
            : undefined,
        controlMap: ctrlTex && options.ctrlMap
            ? ApplyOfficialCharacterSurfaceSampling(
                ctrlTex,
                options.ctrlMap,
                getOfficialTextureSamplerProfile(options.ctrlMap),
            )
            : undefined,
    };
    if (specularGradientTex && !native) {
        ApplyOfficialSpecularGradientSampling(specularGradientTex)
    }

    const material = new THREE.MeshStandardMaterial({
        map: colorTex,
        roughness: 1,
        metalness: 0,
        transparent: Boolean(options.alphaSrc),
    });
    if (native) {
        material.color.setRGB(native.baseColor[0], native.baseColor[1], native.baseColor[2]);
        material.opacity = native.baseColor[3];
    }

    if (nullBase) {
        const color = nullBase.cosmic.baseColor;
        material.color.setRGB(color[0], color[1], color[2]);
        material.opacity = color[3];
    }

    const userData = new MaterialUserData()
    material.userData = userData
    userData.officialTextureSampling = officialTextureSampling
    if (native) Object.assign(userData, { nativeMaterialKey: native.key, nativeTextureSampling: native.sampling, nativeUnknowns: native.unknowns });
    const anisotropy = options.featureProfile?.anisotropy ?? false
    const specialJewel = options.featureProfile?.specialJewel ?? false

    const programCacheKey = JSON.stringify({
        colorMap: options.colorMap,
        nullBaseMap: nullBase?.cosmic.nullBaseMap,
        nullBaseColor: nullBase?.cosmic.baseColor,
        shadowMap: options.shadowMap,
        ctrlMap: options.ctrlMap,
        specularGradientMap: options.specularGradientMap,
        alphaSrc: options.alphaSrc,
        anisotropy,
        specialJewel,
        hasExtension: Boolean(options.onBeforeCompile),
        hasCharacterPerspective: Boolean(
            options.characterPerspectiveReference,
        ),
    });
    material.customProgramCacheKey = () => programCacheKey;

    material.onBeforeCompile = function (shader) {
        if (!shader.defines) shader.defines = {};

        const runtimeUserData = this.userData instanceof MaterialUserData
            ? this.userData
            : new MaterialUserData()
        this.userData = runtimeUserData
        const uniforms = new GeneralMatrialUniforms(shader)
        uniforms.loadGlobalOptions()
        shader.uniforms.uMaterialAnisotropy = { value: anisotropy ? 1 : 0 }
        shader.uniforms.uMaterialAnisoMaskByMetallic = { value: 0 }
        shader.uniforms.uMaterialAnisoColor = { value: new THREE.Color(1, 1, 1) }
        shader.uniforms.uMaterialAnisoThreshold = { value: 0.9 }
        shader.uniforms.uMaterialAnisoFeather = { value: 0 }
        shader.uniforms.uMaterialIsAlphaAdditive = { value: 0 }
        shader.uniforms.uMaterialSurfaceAlphaMode = { value: -1 }
        shader.uniforms.uMaterialShadowAlphaScale = { value: native?.shadowColor[3] ?? 1 }
        shader.uniforms.uMaterialSpecialJewel = { value: specialJewel ? 1 : 0 }

        if (shadowTex) {
            shader.defines.HAS_SHADOW = true;
            shader.uniforms.tShadow = { value: shadowTex };
        }

        if (ctrlTex) {
            shader.defines.HAS_CTRL = true;
            shader.uniforms.tCtrl = { value: ctrlTex };
        }

        if (specularGradientTex) {
            shader.defines.HAS_SPECULAR_GRADIENT = true;
            shader.uniforms.tSpecularGradient = { value: specularGradientTex };
        }

        shader.fragmentShader = /*glsl*/ `
            uniform sampler2D tShadow;
            uniform sampler2D tCtrl;
            uniform sampler2D tSpecularGradient;

            uniform float uShadowMix;
            uniform float uShadowPreMix;
            uniform float uShadowTest;
            uniform float uShadowThreshold;
            uniform float uShadowTransition;
            uniform float uShadowAmount;
            uniform float uControlOffsetStrength;
            uniform float uRdShadowOffset;
            uniform float uRdShadowFeather;
            uniform float uRdShadowOffsetMapOffset;
            uniform float uRdAdditionalDirectionalLightEnabled;
            uniform vec3 uRdAdditionalDirectionalLightDirectionWorld;
            uniform vec3 uRdAdditionalDirectionalLightColor;
            uniform float uRdAdditionalLightInfluenceByLuminance;
            uniform float uRdOfficialAdditionalLightInfluenceByLuminance;
            uniform float uMaterialAnisotropy;
            uniform float uMaterialAnisoMaskByMetallic;
            uniform vec3 uMaterialAnisoColor;
            uniform float uMaterialAnisoThreshold;
            uniform float uMaterialAnisoFeather;
            uniform float uMaterialIsAlphaAdditive;
            uniform float uMaterialSurfaceAlphaMode;
            uniform float uMaterialShadowAlphaScale;
            uniform float uMaterialSpecialJewel;
            uniform float uMaterialReceiveSelfShadow;
            uniform vec3 uMaterialEmissionColor;

            ${shader.fragmentShader}
        `.replace(
            '#include <map_fragment>',
            /*glsl*/ `
            #include <map_fragment>

            // Keep authored Base and Shadow textures separate until the exact
            // ReDriveToon light threshold is evaluated after normal setup.
            vec3 rdToonShadowColor = diffuseColor.rgb;
            float rdToonControlR = 1.0;

            #ifdef HAS_CTRL
                vec4 texCtrl = texture2D(tCtrl, vMapUv);
                rdToonControlR = texCtrl.r;
                rdToonShadowOffset = texCtrl.r;
                rdToonMetallicMask = texCtrl.g;
                rdToonSpecularMask = texCtrl.b;
            #endif

            #ifdef HAS_SHADOW
                vec4 texShadow = texture2D(tShadow, vMapUv);
                rdToonShadowColor = texShadow.rgb;
            #endif
            `
        ).replace(
            '#include <roughnessmap_fragment>',
            /*glsl*/ `
            float roughnessFactor;

            #ifdef HAS_CTRL
                // Keep the physical lobe broad. The authored narrow response is
                // restored separately through the SpecularGradientMap.
                roughnessFactor = mix(0.96, 0.52, texCtrl.b);
            #else
                roughnessFactor = roughness;
            #endif
            `
        ).replace(
            '#include <metalnessmap_fragment>',
            /*glsl*/ `
            float metalnessFactor;
            // Official Control G affects the stylized response/tint; it should
            // not turn the whole albedo into Three's energy-conserving metal.
            metalnessFactor = 0.0;
            `
        ).replace(
            '#include <alphamap_fragment>',
            /*glsl*/ `
            ${ {
                ctrl: `diffuseColor.a = texCtrl.a;`,
                shadow: `diffuseColor.a = texShadow.a;`,
                none: `diffuseColor.a = 1.0;`,
            }[options.alphaSrc || 'none'] }
            // ReDrive main_base blob 90: Transparency/AlphaClipping selects
            // ShadowTex.a * ShadowColor.a, never ControlMap.a. Resolve per draw
            // slot so an alpha sleeve does not make its opaque body transparent.
            if (uMaterialSurfaceAlphaMode >= 0.0) {
                diffuseColor.a = 1.0;
                #ifdef HAS_SHADOW
                    if (uMaterialSurfaceAlphaMode > 0.5) {
                        diffuseColor.a = texShadow.a * uMaterialShadowAlphaScale;
                    }
                #endif
            }
            `
        ).replace(
            '#include <lights_physical_fragment>',
            /*glsl*/`
            // Keep a single Three lighting accumulation for compatibility with
            // extensions, but do not use its N.L-weighted diffuse as the final
            // ReDriveToon colour.
            #include <lights_physical_fragment>
            `
        ).replace(
            '#include <opaque_fragment>',
            /*glsl*/ `
            // JP 3.11 ReDriveToon forward pass:
            //   halfLambert = N.L * 0.5 + 0.5
            //   Control R shifts the local shadow ramp
            //   ShadowOffset/Feather selects Base versus Shadow texture
            // Missing self/depth/global shadow masks deliberately remain 1.0
            // until their dedicated passes are ported.
            vec3 rdToonMainLightDirection =
                normalize(vec3(-0.32, 0.68, 0.66));
            vec3 rdToonMainLightColor = vec3(0.0);
            #if NUM_DIR_LIGHTS > 0
                rdToonMainLightDirection =
                    normalize(directionalLights[0].direction);
                // Stage lights are multiplied by PI to cancel Three's
                // Lambert RECIPROCAL_PI. This custom toon carrier bypasses
                // Lambert, so convert the light back to Unity radiance.
                rdToonMainLightColor =
                    directionalLights[0].color * RECIPROCAL_PI;
            #endif

            // Native ReDriveToon keeps two independent direction chains:
            // CameraDepthTexture samples the physical main light, while the
            // broad BaseTex/ShadowTex selector and highlights use the optional
            // character-light override produced by SetGlobalShaderParams.
            vec3 rdToonCharacterLightDirection = mix(
                rdToonMainLightDirection,
                uGlobalCharacterLightingOverrideDirection,
                step(
                    0.5,
                    uGlobalCharacterLightingOverrideDirectionEnabled
                )
            );

            // RD_DEPTH_RIM_SAMPLE_BEGIN

            float rdToonHalfLambert = saturate(
                dot(normal, rdToonCharacterLightDirection) * 0.5 + 0.5
            );
            float rdToonControl = saturate(
                rdToonControlR + uRdShadowOffsetMapOffset
            );
            float rdToonRamp = saturate(
                rdToonHalfLambert - (1.0 - rdToonControl)
            );
            // RD_DEPTH_SHADOW_SELECTOR_BEGIN
            float rdToonRampLow = saturate(
                uRdShadowOffset - uRdShadowFeather * 0.5
            );
            float rdToonRampHigh = saturate(
                uRdShadowOffset + uRdShadowFeather * 0.5
            );
            float rdToonBaseWeight = step(rdToonRampLow, rdToonRamp);
            if (rdToonRampHigh > rdToonRampLow + 0.00001) {
                rdToonBaseWeight = smoothstep(
                    rdToonRampLow,
                    rdToonRampHigh,
                    rdToonRamp
                );
            }
            // Dedicated ReDrive self-shadow selects the authored ShadowTex.
            rdToonBaseWeight *= mix(
                1.0,
                rdToonSelfShadowVisibility(
                    vRdToonWorldPosition,
                    normal
                ),
                saturate(uMaterialReceiveSelfShadow)
            );

            vec3 rdToonBaseColor = diffuseColor.rgb;
            diffuseColor.rgb = mix(
                rdToonShadowColor * uGlobalCharacterShadowTint,
                rdToonBaseColor,
                rdToonBaseWeight
            );

            ${diffuseColorManipulationEndFlag}

            // The official shader uses SH + main-light colour as a colour
            // multiplier. N.L has already selected the toon texture and must not
            // darken it a second time through MeshStandard's physical diffuse.
            // ReDriveToon consumes Unity's 27-coefficient SH plus the main
            // directional light. Three's assembled irradiance also contains
            // every HemisphereLight in the scene; the Viewer fallback
            // hemisphere therefore introduced a second, normal-dependent
            // gradient after the authored zero-feather Base/Shadow selector.
            // Keep the direction-independent fallback AmbientLight, and use a
            // real LightProbe when one is installed as the Web equivalent of
            // Unity SH. Background/fallback hemisphere lights do not belong to
            // the character carrier.
            vec3 rdToonAmbientColor =
                getAmbientLightIrradiance(ambientLightColor);
            #if defined(USE_LIGHT_PROBES)
                rdToonAmbientColor += getLightProbeIrradiance(
                    lightProbe,
                    normal
                );
            #endif
            vec3 rdToonSceneLightRaw = clamp(
                rdToonAmbientColor + rdToonMainLightColor,
                vec3(0.0),
                vec3(1.0)
            );
            vec3 rdToonSceneLightColor = max(
                mix(
                    rdToonSceneLightRaw,
                    uGlobalCharacterLightingOverrideColor,
                    saturate(uGlobalCharacterLightingOverrideRatio)
                ),
                vec3(0.1)
            );
            outgoingLight = diffuseColor.rgb * rdToonSceneLightColor;

            #ifdef HAS_CTRL
                vec3 rdViewDirection = normalize(geometryViewDir);
                vec3 rdLightDirection = rdToonCharacterLightDirection;
                vec3 rdHalfDirection = normalize(rdViewDirection + rdLightDirection);
                float rdNdotH = saturate(dot(normal, rdHalfDirection));

                // JP 2022.3.62f2 ReDriveToon _IsAniso branch (GLES3 blob 90)
                // executes before the hard highlight and RGB gradient Overlay.
                vec2 rdAnisoNormalXZ = normal.xz;
                float rdAnisoNormalLength = length(rdAnisoNormalXZ);
                rdAnisoNormalXZ = rdAnisoNormalLength > 0.00001
                    ? rdAnisoNormalXZ / rdAnisoNormalLength
                    : vec2(0.0, 1.0);
                vec2 rdAnisoHalfXZ = rdHalfDirection.xz;
                float rdAnisoHalfLength = length(rdAnisoHalfXZ);
                rdAnisoHalfXZ = rdAnisoHalfLength > 0.00001
                    ? rdAnisoHalfXZ / rdAnisoHalfLength
                    : vec2(0.0, 1.0);
                float rdAnisoCoordinate = saturate(dot(
                    rdAnisoNormalXZ,
                    rdAnisoHalfXZ
                ));
                float rdAnisoThreshold =
                    uMaterialAnisoThreshold +
                    (1.00100005 - uMaterialAnisoThreshold) *
                    (1.0 - rdToonMetallicMask);
                float rdAnisoBand = uMaterialAnisoFeather > 0.00001
                    ? smoothstep(
                        rdAnisoThreshold - uMaterialAnisoFeather,
                        rdAnisoThreshold + uMaterialAnisoFeather,
                        rdAnisoCoordinate
                    )
                    : step(rdAnisoThreshold, rdAnisoCoordinate);
                float rdAnisoMetallicMask = mix(
                    1.0,
                    rdToonMetallicMask,
                    saturate(uMaterialAnisoMaskByMetallic)
                );
                vec3 rdAnisoSceneLight = rdToonSceneLightColor *
                    (0.2 + 0.8 * rdToonBaseWeight);
                vec3 rdAnisoColor =
                    rdAnisoSceneLight *
                    uMaterialAnisoColor *
                    rdAnisoBand *
                    rdAnisoMetallicMask;
                vec3 rdAnisoContribution =
                    rdAnisoColor * saturate(uMaterialAnisotropy);
                outgoingLight += rdAnisoContribution;
                diffuseColor.a +=
                    saturate(dot(
                        vec3(0.298911989, 0.586610973, 0.114478),
                        rdAnisoContribution
                    )) * saturate(uMaterialIsAlphaAdditive);

                // JP 2022.3.62f2 main_hair blob 98: the primary response is a
                // hard N.H gate, not the former hand-tuned pow/strength lobe.
                // The light carrier is shared with Aniso/Rim and Control B is
                // the serialized specular mask.
                vec3 rdSpecularLightCarrier =
                    rdToonSceneLightColor *
                    (rdToonBaseWeight * 0.800000012 + 0.200000003);
                float rdHardSpecular =
                    step(0.966000021, rdNdotH) *
                    rdToonSpecularMask *
                    (1.0 - step(0.5, uMaterialAnisotropy));
                outgoingLight +=
                    rdSpecularLightCarrier *
                    rdToonMainLightColor *
                    uRdDepthRimMainColor *
                    rdHardSpecular;

                #ifdef HAS_SPECULAR_GRADIENT
                    // The official gradient is RGB and uses the same per-
                    // channel Overlay operator recovered for MatCap. Control
                    // G selects the blend; when Fresnel itself is metallic-
                    // masked, enabling Fresnel suppresses this overlay.
                    vec3 rdSpecularGradient = texture2D(
                        tSpecularGradient,
                        vec2(rdNdotH, rdNdotH)
                    ).rgb;
                    vec3 rdSpecularOverlayLow =
                        outgoingLight * rdSpecularGradient * 2.0;
                    vec3 rdSpecularOverlayHigh =
                        vec3(1.0) -
                        (vec3(1.0) - outgoingLight) *
                        (vec3(1.0) - rdSpecularGradient) * 2.0;
                    vec3 rdSpecularOverlay = mix(
                        rdSpecularOverlayLow,
                        rdSpecularOverlayHigh,
                        vec3(1.0) - step(outgoingLight, vec3(0.5))
                    );
                    diffuseColor.a +=
                        saturate((dot(
                            vec3(0.298911989, 0.586610973, 0.114478),
                            rdSpecularOverlay
                        ) - 0.5) * 2.0) *
                        saturate(uMaterialIsAlphaAdditive);
                    float rdSpecularFresnelGate = mix(
                        1.0,
                        1.0 - saturate(uFresnelEnabled),
                        saturate(uFresnelMaskByMetallic)
                    );
                    float rdSpecularOverlayWeight =
                        rdToonMetallicMask * rdSpecularFresnelGate;
                    outgoingLight +=
                        rdSpecularOverlayWeight *
                        (rdSpecularOverlay - outgoingLight);
                #endif

            #endif

            // JP 2022.3.62f2 ReDriveToon main_hair blob 98, lines 788-808
            // and 911-924. Fresnel is an authored additive band carried by
            // the same SH/main-light and Base/Shadow selector as Aniso and the
            // hard highlight. It is not a lighting-independent post effect.
            float rdToonFresnelNdotV = saturate(dot(
                normal,
                normalize(geometryViewDir)
            ));
            float rdToonFresnelMetallicScale = mix(
                1.0,
                rdToonMetallicMask,
                saturate(uFresnelMaskByMetallic)
            );
            float rdToonFresnelInput =
                (1.0 - rdToonFresnelNdotV) *
                rdToonFresnelMetallicScale;
            float rdToonFresnelCenter = 1.0 - uFresnelThreshold;
            float rdToonFresnelLow =
                rdToonFresnelCenter - uFresnelFeather * 0.5;
            float rdToonFresnelHigh =
                rdToonFresnelCenter + uFresnelFeather * 0.5;
            float rdToonFresnelMask = step(
                rdToonFresnelCenter,
                rdToonFresnelInput
            );
            if (rdToonFresnelHigh > rdToonFresnelLow + 0.000001) {
                float rdToonFresnelT = saturate(
                    (rdToonFresnelInput - rdToonFresnelLow) /
                    (rdToonFresnelHigh - rdToonFresnelLow)
                );
                rdToonFresnelMask =
                    rdToonFresnelT * rdToonFresnelT *
                    (3.0 - 2.0 * rdToonFresnelT);
            }
            vec3 rdToonFresnelSceneCarrier =
                rdToonSceneLightColor *
                (rdToonBaseWeight * 0.800000012 + 0.200000003);
            vec3 rdToonFresnelContribution =
                rdToonFresnelSceneCarrier *
                uFresnelColor *
                rdToonFresnelMask *
                saturate(uFresnelEnabled);
            outgoingLight += rdToonFresnelContribution;
            diffuseColor.a +=
                saturate(dot(
                    vec3(0.298911989, 0.586610973, 0.114478),
                    rdToonFresnelContribution
                )) * saturate(uMaterialIsAlphaAdditive);
            diffuseColor.a = saturate(diffuseColor.a);

            // RD_OFFICIAL_COSMIC_COMPOSITE

            // RD_DEPTH_RIM_COMPOSITE_BEGIN

            // Emission is downstream of Aniso, hard Specular and the RGB
            // SpecularGradient Overlay in the compiled ReDriveToon program.
            outgoingLight +=
                totalEmissiveRadiance +
                rdToonBaseColor * uMaterialEmissionColor;

            #include <opaque_fragment>
            `
        );

        options.onBeforeCompile?.call(this, shader);
        injectCharacterPerspectiveCancellation(
            shader,
            options.characterPerspectiveReference,
        );
        injectToonStylization(shader, uniforms);
        options.onAfterStylization?.call(this, shader);
        injectReDriveDepthRimShader(shader);
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <opaque_fragment>',
            /* glsl */ `
            // JP 2022.3.62f2 ReDriveToon forward additional-light loop.
            // Foreground lights are already selected from Unity culling masks
            // by the generated scene profile. Three stores their colours in
            // PI-scaled Lambert units; this toon branch consumes Unity
            // radiance directly and therefore applies RECIPROCAL_PI.
            vec3 rdOfficialAdditionalLight = vec3(0.0);

            #if NUM_DIR_LIGHTS > 1
                for (int rdLightIndex = 1;
                    rdLightIndex < NUM_DIR_LIGHTS;
                    rdLightIndex++) {
                    vec3 rdDirection = normalize(
                        directionalLights[rdLightIndex].direction
                    );
                    float rdSelector = step(
                        0.0,
                        dot(normal, rdDirection)
                    );
                    rdOfficialAdditionalLight +=
                        directionalLights[rdLightIndex].color *
                        RECIPROCAL_PI *
                        rdSelector;
                }
            #endif

            #if NUM_POINT_LIGHTS > 0
                for (int rdLightIndex = 0;
                    rdLightIndex < NUM_POINT_LIGHTS;
                    rdLightIndex++) {
                    IncidentLight rdPointLight;
                    getPointLightInfo(
                        pointLights[rdLightIndex],
                        geometryPosition,
                        rdPointLight
                    );
                    float rdSelector = step(
                        0.0,
                        dot(normal, rdPointLight.direction)
                    );
                    rdOfficialAdditionalLight +=
                        rdPointLight.color *
                        RECIPROCAL_PI *
                        rdSelector;
                }
            #endif

            #if NUM_SPOT_LIGHTS > 0
                for (int rdLightIndex = 0;
                    rdLightIndex < NUM_SPOT_LIGHTS;
                    rdLightIndex++) {
                    SpotLight rdSpot = spotLights[rdLightIndex];
                    vec3 rdSpotVector =
                        rdSpot.position - geometryPosition;
                    float rdSpotDistance = length(rdSpotVector);
                    vec3 rdSpotDirection = rdSpotVector / max(
                        rdSpotDistance,
                        0.0000610351562
                    );
                    float rdSpotAngleCos = dot(
                        rdSpotDirection,
                        rdSpot.direction
                    );
                    float rdSpotAttenuation = saturate(
                        (rdSpotAngleCos - rdSpot.coneCos) /
                        max(
                            rdSpot.penumbraCos - rdSpot.coneCos,
                            0.00001
                        )
                    );
                    rdSpotAttenuation *= rdSpotAttenuation;
                    float rdDistanceAttenuation =
                        getDistanceAttenuation(
                            rdSpotDistance,
                            rdSpot.distance,
                            rdSpot.decay
                        );
                    float rdSelector = step(
                        0.0,
                        dot(normal, rdSpotDirection)
                    );
                    rdOfficialAdditionalLight +=
                        rdSpot.color *
                        RECIPROCAL_PI *
                        rdSpotAttenuation *
                        rdDistanceAttenuation *
                        rdSelector;
                }
            #endif

            float rdOfficialBaseLuminance = dot(
                rdToonBaseColor,
                vec3(0.298911989, 0.586610973, 0.114478)
            );
            float rdOfficialAdditionalLuminanceFactor = mix(
                1.0,
                rdOfficialBaseLuminance,
                saturate(
                    uRdOfficialAdditionalLightInfluenceByLuminance
                )
            );
            outgoingLight +=
                rdOfficialAdditionalLight *
                0.200000003 *
                rdOfficialAdditionalLuminanceFactor;

            // Generic directional slice of the official per-pixel additional
            // light loop. Directional attenuation and shadow visibility are 1.
            // FaceGradient uses a per-light SDF selector and is implemented in
            // face.ts rather than approximated here with a mesh-normal test.
            vec3 rdAdditionalLightRawDirectionVS =
                mat3(viewMatrix) * uRdAdditionalDirectionalLightDirectionWorld
            ;
            float rdAdditionalLightDirectionLengthSquared = dot(
                rdAdditionalLightRawDirectionVS,
                rdAdditionalLightRawDirectionVS
            );
            vec3 rdAdditionalLightDirectionVS =
                rdAdditionalLightRawDirectionVS * inversesqrt(max(
                    rdAdditionalLightDirectionLengthSquared,
                    0.0000001
                ));
            float rdAdditionalLightSelector =
                step(0.0000001, rdAdditionalLightDirectionLengthSquared) *
                step(0.0, dot(normal, rdAdditionalLightDirectionVS));
            float rdAdditionalLightBaseLuminance = dot(
                rdToonBaseColor,
                vec3(0.298911989, 0.586610973, 0.114478)
            );
            float rdAdditionalLightLuminanceFactor = mix(
                1.0,
                rdAdditionalLightBaseLuminance,
                saturate(uRdAdditionalLightInfluenceByLuminance)
            );
            outgoingLight +=
                uRdAdditionalDirectionalLightColor *
                rdAdditionalLightSelector *
                0.200000003 *
                rdAdditionalLightLuminanceFactor *
                saturate(uRdAdditionalDirectionalLightEnabled);

            #include <opaque_fragment>
            `,
        )
        setOfficialMaterialProfileUniforms(
            shader,
            runtimeUserData.officialMaterialProfile ??
                options.materialProfiles?.[0],
        )

        runtimeUserData.shader = shader;
        runtimeUserData.shaderUniforms = uniforms;
        if (native || nullBase) {
            // Custom control/shadow samples use original UV0, independently
            // of BaseMap's transform and even when BaseMap is explicitly null.
            shader.defines.USE_UV = true;
            shader.fragmentShader = shader.fragmentShader.replace(/vMapUv/g, 'vUv');
            const exactShadowColor = native ? native.shadowColor : nullBase!.cosmic.nullBaseMap!.shadow.color;
            shader.uniforms.rdNativeShadowColor = { value: new THREE.Color(exactShadowColor[0], exactShadowColor[1], exactShadowColor[2]) };
            shader.fragmentShader = 'uniform vec3 rdNativeShadowColor;\n' + shader.fragmentShader
                .replace('vec3 rdToonShadowColor = diffuseColor.rgb;', 'vec3 rdToonShadowColor = rdNativeShadowColor;')
                .replace('rdToonShadowColor = texShadow.rgb;', 'rdToonShadowColor = texShadow.rgb * rdNativeShadowColor;');
            if (native) applyNativeSlotShaderBindings(shader, native);
        }
    };

    return {
        material,
        textures: [colorTex, shadowTex, ctrlTex, specularGradientTex]
            .filter(x => x instanceof THREE.Texture),
        alphaTex: {
            ctrl: ctrlTex,
            shadow: shadowTex,
            none: undefined,
        }[options.alphaSrc || 'none'],
        shadowTex,
    };
}

export function getMeshGeneralMaterialUniforms(mesh: THREE.Mesh): GeneralMatrialUniforms[] {
    return (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        .map(x => x?.userData)
        .filter(x => x instanceof MaterialUserData)
        .map(x => x.shaderUniforms)
        .filter(x => x instanceof GeneralMatrialUniforms)
}
