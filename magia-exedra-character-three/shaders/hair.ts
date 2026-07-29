import * as THREE from 'three';
import {
    createGeneralMaterial,
    MaterialUserData,
    type MaterialCreationOptions,
    type MaterialCreationResult,
} from '.';
import type { OfficialMaterialProfile } from '../materialProfile';
import type { AngelRingReference } from '../renderProfile';
import { loadTexture, MaximizeTextureQuality } from '../texture';
import AngelRingMap from './RDToon_AngelRingMap.png';

/**
 * The official material exposes no AngelRing strength, gamma, band-width, or
 * vertical-offset property. This global switch is retained only as a diagnostic
 * A/B toggle; shape, location, map mode, and colour come from official data.
 */
export interface AngelRingOptions {
    enabled: boolean;
}

export const angelRingOptions: AngelRingOptions = {
    enabled: true,
};

export const officialAngelRingPreset = {
    ...angelRingOptions,
};

export function resetOfficialAngelRingPreset() {
    Object.assign(angelRingOptions, officialAngelRingPreset);
}

export interface HairMaterialCreationOptions extends MaterialCreationOptions {
    /** Animated official reference: Head.position + faceUp * headOffset. */
    angelRingReference?: AngelRingReference;
    /** Character-authored `_AngelRingMap` used by UV and rare projected modes. */
    angelRingMap?: string;
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

function setNumberUniform(
    shader: THREE.WebGLProgramParametersWithUniforms,
    key: string,
    value: number,
) {
    shader.uniforms[key] ??= { value };
    shader.uniforms[key].value = value;
}

export function loadAngelRingOptions(
    shader: THREE.WebGLProgramParametersWithUniforms,
) {
    setNumberUniform(
        shader,
        'uAngelRingEnabled',
        angelRingOptions.enabled ? 1 : 0,
    );
}

/**
 * Apply the serialized material-slot AngelRing state immediately before the
 * corresponding FBX geometry group is drawn.
 */
export function setOfficialAngelRingMaterialProfileUniforms(
    shader: THREE.WebGLProgramParametersWithUniforms | undefined,
    profile: OfficialMaterialProfile | undefined,
) {
    if (!shader) return;
    const angelRing = profile?.angelRing;
    const mapKind = angelRing?.map === 'character'
        ? 2
        : angelRing?.map === 'common'
            ? 1
            : 0;
    setNumberUniform(
        shader,
        'uAngelRingMaterialEnabled',
        angelRing?.enabled ? 1 : 0,
    );
    setNumberUniform(shader, 'uAngelRingMapKind', mapKind);
    setNumberUniform(shader, 'uAngelRingUvMode', angelRing?.uvMode ? 1 : 0);
    const color = angelRing?.rimLightColor ?? [1, 1, 1];
    setColorUniform(
        shader,
        'uAngelRingColor',
        new THREE.Color(color[0], color[1], color[2]),
    );
}

const viewportSize = new THREE.Vector2(1, 1);

/**
 * Unity's `_GlobalAspectFix` and `_GlobalFOVorOrthoSizeFix` are camera globals,
 * not artist-tuned AngelRing parameters. Update their Web equivalents for each
 * draw so resized canvases, perspective cameras, and orthographic cameras all
 * use the recovered official projection.
 */
export function setAngelRingCameraUniforms(
    shader: THREE.WebGLProgramParametersWithUniforms | undefined,
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
) {
    if (!shader?.uniforms.uAngelRingViewportSize) return;
    const renderTarget = renderer.getRenderTarget();
    if (renderTarget) {
        viewportSize.set(renderTarget.width, renderTarget.height);
    } else {
        renderer.getDrawingBufferSize(viewportSize);
    }
    const width = Math.max(viewportSize.x, 1);
    const height = Math.max(viewportSize.y, 1);
    shader.uniforms.uAngelRingViewportSize.value.set(width, height);
    shader.uniforms.uAngelRingAspectFix.value.set(width / height, 1);

    let cameraFix = 1;
    let orthographic = 0;
    if (camera instanceof THREE.PerspectiveCamera) {
        // Native SetShaderParams writes 1 / Camera.fieldOfView. Camera zoom is
        // handled by the projection matrix and must not rescale this global.
        cameraFix = 1 / Math.max(camera.fov, 0.0001);
    } else if (camera instanceof THREE.OrthographicCamera) {
        const halfHeight =
            Math.abs(camera.top - camera.bottom) /
            (2 * Math.max(camera.zoom, 0.0001));
        cameraFix = 1 / Math.max(halfHeight * 100, 0.0001);
        orthographic = 1;
    }
    setNumberUniform(shader, 'uAngelRingFovOrOrthoFix', cameraFix);
    setNumberUniform(shader, 'uAngelRingOrthographic', orthographic);
}

/**
 * Exact AngelRing coordinate path recovered from the JP 3.11 GLES program.
 *
 * Projected mode:
 * - projects `Head.position + FaceUp * headOffset` into screen space;
 * - applies the official camera-distance, aspect, FOV/ortho, and head-axis warp;
 * - samples the common (or character-specific) `_AngelRingMap` red channel.
 *
 * `_YuugenHighlight` mode samples the character-authored map directly with the
 * base hair UV and keeps its RGB colour. No guessed world-space strip remains.
 */
export async function createHairMaterial(
    options: HairMaterialCreationOptions,
): Promise<HairMaterialCreationResult> {
    const reference = options.angelRingReference;
    if (!reference) return await createGeneralMaterial(options);

    const [commonAngelRingTex, characterAngelRingTex] = await Promise.all([
        loadTexture(AngelRingMap, { colorSpace: THREE.NoColorSpace }),
        options.angelRingMap
            ? loadTexture(options.angelRingMap, {
                colorSpace: THREE.SRGBColorSpace,
            })
            : Promise.resolve(undefined),
    ]);
    for (const texture of [commonAngelRingTex, characterAngelRingTex]) {
        if (!texture) continue;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        // The official 512x512 AngelRing map has MipCount=1 and bilinear
        // sampling. Generated mip levels blur and thicken its narrow arcs.
        texture.generateMipmaps = false;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.needsUpdate = true;
    }
    MaximizeTextureQuality(commonAngelRingTex, characterAngelRingTex);

    const compiledShaders =
        new Set<THREE.WebGLProgramParametersWithUniforms>();
    const headPosition = new THREE.Vector3();
    const headQuaternion = new THREE.Quaternion();
    const facePosition = new THREE.Vector3();
    const faceUp = new THREE.Vector3(0, 1, 0);
    const faceRight = new THREE.Vector3(1, 0, 0);
    const faceForward = new THREE.Vector3(0, 0, 1);

    const updateAngelRingReference = () => {
        if (compiledShaders.size === 0) return;
        reference.headBone.updateWorldMatrix(true, false);
        reference.headBone.getWorldPosition(headPosition);
        reference.headBone.getWorldQuaternion(headQuaternion);
        faceUp.copy(reference.localUp).applyQuaternion(headQuaternion).normalize();
        faceRight.copy(reference.localRight).applyQuaternion(headQuaternion).normalize();
        faceForward
            .copy(reference.localForward)
            .applyQuaternion(headQuaternion)
            .normalize();
        facePosition
            .copy(headPosition)
            .addScaledVector(faceUp, reference.headOffset);

        for (const shader of compiledShaders) {
            shader.uniforms.uAngelRingFacePosition.value.copy(facePosition);
            shader.uniforms.uAngelRingFaceUp.value.copy(faceUp);
            shader.uniforms.uAngelRingFaceForward.value.copy(faceForward);

            // Compatibility diagnostics retained for the existing reports.
            shader.uniforms.uAngelRingPlanePosition.value.copy(facePosition);
            shader.uniforms.uAngelRingPlaneUp.value.copy(faceUp);
            shader.uniforms.uAngelRingPlaneRight.value.copy(faceRight);
            shader.uniforms.uAngelRingPlaneForward.value.copy(faceForward);
            shader.uniforms.uAngelRingBandHalfWidth.value =
                reference.bandHalfWidth;
            shader.uniforms.uAngelRingProjectionRadius.value =
                reference.projectionRadius;
        }
    };

    const result = await createGeneralMaterial({
        ...options,
        onBeforeCompile(shader) {
            compiledShaders.add(shader);
            shader.uniforms.tAngelRingCommon = { value: commonAngelRingTex };
            shader.uniforms.tAngelRingCharacter = {
                value: characterAngelRingTex ?? commonAngelRingTex,
            };
            shader.uniforms.uAngelRingFacePosition = {
                value: new THREE.Vector3(),
            };
            shader.uniforms.uAngelRingFaceUp = {
                value: new THREE.Vector3(0, 1, 0),
            };
            shader.uniforms.uAngelRingFaceForward = {
                value: new THREE.Vector3(0, 0, 1),
            };
            shader.uniforms.uAngelRingViewportSize = {
                value: new THREE.Vector2(1, 1),
            };
            shader.uniforms.uAngelRingAspectFix = {
                value: new THREE.Vector2(1, 1),
            };
            shader.uniforms.uAngelRingFovOrOrthoFix = { value: 1 };
            shader.uniforms.uAngelRingOrthographic = { value: 0 };

            // Compatibility diagnostics; these do not drive the recovered math.
            shader.uniforms.uAngelRingUseHeadPlane = { value: 1 };
            shader.uniforms.uAngelRingPlanePosition = {
                value: new THREE.Vector3(),
            };
            shader.uniforms.uAngelRingPlaneUp = {
                value: new THREE.Vector3(0, 1, 0),
            };
            shader.uniforms.uAngelRingPlaneRight = {
                value: new THREE.Vector3(1, 0, 0),
            };
            shader.uniforms.uAngelRingPlaneForward = {
                value: new THREE.Vector3(0, 0, 1),
            };
            shader.uniforms.uAngelRingBandHalfWidth = {
                value: reference.bandHalfWidth,
            };
            shader.uniforms.uAngelRingProjectionRadius = {
                value: reference.projectionRadius,
            };

            loadAngelRingOptions(shader);
            setOfficialAngelRingMaterialProfileUniforms(
                shader,
                this.userData instanceof MaterialUserData
                    ? this.userData.officialMaterialProfile
                    : options.materialProfiles?.[0],
            );
            updateAngelRingReference();

            shader.vertexShader = /* glsl */ `
                varying vec3 vAngelRingFaceClipXYW;
                uniform vec3 uAngelRingFacePosition;
                ${shader.vertexShader}
            `.replace(
                '#include <project_vertex>',
                /* glsl */ `
                #include <project_vertex>
                vec4 rdAngelFaceClip =
                    projectionMatrix *
                    viewMatrix *
                    vec4(uAngelRingFacePosition, 1.0);
                vAngelRingFaceClipXYW = rdAngelFaceClip.xyw;
                `,
            );

            shader.fragmentShader = /* glsl */ `
                varying vec3 vAngelRingFaceClipXYW;
                uniform sampler2D tAngelRingCommon;
                uniform sampler2D tAngelRingCharacter;
                uniform float uAngelRingEnabled;
                uniform float uAngelRingMaterialEnabled;
                uniform float uAngelRingMapKind;
                uniform float uAngelRingUvMode;
                uniform vec3 uAngelRingColor;
                uniform vec3 uAngelRingFacePosition;
                uniform vec3 uAngelRingFaceUp;
                uniform vec3 uAngelRingFaceForward;
                uniform vec2 uAngelRingViewportSize;
                uniform vec2 uAngelRingAspectFix;
                uniform float uAngelRingFovOrOrthoFix;
                uniform float uAngelRingOrthographic;
                ${shader.fragmentShader}
            `.replace(
                '#include <opaque_fragment>',
                /* glsl */ `
                #include <opaque_fragment>

                float rdAngelActive =
                    uAngelRingEnabled *
                    uAngelRingMaterialEnabled *
                    step(0.5, uAngelRingMapKind);
                if (rdAngelActive > 0.0) {
                    // The compiled JP shader does not infer lighting from the
                    // already-composited output. It reuses the same clamped
                    // SH/main-light multiplier as the hair base and attenuates
                    // it with the authored toon ramp:
                    //     sceneLight * (shadowRamp * 0.8 + 0.2)
                    // Deriving this as outgoingLight / diffuseColor amplified
                    // pale hair into an opaque white stripe.
                    vec3 rdAngelCurrentLighting =
                        rdToonSceneLightColor *
                        (rdToonBaseWeight * 0.8 + 0.2);
                    vec3 rdAngelContribution = vec3(0.0);

                    if (uAngelRingUvMode > 0.5) {
                        vec3 rdAngelCommon = texture2D(
                            tAngelRingCommon,
                            vMapUv
                        ).rgb;
                        vec3 rdAngelCharacter = texture2D(
                            tAngelRingCharacter,
                            vMapUv
                        ).rgb;
                        vec3 rdAngelMap = mix(
                            rdAngelCommon,
                            rdAngelCharacter,
                            step(1.5, uAngelRingMapKind)
                        );
                        rdAngelContribution =
                            rdAngelMap *
                            uAngelRingColor *
                            rdAngelCurrentLighting;
                    } else {
                        vec2 rdAngelFaceCenter =
                            vAngelRingFaceClipXYW.xy /
                            max(abs(vAngelRingFaceClipXYW.z), 0.00001);
                        rdAngelFaceCenter =
                            rdAngelFaceCenter * 0.5 + vec2(0.5);

                        vec2 rdAngelFragmentUv =
                            gl_FragCoord.xy /
                            max(uAngelRingViewportSize, vec2(1.0));
                        vec3 rdAngelFaceUpVs = normalize(
                            mat3(viewMatrix) * uAngelRingFaceUp
                        );
                        vec3 rdAngelFaceForwardVs = normalize(
                            mat3(viewMatrix) * uAngelRingFaceForward
                        );
                        float rdAngelFacing =
                            rdAngelFaceForwardVs.z * -0.5 + 0.5;
                        float rdAngelInverseDistance =
                            1.0 /
                            max(
                                distance(
                                    uAngelRingFacePosition,
                                    cameraPosition
                                ),
                                0.00001
                            );
                        float rdAngelDistanceScale = mix(
                            rdAngelInverseDistance,
                            0.875,
                            uAngelRingOrthographic
                        );
                        vec2 rdAngelCameraScale =
                            uAngelRingAspectFix *
                            uAngelRingFovOrOrthoFix *
                            rdAngelDistanceScale;
                        vec2 rdAngelBoxMin =
                            rdAngelFaceCenter - rdAngelCameraScale * 10.0;
                        vec2 rdAngelBoxMax =
                            rdAngelFaceCenter + rdAngelCameraScale * 10.0;

                        vec2 rdAngelViewOffset = vec2(
                            sin(
                                rdAngelFaceUpVs.y *
                                1.5707963267948966
                            ) *
                            15.0 *
                            rdAngelFacing *
                            rdAngelFacing,
                            -3.0 * rdAngelFaceUpVs.z
                        );
                        vec2 rdAngelProjected =
                            rdAngelFragmentUv +
                            rdAngelViewOffset *
                            uAngelRingAspectFix *
                            uAngelRingFovOrOrthoFix *
                            rdAngelDistanceScale;
                        vec2 rdAngelUv =
                            (rdAngelProjected - rdAngelBoxMin) /
                            max(
                                rdAngelBoxMax - rdAngelBoxMin,
                                vec2(0.00001)
                            );

                        vec2 rdAngelCentered = rdAngelUv - vec2(0.5);
                        rdAngelUv = vec2(
                            dot(
                                rdAngelCentered,
                                vec2(
                                    rdAngelFaceUpVs.y,
                                    -rdAngelFaceUpVs.x
                                )
                            ),
                            dot(
                                rdAngelCentered,
                                rdAngelFaceUpVs.xy
                            )
                        ) + vec2(0.5);

                        float rdAngelArc =
                            sin(3.141592653589793 * rdAngelUv.x);
                        float rdAngelLower =
                            rdAngelUv.y - 0.415 * rdAngelArc;
                        float rdAngelUpper =
                            rdAngelUv.y + 0.5 * rdAngelArc;
                        float rdAngelWarpedV = mix(
                            rdAngelLower,
                            rdAngelUpper,
                            rdAngelFaceUpVs.z * 0.5 + 0.5
                        );
                        vec2 rdAngelMapUv =
                            vec2(rdAngelUv.x, rdAngelWarpedV);
                        float rdAngelCommon = texture2D(
                            tAngelRingCommon,
                            rdAngelMapUv
                        ).r;
                        float rdAngelCharacter = texture2D(
                            tAngelRingCharacter,
                            rdAngelMapUv
                        ).r;
                        float rdAngelMap = mix(
                            rdAngelCommon,
                            rdAngelCharacter,
                            step(1.5, uAngelRingMapKind)
                        );
                        float rdAngelBaseLuminance = dot(
                            diffuseColor.rgb,
                            vec3(0.298911989, 0.586610973, 0.114478)
                        );
                        rdAngelContribution =
                            vec3(rdAngelMap) *
                            uAngelRingColor *
                            rdAngelCurrentLighting *
                            rdAngelBaseLuminance;
                    }

                    // The original GLES branch adds AngelRing after character
                    // lighting and before tone mapping/fog.
                    gl_FragColor.rgb +=
                        rdAngelContribution * rdAngelActive;
                }
                `,
            );
        },
    });

    result.textures.push(commonAngelRingTex);
    if (characterAngelRingTex) {
        result.textures.push(characterAngelRingTex);
    }
    return {
        ...result,
        updateAngelRingReference,
    };
}

export function getMeshAngelRingShaders(
    mesh: THREE.Mesh,
): THREE.WebGLProgramParametersWithUniforms[] {
    const shaders = (Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material])
        .map(material => material?.userData)
        .filter(userData => userData instanceof MaterialUserData)
        .map(userData => userData.shader)
        .filter(
            (shader): shader is THREE.WebGLProgramParametersWithUniforms =>
                Boolean(shader?.uniforms.uAngelRingEnabled),
        );
    return [...new Set(shaders)];
}
