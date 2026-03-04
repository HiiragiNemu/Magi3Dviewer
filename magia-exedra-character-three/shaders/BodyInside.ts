import * as THREE from 'three';
import { createGeneralMaterial, diffuseColorManipulationEndFlag, type MaterialCreationOptions, type MaterialCreationResult } from '.';
import { loadTexture } from '../texture';
import { ObjFindByKey } from '../utils';
import type GUI from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { getClockDelta } from '../renderer';

const bodyInsideOptions = {
    wrap: THREE.RepeatWrapping,
    offsetX: 0.0,
    offsetY: 0.0,
    scale: 1.5,
    speed: 0.025,
    starBrightness: 0.67,
    starBlinkInterval: 8,
}

interface BodyInsideMaterialCreationResult extends MaterialCreationResult {
    animate: Function
}

/**
 * ```txt
 * body_color ---\
 *                mix, factor=body_ctrl[red] --\
 * body_shadow --/                              \
 *                                               |--> final texture
 * [UV1]dress_inside, UV1.xy > 0 ---------------/
 * 
 *                             body_shadow[alpha] --> final alpha map
 * ```
 */
export async function createBodyInsideMaterial(options: MaterialCreationOptions, modelTextures: Record<string, string>): Promise<BodyInsideMaterialCreationResult> {
    const insideTex = await loadTexture(ObjFindByKey(modelTextures, x =>
        x.includes('space') || // ultimate madoka (body_space_color)
        x.includes('inside') // akuma homura (body_inside_color)
    )!, { colorSpace: THREE.SRGBColorSpace })

    insideTex.wrapS = bodyInsideOptions.wrap
    insideTex.wrapT = bodyInsideOptions.wrap

    const starImgUrl = ObjFindByKey(modelTextures, x => x.includes('star'))
    const starTex = starImgUrl ? await loadTexture(starImgUrl) : undefined

    if (starTex) {
        starTex.wrapS = bodyInsideOptions.wrap
        starTex.wrapT = bodyInsideOptions.wrap
    }

    let shader: THREE.WebGLProgramParametersWithUniforms | undefined = undefined

    const result = await createGeneralMaterial({
        ...options,
        alphaSrc: 'shadow', // only effective for ultimate madoka. akuma homura's maps are fully opaque

        onBeforeCompile(s) {
            shader = s

            shader.uniforms.tInside = { value: insideTex }
            shader.uniforms.uInsideOffsetX = { value: bodyInsideOptions.offsetX }
            shader.uniforms.uInsideOffsetY = { value: bodyInsideOptions.offsetY }
            shader.uniforms.uInsideScale = { value: bodyInsideOptions.scale }

            shader.uniforms.tStar = { value: starTex }
            shader.uniforms.uStarBrightness = { value: bodyInsideOptions.starBrightness }

            if (!shader.defines) shader.defines = {}
            if (starTex) {
                shader.defines.HAS_STAR = true
            }

            // dress inside uses UV1
            shader.vertexShader = /*glsl*/`
                attribute vec2 uv1;
                varying vec2 vUv1;

                varying vec2 vInsideUV;
                uniform float uInsideOffsetX;
                uniform float uInsideOffsetY;
                uniform float uInsideScale;
                
                ${shader.vertexShader}
            `.replace(
                '#include <uv_vertex>',
                /*glsl*/`
                #include <uv_vertex>
                vUv1 = uv1;
                `
            ).replace(
                '#include <project_vertex>',
                /*glsl*/`
                #include <project_vertex>
                vInsideUV = (mvPosition.xy // creates the 'portal' effect
                    // - (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xy // subtract the model view offset, so it moves along with the model
                    - vec2(uInsideOffsetX, uInsideOffsetY) // correct the offset of the texture
                    ) * uInsideScale // controls the size of the texture
                    /* adjust the scale and offset accordingly to let it fit the dress */
                    + vec2(0.5, 0.5) // normalize scale offset to center
                    ;
                `
            )

            shader.fragmentShader = /*glsl*/`
                varying vec2 vUv1;

                varying vec2 vInsideUV;
                uniform sampler2D tInside;
                uniform sampler2D tStar;
                uniform float uStarBrightness;

                ${shader.fragmentShader}
            `.replace(
                diffuseColorManipulationEndFlag,
                /*glsl*/`
                vec4 texInside = texture2D(tInside, vInsideUV);
                #ifdef HAS_STAR
                    vec4 texStar = texture2D(tStar, vInsideUV);
                #endif

                if (vUv1.x > 0.0 && vUv1.y > 0.0) {
                    diffuseColor.rgb = texInside.rgb; // replace color if UV1 > 0
                    #ifdef HAS_STAR
                        diffuseColor.rgb += texStar.rgb * uStarBrightness;
                    #endif
                }
                ${diffuseColorManipulationEndFlag}
                `
            )

            Object.assign(window, { bodyInsideShader: shader })
        },
    })

    result.textures.push(insideTex)
    if (starTex) {
        result.textures.push(starTex)
    }

    let elapsed = 0
    function animate() {
        if (!shader) return

        const delta = getClockDelta()
        elapsed += delta
        elapsed %= bodyInsideOptions.starBlinkInterval

        shader.uniforms.uInsideOffsetX.value -= delta * bodyInsideOptions.speed
        shader.uniforms.uInsideOffsetY.value -= delta * bodyInsideOptions.speed

        shader.uniforms.uStarBrightness.value = THREE.MathUtils.smoothstep(
            Math.abs((elapsed % bodyInsideOptions.starBlinkInterval) / bodyInsideOptions.starBlinkInterval * 2 - 1),
            0.1, 1
        )
    }

    return { ...result, animate }
}

if (false) {
    setTimeout(() => {
        function setShader(callback: (shader: THREE.WebGLProgramParametersWithUniforms) => any) {
            const shader = (window as any).bodyInsideShader
            if (shader) {
                callback(shader)
            }
        }

        const gui = (window as any).gui as GUI | undefined

        if (gui) {
            const folder = gui.addFolder('Debug (BodyInside)')

            folder.add(bodyInsideOptions, 'offsetX', -1, 1, 0.01).onChange(value => setShader(x => x.uniforms.uInsideOffsetX.value = value))
            folder.add(bodyInsideOptions, 'offsetY', -1, 1, 0.01).onChange(value => setShader(x => x.uniforms.uInsideOffsetY.value = value))
            folder.add(bodyInsideOptions, 'scale', 0.1, 5, 0.01).onChange(value => setShader(x => x.uniforms.uInsideScale.value = value))
            folder.add(bodyInsideOptions, 'starBrightness', 0, 1, 0.01).onChange(value => setShader(x => x.uniforms.uStarBrightness.value = value))

            folder.add({ Reset: () => folder.reset() }, 'Reset')
        }
    }, 0);
}
