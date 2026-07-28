import * as THREE from 'three';
import {
    createGeneralMaterial,
    diffuseColorManipulationEndFlag,
    MaterialUserData,
    type MaterialCreationOptions,
    type MaterialCreationResult,
} from '.';
import type { AngelRingReference } from '../renderProfile';
import { loadTexture } from '../texture';
import AngelRingMap from './RDToon_AngelRingMap.png'

export interface AngelRingOptions {
    enabled: boolean;
    color: string;
    strength: number;
    /** Compresses the view-space normal projection toward the texture centre. */
    offsetU: number;
    /** Official vertical blend: 0 = authored UV3, 1 = view-space normal Y. */
    offsetV: number;
    /** Fine vertical movement after the official UV blend. */
    verticalOffset: number;
    /** Small Head-plane correction; UV3 remains the primary vertical coordinate. */
    headVInfluence: number;
    /** Texture-space filtering distance. */
    softness: number;
    /** Fade the strip when the camera moves behind the character. */
    frontFadeStart: number;
    frontFadeEnd: number;
    /** Remaps the authored texture without changing its silhouette. */
    mapGamma: number;
    /** Additive component required for the official bright strip/bloom response. */
    emission: number;
}

export const angelRingOptions: AngelRingOptions = {
    enabled: true,
    color: '#fff6fa',
    strength: 0.96,
    offsetU: 0.10,
    offsetV: 0.30,
    verticalOffset: 0.0,
    headVInfluence: 0.12,
    softness: 0.006,
    frontFadeStart: -0.08,
    frontFadeEnd: 0.28,
    mapGamma: 0.72,
    emission: 0.72,
}

export const officialAngelRingPreset = {
    ...angelRingOptions,
}

export function resetOfficialAngelRingPreset() {
    Object.assign(angelRingOptions, officialAngelRingPreset)
}

export interface HairMaterialCreationOptions extends MaterialCreationOptions {
    /** Animated Head reference used only for vertical correction and front/back gating. */
    angelRingReference?: AngelRingReference;
    /** FBX LayerElementUV[1] (export name UV3) is available as Three.js `uv1`. */
    angelRingHasUv1?: boolean;
    /** Exedra UV3 normally occupies -1..1 and must be remapped to 0..1. */
    angelRingUv1Signed?: boolean;
}

export interface HairMaterialCreationResult extends MaterialCreationResult {
    updateAngelRingReference?: () => void;
}

function setColorUniform(
    shader: THREE.WebGLProgramParametersWithUniforms,
    key: string,
    value: THREE.ColorRepresentation,
) {
    const current = shader.uniforms[key]?.value;
    if (current instanceof THREE.Color) {
        current.set(value);
    } else {
        shader.uniforms[key] = { value: new THREE.Color(value) };
    }
}

export function loadAngelRingOptions(
    shader: THREE.WebGLProgramParametersWithUniforms,
) {
    shader.uniforms.uAngelRingEnabled ??= { value: 0 };
    shader.uniforms.uAngelRingStrength ??= { value: 0 };
    shader.uniforms.uAngelRingOffsetU ??= { value: 0.1 };
    shader.uniforms.uAngelRingOffsetV ??= { value: 0.3 };
    shader.uniforms.uAngelRingVerticalOffset ??= { value: 0 };
    shader.uniforms.uAngelRingHeadVInfluence ??= { value: 0.12 };
    shader.uniforms.uAngelRingSoftness ??= { value: 0.006 };
    shader.uniforms.uAngelRingFrontFadeStart ??= { value: -0.08 };
    shader.uniforms.uAngelRingFrontFadeEnd ??= { value: 0.28 };
    shader.uniforms.uAngelRingMapGamma ??= { value: 0.72 };
    shader.uniforms.uAngelRingEmission ??= { value: 0.72 };

    shader.uniforms.uAngelRingEnabled.value = angelRingOptions.enabled ? 1 : 0;
    shader.uniforms.uAngelRingStrength.value = angelRingOptions.strength;
    shader.uniforms.uAngelRingOffsetU.value = angelRingOptions.offsetU;
    shader.uniforms.uAngelRingOffsetV.value = angelRingOptions.offsetV;
    shader.uniforms.uAngelRingVerticalOffset.value = angelRingOptions.verticalOffset;
    shader.uniforms.uAngelRingHeadVInfluence.value = angelRingOptions.headVInfluence;
    shader.uniforms.uAngelRingSoftness.value = angelRingOptions.softness;
    shader.uniforms.uAngelRingFrontFadeStart.value = angelRingOptions.frontFadeStart;
    shader.uniforms.uAngelRingFrontFadeEnd.value = angelRingOptions.frontFadeEnd;
    shader.uniforms.uAngelRingMapGamma.value = angelRingOptions.mapGamma;
    shader.uniforms.uAngelRingEmission.value = angelRingOptions.emission;
    setColorUniform(shader, 'uAngelRingColor', angelRingOptions.color);
}

/**
 * ReDriveToon AngelRing reconstruction.
 *
 * The previous implementation treated the map as a world-position decal. That
 * produced a flat rectangle on rear hair and disconnected ponytail patches.
 * Exedra FBXs contain an authored second UV set (`UV3`, imported by Three as
 * `uv1`). Official shaders from the same AngelRing convention project the
 * view-space normal into UV and blend its vertical coordinate with this authored
 * UV. This implementation follows that convention exactly, while retaining the
 * recovered Exedra Head/headOffset data only as a small vertical correction and
 * a character-level front/back visibility gate.
 */
export async function createHairMaterial(
    options: HairMaterialCreationOptions,
): Promise<HairMaterialCreationResult> {
    const angelRingTex = await loadTexture(
        AngelRingMap,
        { colorSpace: THREE.NoColorSpace },
    )
    angelRingTex.wrapS = THREE.ClampToEdgeWrapping
    angelRingTex.wrapT = THREE.ClampToEdgeWrapping
    angelRingTex.minFilter = THREE.LinearFilter
    angelRingTex.magFilter = THREE.LinearFilter

    const reference = options.angelRingReference
    let compiledShader: THREE.WebGLProgramParametersWithUniforms | undefined

    const headPosition = new THREE.Vector3()
    const headQuaternion = new THREE.Quaternion()
    const planePosition = new THREE.Vector3()
    const planeUp = new THREE.Vector3(0, 1, 0)
    const planeForward = new THREE.Vector3(0, 0, 1)

    const updateAngelRingReference = () => {
        if (!compiledShader || !reference) return
        reference.headBone.updateWorldMatrix(true, false)
        reference.headBone.getWorldPosition(headPosition)
        reference.headBone.getWorldQuaternion(headQuaternion)
        planeUp.copy(reference.localUp).applyQuaternion(headQuaternion).normalize()
        planeForward.copy(reference.localForward).applyQuaternion(headQuaternion).normalize()
        planePosition.copy(headPosition).addScaledVector(planeUp, reference.headOffset)

        compiledShader.uniforms.uAngelRingPlanePosition.value.copy(planePosition)
        compiledShader.uniforms.uAngelRingPlaneUp.value.copy(planeUp)
        compiledShader.uniforms.uAngelRingFaceForward.value.copy(planeForward)
        compiledShader.uniforms.uAngelRingBandHalfWidth.value = reference.bandHalfWidth
        compiledShader.uniforms.uAngelRingUvMode.value = reference.uvMode ? 1 : 0
    }

    const result = await createGeneralMaterial({
        ...options,
        onBeforeCompile(shader) {
            compiledShader = shader
            shader.uniforms.tAngelRing = { value: angelRingTex }
            shader.uniforms.uAngelRingUseHeadPlane = { value: reference ? 1 : 0 }
            shader.uniforms.uAngelRingPlanePosition = { value: new THREE.Vector3() }
            shader.uniforms.uAngelRingPlaneUp = { value: new THREE.Vector3(0, 1, 0) }
            shader.uniforms.uAngelRingFaceForward = { value: new THREE.Vector3(0, 0, 1) }
            shader.uniforms.uAngelRingBandHalfWidth = { value: reference?.bandHalfWidth ?? 0.045 }
            shader.uniforms.uAngelRingUvMode = { value: reference?.uvMode ? 1 : 0 }
            shader.uniforms.uAngelRingHasUv1 = { value: options.angelRingHasUv1 ? 1 : 0 }
            shader.uniforms.uAngelRingUv1Signed = { value: options.angelRingUv1Signed ? 1 : 0 }
            loadAngelRingOptions(shader)
            updateAngelRingReference()

            shader.vertexShader = /* glsl */ `
                attribute vec2 uv1;
                varying vec2 vAngelRingUv1;
                varying float vAngelRingPlaneDistance;
                varying float vAngelRingCharacterFacing;
                uniform vec3 uAngelRingPlanePosition;
                uniform vec3 uAngelRingPlaneUp;
                uniform vec3 uAngelRingFaceForward;
                ${shader.vertexShader}
            `.replace(
                '#include <project_vertex>',
                /* glsl */ `
                #include <project_vertex>
                vAngelRingUv1 = uv1;
                vec3 rdAngelWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
                vAngelRingPlaneDistance = dot(
                    rdAngelWorldPosition - uAngelRingPlanePosition,
                    normalize(uAngelRingPlaneUp)
                );
                vec3 rdAngelHeadToCamera = normalize(cameraPosition - uAngelRingPlanePosition);
                vAngelRingCharacterFacing = dot(
                    normalize(uAngelRingFaceForward),
                    rdAngelHeadToCamera
                );
                `
            )

            shader.fragmentShader = /* glsl */ `
                varying vec2 vAngelRingUv1;
                varying float vAngelRingPlaneDistance;
                varying float vAngelRingCharacterFacing;
                uniform sampler2D tAngelRing;
                uniform float uAngelRingEnabled;
                uniform vec3 uAngelRingColor;
                uniform float uAngelRingStrength;
                uniform float uAngelRingOffsetU;
                uniform float uAngelRingOffsetV;
                uniform float uAngelRingVerticalOffset;
                uniform float uAngelRingHeadVInfluence;
                uniform float uAngelRingSoftness;
                uniform float uAngelRingFrontFadeStart;
                uniform float uAngelRingFrontFadeEnd;
                uniform float uAngelRingMapGamma;
                uniform float uAngelRingEmission;
                uniform float uAngelRingUseHeadPlane;
                uniform float uAngelRingBandHalfWidth;
                uniform float uAngelRingUvMode;
                uniform float uAngelRingHasUv1;
                uniform float uAngelRingUv1Signed;
                ${shader.fragmentShader}
            `.replace(
                diffuseColorManipulationEndFlag,
                /* glsl */ `
                // Official convention: view-space normal XY supplies the map
                // projection; the authored FBX UV3 controls its vertical shape.
                vec3 rdAngelNormalVs = normalize(normal);
                vec2 rdAngelNormalUv = mix(
                    rdAngelNormalVs,
                    vec3(0.0, 0.0, 1.0),
                    saturate(uAngelRingOffsetU)
                ).xy * 0.5 + 0.5;

                vec2 rdAngelUv1Unsigned = mix(
                    vAngelRingUv1,
                    vAngelRingUv1 * 0.5 + 0.5,
                    saturate(uAngelRingUv1Signed)
                );
                rdAngelUv1Unsigned = clamp(rdAngelUv1Unsigned, 0.0, 1.0);

                float rdAngelPlaneV = 0.5 +
                    vAngelRingPlaneDistance /
                    max(uAngelRingBandHalfWidth * 6.0, 0.001);
                float rdAngelAuthoredV = mix(
                    rdAngelNormalUv.y,
                    rdAngelUv1Unsigned.y,
                    saturate(uAngelRingHasUv1)
                );
                rdAngelAuthoredV = mix(
                    rdAngelAuthoredV,
                    rdAngelPlaneV,
                    saturate(uAngelRingHeadVInfluence) *
                    saturate(uAngelRingUseHeadPlane)
                );

                vec2 rdAngelHybridUv = rdAngelNormalUv;
                rdAngelHybridUv.y = mix(
                    rdAngelAuthoredV,
                    rdAngelNormalUv.y,
                    saturate(uAngelRingOffsetV)
                );
                rdAngelHybridUv.y += uAngelRingVerticalOffset;

                // `_YuugenHighlight` / IsHairUVAngelRing uses the complete
                // authored UV3; ordinary hair uses normal X + blended UV3 Y.
                vec2 rdAngelUv = mix(
                    rdAngelHybridUv,
                    rdAngelUv1Unsigned,
                    saturate(uAngelRingUvMode * uAngelRingHasUv1)
                );
                rdAngelUv = clamp(rdAngelUv, 0.0, 1.0);

                float rdAngelFilter = max(uAngelRingSoftness, 0.00025);
                float rdAngelMap =
                    texture2D(tAngelRing, rdAngelUv).r * 0.50 +
                    texture2D(tAngelRing, rdAngelUv + vec2(0.0, rdAngelFilter)).r * 0.25 +
                    texture2D(tAngelRing, rdAngelUv - vec2(0.0, rdAngelFilter)).r * 0.25;
                rdAngelMap = pow(
                    saturate(rdAngelMap),
                    max(uAngelRingMapGamma, 0.05)
                );

                // A single character-level gate prevents the front strip from
                // turning into a large white rectangle when the camera is behind.
                float rdAngelFrontGate = mix(
                    1.0,
                    smoothstep(
                        uAngelRingFrontFadeStart,
                        max(uAngelRingFrontFadeEnd, uAngelRingFrontFadeStart + 0.001),
                        vAngelRingCharacterFacing
                    ),
                    saturate(uAngelRingUseHeadPlane)
                );
                float rdAngelAmount =
                    rdAngelMap *
                    rdAngelFrontGate *
                    uAngelRingEnabled *
                    uAngelRingStrength;

                // Official hair adds AngelRing before the toon-ramp result. The
                // additive term intentionally exceeds 1.0 so scene bloom can form
                // the broad soft strip visible in official battle close-ups.
                diffuseColor.rgb +=
                    uAngelRingColor * rdAngelAmount * uAngelRingEmission;
                diffuseColor.rgb = mix(
                    diffuseColor.rgb,
                    max(diffuseColor.rgb, uAngelRingColor),
                    saturate(rdAngelAmount * 0.42)
                );

                ${diffuseColorManipulationEndFlag}
                `
            )
        },
    })

    result.textures.push(angelRingTex)
    return {
        ...result,
        updateAngelRingReference: reference ? updateAngelRingReference : undefined,
    }
}

export function getMeshAngelRingShaders(
    mesh: THREE.Mesh,
): THREE.WebGLProgramParametersWithUniforms[] {
    return (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        .map(material => material?.userData)
        .filter(userData => userData instanceof MaterialUserData)
        .map(userData => userData.shader)
        .filter(
            (shader): shader is THREE.WebGLProgramParametersWithUniforms =>
                Boolean(shader?.uniforms.uAngelRingEnabled),
        )
}
