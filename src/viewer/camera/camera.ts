import { Controller } from 'three/addons/libs/lil-gui.module.min.js';
import { prettyPrintJSON } from '../controllers/presets';
import { guiAmbientLight, guiAmbientLightColor, guiDirectionalLight, guiDirectionalLightColor, guiFloorShadowOpacity, guiLightAngle, guiLightDistance, guiLightHeight, updateCameraVideoCurrentResolution, updateCameraVideoGUI } from '../controllers';
import { CameraEnvironmentOptions } from './environment';
import { MagiaExedraScene3D } from 'magia-exedra-character-three';

export const CameraSettings = {
    resolution: '1920x1440'
}

export const cameraVideo = document.getElementById('camera-bg') as HTMLVideoElement
let cameraStream: MediaStream | undefined = undefined

export async function enableSceneCamera() {
    cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
            width: { ideal: parseResolutionString(CameraSettings.resolution).width },
            height: { ideal: parseResolutionString(CameraSettings.resolution).height },
            aspectRatio: { ideal: 4 / 3 },
            facingMode: "environment",
        }
    })

    cameraStream.getTracks().forEach(x => prettyPrintJSON(x.getSettings()));

    cameraVideo.srcObject = cameraStream
    cameraVideo.play()

    backupGuiValues(
        guiAmbientLightColor, guiAmbientLight,
        guiDirectionalLightColor, guiDirectionalLight,
        guiLightAngle, guiLightHeight, guiLightDistance,
        guiFloorShadowOpacity
    )

    guiAmbientLightColor.setValue(MagiaExedraScene3D.ambientLightInitialColor)
    guiAmbientLight.setValue(1.25)
    guiAmbientLight.initialValue = 1.25

    guiDirectionalLightColor.setValue(MagiaExedraScene3D.directionalLightInitialColor)
    // guiLightDistance.setValue(5)
    // guiLightDistance.initialValue = 5

    // guiFloorShadowOpacity.setValue(0.25)
    // guiFloorShadowOpacity.initialValue = 0.25

    updateCameraVideoGUI()

    cameraVideo.onloadedmetadata = () => {
        updateCameraVideoCurrentResolution()
        CameraEnvironmentOptions.active = true
    }
}

export function disableSceneCamera() {
    CameraEnvironmentOptions.active = false

    cameraVideo.srcObject = null
    if (cameraStream) {
        cameraStream.getTracks().forEach(x => x.stop())
        cameraStream = undefined
    }

    restoreGuiValues()

    updateCameraVideoGUI()
}

let savedGuiValues: Array<{
    controller: Controller,
    value: unknown,
    initialValue: unknown,
    // TODO: initial color hex value
}> | undefined

function backupGuiValues(...controllers: unknown[]) {
    savedGuiValues = controllers.filter(x => x instanceof Controller).map(controller => ({
        controller,
        value: controller.getValue(),
        initialValue: controller.initialValue,
    }))
}

function restoreGuiValues() {
    savedGuiValues?.forEach(x => {
        x.controller.initialValue = x.initialValue
        x.controller.setValue(x.value)
    })
}

export function getCameraVideoResolution(): { width: number, height: number } {
    if (cameraVideo.srcObject) {
        return {
            width: cameraVideo.videoWidth,
            height: cameraVideo.videoHeight
        }
    } else {
        return { width: 0, height: 0 }
    }
}

function getCameraStreamDimensions(): { width: number, height: number } {
    const track = getCameraVideoTrack()
    if (!track) {
        return { width: 0, height: 0 }
    }
    const settings = track.getSettings()
    return {
        width: settings.width ?? 0,
        height: settings.height ?? 0,
    }
}

export async function setCameraStreamDimensions(width: number | string, height?: number) {
    if (typeof width == 'string') {
        ({ width, height } = parseResolutionString(width));
    } else if (height == undefined) {
        height = width
    }

    const track = getCameraVideoTrack()
    if (!track) return

    console.log(`trying to set camera resolution to ${width}x${height}`)
    await track.applyConstraints({ width, height })

    await new Promise(resolve => {
        if (cameraVideo.requestVideoFrameCallback != undefined) {
            cameraVideo.requestVideoFrameCallback(resolve)
        } else {
            console.log('`requestVideoFrameCallback` is not available')
            setTimeout(resolve, 1000)
        }
    })
    prettyPrintJSON(track.getSettings())
    console.log(getCameraVideoResolution())
}

function getCameraVideoTrack() {
    return cameraStream?.getTracks().find(x => x.kind == 'video')
}

function parseResolutionString(resolution: string) {
    const [width, height] = resolution.split('x')
    return {
        width: parseInt(width),
        height: parseInt(height)
    }
}

export function setCameraVideoFullscreen(fullscreen: boolean) {
    if (fullscreen) {
        cameraVideo.style.removeProperty('object-fit')
    } else {
        cameraVideo.style.objectFit = 'contain'
    }
}

Object.assign(window, { cameraVideo, disableSceneCamera, getCameraVideoResolution, getCameraStreamDimensions, setCameraStreamDimensions, getCameraVideoTrack })
