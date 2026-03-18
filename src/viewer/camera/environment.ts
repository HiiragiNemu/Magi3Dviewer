import * as THREE from 'three'
import { scene } from '../scene'
import { addAnimationLoop, getClockDelta, removeAnimationLoop } from 'magia-exedra-character-three/renderer'
import { updateSceneLight } from './lighting'
import { cameraDownscaleCanvas, cameraDownscaleSize, downscaleCamera } from './scale'
import { showCanvas } from './background'
import { clearCameraPerformance, perfPanoramaDraw, perfPmrem } from '../performance'

export const CameraEnvironmentOptions = {
    enabled: true,
    enablePMREM: true,
    enableLightCalculation: true
}

const cameraPanoramaCanvas = document.createElement('canvas')
cameraPanoramaCanvas.width = cameraDownscaleSize * 2
cameraPanoramaCanvas.height = cameraDownscaleSize
const cameraPanoramaCanvasCtx = cameraPanoramaCanvas.getContext('2d')

let cameraPanoramaTex: THREE.Texture | undefined = undefined
let pmremRenderTarget: THREE.WebGLRenderTarget | undefined = undefined

const pmremGenerator = new THREE.PMREMGenerator(scene.renderer);
pmremGenerator.compileEquirectangularShader();

let accumulatedTimeDelta = 0
const environmentUpdateTime = 1 / 5

function updateSceneEnvironment() {
    if (!CameraEnvironmentOptions.enabled) return

    // run at a throttled framerate. the PMREM calculation is heavy
    accumulatedTimeDelta += getClockDelta()
    if (accumulatedTimeDelta < environmentUpdateTime) return
    accumulatedTimeDelta = 0

    downscaleCamera()

    if (CameraEnvironmentOptions.enablePMREM) {
        updatePMREM()
    }

    if (CameraEnvironmentOptions.enableLightCalculation) {
        updateSceneLight()
    }
}

function updatePMREM() {
    if (!cameraPanoramaCanvasCtx) return

    const drawWidth = cameraPanoramaCanvas.width / 2
    const drawHeight = cameraPanoramaCanvas.height

    perfPanoramaDraw.start()
    cameraPanoramaCanvasCtx.drawImage(cameraDownscaleCanvas, 0, 0, drawWidth, drawHeight) // draw the front side
    cameraPanoramaCanvasCtx.scale(-1, 1)
    cameraPanoramaCanvasCtx.drawImage(cameraDownscaleCanvas, 0 - drawWidth * 2, 0, drawWidth, drawHeight) // draw the rear side (mirrord front side)
    cameraPanoramaCanvasCtx.resetTransform()
    perfPanoramaDraw.stop()

    if (!cameraPanoramaTex) {
        cameraPanoramaTex = new THREE.Texture(cameraPanoramaCanvas)
        cameraPanoramaTex.colorSpace = THREE.SRGBColorSpace
        // cameraTex.mapping = THREE.EquirectangularReflectionMapping
    }
    cameraPanoramaTex.needsUpdate = true

    perfPmrem.start()
    // we need to re-calculate PMREM every time, or it won't update
    const renderTarget = pmremGenerator.fromEquirectangular(cameraPanoramaTex)
    perfPmrem.stop()
    scene.scene.environment = renderTarget.texture
    // scene.scene.background = pmremTexNext

    pmremRenderTarget?.dispose() // dispose the old texture
    pmremRenderTarget = renderTarget
}

/**
 * Use the webcam to create a panorama and apply it as scene environment, to provide ambient lighting
 */
export function startUpdateSceneEnvironment() {
    addAnimationLoop(updateSceneEnvironment)
}

export function stopUpdateSceneEnvironment() {
    removeAnimationLoop(updateSceneEnvironment)
    scene.scene.environment = null
    scene.scene.background = null

    cameraPanoramaTex?.dispose()
    cameraPanoramaTex = undefined
    pmremRenderTarget?.dispose()
    pmremRenderTarget = undefined

    clearCameraPerformance()
}

if (false) {
    showCanvas(cameraPanoramaCanvas)
}
