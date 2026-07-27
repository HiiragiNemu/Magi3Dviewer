import * as THREE from 'three';
import { MaterialUserData, type MaterialCreationOptions, type MaterialCreationResult } from '.';
import { loadTexture, MaximizeTextureQuality } from '../texture';
import FaceCtrlBase from './face_ctrl_base.png'
import { injectToonStylization, ToonStylizationUniforms } from './stylization';

const enableFaceCtrl = false

interface FaceMaterialCreationOptions extends MaterialCreationOptions {
    shadowMap: string;
    eyehighlightMap: string;
}

export class FaceMaterialUniforms extends ToonStylizationUniforms { }

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
        roughness: 1.0,
        metalness: 0.0,
    });

    const userData = new MaterialUserData()
    material.userData = userData

    material.onBeforeCompile = (shader) => {
        if (!shader.defines) shader.defines = {};

        const uniforms = new FaceMaterialUniforms(shader)

        shader.uniforms.tShadow = { value: shadowTex };
        shader.uniforms.tEyehighlight = { value: eyehighlightTex };

        shader.uniforms.uShadowMix = { value: 0.80 };
        shader.uniforms.uHighlightBrightness = { value: 1.12 };
        shader.uniforms.uBlushStrength = { value: 0.22 };

        if (ctrlTex) {
            shader.uniforms.tCtrl = { value: ctrlTex };
            shader.defines.HAS_CTRL = true;
        }

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

            #ifdef HAS_CTRL
                float mirroredU = abs(vUv.x - 0.5) / 2.0 + 0.5;
                vec4 faceCtrl = texture2D(tCtrl, vec2(mirroredU, vUv.y));
                faceColor.rgb = mix(faceShadow.rgb, faceColor.rgb, faceCtrl.r);
            #else
                faceColor.rgb = mix(faceShadow.rgb, faceColor.rgb, uShadowMix);
            #endif

            float eyeMask = step(vUv2.y, 0.5);
            float highlightIntensity =
                eyehighlight.r *
                smoothstep(0.46, 0.62, eyehighlight.r) *
                eyeMask;
            vec3 highlightColor = vec3(
                highlightIntensity * uHighlightBrightness
            );

            float blushMask = step(0.5, vUv2.y);
            float blushFactor =
                eyehighlight.r * blushMask * uBlushStrength;
            vec3 blushCyan = vec3(0.0, blushFactor, blushFactor);

            faceColor.rgb += highlightColor;
            faceColor.rgb -= blushCyan;
            diffuseColor = faceColor;
            `
        );

        injectToonStylization(shader, uniforms);
        userData.shader = shader;
        userData.shaderUniforms = uniforms;
    };

    return {
        material,
        textures: [colorTex, shadowTex, ctrlTex, eyehighlightTex]
            .filter(x => x instanceof THREE.Texture)
    };
}
