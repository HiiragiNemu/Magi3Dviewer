import { shadowOptions } from 'magia-exedra-character-three/shaders';
import { scene } from '../scene';
import { gui, guiOptions } from './GUI';

export const guiShader = gui.addFolder('Shader').close()

guiShader.add(guiOptions, 'ShadowPreMix', 0, 1).onChange(updateShaders)
guiShader.add(guiOptions, 'ShadowThreshold', 0, 0.2).onChange(updateShaders)
guiShader.add(guiOptions, 'ShadowTransition', 0, 0.01).onChange(updateShaders)
guiShader.add(guiOptions, 'ShadowAmount', -1, 1).onChange(updateShaders)

function updateShaders() {
    shadowOptions.preMix = guiOptions.ShadowPreMix
    shadowOptions.threshold = guiOptions.ShadowThreshold
    shadowOptions.transition = guiOptions.ShadowTransition
    shadowOptions.amount = guiOptions.ShadowAmount

    scene.characters.map(x => x.character).filter(x => !!x).map(x => x.meshes.forEach(mesh => {
        const shader = mesh.shader
        if (!shader) return

        if (shader.uniforms.uShadowPreMix) {
            shader.uniforms.uShadowPreMix.value = shadowOptions.preMix
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
