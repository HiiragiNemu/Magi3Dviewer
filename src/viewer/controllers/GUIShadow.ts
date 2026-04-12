import { ShadowOptions, getMeshShadowMaterialUniforms } from 'magia-exedra-character-three/shaders';
import { scene } from '../scene';
import { gui } from './GUI';
import { createSquareExponentController } from './GUIExtensions';

export const guiShadow = gui.addFolder('Shadow').close()

guiShadow.add(scene.shadow, 'enabled').name('ShadowEnabled')

guiShadow.add(scene.renderer.shadowMap, 'type', {
    BasicShadowMap: 0,
    PCFShadowMap: 1,
    PCFSoftShadowMap: 2,
    VSMShadowMap: 3,
}).name('ShadowType')

createSquareExponentController(guiShadow, scene.shadow, 'resolution', 512, scene.renderer.capabilities.maxTextureSize).name('ShadowResolution')

guiShadow.add(scene.shadow, 'bias', -0.0001, 0).name('ShadowBias')

export const guiFloorShadowOpacity = guiShadow.add(scene.shadow, 'floorOpacity', 0, 1).name('FloorShadowOpacity')

guiShadow.add(ShadowOptions, 'alphaTest', 0, 1).name('ShadowAlphaTest').onChange(() => {
    scene.characters
        .map(x => x.character)
        .flatMap(x => x?.meshes.map(x => x.mesh))
        .filter(x => !!x)
        .flatMap(x => getMeshShadowMaterialUniforms(x))
        .forEach(uniforms => uniforms.loadGlobalOptions())
})


guiShadow.add(scene.shadow.camera.helper, 'visible').name('ShadowCameraHelper')

guiShadow.add(scene.shadow.camera, 'size', 2, 10).name('ShadowCameraSize')
guiShadow.add(scene.shadow.camera, 'offsetX', -2, 2).name('ShadowCameraOffsetX')
guiShadow.add(scene.shadow.camera, 'offsetY', -2, 2).name('ShadowCameraOffsetY')
