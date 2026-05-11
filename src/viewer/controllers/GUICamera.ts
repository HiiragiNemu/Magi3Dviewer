import { gui, guiOptions } from './GUI';
import { CameraSettings, getCameraVideoResolution, isCameraEnabled, setCameraStreamDimensions, setCameraVideoFullscreen } from '../camera';
import { scene } from '../scene';
import { updateGuiLightingDynamic } from './GUILighting';

const guiCamera = gui.addFolder('Camera').close()
const guiCameraOptions = {
    CurrentResolution: '',
    Reset() {
        guiCamera.reset()
        scene.resetCameraControl()
    }
}

guiCamera.add(guiOptions, 'FOV', 5, 60).onChange(value => { scene.camera.fov = value; scene.camera.updateProjectionMatrix() })
guiCamera.add(guiOptions, 'CameraRotation', -90, 90).onChange(value => { scene.cameraRotation = value || undefined })

const guiCameraResolution = guiCamera.add(CameraSettings, 'resolution', ['720x1280', '1080x1920', '1440x1920', '2160x3840', '640x480', '800x600', '1024x768', '1280x720', '1280x960', '1920x1080', '1920x1440', '3840x2160']).name('CameraResolution').onChange(async (value) => {
    await setCameraStreamDimensions(value)
    updateCameraVideoCurrentResolution()
}).hide()
const guiCurrentResolution = guiCamera.add(guiCameraOptions, 'CurrentResolution').disable().hide()
const guiCameraFullscreen = guiCamera.add(guiOptions, 'CameraFullscreen').onChange(setCameraVideoFullscreen).hide()

export function updateCameraVideoGUI() {
    [guiCameraResolution, guiCurrentResolution, guiCameraFullscreen].forEach(x => isCameraEnabled() ? x.show() : x.hide());
    updateGuiLightingDynamic()
}

export function updateCameraVideoCurrentResolution() {
    const resolution = getCameraVideoResolution()
    const resolutionStr = `${resolution.width}x${resolution.height}`
    guiCurrentResolution.setValue(resolutionStr)
    guiCurrentResolution.initialValue = resolutionStr
}

// screen.orientation.addEventListener("change", updateCameraVideoCurrentResolution)

guiCamera.add(guiCameraOptions, 'Reset').name('Reset camera')
