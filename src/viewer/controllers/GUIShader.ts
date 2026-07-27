import {
    ShadowTexOptions,
    getMeshGeneralMaterialUniforms,
    getMeshToonStylizationUniforms,
    toonStylizationOptions,
} from 'magia-exedra-character-three/shaders';
import { scene } from '../scene';
import { gui } from './GUI';

export const guiShader = gui.addFolder('Shader').close()

guiShader.add(ShadowTexOptions, 'preMix', 0, 1).name('ShadowTexPreMix').onChange(updateMaterialShadow)
guiShader.add(ShadowTexOptions, 'test', 0, 1).name('ShadowTexTest').onChange(updateMaterialShadow)
guiShader.add(ShadowTexOptions, 'threshold', 0, 0.2).name('ShadowTexThreshold').onChange(updateMaterialShadow)
guiShader.add(ShadowTexOptions, 'transition', 0, 0.01).name('ShadowTexTransition').onChange(updateMaterialShadow)
guiShader.add(ShadowTexOptions, 'amount', -1, 1).name('ShadowTexAmount').onChange(updateMaterialShadow)

const rimFolder = guiShader.addFolder('Rim light').close()
rimFolder.add(toonStylizationOptions, 'rimEnabled').name('Enabled').onChange(updateMaterialStylization)
rimFolder.addColor(toonStylizationOptions, 'rimColor').name('Color').onChange(updateMaterialStylization)
rimFolder.add(toonStylizationOptions, 'rimStrength', 0, 2, 0.01).name('Strength').onChange(updateMaterialStylization)
rimFolder.add(toonStylizationOptions, 'rimThreshold', 0, 1, 0.01).name('Threshold').onChange(updateMaterialStylization)
rimFolder.add(toonStylizationOptions, 'rimFeather', 0, 0.5, 0.01).name('Feather').onChange(updateMaterialStylization)
rimFolder.add(toonStylizationOptions, 'rimDirectionX', -1, 1, 0.01).name('Direction X').onChange(updateMaterialStylization)
rimFolder.add(toonStylizationOptions, 'rimDirectionY', -1, 1, 0.01).name('Direction Y').onChange(updateMaterialStylization)
rimFolder.add(toonStylizationOptions, 'rimDirectionality', 0, 1, 0.01).name('Directionality').onChange(updateMaterialStylization)

const fresnelFolder = guiShader.addFolder('Fresnel').close()
fresnelFolder.add(toonStylizationOptions, 'fresnelEnabled').name('Enabled').onChange(updateMaterialStylization)
fresnelFolder.addColor(toonStylizationOptions, 'fresnelColor').name('Color').onChange(updateMaterialStylization)
fresnelFolder.add(toonStylizationOptions, 'fresnelStrength', 0, 2, 0.01).name('Strength').onChange(updateMaterialStylization)
fresnelFolder.add(toonStylizationOptions, 'fresnelThreshold', 0, 1, 0.01).name('Threshold').onChange(updateMaterialStylization)
fresnelFolder.add(toonStylizationOptions, 'fresnelFeather', 0, 0.5, 0.01).name('Feather').onChange(updateMaterialStylization)

function getLoadedMeshes() {
    return scene.characters
        .map(x => x.character)
        .flatMap(x => x?.meshes.map(mesh => mesh.mesh) ?? [])
}

function updateMaterialShadow() {
    getLoadedMeshes()
        .flatMap(mesh => getMeshGeneralMaterialUniforms(mesh))
        .forEach(uniforms => uniforms.loadGlobalOptions())
}

function updateMaterialStylization() {
    getLoadedMeshes()
        .flatMap(mesh => getMeshToonStylizationUniforms(mesh))
        .forEach(uniforms => uniforms.loadGlobalOptions())
}
