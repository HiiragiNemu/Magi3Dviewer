import * as THREE from 'three';

export type ReDriveBlendMode = 0 | 1 | 2 | 3

export interface ReDriveParaffinFactorInput {
    uv: [number, number]
    globalMainLightDirectionVS: [number, number, number]
    useFixedLightDirection: boolean
    width: number
}

/**
 * Exact factor reconstructed from Shader Graphs/ReDrivePostProcess.
 *
 * Authority: globalgamemanagers.assets Material PathID 4, Shader PathID 62,
 * D3D11 fragment variants 69/89/93. The compiled shader uses a fixed
 * (0, -12.99, 0) origin when _UseFixedLightDir is enabled; otherwise it uses
 * the negated normalized _GlobalMainLightDirVS.
 */
export function calculateReDriveParaffinFactor({
    uv,
    globalMainLightDirectionVS,
    useFixedLightDirection,
    width,
}: ReDriveParaffinFactorInput) {
    let origin: [number, number, number]
    if (useFixedLightDirection) {
        origin = [0, -12.99, 0]
    } else {
        const [x, y, z] = globalMainLightDirectionVS
        const length = Math.hypot(x, y, z)
        origin = length > 0
            ? [-x / length, -y / length, -z / length]
            : [0, 0, 1]
    }
    const x = (uv[0] * 2 - 1) * 0.5 + origin[0]
    const y = (uv[1] * 2 - 1) * 0.5 + origin[1]
    const z = origin[2]
    const factor = Math.hypot(x, y, z) / Math.max(width, 0.0001)
    return THREE.MathUtils.clamp(factor, 0, 1)
}

export function reDriveBlendChannel(
    base: number,
    blend: number,
    mode: ReDriveBlendMode,
) {
    if (mode === 1) return base * blend
    if (mode === 2) {
        return base < 0.5
            ? 2 * base * blend
            : 1 - 2 * (1 - base) * (1 - blend)
    }
    if (mode === 3) {
        return blend < 0.5
            ? 2 * base * blend
            : 1 - 2 * (1 - base) * (1 - blend)
    }
    return 1 - (1 - base) * (1 - blend)
}

export const ReDriveParaffinShader = {
    uniforms: {
        tDiffuse: { value: null },
        uEnabled: { value: 0 },
        uTopColor: { value: new THREE.Color(1, 1, 1) },
        uBottomColor: { value: new THREE.Color(1, 1, 1) },
        uOpacity: { value: 0 },
        uParaWidth: { value: 1 },
        uTopBlendMode: { value: 0 },
        uBottomBlendMode: { value: 0 },
        uUseFixedLightDirection: { value: 0 },
        uGlobalMainLightDirectionVS: {
            value: new THREE.Vector3(0, 0, -1),
        },
    },
    vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uEnabled;
        uniform vec3 uTopColor;
        uniform vec3 uBottomColor;
        uniform float uOpacity;
        uniform float uParaWidth;
        uniform int uTopBlendMode;
        uniform int uBottomBlendMode;
        uniform float uUseFixedLightDirection;
        uniform vec3 uGlobalMainLightDirectionVS;
        varying vec2 vUv;

        vec3 rdScreen(vec3 base, vec3 blend) {
            return 1.0 - (1.0 - base) * (1.0 - blend);
        }
        vec3 rdOverlay(vec3 base, vec3 blend) {
            return mix(
                2.0 * base * blend,
                1.0 - 2.0 * (1.0 - base) * (1.0 - blend),
                step(vec3(0.5), base)
            );
        }
        vec3 rdHardLight(vec3 base, vec3 blend) {
            return mix(
                2.0 * base * blend,
                1.0 - 2.0 * (1.0 - base) * (1.0 - blend),
                step(vec3(0.5), blend)
            );
        }
        vec3 rdBlend(vec3 base, vec3 blend, int mode) {
            if (mode == 1) return base * blend;
            if (mode == 2) return rdOverlay(base, blend);
            if (mode == 3) return rdHardLight(base, blend);
            return rdScreen(base, blend);
        }

        void main() {
            vec4 source = texture2D(tDiffuse, vUv);
            if (uEnabled < 0.5 || uOpacity <= 0.0001) {
                gl_FragColor = source;
                return;
            }

            vec3 paraOrigin;
            if (uUseFixedLightDirection > 0.5) {
                paraOrigin = vec3(0.0, -12.99, 0.0);
            } else {
                paraOrigin = -normalize(uGlobalMainLightDirectionVS);
            }
            vec3 screenPosition = vec3(vUv * 2.0 - 1.0, 0.0);
            float factor = clamp(
                length(screenPosition * 0.5 + paraOrigin)
                    / max(uParaWidth, 0.0001),
                0.0,
                1.0
            );
            vec3 topResult = rdBlend(source.rgb, uTopColor, uTopBlendMode);
            vec3 bottomResult = rdBlend(
                source.rgb,
                uBottomColor,
                uBottomBlendMode
            );
            vec3 paraffin = mix(topResult, bottomResult, factor);
            vec3 color = mix(
                source.rgb,
                paraffin,
                clamp(uOpacity, 0.0, 1.0)
            );
            gl_FragColor = vec4(color, source.a);
        }
    `,
}
