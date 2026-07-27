import * as THREE from 'three';
import { MaterialUserData, type MaterialCreationOptions, type MaterialCreationResult } from '.';
import { loadTexture, MaximizeTextureQuality } from '../texture';
import { injectToonStylization, ToonStylizationUniforms } from './stylization';

export const ShadowTexOptions = {
    preMix: 0.82,
    test: 0.50,
    threshold: 0.18,
    transition: 0.22,
    amount: 0.28,
    controlOffsetStrength: 0.32,
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

    loadGlobalOptions() {
        super.loadGlobalOptions()
        this.uShadowMix = 0.72
        this.uShadowPreMix = ShadowTexOptions.preMix
        this.uShadowTest = ShadowTexOptions.test
        this.uShadowThreshold = ShadowTexOptions.threshold
        this.uShadowTransition = ShadowTexOptions.transition
        this.uShadowAmount = ShadowTexOptions.amount
        this.uControlOffsetStrength = ShadowTexOptions.controlOffsetStrength
    }
}

export const diffuseColorManipulationEndFlag = '// END diffuseColor manipulation'

interface GeneralMaterialCreationOptions extends MaterialCreationOptions {
    onBeforeCompile?: (shader: THREE.WebGLProgramParametersWithUniforms) => any;
}

/**
 * ReDriveToon control texture:
 * R = per-pixel shadow threshold offset
 * G = metallic response
 * B = specular response
 * A = alpha
 */
export async function createGeneralMaterial(options: GeneralMaterialCreationOptions): Promise<MaterialCreationResult> {
    if (options.alphaSrc == 'shadow' && !options.shadowMap) options.alphaSrc = undefined;
    if (options.alphaSrc == 'ctrl' && !options.ctrlMap) options.alphaSrc = undefined;

    const [colorTex, shadowTex, ctrlTex] = await Promise.all([
        loadTexture(options.colorMap, { colorSpace: THREE.SRGBColorSpace }),
        options.shadowMap ? loadTexture(options.shadowMap, { colorSpace: THREE.SRGBColorSpace }) : Promise.resolve(undefined),
        options.ctrlMap ? loadTexture(options.ctrlMap) : Promise.resolve(undefined),
    ]);

    MaximizeTextureQuality(colorTex, shadowTex, ctrlTex);

    const material = new THREE.MeshStandardMaterial({
        map: colorTex,
        roughness: 1,
        metalness: 0,
        transparent: Boolean(options.alphaSrc),
    });

    const userData = new MaterialUserData()
    material.userData = userData

    const programCacheKey = JSON.stringify({
        colorMap: options.colorMap,
        shadowMap: options.shadowMap,
        ctrlMap: options.ctrlMap,
        alphaSrc: options.alphaSrc,
        hasExtension: Boolean(options.onBeforeCompile),
    });
    material.customProgramCacheKey = () => programCacheKey;

    material.onBeforeCompile = (shader) => {
        if (!shader.defines) shader.defines = {};

        const uniforms = new GeneralMatrialUniforms(shader)
        uniforms.loadGlobalOptions()

        if (shadowTex) {
            shader.defines.HAS_SHADOW = true;
            shader.uniforms.tShadow = { value: shadowTex };
        }

        if (ctrlTex) {
            shader.defines.HAS_CTRL = true;
            shader.uniforms.tCtrl = { value: ctrlTex };
        }

        shader.fragmentShader = /*glsl*/ `
            uniform sampler2D tShadow;
            uniform sampler2D tCtrl;

            uniform float uShadowMix;
            uniform float uShadowPreMix;
            uniform float uShadowTest;
            uniform float uShadowThreshold;
            uniform float uShadowTransition;
            uniform float uShadowAmount;
            uniform float uControlOffsetStrength;

            ${shader.fragmentShader}
        `.replace(
            '#include <map_fragment>',
            /*glsl*/ `
            #include <map_fragment>

            #ifdef HAS_CTRL
                vec4 texCtrl = texture2D(tCtrl, vMapUv);
                rdToonShadowOffset = texCtrl.r - 0.5;
                rdToonMetallicMask = texCtrl.g;
                rdToonSpecularMask = texCtrl.b;
            #endif

            #ifdef HAS_SHADOW
                vec4 texShadow = texture2D(tShadow, vMapUv);

                float shadowMix;
                #ifdef HAS_CTRL
                    float authoredPreMix = mix(0.78, 1.0, texCtrl.r);
                    shadowMix = mix(1.0, authoredPreMix, uShadowPreMix);
                #else
                    shadowMix = uShadowMix;
                #endif

                diffuseColor.rgb = mix(texShadow.rgb, diffuseColor.rgb, shadowMix);
            #endif
            `
        ).replace(
            '#include <roughnessmap_fragment>',
            /*glsl*/ `
            float roughnessFactor;

            #ifdef HAS_CTRL
                roughnessFactor = mix(0.94, 0.38, texCtrl.b);
            #else
                roughnessFactor = roughness;
            #endif
            `
        ).replace(
            '#include <metalnessmap_fragment>',
            /*glsl*/ `
            float metalnessFactor;
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
            #ifdef HAS_SHADOW
                vec3 o_diffuseColor = diffuseColor.rgb;
                ReflectedLight o_reflectedLight = reflectedLight;
                float o_roughnessFactor = roughnessFactor;
                float o_metalnessFactor = metalnessFactor;

                diffuseColor.rgb = vec3(uShadowTest);
                roughnessFactor = 1.0;
                metalnessFactor = 0.0;

                float lightStrength;

                if (0 == 0) {
                    #include <lights_physical_fragment>
                    #include <lights_fragment_begin>
                    #include <lights_fragment_maps>
                    #include <lights_fragment_end>

                    lightStrength = reflectedLight.directDiffuse.r;

                    float pixelShadowThreshold = clamp(
                        uShadowThreshold - rdToonShadowOffset * uControlOffsetStrength,
                        -0.25,
                        0.95
                    );
                    float pixelShadowEnd = pixelShadowThreshold +
                        (1.0 - pixelShadowThreshold) *
                        max(uShadowTransition, 0.0001);

                    lightStrength = smoothstep(
                        pixelShadowThreshold,
                        max(pixelShadowEnd, pixelShadowThreshold + 0.0001),
                        lightStrength
                    );

                    float shadowStrength;
                    if (uShadowAmount < 0.0) {
                        shadowStrength =
                            reflectedLight.indirectDiffuse.r *
                            (1.0 + uShadowAmount);
                    } else {
                        shadowStrength =
                            reflectedLight.indirectDiffuse.r +
                            (1.0 - reflectedLight.indirectDiffuse.r) *
                            uShadowAmount;
                    }
                    lightStrength =
                        shadowStrength +
                        lightStrength * (1.0 - shadowStrength);
                }

                diffuseColor.rgb = o_diffuseColor;
                reflectedLight = o_reflectedLight;
                roughnessFactor = o_roughnessFactor;
                metalnessFactor = o_metalnessFactor;

                diffuseColor.rgb = mix(
                    texShadow.rgb,
                    diffuseColor.rgb,
                    lightStrength
                );
            #endif

            ${diffuseColorManipulationEndFlag}

            #include <lights_physical_fragment>
            `
        );

        options.onBeforeCompile?.(shader);
        injectToonStylization(shader, uniforms);

        userData.shader = shader;
        userData.shaderUniforms = uniforms;
    };

    return {
        material,
        textures: [colorTex, shadowTex, ctrlTex].filter(x => x instanceof THREE.Texture),
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
