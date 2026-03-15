import * as THREE from 'three'
import { scene } from '../scene';
import { MagiaExedraScene3D, deg2pos } from 'magia-exedra-character-three/scene'

import { gui, guiOptions } from "./GUI";

const lightingFolder = gui.addFolder('Lighting')

export const guiBgColor = lightingFolder.addColor(guiOptions, 'BgColor').onChange(value => {
    document.body.style.backgroundColor = value
    const color = new THREE.Color(value)
    // W3C Luminance Formula
    const luminance = (0.299 * color.r) + (0.587 * color.g) + (0.114 * color.b);
    scene.outlinePass.visibleEdgeColor = luminance > 0.5 ? MagiaExedraScene3D.outlineColorDark : MagiaExedraScene3D.outlineColorLight
})
export const guiAmbientLightColor = lightingFolder.addColor(guiOptions, 'AmbientLightColor').onChange(value => scene.ambientLight.color = new THREE.Color(value))
export const guiDirectionalLightColor = lightingFolder.addColor(guiOptions, 'DirectionalLightColor').onChange(value => scene.directionalLight.color = new THREE.Color(value))
export const guiAmbientLight = lightingFolder.add(guiOptions, 'AmbientLight', 0, 10).onChange(value => scene.ambientLight.intensity = value)
export const guiDirectionalLight = lightingFolder.add(guiOptions, 'DirectionalLight', 0, 10).onChange(value => scene.directionalLight.intensity = value)
export const guiLightAngle = lightingFolder.add(guiOptions, 'LightAngle', -180, 180).onChange(updateSceneDirectionalLight)
export const guiLightHeight = lightingFolder.add(guiOptions, 'LightHeight', -5, 5).onChange(updateSceneDirectionalLight)
export const guiLightDistance = lightingFolder.add(guiOptions, 'LightDistance', 0, 10).onChange(updateSceneDirectionalLight)

function updateSceneDirectionalLight() {
    const { x, z } = deg2pos(guiOptions.LightAngle, guiOptions.LightDistance)
    scene.directionalLight.position.set(x, guiOptions.LightHeight, z)
}
