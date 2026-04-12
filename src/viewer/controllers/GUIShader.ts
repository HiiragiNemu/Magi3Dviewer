import { ShadowTexOptions, getMeshGeneralMaterialUniforms } from 'magia-exedra-character-three/shaders';
import { scene } from '../scene';
import { gui } from './GUI';

export const guiShader = gui.addFolder('Shader').close()

guiShader.add(ShadowTexOptions, 'preMix', 0, 1).name('ShadowTexPreMix').onChange(updateMaterialShadow)
guiShader.add(ShadowTexOptions, 'test', 0, 1).name('ShadowTexTest').onChange(updateMaterialShadow)
guiShader.add(ShadowTexOptions, 'threshold', 0, 0.2).name('ShadowTexThreshold').onChange(updateMaterialShadow)
guiShader.add(ShadowTexOptions, 'transition', 0, 0.01).name('ShadowTexTransition').onChange(updateMaterialShadow)
guiShader.add(ShadowTexOptions, 'amount', -1, 1).name('ShadowTexAmount').onChange(updateMaterialShadow)

function updateMaterialShadow() {
    scene.characters
        .map(x => x.character)
        .flatMap(x => x?.meshes.map(x => x.mesh))
        .filter(x => !!x)
        .flatMap(x => getMeshGeneralMaterialUniforms(x))
        .forEach(uniforms => uniforms.loadGlobalOptions())
}
