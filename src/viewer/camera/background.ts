import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/Addons.js';
import { Controller } from 'three/addons/libs/lil-gui.module.min.js';
import { scene } from '../scene';
import { prettyPrintJSON } from '../controllers/presets';
import { addAnimationLoop, removeAnimationLoop } from 'magia-exedra-character-three/renderer';
import { guiAmbientLight, guiAmbientLightColor, guiDirectionalLight, guiDirectionalLightColor, guiFloorShadowOpacity, guiLightAngle, guiLightDistance, guiLightHeight, setCameraVideoOptionsVisible, updateCameraVideoCurrentResolution } from '../controllers';
import { disposeEnvironmentMaps, updateSceneEnvironment } from './environment';

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

    cameraVideo.onloadedmetadata = () => {
        addAnimationLoop(updateSceneEnvironment)
    }

    backupGuiValues(
        guiAmbientLightColor, guiAmbientLight,
        guiDirectionalLightColor, guiDirectionalLight,
        guiLightAngle, guiLightHeight, guiLightDistance,
        guiFloorShadowOpacity
    )
    guiAmbientLight.setValue(1.25)
    guiFloorShadowOpacity.setValue(0.25)

    setCameraVideoOptionsVisible(true)
    updateCameraVideoCurrentResolution()
}

export function disableSceneCamera() {
    removeAnimationLoop(updateSceneEnvironment)
    scene.scene.environment = null
    scene.scene.background = null

    disposeEnvironmentMaps()

    if (cameraStream) {
        cameraStream.getTracks().forEach(x => x.stop())
        cameraStream = undefined
    }

    restoreGuiValues()

    setCameraVideoOptionsVisible(false)
}

let savedGuiValues: { controller: Controller, value: unknown }[] | undefined

function backupGuiValues(...controllers: unknown[]) {
    savedGuiValues = controllers.filter(x => x instanceof Controller).map(controller => ({
        controller,
        value: controller.getValue()
    }))
}

function restoreGuiValues() {
    savedGuiValues?.forEach(x => x.controller.setValue(x.value))
}

export function getCameraStreamDimensions(): { width: number, height: number } {
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

// debug canvas
// showCanvas(cameraPanoramaCanvas)

export function showCanvas(canvas: HTMLCanvasElement) {
    canvas.style.maxWidth = '100%'
    canvas.style.maxHeight = '25%'
    canvas.style.border = '2px solid red'
    canvas.style.boxSizing = 'border-box'
    canvas.style.position = 'fixed'
    canvas.style.left = '0'
    canvas.style.bottom = '0'
    document.body.appendChild(canvas)
}

// plane for debugging environment reflection
if (false) {
    const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(100, 100),
        new THREE.MeshStandardMaterial({
            roughness: 0,
            metalness: 0.9,
            color: 0xffffff,
        })
    )
    plane.castShadow = true
    plane.receiveShadow = true
    plane.rotation.x = -Math.PI / 2
    plane.position.y = 0
    scene.scene.add(plane)
}

function enableTestEnvironmentMap() {
    new HDRLoader().load('https://sbcode.net/img/spruit_sunrise_1k.hdr', (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping
        scene.scene.environment = texture
        scene.scene.background = texture
    })
}

Object.assign(window, { cameraVideo, disableSceneCamera, enableTestEnvironmentMap, getCameraStreamDimensions, setCameraStreamDimensions, getCameraVideoTrack })
