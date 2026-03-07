import * as THREE from 'three';
import type { MaterialCreationOptions, MaterialCreationResult, MaterialUserData } from '.';
import { loadTexture, MaximizeTextureQuality } from '../texture';

export const shadowOptions = {
    preMix: 1.0,
    test: 0.33,
    threshold: 0.0,
    transition: 0.002,
    amount: 0.0,
}

export const diffuseColorManipulationEndFlag = '// END diffuseColor manipulation'

interface GeneralMaterialCreationOptions extends MaterialCreationOptions {
    onBeforeCompile?: (shader: THREE.WebGLProgramParametersWithUniforms) => any;
}

/**
 * ```txt
 * color ---\
 *           |--> ctrl[red] -----> final texture
 * shadow --/
 *
 * ctrl[alpha] / shadow[alpha] --> final alpha map
 * ```
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
        transparent: Boolean(options.alphaSrc),
    });

    const userData: MaterialUserData = {}
    material.userData = userData

    // prevent different materials from using a same shader
    const programCacheKey = JSON.stringify(options);
    material.customProgramCacheKey = () => programCacheKey;

    material.onBeforeCompile = (shader) => {
        if (!shader.defines) shader.defines = {};

        if (shadowTex) {
            shader.defines.HAS_SHADOW = true;
            shader.uniforms.tShadow = { value: shadowTex };
        }
        shader.uniforms.uShadowMix = { value: 0.67 };
        shader.uniforms.uShadowPreMix = { value: shadowOptions.preMix };
        shader.uniforms.uShadowTest = { value: shadowOptions.test };
        shader.uniforms.uShadowThreshold = { value: shadowOptions.threshold };
        shader.uniforms.uShadowTransition = { value: shadowOptions.transition };
        shader.uniforms.uShadowAmount = { value: shadowOptions.amount };

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

            ${shader.fragmentShader}
        `.replace(
            '#include <map_fragment>',
            /*glsl*/ `
            #include <map_fragment>

            #ifdef HAS_CTRL
                vec4 texCtrl = texture2D(tCtrl, vMapUv);
            #endif

            #ifdef HAS_SHADOW
                vec4 texShadow = texture2D(tShadow, vMapUv);

                float shadowMix;
                #ifdef HAS_CTRL
                    shadowMix = mix(1.0, texCtrl.r, uShadowPreMix); // Mix Color and Shadow texture with Ctrl red, controlled by a premix factor
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
                roughnessFactor = 1.0 - texCtrl.g; // Ctrl green inverted -> Roughness
            #else
                roughnessFactor = roughness; 
            #endif
            `
        ).replace(
            '#include <metalnessmap_fragment>',
            /*glsl*/ `
            float metalnessFactor;

            #ifdef HAS_CTRL
                metalnessFactor = texCtrl.b; // Ctrl blue -> Metalness
            #else
                metalnessFactor = metalness; 
            #endif
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
                // backup global variables
                vec3 o_diffuseColor = diffuseColor.rgb;
                ReflectedLight o_reflectedLight = reflectedLight;
                float o_roughnessFactor = roughnessFactor;
                float o_metalnessFactor = metalnessFactor;

                // first pass: get light strength
                diffuseColor.rgb = vec3(uShadowTest, uShadowTest, uShadowTest); // set texture to 50% gray
                roughnessFactor = 1.0; // disable speculars
                metalnessFactor = 0.0;

                float lightStrength;

                if (0 == 0) {
                    // these includes define some variables
                    // to avoid re-declaration, run them inside a block
                    #include <lights_physical_fragment>
                    #include <lights_fragment_begin>
                    #include <lights_fragment_maps>
                    #include <lights_fragment_end>

                    lightStrength =
                        reflectedLight.directDiffuse.r // directional lights
                        // + reflectedLight.indirectDiffuse.r // ambient lights
                        ;
                    
                    // distinguish light and shadow, add a tiny smooth transition to prevent aliasing
                    lightStrength = smoothstep(
                        uShadowThreshold,
                        uShadowThreshold + (1.0 - uShadowThreshold) * uShadowTransition,
                        lightStrength
                    );

                    // use ambient light as shadow strength
                    float shadowStrength;
                    if (uShadowAmount < 0.0) {
                        shadowStrength = reflectedLight.indirectDiffuse.r * (1.0 + uShadowAmount);
                    } else {
                        shadowStrength = reflectedLight.indirectDiffuse.r + (1.0 - reflectedLight.indirectDiffuse.r) * uShadowAmount;
                    }
                    lightStrength = shadowStrength + lightStrength * (1.0 - shadowStrength); // add shadow
                }

                // restore global variables
                diffuseColor.rgb = o_diffuseColor;
                reflectedLight = o_reflectedLight;
                roughnessFactor = o_roughnessFactor;
                metalnessFactor = o_metalnessFactor;

                // select between color and shadow map according to light strength
                diffuseColor.rgb = mix(texShadow.rgb, diffuseColor.rgb, lightStrength);
                // diffuseColor.rgb = vec3(lightStrength, lightStrength, lightStrength); // debug: for testing whether we've got the correct light strength
            #endif

            ${diffuseColorManipulationEndFlag}

            // second pass: calculate final light based on new diffuseColor
            #include <lights_physical_fragment>
            `
        );

        options.onBeforeCompile && options.onBeforeCompile(shader);

        userData.shader = shader;
        // console.log(shader.fragmentShader)
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
