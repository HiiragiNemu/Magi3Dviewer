import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/Addons.js';
import { scene } from '../scene'
import { addAnimationLoop, removeAnimationLoop } from 'magia-exedra-character-three/renderer'
import { updateSceneLight } from './lighting'
import { clearCameraPerformance, perfCreateImageBitmap, perfWorkerDownscale, perfWorkerLightDraw, perfWorkerLightGet, perfWorkerTotal } from '../performance'
import { disposePMREM, updatePMREM } from './PMREM'
import CameraWorker from './worker?worker'
import type { CameraWorkerMessage } from './worker';
import { cameraVideo } from './camera';

const cameraWorker = new CameraWorker()

const _cameraEnvironmentOptions = {
    active: false,
    enableLightCalculation: true,
}

/**
 * Use the webcam to create a panorama and apply it as scene environment, to provide ambient lighting
 */
export const CameraEnvironmentOptions = {
    /** Whether to constantly fetch camera feed and compute scene environment */
    get active() {
        return _cameraEnvironmentOptions.active
    },
    set active(value) {
        _cameraEnvironmentOptions.active = value
        if (value) {
            addAnimationLoop(updateSceneEnvironment)
            submitCameraImage()
        } else {
            removeAnimationLoop(updateSceneEnvironment)
            disposePMREM()
            clearCameraPerformance()
        }
    },
    /** Set to `false` to pause updating environment when active */
    enabled: true,
    enablePMREM: true,
    get enableLightCalculation() {
        return _cameraEnvironmentOptions.enableLightCalculation
    },
    set enableLightCalculation(value) {
        _cameraEnvironmentOptions.enableLightCalculation = value
        cameraWorker.postMessage({
            settings: { lighting: value }
        } satisfies CameraWorkerMessage)
    },
}

let workerTotalTime: number | undefined = undefined
const environmentMinFrametime = 40 // avoid PMREM overwhelming the GPU when worker time is short

function updateSceneEnvironment() {
    if (!CameraEnvironmentOptions.enabled) return

    // run at half of worker framerate
    if (workerTotalTime != undefined) {
        setTimeout(() => {
            submitCameraImage()
        }, Math.max(workerTotalTime, environmentMinFrametime));
        workerTotalTime = undefined
    }
}

async function submitCameraImage() {
    perfCreateImageBitmap.start()
    const imageBitmapPromise = createImageBitmap(cameraVideo)
    perfCreateImageBitmap.stop()

    const cameraImage = await imageBitmapPromise
    cameraWorker.postMessage(
        { cameraImage } satisfies CameraWorkerMessage,
        [cameraImage]
    )
}

cameraWorker.onmessage = e => {
    if (typeof e.data != 'object') return
    const data = e.data as CameraWorkerMessage

    if (data.downscaledImage) {
        try {
            if (CameraEnvironmentOptions.active && CameraEnvironmentOptions.enablePMREM) {
                updatePMREM(data.downscaledImage.image)
                perfWorkerDownscale.setTimeMs(data.downscaledImage.timeDraw)
            }
        } finally {
            data.downscaledImage.image.close()
        }
    }

    if (data.lightingData && CameraEnvironmentOptions.active && CameraEnvironmentOptions.enableLightCalculation) {
        updateSceneLight(data.lightingData.data)
        perfWorkerLightDraw.setTimeMs(data.lightingData.timeDraw)
        perfWorkerLightGet.setTimeMs(data.lightingData.timeGet)
    }

    if (data.finish && CameraEnvironmentOptions.active) {
        workerTotalTime = data.finish.totalTime
        perfWorkerTotal.setTimeMs(data.finish.totalTime)
    }
}

export function showCanvas(canvas: HTMLCanvasElement) {
    canvas.style.maxWidth = '100%'
    canvas.style.maxHeight = '25%'
    canvas.style.border = '2px solid red'
    canvas.style.boxSizing = 'content-box'
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

Object.assign(window, { enableTestEnvironmentMap })
