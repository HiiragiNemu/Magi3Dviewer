import * as THREE from 'three'
import { scene, ViewerScene, deg2pos, viewerEl } from '../scene';
import { gui, guiOptions } from "./GUI";

const lightingFolder = gui.addFolder('Lighting')

export const guiBgColor = lightingFolder.addColor(guiOptions, 'BgColor').onChange(value => {
    viewerEl.style.backgroundColor = value
    const color = new THREE.Color(value)
    // W3C Luminance Formula
    const luminance = (0.299 * color.r) + (0.587 * color.g) + (0.114 * color.b);
    scene.outlinePass.visibleEdgeColor = luminance > 0.5 ? ViewerScene.outlineColorDark : ViewerScene.outlineColorLight
})
lightingFolder.addColor(guiOptions, 'AmbientLightColor').onChange(value => scene.ambientLight.color = new THREE.Color(value))
lightingFolder.addColor(guiOptions, 'DirectionalLightColor').onChange(value => scene.directionalLight.color = new THREE.Color(value))
lightingFolder.add(guiOptions, 'AmbientLight', 0, 5).onChange(value => scene.ambientLight.intensity = value)
lightingFolder.add(guiOptions, 'DirectionalLight', 0, 5).onChange(value => scene.directionalLight.intensity = value)
lightingFolder.add(guiOptions, 'LightAngle', -180, 180).onChange(updateSceneDirectionalLight)
lightingFolder.add(guiOptions, 'LightHeight', -5, 5).onChange(updateSceneDirectionalLight)
lightingFolder.add(guiOptions, 'LightDistance', 0, 10).onChange(updateSceneDirectionalLight)

function updateSceneDirectionalLight() {
    const { x, z } = deg2pos(guiOptions.LightAngle, guiOptions.LightDistance)
    scene.directionalLight.position.set(x, guiOptions.LightHeight, z)
}
