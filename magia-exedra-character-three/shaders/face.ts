import * as THREE from 'three';
import type { MaterialCreationOptions, MaterialCreationResult, MaterialUserData } from '.';
import { loadTexture, MaximizeTextureQuality } from '../texture';
import FaceCtrlBase from './face_ctrl_base.png'

const enableFaceCtrl = false

interface FaceMaterialCreationOptions extends MaterialCreationOptions {
    shadowMap: string;
    eyehighlightMap: string;
}

export async function createFaceMaterial(options: FaceMaterialCreationOptions): Promise<MaterialCreationResult> {
    const [colorTex, shadowTex, ctrlTex, eyehighlightTex] = await Promise.all([
        loadTexture(options.colorMap, { colorSpace: THREE.SRGBColorSpace }),
        loadTexture(options.shadowMap, { colorSpace: THREE.SRGBColorSpace }),
        enableFaceCtrl ? loadTexture(options.ctrlMap || FaceCtrlBase) : Promise.resolve(undefined),
        loadTexture(options.eyehighlightMap),
    ]);

    MaximizeTextureQuality(colorTex, shadowTex, ctrlTex, eyehighlightTex);

    const material = new THREE.MeshStandardMaterial({
        map: colorTex,
        // transparent: true,
    });

    const userData: MaterialUserData = {}
    material.userData = userData

    // 2. Inject your custom Blush/Highlight logic
    material.onBeforeCompile = (shader) => {
        if (!shader.defines) shader.defines = {};

        // Add your extra uniforms
        shader.uniforms.tShadow = { value: shadowTex };
        shader.uniforms.tEyehighlight = { value: eyehighlightTex };

        shader.uniforms.uShadowMix = { value: 0.67 };
        shader.uniforms.uHighlightBrightness = { value: 1.0 };
        shader.uniforms.uBlushStrength = { value: 0.33 };

        if (ctrlTex) {
            shader.uniforms.tCtrl = { value: ctrlTex };
            shader.defines.HAS_CTRL = true;
        }

        // Update Vertex Shader to handle UV1 (uv1 attribute)
        shader.vertexShader = /*glsl*/ `
            attribute vec2 uv1;
            varying vec2 vUv;
            varying vec2 vUv2;
            ${shader.vertexShader}
        `.replace(
            '#include <uv_vertex>',
            /*glsl*/ `
            #include <uv_vertex>
            vUv = uv;
            vUv2 = uv1;
            `
        );

        // Update Fragment Shader
        shader.fragmentShader = /*glsl*/ `
            varying vec2 vUv;
            varying vec2 vUv2;

            uniform sampler2D tShadow;
            uniform sampler2D tCtrl;
            uniform sampler2D tEyehighlight;
            
            uniform float uShadowMix;
            uniform float uHighlightBrightness;
            uniform float uBlushStrength;
            ${shader.fragmentShader}
        `.replace(
            '#include <map_fragment>',
            /*glsl*/ `
            vec4 faceColor = texture2D(map, vUv);
            vec4 faceShadow = texture2D(tShadow, vUv);
            vec4 eyehighlight = texture2D(tEyehighlight, vUv2);
            
            // mix color and shadow map
            #ifdef HAS_CTRL
                // mirror vUv right to the left and reduce range
                float mirroredU = abs(vUv.x - 0.5) / 2.0 + 0.5;
                vec4 faceCtrl = texture2D(tCtrl, vec2(mirroredU, vUv.y));
                faceColor.rgb = mix(faceShadow.rgb, faceColor.rgb, faceCtrl.r);
            #else
                faceColor.rgb = mix(faceShadow.rgb, faceColor.rgb, uShadowMix);
            #endif
            
            float eyeMask = step(vUv2.y, 0.5); // extract eye highlights (bottom-half)
            float highlightIntensity = eyehighlight.r * step(0.5, eyehighlight.r) * eyeMask; // hide pixels with value < 0.5
            vec3 highlightColor = vec3(highlightIntensity * uHighlightBrightness);

            float blushMask = step(0.5, vUv2.y); // extract blush (top-half)
            float blushFactor = eyehighlight.r * blushMask * uBlushStrength; // calculate factor
            vec3 blushCyan = vec3(0.0, blushFactor, blushFactor); // map red to grenn-blue, used for subtraction later

            faceColor.rgb += highlightColor; // add eye highlights
            faceColor.rgb -= blushCyan; // add blush (subtract the inverted red)

            // Apply back to the standard variable 'diffuseColor'
            diffuseColor = faceColor;
            `
        );

        userData.shader = shader;
    };

    return {
        material,
        textures: [colorTex, shadowTex, ctrlTex, eyehighlightTex].filter(x => x instanceof THREE.Texture)
    };
}
