import * as THREE from 'three'
import { cameraVideo } from './background'
import { scene } from '../scene'
import { getClockDelta } from 'magia-exedra-character-three/renderer'

const cameraPanoramaCanvas = document.createElement('canvas')
cameraPanoramaCanvas.width = 512
cameraPanoramaCanvas.height = 256
const cameraPanoramaCanvasCtx = cameraPanoramaCanvas.getContext('2d')

let cameraPanoramaTex: THREE.Texture | undefined = undefined
let pmremRenderTarget: THREE.WebGLRenderTarget | undefined = undefined

const pmremGenerator = new THREE.PMREMGenerator(scene.renderer);
pmremGenerator.compileEquirectangularShader();

let accumulatedTimeDelta = 0
const environmentUpdateTime = 1 / 5

/**
 * Use the webcam to create a panorama and apply it as scene environment, to provide ambient lighting
 */
export function updateSceneEnvironment() {
    if (!cameraPanoramaCanvasCtx) return

    // run at a throttled framerate. the PMREM calculation is heavy
    accumulatedTimeDelta += getClockDelta()
    if (accumulatedTimeDelta < environmentUpdateTime) return
    accumulatedTimeDelta = 0

    const drawWidth = cameraPanoramaCanvas.width / 2
    const drawHeight = cameraPanoramaCanvas.height

    cameraPanoramaCanvasCtx.drawImage(cameraVideo, 0, 0, drawWidth, drawHeight) // draw the front side
    cameraPanoramaCanvasCtx.scale(-1, 1)
    cameraPanoramaCanvasCtx.drawImage(cameraVideo, 0 - drawWidth * 2, 0, drawWidth, drawHeight) // draw the rear side (mirrord front side)
    cameraPanoramaCanvasCtx.resetTransform()

    if (!cameraPanoramaTex) {
        cameraPanoramaTex = new THREE.Texture(cameraPanoramaCanvas)
        cameraPanoramaTex.colorSpace = THREE.SRGBColorSpace
        // cameraTex.mapping = THREE.EquirectangularReflectionMapping
    }
    cameraPanoramaTex.needsUpdate = true

    // we need to re-calculate PMREM every time, or it won't update
    const renderTarget = pmremGenerator.fromEquirectangular(cameraPanoramaTex)
    scene.scene.environment = renderTarget.texture
    // scene.scene.background = pmremTexNext

    pmremRenderTarget?.dispose() // dispose the old texture
    pmremRenderTarget = renderTarget
}

export function disposeEnvironmentMaps() {
    cameraPanoramaTex?.dispose()
    cameraPanoramaTex = undefined
    pmremRenderTarget?.dispose()
    pmremRenderTarget = undefined
}
