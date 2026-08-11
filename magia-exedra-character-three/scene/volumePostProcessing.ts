import * as THREE from 'three'

/**
 * Runtime subset of Unity/URP Volume post processing used by recovered stages.
 *
 * The serialized values stay in Unity units: exposure is EV, contrast and
 * saturation are percentages, and vignette intensity/smoothness are [0, 1].
 * This is deliberately a separate full-composite pass; ReDrive's background-
 * only grading remains in backgroundColorAdjustments.ts.
 */
export const ReDriveVolumePostProcessingShader = {
    uniforms: {
        tDiffuse: { value: null },
        uColorAdjustEnabled: { value: 0 },
        uPostExposure: { value: 0 },
        uContrast: { value: 0 },
        uSaturation: { value: 0 },
        uColorFilter: { value: new THREE.Color(1, 1, 1) },
        uVignetteEnabled: { value: 0 },
        uVignetteColor: { value: new THREE.Color(0, 0, 0) },
        uVignetteCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uVignetteIntensity: { value: 0 },
        uVignetteSmoothness: { value: 0.2 },
        uVignetteRounded: { value: 0 },
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
        uniform float uColorAdjustEnabled;
        uniform float uPostExposure;
        uniform float uContrast;
        uniform float uSaturation;
        uniform vec3 uColorFilter;
        uniform float uVignetteEnabled;
        uniform vec3 uVignetteColor;
        uniform vec2 uVignetteCenter;
        uniform float uVignetteIntensity;
        uniform float uVignetteSmoothness;
        uniform float uVignetteRounded;
        varying vec2 vUv;

        void main() {
            vec4 source = texture2D(tDiffuse, vUv);
            vec3 color = source.rgb;

            if (uColorAdjustEnabled > 0.5) {
                color *= uColorFilter;
                color *= exp2(uPostExposure);

                float contrast = 1.0 + uContrast * 0.01;
                color = (color - vec3(0.5)) * contrast + vec3(0.5);

                float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
                float saturation = 1.0 + uSaturation * 0.01;
                color = mix(vec3(luma), color, saturation);
            }

            if (uVignetteEnabled > 0.5 && uVignetteIntensity > 0.0001) {
                vec2 delta = abs(vUv - uVignetteCenter) * 2.0;
                // Rounded is retained in the runtime contract. The 603 source
                // leaves its override disabled, so this branch stays neutral.
                delta.x *= mix(1.0, 0.75, clamp(uVignetteRounded, 0.0, 1.0));
                float radius = max(1.0 - uVignetteIntensity, 0.0001);
                float softness = max(uVignetteSmoothness, 0.0001);
                float keep = 1.0 - smoothstep(
                    max(radius - softness, 0.0),
                    radius + softness,
                    length(delta)
                );
                color = mix(uVignetteColor, color, keep);
            }

            gl_FragColor = vec4(max(color, vec3(0.0)), source.a);
        }
    `,
}
