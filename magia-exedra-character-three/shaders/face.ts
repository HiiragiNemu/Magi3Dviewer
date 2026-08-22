import * as THREE from 'three';
import { MaterialUserData, type MaterialCreationOptions, type MaterialCreationResult } from '.';
import type { FaceDirectionReference, OfficialFaceProfile } from '../faceProfile';
import type { OfficialMaterialProfile } from '../materialProfile';
import { loadTexture, MaximizeTextureQuality } from '../texture';
import FaceCtrlBase from './face_ctrl_base.png'
import FaceCtrlNose from './face_ctrl_nose.png'
import { injectToonStylization, ToonStylizationUniforms } from './stylization';
import { injectCharacterPerspectiveCancellation } from './perspective';

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

export function setOfficialFaceMaterialProfileUniforms(
    shader: THREE.WebGLProgramParametersWithUniforms | undefined,
    profile: OfficialMaterialProfile,
): void {
    if (!shader) return
    const face = profile.face
    const set = (name: string, value: number) => {
        if (shader.uniforms[name]) shader.uniforms[name].value = value
    }
    set('uUseFaceGradient', face.useGradientMap ? 1 : 0)
    set('uOfficialFaceIsEye', face.isEye ? 1 : 0)
    set(
        'uOfficialFaceShouldApplyAdditional',
        face.shouldApplyAdditional ? 1 : 0,
    )
    set('uOfficialFaceHighlightThreshold', face.highlightThreshold)
    set('uOfficialFaceHighlightRotation', face.highlightRotation)
    set('uCheekValue', face.cheekValue)
    const color = shader.uniforms.uOfficialFaceCheekColor?.value
    if (color instanceof THREE.Color) {
        color.setRGB(...face.cheekColor, THREE.LinearSRGBColorSpace)
    }
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
    const initialOfficialProfile = options.materialProfiles?.find(
        profile => profile.face.useGradientMap,
    ) ?? options.materialProfiles?.[0]

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
        hasCharacterPerspective: Boolean(
            options.characterPerspectiveReference,
        ),
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
        shader.uniforms.uOfficialFaceIsEye = { value: 0 };
        shader.uniforms.uOfficialFaceShouldApplyAdditional = { value: 0 };
        shader.uniforms.uOfficialFaceHighlightThreshold = { value: 0.5 };
        shader.uniforms.uOfficialFaceHighlightRotation = { value: 0 };
        shader.uniforms.uOfficialFaceCheekColor = {
            value: new THREE.Color(1, 0.7, 0.7),
        };
        shader.uniforms.uFaceForwardWS = { value: new THREE.Vector3(0, 0, 1) };
        shader.uniforms.uFaceUpWS = { value: new THREE.Vector3(0, 1, 0) };
        shader.uniforms.uFaceRightWS = { value: new THREE.Vector3(1, 0, 0) };
        if (initialOfficialProfile) {
            setOfficialFaceMaterialProfileUniforms(shader, initialOfficialProfile)
        }
        updateFaceDirectionReference()

        shader.vertexShader = /*glsl*/ `
            attribute vec2 uv1;
            varying vec2 vFaceUv;
            varying vec2 vFaceUv2;
            varying vec3 vFaceForwardVS;
            varying vec3 vFaceUpVS;
            varying vec3 vFaceRightVS;
            varying vec3 vFaceSelfShadowNormalVS;
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
        ).replace(
            '#include <defaultnormal_vertex>',
            /*glsl*/ `
            #include <defaultnormal_vertex>
            vFaceSelfShadowNormalVS = normalize(transformedNormal);
            `
        );

        shader.fragmentShader = /*glsl*/ `
            varying vec2 vFaceUv;
            varying vec2 vFaceUv2;
            varying vec3 vFaceForwardVS;
            varying vec3 vFaceUpVS;
            varying vec3 vFaceRightVS;
            varying vec3 vFaceSelfShadowNormalVS;

            uniform sampler2D tShadow;
            uniform sampler2D tFaceGradient;
            uniform sampler2D tNoseGradient;
            uniform sampler2D tEyehighlight;
            uniform float uUseFaceGradient;
            uniform float uFaceGradientYOffset;
            uniform float uNoseGradientYOffset;
            uniform float uCheekValue;
            uniform float uOfficialFaceIsEye;
            uniform float uOfficialFaceShouldApplyAdditional;
            uniform float uOfficialFaceHighlightThreshold;
            uniform float uOfficialFaceHighlightRotation;
            uniform vec3 uOfficialFaceCheekColor;
            ${shader.fragmentShader}
        `.replace(
            '#include <map_fragment>',
            /*glsl*/ `
            vec4 faceColor = texture2D(map, vFaceUv);
            vec4 faceShadow = texture2D(tShadow, vFaceUv);
            vec4 eyehighlight = texture2D(tEyehighlight, vFaceUv2);

            vec3 rdFacePhysicalLightVS = normalize(vec3(-0.35, 0.72, 0.60));
            #if NUM_DIR_LIGHTS > 0
                rdFacePhysicalLightVS = normalize(directionalLights[0].direction);
            #endif
            // SetGlobalShaderParams applies the same character-light direction
            // to FaceGradient as to Body/Hair.  Keeping Face on the physical
            // stage light alone made every overridden scene appear backlit.
            vec3 rdFaceLightVS = normalize(mix(
                rdFacePhysicalLightVS,
                uGlobalCharacterLightingOverrideDirection,
                step(
                    0.5,
                    uGlobalCharacterLightingOverrideDirectionEnabled
                )
            ));

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
            float rdGradientFaceLight = smoothstep(
                rdFaceThreshold - 0.01,
                rdFaceThreshold,
                rdCombinedGradient
            );
            float rdMaskNdotL = dot(
                rdFaceLightVS,
                normalize(vFaceSelfShadowNormalVS)
            );
            float rdMaskFaceLight = smoothstep(
                0.0,
                1.0,
                clamp(rdMaskNdotL + 1.0, 0.0, 1.0)
            );
            float rdCombinedFaceLight = mix(
                rdMaskFaceLight,
                rdGradientFaceLight,
                saturate(uUseFaceGradient)
            );
            rdCombinedFaceLight *= rdToonSelfShadowVisibility(
                vRdToonWorldPosition,
                vFaceSelfShadowNormalVS
            );

            faceColor.rgb = mix(
                faceShadow.rgb * uGlobalCharacterShadowTint,
                faceColor.rgb,
                rdCombinedFaceLight
            );

            diffuseColor = faceColor;
            `
        ).replace(
            '#include <opaque_fragment>',
            /*glsl*/ `
            // JP ReDriveToon face pass evaluates SH with the animated Head
            // forward direction, not the polygon normal. Apply the scene-volume
            // lighting override before subsequent material additions.
            vec3 rdFaceForwardNormalVS = normalize(vFaceForwardVS);
            vec3 rdFaceAmbient = getAmbientLightIrradiance(ambientLightColor);
            #if defined(USE_LIGHT_PROBES)
                rdFaceAmbient += getLightProbeIrradiance(
                    lightProbe,
                    rdFaceForwardNormalVS
                );
            #endif
            #if NUM_HEMI_LIGHTS > 0
                #pragma unroll_loop_start
                for (int i = 0; i < NUM_HEMI_LIGHTS; i++) {
                    rdFaceAmbient += getHemisphereLightIrradiance(
                        hemisphereLights[i],
                        rdFaceForwardNormalVS
                    );
                }
                #pragma unroll_loop_end
            #endif
            vec3 rdFaceMainLightColor = vec3(0.0);
            #if NUM_DIR_LIGHTS > 0
                // Stage directional lights are multiplied by PI so Three's
                // Lambert branch receives Unity radiance after RECIPROCAL_PI.
                // This face carrier bypasses Lambert, matching ReDriveToon's
                // direct _MainLightColor use, so undo that transport scaling.
                rdFaceMainLightColor =
                    directionalLights[0].color * RECIPROCAL_PI;
            #endif
            vec3 rdFaceSceneLightRaw = clamp(
                max(rdFaceAmbient, vec3(0.0)) + rdFaceMainLightColor,
                vec3(0.0),
                vec3(1.0)
            );
            vec3 rdFaceSceneLightColor = max(
                mix(
                    rdFaceSceneLightRaw,
                    uGlobalCharacterLightingOverrideColor,
                    saturate(uGlobalCharacterLightingOverrideRatio)
                ),
                vec3(0.1)
            );
            outgoingLight =
                diffuseColor.rgb * rdFaceSceneLightColor +
                totalEmissiveRadiance;

            // _ISEYE is a separate queue-2001 geometry pass. The compiled
            // ReDriveToon program applies its highlight after scene lighting;
            // it is not a hand-tuned brightening of the main face material.
            vec2 rdFaceAdditionalUv = vFaceUv2;
            if (uOfficialFaceHighlightRotation != 0.0) {
                vec2 rdEyeCenter = vFaceUv2.x <= 0.5
                    ? vec2(0.25, 0.25)
                    : vec2(0.75, 0.25);
                vec2 rdEyeLocal = vFaceUv2 - rdEyeCenter;
                float rdEyeAngle =
                    uOfficialFaceHighlightRotation * 6.28318530718;
                float rdEyeSin = sin(rdEyeAngle);
                float rdEyeCos = cos(rdEyeAngle);
                rdFaceAdditionalUv = rdEyeCenter + vec2(
                    dot(rdEyeLocal, vec2(rdEyeCos, rdEyeSin)),
                    dot(rdEyeLocal.yx, vec2(rdEyeCos, -rdEyeSin))
                );
            }
            float rdEyeAdditional = texture2D(
                tEyehighlight,
                rdFaceAdditionalUv
            ).r;
            float rdEyeHighlight = smoothstep(
                uOfficialFaceHighlightThreshold,
                uOfficialFaceHighlightThreshold + 0.05,
                rdEyeAdditional
            );
            vec3 rdFaceHighlightCarrier =
                min(rdFaceSceneLightColor * 2.0, vec3(1.0)) * 1.5;
            outgoingLight += rdFaceHighlightCarrier * rdEyeHighlight
                * saturate(uOfficialFaceIsEye);

            if (uOfficialFaceShouldApplyAdditional != 0.0) {
                float rdFaceAdditional = texture2D(
                    tEyehighlight,
                    vFaceUv2
                ).r;
                float rdCheekMask = step(0.5, vFaceUv2.y);
                float rdCheekBlend =
                    rdFaceAdditional * rdCheekMask * uCheekValue;
                outgoingLight = mix(
                    outgoingLight,
                    outgoingLight * uOfficialFaceCheekColor,
                    rdCheekBlend
                );
                float rdFaceHighlight = smoothstep(
                    uOfficialFaceHighlightThreshold,
                    uOfficialFaceHighlightThreshold + 0.05,
                    rdFaceAdditional * (1.0 - rdCheekMask)
                );
                outgoingLight += rdFaceHighlightCarrier * rdFaceHighlight;
            }

            #include <opaque_fragment>
            `
        );

        injectCharacterPerspectiveCancellation(
            shader,
            options.characterPerspectiveReference,
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
        shadowTex,
        updateFaceDirectionReference: options.faceReference
            ? updateFaceDirectionReference
            : undefined,
    };
}
