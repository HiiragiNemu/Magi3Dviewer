import { shaderOptions } from 'magia-exedra-character-three/shaders';
import { scene } from '../scene';
import { gui, guiOptions } from './GUI';

const guiShader = gui.addFolder('Shader')

guiShader.add(guiOptions, 'ShadowThreshold', 0, 1).onChange(updateShaders)
guiShader.add(guiOptions, 'ShadowTransition', 0, 1).onChange(updateShaders)
guiShader.add(guiOptions, 'ShadowMinLight', 0, 1).onChange(updateShaders)

function updateShaders() {
    shaderOptions.shadowThreshold = guiOptions.ShadowThreshold
    shaderOptions.shadowTransition = guiOptions.ShadowTransition
    shaderOptions.shadowMinLight = guiOptions.ShadowMinLight

    scene.characters.map(x => x.character).filter(x => !!x).map(x => x.meshes.forEach(mesh => {
        const shader = mesh.shader
        if (!shader) return

        if (shader.uniforms.uShadowThreshold) {
            shader.uniforms.uShadowThreshold.value = shaderOptions.shadowThreshold
        }
        if (shader.uniforms.uShadowTransition) {
            shader.uniforms.uShadowTransition.value = shaderOptions.shadowTransition
        }
        if (shader.uniforms.uShadowMinLight) {
            shader.uniforms.uShadowMinLight.value = shaderOptions.shadowMinLight
        }
    }))
}
