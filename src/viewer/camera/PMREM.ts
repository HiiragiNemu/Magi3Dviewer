import * as THREE from 'three'
import { scene } from '../scene'
import { perfPanoramaDraw, perfPmrem } from "../performance"
import { cameraDownscaleSize } from "./consts"
import { showCanvas } from './environment'

const cameraPanoramaCanvas = document.createElement('canvas')
cameraPanoramaCanvas.width = cameraDownscaleSize * 2
cameraPanoramaCanvas.height = cameraDownscaleSize
const cameraPanoramaCanvasCtx = cameraPanoramaCanvas.getContext('2d')

let cameraPanoramaTex: THREE.Texture | undefined = undefined
let pmremRenderTarget: THREE.WebGLRenderTarget | undefined = undefined

const pmremGenerator = new THREE.PMREMGenerator(scene.renderer);
pmremGenerator.compileEquirectangularShader();

export function updatePMREM(image: CanvasImageSource) {
    if (!cameraPanoramaCanvasCtx) return

    const drawWidth = cameraPanoramaCanvas.width / 2
    const drawHeight = cameraPanoramaCanvas.height

    perfPanoramaDraw.start()
    cameraPanoramaCanvasCtx.drawImage(image, 0, 0, drawWidth, drawHeight) // draw the front side
    cameraPanoramaCanvasCtx.scale(-1, 1)
    cameraPanoramaCanvasCtx.drawImage(image, 0 - drawWidth * 2, 0, drawWidth, drawHeight) // draw the rear side (mirrord front side)
    cameraPanoramaCanvasCtx.resetTransform()
    perfPanoramaDraw.stop()

    if (!cameraPanoramaTex) {
        cameraPanoramaTex = new THREE.Texture(cameraPanoramaCanvas)
        cameraPanoramaTex.colorSpace = THREE.SRGBColorSpace
        // cameraTex.mapping = THREE.EquirectangularReflectionMapping
    }
    cameraPanoramaTex.needsUpdate = true

    perfPmrem.start() // PMREM computes on GPU, so the CPU time is always very short
    // we need to re-calculate PMREM every time, or it won't update
    const renderTarget = pmremGenerator.fromEquirectangular(cameraPanoramaTex)
    perfPmrem.stop()
    scene.scene.environment = renderTarget.texture
    // scene.scene.background = pmremTexNext

    pmremRenderTarget?.dispose() // dispose the old texture
    pmremRenderTarget = renderTarget
}

export function disposePMREM() {
    scene.scene.environment = null
    scene.scene.background = null

    cameraPanoramaTex?.dispose()
    cameraPanoramaTex = undefined
    pmremRenderTarget?.dispose()
    pmremRenderTarget = undefined
}

if (false) {
    showCanvas(cameraPanoramaCanvas)
}
