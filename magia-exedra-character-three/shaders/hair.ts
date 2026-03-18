import * as THREE from 'three';
import { createGeneralMaterial, diffuseColorManipulationEndFlag, type MaterialCreationOptions, type MaterialCreationResult } from '.';
import { loadTexture } from '../texture';
import type GUI from 'three/examples/jsm/libs/lil-gui.module.min.js';
import AngelRingMap from './RDToon_AngelRingMap.png'

const angelRingOptions = {
    offsetX: 0,
    offsetY: 1.475,
    scale: 1.25,
}

export async function createHairMaterial(options: MaterialCreationOptions): Promise<MaterialCreationResult> {
    return createGeneralMaterial(options)

    // TODO: Angel ring

    const angelRingTex = await loadTexture(AngelRingMap, { colorSpace: THREE.SRGBColorSpace })

    angelRingTex.wrapS = THREE.ClampToEdgeWrapping
    angelRingTex.wrapT = THREE.ClampToEdgeWrapping

    const result = await createGeneralMaterial({
        ...options,

        onBeforeCompile(shader) {
            shader.uniforms.tAngelRing = { value: angelRingTex }
            shader.uniforms.uAngelRingOffsetX = { value: angelRingOptions.offsetX }
            shader.uniforms.uAngelRingOffsetY = { value: angelRingOptions.offsetY }
            shader.uniforms.uAngelRingScale = { value: angelRingOptions.scale }

            shader.vertexShader = /*glsl*/`
                varying vec2 vAngelRingUV;
                uniform float uAngelRingOffsetX;
                uniform float uAngelRingOffsetY;
                uniform float uAngelRingScale;
                ${shader.vertexShader}
            `.replace(
                '#include <project_vertex>',
                /*glsl*/`
                #include <project_vertex>
                vAngelRingUV = (mvPosition.xy // creates the 'portal' effect
                    - (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xy // subtract the model view offset, so it moves along with the model
                    - vec2(uAngelRingOffsetX, uAngelRingOffsetY) // correct the offset of the texture
                    ) * uAngelRingScale // controls the size of the texture
                    + vec2(0.5, 0.5) // normalize scale origin to center
                    ;
                `
            )

            shader.fragmentShader = /*glsl*/`
                varying vec2 vAngelRingUV;
                uniform sampler2D tAngelRing;
                ${shader.fragmentShader}
            `.replace(
                diffuseColorManipulationEndFlag,
                /*glsl*/`
                vec4 texAngelRing = texture2D(tAngelRing, vAngelRingUV);
                diffuseColor.rgb += texAngelRing.rgb;
                ${diffuseColorManipulationEndFlag}
                `
            )

            Object.assign(window, { hairShader: shader })
        },
    })

    result.textures.push(angelRingTex)

    return result
}

if (false) {
    setTimeout(() => {
        function setShader(callback: (shader: THREE.WebGLProgramParametersWithUniforms) => any) {
            const shader = (window as any).hairShader
            if (shader) {
                callback(shader)
            }
        }

        const gui = (window as any).gui as GUI | undefined

        if (gui) {
            const folder = gui.addFolder('Debug (AngelRing)')

            folder.add(angelRingOptions, 'offsetX', -0.5, 0.5, 0.01).onChange(value => setShader(x => x.uniforms.uAngelRingOffsetX.value = value))
            folder.add(angelRingOptions, 'offsetY', 1.25, 1.6, 0.005).onChange(value => setShader(x => x.uniforms.uAngelRingOffsetY.value = value))
            folder.add(angelRingOptions, 'scale', 0.1, 2, 0.01).onChange(value => setShader(x => x.uniforms.uAngelRingScale.value = value))

            folder.add({ Reset: () => folder.reset() }, 'Reset')
        }
    }, 0);
}
