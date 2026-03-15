import { gui, guiOptions } from './GUI';
import { CameraSettings, getCameraStreamDimensions, setCameraStreamDimensions, setCameraVideoFullscreen } from '../camera';
import { scene } from '../scene';

const cameraOptions = {
    CurrentResolution: '',
    Reset() {
        guiCamera.reset()
        scene.resetCameraControl()
    }
}
const guiCamera = gui.addFolder('Camera').close()

guiCamera.add(guiOptions, 'FOV', 5, 60).onChange(value => { scene.camera.fov = value; scene.camera.updateProjectionMatrix() })
guiCamera.add(guiOptions, 'CameraRotation', -90, 90).onChange(value => { scene.cameraRotation = value || undefined })

const guiCameraResolution = guiCamera.add(guiOptions, 'CameraResolution', ['640x480', '800x600', '1024x768', '1280x720', '1280x960', '1920x1080', '1920x1440', '3840x2160']).onChange(async (value) => {
    CameraSettings.resolution = value
    await setCameraStreamDimensions(value)
    updateCameraVideoCurrentResolution()
}).hide()
const guiCurrentResolution = guiCamera.add(cameraOptions, 'CurrentResolution').disable().hide()
const guiCameraFullscreen = guiCamera.add(guiOptions, 'CameraFullscreen').onChange(setCameraVideoFullscreen).hide()

export function setCameraVideoOptionsVisible(visible: boolean) {
    [guiCameraResolution, guiCurrentResolution, guiCameraFullscreen].forEach(x => visible ? x.show() : x.hide())
}

export function updateCameraVideoCurrentResolution() {
    const resolution = getCameraStreamDimensions()
    const resolutionStr = `${resolution.width}x${resolution.height}`
    guiCurrentResolution.setValue(resolutionStr)
    guiCurrentResolution.initialValue = resolutionStr
}

// screen.orientation.addEventListener("change", updateCameraVideoCurrentResolution)

guiCamera.add(cameraOptions, 'Reset').name('Reset camera')
