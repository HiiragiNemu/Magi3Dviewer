import * as THREE from 'three';
import { MaterialUserData, type MaterialCreationOptions, type MaterialCreationResult } from '.';
import type { FaceDirectionReference, OfficialFaceProfile } from '../faceProfile';
import { loadTexture, MaximizeTextureQuality } from '../texture';
import FaceCtrlBase from './face_ctrl_base.png'
import { injectToonStylization, ToonStylizationUniforms } from './stylization';

interface FaceMaterialCreationOptions extends MaterialCreationOptions {
    shadowMap: string;
    eyehighlightMap: string;
    faceReference?: FaceDirectionReference;
    faceProfile: OfficialFaceProfile;
}

export interface FaceMaterialCreationResult extends MaterialCreationResult {
    updateFaceDirectionReference?: () => void;
}

/**
 * Face shading is driven by the animated Head coordinate frame and the authored
 * face SDF. It must not use the mesh normal/PBR split that is appropriate for
 * clothes and hair.
 */
export class FaceMaterialUniforms extends ToonStylizationUniforms {
    loadGlobalOptions() {
        super.loadGlobalOptions()
        this.setValue('uLightingInfluence', 0.01)
        this.setValue('uAlbedoLift', 0.0)
        this.setValue('uOfficialBrightness', 1.0)
        this.setValue('uOfficialContrast', 1.0)
        this.setValue('uOfficialSaturation', 1.02)
        this.setValue('uShadowTintStrength', 0.025)
        this.setValue('uHighlightTintStrength', 0.01)
        this.setValue('uOfficialSpecularStrength', 0.06)
        this.setValue('uMetallicResponse', 0.0)
        this.setValue('uRimStrength', 0.0)
    }
}

export async function createFaceMaterial(options: FaceMaterialCreationOptions): Promise<FaceMaterialCreationResult> {
    const [colorTex, shadowTex, ctrlTex, eyehighlightTex] = await Promise.all([
        loadTexture(options.colorMap, { colorSpace: THREE.SRGBColorSpace }),
        loadTexture(options.shadowMap, { colorSpace: THREE.SRGBColorSpace }),
        loadTexture(options.ctrlMap || FaceCtrlBase),
        loadTexture(options.eyehighlightMap),
    ]);

    MaximizeTextureQuality(colorTex, shadowTex, ctrlTex, eyehighlightTex);
    ctrlTex.wrapS = THREE.ClampToEdgeWrapping
    ctrlTex.wrapT = THREE.ClampToEdgeWrapping

    const material = new THREE.MeshStandardMaterial({
        map: colorTex,
        roughness: 1.0,
        metalness: 0.0,
    });

    const userData = new MaterialUserData()
    material.userData = userData
    let compiledShader: THREE.WebGLProgramParametersWithUniforms | undefined

    const headQuaternion = new THREE.Quaternion()
    const forward = new THREE.Vector3(0, 0, 1)
    const up = new THREE.Vector3(0, 1, 0)
    const right = new THREE.Vector3(1, 0, 0)

    const updateFaceDirectionReference = () => {
        if (!compiledShader || !options.faceReference) return
        const reference = options.faceReference
        reference.headBone.updateWorldMatrix(true, false)
        reference.headBone.getWorldQuaternion(headQuaternion)
        forward.copy(reference.localForward).applyQuaternion(headQuaternion).normalize()
        up.copy(reference.localUp).applyQuaternion(headQuaternion).normalize()
        right.copy(reference.localRight).applyQuaternion(headQuaternion).normalize()
        compiledShader.uniforms.uFaceForwardWS.value.copy(forward)
        compiledShader.uniforms.uFaceUpWS.value.copy(up)
        compiledShader.uniforms.uFaceRightWS.value.copy(right)
    }

    material.customProgramCacheKey = () => JSON.stringify({
        faceSdf: true,
        characterId: options.faceProfile.characterId,
        source: options.faceProfile.source,
        hasReference: Boolean(options.faceReference),
    })

    material.onBeforeCompile = (shader) => {
        compiledShader = shader
        if (!shader.defines) shader.defines = {};

        const uniforms = new FaceMaterialUniforms(shader)
        uniforms.loadGlobalOptions()

        shader.uniforms.tShadow = { value: shadowTex };
        shader.uniforms.tFaceGradient = { value: ctrlTex };
        shader.uniforms.tEyehighlight = { value: eyehighlightTex };
        shader.uniforms.uUseFaceGradient = { value: options.faceProfile.useFaceGradientMap ? 1 : 0 };
        shader.uniforms.uFaceGradientYOffset = { value: options.faceProfile.faceShadowGradientMapYOffset };
        shader.uniforms.uNoseGradientYOffset = { value: options.faceProfile.noseShadowGradientMapYOffset };
        shader.uniforms.uFaceShadowOffset = { value: options.faceProfile.shadowOffset };
        shader.uniforms.uFaceShadowFeather = { value: Math.max(options.faceProfile.shadowFeather, 0.018) };
        shader.uniforms.uCheekValue = { value: options.faceProfile.cheekValue };
        shader.uniforms.uHighlightBrightness = { value: 1.06 };
        shader.uniforms.uBlushStrength = { value: 0.17 };
        shader.uniforms.uFaceForwardWS = { value: new THREE.Vector3(0, 0, 1) };
        shader.uniforms.uFaceUpWS = { value: new THREE.Vector3(0, 1, 0) };
        shader.uniforms.uFaceRightWS = { value: new THREE.Vector3(1, 0, 0) };
        updateFaceDirectionReference()

        shader.vertexShader = /*glsl*/ `
            attribute vec2 uv1;
            varying vec2 vFaceUv;
            varying vec2 vFaceUv2;
            varying vec3 vFaceForwardVS;
            varying vec3 vFaceUpVS;
            varying vec3 vFaceRightVS;
            uniform vec3 uFaceForwardWS;
            uniform vec3 uFaceUpWS;
            uniform vec3 uFaceRightWS;
            ${shader.vertexShader}
        `.replace(
            '#include <uv_vertex>',
            /*glsl*/ `
            #include <uv_vertex>
            vFaceUv = uv;
            vFaceUv2 = uv1;
            vFaceForwardVS = normalize(mat3(viewMatrix) * uFaceForwardWS);
            vFaceUpVS = normalize(mat3(viewMatrix) * uFaceUpWS);
            vFaceRightVS = normalize(mat3(viewMatrix) * uFaceRightWS);
            `
        );

        shader.fragmentShader = /*glsl*/ `
            varying vec2 vFaceUv;
            varying vec2 vFaceUv2;
            varying vec3 vFaceForwardVS;
            varying vec3 vFaceUpVS;
            varying vec3 vFaceRightVS;

            uniform sampler2D tShadow;
            uniform sampler2D tFaceGradient;
            uniform sampler2D tEyehighlight;
            uniform float uUseFaceGradient;
            uniform float uFaceGradientYOffset;
            uniform float uNoseGradientYOffset;
            uniform float uFaceShadowOffset;
            uniform float uFaceShadowFeather;
            uniform float uCheekValue;
            uniform float uHighlightBrightness;
            uniform float uBlushStrength;
            ${shader.fragmentShader}
        `.replace(
            '#include <map_fragment>',
            /*glsl*/ `
            vec4 faceColor = texture2D(map, vFaceUv);
            vec4 faceShadow = texture2D(tShadow, vFaceUv);
            vec4 eyehighlight = texture2D(tEyehighlight, vFaceUv2);

            vec3 rdFaceLightVS = normalize(vec3(-0.35, 0.72, 0.60));
            #if NUM_DIR_LIGHTS > 0
                rdFaceLightVS = normalize(directionalLights[0].direction);
            #endif

            float rdFaceForwardLight = dot(rdFaceLightVS, normalize(vFaceForwardVS));
            float rdFaceSideLight = dot(rdFaceLightVS, normalize(vFaceRightVS));
            float rdFaceHorizontalLength = max(
                length(vec2(rdFaceSideLight, rdFaceForwardLight)),
                0.0001
            );
            rdFaceForwardLight /= rdFaceHorizontalLength;
            rdFaceSideLight /= rdFaceHorizontalLength;

            // 0 at frontal light, 1 at light directly behind the head.
            float rdFaceAngleThreshold =
                acos(clamp(rdFaceForwardLight, -1.0, 1.0)) / 3.14159265359;
            rdFaceAngleThreshold = clamp(
                rdFaceAngleThreshold - uFaceShadowOffset * 0.10,
                0.0,
                1.0
            );

            vec2 rdFaceGradientUv = vec2(
                rdFaceSideLight >= 0.0 ? 1.0 - vFaceUv.x : vFaceUv.x,
                clamp(vFaceUv.y + uFaceGradientYOffset, 0.0, 1.0)
            );
            vec4 rdFaceGradient = texture2D(tFaceGradient, rdFaceGradientUv);
            float rdFaceLit = smoothstep(
                rdFaceAngleThreshold - uFaceShadowFeather,
                rdFaceAngleThreshold + uFaceShadowFeather,
                rdFaceGradient.r
            );
            rdFaceLit = mix(0.86, rdFaceLit, saturate(uUseFaceGradient));

            // The common control map stores a second authored response in G.
            // Constrain it to the central lower face so it behaves as nose/cheek
            // modelling rather than painting a second hard half-face shadow.
            vec2 rdNoseDelta = vec2(
                (vFaceUv.x - 0.5) / 0.18,
                (vFaceUv.y - (0.52 + uNoseGradientYOffset)) / 0.20
            );
            float rdNoseArea = exp(-dot(rdNoseDelta, rdNoseDelta) * 2.2);
            float rdNoseLit = smoothstep(
                rdFaceAngleThreshold - 0.04,
                rdFaceAngleThreshold + 0.04,
                rdFaceGradient.g
            );
            float rdCombinedFaceLight = min(
                rdFaceLit,
                mix(1.0, rdNoseLit, rdNoseArea * 0.32)
            );

            faceColor.rgb = mix(faceShadow.rgb, faceColor.rgb, rdCombinedFaceLight);

            float eyeMask = step(vFaceUv2.y, 0.5);
            float highlightIntensity =
                eyehighlight.r *
                smoothstep(0.46, 0.62, eyehighlight.r) *
                eyeMask;
            faceColor.rgb += vec3(highlightIntensity * uHighlightBrightness);

            float blushMask = step(0.5, vFaceUv2.y);
            float blushFactor =
                eyehighlight.r * blushMask * uBlushStrength * uCheekValue;
            faceColor.rgb -= vec3(0.0, blushFactor, blushFactor);
            diffuseColor = faceColor;
            `
        );

        injectToonStylization(shader, uniforms);
        userData.shader = shader;
        userData.shaderUniforms = uniforms;
    };

    return {
        material,
        textures: [colorTex, shadowTex, ctrlTex, eyehighlightTex],
        updateFaceDirectionReference: options.faceReference
            ? updateFaceDirectionReference
            : undefined,
    };
}
