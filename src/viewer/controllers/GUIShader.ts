import { shadowOptions } from 'magia-exedra-character-three/shaders';
import { scene } from '../scene';
import { gui, guiOptions } from './GUI';
import { createSquareExponentController } from './GUIExtensions';

export const guiShader = gui.addFolder('Shader').close()

guiShader.add(guiOptions, 'ShadowEnabled').onChange(updateShadow)
guiShader.add(guiOptions, 'ShadowType', {
    BasicShadowMap: 0,
    PCFShadowMap: 1,
    PCFSoftShadowMap: 2,
    VSMShadowMap: 3,
}).onChange(updateShadow)
createSquareExponentController(guiShader, guiOptions, 'ShadowResolution', 512, scene.renderer.capabilities.maxTextureSize).onChange(updateShadow)
guiShader.add(guiOptions, 'ShadowBias', -0.0001, 0).onChange(updateShadow)

function updateShadow() {
    scene.setShadow(guiOptions.ShadowEnabled, guiOptions.ShadowResolution, guiOptions.ShadowBias)
    scene.renderer.shadowMap.type = guiOptions.ShadowType
}


guiShader.add(guiOptions, 'ShadowTexPreMix', 0, 1).onChange(updateMaterialShadow)
guiShader.add(guiOptions, 'ShadowTexTest', 0, 1).onChange(updateMaterialShadow)
guiShader.add(guiOptions, 'ShadowTexThreshold', 0, 0.2).onChange(updateMaterialShadow)
guiShader.add(guiOptions, 'ShadowTexTransition', 0, 0.01).onChange(updateMaterialShadow)
guiShader.add(guiOptions, 'ShadowTexAmount', -1, 1).onChange(updateMaterialShadow)

function updateMaterialShadow() {
    shadowOptions.preMix = guiOptions.ShadowTexPreMix
    shadowOptions.test = guiOptions.ShadowTexTest
    shadowOptions.threshold = guiOptions.ShadowTexThreshold
    shadowOptions.transition = guiOptions.ShadowTexTransition
    shadowOptions.amount = guiOptions.ShadowTexAmount

    scene.characters.map(x => x.character).filter(x => !!x).map(x => x.meshes.forEach(mesh => {
        const shader = mesh.shader
        if (!shader) return

        if (shader.uniforms.uShadowPreMix) {
            shader.uniforms.uShadowPreMix.value = shadowOptions.preMix
        }
        if (shader.uniforms.uShadowTest) {
            shader.uniforms.uShadowTest.value = shadowOptions.test
        }
        if (shader.uniforms.uShadowThreshold) {
            shader.uniforms.uShadowThreshold.value = shadowOptions.threshold
        }
        if (shader.uniforms.uShadowTransition) {
            shader.uniforms.uShadowTransition.value = shadowOptions.transition
        }
        if (shader.uniforms.uShadowAmount) {
            shader.uniforms.uShadowAmount.value = shadowOptions.amount
        }
    }))
}
