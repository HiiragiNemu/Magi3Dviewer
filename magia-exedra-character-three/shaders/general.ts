import * as THREE from 'three';
import { MaterialUserData, type MaterialCreationOptions, type MaterialCreationResult } from '.';
import { loadTexture, MaximizeTextureQuality } from '../texture';
import { injectToonStylization, ToonStylizationUniforms } from './stylization';
import { setOfficialMaterialProfileUniforms } from './gem';

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
    }
}

export const diffuseColorManipulationEndFlag = '// END diffuseColor manipulation'

interface GeneralMaterialCreationOptions extends MaterialCreationOptions {
    onBeforeCompile?: (
        this: THREE.Material,
        shader: THREE.WebGLProgramParametersWithUniforms,
    ) => any;
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
 * N.H and applies it after Three's PBR accumulation. Materials whose FBX names
 * contain `Aniso` use a tangent-oriented half-vector coordinate.
 */
export async function createGeneralMaterial(options: GeneralMaterialCreationOptions): Promise<MaterialCreationResult> {
    if (options.alphaSrc == 'shadow' && !options.shadowMap) options.alphaSrc = undefined;
    if (options.alphaSrc == 'ctrl' && !options.ctrlMap) options.alphaSrc = undefined;

    const [colorTex, shadowTex, ctrlTex, specularGradientTex] = await Promise.all([
        loadTexture(options.colorMap, { colorSpace: THREE.SRGBColorSpace }),
        options.shadowMap ? loadTexture(options.shadowMap, { colorSpace: THREE.SRGBColorSpace }) : Promise.resolve(undefined),
        options.ctrlMap ? loadTexture(options.ctrlMap) : Promise.resolve(undefined),
        options.specularGradientMap ? loadTexture(options.specularGradientMap) : Promise.resolve(undefined),
    ]);

    MaximizeTextureQuality(colorTex, shadowTex, ctrlTex, specularGradientTex);
    if (specularGradientTex) {
        specularGradientTex.wrapS = THREE.ClampToEdgeWrapping
        specularGradientTex.wrapT = THREE.ClampToEdgeWrapping
    }

    const material = new THREE.MeshStandardMaterial({
        map: colorTex,
        roughness: 1,
        metalness: 0,
        transparent: Boolean(options.alphaSrc),
    });

    const userData = new MaterialUserData()
    material.userData = userData
    const anisotropy = options.featureProfile?.anisotropy ?? false
    const specialJewel = options.featureProfile?.specialJewel ?? false

    const programCacheKey = JSON.stringify({
        colorMap: options.colorMap,
        shadowMap: options.shadowMap,
        ctrlMap: options.ctrlMap,
        specularGradientMap: options.specularGradientMap,
        alphaSrc: options.alphaSrc,
        anisotropy,
        specialJewel,
        hasExtension: Boolean(options.onBeforeCompile),
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
            uniform float uMaterialAnisotropy;
            uniform float uMaterialSpecialJewel;

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
            {
                ctrl: /*glsl*/ `diffuseColor.a = texCtrl.a;`,
                shadow: /*glsl*/ `diffuseColor.a = texShadow.a;`,
                none: /*glsl*/ `diffuseColor.a = 1.0;`,
            }[options.alphaSrc || 'none']
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
                rdToonMainLightColor = directionalLights[0].color;
            #endif

            float rdToonHalfLambert = saturate(
                dot(normal, rdToonMainLightDirection) * 0.5 + 0.5
            );
            float rdToonControl = saturate(
                rdToonControlR + uRdShadowOffsetMapOffset
            );
            float rdToonRamp = saturate(
                rdToonHalfLambert - (1.0 - rdToonControl)
            );
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
            vec3 rdToonAmbientColor = vec3(0.0);
            #if defined(RE_IndirectDiffuse)
                rdToonAmbientColor = irradiance;
            #endif
            vec3 rdToonSceneLightColor = max(
                clamp(
                    rdToonAmbientColor + rdToonMainLightColor,
                    vec3(0.0),
                    vec3(1.0)
                ),
                vec3(0.1)
            );
            outgoingLight =
                diffuseColor.rgb * rdToonSceneLightColor +
                totalEmissiveRadiance;

            #ifdef HAS_CTRL
                vec3 rdViewDirection = normalize(vViewPosition);
                vec3 rdLightDirection = rdToonMainLightDirection;
                vec3 rdHalfDirection = normalize(rdViewDirection + rdLightDirection);
                float rdNdotH = saturate(dot(normal, rdHalfDirection));

                vec3 rdAnisoTangent = cross(vec3(0.0, 1.0, 0.0), normal);
                if (dot(rdAnisoTangent, rdAnisoTangent) < 0.0001) {
                    rdAnisoTangent = cross(vec3(1.0, 0.0, 0.0), normal);
                }
                rdAnisoTangent = normalize(rdAnisoTangent);
                vec3 rdAnisoNormal = normalize(
                    normal + rdAnisoTangent *
                    (dot(rdHalfDirection, rdAnisoTangent) * 0.52)
                );
                float rdAnisoNdotH = saturate(dot(rdAnisoNormal, rdHalfDirection));
                float rdSpecularCoordinate = mix(
                    rdNdotH,
                    rdAnisoNdotH,
                    saturate(uMaterialAnisotropy)
                );

                float rdSpecularGradient = pow(
                    rdSpecularCoordinate,
                    mix(18.0, 5.0, rdToonSpecularMask)
                );
                #ifdef HAS_SPECULAR_GRADIENT
                    rdSpecularGradient = texture2D(
                        tSpecularGradient,
                        vec2(rdSpecularCoordinate, 0.5)
                    ).r;
                #endif

                float rdSpecular =
                    rdSpecularGradient *
                    rdToonSpecularMask *
                    uOfficialSpecularStrength;
                rdSpecular *= mix(1.0, 1.18, saturate(uMaterialAnisotropy));
                rdSpecular *= mix(1.0, 1.35, saturate(uMaterialSpecialJewel));

                vec3 rdSpecularColor = mix(
                    vec3(1.0),
                    max(diffuseColor.rgb, vec3(0.04)),
                    saturate(rdToonMetallicMask * uMetallicResponse)
                );
                outgoingLight += rdSpecularColor * rdSpecular;
            #endif

            #include <opaque_fragment>
            `
        );

        options.onBeforeCompile?.call(this, shader);
        injectToonStylization(shader, uniforms);
        setOfficialMaterialProfileUniforms(
            shader,
            runtimeUserData.officialMaterialProfile ??
                options.materialProfiles?.[0],
        )

        runtimeUserData.shader = shader;
        runtimeUserData.shaderUniforms = uniforms;
    };

    return {
        material,
        textures: [colorTex, shadowTex, ctrlTex, specularGradientTex]
            .filter(x => x instanceof THREE.Texture),
        alphaTex: {
            ctrl: ctrlTex,
            shadow: shadowTex,
            none: undefined,
        }[options.alphaSrc || 'none']
    };
}

export function getMeshGeneralMaterialUniforms(mesh: THREE.Mesh): GeneralMatrialUniforms[] {
    return (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        .map(x => x?.userData)
        .filter(x => x instanceof MaterialUserData)
        .map(x => x.shaderUniforms)
        .filter(x => x instanceof GeneralMatrialUniforms)
}
