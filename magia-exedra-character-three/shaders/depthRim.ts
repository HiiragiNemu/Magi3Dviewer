import * as THREE from 'three';
import type { OfficialMaterialProfile } from '../materialProfile';

/**
 * First bounded CameraDepthTexture experiment.
 *
 * The recovered constants are official JP 3.11 values. The additional Rim
 * direction/colour are intentionally neutral until a scene/Timeline value is
 * captured; callers may set them explicitly for A/B work. Normal rendering is
 * unchanged because enabled defaults to false.
 */
export const DepthRimExperiment = {
    enabled: false,
    debugMasks: false,
    depthTexWidth: 1.0,
    depthTexYOffset: 0.0,
    rimDiffThreshold: 0.02,
    shadowDiffThreshold: 0.03,
    additionalDirectionVS: new THREE.Vector2(0, 0),
    additionalColor: new THREE.Color(0, 0, 0),
}

const fallbackDepth = new THREE.DataTexture(
    new Uint8Array([255]),
    1,
    1,
    THREE.RedFormat,
    THREE.UnsignedByteType,
)
fallbackDepth.name = 'ReDrive:CameraDepthFallbackFar'
fallbackDepth.minFilter = THREE.NearestFilter
fallbackDepth.magFilter = THREE.NearestFilter
fallbackDepth.generateMipmaps = false
fallbackDepth.needsUpdate = true

/** Shared frame uniforms. Material-class uniforms remain per draw. */
export const reDriveCameraDepthUniformState = {
    enabled: { value: 0 },
    debugMasks: { value: 0 },
    map: { value: fallbackDepth as THREE.Texture },
    viewportSize: { value: new THREE.Vector2(1, 1) },
    nearFar: { value: new THREE.Vector2(0.1, 1000) },
    orthographic: { value: 0 },
    aspectFix: { value: new THREE.Vector2(1, 1) },
    fovOrOrthoFix: { value: 1 },
    depthTexWidth: { value: 1.0 },
    depthTexYOffset: { value: 0.0 },
    rimDiffThreshold: { value: 0.02 },
    shadowDiffThreshold: { value: 0.03 },
    additionalDirectionVS: { value: new THREE.Vector2(0, 0) },
    additionalColor: { value: new THREE.Color(0, 0, 0) },
}

function bindSharedUniforms(shader: THREE.WebGLProgramParametersWithUniforms) {
    const uniforms = shader.uniforms
    uniforms.uRdDepthRimExperimentEnabled = reDriveCameraDepthUniformState.enabled
    uniforms.uRdDepthRimDebugMasks = reDriveCameraDepthUniformState.debugMasks
    uniforms.uRdCameraDepthTexture = reDriveCameraDepthUniformState.map
    uniforms.uRdDepthRimViewportSize = reDriveCameraDepthUniformState.viewportSize
    uniforms.uRdDepthRimNearFar = reDriveCameraDepthUniformState.nearFar
    uniforms.uRdDepthRimOrthographic = reDriveCameraDepthUniformState.orthographic
    uniforms.uRdDepthRimAspectFix = reDriveCameraDepthUniformState.aspectFix
    uniforms.uRdDepthRimFovOrOrthoFix = reDriveCameraDepthUniformState.fovOrOrthoFix
    uniforms.uRdDepthTexWidth = reDriveCameraDepthUniformState.depthTexWidth
    uniforms.uRdDepthTexYOffset = reDriveCameraDepthUniformState.depthTexYOffset
    uniforms.uRdDepthRimLightDiffThreshold =
        reDriveCameraDepthUniformState.rimDiffThreshold
    uniforms.uRdDepthShadowDiffThreshold =
        reDriveCameraDepthUniformState.shadowDiffThreshold
    uniforms.uRdDepthRimAdditionalDirectionVS =
        reDriveCameraDepthUniformState.additionalDirectionVS
    uniforms.uRdDepthRimAdditionalColor =
        reDriveCameraDepthUniformState.additionalColor
}

export function setDepthRimMaterialProfileUniforms(
    shader: THREE.WebGLProgramParametersWithUniforms | undefined,
    profile: OfficialMaterialProfile | undefined,
) {
    if (!shader) return
    const setNumber = (name: string, value: number) => {
        shader.uniforms[name] ??= { value }
        shader.uniforms[name].value = value
    }
    const color = profile?.angelRing.rimLightColor ?? [1, 1, 1]
    const currentColor = shader.uniforms.uRdDepthRimMainColor?.value
    if (currentColor instanceof THREE.Color) currentColor.setRGB(...color)
    else shader.uniforms.uRdDepthRimMainColor = {
        value: new THREE.Color(...color),
    }
    setNumber('uRdDepthRimIsHair', profile?.angelRing.isHair ? 1 : 0)
    setNumber('uRdDepthRimIsGem', profile?.gem.enabled ? 1 : 0)
}

export function setDepthRimVertexColorAvailability(
    shader: THREE.WebGLProgramParametersWithUniforms | undefined,
    available: boolean,
) {
    if (!shader?.uniforms.uRdDepthRimVertexColorGAvailable) return
    shader.uniforms.uRdDepthRimVertexColorGAvailable.value = available ? 1 : 0
}

/**
 * Inject the shared Body/Hair/Gem CameraDepthTexture path.
 *
 * The contribution is inserted immediately after Three's opaque write. This
 * keeps it in linear shader space, survives Gem's earlier outgoingLight
 * replacement, and remains before tone mapping/fog/output encoding.
 */
export function injectReDriveDepthRimShader(
    shader: THREE.WebGLProgramParametersWithUniforms,
) {
    bindSharedUniforms(shader)
    setDepthRimMaterialProfileUniforms(shader, undefined)
    shader.uniforms.uRdDepthRimVertexColorGAvailable = { value: 0 }

    shader.vertexShader = /* glsl */ `
        #if !defined(USE_COLOR) && !defined(USE_COLOR_ALPHA)
            attribute vec3 color;
        #endif
        varying float vRdDepthRimVertexColorG;
        ${shader.vertexShader}
    `.replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        vRdDepthRimVertexColorG = color.g;
        `,
    )

    shader.fragmentShader = /* glsl */ `
        uniform sampler2D uRdCameraDepthTexture;
        uniform float uRdDepthRimExperimentEnabled;
        uniform float uRdDepthRimDebugMasks;
        uniform vec2 uRdDepthRimViewportSize;
        uniform vec2 uRdDepthRimNearFar;
        uniform float uRdDepthRimOrthographic;
        uniform vec2 uRdDepthRimAspectFix;
        uniform float uRdDepthRimFovOrOrthoFix;
        uniform float uRdDepthTexWidth;
        uniform float uRdDepthTexYOffset;
        uniform float uRdDepthRimLightDiffThreshold;
        uniform float uRdDepthShadowDiffThreshold;
        uniform vec2 uRdDepthRimAdditionalDirectionVS;
        uniform vec3 uRdDepthRimAdditionalColor;
        uniform vec3 uRdDepthRimMainColor;
        uniform float uRdDepthRimIsHair;
        uniform float uRdDepthRimIsGem;
        uniform float uRdDepthRimVertexColorGAvailable;
        varying float vRdDepthRimVertexColorG;

        float rdDepthRimLinearEye(float rawDepth) {
            float nearPlane = uRdDepthRimNearFar.x;
            float farPlane = uRdDepthRimNearFar.y;
            float perspectiveEye =
                (nearPlane * farPlane) /
                max(
                    farPlane - rawDepth * (farPlane - nearPlane),
                    0.0000001
                );
            float orthographicEye =
                rawDepth * (farPlane - nearPlane) + nearPlane;
            return mix(
                perspectiveEye,
                orthographicEye,
                step(0.5, uRdDepthRimOrthographic)
            );
        }

        float rdDepthRimFetchEye(ivec2 pixel) {
            return rdDepthRimLinearEye(
                texelFetch(uRdCameraDepthTexture, pixel, 0).r
            );
        }

        ${shader.fragmentShader}
    `.replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        #include <opaque_fragment>

        if (
            uRdDepthRimExperimentEnabled > 0.5 &&
            uRdDepthRimVertexColorGAvailable > 0.5
        ) {
            float rdDepthCenterZ = rdDepthRimLinearEye(gl_FragCoord.z);
            float rdDepthDistanceScale = mix(
                1.0 / max(rdDepthCenterZ, 0.0000001),
                0.850000024,
                step(0.5, uRdDepthRimOrthographic)
            );
            float rdDepthWidth =
                vRdDepthRimVertexColorG * uRdDepthTexWidth;
            vec2 rdDepthExtent = vec2(
                rdDepthWidth * 0.660000026,
                rdDepthWidth * 0.660000026 + uRdDepthTexYOffset
            );
            rdDepthExtent *= uRdDepthRimAspectFix;
            rdDepthExtent *= uRdDepthRimFovOrOrthoFix;
            rdDepthExtent *= rdDepthDistanceScale;

            vec2 rdDepthMainDeltaPx =
                rdDepthExtent *
                rdToonMainLightDirection.xy *
                uRdDepthRimViewportSize;
            vec2 rdDepthAdditionalDeltaPx =
                rdDepthExtent *
                uRdDepthRimAdditionalDirectionVS *
                uRdDepthRimViewportSize;
            ivec2 rdDepthMaxPixel =
                ivec2(uRdDepthRimViewportSize) - ivec2(1);
            ivec2 rdDepthMainPixel = clamp(
                ivec2(trunc(gl_FragCoord.xy + rdDepthMainDeltaPx)),
                ivec2(0),
                rdDepthMaxPixel
            );
            ivec2 rdDepthAdditionalPixel = clamp(
                ivec2(trunc(gl_FragCoord.xy + rdDepthAdditionalDeltaPx)),
                ivec2(0),
                rdDepthMaxPixel
            );
            float rdDepthMainZ = rdDepthRimFetchEye(rdDepthMainPixel);
            float rdDepthAdditionalZ =
                rdDepthRimFetchEye(rdDepthAdditionalPixel);
            float rdDepthRimReference =
                rdDepthCenterZ + uRdDepthRimLightDiffThreshold;
            float rdDepthMainSignal = clamp(
                10.0 * (rdDepthMainZ - rdDepthRimReference),
                0.0,
                1.0
            );
            float rdDepthAdditionalSignal = clamp(
                10.0 * (rdDepthAdditionalZ - rdDepthRimReference),
                0.0,
                1.0
            );
            float rdDepthShadowSignal = clamp(
                50.0 * (
                    rdDepthMainZ -
                    (rdDepthCenterZ - uRdDepthShadowDiffThreshold)
                ),
                0.0,
                1.0
            );

            float rdDepthNdotV = saturate(
                dot(normal, geometryViewDir)
            );
            float rdDepthEdge =
                1.0 - uRdDepthRimIsHair * rdDepthNdotV;
            vec2 rdDepthRim = smoothstep(
                vec2(0.1),
                vec2(0.125),
                rdDepthEdge * vec2(
                    rdDepthMainSignal,
                    rdDepthAdditionalSignal
                )
            );

            if (uRdDepthRimDebugMasks > 0.5) {
                gl_FragColor.rgb = vec3(
                    rdDepthShadowSignal,
                    rdDepthRim.x,
                    rdDepthRim.y
                );
            } else {
                float rdDepthBaseLuma = dot(
                    rdToonBaseColor,
                    vec3(0.298911989, 0.586610973, 0.114478)
                );
                vec3 rdDepthLightCarrier = max(
                    mix(
                        rdToonSceneLightColor,
                        uGlobalCharacterLightingOverrideColor,
                        saturate(uGlobalCharacterLightingOverrideRatio)
                    ),
                    vec3(0.1)
                ) * (0.2 + 0.8 * rdToonBaseWeight);
                gl_FragColor.rgb +=
                    rdDepthLightCarrier *
                    rdDepthBaseLuma *
                    rdDepthRim.x *
                    uRdDepthRimMainColor;
                gl_FragColor.rgb +=
                    rdDepthLightCarrier *
                    rdDepthBaseLuma *
                    rdDepthRim.y *
                    uRdDepthRimAdditionalColor;
            }
        }
        `,
    )
}

export function updateDepthRimExperimentUniforms() {
    const state = reDriveCameraDepthUniformState
    state.debugMasks.value = DepthRimExperiment.debugMasks ? 1 : 0
    state.depthTexWidth.value = DepthRimExperiment.depthTexWidth
    state.depthTexYOffset.value = DepthRimExperiment.depthTexYOffset
    state.rimDiffThreshold.value = DepthRimExperiment.rimDiffThreshold
    state.shadowDiffThreshold.value = DepthRimExperiment.shadowDiffThreshold
    state.additionalDirectionVS.value.copy(
        DepthRimExperiment.additionalDirectionVS,
    )
    state.additionalColor.value.copy(DepthRimExperiment.additionalColor)
}

