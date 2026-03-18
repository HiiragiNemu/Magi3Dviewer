import * as THREE from 'three'
import { scene } from '../scene';
import { MagiaExedraScene3D, deg2pos } from 'magia-exedra-character-three/scene'

import { gui, guiOptions } from "./GUI";
import { CameraEnvironmentOptions } from '../camera/environment';
import { cameraVideo } from '../camera';

const lightingFolder = gui.addFolder('Lighting').close()
const guiLightingOptions = {
    Reset() {
        lightingFolder.reset()
    }
}

export const guiBgColor = lightingFolder.addColor(guiOptions, 'BgColor').onChange(value => {
    document.body.style.backgroundColor = value
    const color = new THREE.Color(value)
    const luminance = rgb2luminance(color.r, color.g, color.b);
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

/** W3C Luminance Formula */
export function rgb2luminance(r: number, g: number, b: number) {
    return 0.299 * r + 0.587 * g + 0.114 * b
}

export const guiCameraEnvironment = lightingFolder.add(CameraEnvironmentOptions, 'enabled').name('CameraEnvironment').onChange(updateGuiLightingDynamic).hide()
export const guiDynamicAmbient = lightingFolder.add(CameraEnvironmentOptions, 'enablePMREM').name('DynamicAmbient').hide()
export const guiDynamicLight = lightingFolder.add(CameraEnvironmentOptions, 'enableLightCalculation').name('DynamicLight').hide()

export function updateGuiLightingDynamic() {
    const cameraEnabled = !!cameraVideo.srcObject

    if (cameraEnabled) {
        guiCameraEnvironment.show()
    } else {
        guiCameraEnvironment.hide()
    }

    if (cameraEnabled && CameraEnvironmentOptions.enabled) {
        guiDynamicAmbient.show()
        guiDynamicLight.show()
    } else {
        guiDynamicAmbient.hide()
        guiDynamicLight.hide()
    }
}

lightingFolder.add(guiLightingOptions, 'Reset').name('Reset lighting')
