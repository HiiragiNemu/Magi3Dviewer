import * as THREE from 'three'
import type { StageMaterialBinding } from './stageMaterialBindings'

export const SHADOW_ONLY_SOURCE = 'Creative/Bg/BgShadowOnlyShader_Trs'

/** Native GLES Universal Forward (JP shader -3296666697305076964): the
 * material colour's alpha is NOT the opacity. Only the main-light shadow and
 * view-angle gate generate opacity. Unshadowed ground must remain transparent. */
export function nativeShadowOnlyAlpha(attenuation: number, normalDotView: number, power: number): number {
    const clamp = (n: number) => Math.min(1, Math.max(0, n))
    if (![attenuation, normalDotView, power].every(Number.isFinite) || power <= 0) return 0
    return clamp((1 - clamp(attenuation)) * Math.pow(1 - clamp(normalDotView), power))
}

/** Reuse the existing stage's native main-light CSM receiver, not a second
 * shadow pass or a full PBR white plane. Other lights do not generate opacity. */
export function createStageShadowOnlyMaterial(binding: StageMaterialBinding): THREE.MeshStandardMaterial {
    if (binding.sourceShader !== SHADOW_ONLY_SOURCE) throw new Error('Not a native shadow-only surface')
    const color = binding.serializedColors?._ShadowColor
    const power = binding.serializedFloats?._frenelPower
    if (!Array.isArray(color) || color.length < 3 || !color.slice(0, 3).every(Number.isFinite)
        || !Number.isFinite(power) || power! <= 0) {
        throw new Error('Native shadow-only colour or Fresnel power is missing')
    }
    const material = new THREE.MeshStandardMaterial({
        color: 0xffffff, metalness: 0, roughness: 1,
        transparent: true, depthWrite: false, depthTest: true,
        depthFunc: THREE.LessEqualDepth, side: THREE.FrontSide, fog: false,
        blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    })
    const shadowColor = new THREE.Color(color[0], color[1], color[2])
    material.onBeforeCompile = shader => {
        shader.uniforms.stageOnlyColor = { value: shadowColor }
        shader.uniforms.stageOnlyFresnelPower = { value: power }
        const csmSample = 'directLight.color *= mix( stageMainShadow, 1.0, stageMainShadowFade );'
        const ordinarySample = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;'
        let lights = THREE.ShaderChunk.lights_fragment_begin
        if (material.defines?.USE_CSM !== undefined) {
            if (!lights.includes(csmSample)) throw new Error('Native shadow-only CSM receiver no longer matches')
            lights = lights.replace(csmSample,
                'stageOnlyShadow = mix( stageMainShadow, 1.0, stageMainShadowFade );\n' + csmSample)
        } else {
            if (!lights.includes(ordinarySample)) throw new Error('Native shadow-only directional receiver no longer matches')
            lights = lights.replace(ordinarySample, `
                #if ( UNROLLED_LOOP_INDEX == 0 )
                stageOnlyShadow = ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
                #endif
                ${ordinarySample}`)
        }
        const lightingInclude = '#include <lights_fragment_begin>'
        const outputInclude = '#include <opaque_fragment>'
        if (!shader.fragmentShader.includes(lightingInclude) || !shader.fragmentShader.includes(outputInclude)) {
            throw new Error('Native shadow-only carrier shader contract changed')
        }
        shader.fragmentShader = 'uniform vec3 stageOnlyColor;\nuniform float stageOnlyFresnelPower;\n'
            + shader.fragmentShader
                .replace(lightingInclude, 'float stageOnlyShadow = 1.0;\n' + lights)
                .replace(outputInclude, `
                    float stageOnlyAngle = pow(1.0 - clamp(dot(normalize(geometryNormal), normalize(geometryViewDir)), 0.0, 1.0), stageOnlyFresnelPower);
                    gl_FragColor = vec4(stageOnlyColor, clamp((1.0 - stageOnlyShadow) * stageOnlyAngle, 0.0, 1.0));`)
    }
    material.customProgramCacheKey = () => 'native-shadow-only-main-csm-v1'
    material.userData.stageNativeSurface = {
        sourceShader: SHADOW_ONLY_SOURCE, policy: 'main-light-shadow-times-native-fresnel',
        colourAlphaIsOpacity: false, opaqueFallback: false,
    }
    // No vertex deformation; static batching retains this material callback.
    material.userData.stageRigidVertexPosition = true
    material.userData.stageRigidBatchBinding = JSON.stringify(binding)
    // Lightmap/probe bindings may clone a Standard material. Keep the native
    // shader policy rather than silently returning to an opaque PBR carrier.
    material.clone = function () {
        const result = createStageShadowOnlyMaterial(binding)
        result.copy(this)
        return result as typeof this
    }
    return material
}
