import * as THREE from 'three';
import type { MaterialCreationOptions, MaterialCreationResult, MaterialUserData } from '.';
import { loadTexture, MaximizeTextureQuality } from '../texture';

export const shaderOptions = {
    shadowThreshold: 0.33,
    shadowTransition: 0.01,
    shadowMinLight: 0.2,
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
        shader.uniforms.uShadowTest = { value: 0.5 };
        shader.uniforms.uShadowThreshold = { value: shaderOptions.shadowThreshold };
        shader.uniforms.uShadowTransition = { value: shaderOptions.shadowTransition };
        shader.uniforms.uShadowMinLight = { value: shaderOptions.shadowMinLight };

        if (ctrlTex) {
            shader.defines.HAS_CTRL = true;
            shader.uniforms.tCtrl = { value: ctrlTex };
        }

        shader.fragmentShader = /*glsl*/ `
            uniform sampler2D tShadow;
            uniform sampler2D tCtrl;

            uniform float uShadowMix;
            uniform float uShadowTest;
            uniform float uShadowThreshold;
            uniform float uShadowTransition;
            uniform float uShadowMinLight;

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
                #ifdef HAS_CTRL
                    diffuseColor.rgb = mix(texShadow.rgb, diffuseColor.rgb, texCtrl.r); // Mix Color and Shadow texture with Ctrl red
                #else
                    diffuseColor.rgb = mix(texShadow.rgb, diffuseColor.rgb, uShadowMix);
                #endif
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

                // first pass: get light strength
                diffuseColor.rgb = vec3(uShadowTest, uShadowTest, uShadowTest);
                float lightStrength;
                if (0 == 0) {
                    // these includes define some variables
                    // to avoid re-declaration, run them inside a block
                    #include <lights_physical_fragment>
                    #include <lights_fragment_begin>
                    #include <lights_fragment_maps>
                    #include <lights_fragment_end>
                    lightStrength = reflectedLight.directDiffuse.r + reflectedLight.indirectDiffuse.r;
                    lightStrength = smoothstep(uShadowThreshold - uShadowTransition / 2.0, uShadowThreshold + uShadowTransition / 2.0, lightStrength); // distinguish light and shadow
                    lightStrength = uShadowMinLight + lightStrength * (1.0 - uShadowMinLight); // add minimum light
                }

                // restore global variables
                diffuseColor.rgb = o_diffuseColor;
                reflectedLight = o_reflectedLight;

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
