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
    setNumberUniform(
        shader,
        'uHairDepthRimEnabled',
        angelRing?.isHair ? 1 : 0,
    );
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
    // Fragment coordinates are normalized independently by viewport size.
    // Use inverse display aspect so one normalized X unit represents the same
    // physical screen distance as one normalized Y unit. width / height
    // collapses the projected ring into a diagonal stripe on portrait screens.
    shader.uniforms.uAngelRingAspectFix.value.set(height / width, 1);

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
 * Head-locked AngelRing reconstruction.
 *
 * The material controller fixes the ring origin to
 * `Head.position + FaceUp * headOffset`. JP 3.11's compiled forward pass then
 * projects that origin into screen space, rotates the fragment coordinate by
 * the Head Up axis in view space, and bends V with `sin(pi * U)`. This is not a
 * flat world-space band and it intentionally remains continuous through a
 * 360-degree camera orbit; deep shadow attenuates it through character light.
 *
 * `_YuugenHighlight` mode remains character-authored and samples the material
 * map directly with the base hair UV.
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
            shader.uniforms.uHairDepthRimEnabled = { value: 0 };

            // Kept for the diagnostics UI and for the geometry-locked shader.
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
                uniform vec3 uAngelRingFacePosition;
                uniform vec3 uAngelRingFaceUp;
                uniform vec3 uAngelRingFaceForward;
                varying vec3 vAngelRingFaceClip;
                varying vec3 vAngelRingFaceUpVS;
                varying vec3 vAngelRingFaceForwardVS;
                ${shader.vertexShader}
            `.replace(
                '#include <project_vertex>',
                /* glsl */ `
                #include <project_vertex>
                vec4 rdAngelFaceClip =
                    projectionMatrix *
                    viewMatrix *
                    vec4(uAngelRingFacePosition, 1.0);
                vAngelRingFaceClip = vec3(
                    rdAngelFaceClip.xy,
                    rdAngelFaceClip.w
                );
                vAngelRingFaceUpVS =
                    mat3(viewMatrix) * uAngelRingFaceUp;
                vAngelRingFaceForwardVS =
                    mat3(viewMatrix) * uAngelRingFaceForward;
                `,
            );

            shader.fragmentShader = /* glsl */ `
                varying vec3 vAngelRingFaceClip;
                varying vec3 vAngelRingFaceUpVS;
                varying vec3 vAngelRingFaceForwardVS;
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
                uniform vec3 uAngelRingPlanePosition;
                uniform vec3 uAngelRingPlaneUp;
                uniform vec3 uAngelRingPlaneRight;
                uniform vec3 uAngelRingPlaneForward;
                uniform float uAngelRingBandHalfWidth;
                uniform float uAngelRingProjectionRadius;
                uniform float uHairDepthRimEnabled;
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
                        // Exact readable port of JP 3.11 lines 932-982:
                        // face-position projection, view-space Head axes,
                        // camera-distance scale, rotation, and sin-shaped
                        // tapered map V. There is no front/rear kill gate.
                        vec2 rdAngelFragmentUv =
                            gl_FragCoord.xy /
                            max(uAngelRingViewportSize, vec2(1.0));
                        float rdAngelFaceW = max(
                            abs(vAngelRingFaceClip.z),
                            0.000001
                        );
                        vec2 rdAngelFaceUv =
                            vAngelRingFaceClip.xy /
                            rdAngelFaceW;
                        rdAngelFaceUv =
                            rdAngelFaceUv * 0.5 + vec2(0.5);

                        vec3 rdAngelFaceUpVS =
                            normalize(vAngelRingFaceUpVS);
                        vec3 rdAngelFaceForwardVS =
                            normalize(vAngelRingFaceForwardVS);
                        float rdAngelInverseDistance = 1.0 / max(
                            distance(
                                cameraPosition,
                                uAngelRingFacePosition
                            ),
                            0.0001
                        );
                        rdAngelInverseDistance = mix(
                            rdAngelInverseDistance,
                            0.875,
                            step(0.5, uAngelRingOrthographic)
                        );
                        vec2 rdAngelUnitScale =
                            uAngelRingAspectFix *
                            uAngelRingFovOrOrthoFix *
                            rdAngelInverseDistance;
                        vec2 rdAngelRectHalf = max(
                            rdAngelUnitScale * 10.0,
                            vec2(0.000001)
                        );

                        float rdAngelBackFactor =
                            rdAngelFaceForwardVS.z * -0.5 + 0.5;
                        vec2 rdAngelViewShift = vec2(
                            sin(
                                rdAngelFaceUpVS.y *
                                1.5707963267948966
                            ) *
                            rdAngelBackFactor *
                            rdAngelBackFactor *
                            15.0,
                            rdAngelFaceUpVS.z * -3.0
                        ) * rdAngelUnitScale;
                        vec2 rdAngelRectCoordinate =
                            (
                                rdAngelFragmentUv +
                                rdAngelViewShift -
                                (rdAngelFaceUv - rdAngelRectHalf)
                            ) /
                            (rdAngelRectHalf * 2.0) -
                            vec2(0.5);
                        // A normalized 3D Head-Up vector does not imply a
                        // normalized 2D screen axis. When the head pitches
                        // towards the camera, FaceUp.xy becomes short; using it
                        // directly scales and clips the projected map into a
                        // diagonal stripe. Normalize the projected axis in the
                        // same aspect-correct coordinate space as the ring box.
                        vec2 rdAngelProjectedUp = rdAngelFaceUpVS.xy;
                        float rdAngelProjectedUpLength =
                            length(rdAngelProjectedUp);
                        rdAngelProjectedUp =
                            rdAngelProjectedUpLength > 0.00001
                                ? rdAngelProjectedUp /
                                    rdAngelProjectedUpLength
                                : vec2(0.0, 1.0);
                        vec2 rdAngelProjectedRight = vec2(
                            rdAngelProjectedUp.y,
                            -rdAngelProjectedUp.x
                        );
                        vec2 rdAngelRotated = vec2(
                            dot(
                                rdAngelRectCoordinate,
                                rdAngelProjectedRight
                            ),
                            dot(
                                rdAngelRectCoordinate,
                                rdAngelProjectedUp
                            )
                        ) + vec2(0.5);
                        float rdAngelArch = sin(
                            rdAngelRotated.x *
                            3.14159265358979323846
                        );
                        float rdAngelLowerV =
                            rdAngelRotated.y -
                            rdAngelArch * 0.414999992;
                        float rdAngelUpperV =
                            rdAngelRotated.y +
                            rdAngelArch * 0.5;
                        vec2 rdAngelMapUv = vec2(
                            rdAngelRotated.x,
                            mix(
                                rdAngelLowerV,
                                rdAngelUpperV,
                                rdAngelFaceUpVS.z * 0.5 + 0.5
                            )
                        );
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

                // ReDriveToon's hair depth-rim is separate from AngelRing.
                // Until the official CameraDepthTexture offset pass is ported,
                // preserve its observed soft, asymmetric and scene-tinted
                // response rather than substituting a hard global Fresnel.
                if (uHairDepthRimEnabled > 0.5) {
                    vec3 rdHairViewDirection =
                        normalize(vViewPosition);
                    float rdHairNdotV = saturate(
                        dot(normal, rdHairViewDirection)
                    );
                    float rdHairEdge = smoothstep(
                        0.55,
                        0.93,
                        1.0 - rdHairNdotV
                    );
                    float rdHairLightSide = saturate(
                        dot(normal, rdToonMainLightDirection) *
                        0.5 + 0.5
                    );
                    float rdHairDepthRim =
                        rdHairEdge *
                        mix(0.15, 1.0, rdHairLightSide) *
                        (rdToonBaseWeight * 0.8 + 0.2);
                    gl_FragColor.rgb +=
                        uAngelRingColor *
                        rdToonSceneLightColor *
                        rdHairDepthRim *
                        0.16;
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
