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
        uHueShift: { value: 0 },
        uColorFilter: { value: new THREE.Color(1, 1, 1) },
        /** 0=None, 1=Unity URP 2022.3 ACES. */
        uToneMappingMode: { value: 0 },
        uVignetteEnabled: { value: 0 },
        uVignetteColor: { value: new THREE.Color(0, 0, 0) },
        uVignetteCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uVignetteIntensity: { value: 0 },
        uVignetteSmoothness: { value: 0.2 },
        uVignetteRounded: { value: 0 },
        uVignetteAspectRatio: { value: 1 },
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
        uniform float uHueShift;
        uniform vec3 uColorFilter;
        uniform float uToneMappingMode;
        uniform float uVignetteEnabled;
        uniform vec3 uVignetteColor;
        uniform vec2 uVignetteCenter;
        uniform float uVignetteIntensity;
        uniform float uVignetteSmoothness;
        uniform float uVignetteRounded;
        uniform float uVignetteAspectRatio;
        varying vec2 vUv;

        const float RD_PI = 3.141592653589793;
        const float RD_ACESCC_MIDGRAY = 0.4135884;
        const vec3 RD_AP1_RGB2Y = vec3(0.272229, 0.674082, 0.0536895);

        // Unity Graphics 2022.3/staging, ACES.hlsl. Row-dot helpers avoid
        // HLSL/GLSL matrix-layout ambiguity.
        vec3 rdSrgbToAp0(vec3 x) {
            return vec3(
                dot(vec3(0.4397010, 0.3829780, 0.1773350), x),
                dot(vec3(0.0897923, 0.8134230, 0.0967616), x),
                dot(vec3(0.0175440, 0.1115440, 0.8707040), x)
            );
        }
        vec3 rdAp0ToAp1(vec3 x) {
            return vec3(
                dot(vec3(1.4514393161, -0.2365107469, -0.2149285693), x),
                dot(vec3(-0.0765537734, 1.1762296998, -0.0996759264), x),
                dot(vec3(0.0083161484, -0.0060324498, 0.9977163014), x)
            );
        }
        vec3 rdAp1ToAp0(vec3 x) {
            return vec3(
                dot(vec3(0.6954522414, 0.1406786965, 0.1638690622), x),
                dot(vec3(0.0447945634, 0.8596711185, 0.0955343182), x),
                dot(vec3(-0.0055258826, 0.0040252103, 1.0015006723), x)
            );
        }
        vec3 rdAp1ToXyz(vec3 x) {
            return vec3(
                dot(vec3(0.6624541811, 0.1340042065, 0.1561876870), x),
                dot(vec3(0.2722287168, 0.6740817658, 0.0536895174), x),
                dot(vec3(-0.0055746495, 0.0040607335, 1.0103391003), x)
            );
        }
        vec3 rdXyzToAp1(vec3 x) {
            return vec3(
                dot(vec3(1.6410233797, -0.3248032942, -0.2364246952), x),
                dot(vec3(-0.6636628587, 1.6153315917, 0.0167563477), x),
                dot(vec3(0.0117218943, -0.0082844420, 0.9883948585), x)
            );
        }
        vec3 rdD60ToD65(vec3 x) {
            return vec3(
                dot(vec3(0.98722400, -0.00611327, 0.0159533), x),
                dot(vec3(-0.00759836, 1.00186000, 0.0053302), x),
                dot(vec3(0.00307257, -0.00509595, 1.0816800), x)
            );
        }
        vec3 rdXyzToRec709(vec3 x) {
            return vec3(
                dot(vec3(3.2409699419, -1.5373831776, -0.4986107603), x),
                dot(vec3(-0.9692436363, 1.8759675015, 0.0415550574), x),
                dot(vec3(0.0556300797, -0.2039769589, 1.0569715142), x)
            );
        }

        float rdAcesToAcesCc(float x) {
            x = clamp(x, 0.0, 65504.0);
            return x < 0.00003051757
                ? (log2(0.00001525878 + x * 0.5) + 9.72) / 17.52
                : (log2(x) + 9.72) / 17.52;
        }
        vec3 rdAcesToAcesCc(vec3 x) {
            return vec3(
                rdAcesToAcesCc(x.r),
                rdAcesToAcesCc(x.g),
                rdAcesToAcesCc(x.b)
            );
        }
        float rdAcesCcToAces(float x) {
            if (x < -0.3013698630) {
                return (exp2(x * 17.52 - 9.72) - exp2(-16.0)) * 2.0;
            }
            if (x < (log2(65504.0) + 9.72) / 17.52) {
                return exp2(x * 17.52 - 9.72);
            }
            return 65504.0;
        }
        vec3 rdAcesCcToAces(vec3 x) {
            return vec3(
                rdAcesCcToAces(x.r),
                rdAcesCcToAces(x.g),
                rdAcesCcToAces(x.b)
            );
        }

        float rdRgbSaturation(vec3 rgb) {
            float mi = min(rgb.r, min(rgb.g, rgb.b));
            float ma = max(rgb.r, max(rgb.g, rgb.b));
            return (max(ma, 1e-4) - max(mi, 1e-4)) / max(ma, 1e-2);
        }
        float rdRgbYc(vec3 rgb) {
            float k = rgb.b * (rgb.b - rgb.g)
                + rgb.g * (rgb.g - rgb.r)
                + rgb.r * (rgb.r - rgb.b);
            return (rgb.r + rgb.g + rgb.b + 1.75 * sqrt(max(k, 0.0))) / 3.0;
        }
        float rdRgbHue(vec3 rgb) {
            if (rgb.r == rgb.g && rgb.g == rgb.b) return 0.0;
            float hue = (180.0 / RD_PI) * atan(
                sqrt(3.0) * (rgb.g - rgb.b),
                2.0 * rgb.r - rgb.g - rgb.b
            );
            return hue < 0.0 ? hue + 360.0 : hue;
        }
        float rdCenterHue(float hue) {
            float centered = hue;
            if (centered < -180.0) centered += 360.0;
            else if (centered > 180.0) centered -= 360.0;
            return centered;
        }
        float rdSigmoidShaper(float x) {
            float t = max(1.0 - abs(x * 0.5), 0.0);
            return (1.0 + sign(x) * (1.0 - t * t)) * 0.5;
        }
        float rdGlow(float yc, float gain, float mid) {
            if (yc <= (2.0 / 3.0) * mid) return gain;
            if (yc >= 2.0 * mid) return 0.0;
            return gain * (mid / yc - 0.5);
        }
        vec3 rdDarkToDimSurround(vec3 linearCv) {
            vec3 xyz = rdAp1ToXyz(linearCv);
            float divisor = max(xyz.x + xyz.y + xyz.z, 1e-4);
            vec3 xyY = vec3(xyz.x / divisor, xyz.y / divisor, xyz.y);
            xyY.z = pow(clamp(xyY.z, 0.0, 65504.0), 0.9811);
            float m = xyY.z / max(xyY.y, 1e-4);
            xyz = vec3(xyY.x * m, xyY.z, (1.0 - xyY.x - xyY.y) * m);
            return rdXyzToAp1(xyz);
        }
        vec3 rdAcesTonemap(vec3 aces) {
            float saturation = rdRgbSaturation(aces);
            float yc = rdRgbYc(aces);
            float sigmoid = rdSigmoidShaper((saturation - 0.4) / 0.2);
            aces *= 1.0 + rdGlow(yc, 0.05 * sigmoid, 0.08);

            float centeredHue = rdCenterHue(rdRgbHue(aces));
            float hueWeight = smoothstep(
                0.0,
                1.0,
                1.0 - abs(2.0 * centeredHue / 135.0)
            );
            hueWeight *= hueWeight;
            aces.r += hueWeight * saturation * (0.03 - aces.r) * 0.18;

            vec3 acesCg = max(rdAp0ToAp1(aces), vec3(0.0));
            float luma = dot(acesCg, RD_AP1_RGB2Y);
            acesCg = mix(vec3(luma), acesCg, 0.96);
            vec3 rgbPost = (
                acesCg * (acesCg + 0.0245786) - 0.000090537
            ) / (
                acesCg * (0.983729 * acesCg + 0.4329510) + 0.238081
            );
            vec3 linearCv = rdDarkToDimSurround(rgbPost);
            luma = dot(linearCv, RD_AP1_RGB2Y);
            linearCv = mix(vec3(luma), linearCv, 0.93);
            return rdXyzToRec709(rdD60ToD65(rdAp1ToXyz(linearCv)));
        }

        // Unity ColorAdjustments hue is evaluated in the ACEScg grading space.
        vec3 rdRgbToHsv(vec3 c) {
            vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
            vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
            vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
            float d = q.x - min(q.w, q.y);
            float e = 1e-10;
            return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
        }
        vec3 rdHsvToRgb(vec3 c) {
            vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
            return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
        }
        vec3 rdUnityAcesGrade(vec3 color) {
            color *= exp2(uPostExposure);
            vec3 colorLog = rdAcesToAcesCc(rdSrgbToAp0(color));
            float contrast = 1.0 + uContrast * 0.01;
            colorLog = (colorLog - RD_ACESCC_MIDGRAY) * contrast
                + RD_ACESCC_MIDGRAY;
            vec3 colorAp1 = rdAp0ToAp1(rdAcesCcToAces(colorLog));
            colorAp1 = max(colorAp1 * uColorFilter, vec3(0.0));
            if (abs(uHueShift) > 0.0001) {
                vec3 hsv = rdRgbToHsv(colorAp1);
                hsv.x = fract(hsv.x + uHueShift / 360.0);
                colorAp1 = rdHsvToRgb(hsv);
            }
            float luma = dot(colorAp1, RD_AP1_RGB2Y);
            colorAp1 = vec3(luma)
                + (1.0 + uSaturation * 0.01) * (colorAp1 - vec3(luma));
            return rdAcesTonemap(rdAp1ToAp0(max(colorAp1, vec3(0.0))));
        }

        void main() {
            vec4 source = texture2D(tDiffuse, vUv);
            vec3 color = source.rgb;

            if (uVignetteEnabled > 0.5 && uVignetteIntensity > 0.0001) {
                // Unity URP 14 (Unity 2022.3) SetupVignette multiplies the
                // serialized intensity by 3 and smoothness by 5. Common.hlsl
                // then applies a multiplicative vignette before color grading.
                vec2 dist = abs(vUv - uVignetteCenter)
                    * (uVignetteIntensity * 3.0);
                float roundness = mix(
                    1.0,
                    uVignetteAspectRatio,
                    clamp(uVignetteRounded, 0.0, 1.0)
                );
                dist.x *= roundness;
                float vfactor = pow(
                    clamp(1.0 - dot(dist, dist), 0.0, 1.0),
                    max(uVignetteSmoothness * 5.0, 0.0001)
                );
                color *= mix(uVignetteColor, vec3(1.0), vfactor);
            }

            if (uToneMappingMode > 0.5) {
                color = rdUnityAcesGrade(color);
            } else if (uColorAdjustEnabled > 0.5) {
                color *= uColorFilter;
                color *= exp2(uPostExposure);

                float contrast = 1.0 + uContrast * 0.01;
                color = (color - vec3(0.5)) * contrast + vec3(0.5);

                float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
                float saturation = 1.0 + uSaturation * 0.01;
                color = mix(vec3(luma), color, saturation);
            }

            gl_FragColor = vec4(max(color, vec3(0.0)), source.a);
        }
    `,
}
