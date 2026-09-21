import * as THREE from 'three'
import { toonStylizationOptions } from './stylization'
import { ReDriveBakedNormalAttribute } from '../bakedNormal'
import type { CharacterPerspectiveReference } from '../renderProfile'

/** Serialized ReDriveToon `_OutlineWidth` default and range. */
export const OutlineThickness = 5
export const OutlineColor = '#000000'

export interface OutlineMaterialCreationOptions {
    /** Serialized `_UseOutline`; false slots are omitted from the draw list. */
    enabled?: boolean
    /** ReDriveToon `_OutlineWidth`, in the official 0.001..10 units. */
    thickness?: number
    color?: THREE.ColorRepresentation
    alphaTex?: THREE.Texture
    shadowTex?: THREE.Texture
    shadowColor?: THREE.ColorRepresentation
    texBlend?: number
    emissionColor?: THREE.ColorRepresentation
    outlineZOffset?: number
    faceOutlineAdjust?: number
    characterPerspectiveReference?: CharacterPerspectiveReference
}

export function createOutlineMaterial(options?: OutlineMaterialCreationOptions) {
    const thickness = options?.thickness ?? OutlineThickness
    const color = options?.color ?? OutlineColor
    const alphaTex = options?.alphaTex
    const shadowTex = options?.shadowTex

    const material = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([
            THREE.UniformsLib.lights,
            {
                uThickness: { value: thickness },
                uColor: { value: new THREE.Color(color) },
                uShadowColor: {
                    value: new THREE.Color(options?.shadowColor ?? '#ffffff'),
                },
                uOutlineTexBlend: { value: options?.texBlend ?? 0.2 },
                uEmissionColor: {
                    value: new THREE.Color(options?.emissionColor ?? '#000000'),
                },
                uGlobalCharacterTint: { value: new THREE.Color('#ffffff') },
                uCurrentCameraFOV: { value: 60 },
                uCameraNear: { value: 0.1 },
                uCameraFar: { value: 2000 },
                uOrthographic: { value: 0 },
                uOrthoY: { value: 0.5 },
                uVertexColorAvailable: { value: 0 },
                uOutlineZOffset: { value: options?.outlineZOffset ?? 0 },
                uFaceOutlineAdjust: { value: options?.faceOutlineAdjust ?? 0 },
                uRdCharacterFacePositionWS: { value: new THREE.Vector3() },
                uRdCharacterCancelPerspective: {
                    value: options?.characterPerspectiveReference
                        ?.characterCancelPerspective ?? 0,
                },
                uRdGlobalCharacterCancelPerspective: {
                    value: options?.characterPerspectiveReference ? 1 : 0,
                },
            },
        ]),
        vertexShader: /*glsl*/`
            uniform float uThickness;
            uniform float uCurrentCameraFOV;
            uniform float uCameraNear;
            uniform float uCameraFar;
            uniform float uOrthographic;
            uniform float uOrthoY;
            uniform float uVertexColorAvailable;
            uniform float uOutlineZOffset;
            uniform float uFaceOutlineAdjust;
            uniform vec3 uRdCharacterFacePositionWS;
            uniform float uRdCharacterCancelPerspective;
            uniform float uRdGlobalCharacterCancelPerspective;
            attribute vec3 color;
            attribute vec3 ${ReDriveBakedNormalAttribute};
            varying vec2 vUv;
            varying vec3 vOutlineNormalVS;
            varying vec3 vOutlineViewDirectionVS;
            #include <skinning_pars_vertex>

            void main() {
                vUv = uv;

                #include <skinbase_vertex>
                #include <begin_vertex>
                #include <beginnormal_vertex>
                objectNormal = normalize(${ReDriveBakedNormalAttribute});
                #include <skinnormal_vertex>
                #include <skinning_vertex>

                vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
                vec3 outlineNormalVS = normalize(normalMatrix * objectNormal);
                vOutlineViewDirectionVS = normalize(-mvPosition.xyz);
                float outlineVertexWidth = mix(
                    1.0,
                    clamp(color.r, 0.0, 1.0),
                    uVertexColorAvailable
                );
                float currentFOV = max(uCurrentCameraFOV, 0.0001);
                float perspectiveScale =
                    min(abs(mvPosition.z), 60.0 / currentFOV) * currentFOV;
                float orthographicScale = min(abs(uOrthoY), 0.5) * 100.0;
                float outlineScale = mix(
                    perspectiveScale,
                    orthographicScale,
                    uOrthographic
                ) * 0.003 * (uThickness * 0.01);
                mvPosition.xyz +=
                    outlineNormalVS * outlineScale * outlineVertexWidth;

                gl_Position = projectionMatrix * mvPosition;
                vec3 rdCancelWorldPosition =
                    (modelMatrix * vec4(transformed, 1.0)).xyz;
                float rdCancelPerspectiveFactor = max(
                    1.0 - distance(
                        rdCancelWorldPosition,
                        uRdCharacterFacePositionWS
                    ) * 2.25,
                    0.0
                );
                rdCancelPerspectiveFactor *=
                    uRdGlobalCharacterCancelPerspective *
                    uRdCharacterCancelPerspective *
                    clamp(rdCancelWorldPosition.y, 0.0, 1.0);
                vec3 rdCancelFacePositionVS =
                    (viewMatrix * vec4(
                        uRdCharacterFacePositionWS,
                        1.0
                    )).xyz;
                vec2 rdPerspectiveCancelledXY =
                    abs(gl_Position.w) * gl_Position.xy /
                    abs(rdCancelFacePositionVS.z);
                if (uOrthographic < 0.5) {
                    gl_Position.xy = mix(
                        gl_Position.xy,
                        rdPerspectiveCancelledXY,
                        rdCancelPerspectiveFactor
                    );
                }
                float outlineDepthOffset =
                    uOutlineZOffset +
                    mix(0.0, clamp(color.b, 0.0, 1.0), uVertexColorAvailable) *
                    uFaceOutlineAdjust;
                // ReDriveToon rebuilds projected depth instead of subtracting
                // a clip-space constant. This preserves the same eye-space
                // offset under perspective and orthographic cameras.
                if (outlineDepthOffset != 0.0) {
                    if (uOrthographic > 0.5) {
                        gl_Position.z += 2.0 * outlineDepthOffset /
                            max(uCameraFar - uCameraNear, 0.0000001);
                    } else {
                        float outlineEyeDepth = max(
                            abs(gl_Position.w) + outlineDepthOffset,
                            uCameraNear + 5.96046448e-8
                        );
                        gl_Position.z = gl_Position.w * (
                            (-outlineEyeDepth) * projectionMatrix[2][2] +
                            projectionMatrix[3][2]
                        ) / outlineEyeDepth;
                    }
                }
                vOutlineNormalVS = outlineNormalVS;
            }
        `,
        fragmentShader: /*glsl*/`
            uniform vec3 uColor;
            uniform vec3 uShadowColor;
            uniform float uOutlineTexBlend;
            uniform vec3 uEmissionColor;
            uniform vec3 uGlobalCharacterTint;
            uniform sampler2D tAlpha;
            uniform sampler2D tShadow;
            varying vec2 vUv;
            varying vec3 vOutlineNormalVS;
            varying vec3 vOutlineViewDirectionVS;
            #include <common>
            #include <lights_pars_begin>

            void main() {
                float alpha = 1.0;
                #ifdef HAS_ALPHA
                    alpha = texture2D(tAlpha, vUv).a;
                #endif

                vec3 outlineBase = uColor;
                #ifdef HAS_SHADOW
                    vec3 outlineShadow =
                        texture2D(tShadow, vUv).rgb * uShadowColor;
                    outlineBase = mix(
                        uColor,
                        outlineShadow,
                        uOutlineTexBlend
                    );
                #endif

                vec3 outlineNormal = normalize(vOutlineNormalVS);
                vec3 outlineSceneLight =
                    getAmbientLightIrradiance(ambientLightColor);
                #if defined(USE_LIGHT_PROBES)
                    outlineSceneLight += getLightProbeIrradiance(
                        lightProbe,
                        outlineNormal
                    );
                #endif
                #if NUM_HEMI_LIGHTS > 0
                    #pragma unroll_loop_start
                    for (int i = 0; i < NUM_HEMI_LIGHTS; i++) {
                        outlineSceneLight += getHemisphereLightIrradiance(
                            hemisphereLights[i],
                            outlineNormal
                        );
                    }
                    #pragma unroll_loop_end
                #endif
                #if NUM_DIR_LIGHTS > 0
                    outlineSceneLight += directionalLights[0].color;
                #endif
                outlineSceneLight = max(
                    clamp(outlineSceneLight, vec3(0.0), vec3(1.0)),
                    vec3(0.1)
                );

                gl_FragColor = vec4(
                    (outlineBase * outlineSceneLight + uEmissionColor) *
                        uGlobalCharacterTint,
                    alpha
                );
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }
        `,
        side: THREE.BackSide,
        transparent: Boolean(alphaTex),
        lights: true,
        toneMapped: true,
    })

    if (options?.characterPerspectiveReference) {
        material.uniforms.uRdCharacterFacePositionWS.value =
            options.characterPerspectiveReference.facePosition
    }

    if (alphaTex) {
        material.uniforms.tAlpha = { value: alphaTex }
        material.defines.HAS_ALPHA = true
    }
    if (shadowTex) {
        material.uniforms.tShadow = { value: shadowTex }
        material.defines.HAS_SHADOW = true
    }

    return material
}

export function addOutlineToMesh(
    mesh: THREE.Mesh,
    options?: OutlineMaterialCreationOptions,
) {
    const outlineMat = createOutlineMaterial(options)
    const outlineMesh = new THREE.SkinnedMesh(mesh.geometry, outlineMat)
    outlineMat.uniforms.uVertexColorAvailable.value =
        mesh.geometry.getAttribute('color') ? 1 : 0

    if (mesh instanceof THREE.SkinnedMesh && mesh.skeleton) {
        outlineMesh.bind(mesh.skeleton, mesh.bindMatrix)
    }

    outlineMesh.onBeforeRender = (_renderer, _scene, camera) => {
        const uniforms = outlineMat.uniforms
        if (camera instanceof THREE.OrthographicCamera) {
            uniforms.uOrthographic.value = 1
            uniforms.uOrthoY.value =
                Math.abs(camera.top - camera.bottom) /
                Math.max(2 * camera.zoom, 0.0001)
            uniforms.uCameraNear.value = camera.near
            uniforms.uCameraFar.value = camera.far
        } else {
            uniforms.uOrthographic.value = 0
            uniforms.uCurrentCameraFOV.value =
                camera instanceof THREE.PerspectiveCamera ? camera.fov : 60
            if (camera instanceof THREE.PerspectiveCamera) {
                uniforms.uCameraNear.value = camera.near
                uniforms.uCameraFar.value = camera.far
            }
        }
        ;(uniforms.uGlobalCharacterTint.value as THREE.Color).set(
            toonStylizationOptions.characterTint,
        )
    }

    mesh.add(outlineMesh)
    return outlineMesh
}

function createOutlineGroupGeometry(
    source: THREE.BufferGeometry,
    start: number,
    count: number,
): THREE.BufferGeometry {
    // A group view shares immutable vertex/index buffers with the source and
    // owns only its draw range. This avoids cloning the complete character
    // geometry once per Unity material slot.
    const geometry = new THREE.BufferGeometry()
    geometry.name = `${source.name}:official-outline-group`
    if (source.index) geometry.setIndex(source.index)
    for (const [name, attribute] of Object.entries(source.attributes)) {
        geometry.setAttribute(name, attribute)
    }
    geometry.morphAttributes = source.morphAttributes
    geometry.morphTargetsRelative = source.morphTargetsRelative
    geometry.boundingBox = source.boundingBox
    geometry.boundingSphere = source.boundingSphere
    geometry.setDrawRange(start, count)
    return geometry
}

/**
 * Build one outline draw for each official Unity geometry group. A distinct
 * ShaderMaterial keeps `_OutlineWidth`, colours, texture blend and depth
 * offsets bound to the exact `materialIndex`; disabled/transparent slots are
 * omitted before WebGL render-list construction.
 */
export function addOfficialOutlineGroupsToMesh(
    mesh: THREE.Mesh,
    optionsByMaterialIndex: readonly OutlineMaterialCreationOptions[],
): THREE.SkinnedMesh[] {
    const drawRange = mesh.geometry.drawRange
    const groups = mesh.geometry.groups.length > 0
        ? mesh.geometry.groups
        : [{
            start: drawRange.start,
            count: drawRange.count,
            materialIndex: 0,
        }]
    const outlines: THREE.SkinnedMesh[] = []

    for (const group of groups) {
        const materialIndex = group.materialIndex ?? 0
        const options = optionsByMaterialIndex[materialIndex]
            ?? optionsByMaterialIndex[0]
        if (options?.enabled === false) continue

        const outlineMat = createOutlineMaterial(options)
        const outlineGeometry = createOutlineGroupGeometry(
            mesh.geometry,
            group.start,
            group.count,
        )
        const outlineMesh = new THREE.SkinnedMesh(
            outlineGeometry,
            outlineMat,
        )
        outlineMesh.name = `${mesh.name}:official-outline:${materialIndex}`
        outlineMesh.userData.officialMaterialIndex = materialIndex
        outlineMat.uniforms.uVertexColorAvailable.value =
            mesh.geometry.getAttribute('color') ? 1 : 0

        if (mesh instanceof THREE.SkinnedMesh && mesh.skeleton) {
            outlineMesh.bind(mesh.skeleton, mesh.bindMatrix)
        }
        if (mesh.morphTargetInfluences) {
            outlineMesh.morphTargetInfluences = mesh.morphTargetInfluences
        }
        if (mesh.morphTargetDictionary) {
            outlineMesh.morphTargetDictionary = mesh.morphTargetDictionary
        }

        outlineMesh.onBeforeRender = (_renderer, _scene, camera) => {
            const uniforms = outlineMat.uniforms
            if (camera instanceof THREE.OrthographicCamera) {
                uniforms.uOrthographic.value = 1
                uniforms.uOrthoY.value =
                    Math.abs(camera.top - camera.bottom) /
                    Math.max(2 * camera.zoom, 0.0001)
                uniforms.uCameraNear.value = camera.near
                uniforms.uCameraFar.value = camera.far
            } else {
                uniforms.uOrthographic.value = 0
                uniforms.uCurrentCameraFOV.value =
                    camera instanceof THREE.PerspectiveCamera ? camera.fov : 60
                if (camera instanceof THREE.PerspectiveCamera) {
                    uniforms.uCameraNear.value = camera.near
                    uniforms.uCameraFar.value = camera.far
                }
            }
            ;(uniforms.uGlobalCharacterTint.value as THREE.Color).set(
                toonStylizationOptions.characterTint,
            )
        }

        mesh.add(outlineMesh)
        outlines.push(outlineMesh)
    }

    return outlines
}
