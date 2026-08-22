import * as THREE from 'three'
import type { OfficialMaterialProfile } from '../materialProfile'

/**
 * Runtime controls for the recovered JP 2022.3.62f2 CameraDepthTexture pass.
 * Serialized material values are authoritative; these controls only own the
 * shared pass/debug state and the scene-provided additional-rim light.
 */
export const DepthRimExperiment = {
    enabled: true,
    debugMasks: false,
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

/** Shared frame uniforms. Serialized material values remain per draw. */
export const reDriveCameraDepthUniformState = {
    enabled: { value: 0 },
    debugMasks: { value: 0 },
    map: { value: fallbackDepth as THREE.Texture },
    viewportSize: { value: new THREE.Vector2(1, 1) },
    nearFar: { value: new THREE.Vector2(0.1, 1000) },
    orthographic: { value: 0 },
    aspectFix: { value: new THREE.Vector2(1, 1) },
    fovOrOrthoFix: { value: 1 },
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
    const depthRim = profile?.depthRim
    setNumber('uRdDepthRimProfilePresent', profile ? 1 : 0)
    setNumber('uRdDepthUseDepthTex', depthRim?.useDepthTex ? 1 : 0)
    setNumber('uRdDepthUseRimLight', depthRim?.useRimLight ? 1 : 0)
    setNumber('uRdDepthDitherFade', depthRim?.ditherFade ?? 0)
    setNumber('uRdDepthTexWidth', depthRim?.width ?? 1)
    setNumber('uRdDepthTexYOffset', depthRim?.yOffset ?? 0)
    setNumber(
        'uRdDepthRimLightDiffThreshold',
        depthRim?.rimDiffThreshold ?? 0.02,
    )
    setNumber(
        'uRdDepthShadowDiffThreshold',
        depthRim?.shadowDiffThreshold ?? 0.03,
    )

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
 * Inject the official Body/Hair CameraDepthTexture path at three explicit
 * points in the reconstructed forward program:
 *  1. sample depth before the toon ramp;
 *  2. apply the >= 0.1 depth-shadow selector before ShadowFeather;
 *  3. add rim light with the already-computed scene-light carrier.
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
        uniform float uRdDepthRimProfilePresent;
        uniform float uRdDepthUseDepthTex;
        uniform float uRdDepthUseRimLight;
        uniform float uRdDepthDitherFade;
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

        float rdDepthRimDitherBayer(ivec2 pixel) {
            int x = int(mod(float(pixel.x), 4.0));
            int y = int(mod(float(pixel.y), 4.0));
            int index = x * 4 + y;
            if (index == 0) return 0.0588235296;
            if (index == 1) return 0.529411793;
            if (index == 2) return 0.176470593;
            if (index == 3) return 0.647058845;
            if (index == 4) return 0.764705896;
            if (index == 5) return 0.294117659;
            if (index == 6) return 0.882352948;
            if (index == 7) return 0.411764711;
            if (index == 8) return 0.235294119;
            if (index == 9) return 0.70588237;
            if (index == 10) return 0.117647059;
            if (index == 11) return 0.588235319;
            if (index == 12) return 0.941176474;
            if (index == 13) return 0.470588237;
            if (index == 14) return 0.823529422;
            return 0.352941185;
        }

        ${shader.fragmentShader}
    `.replace(
        '// RD_DEPTH_RIM_SAMPLE_BEGIN',
        /* glsl */ `
        float rdDepthShadowSignal = 1.0;
        vec2 rdDepthRim = vec2(0.0);
        float rdDepthProfileEnabled =
            step(0.5, uRdDepthRimExperimentEnabled) *
            step(0.5, uRdDepthRimProfilePresent);

        if (rdDepthProfileEnabled > 0.5) {
            float rdDepthDitherValue = rdDepthRimDitherBayer(
                ivec2(gl_FragCoord.xy)
            );
            float rdDepthDitherTest =
                (1.0 - uRdDepthDitherFade) -
                (
                    uRdDepthDitherFade *
                    (0.5 - rdDepthDitherValue) +
                    0.5
                );
            if (rdDepthDitherTest < 0.0) discard;
        }

        float rdDepthChainEnabled =
            rdDepthProfileEnabled *
            step(0.5, uRdDepthUseDepthTex) *
            step(0.5, uRdDepthRimVertexColorGAvailable);
        if (
            rdDepthChainEnabled > 0.5 &&
            uRdDepthDitherFade <= 0.5
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
            rdDepthShadowSignal = clamp(
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
            rdDepthRim = smoothstep(
                vec2(0.1),
                vec2(0.125),
                rdDepthEdge * vec2(
                    rdDepthMainSignal,
                    rdDepthAdditionalSignal
                )
            );
            rdDepthRim *= step(0.5, uRdDepthUseRimLight);
        }
        `,
    ).replace(
        '// RD_DEPTH_SHADOW_SELECTOR_BEGIN',
        /* glsl */ `
        float rdDepthShadowSelector =
            rdDepthShadowSignal >= 0.100000001 ? 1.0 : 0.0;
        rdToonRamp *= rdDepthShadowSelector;
        `,
    ).replace(
        '// RD_DEPTH_RIM_COMPOSITE_BEGIN',
        /* glsl */ `
        if (uRdDepthRimDebugMasks > 0.5) {
            outgoingLight = vec3(
                rdDepthShadowSignal,
                rdDepthRim.x,
                rdDepthRim.y
            );
        } else {
            float rdDepthBaseLuma = dot(
                rdToonBaseColor,
                vec3(0.298911989, 0.586610973, 0.114478)
            );
            vec3 rdDepthLightCarrier =
                rdToonSceneLightColor *
                (rdToonBaseWeight * 0.800000012 + 0.200000003);
            outgoingLight +=
                rdDepthLightCarrier *
                rdDepthBaseLuma *
                rdDepthRim.x *
                uRdDepthRimMainColor;
            outgoingLight +=
                rdDepthLightCarrier *
                rdDepthBaseLuma *
                rdDepthRim.y *
                uRdDepthRimAdditionalColor;
        }
        `,
    )
}

export function updateDepthRimExperimentUniforms() {
    const state = reDriveCameraDepthUniformState
    state.debugMasks.value = DepthRimExperiment.debugMasks ? 1 : 0
    state.additionalDirectionVS.value.copy(
        DepthRimExperiment.additionalDirectionVS,
    )
    state.additionalColor.value.copy(DepthRimExperiment.additionalColor)
}
