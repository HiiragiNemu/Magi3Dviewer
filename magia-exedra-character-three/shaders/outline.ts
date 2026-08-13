import * as THREE from 'three'
import { toonStylizationOptions } from './stylization'

/** Serialized ReDriveToon `_OutlineWidth` default and range. */
export const OutlineThickness = 5
export const OutlineColor = '#000000'

interface OutlineMaterialCreationOptions {
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
            attribute vec3 color;
            varying vec2 vUv;
            varying vec3 vOutlineNormalVS;
            #include <skinning_pars_vertex>

            void main() {
                vUv = uv;

                #include <skinbase_vertex>
                #include <begin_vertex>
                #include <beginnormal_vertex>
                #include <skinnormal_vertex>
                #include <skinning_vertex>

                vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
                vec3 outlineNormalVS = normalize(normalMatrix * objectNormal);
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
                        clamp(uOutlineTexBlend, 0.0, 1.0)
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
