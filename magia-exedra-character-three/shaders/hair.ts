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
    /** Multiplies the per-character world-space front-band half width; 0.1 is 1x. */
    width: number;
    /** Vertical filtering applied to the authored wedge map. */
    softness: number;
    /** Tilts the band across the character-local right axis. */
    tilt: number;
    /** Controls how strongly the highlight is restricted to the facial hemisphere. */
    viewPower: number;
    textureInfluence: number;
}

export const angelRingOptions: AngelRingOptions = {
    enabled: true,
    color: '#fff8fb',
    strength: 1.10,
    center: 0.50,
    width: 0.10,
    softness: 0.020,
    tilt: 0.035,
    viewPower: 0.55,
    textureInfluence: 1.0,
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
    shader.uniforms.uAngelRingSoftness ??= { value: 0.02 };
    shader.uniforms.uAngelRingTilt ??= { value: 0 };
    shader.uniforms.uAngelRingViewPower ??= { value: 0.55 };
    shader.uniforms.uAngelRingTextureInfluence ??= { value: 1 };

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
 * The shipped 512x512 map is not a square decal. It is a horizontal wedge:
 * approximately 66 px high at U=0, tapering to zero near U=0.64. The correct
 * coordinates are therefore:
 *
 * - U: angular distance around the Head from front (0) to back (1);
 * - V: signed distance above/below Head.position + faceUp * headOffset.
 *
 * The previous implementation used right/forward position directly as UV. That
 * produced a square on the rear hair and thin vertical edge streaks. This port
 * uses the animated Head axes every frame, gives the map its intended front-to-
 * side taper, and naturally suppresses the rear hemisphere.
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
    const planeForward = new THREE.Vector3(0, 0, -1)

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
            shader.uniforms.uAngelRingPlaneForward = { value: new THREE.Vector3(0, 0, -1) }
            shader.uniforms.uAngelRingBandHalfWidth = { value: reference?.bandHalfWidth ?? 0.055 }
            shader.uniforms.uAngelRingProjectionRadius = { value: reference?.projectionRadius ?? 0.35 }
            shader.uniforms.uAngelRingUvMode = { value: reference?.uvMode ? 1 : 0 }
            loadAngelRingOptions(shader)
            updateAngelRingReference()

            shader.vertexShader = /* glsl */ `
                varying float vAngelRingHeight;
                varying float vAngelRingPlaneDistance;
                varying float vAngelRingFrontness;
                varying float vAngelRingSide;
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
                float rdAngelSide = dot(rdAngelWorldDelta, normalize(uAngelRingPlaneRight));
                float rdAngelFront = dot(rdAngelWorldDelta, normalize(uAngelRingPlaneForward));
                float rdAngelRadius = max(length(vec2(rdAngelSide, rdAngelFront)), 0.0001);
                vAngelRingFrontness = clamp(rdAngelFront / rdAngelRadius, -1.0, 1.0);
                vAngelRingSide = clamp(
                    rdAngelSide / max(uAngelRingProjectionRadius, 0.0001),
                    -1.5,
                    1.5
                );
                `
            )

            shader.fragmentShader = /* glsl */ `
                varying float vAngelRingHeight;
                varying float vAngelRingPlaneDistance;
                varying float vAngelRingFrontness;
                varying float vAngelRingSide;
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
                // Legacy fallback for unusual exports without a usable Head bone.
                float rdAngelFallbackHeight = mix(
                    vAngelRingHeight,
                    clamp(1.0 - vMapUv.y, 0.0, 1.0),
                    0.55
                );
                float rdAngelFallbackCenter = uAngelRingCenter;
                float rdAngelFallbackDistance = abs(rdAngelFallbackHeight - rdAngelFallbackCenter);
                float rdAngelFallbackBand = 1.0 - smoothstep(
                    max(uAngelRingWidth - uAngelRingSoftness, 0.0),
                    uAngelRingWidth + uAngelRingSoftness,
                    rdAngelFallbackDistance
                );

                float rdAngelWorldWidth = max(
                    uAngelRingBandHalfWidth * max(uAngelRingWidth / 0.10, 0.05),
                    0.001
                );
                float rdAngelCenterShift =
                    (uAngelRingCenter - 0.5) * rdAngelWorldWidth * 3.0 +
                    vAngelRingSide * uAngelRingTilt * rdAngelWorldWidth;
                float rdAngelSignedDistance =
                    vAngelRingPlaneDistance - rdAngelCenterShift;

                // The authored map's front wedge half-height is ~33 / 512.
                // Scale physical Head-space width into that exact map interval.
                float rdAngelMapV = 0.503 +
                    rdAngelSignedDistance * (0.06445 / rdAngelWorldWidth);
                float rdAngelMapU = clamp(
                    (1.0 - vAngelRingFrontness) * 0.5,
                    0.0,
                    1.0
                );
                vec2 rdAngelHeadUv = vec2(rdAngelMapU, rdAngelMapV);
                vec2 rdAngelHairUv = vec2(vMapUv.x, 1.0 - vMapUv.y);
                vec2 rdAngelOfficialUv = mix(
                    rdAngelHeadUv,
                    rdAngelHairUv,
                    saturate(uAngelRingUvMode)
                );

                float rdAngelFilter = max(uAngelRingSoftness * 0.12, 0.0005);
                float rdAngelMap = (
                    texture2D(tAngelRing, rdAngelOfficialUv).r * 0.50 +
                    texture2D(tAngelRing, rdAngelOfficialUv + vec2(0.0, rdAngelFilter)).r * 0.25 +
                    texture2D(tAngelRing, rdAngelOfficialUv - vec2(0.0, rdAngelFilter)).r * 0.25
                );

                // Suppress rear hair independently of texture filtering. Front is
                // 1, side tapers smoothly, back is 0.
                float rdAngelFrontGate = pow(
                    smoothstep(-0.18, 0.42, vAngelRingFrontness),
                    max(uAngelRingViewPower, 0.05)
                );
                float rdAngelHeadMask =
                    rdAngelMap *
                    rdAngelFrontGate *
                    uAngelRingEnabled;
                float rdAngelMask = mix(
                    rdAngelFallbackBand,
                    rdAngelHeadMask,
                    saturate(uAngelRingUseHeadPlane)
                );
                rdAngelMask *= mix(
                    1.0,
                    rdAngelMap,
                    saturate(uAngelRingTextureInfluence) *
                    saturate(uAngelRingUseHeadPlane)
                );

                float rdAngelAmount = saturate(rdAngelMask * uAngelRingStrength);
                vec3 rdAngelTarget = mix(
                    max(diffuseColor.rgb, uAngelRingColor * 0.90),
                    uAngelRingColor,
                    0.82
                );
                diffuseColor.rgb = mix(
                    diffuseColor.rgb,
                    rdAngelTarget,
                    rdAngelAmount
                );
                // The official strip has a mild emissive component and remains
                // readable under dark scene lighting.
                diffuseColor.rgb += uAngelRingColor * rdAngelAmount * 0.12;

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
