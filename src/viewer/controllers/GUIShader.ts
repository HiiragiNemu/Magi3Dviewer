import { ShadowOptions, ShadowTexOptions, getMeshShadowMaterialUniforms, getMeshGeneralMaterialUniforms } from 'magia-exedra-character-three/shaders';
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
export const guiFloorShadowOpacity = guiShader.add(guiOptions, 'FloorShadowOpacity', 0, 1).onChange(updateShadow)

function updateShadow() {
    scene.shadow.enabled = guiOptions.ShadowEnabled
    scene.shadow.resolution = guiOptions.ShadowResolution
    scene.shadow.bias = guiOptions.ShadowBias
    scene.shadow.floorOpacity = guiOptions.FloorShadowOpacity

    scene.renderer.shadowMap.type = guiOptions.ShadowType
}

guiShader.add(guiOptions, 'ShadowAlphaTest', 0, 1).onChange(() => {
    ShadowOptions.alphaTest = guiOptions.ShadowAlphaTest

    scene.characters
        .map(x => x.character)
        .flatMap(x => x?.meshes.map(x => x.mesh))
        .filter(x => !!x)
        .flatMap(x => getMeshShadowMaterialUniforms(x))
        .forEach(uniforms => uniforms.loadGlobalOptions())
})

guiShader.add(guiOptions, 'ShadowTexPreMix', 0, 1).onChange(updateMaterialShadow)
guiShader.add(guiOptions, 'ShadowTexTest', 0, 1).onChange(updateMaterialShadow)
guiShader.add(guiOptions, 'ShadowTexThreshold', 0, 0.2).onChange(updateMaterialShadow)
guiShader.add(guiOptions, 'ShadowTexTransition', 0, 0.01).onChange(updateMaterialShadow)
guiShader.add(guiOptions, 'ShadowTexAmount', -1, 1).onChange(updateMaterialShadow)

function updateMaterialShadow() {
    ShadowTexOptions.preMix = guiOptions.ShadowTexPreMix
    ShadowTexOptions.test = guiOptions.ShadowTexTest
    ShadowTexOptions.threshold = guiOptions.ShadowTexThreshold
    ShadowTexOptions.transition = guiOptions.ShadowTexTransition
    ShadowTexOptions.amount = guiOptions.ShadowTexAmount

    scene.characters
        .map(x => x.character)
        .flatMap(x => x?.meshes.map(x => x.mesh))
        .filter(x => !!x)
        .flatMap(x => getMeshGeneralMaterialUniforms(x))
        .forEach(uniforms => uniforms.loadGlobalOptions())
}
