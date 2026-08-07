import * as THREE from 'three'

/**
 * Background-only subset of ReDriveVolume ColorAdjustments.
 *
 * The official client applies these values to the background path, separately
 * from characters. This shader is therefore inserted after the background
 * RenderPass and before the character RenderPass. Post exposure follows Unity's
 * EV convention (2^EV). Contrast/saturation retain Unity's percentage inputs;
 * the exact URP grading/LUT transfer curve remains a future parity target.
 */
export const ReDriveBackgroundColorAdjustmentsShader = {
    uniforms: {
        tDiffuse: { value: null },
        uEnabled: { value: 0 },
        uPostExposure: { value: 0 },
        uContrast: { value: 0 },
        uSaturation: { value: 0 },
        uGlobalTint: { value: new THREE.Color(1, 1, 1) },
        uBackgroundTint: { value: new THREE.Color(1, 1, 1) },
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
        uniform float uPostExposure;
        uniform float uContrast;
        uniform float uSaturation;
        uniform vec3 uGlobalTint;
        uniform vec3 uBackgroundTint;
        varying vec2 vUv;

        void main() {
            vec4 source = texture2D(tDiffuse, vUv);
            if (uEnabled < 0.5) {
                gl_FragColor = source;
                return;
            }

            vec3 color = source.rgb * uGlobalTint * uBackgroundTint;
            color *= exp2(uPostExposure);

            float contrast = 1.0 + uContrast * 0.01;
            color = (color - vec3(0.5)) * contrast + vec3(0.5);

            float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
            float saturation = 1.0 + uSaturation * 0.01;
            color = mix(vec3(luma), color, saturation);

            gl_FragColor = vec4(max(color, vec3(0.0)), source.a);
        }
    `,
}
