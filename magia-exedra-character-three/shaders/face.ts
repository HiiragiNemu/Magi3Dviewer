import * as THREE from 'three';
import { MaterialUserData, type MaterialCreationOptions, type MaterialCreationResult } from '.';
import type { FaceDirectionReference, OfficialFaceProfile } from '../faceProfile';
import { loadTexture, MaximizeTextureQuality } from '../texture';
import FaceCtrlBase from './face_ctrl_base.png'
import FaceCtrlNose from './face_ctrl_nose.png'
import { injectToonStylization, ToonStylizationUniforms } from './stylization';

interface FaceMaterialCreationOptions extends MaterialCreationOptions {
    shadowMap: string;
    eyehighlightMap: string;
    noseGradientMap?: string;
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
    const [colorTex, shadowTex, ctrlTex, noseGradientTex, eyehighlightTex] = await Promise.all([
        loadTexture(options.colorMap, { colorSpace: THREE.SRGBColorSpace }),
        loadTexture(options.shadowMap, { colorSpace: THREE.SRGBColorSpace }),
        loadTexture(options.ctrlMap || FaceCtrlBase),
        loadTexture(options.noseGradientMap || FaceCtrlNose),
        loadTexture(options.eyehighlightMap),
    ]);

    MaximizeTextureQuality(
        colorTex,
        shadowTex,
        ctrlTex,
        noseGradientTex,
        eyehighlightTex,
    );
    ctrlTex.wrapS = THREE.ClampToEdgeWrapping
    ctrlTex.wrapT = THREE.ClampToEdgeWrapping
    noseGradientTex.wrapS = THREE.ClampToEdgeWrapping
    noseGradientTex.wrapT = THREE.ClampToEdgeWrapping

    const material = new THREE.MeshStandardMaterial({
        map: colorTex,
        roughness: 1.0,
        metalness: 0.0,
    });

    material.userData = new MaterialUserData()
    const compiledShaders =
        new Set<THREE.WebGLProgramParametersWithUniforms>()

    const headQuaternion = new THREE.Quaternion()
    const forward = new THREE.Vector3(0, 0, 1)
    const up = new THREE.Vector3(0, 1, 0)
    const right = new THREE.Vector3(1, 0, 0)

    const updateFaceDirectionReference = () => {
        if (compiledShaders.size === 0 || !options.faceReference) return
        const reference = options.faceReference
        reference.headBone.updateWorldMatrix(true, false)
        reference.headBone.getWorldQuaternion(headQuaternion)
        forward.copy(reference.localForward).applyQuaternion(headQuaternion).normalize()
        up.copy(reference.localUp).applyQuaternion(headQuaternion).normalize()
        right.copy(reference.localRight).applyQuaternion(headQuaternion).normalize()
        for (const shader of compiledShaders) {
            shader.uniforms.uFaceForwardWS.value.copy(forward)
            shader.uniforms.uFaceUpWS.value.copy(up)
            shader.uniforms.uFaceRightWS.value.copy(right)
        }
    }

    material.customProgramCacheKey = () => JSON.stringify({
        faceSdf: true,
        characterId: options.faceProfile.characterId,
        source: options.faceProfile.source,
        hasReference: Boolean(options.faceReference),
    })

    material.onBeforeCompile = function (shader) {
        compiledShaders.add(shader)
        if (!shader.defines) shader.defines = {};

        const runtimeUserData = this.userData instanceof MaterialUserData
            ? this.userData
            : new MaterialUserData()
        this.userData = runtimeUserData
        const uniforms = new FaceMaterialUniforms(shader)
        uniforms.loadGlobalOptions()

        shader.uniforms.tShadow = { value: shadowTex };
        shader.uniforms.tFaceGradient = { value: ctrlTex };
        shader.uniforms.tNoseGradient = { value: noseGradientTex };
        shader.uniforms.tEyehighlight = { value: eyehighlightTex };
        shader.uniforms.uUseFaceGradient = { value: options.faceProfile.useFaceGradientMap ? 1 : 0 };
        shader.uniforms.uFaceGradientYOffset = { value: options.faceProfile.faceShadowGradientMapYOffset };
        shader.uniforms.uNoseGradientYOffset = { value: options.faceProfile.noseShadowGradientMapYOffset };
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
            uniform sampler2D tNoseGradient;
            uniform sampler2D tEyehighlight;
            uniform float uUseFaceGradient;
            uniform float uFaceGradientYOffset;
            uniform float uNoseGradientYOffset;
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

            // Recovered from the Android ReDriveToon face-gradient variant.
            // The two bias constants and the 0.985 threshold are part of the
            // compiled official program, not viewer-tuned approximations.
            vec3 rdFaceForward = normalize(vFaceForwardVS);
            vec3 rdFaceRight = normalize(vFaceRightVS);
            vec3 rdFaceBiasedLight = normalize(
                rdFaceLightVS +
                rdFaceForward * 0.111 +
                rdFaceRight * 0.333
            );
            vec2 rdFaceDirection = vec2(
                dot(rdFaceRight, rdFaceBiasedLight),
                dot(rdFaceForward, rdFaceBiasedLight)
            );
            rdFaceDirection /= max(length(rdFaceDirection), 0.0000001);

            // The Unity sampler mirrors the authored gradient when the light
            // crosses the head's right axis. Spell the mirror out so the WebGL
            // result does not depend on texture wrap metadata.
            float rdFaceMirroredU = rdFaceDirection.x >= 0.0
                ? vFaceUv.x
                : 1.0 - vFaceUv.x;
            float rdFaceGradient = texture2D(
                tFaceGradient,
                vec2(
                    rdFaceMirroredU,
                    clamp(vFaceUv.y + uFaceGradientYOffset, 0.0, 1.0)
                )
            ).r;
            float rdNoseGradient = texture2D(
                tNoseGradient,
                vec2(
                    rdFaceMirroredU,
                    clamp(vFaceUv.y + uNoseGradientYOffset, 0.0, 1.0)
                )
            ).r;

            // Official mix: nose values farthest from neutral 0.5 replace the
            // face gradient most strongly.
            float rdNoseMix = saturate(abs(rdNoseGradient - 0.5) * 2.0);
            float rdCombinedGradient = mix(
                rdFaceGradient,
                rdNoseGradient,
                rdNoseMix
            );
            float rdFaceThreshold =
                0.985 - (rdFaceDirection.y * 0.5 + 0.5);
            float rdCombinedFaceLight = smoothstep(
                rdFaceThreshold - 0.01,
                rdFaceThreshold,
                rdCombinedGradient
            );
            rdCombinedFaceLight = mix(
                1.0,
                rdCombinedFaceLight,
                saturate(uUseFaceGradient)
            );
            rdCombinedFaceLight *= rdToonSelfShadowVisibility(
                vRdToonWorldPosition
            );

            faceColor.rgb = mix(
                faceShadow.rgb * uGlobalCharacterShadowTint,
                faceColor.rgb,
                rdCombinedFaceLight
            );

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
        runtimeUserData.shader = shader;
        runtimeUserData.shaderUniforms = uniforms;
    };

    return {
        material,
        textures: [
            colorTex,
            shadowTex,
            ctrlTex,
            noseGradientTex,
            eyehighlightTex,
        ],
        updateFaceDirectionReference: options.faceReference
            ? updateFaceDirectionReference
            : undefined,
    };
}
