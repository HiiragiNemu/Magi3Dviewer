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
    /** Fine vertical shift; 0.5 means the serialized/estimated Head plane. */
    center: number;
    /** Multiplies the per-character world-space band width; 0.1 is 1x. */
    width: number;
    /** World-band edge softness relative to the default 0.1 control value. */
    softness: number;
    tilt: number;
    viewPower: number;
    textureInfluence: number;
}

export const angelRingOptions: AngelRingOptions = {
    enabled: true,
    color: '#fff2f7',
    strength: 0.78,
    center: 0.50,
    width: 0.10,
    softness: 0.035,
    tilt: 0.10,
    viewPower: 0.80,
    textureInfluence: 0.90,
}

export const officialAngelRingPreset = {
    ...angelRingOptions,
}

export function resetOfficialAngelRingPreset() {
    Object.assign(angelRingOptions, officialAngelRingPreset)
}

export interface HairMaterialCreationOptions extends MaterialCreationOptions {
    /** Official coordinate model: Head position + faceUp * headOffset. */
    angelRingReference?: AngelRingReference;
    /** Legacy fallback only when no usable Head bone exists. */
    angelRingMinY?: number;
    angelRingMaxY?: number;
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
    shader.uniforms.uAngelRingCenter ??= { value: 0.5 };
    shader.uniforms.uAngelRingWidth ??= { value: 0.1 };
    shader.uniforms.uAngelRingSoftness ??= { value: 0.035 };
    shader.uniforms.uAngelRingTilt ??= { value: 0 };
    shader.uniforms.uAngelRingViewPower ??= { value: 0 };
    shader.uniforms.uAngelRingTextureInfluence ??= { value: 0 };

    shader.uniforms.uAngelRingEnabled.value = angelRingOptions.enabled ? 1 : 0;
    shader.uniforms.uAngelRingStrength.value = angelRingOptions.strength;
    shader.uniforms.uAngelRingCenter.value = angelRingOptions.center;
    shader.uniforms.uAngelRingWidth.value = angelRingOptions.width;
    shader.uniforms.uAngelRingSoftness.value = angelRingOptions.softness;
    shader.uniforms.uAngelRingTilt.value = angelRingOptions.tilt;
    shader.uniforms.uAngelRingViewPower.value = angelRingOptions.viewPower;
    shader.uniforms.uAngelRingTextureInfluence.value = angelRingOptions.textureInfluence;
    setColorUniform(shader, 'uAngelRingColor', angelRingOptions.color);
}

/**
 * ReDriveToon AngelRing reconstruction.
 *
 * Native evidence shows the reference point is character-local:
 * `Head.position + faceUpDirectionWs * headOffset`. The previous normalized
 * model-height/UV band ignored the animated Head transform and could disappear
 * or drift between characters. This implementation projects skinned hair into
 * the animated Head plane, samples the official AngelRing map in face-local
 * right/forward coordinates and retains the UV mode exposed by
 * `_YuugenHighlight` when an exported profile enables it.
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

    const minY = options.angelRingMinY ?? 0
    const maxY = options.angelRingMaxY ?? 2.2
    const safeMaxY = Math.abs(maxY - minY) > 0.0001 ? maxY : minY + 1
    const reference = options.angelRingReference
    let compiledShader: THREE.WebGLProgramParametersWithUniforms | undefined

    const headPosition = new THREE.Vector3()
    const headQuaternion = new THREE.Quaternion()
    const planePosition = new THREE.Vector3()
    const planeUp = new THREE.Vector3(0, 1, 0)
    const planeRight = new THREE.Vector3(1, 0, 0)
    const planeForward = new THREE.Vector3(0, 0, 1)

    const updateAngelRingReference = () => {
        if (!compiledShader || !reference) return
        reference.headBone.updateWorldMatrix(true, false)
        reference.headBone.getWorldPosition(headPosition)
        reference.headBone.getWorldQuaternion(headQuaternion)
        planeUp.copy(reference.localUp).applyQuaternion(headQuaternion).normalize()
        planeRight.copy(reference.localRight).applyQuaternion(headQuaternion).normalize()
        planeForward.copy(reference.localForward).applyQuaternion(headQuaternion).normalize()
        planePosition.copy(headPosition).addScaledVector(planeUp, reference.headOffset)

        compiledShader.uniforms.uAngelRingPlanePosition.value.copy(planePosition)
        compiledShader.uniforms.uAngelRingPlaneUp.value.copy(planeUp)
        compiledShader.uniforms.uAngelRingPlaneRight.value.copy(planeRight)
        compiledShader.uniforms.uAngelRingPlaneForward.value.copy(planeForward)
        compiledShader.uniforms.uAngelRingBandHalfWidth.value = reference.bandHalfWidth
        compiledShader.uniforms.uAngelRingProjectionRadius.value = reference.projectionRadius
        compiledShader.uniforms.uAngelRingUvMode.value = reference.uvMode ? 1 : 0
    }

    const result = await createGeneralMaterial({
        ...options,
        onBeforeCompile(shader) {
            compiledShader = shader
            shader.uniforms.tAngelRing = { value: angelRingTex }
            shader.uniforms.uAngelRingMinY = { value: minY }
            shader.uniforms.uAngelRingMaxY = { value: safeMaxY }
            shader.uniforms.uAngelRingUseHeadPlane = { value: reference ? 1 : 0 }
            shader.uniforms.uAngelRingPlanePosition = { value: new THREE.Vector3() }
            shader.uniforms.uAngelRingPlaneUp = { value: new THREE.Vector3(0, 1, 0) }
            shader.uniforms.uAngelRingPlaneRight = { value: new THREE.Vector3(1, 0, 0) }
            shader.uniforms.uAngelRingPlaneForward = { value: new THREE.Vector3(0, 0, 1) }
            shader.uniforms.uAngelRingBandHalfWidth = { value: reference?.bandHalfWidth ?? 0.035 }
            shader.uniforms.uAngelRingProjectionRadius = { value: reference?.projectionRadius ?? 0.35 }
            shader.uniforms.uAngelRingUvMode = { value: reference?.uvMode ? 1 : 0 }
            loadAngelRingOptions(shader)
            updateAngelRingReference()

            shader.vertexShader = /* glsl */ `
                varying float vAngelRingHeight;
                varying float vAngelRingPlaneDistance;
                varying vec2 vAngelRingPlaneUv;
                uniform float uAngelRingMinY;
                uniform float uAngelRingMaxY;
                uniform vec3 uAngelRingPlanePosition;
                uniform vec3 uAngelRingPlaneUp;
                uniform vec3 uAngelRingPlaneRight;
                uniform vec3 uAngelRingPlaneForward;
                uniform float uAngelRingProjectionRadius;
                ${shader.vertexShader}
            `.replace(
                '#include <project_vertex>',
                /* glsl */ `
                #include <project_vertex>
                vAngelRingHeight = clamp(
                    (transformed.y - uAngelRingMinY) /
                    max(uAngelRingMaxY - uAngelRingMinY, 0.0001),
                    0.0,
                    1.0
                );
                vec3 rdAngelWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
                vec3 rdAngelWorldDelta = rdAngelWorldPosition - uAngelRingPlanePosition;
                vAngelRingPlaneDistance = dot(rdAngelWorldDelta, normalize(uAngelRingPlaneUp));
                vAngelRingPlaneUv = vec2(
                    dot(rdAngelWorldDelta, normalize(uAngelRingPlaneRight)),
                    dot(rdAngelWorldDelta, normalize(uAngelRingPlaneForward))
                ) / max(uAngelRingProjectionRadius * 2.0, 0.0001) + 0.5;
                `
            )

            shader.fragmentShader = /* glsl */ `
                varying float vAngelRingHeight;
                varying float vAngelRingPlaneDistance;
                varying vec2 vAngelRingPlaneUv;
                uniform sampler2D tAngelRing;
                uniform float uAngelRingEnabled;
                uniform vec3 uAngelRingColor;
                uniform float uAngelRingStrength;
                uniform float uAngelRingCenter;
                uniform float uAngelRingWidth;
                uniform float uAngelRingSoftness;
                uniform float uAngelRingTilt;
                uniform float uAngelRingViewPower;
                uniform float uAngelRingTextureInfluence;
                uniform float uAngelRingUseHeadPlane;
                uniform float uAngelRingBandHalfWidth;
                uniform float uAngelRingUvMode;
                ${shader.fragmentShader}
            `.replace(
                diffuseColorManipulationEndFlag,
                /* glsl */ `
                float rdAngelFallbackHeight = mix(
                    vAngelRingHeight,
                    clamp(1.0 - vMapUv.y, 0.0, 1.0),
                    0.55
                );
                float rdAngelFallbackCenter = uAngelRingCenter + normal.x * uAngelRingTilt * 0.16;
                float rdAngelFallbackDistance = abs(rdAngelFallbackHeight - rdAngelFallbackCenter);
                float rdAngelFallbackInner = max(uAngelRingWidth - uAngelRingSoftness, 0.0);
                float rdAngelFallbackOuter = max(
                    rdAngelFallbackInner + 0.0001,
                    uAngelRingWidth + uAngelRingSoftness
                );
                float rdAngelFallbackBand = 1.0 - smoothstep(
                    rdAngelFallbackInner,
                    rdAngelFallbackOuter,
                    rdAngelFallbackDistance
                );
                vec2 rdAngelFallbackUv = vec2(
                    clamp(normal.x * 0.5 + 0.5, 0.0, 1.0),
                    clamp(
                        0.5 + (rdAngelFallbackHeight - rdAngelFallbackCenter) /
                        max(uAngelRingWidth * 2.0, 0.0001),
                        0.0,
                        1.0
                    )
                );

                float rdAngelWorldWidth = max(
                    uAngelRingBandHalfWidth * max(uAngelRingWidth / 0.10, 0.05),
                    0.001
                );
                float rdAngelWorldSoftness = max(
                    uAngelRingBandHalfWidth * max(uAngelRingSoftness / 0.10, 0.02),
                    0.0005
                );
                float rdAngelWorldCenterShift =
                    (uAngelRingCenter - 0.5) * rdAngelWorldWidth * 2.0 +
                    (vAngelRingPlaneUv.x - 0.5) * uAngelRingTilt * rdAngelWorldWidth;
                float rdAngelWorldDistance = abs(
                    vAngelRingPlaneDistance - rdAngelWorldCenterShift
                );
                float rdAngelWorldBand = 1.0 - smoothstep(
                    max(rdAngelWorldWidth - rdAngelWorldSoftness, 0.0),
                    rdAngelWorldWidth + rdAngelWorldSoftness,
                    rdAngelWorldDistance
                );

                vec2 rdAngelProjectedUv = clamp(vAngelRingPlaneUv, 0.0, 1.0);
                vec2 rdAngelHairUv = vec2(vMapUv.x, 1.0 - vMapUv.y);
                vec2 rdAngelOfficialUv = mix(
                    rdAngelProjectedUv,
                    rdAngelHairUv,
                    saturate(uAngelRingUvMode)
                );
                float rdAngelProjectedMap = texture2D(tAngelRing, rdAngelOfficialUv).r;
                float rdAngelFallbackMap = texture2D(tAngelRing, rdAngelFallbackUv).r;
                float rdAngelBand = mix(
                    rdAngelFallbackBand,
                    rdAngelWorldBand,
                    saturate(uAngelRingUseHeadPlane)
                );
                float rdAngelMap = mix(
                    rdAngelFallbackMap,
                    rdAngelProjectedMap,
                    saturate(uAngelRingUseHeadPlane)
                );

                float rdAngelFacing = pow(
                    saturate(dot(normal, normalize(vViewPosition))),
                    max(uAngelRingViewPower, 0.0001)
                );
                float rdAngelMask =
                    rdAngelBand *
                    mix(1.0, rdAngelMap, saturate(uAngelRingTextureInfluence)) *
                    mix(0.74, 1.0, rdAngelFacing) *
                    uAngelRingEnabled;

                vec3 rdAngelTarget = max(diffuseColor.rgb, uAngelRingColor);
                diffuseColor.rgb = mix(
                    diffuseColor.rgb,
                    rdAngelTarget,
                    saturate(rdAngelMask * uAngelRingStrength)
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
