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
    /** Shapes the front-normal coordinate before it enters the wedge map. */
    offsetU: number;
    /** Scales view-normal Y around the texture centre. */
    offsetV: number;
    /** Fine vertical movement in texture space. */
    verticalOffset: number;
    /** Small correction from Head.position + faceUp * headOffset. */
    headVInfluence: number;
    /** Texture-space vertical filtering distance. */
    softness: number;
    /** Fade the strip when the camera moves behind the character. */
    frontFadeStart: number;
    frontFadeEnd: number;
    mapGamma: number;
    /** Mild additive component; scene bloom supplies the broad action glow. */
    emission: number;
}

export const angelRingOptions: AngelRingOptions = {
    enabled: true,
    color: '#fff7fb',
    strength: 0.88,
    offsetU: 0.34,
    offsetV: 0.30,
    verticalOffset: 0.0,
    headVInfluence: 0.035,
    softness: 0.004,
    frontFadeStart: -0.04,
    frontFadeEnd: 0.30,
    mapGamma: 0.82,
    emission: 0.36,
}

export const officialAngelRingPreset = {
    ...angelRingOptions,
}

export function resetOfficialAngelRingPreset() {
    Object.assign(angelRingOptions, officialAngelRingPreset)
}

export interface HairMaterialCreationOptions extends MaterialCreationOptions {
    /** Animated official reference: Head.position + faceUp * headOffset. */
    angelRingReference?: AngelRingReference;
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
    shader.uniforms.uAngelRingOffsetU ??= { value: 0.34 };
    shader.uniforms.uAngelRingOffsetV ??= { value: 0.30 };
    shader.uniforms.uAngelRingVerticalOffset ??= { value: 0 };
    shader.uniforms.uAngelRingHeadVInfluence ??= { value: 0.035 };
    shader.uniforms.uAngelRingSoftness ??= { value: 0.004 };
    shader.uniforms.uAngelRingFrontFadeStart ??= { value: -0.04 };
    shader.uniforms.uAngelRingFrontFadeEnd ??= { value: 0.30 };
    shader.uniforms.uAngelRingMapGamma ??= { value: 0.82 };
    shader.uniforms.uAngelRingEmission ??= { value: 0.36 };

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
 * UV3 in the Exedra FBX is a signed auxiliary/baked-normal channel; it is not an
 * AngelRing height coordinate. Treating UV3.y as height produced the jagged white
 * crown marks reported in the Viewer. The shipped AngelRing texture is a wedge:
 * its widest section is U=0,V=0.5 and it tapers toward U≈0.64. The stable mapping
 * is therefore:
 *
 * - U = how far the smooth world normal turns away from character forward;
 * - V = view-space normal Y around 0.5;
 * - Head/headOffset supplies only a small per-character vertical correction;
 * - `_YuugenHighlight` uses the ordinary authored hair UV instead.
 *
 * This produces a continuous front-bang strip, tapers toward the side hair and
 * suppresses rear/twin-tail rectangles without depending on mesh tessellation.
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
            shader.uniforms.uAngelRingBandHalfWidth = { value: reference?.bandHalfWidth ?? 0.040 }
            shader.uniforms.uAngelRingUvMode = { value: reference?.uvMode ? 1 : 0 }
            loadAngelRingOptions(shader)
            updateAngelRingReference()

            shader.vertexShader = /* glsl */ `
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
                uniform vec3 uAngelRingFaceForward;
                ${shader.fragmentShader}
            `.replace(
                diffuseColorManipulationEndFlag,
                /* glsl */ `
                vec3 rdAngelWorldNormal = normalize(
                    inverseTransformDirection(normal, viewMatrix)
                );
                float rdAngelFrontNormal = saturate(dot(
                    rdAngelWorldNormal,
                    normalize(uAngelRingFaceForward)
                ));

                // U=0 is the widest part of the official wedge. Front-facing
                // bangs map there; side hair moves toward the tapered end.
                float rdAngelUExponent = mix(0.48, 1.20, saturate(uAngelRingOffsetU));
                float rdAngelMapU = pow(
                    saturate(1.0 - rdAngelFrontNormal),
                    rdAngelUExponent
                ) * 0.68;

                // Vertical surfaces have view-normal Y≈0 and therefore map to
                // V=0.5, the centre of the authored horizontal strip.
                float rdAngelVScale = mix(0.22, 0.62, saturate(uAngelRingOffsetV));
                float rdAngelMapV = 0.5 + normalize(normal).y * rdAngelVScale;
                float rdAngelHeadCorrection = clamp(
                    vAngelRingPlaneDistance /
                    max(uAngelRingBandHalfWidth * 5.0, 0.001),
                    -1.0,
                    1.0
                ) * uAngelRingHeadVInfluence;
                rdAngelMapV += rdAngelHeadCorrection * saturate(uAngelRingUseHeadPlane);
                rdAngelMapV += uAngelRingVerticalOffset;

                vec2 rdAngelNormalUv = clamp(
                    vec2(rdAngelMapU, rdAngelMapV),
                    0.0,
                    1.0
                );
                // IsHairUVAngelRing / YuugenHighlight uses the ordinary authored
                // hair UV, not the signed UV3 baked-normal channel.
                vec2 rdAngelUv = mix(
                    rdAngelNormalUv,
                    vec2(vMapUv.x, 1.0 - vMapUv.y),
                    saturate(uAngelRingUvMode)
                );

                float rdAngelFilter = max(uAngelRingSoftness, 0.00025);
                float rdAngelMap =
                    texture2D(tAngelRing, rdAngelUv).r * 0.50 +
                    texture2D(tAngelRing, rdAngelUv + vec2(0.0, rdAngelFilter)).r * 0.25 +
                    texture2D(tAngelRing, rdAngelUv - vec2(0.0, rdAngelFilter)).r * 0.25;
                rdAngelMap = pow(
                    saturate(rdAngelMap),
                    max(uAngelRingMapGamma, 0.05)
                );

                float rdAngelFrontGate = mix(
                    1.0,
                    smoothstep(
                        uAngelRingFrontFadeStart,
                        max(uAngelRingFrontFadeEnd, uAngelRingFrontFadeStart + 0.001),
                        vAngelRingCharacterFacing
                    ),
                    saturate(uAngelRingUseHeadPlane)
                );
                // Per-fragment normal gating prevents a rear shell from lighting
                // even when the camera is near the side of the character.
                float rdAngelSurfaceGate = smoothstep(0.02, 0.34, rdAngelFrontNormal);
                float rdAngelAmount =
                    rdAngelMap *
                    rdAngelFrontGate *
                    rdAngelSurfaceGate *
                    uAngelRingEnabled *
                    uAngelRingStrength;

                diffuseColor.rgb = mix(
                    diffuseColor.rgb,
                    max(diffuseColor.rgb, uAngelRingColor),
                    saturate(rdAngelAmount * 0.70)
                );
                diffuseColor.rgb +=
                    uAngelRingColor * rdAngelAmount * uAngelRingEmission;

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
