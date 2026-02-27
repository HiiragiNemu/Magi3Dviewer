import * as THREE from 'three';
import { getMaterialType, type MaterialCreationOptions, type MaterialCreationResult } from '.';
import { loadTexture, MaximizeTextureQuality } from '../texture';

export const mapFragmentInjectionEndFlag = '// end map_fragment injection'

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

    const material = new (getMaterialType())({
        map: colorTex,
        transparent: Boolean(options.alphaSrc),
    });

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

        if (ctrlTex) {
            shader.defines.HAS_CTRL = true;
            shader.uniforms.tCtrl = { value: ctrlTex };
        }

        shader.fragmentShader = /*glsl*/ `
            uniform sampler2D tShadow;
            uniform sampler2D tCtrl;
            uniform float uShadowMix;
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
            ${mapFragmentInjectionEndFlag}
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
        );

        options.onBeforeCompile && options.onBeforeCompile(shader);

        material.userData.shader = shader;
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
