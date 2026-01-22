import * as THREE from 'three'
import { loadTexture, MaximizeTextureQuality } from './texture'

interface GeneralMaterialCreationOptions {
    colorMap: string
    shadowMap?: string
    ctrlMap?: string
    alphaSrc?: 'shadow' | 'ctrl'
    onBeforeCompile?: (shader: THREE.WebGLProgramParametersWithUniforms) => any
}

/**
 * ```txt
 * color ---\
 *           |--> ctrl[red] -----> final texture
 * shadow --/
 * 
 * ctrl[alpha] / shadow[alpha] --> final alpha map
 * ```
 * 
 * **TODO: Need to return the textures to prevent memory leak**
 */
export async function createGeneralMaterial(options: GeneralMaterialCreationOptions): Promise<THREE.MeshStandardMaterial> {
    if (options.alphaSrc == 'shadow' && !options.shadowMap) options.alphaSrc = undefined
    if (options.alphaSrc == 'ctrl' && !options.ctrlMap) options.alphaSrc = undefined

    const [colorTex, shadowTex, ctrlTex] = await Promise.all([
        loadTexture(options.colorMap, { colorSpace: THREE.SRGBColorSpace }),
        options.shadowMap ? loadTexture(options.shadowMap, { colorSpace: THREE.SRGBColorSpace }) : Promise.resolve(null),
        options.ctrlMap ? loadTexture(options.ctrlMap) : Promise.resolve(null),
    ]);

    MaximizeTextureQuality(colorTex, shadowTex, ctrlTex)

    const material = new THREE.MeshStandardMaterial({
        map: colorTex,
        transparent: Boolean(options.alphaSrc),
    });

    material.onBeforeCompile = (shader) => {
        if (!shader.defines) shader.defines = {}

        if (shadowTex) {
            shader.defines.HAS_SHADOW = true
            shader.uniforms.tShadow = { value: shadowTex }
        }
        shader.uniforms.uShadowMix = { value: 0.67 }

        if (ctrlTex) {
            shader.defines.HAS_CTRL = true
            shader.uniforms.tCtrl = { value: ctrlTex }
        }

        shader.fragmentShader = /*glsl*/`
            uniform sampler2D tShadow;
            uniform sampler2D tCtrl;
            uniform float uShadowMix;
            ${shader.fragmentShader}
        `.replace(
            '#include <map_fragment>',
            /*glsl*/`
            // start map_fragment injection
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
            // end map_fragment injection
            `
        ).replace(
            '#include <roughnessmap_fragment>',
            /*glsl*/`
            float roughnessFactor;

            #ifdef HAS_CTRL
                roughnessFactor = 1.0 - texCtrl.g; // Ctrl green inverted -> Roughness
            #else
                roughnessFactor = roughness; 
            #endif
            `
        ).replace(
            '#include <metalnessmap_fragment>',
            /*glsl*/`
            float metalnessFactor;

            #ifdef HAS_CTRL
                metalnessFactor = texCtrl.b; // Ctrl blue -> Metalness
            #else
                metalnessFactor = metalness; 
            #endif
            `
        ).replace(
            '#include <alphatest_fragment>',
            {
                ctrl: /*glsl*/`diffuseColor.a = texCtrl.a;`,
                shadow: /*glsl*/`diffuseColor.a = texShadow.a;`,
                none: /*glsl*/`diffuseColor.a = 1.0;`,
            }[options.alphaSrc || 'none']
        )

        options.onBeforeCompile && options.onBeforeCompile(shader)

        // console.log(shader.fragmentShader)
    };

    return material;
}

interface FaceMaterialCreationOptions {
    colorMap: string
    shadowMap: string
    ctrlMap: string
}

export async function createFaceMaterial(options: FaceMaterialCreationOptions): Promise<THREE.MeshStandardMaterial> {
    const [colorTex, shadowTex, ctrlTex] = await Promise.all([
        loadTexture(options.colorMap, { colorSpace: THREE.SRGBColorSpace }),
        loadTexture(options.shadowMap, { colorSpace: THREE.SRGBColorSpace }),
        loadTexture(options.ctrlMap),
    ]);

    MaximizeTextureQuality(colorTex, shadowTex, ctrlTex)

    const material = new THREE.MeshStandardMaterial({
        map: colorTex,
        // transparent: true,
    });

    // 2. Inject your custom Blush/Highlight logic
    material.onBeforeCompile = (shader) => {
        // Add your extra uniforms
        shader.uniforms.tShadow = { value: shadowTex };
        shader.uniforms.tCtrl = { value: ctrlTex };

        shader.uniforms.uShadowMix = { value: 0.67 }
        shader.uniforms.uHighlightBrightness = { value: 1.0 }
        shader.uniforms.uBlushStrength = { value: 0.33 };

        // Update Vertex Shader to handle UV1 (uv1 attribute)
        shader.vertexShader = /*glsl*/`
            attribute vec2 uv1;
            varying vec2 vUv;
            varying vec2 vUv2;
            ${shader.vertexShader}
        `.replace(
            '#include <uv_vertex>',
            /*glsl*/`
            #include <uv_vertex>
            vUv = uv;
            vUv2 = uv1;
            `
        );

        // Update Fragment Shader
        shader.fragmentShader = /*glsl*/`
            varying vec2 vUv;
            varying vec2 vUv2;

            uniform sampler2D tShadow;
            uniform sampler2D tCtrl;
            
            uniform float uShadowMix;
            uniform float uHighlightBrightness;
            uniform float uBlushStrength;
            ${shader.fragmentShader}
        `.replace(
            '#include <map_fragment>',
            /*glsl*/`
            vec4 faceColor = texture2D(map, vUv);
            vec4 faceShadow = texture2D(tShadow, vUv);
            vec4 faceCtrl = texture2D(tCtrl, vUv2);
            
            // mix color and shadow map
            faceColor.rgb = mix(faceShadow.rgb, faceColor.rgb, uShadowMix);

            float eyeMask = step(vUv2.y, 0.5); // extract eye highlights (bottom-half)
            float highlightIntensity = smoothstep(0.5, 1.0, faceCtrl.r) * eyeMask; // hide pixels with value < 0.5
            vec3 highlightColor = vec3(highlightIntensity * uHighlightBrightness);

            float blushMask = step(0.5, vUv2.y); // extract blush (top-half)
            float blushFactor = faceCtrl.r * blushMask * uBlushStrength; // calculate factor
            vec3 blushCyan = vec3(0.0, blushFactor, blushFactor); // map red to grenn-blue, used for subtraction later

            faceColor.rgb += highlightColor; // add eye highlights
            faceColor.rgb -= blushCyan; // add blush (subtract the inverted red)

            // Apply back to the standard variable 'diffuseColor'
            diffuseColor = faceColor;
            `
        );
    };

    return material
}