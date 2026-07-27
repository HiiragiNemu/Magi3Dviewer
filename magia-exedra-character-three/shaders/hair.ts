import * as THREE from 'three';
import {
    createGeneralMaterial,
    diffuseColorManipulationEndFlag,
    MaterialUserData,
    type MaterialCreationOptions,
    type MaterialCreationResult,
} from '.';
import { loadTexture } from '../texture';
import AngelRingMap from './RDToon_AngelRingMap.png'

export interface AngelRingOptions {
    enabled: boolean;
    color: string;
    strength: number;
    center: number;
    width: number;
    softness: number;
    tilt: number;
    viewPower: number;
    textureInfluence: number;
}

export const angelRingOptions: AngelRingOptions = {
    enabled: true,
    color: '#fff2f7',
    strength: 0.38,
    center: 0.73,
    width: 0.10,
    softness: 0.045,
    tilt: 0.14,
    viewPower: 1.10,
    textureInfluence: 0.62,
}

export const officialAngelRingPreset = {
    ...angelRingOptions,
}

export function resetOfficialAngelRingPreset() {
    Object.assign(angelRingOptions, officialAngelRingPreset)
}

export interface HairMaterialCreationOptions extends MaterialCreationOptions {
    angelRingMinY?: number;
    angelRingMaxY?: number;
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
    shader.uniforms.uAngelRingCenter ??= { value: 0 };
    shader.uniforms.uAngelRingWidth ??= { value: 0 };
    shader.uniforms.uAngelRingSoftness ??= { value: 0 };
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
    shader.uniforms.uAngelRingTextureInfluence.value =
        angelRingOptions.textureInfluence;
    setColorUniform(shader, 'uAngelRingColor', angelRingOptions.color);
}

/**
 * Official ReDrive AngelRing approximation.
 *
 * The original upstream function returned before compiling its AngelRing code.
 * The restored version uses a model-height band plus a UV-height fallback. The
 * fallback is important for FBX hair meshes whose local Y origin/range differs
 * between characters, so every currently exported hair mesh receives a visible
 * ring while still using the supplied ReDrive map and view-space normal.
 */
export async function createHairMaterial(
    options: HairMaterialCreationOptions,
): Promise<MaterialCreationResult> {
    const angelRingTex = await loadTexture(
        AngelRingMap,
        { colorSpace: THREE.SRGBColorSpace },
    )
    angelRingTex.wrapS = THREE.ClampToEdgeWrapping
    angelRingTex.wrapT = THREE.ClampToEdgeWrapping

    const minY = options.angelRingMinY ?? 0
    const maxY = options.angelRingMaxY ?? 2.2
    const safeMaxY = Math.abs(maxY - minY) > 0.0001 ? maxY : minY + 1

    const result = await createGeneralMaterial({
        ...options,
        onBeforeCompile(shader) {
            shader.uniforms.tAngelRing = { value: angelRingTex }
            shader.uniforms.uAngelRingMinY = { value: minY }
            shader.uniforms.uAngelRingMaxY = { value: safeMaxY }
            loadAngelRingOptions(shader)

            shader.vertexShader = /* glsl */ `
                varying float vAngelRingHeight;
                uniform float uAngelRingMinY;
                uniform float uAngelRingMaxY;
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
                `
            )

            shader.fragmentShader = /* glsl */ `
                varying float vAngelRingHeight;
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
                ${shader.fragmentShader}
            `.replace(
                diffuseColorManipulationEndFlag,
                /* glsl */ `
                // UV fallback makes the band independent from inconsistent FBX
                // local origins while the model-height component preserves a
                // coherent ring on well-exported characters.
                float rdAngelUvHeight = clamp(1.0 - vMapUv.y, 0.0, 1.0);
                float rdAngelHeight = mix(
                    vAngelRingHeight,
                    rdAngelUvHeight,
                    0.55
                );
                float rdAngelCenter =
                    uAngelRingCenter +
                    normal.x * uAngelRingTilt * 0.16;
                float rdAngelDistance = abs(
                    rdAngelHeight - rdAngelCenter
                );
                float rdAngelInner = max(
                    uAngelRingWidth - uAngelRingSoftness,
                    0.0
                );
                float rdAngelOuter = max(
                    rdAngelInner + 0.0001,
                    uAngelRingWidth + uAngelRingSoftness
                );
                float rdAngelBand = 1.0 - smoothstep(
                    rdAngelInner,
                    rdAngelOuter,
                    rdAngelDistance
                );

                float rdAngelU = clamp(normal.x * 0.5 + 0.5, 0.0, 1.0);
                float rdAngelV = clamp(
                    0.5 +
                    (rdAngelHeight - rdAngelCenter) /
                    max(uAngelRingWidth * 2.0, 0.0001),
                    0.0,
                    1.0
                );
                vec3 rdAngelTexture = texture2D(
                    tAngelRing,
                    vec2(rdAngelU, rdAngelV)
                ).rgb;
                float rdAngelTextureMask = max(
                    rdAngelTexture.r,
                    max(rdAngelTexture.g, rdAngelTexture.b)
                );
                float rdAngelFacing = pow(
                    saturate(dot(normal, normalize(vViewPosition))),
                    max(uAngelRingViewPower, 0.0001)
                );
                float rdAngelMask =
                    rdAngelBand *
                    mix(
                        1.0,
                        rdAngelTextureMask,
                        saturate(uAngelRingTextureInfluence)
                    ) *
                    mix(0.70, 1.0, rdAngelFacing) *
                    uAngelRingEnabled;

                vec3 rdAngelTarget = max(
                    diffuseColor.rgb,
                    uAngelRingColor
                );
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
    return result
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
